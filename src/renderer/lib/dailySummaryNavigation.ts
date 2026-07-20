import type { DayTimelinePayload, WrappedPeriod } from '@shared/types'

interface DailySummaryNavigationDeps {
  getTimelineDay: (date: string) => Promise<DayTimelinePayload>
  openWrapped: (payload: {
    day: DayTimelinePayload
    threadId: number | null
    artifactId: number | null
  }) => void
  /** Opens the period (week/month/year) wrap — the weekly brief's target. */
  openPeriodWrapped?: (payload: { period: WrappedPeriod; anchorDate: string }) => void
  navigate: (route: string) => void
  todayString: () => string
}

const WRAPPED_PERIODS: ReadonlySet<string> = new Set(['week', 'month', 'year'])

function numberParam(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function emptyDay(date: string): DayTimelinePayload {
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
    version: 'fallback',
  }
}

export async function handleDailySummaryNavigation(
  route: string,
  deps: DailySummaryNavigationDeps,
): Promise<boolean> {
  const url = new URL(route, 'http://x')
  const source = url.searchParams.get('source')
  const opensWrapped = url.pathname === '/wrapped' || source === 'daily-summary' || source === 'evening-wrap' || source === 'weekly-brief'
  if (!opensWrapped) {
    deps.navigate(route)
    return false
  }

  // A period route (the weekly brief) opens the period wrap, not a day deck.
  const period = url.searchParams.get('period')
  if (period && WRAPPED_PERIODS.has(period) && deps.openPeriodWrapped) {
    const anchorDate = url.searchParams.get('date') || deps.todayString()
    deps.openPeriodWrapped({ period: period as WrappedPeriod, anchorDate })
    return true
  }

  const threadId = numberParam(url.searchParams.get('threadId'))
  const artifactId = numberParam(url.searchParams.get('artifactId'))
  const wrappedDate = url.searchParams.get('date') || deps.todayString()

  try {
    const day = await deps.getTimelineDay(wrappedDate)
    deps.openWrapped({ day, threadId, artifactId })
  } catch {
    deps.openWrapped({ day: emptyDay(wrappedDate), threadId, artifactId })
  }

  return true
}
