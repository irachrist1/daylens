// Correction commands (timeline spec, Corrections; DEV-172).
//
// Every non-destructive correction — rename, category, trim, merge, split,
// exclude a block, exclude specific evidence, assign a client — flows through
// one typed command with three verbs:
//
//   previewCorrection  — applies the command inside a SQLite savepoint, reads
//                        the corrected day and Apps facts, rolls back, and
//                        returns the delta. The preview IS the apply, dry-run:
//                        it can never drift from what apply will do.
//   applyCorrection    — one transaction: snapshot the correction-ledger rows
//                        the command may touch, apply, record the undo entry.
//                        A conflicting correction throws before or inside the
//                        transaction and nothing lands (spec: "Conflicting
//                        corrections do not apply partially").
//   undoCorrection     — restores the snapshot in one transaction. Only the
//                        newest un-undone correction of a date can be undone,
//                        so interleaved restores can't corrupt the ledger.
//
// Permanent purges are NOT commands. They destroy raw rows, require their own
// confirmation, and have no undo — the spec keeps them clearly separated.
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  AppCategory,
  CorrectionAppDelta,
  CorrectionApplyResult,
  CorrectionBlockDelta,
  CorrectionCommand,
  CorrectionPreview,
  CorrectionUndoResult,
  DayTimelinePayload,
  LiveSession,
  WorkContextBlock,
} from '@shared/types'
import { localDayBounds } from '../lib/localDate'
import { materializeTimelineDayProjection } from '../core/query/projections'
import { getCorrectedAppSummariesForRange } from './activityFacts'
import { applyTimelineBlockEdit } from './timelineBlockEdits'
import {
  invalidateTimelineDayBlocks,
  mergeTimelineEpisodes,
  writeSplitCorrection,
  writeTimelineBlockReview,
} from './workBlocks'
import {
  isEntityCorrectionSnapshot,
  restoreEntityCorrectionSnapshot,
} from './entities/entityCorrections'

const MIN_SPLIT_EDGE_MS = 60_000

interface ResolvedCommand {
  payload: DayTimelinePayload
  blocks: WorkContextBlock[]
}

interface LedgerSnapshot {
  affectedBlockIds: string[]
  reviews: Array<Record<string, unknown>>
  boundary: Array<Record<string, unknown>>
  labelOverrides: Array<Record<string, unknown>>
  exclusions: Array<Record<string, unknown>>
  workSessions: Array<{
    id: string
    client_id: string | null
    project_id: string | null
    attribution_status: string | null
    attribution_confidence: number | null
  }>
  segmentAttributions: Array<{
    segment_id: string
    client_id: string | null
    project_id: string | null
    decision_source: string | null
    confidence: number | null
  }>
}

function blockIdsOf(command: CorrectionCommand): string[] {
  if (command.kind === 'merge') return command.blockIds
  return [command.blockId]
}

function resolveCommand(
  db: Database.Database,
  command: CorrectionCommand,
  live: LiveSession | null,
): ResolvedCommand {
  const payload = materializeTimelineDayProjection(db, command.date, live)
  const blocks = blockIdsOf(command).map((blockId) => {
    const block = payload.blocks.find((candidate) => candidate.id === blockId)
    if (!block) throw new Error('Block not found — the day may have just rebuilt. Reopen it and try again.')
    return block
  })
  if (command.kind === 'merge' && blocks.length < 2) {
    throw new Error('Pick at least two blocks to merge.')
  }
  if (command.kind === 'split') {
    const [block] = blocks
    if (command.cutMs < block.startTime + MIN_SPLIT_EDGE_MS || command.cutMs > block.endTime - MIN_SPLIT_EDGE_MS) {
      throw new Error('Pick a split point at least a minute inside the block.')
    }
  }
  if (command.kind === 'exclude-evidence') {
    const ref = command.evidence
    const identity = ref.kind === 'site' ? ref.domain?.trim() : (ref.bundleId ?? ref.appName)?.trim()
    if (!identity) throw new Error('Nothing to exclude.')
  }
  return { payload, blocks }
}

function clientNameFor(db: Database.Database, clientId: string | null): string | null {
  if (!clientId) return null
  const row = db.prepare(`SELECT name FROM clients WHERE id = ?`).get(clientId) as { name: string } | undefined
  return row?.name ?? null
}

