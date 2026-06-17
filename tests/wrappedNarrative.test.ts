import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFallbackNarrative,
  buildWrappedFactsFromPayload,
  buildWrappedPrompts,
  computeFactsHash,
  validateWrappedNarrativeResponse,
  type WrappedFacts,
} from '../src/main/lib/wrappedNarrative.ts'
import type {
  AppCategory,
  DayTimelinePayload,
  TimelineBlockReviewState,
  WorkContextBlock,
} from '../src/shared/types.ts'
import { DEFAULT_TIMELINE_BLOCK_REVIEW } from '../src/shared/timelineReview.ts'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function fullFacts(overrides: Partial<WrappedFacts> = {}): WrappedFacts {
  return {
    date: '2026-05-12',
    totalSeconds: 5 * 3600 + 24 * 60, // 5h 24m
    focusSeconds: 3 * 3600,
    focusPct: 56,
    blockCount: 6,
    totalSwitches: 42,
    switchesPerHour: 8,
    dominantCategory: 'development',
    dominantCategoryPct: 48,
    quality: 'full',
    peakBlock: {
      label: 'Wrapped narrative service',
      durationSeconds: 80 * 60,
      startClock: '10:12 AM',
      endClock: '11:32 AM',
      category: 'development',
    },
    topApp: {
      appName: 'Cursor',
      durationSeconds: 4 * 3600,
      category: 'development',
      isBrowser: false,
    },
    topDomain: {
      domain: 'github.com',
      totalSeconds: 1800,
      classification: 'codePlatform',
      isWorkRelevant: true,
    },
    mattered: [
      {
        label: 'Wrapped narrative service',
        category: 'development',
        intentRole: 'execution',
        intentSubject: 'wrappedNarrative.ts',
        durationSeconds: 80 * 60,
        startClock: '10:12 AM',
        endClock: '11:32 AM',
        reviewState: 'auto-approved',
        confidence: 'high',
      },
    ],
    needsReview: {
      count: 1,
      items: [
        { label: 'Slack triage', durationSeconds: 12 * 60, startClock: '9:00 AM', endClock: '9:12 AM' },
      ],
    },
    carryover: [
      {
        label: 'Wrapped narrative service',
        intentRole: 'execution',
        intentSubject: 'wrappedNarrative.ts',
        startClock: '10:12 AM',
        endClock: '11:32 AM',
        reason: 'open-thread',
      },
    ],
    kindBreakdown: {
      work: 5 * 3600 + 24 * 60,
      leisure: 0,
      personal: 0,
      idle: 0,
      dominant: 'work',
      topLeisure: [],
      isLeisureDay: false,
    },
    ...overrides,
  }
}

function emptyFacts(): WrappedFacts {
  return {
    date: '2026-05-12',
    totalSeconds: 0,
    focusSeconds: 0,
    focusPct: 0,
    blockCount: 0,
    totalSwitches: 0,
    switchesPerHour: 0,
    dominantCategory: 'unknown',
    dominantCategoryPct: 0,
    quality: 'empty',
    peakBlock: null,
    topApp: null,
    topDomain: null,
    mattered: [],
    needsReview: { count: 0, items: [] },
    carryover: [],
    kindBreakdown: {
      work: 0, leisure: 0, personal: 0, idle: 0,
      dominant: 'personal', topLeisure: [], isLeisureDay: false,
    },
  }
}

// ─── validateWrappedNarrativeResponse ─────────────────────────────────────────

test('validate: accepts a clean AI response matching the facts', () => {
  const facts = fullFacts()
  const raw = JSON.stringify({
    lead: 'You held the line — about 5 hours of tracked time with development carrying the weight today.',
    peakInsight: 'Your clearest stretch ran 10:12 AM to 11:32 AM and was clearly development work.',
    nudge: 'Try to defend that 10:12–11:32 window again tomorrow before meetings start crowding in.',
  })
  const result = validateWrappedNarrativeResponse(raw, facts, 'abc123')
  assert.ok(result)
  assert.equal(result?.source, 'ai')
  assert.equal(result?.factsHash, 'abc123')
  assert.match(result!.lead, /5 hours/)
})

test('validate: tolerates a fenced ```json block', () => {
  const facts = fullFacts()
  const raw = '```json\n{"lead":"About 5 hours tracked today with steady development work running through the morning.","peakInsight":null,"nudge":null}\n```'
  const result = validateWrappedNarrativeResponse(raw, facts, 'h')
  assert.ok(result)
})

