// Exact-retrieval memory index (memory-and-entities.md §Memory record,
// §Retrieval flow, DEV-178).
//
// One local, queryable store of "moments worth finding again", built from the
// SAME corrected activity facts Timeline and Apps render — never from raw
// app_sessions directly. Each indexed day is a deterministic projection:
//
//   corrected sessions (canonical focus-event projection, legacy fallback,
//   ignored blocks and evidence exclusions already subtracted)
//     → one memory record per visible session, tagged with its application
//       entity and any client/project the overlapping work session attributes
//   meeting entities observed that day → one record each (entity-named)
//   artifact mentions that day        → one record each (entity-named)
//
// Because the input is the corrected read model, a deleted block or excluded
// app never enters the index, and reindexing a day after a correction removes
// what the correction removed — results cannot resurrect (spec §Corrections
// and deletion). Entity-named records carry NO index-time text: they are found
// through entity resolution (canonical name + aliases) at query time, so a
// rename changes search results instantly and a removed alias stops matching
// without any reindex.
//
// LOCAL-ONLY: memory_records, memory_record_entities, and memory_index_days
// have no sync-allowlist keys and can never serialize into a remote payload
// (tests/syncAllowlist.test.ts).
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AppSession } from '@shared/types'
import { localDayBounds, localDateString } from '../lib/localDate'
import {
  getCorrectedSessionsForRange,
  getIgnoredBlockSpansForRange,
  type CorrectionSpan,
} from './activityFacts'
import { resolveMergeChain, type EntityRow } from './entities/entityRepository'

/** Bump to force a full reindex on upgrade (the version is part of every
 *  day fingerprint, so stale-format days re-project lazily). */
export const MEMORY_INDEX_VERSION = 1

export type MemoryRecordKind = 'session' | 'meeting' | 'artifact'

function tableExists(db: Database.Database, name: string): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) != null
}

export function memoryIndexAvailable(db: Database.Database): boolean {
  return tableExists(db, 'memory_records') && tableExists(db, 'memory_index_days')
}

function newRecordId(): string {
  return `mem_${randomUUID().replace(/-/g, '').slice(0, 20)}`
}

// ─── Day input fingerprint ───────────────────────────────────────────────────
// Cheap, deterministic digest of everything that can change a day's records:
// evidence volume, correction ledger state, attribution, meeting refs, and
// artifact mentions. Same inputs ⇒ same fingerprint ⇒ no reindex.

function countAndMax(
  db: Database.Database,
  sql: string,
  ...params: unknown[]
): string {
  const row = db.prepare(sql).get(...params) as { c: number; m: number | null } | undefined
  return `${row?.c ?? 0}:${row?.m ?? 0}`
}

export function memoryIndexDayFingerprint(db: Database.Database, date: string): string {
  const [fromMs, toMs] = localDayBounds(date)
  const parts = [
    `v${MEMORY_INDEX_VERSION}`,
    `fe:${countAndMax(db, `SELECT COUNT(*) AS c, MAX(ts_ms) AS m FROM focus_events WHERE ts_ms >= ? AND ts_ms < ?`, fromMs, toMs)}`,
    `as:${countAndMax(db, `SELECT COUNT(*) AS c, MAX(start_time) AS m FROM app_sessions WHERE start_time >= ? AND start_time < ?`, fromMs, toMs)}`,
    `rev:${countAndMax(db, `SELECT COUNT(*) AS c, MAX(updated_at) AS m FROM timeline_block_reviews WHERE date = ?`, date)}`,
    `bnd:${countAndMax(db, `SELECT COUNT(*) AS c, MAX(updated_at) AS m FROM timeline_boundary_corrections WHERE date = ?`, date)}`,
    `exc:${countAndMax(db, `SELECT COUNT(*) AS c, MAX(created_at) AS m FROM evidence_exclusions WHERE date = ?`, date)}`,
    `ws:${countAndMax(db, `SELECT COUNT(*) AS c, MAX(updated_at) AS m FROM work_sessions WHERE started_at < ? AND ended_at > ?`, toMs, fromMs)}`,
    `mtg:${countAndMax(db, `
      SELECT COUNT(*) AS c, MAX(r.created_at) AS m
      FROM entity_evidence_refs r
      JOIN entities e ON e.id = r.entity_id AND e.entity_type = 'meeting'
      WHERE r.span_start_ms >= ? AND r.span_start_ms < ?`, fromMs, toMs)}`,
    `art:${countAndMax(db, `SELECT COUNT(*) AS c, MAX(start_time) AS m FROM artifact_mentions WHERE start_time >= ? AND start_time < ?`, fromMs, toMs)}`,
  ]
  return parts.join('|')
}

// ─── Record building ─────────────────────────────────────────────────────────

