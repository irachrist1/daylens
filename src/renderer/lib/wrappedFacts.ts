// Pure deterministic utilities for the Wrapped facts layer.
// No React dependencies — extracted so this logic can be unit-tested.
import type { AppCategory, AppSession, WebsiteSummary, WorkContextBlock } from '@shared/types'
import { blockActiveSeconds } from '@shared/blockDuration'

// ─── Data quality ──────────────────────────────────────────────────────────────

export type WrappedQuality = 'empty' | 'tooEarly' | 'partial' | 'full'

// Named thresholds — tunable hypotheses, not permanent truth
export const QUALITY_THRESHOLDS = {
  TOO_EARLY_SECONDS: 5 * 60,   // < 5 min → empty
  PARTIAL_SECONDS:  45 * 60,   // < 45 min → partial
}

export function computeQuality(totalSeconds: number): WrappedQuality {
  if (totalSeconds <= 0) return 'empty'
  if (totalSeconds < QUALITY_THRESHOLDS.TOO_EARLY_SECONDS) return 'tooEarly'
  if (totalSeconds < QUALITY_THRESHOLDS.PARTIAL_SECONDS) return 'partial'
  return 'full'
}

// ─── Domain classification ─────────────────────────────────────────────────────

export type DomainClass =
  | 'devDocs' | 'codePlatform' | 'search' | 'aiTool' | 'workTool'
  | 'communication' | 'email' | 'learning' | 'video' | 'entertainment'
  | 'social' | 'news' | 'unknown'

export const DOMAIN_CLASSIFICATION: Record<string, DomainClass> = {
  // Code platforms
  'github.com': 'codePlatform',
  'gitlab.com': 'codePlatform',
  'bitbucket.org': 'codePlatform',
  // Developer docs
  'stackoverflow.com': 'devDocs',
  'developer.mozilla.org': 'devDocs',
  'docs.python.org': 'devDocs',
  'reactjs.org': 'devDocs',
  'react.dev': 'devDocs',
  'nodejs.org': 'devDocs',
  'docs.rs': 'devDocs',
  'pkg.go.dev': 'devDocs',
  'rust-lang.org': 'devDocs',
  'typescriptlang.org': 'devDocs',
  'npmjs.com': 'devDocs',
  'pypi.org': 'devDocs',
  'docs.anthropic.com': 'devDocs',
  'platform.openai.com': 'devDocs',
  'vercel.com': 'devDocs',
  // Search
  'google.com': 'search',
  'duckduckgo.com': 'search',
  'bing.com': 'search',
  'perplexity.ai': 'search',
  // AI tools
  'chat.openai.com': 'aiTool',
  'chatgpt.com': 'aiTool',
  'claude.ai': 'aiTool',
  'gemini.google.com': 'aiTool',
  'copilot.microsoft.com': 'aiTool',
  'cursor.sh': 'aiTool',
  'v0.dev': 'aiTool',
  // Work tools
  'notion.so': 'workTool',
  'figma.com': 'workTool',
  'linear.app': 'workTool',
  'jira.atlassian.com': 'workTool',
  'confluence.atlassian.com': 'workTool',
  'trello.com': 'workTool',
  'asana.com': 'workTool',
  'airtable.com': 'workTool',
  'miro.com': 'workTool',
  'clickup.com': 'workTool',
  'basecamp.com': 'workTool',
  // Communication
  'slack.com': 'communication',
  'teams.microsoft.com': 'communication',
  'discord.com': 'communication',
  'meet.google.com': 'communication',
  'zoom.us': 'communication',
  // Email
  'gmail.com': 'email',
  'mail.google.com': 'email',
  'outlook.com': 'email',
  'outlook.live.com': 'email',
  // Learning
  'medium.com': 'learning',
  'substack.com': 'learning',
  'coursera.org': 'learning',
  'udemy.com': 'learning',
  'khanacademy.org': 'learning',
  // Video (not entertainment — YouTube can be work or leisure)
  'youtube.com': 'video',
  'twitch.tv': 'video',
  'vimeo.com': 'video',
  // Entertainment (clearly leisure)
  'netflix.com': 'entertainment',
  'primevideo.com': 'entertainment',
  'hulu.com': 'entertainment',
  'disneyplus.com': 'entertainment',
  'max.com': 'entertainment',
  'tiktok.com': 'entertainment',
  // Social
  'twitter.com': 'social',
  'x.com': 'social',
  'instagram.com': 'social',
  'facebook.com': 'social',
  'reddit.com': 'social',
  'linkedin.com': 'social',
  'pinterest.com': 'social',
  // News
  'news.ycombinator.com': 'news',
  'techcrunch.com': 'news',
  'theverge.com': 'news',
  'wired.com': 'news',
}

