import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { getExternalSignal, putExternalSignal } from '../src/main/services/externalSignals.ts'
import type { GitActivitySignal } from '../src/shared/types.ts'

// external_signals store (Stage 0.2): one row per date+source, replaced on
// refresh, read back typed; a pre-migration DB reads as "no signal".

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE external_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL, source TEXT NOT NULL,
      payload_json TEXT NOT NULL, captured_at INTEGER NOT NULL,
      UNIQUE(date, source)
    );
  `)
  return db
}

const GIT_SIGNAL: GitActivitySignal = {
  repos: [{ repo: 'daylens', commitCount: 3, messages: ['fix: a', 'feat: b'], firstCommitClock: '9:12am', lastCommitClock: '4:30pm' }],
  totalCommits: 3,
  prs: [],
}

test('put/get round-trips a typed payload per date+source', () => {
  const db = makeDb()
  putExternalSignal(db, '2026-07-07', 'git', GIT_SIGNAL)
  const stored = getExternalSignal<GitActivitySignal>(db, '2026-07-07', 'git')
  assert.ok(stored)
  assert.equal(stored!.payload.totalCommits, 3)
  assert.equal(stored!.payload.repos[0].repo, 'daylens')
  assert.equal(getExternalSignal(db, '2026-07-07', 'calendar'), null)
  assert.equal(getExternalSignal(db, '2026-07-06', 'git'), null)
  db.close()
})

test('a re-run replaces the day\'s row instead of stacking', () => {
  const db = makeDb()
  putExternalSignal(db, '2026-07-07', 'git', GIT_SIGNAL)
  putExternalSignal(db, '2026-07-07', 'git', { ...GIT_SIGNAL, totalCommits: 9 })
  const rows = db.prepare(`SELECT COUNT(*) c FROM external_signals`).get() as { c: number }
  assert.equal(rows.c, 1)
  assert.equal(getExternalSignal<GitActivitySignal>(db, '2026-07-07', 'git')!.payload.totalCommits, 9)
  db.close()
})

test('a DB without the table reads as no signal, never an error', () => {
  const db = new Database(':memory:')
  assert.equal(getExternalSignal(db, '2026-07-07', 'git'), null)
  db.close()
})
