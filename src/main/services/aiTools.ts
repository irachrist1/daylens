// Tool schemas and executor for AI recall queries.
// Imported by: spike scripts (Task C), tool-use integration (Task D),
// MCP server (Task E).
import type Database from 'better-sqlite3'
import type { FunctionDeclaration } from '@google/genai'
import {
  getAppSummariesForRange,
  getSessionsForRange,
  getWebsiteSummariesForRange,
  searchSessions as dbSearchSessions,
  searchBrowser as dbSearchBrowser,
  searchArtifacts as dbSearchArtifacts,
} from '../db/queries'
import { computeFocusScoreV2 } from '../lib/focusScore'
import {
  findClientByName,
  findProjectByName,
  listClients as dbListClients,
  listClientsForRange as dbListClientsForRange,
} from '../core/query/attributionResolvers'
import { searchFileMentions as execSearchFileMentions, type SearchFileMentionsResult } from '../lib/windowTitleFilenames'
import { getTimelineDayPayload, userVisibleLabelForBlock } from './workBlocks'
import { sanitizeToolResult } from '@shared/aiSanitize'

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

export interface GetBlockAtTimeParams {
  date: string  // YYYY-MM-DD local
  time: string  // HH:MM local, 24h
}

export interface ListClientsParams {
  startDate?: string  // YYYY-MM-DD local
  endDate?: string    // YYYY-MM-DD local
}

// ---------------------------------------------------------------------------
// TypeScript return interfaces
// ---------------------------------------------------------------------------

export interface SessionSearchHit {
  id: number
  kind: 'session' | 'page'
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
  // B2: when a strict AND search yields zero hits, the tool broadens to a
  // per-token OR sweep and reports the broadened results with matchKind
  // 'broadened'. This is the signal the model uses to frame the answer as
  // "closest captured signal" (D4) rather than refusing with "I don't see
  // any evidence." matchKind 'strict' = the original query matched as-is.
  matchKind: 'strict' | 'broadened' | 'empty'
  // The tokens the broadened sweep ran (after stripping pipes / punctuation
  // / stopwords). Empty for strict matches. Useful so the model can name
  // exactly which fragment of the user's phrase did match.
  broadenedTokens?: string[]
  // Explicit framing instruction included in the tool result so the model
  // can't sleepwalk into a bare refusal. The instruction tells the model
  // exactly how to phrase the answer and which next tool to call when the
  // current search is empty.
  _instruction?: string
}

export interface AppUsageStat {
  appName: string
  bundleId: string
  totalSeconds: number
  sessionCount: number
  /**
   * The block this app contributed the most time to, when computed against a
   * day's block timeline. Lets D1-compliant answers lead with what was being
   * done ("Kiro — coding in the Building & Testing block") instead of just a
   * duration. Null when no block-aware computation was possible.
   */
  dominantBlockLabel?: string | null
  dominantBlockSeconds?: number
  /** Up to 3 distinct block labels the app appeared in, time-ordered. */
  blockLabels?: string[]
}

/**
 * A single timeline block as the AI should see it: the activity-shaped
 * record (label, time range, what was in it). This is what the model
 * cites in answers. App totals are evidence, not the headline.
 */
export interface DayBlockNarrative {
  blockId: string
  label: string
  /** Renderer-canonical start in HH:MM 24h. */
  startTime: string
  /** Renderer-canonical end in HH:MM 24h. */
  endTime: string
  startMs: number
  endMs: number
  /** Block duration in whole seconds, computed from endMs - startMs. */
  durationSeconds: number
  dominantCategory: string
  /** Up to 4 apps that participated in this block, ordered by time-in-block. */
  appsInBlock: Array<{ appName: string; seconds: number; category: string }>
  /** Up to 4 page titles seen in the block (already URL-sanitized). */
  pageTitles: string[]
  /** Up to 3 artifact titles attached to this block (docs, files referenced). */
  artifactTitles: string[]
}

