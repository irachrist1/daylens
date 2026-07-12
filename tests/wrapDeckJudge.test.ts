// The whole-deck judge's pure logic (tests/wrapped-bench/deckJudge.ts), pinned
// hermetically — prompt contract, verdict parsing, majority math, and the two
// deterministic checks — so the paid gate's deck-level pass is verifiable
// without a provider call. The LLM half runs only inside npm run wrapped:bench.

import test from 'node:test'
import assert from 'node:assert/strict'
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
  type DeckJudgeVerdict,
} from './wrapped-bench/deckJudge.ts'

const PASS = { pass: true, evidence: '' }

function verdict(over: Partial<DeckJudgeVerdict> = {}): DeckJudgeVerdict {
  return { repetition: PASS, arc: PASS, contradiction: PASS, reasoning: 'reads as one day', ...over }
}

// ─── Deterministic: the deck-wide emoji budget ────────────────────────────────

test('emoji budget: zero or one emoji across the deck passes', () => {
  assert.equal(checkDeckEmojiBudget(['A plain line.', 'Another plain line.']).pass, true)
  assert.equal(checkDeckEmojiBudget(['A record run 🔥', 'A plain line.']).pass, true)
})

test('emoji budget: a second emoji anywhere in the deck fails with evidence', () => {
  const result = checkDeckEmojiBudget([
    'A record run 🔥',
    'A plain middle line.',
    'And an early morning too ☕',
  ])
  assert.equal(result.pass, false)
  assert.match(result.evidence, /2 emoji/)
  assert.match(result.evidence, /record run/)
  assert.match(result.evidence, /early morning/)
})

test('emoji budget: two emoji on ONE line also fail (the deck total is what counts)', () => {
  assert.equal(checkDeckEmojiBudget(['Two wins 🏆🔥 in one line.']).pass, false)
})

// ─── Deterministic: exact-duplicate lines ─────────────────────────────────────

function entry(id: string, line: string, deterministic = false): DeckJudgeEntry {
  return { id, kicker: `KICKER ${id}`, line, deterministic }
}

test('duplicates: the same prose under two slide ids fails, naming both slides', () => {
  const result = checkDeckDuplicateLines([
    entry('headline', 'Most of it stacked up before lunch, one long unbroken run.'),
    entry('focus', 'Most of it stacked up before lunch, one long unbroken run.'),
  ])
  assert.equal(result.pass, false)
  assert.match(result.evidence, /"headline" and "focus"/)
})

test('duplicates: deterministic card copy is exempt; distinct lines pass', () => {
  assert.equal(checkDeckDuplicateLines([
    entry('coverage', 'Built from 5h of tracked activity on this computer, honestly told.', true),
    entry('finale', 'Built from 5h of tracked activity on this computer, honestly told.', true),
  ]).pass, true)
  assert.equal(checkDeckDuplicateLines([
    entry('headline', 'Most of it stacked up before lunch.'),
    entry('focus', 'The engine held you for two and a half hours without surfacing.'),
  ]).pass, true)
})

// ─── The prompt contract ──────────────────────────────────────────────────────

test('system prompt: names all three deck-level failure modes and the fixed-copy exemption', () => {
  assert.match(DECK_JUDGE_SYSTEM, /REPETITION/)
  assert.match(DECK_JUDGE_SYSTEM, /one deliberate callback/i)
  assert.match(DECK_JUDGE_SYSTEM, /ARC/)
  assert.match(DECK_JUDGE_SYSTEM, /start to finish/i)
  assert.match(DECK_JUDGE_SYSTEM, /CONTRADICTION/)
  assert.match(DECK_JUDGE_SYSTEM, /\[fixed\]/)
  assert.match(DECK_JUDGE_SYSTEM, /strict JSON/i)
  // The judge must not punish honest thinness — that is the coverage card's job.
  assert.match(DECK_JUDGE_SYSTEM, /thin day being thin/)
})

