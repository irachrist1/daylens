// Tests for the pure scheduling decisions used by the daily-summary notifier.
// These cover the time-of-day gates, once-per-day write, activity threshold,
// and morning-nudge "user hasn't started working yet" check.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decideDailySummary,
  decideYesterdayRecap,
  decideCarryoverNudge,
  NOTIFY_MIN_SECONDS,
  CARRYOVER_MIN_WORK_SECONDS,
  AI_ATTEMPT_MAX_PER_DAY,
  AI_ATTEMPT_MIN_GAP_MS,
  canAttemptAiNarrative,
  recordAiNarrativeAttempt,
  type DailyNotifierState,
} from '../src/main/lib/dailySummaryScheduler'

const TODAY = '2026-05-12'
const YESTERDAY = '2026-05-11'

function at(hour: number, minute = 0): Date {
  // Year/month/day fixed at 2026-05-12 so the date string passed alongside
  // stays consistent. Local-time semantics match what the production code uses.
  return new Date(2026, 4, 12, hour, minute, 0, 0)
}

// ─── decideDailySummary ─────────────────────────────────────────────────────

test('daily summary does not fire when disabled', () => {
  const decision = decideDailySummary({
    now: at(20),
    state: {},
    todaySecondsTracked: NOTIFY_MIN_SECONDS + 1,
    dailySummaryEnabled: false,
    todayDateString: TODAY,
  })
  assert.deepEqual(decision, { fire: false, reason: 'disabled' })
})

test('daily summary does not fire before 18:00 even with enough activity', () => {
  for (const hour of [0, 6, 12, 17]) {
    const decision = decideDailySummary({
      now: at(hour, 59),
      state: {},
      todaySecondsTracked: NOTIFY_MIN_SECONDS * 4,
      dailySummaryEnabled: true,
      todayDateString: TODAY,
    })
    assert.deepEqual(decision, { fire: false, reason: 'before-18' }, `hour=${hour}`)
  }
})

test('daily summary fires at exactly 18:00 with enough activity', () => {
  const decision = decideDailySummary({
    now: at(18, 0),
    state: {},
    todaySecondsTracked: NOTIFY_MIN_SECONDS,
    dailySummaryEnabled: true,
    todayDateString: TODAY,
  })
  assert.deepEqual(decision, { fire: true, targetDate: TODAY })
})

test('daily summary does not fire when already fired today', () => {
  const decision = decideDailySummary({
    now: at(22),
    state: { lastDailySummaryDate: TODAY },
    todaySecondsTracked: NOTIFY_MIN_SECONDS * 10,
    dailySummaryEnabled: true,
    todayDateString: TODAY,
  })
  assert.deepEqual(decision, { fire: false, reason: 'already-fired-today' })
})

test('daily summary fires when last fire was a different day', () => {
  const decision = decideDailySummary({
    now: at(19),
    state: { lastDailySummaryDate: YESTERDAY },
    todaySecondsTracked: NOTIFY_MIN_SECONDS,
    dailySummaryEnabled: true,
    todayDateString: TODAY,
  })
  assert.deepEqual(decision, { fire: true, targetDate: TODAY })
})

test('daily summary does not fire with insufficient activity', () => {
  const decision = decideDailySummary({
    now: at(20),
    state: {},
    todaySecondsTracked: NOTIFY_MIN_SECONDS - 1,
    dailySummaryEnabled: true,
    todayDateString: TODAY,
  })
  assert.deepEqual(decision, { fire: false, reason: 'insufficient-activity' })
})

test('daily summary fires at the exact activity threshold', () => {
  const decision = decideDailySummary({
    now: at(20),
    state: {},
    todaySecondsTracked: NOTIFY_MIN_SECONDS,
    dailySummaryEnabled: true,
    todayDateString: TODAY,
  })
  assert.deepEqual(decision, { fire: true, targetDate: TODAY })
})

test('daily summary fires deep in the evening', () => {
  const decision = decideDailySummary({
    now: at(23, 45),
    state: {},
    todaySecondsTracked: NOTIFY_MIN_SECONDS * 6,
    dailySummaryEnabled: true,
    todayDateString: TODAY,
  })
  assert.deepEqual(decision, { fire: true, targetDate: TODAY })
})

// ─── decideYesterdayRecap (§4.1) ───────────────────────────────────────────