export function classifyDomain(domain: string): DomainClass {
  const normalized = domain.toLowerCase().replace(/^www\./, '')
  return DOMAIN_CLASSIFICATION[normalized] ?? 'unknown'
}

export function isDomainWorkRelevant(cls: DomainClass): boolean {
  return cls === 'devDocs' || cls === 'codePlatform' || cls === 'aiTool' || cls === 'workTool' || cls === 'search'
}

// ─── Browser context ───────────────────────────────────────────────────────────

export interface BrowserContext {
  topDomain: string
  topDomainSeconds: number
  topDomainClass: DomainClass
  isWorkRelevant: boolean
  nonWorkSeconds: number
  workSeconds: number
  isMixed: boolean
  interpretation: string
}

export function buildBrowserContext(websites: WebsiteSummary[]): BrowserContext | null {
  if (websites.length === 0) return null
  const sorted = [...websites].sort((a, b) => b.totalSeconds - a.totalSeconds)
  const top = sorted[0]
  if (!top) return null
  const cls = classifyDomain(top.domain)
  const workRelevant = isDomainWorkRelevant(cls)
  const workSeconds = sorted
    .filter((site) => isDomainWorkRelevant(classifyDomain(site.domain)))
    .reduce((sum, site) => sum + site.totalSeconds, 0)
  const nonWorkSites = sorted.filter((site) => !isDomainWorkRelevant(classifyDomain(site.domain)))
  const nonWorkSeconds = nonWorkSites.reduce((sum, site) => sum + site.totalSeconds, 0)
  const totalSeconds = workSeconds + nonWorkSeconds
  const topNonWork = nonWorkSites[0] ?? null
  const mixedBySeconds =
    workSeconds > 0
    && topNonWork != null
    && topNonWork.totalSeconds >= 10 * 60
    && (totalSeconds <= 0 || topNonWork.totalSeconds / totalSeconds >= 0.15 || nonWorkSeconds / totalSeconds >= 0.25)
  const isMixed = Boolean(workRelevant && mixedBySeconds)

  let interpretation: string
  if (isMixed && workRelevant && topNonWork) {
    interpretation = `${top.domain} led the browser time, but ${topNonWork.domain} also took a meaningful share.`
  } else if (cls === 'video') {
    interpretation = `Browser time was mostly ${top.domain}.`
  } else if (cls === 'entertainment' || cls === 'social') {
    interpretation = `Browser time drifted — ${top.domain} led the day.`
  } else if (workRelevant) {
    const second = sorted[1]
    if (second && isDomainWorkRelevant(classifyDomain(second.domain))) {
      interpretation = `Browser time supported the work — mostly ${top.domain} and ${second.domain}.`
    } else {
      interpretation = `Browser time supported the work — mostly ${top.domain}.`
    }
  } else {
    interpretation = `Browser time led to ${top.domain}.`
  }

  return {
    topDomain: top.domain,
    topDomainSeconds: top.totalSeconds,
    topDomainClass: cls,
    isWorkRelevant: workRelevant,
    nonWorkSeconds,
    workSeconds,
    isMixed,
    interpretation,
  }
}

// ─── Identity confidence ───────────────────────────────────────────────────────

export type IdentityConfidence = 'high' | 'medium' | 'low' | 'none'

export function computeIdentityConfidence(
  quality: WrappedQuality,
  totalSeconds: number,
  dominantCategory: AppCategory,
  dominantCategoryPct: number,
  browserContext: BrowserContext | null,
): IdentityConfidence {
  if (quality === 'empty' || quality === 'tooEarly') return 'none'
  if (totalSeconds < 30 * 60) return 'none'
  if (dominantCategoryPct < 25) return 'none'
  if (dominantCategory === 'system' || dominantCategory === 'uncategorized') return 'none'

  // Browsing identity requires domain evidence to be meaningful
  if (dominantCategory === 'browsing') {
    if (!browserContext) return 'none'
    if (browserContext.isMixed) return 'low'
    if (!browserContext.isWorkRelevant) return 'low'
    if (dominantCategoryPct < 45) return 'low'
    return 'medium'
  }

  if (dominantCategoryPct >= 60 && quality === 'full') return 'high'
  if (dominantCategoryPct >= 40) return 'medium'
  return 'low'
}

