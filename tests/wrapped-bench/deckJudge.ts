// Whole-deck judge (V2 ship plan, W1-D outcome 1). Every anchor and score in
// the benchmark is per-slide; nothing evaluated the deck as ONE story — which
// is exactly where "it doesn't sound right" lives: three slides re-announcing
// the same total, a shuffled arc, two slides disagreeing about the same fact.
// This module is the PURE half (prompt, parsing, deterministic checks, verdict
// math) so the hermetic suite can pin every rule without a provider; the
// harness owns the actual Anthropic calls.
//
// A deck fails on any of (docs/wrapped-slide-catalog.md, "The whole-deck
// judgment"):
//   a. cross-slide repetition of the same fact/number/phrase beyond one
//      deliberate callback                                 (LLM verdict)
//   b. broken arc — not one day/week told start to finish  (LLM verdict)
//   c. internal contradiction between slides               (LLM verdict)
//   d. more than one emoji across the whole deck           (deterministic)
// plus a deterministic exact-duplicate check (two slides showing the same
// prose is repetition no judge needs to deliberate about).

import { EMOJI_REGEX } from '../../src/main/lib/wrapNarrativeShared'

export interface DeckJudgeEntry {
  id: string
  kicker: string
  /** The line the user actually sees on this slide (AI or fallback). */
  line: string
  /** True when the shown line is deterministic card copy (coverage, a slide
   *  that fell back, the finale) — fixed copy is exempt from the repetition
   *  and voice reads but still counts for contradiction. */
  deterministic: boolean
}

export interface DeckJudgeCriterion {
  pass: boolean
  /** For a fail: the offending lines/facts, quoted. For a pass: ''. */
  evidence: string
}

/** The three LLM-judged criteria. */
export interface DeckJudgeVerdict {
  repetition: DeckJudgeCriterion
  arc: DeckJudgeCriterion
  contradiction: DeckJudgeCriterion
  reasoning: string
}

export interface DeckJudgeResult {
  /** Majority verdict across samples; null only when the judge itself failed. */
  verdict: DeckJudgeVerdict | null
  emojiBudget: DeckJudgeCriterion
  duplicateLines: DeckJudgeCriterion
  samples: number
  /** The deck-level gate: all three verdicts AND both deterministic checks. */
  passed: boolean
}

// ─── Deterministic checks ─────────────────────────────────────────────────────

/** Catalog rule: at most ONE emoji across the whole deck. Counts every shown
 *  piece (lines, question, reflection). */
export function checkDeckEmojiBudget(lines: string[]): DeckJudgeCriterion {
  const offenders: string[] = []
  let count = 0
  for (const line of lines) {
    const matches = [...line.matchAll(new RegExp(EMOJI_REGEX.source, 'gu'))]
    if (matches.length === 0) continue
    count += matches.length
    offenders.push(truncate(line, 60))
  }
  if (count <= 1) return { pass: true, evidence: '' }
  return {
    pass: false,
    evidence: `${count} emoji across the deck (the contract allows one): ${offenders.map((o) => `"${o}"`).join(' · ')}`,
  }
}

/** Two different slides showing the exact same prose is repetition no judge
 *  needs to deliberate about (typically two slides falling back to near-equal
 *  copy, or the writer pasting one line under two ids). Deterministic copy is
 *  exempt — it repeats by design across decks, not within one. */
export function checkDeckDuplicateLines(entries: DeckJudgeEntry[]): DeckJudgeCriterion {
  const seen = new Map<string, string>()
  for (const entry of entries) {
    if (entry.deterministic) continue
    const key = entry.line.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (key.length < 24) continue // a short caption echoing is the LLM's call
    const firstId = seen.get(key)
    if (firstId) {
      return {
        pass: false,
        evidence: `slides "${firstId}" and "${entry.id}" show the same line: "${truncate(entry.line, 80)}"`,
      }
    }
    seen.set(key, entry.id)
  }
  return { pass: true, evidence: '' }
}

// ─── The LLM pass ─────────────────────────────────────────────────────────────

