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
import type { WrapSlideSpec } from '../../src/renderer/lib/wrapDeck'
import type { DayWrapFacts } from '../../src/renderer/lib/dayWrapScenes'
import type { WrappedPeriod, WrappedPeriodFacts } from '../../src/shared/types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const LOG_PATH = path.resolve(HERE, '../../docs/wrapped-benchmark-log.md')
export const RESULTS_PATH = path.resolve(HERE, '.last-results.json')

const JUDGE_MODEL = process.env.WRAPPED_JUDGE_MODEL ?? 'claude-opus-4-8'

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
  cadence: 'day' | 'week'
  key: string // date or period anchor
  slides: SlideResult[]
  /** Average over the PROSE slides (captions excluded, founder Q2). */
  deckAverage: number
  /** Every prose slide >= 7 and every caption slide >= 7. */
  allSlidesPassed: boolean
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
const GEN_RETRIES = 3

export async function generateDayDeck(date: string): Promise<{ facts: DayWrapFacts } & GeneratedDeck> {
  const { getDb } = await import('../../src/main/services/database')
  const { getTimelineDayPayload } = await import('../../src/main/services/workBlocks')
  const { buildDayWrapFacts } = await import('../../src/renderer/lib/dayWrapScenes')
  const { planDayWrapSlides } = await import('../../src/renderer/lib/wrapDeck')
  const { getWrappedNarrative } = await import('../../src/main/services/wrappedNarrative')
  const { compactDayFacts } = await import('../../src/main/lib/wrappedNarrative')

  const payload = getTimelineDayPayload(getDb(), date, null)
  const facts = buildDayWrapFacts(payload)
  const slides = planDayWrapSlides(facts)
  let narrative = await getWrappedNarrative(payload, { force: true, triggerSource: 'user' })
  for (let i = 0; narrative.source === 'fallback' && i < GEN_RETRIES; i++) {
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
    factsSummary: JSON.stringify(compactDayFacts(facts)),
  }
}

export async function generatePeriodDeck(period: WrappedPeriod, anchorDate: string): Promise<{ facts: WrappedPeriodFacts } & GeneratedDeck> {
  const { planPeriodWrapSlides } = await import('../../src/renderer/lib/wrapDeck')
  const { getWrappedPeriodWrap } = await import('../../src/main/services/wrappedPeriodNarrative')
  let { facts, narrative } = await getWrappedPeriodWrap(period, anchorDate, { force: true, triggerSource: 'user' })
  for (let i = 0; narrative.source === 'fallback' && i < GEN_RETRIES; i++) {
    process.stderr.write(`[wrapped-bench] ${period} ${anchorDate} fell back (transient), retry ${i + 1}/${GEN_RETRIES}…\n`)
    await sleep(1500 * (i + 1))
    ;({ facts, narrative } = await getWrappedPeriodWrap(period, anchorDate, { force: true, triggerSource: 'user' }))
  }
  const factsSummary = JSON.stringify({
    period: facts.period, range: facts.rangeLabel,
    total: Math.round(facts.totalSeconds / 60) + 'm', work: Math.round(facts.workSeconds / 60) + 'm', leisure: Math.round(facts.leisureSeconds / 60) + 'm',
    daysActive: facts.daysWithActivity, prevPeriod: Math.round(facts.previousPeriodSeconds / 60) + 'm',
    threads: facts.threads.slice(0, 6).map((t) => ({ subject: t.subject, min: Math.round(t.seconds / 60), days: t.daysActive })),
    topApps: facts.topApps.slice(0, 8).map((a) => ({ app: a.appName, min: Math.round(a.seconds / 60) })),
    busiestDay: facts.busiestDay ? { day: facts.busiestDay.dayLabel, min: Math.round(facts.busiestDay.totalSeconds / 60) } : null,
    quietestDay: facts.quietestActiveDay ? { day: facts.quietestActiveDay.dayLabel, min: Math.round(facts.quietestActiveDay.totalSeconds / 60) } : null,
    longestStretch: facts.longestStretch ? { min: Math.round(facts.longestStretch.seconds / 60), day: facts.longestStretch.dayLabel, label: facts.longestStretch.label, from: facts.longestStretch.startClock ?? null } : null,
    leisureSurfaces: facts.leisureSurfaces.slice(0, 5), meetingsMin: Math.round(facts.meetingsSeconds / 60),
  })
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
  'For a CAPTION slide (a chart/finale caption) judge against the lighter job a one-line caption does: a caption that adds a read over the chart earns full specificity and motion; do not penalize it for not restating chart rows.',
  '',
  'Return ONLY strict JSON: {"specificity":0-3,"tone":0-2,"accuracy":0-3,"motion":0-2,"reasoning":"one or two sentences, concrete about what earned or lost points"}. No prose outside the JSON.',
].join('\n')