interface PendingRecord {
  id: string
  kind: MemoryRecordKind
  memoryType: 'observed' | 'connected' | 'supplied' | 'inferred'
  statement: string
  /** Index-time full-text. EMPTY for entity-named records — those match via
   *  entity resolution so renames/alias removals apply instantly. */
  exactText: string
  startMs: number
  endMs: number
  appBundleId: string | null
  appName: string | null
  title: string | null
  primaryEntityId: string | null
  sourceRefs: string[]
  entityIds: Set<string>
}

function startsInsideSpans(startMs: number, spans: readonly CorrectionSpan[]): boolean {
  return spans.some((span) => startMs >= span.startMs && startMs < span.endMs)
}

function activeEntityId(db: Database.Database, id: string): string | null {
  const row = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(id) as EntityRow | undefined
  if (!row) return null
  const survivor = resolveMergeChain(db, row)
  return survivor.status === 'deleted' ? null : survivor.id
}

function applicationEntityIdFor(
  db: Database.Database,
  session: AppSession,
  cache: Map<string, string | null>,
): string | null {
  const key = `app:${session.canonicalAppId ?? session.appInstanceId ?? session.bundleId}`
  if (cache.has(key)) return cache.get(key) ?? null
  const row = db.prepare(
    `SELECT * FROM entities WHERE entity_type = 'application' AND identity_key = ?`,
  ).get(key) as EntityRow | undefined
  const survivorId = row ? resolveMergeChain(db, row).id : null
  cache.set(key, survivorId)
  return survivorId
}

function sessionRecords(db: Database.Database, date: string, fromMs: number, toMs: number): PendingRecord[] {
  const sessions = getCorrectedSessionsForRange(db, fromMs, toMs)
  const appEntityCache = new Map<string, string | null>()
  const records: PendingRecord[] = []
  for (const session of sessions) {
    if (session.durationSeconds <= 0) continue
    const title = session.windowTitle?.trim() || null
    const exactText = [title, session.appName].filter(Boolean).join(' ')
    if (!exactText) continue
    const record: PendingRecord = {
      id: newRecordId(),
      kind: 'session',
      memoryType: 'observed',
      statement: title ? `${session.appName} — ${title}` : `Used ${session.appName}`,
      exactText,
      startMs: session.startTime,
      endMs: session.endTime ?? session.startTime + session.durationSeconds * 1000,
      appBundleId: session.bundleId,
      appName: session.appName,
      title,
      primaryEntityId: null,
      sourceRefs: [`corrected_session:${date}:${session.startTime}`],
      entityIds: new Set<string>(),
    }
    const appEntityId = applicationEntityIdFor(db, session, appEntityCache)
    if (appEntityId) record.entityIds.add(appEntityId)
    records.push(record)
  }
  return records
}

/** Tag session records with the client/project the overlapping attributed
 *  work session names — that is what lets "acme" find Acme Corp's days even
 *  when no window title ever contained the word. */
function applyAttributionTags(
  db: Database.Database,
  records: PendingRecord[],
  fromMs: number,
  toMs: number,
): void {
  const attributed = db.prepare(`
    SELECT started_at, ended_at, client_id, project_id
    FROM work_sessions
    WHERE started_at < ? AND ended_at > ?
      AND (client_id IS NOT NULL OR project_id IS NOT NULL)
  `).all(toMs, fromMs) as Array<{
    started_at: number
    ended_at: number
    client_id: string | null
    project_id: string | null
  }>
  if (attributed.length === 0) return
  const entityCache = new Map<string, string | null>()
  const resolve = (id: string | null): string | null => {
    if (!id) return null
    if (!entityCache.has(id)) entityCache.set(id, activeEntityId(db, id))
    return entityCache.get(id) ?? null
  }
  for (const record of records) {
    if (record.kind !== 'session') continue
    for (const span of attributed) {
      if (record.startMs >= span.ended_at || record.endMs <= span.started_at) continue
      const clientEntity = resolve(span.client_id)
      const projectEntity = resolve(span.project_id)
      if (clientEntity) record.entityIds.add(clientEntity)
      if (projectEntity) record.entityIds.add(projectEntity)
    }
  }
}

