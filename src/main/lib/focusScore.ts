import { FOCUSED_CATEGORIES } from '@shared/types'
import type { AppCategory, FocusScoreBreakdown, PeakHoursResult } from '@shared/types'

export interface FocusScoreSession {
  durationSeconds: number
  isFocused: boolean
}

function isHourInPeakWindow(
  hour: number,
  peakWindow: Pick<PeakHoursResult, 'peakStart' | 'peakEnd'>,
): boolean {
  if (peakWindow.peakStart === peakWindow.peakEnd) return true
  if (peakWindow.peakStart < peakWindow.peakEnd) {
    return hour >= peakWindow.peakStart && hour < peakWindow.peakEnd
  }
  return hour >= peakWindow.peakStart || hour < peakWindow.peakEnd
}

export function computeEnhancedFocusScore(params: {
  focusedSeconds: number
  totalSeconds: number
  switchesPerHour: number
  sessions: FocusScoreSession[]
  peakHours?: Pick<PeakHoursResult, 'peakStart' | 'peakEnd'>
  currentHour?: number
  websiteFocusCreditSeconds?: number
}): number {
  const effectiveFocusedSeconds = params.focusedSeconds + (params.websiteFocusCreditSeconds ?? 0)
  if (params.totalSeconds < 60) return 0

  const focusRatio = effectiveFocusedSeconds / params.totalSeconds

  const focusedSessions = params.sessions.filter((session) => session.isFocused)
  const avgSessionMin = focusedSessions.length > 0
    ? focusedSessions.reduce((sum, session) => sum + session.durationSeconds, 0) / focusedSessions.length / 60
    : 0
  const consistencyBonus = Math.min(avgSessionMin / 30, 1) * 10

  const hasFlowState = focusedSessions.some((session) => session.durationSeconds >= 75 * 60)
  const flowBonus = hasFlowState ? 5 : 0
  const peakBonus = params.peakHours !== undefined && params.currentHour !== undefined &&
    isHourInPeakWindow(params.currentHour, params.peakHours)
    ? 5
    : 0

  // Raw switch frequency is descriptive telemetry, not direct evidence that focus was broken.
  const raw = (focusRatio * 100) + consistencyBonus + flowBonus + peakBonus
  return Math.min(Math.round(raw), 100)
}

export function computeFocusScore(params: {
  focusedSeconds: number
  totalSeconds: number
  switchesPerHour: number
  sessions?: FocusScoreSession[]
  peakHours?: Pick<PeakHoursResult, 'peakStart' | 'peakEnd'>
  currentHour?: number
  websiteFocusCreditSeconds?: number
}): number {
  return computeEnhancedFocusScore({
    ...params,
    sessions: params.sessions ?? [],
  })
}

export function isCategoryFocused(category: AppCategory | string): boolean {
  return FOCUSED_CATEGORIES.includes(category as AppCategory)
}

// ---------------------------------------------------------------------------
// Focus score V2 — honest deep-work percentage.
// ---------------------------------------------------------------------------

export interface FocusScoreV2Session {
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

  return {
    deepWorkPct: hasEnoughData
      ? Math.round((deepWorkSeconds / totalActiveSeconds) * 100)
      : null,
    longestStreakSeconds,
    switchCount,
    deepWorkSessionCount,
  }
}
