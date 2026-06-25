// Period (week / month / year) Wrapped narrative — prompt, validation, and a
// deterministic baseline. Pure helpers, no DB or AI orchestration, so tests can
// drive them directly. briefs-wraps.md §6.
//
// The narrative reads from WrappedPeriodFacts, which is a SUM of frozen daily
// snapshots. The stat card reads the same facts, so they can't disagree.

import { createHash } from 'node:crypto'
import { VOICE_SYSTEM_PROMPT } from '../ai/voiceContract'
import type {
  AppCategory,
  WrappedPeriod,
  WrappedPeriodFacts,
  WrappedPeriodNarrative,
} from '@shared/types'

const MIN_FIELD_CHARS = 24
const MAX_FIELD_CHARS = 220
const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u

const BANNED_PHRASES = [
  'dive into', 'unleash', 'navigate the landscape', "in today's fast-paced",
  'game-changing', 'seamless', 'elevate', 'great question', "let's explore",
  'at the end of the day', 'fascinating perspective', "you're absolutely right",
  'harness the power', 'empower', 'robust', 'streamline', 'crush it', 'crushed it',
  "you've got this", 'you got this', 'great work', 'great job', 'amazing job',
]

// Grades the wrap must never speak (invariant 5), plus carryover / next-period
// prediction the locked decision bans every cadence.
const GRADE_PATTERNS = [
  /\bfocus(?:ed)?\s+(?:score|percentage|signal)\b/i,
  /\b\d+\s*%\s*(?:of (?:your|the|a)\b|focused)/i,
  /\b\d+%\s*of (?:a|your)?\s*\d+\s*-?\s*hour/i,
  /\bdrift\b/i,
  /\bproductiv(?:e|ity)\s+score\b/i,
  /\bpick (?:it|this|that|them) (?:back )?up\b/i,
  /\bcarry(?:ing)?\b[^.]{0,16}\b(?:forward|over|into next)\b/i,
  /\bnext (?:week|month|year)\b/i,
]

function periodWord(period: WrappedPeriod): string {
  return period === 'week' ? 'week' : period === 'month' ? 'month' : 'year'
}

export function computePeriodFactsHash(facts: WrappedPeriodFacts): string {
  const bucket = (s: number) => Math.round(s / 60)
  const canonical = JSON.stringify({
    period: facts.period,
    anchor: facts.anchorDate,
    total: bucket(facts.totalSeconds),
    work: bucket(facts.workSeconds),
    leisure: bucket(facts.leisureSeconds),
    prev: bucket(facts.previousPeriodSeconds),
    days: facts.daysWithActivity,
    dom: facts.dominantWorkCategory,
    domPct: facts.dominantWorkCategoryPct,
    cats: facts.categories.map((c) => [c.category, bucket(c.seconds)]),
    apps: facts.topApps.map((a) => [a.appName.toLowerCase(), bucket(a.seconds)]),
    threads: facts.threads.map((t) => [t.subject.toLowerCase(), bucket(t.seconds), t.daysActive]),
    busy: facts.busiestDay ? [facts.busiestDay.dateStr, bucket(facts.busiestDay.totalSeconds)] : null,
    long: facts.longestStretch ? [facts.longestStretch.label.toLowerCase(), bucket(facts.longestStretch.seconds)] : null,
    buckets: facts.buckets.map((b) => [b.label, bucket(b.totalSeconds)]),
  })
  return createHash('sha1').update(canonical).digest('hex').slice(0, 12)
}

export function periodNarrativeCacheKey(facts: WrappedPeriodFacts, factsHash: string): string {
  return `${facts.period}|${facts.anchorDate}|${factsHash}`
}

