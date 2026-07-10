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

// ─── Tombstone + toggle gating (Gap 2, Gap 4) ─────────────────────────────────

import { collectExternalSignals, deleteExternalSignal, type CollectExternalSignalsDeps } from '../src/main/services/externalSignals.ts'
import type { CalendarSignal, FocusAppSignal } from '../src/shared/types.ts'

function baseDeps(db: Database.Database, over: Partial<CollectExternalSignalsDeps> = {}): CollectExternalSignalsDeps {
  return {
    db,
    collectGit: async () => null,
    collectCalendar: async () => null,
    collectFocus: async () => null,
    enrichmentSources: {},
    ...over,
  }
}

test('deleteExternalSignal tombstones a stored row', () => {
  const db = makeDb()
  putExternalSignal(db, '2026-07-07', 'git', GIT_SIGNAL)
  deleteExternalSignal(db, '2026-07-07', 'git')
  assert.equal(getExternalSignal(db, '2026-07-07', 'git'), null)
  db.close()
})

test('a forced refresh whose connector now returns empty tombstones the stale row', async () => {
  const db = makeDb()
  putExternalSignal(db, '2026-07-07', 'git', GIT_SIGNAL)
  putExternalSignal(db, '2026-07-07', 'calendar', { events: [{ title: 'Old', startClock: '9am', durationMinutes: 30, attendeeCount: 2 }] } as CalendarSignal)
  // The connectors now find nothing on a forced re-check.
  await collectExternalSignals('2026-07-07', { force: true, deps: baseDeps(db) })
  assert.equal(getExternalSignal(db, '2026-07-07', 'git'), null, 'stale git must not keep serving')
  assert.equal(getExternalSignal(db, '2026-07-07', 'calendar'), null, 'stale meetings must not keep serving')
  db.close()
})

test('focus collection honors the per-app enrichment toggle', async () => {
  const db = makeDb()
  const focus: FocusAppSignal[] = [{ app: 'Session', sessions: [{ startClock: '9am', durationMinutes: 50, label: null }] }]

  // Toggle OFF: nothing stored.
  await collectExternalSignals('2026-07-07', { force: true, deps: baseDeps(db, { collectFocus: async () => focus, enrichmentSources: { 'focus:Session': false } }) })
  assert.equal(getExternalSignal(db, '2026-07-07', 'focus_app'), null, 'a disabled focus app is not collected')

  // Toggle ON: stored.
  const fired = await collectExternalSignals('2026-07-07', { force: true, deps: baseDeps(db, { collectFocus: async () => focus, enrichmentSources: { 'focus:Session': true } }) })
  assert.ok(fired.includes('focus_app'))
  const stored = getExternalSignal<FocusAppSignal[]>(db, '2026-07-07', 'focus_app')
  assert.ok(stored)
  assert.equal(stored!.payload[0].app, 'Session')
  db.close()
})

test('a non-empty git connector stores and reports it fired', async () => {
  const db = makeDb()
  const fired = await collectExternalSignals('2026-07-07', { force: true, deps: baseDeps(db, { collectGit: async () => GIT_SIGNAL }) })
  assert.ok(fired.includes('git'))
  assert.equal(getExternalSignal<GitActivitySignal>(db, '2026-07-07', 'git')!.payload.totalCommits, 3)
  db.close()
})

test('a NON-forced empty run preserves the prior row (a transient miss never deletes)', async () => {
  const db = makeDb()
  // Today, with a STALE row (captured 40m ago) so the connector actually re-runs
  // on a non-forced pass. It returns empty, but without force we must NOT delete
  // — an empty background result could just be a transient timeout.
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  db.prepare('INSERT INTO external_signals (date, source, payload_json, captured_at) VALUES (?, ?, ?, ?)')
    .run(todayStr, 'git', JSON.stringify(GIT_SIGNAL), Date.now() - 40 * 60_000)
  await collectExternalSignals(todayStr, { deps: baseDeps(db) })
  assert.ok(getExternalSignal(db, todayStr, 'git'), 'a non-forced empty run must keep the prior row')

  // But a FORCED empty refresh does replace truth (tombstones it).
  await collectExternalSignals(todayStr, { force: true, deps: baseDeps(db) })
  assert.equal(getExternalSignal(db, todayStr, 'git'), null, 'a forced empty refresh tombstones the row')
  db.close()
})
