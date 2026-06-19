import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { ANALYTICS_EVENT, trackedTimeBucket } from '@shared/analytics'
import { kindForDomain } from '@shared/workKind'
import type { AISurfaceSummary, AppActivityDigest, AppCategory, AppDetailPayload, AppUsageSummary, LiveSession } from '@shared/types'
import EntityIcon from '../components/EntityIcon'
import InlineRevealText from '../components/InlineRevealText'
import { useProjectionResource } from '../hooks/useProjectionResource'
import { track } from '../lib/analytics'
import { ipc } from '../lib/ipc'
import { formatDisplayAppName } from '../lib/apps'
import { formatDuration, todayString } from '../lib/format'
import { openArtifact } from '../lib/openTarget'

const DAYS_OPTIONS = [1, 7, 30] as const

const CATEGORY_LABELS: Record<AppCategory, string> = {
  development: 'Development',
  communication: 'Communication',
  research: 'Research',
  writing: 'Writing',
  aiTools: 'AI tools',
  design: 'Design',
  browsing: 'Browsing',
  meetings: 'Meetings',
  entertainment: 'Entertainment',
  email: 'Email',
  productivity: 'Productivity',
  social: 'Social',
  system: 'System',
  uncategorized: 'Other',
}

function categoryLabel(category: AppCategory): string {
  return CATEGORY_LABELS[category] ?? category
}

// Invariant 7: work surfaces before leisure. Streaming and social (YouTube,
// Netflix, X) are honest and still counted, but collected in a quieter "Off to
// the side" group so they never crowd out the work a developer came to see.
// Order within each group is preserved (callers pass time-sorted lists).
function splitWorkFirst<T>(
  items: readonly T[],
  getDomain: (item: T) => string | null | undefined,
): { work: T[]; leisure: T[] } {
  const work: T[] = []
  const leisure: T[] = []
  for (const item of items) {
    if (kindForDomain(getDomain(item)) === 'leisure') leisure.push(item)
    else work.push(item)
  }
  return { work, leisure }
}

function liveAwareSummaries(
  summaries: AppUsageSummary[],
  live: LiveSession | null,
  days: (typeof DAYS_OPTIONS)[number],
): AppUsageSummary[] {
  if (!live) return summaries

  const end = Date.now()
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const rangeStart = days === 1 ? todayStart : todayStart - (days - 1) * 86_400_000
  const liveStart = Math.max(live.startTime, rangeStart)
  const seconds = Math.max(0, Math.round((end - liveStart) / 1000))

  if (seconds <= 0) return summaries

  const index = summaries.findIndex((summary) => summary.bundleId === live.bundleId)
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
      canonicalAppId: live.canonicalAppId ?? live.bundleId,
      appName: live.appName,
      category: live.category,
      totalSeconds: seconds,
      isFocused: ['development', 'research', 'writing', 'aiTools', 'design', 'productivity'].includes(live.category),
      sessionCount: 1,
    },
  ].sort((left, right) => right.totalSeconds - left.totalSeconds)
}


function normalizedActivityLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function detailSummary(detail: AppDetailPayload, selectedAppName: string): string {
  const blockLabels = detail.blockAppearances
    .slice(0, 3)
    .map((block) => block.label)
    .filter(Boolean)
    .filter((label) => normalizedActivityLabel(label) !== normalizedActivityLabel(selectedAppName))
    .filter((label, index, labels) => labels.indexOf(label) === index)

  // Invariant 9: an artifact is named once. Dedup case-insensitively so the
  // recap never reads "Netflix, Netflix". Spec 4.5: never name co-used apps.
  const seenArtifacts = new Set<string>()
  const artifacts = detail.topArtifacts
    .map((artifact) => artifact.displayTitle)
    .filter(Boolean)
    .filter((title) => {
      const key = normalizedActivityLabel(title)
      if (!key || seenArtifacts.has(key)) return false
      seenArtifacts.add(key)
      return true
    })
    .slice(0, 3)

  const parts: string[] = []
  if (blockLabels.length > 0) parts.push(`Most often part of ${blockLabels.join(', ')}`)
  if (artifacts.length > 0) parts.push(`Key artifacts include ${artifacts.join(', ')}`)
  // Spec 4.3: when an app has too little signal, state its time honestly and
  // say so plainly — never beg for "more context".
  return parts.join('. ') || 'A quiet surface with little to describe beyond the time above.'
}

function appMetricSentence(totalSeconds: number, sessionCount?: number): string {
  const sessions = sessionCount ?? 0
  return `Tracked for ${formatDuration(totalSeconds)}${sessions ? ` across ${sessions} session${sessions === 1 ? '' : 's'}` : ''}.`
}

function formatBlockRange(startTime: number, endTime: number): string {
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return `${formatter.format(startTime)} – ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(endTime)}`
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function shiftAppsDate(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const next = new Date(y, m - 1, d + delta)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
}

function formatAppsDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(y, m - 1, d))
}

function DeleteIconButton({
  label,
  busy,
  onClick,
}: {
  label: string
  busy: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={onClick}
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        border: '1px solid rgba(248, 113, 113, 0.28)',
        background: busy ? 'rgba(248, 113, 113, 0.12)' : 'transparent',
        color: '#ef4444',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.55 : 0.82,
        flexShrink: 0,
      }}
    >
      <Trash2 size={14} strokeWidth={1.9} aria-hidden="true" />
    </button>
  )
}

