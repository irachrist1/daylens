// T3: delete already-captured history for an app or site the user just excluded
// (or wants gone). Deletes the source rows (app_sessions / website_visits), then
// rebuilds the affected day projections from what remains and notifies the
// surfaces so the data disappears from the timeline, Apps, AI answers, and
// search — "gone, not just hidden". Forward capture is stopped separately by the
// gate in tracking.ts / browserContext.ts.

import { getDb } from './database'
import { localDateString } from '../lib/localDate'
import { materializeTimelineDayProjection } from '../core/query/projections'
import { invalidateProjectionScope } from '../core/projections/invalidation'

export interface PurgeResult {
  deletedRows: number
  affectedDates: string[]
}

function rematerializeAndNotify(affectedDates: string[]): void {
  if (affectedDates.length === 0) return
  const db = getDb()
  for (const date of affectedDates) {
    try {
      materializeTimelineDayProjection(db, date, null)
    } catch (err) {
      console.warn('[tracking-controls] re-materialize failed for', date, err)
    }
  }
  // Deleted activity can affect any read surface; refresh them all.
  invalidateProjectionScope('timeline', 'tracking_controls_purge')
  invalidateProjectionScope('apps', 'tracking_controls_purge')
  invalidateProjectionScope('insights', 'tracking_controls_purge')
}

function distinctLocalDates(timestamps: number[]): string[] {
  return [...new Set(timestamps.map((ms) => localDateString(new Date(ms))))]
}

export function deleteHistoryForApp(input: { bundleId?: string | null; appName?: string | null }): PurgeResult {
  const db = getDb()
  const bundle = (input.bundleId ?? '').trim()
  const name = (input.appName ?? '').trim()
  if (!bundle && !name) return { deletedRows: 0, affectedDates: [] }

  const where = 'WHERE (? <> \'\' AND lower(bundle_id) = lower(?)) OR (? <> \'\' AND lower(app_name) = lower(?))'
  const params = [bundle, bundle, name, name]
  const rows = db.prepare(`SELECT start_time FROM app_sessions ${where}`).all(...params) as { start_time: number }[]
  const affectedDates = distinctLocalDates(rows.map((r) => r.start_time))
  const info = db.prepare(`DELETE FROM app_sessions ${where}`).run(...params)
  rematerializeAndNotify(affectedDates)
  return { deletedRows: info.changes, affectedDates }
}

export function deleteHistoryForSite(input: { domain: string }): PurgeResult {
  const db = getDb()
  const domain = (input.domain ?? '').trim().toLowerCase().replace(/^www\./, '')
  if (!domain) return { deletedRows: 0, affectedDates: [] }

  // Exact host or any subdomain (so excluding youtube.com also clears m.youtube.com).
  const where = 'WHERE lower(domain) = ? OR lower(domain) LIKE ?'
  const params = [domain, `%.${domain}`]
  const rows = db.prepare(`SELECT visit_time FROM website_visits ${where}`).all(...params) as { visit_time: number }[]
  const affectedDates = distinctLocalDates(rows.map((r) => r.visit_time))
  const info = db.prepare(`DELETE FROM website_visits ${where}`).run(...params)
  rematerializeAndNotify(affectedDates)
  return { deletedRows: info.changes, affectedDates }
}
