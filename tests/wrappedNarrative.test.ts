import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFallbackNarrative,
  buildWrappedPrompts,
  computeFactsHash,
  validateWrappedNarrativeResponse,
} from '../src/main/lib/wrappedNarrative.ts'
import { planDayWrapSlides } from '../src/renderer/lib/wrapDeck.ts'
import { buildDayWrapFacts, type DayWrapFacts } from '../src/renderer/lib/dayWrapScenes.ts'
import type { AppCategory, DayTimelinePayload, WorkContextBlock } from '../src/shared/types.ts'
import { DEFAULT_TIMELINE_BLOCK_REVIEW } from '../src/shared/timelineReview.ts'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeBlock(opts: {
  label: string
  start: number
  durationSeconds: number
  category?: AppCategory
  appName?: string
}): WorkContextBlock {
  const category: AppCategory = opts.category ?? 'development'
  const appName = opts.appName ?? 'Cursor'
  return {
    id: `b:${opts.label}:${opts.start}`,
    startTime: opts.start,
    endTime: opts.start + opts.durationSeconds * 1000,
    dominantCategory: category,
    categoryDistribution: { [category]: opts.durationSeconds },
    ruleBasedLabel: opts.label,
    aiLabel: null,
    sessions: [],
    topApps: [{ bundleId: appName.toLowerCase(), appName, category, totalSeconds: opts.durationSeconds, sessionCount: 1, isBrowser: false }],
    websites: [],
    keyPages: [],
    pageRefs: [],
    documentRefs: [],
    topArtifacts: [],
    workflowRefs: [],
    label: {
      current: opts.label,
      source: 'rule',
      confidence: 0.92,
      narrative: null,
      ruleBased: opts.label,
      aiSuggested: null,
      override: null,
    },
    focusOverlap: { totalSeconds: opts.durationSeconds, pct: 100, sessionIds: [] },
    evidenceSummary: { apps: [], pages: [], documents: [], domains: [] },
    heuristicVersion: 'test',
    computedAt: opts.start,
    switchCount: 0,
    confidence: 'high',
    review: { ...DEFAULT_TIMELINE_BLOCK_REVIEW, state: 'auto-approved' },
    isLive: false,
  }
}

function makeDayPayload(blocks: WorkContextBlock[]): DayTimelinePayload {
  const total = blocks.reduce((s, b) => s + Math.round((b.endTime - b.startTime) / 1000), 0)
  return {
    date: '2026-05-12',
    sessions: [],
    websites: [],
    blocks,
    segments: [],
    focusSessions: [],
    computedAt: Date.now(),
    version: 'test',
    totalSeconds: total,
    focusSeconds: total,
    focusPct: 100,
    appCount: 0,
    siteCount: 0,
  }
}

const NINE_AM = new Date('2026-05-12T09:00:00').getTime()
const ONE_PM = new Date('2026-05-12T13:00:00').getTime()
const SIX_PM = new Date('2026-05-12T18:00:00').getTime()

function workingDayFacts(): DayWrapFacts {
  return buildDayWrapFacts(makeDayPayload([
    makeBlock({ label: 'Auth refactor', start: NINE_AM, durationSeconds: 90 * 60, category: 'development', appName: 'Cursor' }),
    makeBlock({ label: 'Design review', start: ONE_PM, durationSeconds: 40 * 60, category: 'design', appName: 'Figma' }),
    // A short leisure tail so the honest work/leisure split slide exists.
    makeBlock({ label: 'YouTube', start: SIX_PM, durationSeconds: 25 * 60, category: 'entertainment', appName: 'YouTube' }),
  ]))
}

function emptyFacts(): DayWrapFacts {
  return buildDayWrapFacts(makeDayPayload([]))
}

/** A clean deck response: one plausible line per asked slide id, plus a real
 *  question and reflection. Built from the SAME plan the validator replans. */
function deckResponse(facts: DayWrapFacts, over: Record<string, unknown> = {}): string {
  const lines: Record<string, string> = {}
  for (const spec of planDayWrapSlides(facts)) {
    if (!spec.ask) continue
    lines[spec.id] = spec.id === 'opening'
      ? 'A steady one, mostly heads-down on the auth work.'
      : 'A steady, honest stretch of the day, plainly told.'
  }
  return JSON.stringify({
    lines,
    question: 'What pulled you into the design review after lunch?',
    reflection: 'You went into the code early and stayed there most of the morning. The afternoon turned to the design review, and a little of the evening went to unwinding. It reads like a day that knew what it was for.',
    ...over,
  })
}