export const DECK_JUDGE_SYSTEM = [
  'You are the whole-deck judge for Daylens Wrapped, a Spotify-Wrapped-style recap of one person\'s day, week, month, or year.',
  'Per-slide quality was already scored. Your ONLY job is what per-slide scoring cannot see: does the deck, read in order, work as ONE honest story? You are given every slide in the order the user sees them, plus the period\'s true facts.',
  '',
  'Judge exactly three criteria:',
  'REPETITION — fail if the same fact, number, or phrase is re-announced in the PROSE of more than one slide beyond ONE deliberate callback. The cards share numbers by design (the chart reconciles to the headline; a kicker may repeat a stat its own card shows): judge only the written lines. A closing reflection that gathers the day\'s beats into a synthesis is the one deliberate callback and is not repetition; a reflection that merely re-lists earlier slides\' sentences is.',
  'ARC — fail if the deck does not read as one period told start to finish: a hook that names the real thing, substance that follows the day\'s actual shape (story beats in chronological order when present), and an honest close that lands. The middle is deliberately shuffled for rhythm, so varied ORDER of stat cards is fine; fragments that ignore each other, a story told out of time order, or an opening/closing that describe different days are not.',
  'CONTRADICTION — fail if two slides disagree about the same fact: a morning called quiet on one card and the day\'s engine on another, totals that cannot coexist, the same stretch attributed to two different works, a day called mostly rest whose other slides describe a full working day.',
  '',
  'Lines marked [fixed] are deterministic card copy (the honesty/coverage card, a slide whose AI line was rejected, the share card). They are EXEMPT from the repetition read (their copy is fixed by design) but still count for contradiction.',
  'Judge the deck that is in front of you against its own facts. Do not fail a deck for being short, for a thin day being thin, or for taste you were not asked about.',
  '',
  'Return ONLY strict JSON:',
  '{"repetition":{"pass":true|false,"evidence":"quote the offending lines, or empty"},"arc":{"pass":true|false,"evidence":"..."},"contradiction":{"pass":true|false,"evidence":"..."},"reasoning":"one or two sentences on the deck as a whole"}',
  'Evidence for any fail MUST quote the offending slide lines. No prose outside the JSON.',
].join('\n')

export function buildDeckJudgeUser(
  cadence: 'day' | 'week' | 'month' | 'year',
  key: string,
  entries: DeckJudgeEntry[],
  factsSummary: string,
): string {
  const deck = entries
    .map((e, i) => `${i + 1}. [${e.id}]${e.deterministic ? ' [fixed]' : ''} (${e.kicker}) — ${JSON.stringify(e.line)}`)
    .join('\n')
  return [
    `Cadence: ${cadence} (${key})`,
    '',
    'The period\'s true facts (every claim must be able to coexist with these):',
    factsSummary,
    '',
    'The deck, in the exact order shown:',
    deck,
    '',
    'Judge the WHOLE deck. Return ONLY the JSON object.',
  ].join('\n')
}

export function parseDeckJudgeVerdict(raw: string): DeckJudgeVerdict | null {
  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  const criterion = (value: unknown): DeckJudgeCriterion | null => {
    if (!value || typeof value !== 'object') return null
    const c = value as Record<string, unknown>
    if (typeof c.pass !== 'boolean') return null
    return { pass: c.pass, evidence: String(c.evidence ?? '') }
  }
  const repetition = criterion(obj.repetition)
  const arc = criterion(obj.arc)
  const contradiction = criterion(obj.contradiction)
  if (!repetition || !arc || !contradiction) return null
  return { repetition, arc, contradiction, reasoning: String(obj.reasoning ?? '') }
}

/** Majority verdict across samples, per criterion — same anti-variance design
 *  as the slide judge's median. A criterion fails when at least half the
 *  samples fail it; the evidence comes from the first failing sample. */
export function combineDeckJudgeSamples(samples: DeckJudgeVerdict[]): DeckJudgeVerdict {
  if (samples.length === 0) throw new Error('combineDeckJudgeSamples: no samples')
  if (samples.length === 1) return samples[0]
  const majority = (pick: (v: DeckJudgeVerdict) => DeckJudgeCriterion): DeckJudgeCriterion => {
    const fails = samples.filter((s) => !pick(s).pass)
    if (fails.length * 2 >= samples.length) return pick(fails[0])
    return { pass: true, evidence: '' }
  }
  return {
    repetition: majority((v) => v.repetition),
    arc: majority((v) => v.arc),
    contradiction: majority((v) => v.contradiction),
    reasoning: samples[0].reasoning,
  }
}

export function deckJudgePassed(result: Pick<DeckJudgeResult, 'verdict' | 'emojiBudget' | 'duplicateLines'>): boolean {
  return Boolean(
    result.verdict
    && result.verdict.repetition.pass
    && result.verdict.arc.pass
    && result.verdict.contradiction.pass
    && result.emojiBudget.pass
    && result.duplicateLines.pass,
  )
}

/** One-line log/report rendering of a deck-level result. */
export function formatDeckJudge(result: DeckJudgeResult): string {
  if (!result.verdict) return 'deck judge FAILED TO RUN'
  const mark = (name: string, c: DeckJudgeCriterion) => (c.pass ? `${name} ok` : `${name} FAIL (${c.evidence})`)
  return [
    mark('repetition', result.verdict.repetition),
    mark('arc', result.verdict.arc),
    mark('contradiction', result.verdict.contradiction),
    mark('emoji', result.emojiBudget),
    mark('duplicates', result.duplicateLines),
  ].join(' · ')
}

function truncate(s: string, n: number): string { return s.length <= n ? s : s.slice(0, n - 1) + '…' }
