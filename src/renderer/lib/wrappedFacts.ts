// Pure deterministic utilities for the Wrapped facts layer.
// No React dependencies — extracted so this logic can be unit-tested.
import type { AppCategory, WebsiteSummary } from '@shared/types'

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
  interpretation: string
}

export function buildBrowserContext(websites: WebsiteSummary[]): BrowserContext | null {
  if (websites.length === 0) return null
  const sorted = [...websites].sort((a, b) => b.totalSeconds - a.totalSeconds)
  const top = sorted[0]
  if (!top) return null
  const cls = classifyDomain(top.domain)
  const workRelevant = isDomainWorkRelevant(cls)

  let interpretation: string
  if (cls === 'video') {
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

  // Browsing identity requires domain evidence to be meaningful
  if (dominantCategory === 'browsing') {
    if (!browserContext) return 'none'
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
}

export function computeFocusByPeriod(blocks: FocusBlock[]): FocusByPeriod {
  let morning = 0, afternoon = 0, evening = 0
  for (const b of blocks) {
    if (!FOCUSED_CATEGORY_SET.has(b.category)) continue
    const dur = Math.max(0, Math.round((b.endTime - b.startTime) / 1000))
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
