// The one fact table the wrap agent writes from (wrapped-agent-plan.md, P0 item 2).
//
// Every number, clock time, and percent that can reach deck copy lives here,
// keyed by a stable dotted id, with its own "groundable forms" — the exact
// value plus the honest approximations a human would actually say (rounded
// hours, spelled-out counts, clock roundings). The validator (`checkCopyGrounding`)
// scans copy for numeric-looking tokens and requires each one to match a
// groundable form of a CITED fact — so a slide can say "about an hour" for a
// 59-minute fact, but never invent "1h 45m" for a 92-minute one.
//
// This module has no Electron dependency and no React dependency — it is pure
// data-in/data-out so it can be unit-tested in isolation (module placement
// note in wrapped-agent-plan.md: the deck is authored in main, so this lives
// in src/main/lib, but stays framework-free).

import { createHash } from 'node:crypto'
import type { DayEnrichment, WorkContextBlock, WrappedPeriodFacts } from '@shared/types'
import { formatHm, type DayWrapFacts } from '../../renderer/lib/dayWrapScenes'
import { largestRemainderPercentages, looksLikeRawArtifactLabel } from '../../renderer/lib/wrappedFacts'

// ─── Shapes ──────────────────────────────────────────────────────────────────

export type WrapFactKind = 'duration' | 'clock' | 'count' | 'percent' | 'label'

export interface WrapFact {
  id: string
  kind: WrapFactKind
  /** Canonical value: seconds (duration), minutes-since-midnight local (clock),
   *  integer (count), 0-100 (percent), string (label). */
  value: number | string
  display: string
  /** Lowercased strings that count as a grounded mention of this fact. */
  groundableForms: string[]
}

export interface WrapFactTable {
  cadence: 'day' | 'week' | 'month' | 'year'
  periodKey: string
  facts: Record<string, WrapFact>
  /** Stable hash of canonical values — staleness marker, never a cache key. */
  factsHash: string
}

// ─── Consistency invariant ────────────────────────────────────────────────────
// A wrap fact table is built once from one set of already-reconciled inputs.
// If two facts about the SAME quantity ever disagree beyond rounding, that is
// a bug in the caller, not something the deck should silently paper over — so
// this throws rather than emitting a table that could contradict itself
// (wrapped-agent-plan.md "no two facts about the same quantity differ").
// Gated off in production so a rare drift degrades honestly instead of
// crashing a shipped app; dev and the test suite always see it.
const THROW_ON_INCONSISTENCY = process.env.NODE_ENV !== 'production'

const CONSISTENCY_TOLERANCE_SECONDS = 2

function assertConsistent(label: string, a: number, b: number, toleranceSeconds = CONSISTENCY_TOLERANCE_SECONDS): void {
  if (!THROW_ON_INCONSISTENCY) return
  if (Math.abs(a - b) > toleranceSeconds) {
    throw new Error(`WrapFactTable consistency violation: ${label} disagree (${a} vs ${b})`)
  }
}

// ─── Small formatting helpers ──────────────────────────────────────────────────

function clockDisplay(minutesSinceMidnight: number): string {
  const m = ((Math.round(minutesSinceMidnight) % 1440) + 1440) % 1440
  const h24 = Math.floor(m / 60)
  const mm = m % 60
  const period = h24 >= 12 ? 'pm' : 'am'
  let h12 = h24 % 12
  if (h12 === 0) h12 = 12
  return `${h12}:${String(mm).padStart(2, '0')}${period}`
}

/** Parses the "11:15am" / "8am" display strings the rest of the facts layer
 *  already produces back into minutes-since-midnight, so this module can
 *  build clock facts without re-deriving raw timestamps. */
function parseClockDisplay(display: string): number | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(display.trim())
  if (!match) return null
  let h = parseInt(match[1], 10) % 12
  const mm = match[2] ? parseInt(match[2], 10) : 0
  if (match[3].toLowerCase() === 'pm') h += 12
  return h * 60 + mm
}

function minutesFromMs(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

function splitClockPeriod(display: string): [string, string] {
  const match = /^(\d{1,2}:\d{2})(am|pm)$/i.exec(display)
  if (!match) return [display, '']
  return [match[1], match[2].toLowerCase()]
}

function formatHalfHours(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1)
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']

function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'x'
}

