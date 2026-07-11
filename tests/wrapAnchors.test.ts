// tests/wrapAnchors.test.ts — the judge's calibration anchors stay in lockstep
// with the official catalog (docs/wrapped-slide-catalog.md).
//
// Two contracts:
//  1. COVERAGE — every slide id the day/week planner can emit with an AI ask has
//     its own anchor set, day and week separately (the week slides no longer
//     share one thin set). Dynamic families (story-*, thread-N) share one
//     family set by design.
//  2. SHIPPABILITY — no "perfect" anchor line would itself be killed by the
//     deterministic runtime guards. A line the writer can never ship must never
//     be taught to the judge as the ceiling.

import test from 'node:test'
import assert from 'node:assert/strict'
import { anchorsFor, normalizeSlideId } from './wrapped-bench/anchors.ts'
import {
  BANNED_PHRASES,
  HOMEWORK_GUILT_PATTERNS,
  emojiUsageAllowed,
  findOverclaimViolation,
  findRawArtifactLeak,
} from '../src/main/lib/wrapNarrativeShared.ts'

// Every id the day planner can emit with a non-empty ask (wrapDeck.ts,
// planDayWrapSlides), plus the question/reflection pseudo-slides the harness
// scores from narrative.*.
const DAY_JUDGED_IDS = [
  'opening', 'headline',
  'story-lateNight', 'story-morning', 'story-midday', 'story-evening',
  'focus', 'timesink', 'apps', 'split', 'earlystart', 'latenight',
  'forgotten', 'meetings', 'wildcard', 'question', 'reflection',
]

// Every id the period planner can emit with a non-empty ask
// (planPeriodWrapSlides; bestbucket is month/year but scored on the same
// week-cadence table).
const WEEK_JUDGED_IDS = [
  'opening', 'headline', 'consistency', 'shape', 'bestday', 'worstday',
  'focus', 'bestbucket', 'thread-0', 'thread-1', 'thread-2', 'thread-3',
  'threads', 'timesink', 'apps', 'categories', 'split', 'leisure', 'meetings',
  'forgotten', 'latenights', 'earlystarts', 'compare', 'average',
  'question', 'reflection',
]

test('every judged day slide id has its own anchor set', () => {
  for (const id of DAY_JUDGED_IDS) {
    const anchors = anchorsFor('day', id)
    assert.ok(anchors, `day slide "${id}" has no judge anchors`)
    assert.ok(anchors.perfect.length >= 1, `day slide "${id}" has no perfect anchors`)
    assert.ok(anchors.bad.length >= 1, `day slide "${id}" has no failing anchors`)
  }
})

test('every judged week slide id has its own anchor set (no shared thin set)', () => {
  for (const id of WEEK_JUDGED_IDS) {
    const anchors = anchorsFor('week', id)
    assert.ok(anchors, `week slide "${id}" has no judge anchors`)
    assert.ok(anchors.perfect.length >= 1, `week slide "${id}" has no perfect anchors`)
    assert.ok(anchors.bad.length >= 1, `week slide "${id}" has no failing anchors`)
  }
})

test('dynamic slide families normalize to one shared anchor set', () => {
  assert.equal(normalizeSlideId('story-morning'), 'story')
  assert.equal(normalizeSlideId('story-lateNight'), 'story')
  assert.equal(normalizeSlideId('thread-0'), 'thread')
  assert.equal(normalizeSlideId('thread-3'), 'thread')
  assert.equal(normalizeSlideId('opening'), 'opening')
  // "threads" (the chart) is its own slide, not part of the thread-N family.
  assert.equal(normalizeSlideId('threads'), 'threads')
})

// Words the writer prompts ban outright; a perfect anchor may never model them.
const BANNED_WORDS_IN_PERFECT = /\b(?:productive|productivity|wasted)\b/i

test('no perfect anchor would be killed by the deterministic guards', () => {
  const seen = new Set<string>()
  for (const [cadence, ids] of [['day', DAY_JUDGED_IDS], ['week', WEEK_JUDGED_IDS]] as const) {
    for (const id of ids) {
      const key = `${cadence}:${normalizeSlideId(id)}`
      if (seen.has(key)) continue
      seen.add(key)
      const anchors = anchorsFor(cadence, id)
      if (!anchors) continue
      for (const line of anchors.perfect) {
        const where = `${key} perfect anchor "${line.slice(0, 60)}…"`
        assert.equal(findOverclaimViolation(line), null, `${where} trips the overclaim guard`)
        assert.equal(findRawArtifactLeak(line), null, `${where} leaks raw technical text`)
        assert.ok(!HOMEWORK_GUILT_PATTERNS.some((p) => p.test(line)), `${where} uses homework/guilt/grading language`)
        assert.ok(emojiUsageAllowed(line), `${where} breaks the emoji rule`)
        assert.ok(!/[—–]/.test(line), `${where} contains an em/en dash`)
        assert.ok(!BANNED_PHRASES.some((p) => line.toLowerCase().includes(p)), `${where} contains a banned phrase`)
        assert.ok(!BANNED_WORDS_IN_PERFECT.test(line), `${where} contains a banned word`)
        if (normalizeSlideId(id) !== 'question') {
          assert.ok(!line.includes('?'), `${where} asks a question outside the question slide`)
        }
      }
    }
  }
})