export function buildPeriodPrompts(facts: WrappedPeriodFacts): { systemPrompt: string; userMessage: string } {
  const label = periodWord(facts.period)

  const systemPrompt = [
    VOICE_SYSTEM_PROMPT,
    `You are Daylens, narrating a Spotify-Wrapped-style ${label} recap for one person.`,
    `You will receive a compact JSON facts object summed from this ${label}'s frozen daily snapshots.`,
    'Return STRICT JSON with exactly these keys: "lead" (string), "slides" (object with keys "whatMattered", "whereTimeWent", "standout", "distribution", each a string or null).',
    'No prose outside the JSON. No code fences. No emoji. No markdown. No exclamation marks.',
    'Never use an em dash (—) anywhere in the output. Use a comma, a period, or "and" instead. Use "to" for ranges, never a dash.',
    'Voice: warm but grounded, second-person, specific. Like Spotify Wrapped, personal and occasionally surprising. No motivational filler, no hedging ("likely", "approximately").',
    'Each string is one sentence, 24-200 characters. Never ask the user a question.',
    `lead — the ${label} in one line: the headline story, grounded in the facts. Name the biggest thread or the dominant work category if the signal is clear.`,
    'slides.whatMattered: name the biggest threads from facts.threads with their real hours ("12h on the timeline rework across four days"). null if facts.threads is empty.',
    'slides.whereTimeWent: tell where the WORK time went as a story across facts.categories — not a percentage readout. null if there is no real work.',
    'slides.standout: one real superlative from facts.busiestDay or facts.longestStretch ("Wednesday was your longest day", "your single longest stretch was 3h on the 14th"). null if neither is present.',
    'slides.distribution: the nitty-gritty, which apps and sites actually held the time, named from facts.topApps and facts.leisureSurfaces, friendly and skimmable, never a spreadsheet. null if there is nothing concrete.',
    'Main mode = facts.dominantWorkCategory — your actual WORK, never leisure. A working person\'s week is never "mostly entertainment" because a few videos played on the side; leisure is a quieter, separate note, never the headline.',
    'NEVER grade: no focus score, no focus percentage, no "X% of your day", no "drift", no productivity score.',
    'NEVER predict the next period, NEVER say anything carries forward or needs picking up, NEVER assign homework. The recap looks back, never ahead.',
    `Never invent a duration. If a line claims hours, the number must match facts.totalSeconds/3600 or a sub-total within a small margin.`,
    'Never invent app, domain, or project names. Only names present in the facts JSON (threads, topApps, categories, leisureSurfaces, dates) may be referenced.',
    'Never describe yourself or the model.',
  ].join(' ')

  const userMessage = [
    `Period: ${label}`,
    `Range: ${facts.rangeLabel}`,
    '',
    'Compact facts JSON:',
    JSON.stringify(facts, null, 2),
    '',
    'Return ONLY the JSON object.',
  ].join('\n')

  return { systemPrompt, userMessage }
}

export function validatePeriodNarrativeResponse(
  raw: string,
  facts: WrappedPeriodFacts,
  factsHash: string,
): WrappedPeriodNarrative | null {
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
  if (!isFieldValid(lead, facts)) return null

  const slidesRaw = (obj.slides && typeof obj.slides === 'object') ? obj.slides as Record<string, unknown> : {}
  const whatMattered = facts.threads.length > 0 ? validateLine(slidesRaw.whatMattered, facts) : null
  const whereTimeWent = facts.workSeconds > 0 ? validateLine(slidesRaw.whereTimeWent, facts) : null
  const standout = (facts.busiestDay || facts.longestStretch) ? validateLine(slidesRaw.standout, facts) : null
  const distribution = (facts.topApps.length > 0 || facts.leisureSurfaces.length > 0)
    ? validateLine(slidesRaw.distribution, facts) : null

  return {
    period: facts.period,
    lead,
    slides: { whatMattered, whereTimeWent, standout, distribution },
    source: 'ai',
    factsHash,
  }
}

function validateLine(value: unknown, facts: WrappedPeriodFacts): string | null {
  const trimmed = normalizeOptional(value)
  if (trimmed == null) return null
  if (!isFieldValid(trimmed, facts)) return null
  return trimmed
}

function normalizeOptional(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^null$/i.test(trimmed)) return null
  return trimmed
}