export interface DaySummaryResult {
  date: string
  /** Activity-shaped primary view of the day. Use this to write answers. */
  blocks: DayBlockNarrative[]
  /**
   * Total tracked seconds across the day. Always equals the sum of block
   * durations — never derived from session sums independently, so the
   * number matches what the renderer shows.
   */
  totalTrackedSeconds: number
  focusSeconds: number
  /**
   * Apps that participated in any block today. Secondary evidence — quote
   * an app total only when it adds clarity to a block-led answer, never
   * as the headline.
   */
  _evidence: {
    topApps: AppUsageStat[]
    topWebsiteDomains: { domain: string; totalSeconds: number }[]
    deepWorkSessionCount: number
    longestStreakSeconds: number
  }
  /** @deprecated — present for back-compat. Use `blocks[].label` instead. */
  timelineBlockLabels: string[]
  /** @deprecated — present for back-compat. Use `_evidence.topApps`. */
  topApps: AppUsageStat[]
  /** @deprecated — present for back-compat. Use `_evidence.topWebsiteDomains`. */
  topWebsiteDomains: { domain: string; totalSeconds: number }[]
  /** @deprecated — present for back-compat. Use `_evidence.deepWorkSessionCount`. */
  deepWorkSessionCount: number
  /** @deprecated — present for back-compat. Use `_evidence.longestStreakSeconds`. */
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

/**
 * Compact daily block narrative for weekly answers. Each entry is
 * sufficient for the model to write "On Monday you spent 09:09–10:08 on
 * 'Building & Testing' with Kiro and Dia." without further tool calls.
 */
export interface WeeklyDayBlockSummary {
  date: string  // YYYY-MM-DD
  /** Up to 6 top blocks for the day, sorted by duration desc. */
  topBlocks: Array<{
    label: string
    startTime: string  // HH:MM
    endTime: string    // HH:MM
    durationSeconds: number
    appsInBlock: string[]  // up to 3 app names
  }>
}

export interface GetWeekSummaryResult {
  weekStart: string  // YYYY-MM-DD
  weekEnd: string    // YYYY-MM-DD
  /** Sum of block durations across the week — matches what the timeline shows. */
  totalTrackedSeconds: number
  totalFocusSeconds: number
  focusPct: number
  /** Activity-shaped primary view: per-day top blocks for narrative grounding. */
  dailyBlockSummaries: WeeklyDayBlockSummary[]
  dailyBreakdown: DailyBreakdownEntry[]
  bestDay: { date: string; focusPct: number } | null
  mostActiveDay: { date: string; totalSeconds: number } | null
  /** Apps that participated across the week. Secondary evidence, not headline. */
  _evidence: {
    topApps: AppUsageStat[]
  }
  /** @deprecated — use `_evidence.topApps`. */
  topApps: AppUsageStat[]
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

export interface GetBlockAtTimeResult {
  /** The calendar day the request was resolved against (YYYY-MM-DD local). */
  date: string
  /** HH:MM the request was resolved to. */
  time: string
  /** True when a covering block was found. False means no block covers `time`. */
  found: boolean
  /** The covering block, when found. */
  block: {
    blockId: string
    label: string
    dominantCategory: string
    startTime: number   // epoch ms
    endTime: number     // epoch ms
    durationSeconds: number
    topAppNames: string[]        // up to 4
    keyPageTitles: string[]       // up to 4, deduped
  } | null
  /** App sessions overlapping the covering block, newest first. Up to 6. */
  overlappingSessions: Array<{
    appName: string
    windowTitle: string | null
    startTime: number
    endTime: number
    durationSeconds: number
  }>
}

export interface ListClientsResult {
  rangeLabel: string  // "all time" | "today" | "YYYY-MM-DD to YYYY-MM-DD"
  /**
   * When present, ranked by attributed time in the window. Each entry is
   * the portfolio payload for that client (attributed_ms, ambiguous_ms,
   * session_count, project_names).
   */
  attributedClients: Array<{
    clientId: string
    clientName: string
    attributedSeconds: number
    ambiguousSeconds: number
    sessionCount: number
    projectNames: string[]
  }>
  /**
   * Always-populated roster from the `clients` table. When
   * `attributedClients` is empty (e.g. the user has clients but no
   * attributed work sessions in the range), the caller should surface this
   * so "who are my clients" does not hallucinate an empty answer.
   */
  clientRoster: Array<{
    clientId: string
    clientName: string
    projectCount: number
  }>
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
      'Full-text search across app sessions and browser page visits by app name, window title, URL, and page title. ' +
      'Use this to find when the user worked in a specific app, on a specific project, ' +
      'studied a topic, consumed web pages, or saw a particular window/page title. Results are sorted by recency.',
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

  {
    name: 'searchFileMentions',
    description:
      'Extract filename-like tokens from window title strings in the tracked sessions. ' +
      'Use this when the user asks which files, documents, or code files they had open. ' +
      'Results are INFERRED from title strings — not from file-system events — so ' +
      'always surface the note field to the user so they understand the evidence level.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { ...DATE_PARAM, description: 'Restrict to sessions starting on or after this date.' },
        endDate: { ...DATE_PARAM, description: 'Restrict to sessions starting on or before this date.' },
      },
      required: [],
    },
  },

  {
    name: 'getBlockAtTime',
    description:
      'Return the timeline work block covering a specific moment. Use this for ' +
      'questions like "what was I doing at 4pm" or "what happened yesterday at 3pm". ' +
      'Returns the covering block plus the app sessions overlapping it. ' +
      'If no block covers the moment, `found` is false — do not fabricate an answer.',
    input_schema: {
      type: 'object',
      properties: {
        date: { ...DATE_PARAM, description: 'Calendar day the moment falls on.' },
        time: {
          type: 'string',
          description: 'Local time in 24-hour HH:MM format (e.g. "16:00" for 4 pm, "09:30" for 9:30 am).',
          pattern: '^\\d{2}:\\d{2}$',
        },
      },
      required: ['date', 'time'],
    },
  },

