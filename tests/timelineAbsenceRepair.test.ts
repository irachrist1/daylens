import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import type { AppCategory, WorkContextBlock } from '../src/shared/types.ts'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { materializeTimelineDayProjection } from '../src/main/core/query/projections.ts'
import { analyzeTimelineDay } from '../src/main/services/analyzeDay.ts'
import { mergeTimelineEpisodes, writeTimelineBlockReview } from '../src/main/services/workBlocks.ts'
import { setBlockLabelOverride } from '../src/main/db/queries.ts'

// The absence guard end-to-end (v2-ship-plan W1-A). The founder's real July 10
// had a block from 3:49 PM to 10:05 PM with a real absence from 8:01 PM to
// 9:39 PM inside it — a merge path joined work across time away. These tests
// pin the three defenses: the write-path veto in mergeTimelineEpisodes, the
// regroup partition in analyzeTimelineDay (the AI proposes, the guard
// decides), and the repair path that splits an already-stored bad day at the
// gap while user corrections survive.

const TEST_DATE = '2026-04-22'

// The July 10 shape, scaled to a morning: work 9:00–10:00, a 97-minute real
// absence 10:00–11:37, work 11:37–12:30.
const GAP_START_H = 10
const GAP_END = { h: 11, m: 37 }

function localMs(hour: number, minute = 0): number {
  return new Date(2026, 3, 22, hour, minute, 0, 0).getTime()
}

function createDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  return db
}

