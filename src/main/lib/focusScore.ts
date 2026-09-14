import { FOCUSED_CATEGORIES } from '@shared/types'
import type { AppCategory, FocusScoreBreakdown } from '@shared/types'
import { appMatchesFocusList } from '@shared/userProfile'

export function isCategoryFocused(category: AppCategory | string): boolean {
  return FOCUSED_CATEGORIES.includes(category as AppCategory)
}

/** Existing V2 deep-work thresholds — reused so summaries do not invent new limits. */
export const FOCUS_STREAK_THRESHOLD_SEC = 25 * 60
export const FOCUS_GAP_TOLERANCE_MS = 60_000

/**
 * What week/day summaries mean by "focus". Category membership is not focus:
 * an editor or AI tool being frontmost is not enough. A stretch counts only
 * when one eligible app holds the foreground for 25 minutes or more without
 * an app switch, allowing gaps of up to 60 seconds. AI tools are not eligible.
 */
export const FOCUS_DEFINITION =
  'Focus is time in one app for 25 minutes or more without switching apps, allowing gaps of up to 60 seconds. App category is not focus. AI tools are not eligible.'

export function isFocusEligibleCategory(category: AppCategory | string): boolean {
  return category !== 'aiTools' && FOCUSED_CATEGORIES.includes(category as AppCategory)
}

/**
 * Whether an app counts as real, focused work. A category in FOCUSED_CATEGORIES
 * always counts; on top of that, an app the user explicitly marked as their real
 * work in onboarding (`focusApps`) counts even if its category normally would
 * not (e.g. a browser they live in, or a niche tool we classify as "other").
 */
export function isAppFocused(
  category: AppCategory | string,
  bundleId: string | null | undefined,
  appName: string | null | undefined,
  focusApps: string[] | undefined,
): boolean {
  return isCategoryFocused(category) || appMatchesFocusList(focusApps, bundleId, appName)
}

// ---------------------------------------------------------------------------
// Focus score V2 — honest deep-work percentage.
// ---------------------------------------------------------------------------

interface FocusScoreV2Session {
  startTime?: number
  endTime?: number | null
  durationSeconds: number
  category: AppCategory | string
  isFocused?: boolean
}

export interface FocusScoreV2Input {
  sessions: FocusScoreV2Session[]
  totalActiveSeconds?: number
}

const DEEP_WORK_BLOCK_THRESHOLD_SEC = FOCUS_STREAK_THRESHOLD_SEC
const MIN_SCORE_ACTIVE_SECONDS = 30 * 60
const CONTINUOUS_GAP_TOLERANCE_MS = FOCUS_GAP_TOLERANCE_MS

export interface SustainedFocusSession {
  startTime?: number
  endTime?: number | null
  durationSeconds: number
  category: AppCategory | string
  bundleId?: string | null
  appName?: string | null
  canonicalAppId?: string | null
}

export interface SustainedFocusResult {
  focusSeconds: number
  longestStreakSeconds: number
  streakCount: number
}

function sessionAppKey(session: SustainedFocusSession): string {
  const canonical = session.canonicalAppId?.trim()
  if (canonical) return `canonical:${canonical.toLowerCase()}`
  const bundle = session.bundleId?.trim()
  if (bundle) return `bundle:${bundle.toLowerCase()}`
  return `name:${(session.appName ?? '').trim().toLowerCase()}`
}

/**
 * Focus as agents and summaries must report it: sustained single-app time,
 * not FOCUSED_CATEGORIES membership. Switching Codex → Grok → Claude ends
 * each stretch even though all three share the aiTools category.
 */
