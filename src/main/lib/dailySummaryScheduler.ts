// Pure scheduling decisions for the briefs & wraps notifier. Lives in /lib so it
// has no dependency on settings, the database, or providers — tests drive the
// gate logic with synthetic state alone.
//
// Three notifications: the morning brief (yesterday's recap), the evening
// wrap that fires as you shut down, and the weekly brief that fires at the
// week boundary and opens the week's wrap. The carryover nudge is gone —
// removed with the brief rebuild, not migrated.
//
// The notifier (`src/main/services/dailySummaryNotifier.ts`) gathers settings +
// state + tracked seconds and asks these functions whether to fire.

import type { WorkRhythm } from '@shared/types'

// The user's working rhythm (chosen in onboarding) shifts when the
// briefs and wrap fire. An early bird gets an earlier evening wrap and morning
// recap window; a night owl gets later ones; "always on" stays wide. The
// defaults match the standard nine-to-five day so behavior is unchanged when no
// rhythm is set.
export interface RhythmWindows {
  /** Earliest hour the evening wrap may fire. */
  eveningWrapHour: number
  /** Morning-recap window: fires only between these hours. */
  morningStartHour: number
  morningEndHour: number
}

export function workRhythmWindows(rhythm: WorkRhythm | undefined): RhythmWindows {
  switch (rhythm) {
    case 'early':
      return { eveningWrapHour: 17, morningStartHour: 4, morningEndHour: 11 }
    case 'night':
      return { eveningWrapHour: 21, morningStartHour: 8, morningEndHour: 14 }
    case 'always':
      return { eveningWrapHour: 18, morningStartHour: 5, morningEndHour: 13 }
    case 'standard':
    default:
      return { eveningWrapHour: 18, morningStartHour: 5, morningEndHour: 12 }
  }
}

const STANDARD_WINDOWS = workRhythmWindows('standard')

export interface DailyNotifierState {
  /** Evening wrap last fired for this date. */
  lastDailySummaryDate?: string
  /** Yesterday's-recap notification last fired (keyed to the day it fired). */
  lastYesterdayRecapDate?: string
  /** Weekly brief last fired for this week (keyed by the completed week's last
   *  day — the anchor its wrap opens on). Restarts, wakes, and clock changes
   *  can never duplicate a week that already fired. */
  lastWeeklyBriefAnchor?: string
  /** Dates the user explicitly generated a recap for (so we don't re-offer it). */
  recapGeneratedDates?: string[]
  /** AI narrative attempts per "<kind>:<date>" — the retry budget below. */
  aiAttempts?: Record<string, { count: number; lastAtMs: number }>
}

// ─── AI attempt budget ────────────────────────────────────────────────────────
// The notifier runs its checks every 60s. When a check's
// window was open but the wrap call failed (or timed out and was discarded), no
// state was written — so the next minute spent ANOTHER full AI call, an
// AI-call-per-minute loop for the rest of the window. This budget makes a failed attempt cost
// something: at most AI_ATTEMPT_MAX_PER_DAY attempts per notification kind per
// day, spaced at least AI_ATTEMPT_MIN_GAP_MS apart. A SUCCESSFUL attempt ends
// the loop through the existing last*Date state, so the budget only ever gates
// retries of failures.

export type AiAttemptKind = 'evening-wrap' | 'yesterday-recap' | 'weekly-brief'

export const AI_ATTEMPT_MAX_PER_DAY = 3
export const AI_ATTEMPT_MIN_GAP_MS = 20 * 60_000

function aiAttemptKey(kind: AiAttemptKind, date: string): string {
  return `${kind}:${date}`
}

export function canAttemptAiNarrative(
  state: DailyNotifierState,
  kind: AiAttemptKind,
  date: string,
  nowMs: number,
): boolean {
  const entry = state.aiAttempts?.[aiAttemptKey(kind, date)]
  if (!entry) return true
  if (entry.count >= AI_ATTEMPT_MAX_PER_DAY) return false
  return nowMs - entry.lastAtMs >= AI_ATTEMPT_MIN_GAP_MS
}

/** True once the day's AI budget for this kind is spent for good — as opposed
 *  to merely waiting out the retry gap. This is the moment the evening recap
 *  stops hoping for a written line and falls back to the deterministic
 *  fact-only one (fallback order: fact-only line, then silence). */
export function aiNarrativeAttemptsExhausted(
  state: DailyNotifierState,
  kind: AiAttemptKind,
  date: string,
): boolean {
  const entry = state.aiAttempts?.[aiAttemptKey(kind, date)]
  return (entry?.count ?? 0) >= AI_ATTEMPT_MAX_PER_DAY
}

/** Returns a new state with the attempt recorded and entries older than 48h
 *  pruned. Pruning is by attempt age, not by date key, because the morning
 *  checks legitimately track yesterday's date while the wrap tracks today's. */
export function recordAiNarrativeAttempt(
  state: DailyNotifierState,
  kind: AiAttemptKind,
  date: string,
  nowMs: number,
): DailyNotifierState {
  const key = aiAttemptKey(kind, date)
  const previous = state.aiAttempts?.[key]
  const kept = Object.entries(state.aiAttempts ?? {})
    .filter(([, entry]) => nowMs - entry.lastAtMs < 48 * 3_600_000)
  return {
    ...state,
    aiAttempts: {
      ...Object.fromEntries(kept),
      [key]: { count: (previous?.count ?? 0) + 1, lastAtMs: nowMs },
    },
  }
}

