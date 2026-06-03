import test from 'node:test'
import assert from 'node:assert/strict'
import { getTimelineDayProjection } from '../src/main/core/query/projections.ts'
import {
  getAppSummariesForRange,
  getSessionsForRange,
  getWebsiteSummariesForRange,
  searchAll,
} from '../src/main/db/queries.ts'
import {
  REAL_WORLD_DATE,
  localMs,
  setupRealWorldDb,
} from './support/realWorldActivityFixture.ts'

test('real-world day projection shows the activity a user actually did', () => {
  const db = setupRealWorldDb()
  const day = getTimelineDayProjection(db, REAL_WORLD_DATE, null, { materialize: true })

  assert.equal(day.date, REAL_WORLD_DATE)
  assert.equal(day.totalSeconds, 12_300, 'self-capture noise must not count toward tracked time')
  assert.equal(day.focusSeconds, 8_700, 'development, research, and AI-tool time should count as focus')
  assert.equal(day.focusPct, 71)
  assert.equal(day.appCount, 5)
  assert.equal(day.siteCount, 3)
  assert.deepEqual(
    day.sessions.map((session) => session.appName),
    ['Visual Studio Code', 'Google Chrome', 'Zoom', 'Codex', 'Safari'],
  )

  const away = day.segments.find((segment) => segment.kind === 'away')
  assert.ok(away, 'lock/unlock telemetry should render as an away segment')
  assert.equal(away.startTime, localMs(REAL_WORLD_DATE, 11, 15))
  assert.equal(away.endTime, localMs(REAL_WORLD_DATE, 12, 0))

  const blockLabels = day.blocks.map((block) => block.label.current)
  assert.ok(
    blockLabels.some((label) => /timeline|development|code/i.test(label)),
    `expected a coding block label, got: ${blockLabels.join(', ')}`,
  )
  assert.ok(
    day.blocks.some((block) => block.topApps.some((app) => app.appName === 'Codex')),
    'the AI-assistance block should include Codex as evidence',
  )

  const persistedBlockCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM timeline_blocks
    WHERE date = ? AND invalidated_at IS NULL
  `).get(REAL_WORLD_DATE) as { count: number }
  assert.equal(persistedBlockCount.count, day.blocks.length, 'materialization should persist the blocks the renderer saw')
  db.close()
})

test('real-world range queries aggregate the same day payload inputs', () => {
  const db = setupRealWorldDb()
  const fromMs = localMs(REAL_WORLD_DATE, 0)
  const toMs = fromMs + 86_400_000

  const sessions = getSessionsForRange(db, fromMs, toMs)
  assert.equal(sessions.length, 5)
  assert.equal(sessions.some((session) => session.appName === 'Daylens'), false)
  assert.equal(sessions[0].windowTitle, 'Timeline.tsx - daylens')

  const apps = getAppSummariesForRange(db, fromMs, toMs)
  const appTotals = new Map(apps.map((app) => [app.appName, app.totalSeconds]))
  assert.equal(appTotals.get('Visual Studio Code'), 4_500)
  assert.equal(appTotals.get('Codex'), 2_400)
  assert.equal(appTotals.get('Google Chrome'), 1_800)
  assert.equal(appTotals.get('Safari'), 1_800)
  assert.equal(appTotals.get('Zoom'), 1_800)

  const websites = getWebsiteSummariesForRange(db, fromMs, toMs)
  assert.deepEqual(
    websites.map((site) => [site.domain, site.totalSeconds]),
    [
      ['youtube.com', 1_800],
      ['react.dev', 1_080],
      ['github.com', 600],
    ],
  )
  db.close()
})

test('real-world search finds sessions, sites, and materialized blocks together', () => {
  const db = setupRealWorldDb()
  getTimelineDayProjection(db, REAL_WORLD_DATE, null, { materialize: true })

  const timelineResults = searchAll(db, 'timeline', {
    startDate: REAL_WORLD_DATE,
    endDate: REAL_WORLD_DATE,
    limit: 10,
  })
  assert.ok(timelineResults.some((result) => result.type === 'session'), 'window-title match should return the coding session')
  assert.ok(timelineResults.some((result) => result.type === 'block'), 'materialized timeline labels should be searchable')

  const docsResults = searchAll(db, 'useEffect', {
    startDate: REAL_WORLD_DATE,
    endDate: REAL_WORLD_DATE,
    limit: 10,
  })
  assert.ok(docsResults.some((result) => result.type === 'browser'), 'browser-history title should be searchable')
  assert.ok(docsResults.some((result) => result.type === 'session'), 'foreground browser title should be searchable')

  const selfCaptureResults = searchAll(db, 'Daylens: Timeline', {
    startDate: REAL_WORLD_DATE,
    endDate: REAL_WORLD_DATE,
    limit: 10,
  })
  assert.ok(
    selfCaptureResults.some((result) => result.type === 'session'),
    'raw search keeps self-capture records discoverable for debugging even though the timeline hides them',
  )
  db.close()
})
