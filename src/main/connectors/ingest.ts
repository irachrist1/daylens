// The connector ingestion path (DEV-186). Every connector's records enter
// local memory through THIS module and nowhere else:
//
//   adapter.sync() → typed envelopes → consent gate → one transaction:
//     connector_records ledger  (idempotent by opaque source identity)
//     entity repository         (the same adoptConnectedEnvelope path the
//                                batch-7 fixtures exercise)
//     entity_evidence_refs      (sourceType 'connector' — the exact rows
//                                disconnect-with-delete removes)
//     external_signals          (per-day calendar projection for the surfaces
//                                that already read the day layer)
//     sync cursor               (advances ONLY with the page's evidence;
//                                a failed page rolls the whole thing back)
//
// The gate is the existing privacy machinery, not a parallel one: capture
// consent must be current (shared/captureConsent.ts) AND the global
// connected-sources switch must be on. When the gate is closed the page is
// refused outright — nothing is written, not even bookkeeping.

import type Database from 'better-sqlite3'
import type {
  CalendarEventSignal,
  CalendarSignal,
  ConnectorId,
  GitActivitySignal,
  MeetingNotesSignal,
} from '@shared/types'
import { isCaptureConsentCurrent } from '@shared/captureConsent'
import { getSettings } from '../services/settings'
import { getExternalSignal } from '../services/externalSignals'
import {
  adoptConnectedEnvelope,
  unifyMeetingNoteIdentity,
  unifyRepositoryEntityIdentity,
} from '../services/entities/entityAdoption'
import { addEntityEvidenceRef, resolvePersonEntity } from '../services/entities/entityRepository'
import {
  validateRecordEnvelope,
  type ConnectorDaySignalEvent,
  type ConnectorGitDaySignal,
  type ConnectorNotesDaySignal,
  type ConnectorRecordEnvelope,
  type ConnectorSyncPage,
} from './contract'
import {
  commitConnectorSync,
  getConnectorRecord,
  listConnectorRecords,
  tombstoneConnectorRecord,
  upsertConnectorRecord,
} from './store'
import {
  removeConnectorDaySignalEvent,
  removeConnectorGitDaySignalEvent,
  removeConnectorNotesDaySignalEvent,
  removeConnectorRecordDerivedData,
} from './purge'
import { connectorEvidenceSourceId } from './evidenceId'

export { connectorEvidenceSourceId } from './evidenceId'

// ─── Gate ────────────────────────────────────────────────────────────────────

export interface ConnectorIngestGate {
  isConsentCurrent(): boolean
  connectedSourcesEnabled(): boolean
}

export function defaultConnectorGate(): ConnectorIngestGate {
  return {
    isConsentCurrent: () => {
      try { return isCaptureConsentCurrent(getSettings().captureConsent) } catch { return false }
    },
    connectedSourcesEnabled: () => {
      try { return getSettings().connectedSourcesEnabled !== false } catch { return false }
    },
  }
}

export function connectorGateState(gate: ConnectorIngestGate): 'open' | 'blocked_consent' | 'blocked_disabled' {
  if (!gate.isConsentCurrent()) return 'blocked_consent'
  if (!gate.connectedSourcesEnabled()) return 'blocked_disabled'
  return 'open'
}

// ─── Day-signal merge ────────────────────────────────────────────────────────

const sameDayEvent = (a: { startClock: string; title: string }, b: { startClock: string; title: string }) =>
  a.startClock === b.startClock && a.title === b.title

/**
 * Merge connector calendar events into the external_signals day layer.
 * Deliberately NOT putExternalSignal: that path re-mints meeting entities from
 * (date, clock, title) identity, and these events already minted entities with
 * their REAL source ids through the envelope path — going through it would
 * duplicate every meeting. The write is the same row shape, merged by
 * (startClock, title) so a co-existing local calendar source is preserved.
 */
export function mergeConnectorCalendarDaySignal(
  db: Database.Database,
  date: string,
  events: ConnectorDaySignalEvent[],
  nowMs = Date.now(),
): void {
  if (events.length === 0) return
  const incoming: CalendarEventSignal[] = events.map((event) => ({
    title: event.title,
    startClock: event.startClock,
    durationMinutes: event.durationMinutes,
    attendeeCount: event.attendeeCount,
  }))
  const existing = getExternalSignal<CalendarSignal>(db, date, 'calendar')?.payload.events ?? []
  const kept = existing.filter((event) => !incoming.some((candidate) => sameDayEvent(candidate, event)))
  const merged: CalendarSignal = { events: [...kept, ...incoming] }
  db.prepare(`
    INSERT INTO external_signals (date, source, payload_json, captured_at)
    VALUES (?, 'calendar', ?, ?)
    ON CONFLICT(date, source) DO UPDATE SET
      payload_json = excluded.payload_json,
      captured_at = excluded.captured_at
  `).run(date, JSON.stringify(merged), nowMs)
}

