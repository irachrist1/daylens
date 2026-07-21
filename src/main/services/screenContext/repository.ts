// Screen-context experiment (DEV-197) — the durable frame ledger and derived
// evidence store. Pure SQL over an injected handle; the only writer of
// screen_context_frames / screen_context_evidence. State transitions are
// validated against the lifecycle table so an illegal hop can never be
// persisted, and the extraction commit is one transaction: evidence row,
// provenance, and the 'indexed' state land together or not at all.

import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  RAW_BACKLOG_STATES,
  SCREEN_FRAME_TRANSITIONS,
  type ScreenEvidenceRecord,
  type ScreenExtractionResult,
  type ScreenFrameRecord,
  type ScreenFrameState,
  type ScreenFrameTrigger,
} from './types'

interface FrameRow {
  id: string
  captured_at: number
  trigger: string
  app_bundle_id: string | null
  app_name: string | null
  display_id: number | null
  exclusion_policy_version: number
  local_path: string | null
  byte_size: number
  state: string
  retry_count: number
  last_error: string | null
  next_retry_at: number | null
  first_failed_at: number | null
  deleted_without_evidence: number
  created_at: number
  updated_at: number
}

function rowToFrame(row: FrameRow): ScreenFrameRecord {
  return {
    id: row.id,
    capturedAt: row.captured_at,
    trigger: row.trigger as ScreenFrameTrigger,
    appBundleId: row.app_bundle_id,
    appName: row.app_name,
    displayId: row.display_id,
    exclusionPolicyVersion: row.exclusion_policy_version,
    localPath: row.local_path,
    byteSize: row.byte_size,
    state: row.state as ScreenFrameState,
    retryCount: row.retry_count,
    lastError: row.last_error,
    nextRetryAt: row.next_retry_at,
    firstFailedAt: row.first_failed_at,
    deletedWithoutEvidence: row.deleted_without_evidence === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

interface EvidenceRow {
  id: string
  frame_id: string
  captured_at: number
  app_bundle_id: string | null
  app_name: string | null
  doc_title: string | null
  ocr_spans_json: string
  subject_refs_json: string
  bounding_json: string | null
  extractor_model: string
  extractor_schema_version: number
  confidence: number
  sensitivity: string
  frame_digest: string
  interval_start_ms: number | null
  interval_end_ms: number | null
  created_at: number
}

function parseJsonArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function rowToEvidence(row: EvidenceRow): ScreenEvidenceRecord {
  let bounding: unknown | null = null
  if (row.bounding_json) {
    try { bounding = JSON.parse(row.bounding_json) } catch { bounding = null }
  }
  return {
    id: row.id,
    frameId: row.frame_id,
    capturedAt: row.captured_at,
    appBundleId: row.app_bundle_id,
    appName: row.app_name,
    docTitle: row.doc_title,
    ocrSpans: parseJsonArray(row.ocr_spans_json),
    subjectRefs: parseJsonArray(row.subject_refs_json),
    bounding,
    extractorModel: row.extractor_model,
    extractorSchemaVersion: row.extractor_schema_version,
    confidence: row.confidence,
    sensitivity: 'high',
    frameDigest: row.frame_digest,
    intervalStartMs: row.interval_start_ms,
    intervalEndMs: row.interval_end_ms,
    createdAt: row.created_at,
  }
}

// ─── Frames ───────────────────────────────────────────────────────────────────

export function insertFrameRecord(
  db: Database.Database,
  input: {
    capturedAt: number
    trigger: ScreenFrameTrigger
    appBundleId: string | null
    appName: string | null
    displayId: number | null
    exclusionPolicyVersion: number
    localPath: string
    byteSize: number
  },
): ScreenFrameRecord {
  const now = Date.now()
  const id = `scf_${randomUUID().replace(/-/g, '').slice(0, 20)}`
  db.prepare(`
    INSERT INTO screen_context_frames (
      id, captured_at, trigger, app_bundle_id, app_name, display_id,
      exclusion_policy_version, local_path, byte_size, state,
      retry_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'captured', 0, ?, ?)
  `).run(
    id, input.capturedAt, input.trigger, input.appBundleId, input.appName,
    input.displayId, input.exclusionPolicyVersion, input.localPath,
    input.byteSize, now, now,
  )
  return getFrameRecord(db, id)!
}

export function getFrameRecord(db: Database.Database, id: string): ScreenFrameRecord | null {
  const row = db.prepare(`SELECT * FROM screen_context_frames WHERE id = ?`).get(id) as FrameRow | undefined
  return row ? rowToFrame(row) : null
}

export function listFramesInState(
  db: Database.Database,
  states: readonly ScreenFrameState[],
): ScreenFrameRecord[] {
  if (states.length === 0) return []
  const marks = states.map(() => '?').join(', ')
  const rows = db.prepare(
    `SELECT * FROM screen_context_frames WHERE state IN (${marks}) ORDER BY captured_at ASC`,
  ).all(...states) as FrameRow[]
  return rows.map(rowToFrame)
}

/** The raw backlog: every frame whose encrypted file is still on disk. */
export function getBacklogTotals(db: Database.Database): { frames: number; bytes: number } {
  const marks = RAW_BACKLOG_STATES.map(() => '?').join(', ')
  const row = db.prepare(`
    SELECT COUNT(*) AS frames, COALESCE(SUM(byte_size), 0) AS bytes
    FROM screen_context_frames WHERE state IN (${marks})
  `).get(...RAW_BACKLOG_STATES) as { frames: number; bytes: number }
  return { frames: row.frames, bytes: row.bytes }
}

class IllegalTransitionError extends Error {
  constructor(id: string, from: string, to: string) {
    super(`screen-context frame ${id}: illegal lifecycle transition ${from} → ${to}`)
    this.name = 'IllegalTransitionError'
  }
}

/** Move a frame to a new lifecycle state, refusing illegal hops. Extra column
 *  updates ride the same statement so failure bookkeeping is atomic with the
 *  state change. */
export function transitionFrameState(
  db: Database.Database,
  id: string,
  to: ScreenFrameState,
  extra: Partial<{
    localPath: string | null
    lastError: string | null
    retryCount: number
    nextRetryAt: number | null
    firstFailedAt: number | null
    deletedWithoutEvidence: boolean
  }> = {},
): ScreenFrameRecord {
  const current = getFrameRecord(db, id)
  if (!current) throw new Error(`screen-context frame ${id}: not found`)
  if (!SCREEN_FRAME_TRANSITIONS[current.state].includes(to)) {
    throw new IllegalTransitionError(id, current.state, to)
  }
  const sets: string[] = ['state = ?', 'updated_at = ?']
  const values: unknown[] = [to, Date.now()]
  if (extra.localPath !== undefined) { sets.push('local_path = ?'); values.push(extra.localPath) }
  if (extra.lastError !== undefined) { sets.push('last_error = ?'); values.push(extra.lastError) }
  if (extra.retryCount !== undefined) { sets.push('retry_count = ?'); values.push(extra.retryCount) }
  if (extra.nextRetryAt !== undefined) { sets.push('next_retry_at = ?'); values.push(extra.nextRetryAt) }
  if (extra.firstFailedAt !== undefined) { sets.push('first_failed_at = ?'); values.push(extra.firstFailedAt) }
  if (extra.deletedWithoutEvidence !== undefined) {
    sets.push('deleted_without_evidence = ?')
    values.push(extra.deletedWithoutEvidence ? 1 : 0)
  }
  db.prepare(`UPDATE screen_context_frames SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
  return getFrameRecord(db, id)!
}

// ─── The atomic extraction commit ─────────────────────────────────────────────

/** Commit extraction: the derived evidence row and the frame's 'indexed' state
 *  land in ONE transaction. Only after this returns may the raw file be
 *  deleted — the invariant that makes raw deletion safe. */
export function commitExtractionResult(
  db: Database.Database,
  frame: ScreenFrameRecord,
  result: ScreenExtractionResult,
  frameDigest: string,
): ScreenEvidenceRecord {
  const now = Date.now()
  const evidenceId = `sce_${randomUUID().replace(/-/g, '').slice(0, 20)}`
  const commit = db.transaction(() => {
    db.prepare(`
      INSERT INTO screen_context_evidence (
        id, frame_id, captured_at, app_bundle_id, app_name, doc_title,
        ocr_spans_json, subject_refs_json, bounding_json,
        extractor_model, extractor_schema_version, confidence, sensitivity,
        frame_digest, interval_start_ms, interval_end_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'high', ?, ?, ?, ?)
    `).run(
      evidenceId, frame.id, frame.capturedAt, frame.appBundleId, frame.appName,
      result.docTitle,
      JSON.stringify(result.ocrSpans),
      JSON.stringify(result.subjectRefs),
      result.bounding == null ? null : JSON.stringify(result.bounding),
      result.extractorModel, result.extractorSchemaVersion, result.confidence,
      frameDigest, frame.capturedAt, frame.capturedAt, now,
    )
    transitionFrameState(db, frame.id, 'indexed')
  })
  commit()
  return getEvidenceForFrame(db, frame.id)!
}

// ─── Evidence ─────────────────────────────────────────────────────────────────

export function getEvidenceForFrame(db: Database.Database, frameId: string): ScreenEvidenceRecord | null {
  const row = db.prepare(`SELECT * FROM screen_context_evidence WHERE frame_id = ?`).get(frameId) as EvidenceRow | undefined
  return row ? rowToEvidence(row) : null
}

export function listAllEvidence(db: Database.Database): ScreenEvidenceRecord[] {
  const rows = db.prepare(`SELECT * FROM screen_context_evidence ORDER BY captured_at ASC`).all() as EvidenceRow[]
  return rows.map(rowToEvidence)
}

/** Delete derived evidence rows. Frame rows keep their terminal state — the
 *  ledger remembers a frame existed and was deleted, never what it showed. */
export function deleteEvidenceRows(db: Database.Database, evidenceIds: readonly string[]): void {
  if (evidenceIds.length === 0) return
  const marks = evidenceIds.map(() => '?').join(', ')
  db.prepare(`DELETE FROM screen_context_evidence WHERE id IN (${marks})`).run(...evidenceIds)
}

/** Every frame + evidence pair belonging to one excluded source (app by
 *  bundle id or name) or, with a span, one period. */
export function listFramesForSource(
  db: Database.Database,
  source: { bundleId?: string | null; appName?: string | null },
): ScreenFrameRecord[] {
  const clauses: string[] = []
  const values: unknown[] = []
  if (source.bundleId) { clauses.push('app_bundle_id = ?'); values.push(source.bundleId) }
  if (source.appName) { clauses.push('app_name = ?'); values.push(source.appName) }
  if (clauses.length === 0) return []
  const rows = db.prepare(
    `SELECT * FROM screen_context_frames WHERE ${clauses.join(' OR ')} ORDER BY captured_at ASC`,
  ).all(...values) as FrameRow[]
  return rows.map(rowToFrame)
}

export function listFramesInPeriod(
  db: Database.Database,
  fromMs: number,
  toMs: number,
): ScreenFrameRecord[] {
  const rows = db.prepare(
    `SELECT * FROM screen_context_frames WHERE captured_at >= ? AND captured_at < ? ORDER BY captured_at ASC`,
  ).all(fromMs, toMs) as FrameRow[]
  return rows.map(rowToFrame)
}

export function listAllFrames(db: Database.Database): ScreenFrameRecord[] {
  const rows = db.prepare(`SELECT * FROM screen_context_frames ORDER BY captured_at ASC`).all() as FrameRow[]
  return rows.map(rowToFrame)
}