// ─── Focus by period ───────────────────────────────────────────────────────────

export interface FocusByPeriod {
  morning: number    // seconds before noon
  afternoon: number  // seconds noon–5pm
  evening: number    // seconds after 5pm
  peakPeriod: 'morning' | 'afternoon' | 'evening' | null
}

const FOCUSED_CATEGORY_SET: ReadonlySet<AppCategory> = new Set([
  'development', 'research', 'writing', 'aiTools', 'design', 'productivity',
])

export interface FocusBlock {
  startTime: number
  endTime: number
  category: AppCategory
  durationSeconds?: number
}

export function computeFocusByPeriod(blocks: FocusBlock[]): FocusByPeriod {
  let morning = 0, afternoon = 0, evening = 0
  for (const b of blocks) {
    if (!FOCUSED_CATEGORY_SET.has(b.category)) continue
    const dur = b.durationSeconds ?? Math.max(0, Math.round((b.endTime - b.startTime) / 1000))
    const hour = new Date(b.startTime).getHours()
    if (hour < 12) morning += dur
    else if (hour < 17) afternoon += dur
    else evening += dur
  }

  let peakPeriod: FocusByPeriod['peakPeriod'] = null
  if (morning > 0 || afternoon > 0 || evening > 0) {
    if (morning >= afternoon && morning >= evening) peakPeriod = 'morning'
    else if (afternoon >= evening) peakPeriod = 'afternoon'
    else peakPeriod = 'evening'
  }

  return { morning, afternoon, evening, peakPeriod }
}

// ─── Category breakdown ───────────────────────────────────────────────────────

export interface CategoryBreakdownItem {
  category: AppCategory
  seconds: number
  pct: number
}

export function largestRemainderPercentages(values: number[]): number[] {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0)
  if (total <= 0) return values.map(() => 0)
  const raw = values.map((value) => (Math.max(0, value) / total) * 100)
  const floors = raw.map(Math.floor)
  let remaining = 100 - floors.reduce((a, b) => a + b, 0)
  const order = raw
    .map((value, index) => [value - Math.floor(value), index] as [number, number])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (let i = 0; i < remaining && i < order.length; i++) floors[order[i][1]] += 1
  return floors
}

// Session categories that are OS/tracking artifacts, not user activity
const EXCLUDED_BACKGROUND_CATEGORIES: ReadonlySet<AppCategory> = new Set<AppCategory>(['system', 'uncategorized'])

