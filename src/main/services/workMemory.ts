import type Database from 'better-sqlite3'
import crypto from 'node:crypto'
import type { AppCategory, WorkContextAppSummary } from '@shared/types'
import { policyForHost } from '@shared/domainPolicy'
import { tableExists } from './database'

export interface WorkMemoryBlockInput {
  id: string
  startTime: number
  endTime: number
  dominantCategory?: AppCategory | string
  topApps?: WorkContextAppSummary[]
}

interface ConcurrentWebsiteVisit {
  id: number
  domain: string
  pageTitle: string | null
  url: string | null
  visitTime: number
  durationSec: number
}

interface ConcurrentBrowserContext {
  id: string
  bundleId: string
  tabUrl: string | null
  domain: string | null
  registrableDomain: string | null
  tabTitle: string | null
  pagePath: string | null
  startedAt: number
  endedAt: number
}

interface ConcurrentFileActivity {
  filePath: string
  fileName: string | null
  projectRoot: string | null
  repoRemoteUrl: string | null
  startedAt: number
  endedAt: number | null
}

export interface ConcurrentEvidence {
  overlappingVisits: ConcurrentWebsiteVisit[]
  browserContexts: ConcurrentBrowserContext[]
  fileActivity: ConcurrentFileActivity[]
}

export interface ProjectHint {
  project: string
  label: string
  confidence: number
  evidence: string[]
}

export interface MemoryPatternMatch {
  patternId: string
  label: string
  confidence: number
  score: number
  category: string | null
}

interface PatternKey {
  version: 1
  apps: string[]
  domains: string[]
  titleTokens: string[]
  project: string | null
  hasLocalhost: boolean
  devContext: boolean
}

const PROMOTED_PATTERN_THRESHOLD = 0.65
const MAX_CONTEXT_WINDOW_MINUTES = 10

const TERMINAL_APP_TOKENS = [
  'ghostty',
  'terminal',
  'iterm',
  'iterm2',
  'warp',
  'kitty',
  'alacritty',
  'wezterm',
  'hyper',
]

const DEV_APP_TOKENS = [
  'cursor',
  'visual studio code',
  'vscode',
  'code',
  'xcode',
  'zed',
  'webstorm',
  'intellij',
  'github desktop',
]

const DISTRACTION_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'netflix.com',
  'spotify.com',
  'tiktok.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'reddit.com',
  'facebook.com',
  'twitch.tv',
]

const GENERIC_TITLE_WORDS = new Set([
  'app',
  'dashboard',
  'home',
  'localhost',
  'new tab',
  'safari',
  'chrome',
  'google chrome',
  'dia',
  'untitled',
  'vite',
  'react',
])

function sha1(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex')
}

function nowMs(): number {
  return Date.now()
}

export function memoryEnabled(): boolean {
  const raw = process.env.DAYLENS_WORK_MEMORY_ENABLED
  if (!raw) return true
  return !['0', 'false', 'off', 'no'].includes(raw.trim().toLowerCase())
}

function contextWindowForBlock(block: WorkMemoryBlockInput): { searchStart: number; searchEnd: number } {
  const durationMinutes = Math.max(1, (block.endTime - block.startTime) / 60_000)
  const padMs = Math.min(MAX_CONTEXT_WINDOW_MINUTES, durationMinutes) * 60_000
  return {
    searchStart: block.startTime - padMs,
    searchEnd: block.endTime + padMs,
  }
}

export function gatherConcurrentEvidence(
  db: Database.Database,
  block: WorkMemoryBlockInput,
): ConcurrentEvidence {
  const { searchStart, searchEnd } = contextWindowForBlock(block)

  const overlappingVisits = tableExists(db, 'website_visits')
    ? db.prepare(`
      SELECT
        id,
        domain,
        page_title AS pageTitle,
        url,
        visit_time AS visitTime,
        duration_sec AS durationSec
      FROM website_visits
      WHERE visit_time < ?
        AND (visit_time + (MAX(duration_sec, 1) * 1000)) > ?
      ORDER BY visit_time ASC
      LIMIT 40
    `).all(searchEnd, searchStart) as ConcurrentWebsiteVisit[]
    : []

  // browser_context_events and file_activity_events were part of a capture
  // layer that was never wired up to a writer (0 rows, ever) and the tables
  // have been dropped (see db/migrations.ts v42). gatherConcurrentEvidence's
  // callers (eveningConsolidation.ts, workBlocks.ts) still destructure
  // browserContexts/fileActivity off ConcurrentEvidence, so the fields stay
  // in the shape as permanently-empty constants rather than forcing a change
  // in those call sites.
  const browserContexts: ConcurrentBrowserContext[] = []
  const fileActivity: ConcurrentFileActivity[] = []

  return { overlappingVisits, browserContexts, fileActivity }
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort()
}