/** The honest source label the notes day row shows ("Granola"). */
function connectorDisplayLabel(connectorId: ConnectorId): string {
  switch (connectorId) {
    case 'granola': return 'Granola'
    case 'linear': return 'Linear'
    case 'github': return 'GitHub'
    case 'google_calendar': return 'Google Calendar'
    case 'outlook_calendar': return 'Outlook Calendar'
    default: return connectorId
  }
}

/** Cap per repo per day so one rebase spree cannot flood the day layer. */
const MAX_DAY_COMMIT_MESSAGES = 12

/**
 * Merge connector git contributions into the external_signals 'git' day row —
 * the same row shape the local git probe writes and enrichment/wraps read.
 * Commits merge by exact subject line within their repo entry (so a commit the
 * local probe already found is not double-counted); PRs merge by (title, repo).
 */
export function mergeConnectorGitDaySignal(
  db: Database.Database,
  date: string,
  signals: ConnectorGitDaySignal[],
  nowMs = Date.now(),
): void {
  if (signals.length === 0) return
  const stored = getExternalSignal<GitActivitySignal>(db, date, 'git')?.payload
  const payload: GitActivitySignal = stored ?? { repos: [], totalCommits: 0, prs: [] }

  for (const signal of signals) {
    if (signal.commit) {
      let entry = payload.repos.find((repo) => repo.repo === signal.repo)
      if (!entry) {
        entry = { repo: signal.repo, commitCount: 0, messages: [], firstCommitClock: null, lastCommitClock: null }
        payload.repos.push(entry)
      }
      // Count only what is also listed, so tombstone removal (which finds the
      // commit by its subject line) stays symmetric with this merge.
      if (!entry.messages.includes(signal.commit.message) && entry.messages.length < MAX_DAY_COMMIT_MESSAGES) {
        entry.messages.push(signal.commit.message)
        entry.commitCount += 1
        if (entry.firstCommitClock == null || signal.commit.clock < entry.firstCommitClock) {
          entry.firstCommitClock = signal.commit.clock
        }
        if (entry.lastCommitClock == null || signal.commit.clock > entry.lastCommitClock) {
          entry.lastCommitClock = signal.commit.clock
        }
      }
    }
    if (signal.pr) {
      const existing = payload.prs.find((pr) => pr.repo === signal.repo && pr.title === signal.pr!.title)
      if (existing) existing.state = signal.pr.state
      else payload.prs.push({ title: signal.pr.title, state: signal.pr.state, repo: signal.repo })
    }
  }
  payload.totalCommits = payload.repos.reduce((sum, repo) => sum + repo.commitCount, 0)

  db.prepare(`
    INSERT INTO external_signals (date, source, payload_json, captured_at)
    VALUES (?, 'git', ?, ?)
    ON CONFLICT(date, source) DO UPDATE SET
      payload_json = excluded.payload_json,
      captured_at = excluded.captured_at
  `).run(date, JSON.stringify(payload), nowMs)
}

/**
 * Merge connector meeting notes into the external_signals 'notes' day layer —
 * the MeetingNotesSignal row the wrap enrichment already reads (and
 * sanitizes). Merged by (title, scheduledClock) so a re-synced note replaces
 * its own entry instead of duplicating it. The app label stays the provider's
 * honest display name.
 */
export function mergeConnectorNotesDaySignal(
  db: Database.Database,
  date: string,
  notes: ConnectorNotesDaySignal[],
  appLabel: string,
  nowMs = Date.now(),
): void {
  if (notes.length === 0) return
  const incoming = notes.map((note) => ({
    title: note.title,
    participants: note.participants,
    actionItems: note.actionItems,
    scheduledClock: note.scheduledClock,
  }))
  const existing = getExternalSignal<MeetingNotesSignal>(db, date, 'notes')?.payload.notes ?? []
  const kept = existing.filter((note) => !incoming.some(
    (candidate) => candidate.title === note.title && (candidate.scheduledClock ?? null) === (note.scheduledClock ?? null),
  ))
  const merged: MeetingNotesSignal = { app: appLabel, notes: [...kept, ...incoming] }
  db.prepare(`
    INSERT INTO external_signals (date, source, payload_json, captured_at)
    VALUES (?, 'notes', ?, ?)
    ON CONFLICT(date, source) DO UPDATE SET
      payload_json = excluded.payload_json,
      captured_at = excluded.captured_at
  `).run(date, JSON.stringify(merged), nowMs)
}

