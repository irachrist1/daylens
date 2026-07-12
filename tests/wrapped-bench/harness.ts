// Wrapped benchmark harness (Stage 1.2). The ground-truth quality bar for the
// Wrapped AI content, run against the REAL provider and the REAL database.
//
// It does NOT mock. It stages a read-only copy of the user's DB, imports the
// real aiService (which registers the real provider runners), generates each
// fixture's deck through the exact production path (getWrappedNarrative /
// getWrappedPeriodWrap with force), then scores every AI-written line against
// the catalog rubric (docs/wrapped-slide-catalog.md):
//
//   Specificity 0-3, Tone 0-2, Accuracy 0-3, Narrative motion 0-2  (max 10)
//
// Scoring is two-layered: a deterministic accuracy pre-check (a line whose AI
// text was rejected by the runtime guard fell back to the deterministic line and
// counts as an AI failure), plus an LLM judge (claude-opus-4-8) that reads the
// slide's exact facts and the line and returns per-dimension scores. The judge
// is grounded: any number, clock time, percentage, or name not in the slide's
// facts is an automatic accuracy 0.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { stageReadOnlyCopyOfRealDb, cleanupRealDbCopy, type RealDbContext } from '../ai-behaviour/realDb'
import { anchorsFor, type SlideAnchors, type WrapBenchCadence } from './anchors'
import {
  DECK_JUDGE_SYSTEM,
  buildDeckJudgeUser,
  checkDeckDuplicateLines,
  checkDeckEmojiBudget,
  combineDeckJudgeSamples,
  deckJudgePassed,
  formatDeckJudge,
  parseDeckJudgeVerdict,
  type DeckJudgeEntry,
  type DeckJudgeResult,
  type DeckJudgeVerdict,
} from './deckJudge'
// The SAME deterministic honesty rules the runtime guard enforces (one shared
// source): re-run here independently so a guard regression fails the bench
// instead of shipping. Pure module — safe to import before the DB boots.
import { findOverclaimViolation, findRawArtifactLeak } from '../../src/main/lib/wrapNarrativeShared'
import type { WrapSlideSpec } from '../../src/renderer/lib/wrapDeck'
import type { DayWrapFacts } from '../../src/renderer/lib/dayWrapScenes'
import type { WrappedPeriod, WrappedPeriodFacts } from '../../src/shared/types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const LOG_PATH = path.resolve(HERE, '../../docs/wrapped-benchmark-log.md')
export const RESULTS_PATH = path.resolve(HERE, '.last-results.json')

const JUDGE_MODEL = process.env.WRAPPED_JUDGE_MODEL ?? 'claude-opus-4-8'
// The judge is sampled N times and each dimension is scored by the MEDIAN, so a
// single unlucky read can't sink (or inflate) a line. 3 is enough to kill the
// ±0.4 run-to-run swing the abstract-rubric judge used to have.
const JUDGE_SAMPLES = Math.max(1, Number(process.env.WRAPPED_JUDGE_SAMPLES) || 3)
// The whole-deck judge is sampled too (majority per criterion) so one flaky
// read can't fail — or wave through — an entire deck.
const DECK_JUDGE_SAMPLES = Math.max(1, Number(process.env.WRAPPED_DECK_JUDGE_SAMPLES) || 3)

// ─── Rubric shapes ────────────────────────────────────────────────────────────

export interface SlideScore {
  specificity: number // 0-3
  tone: number        // 0-2
  accuracy: number    // 0-3
  motion: number      // 0-2
  total: number       // 0-10
  reasoning: string
}

export interface SlideResult {
  id: string
  kind: string
  /** 'ai' = the model's line survived the guard and shipped; 'fallback' = it was
   *  rejected and the deterministic floor showed (an AI failure for the loop). */
  source: 'ai' | 'fallback'
  /** true for caption/deterministic-heavy slides held to a lighter bar and kept
   *  out of the strict deck-average math (founder decision 2026-07-08). */
  caption: boolean
  line: string
  score: SlideScore
  /** Per-slide pass: source must be 'ai' AND total >= 7. */
  passed: boolean
}

