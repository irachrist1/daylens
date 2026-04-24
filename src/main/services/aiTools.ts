// Tool schemas and executor for AI recall queries.
// Imported by: spike scripts (Task C), tool-use integration (Task D),
// MCP server (Task E).
import type Database from 'better-sqlite3'
import {
  getAppSummariesForRange,
  getSessionsForRange,
  getWebsiteSummariesForRange,
  searchSessions as dbSearchSessions,
  searchArtifacts as dbSearchArtifacts,
} from '../db/queries'
import { computeFocusScoreV2 } from '../lib/focusScore'
import {
  findClientByName,
  findProjectByName,
} from '../core/query/attributionResolvers'

// ---------------------------------------------------------------------------
// TypeScript parameter interfaces
// ---------------------------------------------------------------------------

export interface SearchSessionsParams {
  query: string
  startDate?: string  // YYYY-MM-DD local
  endDate?: string    // YYYY-MM-DD local
  limit?: number
}

export interface GetDaySummaryParams {
  date: string  // YYYY-MM-DD local
}

export interface GetAppUsageParams {
  appName: string
  startDate?: string  // YYYY-MM-DD local
  endDate?: string    // YYYY-MM-DD local
}

export interface SearchArtifactsParams {
  query: string
}

export interface GetWeekSummaryParams {
  weekStartDate: string  // YYYY-MM-DD local (Monday of the target week)
}

export interface GetAttributionContextParams {
  entityName: string  // client or project name (partial match accepted)
}

// ---------------------------------------------------------------------------
// TypeScript return interfaces
// ---------------------------------------------------------------------------

export interface SessionSearchHit {
  id: number
  appName: string
  windowTitle: string | null
  startTime: number   // epoch ms
  endTime: number     // epoch ms
  durationSeconds: number
  date: string        // YYYY-MM-DD local
  excerpt: string     // FTS5 snippet with [[mark]]…[[/mark]] highlights
}

export interface SearchSessionsResult {
  hits: SessionSearchHit[]
  totalFound: number  // before limit
}

export interface AppUsageStat {
  appName: string
  bundleId: string
  totalSeconds: number
  sessionCount: number
}

export interface DaySummaryResult {
  date: string
  totalTrackedSeconds: number
  focusSeconds: number
  topApps: AppUsageStat[]
  topWebsiteDomains: { domain: string; totalSeconds: number }[]
  timelineBlockLabels: string[]  // human-readable block labels for the day
  deepWorkSessionCount: number
  longestStreakSeconds: number
}

export interface AppUsageDailyBreakdown {
  date: string
  totalSeconds: number
  sessionCount: number
}

export interface GetAppUsageResult {
  appName: string
  bundleId: string
  totalSeconds: number
  sessionCount: number
  startDate: string
  endDate: string
  dailyBreakdown: AppUsageDailyBreakdown[]
  recentWindowTitles: string[]  // up to 10 most recent distinct window titles
}

export interface ArtifactHit {
  id: number
  title: string
  kind: string      // 'report' | 'chart' | 'csv' | etc.
  summary: string | null
  createdAt: number // epoch ms
  date: string      // YYYY-MM-DD local
}

export interface SearchArtifactsResult {
  hits: ArtifactHit[]
}

export interface DailyBreakdownEntry {
  date: string       // YYYY-MM-DD
  totalSeconds: number
  focusSeconds: number
}

export interface GetWeekSummaryResult {
  weekStart: string  // YYYY-MM-DD
  weekEnd: string    // YYYY-MM-DD
  totalTrackedSeconds: number
  totalFocusSeconds: number
  focusPct: number
  topApps: AppUsageStat[]
  dailyBreakdown: DailyBreakdownEntry[]
  bestDay: { date: string; focusPct: number } | null
  mostActiveDay: { date: string; totalSeconds: number } | null
}

export interface AttributionSession {
  date: string
  totalSeconds: number
  label: string | null
}