// ─── Facts shape (unchanged layer, still pinned) ──────────────────────────────

test('facts: a working day yields appSites, a story, and a wildcard hook', () => {
  const facts = workingDayFacts()
  assert.ok(facts.appSites.length >= 2, 'expected app/site distribution')
  assert.ok(facts.dayStory.some((s) => s.part === 'morning'), 'expected a morning beat')
  assert.ok(facts.dayStory.some((s) => s.part === 'midday'), 'expected a midday beat')
  assert.ok(facts.wildcardHook, 'expected a wildcard hook')
})

test('facts: the app/site distribution sums to the headline exactly', () => {
  const facts = workingDayFacts()
  const sum = facts.appSites.reduce((s, slice) => s + slice.seconds, 0)
  assert.equal(sum, facts.activeSeconds)
})

test('facts: the same date seeds identically', () => {
  assert.equal(workingDayFacts().seed, workingDayFacts().seed)
})

// ─── validateWrappedNarrativeResponse ─────────────────────────────────────────

test('validate: accepts a clean deck response and keys lines by slide id', () => {
  const facts = workingDayFacts()
  const result = validateWrappedNarrativeResponse(deckResponse(facts), facts, 'abc123')
  assert.ok(result)
  assert.equal(result!.source, 'ai')
  assert.equal(result!.factsHash, 'abc123')
  assert.equal(result!.lead, 'A steady one, mostly heads-down on the auth work.')
  assert.ok(result!.lines['story-morning'], 'expected a morning line')
  assert.ok(result!.question?.endsWith('?'), 'expected a real question')
  assert.ok(result!.reflection && result!.reflection.length >= 80, 'expected a real reflection paragraph')
})

test('validate: tolerates a fenced ```json block', () => {
  const facts = workingDayFacts()
  assert.ok(validateWrappedNarrativeResponse('```json\n' + deckResponse(facts) + '\n```', facts, 'h'))
})

test('validate: a missing or dead opening kills the whole response', () => {
  const facts = workingDayFacts()
  const linesWithout = JSON.parse(deckResponse(facts)) as { lines: Record<string, string> }
  delete linesWithout.lines.opening
  assert.equal(validateWrappedNarrativeResponse(JSON.stringify(linesWithout), facts, 'h'), null)
})

test('validate: one bad line dies alone, the deck survives', () => {
  const facts = workingDayFacts()
  const parsed = JSON.parse(deckResponse(facts)) as { lines: Record<string, string> }
  parsed.lines.headline = 'A full one — mostly heads-down.' // em dash: banned
  const result = validateWrappedNarrativeResponse(JSON.stringify(parsed), facts, 'h')
  assert.ok(result, 'the wrap must survive a single bad line')
  assert.equal(result!.lines.headline, null, 'the bad line falls back')
  assert.ok(result!.lead, 'the opening still leads')
})

test('validate: rejects an invented percentage, keeps the slide-shown one', () => {
  const facts = workingDayFacts()
  const plan = planDayWrapSlides(facts)
  const split = plan.find((s) => s.id === 'split')
  assert.ok(split?.split, 'fixture should produce a split slide')

  // A percentage no slide shows is an invented grade: the line dies.
  const bad = JSON.parse(deckResponse(facts)) as { lines: Record<string, string> }
  bad.lines.headline = 'You were productive 87% of the day, a strong showing.'
  const badResult = validateWrappedNarrativeResponse(JSON.stringify(bad), facts, 'h')
  assert.ok(badResult)
  assert.equal(badResult!.lines.headline, null)

  // The exact percentage the split slide shows is allowed.
  const good = JSON.parse(deckResponse(facts)) as { lines: Record<string, string> }
  good.lines.split = `About ${split!.split!.aPct}% of the day was real work, and the rest was rest.`
  const goodResult = validateWrappedNarrativeResponse(JSON.stringify(good), facts, 'h')
  assert.ok(goodResult)
  assert.ok(goodResult!.lines.split, 'the slide-shown percentage must survive')
})

test('validate: rejects an hour claim that exceeds the day total', () => {
  const facts = workingDayFacts()
  const parsed = JSON.parse(deckResponse(facts)) as { lines: Record<string, string> }
  parsed.lines.headline = 'You shipped 12 hours of deep development work today.'
  const result = validateWrappedNarrativeResponse(JSON.stringify(parsed), facts, 'h')
  assert.ok(result)
  assert.equal(result!.lines.headline, null)
})