export interface DeckResult {
  cadence: WrapBenchCadence
  key: string // date or period anchor
  slides: SlideResult[]
  /** Average over the PROSE slides (captions excluded, founder Q2). */
  deckAverage: number
  /** Every prose slide >= 7 and every caption slide >= 7. */
  allSlidesPassed: boolean
  /** The whole-deck judgment: repetition / arc / contradiction (LLM, majority
   *  of samples) + emoji budget and exact-duplicate lines (deterministic). */
  deckJudge: DeckJudgeResult
  /** THE gate: every slide passed AND deckAverage >= 9 AND the deck judge
   *  passed. Per-slide perfection with a broken whole is still a fail. */
  passed: boolean
  /** Slides that need the improvement loop (source=fallback OR total < 8). */
  needsWork: SlideResult[]
}

// Caption / deterministic-heavy slides: the AI writes a short caption, judged
// against that lighter job and kept out of the >=9 deck-average gate.
const CAPTION_KINDS = new Set(['bars', 'shape', 'finale'])

// ─── Setup ────────────────────────────────────────────────────────────────────

export interface BenchContext {
  dbCtx: RealDbContext
  anthropic: Anthropic
  cleanup: () => void
}

/** Stage the DB copy, boot the real DB, register the real provider runners, and
 *  build an Anthropic client for the judge from the keytar key. */
export async function setupBench(): Promise<BenchContext> {
  const dbCtx = stageReadOnlyCopyOfRealDb()
  const { initDb } = await import('../../src/main/services/database')
  initDb()

  const { getApiKey } = await import('../../src/main/services/settings')
  const anthropicKey = (await getApiKey('anthropic').catch(() => null)) ?? process.env.ANTHROPIC_API_KEY ?? null
  if (!anthropicKey) {
    cleanupRealDbCopy(dbCtx)
    throw new Error('[wrapped-bench] No Anthropic key in keytar/env — the benchmark needs a real provider (Settings → AI).')
  }
  process.env.ANTHROPIC_API_KEY = anthropicKey

  // Importing aiService runs its module-level registerWrapped*Provider() calls,
  // wiring the real provider sender into the wrapped narrative services.
  await import('../../src/main/jobs/aiService')

  const anthropic = new Anthropic({ apiKey: anthropicKey })
  return { dbCtx, anthropic, cleanup: () => cleanupRealDbCopy(dbCtx) }
}

// ─── Generation (real production path) ────────────────────────────────────────

export interface GeneratedDeck {
  slides: WrapSlideSpec[]
  lines: Record<string, string | null>
  question: string | null
  reflection: string | null
  source: string
  /** A compact JSON of the WHOLE period's true facts. The judge scores accuracy
   *  against this, not only a slide's narrow factsNote — a line may legitimately
   *  reference any true fact of the day (e.g. "a late start" when the day began
   *  at 11:15am) even when that value is not repeated in the slide's own note. */
  factsSummary: string
}

// A whole-deck fallback means the generation call itself failed (timeout /
// transient provider error), NOT a content problem — so retry a few times
// before treating it as real. Only a persistent fallback is a genuine failure.
// EXCEPT on empty/tooEarly days: there the fallback IS the correct output
// (the quality gate refuses to spend tokens on "not enough data"), so
// retrying would just burn calls proving the gate works.
const GEN_RETRIES = 3