function appKey(app: WorkContextAppSummary): string {
  return normalize(app.bundleId || app.appName)
}

function appText(app: WorkContextAppSummary): string {
  return `${app.bundleId} ${app.appName}`.toLowerCase()
}

function hasDevOrTerminalApp(block: WorkMemoryBlockInput): boolean {
  const apps = block.topApps ?? []
  return apps.some((app) => {
    const text = appText(app)
    return TERMINAL_APP_TOKENS.some((token) => text.includes(token))
      || DEV_APP_TOKENS.some((token) => text.includes(token))
  })
}

function isLocalhost(value: string | null | undefined): boolean {
  return /\b(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])\b/i.test(value ?? '')
}

function normalizedDomain(value: string | null | undefined): string | null {
  const domain = normalize(value)
  if (!domain) return null
  return domain.replace(/^www\./, '')
}

function evidenceDomains(evidence: ConcurrentEvidence): string[] {
  const contextDomains = evidence.browserContexts
    .map((row) => normalizedDomain(row.registrableDomain ?? row.domain))
    .filter((domain): domain is string => Boolean(domain))
  const visitDomains = evidence.overlappingVisits
    .map((row) => normalizedDomain(row.domain))
    .filter((domain): domain is string => Boolean(domain))
  return uniqueSorted([...contextDomains, ...visitDomains])
}

function titleCandidates(evidence: ConcurrentEvidence): string[] {
  const browserTitles = evidence.browserContexts
    .map((row) => row.tabTitle)
    .filter((title): title is string => Boolean(title?.trim()))
  const visitTitles = evidence.overlappingVisits
    .map((row) => row.pageTitle)
    .filter((title): title is string => Boolean(title?.trim()))
  return [...browserTitles, ...visitTitles]
}

function urlCandidates(evidence: ConcurrentEvidence): string[] {
  return [
    ...evidence.browserContexts.map((row) => row.tabUrl ?? ''),
    ...evidence.overlappingVisits.map((row) => row.url ?? ''),
  ].filter(Boolean)
}

function splitTitleSegments(title: string): string[] {
  return title
    .split(/\s+(?:[-–—|:·•]\s+)|\s+[|]\s*|\s*[-–—]\s*/g)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function humanizeToken(value: string): string {
  const cleaned = value
    .replace(/[_+]+/g, ' ')
    .replace(/[-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase())
}

function usefulProjectName(candidate: string): string | null {
  const cleaned = candidate
    .replace(/\.(com|net|org|dev|app|io|ai|local)$/i, '')
    .replace(/\b(localhost|127\.0\.0\.1|0\.0\.0\.0)\b/gi, '')
    .replace(/\b(port\s*)?\d{2,5}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length < 3) return null
  if (GENERIC_TITLE_WORDS.has(cleaned.toLowerCase())) return null
  if (/^(http|https)$/i.test(cleaned)) return null
  return humanizeToken(cleaned)
}

function projectFromTitle(title: string): string | null {
  const segments = splitTitleSegments(title)
  for (const segment of segments) {
    const useful = usefulProjectName(segment)
    if (useful) return useful
  }
  return usefulProjectName(title)
}

// Hosts where a URL path identifies a real code repository. The repo slug is a
// legitimate project name; the bare hostname of a non-code site is not.
const CODE_REPO_HOSTS = new Set([
  'github.com',
  'gitlab.com',
  'bitbucket.org',
])

// Extract a project name only from a recognized code-repository URL
// (github.com/<owner>/<repo> etc.). Returns null for every other host, so a
// social, video, or news site can never be promoted into a "<host> development"
// label. The previous generic `hostname → project` fallback is exactly what
// produced "Instagram development" / "Youtube development".
function projectFromRepoUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.replace(/^www\./, '')
    if (!CODE_REPO_HOSTS.has(host)) return null
    const [, , repo] = parsed.pathname.split('/')
    return usefulProjectName(repo ?? '')
  } catch {
    return null
  }
}