// Minimum tracked seconds before a day has enough signal to be worth a recap.
// Matches the 'partial' threshold from the renderer quality model. An empty or
// barely-tracked day produces no notification at all: silence over invention.
export const NOTIFY_MIN_SECONDS = 45 * 60

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
  /** Earliest hour the wrap may fire; defaults to the standard 18:00. */
  eveningWrapHour?: number
}

export function decideDailySummary(input: DailySummaryDecisionInput): SchedulerDecision {
  if (!input.dailySummaryEnabled) return { fire: false, reason: 'disabled' }
  if (input.state.lastDailySummaryDate === input.todayDateString) {
    return { fire: false, reason: 'already-fired-today' }
  }
  const eveningWrapHour = input.eveningWrapHour ?? STANDARD_WINDOWS.eveningWrapHour
  if (!hasReachedLocalTime(input.now, eveningWrapHour)) return { fire: false, reason: `before-${eveningWrapHour}` }
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
  /** Morning-recap window; defaults to the standard 05:00–noon. */
  morningStartHour?: number
  morningEndHour?: number
}

export function decideYesterdayRecap(input: YesterdayRecapDecisionInput): SchedulerDecision {
  if (!input.morningNudgeEnabled) return { fire: false, reason: 'disabled' }
  if (input.state.lastYesterdayRecapDate === input.todayDateString) {
    return { fire: false, reason: 'already-fired-today' }
  }
  // Morning window: from early morning until the rhythm's cutoff (noon by default).
  const morningStartHour = input.morningStartHour ?? STANDARD_WINDOWS.morningStartHour
  const morningEndHour = input.morningEndHour ?? STANDARD_WINDOWS.morningEndHour
  if (!hasReachedLocalTime(input.now, morningStartHour)) return { fire: false, reason: `before-${morningStartHour}` }
  if (input.now.getHours() >= morningEndHour) return { fire: false, reason: 'after-noon' }
  // The critical rule: if a recap was already generated yesterday, don't repeat it.
  if ((input.state.recapGeneratedDates ?? []).includes(input.yesterdayDateString)) {
    return { fire: false, reason: 'recap-already-generated' }
  }
  if (input.yesterdaySecondsTracked < NOTIFY_MIN_SECONDS) {
    return { fire: false, reason: 'insufficient-yesterday-activity' }
  }
  return { fire: true, targetDate: input.yesterdayDateString }
}

// ─── Weekly brief (briefs.md) ─────────────────────────────────────────────────
// Fires at the week boundary — Monday morning, inside the same rhythm-derived
// morning window as the morning brief — and opens the completed week's wrap
// (the rolling 7-day window ending on Sunday, so the wrap covers Mon–Sun).
// A missed window is skipped, never delivered late into the week: if Monday's
// morning window passes without a fire, that week's brief simply doesn't
// happen (briefs.md §Scheduling and delivery).

/** Minimum tracked seconds across the week before there is enough signal for a
 *  weekly brief. A near-empty week produces silence over invention. Kept above
 *  the daily floor: one thin day is not a week story. */
export const WEEKLY_NOTIFY_MIN_SECONDS = 2 * 3600

export interface WeeklyBriefDecisionInput {
  now: Date
  state: DailyNotifierState
  /** Total tracked seconds across the completed week (anchor-6 … anchor). */
  weekSecondsTracked: number
  weeklyBriefEnabled: boolean
  /** The completed week's last day (yesterday when today is Monday) — the
   *  anchor date the week wrap opens on, and the once-per-week state key. */
  weekAnchorDate: string
  /** Morning window shared with the morning brief; rhythm-derived. */
  morningStartHour?: number
  morningEndHour?: number
}

export function decideWeeklyBrief(input: WeeklyBriefDecisionInput): SchedulerDecision {
  if (!input.weeklyBriefEnabled) return { fire: false, reason: 'disabled' }
  // The week boundary: local Monday. Clock changes and timezone travel resolve
  // through the same local calendar every other gate uses, so a re-crossed
  // boundary can't re-fire (the anchor key below already recorded the week).
  if (input.now.getDay() !== 1) return { fire: false, reason: 'not-week-boundary' }
  if (input.state.lastWeeklyBriefAnchor === input.weekAnchorDate) {
    return { fire: false, reason: 'already-fired-this-week' }
  }
  const morningStartHour = input.morningStartHour ?? STANDARD_WINDOWS.morningStartHour
  const morningEndHour = input.morningEndHour ?? STANDARD_WINDOWS.morningEndHour
  if (!hasReachedLocalTime(input.now, morningStartHour)) return { fire: false, reason: `before-${morningStartHour}` }
  // Past the window: skip the week, never deliver late (missed windows skip).
  if (input.now.getHours() >= morningEndHour) return { fire: false, reason: 'window-passed' }
  if (input.weekSecondsTracked < WEEKLY_NOTIFY_MIN_SECONDS) {
    return { fire: false, reason: 'insufficient-week-activity' }
  }
  return { fire: true, targetDate: input.weekAnchorDate }
}

