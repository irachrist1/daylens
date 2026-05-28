// Evening consolidation: at day-rollover, archive the finalized day,
// extract repeated pattern candidates, promote ones above threshold, decay
// non-override patterns that didn't fire today, and optionally backfill
// today's blocks with newly-promoted labels. Local + deterministic — no
// AI calls. Hermes-style closed loop adapted to Daylens' structured data.

import type Database from 'better-sqlite3'
import crypto from 'node:crypto'
import { localDayBounds } from '../lib/localDate'
import {
  buildBlockPatternKeyJson,
  evidenceIsAllDistraction,
  gatherConcurrentEvidence,
  matchPromotedPatterns,
  memoryEnabled,
  type WorkMemoryBlockInput,
} from '../services/workMemory'
import type { WorkContextAppSummary } from '@shared/types'
import { getSettings } from '../services/settings'

const PROMOTION_THRESHOLD_CONFIDENCE = 0.65
const PROMOTION_THRESHOLD_OCCURRENCES = 2
const DECAY_FACTOR = 0.95
const DECAY_FLOOR = 0.2
const DECAYED_RECALL_GRACE_MS = 14 * 24 * 60 * 60 * 1000

export interface EveningConsolidationResult {
  date: string
  archived: boolean
  newCandidates: number
  promoted: number
  decayed: number
  backfilled: number
  skipped: false
  reason?: undefined
}

export interface EveningConsolidationSkip {
  date: string
  skipped: true
  reason: 'disabled' | 'no-tables' | 'already-archived'
}

function sha1(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex')
}

function nowMs(): number {
  return Date.now()
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).get(tableName) as { name: string } | undefined
  return Boolean(row)
}

interface FinalizedBlockRow {
  id: string
  startTime: number
  endTime: number
  dominantCategory: string
  labelCurrent: string
  labelSource: string
}

function loadFinalizedBlocksForDate(db: Database.Database, dateStr: string): FinalizedBlockRow[] {
  if (!tableExists(db, 'timeline_blocks')) return []
  return db.prepare(`
    SELECT
      id,
      start_time AS startTime,
      end_time AS endTime,
      dominant_category AS dominantCategory,
      label_current AS labelCurrent,
      label_source AS labelSource
    FROM timeline_blocks
    WHERE date = ? AND invalidated_at IS NULL AND is_live = 0
    ORDER BY start_time ASC
  `).all(dateStr) as FinalizedBlockRow[]
}

function loadTopAppsForBlock(db: Database.Database, blockId: string, fallbackCategory: string): WorkContextAppSummary[] {
  if (!tableExists(db, 'timeline_block_members') || !tableExists(db, 'app_sessions')) return []
  return db.prepare(`
    SELECT
      app_sessions.bundle_id AS bundleId,
      app_sessions.app_name AS appName,
      COALESCE(app_sessions.category, ?) AS category,
      SUM(COALESCE(timeline_block_members.weight_seconds, app_sessions.duration_sec, 0)) AS totalSeconds,
      COUNT(*) AS sessionCount,
      0 AS isBrowser
    FROM timeline_block_members
    JOIN app_sessions ON CAST(app_sessions.id AS TEXT) = timeline_block_members.member_id
    WHERE timeline_block_members.block_id = ?
      AND timeline_block_members.member_type = 'app_session'
    GROUP BY app_sessions.bundle_id, app_sessions.app_name, app_sessions.category
    ORDER BY totalSeconds DESC
    LIMIT 6
  `).all(fallbackCategory, blockId) as WorkContextAppSummary[]
}

function blockInputFromRow(db: Database.Database, row: FinalizedBlockRow): WorkMemoryBlockInput {
  return {
    id: row.id,
    startTime: row.startTime,
    endTime: row.endTime,
    dominantCategory: row.dominantCategory,
    topApps: loadTopAppsForBlock(db, row.id, row.dominantCategory),
  }
}

function blockLabelIsGenericForBackfill(row: FinalizedBlockRow): boolean {
  if (row.labelSource === 'user' || row.labelSource === 'memory') return false
  const label = row.labelCurrent?.trim().toLowerCase() ?? ''
  if (!label) return true
  return [
    'mixed work',
    'web session',
    'development',
    'building & testing',
    'terminal session',
    'terminal work',
    'browsing',
    'general browsing',
    'untitled block',
    'communication',
    'productivity',
  ].includes(label)
}

function alreadyArchived(db: Database.Database, dateStr: string): boolean {
  if (!tableExists(db, 'daily_memory_archive')) return false
  const row = db.prepare(`
    SELECT date FROM daily_memory_archive WHERE date = ? LIMIT 1
  `).get(dateStr) as { date: string } | undefined
  return Boolean(row)
}

