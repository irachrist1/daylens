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
  /** The only counts a line may attach to an enrichment noun, keyed by category
   *  ("commits:9", "meetings:2"). Enrichment rides no slide, so this is how an
   *  invented "12 commits" dies. Keyed by noun so a real "2 meetings" does NOT
   *  authorize an invented "2 commits". Empty/absent means no enrichment counts
   *  exist, so ANY such count is invented and killed. */
  allowedCounts?: ReadonlySet<string>
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

/** The first clock token in the text that is NOT grounded in the allowed set,
 *  or null when every claimed time is grounded. */
function ungroundedTimeIn(text: string, allowed: ReadonlySet<string>): string | null {
  for (const token of clockTokensIn(text)) {
    if (!allowed.has(token)) return token
  }
  return null
}

export interface WrapLineGuardOpts {
  minChars?: number
  maxChars?: number
  allowQuestion?: boolean
  allowedTimes?: ReadonlySet<string>
}

/** Why a line dies, phrased for the WRITER (the repair round feeds this back to
 *  the model verbatim), or null when the line is valid. Every reason names the
 *  offending value and what would have been allowed, so a rewrite can actually
 *  fix it instead of guessing. */
export function wrapLineViolation(value: string, ctx: LineGuardContext, opts?: WrapLineGuardOpts): string | null {
  const minChars = opts?.minChars ?? 18
  const maxChars = opts?.maxChars ?? 220
  if (!value) return 'the line is empty'
  if (value.length < minChars) return `too short (${value.length} characters; write at least ${minChars})`
  if (value.length > maxChars) return `too long (${value.length} characters; the hard cap for this slide is ${maxChars})`
  if (!emojiUsageAllowed(value)) return 'emoji rule broken: at most ONE emoji in the whole deck, from the celebration set, only at the very end of a line'
  if (!opts?.allowQuestion && /\?/.test(value)) return 'contains a question mark; only the dedicated question slide may ask'
  if (/[—–]/.test(value)) return 'contains an em or en dash; use a comma, a period, or "and"'
  if (/```/.test(value)) return 'contains a code fence'
  if (/^\s*[{[]/.test(value)) return 'reads as JSON, not prose'
  const hedge = value.match(/\b(I'?m not sure|couldn'?t|cannot determine|no data|n\/?a)\b/i)
  if (hedge) return `hedges about missing data ("${hedge[0]}"); state only what the facts support, plainly`
  const lower = value.toLowerCase()
  const banned = BANNED_PHRASES.find((p) => lower.includes(p))
  if (banned) return `contains the banned phrase "${banned}"`
  const guilt = HOMEWORK_GUILT_PATTERNS.find((p) => p.test(value))
  if (guilt) {
    const matched = value.match(guilt)?.[0] ?? ''
    return `contains banned homework/guilt/grading language ("${matched}"); never mention drift, distraction, carryover, or focus scores, not even to negate them`
  }
  const hours = hourClaimViolation(value, ctx)
  if (hours) return hours
  const percent = percentClaimViolation(value, ctx)
  if (percent) return percent
  const time = ungroundedTimeIn(value, opts?.allowedTimes ?? ctx.allowedTimes)
  if (time) {
    const allowed = [...(opts?.allowedTimes ?? ctx.allowedTimes)]
    return `writes the clock time "${time}" which is NOT in this slide's own facts (${allowed.length ? `this slide's facts only allow: ${allowed.join(', ')}` : 'this slide\'s facts contain no clock times at all'}); copy a listed time character for character, or use a part-of-day word instead`
  }
  const count = countClaimViolation(value, ctx)
  if (count) return count
  return null
}

export function isWrapLineValid(value: string, ctx: LineGuardContext, opts?: WrapLineGuardOpts): boolean {
  return wrapLineViolation(value, ctx, opts) === null
}

/** A number attached to an enrichment noun ("9 commits", "two pull requests")
 *  must be a real count from the enrichment facts. Word-form small numbers are
 *  normalized so "two meetings" is checked too. Only enrichment nouns are
 *  policed, so ordinary lines ("you opened it 14 times") are untouched. */
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}
/** Map an enrichment noun to its count category, so counts are checked against
 *  the RIGHT source ("2 meetings" never vouches for "2 commits"). */
