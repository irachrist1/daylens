// Tests for the pure scheduling decisions used by the daily-summary notifier.
// These cover the time-of-day gates, once-per-day write, the activity
// threshold (an empty day fires nothing), and the removed carryover nudge.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decideDailySummary,
  decideYesterdayRecap,
  decideWeeklyBrief,
  NOTIFY_MIN_SECONDS,
  WEEKLY_NOTIFY_MIN_SECONDS,
  AI_ATTEMPT_MAX_PER_DAY,
  AI_ATTEMPT_MIN_GAP_MS,
  canAttemptAiNarrative,
  recordAiNarrativeAttempt,
  type DailyNotifierState,
} from '../src/main/lib/dailySummaryScheduler'

const TODAY = '2026-05-12'
const YESTERDAY = '2026-05-11'

function at(hour: number, minute = 0): Date {
  // Year/month/day fixed so the date string passed alongside
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
    notificationsConsented: true,
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
    notificationsConsented: true,
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
    notificationsConsented: true,
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
    notificationsConsented: true,
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
    notificationsConsented: true,
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
    notificationsConsented: true,
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
    notificationsConsented: true,
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
    notificationsConsented: true,
    todayDateString: TODAY,
  })
  assert.deepEqual(decision, { fire: true, targetDate: TODAY })
})

// ─── decideYesterdayRecap (§4.1) ───────────────────────────────────────────