// ─── Page ingestion ──────────────────────────────────────────────────────────

export interface IngestPageResult {
  status: 'ok' | 'blocked_consent' | 'blocked_disabled'
  ingested: number
  /** Records rejected by the envelope gate — skipped whole, never partially
   *  normalized, identified only by opaque source identity. */
  quarantined: number
  /** Known records the (complete) page no longer contains — provider
   *  deletions, tombstoned locally with their derived data removed. */
  tombstoned: number
}

function envelopeDate(record: ConnectorRecordEnvelope): string | null {
  if (record.daySignal) return record.daySignal.date
  if (record.gitSignal) return record.gitSignal.date
  if (record.notesSignal) return record.notesSignal.date
  if (record.provenance.effectiveAtMs != null) {
    const at = new Date(record.provenance.effectiveAtMs)
    const month = String(at.getMonth() + 1).padStart(2, '0')
    const day = String(at.getDate()).padStart(2, '0')
    return `${at.getFullYear()}-${month}-${day}`
  }
  return null
}

/**
 * Store one sync page. Everything — ledger rows, entities, evidence refs, day
 * signals, tombstones, and the cursor — commits in ONE transaction, so a
 * failed page never advances the cursor and never leaves partial evidence.
 */
export function ingestConnectorPage(
  db: Database.Database,
  connectorId: ConnectorId,
  page: ConnectorSyncPage,
  options: { gate?: ConnectorIngestGate; nowMs?: number } = {},
): IngestPageResult {
  const gate = options.gate ?? defaultConnectorGate()
  const gateState = connectorGateState(gate)
  if (gateState !== 'open') {
    return { status: gateState, ingested: 0, quarantined: 0, tombstoned: 0 }
  }
  const nowMs = options.nowMs ?? Date.now()

  let ingested = 0
  let quarantined = 0
  let tombstoned = 0

  const run = db.transaction(() => {
    const dayEvents = new Map<string, ConnectorDaySignalEvent[]>()
    const gitEvents = new Map<string, ConnectorGitDaySignal[]>()
    const noteEvents = new Map<string, ConnectorNotesDaySignal[]>()

    for (const record of page.records) {
      const problems = validateRecordEnvelope(record)
      if (problems.length > 0 || record.provenance.connectorId !== connectorId) {
        // Quarantine: skip the whole record. Only the opaque source identity
        // is loggable — never the malformed content itself.
        quarantined += 1
        continue
      }

      const entity = adoptConnectedEnvelope(db, record.entity)
      if (entity) {
        addEntityEvidenceRef(db, entity.id, {
          sourceType: 'connector',
          sourceId: connectorEvidenceSourceId(connectorId, record.provenance.sourceRecordId),
          spanStartMs: record.provenance.effectiveAtMs,
        })
        // A commit the local git probe ALSO observed corroborates that the
        // provisional local-folder repository and this provider repository
        // are one thing — unify them under the provider identity. Runs
        // BEFORE this page's day-signal merge, so this page's own writes can
        // never be their own corroboration.
        if (record.entity.kind === 'repository_activity' && record.gitSignal?.commit) {
          unifyRepositoryEntityIdentity(db, {
            providerEntityId: entity.id,
            repoShortName: record.entity.repo,
            commitSubject: record.gitSignal.commit.message,
            date: record.gitSignal.date,
          })
        }
        // A meeting-notes record whose identity corroborates a scheduled
        // meeting on the same day (title + timing + shared addresses, two of
        // three) merges into that meeting's entity — the note ATTACHES to
        // the meeting it documents and becomes its occurrence evidence.
        if (record.entity.kind === 'meeting_record' && record.notesSignal) {
          unifyMeetingNoteIdentity(db, {
            noteEntityId: entity.id,
            title: record.entity.title,
            startMs: record.entity.startMs ?? null,
            date: record.notesSignal.date,
            participantEmails: (record.entity.participants ?? [])
              .map((person) => person.connectorId.split(':').slice(1).join(':'))
              .filter((identity) => identity.includes('@')),
          })
        }
      }
      // Attendees/participants minted inside adoptConnectedEnvelope get the
      // same per-record support ref (resolvePersonEntity is idempotent), so
      // "no refs left → unsupported" holds for people too.
      const people = record.entity.kind === 'calendar_event'
        ? record.entity.attendees ?? []
        : record.entity.kind === 'meeting_record'
          ? record.entity.participants ?? []
          : record.entity.kind === 'repository_activity' || record.entity.kind === 'issue_activity'
            ? record.entity.people ?? []
            : []
      for (const person of people) {
        const personEntity = resolvePersonEntity(db, {
          connectorId: person.connectorId,
          displayName: person.displayName,
        })
        if (personEntity) {
          addEntityEvidenceRef(db, personEntity.id, {
            sourceType: 'connector',
            sourceId: connectorEvidenceSourceId(connectorId, record.provenance.sourceRecordId),
          })
        }
      }

      // A re-synced record that MOVED (new date/time/title) must not leave its
      // old day-signal event behind on the previous day row.
      const previous = getConnectorRecord(db, connectorId, record.provenance.sourceRecordId)
      if (previous) {
        try {
          const previousEnvelope = JSON.parse(previous.envelope_json) as ConnectorRecordEnvelope
          const old = previousEnvelope.daySignal
          const next = record.daySignal
          if (old && (!next || old.date !== next.date || old.startClock !== next.startClock || old.title !== next.title)) {
            removeConnectorDaySignalEvent(db, old, nowMs)
          }
          const oldGit = previousEnvelope.gitSignal
          const nextGit = record.gitSignal
          if (oldGit && JSON.stringify(oldGit) !== JSON.stringify(nextGit ?? null)) {
            removeConnectorGitDaySignalEvent(db, oldGit, nowMs)
          }
          const oldNotes = previousEnvelope.notesSignal
          const nextNotes = record.notesSignal
          if (oldNotes && (!nextNotes || oldNotes.date !== nextNotes.date
            || oldNotes.title !== nextNotes.title
            || (oldNotes.scheduledClock ?? null) !== (nextNotes.scheduledClock ?? null))) {
            removeConnectorNotesDaySignalEvent(db, oldNotes, nowMs)
          }
        } catch { /* unreadable prior envelope — nothing to clean */ }
      }

      upsertConnectorRecord(db, record, entity?.id ?? null, envelopeDate(record), nowMs)
      if (record.daySignal) {
        const events = dayEvents.get(record.daySignal.date) ?? []
        events.push(record.daySignal)
        dayEvents.set(record.daySignal.date, events)
      }
      if (record.gitSignal) {
        const events = gitEvents.get(record.gitSignal.date) ?? []
        events.push(record.gitSignal)
        gitEvents.set(record.gitSignal.date, events)
      }
      if (record.notesSignal) {
        const events = noteEvents.get(record.notesSignal.date) ?? []
        events.push(record.notesSignal)
        noteEvents.set(record.notesSignal.date, events)
      }
      ingested += 1
    }

    for (const [date, events] of dayEvents) {
      mergeConnectorCalendarDaySignal(db, date, events, nowMs)
    }
    for (const [date, events] of gitEvents) {
      mergeConnectorGitDaySignal(db, date, events, nowMs)
    }
    for (const [date, events] of noteEvents) {
      mergeConnectorNotesDaySignal(db, date, events, connectorDisplayLabel(connectorId), nowMs)
    }

    // Explicit provider deletions on an incremental page (cancellations under
    // cursor semantics like Google's syncToken). Only known, live records
    // tombstone; an id this store never ingested is a no-op.
    for (const deletedId of page.deletedSourceRecordIds ?? []) {
      const known = getConnectorRecord(db, connectorId, deletedId)
      if (!known || known.tombstoned_at != null) continue
      removeConnectorRecordDerivedData(db, known, nowMs)
      tombstoneConnectorRecord(db, connectorId, deletedId, nowMs)
      tombstoned += 1
    }

    // Provider deletions → local tombstones (connectors.md §Synchronization).
    // Only when the adapter attests the page is a COMPLETE window view.
    if (page.presentSourceRecordIds) {
      const present = new Set(page.presentSourceRecordIds)
      for (const known of listConnectorRecords(db, connectorId)) {
        if (present.has(known.source_record_id)) continue
        removeConnectorRecordDerivedData(db, known)
        tombstoneConnectorRecord(db, connectorId, known.source_record_id, nowMs)
        tombstoned += 1
      }
    }

    commitConnectorSync(db, connectorId, { cursor: page.nextCursor, ingested, nowMs })
  })
  run()

  return { status: 'ok', ingested, quarantined, tombstoned }
}