function meetingRecords(
  db: Database.Database,
  fromMs: number,
  toMs: number,
  ignoredSpans: readonly CorrectionSpan[],
): PendingRecord[] {
  const rows = db.prepare(`
    SELECT e.id AS entity_id, r.span_start_ms, r.span_end_ms, r.source_type, r.source_id
    FROM entity_evidence_refs r
    JOIN entities e ON e.id = r.entity_id AND e.entity_type = 'meeting'
    WHERE r.span_start_ms >= ? AND r.span_start_ms < ?
  `).all(fromMs, toMs) as Array<{
    entity_id: string
    span_start_ms: number
    span_end_ms: number | null
    source_type: string
    source_id: string
  }>
  const byEntity = new Map<string, PendingRecord>()
  for (const row of rows) {
    if (startsInsideSpans(row.span_start_ms, ignoredSpans)) continue
    const survivorId = activeEntityId(db, row.entity_id)
    if (!survivorId) continue
    const survivor = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(survivorId) as EntityRow
    const existing = byEntity.get(survivorId)
    if (existing) {
      existing.startMs = Math.min(existing.startMs, row.span_start_ms)
      existing.endMs = Math.max(existing.endMs, row.span_end_ms ?? row.span_start_ms)
      existing.sourceRefs.push(`${row.source_type}:${row.source_id}`)
      continue
    }
    byEntity.set(survivorId, {
      id: newRecordId(),
      kind: 'meeting',
      memoryType: 'connected',
      statement: `Meeting: ${survivor.canonical_name}`,
      // Entity-named: found via canonical name + aliases at query time.
      exactText: '',
      startMs: row.span_start_ms,
      endMs: row.span_end_ms ?? row.span_start_ms,
      appBundleId: null,
      appName: null,
      title: null,
      primaryEntityId: survivorId,
      sourceRefs: [`${row.source_type}:${row.source_id}`],
      entityIds: new Set([survivorId]),
    })
  }
  return [...byEntity.values()]
}

function artifactRecords(
  db: Database.Database,
  fromMs: number,
  toMs: number,
  ignoredSpans: readonly CorrectionSpan[],
): PendingRecord[] {
  const rows = db.prepare(`
    SELECT m.artifact_id, m.start_time, m.end_time, a.display_title, a.artifact_type
    FROM artifact_mentions m
    JOIN artifacts a ON a.id = m.artifact_id
    WHERE m.start_time >= ? AND m.start_time < ?
  `).all(fromMs, toMs) as Array<{
    artifact_id: string
    start_time: number
    end_time: number
    display_title: string
    artifact_type: string
  }>
  const byArtifact = new Map<string, PendingRecord>()
  for (const row of rows) {
    if (startsInsideSpans(row.start_time, ignoredSpans)) continue
    const existing = byArtifact.get(row.artifact_id)
    if (existing) {
      existing.startMs = Math.min(existing.startMs, row.start_time)
      existing.endMs = Math.max(existing.endMs, row.end_time)
      continue
    }
    // Adoption (v50) kept the artifact id as the entity id when it minted a
    // page/file/repository entity for it.
    const entityId = activeEntityId(db, row.artifact_id)
    byArtifact.set(row.artifact_id, {
      id: newRecordId(),
      kind: 'artifact',
      memoryType: 'observed',
      statement: row.display_title,
      // Entity-named when an entity exists; plain text otherwise so the title
      // stays findable either way.
      exactText: entityId ? '' : row.display_title,
      startMs: row.start_time,
      endMs: row.end_time,
      appBundleId: null,
      appName: null,
      title: row.display_title,
      primaryEntityId: entityId,
      sourceRefs: [`artifact:${row.artifact_id}`],
      entityIds: new Set(entityId ? [entityId] : []),
    })
  }
  return [...byArtifact.values()]
}

// ─── Index maintenance ───────────────────────────────────────────────────────

export interface IndexDayResult {
  date: string
  records: number
}

/** Rebuild one local day's records from the corrected facts, atomically. */
export function indexMemoryForDay(db: Database.Database, date: string): IndexDayResult {
  const [fromMs, toMs] = localDayBounds(date)
  const fingerprint = memoryIndexDayFingerprint(db, date)
  const ignoredSpans = getIgnoredBlockSpansForRange(db, fromMs, toMs)

  const records = sessionRecords(db, date, fromMs, toMs)
  applyAttributionTags(db, records, fromMs, toMs)
  records.push(...meetingRecords(db, fromMs, toMs, ignoredSpans))
  records.push(...artifactRecords(db, fromMs, toMs, ignoredSpans))

  const insertRecord = db.prepare(`
    INSERT INTO memory_records (
      id, record_kind, memory_type, statement, exact_text, semantic_text,
      date, start_ms, end_ms, app_bundle_id, app_name, title,
      primary_entity_id, source_refs_json, confidence, provenance,
      sensitivity, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'standard', ?)
  `)
  const insertTag = db.prepare(`
    INSERT OR IGNORE INTO memory_record_entities (record_id, entity_id) VALUES (?, ?)
  `)

  const now = Date.now()
  const commit = db.transaction(() => {
    db.prepare(`DELETE FROM memory_records WHERE date = ?`).run(date)
    for (const record of records) {
      insertRecord.run(
        record.id,
        record.kind,
        record.memoryType,
        record.statement,
        record.exactText,
        // Semantic text is the minimized factual representation DEV-180 will
        // embed; written now so the semantic index can build without another
        // full projection pass.
        record.statement,
        date,
        record.startMs,
        record.endMs,
        record.appBundleId,
        record.appName,
        record.title,
        record.primaryEntityId,
        JSON.stringify(record.sourceRefs),
        record.memoryType === 'connected' ? 'corroborated' : 'observed',
        record.kind === 'session' ? 'corrected_session' : record.kind,
        now,
      )
      for (const entityId of record.entityIds) insertTag.run(record.id, entityId)
    }
    db.prepare(`
      INSERT INTO memory_index_days (date, fingerprint, indexed_at, record_count)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        fingerprint = excluded.fingerprint,
        indexed_at = excluded.indexed_at,
        record_count = excluded.record_count
    `).run(date, fingerprint, now, records.length)
  })
  commit()
  return { date, records: records.length }
}

