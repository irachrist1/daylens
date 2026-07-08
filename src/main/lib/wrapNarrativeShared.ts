// Shared guard rails for every Wrapped narrative (day and period): the line
// validator, the deck prompt builder, and the JSON plumbing. The model writes
// prose per slide id; everything here exists to reject a line that invents a
// number, grades the user, asks homework, or breaks the voice contract — the
// deterministic fallbackLine takes over per slide, never per wrap.

import type { WrapSlideSpec } from '../../renderer/lib/wrapDeck'

export const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u

/** The only emoji a wrap line may carry — earned celebration, one per line, at
 *  the end. Everything else still reads as AI confetti and dies. */
export const CELEBRATION_EMOJI = ['🏆', '🔥', '🌙', '☕', '🎯', '✨'] as const

/** True when the text's emoji usage is allowed: at most ONE emoji, from the
 *  celebration set, sitting at the end of the line. */
export function emojiUsageAllowed(text: string): boolean {
  const matches = [...text.matchAll(new RegExp(EMOJI_REGEX.source, 'gu'))]
  if (matches.length === 0) return true
  if (matches.length > 1) return false
  const emoji = matches[0][0]
  if (!(CELEBRATION_EMOJI as readonly string[]).includes(emoji)) return false
  return text.trimEnd().endsWith(emoji)
}

export const BANNED_PHRASES = [
  'dive into', 'unleash', 'navigate the landscape', "in today's fast-paced",
  'game-changing', 'seamless', 'elevate', 'great question', "let's explore",
  'at the end of the day', 'fascinating perspective', "you're absolutely right",
  'harness the power', 'empower', 'robust', 'streamline',
]

// Carryover / homework / guilt the wrap must never speak (locked decision +
// voice.md §2.9). No "pick it up tomorrow", no drift, no focus grades.
export const HOMEWORK_GUILT_PATTERNS = [
  /needs?\b[^.]{0,24}\breview\b/i,
  /\bpick (?:it|this|that|them) (?:back )?up\b/i,
  /\bcarry(?:ing)?\b[^.]{0,16}\b(?:forward|over|into (?:tomorrow|next))\b/i,
  /\bdistraction(?:s)?\b/i,
  /\bfocus(?:ed)?\s+(?:score|percentage|signal)\b/i,
  /\bdrift\b/i,
  /\bproductiv(?:e|ity)\s+score\b/i,
]

export function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced?.[1]?.trim() ?? text
}

export function normalizeOptional(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^null$/i.test(trimmed)) return null
  return trimmed
}

export interface LineGuardContext {
  /** The period's total hours; a claim exceeding this beyond tolerance dies. */
  totalHours: number
  /** Hour tolerance (a line may reference a sub-total, so only excess kills). */
  hourTolerance: number
  /** The only percentages a line may speak — the ones a slide actually shows.
   *  Any other percentage is an invented grade and kills the line. */
  allowedPercents: ReadonlySet<number>
  /** The only clock times a line may speak — normalized tokens harvested from
   *  the facts. "You started at midnight" when the facts say 11:15am is the
   *  single worst wrap failure; any ungrounded clock time kills the line. */
  allowedTimes: ReadonlySet<string>
}

export function guardContextPercents(slides: WrapSlideSpec[]): Set<number> {
  const allowed = new Set<number>()
  for (const spec of slides) {
    if (spec.split) { allowed.add(spec.split.aPct); allowed.add(spec.split.bPct) }
  }
  return allowed
}

// ─── Clock-time grounding ─────────────────────────────────────────────────────

const CLOCK_TOKEN_REGEX = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\bmidnight\b|\bnoon\b|\bmidday\b/gi

/** Normalize one clock mention to a comparable token: "12:00 PM" → "12pm",
 *  "midnight" → "12am", "8:22pm" → "8:22pm". */
function normalizeClockToken(match: RegExpMatchArray): string {
  const whole = match[0].toLowerCase()
  if (whole === 'midnight') return '12am'
  if (whole === 'noon' || whole === 'midday') return '12pm'
  const hour = match[1]
  const minutes = match[2] && match[2] !== '00' ? `:${match[2]}` : ''
  const meridiem = match[3].toLowerCase()
  return `${Number(hour)}${minutes}${meridiem}`
}

/** Every normalized clock token mentioned in a text. */
export function clockTokensIn(text: string): Set<string> {
  const tokens = new Set<string>()
  for (const match of text.matchAll(CLOCK_TOKEN_REGEX)) tokens.add(normalizeClockToken(match))
  return tokens
}

/** The clock tokens the whole deck's facts put on the table (kickers, facts
 *  notes, stat sublabels). Union set for the question and the reflection; the
 *  per-slide validator further restricts a line to its own slide's tokens. */
export function guardContextTimes(slides: WrapSlideSpec[]): Set<string> {
  const allowed = new Set<string>()
  for (const spec of slides) {
    for (const token of clockTokensIn(`${spec.kicker} ${spec.factsNote} ${spec.stat?.sublabel ?? ''} ${spec.stat?.value ?? ''}`)) {
      allowed.add(token)
    }
  }
  return allowed
}

function claimedTimesGrounded(text: string, allowed: ReadonlySet<string>): boolean {
  for (const token of clockTokensIn(text)) {
    if (!allowed.has(token)) return false
  }
  return true
}

