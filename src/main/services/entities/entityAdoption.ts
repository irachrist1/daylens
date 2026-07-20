// Entity adoption (memory-and-entities.md migration slice 3 + Wave-2 evidence
// sources, DEV-177).
//
// Adopts what the product already knows into the durable entity store, KEEPING
// existing identifiers so attributions, corrections, and references stay
// valid:
//
//   - clients / projects        → client / project entities (same id)
//   - app_identities            → application entities (id = first-seen
//                                 app_instance_id per canonical app)
//   - artifacts                 → page / file / repository entities (same id)
//   - external_signals calendar → meeting entities keyed by their source event
//                                 identity (date + start + exact title from
//                                 the stored payload — two events with similar
//                                 titles/times never merge)
//   - external_signals notes    → meeting entities from meeting-notes payloads
//   - external_signals git      → repository entities (provisional local
//                                 identity — provider identity arrives with
//                                 the Wave-3 connectors)
//
// The whole backfill is idempotent: identity keys dedupe re-runs, and an
// explicit user rename (name_source='user') is never overwritten by a re-run —
// that is the "correction outranks later inference" acceptance criterion.
//
// Person entities are NOT minted from meeting-notes first names: people
// resolve by connector id first, and none of the currently adopted sources
// carries one. Fixtures exercise people through the synthetic connected-source
// envelopes below.
import type Database from 'better-sqlite3'
import type {
  CalendarSignal,
  GitActivitySignal,
  MeetingNotesSignal,
} from '@shared/types'
import {
  addEntityAlias,
  addEntityEvidenceRef,
  addEntityRelationship,
  resolveMeetingEntity,
  resolvePersonEntity,
  resolveRepositoryEntity,
  upsertEntity,
  normalizeEntityLabel,
  type EntityRow,
} from './entityRepository'

function hasTable(db: Database.Database, table: string): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) != null
}

function msForClock(dateStr: string, clock: string | null | undefined): number | null {
  if (!clock) return null
  const match = clock.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day, Number(match[1]), Number(match[2]), 0, 0).getTime()
}

// ─── Per-source adoption ─────────────────────────────────────────────────────

function adoptClients(db: Database.Database): void {
  const clients = db.prepare(`SELECT id, name, status, created_at, updated_at FROM clients`).all() as Array<{
    id: string; name: string; status: string; created_at: number; updated_at: number
  }>
  for (const client of clients) {
    const entity = upsertEntity(db, {
      type: 'client',
      identityKey: `supplied:${client.id}`,
      name: client.name,
      origin: 'supplied',
      id: client.id,
      observedAt: client.created_at,
    })
    const aliases = db.prepare(`SELECT alias, source FROM client_aliases WHERE client_id = ?`)
      .all(client.id) as Array<{ alias: string; source: string }>
    for (const alias of aliases) {
      addEntityAlias(db, entity.id, alias.alias, { rawLabel: alias.alias, source: alias.source })
    }
  }
}

function adoptProjects(db: Database.Database): void {
  const projects = db.prepare(`SELECT id, client_id, name, created_at FROM projects`).all() as Array<{
    id: string; client_id: string | null; name: string; created_at: number
  }>
  for (const project of projects) {
    const entity = upsertEntity(db, {
      type: 'project',
      identityKey: `supplied:${project.id}`,
      name: project.name,
      origin: 'supplied',
      id: project.id,
      observedAt: project.created_at,
    })
    const aliases = db.prepare(`SELECT alias, source FROM project_aliases WHERE project_id = ?`)
      .all(project.id) as Array<{ alias: string; source: string }>
    for (const alias of aliases) {
      addEntityAlias(db, entity.id, alias.alias, { rawLabel: alias.alias, source: alias.source })
    }
    if (project.client_id && db.prepare(`SELECT 1 FROM entities WHERE id = ?`).get(project.client_id)) {
      addEntityRelationship(db, entity.id, project.client_id, 'belongs_to', { source: 'user', confidence: 1 })
    }
  }
}

