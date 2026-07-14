import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { getTimelineRangeBlocks } from '../src/main/services/timelineCalendarRange.ts'

function seedBlock(
  db: Database.Database,
  options: {
    id: string
    date: string
    startTime: number
    endTime: number
    label?: string
    isLive?: number
    invalidatedAt?: number | null
    distribution?: Record<string, number>
  },
): void {
  db.prepare(`
    INSERT INTO timeline_blocks (
      id, date, start_time, end_time, block_kind, dominant_category,
      category_distribution_json, switch_count, label_current, label_source,
      label_confidence, narrative_current, evidence_summary_json, is_live,
      heuristic_version, computed_at, invalidated_at
    ) VALUES (?, ?, ?, ?, 'work', 'development', ?, 0, ?, 'rule',
      0.5, NULL, '{}', ?, 'test', ?, ?)
  `).run(
    options.id,
    options.date,
    options.startTime,
    options.endTime,
    JSON.stringify(options.distribution ?? { development: 3600 }),
    options.label ?? 'Development',
    options.isLive ?? 0,
    options.startTime,
    options.invalidatedAt ?? null,
  )
}

function seedMemberSeconds(db: Database.Database, blockId: string, seconds: number): void {
  db.prepare(`
    INSERT INTO timeline_block_members (block_id, member_type, member_id, start_time, end_time, weight_seconds)
    VALUES (?, 'app_session', ?, 0, 0, ?)
  `).run(blockId, `${blockId}:s1`, seconds)
}

const T0 = new Date(2026, 6, 1, 9, 0, 0, 0).getTime()
const HOUR = 3_600_000

test('returns blocks grouped by day, ordered, live and invalidated excluded', () => {
  const db = createProductionTestDatabase()
  seedBlock(db, { id: 'b2', date: '2026-07-01', startTime: T0 + 2 * HOUR, endTime: T0 + 3 * HOUR })
  seedBlock(db, { id: 'b1', date: '2026-07-01', startTime: T0, endTime: T0 + HOUR })
  seedBlock(db, { id: 'b3', date: '2026-07-02', startTime: T0 + 24 * HOUR, endTime: T0 + 25 * HOUR })
  seedBlock(db, { id: 'live', date: '2026-07-02', startTime: T0 + 26 * HOUR, endTime: T0 + 27 * HOUR, isLive: 1 })
  seedBlock(db, { id: 'stale', date: '2026-07-02', startTime: T0 + 28 * HOUR, endTime: T0 + 29 * HOUR, invalidatedAt: Date.now() })
  seedBlock(db, { id: 'outside', date: '2026-08-01', startTime: T0, endTime: T0 + HOUR })
  seedMemberSeconds(db, 'b1', 1800)

  const days = getTimelineRangeBlocks(db, '2026-07-01', '2026-07-31')
  assert.equal(days.length, 2)
  const july1 = days.find((day) => day.date === '2026-07-01')
  assert.ok(july1)
  assert.deepEqual(july1.blocks.map((block) => block.id), ['b1', 'b2'])
  const july2 = days.find((day) => day.date === '2026-07-02')
  assert.ok(july2)
  assert.deepEqual(july2.blocks.map((block) => block.id), ['b3'])
  db.close()
})

test('a deleted block is excluded from the month range read', () => {
  const db = createProductionTestDatabase()
  seedBlock(db, { id: 'kept', date: '2026-07-01', startTime: T0, endTime: T0 + HOUR })
  seedBlock(db, { id: 'gone', date: '2026-07-01', startTime: T0 + 2 * HOUR, endTime: T0 + 3 * HOUR })
  db.prepare(`
    INSERT INTO timeline_block_reviews (id, block_id, date, evidence_key, review_state, original_block_json, correction_json, created_at, updated_at)
    VALUES ('r1', 'gone', '2026-07-01', 'k', 'ignored', '{}', '{}', ?, ?)
  `).run(Date.now(), Date.now())

  const [day] = getTimelineRangeBlocks(db, '2026-07-01', '2026-07-01')
  assert.deepEqual(day.blocks.map((block) => block.id), ['kept'])
  db.close()
})

test('a user rename always wins over label_current', () => {
  const db = createProductionTestDatabase()
  seedBlock(db, { id: 'b1', date: '2026-07-01', startTime: T0, endTime: T0 + HOUR, label: 'Stale AI name' })
  db.prepare(`INSERT INTO block_label_overrides (block_id, label, narrative, updated_at) VALUES ('b1', 'Client billing', NULL, ?)`).run(Date.now())

  const [day] = getTimelineRangeBlocks(db, '2026-07-01', '2026-07-01')
  assert.equal(day.blocks[0].label, 'Client billing')
  db.close()
})

test('active seconds come from session weights, clamped to the wall-clock span', () => {
  const db = createProductionTestDatabase()
  // 1h span with 30m of tracked sessions → 30m active.
  seedBlock(db, { id: 'sparse', date: '2026-07-01', startTime: T0, endTime: T0 + HOUR })
  seedMemberSeconds(db, 'sparse', 1800)
  // 1h span with inflated 3h of member weights → clamped to the span.
  seedBlock(db, { id: 'inflated', date: '2026-07-01', startTime: T0 + 2 * HOUR, endTime: T0 + 3 * HOUR })
  seedMemberSeconds(db, 'inflated', 3 * 3600)
  // No members at all → falls back to the span (same rule as blockActiveSeconds).
  seedBlock(db, { id: 'bare', date: '2026-07-01', startTime: T0 + 4 * HOUR, endTime: T0 + 5 * HOUR })

  const [day] = getTimelineRangeBlocks(db, '2026-07-01', '2026-07-01')
  const byId = new Map(day.blocks.map((block) => [block.id, block]))
  assert.equal(byId.get('sparse')?.activeSeconds, 1800)
  assert.equal(byId.get('inflated')?.activeSeconds, 3600)
  assert.equal(byId.get('bare')?.activeSeconds, 3600)
  assert.equal(day.activeSeconds, 1800 + 3600 + 3600)
  db.close()
})