export function computeSustainedFocus(
  sessions: readonly SustainedFocusSession[],
): SustainedFocusResult {
  const ordered = [...sessions]
    .filter((session) => sessionDurationSeconds(session) > 0)
    .sort((left, right) => (left.startTime ?? 0) - (right.startTime ?? 0))

  let focusSeconds = 0
  let longestStreakSeconds = 0
  let streakCount = 0
  let streakKey: string | null = null
  let streakSeconds = 0
  let streakEndTime: number | null = null

  function closeStreak() {
    if (streakSeconds >= FOCUS_STREAK_THRESHOLD_SEC) {
      focusSeconds += streakSeconds
      streakCount += 1
      longestStreakSeconds = Math.max(longestStreakSeconds, streakSeconds)
    }
    streakKey = null
    streakSeconds = 0
    streakEndTime = null
  }

  for (const session of ordered) {
    const durationSeconds = sessionDurationSeconds(session)
    const startTime = session.startTime ?? null
    const endTime = typeof session.endTime === 'number'
      ? session.endTime
      : startTime !== null
        ? startTime + durationSeconds * 1000
        : null
    const eligible = isFocusEligibleCategory(session.category)
    const appKey = sessionAppKey(session)
    const gapBreaksStreak = startTime !== null && streakEndTime !== null
      ? startTime - streakEndTime > FOCUS_GAP_TOLERANCE_MS
      : false

    if (!eligible || streakKey !== appKey || gapBreaksStreak) {
      closeStreak()
    }

    if (eligible) {
      streakKey = appKey
      streakSeconds += durationSeconds
      streakEndTime = endTime
    }
  }

  closeStreak()
  return { focusSeconds, longestStreakSeconds, streakCount }
}

function sessionDurationSeconds(session: FocusScoreV2Session): number {
  if (typeof session.startTime === 'number' && typeof session.endTime === 'number' && session.endTime > session.startTime) {
    return Math.max(0, Math.round((session.endTime - session.startTime) / 1000))
  }
  return Math.max(0, session.durationSeconds)
}

export function computeFocusScoreV2(input: FocusScoreV2Input): FocusScoreBreakdown {
  const sessions = [...input.sessions]
    .filter((session) => sessionDurationSeconds(session) > 0)
    .sort((left, right) => (left.startTime ?? 0) - (right.startTime ?? 0))

  const totalActiveSeconds = Math.max(
    0,
    input.totalActiveSeconds ?? sessions.reduce((sum, session) => sum + sessionDurationSeconds(session), 0),
  )

  let switchCount = 0
  for (let i = 1; i < sessions.length; i++) {
    if (sessions[i].category !== sessions[i - 1].category) {
      switchCount++
    }
  }

  let deepWorkSeconds = 0
  let longestStreakSeconds = 0
  let deepWorkSessionCount = 0
  let streakCategory: string | null = null
  let streakSeconds = 0
  let streakEndTime: number | null = null

  function closeStreak() {
    if (streakSeconds >= DEEP_WORK_BLOCK_THRESHOLD_SEC) {
      deepWorkSeconds += streakSeconds
      deepWorkSessionCount++
      longestStreakSeconds = Math.max(longestStreakSeconds, streakSeconds)
    }
    streakCategory = null
    streakSeconds = 0
    streakEndTime = null
  }

  for (const session of sessions) {
    const durationSeconds = sessionDurationSeconds(session)
    const focused = session.isFocused ?? isCategoryFocused(session.category)
    const category = String(session.category)
    const startTime = session.startTime ?? null
    const endTime = typeof session.endTime === 'number'
      ? session.endTime
      : startTime !== null
        ? startTime + durationSeconds * 1000
        : null

    const gapBreaksStreak = startTime !== null && streakEndTime !== null
      ? startTime - streakEndTime > CONTINUOUS_GAP_TOLERANCE_MS
      : false

    if (!focused || streakCategory !== category || gapBreaksStreak) {
      closeStreak()
    }

    if (focused) {
      streakCategory = category
      streakSeconds += durationSeconds
      streakEndTime = endTime
    }
  }

  closeStreak()
  const hasEnoughData = totalActiveSeconds >= MIN_SCORE_ACTIVE_SECONDS

  const rawDeepWorkPct = hasEnoughData
    ? Math.round((deepWorkSeconds / totalActiveSeconds) * 100)
    : null
  // Repeated 25m+ focus blocks now get continuity credit so steady dev days with modest drift do not read as failing focus days.
  const deepWorkPct = rawDeepWorkPct !== null
    && rawDeepWorkPct >= 60
    && rawDeepWorkPct < 85
    && deepWorkSessionCount >= 3
    && longestStreakSeconds >= 35 * 60
    && switchCount <= sessions.length
      ? Math.min(85, rawDeepWorkPct + Math.min(15, Math.round((100 - rawDeepWorkPct) * 0.4)))
      : rawDeepWorkPct

  return {
    deepWorkPct,
    longestStreakSeconds,
    switchCount,
    deepWorkSessionCount,
  }
}