const MORNING_BASE = {
  state: {},
  morningNudgeEnabled: true,
  todayDateString: TODAY,
  yesterdayDateString: YESTERDAY,
}

test('yesterday recap does not fire when disabled', () => {
  const decision = decideYesterdayRecap({
    ...MORNING_BASE,
    now: at(9),
    yesterdaySecondsTracked: NOTIFY_MIN_SECONDS * 4,
    morningNudgeEnabled: false,
  })
  assert.deepEqual(decision, { fire: false, reason: 'disabled' })
})

test('yesterday recap fires in the morning when no recap was generated yesterday', () => {
  const decision = decideYesterdayRecap({
    ...MORNING_BASE,
    now: at(9),
    yesterdaySecondsTracked: NOTIFY_MIN_SECONDS,
  })
  assert.deepEqual(decision, { fire: true, targetDate: YESTERDAY })
})

test('yesterday recap does NOT fire when a recap was already generated yesterday', () => {
  const decision = decideYesterdayRecap({
    ...MORNING_BASE,
    now: at(9),
    state: { recapGeneratedDates: [YESTERDAY] },
    yesterdaySecondsTracked: NOTIFY_MIN_SECONDS * 4,
  })
  assert.deepEqual(decision, { fire: false, reason: 'recap-already-generated' })
})

test('yesterday recap does not fire after noon', () => {
  for (const hour of [12, 15, 20]) {
    const decision = decideYesterdayRecap({
      ...MORNING_BASE,
      now: at(hour),
      yesterdaySecondsTracked: NOTIFY_MIN_SECONDS,
    })
    assert.deepEqual(decision, { fire: false, reason: 'after-noon' }, `hour=${hour}`)
  }
})

test('yesterday recap does not fire when yesterday had little activity', () => {
  const decision = decideYesterdayRecap({
    ...MORNING_BASE,
    now: at(9),
    yesterdaySecondsTracked: NOTIFY_MIN_SECONDS - 1,
  })
  assert.deepEqual(decision, { fire: false, reason: 'insufficient-yesterday-activity' })
})

test('yesterday recap does not fire twice in one day', () => {
  const decision = decideYesterdayRecap({
    ...MORNING_BASE,
    now: at(10),
    state: { lastYesterdayRecapDate: TODAY },
    yesterdaySecondsTracked: NOTIFY_MIN_SECONDS * 4,
  })
  assert.deepEqual(decision, { fire: false, reason: 'already-fired-today' })
})

// ─── decideCarryoverNudge (§4.2) ───────────────────────────────────────────

test('carryover nudge does not fire when disabled', () => {
  const decision = decideCarryoverNudge({
    ...MORNING_BASE,
    now: at(10),
    todaySecondsTracked: CARRYOVER_MIN_WORK_SECONDS,
    morningNudgeEnabled: false,
  })
  assert.deepEqual(decision, { fire: false, reason: 'disabled' })
})

test('carryover nudge does not fire until ~1h of work that morning', () => {
  const decision = decideCarryoverNudge({
    ...MORNING_BASE,
    now: at(10),
    todaySecondsTracked: CARRYOVER_MIN_WORK_SECONDS - 1,
  })
  assert.deepEqual(decision, { fire: false, reason: 'not-settled-in-yet' })
})

test('carryover nudge fires after ~1h of work, regardless of yesterday recap', () => {
  const decision = decideCarryoverNudge({
    ...MORNING_BASE,
    now: at(10),
    state: { recapGeneratedDates: [YESTERDAY] }, // recap generated yesterday: still fires
    todaySecondsTracked: CARRYOVER_MIN_WORK_SECONDS,
  })
  assert.deepEqual(decision, { fire: true, targetDate: TODAY })
})

test('carryover nudge does not fire in the late afternoon', () => {
  const decision = decideCarryoverNudge({
    ...MORNING_BASE,
    now: at(14),
    todaySecondsTracked: CARRYOVER_MIN_WORK_SECONDS * 3,
  })
  assert.deepEqual(decision, { fire: false, reason: 'after-early-afternoon' })
})

test('carryover nudge does not fire twice in one day', () => {
  const decision = decideCarryoverNudge({
    ...MORNING_BASE,
    now: at(11),
    state: { lastCarryoverNudgeDate: TODAY },
    todaySecondsTracked: CARRYOVER_MIN_WORK_SECONDS * 2,
  })
  assert.deepEqual(decision, { fire: false, reason: 'already-fired-today' })
})