function projectFromFileActivity(evidence: ConcurrentEvidence): string | null {
  for (const row of evidence.fileActivity) {
    const projectRoot = row.projectRoot?.split(/[\\/]/).filter(Boolean).pop()
    const usefulRoot = usefulProjectName(projectRoot ?? '')
    if (usefulRoot) return usefulRoot
  }
  return null
}

function isDistractionDomain(domain: string): boolean {
  const policy = policyForHost(domain)
  if (policy === 'entertainment' || policy === 'social_feed') return true
  return DISTRACTION_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))
}

function onlyDistractionEvidence(evidence: ConcurrentEvidence): boolean {
  const domains = evidenceDomains(evidence)
  return domains.length > 0 && domains.every(isDistractionDomain) && evidence.fileActivity.length === 0
}

// Title/url pairs from concurrent browsing evidence, so a candidate title can
// be judged against the URL it came from.
function titledUrls(evidence: ConcurrentEvidence): Array<{ url: string; title: string }> {
  return [
    ...evidence.browserContexts.map((row) => ({ url: row.tabUrl ?? '', title: row.tabTitle ?? '' })),
    ...evidence.overlappingVisits.map((row) => ({ url: row.url ?? '', title: row.pageTitle ?? '' })),
  ].filter((pair) => pair.title.trim().length > 0)
}

// A project hint is a deterministic "<project> development" floor label, used
// only when nothing better (AI, artifact, workflow) is available. It must be
// grounded in a *real* project signal: the file being edited, a code repository
// that was open, or a local dev server (localhost) the user was running. It
// must NEVER be invented from an arbitrary web page title or hostname — a
// background "YouTube"/"Instagram"/"Inbox (1)" tab is not a project, and that is
// exactly how a block ended up labeled "<noun> development" with a contradicting
// category badge (P1). The dev signal has to tie the title to the user's own
// code, not to whatever site happened to be open.
export function extractProjectHintFromEvidence(
  block: WorkMemoryBlockInput,
  evidence: ConcurrentEvidence,
): ProjectHint | null {
  if (!hasDevOrTerminalApp(block)) return null
  if (onlyDistractionEvidence(evidence)) return null

  // 1. The file actually being edited is the strongest, least ambiguous signal.
  const fileProject = projectFromFileActivity(evidence)
  if (fileProject) {
    return {
      project: fileProject,
      label: `${fileProject} development`,
      confidence: 0.78,
      evidence: evidence.fileActivity.map((row) => row.projectRoot ?? row.filePath).filter(Boolean).slice(0, 2),
    }
  }

  // 2. A local dev server (localhost:5173, 127.0.0.1, …) is the user running
  //    their own app; its page title names the project ("Daylens - localhost:5173").
  for (const { url, title } of titledUrls(evidence)) {
    if (!isLocalhost(url)) continue
    const project = projectFromTitle(title)
    if (project) {
      return {
        project,
        label: `${project} development`,
        confidence: 0.74,
        evidence: [title],
      }
    }
  }

  // 3. A code-repository URL (e.g. github.com/<owner>/<repo>) is a real project.
  //    projectFromRepoUrl returns null for non-code hosts, so a social or video
  //    site can never masquerade as a "project" here.
  for (const url of urlCandidates(evidence)) {
    const project = projectFromRepoUrl(url)
    if (project) {
      return {
        project,
        label: `${project} development`,
        confidence: 0.7,
        evidence: [url],
      }
    }
  }

  return null
}

function titleTokens(evidence: ConcurrentEvidence): string[] {
  const tokens = titleCandidates(evidence)
    .flatMap((title) => splitTitleSegments(title))
    .map((segment) => usefulProjectName(segment))
    .filter((token): token is string => Boolean(token))
    .map((token) => token.toLowerCase())
    .slice(0, 8)
  return uniqueSorted(tokens)
}

