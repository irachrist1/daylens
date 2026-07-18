import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import {
  clearTestDb,
  setTestDb,
} from './support/database-stub.mjs'
import {
  deleteHistoryForApp,
  deleteHistoryForSite,
  deleteTrackedActivity,
} from '../src/main/services/trackingHistory.ts'
import { projectDay } from '../src/main/core/projections/chunk2.ts'
import { materializeTimelineDayProjection } from '../src/main/core/query/projections.ts'

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
      'https://private.example.com/plan', 'Private plan', 'apple_events_tab', 'observed', 'darwin', 2)
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
  const db = createProductionTestDatabase()
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
  const db = createProductionTestDatabase()
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

test('excluding a site removes its legacy browser title before projections rebuild', () => {
  const db = createProductionTestDatabase()
  const pageTitle = 'Legacy forum thread'
  const windowTitle = `${pageTitle} — Zen`
  const date = '2026-06-19'
  const start = new Date(2026, 5, 19, 10, 0, 0, 0).getTime()
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec, category,
      is_focused, window_title, raw_app_name, capture_source, capture_version
    ) VALUES ('app.zen-browser.zen', 'Zen', ?, ?, 1200, 'browsing', 0, ?, 'Zen', 'test', 2)
  `).run(start, start + 20 * 60_000, windowTitle)
  const insertFocusEvent = db.prepare(`
    INSERT INTO focus_events (
      ts_ms, mono_ns, event_type, app_bundle_id, app_name, pid,
      window_title, url, page_title, source, confidence, platform, schema_ver
    ) VALUES (
      @tsMs, @monoNs, @eventType, 'app.zen-browser.zen', 'Zen', 42,
      @windowTitle, @url, @pageTitle, @source, 'observed', 'darwin', 2
    )
  `)
  insertFocusEvent.run({
    tsMs: start,
    monoNs: start,
    eventType: 'app_activated',
    windowTitle,
    url: null,
    pageTitle: null,
    source: 'nsworkspace_event',
  })
  insertFocusEvent.run({
    tsMs: start + 10_000,
    monoNs: start + 10_000,
    eventType: 'tab_changed',
    windowTitle,
    url: 'https://old-forum.example/thread/1',
    pageTitle,
    source: 'apple_events_tab',
  })
  insertFocusEvent.run({
    tsMs: start + 20_000,
    monoNs: start + 20_000,
    eventType: 'window_changed',
    windowTitle,
    url: null,
    pageTitle: null,
    source: 'nsworkspace_event',
  })
  insertFocusEvent.run({
    tsMs: start + 20 * 60_000,
    monoNs: start + 20 * 60_000,
    eventType: 'app_deactivated',
    windowTitle: null,
    url: null,
    pageTitle: null,
    source: 'nsworkspace_event',
  })
  db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, normalized_url, page_key,
      visit_time, visit_time_us, duration_sec, browser_bundle_id,
      canonical_browser_id, browser_profile_id, source
    ) VALUES (
      'old-forum.example', ?, 'https://old-forum.example/thread/1',
      'https://old-forum.example/thread/1', 'old-forum.example/thread/1',
      ?, ?, 1190, 'app.zen-browser.zen:default', 'zen', 'default', 'test'
    )
  `).run(pageTitle, start + 10_000, BigInt(start + 10_000) * 1_000n)
  setTestDb(db)

  try {
    projectDay(db, date, { finalize: true })
    materializeTimelineDayProjection(db, date, null)
    assert.equal((db.prepare(`
      SELECT COUNT(*) AS count FROM derived_blocks WHERE label = ?
    `).get(pageTitle) as { count: number }).count, 1)

    const result = deleteHistoryForSite({ domain: 'old-forum.example' })
    assert.ok(result.deletedRows >= 4)

    const evidenceAndDerivedTables = [
      'app_sessions',
      'focus_events',
      'website_visits',
      'activity_segments',
      'derived_sessions',
      'derived_blocks',
      'timeline_blocks',
    ]
    for (const residueTitle of [pageTitle, windowTitle]) {
      for (const table of evidenceAndDerivedTables) {
        const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; type: string }>
        for (const column of columns.filter((entry) => !/INT|REAL|BLOB/i.test(entry.type ?? ''))) {
          const residue = db.prepare(`
            SELECT COUNT(*) AS count FROM "${table}"
            WHERE instr(lower(CAST("${column.name}" AS TEXT)), lower(?)) > 0
          `).get(residueTitle) as { count: number }
          assert.equal(residue.count, 0, `${residueTitle} remained in ${table}.${column.name}`)
        }
      }
    }

    projectDay(db, date, { finalize: true })
    const rebuilt = materializeTimelineDayProjection(db, date, null)
    assert.equal(JSON.stringify(rebuilt).includes(pageTitle), false)
    assert.equal(JSON.stringify(rebuilt).includes(windowTitle), false)
    assert.equal((db.prepare(`
      SELECT COUNT(*) AS count FROM derived_blocks WHERE label = ?
    `).get(pageTitle) as { count: number }).count, 0)
    assert.equal((db.prepare(`
      SELECT COUNT(*) AS count FROM timeline_blocks
      WHERE label_current = ? OR evidence_summary_json LIKE ?
    `).get(pageTitle, `%${pageTitle}%`) as { count: number }).count, 0)
  } finally {
    clearTestDb()
    db.close()
  }
})

