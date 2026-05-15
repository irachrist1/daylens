// Period (week / month) narrative — prompt, validation, fallback. Pure
// helpers, no DB or AI orchestration coupling, so tests can exercise them
// without dragging the rest of main in.

import { createHash } from 'node:crypto'
import { VOICE_SYSTEM_PROMPT } from '../ai/voiceContract'
import type {
  AppCategory,
  WrappedPeriodFacts,
  WrappedPeriodNarrative,
} from '@shared/types'

const MIN_FIELD_CHARS = 24
const MAX_FIELD_CHARS = 200
const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u

const BANNED_PHRASES = [
  'dive into', 'unleash', 'navigate the landscape', "in today's fast-paced",
  'game-changing', 'seamless', 'elevate', 'great question', "let's explore",
  'at the end of the day', 'fascinating perspective', "you're absolutely right",
  'harness the power', 'empower', 'robust', 'streamline', 'crush it', 'crushed it',
  "you've got this", 'you got this', 'great work', 'great job', 'amazing job',
]

export function computePeriodFactsHash(facts: WrappedPeriodFacts): string {
  const bucket = (s: number) => Math.round(s / 60)
  const canonical = JSON.stringify({
    period: facts.period,
    anchor: facts.anchorDate,
    total: bucket(facts.totalSeconds),
    prev: bucket(facts.previousPeriodSeconds),
    days: facts.daysWithActivity,
    dom: facts.dominantCategory,
    domPct: facts.dominantCategoryPct,
    busy: facts.busiestDay ? {
      d: facts.busiestDay.dateStr,
      t: bucket(facts.busiestDay.totalSeconds),
      c: facts.busiestDay.dominantCategory,
    } : null,
    long: facts.longestBlock ? {
      d: facts.longestBlock.dateStr,
      t: bucket(facts.longestBlock.durationSeconds),
      c: facts.longestBlock.dominantCategory,
    } : null,
    buckets: facts.buckets.map(b => ({ l: b.label, t: bucket(b.totalSeconds), c: b.dominantCategory })),
  })
  return createHash('sha1').update(canonical).digest('hex').slice(0, 12)
}

export function periodNarrativeCacheKey(facts: WrappedPeriodFacts, factsHash: string): string {
  return `${facts.period}|${facts.anchorDate}|${factsHash}`
}

export function buildPeriodPrompts(facts: WrappedPeriodFacts): { systemPrompt: string; userMessage: string } {
  const label = facts.period === 'week' ? 'week' : 'month'
  const prevLabel = facts.period === 'week' ? 'last week' : 'last month'

  const systemPrompt = [
    VOICE_SYSTEM_PROMPT,
    `You are Daylens, narrating a Wrapped-style ${label} recap for one person.`,
    'You will receive a compact JSON facts object derived deterministically from local activity over the period.',
    'Return STRICT JSON with exactly these keys: "lead" (string), "slides" (object with keys "chart", "record", "comparison", each a string or null).',
    'No prose outside the JSON. No code fences. No emoji. No markdown.',
    'Voice: dry, direct, second-person, a colleague who has been paying attention. No motivational filler. No exclamation marks. Specific over generic.',
    'Each string is one sentence, 24-170 characters. Never two sentences. Never ask the user a question.',
    `lead: the headline read on the ${label} — concrete and grounded in facts. Mention the dominant category if signal is clear.`,
    `slides.chart: narrates the shape across the ${label} — the busiest day or the rhythm — without restating raw hours.`,
    `slides.record: narrates the longest deep stretch in the ${label}, citing the day or category if known. null if facts.longestBlock is null.`,
    `slides.comparison: narrates the delta against ${prevLabel} — direction and what that suggests. null if previousPeriodSeconds is 0.`,
    'Never invent a duration. If a line claims hours, the number must match facts.totalSeconds / 3600 within one hour.',
    'Never invent app, domain, or project names. Only categories and dates in the facts JSON are allowed as concrete references.',
    'Never describe yourself or the model.',
  ].join(' ')

  const userMessage = [
    `Period: ${label}`,
    `Anchor date: ${facts.anchorDate}`,
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
  const chart = validateLine(slidesRaw.chart, facts)
  const record = facts.longestBlock ? validateLine(slidesRaw.record, facts) : null
  const comparison = facts.previousPeriodSeconds > 0 ? validateLine(slidesRaw.comparison, facts) : null

  return {
    period: facts.period,
    lead,
    slides: { chart, record, comparison },
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
  if (BANNED_PHRASES.some(p => lower.includes(p))) return false
  if (!claimedHoursAreConsistent(text, facts)) return false
  return true
}

function claimedHoursAreConsistent(text: string, facts: WrappedPeriodFacts): boolean {
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b)/gi)]
  if (matches.length === 0) return true
  const actualHours = facts.totalSeconds / 3600
  // For weeks we allow ±1h tolerance. For months we widen to ±4h since claims
  // tend to round more loosely (e.g. "about 80 hours" for 78).
  const tolerance = facts.period === 'week' ? 1.05 : 4.05
  for (const m of matches) {
    const claimed = Number(m[1])
    if (!Number.isFinite(claimed)) return false
    if (Math.abs(claimed - actualHours) > tolerance) return false
  }
  return true
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced?.[1]?.trim() ?? text
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

