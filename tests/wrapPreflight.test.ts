import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { getWrapPreflight } from '../src/main/services/wrapPreflight.ts'

// Wrap pre-flight (Stage 0.4): honest, specific warnings before generation.
// None block; the renderer offers a one-tap "Generate anyway".

const DATE = '2026-06-23' // fixed past Tuesday
const DAY_START = new Date(2026, 5, 23, 9, 0, 0, 0).getTime()

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  db.exec(`
    CREATE TABLE IF NOT EXISTS external_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL, source TEXT NOT NULL,
      payload_json TEXT NOT NULL, captured_at INTEGER NOT NULL,
      UNIQUE(date, source)
    );
    CREATE TABLE IF NOT EXISTS wrapped_narratives (
      cadence TEXT NOT NULL, period_key TEXT NOT NULL,
      facts_hash TEXT NOT NULL, narrative_json TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      PRIMARY KEY (cadence, period_key)
    );
  `)
  return db
}

function seedSessions(db: Database.Database, count: number, titledEvery: number, startMs = DAY_START): void {
  const stmt = db.prepare(`
    INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec, category, is_focused, window_title)
    VALUES (?, ?, ?, ?, ?, 'development', 1, ?)
  `)
  for (let i = 0; i < count; i++) {
    const start = startMs + i * 10 * 60_000
    stmt.run('com.test.app', 'TestApp', start, start + 9 * 60_000, 9 * 60, i % titledEvery === 0 ? `Working on thing ${i}` : null)
  }
}

test('a thin, unanalyzed day warns specifically without blocking', () => {
  const db = makeDb()
  seedSessions(db, 4, 1)
  const result = getWrapPreflight(db, DATE)
  assert.ok(result.warnings.some((w) => w.kind === 'lowWork'), 'expected a lowWork warning')
  assert.ok(result.warnings.every((w) => w.message.length > 20), 'warnings must be specific sentences')
  assert.equal(result.hasStoredWrap, false)
  db.close()
})

test('missing window titles above 30% produce a percentage-specific warning', () => {
  const db = makeDb()
  // 20 sessions, titled every 3rd: ~67% missing.
  seedSessions(db, 20, 3)
  const result = getWrapPreflight(db, DATE)
  const warning = result.warnings.find((w) => w.kind === 'missingTitles')
  assert.ok(warning, 'expected a missingTitles warning')
  assert.ok(result.missingTitlePct! > 30)
  assert.ok(warning!.message.includes(`${result.missingTitlePct}%`), `message must name the real number: ${warning!.message}`)
  db.close()
})

test('full titles produce no missingTitles warning', () => {
  const db = makeDb()
  seedSessions(db, 20, 1)
  const result = getWrapPreflight(db, DATE)
  assert.equal(result.warnings.find((w) => w.kind === 'missingTitles'), undefined)
  assert.equal(result.missingTitlePct, 0)
  db.close()
})

test('a stored wrap flips hasStoredWrap so the renderer skips the gate', () => {
  const db = makeDb()
  seedSessions(db, 4, 1)
  db.prepare(`
    INSERT INTO wrapped_narratives (cadence, period_key, facts_hash, narrative_json, generated_at)
    VALUES ('day', ?, 'x', '{}', ?)
  `).run(DATE, Date.now())
  const result = getWrapPreflight(db, DATE)
  assert.equal(result.hasStoredWrap, true)
  db.close()
})

test('staleCapture warns only on the live day', () => {
  const db = makeDb()
  // A past day whose last session ended long ago must NOT warn stale.
  seedSessions(db, 6, 1)
  const past = getWrapPreflight(db, DATE)
  assert.equal(past.warnings.find((w) => w.kind === 'staleCapture'), undefined)

  // The live day with the last session 3 hours ago must warn.
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000
  seedSessions(db, 3, 1, threeHoursAgo - 40 * 60_000)
  const live = getWrapPreflight(db, todayStr)
  const warning = live.warnings.find((w) => w.kind === 'staleCapture')
  assert.ok(warning, 'expected a staleCapture warning on the live day')
  assert.ok(/hours ago/.test(warning!.message))
  db.close()
})

test('an empty day never throws and reports zero work', () => {
  const db = makeDb()
  const result = getWrapPreflight(db, DATE)
  assert.equal(result.workSeconds, 0)
  assert.ok(result.warnings.some((w) => w.kind === 'lowWork'))
  assert.equal(result.missingTitlePct, null)
  db.close()
})
