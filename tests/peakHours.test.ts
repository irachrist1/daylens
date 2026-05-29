// Regression guard for getPeakHours after F46 collapsed its two full-table
// scans (distinct-day pass + getHourlyBreakdown) into a single grouped query.
// Verifies the distinct-day gate, the 2-hour window selection by focus pct,
// and that UX-noise sessions are excluded from both the gate and the buckets.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema'
import { getPeakHours } from '../src/main/db/queries'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  return db
}

function localMs(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month, day, hour, minute, 0, 0).getTime()
}

function insertSession(
  db: Database.Database,
  args: { appName: string; bundleId: string; start: number; end: number; category: string },
): void {
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec, category,
      is_focused, window_title, raw_app_name, canonical_app_id, app_instance_id,
      capture_source, capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'test', 1)
  `).run(
    args.bundleId,
    args.appName,
    args.start,
    args.end,
    Math.max(1, Math.round((args.end - args.start) / 1000)),
    args.category,
    args.appName,
    args.appName,
    null,
    args.bundleId,
  )
}

test('getPeakHours returns null when fewer than 3 distinct days have data', () => {
  const db = freshDb()
  // Two days only.
  insertSession(db, { appName: 'Cursor', bundleId: 'dev', start: localMs(2026, 4, 1, 9), end: localMs(2026, 4, 1, 11), category: 'development' })
  insertSession(db, { appName: 'Cursor', bundleId: 'dev', start: localMs(2026, 4, 2, 9), end: localMs(2026, 4, 2, 11), category: 'development' })
  const from = localMs(2026, 4, 1, 0)
  const to = localMs(2026, 4, 8, 0)
  assert.equal(getPeakHours(db, from, to), null)
  db.close()
})

test('getPeakHours picks the 2-hour window with the highest focus percentage', () => {
  const db = freshDb()
  // Three days, each with focused dev work in BOTH hour 9 and hour 10 (two
  // 1-hour sessions, since hourly buckets key on the session start hour) and a
  // distracting block at 14:00 (social, not focused). The 09–11 window is the
  // only one fully covering two focused hours, so it wins uniquely on focus
  // seconds among the 100%-focus windows.
  for (let day = 1; day <= 3; day++) {
    insertSession(db, { appName: 'Cursor', bundleId: 'dev', start: localMs(2026, 4, day, 9), end: localMs(2026, 4, day, 10), category: 'development' })
    insertSession(db, { appName: 'Cursor', bundleId: 'dev', start: localMs(2026, 4, day, 10), end: localMs(2026, 4, day, 11), category: 'development' })
    insertSession(db, { appName: 'Slack', bundleId: 'social', start: localMs(2026, 4, day, 14), end: localMs(2026, 4, day, 16), category: 'social' })
  }
  const from = localMs(2026, 4, 1, 0)
  const to = localMs(2026, 4, 8, 0)
  const peak = getPeakHours(db, from, to)
  assert.ok(peak, 'expected a peak window across 3 days of data')
  assert.equal(peak.peakStart, 9, 'peak should start at 09:00 where focus time concentrates')
  assert.equal(peak.peakEnd, 11)
  assert.equal(peak.focusPct, 100, 'the 09–11 window is entirely focused work')
  db.close()
})

test('getPeakHours excludes UX-noise apps from the distinct-day gate', () => {
  const db = freshDb()
  // Three days, but only noise sessions ("Daylens" itself) — should not count.
  for (let day = 1; day <= 3; day++) {
    insertSession(db, { appName: 'Daylens', bundleId: 'self', start: localMs(2026, 4, day, 9), end: localMs(2026, 4, day, 11), category: 'development' })
  }
  const from = localMs(2026, 4, 1, 0)
  const to = localMs(2026, 4, 8, 0)
  assert.equal(getPeakHours(db, from, to), null, 'noise-only days must not satisfy the 3-day gate')
  db.close()
})