function projectNameFor(db: Database.Database, projectId: string | null | undefined): string | null {
  if (!projectId) return null
  const row = db.prepare(`SELECT name FROM projects WHERE id = ?`).get(projectId) as { name: string } | undefined
  return row?.name ?? null
}

function describeCommand(
  db: Database.Database,
  command: CorrectionCommand,
  blocks: readonly WorkContextBlock[],
): string {
  const label = (block: WorkContextBlock): string => block.label.current
  switch (command.kind) {
    case 'edit': {
      const parts: string[] = []
      if (command.label && command.label.trim() !== blocks[0].label.current) {
        parts.push(`Rename "${label(blocks[0])}" to "${command.label.trim()}"`)
      }
      if (command.category && command.category !== blocks[0].dominantCategory) {
        parts.push(parts.length > 0 ? `change its category to ${command.category}` : `Change the category of "${label(blocks[0])}" to ${command.category}`)
      }
      if (command.startMs !== undefined || command.endMs !== undefined) {
        parts.push(parts.length > 0 ? 'adjust its time range' : `Adjust the time range of "${label(blocks[0])}"`)
      }
      return parts.length > 0 ? parts.join(', ') : `Edit "${label(blocks[0])}"`
    }
    case 'merge':
      return `Merge ${blocks.length} blocks into one`
    case 'split': {
      const at = new Date(command.cutMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      return `Split "${label(blocks[0])}" at ${at}`
    }
    case 'exclude-block':
      return `Remove "${label(blocks[0])}" from the day`
    case 'exclude-evidence': {
      const subject = command.evidence.kind === 'site'
        ? command.evidence.domain
        : (command.evidence.appName ?? command.evidence.bundleId)
      return `Exclude ${subject} from "${label(blocks[0])}"`
    }
    case 'assign-client': {
      const name = clientNameFor(db, command.clientId)
      if (!name) return `Remove the client assignment from "${label(blocks[0])}"`
      const project = projectNameFor(db, command.projectId)
      return project
        ? `Assign "${label(blocks[0])}" to ${name} · ${project}`
        : `Assign "${label(blocks[0])}" to ${name}`
    }
  }
}

// The single write path preview and apply share. Resolution already validated
// the command; everything here writes only correction-ledger rows (reviews,
// boundary corrections, label overrides, evidence exclusions, work-session
// attribution) — never raw evidence.
function applyCommandToLedger(
  db: Database.Database,
  command: CorrectionCommand,
  resolved: ResolvedCommand,
): void {
  switch (command.kind) {
    case 'edit': {
      applyTimelineBlockEdit(db, resolved.blocks[0], {
        blockId: command.blockId,
        date: command.date,
        label: command.label,
        category: command.category,
        startMs: command.startMs,
        endMs: command.endMs,
      })
      return
    }
    case 'merge': {
      mergeTimelineEpisodes(db, command.date, [...resolved.blocks])
      return
    }
    case 'split': {
      writeSplitCorrection(db, command.date, command.cutMs)
      invalidateTimelineDayBlocks(db, command.date)
      return
    }
    case 'exclude-block': {
      writeTimelineBlockReview(db, command.date, resolved.blocks[0], { state: 'ignored' })
      return
    }
    case 'exclude-evidence': {
      const block = resolved.blocks[0]
      const ref = command.evidence
      db.prepare(`
        INSERT INTO evidence_exclusions (id, date, kind, bundle_id, app_name, domain, span_start_ms, span_end_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `excl_${randomUUID().replace(/-/g, '').slice(0, 18)}`,
        command.date,
        ref.kind,
        ref.bundleId ?? null,
        ref.appName ?? null,
        ref.domain ?? null,
        block.startTime,
        block.endTime,
        Date.now(),
      )
      invalidateTimelineDayBlocks(db, command.date)
      return
    }
    case 'assign-client': {
      const block = resolved.blocks[0]
      const now = Date.now()
      const sessions = db.prepare(`
        SELECT id FROM work_sessions WHERE started_at < ? AND ended_at > ?
      `).all(block.endTime, block.startTime) as Array<{ id: string }>
      if (sessions.length === 0 && (command.clientId != null || command.projectId != null)) {
        throw new Error(
          'Nothing to attribute in this block yet — attribution needs a work session overlapping the block.',
        )
      }
      for (const { id } of sessions) {
        db.prepare(`
          UPDATE work_sessions
          SET client_id = ?, project_id = ?,
              attribution_status = CASE WHEN ? IS NOT NULL THEN 'attributed' ELSE 'unattributed' END,
              attribution_confidence = CASE WHEN ? IS NOT NULL THEN 1.0 ELSE NULL END,
              updated_at = ?
          WHERE id = ?
        `).run(command.clientId, command.projectId ?? null, command.clientId, command.clientId, now, id)
        db.prepare(`
          UPDATE segment_attributions
          SET client_id = ?, project_id = ?, decision_source = 'user', confidence = 1.0
          WHERE rank = 1 AND segment_id IN (
            SELECT segment_id FROM work_session_segments WHERE work_session_id = ?
          )
        `).run(command.clientId, command.projectId ?? null, id)
      }
      return
    }
  }
}

function captureSnapshot(
  db: Database.Database,
  command: CorrectionCommand,
  resolved: ResolvedCommand,
): LedgerSnapshot {
  const affectedBlockIds = resolved.blocks.map((block) => block.id)
  const blockIdMarks = affectedBlockIds.map(() => '?').join(', ') || `''`
  const reviews = db.prepare(`
    SELECT * FROM timeline_block_reviews WHERE date = ? OR block_id IN (${blockIdMarks})
  `).all(command.date, ...affectedBlockIds) as Array<Record<string, unknown>>
  const boundary = db.prepare(`
    SELECT * FROM timeline_boundary_corrections WHERE date = ?
  `).all(command.date) as Array<Record<string, unknown>>
  const labelOverrides = affectedBlockIds.length === 0 ? [] : db.prepare(`
    SELECT * FROM block_label_overrides WHERE block_id IN (${blockIdMarks})
  `).all(...affectedBlockIds) as Array<Record<string, unknown>>
  const exclusions = db.prepare(`
    SELECT * FROM evidence_exclusions WHERE date = ?
  `).all(command.date) as Array<Record<string, unknown>>

  let workSessions: LedgerSnapshot['workSessions'] = []
  let segmentAttributions: LedgerSnapshot['segmentAttributions'] = []
  if (command.kind === 'assign-client') {
    const block = resolved.blocks[0]
    workSessions = db.prepare(`
      SELECT id, client_id, project_id, attribution_status, attribution_confidence
      FROM work_sessions WHERE started_at < ? AND ended_at > ?
    `).all(block.endTime, block.startTime) as LedgerSnapshot['workSessions']
    const sessionMarks = workSessions.map(() => '?').join(', ')
    segmentAttributions = workSessions.length === 0 ? [] : db.prepare(`
      SELECT segment_id, client_id, project_id, decision_source, confidence
      FROM segment_attributions
      WHERE rank = 1 AND segment_id IN (
        SELECT segment_id FROM work_session_segments WHERE work_session_id IN (${sessionMarks})
      )
    `).all(...workSessions.map((session) => session.id)) as LedgerSnapshot['segmentAttributions']
  }

  return { affectedBlockIds, reviews, boundary, labelOverrides, exclusions, workSessions, segmentAttributions }
}

function restoreRows(
  db: Database.Database,
  table: string,
  rows: readonly Record<string, unknown>[],
): void {
  for (const row of rows) {
    const columns = Object.keys(row)
    db.prepare(`
      INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
    `).run(...columns.map((column) => row[column]))
  }
}

function restoreSnapshot(db: Database.Database, dateStr: string, snapshot: LedgerSnapshot): void {
  const blockIdMarks = snapshot.affectedBlockIds.map(() => '?').join(', ') || `''`
  db.prepare(`DELETE FROM timeline_block_reviews WHERE date = ? OR block_id IN (${blockIdMarks})`)
    .run(dateStr, ...snapshot.affectedBlockIds)
  db.prepare(`DELETE FROM timeline_boundary_corrections WHERE date = ?`).run(dateStr)
  if (snapshot.affectedBlockIds.length > 0) {
    db.prepare(`DELETE FROM block_label_overrides WHERE block_id IN (${blockIdMarks})`)
      .run(...snapshot.affectedBlockIds)
  }
  db.prepare(`DELETE FROM evidence_exclusions WHERE date = ?`).run(dateStr)
  restoreRows(db, 'timeline_block_reviews', snapshot.reviews)
  restoreRows(db, 'timeline_boundary_corrections', snapshot.boundary)
  restoreRows(db, 'block_label_overrides', snapshot.labelOverrides)
  restoreRows(db, 'evidence_exclusions', snapshot.exclusions)
  for (const session of snapshot.workSessions) {
    // Attribution ids churn on reprojection; a vanished session simply has
    // nothing to restore.
    db.prepare(`
      UPDATE work_sessions
      SET client_id = ?, project_id = ?, attribution_status = ?, attribution_confidence = ?, updated_at = ?
      WHERE id = ?
    `).run(
      session.client_id, session.project_id, session.attribution_status,
      session.attribution_confidence, Date.now(), session.id,
    )
  }
  for (const attribution of snapshot.segmentAttributions) {
    db.prepare(`
      UPDATE segment_attributions
      SET client_id = ?, project_id = ?, decision_source = ?, confidence = ?
      WHERE rank = 1 AND segment_id = ?
    `).run(
      attribution.client_id, attribution.project_id, attribution.decision_source,
      attribution.confidence, attribution.segment_id,
    )
  }
}

function blockDeltas(
  targets: readonly WorkContextBlock[],
  after: DayTimelinePayload,
): CorrectionBlockDelta[] {
  return targets.map((target) => {
    const midpoint = target.startTime + (target.endTime - target.startTime) / 2
    const successor = after.blocks.find((candidate) =>
      candidate.startTime <= midpoint && candidate.endTime > midpoint
      && candidate.review?.state !== 'ignored')
      ?? null
    return {
      blockId: target.id,
      labelBefore: target.label.current,
      labelAfter: successor ? successor.label.current : null,
      startMsBefore: target.startTime,
      endMsBefore: target.endTime,
      startMsAfter: successor?.startTime ?? null,
      endMsAfter: successor?.endTime ?? null,
      categoryBefore: target.dominantCategory,
      categoryAfter: successor?.dominantCategory ?? null,
    }
  })
}

function appDeltas(
  before: ReturnType<typeof getCorrectedAppSummariesForRange>,
  after: ReturnType<typeof getCorrectedAppSummariesForRange>,
): CorrectionAppDelta[] {
  const names = new Set([...before.map((app) => app.appName), ...after.map((app) => app.appName)])
  const deltas: CorrectionAppDelta[] = []
  for (const appName of names) {
    const secondsBefore = before.find((app) => app.appName === appName)?.totalSeconds ?? 0
    const secondsAfter = after.find((app) => app.appName === appName)?.totalSeconds ?? 0
    if (Math.abs(secondsBefore - secondsAfter) >= 30) deltas.push({ appName, secondsBefore, secondsAfter })
  }
  return deltas.sort((a, b) => Math.abs(b.secondsAfter - b.secondsBefore) - Math.abs(a.secondsAfter - a.secondsBefore))
}

function surfaceNotes(
  db: Database.Database,
  command: CorrectionCommand,
  blocks: readonly WorkContextBlock[],
  category: AppCategory | undefined,
): string[] {
  const notes: string[] = []
  switch (command.kind) {
    case 'edit':
      if (command.label?.trim()) {
        notes.push(`Search and the AI will know this block as "${command.label.trim()}".`)
      }
      if (category) notes.push(`Apps and Timeline recolor this stretch as ${category}.`)
      if (command.startMs !== undefined) {
        notes.push('Trimmed-off minutes re-form into their own block; nothing is lost.')
      }
      break
    case 'merge':
      notes.push('The merged block survives every re-analysis; search finds one block instead of several.')
      break
    case 'split':
      notes.push('The cut survives every re-analysis; each side keeps its own evidence.')
      break
    case 'exclude-block':
      notes.push(`This stretch disappears from Timeline, Apps totals, search, and AI answers for ${command.date}. Raw capture is kept; undo brings it back.`)
      break
    case 'exclude-evidence': {
      const subject = command.evidence.kind === 'site'
        ? command.evidence.domain
        : (command.evidence.appName ?? command.evidence.bundleId)
      notes.push(`${subject} disappears from this block's evidence, the Apps totals, search, and AI answers. Raw capture is kept; undo brings it back.`)
      break
    }
    case 'assign-client': {
      const name = clientNameFor(db, command.clientId)
      const project = projectNameFor(db, command.projectId)
      if (!name) {
        notes.push(`Time in "${blocks[0].label.current}" no longer counts toward any client.`)
      } else if (project) {
        notes.push(`Time in "${blocks[0].label.current}" counts toward ${name} · ${project} in client rollups and reports.`)
      } else {
        notes.push(`Time in "${blocks[0].label.current}" counts toward ${name} in client rollups and reports.`)
      }
      break
    }
  }
  return notes
}

export function previewCorrection(
  db: Database.Database,
  command: CorrectionCommand,
  live: LiveSession | null,
): CorrectionPreview {
  const [dayFromMs, dayToMs] = localDayBounds(command.date)
  const resolved = resolveCommand(db, command, live)
  const appsBefore = getCorrectedAppSummariesForRange(db, dayFromMs, dayToMs, live)
  const description = describeCommand(db, command, resolved.blocks)

  db.exec('SAVEPOINT correction_preview')
  try {
    applyCommandToLedger(db, command, resolved)
    const after = materializeTimelineDayProjection(db, command.date, live)
    const appsAfter = getCorrectedAppSummariesForRange(db, dayFromMs, dayToMs, live)
    const category = command.kind === 'edit' ? command.category : undefined
    return {
      description,
      totalSecondsBefore: Math.round(resolved.payload.totalSeconds),
      totalSecondsAfter: Math.round(after.totalSeconds),
      blockCountBefore: resolved.payload.blocks.length,
      blockCountAfter: after.blocks.length,
      blocks: blockDeltas(resolved.blocks, after),
      apps: appDeltas(appsBefore, appsAfter),
      surfaces: surfaceNotes(db, command, resolved.blocks, category),
    }
  } finally {
    db.exec('ROLLBACK TO correction_preview')
    db.exec('RELEASE correction_preview')
  }
}

export function applyCorrection(
  db: Database.Database,
  command: CorrectionCommand,
  live: LiveSession | null,
): CorrectionApplyResult {
  const resolved = resolveCommand(db, command, live)
  const description = describeCommand(db, command, resolved.blocks)
  const snapshot = captureSnapshot(db, command, resolved)
  const correctionId = `corr_${randomUUID().replace(/-/g, '').slice(0, 18)}`
  const commit = db.transaction(() => {
    applyCommandToLedger(db, command, resolved)
    db.prepare(`
      INSERT INTO correction_undo_log (id, date, kind, description, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(correctionId, command.date, command.kind, description, JSON.stringify(snapshot), Date.now())
  })
  commit()
  return { correctionId, description }
}

interface UndoRow {
  id: string
  date: string
  kind: string
  description: string
  snapshot_json: string
  created_at: number
  undone_at: number | null
}

export function undoCorrection(db: Database.Database, correctionId: string): CorrectionUndoResult {
  const row = db.prepare(`SELECT * FROM correction_undo_log WHERE id = ?`).get(correctionId) as UndoRow | undefined
  if (!row) throw new Error('Nothing to undo.')
  if (row.undone_at != null) return { undone: false, description: row.description }
  const newer = db.prepare(`
    SELECT id FROM correction_undo_log
    WHERE date = ? AND undone_at IS NULL AND created_at > ? AND id != ?
    LIMIT 1
  `).get(row.date, row.created_at, row.id) as { id: string } | undefined
  if (newer) throw new Error('A newer correction exists for this day — undo that one first.')

  const snapshot = JSON.parse(row.snapshot_json) as unknown
  // Entity corrections (DEV-177) live in the same ledger; their snapshots
  // restore entity tables instead of the timeline correction overlay.
  if (isEntityCorrectionSnapshot(snapshot)) {
    const commit = db.transaction(() => {
      restoreEntityCorrectionSnapshot(db, snapshot)
      db.prepare(`UPDATE correction_undo_log SET undone_at = ? WHERE id = ?`).run(Date.now(), row.id)
    })
    commit()
    return { undone: true, description: row.description }
  }
  const commit = db.transaction(() => {
    restoreSnapshot(db, row.date, snapshot as LedgerSnapshot)
    db.prepare(`UPDATE correction_undo_log SET undone_at = ? WHERE id = ?`).run(Date.now(), row.id)
    invalidateTimelineDayBlocks(db, row.date)
  })
  commit()
  return { undone: true, description: row.description }
}