export function buildPeriodFallbackNarrative(
  facts: WrappedPeriodFacts,
  factsHash: string,
): WrappedPeriodNarrative {
  const periodLabel = facts.period === 'week' ? 'week' : 'month'
  const prevLabel = facts.period === 'week' ? 'last week' : 'last month'

  if (facts.totalSeconds <= 0) {
    return {
      period: facts.period,
      lead: `Daylens did not see enough activity this ${periodLabel} to tell a real story yet.`,
      slides: { chart: null, record: null, comparison: null },
      source: 'fallback',
      factsHash,
    }
  }

  const hours = Math.floor(facts.totalSeconds / 3600)
  const catLabel = humanCategory(facts.dominantCategory)

  const lead = facts.dominantCategory === 'unknown'
    ? `A mixed ${periodLabel} across ${facts.daysWithActivity} day${facts.daysWithActivity === 1 ? '' : 's'} of tracked activity.`
    : `A ${catLabel}-led ${periodLabel} — ${facts.dominantCategoryPct}% of the time landed there.`

  const chart = facts.busiestDay
    ? `${facts.busiestDay.dayLabel} carried the most weight this ${periodLabel} at around ${Math.floor(facts.busiestDay.totalSeconds / 3600)}h.`
    : `A roughly even spread across the ${periodLabel}, with no single day pulling away from the rest.`

  const record = facts.longestBlock
    ? `Your longest deep stretch was ${formatHm(facts.longestBlock.durationSeconds)} on ${facts.longestBlock.dayLabel}.`
    : null

  const comparison = facts.previousPeriodSeconds > 0
    ? (() => {
        const diff = facts.totalSeconds - facts.previousPeriodSeconds
        const pct = Math.round((diff / facts.previousPeriodSeconds) * 100)
        const abs = Math.abs(pct)
        if (abs < 5) return `About the same shape as ${prevLabel} — within a few hours either way.`
        const direction = pct > 0 ? 'more' : 'less'
        return `Roughly ${abs}% ${direction} tracked time than ${prevLabel} — worth noticing.`
      })()
    : null

  // Touch hours so tslint-style "unused" complaints don't appear if we extend
  // later; the value is part of the lead path that may use it.
  void hours

  return {
    period: facts.period,
    lead,
    slides: { chart, record, comparison },
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
    case 'productivity': return 'admin/productivity'
    case 'writing': return 'writing'
    case 'design': return 'design'
    case 'research': return 'research'
    case 'browsing': return 'browser'
    case 'communication': return 'communication'
    case 'email': return 'email'
    case 'entertainment': return 'entertainment'
    case 'social': return 'social'
    case 'meetings': return 'meetings'
    default: return 'mixed'
  }
}
