import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'

// memoryEnabled() reads this at call time; ensure the work-memory system is on
// for these tests regardless of the host environment.
process.env.DAYLENS_WORK_MEMORY_ENABLED = '1'

import { createProductionTestDatabase } from './support/testDatabase.ts'
import { backfillMemoryFromHistory } from '../src/main/jobs/eveningConsolidation.ts'

function createDb(): Database.Database {
  return createProductionTestDatabase()
}

function localDateOffset(offsetDays: number): { date: string; start: number } {
  const today = new Date()
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays, 9, 0, 0, 0)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { date, start: d.getTime() }
}

function insertFinalizedBlock(db: Database.Database, id: string, date: string, start: number): void {
  db.prepare(`
    INSERT INTO timeline_blocks (
      id, date, start_time, end_time, block_kind, dominant_category,
      category_distribution_json, switch_count, label_current, label_source,
      label_confidence, evidence_summary_json, is_live, heuristic_version, computed_at
    )
    VALUES (?, ?, ?, ?, 'work', 'development', '{}', 0, 'Terminal work', 'rule', 0.5, '{}', 0, 'test', ?)
  `).run(id, date, start, start + 30 * 60_000, start)
}

function archivedDates(db: Database.Database): string[] {
  return (db.prepare('SELECT date FROM daily_memory_archive ORDER BY date ASC').all() as Array<{ date: string }>)
    .map((row) => row.date)
}

test('backfill walks finalized days through yesterday and skips today', () => {
  const db = createDb()
  const twoDaysAgo = localDateOffset(-2)
  const yesterday = localDateOffset(-1)
  const today = localDateOffset(0)
  insertFinalizedBlock(db, 'blk-a', twoDaysAgo.date, twoDaysAgo.start)
  insertFinalizedBlock(db, 'blk-b', yesterday.date, yesterday.start)
  insertFinalizedBlock(db, 'blk-c', today.date, today.start)

  const result = backfillMemoryFromHistory(db)

  assert.equal(result.ran, true, `backfill should run; got ${JSON.stringify(result)}`)
  assert.equal(result.fromDate, twoDaysAgo.date)
  assert.equal(result.throughDate, yesterday.date)
  const archived = archivedDates(db)
  assert.deepEqual(archived, [twoDaysAgo.date, yesterday.date], `today must not be archived: ${JSON.stringify(archived)}`)
  db.close()
})

test('backfill is idempotent — a second run archives no new days', () => {
  const db = createDb()
  const yesterday = localDateOffset(-1)
  insertFinalizedBlock(db, 'blk-y', yesterday.date, yesterday.start)

  const first = backfillMemoryFromHistory(db)
  assert.equal(first.daysArchived, 1)

  const second = backfillMemoryFromHistory(db)
  assert.equal(second.daysProcessed, 1)
  assert.equal(second.daysArchived, 0, 'already-consolidated day must be skipped on re-run')
  assert.equal(second.daysSkipped, 1)

  // The gate fact is recorded for the renderer to read.
  const fact = db.prepare(`SELECT fact_key FROM user_memory_facts WHERE fact_key = 'memory_backfilled_at'`).get()
  assert.ok(fact, 'memory_backfilled_at fact should be recorded')
  db.close()
})

test('backfill reports no-history when only today has blocks', () => {
  const db = createDb()
  const today = localDateOffset(0)
  insertFinalizedBlock(db, 'blk-today', today.date, today.start)

  const result = backfillMemoryFromHistory(db)
  assert.equal(result.ran, false)
  assert.equal(result.reason, 'no-history')
  db.close()
})
