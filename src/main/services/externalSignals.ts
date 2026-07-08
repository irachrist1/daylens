// External signals — the Wrapped data layer's optional connectors (Stage 0.2).
//
// The wrap has always known how long the user stared at apps; these connectors
// tell it what was actually produced: git commits and PR activity, calendar
// meetings, focus-app sessions. Each connector is independent and optional —
// unavailable, unpermissioned, or erroring sources skip SILENTLY and the day
// simply has no row for that source. Nothing here may ever throw out of
// collectExternalSignals, block the wrap, or touch the network beyond the
// user's own authenticated CLIs (gh).
//
// Results persist in external_signals keyed by (date, source): a re-run
// replaces the day's row, so the table always holds the freshest read.

import type Database from 'better-sqlite3'
import type { ExternalSignalSource, StoredExternalSignal } from '@shared/types'
import { ANALYTICS_EVENT } from '@shared/analytics'
import { getDb } from './database'
import { capture } from './analytics'
import { collectGitActivity } from './gitSignals'
import { collectCalendarEvents } from './calendarSignals'
import { collectFocusAppSignals } from './enrichmentDiscovery'
import { localDateString } from '../lib/localDate'

// ─── Store ────────────────────────────────────────────────────────────────────

export function putExternalSignal(
  db: Database.Database,
  date: string,
  source: ExternalSignalSource,
  payload: unknown,
): void {
  db.prepare(`
    INSERT INTO external_signals (date, source, payload_json, captured_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date, source) DO UPDATE SET
      payload_json = excluded.payload_json,
      captured_at = excluded.captured_at
  `).run(date, source, JSON.stringify(payload), Date.now())
}

export function getExternalSignal<T>(
  db: Database.Database,
  date: string,
  source: ExternalSignalSource,
): StoredExternalSignal<T> | null {
  // Tolerate a DB from before migration v43 (e.g. an MCP client pointed at an
  // older copy): a missing table means no signal, never an error.
  try {
    const row = db.prepare(`
      SELECT payload_json, captured_at FROM external_signals
      WHERE date = ? AND source = ?
    `).get(date, source) as { payload_json: string; captured_at: number } | undefined
    if (!row) return null
    return { date, source, payload: JSON.parse(row.payload_json) as T, capturedAt: row.captured_at }
  } catch {
    return null
  }
}

// ─── Collection ───────────────────────────────────────────────────────────────

/** How stale a stored signal may be before a refresh re-runs its connector.
 *  A finished (past) day's signals never go stale — the day can't change. */
const LIVE_DAY_STALE_MS = 30 * 60 * 1000

function isFresh(db: Database.Database, date: string, source: ExternalSignalSource): boolean {
  const stored = getExternalSignal(db, date, source)
  if (!stored) return false
  if (date < localDateString()) return true
  return Date.now() - stored.capturedAt < LIVE_DAY_STALE_MS
}

let collecting = false

/** Run every available connector for a date and persist what they found.
 *  Fire-and-forget safe: never throws, never blocks a wrap. Returns the list
 *  of sources that produced a signal this run (for telemetry and tests). */
export async function collectExternalSignals(
  date: string,
  options: { force?: boolean } = {},
): Promise<ExternalSignalSource[]> {
  if (collecting) return []
  collecting = true
  const fired: ExternalSignalSource[] = []
  try {
    const db = getDb()

    if (options.force || !isFresh(db, date, 'git')) {
      try {
        const git = await collectGitActivity(date)
        if (git && (git.repos.length > 0 || git.prs.length > 0)) {
          putExternalSignal(db, date, 'git', git)
          fired.push('git')
        }
      } catch { /* optional source — skip silently */ }
    }

    if (options.force || !isFresh(db, date, 'calendar')) {
      try {
        const calendar = await collectCalendarEvents(date)
        if (calendar && calendar.events.length > 0) {
          putExternalSignal(db, date, 'calendar', calendar)
          fired.push('calendar')
        }
      } catch { /* optional source — skip silently */ }
    }

    if (options.force || !isFresh(db, date, 'focus_app')) {
      try {
        const focus = await collectFocusAppSignals(date)
        if (focus && focus.length > 0) {
          putExternalSignal(db, date, 'focus_app', focus)
          fired.push('focus_app')
        }
      } catch { /* optional source — skip silently */ }
    }

    // Which connectors fired, never the data: tells us what to build next.
    if (fired.length > 0) {
      capture(ANALYTICS_EVENT.WRAPPED_EXTERNAL_SOURCES, {
        external_sources: fired,
        source_count: fired.length,
      })
    }
  } catch { /* the whole collection is best-effort */ }
  finally {
    collecting = false
  }
  return fired
}

let scheduled: ReturnType<typeof setInterval> | null = null

/** Background cadence: first pass a couple of minutes after launch (today and
 *  yesterday), then a refresh every 6 hours. Cheap: connectors early-exit when
 *  the stored signal is fresh. */
export function startExternalSignalCollection(): void {
  if (scheduled) return
  const run = () => {
    const today = localDateString()
    const yesterday = localDateString(new Date(Date.now() - 86_400_000))
    void collectExternalSignals(yesterday).then(() => collectExternalSignals(today))
  }
  setTimeout(run, 2 * 60 * 1000)
  scheduled = setInterval(run, 6 * 60 * 60 * 1000)
}

export function stopExternalSignalCollection(): void {
  if (scheduled) { clearInterval(scheduled); scheduled = null }
}
