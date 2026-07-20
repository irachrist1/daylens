// Disconnect / deletion cleanup for connector-derived data (connectors.md
// §Disconnection and deletion, DEV-186).
//
// The rule: deleting a source's data removes every derivative the source alone
// supported — entities, aliases, relationships, evidence refs, day-signal
// events — and NOTHING that has independent support. Support is literal: an
// entity is retired only when, after this connector's evidence refs are gone,
// no evidence ref from any other source remains anywhere in its merge group.
//
// Pure better-sqlite3 (no Electron) so the deletion journal can replay the
// same purge against a freshly restored database (DEV-220: a backup restore
// must never resurrect deleted connector data).

import type Database from 'better-sqlite3'
import type { CalendarSignal, ConnectorId, GitActivitySignal } from '@shared/types'
import { getExternalSignal } from '../services/externalSignals'
import { mergeGroupIds, resolveMergeChain, type EntityRow } from '../services/entities/entityRepository'
import type { ConnectorGitDaySignal, ConnectorRecordEnvelope } from './contract'
import {
  deleteConnectorRecords,
  listConnectorRecords,
  markConnectorDisconnected,
  type ConnectorRecordRow,
} from './store'
import { connectorEvidenceSourceId } from './evidenceId'

function remainingEvidenceRefCount(db: Database.Database, entityId: string): number {
  const groupIds = mergeGroupIds(db, entityId)
  const marks = groupIds.map(() => '?').join(', ')
  return (db.prepare(
    `SELECT COUNT(*) AS c FROM entity_evidence_refs WHERE entity_id IN (${marks})`,
  ).get(...groupIds) as { c: number }).c
}

/** Retire a connected-origin entity that lost its last support: mark deleted,
 *  drop its relationships. Observed/supplied entities are never touched. */
function retireIfUnsupported(db: Database.Database, entityId: string, nowMs: number): boolean {
  const row = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(entityId) as EntityRow | undefined
  if (!row) return false
  const survivor = resolveMergeChain(db, row)
  if (survivor.status === 'deleted') return false
  if (survivor.origin !== 'connected') return false
  if (remainingEvidenceRefCount(db, survivor.id) > 0) return false
  const groupIds = mergeGroupIds(db, survivor.id)
  const marks = groupIds.map(() => '?').join(', ')
  db.prepare(`
    DELETE FROM entity_relationships WHERE entity_id IN (${marks}) OR related_entity_id IN (${marks})
  `).run(...groupIds, ...groupIds)
  db.prepare(`UPDATE entities SET status = 'deleted', updated_at = ? WHERE id IN (${marks})`)
    .run(nowMs, ...groupIds)
  return true
}

function parseEnvelope(row: ConnectorRecordRow): ConnectorRecordEnvelope | null {
  try {
    return JSON.parse(row.envelope_json) as ConnectorRecordEnvelope
  } catch {
    return null
  }
}

/** Remove a record's day-signal event from the external_signals day row,
 *  deleting the row when it empties. A same-titled event another source also
 *  found is re-added by that source's next refresh. Also used by ingest when a
 *  re-synced record MOVED (new date/time/title) so the old event doesn't linger. */
export function removeConnectorDaySignalEvent(
  db: Database.Database,
  daySignal: { date: string; startClock: string; title: string },
  nowMs: number,
): void {
  const stored = getExternalSignal<CalendarSignal>(db, daySignal.date, 'calendar')
  if (!stored) return
  const kept = stored.payload.events.filter(
    (event) => !(event.startClock === daySignal.startClock && event.title === daySignal.title),
  )
  if (kept.length === stored.payload.events.length) return
  if (kept.length === 0) {
    db.prepare(`DELETE FROM external_signals WHERE date = ? AND source = 'calendar'`).run(daySignal.date)
    return
  }
  db.prepare(`
    UPDATE external_signals SET payload_json = ?, captured_at = ? WHERE date = ? AND source = 'calendar'
  `).run(JSON.stringify({ events: kept } satisfies CalendarSignal), nowMs, daySignal.date)
}

/** Remove a record's git contribution from the external_signals 'git' day
 *  row: the commit line (decrementing the repo's count) or the PR entry,
 *  dropping emptied repo entries and deleting the row when nothing remains.
 *  Same-shaped data another source also found returns on that source's next
 *  refresh. Also used by ingest when a re-synced record MOVED days. */
