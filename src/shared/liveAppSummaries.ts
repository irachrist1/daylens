import type { AppUsageSummary, LiveSession } from './types'

export function withLiveAppSummary(
  summaries: AppUsageSummary[],
  live: LiveSession | null,
  rangeStartMs: number,
  nowMs: number,
): AppUsageSummary[] {
  if (!live) return summaries
  const liveStart = Math.max(live.startTime, rangeStartMs)
  const seconds = Math.max(0, Math.round((nowMs - liveStart) / 1000))
  if (seconds <= 0) return summaries

  const liveKey = live.canonicalAppId ?? live.bundleId
  const index = summaries.findIndex((summary) =>
    (summary.canonicalAppId ?? summary.bundleId) === liveKey
    || summary.bundleId === live.bundleId)
  if (index >= 0) {
    return summaries
      .map((summary, position) => position === index
        ? { ...summary, totalSeconds: summary.totalSeconds + seconds }
        : summary)
      .sort((left, right) => right.totalSeconds - left.totalSeconds)
  }

  return [
    ...summaries,
    {
      bundleId: live.bundleId,
      canonicalAppId: liveKey,
      appName: live.appName,
      category: live.category,
      totalSeconds: seconds,
      isFocused: ['development', 'research', 'writing', 'aiTools', 'design', 'productivity'].includes(live.category),
      sessionCount: 1,
    },
  ].sort((left, right) => right.totalSeconds - left.totalSeconds)
}