export async function generateDayDeck(date: string): Promise<{ facts: DayWrapFacts } & GeneratedDeck> {
  const { getDb } = await import('../../src/main/services/database')
  const { getTimelineDayPayload } = await import('../../src/main/services/workBlocks')
  const { buildDayWrapFacts } = await import('../../src/renderer/lib/dayWrapScenes')
  const { planDayWrapSlides } = await import('../../src/renderer/lib/wrapDeck')
  const { getWrappedNarrative } = await import('../../src/main/services/wrappedNarrative')
  const { compactDayFacts } = await import('../../src/main/lib/wrappedNarrative')
  const { collectExternalSignals } = await import('../../src/main/services/externalSignals')
  const { resolveDayEnrichment } = await import('../../src/main/services/enrichmentResolve')

  // Collect git/calendar so the day's enrichment is fresh, then resolve it — the
  // judge must score against the SAME facts the writer saw, or a calendar/git
  // grounded line reads as "invented" and is unfairly docked (Gap 1).
  await collectExternalSignals(date, { force: true }).catch(() => {})
  const enrichment = resolveDayEnrichment(getDb(), date)

  const payload = getTimelineDayPayload(getDb(), date, null)
  const facts = buildDayWrapFacts(payload)
  const slides = planDayWrapSlides(facts)
  const floorDay = facts.quality === 'empty' || facts.quality === 'tooEarly'
  let narrative = await getWrappedNarrative(payload, { force: true, triggerSource: 'user' })
  for (let i = 0; !floorDay && narrative.source === 'fallback' && i < GEN_RETRIES; i++) {
    process.stderr.write(`[wrapped-bench] ${date} fell back (transient), retry ${i + 1}/${GEN_RETRIES}…\n`)
    await sleep(1500 * (i + 1))
    narrative = await getWrappedNarrative(payload, { force: true, triggerSource: 'user' })
  }
  return {
    facts,
    slides,
    lines: narrative.lines ?? {},
    question: narrative.question ?? null,
    reflection: narrative.reflection ?? null,
    source: narrative.source,
    factsSummary: JSON.stringify(compactDayFacts(facts, enrichment)),
  }
}

export async function generatePeriodDeck(period: WrappedPeriod, anchorDate: string): Promise<{ facts: WrappedPeriodFacts } & GeneratedDeck> {
  const { planPeriodWrapSlides } = await import('../../src/renderer/lib/wrapDeck')
  const { getWrappedPeriodWrap } = await import('../../src/main/services/wrappedPeriodNarrative')
  const { compactPeriodFacts } = await import('../../src/main/lib/wrappedPeriodNarrative')
  let { facts, narrative } = await getWrappedPeriodWrap(period, anchorDate, { force: true, triggerSource: 'user' })
  for (let i = 0; narrative.source === 'fallback' && i < GEN_RETRIES; i++) {
    process.stderr.write(`[wrapped-bench] ${period} ${anchorDate} fell back (transient), retry ${i + 1}/${GEN_RETRIES}…\n`)
    await sleep(1500 * (i + 1))
    ;({ facts, narrative } = await getWrappedPeriodWrap(period, anchorDate, { force: true, triggerSource: 'user' }))
  }
  // The judge must score against the SAME facts the writer saw (the day path's
  // Gap-1 rule). The old hand-rolled subset dropped dayEdges/days/buckets/
  // categories, so TRUE week claims ("every day ran past 11pm") were scored as
  // invented and week decks bled accuracy for honesty they actually had.
  const factsSummary = JSON.stringify(compactPeriodFacts(facts))
  return {
    facts,
    slides: planPeriodWrapSlides(facts),
    lines: narrative.lines ?? {},
    question: narrative.question ?? null,
    reflection: narrative.reflection ?? null,
    source: narrative.source,
    factsSummary,
  }
}

// ─── The judge ────────────────────────────────────────────────────────────────

