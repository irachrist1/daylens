// Pure helpers for the daily Wrapped narrative: facts hash, prompt building,
// AI-output validation, and the deterministic fallback. Kept out of the service
// module so tests can exercise it without the AI orchestration / settings chain.
//
// The ONE facts object the wrap narrates is `DayWrapFacts` (built by
// `buildDayWrapFacts`), the same object the renderer draws from. The model only
// phrases those facts in the Daylens voice; it never invents a number, a name,
// or a superlative (voice.md §2). It writes the arc: hook → the day as a story →
// where the time went → the wildcard → a quiet close.

import { createHash } from 'node:crypto'
import { VOICE_SYSTEM_PROMPT } from '../ai/voiceContract'
import type { AIWrappedNarrative } from '@shared/types'
import {
  formatHm,
  type DayWrapFacts,
} from '../../renderer/lib/dayWrapScenes'

// ─── Hashing & cache key ──────────────────────────────────────────────────────

export function computeFactsHash(facts: DayWrapFacts): string {
  const bucket = (s: number) => Math.round(s / 60)
  const canonical = JSON.stringify({
    date: facts.date,
    quality: facts.quality,
    active: bucket(facts.activeSeconds),
    work: bucket(facts.workSeconds),
    leisure: bucket(facts.leisureSeconds),
    personal: bucket(facts.personalSeconds),
    isLeisure: facts.isLeisureDay,
    activities: facts.workActivities.map((a) => [a.name.toLowerCase(), bucket(a.seconds)]),
    appSites: facts.appSites.map((s) => [s.name.toLowerCase(), bucket(s.seconds)]),
    standout: facts.standout ? [facts.standout.name.toLowerCase(), bucket(facts.standout.seconds)] : null,
    wildcard: facts.wildcardHook ? [facts.wildcardHook.kind, facts.wildcardHook.value] : null,
    story: (['morning', 'midday', 'evening'] as const).map((p) => {
      const seg = facts.dayStory[p]
      return seg ? [p, seg.items.map((i) => i.toLowerCase()), bucket(seg.seconds)] : null
    }),
  })
  return createHash('sha1').update(canonical).digest('hex').slice(0, 12)
}

export function wrappedNarrativeCacheKey(facts: DayWrapFacts, factsHash: string): string {
  return `${facts.date}|${factsHash}`
}

// ─── Prompt construction ──────────────────────────────────────────────────────

/** The compact, model-facing projection of the facts. Every key has to earn its
 *  prompt-token cost; anything beyond this is context the model could hallucinate
 *  around. Durations are pre-formatted so the model never has to do math. */
function compactDayFacts(facts: DayWrapFacts) {
  const seg = (part: 'morning' | 'midday' | 'evening') => {
    const s = facts.dayStory[part]
    if (!s) return null
    return { when: `${s.clockStart} to ${s.clockEnd}`, did: s.items, alsoSawSomeOf: s.aside }
  }
  return {
    date: facts.date,
    weekday: facts.weekday,
    quality: facts.quality,
    total: formatHm(facts.activeSeconds),
    split: {
      work: formatHm(facts.workSeconds),
      leisure: formatHm(facts.leisureSeconds),
      personal: formatHm(facts.personalSeconds),
      mostlyRest: facts.isLeisureDay,
    },
    workedOn: facts.workActivities.map((a) => ({ what: a.name, time: formatHm(a.seconds) })),
    whereTheTimeWent: facts.appSites.map((s) => ({ name: s.name, time: formatHm(s.seconds) })),
    story: { morning: seg('morning'), midday: seg('midday'), evening: seg('evening') },
    longestStretch: facts.standout
      ? { time: formatHm(facts.standout.seconds), on: facts.standout.name, from: `${facts.standout.startClock} to ${facts.standout.endClock}` }
      : null,
    wildcard: facts.wildcardHook ? { value: facts.wildcardHook.value, means: facts.wildcardHook.caption } : null,
    topLeisure: facts.topLeisure,
  }
}

