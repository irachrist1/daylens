// Pure scheduling decisions for the briefs & wraps notifier. Lives in /lib so it
// has no dependency on settings, the database, or providers — tests drive the
// gate logic with synthetic state alone.
//
// briefs-wraps.md §4: the morning brief is TWO separate notifications with
// different firing rules. §5: the evening wrap fires as you shut down.
//
// The notifier (`src/main/services/dailySummaryNotifier.ts`) gathers settings +
// state + tracked seconds and asks these functions whether to fire.

export interface DailyNotifierState {
  /** Evening wrap last fired for this date. */
  lastDailySummaryDate?: string
  /** Yesterday's-recap notification last fired (keyed to the day it fired). */
  lastYesterdayRecapDate?: string
  /** Carryover-nudge notification last fired (keyed to the day it fired). */
  lastCarryoverNudgeDate?: string
  /** Dates the user explicitly generated a recap for (so we don't re-offer it). */
  recapGeneratedDates?: string[]
}

// Minimum tracked seconds before a day has enough signal to be worth a recap.
// Matches the 'partial' threshold from the renderer quality model.
export const NOTIFY_MIN_SECONDS = 45 * 60

// The carryover nudge catches you once you're settled — after ~1h of work that
// morning, not the instant you open the laptop (§4.2).
export const CARRYOVER_MIN_WORK_SECONDS = 60 * 60

export type SchedulerDecision =
  | { fire: true; targetDate: string }
  | { fire: false; reason: string }

function hasReachedLocalTime(now: Date, hour: number, minute = 0): boolean {
  return now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= minute)
}

// ─── Evening wrap (§5) ──────────────────────────────────────────────────────────

export interface DailySummaryDecisionInput {
  now: Date
  state: DailyNotifierState
  todaySecondsTracked: number
  dailySummaryEnabled: boolean
  todayDateString: string
}

export function decideDailySummary(input: DailySummaryDecisionInput): SchedulerDecision {
  if (!input.dailySummaryEnabled) return { fire: false, reason: 'disabled' }
  if (input.state.lastDailySummaryDate === input.todayDateString) {
    return { fire: false, reason: 'already-fired-today' }
  }
  if (!hasReachedLocalTime(input.now, 18)) return { fire: false, reason: 'before-18' }
  if (input.todaySecondsTracked < NOTIFY_MIN_SECONDS) {
    return { fire: false, reason: 'insufficient-activity' }
  }
  return { fire: true, targetDate: input.todayDateString }
}

// ─── Yesterday's recap (§4.1) ─────────────────────────────────────────────────
// Fires first thing in the morning, ONLY if you did not already generate a recap
// yesterday. It exists to give you the recap you didn't generate yourself.

export interface YesterdayRecapDecisionInput {
  now: Date
  state: DailyNotifierState
  yesterdaySecondsTracked: number
  morningNudgeEnabled: boolean
  todayDateString: string
  yesterdayDateString: string
}

export function decideYesterdayRecap(input: YesterdayRecapDecisionInput): SchedulerDecision {
  if (!input.morningNudgeEnabled) return { fire: false, reason: 'disabled' }
  if (input.state.lastYesterdayRecapDate === input.todayDateString) {
    return { fire: false, reason: 'already-fired-today' }
  }
  // Morning window: from early morning until noon.
  if (!hasReachedLocalTime(input.now, 5)) return { fire: false, reason: 'before-5' }
  if (input.now.getHours() >= 12) return { fire: false, reason: 'after-noon' }
  // The critical rule: if a recap was already generated yesterday, don't repeat it.
  if ((input.state.recapGeneratedDates ?? []).includes(input.yesterdayDateString)) {
    return { fire: false, reason: 'recap-already-generated' }
  }
  if (input.yesterdaySecondsTracked < NOTIFY_MIN_SECONDS) {
    return { fire: false, reason: 'insufficient-yesterday-activity' }
  }
  return { fire: true, targetDate: input.yesterdayDateString }
}

// ─── Carryover nudge (§4.2) ───────────────────────────────────────────────────
// Fires after 1–2 hours of work that morning — always, regardless of whether a
// recap was generated yesterday. The "here's what to pick up" nudge.

export interface CarryoverNudgeDecisionInput {
  now: Date
  state: DailyNotifierState
  todaySecondsTracked: number
  morningNudgeEnabled: boolean
  todayDateString: string
  yesterdayDateString: string
}

export function decideCarryoverNudge(input: CarryoverNudgeDecisionInput): SchedulerDecision {
  if (!input.morningNudgeEnabled) return { fire: false, reason: 'disabled' }
  if (input.state.lastCarryoverNudgeDate === input.todayDateString) {
    return { fire: false, reason: 'already-fired-today' }
  }
  // Late morning / very early afternoon — once you're settled into the day.
  if (input.now.getHours() >= 14) return { fire: false, reason: 'after-early-afternoon' }
  if (input.todaySecondsTracked < CARRYOVER_MIN_WORK_SECONDS) {
    return { fire: false, reason: 'not-settled-in-yet' }
  }
  return { fire: true, targetDate: input.todayDateString }
}