function uniqueSlug(base: string, used: Set<string>): string {
  let slug = base
  let i = 2
  while (used.has(slug)) {
    slug = `${base}-${i}`
    i += 1
  }
  used.add(slug)
  return slug
}

// ─── Groundable forms ──────────────────────────────────────────────────────────

/** The exact value plus every honest approximation a person might actually say
 *  for this fact — the substrate `checkCopyGrounding` matches copy against. */
export function buildGroundableForms(fact: WrapFact): string[] {
  const forms = new Set<string>()
  forms.add(fact.display.toLowerCase())

  switch (fact.kind) {
    case 'duration': {
      const seconds = typeof fact.value === 'number' ? fact.value : 0
      const totalMinutes = Math.max(0, Math.round(seconds / 60))
      const h = Math.floor(totalMinutes / 60)
      const m = totalMinutes % 60
      forms.add(h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`)
      if (totalMinutes < 120) forms.add(`${totalMinutes}m`)
      if (totalMinutes >= 50) {
        const roundedHalf = Math.round((totalMinutes / 60) * 2) / 2
        const hoursLabel = formatHalfHours(roundedHalf)
        const unit = roundedHalf === 1 ? 'hour' : 'hours'
        const wordHours = roundedHalf === 1 ? 'an hour' : `${hoursLabel} hours`
        forms.add(`about ${wordHours}`)
        forms.add(`~${hoursLabel} ${unit}`)
        forms.add(`${hoursLabel} ${unit}`)
      }
      break
    }
    case 'clock': {
      const minutes = typeof fact.value === 'number' ? fact.value : 0
      const exact = clockDisplay(minutes)
      forms.add(exact)
      const [time, period] = splitClockPeriod(exact)
      if (period) {
        forms.add(`${time} ${period}`)
        forms.add(`${time}${period.toUpperCase()}`)
        forms.add(`${time} ${period.toUpperCase()}`)
      }
      const rounded5 = Math.round(minutes / 5) * 5
      if (Math.abs(rounded5 - minutes) <= 10) {
        const roundedDisplay = clockDisplay(rounded5)
        forms.add(roundedDisplay)
        const [rTime] = splitClockPeriod(roundedDisplay)
        forms.add(`about ${rTime}`)
      }
      break
    }
    case 'percent': {
      const pct = typeof fact.value === 'number' ? fact.value : 0
      forms.add(`${Math.round(pct)}%`)
      break
    }
    case 'count': {
      const n = Math.round(typeof fact.value === 'number' ? fact.value : 0)
      forms.add(String(n))
      if (n >= 0 && n <= 12) forms.add(NUMBER_WORDS[n])
      break
    }
    case 'label':
      break
  }
  return [...forms]
}

function makeFact(id: string, kind: WrapFactKind, value: number | string, display: string): WrapFact {
  const fact: WrapFact = { id, kind, value, display, groundableForms: [] }
  fact.groundableForms = buildGroundableForms(fact)
  return fact
}

function addDuration(table: Record<string, WrapFact>, id: string, seconds: number): void {
  table[id] = makeFact(id, 'duration', Math.max(0, Math.round(seconds)), formatHm(Math.max(0, seconds)))
}

function addClockMinutes(table: Record<string, WrapFact>, id: string, minutes: number): void {
  table[id] = makeFact(id, 'clock', minutes, clockDisplay(minutes))
}

function addClockFromDisplay(table: Record<string, WrapFact>, id: string, display: string | null | undefined): void {
  if (!display) return
  const minutes = parseClockDisplay(display)
  if (minutes == null) return
  addClockMinutes(table, id, minutes)
}

function addClockFromMs(table: Record<string, WrapFact>, id: string, ms: number): void {
  addClockMinutes(table, id, minutesFromMs(ms))
}

function addPercent(table: Record<string, WrapFact>, id: string, pct: number): void {
  table[id] = makeFact(id, 'percent', pct, `${Math.round(pct)}%`)
}

function addCount(table: Record<string, WrapFact>, id: string, n: number): void {
  table[id] = makeFact(id, 'count', Math.round(n), String(Math.round(n)))
}

function addLabel(table: Record<string, WrapFact>, id: string, value: string): void {
  table[id] = makeFact(id, 'label', value, value)
}

function splitPercents(work: number, leisure: number, personal: number): { work: number; leisure: number; personal: number } {
  if (work + leisure + personal <= 0) return { work: 0, leisure: 0, personal: 0 }
  const [w, l, p] = largestRemainderPercentages([work, leisure, personal])
  return { work: w, leisure: l, personal: p }
}

function computeTableHash(facts: Record<string, WrapFact>): string {
  const ids = Object.keys(facts).sort()
  const canonical = JSON.stringify(ids.map((id) => [id, facts[id].kind, facts[id].value]))
  return createHash('sha1').update(canonical).digest('hex').slice(0, 12)
}

// ─── Meeting label (never a raw artifact) ─────────────────────────────────────

function meetingLabel(block: WorkContextBlock): string {
  const raw = (block.review?.correctedLabel?.trim() || block.label.current.trim())
  if (!raw || raw.toLowerCase() === 'uncategorized' || looksLikeRawArtifactLabel(raw)) return 'Meeting'
  return raw.length > 60 ? `${raw.slice(0, 57)}...` : raw
}

function sanitizeSliceName(name: string): string {
  if (!name || looksLikeRawArtifactLabel(name)) return 'Other'
  return name
}

function sanitizeTopAppName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed || looksLikeRawArtifactLabel(trimmed)) return null
  return trimmed
}

// ─── Enrichment facts ─────────────────────────────────────────────────────────
// Connected-evidence numbers (git commits, pull requests, calendar counts,
// focus-timer runs) can reach deck copy, so they are facts like any other.
// Each count gets a stable id and the standard groundable forms (digits plus
// the spelled-out small-number words).

function addEnrichmentFacts(table: Record<string, WrapFact>, enrichment: DayEnrichment | null | undefined): void {
  if (!enrichment) return
  const used = new Set<string>()
  let commitTotal = 0
  for (const c of enrichment.shipped?.commitsByProject ?? []) {
    addCount(table, `shipped.commits.${uniqueSlug(slugify(c.project), used)}.count`, c.commits)
    commitTotal += c.commits
  }
  if (commitTotal > 0) addCount(table, 'shipped.commits.total.count', commitTotal)
  let prTotal = 0
  for (const p of enrichment.shipped?.pullRequests ?? []) {
    addCount(table, `shipped.prs.${uniqueSlug(slugify(`${p.project}-${p.state}`), used)}.count`, p.count)
    prTotal += p.count
  }
  if (prTotal > 0) addCount(table, 'shipped.prs.total.count', prTotal)
  if (enrichment.meetings) addCount(table, 'calendar.meetings.count', enrichment.meetings.count)
  if (enrichment.focusSessions) addCount(table, 'focusSessions.count', enrichment.focusSessions.sessions)
}

// ─── Day fact table ────────────────────────────────────────────────────────────

export function buildDayFactTable(
  facts: DayWrapFacts,
  blocks: WorkContextBlock[],
  periodKey: string,
  enrichment?: DayEnrichment | null,
): WrapFactTable {
  // One consistency check per invariant: the reconciled split must sum to the
  // reconciled total, or the whole table is untrustworthy (P0 item 2).
  assertConsistent(
    'day split vs total',
    facts.workSeconds + facts.leisureSeconds + facts.personalSeconds,
    facts.activeSeconds,
  )

  const table: Record<string, WrapFact> = {}

  addDuration(table, 'total.tracked', facts.activeSeconds)
  addClockFromDisplay(table, 'day.start', facts.mainStartClock)
  addClockFromDisplay(table, 'day.end', facts.ribbonEndClock)
  // The literal first activity of the calendar day can differ from the day
  // proper (a spillover sliver from last night); both are real clock facts.
  addClockFromDisplay(table, 'day.firstActivity', facts.ribbonStartClock)

  addDuration(table, 'split.work.duration', facts.workSeconds)
  addDuration(table, 'split.leisure.duration', facts.leisureSeconds)
  addDuration(table, 'split.personal.duration', facts.personalSeconds)

  const pcts = splitPercents(facts.workSeconds, facts.leisureSeconds, facts.personalSeconds)
  addPercent(table, 'split.work.percent', pcts.work)
  addPercent(table, 'split.leisure.percent', pcts.leisure)
  addPercent(table, 'split.personal.percent', pcts.personal)

  // The split SLIDE shows a two-way work-versus-leisure ratio; those exact
  // percentages are deck-reachable numbers, so they are facts too.
  if (facts.workSeconds > 0 && facts.leisureSeconds > 0) {
    const [wp, lp] = largestRemainderPercentages([facts.workSeconds, facts.leisureSeconds])
    addPercent(table, 'split.workVsLeisure.work.percent', wp)
    addPercent(table, 'split.workVsLeisure.leisure.percent', lp)
  }

  // Meeting truth: SPANS of meeting-category blocks, not category-weighted
  // seconds — the fix for the 11:15-12:28 block that displayed as 49m
  // (wrapped-agent-plan.md P0 item 3). The total is the sum of those same
  // spans, never a separately-derived category total, so the per-meeting
  // facts and the total can never disagree.
  const usedMeetingSlugs = new Set<string>()
  let meetingTotalSpanSeconds = 0
  for (const block of blocks) {
    if (block.dominantCategory !== 'meetings') continue
    const spanSeconds = Math.max(0, Math.round((block.endTime - block.startTime) / 1000))
    meetingTotalSpanSeconds += spanSeconds
    const slug = uniqueSlug(slugify(meetingLabel(block)), usedMeetingSlugs)
    addDuration(table, `meeting.${slug}.duration`, spanSeconds)
    addClockFromMs(table, `meeting.${slug}.start`, block.startTime)
    addClockFromMs(table, `meeting.${slug}.end`, block.endTime)
    addLabel(table, `meeting.${slug}.label`, meetingLabel(block))
  }
  if (meetingTotalSpanSeconds > 0) addDuration(table, 'meeting.total.duration', meetingTotalSpanSeconds)

  if (facts.standout) {
    addDuration(table, 'standout.duration', facts.standout.seconds)
    addClockFromDisplay(table, 'standout.start', facts.standout.startClock)
    addClockFromDisplay(table, 'standout.end', facts.standout.endClock)
    addLabel(table, 'standout.label', facts.standout.name)
  }

  const usedSliceSlugs = new Set<string>()
  for (const slice of facts.appSites) {
    if (slice.kind === 'other') continue
    const clean = sanitizeSliceName(slice.name)
    const slug = uniqueSlug(slugify(clean), usedSliceSlugs)
    addLabel(table, `appSite.${slug}.label`, clean)
    addDuration(table, `appSite.${slug}.duration`, slice.seconds)
  }

  addEnrichmentFacts(table, enrichment)

  return { cadence: 'day', periodKey, facts: table, factsHash: computeTableHash(table) }
}

// ─── Period fact table ─────────────────────────────────────────────────────────

export function buildPeriodFactTable(period: WrappedPeriodFacts): WrapFactTable {
  assertConsistent(
    'period split vs total',
    period.workSeconds + period.leisureSeconds + period.personalSeconds,
    period.totalSeconds,
  )

  const table: Record<string, WrapFact> = {}

  addDuration(table, 'total.tracked', period.totalSeconds)
  addDuration(table, 'split.work.duration', period.workSeconds)
  addDuration(table, 'split.leisure.duration', period.leisureSeconds)
  addDuration(table, 'split.personal.duration', period.personalSeconds)

  const pcts = splitPercents(period.workSeconds, period.leisureSeconds, period.personalSeconds)
  addPercent(table, 'split.work.percent', pcts.work)
  addPercent(table, 'split.leisure.percent', pcts.leisure)
  addPercent(table, 'split.personal.percent', pcts.personal)

  // The split slide's two-way ratio, same as the day table.
  if (period.workSeconds > 0 && period.leisureSeconds > 0) {
    const [wp, lp] = largestRemainderPercentages([period.workSeconds, period.leisureSeconds])
    addPercent(table, 'split.workVsLeisure.work.percent', wp)
    addPercent(table, 'split.workVsLeisure.leisure.percent', lp)
  }

  if (period.meetingsSeconds > 0) addDuration(table, 'meeting.total.duration', period.meetingsSeconds)

  addCount(table, 'days.active.count', period.daysWithActivity)
  if (period.daysWithActivity >= 1) {
    addDuration(table, 'day.average.duration', Math.round(period.totalSeconds / period.daysWithActivity))
  }
  if (period.previousPeriodSeconds > 0) {
    addDuration(table, 'previousPeriod.duration', period.previousPeriodSeconds)
    addDuration(table, 'previousPeriod.delta.duration', Math.abs(period.totalSeconds - period.previousPeriodSeconds))
  }

  const usedDaySlugs = new Set<string>()
  for (const day of period.days) {
    const slug = uniqueSlug(slugify(day.dateStr), usedDaySlugs)
    addDuration(table, `day.${slug}.duration`, day.totalSeconds)
    addLabel(table, `day.${slug}.label`, day.dayLabel)
  }

  if (period.busiestDay) {
    addDuration(table, 'busiestDay.duration', period.busiestDay.totalSeconds)
    addLabel(table, 'busiestDay.label', period.busiestDay.dayLabel)
  }
  if (period.quietestActiveDay) {
    addDuration(table, 'quietestDay.duration', period.quietestActiveDay.totalSeconds)
    addLabel(table, 'quietestDay.label', period.quietestActiveDay.dayLabel)
  }
  if (period.longestStretch) {
    addDuration(table, 'standout.duration', period.longestStretch.seconds)
    addLabel(table, 'standout.label', period.longestStretch.label)
    if (period.longestStretch.startClock) addClockFromDisplay(table, 'standout.start', period.longestStretch.startClock)
  }

  // Top apps route through the same raw-artifact guard as day slices — the
  // sanitizer routing fix (P0 item 4): a corrupted name is dropped, never
  // shown, rather than bypassing the guard as it did before.
  const usedAppSlugs = new Set<string>()
  for (const app of period.topApps) {
    const clean = sanitizeTopAppName(app.appName)
    if (!clean) continue
    const slug = uniqueSlug(slugify(clean), usedAppSlugs)
    addLabel(table, `appSite.${slug}.label`, clean)
    addDuration(table, `appSite.${slug}.duration`, app.seconds)
  }

  return { cadence: period.period, periodKey: period.anchorDate, facts: table, factsHash: computeTableHash(table) }
}

// ─── Grounding validator ───────────────────────────────────────────────────────

const COUNT_NOUNS = [
  'thread', 'threads', 'meeting', 'meetings', 'time', 'times', 'tab', 'tabs',
  'app', 'apps', 'site', 'sites', 'email', 'emails', 'message', 'messages',
  'call', 'calls', 'session', 'sessions', 'minute', 'minutes', 'hour', 'hours',
  'day', 'days', 'block', 'blocks', 'slide', 'slides', 'win', 'wins',
  'stretch', 'stretches',
].join('|')

// Ordered so the more specific pattern always wins at a given start index —
// JS regex alternation tries left-to-right, not longest-match, so a clock
// ("12:28pm") must be listed before a bare integer ("12") would otherwise
// swallow half of it.
const NUMERIC_TOKEN_RE = new RegExp(
  [
    String.raw`(?<clock>\d{1,2}:\d{2}\s*(?:am|pm))`,
    String.raw`(?<percent>\d{1,3}\s*%)`,
    String.raw`(?<durationHm>\d{1,2}h(?:\s*\d{1,2}m)?)`,
    String.raw`(?<durationM>\d{1,3}m)\b`,
    String.raw`(?<durationHours>\d+(?:\.\d+)?\s*hours?\b)`,
    String.raw`\b(?<spelled>one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?=\s+(?:${COUNT_NOUNS})\b)`,
    String.raw`\b(?<integer>\d{1,4})\b`,
  ].join('|'),
  'gi',
)

interface NumericToken {
  raw: string
  normalized: string
  kind: string
}

/** Conservative, well-tested tokenizer rather than a clever one (per spec):
 *  it only pulls out things that look unambiguously numeric — clocks,
 *  percents, durations, spelled-out counts next to a count noun, and bare
 *  integers. Prose with no such token ("a couple of tabs", "about an hour")
 *  is style, not a claim, and returns no tokens at all. */
function extractNumericTokens(copy: string): NumericToken[] {
  const lower = copy.toLowerCase()
  const out: NumericToken[] = []
  NUMERIC_TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = NUMERIC_TOKEN_RE.exec(lower))) {
    const groups = match.groups ?? {}
    let kind = ''
    let raw = ''
    if (groups.clock) { kind = 'clock'; raw = groups.clock }
    else if (groups.percent) { kind = 'percent'; raw = groups.percent }
    else if (groups.durationHm) { kind = 'duration'; raw = groups.durationHm }
    else if (groups.durationM) { kind = 'duration'; raw = groups.durationM }
    else if (groups.durationHours) { kind = 'duration'; raw = groups.durationHours }
    else if (groups.spelled) { kind = 'count'; raw = groups.spelled }
    else if (groups.integer) { kind = 'count'; raw = groups.integer }
    if (raw) out.push({ raw, normalized: raw.replace(/\s+/g, ' ').trim(), kind })
    if (match.index === NUMERIC_TOKEN_RE.lastIndex) NUMERIC_TOKEN_RE.lastIndex += 1
  }
  return out
}

/** Every number, clock time, and percent in `copy` must resolve to a
 *  groundable form of one of the CITED facts (wrapped-agent-plan.md "The
 *  writing contract"). Prose without numeric content always passes. */
export function checkCopyGrounding(
  copy: string,
  table: WrapFactTable,
  citedFactIds: string[],
): { ok: boolean; violations: string[] } {
  const citedForms = new Set<string>()
  for (const id of citedFactIds) {
    const fact = table.facts[id]
    if (!fact) continue
    for (const form of fact.groundableForms) citedForms.add(form.toLowerCase())
  }

  const violations: string[] = []
  for (const token of extractNumericTokens(copy)) {
    if (!citedForms.has(token.normalized)) {
      violations.push(`ungrounded ${token.kind}: "${token.raw}"`)
    }
  }
  return { ok: violations.length === 0, violations }
}

// ─── Runtime grounding forms ──────────────────────────────────────────────────
// The runtime validator checks every model line against ONE flat set of
// grounded numeric forms: everything in the fact table (with its honest
// approximations) plus every numeric token in the substrate the writer was
// actually shown (the compact facts JSON and each slide's own card text). A
// number a line could only have invented matches nothing in that set and the
// line dies to the repair round.

/** Every groundable form of every fact in the table, lowercased. */
export function allFactForms(table: WrapFactTable): Set<string> {
  const forms = new Set<string>()
  for (const fact of Object.values(table.facts)) {
    for (const form of fact.groundableForms) forms.add(form.toLowerCase())
  }
  return forms
}

/** Every normalized numeric token in a text — the harvest side of the same
 *  tokenizer the checker runs, so a number shown to the writer always grounds
 *  the writer copying it. Spacing variants ("8h 58m" / "8h58m", "12:28 pm" /
 *  "12:28pm") are the same claim, so both spellings are added. */
export function numericFormsInText(text: string): Set<string> {
  const forms = new Set<string>()
  for (const token of extractNumericTokens(text)) {
    forms.add(token.normalized)
    forms.add(token.normalized.replace(/\s+/g, ''))
  }
  return forms
}

/** Add the space-stripped spelling of every form, so spacing never decides
 *  groundedness. */
export function withSpacelessVariants(forms: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const form of forms) {
    out.add(form)
    out.add(form.replace(/\s+/g, ''))
  }
  return out
}

/** The one set the runtime validator checks lines against: every fact form in
 *  the table plus every numeric token in the substrate the writer was shown,
 *  with spacing variants, and with the bare-digits spelling of pure-minute
 *  durations (a real 30m fact makes "a 30-minute call" an honest claim). */
export function groundingFormsForRuntime(table: WrapFactTable, substrateText: string): Set<string> {
  const union = withSpacelessVariants(allFactForms(table))
  for (const form of numericFormsInText(substrateText)) union.add(form)
  for (const form of [...union]) {
    const wholeUnit = /^(\d{1,3})[mh]$/.exec(form)
    if (wholeUnit) union.add(wholeUnit[1])
  }
  return union
}

/** The first numeric token in `copy` that matches none of the grounded forms,
 *  or null when every number is grounded. "1:1" is prose (a meeting shape,
 *  not a claim about quantities), so it is never treated as a numeric token.
 *  Callers should build `groundedForms` through `groundingFormsForRuntime`. */
export function firstUngroundedNumericToken(
  copy: string,
  groundedForms: ReadonlySet<string>,
): { raw: string; kind: string } | null {
  const prose = copy.replace(/\b1:1s?\b/g, ' ')
  for (const token of extractNumericTokens(prose)) {
    if (groundedForms.has(token.normalized)) continue
    if (groundedForms.has(token.normalized.replace(/\s+/g, ''))) continue
    return { raw: token.raw, kind: token.kind }
  }
  return null
}
