// Pure scheduling decisions for the briefs & wraps notifier. Lives in /lib so it
// has no dependency on settings, the database, or providers — tests drive the
// gate logic with synthetic state alone.
//
// briefs-wraps.md §4: the morning brief is TWO separate notifications with
// different firing rules. §5: the evening wrap fires as you shut down.
//
// The notifier (`src/main/services/dailySummaryNotifier.ts`) gathers settings +
// state + tracked seconds and asks these functions whether to fire.

import type { WorkRhythm } from '@shared/types'

// DEV-113: the user's working rhythm (chosen in onboarding) shifts when the
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
  /** Carryover nudge stops offering once this hour passes. */
  carryoverEndHour: number
}

export function workRhythmWindows(rhythm: WorkRhythm | undefined): RhythmWindows {
  switch (rhythm) {
    case 'early':
      return { eveningWrapHour: 17, morningStartHour: 4, morningEndHour: 11, carryoverEndHour: 13 }
    case 'night':
      return { eveningWrapHour: 21, morningStartHour: 8, morningEndHour: 14, carryoverEndHour: 16 }
    case 'always':
      return { eveningWrapHour: 18, morningStartHour: 5, morningEndHour: 13, carryoverEndHour: 15 }
    case 'standard':
    default:
      return { eveningWrapHour: 18, morningStartHour: 5, morningEndHour: 12, carryoverEndHour: 14 }
  }
}

const STANDARD_WINDOWS = workRhythmWindows('standard')

export interface DailyNotifierState {
  /** Evening wrap last fired for this date. */
  lastDailySummaryDate?: string
  /** Yesterday's-recap notification last fired (keyed to the day it fired). */
  lastYesterdayRecapDate?: string
  /** Carryover-nudge notification last fired (keyed to the day it fired). */
  lastCarryoverNudgeDate?: string
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

export type AiAttemptKind = 'evening-wrap' | 'yesterday-recap' | 'carryover-nudge'

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
  /** Hour after which the carryover nudge stops offering; defaults to 14:00. */
  carryoverEndHour?: number
}

export function decideCarryoverNudge(input: CarryoverNudgeDecisionInput): SchedulerDecision {
  if (!input.morningNudgeEnabled) return { fire: false, reason: 'disabled' }
  if (input.state.lastCarryoverNudgeDate === input.todayDateString) {
    return { fire: false, reason: 'already-fired-today' }
  }
  // Late morning / very early afternoon — once you're settled into the day.
  const carryoverEndHour = input.carryoverEndHour ?? STANDARD_WINDOWS.carryoverEndHour
  if (input.now.getHours() >= carryoverEndHour) return { fire: false, reason: 'after-early-afternoon' }
  if (input.todaySecondsTracked < CARRYOVER_MIN_WORK_SECONDS) {
    return { fire: false, reason: 'not-settled-in-yet' }
  }
  return { fire: true, targetDate: input.todayDateString }
}