const JUDGE_SYSTEM = [
  'You are the strict quality judge for Daylens Wrapped, a Spotify-Wrapped-style recap of a person\'s day or week.',
  'You score ONE slide line against a rubric. You are given the slide\'s EXACT facts (the only true data that line may use) and the line the writer produced.',
  '',
  'Score four dimensions:',
  'You are given TWO fact sources: (1) wholeDayFacts — every true fact of the whole day/week, and (2) the slide\'s own facts. A claim is ACCURATE if it traces to EITHER source. A line may legitimately reference a true fact of the day that the slide note does not repeat (e.g. "a late start" when wholeDayFacts.dayBegan is 11:15am, or "work held the larger half" when work is most of the total). Only flag values that appear in NEITHER source.',
  'SPECIFICITY (0-3): Does it name real things from the facts — the real work, real times, real numbers — or speak vaguely ("you worked hard")? 3 = every sentence carries a specific, correct data point. 0 = generic filler.',
  'TONE (0-2): Does it read like a thoughtful friend who watched the day wrote it, or like a generated report? 2 = human, varied, warm-but-not-fawning. 0 = robotic, hype ("crushed it"), therapy, self-referential, or a bullet dressed as a sentence.',
  'ACCURACY (0-3): Does every number, clock time, percentage, and name in the line trace to the facts (either source above)? 3 = zero invented or misattributed values. ANY value present in NEITHER fact source, or misattributed, is an AUTOMATIC ACCURACY 0. A reasonable qualitative characterization of a true quantitative fact (calling a 79% share "most of the day") is NOT an invention.',
  'NARRATIVE MOTION (0-2): Does the line tell the reader something the card\'s printed number/chart cannot already show (how time spread, what a stretch meant, a true read)? 2 = adds a genuine read. 0 = merely restates the number already on the slide.',
  '',
  'Hard voice rules (breaking any caps TONE at 0): no focus/productivity scores or grades, no percentages except ones present in the facts, no hype/flattery, no therapy, no self-reference to the product, no em dashes, no homework or predictions about tomorrow, no raw filenames/repos/branches/tab titles.',
  'Clarification on names: a humanized project name that appears in wholeDayFacts.shipped (the projects the user committed to) is a REAL name the writer is required to use when narrating shipped work — never penalize it as a raw repo or as product self-reference, even when the project shares the product\'s name. Only path-like, slugged, dashed/underscored, or branch-like strings count as raw artifacts.',
  'For a CAPTION slide (a chart/finale caption) judge against the lighter job a one-line caption does: a caption that adds a read over the chart earns full specificity and motion; do not penalize it for not restating chart rows.',
  '',
  'CALIBRATION. For most slides you are given EXCELLENT lines (what a 9-10 reads like for this slide) and FAILING lines (what a line below 7 reads like). These are illustrative, not templates: the writer\'s line is different copy about a different real day. Use them ONLY to anchor your scale. A line as specific, human, and grounded as the excellent examples scores 9-10; a line as vague, robotic, hype-y, card-restating, or invented as the failing examples scores below 7. Do not reward a line for merely resembling an example, and do not punish it for differing — score the qualities, calibrated to these anchors.',
  '',
  'Return ONLY strict JSON: {"specificity":0-3,"tone":0-2,"accuracy":0-3,"motion":0-2,"reasoning":"one or two sentences, concrete about what earned or lost points"}. No prose outside the JSON.',
].join('\n')

export interface JudgeInput {
  cadence: WrapBenchCadence
  slideId: string
  kicker: string
  factsNote: string
  wholeDayFacts: string
  statValue?: string
  statSublabel?: string
  splitNote?: string
  caption: boolean
  line: string
  role: 'line' | 'question' | 'reflection'
  anchors?: SlideAnchors | null
}

function buildJudgeUser(input: JudgeInput): string {
  const facts: Record<string, unknown> = {
    slideId: input.slideId,
    kicker: input.kicker,
    thisSlideFacts: input.factsNote,
  }
  if (input.statValue) facts.numberPrintedOnCard = input.statValue
  if (input.statSublabel) facts.cardSublabel = input.statSublabel
  if (input.splitNote) facts.splitOnCard = input.splitNote
  if (input.role === 'question') facts.role = 'This is the ONE interactive question slide — it SHOULD end in a question mark; that is not a violation here.'
  if (input.role === 'reflection') facts.role = 'This is the closing reflection paragraph (3-5 sentences allowed).'
  if (input.caption) facts.slideType = 'CAPTION slide — judge against the lighter caption bar.'
  const anchorBlock = input.anchors
    ? [
        '',
        `Calibration for the "${input.slideId}" slide (illustrative, not templates):`,
        `EXCELLENT (9-10) lines:\n${input.anchors.perfect.map((l) => `  • ${l}`).join('\n')}`,
        `FAILING (<7) lines:\n${input.anchors.bad.map((l) => `  • ${l}`).join('\n')}`,
      ].join('\n')
    : ''
  return [
    `Cadence: ${input.cadence}`,
    'wholeDayFacts (every true fact of the whole day/week — accuracy may draw on any of these):',
    input.wholeDayFacts,
    '',
    'This slide (its kicker and its own facts):',
    JSON.stringify(facts, null, 2),
    anchorBlock,
    '',
    'The line the writer produced:',
    JSON.stringify(input.line),
    '',
    'Score it. Return ONLY the JSON object.',
  ].join('\n')
}

