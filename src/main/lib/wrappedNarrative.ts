// Pure helpers for the wrapped narrative pipeline: facts construction, hash,
// prompt building, AI-output validation, and the deterministic fallback.
// Kept out of the service module so tests can exercise it without dragging in
// the AI orchestration / database layer.

import { createHash } from 'node:crypto'
import { VOICE_SYSTEM_PROMPT } from '../ai/voiceContract'
import {
  classifyDomain,
  isDomainWorkRelevant,
  type DomainClass,
} from '../../renderer/lib/wrappedFacts'
import type {
  AIWrappedNarrative,
  AppCategory,
  DayTimelinePayload,
  WebsiteSummary,
} from '@shared/types'
import { blockActiveSeconds } from '@shared/blockDuration'

// ─── Facts shape passed to the AI ─────────────────────────────────────────────
// Compact on purpose: every key has to earn its prompt-token cost. Anything
// beyond this list is unsupported context the model can hallucinate around.
export interface WrappedFacts {
  date: string
  totalSeconds: number
  focusSeconds: number
  focusPct: number
  blockCount: number
  totalSwitches: number
  switchesPerHour: number
  dominantCategory: AppCategory | 'unknown'
  dominantCategoryPct: number
  quality: 'empty' | 'tooEarly' | 'partial' | 'full'
  peakBlock: {
    label: string
    durationSeconds: number
    startClock: string
    endClock: string
    category: AppCategory
  } | null
  topApp: {
    appName: string
    durationSeconds: number
    category: AppCategory
    isBrowser: boolean
  } | null
  topDomain: {
    domain: string
    totalSeconds: number
    classification: DomainClass
    isWorkRelevant: boolean
  } | null
}

// ─── Facts construction ───────────────────────────────────────────────────────

const TOO_EARLY_SECONDS = 5 * 60
const PARTIAL_SECONDS = 45 * 60

