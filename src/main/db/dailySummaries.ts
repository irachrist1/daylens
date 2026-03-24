import { getDb } from '../services/database'
import { computeEnhancedFocusScore } from '../lib/focusScore'
import { localDayBounds } from '../lib/localDate'

/**
 * Daily summary computation and persistence.
 * Runs at end of day and on-demand to pre-compute aggregate metrics.
 */

interface DailySummaryRow {
  date: string
  total_active_sec: number
  focus_sec: number
  app_count: number
  domain_count: number
  session_count: number
  context_switches: number
  focus_score: number
  top_app_bundle_id: string | null
  top_domain: string | null
  ai_summary: string | null
  computed_at: number
}

/**
 * Compute and persist daily summary for a given date (YYYY-MM-DD).
 */
export function computeDailySummary(dateStr: string): void {
  const db = getDb()

  // Use local day bounds so persisted summaries align with the app's local-day views.
  const [dayStart, dayEnd] = localDayBounds(dateStr)

  // App session aggregates — include sessions that overlap the day boundary (cross-midnight).
  // Duration is clipped to the day window before summing.
  const overlapRows = db
    .prepare(
      `SELECT bundle_id, is_focused, start_time,
              COALESCE(end_time, start_time + duration_sec * 1000) AS effective_end
       FROM app_sessions
       WHERE COALESCE(end_time, start_time + duration_sec * 1000) > ?
         AND start_time < ?
         AND duration_sec >= 10`
    )
    .all(dayStart, dayEnd) as {
    bundle_id: string
    is_focused: number
    start_time: number
    effective_end: number
  }[]

  const bundleIds = new Set<string>()
  let totalSec = 0
  let focusSec = 0
  let sessionCount = 0
  const scoreSessions: { durationSeconds: number; isFocused: boolean }[] = []
  for (const row of overlapRows) {
    const clippedStart = Math.max(row.start_time, dayStart)
    const clippedEnd   = Math.min(row.effective_end, dayEnd)
    if (clippedEnd <= clippedStart) continue
    const clippedSec = Math.round((clippedEnd - clippedStart) / 1000)
    bundleIds.add(row.bundle_id)
    totalSec += clippedSec
    if (row.is_focused) focusSec += clippedSec
    sessionCount++
    scoreSessions.push({
      durationSeconds: clippedSec,
      isFocused: row.is_focused === 1,
    })
  }

  const appAgg = {
    app_count:     bundleIds.size,
    session_count: sessionCount,
    total_sec:     totalSec,
    focus_sec:     focusSec,
  }

  // Context switches (count of distinct consecutive app changes)
  const sessions = db
    .prepare(
      `SELECT bundle_id FROM app_sessions
       WHERE COALESCE(end_time, start_time + duration_sec * 1000) > ?
         AND start_time < ?
         AND duration_sec >= 10
       ORDER BY start_time`
    )
    .all(dayStart, dayEnd) as { bundle_id: string }[]

  let switches = 0
  for (let i = 1; i < sessions.length; i++) {
    if (sessions[i].bundle_id !== sessions[i - 1].bundle_id) {
      switches++
    }
  }

  // Top app (also using overlap-aware query)
  const topApp = db
    .prepare(
      `SELECT bundle_id,
              SUM(MIN(COALESCE(end_time, start_time + duration_sec * 1000), ?) -
                  MAX(start_time, ?)) / 1000 as total
       FROM app_sessions
       WHERE COALESCE(end_time, start_time + duration_sec * 1000) > ?
         AND start_time < ?
         AND duration_sec >= 10
       GROUP BY bundle_id
       ORDER BY total DESC
       LIMIT 1`
    )
    .get(dayEnd, dayStart, dayStart, dayEnd) as { bundle_id: string; total: number } | undefined

  // Domain count and top domain
  const domainAgg = db
    .prepare(
      `SELECT COUNT(DISTINCT domain) as domain_count
       FROM website_visits
       WHERE visit_time >= ? AND visit_time < ?`
    )
    .get(dayStart, dayEnd) as { domain_count: number }

  const topDomain = db
    .prepare(
      `SELECT domain, SUM(duration_sec) as total
       FROM website_visits
       WHERE visit_time >= ? AND visit_time < ?
       GROUP BY domain
       ORDER BY total DESC
       LIMIT 1`
    )
    .get(dayStart, dayEnd) as { domain: string; total: number } | undefined

  // Focus score
  const hours = appAgg.total_sec / 3600
  const switchesPerHour = hours > 0 ? switches / hours : 0
  const focusScore = computeEnhancedFocusScore({
    focusedSeconds: appAgg.focus_sec,
    totalSeconds: appAgg.total_sec,
    switchesPerHour,
    sessions: scoreSessions,
  })

  // Upsert
  db.prepare(
    `INSERT INTO daily_summaries
       (date, total_active_sec, focus_sec, app_count, domain_count,
        session_count, context_switches, focus_score,
        top_app_bundle_id, top_domain, ai_summary, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(date) DO UPDATE SET
       total_active_sec = excluded.total_active_sec,
       focus_sec = excluded.focus_sec,
       app_count = excluded.app_count,
       domain_count = excluded.domain_count,
       session_count = excluded.session_count,
       context_switches = excluded.context_switches,
       focus_score = excluded.focus_score,
       top_app_bundle_id = excluded.top_app_bundle_id,
       top_domain = excluded.top_domain,
       computed_at = excluded.computed_at`
  ).run(
    dateStr,
    appAgg.total_sec,
    appAgg.focus_sec,
    appAgg.app_count,
    domainAgg.domain_count,
    appAgg.session_count,
    switches,
    focusScore,
    topApp?.bundle_id ?? null,
    topDomain?.domain ?? null,
    Date.now()
  )
}

/**
 * Get daily summary for a specific date.
 */
export function getDailySummary(dateStr: string): DailySummaryRow | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM daily_summaries WHERE date = ?').get(dateStr) as
    | DailySummaryRow
    | undefined
}

/**
 * Compute summaries for all days that have session data but no summary.
 */
export function computeAllMissingSummaries(): void {
  const db = getDb()
  const dates = db
    .prepare(
      `SELECT DISTINCT date(start_time / 1000, 'unixepoch', 'localtime') as d
       FROM app_sessions
       WHERE d NOT IN (SELECT date FROM daily_summaries)
       ORDER BY d DESC
       LIMIT 60`
    )
    .all() as { d: string }[]

  for (const { d } of dates) {
    computeDailySummary(d)
  }
}
