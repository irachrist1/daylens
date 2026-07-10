export const THIN_APP_NARRATIVE_SUMMARY = 'Daylens has only thin app-specific signal for this app.'

export function appDetailRangeKey(daysOrDate: number | string, anchorDate: string): string {
  return typeof daysOrDate === 'string'
    ? `1d:${daysOrDate}`
    : `${daysOrDate}d:${anchorDate}`
}

export function appNarrativeScopeKey(canonicalAppId: string, rangeKey: string): string {
  return `app:${canonicalAppId}:${rangeKey}`
}

export function isThinAppNarrative(summary: string | null | undefined): boolean {
  return summary?.trim() === THIN_APP_NARRATIVE_SUMMARY
}
