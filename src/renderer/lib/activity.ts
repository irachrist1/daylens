import type { AppCategory, AppSession, AppUsageSummary, FocusSession } from '@shared/types'
import { FOCUSED_CATEGORIES } from '@shared/types'
import { percentOf, dateStringFromMs } from './format'

export interface CategoryTotal {
  category: AppCategory
  totalSeconds: number
}

export interface SessionGroup {
  key: string
  bundleId: string
  appName: string
  category: AppCategory
  isFocused: boolean
  startTime: number
  endTime: number
  totalSeconds: number
  sessionCount: number
}

export interface ContextSwitchingStats {
  count: number
  averageSeconds: number
}

const SYSTEM_NOISE_SEC = 120

export function isPresentationNoise(category: AppCategory, durationSeconds: number): boolean {
  return (category === 'system' || category === 'uncategorized') && durationSeconds < SYSTEM_NOISE_SEC
}

export function isVisibleSession(
  session: AppSession,
  minSeconds = 10,
  includeNoiseCategories = false,
): boolean {
  if (session.durationSeconds < minSeconds) return false
  if (!includeNoiseCategories && isPresentationNoise(session.category, session.durationSeconds)) return false
  return true
}

export function filterVisibleSessions(
  sessions: AppSession[],
  minSeconds = 10,
  includeNoiseCategories = false,
): AppSession[] {
  return sessions.filter((session) => isVisibleSession(session, minSeconds, includeNoiseCategories))
}

export function groupConsecutiveSessions(
  sessions: AppSession[],
  options?: {
    gapMs?: number
    minSeconds?: number
    includeNoiseCategories?: boolean
  },
): SessionGroup[] {
  const gapMs = options?.gapMs ?? 5 * 60_000
  const visible = filterVisibleSessions(
    sessions,
    options?.minSeconds ?? 10,
    options?.includeNoiseCategories ?? false,
  ).slice().sort((a, b) => a.startTime - b.startTime)

  const groups: SessionGroup[] = []

  for (const session of visible) {
    const endTime = session.endTime ?? (session.startTime + session.durationSeconds * 1_000)
    const previous = groups[groups.length - 1]

    if (
      previous &&
      previous.bundleId === session.bundleId &&
      session.startTime - previous.endTime <= gapMs
    ) {
      previous.endTime = Math.max(previous.endTime, endTime)
      previous.totalSeconds += session.durationSeconds
      previous.sessionCount += 1
      continue
    }

    groups.push({
      key: `${session.bundleId}-${session.startTime}`,
      bundleId: session.bundleId,
      appName: session.appName,
      category: session.category,
      isFocused: session.isFocused,
      startTime: session.startTime,
      endTime,
      totalSeconds: session.durationSeconds,
      sessionCount: 1,
    })
  }

  return groups
}

export function groupFocusedBlocks(sessions: AppSession[], gapMs = 5 * 60_000): SessionGroup[] {
  const focused = filterVisibleSessions(sessions, 15, false)
    .filter((session) => FOCUSED_CATEGORIES.includes(session.category))
    .slice()
    .sort((a, b) => a.startTime - b.startTime)

  const blocks: SessionGroup[] = []

  for (const session of focused) {
    const endTime = session.endTime ?? (session.startTime + session.durationSeconds * 1_000)
    const previous = blocks[blocks.length - 1]

    if (previous && session.startTime - previous.endTime <= gapMs) {
      previous.endTime = Math.max(previous.endTime, endTime)
      previous.totalSeconds += session.durationSeconds
      previous.sessionCount += 1
      continue
    }

    blocks.push({
      key: `block-${session.bundleId}-${session.startTime}`,
      bundleId: session.bundleId,
      appName: session.appName,
      category: session.category,
      isFocused: true,
      startTime: session.startTime,
      endTime,
      totalSeconds: session.durationSeconds,
      sessionCount: 1,
    })
  }

  return blocks
}

