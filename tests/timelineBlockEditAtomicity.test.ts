import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { getBlockLabelOverride } from '../src/main/db/queries.ts'
import { getTimelineDayPayload } from '../src/main/services/workBlocks.ts'
import { applyTimelineBlockEdit } from '../src/main/services/timelineBlockEdits.ts'

const DATE = '2026-04-22'
const start = new Date(2026, 3, 22, 9, 0).getTime()
const end = new Date(2026, 3, 22, 10, 0).getTime()

function createBlock() {
  const db = createProductionTestDatabase()
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, raw_app_name, canonical_app_id, capture_source, capture_version
    ) VALUES (?, ?, ?, ?, ?, 'development', 1, ?, ?, 'test', 2)
  `).run('com.test.editor', 'Editor', start, end, 3600, 'Editor', 'com.test.editor')
  const block = getTimelineDayPayload(db, DATE, null, { materialize: false }).blocks[0]
  assert.ok(block)
  return { db, block }
}

test('block editor rolls label and category back when the time edit fails', () => {
  const { db, block } = createBlock()
  assert.throws(() => applyTimelineBlockEdit(db, block, {
    blockId: block.id,
    date: DATE,
    label: 'Renamed work',
    category: 'writing',
    startMs: block.endTime - 30_000,
    endMs: block.endTime,
  }), /at least a minute/)

  assert.equal(getBlockLabelOverride(db, block.id), null)
  const correction = db.prepare(`
    SELECT correction_json FROM timeline_block_reviews
    WHERE block_id = ? ORDER BY updated_at DESC LIMIT 1
  `).get(block.id) as { correction_json: string } | undefined
  assert.equal(correction ? JSON.parse(correction.correction_json).label : undefined, undefined)
  assert.equal(correction ? JSON.parse(correction.correction_json).category : undefined, undefined)
  db.close()
})

test('block editor commits label, category, and time as one save', () => {
  const { db, block } = createBlock()
  const result = applyTimelineBlockEdit(db, block, {
    blockId: block.id,
    date: DATE,
    label: 'Writing the launch note',
    category: 'writing',
    startMs: start + 10 * 60_000,
    endMs: end,
  })

  assert.deepEqual(result.changedFields, ['label', 'category', 'time'])
  assert.equal(getBlockLabelOverride(db, block.id)?.label, 'Writing the launch note')
  const correction = db.prepare(`
    SELECT correction_json FROM timeline_block_reviews
    WHERE block_id = ? ORDER BY updated_at DESC LIMIT 1
  `).get(block.id) as { correction_json: string }
  assert.deepEqual(JSON.parse(correction.correction_json), {
    label: 'Writing the launch note',
    category: 'writing',
  })
  db.close()
})
