import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { getStoredWrappedNarrative, putStoredWrappedNarrative } from '../src/main/db/wrappedNarrativeStore.ts'

// Mirrors migration v40 so the store can be exercised without the full migrator.
function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE wrapped_narratives (
    cadence TEXT NOT NULL, period_key TEXT NOT NULL, facts_hash TEXT NOT NULL,
    narrative_json TEXT NOT NULL, generated_at INTEGER NOT NULL,
    PRIMARY KEY (cadence, period_key)
  );`)
  return db
}

type Wrap = { lead: string; source: string }

test('a stored wrap is returned as-is with its real generated-at time', () => {
  const db = freshDb()
  const wrap: Wrap = { lead: 'A full day building Daylens.', source: 'ai' }
  putStoredWrappedNarrative(db, 'day', '2026-06-25', wrap, 'hash-1', 1_700_000_000_000)

  const stored = getStoredWrappedNarrative<Wrap>(db, 'day', '2026-06-25')
  assert.ok(stored)
  assert.deepEqual(stored!.narrative, wrap)
  assert.equal(stored!.factsHash, 'hash-1')
  assert.equal(stored!.generatedAt, 1_700_000_000_000)
  db.close()
})

test('a missing wrap returns null (so the day is generated, not assumed)', () => {
  const db = freshDb()
  assert.equal(getStoredWrappedNarrative<Wrap>(db, 'day', '2026-06-25'), null)
  assert.equal(getStoredWrappedNarrative<Wrap>(db, 'week', '2026-06-22'), null)
  db.close()
})

test('regenerate overwrites the stored wrap and its timestamp, never duplicates', () => {
  const db = freshDb()
  putStoredWrappedNarrative(db, 'day', '2026-06-25', { lead: 'first', source: 'ai' }, 'h1', 1000)
  putStoredWrappedNarrative(db, 'day', '2026-06-25', { lead: 'second', source: 'ai' }, 'h2', 2000)

  const stored = getStoredWrappedNarrative<Wrap>(db, 'day', '2026-06-25')
  assert.equal(stored!.narrative.lead, 'second')
  assert.equal(stored!.generatedAt, 2000)
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM wrapped_narratives`).get() as { n: number }).n
  assert.equal(count, 1, 'one row per cadence+period, never a duplicate')
  db.close()
})