function buildPatternKey(block: WorkMemoryBlockInput, evidence: ConcurrentEvidence): PatternKey | null {
  const apps = uniqueSorted((block.topApps ?? []).map(appKey))
  const domains = evidenceDomains(evidence)
  const projectHint = extractProjectHintFromEvidence(block, evidence)
  const key: PatternKey = {
    version: 1,
    apps,
    domains,
    titleTokens: titleTokens(evidence),
    project: projectHint?.project.toLowerCase() ?? null,
    hasLocalhost: [
      ...domains,
      ...urlCandidates(evidence),
    ].some(isLocalhost),
    devContext: hasDevOrTerminalApp(block),
  }

  const hasSignal = key.apps.length > 0
    && (key.domains.length > 0 || key.titleTokens.length > 0 || key.project || key.hasLocalhost)
  return hasSignal ? key : null
}

function scorePattern(pattern: PatternKey, current: PatternKey): number {
  let score = 0
  const appOverlap = pattern.apps.filter((app) => current.apps.includes(app)).length
  if (pattern.apps.length > 0) score += 0.35 * (appOverlap / pattern.apps.length)

  const domainOverlap = pattern.domains.filter((domain) => current.domains.includes(domain)).length
  if (pattern.domains.length > 0) score += 0.25 * (domainOverlap / pattern.domains.length)

  const titleOverlap = pattern.titleTokens.filter((token) => current.titleTokens.includes(token)).length
  if (pattern.titleTokens.length > 0) score += 0.2 * (titleOverlap / pattern.titleTokens.length)

  if (pattern.project && current.project && pattern.project === current.project) score += 0.25
  if (pattern.hasLocalhost && current.hasLocalhost) score += 0.1
  if (pattern.devContext && current.devContext) score += 0.1

  return Math.min(1, score)
}

function parsePatternKey(raw: string): PatternKey | null {
  try {
    const parsed = JSON.parse(raw) as PatternKey
    if (parsed?.version !== 1 || !Array.isArray(parsed.apps)) return null
    return {
      version: 1,
      apps: uniqueSorted(parsed.apps ?? []),
      domains: uniqueSorted(parsed.domains ?? []),
      titleTokens: uniqueSorted(parsed.titleTokens ?? []),
      project: parsed.project ?? null,
      hasLocalhost: Boolean(parsed.hasLocalhost),
      devContext: Boolean(parsed.devContext),
    }
  } catch {
    return null
  }
}

