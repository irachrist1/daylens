// DEV-169: live and historical Timeline day reads go through the shared
// corrected activity-fact query. The renderer projection and the direct
// payload must be the same facts — identical tracked seconds, blocks, and
// gaps — whether the day's evidence is canonical focus_events, legacy
// app_sessions, or both.
import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { getTimelineDayPayload } from '../src/main/services/workBlocks.ts'
import { getTimelineDayProjection, getHistoryDayProjection } from '../src/main/core/query/projections.ts'
import { queryCorrectedActivityFactsForRange, LIVE_SESSION_SENTINEL_ID } from '../src/main/core/query/activityFactsQuery.ts'
import { projectDay } from '../src/main/core/projections/chunk2.ts'
import { localDateString, localDayBounds } from '../src/main/lib/localDate.ts'

const TEST_DATE = '2026-04-22'

function localMs(hour: number, minute = 0): number {
  return new Date(2026, 3, 22, hour, minute, 0, 0).getTime()
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

function seedCanonicalMorning(db: Database.Database): void {
  insertFocusEvent(db, localMs(9), 'app_activated', 'com.mitchellh.ghostty', 'Ghostty', 'Editor')
  insertFocusEvent(db, localMs(9, 45), 'app_deactivated', 'com.mitchellh.ghostty', 'Ghostty')
  insertFocusEvent(db, localMs(10), 'app_activated', 'com.apple.Safari', 'Safari', 'Docs')
  insertFocusEvent(db, localMs(10, 30), 'app_deactivated', 'com.apple.Safari', 'Safari')
}

function comparablePayload(payload: ReturnType<typeof getTimelineDayPayload>) {
  return {
    totalSeconds: payload.totalSeconds,
    focusSeconds: payload.focusSeconds,
    sessions: payload.sessions.map((s) => [s.bundleId, s.startTime, s.endTime, s.durationSeconds]),
    blocks: payload.blocks.map((b) => [b.id, b.startTime, b.endTime]),
    segments: payload.segments.map((s) => [s.kind, s.startTime, s.endTime]),
  }
}

test('renderer projection and direct payload are identical facts on a canonical day', () => {
  const db = createProductionTestDatabase()
  seedCanonicalMorning(db)
  const projection = getTimelineDayProjection(db, TEST_DATE, null, { materialize: false })
  const payload = getTimelineDayPayload(db, TEST_DATE, null, { materialize: false })
  const history = getHistoryDayProjection(db, TEST_DATE, null, { materialize: false })
  assert.deepEqual(comparablePayload(projection), comparablePayload(payload))
  assert.deepEqual(comparablePayload(history), comparablePayload(payload))
  assert.equal(payload.totalSeconds, 45 * 60 + 30 * 60)
  db.close()
})

test('renderer projection and direct payload are identical facts on a legacy day', () => {
  const db = createProductionTestDatabase()
  insertLegacySession(db, 'com.mitchellh.ghostty', 'Ghostty', localMs(9), localMs(10))
  const projection = getTimelineDayProjection(db, TEST_DATE, null, { materialize: false })
  const payload = getTimelineDayPayload(db, TEST_DATE, null, { materialize: false })
  assert.deepEqual(comparablePayload(projection), comparablePayload(payload))
  assert.equal(payload.totalSeconds, 3600)
  db.close()
})

test('a mixed day reads canonical evidence, not the disagreeing legacy rows', () => {
  const db = createProductionTestDatabase()
  seedCanonicalMorning(db)
  // Legacy rows claim a much longer day — the July divergence shape.
  insertLegacySession(db, 'com.mitchellh.ghostty', 'Ghostty', localMs(9), localMs(13))
  const payload = getTimelineDayPayload(db, TEST_DATE, null, { materialize: false })
  const projection = getTimelineDayProjection(db, TEST_DATE, null, { materialize: false })
  assert.deepEqual(comparablePayload(projection), comparablePayload(payload))
  assert.equal(payload.totalSeconds, 45 * 60 + 30 * 60)
  db.close()
})

test('a past canonical day never marks a block live', () => {
  const db = createProductionTestDatabase()
  seedCanonicalMorning(db)
  const payload = getTimelineDayPayload(db, TEST_DATE, null, { materialize: false })
  assert.ok(payload.blocks.length > 0)
  assert.ok(payload.blocks.every((block) => !block.isLive))
  assert.ok(payload.sessions.every((session) => session.id !== LIVE_SESSION_SENTINEL_ID))
  db.close()
})

test('focused duration never exceeds tracked duration in the payload', () => {
  const db = createProductionTestDatabase()
  seedCanonicalMorning(db)
  const payload = getTimelineDayPayload(db, TEST_DATE, null, { materialize: false })
  assert.ok(payload.focusSeconds <= payload.totalSeconds)
  db.close()
})

test('an ignored-span correction survives reprojection through the payload path', () => {
  const db = createProductionTestDatabase()
  seedCanonicalMorning(db)
  const now = Date.now()
  db.prepare(`
    INSERT INTO timeline_block_reviews (
      id, block_id, date, evidence_key, review_state, original_block_json,
      correction_json, created_at, updated_at
    ) VALUES ('review_shared_facts', 'shared_facts_block', ?, 'shared_facts_block', 'ignored', ?, '{}', ?, ?)
  `).run(TEST_DATE, JSON.stringify({ startTime: localMs(10), endTime: localMs(10, 30) }), now, now)

  const corrected = getTimelineDayPayload(db, TEST_DATE, null, { materialize: false })
  assert.equal(corrected.totalSeconds, 45 * 60)

  projectDay(db, TEST_DATE, { finalize: true, now: new Date(localMs(23)) })
  const rebuilt = getTimelineDayPayload(db, TEST_DATE, null, { materialize: false })
  assert.equal(rebuilt.totalSeconds, corrected.totalSeconds)
  db.close()
})

test('a correction splitting the trailing open session leaves exactly one live session', () => {
  const db = createProductionTestDatabase()
  const today = localDateString()
  const [dayStart, dayEnd] = localDayBounds(today)
  const now = Date.now()
  const elapsed = Math.max(120_000, now - dayStart - 1000)
  const base = now - elapsed
  insertFocusEvent(db, base, 'app_activated', 'com.apple.Safari', 'Safari', 'Docs')
  // No deactivation: Safari is still the open, in-progress session.

  // Delete a stretch in the middle of the open session — the overlay splits
  // it into a piece before the span and a piece after, and only the piece
  // still reaching “now” may carry the live sentinel.
  const spanStart = base + Math.floor(elapsed / 3)
  const spanEnd = base + Math.floor(elapsed / 2)
  const writtenAt = Date.now()
  db.prepare(`
    INSERT INTO timeline_block_reviews (
      id, block_id, date, evidence_key, review_state, original_block_json,
      correction_json, created_at, updated_at
    ) VALUES ('review_live_split', 'live_split_block', ?, 'live_split_block', 'ignored', ?, '{}', ?, ?)
  `).run(today, JSON.stringify({ startTime: spanStart, endTime: spanEnd }), writtenAt, writtenAt)

  const facts = queryCorrectedActivityFactsForRange(db, dayStart, dayEnd, {
    markTrailingOpenSessionLive: true,
  })
  const liveSessions = facts.sessions.filter((s) => s.id === LIVE_SESSION_SENTINEL_ID)
  assert.equal(liveSessions.length, 1, 'exactly one session carries the live sentinel')
  assert.ok(liveSessions[0].startTime >= spanEnd, 'the live piece is the one after the deleted span')

  const payload = getTimelineDayPayload(db, today, null, { materialize: false })
  assert.equal(payload.blocks.filter((block) => block.isLive).length, 1)
  db.close()
})

test('the live day marks the trailing open canonical session with the live sentinel', () => {
  const db = createProductionTestDatabase()
  const today = localDateString()
  const [dayStart, dayEnd] = localDayBounds(today)
  const now = Date.now()
  // Clock-stable seeding: fit the fixture inside however much of today has
  // actually elapsed, so a run just after midnight still stays inside today.
  const elapsed = Math.max(60_000, now - dayStart - 1000)
  const base = now - elapsed
  const switchAt = base + Math.floor(elapsed / 2)
  insertFocusEvent(db, base, 'app_activated', 'com.mitchellh.ghostty', 'Ghostty', 'Editor')
  insertFocusEvent(db, switchAt, 'app_deactivated', 'com.mitchellh.ghostty', 'Ghostty')
  insertFocusEvent(db, switchAt, 'app_activated', 'com.apple.Safari', 'Safari', 'Docs')
  // No deactivation: Safari is still the open, in-progress session.

  const facts = queryCorrectedActivityFactsForRange(db, dayStart, dayEnd, {
    markTrailingOpenSessionLive: true,
  })
  const trailing = facts.sessions[facts.sessions.length - 1]
  assert.equal(trailing.id, LIVE_SESSION_SENTINEL_ID)
  assert.ok(trailing.endTime !== null && trailing.endTime <= Date.now() + 1000)

  const payload = getTimelineDayPayload(db, today, null, { materialize: false })
  const liveBlocks = payload.blocks.filter((block) => block.isLive)
  assert.equal(liveBlocks.length, 1, 'exactly one block is live on the live day')
  assert.equal(liveBlocks[0].label.current, 'Active now')

  // Live block identity is stable while the same sitting continues.
  const again = getTimelineDayPayload(db, today, null, { materialize: false })
  const liveAgain = again.blocks.filter((block) => block.isLive)
  assert.equal(liveAgain.length, 1)
  assert.equal(liveAgain[0].id, liveBlocks[0].id)
  db.close()
})
