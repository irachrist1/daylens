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
// Focus score V2 — evidence-grounded heuristic.
//
// focus_score = clamp01(
//   0.35 * session_coherence
//   + 0.25 * deep_work_density
//   + 0.20 * artifact_progress
//   + 0.20 * (1 - switch_penalty_normalized)
// ) * 100
//
// Inputs are intentionally scope-agnostic (day, focus session, week window).
// Call sites pass pre-computed block durations and either a real artifact
// count or a window-title-diversity fallback so the score never secretly
// zero-stuffs itself when a signal is missing.
// ---------------------------------------------------------------------------

export interface FocusScoreV2Block {
  durationSeconds: number
  activeSeconds?: number
}

export interface FocusScoreV2Input {
  blocks: FocusScoreV2Block[]
  totalActiveSeconds: number
  switchesPerHour: number
  uniqueArtifactCount?: number
  uniqueWindowTitleCount?: number
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

const COHERENCE_TARGET_MINUTES = 45
const DEEP_WORK_BLOCK_THRESHOLD_SEC = 25 * 60
const ARTIFACT_SATURATION = 16
const SWITCH_RATE_SATURATION = 20
const TITLE_FALLBACK_SATURATION = 10

function computeCoherence(blocks: FocusScoreV2Block[]): number {
  if (blocks.length === 0) return 0
  let weightedSum = 0
  let weightTotal = 0
  for (const block of blocks) {
    const durationSec = Math.max(0, block.durationSeconds)
    const weight = Math.max(0, block.activeSeconds ?? durationSec)
    if (weight <= 0) continue
    weightedSum += (durationSec / 60) * weight
    weightTotal += weight
  }
  if (weightTotal <= 0) return 0
  const meanMinutes = weightedSum / weightTotal
  return clamp01(meanMinutes / COHERENCE_TARGET_MINUTES)
}

function computeDeepWorkDensity(blocks: FocusScoreV2Block[], totalActiveSeconds: number): number {
  if (totalActiveSeconds <= 0) return 0
  let deepSeconds = 0
  for (const block of blocks) {
    if (block.durationSeconds >= DEEP_WORK_BLOCK_THRESHOLD_SEC) {
      deepSeconds += Math.max(0, block.activeSeconds ?? block.durationSeconds)
    }
  }
  return clamp01(deepSeconds / totalActiveSeconds)
}

function computeArtifactProgress(input: FocusScoreV2Input): number {
  if (typeof input.uniqueArtifactCount === 'number' && input.uniqueArtifactCount >= 0) {
    const n = Math.max(0, input.uniqueArtifactCount)
    return clamp01(Math.log2(1 + n) / Math.log2(1 + ARTIFACT_SATURATION))
  }
  if (typeof input.uniqueWindowTitleCount === 'number' && input.uniqueWindowTitleCount >= 0) {
    // Graceful fallback when no artifact extraction has run for the scope yet.
    return clamp01(input.uniqueWindowTitleCount / TITLE_FALLBACK_SATURATION)
  }
  return 0
}

function computeSwitchPenalty(switchesPerHour: number): number {
  if (!Number.isFinite(switchesPerHour) || switchesPerHour <= 0) return 0
  return Math.min(1, switchesPerHour / SWITCH_RATE_SATURATION)
}

export function computeFocusScoreV2(input: FocusScoreV2Input): FocusScoreBreakdown {
  const coherence = computeCoherence(input.blocks)
  const deepWork = computeDeepWorkDensity(input.blocks, input.totalActiveSeconds)
  const artifactProgress = computeArtifactProgress(input)
  const switchPenalty = computeSwitchPenalty(input.switchesPerHour)

  const composite = clamp01(
    0.35 * coherence
    + 0.25 * deepWork
    + 0.20 * artifactProgress
    + 0.20 * (1 - switchPenalty),
  )

  return {
    coherence,
    deepWork,
    artifactProgress,
    switchPenalty,
    score: Math.round(composite * 100),
  }
}
