// The resolver set (ADR 0002, ai.md §4.1) — the ONLY way the AI tab touches
// data. The app owns these; the model may select and parameterize them (the
// planner) and phrase their output, but it never executes them and never
// decides whether data exists. They read the same store the Timeline and Apps
// views read, so a number here equals the number there (ai.md invariant 6).
//
// Each resolver wraps a body that already exists in services/aiTools.ts — we
// keep the bodies, drop the model-facing tool orchestration that used to drive
// them. New question types are served by ADDING a resolver here, never by
// loosening the model.
import type Database from 'better-sqlite3'
import { filterTrackingExcludedEvidence } from '@shared/evidencePrivacy'
import { trackingControlsStateFromSettings, type TrackingControlsState } from '@shared/trackingControls'
import { getSettings } from '../services/settings'
import {
  execGetAppUsage,
  execGetBlockAtTime,
  execGetDaySummary,
  execGetAttributionContext,
  execListClients,
  execSearchSessions,
  localDayBounds,
  type DayBlockNarrative,
  type DaySummaryResult,
  type GetAppUsageResult,
  type GetAttributionContextResult,
  type GetBlockAtTimeResult,
  type ListClientsResult,
  type SearchSessionsResult,
  type SessionSearchHit,
} from '../services/aiTools'

// ---------------------------------------------------------------------------
// The planner emits one or more of these. Dates are explicit YYYY-MM-DD local
// so the resolvers stay fully deterministic — no date math in the model.
// ---------------------------------------------------------------------------

export type ResolverQuery =
  | { resolver: 'getDay'; date: string }
  | { resolver: 'getRange'; from: string; to: string }
  | { resolver: 'getApp'; app: string; from?: string; to?: string }
  | { resolver: 'getBlockAtTime'; date: string; time: string }
  | { resolver: 'recall'; query: string; from?: string; to?: string }
  | { resolver: 'getAttribution'; entity?: string; from?: string; to?: string }
  | { resolver: 'listClients'; from?: string; to?: string }

export type ResolverName = ResolverQuery['resolver']

export const RESOLVER_NAMES: ResolverName[] = [
  'getDay', 'getRange', 'getApp', 'getBlockAtTime', 'recall', 'getAttribution', 'listClients',
]

export interface ResolvedFact {
  query: ResolverQuery
  /** The typed resolver result. The phrase step is handed only this. */
  data: unknown
  /** Did the resolver find anything? Drives the thin-data path (ai.md §7). */
  isEmpty: boolean
}