function insertSession(
  db: Database.Database,
  title: string,
  startHour: number,
  startMinute: number,
  durationMinutes: number,
  category: AppCategory = 'development',
  app: { bundleId: string; name: string } = { bundleId: 'com.mitchellh.ghostty', name: 'Ghostty' },
): void {
  const startTime = localMs(startHour, startMinute)
  const endTime = startTime + durationMinutes * 60_000
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, capture_source, capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'test', 1)
  `).run(app.bundleId, app.name, startTime, endTime, durationMinutes * 60, category, title, app.name)
}

// One coherent block on each side of the absence: same app, same work,
// contiguous sessions — the heuristics keep each side as a single block.
function seedDayWithAbsence(db: Database.Database): void {
  insertSession(db, 'daylens — repairing the tracker - Ghostty', 9, 0, 30)
  insertSession(db, 'daylens — repairing the tracker - Ghostty', 9, 30, 30)
  // 97-minute absence 10:00–11:37 (asleep / away — nothing captured).
  insertSession(db, 'daylens — repairing the tracker - Ghostty', GAP_END.h, GAP_END.m, 28)
  insertSession(db, 'daylens — repairing the tracker - Ghostty', 12, 5, 25)
}

function validBlocks(db: Database.Database): Array<{ id: string; start_time: number; end_time: number }> {
  return db.prepare(`
    SELECT id, start_time, end_time FROM timeline_blocks
    WHERE date = ? AND invalidated_at IS NULL AND is_live = 0
    ORDER BY start_time ASC
  `).all(TEST_DATE) as Array<{ id: string; start_time: number; end_time: number }>
}

function blockSpansGap(block: { startTime: number; endTime: number } | { start_time: number; end_time: number }): boolean {
  const start = 'startTime' in block ? block.startTime : block.start_time
  const end = 'endTime' in block ? block.endTime : block.end_time
  const gapMid = (localMs(GAP_START_H) + localMs(GAP_END.h, GAP_END.m)) / 2
  return start < gapMid && end > gapMid
}

test('mergeTimelineEpisodes refuses to join blocks across a real absence', () => {
  const db = createDb()
  seedDayWithAbsence(db)
  const payload = materializeTimelineDayProjection(db, TEST_DATE, null)
  const blocks = payload.blocks.filter((block) => !block.isLive)
  assert.ok(blocks.length >= 2, `the day must split at the absence; got ${blocks.length} block(s)`)
  assert.ok(blocks.every((block) => !blockSpansGap(block)), 'no fresh block may span the absence')

  assert.throws(
    () => mergeTimelineEpisodes(db, TEST_DATE, [blocks[0], blocks[blocks.length - 1]]),
    /real absence/,
    'the one shared merge write path must veto a join across the gap',
  )
  // The veto left no merge correction behind.
  const corrections = db.prepare(
    `SELECT COUNT(*) AS n FROM timeline_boundary_corrections WHERE kind = 'merge' AND date = ?`,
  ).get(TEST_DATE) as { n: number }
  assert.equal(corrections.n, 0)
  db.close()
})

test('an AI regroup plan spanning the absence is partitioned: sides merge, the gap never does', async () => {
  const db = createDb()
  // Two over-split topics per side so the regroup has real work to do.
  insertSession(db, 'Camera comparison research - Google Search - Google Chrome', 9, 0, 12, 'browsing', { bundleId: 'com.google.Chrome', name: 'Google Chrome' })
  insertSession(db, 'Camera comparison research - DPReview - Google Chrome', 9, 12, 10, 'browsing', { bundleId: 'com.google.Chrome', name: 'Google Chrome' })
  insertSession(db, 'City council election results - Local News - Google Chrome', 9, 22, 12, 'browsing', { bundleId: 'com.google.Chrome', name: 'Google Chrome' })
  insertSession(db, 'City council election results - Analysis - Google Chrome', 9, 34, 10, 'browsing', { bundleId: 'com.google.Chrome', name: 'Google Chrome' })
  // 113-minute absence 9:44–11:37, then the same shape again.
  insertSession(db, 'Camera comparison research - Google Search - Google Chrome', GAP_END.h, GAP_END.m, 12, 'browsing', { bundleId: 'com.google.Chrome', name: 'Google Chrome' })
  insertSession(db, 'Camera comparison research - DPReview - Google Chrome', GAP_END.h, GAP_END.m + 12, 10, 'browsing', { bundleId: 'com.google.Chrome', name: 'Google Chrome' })
  insertSession(db, 'City council election results - Local News - Google Chrome', GAP_END.h, GAP_END.m + 22, 12, 'browsing', { bundleId: 'com.google.Chrome', name: 'Google Chrome' })
  insertSession(db, 'City council election results - Analysis - Google Chrome', GAP_END.h, GAP_END.m + 34, 10, 'browsing', { bundleId: 'com.google.Chrome', name: 'Google Chrome' })

  const before = materializeTimelineDayProjection(db, TEST_DATE, null)
  assert.ok(before.blocks.filter((b) => !b.isLive).length >= 4, 'each side should over-split into two topic blocks')

  // The AI proposes ONE group across the whole day — absence included.
  const result = await analyzeTimelineDay(db, TEST_DATE, {
    regroupPlan: async (blocks) => [blocks.map((_, index) => index)],
    blockInsight: async () => ({ label: 'Researching cameras and local news', narrative: '' }),
  })

  assert.equal(result.merged, true, 'the contiguous runs on each side must still merge')
  const after = validBlocks(db)
  assert.equal(after.length, 2, `expected one merged block per side, got ${after.length}`)
  assert.ok(after.every((block) => !blockSpansGap(block)), 'no merged block may span the absence')

  // No stored merge correction reaches across the gap either.
  const gapMid = (localMs(GAP_START_H) + localMs(GAP_END.h, GAP_END.m)) / 2
  const spanning = db.prepare(`
    SELECT COUNT(*) AS n FROM timeline_boundary_corrections
    WHERE kind = 'merge' AND date = ? AND span_start_ms < ? AND span_end_ms > ?
  `).get(TEST_DATE, gapMid, gapMid) as { n: number }
  assert.equal(spanning.n, 0)
  db.close()
})

test('re-analyze REPAIRS a stored day whose block spans an absence, preserving the user rename', async () => {
  const db = createDb()
  seedDayWithAbsence(db)
  const fresh = materializeTimelineDayProjection(db, TEST_DATE, null)
  const freshBlocks = fresh.blocks.filter((block) => !block.isLive)
  assert.equal(freshBlocks.length, 2)

  // The user renamed the morning block — the correction that must survive.
  const morning = freshBlocks[0]
  writeTimelineBlockReview(db, TEST_DATE, morning as WorkContextBlock, {
    state: 'corrected',
    correctedLabel: 'Fixing the tracker',
  })
  setBlockLabelOverride(db, morning.id, 'Fixing the tracker', null)

  // Poison the day the way the pre-guard bug did: one stored block fused
  // across the absence, held together by a merge correction spanning the gap,
  // and an AI label row that marks the day "processed" (frozen).
  const dayStart = localMs(9)
  const dayEnd = localMs(12, 30)
  const heuristicVersion = (db.prepare(
    `SELECT heuristic_version FROM timeline_blocks WHERE invalidated_at IS NULL LIMIT 1`,
  ).get() as { heuristic_version: string }).heuristic_version
  const sessions = db.prepare(
    `SELECT id, start_time FROM app_sessions ORDER BY start_time ASC`,
  ).all() as Array<{ id: number; start_time: number }>
  const lastBefore = [...sessions].reverse().find((s) => s.start_time < localMs(GAP_START_H))!
  const firstAfter = sessions.find((s) => s.start_time >= localMs(GAP_END.h, GAP_END.m))!
  const now = Date.now()
  db.transaction(() => {
    db.prepare(`UPDATE timeline_blocks SET invalidated_at = ? WHERE date = ?`).run(now, TEST_DATE)
    db.prepare(`
      INSERT INTO timeline_blocks (
        id, date, start_time, end_time, block_kind, dominant_category,
        category_distribution_json, switch_count, label_current, label_source,
        label_confidence, narrative_current, evidence_summary_json, is_live,
        heuristic_version, computed_at, invalidated_at
      ) VALUES ('bad_fused_block', ?, ?, ?, 'deep-work', 'development', '{"development": 6180}', 0,
                'Repairing the tracker', 'ai', 0.9, NULL, '{}', 0, ?, ?, NULL)
    `).run(TEST_DATE, dayStart, dayEnd, heuristicVersion, now)
    db.prepare(`
      INSERT INTO timeline_block_labels (id, block_id, label, narrative, source, confidence, created_at)
      VALUES ('lbl_bad_fused', 'bad_fused_block', 'Repairing the tracker', NULL, 'ai', 0.9, ?)
    `).run(now)
    db.prepare(`
      INSERT INTO timeline_boundary_corrections (
        id, date, left_session_id, right_session_id, kind, created_at, updated_at, span_start_ms, span_end_ms
      ) VALUES ('bnd_poisoned', ?, ?, ?, 'merge', ?, ?, ?, ?)
    `).run(TEST_DATE, lastBefore.id, firstAfter.id, now, now, dayStart, dayEnd)
  })()

  // Sanity: the stored day now serves the fused bad block (it is "processed").
  const poisoned = materializeTimelineDayProjection(db, TEST_DATE, null)
  const poisonedBlocks = poisoned.blocks.filter((block) => !block.isLive)
  assert.equal(poisonedBlocks.length, 1)
  assert.ok(blockSpansGap(poisonedBlocks[0]), 'the poisoned block must span the absence')

  // The founder's one click: re-analyze. No AI needed to repair the shape.
  const result = await analyzeTimelineDay(db, TEST_DATE, {
    regroupPlan: async () => [],
    blockInsight: async () => ({ label: 'Repaired work', narrative: '' }),
  })

  const repaired = result.payload.blocks.filter((block) => !block.isLive)
  assert.ok(repaired.length >= 2, `the repair must split the day at the gap; got ${repaired.length} block(s)`)
  assert.ok(repaired.every((block) => !blockSpansGap(block)), 'no repaired block may span the absence')
  // The poisoned merge correction is still stored but can no longer erase a
  // real-absence boundary — the guard outranks every stored correction.
  const poisonRow = db.prepare(`SELECT COUNT(*) AS n FROM timeline_boundary_corrections WHERE id = 'bnd_poisoned'`)
    .get() as { n: number }
  assert.equal(poisonRow.n, 1)
  // The user's rename re-attached to the rebuilt morning block (invariant 8).
  assert.ok(
    repaired.some((block) => block.label.current === 'Fixing the tracker'),
    `the rename must survive the repair; labels: ${repaired.map((b) => b.label.current).join(' | ')}`,
  )
  db.close()
})

test('a repaired day stays repaired on the next plain read', async () => {
  const db = createDb()
  seedDayWithAbsence(db)
  materializeTimelineDayProjection(db, TEST_DATE, null)

  // Poison with only the spanning merge correction (no fabricated block):
  // rebuild-time protection alone must keep the day split at the gap.
  const sessions = db.prepare(`SELECT id, start_time FROM app_sessions ORDER BY start_time ASC`)
    .all() as Array<{ id: number; start_time: number }>
  const lastBefore = [...sessions].reverse().find((s) => s.start_time < localMs(GAP_START_H))!
  const firstAfter = sessions.find((s) => s.start_time >= localMs(GAP_END.h, GAP_END.m))!
  const now = Date.now()
  db.prepare(`
    INSERT INTO timeline_boundary_corrections (
      id, date, left_session_id, right_session_id, kind, created_at, updated_at, span_start_ms, span_end_ms
    ) VALUES ('bnd_poisoned2', ?, ?, ?, 'merge', ?, ?, ?, ?)
  `).run(TEST_DATE, lastBefore.id, firstAfter.id, now, now, localMs(9), localMs(12, 30))
  db.prepare(`UPDATE timeline_blocks SET invalidated_at = ? WHERE date = ?`).run(now, TEST_DATE)

  // The next read rebuilds from sessions with the poisoned correction live —
  // the absence guard in boundary scoring must refuse to honor it.
  const rebuilt = materializeTimelineDayProjection(db, TEST_DATE, null)
  const blocks = rebuilt.blocks.filter((block) => !block.isLive)
  assert.ok(blocks.length >= 2)
  assert.ok(blocks.every((block) => !blockSpansGap(block)), 'a stored merge correction must not re-fuse across the absence')
  db.close()
})