// ─── Property-style: at most one notification per day from a fresh state ──

test('once fired, the same call does not fire again until state resets', () => {
  let state: { lastDailySummaryDate?: string } = {}
  const firstDecision = decideDailySummary({
    now: at(19),
    state,
    todaySecondsTracked: NOTIFY_MIN_SECONDS,
    dailySummaryEnabled: true,
    todayDateString: TODAY,
  })
  assert.equal(firstDecision.fire, true)
  if (firstDecision.fire) state = { lastDailySummaryDate: firstDecision.targetDate }

  const secondDecision = decideDailySummary({
    now: at(21),
    state,
    todaySecondsTracked: NOTIFY_MIN_SECONDS * 2,
    dailySummaryEnabled: true,
    todayDateString: TODAY,
  })
  assert.deepEqual(secondDecision, { fire: false, reason: 'already-fired-today' })
})

// ─── AI attempt budget (cost audit 2026-07-07) ────────────────────────────────
// A failing wrap call used to retry every 60s for the whole notification
// window (~116 system-triggered wrapped_narrative calls in 3 days). The budget
// caps failed attempts per kind per day and spaces retries.

test('AI attempt budget allows the first attempt and enforces the retry gap', () => {
  const t0 = Date.parse('2026-07-07T18:00:00')
  let state: DailyNotifierState = {}
  assert.equal(canAttemptAiNarrative(state, 'evening-wrap', TODAY, t0), true)
  state = recordAiNarrativeAttempt(state, 'evening-wrap', TODAY, t0)

  // One minute later (the notifier's check cadence): blocked.
  assert.equal(canAttemptAiNarrative(state, 'evening-wrap', TODAY, t0 + 60_000), false)
  // After the minimum gap: allowed again.
  assert.equal(canAttemptAiNarrative(state, 'evening-wrap', TODAY, t0 + AI_ATTEMPT_MIN_GAP_MS), true)
})

test('AI attempt budget hard-caps attempts per kind per day', () => {
  const t0 = Date.parse('2026-07-07T18:00:00')
  let state: DailyNotifierState = {}
  for (let i = 0; i < AI_ATTEMPT_MAX_PER_DAY; i += 1) {
    const at = t0 + i * AI_ATTEMPT_MIN_GAP_MS
    assert.equal(canAttemptAiNarrative(state, 'evening-wrap', TODAY, at), true)
    state = recordAiNarrativeAttempt(state, 'evening-wrap', TODAY, at)
  }
  // Budget exhausted: no attempt, no matter how much time passes today.
  assert.equal(canAttemptAiNarrative(state, 'evening-wrap', TODAY, t0 + 6 * 3_600_000), false)
})

test('AI attempt budget is independent per kind and per date', () => {
  const t0 = Date.parse('2026-07-07T08:00:00')
  const yesterday = '2026-07-06'
  let state: DailyNotifierState = {}
  for (let i = 0; i < AI_ATTEMPT_MAX_PER_DAY; i += 1) {
    state = recordAiNarrativeAttempt(state, 'yesterday-recap', yesterday, t0 + i * AI_ATTEMPT_MIN_GAP_MS)
  }
  assert.equal(canAttemptAiNarrative(state, 'yesterday-recap', yesterday, t0 + 6 * 3_600_000), false)
  // A different kind on a different date keeps its own budget — and recording
  // it must not wipe the exhausted one (pruning is by age, not date match).
  assert.equal(canAttemptAiNarrative(state, 'carryover-nudge', TODAY, t0), true)
  state = recordAiNarrativeAttempt(state, 'carryover-nudge', TODAY, t0)
  assert.equal(canAttemptAiNarrative(state, 'yesterday-recap', yesterday, t0 + 6 * 3_600_000), false)
})

test('AI attempt budget prunes entries older than 48h', () => {
  const t0 = Date.parse('2026-07-05T18:00:00')
  let state: DailyNotifierState = recordAiNarrativeAttempt({}, 'evening-wrap', '2026-07-05', t0)
  const twoDaysLater = t0 + 49 * 3_600_000
  state = recordAiNarrativeAttempt(state, 'evening-wrap', TODAY, twoDaysLater)
  assert.deepEqual(Object.keys(state.aiAttempts ?? {}), [`evening-wrap:${TODAY}`])
})