function adoptApplications(db: Database.Database): void {
  const identities = db.prepare(`
    SELECT app_instance_id, canonical_app_id, display_name, raw_app_name, first_seen_at, last_seen_at
    FROM app_identities
    ORDER BY first_seen_at ASC
  `).all() as Array<{
    app_instance_id: string
    canonical_app_id: string | null
    display_name: string
    raw_app_name: string
    first_seen_at: number
    last_seen_at: number
  }>
  for (const identity of identities) {
    const key = `app:${identity.canonical_app_id ?? identity.app_instance_id}`
    // First-seen id is kept as the entity id; a later identity row for the
    // same canonical app extends the observation range instead of colliding.
    const entity = upsertEntity(db, {
      type: 'application', identityKey: key, name: identity.display_name,
      origin: 'observed', id: identity.app_instance_id, observedAt: identity.first_seen_at,
    })
    upsertEntity(db, {
      type: 'application', identityKey: key, name: identity.display_name,
      origin: 'observed', observedAt: identity.last_seen_at,
    })
    addEntityAlias(db, entity.id, identity.display_name, { rawLabel: identity.raw_app_name, source: 'observed' })
    addEntityEvidenceRef(db, entity.id, { sourceType: 'app_identity', sourceId: identity.app_instance_id })
  }
}

function adoptArtifacts(db: Database.Database): void {
  if (!hasTable(db, 'artifacts')) return
  const typeMap: Record<string, 'page' | 'file' | 'repository'> = {
    page: 'page',
    domain: 'page',
    document: 'file',
    repo: 'repository',
  }
  const artifacts = db.prepare(`
    SELECT id, artifact_type, canonical_key, display_title, first_seen_at, last_seen_at
    FROM artifacts
  `).all() as Array<{
    id: string
    artifact_type: string
    canonical_key: string
    display_title: string
    first_seen_at: number
    last_seen_at: number
  }>
  for (const artifact of artifacts) {
    const entityType = typeMap[artifact.artifact_type]
    if (!entityType) continue
    const entity = upsertEntity(db, {
      type: entityType,
      identityKey: entityType === 'repository'
        ? `local:${normalizeEntityLabel(artifact.display_title)}`
        : `${entityType === 'page' ? 'page' : 'file'}:${artifact.canonical_key}`,
      name: artifact.display_title,
      origin: 'observed',
      id: artifact.id,
      observedAt: artifact.first_seen_at,
      metadata: entityType === 'repository' ? { provisionalLocalIdentity: true } : {},
    })
    upsertEntity(db, {
      type: entityType,
      identityKey: entity.identity_key,
      name: artifact.display_title,
      origin: 'observed',
      observedAt: artifact.last_seen_at,
    })
    addEntityAlias(db, entity.id, artifact.display_title, { rawLabel: artifact.display_title, source: 'observed' })
    addEntityEvidenceRef(db, entity.id, { sourceType: 'artifact', sourceId: artifact.id })
  }
}

/** Deterministic source event identity for a stored calendar payload row.
 *  The local calendar source has no opaque event id; the (date, start clock,
 *  exact title) triple IS its source identity. Two events whose titles differ
 *  at all — however similar — get different identities and never merge. */
export function calendarEventSourceId(date: string, startClock: string, title: string): string {
  return `calendar:${date}:${startClock}:${title}`
}

export function adoptExternalSignalEntities(
  db: Database.Database,
  date: string,
  source: string,
  payload: unknown,
): void {
  if (source === 'calendar') {
    const calendar = payload as CalendarSignal | null
    for (const event of calendar?.events ?? []) {
      if (!event?.title) continue
      const startMs = msForClock(date, event.startClock)
      const endMs = startMs != null && event.durationMinutes
        ? startMs + event.durationMinutes * 60_000
        : null
      resolveMeetingEntity(db, {
        sourceEventId: calendarEventSourceId(date, event.startClock, event.title),
        title: event.title,
        startMs,
        endMs,
        origin: 'connected',
        sourceType: 'external_signal',
        sourceId: `${date}:calendar`,
      })
    }
    return
  }
  if (source === 'notes') {
    const notes = payload as MeetingNotesSignal | null
    for (const note of notes?.notes ?? []) {
      if (!note?.title) continue
      const clock = note.scheduledClock ?? null
      const startMs = clock ? msForClock(date, clock) : null
      resolveMeetingEntity(db, {
        sourceEventId: `notes:${date}:${clock ?? ''}:${note.title}`,
        title: note.title,
        startMs,
        origin: 'connected',
        sourceType: 'external_signal',
        sourceId: `${date}:notes`,
      })
      // Participant first names are NOT connector ids, so they never mint
      // person entities here (spec: people use connector identifiers first).
    }
    return
  }
  if (source === 'git') {
    const git = payload as GitActivitySignal | null
    for (const repo of git?.repos ?? []) {
      if (!repo?.repo) continue
      const entity = resolveRepositoryEntity(db, {
        localName: repo.repo,
        origin: 'connected',
        observedAt: msForClock(date, repo.lastCommitClock) ?? undefined,
      })
      if (entity) {
        addEntityEvidenceRef(db, entity.id, { sourceType: 'external_signal', sourceId: `${date}:git` })
      }
    }
  }
}

