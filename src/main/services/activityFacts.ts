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
import type { AppCategory, AppSession, AppUsageSummary, WebsiteSummary } from '@shared/types'
import { FOCUSED_CATEGORIES } from '@shared/types'
import {
  getAppSummariesForRange,
  getReconciledDomainIntervals,
  getSessionsForRange,
  getWebsiteSummariesForRange,
  getWebsiteVisitsForRange,
  type CorrectionSpan,
} from '../db/queries'

export type { CorrectionSpan }

interface CategoryCorrectionSpan extends CorrectionSpan {
  category: AppCategory
  updatedAt: number
}

const APP_CATEGORIES = new Set<AppCategory>([
  'development', 'communication', 'research', 'writing', 'aiTools', 'design',
  'browsing', 'meetings', 'entertainment', 'email', 'productivity', 'social',
  'system', 'uncategorized',
])

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
  return mergeCorrectionSpans(spans)
}

function mergeCorrectionSpans(spans: readonly CorrectionSpan[]): CorrectionSpan[] {
  const ordered = [...spans].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const merged: CorrectionSpan[] = []
  for (const span of ordered) {
    const last = merged[merged.length - 1]
    if (last && span.startMs <= last.endMs) last.endMs = Math.max(last.endMs, span.endMs)
    else merged.push({ ...span })
  }
  return merged
}

function getCategoryCorrectionSpansForRange(
  db: Database.Database,
  fromMs: number,
  toMs: number,
): CategoryCorrectionSpan[] {
  if (!reviewsTableExists(db)) return []
  const rows = db.prepare(`
    SELECT original_block_json, correction_json, updated_at
    FROM timeline_block_reviews
    WHERE review_state = 'corrected'
    ORDER BY updated_at ASC
  `).all() as Array<{ original_block_json: string; correction_json: string; updated_at: number }>
  const spans: CategoryCorrectionSpan[] = []
  for (const row of rows) {
    try {
      const original = JSON.parse(row.original_block_json || '{}') as Record<string, unknown>
      const correction = JSON.parse(row.correction_json || '{}') as Record<string, unknown>
      const startMs = typeof original.startTime === 'number' ? original.startTime : null
      const endMs = typeof original.endTime === 'number' ? original.endTime : null
      const category = correction.category
      if (startMs == null || endMs == null || endMs <= startMs || endMs <= fromMs || startMs >= toMs) continue
      if (typeof category !== 'string' || !APP_CATEGORIES.has(category as AppCategory)) continue
      spans.push({ startMs, endMs, category: category as AppCategory, updatedAt: row.updated_at })
    } catch { /* malformed review evidence is ignored, never guessed */ }
  }
  return spans
}

function categoryAt(spans: readonly CategoryCorrectionSpan[], startMs: number, endMs: number): AppCategory | null {
  let winner: CategoryCorrectionSpan | null = null
  for (const span of spans) {
    if (span.startMs >= endMs || span.endMs <= startMs) continue
    if (!winner || span.updatedAt >= winner.updatedAt) winner = span
  }
  return winner?.category ?? null
}

function correctedPiecesForSession(
  session: AppSession,
  fromMs: number,
  toMs: number,
  ignored: readonly CorrectionSpan[],
  categories: readonly CategoryCorrectionSpan[],
): AppSession[] {
  // duration_sec is captured activity; a stale wall-clock end may enclose a
  // much larger inactive stretch. Correct only the interval Daylens actually
  // has credit for, then split at every correction boundary.
  const capturedEnd = session.startTime + Math.max(0, session.durationSeconds) * 1000
  const storedEnd = session.endTime != null && session.endTime > session.startTime ? session.endTime : capturedEnd
  const start = Math.max(fromMs, session.startTime)
  const end = Math.min(toMs, storedEnd, capturedEnd)
  if (end <= start) return []
  const boundaries = new Set<number>([start, end])
  for (const span of [...ignored, ...categories]) {
    if (span.startMs > start && span.startMs < end) boundaries.add(span.startMs)
    if (span.endMs > start && span.endMs < end) boundaries.add(span.endMs)
  }
  const points = [...boundaries].sort((a, b) => a - b)
  const pieces: AppSession[] = []
  for (let index = 0; index < points.length - 1; index++) {
    const pieceStart = points[index]
    const pieceEnd = points[index + 1]
    if (ignored.some((span) => span.startMs < pieceEnd && span.endMs > pieceStart)) continue
    const category = categoryAt(categories, pieceStart, pieceEnd) ?? session.category
    pieces.push({
      ...session,
      startTime: pieceStart,
      endTime: pieceEnd,
      durationSeconds: Math.round((pieceEnd - pieceStart) / 1000),
      category,
      isFocused: FOCUSED_CATEGORIES.includes(category),
    })
  }
  return pieces
}

/** Raw sessions minus the spans of deleted Timeline blocks — the corrected
 *  session facts every totalling surface reads. */
export function getCorrectedSessionsForRange(
  db: Database.Database,
  fromMs: number,
  toMs: number,
): AppSession[] {
  const sessions = getSessionsForRange(db, fromMs, toMs)
  return applyTimelineCorrectionsToSessions(db, sessions, fromMs, toMs)
}