export function isWrapLineValid(value: string, ctx: LineGuardContext, opts?: { minChars?: number; maxChars?: number; allowQuestion?: boolean; allowedTimes?: ReadonlySet<string> }): boolean {
  const minChars = opts?.minChars ?? 18
  const maxChars = opts?.maxChars ?? 220
  if (!value) return false
  if (value.length < minChars) return false
  if (value.length > maxChars) return false
  if (!emojiUsageAllowed(value)) return false
  if (!opts?.allowQuestion && /\?/.test(value)) return false
  if (/[—–]/.test(value)) return false // no em or en dashes
  if (/```/.test(value)) return false
  if (/^\s*[{[]/.test(value)) return false
  if (/\b(I'?m not sure|couldn'?t|cannot determine|no data|n\/?a)\b/i.test(value)) return false
  const lower = value.toLowerCase()
  if (BANNED_PHRASES.some((p) => lower.includes(p))) return false
  if (HOMEWORK_GUILT_PATTERNS.some((p) => p.test(value))) return false
  if (!claimedHoursConsistent(value, ctx)) return false
  if (!claimedPercentsAllowed(value, ctx)) return false
  if (!claimedTimesGrounded(value, opts?.allowedTimes ?? ctx.allowedTimes)) return false
  return true
}

function claimedHoursConsistent(text: string, ctx: LineGuardContext): boolean {
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b)/gi)]
  for (const m of matches) {
    const claimed = Number(m[1])
    if (!Number.isFinite(claimed)) return false
    // A line may reference a sub-total (one activity), so only reject a claim
    // that EXCEEDS the period total beyond tolerance.
    if (claimed - ctx.totalHours > ctx.hourTolerance) return false
  }
  return true
}

function claimedPercentsAllowed(text: string, ctx: LineGuardContext): boolean {
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
  for (const m of matches) {
    const claimed = Number(m[1])
    if (!Number.isFinite(claimed)) return false
    if (!ctx.allowedPercents.has(claimed)) return false
  }
  return true
}

/** The AI's curious question: must actually be a question, short, warm, and
 *  about the period — never a task assignment. */
export function validateWrapQuestion(value: unknown, ctx: LineGuardContext): string | null {
  const trimmed = normalizeOptional(value)
  if (trimmed == null) return null
  if (!/\?$/.test(trimmed)) return null
  if (!isWrapLineValid(trimmed, ctx, { minChars: 12, maxChars: 210, allowQuestion: true })) return null
  if (/\b(should you|you should|will you|promise|commit)\b/i.test(trimmed)) return null
  return trimmed
}

/** Per-slide upper bound on line length. The story/leisure beats ("text") are the
 *  narrative heart and legitimately run to two full sentences, so they get more
 *  room than a stat caption; everything else stays punchy. Kept well short of a
 *  paragraph (voice.md §11 — short lines, never a wall). */
export function maxCharsForKind(kind: string): number {
  return kind === 'text' ? 340 : 220
}

/** The finale reflection: a real paragraph, longer leash, same honesty rules. */
export function validateWrapReflection(value: unknown, ctx: LineGuardContext): string | null {
  const trimmed = normalizeOptional(value)
  if (trimmed == null) return null
  if (!isWrapLineValid(trimmed, ctx, { minChars: 80, maxChars: 650, allowQuestion: false })) return null
  return trimmed
}

/** Read the model's `lines` object and keep only per-slide lines that survive
 *  the guards; everything else falls back to the slide's deterministic line. */
export function validateDeckLines(
  raw: Record<string, unknown> | null | undefined,
  slides: WrapSlideSpec[],
  ctx: LineGuardContext,
): Record<string, string | null> {
  const lines: Record<string, string | null> = {}
  for (const spec of slides) {
    if (!spec.ask) continue
    const candidate = normalizeOptional(raw?.[spec.id])
    // A line may only speak the clock times ITS OWN slide's facts contain —
    // this is what kills "you started at midnight" on the 11:15am card.
    const slideTimes = clockTokensIn(`${spec.kicker} ${spec.factsNote} ${spec.stat?.sublabel ?? ''} ${spec.stat?.value ?? ''}`)
    lines[spec.id] = candidate != null && isWrapLineValid(candidate, ctx, { allowedTimes: slideTimes, maxChars: maxCharsForKind(spec.kind) }) ? candidate : null
  }
  return lines
}

/** The per-slide section of the user prompt: id, what to write, and the true
 *  facts the line may use. The model may never write about a slide not listed. */
export function deckPromptSection(slides: WrapSlideSpec[]): string {
  const rows = slides
    .filter((s) => s.ask)
    .map((s) => `- "${s.id}": ${s.ask}\n  facts: ${s.factsNote}`)
  return ['Slides to write, keyed by id:', ...rows].join('\n')
}

/** The JSON contract shared by the day and period prompts. */
export const DECK_JSON_CONTRACT = [
  'Return STRICT JSON with exactly these keys:',
  '"lines" — an object with one string per slide id listed below. Write ONLY the listed ids.',
  '"question" — ONE genuine question you are curious about after reading the facts, addressed to the user, ending with a question mark. Curious, specific to THIS data, never a task, never a should.',
  '"reflection" — one paragraph (3 to 5 sentences, under 600 characters) you would send the user as a closing message about this period. Warm, specific, grounded in the facts, no advice, no homework, no prediction.',
  'No prose outside the JSON. No code fences. No markdown. No exclamation marks. No emoji anywhere except the single earned celebration emoji the instructions allow, at the end of at most one line.',
].join(' ')