interface JudgeInput {
  cadence: 'day' | 'week'
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
  return [
    `Cadence: ${input.cadence}`,
    'wholeDayFacts (every true fact of the whole day/week — accuracy may draw on any of these):',
    input.wholeDayFacts,
    '',
    'This slide (its kicker and its own facts):',
    JSON.stringify(facts, null, 2),
    '',
    'The line the writer produced:',
    JSON.stringify(input.line),
    '',
    'Score it. Return ONLY the JSON object.',
  ].join('\n')
}

async function judge(anthropic: Anthropic, input: JudgeInput): Promise<SlideScore> {
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

function clamp(v: unknown, lo: number, hi: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }

// ─── Scoring a whole deck ─────────────────────────────────────────────────────

export async function scoreDeck(
  anthropic: Anthropic,
  cadence: 'day' | 'week',
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
      caption, line, role: 'line',
    })
    results.push({ id: spec.id, kind: spec.kind, source, caption, line, score, passed: source === 'ai' && score.total >= 7 })
  }

  // The question and reflection come from narrative.*, not lines[].
  const questionSpec = deck.slides.find((s) => s.id === 'question')
  if (questionSpec) {
    const source: 'ai' | 'fallback' = deck.question ? 'ai' : 'fallback'
    const line = deck.question ?? questionSpec.fallbackLine
    const score = await judge(anthropic, { cadence, slideId: 'question', kicker: questionSpec.kicker, factsNote: questionSpec.factsNote, wholeDayFacts: deck.factsSummary, caption: false, line, role: 'question' })
    results.push({ id: 'question', kind: 'question', source, caption: false, line, score, passed: source === 'ai' && score.total >= 7 })
  }
  const reflectionSpec = deck.slides.find((s) => s.id === 'reflection')
  if (reflectionSpec) {
    const source: 'ai' | 'fallback' = deck.reflection ? 'ai' : 'fallback'
    const line = deck.reflection ?? reflectionSpec.fallbackLine
    const score = await judge(anthropic, { cadence, slideId: 'reflection', kicker: reflectionSpec.kicker, factsNote: reflectionSpec.factsNote, wholeDayFacts: deck.factsSummary, caption: false, line, role: 'reflection' })
    results.push({ id: 'reflection', kind: 'reflection', source, caption: false, line, score, passed: source === 'ai' && score.total >= 7 })
  }

  const prose = results.filter((r) => !r.caption)
  const deckAverage = prose.length ? prose.reduce((s, r) => s + r.score.total, 0) / prose.length : 0
  const allSlidesPassed = results.every((r) => r.passed)
  const needsWork = results.filter((r) => r.source === 'fallback' || r.score.total < 8)

  return { cadence, key, slides: results, deckAverage: round2(deckAverage), allSlidesPassed, needsWork }
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
  lines.push(`Deck average (prose slides): **${deck.deckAverage}** · all slides passed: **${deck.allSlidesPassed}**\n`)
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
