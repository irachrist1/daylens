import { FOCUSED_CATEGORIES } from '@shared/types'
import type { AppCategory, FocusScoreBreakdown } from '@shared/types'

export function isCategoryFocused(category: AppCategory | string): boolean {
  return FOCUSED_CATEGORIES.includes(category as AppCategory)
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

const DEEP_WORK_BLOCK_THRESHOLD_SEC = 25 * 60
const MIN_SCORE_ACTIVE_SECONDS = 30 * 60
const CONTINUOUS_GAP_TOLERANCE_MS = 60_000

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
