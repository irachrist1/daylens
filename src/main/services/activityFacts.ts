// The corrected-activity read model (v2-ship-plan W1-A, invariant 7: one
// truth, three views).
//
// Raw capture (app_sessions, website_visits) is append-only ground truth and
// is NEVER mutated by a correction. But the Timeline is the user's curated
// story of the day: when a block is deleted (review state 'ignored'), that
// stretch is gone from the day — and every surface that totals activity must
// agree. Before this seam existed, the Apps view summed raw sessions directly,
// so an ignored June 30 block still owned ~16 minutes of Dia in the Apps
// totals while the Timeline honestly showed nothing.
//
// Every read that feeds a user-facing total — the Apps list, the app detail
// panel, the AI's app/session facts — goes through these functions instead of
// the raw queries. The membership rule is the same one the timeline rebuild
// uses (a session belongs to a deleted span when it STARTED inside it), so
// Timeline, Apps, and AI reconcile exactly.
//
// This module is deliberately a thin seam: when the V3 day model lands and
// block facts become the single store, only this file needs to change — the
// callers already speak "corrected activity".
import type Database from 'better-sqlite3'
import type { AppSession, AppUsageSummary } from '@shared/types'
import {
  getAppSummariesForRange,
  getSessionsForRange,
  sessionStartsInsideSpans,
  type CorrectionSpan,
} from '../db/queries'

export type { CorrectionSpan }

function reviewsTableExists(db: Database.Database): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='timeline_block_reviews' LIMIT 1`,
  ).get() as { name: string } | undefined
  return Boolean(row)
}

/** The time spans of every Timeline block the user deleted, clipped to the
 *  ones overlapping [fromMs, toMs). Read from the review ledger — corrections
 *  win and survive every rebuild (invariant 8). */
export function getIgnoredBlockSpansForRange(
  db: Database.Database,
  fromMs: number,
  toMs: number,
): CorrectionSpan[] {
  if (!reviewsTableExists(db)) return []
  const rows = db.prepare(`
    SELECT original_block_json
    FROM timeline_block_reviews
    WHERE review_state = 'ignored'
  `).all() as Array<{ original_block_json: string }>
  const spans: CorrectionSpan[] = []
  for (const row of rows) {
    let original: Record<string, unknown> = {}
    try {
      original = JSON.parse(row.original_block_json || '{}') as Record<string, unknown>
    } catch {
      continue
    }
    const startMs = typeof original.startTime === 'number' ? original.startTime : null
    const endMs = typeof original.endTime === 'number' ? original.endTime : null
    if (startMs == null || endMs == null || endMs <= startMs) continue
    if (endMs <= fromMs || startMs >= toMs) continue
    spans.push({ startMs, endMs })
  }
  return spans
}

/** Raw sessions minus the spans of deleted Timeline blocks — the corrected
 *  session facts every totalling surface reads. */
export function getCorrectedSessionsForRange(
  db: Database.Database,
  fromMs: number,
  toMs: number,
): AppSession[] {
  const spans = getIgnoredBlockSpansForRange(db, fromMs, toMs)
  const sessions = getSessionsForRange(db, fromMs, toMs)
  if (spans.length === 0) return sessions
  return sessions.filter((session) => !sessionStartsInsideSpans(session, spans))
}

/** App usage summaries with deleted Timeline blocks subtracted — what the
 *  Apps list, the Today totals, and the AI's app facts all read. */
export function getCorrectedAppSummariesForRange(
  db: Database.Database,
  fromMs: number,
  toMs: number,
): AppUsageSummary[] {
  const excludeSpans = getIgnoredBlockSpansForRange(db, fromMs, toMs)
  return getAppSummariesForRange(db, fromMs, toMs, { excludeSpans })
}
