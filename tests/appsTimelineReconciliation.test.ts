// DEV-170: Apps totals reconcile exactly with Timeline. The Apps day view
// reads the same trusted-block partition the Timeline payload totals, so the
// same date and filters produce exactly the same total; week and month
// ranges equal the union of their corrected daily intervals; and browser
// page credit never exceeds the browser's own foreground total.
import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { getTimelineDayPayload } from '../src/main/services/workBlocks.ts'
import { getAppSummariesForTimelineDay } from '../src/main/services/appsFacts.ts'
import {
  getCorrectedAppSummariesForRange,
  getCorrectedWebsiteSummariesForRange,
} from '../src/main/services/activityFacts.ts'

const TEST_DATE = '2026-04-22'

function localMs(hour: number, minute = 0): number {
  return new Date(2026, 3, 22, hour, minute, 0, 0).getTime()
}

function localMsOnDate(dateStr: string, hour: number, minute = 0): number {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function dayBoundsFor(dateStr: string): [number, number] {
  const [year, month, day] = dateStr.split('-').map(Number)
  return [new Date(year, month - 1, day).getTime(), new Date(year, month - 1, day + 1).getTime()]
}

function insertFocusEvent(
  db: Database.Database,
  tsMs: number,
  eventType: string,
  bundleId: string,
  appName: string,
  windowTitle: string | null = null,
): void {
  db.prepare(`
    INSERT INTO focus_events (
      ts_ms, mono_ns, event_type, app_bundle_id, app_name, pid,
      window_title, url, page_title, source, confidence, platform, schema_ver
    ) VALUES (?, ?, ?, ?, ?, 4242, ?, NULL, NULL, 'foreground_poll', 'observed', 'darwin', 2)
  `).run(tsMs, tsMs * 1_000_000, eventType, bundleId, appName, windowTitle)
}

function seedCanonicalStretch(
  db: Database.Database,
  bundleId: string,
  appName: string,
  startMs: number,
  endMs: number,
  windowTitle = 'Work',
): void {
  insertFocusEvent(db, startMs, 'app_activated', bundleId, appName, windowTitle)
  insertFocusEvent(db, endMs, 'app_deactivated', bundleId, appName, windowTitle)
}

function insertLegacySession(
  db: Database.Database,
  bundleId: string,
  appName: string,
  startMs: number,
  endMs: number,
  category = 'development',
): void {
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, canonical_app_id, capture_source, capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 'Work', ?, ?, 'test', 1)
  `).run(bundleId, appName, startMs, endMs, Math.round((endMs - startMs) / 1000), category, appName, bundleId.toLowerCase())
}

function totalOf(summaries: ReadonlyArray<{ totalSeconds: number }>): number {
  return summaries.reduce((sum, row) => sum + row.totalSeconds, 0)
}

test('Apps day totals equal the Timeline payload total exactly on a canonical day', () => {
  const db = createProductionTestDatabase()
  seedCanonicalStretch(db, 'com.mitchellh.ghostty', 'Ghostty', localMs(9), localMs(10, 45))
  seedCanonicalStretch(db, 'com.apple.Safari', 'Safari', localMs(11), localMs(11, 40))
  seedCanonicalStretch(db, 'com.tinyspeck.slackmacgap', 'Slack', localMs(14), localMs(14, 25))

  const payload = getTimelineDayPayload(db, TEST_DATE, null, { materialize: false })
  const apps = getAppSummariesForTimelineDay(db, TEST_DATE, null)
  assert.ok(payload.totalSeconds > 0)
  assert.equal(totalOf(apps), payload.totalSeconds)
  db.close()
})

test('Apps day totals equal the Timeline payload total exactly on a legacy day', () => {
  const db = createProductionTestDatabase()
  insertLegacySession(db, 'com.mitchellh.ghostty', 'Ghostty', localMs(9), localMs(10))
  insertLegacySession(db, 'com.apple.Safari', 'Safari', localMs(10, 30), localMs(11), 'browsing')

  const payload = getTimelineDayPayload(db, TEST_DATE, null, { materialize: false })
  const apps = getAppSummariesForTimelineDay(db, TEST_DATE, null)
  assert.ok(payload.totalSeconds > 0)
  assert.equal(totalOf(apps), payload.totalSeconds)
  db.close()
})

test('a deleted Timeline block changes Apps and Timeline identically', () => {
  const db = createProductionTestDatabase()
  seedCanonicalStretch(db, 'com.mitchellh.ghostty', 'Ghostty', localMs(9), localMs(10, 45))
  seedCanonicalStretch(db, 'com.apple.Safari', 'Safari', localMs(11), localMs(11, 40))

  const before = getAppSummariesForTimelineDay(db, TEST_DATE, null)
  const now = Date.now()
  db.prepare(`
    INSERT INTO timeline_block_reviews (
      id, block_id, date, evidence_key, review_state, original_block_json,
      correction_json, created_at, updated_at
    ) VALUES ('review_apps_recon', 'apps_recon_block', ?, 'apps_recon_block', 'ignored', ?, '{}', ?, ?)
  `).run(TEST_DATE, JSON.stringify({ startTime: localMs(11), endTime: localMs(11, 40) }), now, now)

  const payload = getTimelineDayPayload(db, TEST_DATE, null, { materialize: false })
  const after = getAppSummariesForTimelineDay(db, TEST_DATE, null)
  assert.equal(totalOf(after), payload.totalSeconds)
  assert.ok(totalOf(after) < totalOf(before))
  assert.ok(!after.some((row) => row.appName === 'Safari'), 'the deleted stretch owns no Apps time')
  db.close()
})

test('week totals equal the union of their corrected daily intervals', () => {
  const db = createProductionTestDatabase()
  const dates = ['2026-04-20', '2026-04-21', '2026-04-22']
  for (const date of dates) {
    seedCanonicalStretch(db, 'com.mitchellh.ghostty', 'Ghostty', localMsOnDate(date, 9), localMsOnDate(date, 10))
  }
  const [rangeFrom] = dayBoundsFor('2026-04-16')
  const [, rangeTo] = dayBoundsFor('2026-04-22')
  const week = getCorrectedAppSummariesForRange(db, rangeFrom, rangeTo)
  const perDaySum = dates.reduce((sum, date) => {
    const [from, to] = dayBoundsFor(date)
    return sum + totalOf(getCorrectedAppSummariesForRange(db, from, to))
  }, 0)
  assert.equal(totalOf(week), perDaySum)
  assert.equal(totalOf(week), 3 * 3600)
  db.close()
})

test('page totals never exceed the browser total for the same range', () => {
  const db = createProductionTestDatabase()
  // Canonical browser foreground: 30 minutes. History claims 3 hours.
  seedCanonicalStretch(db, 'com.apple.Safari', 'Safari', localMs(9), localMs(9, 30), null)
  db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, normalized_url, visit_time, visit_time_us, duration_sec,
      browser_bundle_id, canonical_browser_id, source
    ) VALUES ('github.com', 'GitHub', 'https://github.com/', 'https://github.com/', ?, ?, ?, 'com.apple.Safari', 'safari', 'history')
  `).run(localMs(9), localMs(9) * 1000, 3 * 3600)

  const [from, to] = dayBoundsFor(TEST_DATE)
  const apps = getCorrectedAppSummariesForRange(db, from, to)
  const browserSeconds = apps
    .filter((row) => row.category === 'browsing')
    .reduce((sum, row) => sum + row.totalSeconds, 0)
  const websites = getCorrectedWebsiteSummariesForRange(db, from, to)
  const pageSeconds = totalOf(websites)
  assert.ok(browserSeconds > 0)
  assert.ok(
    pageSeconds <= browserSeconds,
    `page credit ${pageSeconds}s must not exceed browser foreground ${browserSeconds}s`,
  )
  db.close()
})
