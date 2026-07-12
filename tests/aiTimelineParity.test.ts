// ai.md invariant 6: "Every number in the AI tab matches the Timeline — they
// read the same blocks and can't disagree." This file proves the harder
// thing — that a number the AI would SAY (time on an app for a day) is the
// SAME number the Timeline shows for that day, computed by an independent path.
//
//   AI side:       executeTool('getDaySummary', ...) → _evidence.topApps
//                   (getAppSummariesForRange)
//   Timeline side: buildTimelineBlocksFromSessions → block.topApps
//
// Two different aggregations over the one store. If they ever drift, this fails.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { ensureSearchSchema } from '../src/main/db/migrations.ts'
import { executeTool } from '../src/main/services/aiTools.ts'
import type { DaySummaryResult } from '../src/main/services/aiTools.ts'
import { buildTimelineBlocksFromSessions } from '../src/main/services/workBlocks.ts'
import { getSessionsForRange } from '../src/main/db/queries.ts'
import { localDayBounds } from '../src/main/lib/localDate.ts'

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  ensureSearchSchema(db)
  return db
}

function localMs(date: Date, hour: number, minute = 0): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0).getTime()
}
function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const CURSOR = 'com.todesktop.230313mzl4w4u92'

// A clean day: two long Cursor stretches plus a Chrome stretch, so the app the
// AI is asked about is one of several and the totals are unambiguous.
function seedDay(db: Database.Database): { date: Date; cursorSeconds: number } {
  const today = new Date()
  const insert = db.prepare(`
    INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, canonical_app_id, app_instance_id,
      capture_source, capture_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', 1)
  `)
  const add = (bundle: string, name: string, sh: number, sm: number, eh: number, em: number, cat: string, title: string) => {
    const s = localMs(today, sh, sm), e = localMs(today, eh, em)
    insert.run(bundle, name, s, e, Math.round((e - s) / 1000), cat, cat === 'development' ? 1 : 0, title, name, name.toLowerCase(), bundle)
  }
  add(CURSOR, 'Cursor', 9, 0, 11, 30, 'development', 'daylens — ai.ts')
  add('com.google.Chrome', 'Google Chrome', 11, 30, 12, 0, 'browsing', 'GitHub — pull request')
  add(CURSOR, 'Cursor', 13, 30, 16, 15, 'development', 'daylens — workBlocks.ts')
  const cursorSeconds = Math.round((localMs(today, 11, 30) - localMs(today, 9, 0)) / 1000)
    + Math.round((localMs(today, 16, 15) - localMs(today, 13, 30)) / 1000)
  return { date: today, cursorSeconds }
}

// What the Timeline shows for one app on a day: sum that app's seconds across the
// blocks the Timeline renders (block.topApps), the same blocks the AI's getDay reads.
function timelineSecondsForApp(db: Database.Database, date: Date, appNameRe: RegExp): number {
  const [from, to] = localDayBounds(dateStr(date))
  const sessions = getSessionsForRange(db, from, to)
  const blocks = buildTimelineBlocksFromSessions(db, sessions)
  return blocks.reduce((sum, block) =>
    sum + block.topApps.filter((a) => appNameRe.test(a.appName)).reduce((s, a) => s + a.totalSeconds, 0), 0)
}

test('invariant 6: AI getDaySummary(day) Cursor total equals the Timeline Cursor total for that day', (t) => {
  const db = setupDb()
  t.after(() => db.close())
  const { date, cursorSeconds } = seedDay(db)
  const day = dateStr(date)

  const summary = executeTool('getDaySummary', { date: day }, db) as DaySummaryResult
  const cursorApp = summary._evidence.topApps.find((app) => /cursor/i.test(app.appName))
  assert.ok(cursorApp, 'expected Cursor in the AI day summary top apps')
  const aiSeconds = cursorApp!.totalSeconds

  const timelineSeconds = timelineSecondsForApp(db, date, /cursor/i)

  // The AI's number and the Timeline's number are the same number — and both are
  // the ground truth we seeded. If they disagree, the AI tab and Timeline would
  // show different times for the same app (the invariant-6 failure).
  assert.equal(aiSeconds, timelineSeconds, 'AI app total must equal the Timeline app total')
  assert.equal(aiSeconds, cursorSeconds, 'and both equal the real tracked time')
})

test('invariant 6: parity holds for a second app (Chrome) on the same day', (t) => {
  const db = setupDb()
  t.after(() => db.close())
  const { date } = seedDay(db)
  const day = dateStr(date)

  const summary = executeTool('getDaySummary', { date: day }, db) as DaySummaryResult
  const chromeApp = summary._evidence.topApps.find((app) => /chrome/i.test(app.appName))
  assert.ok(chromeApp, 'expected Chrome in the AI day summary top apps')
  const aiSeconds = chromeApp!.totalSeconds

  const timelineSeconds = timelineSecondsForApp(db, date, /chrome/i)

  assert.equal(aiSeconds, timelineSeconds, 'AI Chrome total must equal the Timeline Chrome total')
  assert.ok(aiSeconds > 0, 'Chrome was used, so the number is real')
})

test('invariant 6: getDaySummary totalTrackedSeconds equals the sum of its own block durations', (t) => {
  const db = setupDb()
  t.after(() => db.close())
  const { date } = seedDay(db)
  const day = dateStr(date)

  const summary = executeTool('getDaySummary', { date: day }, db) as DaySummaryResult
  const blockSum = summary.blocks.reduce((sum, block) => sum + block.durationSeconds, 0)
  assert.equal(summary.totalTrackedSeconds, blockSum, 'the day total must always equal the sum of the blocks the Timeline renders')
})
