import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import {
  clearTestDb,
  setTestDb,
} from './support/database-stub.mjs'
import {
  deleteHistoryForApp,
  deleteHistoryForSite,
} from '../src/main/services/trackingHistory.ts'

function ensureFocusEventsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS focus_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts_ms INTEGER NOT NULL,
      mono_ns INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      app_bundle_id TEXT,
      app_name TEXT,
      pid INTEGER,
      window_title TEXT,
      url TEXT,
      page_title TEXT,
      source TEXT NOT NULL,
      confidence TEXT NOT NULL,
      platform TEXT,
      schema_ver INTEGER
    );
  `)
}

function seed(db: Database.Database): void {
  const start = new Date(2026, 5, 18, 10, 0, 0, 0).getTime()
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec, category,
      is_focused, window_title, raw_app_name, capture_source, capture_version
    ) VALUES ('app.zen-browser.zen', 'Zen', ?, ?, 1200, 'browsing', 0, 'Private work', 'Zen', 'test', 2)
  `).run(start, start + 20 * 60_000)
  db.prepare(`
    INSERT INTO focus_events (
      ts_ms, mono_ns, event_type, app_bundle_id, app_name, pid,
      window_title, url, page_title, source, confidence, platform, schema_ver
    ) VALUES (?, ?, 'tab_changed', 'app.zen-browser.zen', 'Zen', 42, 'Private work',
      'https://private.example.com/plan', 'Private plan', 'apple_events_tab', 'observed', 'darwin', 1)
  `).run(start, start)
  db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, normalized_url, page_key,
      visit_time, visit_time_us, duration_sec, browser_bundle_id,
      canonical_browser_id, browser_profile_id, source
    ) VALUES ('private.example.com', 'Private plan', 'https://private.example.com/plan',
      'https://private.example.com/plan', 'https://private.example.com/plan',
      ?, ?, 1200, 'app.zen-browser.zen:default', 'app.zen-browser.zen', 'default', 'test')
  `).run(start, BigInt(start) * 1_000n)
}

test('excluding an app removes its app, browser, and native-focus history', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  ensureFocusEventsTable(db)
  seed(db)
  setTestDb(db)

  try {
    const result = deleteHistoryForApp({ bundleId: 'app.zen-browser.zen', appName: 'Zen' })
    assert.ok(result.deletedRows >= 3)
    assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM app_sessions`).get() as { count: number }).count, 0)
    assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM website_visits`).get() as { count: number }).count, 0)
    assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM focus_events`).get() as { count: number }).count, 0)
  } finally {
    clearTestDb()
    db.close()
  }
})

test('excluding a site removes old URL evidence from history and projections', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  ensureFocusEventsTable(db)
  seed(db)
  setTestDb(db)

  try {
    const result = deleteHistoryForSite({ domain: 'example.com' })
    assert.ok(result.deletedRows >= 2)
    assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM website_visits`).get() as { count: number }).count, 0)
    assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM focus_events`).get() as { count: number }).count, 0)
    assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM app_sessions`).get() as { count: number }).count, 1)
  } finally {
    clearTestDb()
    db.close()
  }
})