function toDateStr(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Expand a span into per-day keys. When the span exceeds `cap`, we keep the
// most RECENT `cap` days (chat almost always wants recent activity) and the
// caller reports the effective window, so a long range is never silently
// truncated at the wrong end.
function eachDay(from: string, to: string, cap = 92): string[] {
  const [fromMs] = localDayBounds(from)
  const [toMs] = localDayBounds(to)
  const earliestAllowed = Math.max(fromMs, toMs - (cap - 1) * 86_400_000)
  const days: string[] = []
  for (let ms = earliestAllowed; ms <= toMs; ms += 86_400_000) {
    days.push(toDateStr(ms))
  }
  return days
}

// ---------------------------------------------------------------------------
// getRange — blocks/totals across an arbitrary span, aggregated from the same
// per-day timeline payload getDay reads (so weekly/monthly totals match the
// Timeline to the minute). ai.md §8.3.
// ---------------------------------------------------------------------------

interface RangeDaySummary {
  date: string
  totalTrackedSeconds: number
  topBlocks: Array<{ label: string; startTime: string; endTime: string; durationSeconds: number; apps: string[] }>
}

interface GetRangeResult {
  from: string
  to: string
  totalTrackedSeconds: number
  days: RangeDaySummary[]
  /** Block labels rolled up across the whole range, by total seconds. */
  topActivities: Array<{ label: string; totalSeconds: number }>
  /** Apps rolled up across the range, by total seconds. bundleId is carried so
   *  the privacy filter can drop apps excluded by bundle id, not only by name. */
  topApps: Array<{ appName: string; bundleId: string | null; totalSeconds: number }>
}

function getRange(from: string, to: string, db: Database.Database): GetRangeResult {
  const days: RangeDaySummary[] = []
  const activitySeconds = new Map<string, number>()
  const appSeconds = new Map<string, number>()
  const appBundleIds = new Map<string, string | null>()
  let totalTrackedSeconds = 0

  // The effective window may be narrower than requested for very long spans
  // (see eachDay's cap); report what we actually scanned so totals are honest.
  const scannedDays = eachDay(from, to)
  const effectiveFrom = scannedDays[0] ?? from

  for (const date of scannedDays) {
    const summary = execGetDaySummary({ date }, db)
    if (summary.totalTrackedSeconds <= 0) continue
    totalTrackedSeconds += summary.totalTrackedSeconds
    days.push({
      date,
      totalTrackedSeconds: summary.totalTrackedSeconds,
      topBlocks: [...summary.blocks]
        .sort((a, b) => b.durationSeconds - a.durationSeconds)
        .slice(0, 6)
        .map((b: DayBlockNarrative) => ({
          label: b.label,
          startTime: b.startTime,
          endTime: b.endTime,
          durationSeconds: b.durationSeconds,
          apps: b.appsInBlock.map((a) => a.appName),
        })),
    })
    for (const block of summary.blocks) {
      activitySeconds.set(block.label, (activitySeconds.get(block.label) ?? 0) + block.durationSeconds)
    }
    for (const app of summary._evidence.topApps) {
      appSeconds.set(app.appName, (appSeconds.get(app.appName) ?? 0) + app.totalSeconds)
      if (!appBundleIds.has(app.appName)) appBundleIds.set(app.appName, app.bundleId ?? null)
    }
  }

  const topActivities = [...activitySeconds.entries()]
    .map(([label, totalSeconds]) => ({ label, totalSeconds }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, 12)
  const topApps = [...appSeconds.entries()]
    .map(([appName, totalSeconds]) => ({ appName, bundleId: appBundleIds.get(appName) ?? null, totalSeconds }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, 12)

  return { from: effectiveFrom, to, totalTrackedSeconds, days, topActivities, topApps }
}

// ---------------------------------------------------------------------------
// getAttribution — work grouped by client/project (ai.md §8.2). When no
// clients exist, it never dead-ends: it returns an inferred breakdown from the
// blocks it can already see and a flag telling the phrase step to offer setup.
// ---------------------------------------------------------------------------

export interface GetAttributionResult {
  /** True when the user has named clients/projects in Settings. */
  hasClients: boolean
  /** Direct match when the user asked about a specific entity. */
  entity: GetAttributionContextResult | null
  /** The full client roster + attributed time when clients exist. */
  clients: ListClientsResult | null
  /** Inferred breakdown by block/thread when no projects are set up yet. */
  inferred: Array<{ label: string; totalSeconds: number }> | null
  /** Tells the phrase step to offer setting up named projects in Settings. */
  suggestSetup: boolean
}

function defaultRange(from: string | undefined, to: string | undefined): { from: string; to: string } {
  const now = Date.now()
  return {
    from: from ?? toDateStr(now - 7 * 86_400_000),
    to: to ?? toDateStr(now),
  }
}

function getAttribution(
  params: { entity?: string; from?: string; to?: string },
  db: Database.Database,
): GetAttributionResult {
  if (params.entity && params.entity.trim()) {
    const entity = execGetAttributionContext({ entityName: params.entity.trim() }, db)
    if (entity.entityType !== 'unknown') {
      return { hasClients: true, entity, clients: null, inferred: null, suggestSetup: false }
    }
  }

  const { from, to } = defaultRange(params.from, params.to)
  const clients = execListClients({ startDate: from, endDate: to }, db)
  const hasClients = clients.clientRoster.length > 0 || clients.attributedClients.length > 0
  if (hasClients) {
    return { hasClients: true, entity: null, clients, inferred: null, suggestSetup: false }
  }

  // No clients/projects set up — infer a breakdown from the period's blocks so
  // the answer is never a dead end (ai.md §8.2).
  const range = getRange(from, to, db)
  return {
    hasClients: false,
    entity: null,
    clients: null,
    inferred: range.topActivities,
    suggestSetup: true,
  }
}

// ---------------------------------------------------------------------------
// Dispatch — the deterministic resolve step. Runs a single resolver query and
// reports whether it found data. No model involvement.
// ---------------------------------------------------------------------------

function isEmptyResult(query: ResolverQuery, data: unknown): boolean {
  switch (query.resolver) {
    case 'getDay':
      return (data as { totalTrackedSeconds: number }).totalTrackedSeconds <= 0
    case 'getRange':
      return (data as GetRangeResult).totalTrackedSeconds <= 0
    case 'getApp':
      return (data as GetAppUsageResult).totalSeconds <= 0
    case 'getBlockAtTime':
      return !(data as GetBlockAtTimeResult).found
    case 'recall':
      return (data as { hits: SessionSearchHit[] }).hits.length === 0
    case 'getAttribution': {
      const r = data as GetAttributionResult
      return !r.hasClients && (r.inferred?.length ?? 0) === 0
    }
    case 'listClients':
      return (data as ListClientsResult).clientRoster.length === 0
  }
}

export function runResolverQuery(
  query: ResolverQuery,
  db: Database.Database,
  controls: TrackingControlsState = trackingControlsStateFromSettings(getSettings()),
): ResolvedFact {
  let data: unknown
  switch (query.resolver) {
    case 'getDay':
      data = execGetDaySummary({ date: query.date }, db)
      break
    case 'getRange':
      data = getRange(query.from, query.to, db)
      break
    case 'getApp':
      data = execGetAppUsage({ appName: query.app, startDate: query.from, endDate: query.to }, db)
      break
    case 'getBlockAtTime':
      data = execGetBlockAtTime({ date: query.date, time: query.time }, db)
      break
    case 'recall':
      data = execSearchSessions({ query: query.query, startDate: query.from, endDate: query.to, limit: 12 }, db)
      break
    case 'getAttribution':
      data = getAttribution(query, db)
      break
    case 'listClients':
      data = execListClients({ startDate: query.from, endDate: query.to }, db)
      break
  }
  // Last-line privacy boundary: nothing excluded (or system-noise) is allowed
  // into a fact before it is serialized and handed to the model. isEmpty stays
  // on the raw result so "the day had activity" is reported honestly even when
  // every surfaced row was an excluded one.
  const filtered = filterTrackingExcludedEvidence(data, controls)
  return { query, data: filtered, isEmpty: isEmptyResult(query, data) }
}

export function runResolverQueries(
  queries: ResolverQuery[],
  db: Database.Database,
  controls: TrackingControlsState = trackingControlsStateFromSettings(getSettings()),
): ResolvedFact[] {
  return queries.map((query) => runResolverQuery(query, db, controls))
}

// ---------------------------------------------------------------------------
// Serialization — turns a resolved fact into compact, format-guiding text for
// the phrase step. Kept here (next to the resolvers, free of provider imports)
// so it's the single grounded view the model is handed, and so it's unit-
// testable without dragging in the AI orchestration graph.
// ---------------------------------------------------------------------------

function fmtDuration(seconds: number): string {
  // Round to whole minutes first so we never emit an invalid "1h 60m".
  const totalMinutes = Math.round(Math.max(0, seconds) / 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h <= 0) return `${m}m`
  return `${h}h ${m}m`
}

function fmtClock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function serializeFact(fact: ResolvedFact): string {
  const q = fact.query
  switch (q.resolver) {
    case 'getDay': {
      const d = fact.data as DaySummaryResult
      if (fact.isEmpty) return `getDay ${q.date}: no tracked activity.`
      const blocks = d.blocks
        .map((b) => `  - ${b.label} (${b.startTime}–${b.endTime}, ${fmtDuration(b.durationSeconds)})${b.appsInBlock.length ? ` [apps: ${b.appsInBlock.map((a) => a.appName).join(', ')}]` : ''}${b.pageTitles.length ? ` [pages: ${b.pageTitles.join('; ')}]` : ''}`)
        .join('\n')
      return `getDay ${q.date}: total ${fmtDuration(d.totalTrackedSeconds)} across ${d.blocks.length} blocks.\n${blocks}`
    }
    case 'getRange': {
      const r = fact.data as GetRangeResult
      if (fact.isEmpty) return `getRange ${q.from}..${q.to}: no tracked activity.`
      const perDay = r.days
        .map((day) => `  ${day.date}: ${fmtDuration(day.totalTrackedSeconds)} — ${day.topBlocks.map((b) => `${b.label} (${fmtDuration(b.durationSeconds)})`).join('; ')}`)
        .join('\n')
      const apps = r.topApps.map((a) => `${a.appName} ${fmtDuration(a.totalSeconds)}`).join(', ')
      const acts = r.topActivities.map((a) => `${a.label} ${fmtDuration(a.totalSeconds)}`).join(', ')
      return `getRange ${q.from}..${q.to}: total ${fmtDuration(r.totalTrackedSeconds)}.\nPer day:\n${perDay}\nTop activities: ${acts}\nTop apps: ${apps}`
    }
    case 'getApp': {
      const a = fact.data as GetAppUsageResult
      if (fact.isEmpty) return `getApp "${q.app}": no tracked time in range ${a.startDate}..${a.endDate}.`
      const daily = a.dailyBreakdown.map((d) => `  ${d.date}: ${fmtDuration(d.totalSeconds)} (${d.sessionCount} sessions)`).join('\n')
      const titles = a.recentWindowTitles.slice(0, 6).join('; ')
      return `getApp "${a.appName}" ${a.startDate}..${a.endDate}: total ${fmtDuration(a.totalSeconds)}, ${a.sessionCount} sessions.\nPer day:\n${daily}${titles ? `\nRecent window titles: ${titles}` : ''}`
    }
    case 'getBlockAtTime': {
      const b = fact.data as GetBlockAtTimeResult
      if (!b.found || !b.block) return `getBlockAtTime ${q.date} ${q.time}: nothing tracked at that moment.`
      const blk = b.block
      return `getBlockAtTime ${q.date} ${q.time}: ${blk.label} (${fmtClock(blk.startTime)}–${fmtClock(blk.endTime)}, ${fmtDuration(blk.durationSeconds)})${blk.topAppNames.length ? ` [apps: ${blk.topAppNames.join(', ')}]` : ''}${blk.keyPageTitles.length ? ` [pages: ${blk.keyPageTitles.join('; ')}]` : ''}`
    }
    case 'recall': {
      const s = fact.data as SearchSessionsResult
      if (s.hits.length === 0) return `recall "${q.query}": no matching page or session in history.`
      const hits = s.hits.slice(0, 8).map((h) => {
        const where = h.appName
        const title = h.windowTitle || h.excerpt || where
        const url = h.url ? ` — ${h.url}` : ''
        return `  - "${title}" on ${where}, ${h.date} ${fmtClock(h.startTime)}, ${fmtDuration(h.durationSeconds)}${url}`
      }).join('\n')
      return `recall "${q.query}" (${s.matchKind} match):\n${hits}`
    }
    case 'getAttribution': {
      const r = fact.data as GetAttributionResult
      if (r.entity) {
        const e = r.entity
        const recent = e.recentSessions.map((sn) => `${sn.date} ${fmtDuration(sn.totalSeconds)}${sn.label ? ` (${sn.label})` : ''}`).join('; ')
        return `getAttribution entity "${e.entityName}" (${e.entityType}): total ${fmtDuration(e.totalTrackedSeconds)}, last 30 days ${fmtDuration(e.last30DaysSeconds)}.\nRecent: ${recent}`
      }
      if (r.hasClients && r.clients) {
        const ranked = r.clients.attributedClients.map((c) => `${c.clientName}: ${fmtDuration(c.attributedSeconds)} attributed (+${fmtDuration(c.ambiguousSeconds)} ambiguous)`).join('; ')
        const roster = r.clients.clientRoster.map((c) => c.clientName).join(', ')
        return `getAttribution (${r.clients.rangeLabel}): ${ranked || 'no attributed time in range'}.\nRoster: ${roster}`
      }
      // No projects set up — inferred breakdown + setup offer (ai.md §8.2).
      const inferred = (r.inferred ?? []).map((i) => `${i.label} ${fmtDuration(i.totalSeconds)}`).join('; ')
      return `getAttribution: NO clients/projects are set up yet. Inferred breakdown by activity/thread: ${inferred || 'nothing tracked in range'}.\nIMPORTANT: present this inferred breakdown, then offer to set up named projects in Settings so attribution gets sharper. Do not dead-end.`
    }
    case 'listClients': {
      const c = fact.data as ListClientsResult
      if (c.clientRoster.length === 0) return 'listClients: no clients are set up yet. Offer to add them in Settings.'
      const ranked = c.attributedClients.map((x) => `${x.clientName} ${fmtDuration(x.attributedSeconds)}`).join('; ')
      return `listClients (${c.rangeLabel}): roster — ${c.clientRoster.map((x) => x.clientName).join(', ')}.${ranked ? ` Attributed — ${ranked}.` : ''}`
    }
  }
}