test('validate: rejects empty lead', () => {
  const facts = fullFacts()
  const raw = JSON.stringify({ lead: '', peakInsight: null, nudge: null })
  assert.equal(validateWrappedNarrativeResponse(raw, facts, 'h'), null)
})

test('validate: rejects a too-short lead (under 24 chars)', () => {
  const facts = fullFacts()
  const raw = JSON.stringify({ lead: 'Good day.', peakInsight: null, nudge: null })
  assert.equal(validateWrappedNarrativeResponse(raw, facts, 'h'), null)
})

test('validate: rejects a too-long lead (over 200 chars)', () => {
  const facts = fullFacts()
  const longText = `You held the line `.repeat(20)
  const raw = JSON.stringify({ lead: longText, peakInsight: null, nudge: null })
  assert.equal(validateWrappedNarrativeResponse(raw, facts, 'h'), null)
})

test('validate: rejects emoji in the lead', () => {
  const facts = fullFacts()
  const raw = JSON.stringify({
    lead: 'You held the line — about 5 hours of clear development work today 🚀.',
    peakInsight: null,
    nudge: null,
  })
  assert.equal(validateWrappedNarrativeResponse(raw, facts, 'h'), null)
})

test('validate: rejects a lead that asks the user a question', () => {
  const facts = fullFacts()
  const raw = JSON.stringify({
    lead: 'Was this the kind of focused development day you were trying to have today?',
    peakInsight: null,
    nudge: null,
  })
  assert.equal(validateWrappedNarrativeResponse(raw, facts, 'h'), null)
})

test('validate: rejects an hour claim that contradicts the facts', () => {
  // Facts say 5h, AI claims "12 hours" → outside the 1h tolerance.
  const facts = fullFacts()
  const raw = JSON.stringify({
    lead: 'You shipped 12 hours of focused development work today across many blocks.',
    peakInsight: null,
    nudge: null,
  })
  assert.equal(validateWrappedNarrativeResponse(raw, facts, 'h'), null)
})

test('validate: rejects claim of "I am not sure" non-answers', () => {
  const facts = fullFacts()
  const raw = JSON.stringify({
    lead: "I'm not sure what to make of today's signal, but here's what I see across the blocks.",
    peakInsight: null,
    nudge: null,
  })
  assert.equal(validateWrappedNarrativeResponse(raw, facts, 'h'), null)
})

test('validate: rejects an ungrounded domain reference', () => {
  // Facts only know github.com; AI mentions reddit.com → invented.
  const facts = fullFacts()
  const raw = JSON.stringify({
    lead: 'About 5 hours tracked, with reddit.com pulling significant browser attention today.',
    peakInsight: null,
    nudge: null,
  })
  assert.equal(validateWrappedNarrativeResponse(raw, facts, 'h'), null)
})

test('validate: rejects peakInsight when facts.peakBlock is null', () => {
  const facts = fullFacts({ peakBlock: null })
  const raw = JSON.stringify({
    lead: 'About 5 hours of tracked work today, mostly steady development effort.',
    peakInsight: 'Your peak stretch was a long uninterrupted block in the late morning.',
    nudge: null,
  })
  assert.equal(validateWrappedNarrativeResponse(raw, facts, 'h'), null)
})

test('validate: accepts when peakInsight and nudge are null', () => {
  const facts = fullFacts()
  const raw = JSON.stringify({
    lead: 'About 5 hours tracked, with development carrying the bulk of the day.',
    peakInsight: null,
    nudge: null,
  })
  const result = validateWrappedNarrativeResponse(raw, facts, 'h')
  assert.ok(result)
  assert.equal(result?.peakInsight, null)
  assert.equal(result?.nudge, null)
})

test('validate: rejects non-JSON garbage', () => {
  const facts = fullFacts()
  assert.equal(validateWrappedNarrativeResponse('Sure! Here is the summary.', facts, 'h'), null)
})

test('validate: rejects truncated JSON', () => {
  const facts = fullFacts()
  assert.equal(validateWrappedNarrativeResponse('{"lead": "About 5 hours tracked today', facts, 'h'), null)
})

test('validate: rejects a code fence inside the lead', () => {
  const facts = fullFacts()
  const raw = JSON.stringify({
    lead: 'About 5 hours tracked today with ```bash``` carrying the dev signal.',
    peakInsight: null,
    nudge: null,
  })
  assert.equal(validateWrappedNarrativeResponse(raw, facts, 'h'), null)
})

// ─── buildFallbackNarrative ──────────────────────────────────────────────────