  {
    name: 'listClients',
    description:
      'Return the list of clients Daylens knows about, optionally ranked by ' +
      'attributed time in a date range. Always returns the full client roster ' +
      'from the clients table as `clientRoster`, and additionally returns ' +
      'ranked usage in `attributedClients` when a date range is given or when ' +
      'the most recent week has attributed sessions. Use this for questions ' +
      'like "who are my clients", "list my clients this month".',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { ...DATE_PARAM, description: 'Start of the attribution window (inclusive). Optional — omit for the full client roster.' },
        endDate: { ...DATE_PARAM, description: 'End of the attribution window (inclusive). Optional — omit for the full client roster.' },
      },
      required: [],
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
// Google (@google/genai) function-calling schemas
// Spec: https://ai.google.dev/gemini-api/docs/function-calling
// The Anthropic input_schema is already OpenAPI-3.0-shaped JSON Schema, which
// is what Gemini accepts as a function declaration's `parameters` field.
// ---------------------------------------------------------------------------

export const googleTools: FunctionDeclaration[] = anthropicTools.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.input_schema as unknown as FunctionDeclaration['parameters'],
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
  | 'searchFileMentions'
  | 'getBlockAtTime'
  | 'listClients'

export interface SearchFileMentionsParams {
  startDate?: string
  endDate?: string
}

export type { SearchFileMentionsResult }

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

function normalizeAppLookupValue(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function appLookupCandidates(app: { appName: string; bundleId: string; canonicalAppId?: string | null }): string[] {
  const pathTail = (value: string | null | undefined): string | null => {
    if (!value) return null
    return value.split(/[\\/]/).filter(Boolean).pop() ?? value
  }
  return [
    app.appName,
    app.bundleId,
    app.canonicalAppId ?? null,
    pathTail(app.bundleId),
    pathTail(app.canonicalAppId ?? null),
  ].filter((value): value is string => !!value)
}

function appMatchesExactly(
  app: { appName: string; bundleId: string; canonicalAppId?: string | null },
  lookup: string,
): boolean {
  return appLookupCandidates(app).some((value) => normalizeAppLookupValue(value) === lookup)
}

function appMatchesLoosely(
  app: { appName: string; bundleId: string; canonicalAppId?: string | null },
  lookup: string,
): boolean {
  return appLookupCandidates(app).some((value) => {
    const normalized = normalizeAppLookupValue(value)
    if (!normalized) return false
    if (normalized.includes(lookup)) return true
    return normalized.length >= 4 && lookup.includes(normalized)
  })
}

function sessionIdentityWhereClause(canonicalIds: string[], bundleIds: string[]): { clause: string; params: string[] } {
  const clauses: string[] = []
  const params: string[] = []
  if (canonicalIds.length > 0) {
    clauses.push(`canonical_app_id IN (${canonicalIds.map(() => '?').join(', ')})`)
    params.push(...canonicalIds)
  }
  if (bundleIds.length > 0) {
    clauses.push(`bundle_id IN (${bundleIds.map(() => '?').join(', ')})`)
    params.push(...bundleIds)
  }
  return {
    clause: clauses.length > 0 ? `(${clauses.join(' OR ')})` : '0',
    params,
  }
}

// B2: words that look like tab-title noise rather than meaningful entities.
// Stripping these before broadening keeps the OR sweep focused on the parts
// of the user's phrase a colleague would actually search for.
const SEARCH_STOPWORDS = new Set([
  'a', 'an', 'and', 'around', 'at', 'by', 'for', 'from', 'in', 'into', 'of',
  'on', 'or', 'the', 'to', 'was', 'what', 'when', 'where', 'with',
])

function tokenizeForBroadenedSearch(query: string): string[] {
  return query
    .toLowerCase()
    // Tab-title joiners and bracket characters: keep the meaningful words,
    // drop the join syntax. "W2_Reading | Intro to ML | Perusall" should
    // search for "Perusall" and "Reading", not for the literal "|".
    .replace(/[|()[\]{}"'`,;:!?]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !SEARCH_STOPWORDS.has(token))
}

function execSearchSessions(params: SearchSessionsParams, db: Database.Database): SearchSessionsResult {
  const limit = params.limit ?? 25
  const searchOpts = { startDate: params.startDate, endDate: params.endDate, limit }

  const mapSessionHit = (h: { id: number; appName: string; windowTitle: string | null; startTime: number; endTime: number; date: string; excerpt: string | null }): SessionSearchHit => ({
    id: h.id,
    kind: 'session',
    appName: h.appName,
    windowTitle: h.windowTitle,
    startTime: h.startTime,
    endTime: h.endTime,
    durationSeconds: Math.round((h.endTime - h.startTime) / 1000),
    date: h.date,
    excerpt: h.excerpt ?? h.windowTitle ?? h.appName,
  })

  const mapBrowserHit = (h: { id: number; domain: string; pageTitle: string | null; url: string | null; startTime: number; endTime: number; date: string; excerpt: string }): SessionSearchHit => ({
    id: h.id,
    kind: 'page',
    appName: h.domain,
    windowTitle: h.pageTitle,
    startTime: h.startTime,
    endTime: h.endTime,
    durationSeconds: Math.max(0, Math.round((h.endTime - h.startTime) / 1000)),
    date: h.date,
    excerpt: h.excerpt ?? h.pageTitle ?? h.url ?? h.domain,
  })

  // B2: search both app_sessions_fts and website_visits_fts so the AI can
  // cite specific page titles (e.g. Coursera lesson names), not just app names.
  const strictSessions = dbSearchSessions(db, params.query, searchOpts)
  const strictPages = dbSearchBrowser(db, params.query, searchOpts)
  const strictHits = [
    ...strictSessions.map(mapSessionHit),
    ...strictPages.map(mapBrowserHit),
  ].sort((a, b) => b.startTime - a.startTime).slice(0, limit)

  if (strictHits.length > 0) {
    return {
      hits: strictHits,
      totalFound: strictHits.length,
      matchKind: 'strict',
      _instruction: `Strict match for "${params.query}" — answer directly from these hits. Hits tagged kind:'page' are specific web pages with titles; cite those titles when answering learning/topic questions.`,
    }
  }

  // B2: strict AND yielded nothing across both surfaces. Broaden by
  // searching each meaningful token individually and merging.
  const tokens = tokenizeForBroadenedSearch(params.query)
  if (tokens.length === 0) {
    return {
      hits: [],
      totalFound: 0,
      matchKind: 'empty',
      _instruction: `Closest captured signal for "${params.query}": the phrase did not contain searchable session/page tokens. Call getDaySummary (today) or getBlockAtTime if the user named a time, then answer from captured evidence. Refusal-style wording is banned.`,
    }
  }
  const byKey = new Map<string, SessionSearchHit>()
  const tokenMatches: Record<string, number> = {}
  for (const token of tokens) {
    if (byKey.size >= limit) break
    const remaining = limit - byKey.size
    const partialSessions = dbSearchSessions(db, token, { ...searchOpts, limit: remaining })
    const partialPages = dbSearchBrowser(db, token, { ...searchOpts, limit: remaining })
    tokenMatches[token] = partialSessions.length + partialPages.length
    for (const hit of partialSessions) {
      const key = `session:${hit.id}`
      if (byKey.has(key)) continue
      byKey.set(key, mapSessionHit(hit))
      if (byKey.size >= limit) break
    }
    if (byKey.size >= limit) break
    for (const hit of partialPages) {
      const key = `page:${hit.id}`
      if (byKey.has(key)) continue
      byKey.set(key, mapBrowserHit(hit))
      if (byKey.size >= limit) break
    }
  }
  const merged = Array.from(byKey.values()).sort((a, b) => b.startTime - a.startTime)
  const matchKind: 'broadened' | 'empty' = merged.length > 0 ? 'broadened' : 'empty'
  const matchedTokens = Object.entries(tokenMatches).filter(([, n]) => n > 0).map(([t]) => t)
  const instruction = matchKind === 'broadened'
    ? `Closest captured signal for "${params.query}": strict phrase search missed, so Daylens broadened to tokens ${matchedTokens.map((t) => `"${t}"`).join(', ')}. These hits ARE the evidence. Hits tagged kind:'page' are specific web pages; cite their titles and dates. Frame as: "Closest captured signal for ${matchedTokens[0]}…" Refusal-style wording is banned; answer from captured evidence.`
    : `Closest captured signal for "${params.query}": broadening across tokens ${tokens.map((t) => `"${t}"`).join(', ')} did not surface direct session/page hits. Call getDaySummary (today) or getBlockAtTime if a time was named, then answer from captured evidence for the relevant time range. Refusal-style wording is banned.`
  return {
    hits: merged,
    totalFound: merged.length,
    matchKind,
    broadenedTokens: tokens,
    _instruction: instruction,
  } as SearchSessionsResult & { _instruction?: string }
}

function fmtHHMM(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function execGetDaySummary(params: GetDaySummaryParams, db: Database.Database): DaySummaryResult {
  const [fromMs, toMs] = localDayBounds(params.date)
  const summaries = getAppSummariesForRange(db, fromMs, toMs)
  const sessions = getSessionsForRange(db, fromMs, toMs)
  const websites = getWebsiteSummariesForRange(db, fromMs, toMs)
  const focusScore = computeFocusScoreV2({
    sessions: sessions.map((s) => ({
      startTime: s.startTime,
      endTime: s.endTime,
      durationSeconds: s.durationSeconds,
      category: s.category,
      isFocused: s.isFocused,
    })),
    totalActiveSeconds: summaries.reduce((s, a) => s + a.totalSeconds, 0),
  })
  // Block labels and timings come from the renderer's live path so the
  // AI cites what the user saw. See docs/AI-FIX-STRATEGY.md §Problem 1.
  const livePayload = getTimelineDayPayload(db, params.date, null)

  // Build the activity-shaped primary view. Every block answers "what
  // were you doing between A and B" with exact HH:MM bounds — these are
  // the strings the model must cite verbatim for D3 (minute precision).
  const seenLabels = new Set<string>()
  const blocks: DayBlockNarrative[] = []
  for (const block of livePayload.blocks) {
    const label = userVisibleLabelForBlock(block)
    if (!label) continue
    const startMs = block.startTime
    const endMs = block.endTime
    // Block duration is end - start of the rendered block, never a sum
    // of session durations. The renderer is the source of truth here so
    // the AI and the UI agree to the minute.
    const durationSeconds = Math.max(0, Math.round((endMs - startMs) / 1000))
    const appsInBlock = block.topApps
      .filter((a) => a.category !== 'system')
      .slice(0, 4)
      .map((a) => ({
        appName: a.appName,
        seconds: Math.max(0, Math.round(a.totalSeconds)),
        category: a.category,
      }))
    const pageTitles: string[] = []
    const seenPages = new Set<string>()
    for (const page of block.pageRefs) {
      const title = sanitizeKeyPageTitle(page)
      if (!title) continue
      const k = title.toLowerCase()
      if (seenPages.has(k)) continue
      seenPages.add(k)
      pageTitles.push(title)
      if (pageTitles.length >= 4) break
    }
    const artifactTitles: string[] = []
    for (const artifact of block.topArtifacts ?? []) {
      const t = (artifact as { displayTitle?: string; title?: string }).displayTitle
        ?? (artifact as { title?: string }).title
      if (!t) continue
      artifactTitles.push(t)
      if (artifactTitles.length >= 3) break
    }
    blocks.push({
      blockId: block.id,
      label,
      startTime: fmtHHMM(startMs),
      endTime: fmtHHMM(endMs),
      startMs,
      endMs,
      durationSeconds,
      dominantCategory: block.dominantCategory,
      appsInBlock,
      pageTitles,
      artifactTitles,
    })
    seenLabels.add(label)
  }

  // Total tracked seconds is the sum of block durations — guarantees
  // the AI's daily total matches the timeline view. App-summary sums
  // can disagree with block sums due to overlap/idle gaps.
  const totalTrackedSeconds = blocks.reduce((acc, b) => acc + b.durationSeconds, 0)
  const focusSeconds = summaries.filter((a) => a.isFocused).reduce((s, a) => s + a.totalSeconds, 0)

  // Per-app activity: which block did the app contribute most time to?
  // Lets D1-compliant answers lead with "Kiro — coding in the Building &
  // Testing block (1h 19m)" instead of "Kiro — 1h 19m". Without this the
  // model has app totals but no narrative to attach to each app row.
  const appToBlockSeconds = new Map<string, Map<string, number>>()
  for (const block of blocks) {
    for (const app of block.appsInBlock) {
      const inner = appToBlockSeconds.get(app.appName) ?? new Map<string, number>()
      inner.set(block.label, (inner.get(block.label) ?? 0) + app.seconds)
      appToBlockSeconds.set(app.appName, inner)
    }
  }
  const topApps = summaries.slice(0, 8).map((a) => {
    const blockMap = appToBlockSeconds.get(a.appName)
    const ranked = blockMap
      ? [...blockMap.entries()].sort((x, y) => y[1] - x[1])
      : []
    const primary = ranked[0]
    const dominantBlockLabel = primary?.[0] ?? null
    const dominantBlockSeconds = primary?.[1] ?? 0
    const blockLabels = ranked.slice(0, 3).map(([label]) => label)
    return {
      appName: a.appName,
      bundleId: a.bundleId,
      totalSeconds: a.totalSeconds,
      sessionCount: a.sessionCount ?? 0,
      dominantBlockLabel,
      dominantBlockSeconds,
      blockLabels,
    }
  })
  const topWebsiteDomains = websites.slice(0, 5).map((w) => ({ domain: w.domain, totalSeconds: w.totalSeconds }))

  return {
    date: params.date,
    blocks,
    totalTrackedSeconds,
    focusSeconds,
    _evidence: {
      topApps,
      topWebsiteDomains,
      deepWorkSessionCount: focusScore.deepWorkSessionCount,
      longestStreakSeconds: focusScore.longestStreakSeconds,
    },
    // Back-compat shims so any in-flight code that still reads the flat
    // shape doesn't break. New code should read `blocks` and `_evidence`.
    timelineBlockLabels: [...seenLabels].slice(0, 20),
    topApps,
    topWebsiteDomains,
    deepWorkSessionCount: focusScore.deepWorkSessionCount,
    longestStreakSeconds: focusScore.longestStreakSeconds,
  }
}

function execGetAppUsage(params: GetAppUsageParams, db: Database.Database): GetAppUsageResult {
  const now = Date.now()
  const fromMs = params.startDate ? localDayBounds(params.startDate)[0] : now - 365 * 86_400_000
  const toMs = params.endDate ? localDayBounds(params.endDate)[1] : now
  const allSummaries = getAppSummariesForRange(db, fromMs, toMs)
  const lookup = normalizeAppLookupValue(params.appName)
  const exactMatches = lookup
    ? allSummaries.filter((app) => appMatchesExactly(app, lookup))
    : []
  const matched = exactMatches.length > 0
    ? exactMatches
    : lookup
      ? allSummaries.filter((app) => appMatchesLoosely(app, lookup))
      : []
  const totalSeconds = matched.reduce((s, a) => s + a.totalSeconds, 0)
  const sessionCount = matched.reduce((s, a) => s + (a.sessionCount ?? 0), 0)
  const bundleId = matched[0]?.bundleId ?? ''

  // B4: daily breakdown must come from getAppSummariesForRange (the canonical
  // source) so per-day numbers agree with the Apps rail and detail header.
  // A lightweight query finds candidate days; actual totals come from the
  // canonical path which applies UX-noise filtering, canonical-app collapsing,
  // session merging, and range clipping.
  const matchedCanonicalIds = [...new Set(matched.map((a) => a.canonicalAppId).filter((id): id is string => !!id))]
  const matchedBundleIds = [...new Set(matched.map((a) => a.bundleId).filter(Boolean))]
  const identityFilter = sessionIdentityWhereClause(matchedCanonicalIds, matchedBundleIds)
  const candidateDays = matched.length === 0 ? [] : (db.prepare(`
    SELECT DISTINCT strftime('%Y-%m-%d', start_time / 1000, 'unixepoch', 'localtime') AS day
    FROM app_sessions
    WHERE start_time >= ? AND start_time < ?
      AND ${identityFilter.clause}
    ORDER BY day DESC
    LIMIT 90
  `).all(fromMs, toMs, ...identityFilter.params) as { day: string }[])
  const dailyBreakdown = candidateDays
    .map(({ day }) => {
      const [dayFrom, dayTo] = localDayBounds(day)
      const daySummaries = getAppSummariesForRange(db, dayFrom, dayTo)
      const dayMatched = daySummaries.filter((a) => a.canonicalAppId && matchedCanonicalIds.includes(a.canonicalAppId))
      return {
        date: day,
        totalSeconds: dayMatched.reduce((s, a) => s + a.totalSeconds, 0),
        sessionCount: dayMatched.reduce((s, a) => s + (a.sessionCount ?? 0), 0),
      }
    })
    .filter((d) => d.totalSeconds > 0)

  // Recent distinct window titles
  const titleRows = matched.length === 0 ? [] : (db.prepare(`
    SELECT DISTINCT window_title FROM app_sessions
    WHERE window_title IS NOT NULL
      AND start_time >= ? AND start_time < ?
      AND ${identityFilter.clause}
    ORDER BY start_time DESC LIMIT 10
  `).all(fromMs, toMs, ...identityFilter.params) as { window_title: string }[])

  return {
    appName: matched[0]?.appName ?? params.appName,
    bundleId,
    totalSeconds,
    sessionCount,
    startDate: params.startDate ?? toDateStr(fromMs),
    endDate: params.endDate ?? toDateStr(toMs),
    dailyBreakdown,
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
  const totalFocusSeconds = allSummaries.filter((a) => a.isFocused).reduce((s, a) => s + a.totalSeconds, 0)

  // Build per-day block summaries from the renderer's live path. This is
  // the activity-shaped view that lets weekly answers say
  // "On Monday from 09:09 to 10:08 you were in 'Building & Testing'…"
  // without further tool calls.
  const dailyBlockSummaries: WeeklyDayBlockSummary[] = []
  const dailyBreakdown: DailyBreakdownEntry[] = []
  let totalTrackedSeconds = 0
  for (let d = 0; d < 7; d++) {
    const dayStr = toDateStr(weekFromMs + d * 86_400_000)
    const livePayload = getTimelineDayPayload(db, dayStr, null)
    const dayBlocks = livePayload.blocks
      .map((block) => {
        const startMs = block.startTime
        const endMs = block.endTime
        return {
          label: userVisibleLabelForBlock(block),
          startTime: fmtHHMM(startMs),
          endTime: fmtHHMM(endMs),
          durationSeconds: Math.max(0, Math.round((endMs - startMs) / 1000)),
          appsInBlock: block.topApps.filter((a) => a.category !== 'system').slice(0, 3).map((a) => a.appName),
        }
      })
      .filter((b) => b.label && b.durationSeconds > 0)
    const dayTotalSeconds = dayBlocks.reduce((acc, b) => acc + b.durationSeconds, 0)
    totalTrackedSeconds += dayTotalSeconds
    dailyBlockSummaries.push({
      date: dayStr,
      topBlocks: dayBlocks.sort((a, b) => b.durationSeconds - a.durationSeconds).slice(0, 6),
    })
    // Focus seconds per day still come from session-level focus categorisation.
    const daySessions = livePayload.blocks.flatMap((b) => b.sessions)
    const dayFocusSeconds = daySessions
      .filter((s) => s.isFocused)
      .reduce((acc, s) => acc + s.durationSeconds, 0)
    dailyBreakdown.push({ date: dayStr, totalSeconds: dayTotalSeconds, focusSeconds: dayFocusSeconds })
  }

  const focusPct = totalTrackedSeconds > 0 ? Math.round((totalFocusSeconds / totalTrackedSeconds) * 100) : 0
  const bestDay = dailyBreakdown.reduce<{ date: string; focusPct: number } | null>((best, d) => {
    const pct = d.totalSeconds > 0 ? Math.round((d.focusSeconds / d.totalSeconds) * 100) : 0
    return !best || pct > best.focusPct ? { date: d.date, focusPct: pct } : best
  }, null)
  const mostActiveDay = dailyBreakdown.reduce<{ date: string; totalSeconds: number } | null>((best, d) => {
    return !best || d.totalSeconds > best.totalSeconds ? { date: d.date, totalSeconds: d.totalSeconds } : best
  }, null)
  const topApps = allSummaries.slice(0, 8).map((a) => ({
    appName: a.appName,
    bundleId: a.bundleId,
    totalSeconds: a.totalSeconds,
    sessionCount: a.sessionCount ?? 0,
  }))
  return {
    weekStart: params.weekStartDate,
    weekEnd,
    totalTrackedSeconds,
    totalFocusSeconds,
    focusPct,
    dailyBlockSummaries,
    dailyBreakdown,
    bestDay: bestDay?.focusPct === 0 ? null : bestDay,
    mostActiveDay: mostActiveDay?.totalSeconds === 0 ? null : mostActiveDay,
    _evidence: { topApps },
    topApps,
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

// ---------------------------------------------------------------------------
// Block-at-time tool
// ---------------------------------------------------------------------------

function looksLikeUrlFragment(value: string): boolean {
  if (/^https?:\/\//i.test(value)) return true
  // Long opaque tokens (>= 16 chars, no spaces, mixed case + digits) are
  // typically URL path segments or query strings — never useful entity names.
  const stripped = value.trim()
  if (!stripped.includes(' ') && stripped.length >= 24 && /^[A-Za-z0-9_\-./?&=%]+$/.test(stripped)) return true
  // Pure base64-ish or hash-ish blobs.
  if (/^[A-Za-z0-9+/=_-]{20,}$/.test(stripped) && !/\s/.test(stripped)) return true
  return false
}

interface PageRefLike {
  pageTitle?: string | null
  displayTitle?: string
  subtitle?: string | null
  host?: string | null
  url?: string | null
}

function sanitizeKeyPageTitle(page: PageRefLike): string | null {
  const candidates = [page.pageTitle, page.displayTitle]
  for (const raw of candidates) {
    if (!raw) continue
    const value = String(raw).trim()
    if (!value) continue
    if (looksLikeUrlFragment(value)) continue
    return value
  }
  const domain = (page.host ?? page.subtitle ?? '').trim()
  if (domain) return `${domain} (no page title captured)`
  return null
}

function execGetBlockAtTime(params: GetBlockAtTimeParams, db: Database.Database): GetBlockAtTimeResult {
  const { date, time } = params
  const [fromMs] = localDayBounds(date)
  const match = time.match(/^(\d{1,2}):(\d{2})$/)
  const hour = match ? Math.min(23, Math.max(0, Number(match[1]))) : 0
  const minute = match ? Math.min(59, Math.max(0, Number(match[2]))) : 0
  const momentMs = fromMs + hour * 3_600_000 + minute * 60_000

  const payload = getTimelineDayPayload(db, date, null)
  const covering = payload.blocks.find((block) => block.startTime <= momentMs && block.endTime >= momentMs)

  if (!covering) {
    return {
      date,
      time,
      found: false,
      block: null,
      overlappingSessions: [],
    }
  }

  const label = userVisibleLabelForBlock(covering)
  const topAppNames = covering.topApps
    .filter((app) => app.category !== 'system')
    .slice(0, 4)
    .map((app) => app.appName)

  const seenTitles = new Set<string>()
  const keyPageTitles: string[] = []
  for (const page of covering.pageRefs) {
    const title = sanitizeKeyPageTitle(page)
    if (!title) continue
    const lower = title.toLowerCase()
    if (seenTitles.has(lower)) continue
    seenTitles.add(lower)
    keyPageTitles.push(title)
    if (keyPageTitles.length >= 4) break
  }

  // Overlapping sessions — newest first, capped at 6.
  const overlapping = covering.sessions
    .filter((session) => {
      const end = session.endTime ?? (session.startTime + session.durationSeconds * 1000)
      return end >= momentMs - 30 * 60_000 && session.startTime <= momentMs + 30 * 60_000
    })
    .sort((left, right) => right.startTime - left.startTime)
    .slice(0, 6)
    .map((session) => ({
      appName: session.appName,
      windowTitle: session.windowTitle ?? null,
      startTime: session.startTime,
      endTime: session.endTime ?? (session.startTime + session.durationSeconds * 1000),
      durationSeconds: session.durationSeconds,
    }))

  return {
    date,
    time,
    found: true,
    block: {
      blockId: covering.id,
      label,
      dominantCategory: covering.dominantCategory,
      startTime: covering.startTime,
      endTime: covering.endTime,
      durationSeconds: Math.max(0, Math.round((covering.endTime - covering.startTime) / 1000)),
      topAppNames,
      keyPageTitles,
    },
    overlappingSessions: overlapping,
  }
}

// ---------------------------------------------------------------------------
// List-clients tool
// ---------------------------------------------------------------------------

function execListClients(params: ListClientsParams, db: Database.Database): ListClientsResult {
  const roster = dbListClients(db).map((row) => ({
    clientId: row.id,
    clientName: row.name,
    projectCount: row.projectCount,
  }))

  const hasRange = !!params.startDate && !!params.endDate
  let rangeLabel = 'all time'
  let attributed: ListClientsResult['attributedClients'] = []

  if (hasRange && params.startDate && params.endDate) {
    const [fromMs] = localDayBounds(params.startDate)
    const [, toMs] = localDayBounds(params.endDate)
    const portfolio = dbListClientsForRange(fromMs, toMs, db)
    attributed = portfolio.map((entry) => ({
      clientId: entry.client_id,
      clientName: entry.client_name,
      attributedSeconds: Math.round(entry.attributed_ms / 1000),
      ambiguousSeconds: Math.round(entry.ambiguous_ms / 1000),
      sessionCount: entry.session_count,
      projectNames: entry.project_names,
    }))
    rangeLabel = `${params.startDate} to ${params.endDate}`
  } else {
    // No range — still try to surface last-7-days attribution so the answer
    // has recency when possible. If there's nothing there, just return the
    // roster.
    const now = Date.now()
    const fromMs = now - 7 * 86_400_000
    const portfolio = dbListClientsForRange(fromMs, now, db)
    if (portfolio.length > 0) {
      attributed = portfolio.map((entry) => ({
        clientId: entry.client_id,
        clientName: entry.client_name,
        attributedSeconds: Math.round(entry.attributed_ms / 1000),
        ambiguousSeconds: Math.round(entry.ambiguous_ms / 1000),
        sessionCount: entry.session_count,
        projectNames: entry.project_names,
      }))
      rangeLabel = 'last 7 days'
    }
  }

  return {
    rangeLabel,
    attributedClients: attributed,
    clientRoster: roster,
  }
}

export type ToolParams =
  | { name: 'searchSessions'; params: SearchSessionsParams }
  | { name: 'getDaySummary'; params: GetDaySummaryParams }
  | { name: 'getAppUsage'; params: GetAppUsageParams }
  | { name: 'searchArtifacts'; params: SearchArtifactsParams }
  | { name: 'getWeekSummary'; params: GetWeekSummaryParams }
  | { name: 'getAttributionContext'; params: GetAttributionContextParams }
  | { name: 'searchFileMentions'; params: SearchFileMentionsParams }
  | { name: 'getBlockAtTime'; params: GetBlockAtTimeParams }
  | { name: 'listClients'; params: ListClientsParams }

export function executeTool(
  name: ToolName,
  params: Record<string, unknown>,
  db: Database.Database,
): unknown {
  // Every tool result passes through sanitizeToolResult before leaving the
  // executor: deep-walks every string field and strips OAuth tokens, JWTs,
  // hex blobs, base64 blobs, and URL query strings. This is the load-bearing
  // defense against the OAuth-callback leak repro from V1-PHASE-6-AI §1.
  // sanitizeForRender (renderer streaming path) is the second backstop.
  const raw = (() => {
    switch (name) {
      case 'searchSessions': return execSearchSessions(params as unknown as SearchSessionsParams, db)
      case 'getDaySummary': return execGetDaySummary(params as unknown as GetDaySummaryParams, db)
      case 'getAppUsage': return execGetAppUsage(params as unknown as GetAppUsageParams, db)
      case 'searchArtifacts': return execSearchArtifacts(params as unknown as SearchArtifactsParams, db)
      case 'getWeekSummary': return execGetWeekSummary(params as unknown as GetWeekSummaryParams, db)
      case 'getAttributionContext': return execGetAttributionContext(params as unknown as GetAttributionContextParams, db)
      case 'searchFileMentions': return execSearchFileMentions(db, params as unknown as SearchFileMentionsParams)
      case 'getBlockAtTime': return execGetBlockAtTime(params as unknown as GetBlockAtTimeParams, db)
      case 'listClients': return execListClients(params as unknown as ListClientsParams, db)
    }
  })()
  return sanitizeToolResult(raw)
}
