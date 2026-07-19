import type { AppCategory, AppUsageSummary } from '@shared/types'

export function appSummaryId(summary: Pick<AppUsageSummary, 'canonicalAppId' | 'bundleId'>): string {
  return summary.canonicalAppId ?? summary.bundleId
}

export function filterAppSummariesByCategory(
  summaries: readonly AppUsageSummary[],
  category: AppCategory | null,
): AppUsageSummary[] {
  return category === null
    ? [...summaries]
    : summaries.filter((summary) => summary.category === category)
}

export function splitAppSummaries(
  summaries: readonly AppUsageSummary[],
  category: AppCategory | null,
): { primary: AppUsageSummary[]; fleeting: AppUsageSummary[] } {
  const primary: AppUsageSummary[] = []
  const fleeting: AppUsageSummary[] = []

  // The five largest applications by time are always visibly present, never
  // collapsed into the fleeting fold — on a light day even a top app can sit
  // under the fleeting thresholds, and a collapsed row is an omission from
  // the rendered view.
  const topFive = new Set(
    [...summaries]
      .sort((left, right) => right.totalSeconds - left.totalSeconds)
      .slice(0, 5)
      .map((summary) => appSummaryId(summary)),
  )

  for (const summary of summaries) {
    const isFleeting = summary.totalSeconds < 120
      || ((summary.sessionCount ?? 1) <= 1 && summary.totalSeconds < 5 * 60)
    if (isFleeting && category === null && !topFive.has(appSummaryId(summary))) fleeting.push(summary)
    else primary.push(summary)
  }

  return { primary, fleeting }
}
