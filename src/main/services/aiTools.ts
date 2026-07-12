// Resolver bodies for the AI tab (ADR 0002). The `exec*` functions are the
// deterministic data functions the app owns; they're wrapped by the typed
// resolver set in `ai/resolvers.ts` (getDay/getRange/getApp/getBlockAtTime/
// recall/getAttribution/listClients). The model never executes them — it only
// selects/parameterizes (the planner) and phrases their output. The old
// model-facing tool schemas + agentic tool-loop were deleted with DEV-90.
// `executeTool` remains as a typed name→resolver dispatch for tests/the MCP layer.
import type Database from 'better-sqlite3'
import {
  getReconciledDomainIntervals,
  getWebsiteSummariesForRange,
  searchSessions as dbSearchSessions,
  searchBrowser as dbSearchBrowser,
  searchArtifacts as dbSearchArtifacts,
} from '../db/queries'
// AI facts read the corrected activity truth (invariant 7): a Timeline block
// the user deleted is subtracted from every total the AI quotes, so the AI
// never contradicts the Timeline or the Apps view.
import {
  getCorrectedAppSummariesForRange as getAppSummariesForRange,
  getCorrectedSessionsForRange as getSessionsForRange,
  getIgnoredBlockSpansForRange,
} from './activityFacts'
import { localDateString } from '../lib/localDate'
import { computeFocusScoreV2 } from '../lib/focusScore'
import {
  findClientByName,
  findProjectByName,
  listClients as dbListClients,
  listClientsForRange as dbListClientsForRange,
} from '../core/query/attributionResolvers'
import { searchFileMentions as execSearchFileMentions } from '../lib/windowTitleFilenames'
import { getTimelineDayPayload, userVisibleLabelForBlock } from './workBlocks'
import { sanitizeToolResult } from '@shared/aiSanitize'
import { filterTrackingExcludedEvidence } from '@shared/evidencePrivacy'
import { trackingControlsStateFromSettings, type TrackingControlsState } from '@shared/trackingControls'
import { getSettings } from './settings'

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

interface SearchArtifactsParams {
  query: string
}

