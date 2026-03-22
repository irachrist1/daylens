import { FOCUSED_CATEGORIES } from '@shared/types'
import type { AppCategory } from '@shared/types'

export function computeFocusScore(params: {
  focusedSeconds: number
  totalSeconds: number
  switchesPerHour: number
  websiteFocusCreditSeconds?: number
}): number {
  const {
    focusedSeconds,
    totalSeconds,
    switchesPerHour,
    websiteFocusCreditSeconds = 0,
  } = params

  if (totalSeconds === 0) return 0

  const focusedRatio = (focusedSeconds + websiteFocusCreditSeconds) / totalSeconds
  const penalty = Math.min(switchesPerHour / 300, 0.15)

  return Math.round(100 * focusedRatio * (1 - penalty))
}

export function isCategoryFocused(category: AppCategory | string): boolean {
  return FOCUSED_CATEGORIES.includes(category as AppCategory)
}