test('fallback: empty quality returns a modest lead and no insights', () => {
  const facts = emptyFacts()
  const result = buildFallbackNarrative(facts, 'h')
  assert.equal(result.source, 'fallback')
  assert.equal(result.peakInsight, null)
  assert.equal(result.nudge, null)
  assert.match(result.lead, /not see enough activity/i)
})

test('fallback: tooEarly quality leads with a warming-up lead', () => {
  const facts = fullFacts({ totalSeconds: 90, quality: 'tooEarly', peakBlock: null })
  const result = buildFallbackNarrative(facts, 'h')
  assert.match(result.lead, /still warming up/i)
  assert.equal(result.nudge, null)
})

test('fallback: full day with peak emits a peak insight and forward nudge', () => {
  const facts = fullFacts()
  const result = buildFallbackNarrative(facts, 'h')
  assert.ok(result.peakInsight)
  assert.match(result.peakInsight!, /10:12 AM/)
  assert.ok(result.nudge)
  assert.match(result.nudge!, /10:12|11:32/)
})

test('fallback: partial day suppresses the forward-looking nudge', () => {
  const facts = fullFacts({ totalSeconds: 30 * 60, quality: 'partial' })
  const result = buildFallbackNarrative(facts, 'h')
  assert.equal(result.nudge, null)
})

// ─── computeFactsHash ────────────────────────────────────────────────────────

test('hash: identical facts produce identical hashes', () => {
  assert.equal(computeFactsHash(fullFacts()), computeFactsHash(fullFacts()))
})

test('hash: changing the date changes the hash', () => {
  assert.notEqual(
    computeFactsHash(fullFacts()),
    computeFactsHash(fullFacts({ date: '2026-05-13' })),
  )
})

test('hash: changing the dominant category changes the hash', () => {
  assert.notEqual(
    computeFactsHash(fullFacts()),
    computeFactsHash(fullFacts({ dominantCategory: 'browsing' })),
  )
})

test('hash: trivial sub-minute drift on totalSeconds does NOT change the hash', () => {
  // Bucketed to the minute — 5h24m+5s should hash the same as 5h24m.
  const a = computeFactsHash(fullFacts())
  const b = computeFactsHash(fullFacts({ totalSeconds: 5 * 3600 + 24 * 60 + 5 }))
  assert.equal(a, b)
})

// ─── buildWrappedPrompts ─────────────────────────────────────────────────────

test('prompt: system prompt forbids emoji, code fences, and ungrounded names', () => {
  const { systemPrompt } = buildWrappedPrompts(fullFacts())
  assert.match(systemPrompt, /STRICT JSON/)
  assert.match(systemPrompt, /No emoji/)
  assert.match(systemPrompt, /Never ask the user a question/)
  assert.match(systemPrompt, /Never invent/)
})

test('validate: accepts per-slide narration when present', () => {
  const facts = fullFacts()
  const raw = JSON.stringify({
    lead: 'You held the line — about 5 hours of tracked development today, steady through the morning.',
    peakInsight: 'Your clearest stretch ran 10:12 AM to 11:32 AM, all development work.',
    nudge: 'Defend that 10:12 to 11:32 window again tomorrow before meetings creep in.',
    slides: {
      scale: 'A development-led day with five hours of tracked time and six work sessions to show for it.',
      focus: 'Focus held — over half the day matched a clean signal, which is rare on a busy schedule.',
      topApp: 'Cursor was the anchor — most of the development time on the wrapped narrative work ran through it.',
      switching: 'A reasonably steady rhythm with switches well under the scattered threshold today.',
      identity: 'A clear development day — most of the time landed there with little drift to other modes.',
      closing: 'Carry the rhythm from that mid-morning stretch into tomorrow rather than starting cold.',
    },
  })
  const result = validateWrappedNarrativeResponse(raw, facts, 'h')
  assert.ok(result, 'expected slide-rich response to validate')
  assert.ok(result!.slides.scale, 'scale slide line should pass through')
  assert.ok(result!.slides.topApp, 'topApp slide line should pass through')
  assert.equal(result!.source, 'ai')
})

test('validate: drops slide lines containing banned vocabulary', () => {
  const facts = fullFacts()
  const raw = JSON.stringify({
    lead: 'About 5 hours of tracked development today, steady through the morning sessions.',
    peakInsight: null,
    nudge: null,
    slides: {
      scale: 'Today you crushed it — about five hours of clean development work shipped.',
      focus: null, topApp: null, switching: null, identity: null, closing: null,
    },
  })
  const result = validateWrappedNarrativeResponse(raw, facts, 'h')
  assert.ok(result)
  assert.equal(result!.slides.scale, null, 'banned phrase should be stripped to null')
})