function upsertCandidatePattern(
  db: Database.Database,
  patternKeyJson: string,
  labelGuess: string | null,
  category: string | null,
): { patternId: string; promoted: boolean } {
  const patternId = `cp_${sha1(patternKeyJson).slice(0, 16)}`
  const timestamp = nowMs()

  const existing = db.prepare(`
    SELECT id, status, confidence, recall_count AS recallCount
    FROM context_patterns
    WHERE pattern_key = ?
    LIMIT 1
  `).get(patternKeyJson) as { id: string; status: string; confidence: number; recallCount: number } | undefined

  if (!existing) {
    if (!labelGuess) {
      return { patternId, promoted: false }
    }
    db.prepare(`
      INSERT INTO context_patterns (
        id, pattern_type, pattern_key, label_suggestion, category_suggestion,
        confidence, recall_count, status, created_at, updated_at, last_recalled_at
      )
      VALUES (?, 'app_combo', ?, ?, ?, 0.5, 1, 'candidate', ?, ?, ?)
    `).run(patternId, patternKeyJson, labelGuess, category, timestamp, timestamp, timestamp)
    return { patternId, promoted: false }
  }

  const newRecall = existing.recallCount + 1
  const meetsOccurrence = newRecall >= PROMOTION_THRESHOLD_OCCURRENCES
  const meetsConfidence = existing.confidence >= PROMOTION_THRESHOLD_CONFIDENCE
  const shouldPromote = existing.status === 'candidate' && (meetsOccurrence || meetsConfidence)
  const nextStatus = shouldPromote ? 'promoted' : existing.status
  const nextConfidence = shouldPromote
    ? Math.max(existing.confidence, PROMOTION_THRESHOLD_CONFIDENCE)
    : existing.confidence

  db.prepare(`
    UPDATE context_patterns
    SET recall_count = ?,
        status = ?,
        confidence = ?,
        last_recalled_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(newRecall, nextStatus, nextConfidence, timestamp, timestamp, existing.id)

  return { patternId: existing.id, promoted: shouldPromote && existing.status !== 'promoted' }
}

function recordOccurrence(
  db: Database.Database,
  patternId: string,
  blockId: string,
): void {
  if (!tableExists(db, 'pattern_occurrences')) return
  db.prepare(`
    INSERT OR IGNORE INTO pattern_occurrences (id, pattern_id, block_id, matched_at)
    VALUES (?, ?, ?, ?)
  `).run(`po_${sha1(`${patternId}:${blockId}`).slice(0, 16)}`, patternId, blockId, nowMs())
}

function decayStalePatterns(db: Database.Database, dateStr: string): number {
  if (!tableExists(db, 'pattern_occurrences')) return 0
  const [fromMs, toMs] = localDayBounds(dateStr)

  // Find promoted, non-override patterns with no occurrence today.
  const stale = db.prepare(`
    SELECT id, confidence, last_recalled_at AS lastRecalledAt
    FROM context_patterns
    WHERE status = 'promoted'
      AND pattern_type != 'override'
      AND id NOT IN (
        SELECT pattern_id FROM pattern_occurrences
        WHERE matched_at >= ? AND matched_at < ?
      )
  `).all(fromMs, toMs) as Array<{ id: string; confidence: number; lastRecalledAt: number | null }>

  let count = 0
  const now = nowMs()
  for (const row of stale) {
    const decayed = Math.max(DECAY_FLOOR, row.confidence * DECAY_FACTOR)
    const lastRecall = row.lastRecalledAt ?? 0
    const reachedGrace = now - lastRecall > DECAYED_RECALL_GRACE_MS
    const nextStatus = decayed < PROMOTION_THRESHOLD_CONFIDENCE && reachedGrace ? 'decayed' : 'promoted'
    db.prepare(`
      UPDATE context_patterns
      SET confidence = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(decayed, nextStatus, now, row.id)
    count++
  }
  return count
}

interface BackfillUpdate {
  blockId: string
  label: string
  confidence: number
  source: 'memory'
}

function applyBackfill(db: Database.Database, updates: BackfillUpdate[]): number {
  if (updates.length === 0) return 0
  const stmt = db.prepare(`
    UPDATE timeline_blocks
    SET label_current = ?, label_source = ?, label_confidence = ?
    WHERE id = ? AND invalidated_at IS NULL
  `)
  const labelStmt = db.prepare(`
    INSERT OR REPLACE INTO timeline_block_labels (
      id, block_id, label, narrative, source, confidence, created_at, model_info_json
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL)
  `)
  const tx = db.transaction((rows: BackfillUpdate[]) => {
    let applied = 0
    for (const row of rows) {
      const info = stmt.run(row.label, row.source, row.confidence, row.blockId)
      if (info.changes > 0) {
        const labelId = `${row.blockId}:memory:${sha1(row.label).slice(0, 8)}`
        labelStmt.run(labelId, row.blockId, row.label, row.source, row.confidence, nowMs())
        applied++
      }
    }
    return applied
  })
  return tx(updates)
}