test('validate: rejects carryover homework and grading, per line', () => {
  const facts = workingDayFacts()
  const parsed = JSON.parse(deckResponse(facts)) as { lines: Record<string, string> }
  parsed.lines.focus = 'The design review is still open, pick it up tomorrow morning.'
  parsed.lines.apps = 'Your drift stayed low through the whole afternoon session.'
  const result = validateWrappedNarrativeResponse(JSON.stringify(parsed), facts, 'h')
  assert.ok(result)
  assert.equal(result!.lines.focus, null)
  assert.equal(result!.lines.apps, null)
})

test('validate: the question must actually be a question', () => {
  const facts = workingDayFacts()
  const result = validateWrappedNarrativeResponse(
    deckResponse(facts, { question: 'Tell me about the best part of the day.' }),
    facts, 'h',
  )
  assert.ok(result)
  assert.equal(result!.question, null)
})

test('validate: a homework-shaped reflection is dropped', () => {
  const facts = workingDayFacts()
  const result = validateWrappedNarrativeResponse(
    deckResponse(facts, { reflection: 'A good day overall with real progress through the morning. The auth work moved and the review landed. Tomorrow you should pick it back up early and carry the momentum forward into the next block of work.' }),
    facts, 'h',
  )
  assert.ok(result)
  assert.equal(result!.reflection, null)
})

test('validate: rejects non-JSON garbage and truncated JSON', () => {
  const facts = workingDayFacts()
  assert.equal(validateWrappedNarrativeResponse('Sure! Here is the summary.', facts, 'h'), null)
  assert.equal(validateWrappedNarrativeResponse('{"lines": {"opening": "About two hours tracked', facts, 'h'), null)
})

test('validate: never writes a line for a slide the plan does not have', () => {
  const facts = workingDayFacts()
  const parsed = JSON.parse(deckResponse(facts)) as { lines: Record<string, string> }
  parsed.lines['made-up-slide'] = 'A line for a slide that does not exist in the plan.'
  const result = validateWrappedNarrativeResponse(JSON.stringify(parsed), facts, 'h')
  assert.ok(result)
  assert.equal('made-up-slide' in result!.lines, false)
})

// ─── buildFallbackNarrative ──────────────────────────────────────────────────

test('fallback: empty quality returns a modest lead and nothing else', () => {
  const result = buildFallbackNarrative(emptyFacts(), 'h')
  assert.equal(result.source, 'fallback')
  assert.deepEqual(result.lines, {})
  assert.equal(result.reflection, null)
  assert.match(result.lead, /not much tracked/i)
})

test('fallback: a working day has a lead, a question, and a reflection', () => {
  const result = buildFallbackNarrative(workingDayFacts(), 'h')
  assert.ok(result.lead)
  assert.ok(result.question, 'expected the deterministic question')
  assert.ok(result.reflection, 'expected the deterministic reflection')
})

test('fallback: never predicts tomorrow, assigns homework, or dashes', () => {
  const facts = workingDayFacts()
  const result = buildFallbackNarrative(facts, 'h')
  const everything = [result.lead, result.reflection, ...planDayWrapSlides(facts).map((s) => s.fallbackLine)]
  for (const line of everything) {
    if (!line) continue
    assert.doesNotMatch(line, /tomorrow|pick (it|this|that) up|needs? review|carry/i, `homework leaked: ${line}`)
    assert.doesNotMatch(line, /[—–]/, `dash leaked: ${line}`)
  }
})

// ─── computeFactsHash ────────────────────────────────────────────────────────

test('hash: identical facts produce identical hashes', () => {
  assert.equal(computeFactsHash(workingDayFacts()), computeFactsHash(workingDayFacts()))
})

test('hash: changing the date changes the hash', () => {
  const a = workingDayFacts()
  const b = { ...a, date: '2026-05-13' }
  assert.notEqual(computeFactsHash(a), computeFactsHash(b))
})

// ─── buildWrappedPrompts ─────────────────────────────────────────────────────