test('user prompt: the whole deck in order, fixed copy marked, facts included', () => {
  const user = buildDeckJudgeUser('day', '2026-07-07', [
    entry('opening', 'A maker\'s morning that set the tone.'),
    entry('coverage', 'Built from 5h of tracked activity.', true),
    entry('reflection', 'A good honest day of building.'),
  ], '{"total":"5h"}')
  const openingAt = user.indexOf('1. [opening]')
  const coverageAt = user.indexOf('2. [coverage] [fixed]')
  const reflectionAt = user.indexOf('3. [reflection]')
  assert.ok(openingAt > 0 && coverageAt > openingAt && reflectionAt > coverageAt, `deck order lost:\n${user}`)
  assert.match(user, /Cadence: day \(2026-07-07\)/)
  assert.match(user, /\{"total":"5h"\}/)
})

// ─── Verdict parsing ──────────────────────────────────────────────────────────

test('parse: a clean verdict round-trips; prose around the JSON is tolerated', () => {
  const raw = 'Here is my judgment: {"repetition":{"pass":false,"evidence":"headline and split both announce 6h 40m"},"arc":{"pass":true,"evidence":""},"contradiction":{"pass":true,"evidence":""},"reasoning":"repeats the total"}'
  const v = parseDeckJudgeVerdict(raw)
  assert.ok(v)
  assert.equal(v!.repetition.pass, false)
  assert.match(v!.repetition.evidence, /6h 40m/)
  assert.equal(v!.arc.pass, true)
})

test('parse: garbage, non-JSON, and missing criteria return null (retry, never guess)', () => {
  assert.equal(parseDeckJudgeVerdict('The deck looks fine to me.'), null)
  assert.equal(parseDeckJudgeVerdict('{"repetition":{"pass":true,"evidence":""}}'), null)
  assert.equal(parseDeckJudgeVerdict('{"repetition":{"pass":"yes"},"arc":{"pass":true},"contradiction":{"pass":true}}'), null)
})

// ─── Majority math ────────────────────────────────────────────────────────────

test('majority: one flaky fail out of three cannot sink a deck', () => {
  const combined = combineDeckJudgeSamples([
    verdict(),
    verdict({ arc: { pass: false, evidence: 'a lone dissent' } }),
    verdict(),
  ])
  assert.equal(combined.arc.pass, true)
})

test('majority: two fails out of three sink the criterion with the first evidence', () => {
  const combined = combineDeckJudgeSamples([
    verdict({ contradiction: { pass: false, evidence: 'first evidence' } }),
    verdict(),
    verdict({ contradiction: { pass: false, evidence: 'second evidence' } }),
  ])
  assert.equal(combined.contradiction.pass, false)
  assert.equal(combined.contradiction.evidence, 'first evidence')
  assert.equal(combined.repetition.pass, true)
})

test('majority: a single sample passes through unchanged', () => {
  const single = verdict({ repetition: { pass: false, evidence: 'only read' } })
  assert.deepEqual(combineDeckJudgeSamples([single]), single)
})

// ─── The gate ─────────────────────────────────────────────────────────────────

test('gate: any deck-level failure fails the deck, deterministic or judged', () => {
  const base = { verdict: verdict(), emojiBudget: PASS, duplicateLines: PASS }
  assert.equal(deckJudgePassed(base), true)
  assert.equal(deckJudgePassed({ ...base, verdict: verdict({ repetition: { pass: false, evidence: 'x' } }) }), false)
  assert.equal(deckJudgePassed({ ...base, verdict: verdict({ arc: { pass: false, evidence: 'x' } }) }), false)
  assert.equal(deckJudgePassed({ ...base, verdict: verdict({ contradiction: { pass: false, evidence: 'x' } }) }), false)
  assert.equal(deckJudgePassed({ ...base, emojiBudget: { pass: false, evidence: 'x' } }), false)
  assert.equal(deckJudgePassed({ ...base, duplicateLines: { pass: false, evidence: 'x' } }), false)
  assert.equal(deckJudgePassed({ ...base, verdict: null }), false, 'a judge that never ran is a fail, not a pass')
})

test('format: a failing verdict renders its evidence for the log', () => {
  const rendered = formatDeckJudge({
    verdict: verdict({ repetition: { pass: false, evidence: 'headline and split repeat 6h 40m' } }),
    emojiBudget: PASS,
    duplicateLines: PASS,
    samples: 3,
    passed: false,
  })
  assert.match(rendered, /repetition FAIL \(headline and split repeat 6h 40m\)/)
  assert.match(rendered, /arc ok/)
})
