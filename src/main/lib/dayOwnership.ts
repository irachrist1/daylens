import type Database from 'better-sqlite3'
import { localDayBounds } from './localDate'

const CONTINUITY_GAP_MS = 15 * 60_000
const MAX_LATE_NIGHT_CARRY_MS = 12 * 60 * 60_000
const BREAK_EVENT_TYPES = ['away_start', 'lock_screen', 'suspend'] as const
const SYSTEM_NOISE_NAMES = new Set([
  'finder',
  'loginwindow',
  'notification center',
  'siri',
  'usernotificationcenter',
])

interface SessionSpan {
  app_name: string
  start_time: number
  end_time: number
}

function containsBreakEvent(
  db: Database.Database,
  fromMs: number,
  toMs: number,
): boolean {
  if (toMs <= fromMs) return false
  try {
    const placeholders = BREAK_EVENT_TYPES.map(() => '?').join(', ')
    const row = db.prepare(`
      SELECT 1
      FROM activity_state_events
      WHERE event_type IN (${placeholders})
        AND event_ts >= ?
        AND event_ts < ?
      LIMIT 1
    `).get(...BREAK_EVENT_TYPES, fromMs, toMs)
    return Boolean(row)
  } catch {
    return false
  }
}

function lateNightCarryEnd(
  db: Database.Database,
  boundaryMs: number,
): number {
  const scanFrom = boundaryMs - MAX_LATE_NIGHT_CARRY_MS
  const scanTo = boundaryMs + MAX_LATE_NIGHT_CARRY_MS
  const rows = db.prepare(`
    SELECT
      app_name,
      start_time,
      COALESCE(end_time, start_time + duration_sec * 1000) AS end_time
    FROM app_sessions
    WHERE start_time < ?
      AND COALESCE(end_time, start_time + duration_sec * 1000) > ?
    ORDER BY start_time ASC, id ASC
  `).all(scanTo, scanFrom) as SessionSpan[]
  const sessions = rows.filter((row) => !SYSTEM_NOISE_NAMES.has(row.app_name.trim().toLowerCase()))

  const seed = [...sessions]
    .reverse()
    .find((session) =>
      session.start_time < boundaryMs
      && session.end_time > boundaryMs - CONTINUITY_GAP_MS)
  if (!seed) return boundaryMs

  let carryEnd = Math.max(boundaryMs, seed.end_time)
  let previousEnd = seed.end_time
  for (const session of sessions) {
    if (session.start_time < boundaryMs) continue
    const gap = session.start_time - previousEnd
    if (gap >= CONTINUITY_GAP_MS) break
    if (containsBreakEvent(db, previousEnd, session.start_time)) break
    carryEnd = Math.max(carryEnd, session.end_time)
    previousEnd = Math.max(previousEnd, session.end_time)
  }

  return Math.min(carryEnd, scanTo)
}

export function ownedDayBounds(
  db: Database.Database,
  dateStr: string,
): [number, number] {
  const [calendarStart, calendarEnd] = localDayBounds(dateStr)
  const inheritedUntil = lateNightCarryEnd(db, calendarStart)
  const carriesUntil = lateNightCarryEnd(db, calendarEnd)
  return [
    Math.max(calendarStart, inheritedUntil),
    Math.max(calendarEnd, carriesUntil),
  ]
}