test('fallback: full work day fills the earned cards, drops the padding', () => {
  const facts = fullFacts()
  const result = buildFallbackNarrative(facts, 'h')
  // Earned cards: where-the-time-went (scale), what-you-worked-on (topApp), close.
  assert.ok(result.slides.scale)
  assert.ok(result.slides.topApp)
  assert.ok(result.slides.focus)
  assert.ok(result.slides.closing)
  // Switching / identity are redundant padding under the earn-each-slide rule.
  assert.equal(result.slides.switching, null)
  assert.equal(result.slides.identity, null)
})

test('fallback: empty quality leaves all slide slots null', () => {
  const facts = emptyFacts()
  const result = buildFallbackNarrative(facts, 'h')
  assert.equal(result.slides.scale, null)
  assert.equal(result.slides.focus, null)
  assert.equal(result.slides.closing, null)
})

test('prompt: system prompt requests the slides object with all six keys', () => {
  const { systemPrompt } = buildWrappedPrompts(fullFacts())
  assert.match(systemPrompt, /"slides"/)
  for (const key of ['scale', 'focus', 'topApp', 'switching', 'identity', 'closing']) {
    assert.ok(systemPrompt.includes(`"${key}"`), `expected slides.${key} described in prompt`)
  }
})

test('prompt: user message embeds the facts JSON verbatim', () => {
  const facts = fullFacts()
  const { userMessage } = buildWrappedPrompts(facts)
  assert.match(userMessage, /"date": "2026-05-12"/)
  assert.match(userMessage, /"dominantCategory": "development"/)
})

test('prompt: system prompt describes the reconciled kind spine and bans homework', () => {
  const { systemPrompt } = buildWrappedPrompts(fullFacts())
  assert.match(systemPrompt, /facts\.mattered/)
  assert.match(systemPrompt, /facts\.carryover/)
  assert.match(systemPrompt, /facts\.kindBreakdown/)
  // The redesign forbids the "needs review" homework closing and 100% claims.
  assert.match(systemPrompt, /no "needs review"/i)
  assert.match(systemPrompt, /never say "100%"/i)
})

// ─── Review-grounded derivation (Wraps V2) ────────────────────────────────────

function makeBlock(opts: {
  label: string
  start: number
  durationSeconds: number
  category?: AppCategory
  reviewState?: TimelineBlockReviewState
}): WorkContextBlock {
  const category: AppCategory = opts.category ?? 'development'
  return {
    id: `b:${opts.label}:${opts.start}`,
    startTime: opts.start,
    endTime: opts.start + opts.durationSeconds * 1000,
    dominantCategory: category,
    categoryDistribution: { [category]: opts.durationSeconds },
    ruleBasedLabel: opts.label,
    aiLabel: null,
    sessions: [],
    topApps: [],
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
    review: { ...DEFAULT_TIMELINE_BLOCK_REVIEW, state: opts.reviewState ?? 'auto-approved' },
    isLive: false,
  }
}

function makeDayPayload(blocks: WorkContextBlock[], totalSeconds: number): DayTimelinePayload {
  return {
    date: '2026-05-12',
    sessions: [],
    websites: [],
    blocks,
    segments: [],
    focusSessions: [],
    computedAt: Date.now(),
    version: 'test',
    totalSeconds,
    focusSeconds: totalSeconds,
    focusPct: 100,
    appCount: 0,
    siteCount: 0,
  }
}

test('derive: decided blocks are mattered, pending blocks are needs-review', () => {
  const base = new Date('2026-05-12T09:00:00').getTime()
  const facts = buildWrappedFactsFromPayload(makeDayPayload([
    makeBlock({ label: 'Auth refactor', start: base, durationSeconds: 30 * 60, reviewState: 'approved' }),
    makeBlock({ label: 'Slack triage', start: base + 40 * 60_000, durationSeconds: 10 * 60, reviewState: 'pending' }),
  ], 40 * 60))
  assert.equal(facts.mattered.length, 1)
  assert.equal(facts.mattered[0].label, 'Auth refactor')
  assert.notEqual(facts.mattered[0].reviewState, 'pending')
  assert.equal(facts.needsReview.count, 1)
  assert.equal(facts.needsReview.items[0].label, 'Slack triage')
})

