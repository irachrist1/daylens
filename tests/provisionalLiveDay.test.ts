import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { getTimelineDayPayload } from '../src/main/services/workBlocks.ts'
import { localDateString } from '../src/main/lib/localDate.ts'

function localMs(date: string, hour: number, minute = 0): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function insertSession(db: Database.Database, o: { bundleId: string; appName: string; start: number; end: number; category: string; windowTitle?: string }): void {
  db.prepare(`INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec, category, is_focused, window_title, raw_app_name, canonical_app_id, capture_source, capture_version)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'test', 2)`).run(
    o.bundleId, o.appName, o.start, o.end, Math.round((o.end - o.start) / 1000), o.category, o.windowTitle ?? null, o.appName, o.bundleId,
  )
}

function seedEvent(db: Database.Database, tsMs: number, type: string): void {
  db.prepare(`INSERT INTO activity_state_events (event_ts, event_type, source, metadata_json) VALUES (?, ?, 'test', '{}')`).run(tsMs, type)
}

// Today is one provisional block per continuous sitting until the user
// clicks Analyze — neutral labels, no speculative names. A sitting starts at
// real activity (not an overnight blip), and overnight sleep before the day
// began shows no "Away" bar. With no in-memory live session the sitting reads
// "Earlier today"; the live sitting reads "Active now".
test('today is one provisional block per sitting, starting at real activity, no leading Away bar', () => {
  const db = createProductionTestDatabase()
  const today = localDateString()

  // A 24s overnight blip, then an 8h sleep gap, then the real workday.
  insertSession(db, { bundleId: 'com.anthropic.claude', appName: 'Claude', start: localMs(today, 1, 56), end: localMs(today, 1, 56) + 24_000, category: 'aiTools', windowTitle: 'Claude' })
  insertSession(db, { bundleId: 'com.apple.Terminal', appName: 'Terminal', start: localMs(today, 9, 41), end: localMs(today, 10, 11), category: 'development', windowTitle: 'daylens — onboarding-ux-redesign' })
  insertSession(db, { bundleId: 'com.anthropic.claude', appName: 'Claude', start: localMs(today, 10, 11), end: localMs(today, 10, 40), category: 'aiTools', windowTitle: 'Claude' })
  // Machine slept 5:53am and resumed at 9:41am (the real "Away 3h47m" source).
  seedEvent(db, localMs(today, 5, 53), 'suspend')
  seedEvent(db, localMs(today, 9, 41), 'resume')

  const payload = getTimelineDayPayload(db, today, null, { materialize: false })

  assert.equal(payload.blocks.length, 1, `one sitting should be ONE provisional block, got ${payload.blocks.length}`)
  assert.equal(payload.blocks[0].provisional, true, 'the live day block must be provisional')
  assert.equal(payload.blocks[0].label.current, 'Earlier today', 'provisional block is labelled neutrally')
  assert.equal(new Date(payload.blocks[0].startTime).getHours(), 9, 'block starts at 9am real activity, not the 2am blip')

  const firstStart = payload.blocks[0].startTime
  const leadingBars = payload.segments.filter((s) => s.kind !== 'work_block' && s.startTime < firstStart)
  assert.equal(leadingBars.length, 0, `no Away/idle bar before the first block: ${JSON.stringify(leadingBars)}`)
  db.close()
})