function buildArchiveMarkdown(
  dateStr: string,
  blocks: FinalizedBlockRow[],
  stats: { newCandidates: number; promoted: number; decayed: number; backfilled: number },
): string {
  const lines: string[] = []
  lines.push(`# Daylens daily memory archive — ${dateStr}`)
  lines.push('')
  lines.push(`Blocks finalized: ${blocks.length}`)
  lines.push(`New pattern candidates: ${stats.newCandidates}`)
  lines.push(`Promoted patterns: ${stats.promoted}`)
  lines.push(`Decayed patterns: ${stats.decayed}`)
  lines.push(`Same-day backfilled blocks: ${stats.backfilled}`)
  lines.push('')
  lines.push('## Blocks')
  lines.push('')
  for (const block of blocks) {
    const start = new Date(block.startTime).toISOString()
    const minutes = Math.round((block.endTime - block.startTime) / 60_000)
    lines.push(`- ${start} (${minutes}m) — ${block.dominantCategory} — ${block.labelCurrent} [${block.labelSource}]`)
  }
  return lines.join('\n')
}

export function runEveningConsolidation(
  db: Database.Database,
  dateStr: string,
): EveningConsolidationResult | EveningConsolidationSkip {
  if (!memoryEnabled()) return { date: dateStr, skipped: true, reason: 'disabled' }
  if (!getSettings().workMemoryConsolidationEnabled) {
    return { date: dateStr, skipped: true, reason: 'disabled' }
  }
  if (!tableExists(db, 'context_patterns') || !tableExists(db, 'daily_memory_archive')) {
    return { date: dateStr, skipped: true, reason: 'no-tables' }
  }
  if (alreadyArchived(db, dateStr)) {
    return { date: dateStr, skipped: true, reason: 'already-archived' }
  }

  const blocks = loadFinalizedBlocksForDate(db, dateStr)

  let newCandidates = 0
  let promoted = 0
  const backfill: BackfillUpdate[] = []

  for (const row of blocks) {
    const block = blockInputFromRow(db, row)
    const evidence = gatherConcurrentEvidence(db, block)
    if (evidenceIsAllDistraction(evidence)) continue

    const keyResult = buildBlockPatternKeyJson(block, evidence)
    if (keyResult) {
      const labelGuess = keyResult.project
        ? (keyResult.devContext ? `${capitalize(keyResult.project)} development` : capitalize(keyResult.project))
        : (row.labelSource === 'rule' ? null : row.labelCurrent)

      const existedBefore = db.prepare(`SELECT 1 FROM context_patterns WHERE pattern_key = ? LIMIT 1`).get(keyResult.json) ? true : false
      const categoryHint = block.dominantCategory ? String(block.dominantCategory) : null
      const { patternId, promoted: justPromoted } = upsertCandidatePattern(
        db,
        keyResult.json,
        labelGuess,
        categoryHint,
      )
      if (!existedBefore && labelGuess) newCandidates++
      if (justPromoted) promoted++
      recordOccurrence(db, patternId, row.id)
    }

    // Same-day backfill: if this block has a generic label, try matching
    // promoted patterns (including ones promoted earlier in this loop) and
    // adopt the higher-confidence learned label.
    if (blockLabelIsGenericForBackfill(row)) {
      const match = matchPromotedPatterns(db, block, evidence)
      if (match && match.label.trim() && match.label.trim().toLowerCase() !== row.labelCurrent?.trim().toLowerCase()) {
        backfill.push({
          blockId: row.id,
          label: match.label,
          confidence: match.confidence,
          source: 'memory',
        })
      }
    }
  }

  const backfilled = applyBackfill(db, backfill)
  const decayed = decayStalePatterns(db, dateStr)

  const stats = { newCandidates, promoted, decayed, backfilled }
  const archiveJson = JSON.stringify({
    date: dateStr,
    blocks: blocks.map((row) => ({
      id: row.id,
      startTime: row.startTime,
      endTime: row.endTime,
      dominantCategory: row.dominantCategory,
      label: row.labelCurrent,
      labelSource: row.labelSource,
    })),
    stats,
  })
  const archiveMarkdown = buildArchiveMarkdown(dateStr, blocks, stats)

  db.prepare(`
    INSERT INTO daily_memory_archive (date, archive_markdown, archive_json, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      archive_markdown = excluded.archive_markdown,
      archive_json = excluded.archive_json,
      created_at = excluded.created_at
  `).run(dateStr, archiveMarkdown, archiveJson, nowMs())

  return {
    date: dateStr,
    archived: true,
    newCandidates,
    promoted,
    decayed,
    backfilled,
    skipped: false,
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
