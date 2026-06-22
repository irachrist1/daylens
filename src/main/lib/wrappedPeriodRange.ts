// Pure date math for the period wraps. Given a period and any date inside it,
// work out the inclusive day range, the previous-period range (for the delta),
// human labels, and the sub-buckets used for "the shape of the month/year".
// No DB, no Date-timezone surprises — dates are built local from YYYY-MM-DD.

import type { WrappedPeriod } from '@shared/types'

export interface PeriodRange {
  startDate: string
  endDate: string
  prevStartDate: string
  prevEndDate: string
  rangeLabel: string
  /** Label one date for superlatives — weekday for a week, "Jun 14" otherwise. */
  dayLabel: (dateStr: string) => string
  /** Sub-rollups: week → 7 days; month → weeks; year → 12 months. */
  buckets: Array<{ label: string; startDate: string; endDate: string }>
}

function parse(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function fmt(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function shortDay(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function weekday(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}

/** Monday of the week containing `date`. */
function mondayOf(date: Date): Date {
  const day = date.getDay() // 0=Sun
  const offset = day === 0 ? -6 : 1 - day
  return addDays(date, offset)
}

export function computePeriodRange(period: WrappedPeriod, anchorDate: string): PeriodRange {
  const anchor = parse(anchorDate)

  if (period === 'week') {
    // Rolling 7-day window ending on the anchor (matches "this week").
    const end = anchor
    const start = addDays(end, -6)
    const prevEnd = addDays(start, -1)
    const prevStart = addDays(prevEnd, -6)
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(start, i)
      return { label: weekday(day), startDate: fmt(day), endDate: fmt(day) }
    })
    return {
      startDate: fmt(start),
      endDate: fmt(end),
      prevStartDate: fmt(prevStart),
      prevEndDate: fmt(prevEnd),
      rangeLabel: `${shortDay(start)} – ${shortDay(end)}`,
      dayLabel: (d) => weekday(parse(d)),
      buckets,
    }
  }

  if (period === 'month') {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
    const prevEnd = addDays(start, -1)
    const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1)
    // Bucket the month into Mon-anchored weeks.
    const buckets: PeriodRange['buckets'] = []
    let cursor = mondayOf(start)
    while (cursor <= end) {
      const weekStart = cursor < start ? start : cursor
      const weekEndRaw = addDays(cursor, 6)
      const weekEnd = weekEndRaw > end ? end : weekEndRaw
      buckets.push({ label: `Week of ${shortDay(weekStart)}`, startDate: fmt(weekStart), endDate: fmt(weekEnd) })
      cursor = addDays(cursor, 7)
    }
    return {
      startDate: fmt(start),
      endDate: fmt(end),
      prevStartDate: fmt(prevStart),
      prevEndDate: fmt(prevEnd),
      rangeLabel: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      dayLabel: (d) => shortDay(parse(d)),
      buckets,
    }
  }

  // year
  const year = anchor.getFullYear()
  const start = new Date(year, 0, 1)
  const end = new Date(year, 11, 31)
  const prevStart = new Date(year - 1, 0, 1)
  const prevEnd = new Date(year - 1, 11, 31)
  const buckets = Array.from({ length: 12 }, (_, m) => {
    const mStart = new Date(year, m, 1)
    const mEnd = new Date(year, m + 1, 0)
    return { label: mStart.toLocaleDateString('en-US', { month: 'short' }), startDate: fmt(mStart), endDate: fmt(mEnd) }
  })
  return {
    startDate: fmt(start),
    endDate: fmt(end),
    prevStartDate: fmt(prevStart),
    prevEndDate: fmt(prevEnd),
    rangeLabel: String(year),
    dayLabel: (d) => shortDay(parse(d)),
    buckets,
  }
}