export function matchPromotedPatterns(
  db: Database.Database,
  block: WorkMemoryBlockInput,
  evidence: ConcurrentEvidence = gatherConcurrentEvidence(db, block),
  threshold = PROMOTED_PATTERN_THRESHOLD,
): MemoryPatternMatch | null {
  if (!memoryEnabled() || !tableExists(db, 'context_patterns')) return null
  const currentKey = buildPatternKey(block, evidence)
  if (!currentKey || onlyDistractionEvidence(evidence)) return null

  const rows = db.prepare(`
    SELECT
      id,
      pattern_key AS patternKey,
      label_suggestion AS labelSuggestion,
      category_suggestion AS categorySuggestion,
      confidence
    FROM context_patterns
    WHERE status = 'promoted'
      AND confidence >= ?
    ORDER BY confidence DESC, updated_at DESC
    LIMIT 100
  `).all(threshold) as Array<{
    id: string
    patternKey: string
    labelSuggestion: string
    categorySuggestion: string | null
    confidence: number
  }>

  let best: MemoryPatternMatch | null = null
  for (const row of rows) {
    const pattern = parsePatternKey(row.patternKey)
    if (!pattern) continue
    const score = scorePattern(pattern, currentKey)
    if (score < threshold) continue
    const confidence = Math.min(1, row.confidence * score)
    if (!best || score > best.score || (score === best.score && confidence > best.confidence)) {
      best = {
        patternId: row.id,
        label: row.labelSuggestion,
        category: row.categorySuggestion,
        confidence,
        score,
      }
    }
  }

  if (best) {
    db.prepare(`
      UPDATE context_patterns
      SET recall_count = recall_count + 1,
          last_recalled_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(nowMs(), nowMs(), best.patternId)

    if (tableExists(db, 'pattern_occurrences')) {
      db.prepare(`
        INSERT OR IGNORE INTO pattern_occurrences (id, pattern_id, block_id, matched_at)
        VALUES (?, ?, ?, ?)
      `).run(`po_${sha1(`${best.patternId}:${block.id}`).slice(0, 16)}`, best.patternId, block.id, nowMs())
    }
  }

  return best
}

// Public helper for the evening consolidation job: turn a block + its
// concurrent evidence into the same canonical pattern key the matcher uses
// at label time. Returns null when the block has no learnable signal
// (no apps, no domains/titles/files) — those blocks shouldn't seed
// candidates, they'd just match every future block.
export function buildBlockPatternKeyJson(
  block: WorkMemoryBlockInput,
  evidence: ConcurrentEvidence,
): { json: string; project: string | null; devContext: boolean } | null {
  const key = buildPatternKey(block, evidence)
  if (!key) return null
  return { json: JSON.stringify(key), project: key.project, devContext: key.devContext }
}

export function evidenceIsAllDistraction(evidence: ConcurrentEvidence): boolean {
  return onlyDistractionEvidence(evidence)
}

function blockInputFromTimeline(db: Database.Database, blockId: string): WorkMemoryBlockInput | null {
  if (!tableExists(db, 'timeline_blocks')) return null
  const row = db.prepare(`
    SELECT id, start_time AS startTime, end_time AS endTime, dominant_category AS dominantCategory
    FROM timeline_blocks
    WHERE id = ?
    LIMIT 1
  `).get(blockId) as {
    id: string
    startTime: number
    endTime: number
    dominantCategory: string
  } | undefined
  if (!row) return null

  const topApps = tableExists(db, 'timeline_block_members') && tableExists(db, 'app_sessions')
    ? db.prepare(`
      SELECT
        app_sessions.bundle_id AS bundleId,
        app_sessions.app_name AS appName,
        COALESCE(app_sessions.category, ?) AS category,
        SUM(COALESCE(timeline_block_members.weight_seconds, app_sessions.duration_sec, 0)) AS totalSeconds,
        COUNT(*) AS sessionCount,
        0 AS isBrowser
      FROM timeline_block_members
      JOIN app_sessions ON CAST(app_sessions.id AS TEXT) = timeline_block_members.member_id
      WHERE timeline_block_members.block_id = ?
        AND timeline_block_members.member_type = 'app_session'
      GROUP BY app_sessions.bundle_id, app_sessions.app_name, app_sessions.category
      ORDER BY totalSeconds DESC
      LIMIT 6
    `).all(row.dominantCategory, blockId) as WorkContextAppSummary[]
    : []

  return {
    id: row.id,
    startTime: row.startTime,
    endTime: row.endTime,
    dominantCategory: row.dominantCategory,
    topApps,
  }
}

export function learnFromBlockOverride(
  db: Database.Database,
  blockId: string,
  label: string,
): boolean {
  if (!memoryEnabled() || !tableExists(db, 'context_patterns')) return false
  const normalizedLabel = label.trim()
  if (!normalizedLabel) return false

  const block = blockInputFromTimeline(db, blockId)
  if (!block) return false

  const evidence = gatherConcurrentEvidence(db, block)
  if (onlyDistractionEvidence(evidence) && !hasDevOrTerminalApp(block)) return false

  const patternKey = buildPatternKey(block, evidence)
  if (!patternKey) return false

  const patternKeyJson = JSON.stringify(patternKey)
  const id = `cp_${sha1(patternKeyJson).slice(0, 16)}`
  const timestamp = nowMs()

  db.prepare(`
    INSERT INTO context_patterns (
      id,
      pattern_type,
      pattern_key,
      label_suggestion,
      category_suggestion,
      confidence,
      recall_count,
      status,
      created_at,
      updated_at,
      last_recalled_at
    )
    VALUES (?, 'override', ?, ?, ?, 1.0, 1, 'promoted', ?, ?, ?)
    ON CONFLICT(pattern_key) DO UPDATE SET
      pattern_type = 'override',
      label_suggestion = excluded.label_suggestion,
      category_suggestion = excluded.category_suggestion,
      confidence = 1.0,
      status = 'promoted',
      updated_at = excluded.updated_at,
      last_recalled_at = excluded.last_recalled_at
  `).run(
    id,
    patternKeyJson,
    normalizedLabel,
    block.dominantCategory ?? null,
    timestamp,
    timestamp,
    timestamp,
  )

  if (tableExists(db, 'pattern_occurrences')) {
    db.prepare(`
      INSERT OR IGNORE INTO pattern_occurrences (id, pattern_id, block_id, matched_at)
      VALUES (?, ?, ?, ?)
    `).run(`po_${sha1(`${id}:${blockId}`).slice(0, 16)}`, id, blockId, timestamp)
  }

  return true
}