export function buildWrappedPrompts(facts: DayWrapFacts): { systemPrompt: string; userMessage: string } {
  const systemPrompt = [
    VOICE_SYSTEM_PROMPT,
    'You are Daylens, narrating a Spotify-Wrapped-style recap of one person\'s day, card by card.',
    'You will receive a compact JSON facts object derived deterministically from the user\'s local activity. Phrase ONLY what is in it. Never invent a number, an app, a site, a project, a record, or a superlative.',
    'Return STRICT JSON with exactly these keys: "lead" (string), "story" (object with keys "morning", "midday", "evening", each a string or null), "whereLine" (string or null), "wildcard" (string or null), "closing" (string or null).',
    'No prose outside the JSON. No code fences. No emoji. No markdown. No exclamation marks.',
    'Follow the Daylens voice directive appended at the end of this prompt exactly; it sets the person, warmth, and humor for the chosen voice and is the ceiling for tone. Keep every line short and punchy, one idea per card, never a paragraph.',
    'Each string is one or two short sentences, 20 to 180 characters. Never ask the user a question.',
    'NAME THE WORK, NEVER THE FILE. The facts already hand you humanized names ("the internship essay", "the timeline rework"); use those words. Never print a filename, folder, repo, branch, tab title, or video title. If a part of the day has no clean name, fold it into "a few smaller things".',
    'lead — the hook: one honest, human line on the SHAPE of the day from facts.split and facts.total. "Today was a long one." / "A quiet one." / "Mostly heads-down." If facts.split.mostlyRest, say it was mostly off the clock, plainly and without judgment. Never a score, never a percentage, never "100%".',
    'story.morning / story.midday / story.evening — the day as a story: narrate facts.story[part].did like a friend who was there, connecting the parts ("then", "after lunch"). Use the real names and the time window. Set a beat to null when facts.story[part] is null. If a part also has alsoSawSomeOf (a leisure surface), you may own it with one relevant, kind line, never a scold.',
    'whereLine — one short caption for the app and site chart in facts.whereTheTimeWent (which app or site held the most). null if there is nothing to say. Do not restate the whole list; the chart shows it.',
    'wildcard — the surprising true thing: phrase facts.wildcard.means around facts.wildcard.value. null if facts.wildcard is null. This is the "huh, neat" moment; make it land.',
    'closing — a quiet factual sign-off. "That\'s the day." is a fine default. No motivation, no homework, no "needs review", no prediction of tomorrow, no nudge to pick anything up.',
    'NEVER predict tomorrow, NEVER tell the user to pick something up or carry it forward, NEVER assign review or homework, NEVER grade, NEVER mention focus percentages or drift or guilt over a break.',
    'Never use an em dash anywhere. Use a comma, a period, or "and". Use "to" for ranges, never a dash.',
    'Any duration you write must be one already present in the facts (they are pre-formatted). Never compute or invent a new one.',
    'Never describe yourself or the model. Never say "as an AI".',
    'If facts.quality is "partial", keep every line modest and short.',
  ].join(' ')

  const userMessage = [
    `Date: ${facts.date}`,
    '',
    'Compact facts JSON:',
    JSON.stringify(compactDayFacts(facts), null, 2),
    '',
    'Return ONLY the JSON object.',
  ].join('\n')

  return { systemPrompt, userMessage }
}

// ─── Validation ───────────────────────────────────────────────────────────────

const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u
const MIN_FIELD_CHARS = 18
const MAX_FIELD_CHARS = 220

export function validateWrappedNarrativeResponse(
  raw: string,
  facts: DayWrapFacts,
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
  if (!isFieldValid(lead, facts)) return null

  const storyRaw = (obj.story && typeof obj.story === 'object') ? obj.story as Record<string, unknown> : {}
  const story = {
    // A beat is only allowed when the facts actually have that part of the day.
    morning: facts.dayStory.morning ? validateLine(storyRaw.morning, facts) : null,
    midday: facts.dayStory.midday ? validateLine(storyRaw.midday, facts) : null,
    evening: facts.dayStory.evening ? validateLine(storyRaw.evening, facts) : null,
  }
  const whereLine = facts.appSites.length > 0 ? validateLine(obj.whereLine, facts) : null
  const wildcard = facts.wildcardHook ? validateLine(obj.wildcard, facts) : null
  const closing = validateLine(obj.closing, facts)

  return { lead, story, whereLine, wildcard, closing, source: 'ai', factsHash }
}

