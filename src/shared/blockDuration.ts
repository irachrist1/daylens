// Active duration for a work block.
//
// A block's wall-clock span (`endTime - startTime`) can far exceed the time the
// user was actually working: the block builder permits up to 15 minutes of gap
// between adjacent sessions before splitting (see workBlocks.ts), so a 30 minute
// block can span 2+ hours of wall clock. Use the sum of session durations as the
// truth for displayed durations, clamped to the wall-clock span so it never
// reads larger than the block's visible range.

import type { WorkContextBlock, AppSession } from './types'

export function blockActiveSeconds(block: Pick<WorkContextBlock, 'startTime' | 'endTime' | 'sessions'>): number {
  const span = Math.max(0, Math.round((block.endTime - block.startTime) / 1000))
  const sessions = block.sessions ?? []
  if (sessions.length === 0) return Math.max(1, span)
  const summed = sessions.reduce(
    (sum, session: AppSession) => sum + Math.max(0, session.durationSeconds || 0),
    0,
  )
  if (summed <= 0) return Math.max(1, span)
  return Math.max(1, span > 0 ? Math.min(summed, span) : summed)
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