/** Apply the Timeline review ledger to any session source, including the
 * historical derived-session projection. */
export function applyTimelineCorrectionsToSessions(
  db: Database.Database,
  sessions: readonly AppSession[],
  fromMs: number,
  toMs: number,
): AppSession[] {
  const spans = getIgnoredBlockSpansForRange(db, fromMs, toMs)
  const categorySpans = getCategoryCorrectionSpansForRange(db, fromMs, toMs)
  if (spans.length === 0 && categorySpans.length === 0) return [...sessions]
  return sessions.flatMap((session) => correctedPiecesForSession(session, fromMs, toMs, spans, categorySpans))
}

/** App usage summaries with deleted Timeline blocks subtracted — what the
 *  Apps list, the Today totals, and the AI's app facts all read. */
export function getCorrectedAppSummariesForRange(
  db: Database.Database,
  fromMs: number,
  toMs: number,
): AppUsageSummary[] {
  const raw = getAppSummariesForRange(db, fromMs, toMs)
  const corrected = getCorrectedSessionsForRange(db, fromMs, toMs)
  const totals = new Map<string, { seconds: number; categorySeconds: Map<AppCategory, number> }>()
  for (const session of corrected) {
    const key = session.canonicalAppId ?? session.bundleId
    const entry = totals.get(key) ?? { seconds: 0, categorySeconds: new Map<AppCategory, number>() }
    entry.seconds += session.durationSeconds
    entry.categorySeconds.set(session.category, (entry.categorySeconds.get(session.category) ?? 0) + session.durationSeconds)
    totals.set(key, entry)
  }
  return raw.flatMap((summary) => {
    const key = summary.canonicalAppId ?? summary.bundleId
    const entry = totals.get(key)
    if (!entry || entry.seconds <= 0) return []
    const category = [...entry.categorySeconds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? summary.category
    return [{ ...summary, totalSeconds: entry.seconds, category, isFocused: FOCUSED_CATEGORIES.includes(category) }]
  }).sort((a, b) => b.totalSeconds - a.totalSeconds)
}

export interface CorrectedDomainInterval {
  domain: string
  start: number
  end: number
  visitId: number
}

function subtractSpansFromInterval(start: number, end: number, spans: readonly CorrectionSpan[]): Array<{ start: number; end: number }> {
  let pieces = end > start ? [{ start, end }] : []
  for (const span of spans) {
    pieces = pieces.flatMap((piece) => {
      if (span.endMs <= piece.start || span.startMs >= piece.end) return [piece]
      const next: Array<{ start: number; end: number }> = []
      if (span.startMs > piece.start) next.push({ start: piece.start, end: Math.min(span.startMs, piece.end) })
      if (span.endMs < piece.end) next.push({ start: Math.max(span.endMs, piece.start), end: piece.end })
      return next
    })
  }
  return pieces
}

export function getCorrectedDomainIntervals(
  db: Database.Database,
  fromMs: number,
  toMs: number,
  domainFilter?: (domain: string) => boolean,
): CorrectedDomainInterval[] {
  const ignored = getIgnoredBlockSpansForRange(db, fromMs, toMs)
  return getReconciledDomainIntervals(db, fromMs, toMs, domainFilter).flatMap((interval) =>
    subtractSpansFromInterval(interval.start, interval.end, ignored).map((piece) => ({
      domain: interval.domain,
      visitId: interval.visitId,
      ...piece,
    })),
  )
}

/** Website facts corrected by the same interval ledger as app facts. */
export function getCorrectedWebsiteSummariesForRange(
  db: Database.Database,
  fromMs: number,
  toMs: number,
): WebsiteSummary[] {
  const rawByDomain = new Map(getWebsiteSummariesForRange(db, fromMs, toMs).map((row) => [row.domain, row]))
  const visitsById = new Map(getWebsiteVisitsForRange(db, fromMs, toMs).map((visit) => [visit.id, visit]))
  const grouped = new Map<string, { milliseconds: number; visitIds: Set<number>; titleMs: Map<string, number> }>()
  for (const interval of getCorrectedDomainIntervals(db, fromMs, toMs)) {
    const entry = grouped.get(interval.domain) ?? { milliseconds: 0, visitIds: new Set<number>(), titleMs: new Map<string, number>() }
    const milliseconds = interval.end - interval.start
    entry.milliseconds += milliseconds
    entry.visitIds.add(interval.visitId)
    const title = visitsById.get(interval.visitId)?.pageTitle?.trim()
    if (title) entry.titleMs.set(title, (entry.titleMs.get(title) ?? 0) + milliseconds)
    grouped.set(interval.domain, entry)
  }
  return [...grouped.entries()].map(([domain, entry]) => {
    const raw = rawByDomain.get(domain)
    const topTitle = [...entry.titleMs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    return {
      domain,
      totalSeconds: Math.round(entry.milliseconds / 1000),
      visitCount: entry.visitIds.size,
      topTitle,
      browserBundleId: raw?.browserBundleId ?? null,
      canonicalBrowserId: raw?.canonicalBrowserId ?? null,
    }
  }).filter((summary) => summary.totalSeconds > 0)
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
}