export interface GetAttributionContextResult {
  entityName: string
  entityType: 'client' | 'project' | 'unknown'
  matchedEntityId: string | null
  totalTrackedSeconds: number   // across available history
  last30DaysSeconds: number
  recentSessions: AttributionSession[]  // last 10
}

// ---------------------------------------------------------------------------
// JSON Schema — shared property definitions (reused across both formats)
// ---------------------------------------------------------------------------

const DATE_PARAM = {
  type: 'string',
  description: 'Local calendar date in YYYY-MM-DD format (e.g. "2026-04-21").',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
}

const LIMIT_PARAM = {
  type: 'integer',
  description: 'Maximum number of results to return. Defaults to 25, capped at 100.',
  minimum: 1,
  maximum: 100,
}

// ---------------------------------------------------------------------------
// Anthropic tool schemas
// Spec: https://docs.anthropic.com/en/api/messages#tools
// ---------------------------------------------------------------------------

export interface AnthropicTool {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, object>
    required?: string[]
  }
}

export const anthropicTools: AnthropicTool[] = [
  {
    name: 'searchSessions',
    description:
      'Full-text search across app sessions by app name and window title. ' +
      'Use this to find when the user worked in a specific app, on a specific project, ' +
      'or saw a particular window title. Results are sorted by recency.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Keywords to search for in app name and window title. ' +
            'Supports FTS5 operators: AND, OR, NOT, phrase quotes, prefix*.',
        },
        startDate: { ...DATE_PARAM, description: 'Restrict results to sessions starting on or after this date.' },
        endDate: { ...DATE_PARAM, description: 'Restrict results to sessions starting on or before this date.' },
        limit: LIMIT_PARAM,
      },
      required: ['query'],
    },
  },

  {
    name: 'getDaySummary',
    description:
      'Return a structured summary of all tracked activity for a given calendar day: ' +
      'total time, top apps, top websites, timeline block labels, and focus metrics.',
    input_schema: {
      type: 'object',
      properties: {
        date: { ...DATE_PARAM, description: 'The calendar day to summarize.' },
      },
      required: ['date'],
    },
  },

  {
    name: 'getAppUsage',
    description:
      'Return total usage time and session count for a specific application, ' +
      'optionally filtered by date range. Also returns a per-day breakdown ' +
      'and recent window titles so you can infer what the user was doing.',
    input_schema: {
      type: 'object',
      properties: {
        appName: {
          type: 'string',
          description:
            'App display name to look up (case-insensitive partial match, e.g. "Figma", "VS Code", "Chrome").',
        },
        startDate: { ...DATE_PARAM, description: 'Start of the date range (inclusive).' },
        endDate: { ...DATE_PARAM, description: 'End of the date range (inclusive).' },
      },
      required: ['appName'],
    },
  },

  {
    name: 'searchArtifacts',
    description:
      'Search AI-generated artifacts (reports, charts, CSVs, exports) by title and summary. ' +
      'Use this when the user asks about documents or files they generated via the AI.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords to search in artifact title and summary text.',
        },
      },
      required: ['query'],
    },
  },

  {
    name: 'getWeekSummary',
    description:
      'Return a structured summary for a full calendar week (Mon–Sun): ' +
      'total time, focus percentage, top apps, per-day breakdown, best day, and most active day. ' +
      'Use this for questions about "last week", "this week", or week-over-week comparisons.',
    input_schema: {
      type: 'object',
      properties: {
        weekStartDate: {
          ...DATE_PARAM,
          description:
            'The Monday that starts the target week in YYYY-MM-DD format. ' +
            'To get last week, subtract 7 days from today\'s Monday.',
        },
      },
      required: ['weekStartDate'],
    },
  },

  {
    name: 'getAttributionContext',
    description:
      'Return how much time the user has spent on a specific client or project, ' +
      'based on attribution rules and labeled work sessions. ' +
      'Use this for questions like "how long on ClientX" or "Daylens project time this month".',
    input_schema: {
      type: 'object',
      properties: {
        entityName: {
          type: 'string',
          description:
            'Client or project name to look up. Partial, case-insensitive match. ' +
            'Examples: "ClientX", "Daylens", "acme".',
        },
      },
      required: ['entityName'],
    },
  },
]

