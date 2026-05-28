import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import type { AppCategory } from '../src/shared/types.ts'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { upsertWorkContextInsight } from '../src/main/db/queries.ts'
import { getTimelineDayPayload } from '../src/main/services/workBlocks.ts'

const TEST_DATE = '2026-04-22'

function localMs(hour: number, minute = 0): number {
  return new Date(2026, 3, 22, hour, minute, 0, 0).getTime()
}

function createDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  return db
}

function insertSession(
  db: Database.Database,
  payload: {
    bundleId?: string
    appName?: string
    title: string
    startMinute: number
    durationMinutes: number
    category?: AppCategory
  },
): void {
  const startTime = localMs(9, payload.startMinute)
  const endTime = startTime + payload.durationMinutes * 60_000
  const bundleId = payload.bundleId ?? 'com.google.Chrome'
  const appName = payload.appName ?? 'Google Chrome'
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id,
      app_name,
      start_time,
      end_time,
      duration_sec,
      category,
      is_focused,
      window_title,
      raw_app_name,
      capture_source,
      capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'test', 1)
  `).run(
    bundleId,
    appName,
    startTime,
    endTime,
    payload.durationMinutes * 60,
    payload.category ?? 'browsing',
    payload.title,
    appName,
  )
}

function insertActivityEvent(db: Database.Database, eventType: string, ts: number): void {
  db.prepare(`
    INSERT INTO activity_state_events (event_ts, event_type, source, metadata_json)
    VALUES (?, ?, 'test', '{}')
  `).run(ts, eventType)
}

function labelsFor(db: Database.Database): string[] {
  return getTimelineDayPayload(db, TEST_DATE).blocks.map((block) => block.label.current)
}

test('sustained browser topic changes split into separately named blocks', () => {
  const db = createDb()
  insertSession(db, { title: 'Camera comparison research - Google Search - Google Chrome', startMinute: 0, durationMinutes: 12 })
  insertSession(db, { title: 'Camera comparison research - DPReview - Google Chrome', startMinute: 12, durationMinutes: 10 })
  insertSession(db, { title: 'City council election results - Local News - Google Chrome', startMinute: 22, durationMinutes: 12 })
  insertSession(db, { title: 'City council election results - Analysis - Google Chrome', startMinute: 34, durationMinutes: 10 })

  const labels = labelsFor(db)

  assert.ok(labels.length >= 2, `expected sustained topic shift to split; got ${JSON.stringify(labels)}`)
  assert.notEqual(labels[0], labels[1])
  assert.ok(labels.every((label) => label !== 'Google Chrome'), `labels should not fall back to browser name: ${JSON.stringify(labels)}`)
  db.close()
})

test('brief context changes under two minutes stay inside the surrounding block', () => {
  const db = createDb()
  insertSession(db, { title: 'insightsQueryRouter.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 0, durationMinutes: 12 })
  insertSession(db, { title: 'Inbox - Gmail - Google Chrome', startMinute: 12, durationMinutes: 1, category: 'email' })
  insertSession(db, { title: 'insightsQueryRouter.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 13, durationMinutes: 12 })

  const payload = getTimelineDayPayload(db, TEST_DATE)

  assert.equal(payload.blocks.length, 1)
  assert.match(payload.blocks[0].label.current, /insightsQueryRouter\.ts|daylens/i)
  db.close()
})

test('highly coherent blocks split only when they exceed the coherent maximum duration', () => {
  const db = createDb()
  insertSession(db, { title: 'Deep work planning - Notion', bundleId: 'notion.id', appName: 'Notion', category: 'writing', startMinute: 0, durationMinutes: 240 })

  const blocks = getTimelineDayPayload(db, TEST_DATE).blocks

  assert.ok(blocks.length >= 2, `expected maximum duration split; got ${blocks.length}`)
  assert.ok(
    blocks.every((block) => block.endTime - block.startTime <= 180 * 60_000),
    `expected every block at or below 180 minutes; got ${blocks.map((block) => Math.round((block.endTime - block.startTime) / 60_000)).join(', ')}`,
  )
  db.close()
})

test('timeline hides short gap events while preserving meaningful untracked spans', () => {
  const db = createDb()
  insertSession(db, {
    title: 'Morning implementation - Cursor',
    bundleId: 'com.todesktop.cursor',
    appName: 'Cursor',
    category: 'development',
    startMinute: 0,
    durationMinutes: 30,
  })
  insertSession(db, {
    title: 'Follow-up implementation - Cursor',
    bundleId: 'com.todesktop.cursor',
    appName: 'Cursor',
    category: 'development',
    startMinute: 90,
    durationMinutes: 30,
  })
  insertActivityEvent(db, 'idle_start', localMs(9, 40))
  insertActivityEvent(db, 'idle_end', localMs(9, 40) + 10_000)

  const payload = getTimelineDayPayload(db, TEST_DATE)
  const gaps = payload.segments.filter((segment) => segment.kind !== 'work_block')
  const shortGaps = gaps.filter((segment) => segment.endTime - segment.startTime < 30 * 60_000)

  assert.equal(shortGaps.length, 0, `short gaps should be hidden: ${JSON.stringify(shortGaps)}`)
  assert.ok(
    gaps.some((segment) => segment.kind === 'idle_gap' && segment.startTime === localMs(9, 30) && segment.endTime === localMs(10, 30)),
    `expected the full 60-minute untracked span to remain: ${JSON.stringify(gaps)}`,
  )
  db.close()
})

test('file and project window titles drive labels instead of app names', () => {
  const db = createDb()
  insertSession(db, { title: 'insightsQueryRouter.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 0, durationMinutes: 25 })

  const [label] = labelsFor(db)

  assert.match(label, /insightsQueryRouter\.ts|daylens/i)
  assert.notEqual(label, 'Cursor')
  db.close()
})

test('deterministic title labels outrank stale AI app-name labels', () => {
  const db = createDb()
  const startTime = localMs(9, 0)
  const endTime = startTime + 25 * 60_000
  insertSession(db, { title: 'insightsQueryRouter.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 0, durationMinutes: 25 })
  upsertWorkContextInsight(db, {
    startMs: startTime,
    endMs: endTime,
    insight: {
      label: 'Cursor',
      narrative: null,
    },
  })

  const [label] = labelsFor(db)

  assert.match(label, /insightsQueryRouter\.ts|daylens/i)
  assert.notEqual(label, 'Cursor')
  db.close()
})

test('terminal-dominant blocks use terminal window titles before browser page titles', () => {
  const db = createDb()
  insertSession(db, { title: 'npm run typecheck - daylens - zsh', bundleId: 'com.warp.dev', appName: 'Warp', category: 'development', startMinute: 0, durationMinutes: 20 })
  insertSession(db, { title: 'React docs - Google Chrome', startMinute: 20, durationMinutes: 6, category: 'browsing' })

  const [label] = labelsFor(db)

  assert.match(label, /npm run typecheck|daylens/i)
  assert.doesNotMatch(label, /React docs|Google Chrome/i)
  db.close()
})

test('chat blocks with only app-name evidence stay untitled instead of using the app name', () => {
  const db = createDb()
  insertSession(db, {
    title: 'WhatsApp',
    bundleId: 'com.whatsapp.WhatsApp',
    appName: 'whatsApp',
    category: 'communication',
    startMinute: 0,
    durationMinutes: 20,
  })

  const [label] = labelsFor(db)

  assert.equal(label, 'Untitled block')
  db.close()
})