export default function Apps() {
  // days === 1 enables the date switcher (today raw OR a past day). 7d/30d
  // are range modes that ignore selectedDate.
  const [days, setDays] = useState<(typeof DAYS_OPTIONS)[number]>(1)
  const [selectedDate, setSelectedDate] = useState<string>(todayString())
  const dateMode = days === 1
  const isAppsToday = dateMode && selectedDate === todayString()
  const isAppsPastDay = dateMode && selectedDate !== todayString()
  const [selectedCategory, setSelectedCategory] = useState<AppCategory | null>(null)
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null)
  const [isCompact, setIsCompact] = useState(() => window.innerWidth < 1120)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const lastTrackedDetailKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const onResize = () => setIsCompact(window.innerWidth < 1120)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    track(ANALYTICS_EVENT.APPS_OPENED, {
      surface: 'apps',
      trigger: 'navigation',
      view: 'apps',
    })
  }, [])

  const appsResource = useProjectionResource<{
    summaries: AppUsageSummary[]
    live: LiveSession | null
    digest: AppActivityDigest[]
  }>({
    scope: 'apps',
    dependencies: [days, dateMode ? selectedDate : null],
    // Only auto-poll today's live data. Past-day reads are static; no
    // refresh on date navigation (follow-up C).
    intervalMs: isAppsToday ? 30_000 : 0,
    load: async () => {
      const summariesP = dateMode
        ? (isAppsToday ? ipc.db.getAppSummaries(1) : ipc.db.getAppSummariesForDate(selectedDate))
        : ipc.db.getAppSummaries(days)
      const liveP = isAppsToday ? ipc.tracking.getLiveSession() : Promise.resolve(null)
      // Past days and today (raw) skip the narrative-shaped digest fetch —
      // those panels render finalized projections or raw totals, never the
      // narrative-driven digest.
      const digestP = isAppsPastDay || isAppsToday
        ? Promise.resolve([] as AppActivityDigest[])
        : ipc.db.getAppActivityDigest(days).catch(() => [] as AppActivityDigest[])
      const [summaries, live, digest] = await Promise.all([summariesP, liveP, digestP])
      return {
        summaries: summaries as AppUsageSummary[],
        live: live as LiveSession | null,
        digest: digest as AppActivityDigest[],
      }
    },
  })

  const digestByApp = useMemo(() => {
    const map = new Map<string, AppActivityDigest>()
    for (const entry of appsResource.data?.digest ?? []) {
      map.set(entry.canonicalAppId, entry)
      map.set(entry.bundleId, entry)
    }
    return map
  }, [appsResource.data])

  const summaries = useMemo(
    () => liveAwareSummaries(appsResource.data?.summaries ?? [], appsResource.data?.live ?? null, days),
    [appsResource.data, days],
  )

  const categories = useMemo(() => {
    const seenLabels = new Set<string>()
    const result: AppCategory[] = []
    for (const summary of summaries) {
      const label = categoryLabel(summary.category)
      if (!seenLabels.has(label)) {
        seenLabels.add(label)
        result.push(summary.category)
      }
    }
    return result.sort((left, right) => categoryLabel(left).localeCompare(categoryLabel(right)))
  }, [summaries])

  const filteredSummaries = useMemo(
    () => selectedCategory
      ? summaries.filter((summary) => categoryLabel(summary.category) === categoryLabel(selectedCategory))
      : summaries,
    [selectedCategory, summaries],
  )

  // Group apps by category and split low-signal entries below a fold so high-
  // signal tools lead. An app is "fleeting" if it totalled under 2 minutes or
  // only ran in a single session — these are visit-once tools that should not
  // be promoted alongside a primary workstream app.
  const { grouped, fleeting } = useMemo(() => {
    const map = new Map<AppCategory, AppUsageSummary[]>()
    const fleeting: AppUsageSummary[] = []
    for (const summary of filteredSummaries) {
      const isFleeting = summary.totalSeconds < 120 || (summary.sessionCount ?? 1) <= 1 && summary.totalSeconds < 5 * 60
      if (isFleeting && !selectedCategory) {
        fleeting.push(summary)
        continue
      }
      const list = map.get(summary.category) ?? []
      list.push(summary)
      map.set(summary.category, list)
    }
    // Keep category order by cumulative time within that category, so the
    // section containing today's main work leads. Inside each section we
    // preserve the `totalSeconds` desc ordering `summaries` already uses.
    const orderedCategories = [...map.entries()]
      .map(([category, items]) => ({
        category,
        items,
        total: items.reduce((sum, item) => sum + item.totalSeconds, 0),
      }))
      .sort((left, right) => right.total - left.total)
    return { grouped: orderedCategories, fleeting }
  }, [filteredSummaries, selectedCategory])

  // Leakage callout: top time-sink apps from categories the user didn't come
  // to work in (entertainment, social, and low-signal browsing). Shown as a
  // sidebar footer when the range has real signal and any such apps exceed
  // 5 minutes.
  const leakApps = useMemo(() => {
    const leakCategories: AppCategory[] = ['entertainment', 'social']
    return summaries
      .filter((summary) => leakCategories.includes(summary.category) && summary.totalSeconds >= 5 * 60)
      .slice(0, 3)
  }, [summaries])

  useEffect(() => {
    if (!selectedAppId) return
    const current = filteredSummaries.find((summary) => (summary.canonicalAppId ?? summary.bundleId) === selectedAppId)
    if (!current) {
      setSelectedAppId(null)
    }
  }, [filteredSummaries, selectedAppId])

  useEffect(() => {
    const node = contentRef.current
    if (!node) return
    node.scrollTop = 0
  }, [days, selectedCategory, selectedAppId])

  const selectedSummary = filteredSummaries.find((summary) => (summary.canonicalAppId ?? summary.bundleId) === selectedAppId) ?? null
  const selectedCanonicalId = selectedSummary ? (selectedSummary.canonicalAppId ?? selectedSummary.bundleId) : null


  const detailResource = useProjectionResource<AppDetailPayload>({
    scope: 'apps',
    enabled: !!selectedCanonicalId,
    dependencies: [selectedCanonicalId, days, isAppsPastDay ? selectedDate : null],
    shouldReload: (event) => (
      !event.canonicalAppId
      || event.canonicalAppId === selectedCanonicalId
    ),
    load: () => ipc.db.getAppDetail(selectedCanonicalId as string, isAppsPastDay ? selectedDate : days),
  })
  // Always loads cache-only on selection or app/range change. The explicit
  // generate handler below owns force-generation; we never bake `force=true`
  // into this resource because its loading state cannot be reliably observed
  // (subsequent loads set `reloading`, not `loading`), making any state
  // machine tied to it race against itself.
  const narrativeResource = useProjectionResource<AISurfaceSummary | null>({
    scope: 'apps',
    enabled: !!selectedCanonicalId,
    dependencies: [selectedCanonicalId, days, isAppsPastDay ? selectedDate : null],
    intervalMs: 0,
    shouldReload: (event) => (
      !event.canonicalAppId
      || event.canonicalAppId === selectedCanonicalId
    ),
    load: () => ipc.ai.getAppNarrative(selectedCanonicalId as string, isAppsPastDay ? 1 : days, false).catch(() => null),
  })

  const expectedRangeKey = isAppsPastDay
    ? `1d:${selectedDate}`
    : `${days}d:${todayString()}`
  const selectedRangeLabel = dateMode
    ? (isAppsToday ? 'today' : formatAppsDateLabel(selectedDate))
    : `last ${days} days`
  const detail = detailResource.data && detailResource.data.canonicalAppId === selectedCanonicalId
    && detailResource.data.rangeKey === expectedRangeKey
    ? detailResource.data
    : null
  // Only trust the narrative if it was produced for the currently selected
  // app. Without this guard, switching apps briefly shows a stale narrative
  // from the previously selected app while the new one loads.
  // scopeKey format matches `app:${canonicalAppId}:${rangeKey}` produced by
  // the main-process narrative builder.
  const expectedNarrativeScopeKey = selectedCanonicalId
    ? `app:${selectedCanonicalId}:${expectedRangeKey}`
    : null
  const rawNarrative = narrativeResource.data
    && narrativeResource.data.scope === 'app_detail'
    && narrativeResource.data.scopeKey === expectedNarrativeScopeKey
    ? narrativeResource.data
    : null
  // The AI is instructed to return the literal phrase below when it lacks
  // enough evidence to cite two entities. Treat that as "no real narrative":
  // the user sees deterministic local summary, and the button reads Generate
  // instead of Refresh (the latter implies a generated story already exists).
  const THIN_NARRATIVE_MARKER = 'thin app-specific signal'
  const isThinNarrative = (value: { summary: string } | null): boolean =>
    !!value && value.summary.includes(THIN_NARRATIVE_MARKER)
  const narrative = rawNarrative && !isThinNarrative(rawNarrative) ? rawNarrative : null

  // Past-day Apps cannot ask for an AI narrative scoped to the chosen date —
  // the main-side narrative path keys cache by `1d:<today>` regardless of the
  // selected date, so any returned summary would be rejected by the scopeKey
  // check above and the section would silently never populate. Hide the
  // narrative affordance for past-day until the AI path becomes date-aware.
  const narrativeSupported = !isAppsPastDay

  // Tracks scopeKeys the user explicitly clicked Generate on in this session.
  // The "Generating a stronger app narrative…" message and the disabled
  // button state are only shown for these scopes — cache-only reads on
  // selection no longer flash the spinner. Cleared in the handler's finally
  // block once the force-generation roundtrip completes.
  const [activeGenerationScopes, setActiveGenerationScopes] = useState<Set<string>>(() => new Set())
  // Per-scope status from the most recent Generate click. Lets the UI tell the
  // user when the AI ran but produced no usable narrative ("thin signal"),
  // when it errored, or when it succeeded — instead of the previous silent
  // failure where the button cycled back to "Generate" with no visible change.
  type GenerationStatus =
    | { kind: 'ok' }
    | { kind: 'thin' }
    | { kind: 'no-bundle' }
    | { kind: 'error'; message: string }
  const [lastGenerationStatus, setLastGenerationStatus] = useState<Record<string, GenerationStatus>>({})
  const [deletingActivityKey, setDeletingActivityKey] = useState<string | null>(null)
  const [deleteActivityError, setDeleteActivityError] = useState<string | null>(null)
  const isUserGenerating = expectedNarrativeScopeKey
    ? activeGenerationScopes.has(expectedNarrativeScopeKey)
    : false
  const currentGenerationStatus = expectedNarrativeScopeKey
    ? lastGenerationStatus[expectedNarrativeScopeKey] ?? null
    : null
  const handleGenerateAppNarrative = async () => {
    if (!selectedCanonicalId || !expectedNarrativeScopeKey) {
      console.warn('[apps-narrative] click ignored: no selected app')
      return
    }
    if (activeGenerationScopes.has(expectedNarrativeScopeKey)) return
    const scopeKey = expectedNarrativeScopeKey
    const requestDays = isAppsPastDay ? 1 : days
    console.info(`[apps-narrative] generating for ${scopeKey} (days=${requestDays})`)
    setActiveGenerationScopes((prev) => {
      const next = new Set(prev)
      next.add(scopeKey)
      return next
    })
    setLastGenerationStatus((prev) => {
      if (!(scopeKey in prev)) return prev
      const next = { ...prev }
      delete next[scopeKey]
      return next
    })
    try {
      const result = await ipc.ai.getAppNarrative(selectedCanonicalId, requestDays, true)
      console.info(`[apps-narrative] ipc returned for ${scopeKey}`, {
        hasResult: !!result,
        scopeKey: result?.scopeKey,
        chars: result?.summary?.length ?? 0,
      })
      let status: GenerationStatus
      if (!result) {
        status = { kind: 'no-bundle' }
      } else if (result.summary.includes(THIN_NARRATIVE_MARKER)) {
        status = { kind: 'thin' }
      } else {
        status = { kind: 'ok' }
      }
      setLastGenerationStatus((prev) => ({ ...prev, [scopeKey]: status }))
      await narrativeResource.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[apps-narrative] generation failed for ${scopeKey}:`, message)
      setLastGenerationStatus((prev) => ({ ...prev, [scopeKey]: { kind: 'error', message } }))
    } finally {
      setActiveGenerationScopes((prev) => {
        if (!prev.has(scopeKey)) return prev
        const next = new Set(prev)
        next.delete(scopeKey)
        return next
      })
    }
  }

  const handleDeleteWebsiteActivity = async (target: { domain: string; url?: string | null; title?: string | null }) => {
    const label = target.title?.trim() || target.domain
    // Invariant 10 / spec §4.4: deletion is permanent and removes the records
    // everywhere they appear — not just the period you're looking at. The
    // confirmation must say plainly that it can't be undone.
    const confirmed = window.confirm(
      `Permanently delete all tracked activity for "${label}"? This removes it from every period in Daylens and cannot be undone.`,
    )
    if (!confirmed) return

    const hasUrl = !!target.url
    const key = hasUrl ? `url:${target.url}` : `domain:${target.domain}`
    setDeletingActivityKey(key)
    setDeleteActivityError(null)
    try {
      // Delete globally (no range): a page row removes only that URL; a domain
      // row removes the whole domain. Passing both would OR them and wipe the
      // entire domain on a single-page delete, so target exactly one.
      await ipc.tracking.deleteActivity(
        hasUrl ? { url: target.url } : { domain: target.domain },
      )
      // rematerializeAndNotify on the main side invalidates apps/timeline/
      // insights, which auto-reloads these resources; the changed evidence
      // signature regenerates any recap built on the deleted entry. Refresh
      // explicitly too so the panel updates without waiting on the event.
      await appsResource.refresh()
      await detailResource.refresh()
      await narrativeResource.refresh()
    } catch (error) {
      setDeleteActivityError(error instanceof Error ? error.message : String(error))
    } finally {
      setDeletingActivityKey(null)
    }
  }

  useEffect(() => {
    if (!detail) return
    const detailKey = `${detail.canonicalAppId}:${detail.rangeKey}`
    if (lastTrackedDetailKeyRef.current === detailKey) return
    lastTrackedDetailKeyRef.current = detailKey
    track(ANALYTICS_EVENT.APP_DETAIL_OPENED, {
      surface: 'apps',
      tracked_time_bucket: trackedTimeBucket(detail.totalSeconds),
      trigger: 'click',
      view: 'apps',
    })
  }, [detail])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        padding: '28px 32px 18px',
        borderBottom: '1px solid var(--color-border-ghost)',
        background: 'var(--color-bg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          {/* LEFT: date switcher (C23, mirrors Timeline header). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={() => { setDays(1); setSelectedDate((d) => shiftAppsDate(dateMode ? d : todayString(), -1)) }}
              style={{
                width: 32, height: 32, borderRadius: 999, border: 'none',
                background: 'transparent', cursor: 'pointer',
                color: 'var(--color-text-secondary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              aria-label="Previous day"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="m10 3.5-4.5 4.5 4.5 4.5" />
              </svg>
            </button>
            <div style={{
              minWidth: 156,
              textAlign: 'center',
              padding: '8px 16px',
              borderRadius: 999,
              border: '1px solid var(--color-border-ghost)',
              background: 'var(--color-surface)',
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
            }}>
              {dateMode
                ? (isAppsToday ? 'Today' : formatAppsDateLabel(selectedDate))
                : `Last ${days} days`}
            </div>
            <button
              type="button"
              onClick={() => {
                const next = shiftAppsDate(dateMode ? selectedDate : todayString(), 1)
                if (next <= todayString()) { setDays(1); setSelectedDate(next) }
              }}
              disabled={dateMode && selectedDate === todayString()}
              style={{
                width: 32, height: 32, borderRadius: 999, border: 'none',
                background: 'transparent',
                cursor: (dateMode && selectedDate === todayString()) ? 'default' : 'pointer',
                color: 'var(--color-text-secondary)',
                opacity: (dateMode && selectedDate === todayString()) ? 0.3 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              aria-label="Next day"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 3.5 10.5 8 6 12.5" />
              </svg>
            </button>
          </div>

          {/* RIGHT: range toggle + jump-to-today, mirroring Timeline's right cluster. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {(!dateMode || selectedDate !== todayString()) && (
              <button
                type="button"
                onClick={() => { setDays(1); setSelectedDate(todayString()) }}
                style={{
                  padding: '7px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--color-border-ghost)',
                  background: 'var(--color-surface-low)',
                  color: 'var(--color-text-secondary)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Today
              </button>
            )}
            <div style={{
              display: 'flex',
              gap: 3,
              padding: 3,
              borderRadius: 9,
              background: 'var(--color-surface-high)',
              border: '1px solid var(--color-border-ghost)',
              flexShrink: 0,
            }}>
              {DAYS_OPTIONS.map((option) => (
                <button
                  key={option}
                  onClick={() => {
                    setDays(option)
                    if (option === 1) setSelectedDate(todayString())
                  }}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 7,
                    border: 'none',
                    cursor: 'pointer',
                    background: dateMode && option === 1
                      ? 'var(--gradient-primary)'
                      : (!dateMode && days === option ? 'var(--gradient-primary)' : 'transparent'),
                    color: (dateMode && option === 1) || (!dateMode && days === option)
                      ? 'var(--color-primary-contrast)'
                      : 'var(--color-text-secondary)',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {option === 1 ? 'Day' : `${option}d`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {categories.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              onClick={() => setSelectedCategory(null)}
              style={{
                padding: '6px 11px',
                borderRadius: 999,
                border: '1px solid var(--color-border-ghost)',
                background: selectedCategory === null ? 'var(--color-surface-low)' : 'transparent',
                color: selectedCategory === null ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              All
            </button>
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                style={{
                  padding: '6px 11px',
                  borderRadius: 999,
                  border: '1px solid var(--color-border-ghost)',
                  background: selectedCategory === category ? 'var(--color-surface-low)' : 'transparent',
                  color: selectedCategory === category ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {categoryLabel(category)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: isCompact ? 'minmax(0, 1fr)' : '320px minmax(0, 1fr)',
          height: '100%',
          width: '100%',
          maxWidth: 1180,
          minWidth: 0,
        }}>
          <div style={{
            borderRight: isCompact ? 'none' : '1px solid var(--color-border-ghost)',
            overflowY: 'auto',
            padding: '18px 16px 28px',
          }}>
            {appsResource.error && (
              <div style={{ color: '#f87171', fontSize: 13 }}>Could not load apps: {appsResource.error}</div>
            )}

            {!appsResource.error && filteredSummaries.length === 0 && (
              <div style={{
                borderRadius: 16,
                border: '1px solid var(--color-border-ghost)',
                background: 'var(--color-surface)',
                padding: '24px 18px',
                textAlign: 'center',
                color: 'var(--color-text-tertiary)',
              }}>
                No app activity in this range yet.
              </div>
            )}

            <div style={{ display: 'grid', gap: 18 }}>
              {grouped.map(({ category, items }) => (
                <section key={category} style={{ display: 'grid', gap: 6 }}>
                  <div style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-tertiary)',
                    padding: '0 4px 4px',
                  }}>
                    {categoryLabel(category)}
                  </div>
                  {items.map((summary) => {
                    const key = summary.canonicalAppId ?? summary.bundleId
                    const selected = key === selectedAppId
                    const digest = digestByApp.get(summary.canonicalAppId ?? summary.bundleId)
                      ?? digestByApp.get(summary.bundleId)
                    // Invariant 1: the bold title is ALWAYS the real app name —
                    // never the category, never a block/page/video title. The
                    // "what you did" headline, when present, is a quiet line
                    // below the name, and the category rides in the meta line.
                    const activityHeadline = digest?.topBlockLabel || digest?.topArtifactTitle || null
                    const appName = formatDisplayAppName(summary.appName)
                    const metaLine = `${categoryLabel(summary.category)} · ${formatDuration(summary.totalSeconds)}${summary.sessionCount ? ` · ${summary.sessionCount} session${summary.sessionCount === 1 ? '' : 's'}` : ''}`
                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedAppId(key)}
                        style={{
                          width: '100%',
                          border: selected ? '1px solid var(--color-border-ghost)' : '1px solid transparent',
                          background: selected ? 'var(--color-surface-low)' : 'transparent',
                          borderRadius: 14,
                          padding: '14px 14px',
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                          <EntityIcon appName={summary.appName} bundleId={summary.bundleId} canonicalAppId={summary.canonicalAppId} size={30} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--color-text-primary)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {appName}
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 3, lineHeight: 1.3 }}>
                              {metaLine}
                            </div>
                            {activityHeadline && (
                              <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', marginTop: 4, lineHeight: 1.3, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}>
                                {activityHeadline}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </section>
              ))}

              {fleeting.length > 0 && (
                <details style={{ marginTop: 4 }}>
                  <summary style={{
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.10em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-tertiary)',
                    padding: '6px 4px',
                    listStyle: 'none',
                  }}>
                    Smaller or fleeting ({fleeting.length})
                  </summary>
                  <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                    {fleeting.map((summary) => {
                      const key = summary.canonicalAppId ?? summary.bundleId
                      const selected = key === selectedAppId
                      return (
                        <button
                          key={key}
                          onClick={() => setSelectedAppId(key)}
                          style={{
                            width: '100%',
                            border: selected ? '1px solid var(--color-border-ghost)' : '1px solid transparent',
                            background: selected ? 'var(--color-surface-low)' : 'transparent',
                            borderRadius: 12,
                            padding: '8px 12px',
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <EntityIcon appName={summary.appName} bundleId={summary.bundleId} canonicalAppId={summary.canonicalAppId} size={22} />
                            <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                              {formatDisplayAppName(summary.appName)}
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                              {formatDuration(summary.totalSeconds)}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </details>
              )}

              {leakApps.length > 0 && (
                <section style={{
                  marginTop: 4,
                  borderTop: '1px solid var(--color-border-ghost)',
                  paddingTop: 16,
                  display: 'grid',
                  gap: 8,
                }}>
                  <div style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-tertiary)',
                    padding: '0 4px',
                  }}>
                    Where time slipped
                  </div>
                  {leakApps.map((summary) => {
                    const key = summary.canonicalAppId ?? summary.bundleId
                    return (
                      <button
                        key={`leak:${key}`}
                        onClick={() => setSelectedAppId(key)}
                        style={{
                          width: '100%',
                          border: '1px solid transparent',
                          background: 'transparent',
                          borderRadius: 12,
                          padding: '8px 12px',
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <EntityIcon appName={summary.appName} bundleId={summary.bundleId} canonicalAppId={summary.canonicalAppId} size={22} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                              {formatDisplayAppName(summary.appName)}
                            </div>
                          </div>
                          <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                            {formatDuration(summary.totalSeconds)}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </section>
              )}
            </div>
          </div>

          <div ref={contentRef} style={{ overflowY: 'auto', padding: '22px 24px 32px' }}>
            {!selectedSummary && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 200 }}>
                <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)', opacity: 0.5 }}>Select an app</span>
              </div>
            )}

            {selectedSummary && (
              <div style={{ display: 'grid', gap: 18 }}>
                <div style={{
                  borderRadius: 18,
                  border: '1px solid var(--color-border-ghost)',
                  background: 'var(--color-surface)',
                  padding: '20px 22px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'start', gap: 14 }}>
                    <EntityIcon appName={selectedSummary.appName} bundleId={selectedSummary.bundleId} canonicalAppId={selectedSummary.canonicalAppId} size={38} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <InlineRevealText
                        text={formatDisplayAppName(selectedSummary.appName)}
                        style={{ fontSize: 27, fontWeight: 780, letterSpacing: '-0.03em', color: 'var(--color-text-primary)' }}
                      />
                      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                        {categoryLabel(selectedSummary.category)} · {selectedRangeLabel}
                      </div>
                    </div>
                    {narrativeSupported && (!narrative || !dateMode || isAppsToday) && (
                      <button
                        type="button"
                        disabled={isUserGenerating}
                        onClick={() => { void handleGenerateAppNarrative() }}
                        style={{
                          padding: '7px 10px',
                          borderRadius: 8,
                          border: '1px solid var(--color-border-ghost)',
                          background: 'var(--color-surface-low)',
                          color: 'var(--color-text-secondary)',
                          fontSize: 11.5,
                          fontWeight: 700,
                          cursor: isUserGenerating ? 'default' : 'pointer',
                          opacity: isUserGenerating ? 0.6 : 1,
                        }}
                      >
                        {isUserGenerating ? 'Generating…' : narrative ? 'Refresh' : 'Generate'}
                      </button>
                    )}
                  </div>
                  <>
                    <p style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--color-text-secondary)', margin: '14px 0 0' }}>
                      {appMetricSentence(selectedSummary.totalSeconds, selectedSummary.sessionCount)} {narrative?.summary || (detail ? detailSummary(detail, formatDisplayAppName(selectedSummary.appName)) : 'Loading app context…')}
                    </p>
                    {deleteActivityError && (
                      <div style={{ fontSize: 11.5, color: '#f87171', marginTop: 10 }}>
                        Could not delete activity: {deleteActivityError}
                      </div>
                    )}
                    {isUserGenerating && (
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 10 }}>
                        Generating a stronger app narrative…
                      </div>
                    )}
                    {!isUserGenerating && currentGenerationStatus?.kind === 'thin' && (
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 10 }}>
                        Daylens has only thin signal for this app right now — try again after more activity.
                      </div>
                    )}
                    {!isUserGenerating && currentGenerationStatus?.kind === 'no-bundle' && (
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 10 }}>
                        No recent activity for this app in the selected range.
                      </div>
                    )}
                    {!isUserGenerating && currentGenerationStatus?.kind === 'error' && (
                      <div style={{ fontSize: 11.5, color: '#f87171', marginTop: 10 }}>
                        Could not generate narrative: {currentGenerationStatus.message}
                      </div>
                    )}
                    {narrative?.stale && (
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 10 }}>
                        Showing the last saved narrative while new activity settles.
                      </div>
                    )}
                  </>
                  {/* B12: minute totals are secondary metadata, not headline. */}
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 14, letterSpacing: '0.02em' }}>
                    {formatDuration(selectedSummary.totalSeconds)}
                    {selectedSummary.sessionCount ? ` · ${selectedSummary.sessionCount} session${selectedSummary.sessionCount === 1 ? '' : 's'}` : ''}
                  </div>
                </div>

                {detailResource.error && (
                  <div style={{ color: '#f87171', fontSize: 13 }}>
                    Could not load app detail: {detailResource.error}
                  </div>
                )}

                {!detail && !detailResource.error && (
                  <div style={{ display: 'grid', gap: 10 }} aria-label="Loading app detail">
                    {[80, 64, 72].map((w) => (
                      <div
                        key={w}
                        style={{
                          height: 56,
                          borderRadius: 14,
                          background: 'var(--color-surface)',
                          border: '1px solid var(--color-border-ghost)',
                          opacity: 0.55,
                          width: `${w}%`,
                        }}
                      />
                    ))}
                  </div>
                )}

                {detail && (() => {
                  // Backend `labelMatchesSelectedApp` already removes blocks whose
                  // label is just the app name. Re-filtering here was eating valid
                  // page-titled blocks for browser apps (Safari surfaced empty).
                  const filteredAppearances = detail.blockAppearances
                  const fileArtifacts = detail.topArtifacts.filter((a) => a.artifactType !== 'page')
                  // F6: prefer the memory-pattern rollup when at least one row
                  // collapses 2+ sessions under a learned pattern. For an Apps
                  // view that previously listed 14 near-identical "Daylens
                  // development" rows, this surfaces a single row with
                  // "Daylens development × 14 sessions" instead.
                  const rollups = detail.blockMemoryRollups ?? []
                  const useRollup = rollups.some((row) => row.patternId && row.sessionCount >= 2)
                  return (
                    <>
                      {useRollup && rollups.length > 0 && (
                        <section style={{ borderRadius: 18, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', padding: '18px 20px' }}>
                          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 12 }}>
                            What you did there
                          </div>
                          <div style={{ display: 'grid', gap: 8 }}>
                            {rollups.slice(0, 10).map((row) => (
                              <button
                                key={`${row.patternId ?? row.sampleBlockIds[0]}`}
                                type="button"
                                onClick={() => { window.location.hash = `#/timeline?view=day&date=${localDateKey(row.earliestStart)}` }}
                                style={{
                                  width: '100%',
                                  border: '1px solid var(--color-border-ghost)',
                                  background: 'var(--color-surface-low)',
                                  borderRadius: 12,
                                  padding: '10px 14px',
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                }}
                              >
                                <div style={{ fontSize: 13.5, fontWeight: 620, color: 'var(--color-text-primary)' }}>
                                  {row.patternLabel}
                                  {row.sessionCount > 1 && (
                                    <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>
                                      {' '}× {row.sessionCount} sessions
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 3 }}>
                                  {formatDuration(row.totalSeconds)}
                                  {row.sessionCount === 1 ? ` · ${formatBlockRange(row.earliestStart, row.latestEnd)}` : ''}
                                </div>
                              </button>
                            ))}
                          </div>
                        </section>
                      )}
                      {!useRollup && filteredAppearances.length > 0 && (
                        <section style={{ borderRadius: 18, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', padding: '18px 20px' }}>
                          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 12 }}>
                            What you did there
                          </div>
                          <div style={{ display: 'grid', gap: 8 }}>
                            {filteredAppearances.slice(0, 10).map((block) => (
                              <button
                                key={block.blockId}
                                type="button"
                                onClick={() => { window.location.hash = `#/timeline?view=day&date=${localDateKey(block.startTime)}` }}
                                style={{
                                  width: '100%',
                                  border: '1px solid var(--color-border-ghost)',
                                  background: 'var(--color-surface-low)',
                                  borderRadius: 12,
                                  padding: '10px 14px',
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                }}
                              >
                                <div style={{ fontSize: 13.5, fontWeight: 620, color: 'var(--color-text-primary)' }}>
                                  {block.label}
                                </div>
                                <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 3 }}>
                                  {formatBlockRange(block.startTime, block.endTime)}
                                </div>
                              </button>
                            ))}
                          </div>
                        </section>
                      )}

                      {fileArtifacts.length > 0 && (
                        <section style={{ borderRadius: 18, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', padding: '18px 20px' }}>
                          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 12 }}>
                            Files & documents
                          </div>
                          <div style={{ display: 'grid', gap: 12 }}>
                            {fileArtifacts.slice(0, 8).map((artifact) => (
                              <button
                                key={artifact.id}
                                type="button"
                                onClick={() => void openArtifact(artifact)}
                                disabled={artifact.openTarget.kind === 'unsupported' || !artifact.openTarget.value}
                                style={{
                                  display: 'flex',
                                  alignItems: 'start',
                                  gap: 10,
                                  width: '100%',
                                  padding: 0,
                                  border: 'none',
                                  background: 'transparent',
                                  textAlign: 'left',
                                  cursor: artifact.openTarget.kind === 'unsupported' || !artifact.openTarget.value ? 'default' : 'pointer',
                                }}
                              >
                                <EntityIcon
                                  artifactType={artifact.artifactType}
                                  canonicalAppId={artifact.canonicalAppId}
                                  ownerBundleId={artifact.ownerBundleId}
                                  ownerAppName={artifact.ownerAppName}
                                  ownerAppInstanceId={artifact.ownerAppInstanceId}
                                  title={artifact.displayTitle}
                                  path={artifact.path}
                                  domain={artifact.host}
                                  url={artifact.url}
                                  size={28}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <InlineRevealText
                                    text={artifact.displayTitle}
                                    style={{ fontSize: 13.5, fontWeight: 620, color: 'var(--color-text-primary)' }}
                                  />
                                  <InlineRevealText
                                    text={artifact.subtitle || artifact.host || artifact.path || artifact.artifactType}
                                    style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}
                                  />
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                                  {formatDuration(artifact.totalSeconds)}
                                </div>
                              </button>
                            ))}
                          </div>
                        </section>
                      )}

                      {detail.topDomains && detail.topDomains.length > 0 && (() => {
                        const renderDomainRow = (entry: NonNullable<AppDetailPayload['topDomains']>[number]) => (
                          <div
                            key={entry.domain}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                            }}
                          >
                            <EntityIcon
                              artifactType="page"
                              domain={entry.domain}
                              size={26}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <InlineRevealText
                                text={entry.domain}
                                style={{ fontSize: 13, fontWeight: 620, color: 'var(--color-text-primary)' }}
                              />
                              <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                {entry.visitCount} visit{entry.visitCount === 1 ? '' : 's'}
                                {entry.topTitle ? ` · ${entry.topTitle.slice(0, 60)}` : ''}
                              </div>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                              {formatDuration(entry.totalSeconds)}
                            </div>
                            <DeleteIconButton
                              label={`Delete activity for ${entry.domain}`}
                              busy={deletingActivityKey === `domain:${entry.domain}`}
                              onClick={() => { void handleDeleteWebsiteActivity({ domain: entry.domain, title: entry.domain }) }}
                            />
                          </div>
                        )
                        const { work, leisure } = splitWorkFirst((detail.topDomains ?? []).slice(0, 8), (d) => d.domain)
                        // When everything is leisure (a pure-streaming browser),
                        // show it plainly under the main header rather than an
                        // empty "work" list with everything pushed to the side.
                        const mainRows = work.length > 0 ? work : leisure
                        const sideRows = work.length > 0 ? leisure : []
                        return (
                          <section style={{ borderRadius: 18, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', padding: '18px 20px' }}>
                            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 12 }}>
                              Time by domain
                            </div>
                            <div style={{ display: 'grid', gap: 10 }}>
                              {mainRows.map(renderDomainRow)}
                            </div>
                            {sideRows.length > 0 && (
                              <>
                                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', margin: '18px 0 12px' }}>
                                  Off to the side
                                </div>
                                <div style={{ display: 'grid', gap: 10, opacity: 0.72 }}>
                                  {sideRows.map(renderDomainRow)}
                                </div>
                              </>
                            )}
                          </section>
                        )
                      })()}

                      {detail.topPages.length > 0 && (() => {
                        const renderPageRow = (page: AppDetailPayload['topPages'][number]) => (
                          <div
                            key={page.id}
                            style={{
                              display: 'flex',
                              alignItems: 'start',
                              gap: 10,
                              width: '100%',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => void openArtifact(page)}
                              disabled={page.openTarget.kind === 'unsupported' || !page.openTarget.value}
                              style={{
                                display: 'flex',
                                alignItems: 'start',
                                gap: 10,
                                flex: 1,
                                minWidth: 0,
                                padding: 0,
                                border: 'none',
                                background: 'transparent',
                                textAlign: 'left',
                                cursor: page.openTarget.kind === 'unsupported' || !page.openTarget.value ? 'default' : 'pointer',
                              }}
                            >
                              <EntityIcon
                                artifactType="page"
                                domain={page.domain}
                                url={page.url}
                                size={28}
                              />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <InlineRevealText
                                  text={page.displayTitle}
                                  style={{ fontSize: 13.5, fontWeight: 620, color: 'var(--color-text-primary)' }}
                                />
                                <InlineRevealText
                                  text={page.domain}
                                  style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}
                                />
                              </div>
                            </button>
                            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                              {formatDuration(page.totalSeconds)}
                            </div>
                            <DeleteIconButton
                              label={`Delete activity for ${page.displayTitle}`}
                              busy={deletingActivityKey === (page.url ? `url:${page.url}` : `domain:${page.domain}`)}
                              onClick={() => { void handleDeleteWebsiteActivity({ domain: page.domain, url: page.url, title: page.displayTitle }) }}
                            />
                          </div>
                        )
                        const { work, leisure } = splitWorkFirst(detail.topPages.slice(0, 8), (p) => p.domain)
                        const mainRows = work.length > 0 ? work : leisure
                        const sideRows = work.length > 0 ? leisure : []
                        return (
                          <section style={{ borderRadius: 18, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', padding: '18px 20px' }}>
                            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 12 }}>
                              Pages visited
                            </div>
                            <div style={{ display: 'grid', gap: 12 }}>
                              {mainRows.map(renderPageRow)}
                            </div>
                            {sideRows.length > 0 && (
                              <>
                                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', margin: '18px 0 12px' }}>
                                  Off to the side
                                </div>
                                <div style={{ display: 'grid', gap: 12, opacity: 0.72 }}>
                                  {sideRows.map(renderPageRow)}
                                </div>
                              </>
                            )}
                          </section>
                        )
                      })()}

                      {/* Spec 4.5 / invariant 8: "Often used with" is removed
                          entirely — it surfaced system noise (Siri, Finder,
                          UserNotificationCenter) as co-used apps and added no
                          value. The pairedApps payload is left intact upstream
                          but is never rendered here. */}
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