function validateLine(value: unknown, facts: DayWrapFacts): string | null {
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

const BANNED_PHRASES = [
  'dive into', 'unleash', 'navigate the landscape', "in today's fast-paced",
  'game-changing', 'seamless', 'elevate', 'great question', "let's explore",
  'at the end of the day', 'fascinating perspective', "you're absolutely right",
  'harness the power', 'empower', 'robust', 'streamline', 'crush it', 'crushed it',
  "you've got this", 'you got this', 'great work', 'great job', 'amazing job',
]

// Carryover / homework / guilt the wrap must never speak (locked decision +
// voice.md §2.9). The whole "pick it up tomorrow" / "needs review" family is gone.
const HOMEWORK_GUILT_PATTERNS = [
  /needs?\b[^.]{0,24}\breview\b/i,
  /\bpick (?:it|this|that|them) (?:back )?up\b/i,
  /\bcarry(?:ing)?\b[^.]{0,16}\b(?:forward|over|into tomorrow)\b/i,
  /\btomorrow\b/i,
  /\bdistraction(?:s)?\b/i,
  /\bfocus(?:ed)?\s+\d+\s*%/i,
  /\b\d+\s*%\s*of (?:your|a|the)\b/i,
  /\bdrift\b/i,
]

function isFieldValid(value: string, facts: DayWrapFacts): boolean {
  if (!value) return false
  if (value.length < MIN_FIELD_CHARS) return false
  if (value.length > MAX_FIELD_CHARS) return false
  if (EMOJI_REGEX.test(value)) return false
  if (/\?$/.test(value)) return false
  if (/[—–]/.test(value)) return false // no em or en dashes
  if (/```/.test(value)) return false
  if (/^\s*\{/.test(value)) return false
  if (/\b(I'?m not sure|couldn'?t|cannot determine|no data|n\/?a)\b/i.test(value)) return false
  if (/\b100\s*%/.test(value)) return false
  const lower = value.toLowerCase()
  if (BANNED_PHRASES.some((p) => lower.includes(p))) return false
  if (HOMEWORK_GUILT_PATTERNS.some((p) => p.test(value))) return false
  if (!claimedHoursAreConsistent(value, facts)) return false
  return true
}

function claimedHoursAreConsistent(text: string, facts: DayWrapFacts): boolean {
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b)/gi)]
  if (matches.length === 0) return true
  const actualHours = facts.activeSeconds / 3600
  for (const m of matches) {
    const claimed = Number(m[1])
    if (!Number.isFinite(claimed)) return false
    // A line may reference a sub-total (one activity), so only reject a claim
    // that EXCEEDS the day total beyond a 1-hour rounding tolerance.
    if (claimed - actualHours > 1.05) return false
  }
  return true
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced?.[1]?.trim() ?? text
}

// ─── Fallback narrative (deterministic) ───────────────────────────────────────
// Never shown when no provider is connected (the UI shows the Settings message).
// This is the honest last resort when a CONNECTED provider returns unusable
// output, and the shape the tests pin.

export function buildFallbackNarrative(facts: DayWrapFacts, factsHash: string): AIWrappedNarrative {
  if (facts.quality === 'empty') {
    return {
      lead: 'Not much tracked yet. Come back once the day has more in it.',
      story: { morning: null, midday: null, evening: null },
      whereLine: null, wildcard: null, closing: null,
      source: 'fallback', factsHash,
    }
  }
  if (facts.quality === 'tooEarly') {
    return {
      lead: 'The day is still warming up. Give it a little more and check back.',
      story: { morning: null, midday: null, evening: null },
      whereLine: null, wildcard: null, closing: null,
      source: 'fallback', factsHash,
    }
  }

  const lead = buildFallbackLead(facts)
  const story = {
    morning: storyLine(facts.dayStory.morning),
    midday: storyLine(facts.dayStory.midday),
    evening: storyLine(facts.dayStory.evening),
  }
  const top = facts.appSites.find((s) => s.kind !== 'other')
  const whereLine = top ? `${top.name} held the most of it, ${formatHm(top.seconds)}.` : null
  const wildcard = facts.wildcardHook
    ? `${facts.wildcardHook.value}, ${facts.wildcardHook.caption}.`
    : null
  const closing = "That's the day."

  return { lead, story, whereLine, wildcard, closing, source: 'fallback', factsHash }
}

function buildFallbackLead(facts: DayWrapFacts): string {
  if (facts.isLeisureDay) {
    return facts.workSeconds > 0
      ? `Mostly off the clock. ${formatHm(facts.leisureSeconds)} watching, ${formatHm(facts.workSeconds)} of work.`
      : `A rest day. ${formatHm(facts.leisureSeconds)} of watching and browsing.`
  }
  const top = facts.workActivities[0]
  const shape = facts.activeSeconds / 3600 >= 6 ? 'A long one.' : facts.activeSeconds / 3600 >= 3 ? 'A full one.' : 'A lighter one.'
  return top
    ? `${shape} ${formatHm(facts.activeSeconds)}, mostly on ${lower(top.name)}.`
    : `${shape} ${formatHm(facts.activeSeconds)} tracked.`
}

function storyLine(seg: DayWrapFacts['dayStory']['morning']): string | null {
  if (!seg || seg.items.length === 0) return null
  const part = seg.part === 'morning' ? 'Morning' : seg.part === 'midday' ? 'The afternoon' : 'The evening'
  const names = seg.items.slice(0, 2).map(lower)
  const joined = names.length === 2 ? `${names[0]} and ${names[1]}` : names[0]
  return `${part} went to ${joined}.`
}

function lower(s: string): string {
  return /^[A-Z]{2,}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1)
}
