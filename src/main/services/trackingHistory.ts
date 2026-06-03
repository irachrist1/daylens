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
import { projectDay } from '../core/projections/chunk2'

export interface PurgeResult {
  deletedRows: number
  affectedDates: string[]
}

export interface DeleteTrackedActivityInput {
  appSessionIds?: number[] | null
  derivedSessionIds?: number[] | null
  bundleId?: string | null
  canonicalAppId?: string | null
  appName?: string | null
  startTime?: number | null
  endTime?: number | null
  date?: string | null
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

function normalizeIds(values: number[] | null | undefined): number[] {
  return [...new Set((values ?? [])
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value) && value > 0))]
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ')
}

function appIdentityWhereClause(input: DeleteTrackedActivityInput): { clause: string; params: unknown[] } | null {
  const bundleId = (input.bundleId ?? '').trim()
  const canonicalAppId = (input.canonicalAppId ?? '').trim()
  const appName = (input.appName ?? '').trim()
  const clauses: string[] = []
  const params: unknown[] = []

  if (bundleId) {
    clauses.push('lower(bundle_id) = lower(?)')
    params.push(bundleId)
  }
  if (canonicalAppId) {
    clauses.push('lower(canonical_app_id) = lower(?)')
    params.push(canonicalAppId)
  }
  if (appName) {
    clauses.push('lower(app_name) = lower(?)')
    params.push(appName)
  }

  return clauses.length > 0 ? { clause: `(${clauses.join(' OR ')})`, params } : null
}

function focusEventAppIdentityWhereClause(input: DeleteTrackedActivityInput): { clause: string; params: unknown[] } | null {
  const bundleId = (input.bundleId ?? '').trim()
  const appName = (input.appName ?? '').trim()
  const clauses: string[] = []
  const params: unknown[] = []

  if (bundleId) {
    clauses.push('lower(app_bundle_id) = lower(?)')
    params.push(bundleId)
  }
  if (appName) {
    clauses.push('lower(app_name) = lower(?)')
    params.push(appName)
  }

  return clauses.length > 0 ? { clause: `(${clauses.join(' OR ')})`, params } : null
}

export function deleteTrackedActivity(input: DeleteTrackedActivityInput): PurgeResult {
  const db = getDb()
  const appSessionIds = normalizeIds(input.appSessionIds)
  const derivedSessionIds = normalizeIds(input.derivedSessionIds)
  const explicitDate = (input.date ?? '').trim()
  const explicitStartTime = Number(input.startTime ?? 0)
  const explicitEndTime = Number(input.endTime ?? 0)
  const affectedDates = new Set<string>()
  let deletedRows = 0
  const hasValidExplicitRange = Number.isFinite(explicitStartTime)
    && Number.isFinite(explicitEndTime)
    && explicitEndTime > explicitStartTime

  if (appSessionIds.length > 0) {
    const inClause = placeholders(appSessionIds)
    const rows = db.prepare(`
      SELECT start_time
      FROM app_sessions
      WHERE id IN (${inClause})
    `).all(...appSessionIds) as { start_time: number }[]

    for (const row of rows) affectedDates.add(localDateString(new Date(row.start_time)))
    deletedRows += db.prepare(`DELETE FROM app_sessions WHERE id IN (${inClause})`).run(...appSessionIds).changes
  }

  const appWhere = appIdentityWhereClause(input)
  if (appWhere && hasValidExplicitRange) {
    const rows = db.prepare(`
      SELECT start_time
      FROM app_sessions
      WHERE ${appWhere.clause}
        AND start_time < ?
        AND COALESCE(end_time, start_time + duration_sec * 1000) > ?
    `).all(...appWhere.params, explicitEndTime, explicitStartTime) as { start_time: number }[]

    for (const row of rows) affectedDates.add(localDateString(new Date(row.start_time)))

    deletedRows += db.prepare(`
      DELETE FROM app_sessions
      WHERE ${appWhere.clause}
        AND start_time < ?
        AND COALESCE(end_time, start_time + duration_sec * 1000) > ?
    `).run(...appWhere.params, explicitEndTime, explicitStartTime).changes
  }

  if (derivedSessionIds.length > 0) {
    const inClause = placeholders(derivedSessionIds)
    const rows = db.prepare(`
      SELECT id, date, start_ts_ms, end_ts_ms
      FROM derived_sessions
      WHERE id IN (${inClause})
    `).all(...derivedSessionIds) as Array<{ id: number; date: string; start_ts_ms: number; end_ts_ms: number }>

    for (const row of rows) {
      affectedDates.add(row.date)
      deletedRows += db.prepare(`
        DELETE FROM focus_events
        WHERE ts_ms >= ? AND ts_ms < ?
      `).run(row.start_ts_ms, row.end_ts_ms).changes
    }

    if (rows.length > 0) {
      db.prepare(`DELETE FROM derived_block_sessions WHERE session_id IN (${inClause})`).run(...derivedSessionIds)
      db.prepare(`DELETE FROM derived_sessions WHERE id IN (${inClause})`).run(...derivedSessionIds)
    }
  } else if (
    appSessionIds.length === 0
    && !appWhere
    && explicitDate
    && hasValidExplicitRange
  ) {
    const info = db.prepare(`
      DELETE FROM focus_events
      WHERE ts_ms >= ? AND ts_ms < ?
    `).run(explicitStartTime, explicitEndTime)
    if (info.changes > 0) {
      deletedRows += info.changes
      affectedDates.add(explicitDate)
    }
  }

  const focusEventAppWhere = focusEventAppIdentityWhereClause(input)
  if (focusEventAppWhere && hasValidExplicitRange) {
    const focusEventRows = db.prepare(`
      SELECT ts_ms
      FROM focus_events
      WHERE ${focusEventAppWhere.clause}
        AND ts_ms >= ?
        AND ts_ms < ?
    `).all(...focusEventAppWhere.params, explicitStartTime, explicitEndTime) as { ts_ms: number }[]

    for (const row of focusEventRows) affectedDates.add(localDateString(new Date(row.ts_ms)))

    deletedRows += db.prepare(`
      DELETE FROM focus_events
      WHERE ${focusEventAppWhere.clause}
        AND ts_ms >= ?
        AND ts_ms < ?
    `).run(...focusEventAppWhere.params, explicitStartTime, explicitEndTime).changes
  }

  const dates = [...affectedDates]
  for (const date of dates) {
    try {
      projectDay(db, date, { finalize: true })
    } catch {
      // Some installs may not have focus_events/derived projections populated;
      // the legacy app_sessions materialization below still refreshes the day.
    }
  }

  rematerializeAndNotify(dates)
  return { deletedRows, affectedDates: dates }
}