// ---------------------------------------------------------------------------
// OpenAI function-calling schemas
// Spec: https://platform.openai.com/docs/guides/function-calling
// ---------------------------------------------------------------------------

export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, object>
      required?: string[]
    }
  }
}

export const openaiTools: OpenAITool[] = anthropicTools.map((t) => ({
  type: 'function' as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: {
      type: 'object' as const,
      properties: t.input_schema.properties,
      required: t.input_schema.required ?? [],
    },
  },
}))

// ---------------------------------------------------------------------------
// Tool name union — used for typed dispatch in execution layer
// ---------------------------------------------------------------------------

export type ToolName =
  | 'searchSessions'
  | 'getDaySummary'
  | 'getAppUsage'
  | 'searchArtifacts'
  | 'getWeekSummary'
  | 'getAttributionContext'

// ---------------------------------------------------------------------------
// Executor — main-process only; bridges tool params to real DB queries
// ---------------------------------------------------------------------------

function localDayBounds(dateStr: string): [number, number] {
  const [y, m, d] = dateStr.split('-').map(Number)
  const from = new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
  return [from, from + 86_400_000]
}

function toDateStr(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function execSearchSessions(params: SearchSessionsParams, db: Database.Database): SearchSessionsResult {
  const hits = dbSearchSessions(db, params.query, {
    startDate: params.startDate,
    endDate: params.endDate,
    limit: params.limit ?? 25,
  })
  return {
    hits: hits.map((h) => ({
      id: h.id as number,
      appName: h.appName,
      windowTitle: h.windowTitle,
      startTime: h.startTime,
      endTime: h.endTime,
      durationSeconds: Math.round((h.endTime - h.startTime) / 1000),
      date: h.date,
      excerpt: h.excerpt,
    })),
    totalFound: hits.length,
  }
}

function execGetDaySummary(params: GetDaySummaryParams, db: Database.Database): DaySummaryResult {
  const [fromMs, toMs] = localDayBounds(params.date)
  const summaries = getAppSummariesForRange(db, fromMs, toMs)
  const sessions = getSessionsForRange(db, fromMs, toMs)
  const websites = getWebsiteSummariesForRange(db, fromMs, toMs)
  const totalTrackedSeconds = summaries.reduce((s, a) => s + a.totalSeconds, 0)
  const focusSeconds = summaries.filter((a) => a.isFocused).reduce((s, a) => s + a.totalSeconds, 0)
  const focusScore = computeFocusScoreV2({
    sessions: sessions.map((s) => ({
      startTime: s.startTime,
      endTime: s.endTime,
      durationSeconds: s.durationSeconds,
      category: s.category,
      isFocused: s.isFocused,
    })),
    totalActiveSeconds: totalTrackedSeconds,
  })
  const blockLabels = (db.prepare(`
    SELECT DISTINCT label_current FROM timeline_blocks
    WHERE date = ? AND invalidated_at IS NULL
    ORDER BY start_time ASC LIMIT 20
  `).all(params.date) as { label_current: string }[]).map((r) => r.label_current)
  return {
    date: params.date,
    totalTrackedSeconds,
    focusSeconds,
    topApps: summaries.slice(0, 8).map((a) => ({
      appName: a.appName,
      bundleId: a.bundleId,
      totalSeconds: a.totalSeconds,
      sessionCount: a.sessionCount ?? 0,
    })),
    topWebsiteDomains: websites.slice(0, 5).map((w) => ({ domain: w.domain, totalSeconds: w.totalSeconds })),
    timelineBlockLabels: blockLabels,
    deepWorkSessionCount: focusScore.deepWorkSessionCount,
    longestStreakSeconds: focusScore.longestStreakSeconds,
  }
}

function execGetAppUsage(params: GetAppUsageParams, db: Database.Database): GetAppUsageResult {
  const now = Date.now()
  const fromMs = params.startDate ? localDayBounds(params.startDate)[0] : now - 365 * 86_400_000
  const toMs = params.endDate ? localDayBounds(params.endDate)[1] : now
  const allSummaries = getAppSummariesForRange(db, fromMs, toMs)
  const nameLower = params.appName.toLowerCase()
  const matched = allSummaries.filter((a) => a.appName.toLowerCase().includes(nameLower))
  const totalSeconds = matched.reduce((s, a) => s + a.totalSeconds, 0)
  const sessionCount = matched.reduce((s, a) => s + (a.sessionCount ?? 0), 0)
  const bundleId = matched[0]?.bundleId ?? ''

  // Per-day breakdown via raw query
  const dailyRows = (db.prepare(`
    SELECT
      strftime('%Y-%m-%d', start_time / 1000, 'unixepoch', 'localtime') AS day,
      SUM(duration_sec) AS total_sec,
      COUNT(*) AS session_count
    FROM app_sessions
    WHERE LOWER(app_name) LIKE ?
      AND start_time >= ? AND start_time < ?
    GROUP BY day
    ORDER BY day DESC
    LIMIT 90
  `).all(`%${nameLower}%`, fromMs, toMs) as { day: string; total_sec: number; session_count: number }[])

  // Recent distinct window titles
  const titleRows = (db.prepare(`
    SELECT DISTINCT window_title FROM app_sessions
    WHERE LOWER(app_name) LIKE ? AND window_title IS NOT NULL
      AND start_time >= ? AND start_time < ?
    ORDER BY start_time DESC LIMIT 10
  `).all(`%${nameLower}%`, fromMs, toMs) as { window_title: string }[])

  return {
    appName: matched[0]?.appName ?? params.appName,
    bundleId,
    totalSeconds,
    sessionCount,
    startDate: params.startDate ?? toDateStr(fromMs),
    endDate: params.endDate ?? toDateStr(toMs),
    dailyBreakdown: dailyRows.map((r) => ({ date: r.day, totalSeconds: r.total_sec, sessionCount: r.session_count })),
    recentWindowTitles: titleRows.map((r) => r.window_title),
  }
}

function execSearchArtifacts(params: SearchArtifactsParams, db: Database.Database): SearchArtifactsResult {
  const hits = dbSearchArtifacts(db, params.query)
  return {
    hits: hits.map((h) => ({
      id: h.id as number,
      title: h.title,
      kind: 'report',
      summary: null,
      createdAt: h.startTime,
      date: h.date,
    })),
  }
}

function execGetWeekSummary(params: GetWeekSummaryParams, db: Database.Database): GetWeekSummaryResult {
  const [weekFromMs] = localDayBounds(params.weekStartDate)
  const weekToMs = weekFromMs + 7 * 86_400_000
  const weekEnd = toDateStr(weekToMs - 1)
  const allSummaries = getAppSummariesForRange(db, weekFromMs, weekToMs)
  const allSessions = getSessionsForRange(db, weekFromMs, weekToMs)
  const totalTrackedSeconds = allSummaries.reduce((s, a) => s + a.totalSeconds, 0)
  const totalFocusSeconds = allSummaries.filter((a) => a.isFocused).reduce((s, a) => s + a.totalSeconds, 0)
  const focusPct = totalTrackedSeconds > 0 ? Math.round((totalFocusSeconds / totalTrackedSeconds) * 100) : 0

  // Per-day breakdown from sessions
  const byDay = new Map<string, { totalSeconds: number; focusSeconds: number }>()
  for (let d = 0; d < 7; d++) {
    byDay.set(toDateStr(weekFromMs + d * 86_400_000), { totalSeconds: 0, focusSeconds: 0 })
  }
  for (const s of allSessions) {
    const day = toDateStr(s.startTime)
    const entry = byDay.get(day)
    if (entry) {
      entry.totalSeconds += s.durationSeconds
      if (s.isFocused) entry.focusSeconds += s.durationSeconds
    }
  }
  const dailyBreakdown = [...byDay.entries()].map(([date, v]) => ({ date, ...v }))
  const bestDay = dailyBreakdown.reduce<{ date: string; focusPct: number } | null>((best, d) => {
    const pct = d.totalSeconds > 0 ? Math.round((d.focusSeconds / d.totalSeconds) * 100) : 0
    return !best || pct > best.focusPct ? { date: d.date, focusPct: pct } : best
  }, null)
  const mostActiveDay = dailyBreakdown.reduce<{ date: string; totalSeconds: number } | null>((best, d) => {
    return !best || d.totalSeconds > best.totalSeconds ? { date: d.date, totalSeconds: d.totalSeconds } : best
  }, null)
  return {
    weekStart: params.weekStartDate,
    weekEnd,
    totalTrackedSeconds,
    totalFocusSeconds,
    focusPct,
    topApps: allSummaries.slice(0, 8).map((a) => ({
      appName: a.appName,
      bundleId: a.bundleId,
      totalSeconds: a.totalSeconds,
      sessionCount: a.sessionCount ?? 0,
    })),
    dailyBreakdown,
    bestDay: bestDay?.focusPct === 0 ? null : bestDay,
    mostActiveDay: mostActiveDay?.totalSeconds === 0 ? null : mostActiveDay,
  }
}

function execGetAttributionContext(params: GetAttributionContextParams, db: Database.Database): GetAttributionContextResult {
  const client = findClientByName(params.entityName, db)
  const project = client ? null : findProjectByName(params.entityName, db)
  const entityId = client?.id ?? project?.id ?? null
  const entityType: 'client' | 'project' | 'unknown' = client ? 'client' : project ? 'project' : 'unknown'

  if (!entityId) {
    return {
      entityName: params.entityName,
      entityType: 'unknown',
      matchedEntityId: null,
      totalTrackedSeconds: 0,
      last30DaysSeconds: 0,
      recentSessions: [],
    }
  }

  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 86_400_000
  const idCol = client ? 'client_id' : 'project_id'

  const allRows = db.prepare(`
    SELECT started_at, active_ms, label FROM work_sessions
    WHERE ${idCol} = ? ORDER BY started_at DESC LIMIT 100
  `).all(entityId) as { started_at: number; active_ms: number; label: string | null }[]

  const totalTrackedSeconds = Math.round(allRows.reduce((s, r) => s + r.active_ms, 0) / 1000)
  const last30DaysSeconds = Math.round(allRows.filter((r) => r.started_at >= thirtyDaysAgo).reduce((s, r) => s + r.active_ms, 0) / 1000)
  const recentSessions = allRows.slice(0, 10).map((r) => ({
    date: toDateStr(r.started_at),
    totalSeconds: Math.round(r.active_ms / 1000),
    label: r.label,
  }))

  return {
    entityName: client?.name ?? project?.name ?? params.entityName,
    entityType,
    matchedEntityId: entityId,
    totalTrackedSeconds,
    last30DaysSeconds,
    recentSessions,
  }
}

export type ToolParams =
  | { name: 'searchSessions'; params: SearchSessionsParams }
  | { name: 'getDaySummary'; params: GetDaySummaryParams }
  | { name: 'getAppUsage'; params: GetAppUsageParams }
  | { name: 'searchArtifacts'; params: SearchArtifactsParams }
  | { name: 'getWeekSummary'; params: GetWeekSummaryParams }
  | { name: 'getAttributionContext'; params: GetAttributionContextParams }

export function executeTool(
  name: ToolName,
  params: Record<string, unknown>,
  db: Database.Database,
): unknown {
  switch (name) {
    case 'searchSessions': return execSearchSessions(params as unknown as SearchSessionsParams, db)
    case 'getDaySummary': return execGetDaySummary(params as unknown as GetDaySummaryParams, db)
    case 'getAppUsage': return execGetAppUsage(params as unknown as GetAppUsageParams, db)
    case 'searchArtifacts': return execSearchArtifacts(params as unknown as SearchArtifactsParams, db)
    case 'getWeekSummary': return execGetWeekSummary(params as unknown as GetWeekSummaryParams, db)
    case 'getAttributionContext': return execGetAttributionContext(params as unknown as GetAttributionContextParams, db)
  }
}
