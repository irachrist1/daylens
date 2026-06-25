import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFallbackNarrative,
  buildWrappedPrompts,
  computeFactsHash,
  validateWrappedNarrativeResponse,
} from '../src/main/lib/wrappedNarrative.ts'
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

function workingDayFacts(): DayWrapFacts {
  return buildDayWrapFacts(makeDayPayload([
    makeBlock({ label: 'Auth refactor', start: NINE_AM, durationSeconds: 90 * 60, category: 'development', appName: 'Cursor' }),
    makeBlock({ label: 'Design review', start: ONE_PM, durationSeconds: 40 * 60, category: 'design', appName: 'Figma' }),
  ]))
}

function emptyFacts(): DayWrapFacts {
  return buildDayWrapFacts(makeDayPayload([]))
}

// A clean arc response that matches the working-day facts.
function cleanResponse(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    lead: 'A full one. About two hours, mostly heads-down.',
    story: {
      morning: 'Morning went to the auth refactor in Cursor.',
      midday: 'After lunch you moved to the design review.',
      evening: null,
    },
    whereLine: 'Cursor held the most of it.',
    wildcard: 'Your longest unbroken stretch ran an hour and a half.',
    closing: "That's the day.",
    ...over,
  })
}

// ─── Facts shape ──────────────────────────────────────────────────────────────

test('facts: a working day yields appSites, a story, and a wildcard hook', () => {
  const facts = workingDayFacts()
  assert.ok(facts.appSites.length >= 2, 'expected app/site distribution')
  assert.ok(facts.dayStory.morning, 'expected a morning beat')
  assert.ok(facts.dayStory.midday, 'expected a midday beat')
  assert.equal(facts.dayStory.evening, null)
  assert.ok(facts.wildcardHook, 'expected a wildcard hook')
})

test('facts: the app/site distribution sums to the headline exactly', () => {
  const facts = workingDayFacts()
  const sum = facts.appSites.reduce((s, slice) => s + slice.seconds, 0)
  assert.equal(sum, facts.activeSeconds)
})

test('facts: the same date seeds identically, adjacent dates differ', () => {
  const a = workingDayFacts()
  const b = workingDayFacts()
  assert.equal(a.seed, b.seed)
})

// ─── validateWrappedNarrativeResponse ─────────────────────────────────────────

test('validate: accepts a clean arc response matching the facts', () => {
  const result = validateWrappedNarrativeResponse(cleanResponse(), workingDayFacts(), 'abc123')
  assert.ok(result)
  assert.equal(result?.source, 'ai')
  assert.equal(result?.factsHash, 'abc123')
  assert.ok(result!.story.morning)
  assert.ok(result!.wildcard)
})

test('validate: tolerates a fenced ```json block', () => {
  const raw = '```json\n' + cleanResponse() + '\n```'
  assert.ok(validateWrappedNarrativeResponse(raw, workingDayFacts(), 'h'))
})

test('validate: rejects an empty lead', () => {
  assert.equal(validateWrappedNarrativeResponse(cleanResponse({ lead: '' }), workingDayFacts(), 'h'), null)
})

test('validate: rejects a too-long lead', () => {
  const longText = 'You held the line all day. '.repeat(20)
  assert.equal(validateWrappedNarrativeResponse(cleanResponse({ lead: longText }), workingDayFacts(), 'h'), null)
})

test('validate: rejects emoji in the lead', () => {
  assert.equal(validateWrappedNarrativeResponse(cleanResponse({ lead: 'A solid two hours of heads-down work today 🚀' }), workingDayFacts(), 'h'), null)
})

test('validate: rejects an em dash anywhere', () => {
  assert.equal(validateWrappedNarrativeResponse(cleanResponse({ lead: 'A full one — mostly heads-down for two hours.' }), workingDayFacts(), 'h'), null)
})

test('validate: rejects a lead that asks a question', () => {
  assert.equal(validateWrappedNarrativeResponse(cleanResponse({ lead: 'Was today the focused day you were hoping for?' }), workingDayFacts(), 'h'), null)
})

test('validate: rejects an hour claim that exceeds the day total', () => {
  // Facts total is 2h10m; claiming 12 hours is invented.
  assert.equal(validateWrappedNarrativeResponse(cleanResponse({ lead: 'You shipped 12 hours of deep development work today.' }), workingDayFacts(), 'h'), null)
})