/** Index the day only when its inputs changed. Cheap when current. */
export function ensureDayMemoryIndexed(db: Database.Database, date: string): boolean {
  if (!memoryIndexAvailable(db)) return false
  const stored = db.prepare(`SELECT fingerprint FROM memory_index_days WHERE date = ?`)
    .get(date) as { fingerprint: string } | undefined
  const current = memoryIndexDayFingerprint(db, date)
  if (stored?.fingerprint === current) return false
  indexMemoryForDay(db, date)
  return true
}

/** After a correction lands or is undone: refresh the affected day so the
 *  correction reaches search immediately. A day that was never indexed is left
 *  for the backfill — its legacy query path applies the correction filters at
 *  query time. */
export function refreshMemoryIndexForDay(db: Database.Database, date: string): void {
  try {
    if (!memoryIndexAvailable(db)) return
    const indexed = db.prepare(`SELECT 1 FROM memory_index_days WHERE date = ?`).get(date)
    if (!indexed && date !== localDateString()) return
    indexMemoryForDay(db, date)
  } catch (error) {
    console.error('[memoryIndex] day refresh failed', date, error)
  }
}

/** Dates with any capture evidence, newest first. */
export function listMemoryIndexCandidateDates(db: Database.Database, limit: number): string[] {
  const rows = db.prepare(`
    SELECT DISTINCT date FROM (
      SELECT DISTINCT strftime('%Y-%m-%d', start_time / 1000, 'unixepoch', 'localtime') AS date FROM app_sessions
      UNION
      SELECT DISTINCT strftime('%Y-%m-%d', ts_ms / 1000, 'unixepoch', 'localtime') AS date FROM focus_events
    )
    WHERE date IS NOT NULL
    ORDER BY date DESC
    LIMIT ?
  `).all(limit) as Array<{ date: string }>
  return rows.map((row) => row.date)
}

export interface BackfillProgress {
  scanned: number
  indexed: number
  done: boolean
}

/** One bounded backfill step: ensure up to `daysPerStep` stale days, newest
 *  first. Returns done=true when every candidate day is current. */
export function memoryIndexBackfillStep(
  db: Database.Database,
  options: { maxDays?: number; daysPerStep?: number } = {},
): BackfillProgress {
  if (!memoryIndexAvailable(db)) return { scanned: 0, indexed: 0, done: true }
  const maxDays = options.maxDays ?? 730
  const daysPerStep = options.daysPerStep ?? 5
  const candidates = listMemoryIndexCandidateDates(db, maxDays)
  let scanned = 0
  let indexed = 0
  for (const date of candidates) {
    scanned += 1
    if (ensureDayMemoryIndexed(db, date)) {
      indexed += 1
      if (indexed >= daysPerStep) return { scanned, indexed, done: false }
    }
  }
  return { scanned, indexed, done: true }
}

let backfillTimer: ReturnType<typeof setTimeout> | null = null

/** Background backfill: a few days per tick so the main process stays
 *  responsive; stops when the index is current. Safe to call repeatedly. */
export function startMemoryIndexBackfill(
  getDatabase: () => Database.Database,
  options: { maxDays?: number; stepDelayMs?: number } = {},
): void {
  if (backfillTimer) return
  const stepDelayMs = options.stepDelayMs ?? 500
  const step = (): void => {
    backfillTimer = null
    let progress: BackfillProgress
    try {
      progress = memoryIndexBackfillStep(getDatabase(), { maxDays: options.maxDays })
    } catch (error) {
      console.error('[memoryIndex] backfill step failed', error)
      return
    }
    if (!progress.done) backfillTimer = setTimeout(step, stepDelayMs)
  }
  backfillTimer = setTimeout(step, stepDelayMs)
}

export function stopMemoryIndexBackfill(): void {
  if (backfillTimer) {
    clearTimeout(backfillTimer)
    backfillTimer = null
  }
}