function qualityForSeconds(totalSeconds: number): WrappedFacts['quality'] {
  if (totalSeconds <= 0) return 'empty'
  if (totalSeconds < TOO_EARLY_SECONDS) return 'tooEarly'
  if (totalSeconds < PARTIAL_SECONDS) return 'partial'
  return 'full'
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function buildWrappedFactsFromPayload(payload: DayTimelinePayload): WrappedFacts {
  const totalSeconds = Math.max(0, payload.totalSeconds)
  const quality = qualityForSeconds(totalSeconds)

  const blocks = payload.blocks
  const totalSwitches = blocks.reduce((sum, b) => sum + (b.switchCount ?? 0), 0)
  const hoursTracked = totalSeconds / 3600
  const switchesPerHour = hoursTracked > 0 ? Math.round(totalSwitches / hoursTracked) : 0

  // Dominant category from sessions, falling back to blocks.
  const byCategory = new Map<AppCategory, number>()
  if (payload.sessions.length > 0) {
    for (const session of payload.sessions) {
      if (session.category === 'system' || session.category === 'uncategorized') continue
      byCategory.set(session.category, (byCategory.get(session.category) ?? 0) + Math.max(0, session.durationSeconds))
    }
  } else {
    for (const block of blocks) {
      const seconds = blockActiveSeconds(block)
      byCategory.set(block.dominantCategory, (byCategory.get(block.dominantCategory) ?? 0) + seconds)
    }
  }
  const categoryEntries = [...byCategory.entries()].sort((a, b) => b[1] - a[1])
  const categoryTotal = categoryEntries.reduce((s, [, v]) => s + v, 0)
  const topCategory = categoryEntries[0]
  const dominantCategory: AppCategory | 'unknown' = topCategory?.[0] ?? 'unknown'
  const dominantCategoryPct = categoryTotal > 0 && topCategory
    ? Math.round((topCategory[1] / categoryTotal) * 100)
    : 0

  // Peak block: largest non-system block.
  let peak: WrappedFacts['peakBlock'] = null
  for (const block of blocks) {
    if (block.dominantCategory === 'system' || block.dominantCategory === 'uncategorized') continue
    const durationSeconds = blockActiveSeconds(block)
    if (durationSeconds < 10 * 60) continue
    if (!peak || durationSeconds > peak.durationSeconds) {
      peak = {
        label: block.label.current.trim().slice(0, 60),
        durationSeconds,
        startClock: formatClock(block.startTime),
        endClock: formatClock(block.endTime),
        category: block.dominantCategory,
      }
    }
  }

  // Top app: largest non-system session aggregate.
  const appMap = new Map<string, { appName: string; durationSeconds: number; category: AppCategory; isBrowser: boolean }>()
  const browserFlags = new Map<string, boolean>()
  for (const b of blocks) {
    for (const a of b.topApps) browserFlags.set(a.appName, a.isBrowser)
  }
  for (const session of payload.sessions) {
    if (session.category === 'system') continue
    const entry = appMap.get(session.appName)
    const isBrowser = browserFlags.get(session.appName) ?? (session.category === 'browsing')
    if (entry) {
      entry.durationSeconds += Math.max(0, session.durationSeconds)
    } else {
      appMap.set(session.appName, {
        appName: session.appName,
        durationSeconds: Math.max(0, session.durationSeconds),
        category: session.category,
        isBrowser,
      })
    }
  }
  const topApp = appMap.size > 0
    ? [...appMap.values()].sort((a, b) => b.durationSeconds - a.durationSeconds)[0] ?? null
    : null

  // Top domain.
  const sortedWebsites: WebsiteSummary[] = [...payload.websites].sort((a, b) => b.totalSeconds - a.totalSeconds)
  const topSite = sortedWebsites[0] ?? null
  const topDomain = topSite ? {
    domain: topSite.domain,
    totalSeconds: topSite.totalSeconds,
    classification: classifyDomain(topSite.domain),
    isWorkRelevant: isDomainWorkRelevant(classifyDomain(topSite.domain)),
  } : null

  return {
    date: payload.date,
    totalSeconds,
    focusSeconds: Math.max(0, payload.focusSeconds),
    focusPct: Math.max(0, Math.min(100, payload.focusPct)),
    blockCount: blocks.length,
    totalSwitches,
    switchesPerHour,
    dominantCategory,
    dominantCategoryPct,
    quality,
    peakBlock: peak,
    topApp: topApp ? { ...topApp, durationSeconds: Math.round(topApp.durationSeconds) } : null,
    topDomain,
  }
}

// ─── Hashing & cache key ──────────────────────────────────────────────────────

export function computeFactsHash(facts: WrappedFacts): string {
  // Buckets total/focus to ~minute granularity so trivial reshuffles don't
  // bust the cache while real changes still do.
  const bucket = (s: number) => Math.round(s / 60)
  const canonical = JSON.stringify({
    date: facts.date,
    quality: facts.quality,
    total: bucket(facts.totalSeconds),
    focus: bucket(facts.focusSeconds),
    focusPct: facts.focusPct,
    blocks: facts.blockCount,
    switches: facts.totalSwitches,
    swPerH: facts.switchesPerHour,
    dom: facts.dominantCategory,
    domPct: facts.dominantCategoryPct,
    peak: facts.peakBlock ? {
      label: facts.peakBlock.label.toLowerCase(),
      d: bucket(facts.peakBlock.durationSeconds),
      cat: facts.peakBlock.category,
    } : null,
    topApp: facts.topApp ? {
      name: facts.topApp.appName.toLowerCase(),
      d: bucket(facts.topApp.durationSeconds),
      cat: facts.topApp.category,
    } : null,
    topDomain: facts.topDomain ? {
      domain: facts.topDomain.domain.toLowerCase(),
      d: bucket(facts.topDomain.totalSeconds),
      cls: facts.topDomain.classification,
    } : null,
  })
  return createHash('sha1').update(canonical).digest('hex').slice(0, 12)
}

export function wrappedNarrativeCacheKey(facts: WrappedFacts, factsHash: string): string {
  return `${facts.date}|${factsHash}`
}

// ─── Prompt construction ──────────────────────────────────────────────────────

export function buildWrappedPrompts(facts: WrappedFacts): { systemPrompt: string; userMessage: string } {
  const systemPrompt = [
    VOICE_SYSTEM_PROMPT,
    'You are Daylens, narrating a Wrapped-style recap of one person\'s working day.',
    'You will receive a compact JSON facts object derived deterministically from the user\'s local activity.',
    'Return STRICT JSON with exactly these keys: "lead" (string), "peakInsight" (string or null), "nudge" (string or null), and "slides" (object with keys "scale", "focus", "topApp", "switching", "identity", "closing", each a string or null).',
    'No prose outside the JSON. No code fences. No emoji. No markdown.',
    'Voice: dry, direct, second-person, a colleague who has been paying attention. No motivational filler. No "great work", no "you crushed it", no "let\'s dive in", no exclamation marks. Specific over generic.',
    'Each string is one sentence, 24-170 characters. Never two sentences. Never ask the user a question.',
    'lead: the headline read on the day. Concrete and grounded in facts.',
    'peakInsight: 1 sentence about the peak block\'s time range or category. null if facts.peakBlock is null.',
    'nudge: 1 forward-looking sentence — one small carry-forward or protect-this idea. null if facts.quality is "partial".',
    'slides.scale: narrates the shape and span of the day given totalSeconds, blockCount, and dominant category. Avoid restating raw hours — the slide already shows them.',
    'slides.focus: narrates the focus signal (focusPct, focusSeconds) — what kind of focus day this was. null if focusSeconds is 0.',
    'slides.topApp: narrates what the top app helped accomplish (use topApp.appName + category context). null if facts.topApp is null. Never use ChatGPT/YouTube/Outlook/Mail as the subject — describe the activity.',
    'slides.switching: narrates the switching pattern (totalSwitches, switchesPerHour) — fragmented vs steady — without restating the raw count.',
    'slides.identity: one line that sums up the day\'s shape given the dominant category and topApp.',
    'slides.closing: a 1-sentence sign-off that earns the return visit. Forward-looking, specific, no filler.',
    'Never invent a duration. If a line claims hours, the number must match facts.totalSeconds / 3600 within one hour.',
    'Never invent app, domain, or project names that are not present in the facts JSON.',
    'Never describe yourself or the model. Never say "as an AI" or similar.',
    'If facts.quality is "partial", be modest across all slides — acknowledge the short window rather than overclaim, and set "nudge" to null.',
  ].join(' ')

  const userMessage = [
    `Date: ${facts.date}`,
    '',
    'Compact facts JSON:',
    JSON.stringify(facts, null, 2),
    '',
    'Return ONLY the JSON object.',
  ].join('\n')

  return { systemPrompt, userMessage }
}

// ─── Validation ───────────────────────────────────────────────────────────────

const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u
const MIN_FIELD_CHARS = 24
const MAX_FIELD_CHARS = 200

export function validateWrappedNarrativeResponse(
  raw: string,
  facts: WrappedFacts,
  factsHash: string,
): AIWrappedNarrative | null {
  const jsonText = stripCodeFence(raw).trim()
  if (!jsonText) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const obj = parsed as Record<string, unknown>
  const lead = typeof obj.lead === 'string' ? obj.lead.trim() : ''
  const peakInsightRaw = obj.peakInsight
  const nudgeRaw = obj.nudge

  if (!isFieldValid(lead, false, facts)) return null

  const peakInsight = normalizeOptional(peakInsightRaw)
  if (peakInsight != null && !isFieldValid(peakInsight, true, facts)) return null
  // peakInsight should be null when there's no peak block in the facts —
  // otherwise the model is inventing structure.
  if (peakInsight != null && !facts.peakBlock) return null

  const nudge = normalizeOptional(nudgeRaw)
  if (nudge != null && !isFieldValid(nudge, true, facts)) return null

  const slidesRaw = (obj.slides && typeof obj.slides === 'object') ? obj.slides as Record<string, unknown> : {}
  const slides = {
    scale:     validateSlideLine(slidesRaw.scale, facts),
    focus:     facts.focusSeconds > 0 ? validateSlideLine(slidesRaw.focus, facts) : null,
    topApp:    facts.topApp ? validateSlideLine(slidesRaw.topApp, facts) : null,
    switching: validateSlideLine(slidesRaw.switching, facts),
    identity:  validateSlideLine(slidesRaw.identity, facts),
    closing:   validateSlideLine(slidesRaw.closing, facts),
  }

  return {
    lead,
    peakInsight,
    nudge,
    slides,
    source: 'ai',
    factsHash,
  }
}

function validateSlideLine(value: unknown, facts: WrappedFacts): string | null {
  const trimmed = normalizeOptional(value)
  if (trimmed == null) return null
  if (!isFieldValid(trimmed, false, facts)) return null
  if (containsBannedVocabulary(trimmed)) return null
  return trimmed
}

const BANNED_PHRASES = [
  'dive into', 'unleash', 'navigate the landscape', 'in today\'s fast-paced',
  'game-changing', 'seamless', 'elevate', 'great question', 'let\'s explore',
  'at the end of the day', 'fascinating perspective', 'you\'re absolutely right',
  'harness the power', 'empower', 'robust', 'streamline', 'crush it', 'crushed it',
  'you\'ve got this', 'you got this', 'great work', 'great job', 'amazing job',
]

function containsBannedVocabulary(text: string): boolean {
  const lower = text.toLowerCase()
  return BANNED_PHRASES.some(phrase => lower.includes(phrase))
}

function normalizeOptional(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^null$/i.test(trimmed)) return null
  return trimmed
}

