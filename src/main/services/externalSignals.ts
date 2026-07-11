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
import { getSettings } from './settings'
import { collectGitActivity } from './gitSignals'
import { collectCalendarEvents } from './calendarSignals'
import { collectFocusAppSignals } from './enrichmentDiscovery'
import { localDateString, shiftLocalDateString } from '../lib/localDate'

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

/** Tombstone a (date, source): remove the stored row so a connector that now
 *  finds nothing can't keep serving yesterday's commits/meetings. Called after a
 *  REAL connector run returns empty/null — never speculatively. */
export function deleteExternalSignal(
  db: Database.Database,
  date: string,
  source: ExternalSignalSource,
): void {
  try {
    db.prepare('DELETE FROM external_signals WHERE date = ? AND source = ?').run(date, source)
  } catch { /* missing table (pre-v43 DB): nothing to tombstone */ }
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

/** The moving parts of a collection run, injectable so the tombstone/toggle
 *  logic can be tested hermetically without git, a calendar, or a live DB. */
export interface CollectExternalSignalsDeps {
  db: Database.Database
  collectGit: (date: string) => Promise<import('@shared/types').GitActivitySignal | null>
  collectCalendar: (date: string) => Promise<import('@shared/types').CalendarSignal | null>
  collectFocus: (date: string) => Promise<import('@shared/types').FocusAppSignal[] | null>
  enrichmentSources: Record<string, boolean>
}

function defaultDeps(): CollectExternalSignalsDeps {
  const enrichmentSources = (() => {
    try { return getSettings().enrichmentSources ?? {} } catch { return {} as Record<string, boolean> }
  })()
  return {
    db: getDb(),
    collectGit: collectGitActivity,
    collectCalendar: collectCalendarEvents,
    // Only read the local store of a focus app whose toggle is on (privacy: a
    // disabled app's store is never opened).
    collectFocus: (date) => collectFocusAppSignals(date, {}, (app) => enrichmentSources[`focus:${app}`] === true),
    enrichmentSources,
  }
}

/** Run every available connector for a date and persist what they found.
 *  Fire-and-forget safe: never throws, never blocks a wrap. Returns the list
 *  of sources that produced a signal this run (for telemetry and tests). */
export async function collectExternalSignals(
  date: string,
  options: { force?: boolean; deps?: CollectExternalSignalsDeps } = {},
): Promise<ExternalSignalSource[]> {
  if (collecting) return []
  collecting = true
  const fired: ExternalSignalSource[] = []
  try {
    const { db, collectGit, collectCalendar, collectFocus, enrichmentSources } =
      options.deps ?? defaultDeps()

    // Git and calendar are ALWAYS-ON: read whenever the underlying tools exist
    // (git/gh/icalBuddy/Outlook), no toggle. Focus apps are opt-in per app via
    // the Settings enrichment toggles (`focus:<app>`) — read only what's enabled.
    const focusEnabledFor = (app: string) => enrichmentSources[`focus:${app}`] === true

    // Tombstone rule (Gap 2): a connector that comes back empty must not keep
    // serving stale data — BUT only on an explicit forced refresh (the user
    // asking to replace truth). A background run that returns empty could just
    // be a transient timeout (git/icalBuddy slow or missing), so it leaves any
    // prior row intact rather than risk deleting good data.
    const tombstoneIfForced = (source: ExternalSignalSource) => {
      if (options.force) deleteExternalSignal(db, date, source)
    }

    if (options.force || !isFresh(db, date, 'git')) {
      try {
        const git = await collectGit(date)
        if (git && (git.repos.length > 0 || git.prs.length > 0)) {
          putExternalSignal(db, date, 'git', git)
          fired.push('git')
        } else {
          tombstoneIfForced('git')
        }
      } catch { /* optional source — connector threw; leave any prior row intact */ }
    }

    if (options.force || !isFresh(db, date, 'calendar')) {
      try {
        const calendar = await collectCalendar(date)
        if (calendar && calendar.events.length > 0) {
          putExternalSignal(db, date, 'calendar', calendar)
          fired.push('calendar')
        } else {
          tombstoneIfForced('calendar')
        }
      } catch { /* optional source — connector threw; leave any prior row intact */ }
    }

    if (options.force || !isFresh(db, date, 'focus_app')) {
      try {
        const focus = await collectFocus(date)
        // Only store the apps the user turned on (belt-and-suspenders: the real
        // collector already reads only enabled apps).
        const enabled = (focus ?? []).filter((f) => focusEnabledFor(f.app))
        if (enabled.length > 0) {
          putExternalSignal(db, date, 'focus_app', enabled)
          fired.push('focus_app')
        } else {
          tombstoneIfForced('focus_app')
        }
      } catch { /* optional source — connector threw; leave any prior row intact */ }
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
    const yesterday = shiftLocalDateString(localDateString(), -1)
    void collectExternalSignals(yesterday).then(() => collectExternalSignals(today))
  }
  setTimeout(run, 2 * 60 * 1000)
  scheduled = setInterval(run, 6 * 60 * 60 * 1000)
}

export function stopExternalSignalCollection(): void {
  if (scheduled) { clearInterval(scheduled); scheduled = null }
}