export function categoryBreakdownFromSources(
  sessions: Pick<AppSession, 'category' | 'durationSeconds'>[],
  blocks: Pick<WorkContextBlock, 'dominantCategory' | 'startTime' | 'endTime' | 'sessions'>[],
  limit = 6,
): { breakdown: CategoryBreakdownItem[]; dominantCategory: AppCategory; dominantCategoryPct: number } {
  const byCategory = new Map<AppCategory, number>()

  if (sessions.length > 0) {
    for (const session of sessions) {
      if (EXCLUDED_BACKGROUND_CATEGORIES.has(session.category)) continue
      byCategory.set(session.category, (byCategory.get(session.category) ?? 0) + Math.max(0, session.durationSeconds))
    }
  } else {
    for (const block of blocks) {
      const seconds = blockActiveSeconds(block)
      byCategory.set(block.dominantCategory, (byCategory.get(block.dominantCategory) ?? 0) + seconds)
    }
  }

  const entries = [...byCategory.entries()]
    .filter(([, seconds]) => seconds > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const top = entries.slice(0, limit)
  const percentages = largestRemainderPercentages(top.map(([, seconds]) => seconds))
  const dominant = top[0] ?? ['uncategorized' as AppCategory, 0]
  const total = top.reduce((sum, [, seconds]) => sum + seconds, 0)

  return {
    breakdown: top.map(([category, seconds], index) => ({
      category,
      seconds: Math.round(seconds),
      pct: percentages[index] ?? 0,
    })),
    dominantCategory: dominant[0],
    dominantCategoryPct: total > 0 ? Math.round((dominant[1] / total) * 100) : 0,
  }
}

export function visibleCategoryBreakdown(
  breakdown: CategoryBreakdownItem[],
  limit = 5,
): CategoryBreakdownItem[] {
  const visible = breakdown.slice(0, limit)
  const percentages = largestRemainderPercentages(visible.map((item) => item.seconds))
  return visible.map((item, index) => ({
    ...item,
    pct: percentages[index] ?? 0,
  }))
}

// ─── Peak block selection and labels ──────────────────────────────────────────

const MEANINGFUL_PEAK_CATEGORIES: ReadonlySet<AppCategory> = new Set([
  'development',
  'writing',
  'design',
  'research',
  'aiTools',
  'productivity',
])

const GENERIC_OR_RAW_LABELS = new Set([
  'chatgpt',
  'youtube',
  'mail',
  'outlook',
  'web session',
  'browsing',
  'entertainment',
  'uncategorized',
])

export function looksLikeRawArtifactLabel(label: string): boolean {
  const normalized = label.trim()
  if (!normalized) return true
  const lower = normalized.toLowerCase()
  if (GENERIC_OR_RAW_LABELS.has(lower)) return true
  if (/\b(youtube|linkedin)\b/i.test(normalized) && /[|–-]/.test(normalized)) return true
  if (/\|\s*(linkedin|youtube|coursera|outlook|x|twitter)\b/i.test(normalized)) return true
  if (/[-–]\s*youtube\b/i.test(normalized)) return true
  if (/\bseason\s+\d+\s+episode\s+\d+\b/i.test(normalized)) return true
  if (/^watch\s+/i.test(normalized)) return true
  if (/^mail\s+-\s+/i.test(normalized)) return true
  if (/^notifications\s+\|\s+linkedin$/i.test(normalized)) return true
  return false
}

export function sanitizeWrappedLabel(label: string, category: AppCategory): string {
  const trimmed = label.trim()
  if (!trimmed || trimmed === 'Uncategorized') return categoryFallbackLabel(category)
  if (looksLikeRawArtifactLabel(trimmed)) return categoryFallbackLabel(category)
  if (trimmed.length > 42) return `${trimmed.slice(0, 39)}...`
  return trimmed
}

function categoryFallbackLabel(category: AppCategory): string {
  switch (category) {
    case 'development': return 'Development work'
    case 'aiTools': return 'AI-assisted work'
    case 'productivity': return 'Admin work'
    case 'writing': return 'Writing'
    case 'design': return 'Design work'
    case 'research': return 'Research'
    default: return 'Work session'
  }
}

export interface WrappedPeakBlock {
  label: string
  durationSeconds: number
  startTime: number
  endTime: number
  category: AppCategory
  confidence: 'high' | 'medium' | 'low'
}

export function selectPeakBlock(blocks: WorkContextBlock[]): WrappedPeakBlock | null {
  const candidates = blocks
    .map((block) => {
      const durationSeconds = blockActiveSeconds(block)
      const label = block.label.current.trim()
      const rawArtifact = looksLikeRawArtifactLabel(label)
      const categoryAllowed = MEANINGFUL_PEAK_CATEGORIES.has(block.dominantCategory)
      const hasUsefulRuleLabel = block.label.source === 'rule' || block.label.source === 'workflow' || block.label.source === 'ai' || block.label.source === 'user'
      return {
        block,
        durationSeconds,
        label,
        score:
          durationSeconds
          + (block.dominantCategory === 'development' ? 900 : 0)
          + (block.dominantCategory === 'aiTools' ? 600 : 0)
          + (hasUsefulRuleLabel ? 600 : 0)
          - (rawArtifact ? 3600 : 0),
        eligible: durationSeconds >= 10 * 60 && categoryAllowed && !rawArtifact,
      }
    })
    .filter((candidate) => candidate.eligible)
    .sort((a, b) => b.score - a.score || b.durationSeconds - a.durationSeconds)

  const selected = candidates[0]
  if (!selected) return null
  return {
    label: sanitizeWrappedLabel(selected.label, selected.block.dominantCategory),
    durationSeconds: selected.durationSeconds,
    startTime: selected.block.startTime,
    endTime: selected.block.endTime,
    category: selected.block.dominantCategory,
    confidence: selected.block.confidence,
  }
}