export function countNounCategory(noun: string): 'commits' | 'prs' | 'meetings' | 'sessions' | null {
  const n = noun.toLowerCase()
  if (/^commits?$/.test(n)) return 'commits'
  if (/^(?:pull requests?|prs?|merge requests?)$/.test(n)) return 'prs'
  if (/^(?:meetings?|calls?)$/.test(n)) return 'meetings'
  if (/^(?:focus sessions?|sessions?)$/.test(n)) return 'sessions'
  return null
}
function countClaimViolation(text: string, ctx: LineGuardContext): string | null {
  const allowed = ctx.allowedCounts ?? EMPTY_COUNTS
  const re = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(commits?|pull requests?|prs?|merge requests?|meetings?|calls?|focus sessions?|sessions?)\b/gi
  for (const m of text.matchAll(re)) {
    const raw = m[1].toLowerCase()
    const n = /^\d+$/.test(raw) ? Number(raw) : WORD_NUMBERS[raw]
    if (!Number.isFinite(n)) return `claims "${m[0]}" which cannot be read as a real count`
    const category = countNounCategory(m[2])
    if (!category) return `claims "${m[0]}" which cannot be matched to a fact category`
    if (!allowed.has(`${category}:${n}`)) return `claims "${m[0]}" but the facts record no such ${category} count; copy the exact count the facts give you or drop it`
  }
  return null
}
const EMPTY_COUNTS: ReadonlySet<string> = new Set()

function hourClaimViolation(text: string, ctx: LineGuardContext): string | null {
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b)/gi)]
  for (const m of matches) {
    const claimed = Number(m[1])
    // A line may reference a sub-total (one activity), so only reject a claim
    // that EXCEEDS the period total beyond tolerance.
    if (!Number.isFinite(claimed) || claimed - ctx.totalHours > ctx.hourTolerance) {
      return `claims "${m[0]}" which exceeds the period's real total; copy durations exactly as the facts pre-format them`
    }
  }
  return null
}

function percentClaimViolation(text: string, ctx: LineGuardContext): string | null {
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
  for (const m of matches) {
    const claimed = Number(m[1])
    if (!Number.isFinite(claimed) || !ctx.allowedPercents.has(claimed)) {
      const allowed = [...ctx.allowedPercents]
      return `writes "${m[0]}" but ${allowed.length ? `the only percentages any slide shows are ${allowed.map((p) => `${p}%`).join(' and ')}, and only on the split slide` : 'no slide shows a percentage, so none may be written'}`
    }
  }
  return null
}

/** The AI's curious question: must actually be a question, short, warm, and
 *  about the period — never a task assignment. */
export function validateWrapQuestion(value: unknown, ctx: LineGuardContext): string | null {
  return wrapQuestionViolation(value, ctx).value
}

/** Detailed question validation: the surviving value, or why it died. A missing
 *  question is itself a violation — the JSON contract demands one. */
export function wrapQuestionViolation(value: unknown, ctx: LineGuardContext): { value: string | null; reason: string | null } {
  const trimmed = normalizeOptional(value)
  if (trimmed == null) return { value: null, reason: 'no question was provided; the contract requires one curious question ending in a question mark' }
  if (!/\?$/.test(trimmed)) return { value: null, reason: 'the question does not end with a question mark' }
  const lineReason = wrapLineViolation(trimmed, ctx, { minChars: 12, maxChars: 210, allowQuestion: true })
  if (lineReason) return { value: null, reason: lineReason }
  const task = trimmed.match(/\b(should you|you should|will you|promise|commit)\b/i)
  if (task) return { value: null, reason: `reads as a task or a should ("${task[0]}"); ask out of genuine curiosity, never assign` }
  return { value: trimmed, reason: null }
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
  return wrapReflectionViolation(value, ctx).value
}

/** Detailed reflection validation: the surviving value, or why it died. */
export function wrapReflectionViolation(value: unknown, ctx: LineGuardContext): { value: string | null; reason: string | null } {
  const trimmed = normalizeOptional(value)
  if (trimmed == null) return { value: null, reason: 'no reflection was provided; the contract requires a closing paragraph of 3 to 5 sentences' }
  const lineReason = wrapLineViolation(trimmed, ctx, { minChars: 80, maxChars: 650, allowQuestion: false })
  if (lineReason) return { value: null, reason: lineReason }
  return { value: trimmed, reason: null }
}

