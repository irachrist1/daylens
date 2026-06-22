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