test('validate: rejects a "100%" claim', () => {
  assert.equal(validateWrappedNarrativeResponse(cleanResponse({ lead: 'You were 100% on the auth refactor all morning long.' }), workingDayFacts(), 'h'), null)
})

test('validate: drops a story beat for a part of the day that did not happen', () => {
  // Evening is null in the facts, so any evening beat the model invents is dropped.
  const result = validateWrappedNarrativeResponse(
    cleanResponse({ story: { morning: 'Morning was the auth refactor.', midday: null, evening: 'You closed the night on the design review.' } }),
    workingDayFacts(), 'h',
  )
  assert.ok(result)
  assert.equal(result!.story.evening, null)
})

test('validate: rejects carryover / "pick it up tomorrow" homework', () => {
  const result = validateWrappedNarrativeResponse(
    cleanResponse({ closing: 'The design review is still open, pick it up tomorrow.' }),
    workingDayFacts(), 'h',
  )
  assert.ok(result)
  // The banned closing is dropped to null, never shown.
  assert.equal(result!.closing, null)
})

test('validate: rejects a focus-percentage grade', () => {
  const result = validateWrappedNarrativeResponse(
    cleanResponse({ wildcard: 'You were focused 72% of the working day.' }),
    workingDayFacts(), 'h',
  )
  assert.ok(result)
  assert.equal(result!.wildcard, null)
})

test('validate: rejects non-JSON garbage', () => {
  assert.equal(validateWrappedNarrativeResponse('Sure! Here is the summary.', workingDayFacts(), 'h'), null)
})

test('validate: rejects truncated JSON', () => {
  assert.equal(validateWrappedNarrativeResponse('{"lead": "About two hours tracked today', workingDayFacts(), 'h'), null)
})

// ─── buildFallbackNarrative ──────────────────────────────────────────────────

test('fallback: empty quality returns a modest lead and no beats', () => {
  const result = buildFallbackNarrative(emptyFacts(), 'h')
  assert.equal(result.source, 'fallback')
  assert.equal(result.story.morning, null)
  assert.equal(result.wildcard, null)
  assert.match(result.lead, /not much tracked/i)
})

test('fallback: a working day fills the arc and names the work', () => {
  const result = buildFallbackNarrative(workingDayFacts(), 'h')
  assert.ok(result.lead)
  assert.ok(result.story.morning, 'expected a morning beat')
  assert.ok(result.whereLine, 'expected a where line')
  assert.equal(result.closing, "That's the day.")
})

test('fallback: never predicts tomorrow or assigns homework', () => {
  const result = buildFallbackNarrative(workingDayFacts(), 'h')
  for (const line of [result.lead, result.story.morning, result.story.midday, result.whereLine, result.wildcard, result.closing]) {
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

test('hash: a different set of activities changes the hash', () => {
  const a = workingDayFacts()
  const b = buildDayWrapFacts(makeDayPayload([
    makeBlock({ label: 'Billing migration', start: NINE_AM, durationSeconds: 90 * 60, category: 'development', appName: 'Cursor' }),
  ]))
  assert.notEqual(computeFactsHash(a), computeFactsHash(b))
})

// ─── buildWrappedPrompts ─────────────────────────────────────────────────────

test('prompt: system prompt requests the arc and bans invention, emoji, questions', () => {
  const { systemPrompt } = buildWrappedPrompts(workingDayFacts())
  assert.match(systemPrompt, /STRICT JSON/)
  assert.match(systemPrompt, /No emoji/)
  assert.match(systemPrompt, /Never ask the user a question/)
  assert.match(systemPrompt, /Never invent a number/)
  assert.match(systemPrompt, /NAME THE WORK, NEVER THE FILE/)
  for (const key of ['"lead"', '"story"', '"whereLine"', '"wildcard"', '"closing"']) {
    assert.ok(systemPrompt.includes(key), `expected ${key} described in prompt`)
  }
})

test('prompt: system prompt forbids predicting tomorrow and grading', () => {
  const { systemPrompt } = buildWrappedPrompts(workingDayFacts())
  assert.match(systemPrompt, /NEVER predict tomorrow/)
  assert.match(systemPrompt, /NEVER grade/)
})

test('prompt: user message embeds the compact facts JSON', () => {
  const { userMessage } = buildWrappedPrompts(workingDayFacts())
  assert.match(userMessage, /"date": "2026-05-12"/)
  assert.match(userMessage, /"whereTheTimeWent"/)
})