test('deleting a page removes every visit and clears generated recaps', () => {
  const db = createProductionTestDatabase()
  seed(db)
  const later = new Date(2026, 5, 20, 12, 0, 0, 0).getTime()
  db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, normalized_url, page_key,
      visit_time, visit_time_us, duration_sec, browser_bundle_id,
      canonical_browser_id, browser_profile_id, source
    ) VALUES ('private.example.com', 'Private plan', 'https://private.example.com/plan',
      'https://private.example.com/plan', 'private.example.com/plan',
      ?, ?, 300, 'app.zen-browser.zen', 'app.zen-browser.zen', 'default', 'test')
  `).run(later, BigInt(later) * 1_000n)
  db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, normalized_url, page_key,
      visit_time, visit_time_us, duration_sec, browser_bundle_id,
      canonical_browser_id, browser_profile_id, source
    ) VALUES ('private.example.com', 'Private plan', 'https://private.example.com/plan?utm_source=email',
      'https://private.example.com/plan', 'private.example.com/plan',
      ?, ?, 120, 'app.zen-browser.zen', 'app.zen-browser.zen', 'default', 'test')
  `).run(later + 1_000, BigInt(later + 1_000) * 1_000n)
  db.prepare(`
    INSERT INTO focus_events (
      ts_ms, mono_ns, event_type, app_bundle_id, app_name, pid,
      window_title, url, page_title, source, confidence, platform, schema_ver
    ) VALUES (?, 1, 'tab_changed', 'app.zen-browser.zen', 'Zen', 1,
      'Private plan', 'https://private.example.com/plan?utm_source=email',
      'Private plan', 'apple_events_tab', 'observed', 'darwin', 2)
  `).run(later + 1_000)
  db.prepare(`
    INSERT INTO ai_surface_summaries (
      scope_type, scope_key, job_type, title, summary_text, input_signature,
      metadata_json, created_at, updated_at
    ) VALUES ('app_detail', 'app:zen:7d', 'app_narrative', 'Zen', 'Stale recap', 'sig', '{}', ?, ?)
  `).run(later, later)
  setTestDb(db)

  try {
    const result = deleteTrackedActivity({
      url: 'https://private.example.com/plan',
      normalizedUrl: 'https://private.example.com/plan',
      pageKey: 'private.example.com/plan',
    })
    assert.ok(result.deletedRows >= 5)
    assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM website_visits`).get() as { count: number }).count, 0)
    assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM focus_events`).get() as { count: number }).count, 0)
    assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM ai_surface_summaries`).get() as { count: number }).count, 0)
  } finally {
    clearTestDb()
    db.close()
  }
})