const MORNING_BASE = {
  state: {},
  morningNudgeEnabled: true,
  notificationsConsented: true,
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

// ─── decideWeeklyBrief ────────────────────────────────────────────────────────
// Fires at the week boundary — Monday morning — for the completed week
// (anchored on Sunday). Missed windows skip; restarts never duplicate.

// The fixed test Monday; the completed week it recaps ends the Sunday before.
const MONDAY = '2026-05-11'
const SUNDAY_ANCHOR = '2026-05-10'

function mondayAt(hour: number, minute = 0): Date {
  return new Date(2026, 4, 11, hour, minute, 0, 0)
}

const WEEKLY_BASE = {
  state: {} as DailyNotifierState,
  weeklyBriefEnabled: true,
  notificationsConsented: true,
  weekAnchorDate: SUNDAY_ANCHOR,
  weekSecondsTracked: WEEKLY_NOTIFY_MIN_SECONDS,
}

test('weekly brief does not fire when disabled', () => {
  const decision = decideWeeklyBrief({ ...WEEKLY_BASE, now: mondayAt(9), weeklyBriefEnabled: false })
  assert.deepEqual(decision, { fire: false, reason: 'disabled' })
})

test('weekly brief fires Monday morning for the completed week', () => {
  const decision = decideWeeklyBrief({ ...WEEKLY_BASE, now: mondayAt(9) })
  assert.deepEqual(decision, { fire: true, targetDate: SUNDAY_ANCHOR })
})

test('weekly brief only fires at the week boundary, never midweek', () => {
  for (const day of [12, 13, 14, 15, 16, 17]) { // Tue..Sun of that week
    const decision = decideWeeklyBrief({ ...WEEKLY_BASE, now: new Date(2026, 4, day, 9, 0, 0, 0) })
    assert.deepEqual(decision, { fire: false, reason: 'not-week-boundary' }, `day=${day}`)
  }
})

test('weekly brief respects the morning window: too early holds, too late skips the week', () => {
  assert.deepEqual(
    decideWeeklyBrief({ ...WEEKLY_BASE, now: mondayAt(4, 59) }),
    { fire: false, reason: 'before-5' },
  )
  // A missed window is SKIPPED, not delivered late into the afternoon.
  for (const hour of [12, 15, 21]) {
    assert.deepEqual(
      decideWeeklyBrief({ ...WEEKLY_BASE, now: mondayAt(hour) }),
      { fire: false, reason: 'window-passed' },
      `hour=${hour}`,
    )
  }
})

test('weekly brief fires at most once per week: restarts cannot duplicate it', () => {
  const first = decideWeeklyBrief({ ...WEEKLY_BASE, now: mondayAt(8) })
  assert.equal(first.fire, true)
  const afterFire: DailyNotifierState = { lastWeeklyBriefAnchor: SUNDAY_ANCHOR }
  // Same Monday, later check (a restart mid-window): already fired.
  assert.deepEqual(
    decideWeeklyBrief({ ...WEEKLY_BASE, now: mondayAt(10), state: afterFire }),
    { fire: false, reason: 'already-fired-this-week' },
  )
  // NEXT Monday is a different anchor and fires again.
  const nextMonday = new Date(2026, 4, 18, 9, 0, 0, 0)
  assert.equal(nextMonday.getDay(), 1)
  const nextWeek = decideWeeklyBrief({
    ...WEEKLY_BASE,
    now: nextMonday,
    state: afterFire,
    weekAnchorDate: '2026-05-17',
  })
  assert.deepEqual(nextWeek, { fire: true, targetDate: '2026-05-17' })
})

test('weekly brief stays silent over a near-empty week: silence over invention', () => {
  const decision = decideWeeklyBrief({
    ...WEEKLY_BASE,
    now: mondayAt(9),
    weekSecondsTracked: WEEKLY_NOTIFY_MIN_SECONDS - 1,
  })
  assert.deepEqual(decision, { fire: false, reason: 'insufficient-week-activity' })
})

test('the weekly rhythm window follows the chosen work rhythm', async () => {
  const { workRhythmWindows } = await import('../src/main/lib/dailySummaryScheduler')
  const night = workRhythmWindows('night')
  // A night owl's Monday-morning window starts later; before it, the brief holds.
  assert.deepEqual(
    decideWeeklyBrief({
      ...WEEKLY_BASE,
      now: mondayAt(7),
      morningStartHour: night.morningStartHour,
      morningEndHour: night.morningEndHour,
    }),
    { fire: false, reason: `before-${night.morningStartHour}` },
  )
})

test('the weekly-brief AI attempt budget is its own kind', () => {
  const t0 = Date.parse('2026-05-11T08:00:00')
  let state: DailyNotifierState = {}
  for (let i = 0; i < AI_ATTEMPT_MAX_PER_DAY; i += 1) {
    state = recordAiNarrativeAttempt(state, 'weekly-brief', SUNDAY_ANCHOR, t0 + i * AI_ATTEMPT_MIN_GAP_MS)
  }
  assert.equal(canAttemptAiNarrative(state, 'weekly-brief', SUNDAY_ANCHOR, t0 + 6 * 3_600_000), false)
  // The other kinds keep their own budgets.
  assert.equal(canAttemptAiNarrative(state, 'evening-wrap', MONDAY, t0 + 6 * 3_600_000), true)
  assert.equal(canAttemptAiNarrative(state, 'yesterday-recap', SUNDAY_ANCHOR, t0 + 6 * 3_600_000), true)
})

// ─── Notification consent (briefs.md: no brief before consent) ───────────────

test('no brief fires before notification consent — all three kinds', () => {
  assert.deepEqual(
    decideDailySummary({
      now: at(20),
      state: {},
      todaySecondsTracked: NOTIFY_MIN_SECONDS * 4,
      dailySummaryEnabled: true,
      notificationsConsented: false,
      todayDateString: TODAY,
    }),
    { fire: false, reason: 'no-notification-consent' },
  )
  assert.deepEqual(
    decideYesterdayRecap({
      ...MORNING_BASE,
      now: at(9),
      yesterdaySecondsTracked: NOTIFY_MIN_SECONDS * 4,
      notificationsConsented: false,
    }),
    { fire: false, reason: 'no-notification-consent' },
  )
  assert.deepEqual(
    decideWeeklyBrief({ ...WEEKLY_BASE, now: mondayAt(9), notificationsConsented: false }),
    { fire: false, reason: 'no-notification-consent' },
  )
})

// ─── Clock changes and timezone travel never duplicate or misfire ────────────
// State is keyed by the LOCAL date (day) / completed-week anchor (week), so a
// clock rolled back across the window boundary on the same local date, or a
// timezone hop that re-enters the window, can only ever hit the
// already-fired gate — never a second notification for the same period.

test('a clock rolled back across the window on the same date cannot refire any brief', () => {
  // Evening: fired at 19:00, clocks moved back to 18:05 the same date.
  assert.deepEqual(
    decideDailySummary({
      now: at(18, 5),
      state: { lastDailySummaryDate: TODAY },
      todaySecondsTracked: NOTIFY_MIN_SECONDS * 4,
      dailySummaryEnabled: true,
      notificationsConsented: true,
      todayDateString: TODAY,
    }),
    { fire: false, reason: 'already-fired-today' },
  )
  // Morning: fired at 09:00, clocks moved back to 06:00 the same date.
  assert.deepEqual(
    decideYesterdayRecap({
      ...MORNING_BASE,
      now: at(6),
      state: { lastYesterdayRecapDate: TODAY },
      yesterdaySecondsTracked: NOTIFY_MIN_SECONDS * 4,
    }),
    { fire: false, reason: 'already-fired-today' },
  )
  // Weekly: fired Monday 08:00, clocks moved back into the window again.
  assert.deepEqual(
    decideWeeklyBrief({
      ...WEEKLY_BASE,
      now: mondayAt(5, 30),
      state: { lastWeeklyBriefAnchor: SUNDAY_ANCHOR },
    }),
    { fire: false, reason: 'already-fired-this-week' },
  )
})

test('timezone travel to a new local date only fires inside that date\'s own window', () => {
  // Landing where it is already past noon: the morning window is over —
  // skipped, never delivered late into an unrelated part of the day.
  assert.deepEqual(
    decideYesterdayRecap({
      ...MORNING_BASE,
      now: at(14),
      yesterdaySecondsTracked: NOTIFY_MIN_SECONDS * 4,
    }),
    { fire: false, reason: 'after-noon' },
  )
  // Landing where it is not yet Monday morning: holds until the window.
  assert.deepEqual(
    decideWeeklyBrief({ ...WEEKLY_BASE, now: mondayAt(3) }),
    { fire: false, reason: 'before-5' },
  )
})

// ─── The carryover nudge is removed ─────────────────────────────────────────
// Removed with the brief rebuild, not migrated: the scheduler exposes no
// carryover decision, no carryover window, and no carryover state.

test('the carryover nudge is gone from the scheduler surface', async () => {
  const scheduler = await import('../src/main/lib/dailySummaryScheduler')
  const exported = Object.keys(scheduler).join(' ')
  assert.ok(!/carryover/i.test(exported), `no carryover export may remain, got: ${exported}`)
  const windows = scheduler.workRhythmWindows('standard')
  assert.ok(!('carryoverEndHour' in windows), 'rhythm windows carry no carryover hour')
})

// ─── Property-style: at most one notification per day from a fresh state ──

test('once fired, the same call does not fire again until state resets', () => {
  let state: { lastDailySummaryDate?: string } = {}
  const firstDecision = decideDailySummary({
    now: at(19),
    state,
    todaySecondsTracked: NOTIFY_MIN_SECONDS,
    dailySummaryEnabled: true,
    notificationsConsented: true,
    todayDateString: TODAY,
  })
  assert.equal(firstDecision.fire, true)
  if (firstDecision.fire) state = { lastDailySummaryDate: firstDecision.targetDate }

  const secondDecision = decideDailySummary({
    now: at(21),
    state,
    todaySecondsTracked: NOTIFY_MIN_SECONDS * 2,
    dailySummaryEnabled: true,
    notificationsConsented: true,
    todayDateString: TODAY,
  })
  assert.deepEqual(secondDecision, { fire: false, reason: 'already-fired-today' })
})

// ─── AI attempt budget ──────────────────────────────────────────────────────
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
  assert.equal(canAttemptAiNarrative(state, 'evening-wrap', TODAY, t0), true)
  state = recordAiNarrativeAttempt(state, 'evening-wrap', TODAY, t0)
  assert.equal(canAttemptAiNarrative(state, 'yesterday-recap', yesterday, t0 + 6 * 3_600_000), false)
})

test('AI attempt budget prunes entries older than 48h', () => {
  const t0 = Date.parse('2026-07-05T18:00:00')
  let state: DailyNotifierState = recordAiNarrativeAttempt({}, 'evening-wrap', '2026-07-05', t0)
  const twoDaysLater = t0 + 49 * 3_600_000
  state = recordAiNarrativeAttempt(state, 'evening-wrap', TODAY, twoDaysLater)
  assert.deepEqual(Object.keys(state.aiAttempts ?? {}), [`evening-wrap:${TODAY}`])
})
