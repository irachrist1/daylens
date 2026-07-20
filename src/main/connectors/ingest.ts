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
import type { CalendarEventSignal, CalendarSignal, ConnectorId } from '@shared/types'
import { isCaptureConsentCurrent } from '@shared/captureConsent'
import { getSettings } from '../services/settings'
import { getExternalSignal } from '../services/externalSignals'
import { adoptConnectedEnvelope } from '../services/entities/entityAdoption'
import { addEntityEvidenceRef, resolvePersonEntity } from '../services/entities/entityRepository'
import {
  validateRecordEnvelope,
  type ConnectorDaySignalEvent,
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
import { removeConnectorDaySignalEvent, removeConnectorRecordDerivedData } from './purge'
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
      }
      // Attendees/participants minted inside adoptConnectedEnvelope get the
      // same per-record support ref (resolvePersonEntity is idempotent), so
      // "no refs left → unsupported" holds for people too.
      const people = record.entity.kind === 'calendar_event'
        ? record.entity.attendees ?? []
        : record.entity.kind === 'meeting_record'
          ? record.entity.participants ?? []
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
        } catch { /* unreadable prior envelope — nothing to clean */ }
      }

      upsertConnectorRecord(db, record, entity?.id ?? null, envelopeDate(record), nowMs)
      if (record.daySignal) {
        const events = dayEvents.get(record.daySignal.date) ?? []
        events.push(record.daySignal)
        dayEvents.set(record.daySignal.date, events)
      }
      ingested += 1
    }

    for (const [date, events] of dayEvents) {
      mergeConnectorCalendarDaySignal(db, date, events, nowMs)
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
