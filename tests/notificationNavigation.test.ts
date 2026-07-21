import test from 'node:test'
import assert from 'node:assert/strict'
import { handleDailySummaryNavigation } from '../src/renderer/lib/dailySummaryNavigation.ts'
import { buildDailyReportRoute, buildEveningWrapRoute, buildWeeklyBriefRoute, openDailySummaryRoute } from '../src/main/services/dailySummaryNavigation.ts'

function makeEmptyDay(date: string) {
  return {
    date,
    totalSeconds: 0,
    focusSeconds: 0,
    focusPct: 0,
    appCount: 0,
    siteCount: 0,
    sessions: [],
    websites: [],
    blocks: [],
    segments: [],
    focusSessions: [],
    computedAt: Date.now(),
    version: 'test',
  }
}

test('daily summary navigation opens Day Wrapped for the date in the route even when data is empty', async () => {
  const fetchedDates: string[] = []
  const openedDates: string[] = []
  const navigatedRoutes: string[] = []

  await handleDailySummaryNavigation('/ai?source=daily-summary&date=2026-04-29&threadId=42&artifactId=7', {
    getTimelineDay: async (date) => {
      fetchedDates.push(date)
      return makeEmptyDay(date)
    },
    openWrapped: ({ day }) => {
      openedDates.push(day.date)
    },
    navigate: (route) => {
      navigatedRoutes.push(route)
    },
    todayString: () => '2026-04-30',
  })

  assert.deepEqual(fetchedDates, ['2026-04-29'])
  assert.deepEqual(openedDates, ['2026-04-29'])
  assert.deepEqual(navigatedRoutes, [])
})

test('Evening Wrap route opens Day Wrapped without report handoff ids', async () => {
  const opened: Array<{ date: string; threadId: number | null; artifactId: number | null }> = []
  const navigatedRoutes: string[] = []

  await handleDailySummaryNavigation('/wrapped?date=2026-05-12&source=evening-wrap', {
    getTimelineDay: async (date) => makeEmptyDay(date),
    openWrapped: ({ day, threadId, artifactId }) => {
      opened.push({ date: day.date, threadId, artifactId })
    },
    navigate: (route) => {
      navigatedRoutes.push(route)
    },
    todayString: () => '2026-05-13',
  })

  assert.deepEqual(opened, [{ date: '2026-05-12', threadId: null, artifactId: null }])
  assert.deepEqual(navigatedRoutes, [])
})

test('standalone wrapped route opens the Wrapped overlay', async () => {
  const openedDates: string[] = []
  const navigatedRoutes: string[] = []

  await handleDailySummaryNavigation('/wrapped?date=2026-05-12', {
    getTimelineDay: async (date) => makeEmptyDay(date),
    openWrapped: ({ day }) => {
      openedDates.push(day.date)
    },
    navigate: (route) => {
      navigatedRoutes.push(route)
    },
    todayString: () => '2026-05-13',
  })

  assert.deepEqual(openedDates, ['2026-05-12'])
  assert.deepEqual(navigatedRoutes, [])
})

test('Evening Wrap notification route targets the Wrapped surface', () => {
  assert.equal(buildEveningWrapRoute('2026-05-12'), '/wrapped?date=2026-05-12&source=evening-wrap')
})

test('Weekly Brief notification route targets the week wrap anchored on the completed week', () => {
  assert.equal(buildWeeklyBriefRoute('2026-05-10'), '/wrapped?period=week&date=2026-05-10&source=weekly-brief')
})

test('the weekly brief route opens the PERIOD wrap, never a day deck', async () => {
  const openedPeriods: Array<{ period: string; anchorDate: string }> = []
  const openedDays: string[] = []
  const navigatedRoutes: string[] = []

  await handleDailySummaryNavigation(buildWeeklyBriefRoute('2026-05-10'), {
    getTimelineDay: async (date) => makeEmptyDay(date),
    openWrapped: ({ day }) => { openedDays.push(day.date) },
    openPeriodWrapped: ({ period, anchorDate }) => { openedPeriods.push({ period, anchorDate }) },
    navigate: (route) => { navigatedRoutes.push(route) },
    todayString: () => '2026-05-11',
  })

  assert.deepEqual(openedPeriods, [{ period: 'week', anchorDate: '2026-05-10' }])
  assert.deepEqual(openedDays, [], 'no day deck opened')
  assert.deepEqual(navigatedRoutes, [])
})

test('a period route without an openPeriodWrapped dep still opens a day wrap rather than nothing (old renderer)', async () => {
  const openedDays: string[] = []
  await handleDailySummaryNavigation('/wrapped?period=week&date=2026-05-10&source=weekly-brief', {
    getTimelineDay: async (date) => makeEmptyDay(date),
    openWrapped: ({ day }) => { openedDays.push(day.date) },
    navigate: () => {},
    todayString: () => '2026-05-11',
  })
  assert.deepEqual(openedDays, ['2026-05-10'])
})

test('daily report route includes the report date for Morning Brief click-through', () => {
  const route = buildDailyReportRoute({
    date: '2026-04-29',
    threadId: 42,
    artifactId: 7,
    prepared: true,
    status: 'ready',
  })

  assert.equal(route, '/ai?threadId=42&artifactId=7&date=2026-04-29&source=daily-summary')
})

test('notification click shows a hidden window before sending the navigation event', () => {
  const calls: string[] = []
  const sentRoutes: string[] = []
  const window = {
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => false,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
    webContents: {
      isLoadingMainFrame: () => false,
      once: () => {},
      send: (_channel: string, route: string) => sentRoutes.push(route),
    },
  }

  openDailySummaryRoute('/ai?source=daily-summary&date=2026-04-29', () => window)

  assert.deepEqual(calls, ['show', 'focus'])
  assert.deepEqual(sentRoutes, ['/ai?source=daily-summary&date=2026-04-29'])
})
