// Active duration for a work block.
//
// A block's wall-clock span (`endTime - startTime`) can far exceed the time the
// user was actually working. Sessions can overlap when multiple capture sources
// describe the same foreground stretch, so summing their stored durations can
// double-count time. The union of their clipped intervals is the duration truth.

import type { WorkContextBlock, AppSession } from './types'

export function blockActiveSeconds(block: Pick<WorkContextBlock, 'startTime' | 'endTime' | 'sessions'>): number {
  const span = Math.max(0, Math.round((block.endTime - block.startTime) / 1000))
  const sessions = block.sessions ?? []
  if (sessions.length === 0) return Math.max(1, span)

  const intervals = sessions
    .map((session: AppSession) => {
      const start = Math.max(block.startTime, session.startTime)
      const storedEnd = session.endTime
        ?? (session.startTime + Math.max(0, session.durationSeconds || 0) * 1000)
      const end = Math.min(block.endTime, storedEnd)
      const spanSeconds = Math.max(0, (end - start) / 1000)
      const activeSeconds = session.durationSeconds > 0
        ? Math.min(session.durationSeconds, spanSeconds)
        : spanSeconds
      return { start, end, activeSeconds }
    })
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)

  if (intervals.length === 0) return Math.max(1, span)

  let totalMs = 0
  let currentStart = intervals[0].start
  let currentEnd = intervals[0].end
  for (let index = 1; index < intervals.length; index++) {
    const interval = intervals[index]
    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end)
      continue
    }
    totalMs += currentEnd - currentStart
    currentStart = interval.start
    currentEnd = interval.end
  }
  totalMs += currentEnd - currentStart

  const unionSeconds = totalMs / 1000
  const reportedActiveSeconds = intervals.reduce((sum, interval) => sum + interval.activeSeconds, 0)
  const active = Math.round(Math.min(unionSeconds, reportedActiveSeconds))
  return Math.max(1, span > 0 ? Math.min(active, span) : active)
}

// Timeline cards display whole minutes. Totals use the same per-card buckets
// so the recap and week views equal what a person can add up on screen.
export function blockDisplayedActiveSeconds(
  block: Pick<WorkContextBlock, 'startTime' | 'endTime' | 'sessions'>,
): number {
  return Math.floor(blockActiveSeconds(block) / 60) * 60
}

// Duration that matches the clock range shown next to it. Clock displays
// truncate to whole minutes (8:55:23 reads as "8:55"), so a block running
// 8:55:23 → 9:09:48 should read "8:55 – 9:09 · 14m" — not 13m, even though
// the active-second sum may round down. Use this only when a duration
// appears alongside a "HH:MM – HH:MM" range; for standalone aggregates
// (rail totals, AI answers), keep blockActiveSeconds. See BUGS.md B11.
export function blockDisplayedSpanSeconds(block: Pick<WorkContextBlock, 'startTime' | 'endTime'>): number {
  const startMinute = Math.floor(block.startTime / 60_000)
  const endMinute = Math.floor(block.endTime / 60_000)
  return Math.max(1, (endMinute - startMinute) * 60)
}