export function buildCategoryTotalsFromSummaries(summaries: AppUsageSummary[]): CategoryTotal[] {
  const map = new Map<AppCategory, number>()
  for (const summary of summaries) {
    if (isPresentationNoise(summary.category, summary.totalSeconds)) continue
    map.set(summary.category, (map.get(summary.category) ?? 0) + summary.totalSeconds)
  }
  return [...map.entries()]
    .map(([category, totalSeconds]) => ({ category, totalSeconds }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
}

export function buildCategoryTotalsFromSessions(sessions: AppSession[]): CategoryTotal[] {
  const map = new Map<AppCategory, number>()
  for (const session of filterVisibleSessions(sessions, 10, false)) {
    map.set(session.category, (map.get(session.category) ?? 0) + session.durationSeconds)
  }
  return [...map.entries()]
    .map(([category, totalSeconds]) => ({ category, totalSeconds }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
}

export function getLetterGrade(focusPct: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (focusPct >= 85) return 'A'
  if (focusPct >= 70) return 'B'
  if (focusPct >= 55) return 'C'
  if (focusPct >= 40) return 'D'
  return 'F'
}

export function calculateFocusTotals(summaries: AppUsageSummary[]): {
  totalSeconds: number
  focusSeconds: number
  focusPct: number
} {
  const visible = summaries.filter((summary) => !isPresentationNoise(summary.category, summary.totalSeconds))
  const totalSeconds = visible.reduce((sum, summary) => sum + summary.totalSeconds, 0)
  const focusSeconds = visible
    .filter((summary) => FOCUSED_CATEGORIES.includes(summary.category))
    .reduce((sum, summary) => sum + summary.totalSeconds, 0)
  return {
    totalSeconds,
    focusSeconds,
    focusPct: percentOf(focusSeconds, totalSeconds),
  }
}

export function computeContextSwitching(
  sessions: AppSession[],
  options?: {
    nowMs?: number
    windowMs?: number
    shortSessionSeconds?: number
  },
): ContextSwitchingStats {
  const nowMs = options?.nowMs ?? Date.now()
  const windowMs = options?.windowMs ?? 60 * 60_000
  const shortSessionSeconds = options?.shortSessionSeconds ?? 180
  const recent = filterVisibleSessions(sessions, 10, false).filter((session) => {
    const endTime = session.endTime ?? (session.startTime + session.durationSeconds * 1_000)
    return endTime >= nowMs - windowMs && endTime <= nowMs
  })
  const shortSessions = recent.filter((session) => session.durationSeconds < shortSessionSeconds)
  const averageSeconds = shortSessions.length > 0
    ? Math.round(shortSessions.reduce((sum, session) => sum + session.durationSeconds, 0) / shortSessions.length)
    : 0

  return {
    count: shortSessions.length,
    averageSeconds,
  }
}

export function getLongestFocusedBlockSeconds(sessions: AppSession[], gapMs = 5 * 60_000): number {
  return groupFocusedBlocks(sessions, gapMs).reduce(
    (longest, block) => Math.max(longest, block.totalSeconds),
    0,
  )
}

export function buildHourlyUsage(
  sessions: AppSession[],
  startHour = 9,
  endHour = 17,
): { label: string; seconds: number }[] {
  const buckets = new Map<number, number>()

  for (const session of filterVisibleSessions(sessions, 10, false)) {
    const start = new Date(session.startTime)
    const hour = start.getHours()
    if (hour < startHour || hour >= endHour) continue
    buckets.set(hour, (buckets.get(hour) ?? 0) + session.durationSeconds)
  }

  return Array.from({ length: endHour - startHour }, (_, index) => {
    const hour = startHour + index
    const suffix = hour >= 12 ? 'PM' : 'AM'
    const display = hour % 12 === 0 ? 12 : hour % 12
    return {
      label: `${display}${suffix.toLowerCase()}`,
      seconds: buckets.get(hour) ?? 0,
    }
  })
}

export function getFocusStreakDays(sessions: FocusSession[]): number {
  const dates = [...new Set(
    sessions
      .filter((session) => session.endTime !== null)
      .map((session) => dateStringFromMs(session.startTime)),
  )].sort((a, b) => new Date(b).getTime() - new Date(a).getTime())

  if (dates.length === 0) return 0

  let streak = 0
  let cursor = dateStringFromMs(Date.now())

  for (const date of dates) {
    if (date !== cursor) {
      if (streak === 0) {
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const yesterdayKey = dateStringFromMs(yesterday.getTime())
        if (date !== yesterdayKey) break
        cursor = yesterdayKey
      } else {
        break
      }
    }

    if (date === cursor) {
      streak += 1
      const next = new Date(cursor)
      next.setDate(next.getDate() - 1)
      cursor = dateStringFromMs(next.getTime())
    }
  }

  return streak
}

export function getFocusTotalForLastDays(sessions: FocusSession[], days: number): number {
  const cutoff = Date.now() - days * 86_400_000
  return sessions
    .filter((session) => session.endTime !== null && session.startTime >= cutoff)
    .reduce((sum, session) => sum + session.durationSeconds, 0)
}

export function isDistractionCategory(category: AppCategory): boolean {
  return category === 'entertainment' || category === 'social'
}