function isFieldValid(value: string, allowQuestion: boolean, facts: WrappedFacts): boolean {
  if (!value) return false
  if (value.length < MIN_FIELD_CHARS) return false
  if (value.length > MAX_FIELD_CHARS) return false
  if (EMOJI_REGEX.test(value)) return false
  if (!allowQuestion && /\?$/.test(value)) return false
  if (/```/.test(value)) return false
  if (/\b(I'?m not sure|couldn'?t|cannot determine|no data|n\/?a)\b/i.test(value)) return false
  if (/^\s*\{/.test(value)) return false
  if (!claimedHoursAreConsistent(value, facts)) return false
  if (mentionsUngroundedDomainOrApp(value, facts)) return false
  return true
}

function claimedHoursAreConsistent(text: string, facts: WrappedFacts): boolean {
  // Match "5 hours", "5h", "5 hrs". Minutes are noisy enough that we don't
  // bother validating them — hours are the load-bearing claim.
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b)/gi)]
  if (matches.length === 0) return true
  const actualHours = facts.totalSeconds / 3600
  for (const m of matches) {
    const claimed = Number(m[1])
    if (!Number.isFinite(claimed)) return false
    // Allow a 1-hour tolerance — phrasings like "about 6 hours" should pass
    // when the actual is 5.4. Anything beyond that is invented.
    if (Math.abs(claimed - actualHours) > 1.05) return false
  }
  return true
}

function mentionsUngroundedDomainOrApp(text: string, facts: WrappedFacts): boolean {
  // Flag bare ".com" domains the facts don't list. The facts only carry the
  // single top domain, so any other ".com" tokens in the narrative are at
  // best decorative and at worst hallucinated.
  const domainMatches = text.match(/\b([a-z0-9-]+\.(?:com|org|io|dev|app|net|ai|co))\b/gi) ?? []
  for (const m of domainMatches) {
    const normalized = m.toLowerCase().replace(/^www\./, '')
    if (facts.topDomain && facts.topDomain.domain.toLowerCase().replace(/^www\./, '') === normalized) continue
    return true
  }
  return false
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced?.[1]?.trim() ?? text
}

// ─── Fallback narrative (deterministic) ───────────────────────────────────────

const EMPTY_SLIDES: AIWrappedNarrative['slides'] = {
  scale: null, focus: null, topApp: null, switching: null, identity: null, closing: null,
}

export function buildFallbackNarrative(facts: WrappedFacts, factsHash: string): AIWrappedNarrative {
  if (facts.quality === 'empty') {
    return {
      lead: 'Daylens did not see enough activity yet to tell a story about this day.',
      peakInsight: null,
      nudge: null,
      slides: { ...EMPTY_SLIDES },
      source: 'fallback',
      factsHash,
    }
  }
  if (facts.quality === 'tooEarly') {
    return {
      lead: 'The day is still warming up — a few more minutes of activity and a real recap will surface.',
      peakInsight: null,
      nudge: null,
      slides: { ...EMPTY_SLIDES },
      source: 'fallback',
      factsHash,
    }
  }

  const hours = Math.floor(facts.totalSeconds / 3600)
  const minutes = Math.floor((facts.totalSeconds % 3600) / 60)
  const durationLabel = hours > 0
    ? `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`
    : `${Math.max(1, minutes)}m`

  let lead: string
  if (facts.focusPct >= 60 && facts.quality === 'full') {
    lead = `You held the line — ${durationLabel} tracked with focus running at ${facts.focusPct}% of the day.`
  } else if (facts.switchesPerHour >= 18) {
    lead = `A scattered day — ${facts.switchesPerHour} context switches per hour across ${durationLabel} of tracked time.`
  } else if (facts.topDomain && !facts.topDomain.isWorkRelevant) {
    lead = `${durationLabel} tracked, and the browser leaned hard on ${facts.topDomain.domain} today.`
  } else if (facts.dominantCategory !== 'unknown') {
    lead = `${durationLabel} tracked, with ${facts.dominantCategoryPct}% of it sitting in ${humanCategory(facts.dominantCategory)}.`
  } else {
    lead = `${durationLabel} tracked across ${facts.blockCount} block${facts.blockCount === 1 ? '' : 's'}.`
  }

  let peakInsight: string | null = null
  if (facts.peakBlock) {
    peakInsight = `Your clearest stretch ran ${facts.peakBlock.startClock} to ${facts.peakBlock.endClock} — ${humanCategory(facts.peakBlock.category)}.`
  }

  let nudge: string | null = null
  if (facts.quality !== 'partial') {
    if (facts.peakBlock) {
      nudge = `Try to protect a stretch like ${facts.peakBlock.startClock}–${facts.peakBlock.endClock} again tomorrow.`
    } else if (facts.switchesPerHour >= 18) {
      nudge = 'Tomorrow, pick one block to defend from interruptions and let the rest stay loose.'
    } else if (facts.topDomain && facts.topDomain.isWorkRelevant) {
      nudge = `${facts.topDomain.domain} carried the work today — worth keeping it on the path again tomorrow.`
    } else {
      nudge = 'Carry one specific intention from today into tomorrow rather than restarting from scratch.'
    }
  }

  const slides = buildFallbackSlides(facts)
  return { lead, peakInsight, nudge, slides, source: 'fallback', factsHash }
}

function buildFallbackSlides(facts: WrappedFacts): AIWrappedNarrative['slides'] {
  const catLabel = humanCategory(facts.dominantCategory)
  const scale = facts.dominantCategory === 'unknown'
    ? `A mixed day across ${facts.blockCount} work session${facts.blockCount === 1 ? '' : 's'}.`
    : `The day leaned into ${catLabel} — ${facts.dominantCategoryPct}% of the tracked time sat there.`

  const focus = facts.focusSeconds > 0
    ? (facts.focusPct >= 60
        ? `Focus held — ${facts.focusPct}% of the day matched a real signal.`
        : facts.focusPct >= 30
          ? `Focus came in pieces — ${facts.focusPct}% of the day matched a clean signal.`
          : `Focus stayed thin today — most of the time read as exploratory rather than deep.`)
    : null

  const topApp = facts.topApp
    ? (facts.topApp.isBrowser
        ? `The browser carried the most weight today, especially ${facts.topApp.appName.toLowerCase().replace(/\s+/g, '-')} time.`
        : `${facts.topApp.appName} was the anchor — most of the ${humanCategory(facts.topApp.category)} ran through it.`)
    : null

  const switching = facts.switchesPerHour >= 18
    ? `A scattered shape — context jumped ${facts.switchesPerHour} times an hour on average.`
    : facts.switchesPerHour >= 8
      ? `A reasonably steady rhythm with ${facts.switchesPerHour} switches per hour.`
      : `You held context well — under ${Math.max(1, facts.switchesPerHour)} switches an hour across the day.`

  const identity = facts.dominantCategory === 'unknown'
    ? 'No single mode took over — the day stayed mixed.'
    : facts.dominantCategoryPct >= 60
      ? `A clear ${catLabel} day — most of the time landed there.`
      : `The shape leaned ${catLabel}, with the rest of the day mixed in.`

  const closing = facts.peakBlock
    ? `The clearest stretch ran ${facts.peakBlock.startClock} to ${facts.peakBlock.endClock} — worth defending again tomorrow.`
    : 'Carry one specific thread into tomorrow rather than restarting from scratch.'

  return { scale, focus, topApp, switching, identity, closing }
}

function humanCategory(category: AppCategory | 'unknown'): string {
  switch (category) {
    case 'development': return 'development work'
    case 'aiTools': return 'AI-assisted work'
    case 'productivity': return 'admin and productivity'
    case 'writing': return 'writing'
    case 'design': return 'design work'
    case 'research': return 'research'
    case 'browsing': return 'browser activity'
    case 'communication': return 'communication'
    case 'email': return 'email'
    case 'entertainment': return 'entertainment'
    case 'social': return 'social browsing'
    case 'meetings': return 'meetings'
    default: return 'mixed activity'
  }
}