/** One rejected piece of the model's response, with the writer-facing reason.
 *  `id` is a slide id, or the pseudo-ids 'question' / 'reflection'. */
export interface WrapLineRejection {
  id: string
  candidate: string | null
  reason: string
}

export interface DeckLinesValidation {
  lines: Record<string, string | null>
  rejections: WrapLineRejection[]
}

/** Read the model's `lines` object and keep only per-slide lines that survive
 *  the guards; everything else falls back to the slide's deterministic line.
 *  Every death is recorded with its reason so the repair round (and the bench
 *  log) can see exactly why a slide fell back instead of guessing. */
export function validateDeckLinesDetailed(
  raw: Record<string, unknown> | null | undefined,
  slides: WrapSlideSpec[],
  ctx: LineGuardContext,
): DeckLinesValidation {
  const lines: Record<string, string | null> = {}
  const rejections: WrapLineRejection[] = []
  for (const spec of slides) {
    if (!spec.ask) continue
    const candidate = normalizeOptional(raw?.[spec.id])
    if (candidate == null) {
      lines[spec.id] = null
      rejections.push({ id: spec.id, candidate: null, reason: 'no line was written for this slide; the contract requires one line per listed slide id' })
      continue
    }
    // A line may only speak the clock times ITS OWN slide's facts contain —
    // this is what kills "you started at midnight" on the 11:15am card.
    const slideTimes = clockTokensIn(`${spec.kicker} ${spec.factsNote} ${spec.stat?.sublabel ?? ''} ${spec.stat?.value ?? ''}`)
    const reason = wrapLineViolation(candidate, ctx, { allowedTimes: slideTimes, maxChars: maxCharsForKind(spec.kind) })
    if (reason) {
      lines[spec.id] = null
      rejections.push({ id: spec.id, candidate, reason })
    } else {
      lines[spec.id] = candidate
    }
  }
  return { lines, rejections }
}

export function validateDeckLines(
  raw: Record<string, unknown> | null | undefined,
  slides: WrapSlideSpec[],
  ctx: LineGuardContext,
): Record<string, string | null> {
  return validateDeckLinesDetailed(raw, slides, ctx).lines
}

/** The user message for the ONE repair round: each rejected piece, the line the
 *  writer produced, why the guard killed it, and that slide's ask + facts again.
 *  The writer rewrites ONLY these; everything that survived is already final. */
export function buildRepairUserMessage(slides: WrapSlideSpec[], rejections: WrapLineRejection[]): string {
  const byId = new Map(slides.map((s) => [s.id, s]))
  const items = rejections.map((r) => {
    const spec = byId.get(r.id)
    const head = spec
      ? `- "${r.id}": ${spec.ask}\n  facts: ${spec.factsNote}`
      : r.id === 'question'
        ? '- "question": the ONE curious question, ending with a question mark.'
        : '- "reflection": the closing paragraph, 3 to 5 sentences.'
    const wrote = r.candidate == null ? '  you wrote: nothing' : `  you wrote: ${JSON.stringify(r.candidate)}`
    return `${head}\n${wrote}\n  rejected because it ${r.reason}`
  })
  const lineIds = rejections.filter((r) => r.id !== 'question' && r.id !== 'reflection').map((r) => r.id)
  const wants: string[] = []
  if (lineIds.length) wants.push(`"lines" with exactly these ids: ${lineIds.map((id) => `"${id}"`).join(', ')}`)
  if (rejections.some((r) => r.id === 'question')) wants.push('"question"')
  if (rejections.some((r) => r.id === 'reflection')) wants.push('"reflection"')
  return [
    'Some of your lines were rejected by the validator. Rewrite ONLY the pieces listed below; every other line you wrote has already been accepted and must not change.',
    'Fix exactly what each rejection names, keep every other rule, and stay just as specific and warm. Do not go vague to dodge a rejection; anchor the rewrite in a different true fact from that slide instead.',
    '',
    ...items,
    '',
    `Return STRICT JSON with only: ${wants.join(', ')}. No prose outside the JSON. No code fences.`,
  ].join('\n')
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