function adoptExternalSignals(db: Database.Database): void {
  if (!hasTable(db, 'external_signals')) return
  const rows = db.prepare(`SELECT date, source, payload_json FROM external_signals`).all() as Array<{
    date: string; source: string; payload_json: string
  }>
  for (const row of rows) {
    try {
      adoptExternalSignalEntities(db, row.date, row.source, JSON.parse(row.payload_json))
    } catch {
      // A malformed stored payload never blocks adoption of the rest.
    }
  }
}

// ─── Synthetic connected-source envelopes — provisional payload shapes owned
// by the memory spec; acceptance fixtures inject these until the connectors
// specification is accepted. ──────

export type ConnectedEnvelope =
  | { kind: 'calendar_event'; sourceEventId: string; title: string; startMs?: number; endMs?: number; attendees?: Array<{ connectorId: string; displayName: string }> }
  | { kind: 'meeting_record'; sourceEventId: string; title: string; startMs?: number; endMs?: number; participants?: Array<{ connectorId: string; displayName: string }> }
  | {
    kind: 'repository_activity'
    provider: string
    owner: string
    repo: string
    observedAt?: number
    /** What happened, minimally: activity kind, title (a commit subject or
     *  PR/issue title — never a body, diff, or URL), and provider state. */
    activity?: {
      kind: 'commit' | 'pull_request' | 'review' | 'issue'
      title: string
      state?: string | null
      /** Source-native login of who did it, when it was not the account owner. */
      actorLogin?: string | null
    }
    /** People involved OTHER than the account owner, by source-native login. */
    people?: Array<{ connectorId: string; displayName: string }>
  }
  | { kind: 'document_reference'; sourceDocumentId: string; title: string; observedAt?: number }
  | { kind: 'message_reference'; sourceMessageId: string; author?: { connectorId: string; displayName: string }; observedAt?: number }

export function adoptConnectedEnvelope(db: Database.Database, envelope: ConnectedEnvelope): EntityRow | null {
  switch (envelope.kind) {
    case 'calendar_event':
    case 'meeting_record': {
      const meeting = resolveMeetingEntity(db, {
        sourceEventId: envelope.sourceEventId,
        title: envelope.title,
        startMs: envelope.startMs ?? null,
        endMs: envelope.endMs ?? null,
        origin: 'connected',
        sourceType: 'connected_envelope',
        sourceId: `${envelope.kind}:${envelope.sourceEventId}`,
      })
      const people = envelope.kind === 'calendar_event' ? envelope.attendees : envelope.participants
      for (const person of people ?? []) {
        const entity = resolvePersonEntity(db, {
          connectorId: person.connectorId,
          displayName: person.displayName,
          observedAt: envelope.startMs,
        })
        if (entity) addEntityRelationship(db, entity.id, meeting.id, 'attended', { source: 'connected', confidence: 0.9 })
      }
      return meeting
    }
    case 'repository_activity': {
      const repository = resolveRepositoryEntity(db, {
        provider: envelope.provider,
        owner: envelope.owner,
        repo: envelope.repo,
        origin: 'connected',
        observedAt: envelope.observedAt,
      })
      for (const person of envelope.people ?? []) {
        const entity = resolvePersonEntity(db, {
          connectorId: person.connectorId,
          displayName: person.displayName,
          observedAt: envelope.observedAt,
        })
        if (entity && repository) {
          addEntityRelationship(db, entity.id, repository.id, 'contributed', { source: 'connected', confidence: 0.9 })
        }
      }
      return repository
    }
    case 'document_reference': {
      const entity = upsertEntity(db, {
        type: 'file',
        identityKey: `document:${envelope.sourceDocumentId}`,
        name: envelope.title,
        origin: 'connected',
        observedAt: envelope.observedAt,
      })
      addEntityAlias(db, entity.id, envelope.title, { rawLabel: envelope.title, source: 'connected' })
      addEntityEvidenceRef(db, entity.id, { sourceType: 'connected_envelope', sourceId: `document_reference:${envelope.sourceDocumentId}` })
      return entity
    }
    case 'message_reference': {
      if (!envelope.author) return null
      return resolvePersonEntity(db, {
        connectorId: envelope.author.connectorId,
        displayName: envelope.author.displayName,
        observedAt: envelope.observedAt,
      })
    }
  }
}

// ─── The backfill entrypoint (called by migration v50 and re-runnable) ───────

export function runEntityAdoptionBackfill(db: Database.Database): void {
  adoptClients(db)
  adoptProjects(db)
  adoptApplications(db)
  adoptArtifacts(db)
  adoptExternalSignals(db)
}
