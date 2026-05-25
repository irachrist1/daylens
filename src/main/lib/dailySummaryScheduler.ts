// Pure scheduling decisions for the daily-summary notifier. Lives in /lib
// instead of /services so it has no transitive dependency on settings, the
// database, or providers — which means tests can drive the gate logic with
// synthetic state alone.
//
// The notifier (`src/main/services/dailySummaryNotifier.ts`) is the only
// production caller; it gathers settings + state + tracked seconds and asks
// these functions whether to fire.

export interface DailyNotifierState {
  lastDailySummaryDate?: string
  lastMorningNudgeDate?: string
}

// Minimum tracked seconds before Wrapped has enough signal to be worth notifying.
// Matches the 'partial' threshold from the renderer quality model.
export const NOTIFY_MIN_SECONDS = 45 * 60

export type SchedulerDecision =
  | { fire: true; targetDate: string }
  | { fire: false; reason: string }

function hasReachedLocalTime(now: Date, hour: number, minute = 0): boolean {
  return now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= minute)
}

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

export interface MorningNudgeDecisionInput {
  now: Date
  state: DailyNotifierState
  todaySecondsTracked: number
  yesterdaySecondsTracked: number
  morningNudgeEnabled: boolean
  todayDateString: string
  yesterdayDateString: string
}

export function decideMorningNudge(input: MorningNudgeDecisionInput): SchedulerDecision {
  if (!input.morningNudgeEnabled) return { fire: false, reason: 'disabled' }
  if (input.state.lastMorningNudgeDate === input.todayDateString) {
    return { fire: false, reason: 'already-fired-today' }
  }
  if (!hasReachedLocalTime(input.now, 9)) return { fire: false, reason: 'before-9' }
  if (input.now.getHours() >= 12) return { fire: false, reason: 'after-noon' }
  if (input.todaySecondsTracked > 0) return { fire: false, reason: 'already-working-today' }
  if (input.yesterdaySecondsTracked < NOTIFY_MIN_SECONDS) {
    return { fire: false, reason: 'insufficient-yesterday-activity' }
  }
  return { fire: true, targetDate: input.yesterdayDateString }
}
