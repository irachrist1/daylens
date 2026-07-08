// Pure aggregation of frozen daily snapshots into period facts (week / month /
// year). The whole point of briefs-wraps.md invariant 4: the wrap's stat card
// and its narrative both read THIS — a sum of frozen days — so they can't
// disagree. No re-summarizing, no live recompute.

import type {
  AppCategory,
  DaySnapshot,
  WrappedPeriodThread,
} from '@shared/types'
import { looksLikeRawArtifactLabel } from '../../renderer/lib/wrappedFacts'

export interface SnapshotRollup {
  totalSeconds: number
  workSeconds: number
  leisureSeconds: number
  personalSeconds: number
  daysWithActivity: number
  dominantWorkCategory: AppCategory | 'unknown'
  dominantWorkCategoryPct: number
  categories: Array<{ category: AppCategory; seconds: number }>
  topApps: Array<{ appName: string; seconds: number }>
  threads: WrappedPeriodThread[]
  leisureSurfaces: string[]
  busiestDay: { dateStr: string; dayLabel: string; totalSeconds: number } | null
  quietestActiveDay: { dateStr: string; dayLabel: string; totalSeconds: number } | null
  longestStretch: { dateStr: string; dayLabel: string; seconds: number; label: string; startClock?: string | null } | null
  /** Per-day kind splits, chronological — best/worst-day and ratio slides. */
  days: Array<{ dateStr: string; dayLabel: string; totalSeconds: number; workSeconds: number; leisureSeconds: number }>
  /** Meetings-category seconds summed across the period. */
  meetingsSeconds: number
}

const MAX_CATEGORIES = 6
const MAX_APPS = 6
const MAX_THREADS = 5
const MAX_LEISURE = 4

/** Sum frozen snapshots into the headline period facts. `dayLabel` turns a date
 *  string into a human weekday/label for superlatives. */