export function removeConnectorGitDaySignalEvent(
  db: Database.Database,
  gitSignal: ConnectorGitDaySignal,
  nowMs: number,
): void {
  const stored = getExternalSignal<GitActivitySignal>(db, gitSignal.date, 'git')
  if (!stored) return
  const payload = stored.payload
  let changed = false

  if (gitSignal.commit) {
    const entry = payload.repos.find((repo) => repo.repo === gitSignal.repo)
    if (entry && entry.messages.includes(gitSignal.commit.message)) {
      entry.messages = entry.messages.filter((message) => message !== gitSignal.commit!.message)
      entry.commitCount = Math.max(0, entry.commitCount - 1)
      changed = true
    }
  }
  if (gitSignal.pr) {
    const before = payload.prs.length
    payload.prs = payload.prs.filter(
      (pr) => !(pr.repo === gitSignal.repo && pr.title === gitSignal.pr!.title),
    )
    changed = changed || payload.prs.length !== before
  }
  if (!changed) return

  payload.repos = payload.repos.filter((repo) => repo.commitCount > 0 || repo.messages.length > 0)
  payload.totalCommits = payload.repos.reduce((sum, repo) => sum + repo.commitCount, 0)
  if (payload.repos.length === 0 && payload.prs.length === 0) {
    db.prepare(`DELETE FROM external_signals WHERE date = ? AND source = 'git'`).run(gitSignal.date)
    return
  }
  db.prepare(`
    UPDATE external_signals SET payload_json = ?, captured_at = ? WHERE date = ? AND source = 'git'
  `).run(JSON.stringify(payload), nowMs, gitSignal.date)
}

/**
 * Remove everything ONE record derived: its evidence refs (both the
 * per-connector support refs and the envelope-adoption refs), its day-signal
 * event, and any connected entities left without support. People attending a
 * retired meeting are re-checked after the meeting's relationships drop.
 */
export function removeConnectorRecordDerivedData(
  db: Database.Database,
  row: ConnectorRecordRow,
  nowMs = Date.now(),
): void {
  const envelope = parseEnvelope(row)
  const sourceId = connectorEvidenceSourceId(row.connector_id, row.source_record_id)

  // People this record supported — captured BEFORE the refs disappear.
  const supportedEntityIds = (db.prepare(
    `SELECT DISTINCT entity_id FROM entity_evidence_refs WHERE source_type = 'connector' AND source_id = ?`,
  ).all(sourceId) as Array<{ entity_id: string }>).map((r) => r.entity_id)

  db.prepare(`DELETE FROM entity_evidence_refs WHERE source_type = 'connector' AND source_id = ?`).run(sourceId)
  // adoptConnectedEnvelope's own ref (sourceType 'connected_envelope').
  const adoptionSourceId = envelope?.entity == null
    ? null
    : 'sourceEventId' in envelope.entity
      ? `${envelope.entity.kind}:${envelope.entity.sourceEventId}`
      : 'sourceDocumentId' in envelope.entity
        ? `${envelope.entity.kind}:${envelope.entity.sourceDocumentId}`
        : null
  if (adoptionSourceId) {
    db.prepare(`DELETE FROM entity_evidence_refs WHERE source_type = 'connected_envelope' AND source_id = ?`)
      .run(adoptionSourceId)
  }
  if (envelope?.daySignal) removeConnectorDaySignalEvent(db, envelope.daySignal, nowMs)
  if (envelope?.gitSignal) removeConnectorGitDaySignalEvent(db, envelope.gitSignal, nowMs)

  const candidates = new Set<string>(supportedEntityIds)
  if (row.entity_id) candidates.add(row.entity_id)
  // Retire the primary entity first so attendee relationships drop before
  // people are checked for remaining support.
  if (row.entity_id) retireIfUnsupported(db, row.entity_id, nowMs)
  for (const entityId of candidates) {
    if (entityId !== row.entity_id) retireIfUnsupported(db, entityId, nowMs)
  }
}

export interface ConnectorPurgeResult {
  recordsRemoved: number
}

/**
 * The disconnect-with-delete path and the deletion-journal replay body: remove
 * every derivative of every record this connector ever ingested, then drop the
 * ledger rows themselves and mark the connection disconnected. Idempotent —
 * replaying against a database that never had (or already lost) the rows is a
 * no-op.
 */
export function purgeConnectorDerivedData(
  db: Database.Database,
  connectorId: ConnectorId,
  nowMs = Date.now(),
): ConnectorPurgeResult {
  const rows = listConnectorRecords(db, connectorId, { includeTombstoned: true })
  for (const row of rows) {
    removeConnectorRecordDerivedData(db, row, nowMs)
  }
  const recordsRemoved = deleteConnectorRecords(db, connectorId)
  markConnectorDisconnected(db, connectorId, nowMs)
  return { recordsRemoved }
}