function isFieldValid(text: string, facts: WrappedPeriodFacts): boolean {
  if (!text) return false
  if (text.length < MIN_FIELD_CHARS) return false
  if (text.length > MAX_FIELD_CHARS) return false
  if (EMOJI_REGEX.test(text)) return false
  if (/\?$/.test(text)) return false
  if (/```/.test(text)) return false
  if (/^\s*\{/.test(text)) return false
  if (/\b(I'?m not sure|couldn'?t|cannot determine|no data|n\/?a)\b/i.test(text)) return false
  const lower = text.toLowerCase()
  if (BANNED_PHRASES.some((p) => lower.includes(p))) return false
  if (GRADE_PATTERNS.some((p) => p.test(text))) return false
  if (!claimedHoursAreConsistent(text, facts)) return false
  return true
}

function claimedHoursAreConsistent(text: string, facts: WrappedPeriodFacts): boolean {
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b)/gi)]
  if (matches.length === 0) return true
  const actualHours = facts.totalSeconds / 3600
  // Week ±1.5h; month ±5h; year ±20h — bigger periods round looser.
  const tolerance = facts.period === 'week' ? 1.5 : facts.period === 'month' ? 5 : 20
  for (const m of matches) {
    const claimed = Number(m[1])
    if (!Number.isFinite(claimed)) return false
    // A claim may legitimately reference a sub-total (a thread, an app), so only
    // reject claims that EXCEED the period total beyond tolerance.
    if (claimed - actualHours > tolerance) return false
  }
  return true
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced?.[1]?.trim() ?? text
}

// ─── Deterministic baseline ─────────────────────────────────────────────────
// briefs-wraps.md §7 forbids showing template text as the wrap. This baseline is
// NOT shown as a recap; it exists for tests and as an internal last resort the
// service logs but the UI replaces with the "connect a provider" message.

export function buildPeriodFallbackNarrative(
  facts: WrappedPeriodFacts,
  factsHash: string,
): WrappedPeriodNarrative {
  const label = periodWord(facts.period)

  if (facts.totalSeconds <= 0) {
    return {
      period: facts.period,
      lead: `Daylens did not see enough activity this ${label} to tell a real story yet.`,
      slides: { whatMattered: null, whereTimeWent: null, standout: null, distribution: null },
      source: 'fallback',
      factsHash,
    }
  }

  const catLabel = humanCategory(facts.dominantWorkCategory)
  const lead = facts.dominantWorkCategory === 'unknown'
    ? `A mixed ${label} across ${facts.daysWithActivity} day${facts.daysWithActivity === 1 ? '' : 's'} of tracked work.`
    : `A ${label} led by ${catLabel}. That is where most of the work landed.`

  const top = facts.threads[0]
  const whatMattered = top
    ? `${formatHm(top.seconds)} on ${top.subject}${top.daysActive > 1 ? ` across ${top.daysActive} days` : ''}.`
    : null

  const whereTimeWent = facts.workSeconds > 0
    ? `Most of the work time went to ${catLabel}${facts.topApps[0] ? `, mostly in ${facts.topApps[0].appName}` : ''}.`
    : null

  const standout = facts.longestStretch
    ? `Your longest stretch was ${formatHm(facts.longestStretch.seconds)} on ${facts.longestStretch.dayLabel}.`
    : facts.busiestDay
      ? `${facts.busiestDay.dayLabel} was the busiest, at ${formatHm(facts.busiestDay.totalSeconds)}.`
      : null

  // The nitty-gritty: the apps and sites that actually held the time. Looks
  // back, never ahead (no carryover, no next-period prediction).
  const apps = facts.topApps.slice(0, 3).map((a) => a.appName)
  const sites = facts.leisureSurfaces.slice(0, 2)
  const distributionParts: string[] = []
  if (apps.length > 0) distributionParts.push(apps.join(', '))
  if (sites.length > 0) distributionParts.push(`with ${sites.join(' and ')} on the side`)
  const distribution = distributionParts.length > 0
    ? `Most of the time ran through ${distributionParts.join(' ')}.`
    : null

  return {
    period: facts.period,
    lead,
    slides: { whatMattered, whereTimeWent, standout, distribution },
    source: 'fallback',
    factsHash,
  }
}

function formatHm(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h <= 0) return `${m}m`
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function humanCategory(category: AppCategory | 'unknown'): string {
  switch (category) {
    case 'development': return 'development'
    case 'aiTools': return 'AI-assisted work'
    case 'productivity': return 'admin and productivity'
    case 'writing': return 'writing'
    case 'design': return 'design'
    case 'research': return 'research'
    case 'browsing': return 'browser work'
    case 'communication': return 'communication'
    case 'email': return 'email'
    case 'meetings': return 'meetings'
    default: return 'mixed work'
  }
}
