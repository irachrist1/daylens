import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { writeAIBlockLabel } from '../src/main/db/queries.ts'

function seedBlock(db: Database.Database, id = 'block-1'): void {
  const start = new Date(2026, 3, 12, 10, 0, 0, 0).getTime()
  db.prepare(`
    INSERT INTO timeline_blocks (
      id, date, start_time, end_time, block_kind, dominant_category,
      category_distribution_json, switch_count, label_current, label_source,
      label_confidence, narrative_current, evidence_summary_json, is_live,
      heuristic_version, computed_at, invalidated_at
    ) VALUES (?, '2026-04-12', ?, ?, 'work', 'development', '{}', 0,
      'Development', 'rule', 0.5, NULL, '{}', 0, 'test', ?, NULL)
  `).run(id, start, start + 3_600_000, start)
}

function labelOf(db: Database.Database, id: string): { current: string; source: string } {
  const row = db.prepare('SELECT label_current, label_source FROM timeline_blocks WHERE id = ?').get(id) as
    { label_current: string; label_source: string }
  return { current: row.label_current, source: row.label_source }
}

test('writeAIBlockLabel writes an AI label and records a history row', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  seedBlock(db)

  const wrote = writeAIBlockLabel(db, { blockId: 'block-1', label: 'Fixing sync uploader retries', narrative: 'n' })
  assert.equal(wrote, true)

  const after = labelOf(db, 'block-1')
  assert.equal(after.current, 'Fixing sync uploader retries')
  assert.equal(after.source, 'ai')

  const labelRows = db.prepare("SELECT count(*) c FROM timeline_block_labels WHERE block_id = 'block-1' AND source = 'ai'").get() as { c: number }
  assert.equal(labelRows.c, 1)
  db.close()
})

test('force = false preserves a user override (no write)', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  seedBlock(db)
  // Simulate a user-renamed block.
  db.prepare(`INSERT INTO block_label_overrides (block_id, label, narrative, updated_at) VALUES ('block-1', 'Client billing', NULL, ?)`).run(Date.now())
  db.prepare(`UPDATE timeline_blocks SET label_current = 'Client billing', label_source = 'user' WHERE id = 'block-1'`).run()

  const wrote = writeAIBlockLabel(db, { blockId: 'block-1', label: 'Something the AI guessed' })
  assert.equal(wrote, false, 'override must block a non-forced AI write')

  const after = labelOf(db, 'block-1')
  assert.equal(after.current, 'Client billing')
  assert.equal(after.source, 'user')
  db.close()
})

test('force = true clears the override and overwrites (the Regenerate path)', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  seedBlock(db)
  db.prepare(`INSERT INTO block_label_overrides (block_id, label, narrative, updated_at) VALUES ('block-1', 'Old wrong label', NULL, ?)`).run(Date.now())
  db.prepare(`UPDATE timeline_blocks SET label_current = 'Old wrong label', label_source = 'user' WHERE id = 'block-1'`).run()

  const wrote = writeAIBlockLabel(db, { blockId: 'block-1', label: 'Reviewing pull requests', force: true })
  assert.equal(wrote, true)

  const after = labelOf(db, 'block-1')
  assert.equal(after.current, 'Reviewing pull requests')
  assert.equal(after.source, 'ai')

  const overrideRows = db.prepare("SELECT count(*) c FROM block_label_overrides WHERE block_id = 'block-1'").get() as { c: number }
  assert.equal(overrideRows.c, 0, 'force must clear the override')
  db.close()
})

test('an empty label is rejected', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  seedBlock(db)
  assert.equal(writeAIBlockLabel(db, { blockId: 'block-1', label: '   ' }), false)
  assert.equal(labelOf(db, 'block-1').current, 'Development')
  db.close()
})

test('a missing block is not reported as written', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)

  const wrote = writeAIBlockLabel(db, { blockId: 'missing-block', label: 'Reviewing architecture' })
  assert.equal(wrote, false)

  const labelRows = db.prepare("SELECT count(*) c FROM timeline_block_labels WHERE block_id = 'missing-block'").get() as { c: number }
  assert.equal(labelRows.c, 0)
  db.close()
})
