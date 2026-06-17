import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import type { AppCategory, AppSession } from '../src/shared/types.ts'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { upsertWorkContextInsight } from '../src/main/db/queries.ts'
import { buildTimelineBlocksFromSessions, getBlockDetailPayload, getTimelineDayPayload, listTimelineDaysNeedingHeuristicUpgrade, mergeTimelineEpisodes, writeTimelineBlockReview } from '../src/main/services/workBlocks.ts'
import { getTimelineDayProjection, materializeTimelineDayProjection } from '../src/main/core/query/projections.ts'
import { PROJECTION_VERSION } from '../src/main/core/projections/chunk2.ts'

const TEST_DATE = '2026-04-22'

function localMs(hour: number, minute = 0): number {
  return new Date(2026, 3, 22, hour, minute, 0, 0).getTime()
}

function localMsForDate(dateStr: string, hour: number, minute = 0): number {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function dateStringForOffset(offsetDays: number): string {
  const target = new Date()
  target.setDate(target.getDate() + offsetDays)
  const year = target.getFullYear()
  const month = String(target.getMonth() + 1).padStart(2, '0')
  const day = String(target.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
    dateStr?: string
  },
): void {
  const startTime = payload.dateStr
    ? localMsForDate(payload.dateStr, 9, payload.startMinute)
    : localMs(9, payload.startMinute)
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

function insertWebsiteVisit(
  db: Database.Database,
  payload: {
    domain: string
    pageTitle: string
    url: string
    startMinute: number
    durationSeconds: number
    browserBundleId?: string
  },
): void {
  const startTime = localMs(9, payload.startMinute)
  db.prepare(`
    INSERT INTO website_visits (
      browser_bundle_id,
      canonical_browser_id,
      visit_time,
      visit_time_us,
      duration_sec,
      url,
      normalized_url,
      domain,
      page_title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.browserBundleId ?? 'com.google.Chrome',
    payload.browserBundleId ?? 'com.google.Chrome',
    startTime,
    startTime * 1000,
    payload.durationSeconds,
    payload.url,
    payload.url,
    payload.domain,
    payload.pageTitle,
  )
}

function insertActivityEvent(db: Database.Database, eventType: string, ts: number): void {
  db.prepare(`
    INSERT INTO activity_state_events (event_ts, event_type, source, metadata_json)
    VALUES (?, ?, 'test', '{}')
  `).run(ts, eventType)
}

function insertDerivedSessionDay(db: Database.Database): void {
  const startTime = localMs(9, 0)
  const endTime = startTime + 40 * 60_000
  const session = db.prepare(`
    INSERT INTO derived_sessions (
      date,
      start_ts_ms,
      end_ts_ms,
      active_seconds,
      app_bundle_id,
      app_name,
      window_title,
      url,
      page_title,
      confidence,
      category,
      is_browser,
      domain,
      projection_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'observed', ?, 0, NULL, ?)
  `).run(
    TEST_DATE,
    startTime,
    endTime,
    40 * 60,
    'com.todesktop.cursor',
    'Cursor',
    'router.ts - daylens - Cursor',
    'development',
    PROJECTION_VERSION,
  )
  const block = db.prepare(`
    INSERT INTO derived_blocks (
      date,
      start_ts_ms,
      end_ts_ms,
      active_seconds,
      label,
      label_source,
      dominant_category,
      confidence,
      projection_version,
      finalized_at
    ) VALUES (?, ?, ?, ?, 'Development', 'app', 'development', 'observed', ?, ?)
  `).run(TEST_DATE, startTime, endTime, 40 * 60, PROJECTION_VERSION, endTime)
  db.prepare(`
    INSERT INTO derived_block_sessions (block_id, session_id)
    VALUES (?, ?)
  `).run(block.lastInsertRowid, session.lastInsertRowid)
  db.prepare(`
    INSERT INTO derived_projection_runs (
      date,
      projection_version,
      events_in,
      sessions_out,
      blocks_out,
      finalized_at,
      started_at
    ) VALUES (?, ?, 1, 1, 1, ?, ?)
  `).run(TEST_DATE, PROJECTION_VERSION, endTime, startTime)
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

test('a sub-five-minute terminal sliver is absorbed into the adjacent coding block', () => {
  const db = createDb()
  insertSession(db, { title: 'aiService.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 0, durationMinutes: 30 })
  insertSession(db, { title: 'npm run typecheck - daylens - zsh', bundleId: 'com.warp.dev', appName: 'Warp', category: 'development', startMinute: 30, durationMinutes: 1 })
  insertSession(db, { title: 'aiService.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 31, durationMinutes: 30 })

  const blocks = getTimelineDayPayload(db, TEST_DATE).blocks

  assert.equal(blocks.length, 1, `the 1-minute terminal sliver should fold in; got ${blocks.length} blocks`)
  assert.ok(blocks[0].endTime - blocks[0].startTime >= 60 * 60_000, 'merged block should span the full hour')
  db.close()
})

test('adjacent same-category development fragments coalesce into one block', () => {
  const db = createDb()
  // Two contiguous coding stretches on the same project, interleaving Cursor
  // and the terminal — one continuous work session, not two blocks.
  insertSession(db, { title: 'router.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 0, durationMinutes: 25 })
  insertSession(db, { title: 'npm test - daylens - zsh', bundleId: 'com.warp.dev', appName: 'Warp', category: 'development', startMinute: 25, durationMinutes: 20 })
  insertSession(db, { title: 'router.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 45, durationMinutes: 25 })
  insertSession(db, { title: 'npm test - daylens - zsh', bundleId: 'com.warp.dev', appName: 'Warp', category: 'development', startMinute: 70, durationMinutes: 20 })

  const blocks = getTimelineDayPayload(db, TEST_DATE).blocks

  assert.equal(blocks.length, 1, `same-work dev fragments should merge; got ${blocks.map((b) => b.label.current).join(' | ')}`)
  db.close()
})

test('a sub-30-minute fragment folds into the related neighbour it continues', () => {
  const db = createDb()
  // Excel, a short detour, back to the same Excel workbook. The short middle
  // run is the same spreadsheet work continued; it should not stand alone.
  insertSession(db, { title: 'Q2 forecast.xlsx - Excel', bundleId: 'com.microsoft.Excel', appName: 'Microsoft Excel', category: 'productivity', startMinute: 0, durationMinutes: 35 })
  insertSession(db, { title: 'Q2 forecast.xlsx - Excel', bundleId: 'com.microsoft.Excel', appName: 'Microsoft Excel', category: 'productivity', startMinute: 35, durationMinutes: 20 })

  const blocks = getTimelineDayPayload(db, TEST_DATE).blocks

  assert.equal(blocks.length, 1, `same-app spreadsheet work should read as one block; got ${blocks.map((b) => b.label.current).join(' | ')}`)
  db.close()
})

test('same-app work bridges a moderate untracked gap into one block', () => {
  const db = createDb()
  // A 50-second terminal sliver, then a 17-minute untracked gap, then an hour
  // of the same app. This is one coding session resuming, not two blocks.
  insertSession(db, { title: 'npm run dev - daylens - Ghostty', bundleId: 'com.mitchellh.ghostty', appName: 'Ghostty', category: 'development', startMinute: 0, durationMinutes: 1 })
  insertSession(db, { title: 'widgets.tsx - daylens - Ghostty', bundleId: 'com.mitchellh.ghostty', appName: 'Ghostty', category: 'development', startMinute: 18, durationMinutes: 63 })

  const blocks = getTimelineDayPayload(db, TEST_DATE).blocks

  assert.equal(blocks.length, 1, `same-app work across a 17m gap should bridge; got ${blocks.map((b) => b.label.current).join(' | ')}`)
  db.close()
})

test('sparse AI/dev tool spans fold into surrounding development work by active time', () => {
  const db = createDb()
  const sessions: AppSession[] = [
    {
      id: 1,
      bundleId: 'com.todesktop.cursor',
      appName: 'Cursor',
      startTime: localMs(9, 0),
      endTime: localMs(9, 40),
      durationSeconds: 40 * 60,
      category: 'development',
      isFocused: true,
      windowTitle: 'workBlocks.ts - daylens - Cursor',
      rawAppName: 'Cursor',
    },
    {
      id: 2,
      bundleId: 'com.google.antigravity',
      appName: 'Antigravity',
      startTime: localMs(10, 3),
      endTime: localMs(10, 44),
      durationSeconds: 27,
      category: 'uncategorized',
      isFocused: false,
      windowTitle: 'Daylens agent run - Antigravity',
      rawAppName: 'Antigravity',
    },
  ]

  const blocks = buildTimelineBlocksFromSessions(db, sessions)

  assert.equal(blocks.length, 1, `low-active Antigravity span should fold into dev work; got ${blocks.map((b) => b.label.current).join(' | ')}`)
  assert.equal(blocks[0].dominantCategory, 'development')
  db.close()
})

test('same-app work does not bridge across a real lock boundary', () => {
  const db = createDb()
  insertSession(db, { title: 'npm run dev - daylens - Ghostty', bundleId: 'com.mitchellh.ghostty', appName: 'Ghostty', category: 'development', startMinute: 0, durationMinutes: 20 })
  insertActivityEvent(db, 'lock', localMs(9, 25))
  insertActivityEvent(db, 'unlock', localMs(9, 35))
  insertSession(db, { title: 'widgets.tsx - daylens - Ghostty', bundleId: 'com.mitchellh.ghostty', appName: 'Ghostty', category: 'development', startMinute: 42, durationMinutes: 40 })

  const blocks = getTimelineDayPayload(db, TEST_DATE).blocks

  assert.equal(blocks.length, 2, `real lock boundary should split resumed work; got ${blocks.map((b) => b.label.current).join(' | ')}`)
  db.close()
})

test('entertainment does not bridge a gap into one runaway "watching" block', () => {
  const db = createDb()
  // Two video stretches in the same browser separated by a 17-minute untracked
  // lull. These are two separate detours, not "the same work resuming" — drift
  // categories must never bridge, or one block's span (and old duration) would
  // swallow the whole evening (R4).
  insertSession(db, { title: 'Video A - YouTube', bundleId: 'com.google.Chrome', appName: 'Google Chrome', category: 'entertainment', startMinute: 0, durationMinutes: 25 })
  insertSession(db, { title: 'Video B - YouTube', bundleId: 'com.google.Chrome', appName: 'Google Chrome', category: 'entertainment', startMinute: 42, durationMinutes: 25 })

  const blocks = getTimelineDayPayload(db, TEST_DATE).blocks

  assert.equal(blocks.length, 2, `entertainment across a 17m gap must not bridge; got ${blocks.length} block(s)`)
  db.close()
})

test('a sub-30-minute block with no related neighbour keeps its own block', () => {
  const db = createDb()
  // A 20-minute email block wedged between two coding stretches. Email is
  // unrelated to the development work on either side, so it stays standalone
  // rather than being forced into something it is not.
  insertSession(db, { title: 'router.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 0, durationMinutes: 40 })
  insertSession(db, { title: 'Inbox - Gmail - Google Chrome', bundleId: 'com.google.Chrome', appName: 'Google Chrome', category: 'email', startMinute: 40, durationMinutes: 20 })
  insertSession(db, { title: 'router.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 60, durationMinutes: 40 })

  const categories = getTimelineDayPayload(db, TEST_DATE).blocks.map((b) => b.dominantCategory)

  assert.ok(categories.includes('email'), `the unrelated email block should survive: ${JSON.stringify(categories)}`)
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

test('mixed Daylens development and research does not keep a browsing badge when focused work is substantial', () => {
  const db = createDb()
  insertSession(db, { title: 'workBlocks.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 0, durationMinutes: 16 })
  insertSession(db, { title: 'irachrist1/daylens-v1: Daylens - GitHub - Google Chrome', startMinute: 16, durationMinutes: 24, category: 'browsing' })

  const [block] = getTimelineDayPayload(db, TEST_DATE).blocks

  assert.equal(block.dominantCategory, 'development')
  assert.notEqual(block.dominantCategory, 'browsing')
  db.close()
})

test('GitHub repo review pages badge as focused research rather than browsing', () => {
  const db = createDb()
  insertSession(db, { title: 'irachrist1/daylens-v1: Daylens - GitHub - Google Chrome', startMinute: 0, durationMinutes: 35, category: 'browsing' })
  insertWebsiteVisit(db, {
    domain: 'github.com',
    pageTitle: 'irachrist1/daylens-v1: Daylens',
    url: 'https://github.com/irachrist1/daylens-v1',
    startMinute: 0,
    durationSeconds: 35 * 60,
  })

  const [block] = getTimelineDayPayload(db, TEST_DATE).blocks

  assert.equal(block.dominantCategory, 'research')
  db.close()
})

test('contiguous AI assistant and GitHub repo review collapse into one assisted work block', () => {
  const db = createDb()
  insertSession(db, { title: 'Claude Code - Dia', bundleId: 'company.thebrowser.dia', appName: 'Dia', category: 'aiTools', startMinute: 0, durationMinutes: 120 })
  insertSession(db, { title: 'irachrist1/daylens-v1: Daylens - GitHub - Google Chrome', startMinute: 120, durationMinutes: 115, category: 'browsing' })
  insertWebsiteVisit(db, {
    domain: 'github.com',
    pageTitle: 'irachrist1/daylens-v1: Daylens',
    url: 'https://github.com/irachrist1/daylens-v1',
    startMinute: 120,
    durationSeconds: 115 * 60,
  })

  const blocks = getTimelineDayPayload(db, TEST_DATE).blocks

  assert.equal(blocks.length, 1, `AI assistant plus repo review should merge; got ${blocks.map((b) => b.label.current).join(' | ')}`)
  assert.equal(blocks[0].dominantCategory, 'research')
  db.close()
})

function heuristicVersions(db: Database.Database): string[] {
  return (db.prepare(
    `SELECT heuristic_version FROM timeline_blocks WHERE invalidated_at IS NULL AND is_live = 0 ORDER BY start_time`,
  ).all() as Array<{ heuristic_version: string }>).map((r) => r.heuristic_version)
}

test('a stale, never-processed past day is reconstructed on revisit', () => {
  const db = createDb()
  insertSession(db, { title: 'router.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 0, durationMinutes: 40 })

  // First visit persists under the current heuristic version.
  getTimelineDayPayload(db, TEST_DATE)
  // Simulate the day having been persisted by a superseded heuristic.
  db.prepare(`UPDATE timeline_blocks SET heuristic_version = 'timeline-v3'`).run()
  assert.deepEqual(heuristicVersions(db), ['timeline-v3'])

  // Revisiting an older, unprocessed day rebuilds it more accurately.
  getTimelineDayPayload(db, TEST_DATE)
  assert.ok(heuristicVersions(db).every((v) => v === 'timeline-v7'), 'stale unprocessed day should be rebuilt')
  db.close()
})

test('a nightly-processed past day is kept even when its heuristic is stale', () => {
  const db = createDb()
  insertSession(db, { title: 'router.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 0, durationMinutes: 40 })

  getTimelineDayPayload(db, TEST_DATE)
  const blockId = (db.prepare(`SELECT id FROM timeline_blocks LIMIT 1`).get() as { id: string }).id
  // Mark the day as nightly-processed (an AI label) under a superseded heuristic.
  db.prepare(`UPDATE timeline_blocks SET heuristic_version = 'timeline-v3'`).run()
  db.prepare(`
    INSERT INTO timeline_block_labels (id, block_id, label, narrative, source, confidence, created_at, model_info_json)
    VALUES (?, ?, 'Refactoring the router', NULL, 'ai', 0.9, ?, NULL)
  `).run(`${blockId}:ai:test`, blockId, Date.now())

  getTimelineDayPayload(db, TEST_DATE)
  assert.deepEqual(heuristicVersions(db), ['timeline-v3'], 'processed day must be kept as summarized')
  db.close()
})

test('background upgrade finds stale unprocessed days but leaves processed days alone', () => {
  const db = createDb()
  insertSession(db, { title: 'router.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 0, durationMinutes: 40 })

  getTimelineDayPayload(db, TEST_DATE)
  db.prepare(`UPDATE timeline_blocks SET heuristic_version = 'timeline-v3'`).run()

  assert.deepEqual(listTimelineDaysNeedingHeuristicUpgrade(db, '2026-04-23'), [TEST_DATE])

  const blockId = (db.prepare(`SELECT id FROM timeline_blocks LIMIT 1`).get() as { id: string }).id
  db.prepare(`
    INSERT INTO timeline_block_labels (id, block_id, label, narrative, source, confidence, created_at, model_info_json)
    VALUES (?, ?, 'Refactoring the router', NULL, 'ai', 0.9, ?, NULL)
  `).run(`${blockId}:ai:processed`, blockId, Date.now())

  assert.deepEqual(listTimelineDaysNeedingHeuristicUpgrade(db, '2026-04-23'), [])
  db.close()
})

test('timeline block review state survives reload from persisted blocks', () => {
  const db = createDb()
  insertSession(db, { title: 'router.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 0, durationMinutes: 40 })

  const block = getTimelineDayPayload(db, TEST_DATE).blocks[0]
  assert.ok(block)

  writeTimelineBlockReview(db, TEST_DATE, block, { state: 'ignored' })

  const reloaded = getTimelineDayPayload(db, TEST_DATE).blocks[0]
  assert.equal(reloaded.review.state, 'ignored')
  const reviewRows = db.prepare(`SELECT COUNT(*) AS count FROM timeline_block_reviews WHERE review_state = 'ignored'`).get() as { count: number }
  assert.equal(reviewRows.count, 1)
  db.close()
})

test('timeline block correction survives rebuild through evidence lineage', () => {
  const db = createDb()
  insertSession(db, { title: 'router.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 0, durationMinutes: 40 })

  const block = getTimelineDayPayload(db, TEST_DATE).blocks[0]
  assert.ok(block)
  writeTimelineBlockReview(db, TEST_DATE, block, {
    state: 'corrected',
    correctedLabel: 'Router refactor',
  })

  db.prepare(`UPDATE timeline_block_reviews SET block_id = 'retired-block-id' WHERE block_id = ?`).run(block.id)
  db.prepare(`UPDATE timeline_blocks SET heuristic_version = 'timeline-v3'`).run()

  const rebuilt = getTimelineDayPayload(db, TEST_DATE).blocks[0]
  assert.equal(rebuilt.label.current, 'Router refactor')
  assert.equal(rebuilt.label.source, 'user')
  assert.equal(rebuilt.review.state, 'corrected')
  assert.equal(rebuilt.review.source, 'stored_evidence')
  assert.equal(rebuilt.review.correctedLabel, 'Router refactor')
  assert.ok(heuristicVersions(db).every((v) => v === 'timeline-v7'), 'stale day should rebuild while preserving correction')
  db.close()
})

test('timeline projection reads derived days without materializing timeline blocks', () => {
  const db = createDb()
  insertDerivedSessionDay(db)

  const payload = getTimelineDayProjection(db, TEST_DATE, null, { materialize: false })

  assert.equal(payload.blocks.length, 1)
  const count = db.prepare(`
    SELECT COUNT(*) AS count
    FROM timeline_blocks
    WHERE date = ? AND invalidated_at IS NULL
  `).get(TEST_DATE) as { count: number }
  assert.equal(count.count, 0, 'read-only projection should not persist timeline blocks')
  db.close()
})

test('explicit timeline materialization persists derived day blocks for block writes', () => {
  const db = createDb()
  insertDerivedSessionDay(db)

  const payload = materializeTimelineDayProjection(db, TEST_DATE, null)

  assert.equal(payload.blocks.length, 1)
  const count = db.prepare(`
    SELECT COUNT(*) AS count
    FROM timeline_blocks
    WHERE date = ? AND invalidated_at IS NULL
  `).get(TEST_DATE) as { count: number }
  assert.equal(count.count, 1)
  db.close()
})

test('block detail lookup uses persisted block date before falling back to recent-day scans', () => {
  const db = createDb()
  const olderDate = dateStringForOffset(-45)
  insertSession(db, {
    dateStr: olderDate,
    title: 'lookup.ts - daylens - Cursor',
    bundleId: 'com.todesktop.cursor',
    appName: 'Cursor',
    category: 'development',
    startMinute: 0,
    durationMinutes: 35,
  })

  const [block] = getTimelineDayPayload(db, olderDate).blocks

  const detail = getBlockDetailPayload(db, block.id)

  assert.equal(detail?.id, block.id)
  assert.equal(detail?.label.current, block.label.current)
  db.close()
})

test('every block carries a non-empty boundary reason on both edges', () => {
  const db = createDb()
  insertSession(db, { title: 'router.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 0, durationMinutes: 40 })

  const [block] = getTimelineDayPayload(db, TEST_DATE).blocks
  assert.ok(block.boundary, 'block must expose a boundary')
  assert.ok((block.boundary?.startReasons.length ?? 0) > 0, 'start reason must be non-empty')
  assert.ok((block.boundary?.endReasons.length ?? 0) > 0, 'end reason must be non-empty')
  db.close()
})

test('a user merge erases a boundary that survives a rebuild', () => {
  const db = createDb()
  // Two distinct browsing topics split into two blocks by default.
  insertSession(db, { title: 'Camera comparison research - DPReview - Google Chrome', startMinute: 0, durationMinutes: 25 })
  insertSession(db, { title: 'City council election results - Local News - Google Chrome', startMinute: 25, durationMinutes: 25 })

  const before = getTimelineDayPayload(db, TEST_DATE).blocks
  assert.equal(before.length, 2, 'distinct browsing topics should be two blocks before the merge')

  mergeTimelineEpisodes(db, TEST_DATE, before[0], before[1])

  const afterMerge = getTimelineDayPayload(db, TEST_DATE).blocks
  assert.equal(afterMerge.length, 1, 'the user merge should collapse the two episodes into one')

  db.prepare(`UPDATE timeline_blocks SET heuristic_version = 'timeline-v3'`).run()
  const afterRebuild = getTimelineDayPayload(db, TEST_DATE).blocks
  assert.equal(afterRebuild.length, 1, 'the merge must survive a rebuild')
  db.close()
})

test('a user merge overrides a kind-shift hard cut (work absorbs leisure)', () => {
  const db = createDb()
  // Coding then YouTube, back to back. A kind change is normally the hardest
  // boundary of all, so these are two blocks by default. A manual merge is the
  // strongest signal there is and must win even over kind-shift.
  insertSession(db, { title: 'router.ts - daylens - Cursor', bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', startMinute: 0, durationMinutes: 40 })
  insertSession(db, { title: 'How Israel Won the War - YouTube', bundleId: 'com.google.Chrome', appName: 'Google Chrome', category: 'entertainment', startMinute: 40, durationMinutes: 15 })

  const before = getTimelineDayPayload(db, TEST_DATE).blocks
  assert.equal(before.length, 2, 'a kind change should hard-cut work from leisure by default')

  mergeTimelineEpisodes(db, TEST_DATE, before[0], before[1])

  const afterMerge = getTimelineDayPayload(db, TEST_DATE).blocks
  assert.equal(afterMerge.length, 1, 'a user merge must override the kind-shift cut')

  db.prepare(`UPDATE timeline_blocks SET heuristic_version = 'timeline-v3'`).run()
  const afterRebuild = getTimelineDayPayload(db, TEST_DATE).blocks
  assert.equal(afterRebuild.length, 1, 'the cross-kind merge must survive a rebuild')
  db.close()
})

test('chat blocks with only app-name evidence read as the category, never the app name', () => {
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

  // The app name ("WhatsApp") must never become the label, but the category
  // floor "Communication" is a better, badge-consistent answer than a blank.
  assert.equal(label, 'Communication')
  assert.notEqual(label?.toLowerCase(), 'whatsapp')
  db.close()
})