test('derive: ignored blocks are excluded from mattered and needs-review', () => {
  const base = new Date('2026-05-12T09:00:00').getTime()
  const facts = buildWrappedFactsFromPayload(makeDayPayload([
    makeBlock({ label: 'Ignored noise', start: base, durationSeconds: 30 * 60, reviewState: 'ignored' }),
    makeBlock({ label: 'Pending thing', start: base + 40 * 60_000, durationSeconds: 20 * 60, reviewState: 'pending' }),
  ], 50 * 60))
  assert.ok(!facts.mattered.some((m) => m.label === 'Ignored noise'))
  assert.ok(!facts.needsReview.items.some((i) => i.label === 'Ignored noise'))
  assert.equal(facts.needsReview.count, 1)
})

test('derive: sub-5-minute pending blocks are below the needs-review floor', () => {
  const base = new Date('2026-05-12T09:00:00').getTime()
  const facts = buildWrappedFactsFromPayload(makeDayPayload([
    makeBlock({ label: 'Quick peek', start: base, durationSeconds: 3 * 60, reviewState: 'pending' }),
  ], 3 * 60))
  assert.equal(facts.needsReview.count, 0)
})

// ─── Fallback narrative grounding ─────────────────────────────────────────────

test('fallback: lead names the work subject on a working day', () => {
  const result = buildFallbackNarrative(fullFacts(), 'h')
  assert.match(result.lead, /working day/i)
  assert.match(result.lead, /mostly on wrappedNarrative\.ts/i)
})

test('fallback: nudge surfaces the carryover thread to resume', () => {
  const result = buildFallbackNarrative(fullFacts(), 'h')
  assert.ok(result.nudge)
  assert.match(result.nudge!, /wrappedNarrative\.ts/)
  assert.match(result.nudge!, /pick/i)
})

test('fallback: closing is a quiet sign-off, never review homework', () => {
  // Even with a pending pile, the close assigns no homework.
  const result = buildFallbackNarrative(fullFacts(), 'h') // needsReview.count = 1
  assert.ok(result.slides.closing)
  assert.doesNotMatch(result.slides.closing!, /review/i)
  assert.doesNotMatch(result.slides.closing!, /need/i)
})

test('fallback: nudge is absent when there is no real carryover thread', () => {
  // No invented homework — when nothing carried over, there is no nudge.
  const result = buildFallbackNarrative(fullFacts({ carryover: [] }), 'h')
  assert.equal(result.nudge, null)
})

// ─── Hash sensitivity to review state (cache-honesty) ─────────────────────────

test('hash: clearing the needs-review pile changes the hash', () => {
  // Approving a pending block leaves totals untouched but must regenerate the
  // narrative — otherwise the wrap keeps claiming "N need review" forever.
  assert.notEqual(
    computeFactsHash(fullFacts()),
    computeFactsHash(fullFacts({ needsReview: { count: 0, items: [] } })),
  )
})

test('hash: changing what mattered changes the hash', () => {
  const a = fullFacts()
  const b = fullFacts({ mattered: [{ ...a.mattered[0], intentSubject: 'something-else.ts' }] })
  assert.notEqual(computeFactsHash(a), computeFactsHash(b))
})

test('hash: changing the carryover thread changes the hash', () => {
  assert.notEqual(
    computeFactsHash(fullFacts()),
    computeFactsHash(fullFacts({ carryover: [] })),
  )
})

// ─── Review-count claim validation ────────────────────────────────────────────

test('validate: rejects a review-count claim that contradicts the pending count', () => {
  const facts = fullFacts() // needsReview.count = 1
  const raw = JSON.stringify({
    lead: 'Steady development throughout, and 3 stretches still need a quick review before close.',
    peakInsight: null,
    nudge: null,
  })
  assert.equal(validateWrappedNarrativeResponse(raw, facts, 'h'), null)
})

test('validate: rejects review homework even when it matches the pending count', () => {
  // The redesign deletes the "needs review" closing entirely — any review-nudge
  // is homework and must be rejected regardless of the count.
  const facts = fullFacts() // needsReview.count = 1
  const raw = JSON.stringify({
    lead: 'Most of the day held steady, though 1 stretch still needs a quick review before close.',
    peakInsight: null,
    nudge: null,
  })
  assert.equal(validateWrappedNarrativeResponse(raw, facts, 'h'), null)
})

test('validate: rejects a "needs review" claim when nothing is pending', () => {
  const facts = fullFacts({ needsReview: { count: 0, items: [] } })
  const raw = JSON.stringify({
    lead: 'A solid development day, but a few stretches still need a quick review tonight.',
    peakInsight: null,
    nudge: null,
  })
  assert.equal(validateWrappedNarrativeResponse(raw, facts, 'h'), null)
})