test('prompt: requests the deck JSON and bans invention, emoji, grades', () => {
  const { systemPrompt } = buildWrappedPrompts(workingDayFacts())
  assert.match(systemPrompt, /STRICT JSON/)
  assert.match(systemPrompt, /"lines"/)
  assert.match(systemPrompt, /"question"/)
  assert.match(systemPrompt, /"reflection"/)
  assert.match(systemPrompt, /No emoji/)
  assert.match(systemPrompt, /Never invent a number/)
  assert.match(systemPrompt, /NAME THE WORK, NEVER THE FILE/)
  assert.match(systemPrompt, /NEVER predict tomorrow/)
  assert.match(systemPrompt, /NEVER grade/)
})

test('prompt: the user message lists every asked slide id with its facts', () => {
  const facts = workingDayFacts()
  const { userMessage } = buildWrappedPrompts(facts)
  assert.match(userMessage, /"date": "2026-05-12"/)
  for (const spec of planDayWrapSlides(facts)) {
    if (!spec.ask) continue
    assert.ok(userMessage.includes(`- "${spec.id}":`), `expected slide ${spec.id} in the prompt`)
  }
})

// ─── Clock-time grounding (the "started at midnight" bug) ─────────────────────

test('validate: a line claiming a clock time its slide never showed dies alone', () => {
  const facts = workingDayFacts()
  const slides = planDayWrapSlides(facts)
  const story = slides.find((s) => s.id.startsWith('story-') && s.ask)
  assert.ok(story, 'expected a story slide')
  // The shipped failure: an 11am meeting narrated as "you started at midnight".
  const raw = JSON.parse(deckResponse(facts)) as { lines: Record<string, string> }
  raw.lines[story!.id] = 'You started at midnight on the meeting and kept going until 3:47am.'
  const result = validateWrappedNarrativeResponse(JSON.stringify(raw), facts, 'h')
  assert.ok(result)
  assert.equal(result!.lines[story!.id], null, 'the ungrounded midnight claim must die')
})

test('validate: a line quoting a clock time from its own slide facts survives', () => {
  const facts = workingDayFacts()
  const slides = planDayWrapSlides(facts)
  const story = slides.find((s) => s.id.startsWith('story-') && s.ask)
  assert.ok(story)
  const match = story!.factsNote.match(/\b\d{1,2}(?::\d{2})?(?:am|pm)\b/i)
  assert.ok(match, `expected a clock time in the facts note: ${story!.factsNote}`)
  const raw = JSON.parse(deckResponse(facts)) as { lines: Record<string, string> }
  raw.lines[story!.id] = `You went straight in at ${match![0]} and stayed with it, no detours.`
  const result = validateWrappedNarrativeResponse(JSON.stringify(raw), facts, 'h')
  assert.ok(result)
  assert.equal(result!.lines[story!.id], raw.lines[story!.id], 'a grounded time must survive')
})

test('validate: a question or reflection with an ungrounded time is dropped', () => {
  const facts = workingDayFacts()
  const raw = JSON.parse(deckResponse(facts)) as Record<string, unknown>
  raw.question = 'What pulled you into work at midnight, and was that planned?'
  const result = validateWrappedNarrativeResponse(JSON.stringify(raw), facts, 'h')
  assert.ok(result)
  assert.equal(result!.question, null, 'the midnight question must die when no slide shows 12am')
})

// ─── Earned celebration (one emoji, at the end, from the set) ─────────────────

test('validate: one earned celebration emoji at the end of a line survives', () => {
  const facts = workingDayFacts()
  const raw = JSON.parse(deckResponse(facts)) as { lines: Record<string, string> }
  raw.lines.opening = 'A real building day, and you saw it through 🏆'
  const result = validateWrappedNarrativeResponse(JSON.stringify(raw), facts, 'h')
  assert.ok(result)
  assert.equal(result!.lead, 'A real building day, and you saw it through 🏆')
})

test('validate: emoji confetti still dies — multiple, mid-line, or off-set emoji', () => {
  const facts = workingDayFacts()
  const slides = planDayWrapSlides(facts)
  const askable = slides.filter((s) => s.ask && s.id !== 'opening').map((s) => s.id)
  const raw = JSON.parse(deckResponse(facts)) as { lines: Record<string, string> }
  raw.lines[askable[0]] = 'Two wins today 🏆🔥 and both of them real.'
  raw.lines[askable[1]] = 'A 🚀 kind of day from the first hour onward.'
  const result = validateWrappedNarrativeResponse(JSON.stringify(raw), facts, 'h')
  assert.ok(result)
  assert.equal(result!.lines[askable[0]], null, 'two emoji must die')
  assert.equal(result!.lines[askable[1]], null, 'an off-set mid-line emoji must die')
})