export function rollupSnapshots(
  snapshots: DaySnapshot[],
  dayLabel: (dateStr: string) => string,
): SnapshotRollup {
  let totalSeconds = 0
  let workSeconds = 0
  let leisureSeconds = 0
  let personalSeconds = 0
  let daysWithActivity = 0

  const workCategory = new Map<AppCategory, number>()
  const apps = new Map<string, number>()
  const leisure = new Map<string, number>()
  const threads = new Map<string, { subject: string; seconds: number; days: number }>()

  let busiestDay: SnapshotRollup['busiestDay'] = null
  let quietestActiveDay: SnapshotRollup['quietestActiveDay'] = null
  let longestStretch: SnapshotRollup['longestStretch'] = null
  let meetingsSeconds = 0
  const days: SnapshotRollup['days'] = []

  for (const snap of snapshots) {
    if (snap.totalActiveSeconds <= 0) continue
    daysWithActivity += 1
    totalSeconds += snap.totalActiveSeconds
    workSeconds += snap.kind.work
    leisureSeconds += snap.kind.leisure
    personalSeconds += snap.kind.personal
    days.push({
      dateStr: snap.date,
      dayLabel: dayLabel(snap.date),
      totalSeconds: snap.totalActiveSeconds,
      workSeconds: snap.kind.work,
      leisureSeconds: snap.kind.leisure,
    })

    // Meeting truth: prefer the span-based field (mirrors the daily facts
    // builder); older frozen snapshots fall back to category-weighted seconds.
    meetingsSeconds += snap.meetingsSpanSeconds
      ?? snap.categories.find((cat) => cat.category === 'meetings')?.seconds
      ?? 0
    for (const cat of snap.categories) {
      // Only work-relevant time feeds "main mode" / "where the work went".
      if (cat.category === 'entertainment' || cat.category === 'social') continue
      workCategory.set(cat.category, (workCategory.get(cat.category) ?? 0) + cat.seconds)
    }
    for (const app of snap.apps) {
      // Route through the same raw-artifact guard the day-side app/site slices
      // use (dayWrapScenes.ts) — a corrupted "appName" (a leaked window title,
      // e.g. "wrapped-agent-plan.mdx.bak | LinkedIn") must never reach a wrap
      // as if it were a real app (wrapped-agent-plan.md P0 item 4).
      if (!app.appName || looksLikeRawArtifactLabel(app.appName)) continue
      apps.set(app.appName, (apps.get(app.appName) ?? 0) + app.seconds)
    }
    for (const surface of snap.leisureSurfaces) {
      leisure.set(surface, (leisure.get(surface) ?? 0) + 1)
    }
    for (const thread of snap.threads) {
      const key = thread.subject.toLowerCase()
      const prev = threads.get(key)
      if (prev) { prev.seconds += thread.seconds; prev.days += 1 }
      else threads.set(key, { subject: thread.subject, seconds: thread.seconds, days: 1 })
    }

    if (!busiestDay || snap.totalActiveSeconds > busiestDay.totalSeconds) {
      busiestDay = { dateStr: snap.date, dayLabel: dayLabel(snap.date), totalSeconds: snap.totalActiveSeconds }
    }
    if (!quietestActiveDay || snap.totalActiveSeconds < quietestActiveDay.totalSeconds) {
      quietestActiveDay = { dateStr: snap.date, dayLabel: dayLabel(snap.date), totalSeconds: snap.totalActiveSeconds }
    }
    if (snap.longestBlock && (!longestStretch || snap.longestBlock.seconds > longestStretch.seconds)) {
      longestStretch = {
        dateStr: snap.date,
        dayLabel: dayLabel(snap.date),
        seconds: snap.longestBlock.seconds,
        label: snap.longestBlock.label,
        startClock: snap.longestBlock.startClock ?? null,
      }
    }
  }

  const sortedWorkCategories = [...workCategory.entries()].sort((a, b) => b[1] - a[1])
  const workCategoryTotal = sortedWorkCategories.reduce((s, [, v]) => s + v, 0)
  const topWorkCategory = sortedWorkCategories[0]
  const dominantWorkCategory: AppCategory | 'unknown' = topWorkCategory?.[0] ?? 'unknown'
  const dominantWorkCategoryPct = workCategoryTotal > 0 && topWorkCategory
    ? Math.round((topWorkCategory[1] / workCategoryTotal) * 100)
    : 0

  return {
    totalSeconds,
    workSeconds,
    leisureSeconds,
    personalSeconds,
    daysWithActivity,
    dominantWorkCategory,
    dominantWorkCategoryPct,
    categories: sortedWorkCategories.slice(0, MAX_CATEGORIES).map(([category, seconds]) => ({ category, seconds })),
    topApps: [...apps.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_APPS).map(([appName, seconds]) => ({ appName, seconds })),
    threads: [...threads.values()]
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, MAX_THREADS)
      .map((t) => ({ subject: t.subject, seconds: t.seconds, daysActive: t.days })),
    leisureSurfaces: [...leisure.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_LEISURE).map(([name]) => name),
    busiestDay,
    // Only meaningful when more than one active day; the caller may drop it.
    quietestActiveDay: daysWithActivity > 1 ? quietestActiveDay : null,
    longestStretch,
    days,
    meetingsSeconds,
  }
}

/** Sum a set of buckets (already-grouped snapshots) into the bucket rollup used
 *  for the "shape of the month/year" — busiest week, busiest month. */
export function bucketTotals(
  buckets: Array<{ label: string; snapshots: DaySnapshot[] }>,
): { buckets: Array<{ label: string; totalSeconds: number; dominantWorkCategory: AppCategory | 'unknown' }>; busiestBucket: { label: string; totalSeconds: number } | null } {
  const out = buckets.map((b) => {
    const totalSeconds = b.snapshots.reduce((s, snap) => s + snap.totalActiveSeconds, 0)
    const workCategory = new Map<AppCategory, number>()
    for (const snap of b.snapshots) {
      for (const cat of snap.categories) {
        if (cat.category === 'entertainment' || cat.category === 'social') continue
        workCategory.set(cat.category, (workCategory.get(cat.category) ?? 0) + cat.seconds)
      }
    }
    const top = [...workCategory.entries()].sort((a, b2) => b2[1] - a[1])[0]
    return { label: b.label, totalSeconds, dominantWorkCategory: (top?.[0] ?? 'unknown') as AppCategory | 'unknown' }
  })
  const busiest = out.filter((b) => b.totalSeconds > 0).sort((a, b) => b.totalSeconds - a.totalSeconds)[0] ?? null
  return { buckets: out, busiestBucket: busiest ? { label: busiest.label, totalSeconds: busiest.totalSeconds } : null }
}
