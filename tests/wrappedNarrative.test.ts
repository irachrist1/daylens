import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFallbackNarrative,
  buildWrappedPrompts,
  computeFactsHash,
  validateWrappedNarrativeResponse,
  type WrappedFacts,
} from '../src/main/lib/wrappedNarrative.ts'

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

test('fallback: full day produces slide narration for every slot', () => {
  const facts = fullFacts()
  const result = buildFallbackNarrative(facts, 'h')
  assert.ok(result.slides.scale)
  assert.ok(result.slides.focus)
  assert.ok(result.slides.topApp)
  assert.ok(result.slides.switching)
  assert.ok(result.slides.identity)
  assert.ok(result.slides.closing)
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