/** One judge read (with transient-retry). */
async function judgeOnce(anthropic: Anthropic, input: JudgeInput): Promise<SlideScore> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await anthropic.messages.create({
        model: JUDGE_MODEL,
        max_tokens: 400,
        system: JUDGE_SYSTEM,
        messages: [{ role: 'user', content: buildJudgeUser(input) }],
      })
      const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
      const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? text
      const parsed = JSON.parse(jsonText) as Partial<SlideScore>
      const spec = clamp(parsed.specificity, 0, 3)
      const tone = clamp(parsed.tone, 0, 2)
      const acc = clamp(parsed.accuracy, 0, 3)
      const motion = clamp(parsed.motion, 0, 2)
      return { specificity: spec, tone, accuracy: acc, motion, total: spec + tone + acc + motion, reasoning: String(parsed.reasoning ?? '') }
    } catch (err) {
      lastErr = err
      await sleep(500 * (attempt + 1))
    }
  }
  throw new Error(`[wrapped-bench] judge failed after retries: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]
}

/** Sample the judge JUDGE_SAMPLES times and score each dimension by the MEDIAN,
 *  so one unlucky read can't sink or inflate a line. The reasoning is taken from
 *  the sample whose total is closest to the median total. */
export async function judge(anthropic: Anthropic, input: JudgeInput): Promise<SlideScore> {
  const samples: SlideScore[] = []
  for (let i = 0; i < JUDGE_SAMPLES; i++) samples.push(await judgeOnce(anthropic, input))
  if (samples.length === 1) return samples[0]
  const specificity = median(samples.map((s) => s.specificity))
  const tone = median(samples.map((s) => s.tone))
  const accuracy = median(samples.map((s) => s.accuracy))
  const motion = median(samples.map((s) => s.motion))
  const total = specificity + tone + accuracy + motion
  const nearest = samples.slice().sort((a, b) => Math.abs(a.total - total) - Math.abs(b.total - total))[0]
  return { specificity, tone, accuracy, motion, total, reasoning: nearest.reasoning }
}

function clamp(v: unknown, lo: number, hi: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }

// ─── Deterministic honesty pre-check ──────────────────────────────────────────
// Never depends on an LLM's taste ("wrapped yes or no.md" §benchmark item 3):
// a line that leaks raw technical text (paths, ids, branches, JSON) or claims
// something the tracked data cannot back (attendance, idle, speculation) fails
// outright, no matter how well the judge scores its prose.

function deterministicViolation(line: string): string | null {
  const overclaim = findOverclaimViolation(line)
  if (overclaim) return overclaim
  const leak = findRawArtifactLeak(line)
  if (leak) return `raw technical text in prose: ${leak}`
  return null
}

/** Apply the deterministic check on top of the judge's read: a violation zeroes
 *  accuracy and fails the slide, and the reason is stamped into the reasoning
 *  so the log shows exactly what tripped. */
function applyDeterministicChecks(result: SlideResult): SlideResult {
  const violation = deterministicViolation(result.line)
  if (!violation) return result
  const score: SlideScore = {
    ...result.score,
    accuracy: 0,
    total: result.score.specificity + result.score.tone + result.score.motion,
    reasoning: `[deterministic fail] ${violation}. ${result.score.reasoning}`,
  }
  return { ...result, score, passed: false }
}

// ─── The whole-deck judge ─────────────────────────────────────────────────────
// Per-slide scores cannot see cross-slide repetition, a broken arc, or two
// slides contradicting each other — the exact failure "it doesn't sound right"
// names. One pass reads the ENTIRE deck in order and gates like the slides do.

async function deckJudgeOnce(anthropic: Anthropic, user: string): Promise<DeckJudgeVerdict> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await anthropic.messages.create({
        model: JUDGE_MODEL,
        max_tokens: 700,
        system: DECK_JUDGE_SYSTEM,
        messages: [{ role: 'user', content: user }],
      })
      const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
      const verdict = parseDeckJudgeVerdict(text)
      if (verdict) return verdict
      lastErr = new Error(`unparseable deck-judge response: ${text.slice(0, 200)}`)
    } catch (err) {
      lastErr = err
    }
    await sleep(500 * (attempt + 1))
  }
  throw new Error(`[wrapped-bench] deck judge failed after retries: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

export async function judgeWholeDeck(
  anthropic: Anthropic,
  cadence: WrapBenchCadence,
  key: string,
  deck: GeneratedDeck,
): Promise<DeckJudgeResult> {
  const { resolveSlideLine } = await import('../../src/renderer/lib/wrapDeck')
  const entries: DeckJudgeEntry[] = deck.slides.map((spec) => {
    const line = spec.kind === 'question'
      ? (deck.question ?? spec.fallbackLine)
      : spec.kind === 'reflection'
        ? (deck.reflection ?? spec.fallbackLine)
        : resolveSlideLine(spec, deck.lines)
    return { id: spec.id, kicker: spec.kicker, line, deterministic: line === spec.fallbackLine }
  })
  const emojiBudget = checkDeckEmojiBudget(entries.map((e) => e.line))
  const duplicateLines = checkDeckDuplicateLines(entries)
  const user = buildDeckJudgeUser(cadence, key, entries, deck.factsSummary)
  const samples: DeckJudgeVerdict[] = []
  for (let i = 0; i < DECK_JUDGE_SAMPLES; i++) samples.push(await deckJudgeOnce(anthropic, user))
  const verdict = combineDeckJudgeSamples(samples)
  const result: DeckJudgeResult = { verdict, emojiBudget, duplicateLines, samples: samples.length, passed: false }
  result.passed = deckJudgePassed(result)
  return result
}

// ─── Scoring a whole deck ─────────────────────────────────────────────────────

export async function scoreDeck(
  anthropic: Anthropic,
  cadence: WrapBenchCadence,
  key: string,
  deck: GeneratedDeck,
): Promise<DeckResult> {
  const { resolveSlideLine } = await import('../../src/renderer/lib/wrapDeck')
  const results: SlideResult[] = []

  // Score every slide that asks for an AI line.
  for (const spec of deck.slides) {
    if (!spec.ask) continue
    const aiLine = deck.lines[spec.id]
    const source: 'ai' | 'fallback' = typeof aiLine === 'string' && aiLine.trim() ? 'ai' : 'fallback'
    const line = resolveSlideLine(spec, deck.lines)
    const caption = CAPTION_KINDS.has(spec.kind)
    const score = await judge(anthropic, {
      cadence, slideId: spec.id, kicker: spec.kicker, factsNote: spec.factsNote, wholeDayFacts: deck.factsSummary,
      statValue: spec.stat?.value, statSublabel: spec.stat?.sublabel,
      splitNote: spec.split ? `${spec.split.aLabel} ${spec.split.aPct}%, ${spec.split.bLabel} ${spec.split.bPct}%` : undefined,
      caption, line, role: 'line', anchors: anchorsFor(cadence, spec.id),
    })
    results.push(applyDeterministicChecks({ id: spec.id, kind: spec.kind, source, caption, line, score, passed: source === 'ai' && score.total >= 7 }))
  }

  // The question and reflection come from narrative.*, not lines[].
  const questionSpec = deck.slides.find((s) => s.id === 'question')
  if (questionSpec) {
    const source: 'ai' | 'fallback' = deck.question ? 'ai' : 'fallback'
    const line = deck.question ?? questionSpec.fallbackLine
    const score = await judge(anthropic, { cadence, slideId: 'question', kicker: questionSpec.kicker, factsNote: questionSpec.factsNote, wholeDayFacts: deck.factsSummary, caption: false, line, role: 'question', anchors: anchorsFor(cadence, 'question') })
    results.push(applyDeterministicChecks({ id: 'question', kind: 'question', source, caption: false, line, score, passed: source === 'ai' && score.total >= 7 }))
  }
  const reflectionSpec = deck.slides.find((s) => s.id === 'reflection')
  if (reflectionSpec) {
    const source: 'ai' | 'fallback' = deck.reflection ? 'ai' : 'fallback'
    const line = deck.reflection ?? reflectionSpec.fallbackLine
    const score = await judge(anthropic, { cadence, slideId: 'reflection', kicker: reflectionSpec.kicker, factsNote: reflectionSpec.factsNote, wholeDayFacts: deck.factsSummary, caption: false, line, role: 'reflection', anchors: anchorsFor(cadence, 'reflection') })
    results.push(applyDeterministicChecks({ id: 'reflection', kind: 'reflection', source, caption: false, line, score, passed: source === 'ai' && score.total >= 7 }))
  }

  const prose = results.filter((r) => !r.caption)
  const deckAverage = prose.length ? prose.reduce((s, r) => s + r.score.total, 0) / prose.length : 0
  const allSlidesPassed = results.every((r) => r.passed)
  const needsWork = results.filter((r) => r.source === 'fallback' || r.score.total < 8)

  // The deck-level pass: one judgment of the entire deck in order, gating the
  // suite exactly like the per-slide scores do.
  const deckJudge = await judgeWholeDeck(anthropic, cadence, key, deck)
  const passed = allSlidesPassed && deckAverage >= 9 && deckJudge.passed

  return { cadence, key, slides: results, deckAverage: round2(deckAverage), allSlidesPassed, deckJudge, passed, needsWork }
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

// ─── Logging ──────────────────────────────────────────────────────────────────

/** Append one iteration's full breakdown to docs/wrapped-benchmark-log.md. */
export function appendLog(section: string): void {
  fs.appendFileSync(LOG_PATH, section)
}

export function formatDeckLog(iteration: string, deck: DeckResult, changeNote: string): string {
  const lines: string[] = []
  lines.push(`\n### ${iteration} — ${deck.cadence} ${deck.key}\n`)
  lines.push(`Deck average (prose slides): **${deck.deckAverage}** · all slides passed: **${deck.allSlidesPassed}** · deck gate: **${deck.passed ? 'PASS' : 'FAIL'}**\n`)
  lines.push(`\nWhole-deck judge: ${formatDeckJudge(deck.deckJudge)}\n`)
  if (changeNote) lines.push(`\n_What changed this iteration:_ ${changeNote}\n`)
  lines.push('\n| slide | src | spec | tone | acc | mot | total | line |')
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |')
  for (const r of deck.slides) {
    const s = r.score
    const flag = r.passed ? '' : ' ⚠️'
    const safeLine = r.line.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    lines.push(`| ${r.id}${r.caption ? ' _(cap)_' : ''}${flag} | ${r.source} | ${s.specificity} | ${s.tone} | ${s.accuracy} | ${s.motion} | **${s.total}** | ${truncate(safeLine, 90)} |`)
  }
  lines.push('\n<details><summary>judge reasoning</summary>\n')
  for (const r of deck.slides) {
    lines.push(`- **${r.id}** (${r.score.total}): ${r.score.reasoning.replace(/\n/g, ' ')}`)
  }
  lines.push('\n</details>\n')
  return lines.join('\n')
}

function truncate(s: string, n: number): string { return s.length <= n ? s : s.slice(0, n - 1) + '…' }

export function writeResults(results: DeckResult[]): void {
  fs.writeFileSync(RESULTS_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2))
}
