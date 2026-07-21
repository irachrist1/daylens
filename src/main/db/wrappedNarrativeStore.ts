// Persistence for generated wraps (DEV-118 / wrapped.md §3.3). A wrap is shown
// on open, never silently regenerated: once generated it is stored keyed by
// cadence + period (the DATE for a day, the anchor for a period), NOT by a facts
// hash — so today's wrap stays stable as the day accrues more activity, and only
// an explicit Regenerate (force) replaces it. The stored generated_at drives the
// honest "generated <when>" marker instead of stamping "just now" on every open.

import type Database from 'better-sqlite3'
import {
  retireDayAnalysisVersionsForDate,
  type DayAnalysisRetirementReason,
} from './dayAnalysisVersions'

export type WrappedCadence = 'day' | 'week' | 'month' | 'year'

export interface StoredWrappedNarrative<T> {
  narrative: T
  factsHash: string
  generatedAt: number
}

export function getStoredWrappedNarrative<T>(
  db: Database.Database,
  cadence: WrappedCadence,
  periodKey: string,
): StoredWrappedNarrative<T> | null {
  const row = db.prepare(`
    SELECT narrative_json, facts_hash, generated_at
    FROM wrapped_narratives
    WHERE cadence = ? AND period_key = ?
  `).get(cadence, periodKey) as { narrative_json: string; facts_hash: string; generated_at: number } | undefined
  if (!row) return null
  try {
    return {
      narrative: JSON.parse(row.narrative_json) as T,
      factsHash: row.facts_hash,
      generatedAt: row.generated_at,
    }
  } catch {
    return null
  }
}

export function putStoredWrappedNarrative<T>(
  db: Database.Database,
  cadence: WrappedCadence,
  periodKey: string,
  narrative: T,
  factsHash: string,
  generatedAt: number,
): void {
  db.prepare(`
    INSERT INTO wrapped_narratives (cadence, period_key, facts_hash, narrative_json, generated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(cadence, period_key) DO UPDATE SET
      facts_hash = excluded.facts_hash,
      narrative_json = excluded.narrative_json,
      generated_at = excluded.generated_at
  `).run(cadence, periodKey, factsHash, JSON.stringify(narrative), generatedAt)
}

function wrappedNarrativesTableExists(db: Database.Database): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='wrapped_narratives' LIMIT 1`,
  ).get()
  return Boolean(row)
}

/** Shift a YYYY-MM-DD string by whole days, in local-date arithmetic. */
function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const shifted = new Date(y, m - 1, d + days)
  const mm = String(shifted.getMonth() + 1).padStart(2, '0')
  const dd = String(shifted.getDate()).padStart(2, '0')
  return `${shifted.getFullYear()}-${mm}-${dd}`
}

/**
 * Drop every stored narrative whose period contains `date`. A correction,
 * deletion, or exclusion on that day makes the prose written over the old
 * facts stale; the next open regenerates from the corrected facts instead of
 * serving lines that could contradict Timeline. Week rows are keyed by the
 * start of a rolling 7-day window, month rows by the first of the month, year
 * rows by the year's first day — containment follows from the key alone.
 *
 * The version ledger (DEV-206) records the same moment the other way around:
 * instead of losing what was said, the CURRENT analysis version of every
 * affected period is retired with `reason`, so the next generation appends a
 * new version that names why it replaced the old one — a correction changes
 * the analysis visibly, never silently.
 */
export function deleteWrappedNarrativesForDate(
  db: Database.Database,
  date: string,
  reason: DayAnalysisRetirementReason = 'correction',
): void {
  retireDayAnalysisVersionsForDate(db, date, reason)
  if (!wrappedNarrativesTableExists(db)) return
  db.prepare(`DELETE FROM wrapped_narratives WHERE cadence = 'day' AND period_key = ?`).run(date)
  // A week window starting up to 6 days before `date` still contains it.
  db.prepare(`
    DELETE FROM wrapped_narratives
    WHERE cadence = 'week' AND period_key >= ? AND period_key <= ?
  `).run(shiftDate(date, -6), date)
  db.prepare(`
    DELETE FROM wrapped_narratives
    WHERE cadence = 'month' AND substr(period_key, 1, 7) = ?
  `).run(date.slice(0, 7))
  db.prepare(`
    DELETE FROM wrapped_narratives
    WHERE cadence = 'year' AND substr(period_key, 1, 4) = ?
  `).run(date.slice(0, 4))
}