interface GetWeekSummaryParams {
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
  /** The page URL for kind:'page' hits — what link recall (ai.md §8.1) returns
   *  to the user. Null for app-session hits. */
  url?: string | null
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

interface AppUsageStat {
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

interface AppUsageDailyBreakdown {
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
  /** True when the answer came from website_visits (a site, e.g. youtube.com)
   *  rather than app sessions. Site time sums every visit, which includes a tab
   *  left open/playing in the background while other work was in the foreground —
   *  so the phrase step discloses that rather than implying pure active watching. */
  fromWebsiteVisits?: boolean
}

interface ArtifactHit {
  id: number
  title: string
  kind: string      // 'report' | 'chart' | 'csv' | etc.
  summary: string | null
  createdAt: number // epoch ms
  date: string      // YYYY-MM-DD local
}

interface SearchArtifactsResult {
  hits: ArtifactHit[]
}

interface DailyBreakdownEntry {
  date: string       // YYYY-MM-DD
  totalSeconds: number
  focusSeconds: number
}

/**
 * Compact daily block narrative for weekly answers. Each entry is
 * sufficient for the model to write "On Monday you spent 09:09–10:08 on
 * 'Building & Testing' with Kiro and Dia." without further tool calls.
 */
interface WeeklyDayBlockSummary {
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

interface GetWeekSummaryResult {
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

interface AttributionSession {
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
  // When the name matches no client/project, the AI must NOT dead-end (settings
  // spec §5 / ai §8.2). These give it an inferred breakdown to answer from and a
  // hint to offer setting the entity up as a client in Settings.
  inferredActivity?: Array<{ label: string; date: string; durationSeconds: number }>
  setupHint?: string
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

interface SearchFileMentionsParams {
  startDate?: string
  endDate?: string
}

// ---------------------------------------------------------------------------
// Executor — main-process only; bridges tool params to real DB queries
// ---------------------------------------------------------------------------

export function localDayBounds(dateStr: string): [number, number] {
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

// Per-domain time + visit counts from website_visits, the same table the ⌘K
// search and the Apps "sites under a browser" view read. Matches a site lookup
// ("youtube", "youtube.com") against tracked domains and their subdomains, so
// "how many hours on youtube" stops answering "zero" when the visits are right
// there. Returns null when no tracked domain matches.
interface SiteUsageAgg {
  domain: string
  totalSeconds: number
  visitCount: number
  dailyBreakdown: { date: string; totalSeconds: number; sessionCount: number }[]
  titles: string[]
}

function aggregateSiteUsage(
  db: Database.Database,
  lookupRaw: string,
  fromMs: number,
  toMs: number,
): SiteUsageAgg | null {
  const needle = normalizeAppLookupValue(lookupRaw)
  if (!needle || needle.length < 3) return null

  const domainRows = db.prepare(`
    SELECT DISTINCT domain FROM website_visits
    WHERE visit_time >= ? AND visit_time < ? AND domain IS NOT NULL AND domain != ''
  `).all(fromMs, toMs) as { domain: string }[]

  const matchedDomains = domainRows
    .map((r) => r.domain)
    .filter((domain) => {
      const dn = normalizeAppLookupValue(domain)
      if (!dn) return false
      if (dn === needle) return true
      if (needle.length >= 4 && dn.includes(needle)) return true
      if (dn.length >= 4 && needle.includes(dn)) return true
      return false
    })
  if (matchedDomains.length === 0) return null

  const placeholders = matchedDomains.map(() => '?').join(', ')

  // Visit COUNT stays a raw navigation count, but the TIME is reconciled:
  // raw SUM(duration_sec) double-counts the two capture sources and keeps
  // crediting background tabs, so the AI's "how long on youtube" answer
  // disagreed with every other surface (invariant 7).
  const wanted = new Set(matchedDomains)
  const daySeconds = new Map<string, number>()
  for (const interval of getReconciledDomainIntervals(db, fromMs, toMs, (domain) => wanted.has(domain))) {
    const day = localDateString(new Date(interval.start))
    daySeconds.set(day, (daySeconds.get(day) ?? 0) + (interval.end - interval.start) / 1000)
  }

  const visitRows = db.prepare(`
    SELECT strftime('%Y-%m-%d', visit_time / 1000, 'unixepoch', 'localtime') AS day,
           COUNT(*) AS visits
    FROM website_visits
    WHERE visit_time >= ? AND visit_time < ? AND domain IN (${placeholders})
    GROUP BY day ORDER BY day DESC
  `).all(fromMs, toMs, ...matchedDomains) as { day: string; visits: number }[]

  const visitsByDay = new Map(visitRows.map((r) => [r.day, r.visits ?? 0]))
  const allDays = [...new Set([...daySeconds.keys(), ...visitsByDay.keys()])].sort().reverse()

  const totalSeconds = Math.round([...daySeconds.values()].reduce((s, v) => s + v, 0))
  const visitCount = visitRows.reduce((s, r) => s + (r.visits ?? 0), 0)
  if (visitCount <= 0) return null

  const titleRows = db.prepare(`
    SELECT DISTINCT page_title FROM website_visits
    WHERE visit_time >= ? AND visit_time < ? AND domain IN (${placeholders})
      AND page_title IS NOT NULL AND page_title != ''
    ORDER BY visit_time DESC LIMIT 10
  `).all(fromMs, toMs, ...matchedDomains) as { page_title: string }[]

  return {
    // Show the shortest matched domain — usually the registrable host (youtube.com).
    domain: matchedDomains.slice().sort((a, b) => a.length - b.length)[0],
    totalSeconds,
    visitCount,
    dailyBreakdown: allDays
      .map((day) => ({
        date: day,
        totalSeconds: Math.round(daySeconds.get(day) ?? 0),
        sessionCount: visitsByDay.get(day) ?? 0,
      }))
      .filter((r) => r.totalSeconds > 0 || r.sessionCount > 0),
    titles: titleRows.map((r) => r.page_title),
  }
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

export function execSearchSessions(params: SearchSessionsParams, db: Database.Database): SearchSessionsResult {
  const limit = params.limit ?? 25
  const searchOpts = { startDate: params.startDate, endDate: params.endDate, limit }
  const ignoredFrom = params.startDate ? localDayBounds(params.startDate)[0] : 0
  const ignoredTo = params.endDate ? localDayBounds(params.endDate)[1] : Date.now()
  const ignoredSpans = getIgnoredBlockSpansForRange(db, ignoredFrom, ignoredTo)
  const isVisibleHit = (hit: { startTime: number; endTime: number }): boolean =>
    !ignoredSpans.some((span) => span.startMs < hit.endTime && span.endMs > hit.startTime)

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
    url: null,
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
    url: h.url ?? null,
  })

  // B2: search both app_sessions_fts and website_visits_fts so the AI can
  // cite specific page titles (e.g. Coursera lesson names), not just app names.
  const strictSessions = dbSearchSessions(db, params.query, searchOpts)
  const strictPages = dbSearchBrowser(db, params.query, searchOpts)
  const strictHits = [
    ...strictSessions.map(mapSessionHit).filter(isVisibleHit),
    ...strictPages.map(mapBrowserHit).filter(isVisibleHit),
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
      .map(mapSessionHit).filter(isVisibleHit)
    const partialPages = dbSearchBrowser(db, token, { ...searchOpts, limit: remaining })
      .map(mapBrowserHit).filter(isVisibleHit)
    tokenMatches[token] = partialSessions.length + partialPages.length
    for (const hit of partialSessions) {
      const key = `session:${hit.id}`
      if (byKey.has(key)) continue
      byKey.set(key, hit)
      if (byKey.size >= limit) break
    }
    if (byKey.size >= limit) break
    for (const hit of partialPages) {
      const key = `page:${hit.id}`
      if (byKey.has(key)) continue
      byKey.set(key, hit)
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

export function execGetDaySummary(params: GetDaySummaryParams, db: Database.Database): DaySummaryResult {
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
  // AI cites what the user saw.
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

export function execGetAppUsage(params: GetAppUsageParams, db: Database.Database): GetAppUsageResult {
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

  // Sites aren't apps. "how long on youtube.com" is a website question, and there
  // is no app called youtube.com — so when nothing matched as an app, answer from
  // the website_visits table (the same per-domain data the ⌘K search reads).
  if (totalSeconds <= 0) {
    const site = aggregateSiteUsage(db, params.appName, fromMs, toMs)
    if (site) {
      return {
        appName: site.domain,
        bundleId: '',
        totalSeconds: site.totalSeconds,
        sessionCount: site.visitCount,
        startDate: params.startDate ?? toDateStr(fromMs),
        endDate: params.endDate ?? toDateStr(toMs),
        dailyBreakdown: site.dailyBreakdown,
        recentWindowTitles: site.titles,
        fromWebsiteVisits: true,
      }
    }
  }

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

export function execGetAttributionContext(params: GetAttributionContextParams, db: Database.Database): GetAttributionContextResult {
  const client = findClientByName(params.entityName, db)
  const project = client ? null : findProjectByName(params.entityName, db)
  const entityId = client?.id ?? project?.id ?? null
  const entityType: 'client' | 'project' | 'unknown' = client ? 'client' : project ? 'project' : 'unknown'

  if (!entityId) {
    // No client/project by this name — never dead-end. Infer a breakdown from
    // captured activity matching the name as a keyword (app/page/title), and
    // tell the AI to offer setting it up as a client in Settings.
    const sessionHits = dbSearchSessions(db, params.entityName, { limit: 8 })
    const pageHits = dbSearchBrowser(db, params.entityName, { limit: 8 })
    const allInferred = [
      ...sessionHits.map((h) => ({
        label: h.windowTitle ?? h.appName,
        date: h.date,
        durationSeconds: Math.max(0, Math.round((h.endTime - h.startTime) / 1000)),
      })),
      ...pageHits.map((h) => ({
        label: h.pageTitle ?? h.domain,
        date: h.date,
        durationSeconds: Math.max(0, Math.round((h.endTime - h.startTime) / 1000)),
      })),
    ].sort((a, b) => b.durationSeconds - a.durationSeconds)
    // Total over the full matched set; only the display list is truncated.
    const inferredTotalSeconds = allInferred.reduce((s, a) => s + a.durationSeconds, 0)
    const inferredActivity = allInferred.slice(0, 10)

    return {
      entityName: params.entityName,
      entityType: 'unknown',
      matchedEntityId: null,
      totalTrackedSeconds: inferredTotalSeconds,
      last30DaysSeconds: 0,
      recentSessions: [],
      inferredActivity,
      setupHint: `"${params.entityName}" isn't set up as a client yet, so this is an inferred breakdown from activity mentioning it — not attributed time. Offer the user to add it as a client in Settings → Clients for exact totals. Never refuse; answer from inferredActivity.`,
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

export function execGetBlockAtTime(params: GetBlockAtTimeParams, db: Database.Database): GetBlockAtTimeResult {
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

export function execListClients(params: ListClientsParams, db: Database.Database): ListClientsResult {
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

export function executeTool(
  name: ToolName,
  params: Record<string, unknown>,
  db: Database.Database,
  controls: TrackingControlsState = trackingControlsStateFromSettings(getSettings()),
): unknown {
  // Every tool result passes through two boundaries before leaving the
  // executor:
  //   1. filterTrackingExcludedEvidence — drops excluded apps/sites and system
  //      noise (and redacts excluded names embedded in free text). This is the
  //      last line if capture-time deletion or projection cleanup missed a
  //      stale row, and it is what makes exclusions hold over MCP.
  //   2. sanitizeToolResult — deep-walks every string field and strips OAuth
  //      tokens, JWTs, hex blobs, base64 blobs, and URL query strings. The
  //      load-bearing defense against the OAuth-callback leak repro from
  //      V1-PHASE-6-AI §1. sanitizeForRender (renderer path) is the backstop.
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
  return sanitizeToolResult(filterTrackingExcludedEvidence(raw, controls))
}
