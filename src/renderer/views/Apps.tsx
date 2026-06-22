import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { ANALYTICS_EVENT, trackedTimeBucket } from '@shared/analytics'
import { ALL_TIME_DAYS } from '@shared/types'
import type { AISurfaceSummary, AppCategory, AppDetailPayload, AppUsageSummary, LiveSession } from '@shared/types'
import { kindForDomain } from '@shared/workKind'
import EntityIcon from '../components/EntityIcon'
import InlineRevealText from '../components/InlineRevealText'
import { useProjectionResource } from '../hooks/useProjectionResource'
import { track } from '../lib/analytics'
import { ipc } from '../lib/ipc'
import { formatDisplayAppName } from '../lib/apps'
import { formatDuration, todayString } from '../lib/format'
import { openArtifact } from '../lib/openTarget'

const DAYS_OPTIONS = [1, 7, 30, ALL_TIME_DAYS] as const

// Stable work-first ordering: leisure (streaming/social) domains sink below the
// rest while each group keeps its incoming duration order. Mirrors the recap's
// ordering so the view and the AI agree (spec invariant 8).
function partitionWorkFirst<T>(rows: T[], domain: (row: T) => string | null | undefined): { work: T[]; leisure: T[] } {
  const work: T[] = []
  const leisure: T[] = []
  for (const row of rows) {
    if (kindForDomain(domain(row)) === 'leisure') leisure.push(row)
    else work.push(row)
  }
  return { work, leisure }
}

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

function liveAwareSummaries(
  summaries: AppUsageSummary[],
  live: LiveSession | null,
  days: number,
): AppUsageSummary[] {
  if (!live) return summaries

  const end = Date.now()
  const today = new Date()
  const rangeStart = days >= ALL_TIME_DAYS
    ? 0
    : new Date(today.getFullYear(), today.getMonth(), today.getDate() - Math.max(0, days - 1)).getTime()
  const liveStart = Math.max(live.startTime, rangeStart)
  const seconds = Math.max(0, Math.round((end - liveStart) / 1000))

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
      canonicalAppId: live.canonicalAppId ?? live.bundleId,
      appName: live.appName,
      category: live.category,
      totalSeconds: seconds,
      isFocused: ['development', 'research', 'writing', 'aiTools', 'design', 'productivity'].includes(live.category),
      sessionCount: 1,
    },
  ].sort((left, right) => right.totalSeconds - left.totalSeconds)
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
      const [summaries, live] = await Promise.all([summariesP, liveP])
      return {
        summaries: summaries as AppUsageSummary[],
        live: live as LiveSession | null,
      }
    },
  })

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

  // Preserve the backend's most-used-first ordering. Low-signal entries sit
  // below a fold, but primary apps are never regrouped in a way that lets a
  // lower-usage category jump ahead of a more-used app.
  const { primary, fleeting } = useMemo(() => {
    const primary: AppUsageSummary[] = []
    const fleeting: AppUsageSummary[] = []
    for (const summary of filteredSummaries) {
      const isFleeting = summary.totalSeconds < 120 || (summary.sessionCount ?? 1) <= 1 && summary.totalSeconds < 5 * 60
      if (isFleeting && !selectedCategory) {
        fleeting.push(summary)
        continue
      }
      primary.push(summary)
    }
    return { primary, fleeting }
  }, [filteredSummaries, selectedCategory])

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
    load: () => ipc.ai.getAppNarrative(
      selectedCanonicalId as string,
      isAppsPastDay ? selectedDate : days,
      false,
    ).catch(() => null),
  })

  const expectedRangeKey = isAppsPastDay
    ? `1d:${selectedDate}`
    : `${days}d:${todayString()}`
  const selectedRangeLabel = dateMode
    ? (isAppsToday ? 'today' : formatAppsDateLabel(selectedDate))
    : (days >= ALL_TIME_DAYS ? 'all time' : `last ${days} days`)
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
    const requestRange = isAppsPastDay ? selectedDate : days
    console.info(`[apps-narrative] generating for ${scopeKey} (range=${requestRange})`)
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
      const result = await ipc.ai.getAppNarrative(selectedCanonicalId, requestRange, true)
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

  const handleDeleteWebsiteActivity = async (target: {
    domain: string
    url?: string | null
    normalizedUrl?: string | null
    pageKey?: string | null
    title?: string | null
  }) => {
    const label = target.title?.trim() || target.domain
    const isPage = Boolean(target.url || target.normalizedUrl || target.pageKey)
    const targetKind = isPage ? 'page' : 'domain'
    const confirmed = window.confirm(
      `Permanently delete this ${targetKind} from all Daylens history?\n\n${label}\n\nThis cannot be undone. Any recap built from it will be cleared.`,
    )
    if (!confirmed) return

    const key = isPage
      ? `url:${target.normalizedUrl ?? target.url ?? target.pageKey}`
      : `domain:${target.domain}`
    setDeletingActivityKey(key)
    setDeleteActivityError(null)
    try {
      if (isPage) {
        await ipc.tracking.deleteActivity({
          url: target.url,
          normalizedUrl: target.normalizedUrl,
          pageKey: target.pageKey,
        })
      } else {
        await ipc.tracking.deleteSiteHistory({ domain: target.domain })
      }
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
                : (days >= ALL_TIME_DAYS ? 'All time' : `Last ${days} days`)}
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
                  type="button"
                  aria-pressed={(dateMode && option === 1) || (!dateMode && days === option)}
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
                  {option === 1 ? 'Day' : option >= ALL_TIME_DAYS ? 'All' : `${option}d`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {categories.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              aria-pressed={selectedCategory === null}
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
                type="button"
                aria-pressed={selectedCategory === category}
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
              {primary.map((summary) => {
                const key = summary.canonicalAppId ?? summary.bundleId
                const selected = key === selectedAppId
                const appName = formatDisplayAppName(summary.appName)
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={selected}
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
                          {categoryLabel(summary.category)} · {formatDuration(summary.totalSeconds)}
                          {summary.sessionCount ? ` · ${summary.sessionCount} session${summary.sessionCount === 1 ? '' : 's'}` : ''}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}

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
                          type="button"
                          aria-pressed={selected}
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
                  </div>
                  <>
                    {/* Deterministic metric always; the AI recap is appended only
                        after Generate (spec 4.3) — the real detail lives in the
                        sections below and never waits on AI. */}
                    <p style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--color-text-secondary)', margin: '14px 0 0' }}>
                      {appMetricSentence(selectedSummary.totalSeconds, selectedSummary.sessionCount)}
                      {narrative?.summary ? ` ${narrative.summary}` : ''}
                    </p>
                    {!narrative && !isUserGenerating && !currentGenerationStatus && (
                      <p style={{ fontSize: 11.5, lineHeight: 1.6, color: 'var(--color-text-tertiary)', margin: '8px 0 0' }}>
                        The sites and pages below are computed from your activity. Press Generate for a written recap.
                      </p>
                    )}
                    {deleteActivityError && (
                      <div style={{ fontSize: 11.5, color: '#f87171', marginTop: 10 }}>
                        Could not delete activity: {deleteActivityError}
                      </div>
                    )}
                    {isUserGenerating && (
                      <div aria-live="polite" style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 10 }}>
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

                  // Work surfaces first (spec invariant 8): split domains and
                  // pages into a primary work list and a quieter "Off to the
                  // side" group for streaming/social. Each group keeps its
                  // duration order; nothing is hidden, only deprioritized.
                  const domainSplit = partitionWorkFirst(detail.topDomains ?? [], (d) => d.domain)
                  const pageSplit = partitionWorkFirst(detail.topPages, (p) => p.domain)

                  const offToTheSideSubhead = (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 10px', color: 'var(--color-text-tertiary)' }}>
                      <div style={{ flex: 1, height: 1, background: 'var(--color-border-ghost)' }} />
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Off to the side</span>
                      <div style={{ flex: 1, height: 1, background: 'var(--color-border-ghost)' }} />
                    </div>
                  )

                  const renderDomainRow = (entry: NonNullable<AppDetailPayload['topDomains']>[number]) => (
                    <div key={entry.domain} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <EntityIcon artifactType="page" domain={entry.domain} size={26} />
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

                  const renderPageRow = (page: AppDetailPayload['topPages'][number]) => (
                    <div key={page.id} style={{ display: 'flex', alignItems: 'start', gap: 10, width: '100%' }}>
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
                        <EntityIcon artifactType="page" domain={page.domain} url={page.url} size={28} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <InlineRevealText
                            text={page.displayTitle}
                            style={{ fontSize: 13.5, fontWeight: 620, color: 'var(--color-text-primary)' }}
                          />
                          <InlineRevealText
                            text={page.domain}
                            style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}
                          />
                          <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                            {page.visitCount ?? 1} visit{(page.visitCount ?? 1) === 1 ? '' : 's'}
                          </div>
                        </div>
                      </button>
                      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                        {formatDuration(page.totalSeconds)}
                      </div>
                      <DeleteIconButton
                        label={`Delete activity for ${page.displayTitle}`}
                        busy={deletingActivityKey === (
                          page.url || page.normalizedUrl || page.pageKey
                            ? `url:${page.normalizedUrl ?? page.url ?? page.pageKey}`
                            : `domain:${page.domain}`
                        )}
                        onClick={() => {
                          void handleDeleteWebsiteActivity({
                            domain: page.domain,
                            url: page.url,
                            normalizedUrl: page.normalizedUrl,
                            pageKey: page.pageKey,
                            title: page.displayTitle,
                          })
                        }}
                      />
                    </div>
                  )

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

                      {(domainSplit.work.length > 0 || domainSplit.leisure.length > 0) && (
                        <section style={{ borderRadius: 18, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', padding: '18px 20px' }}>
                          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 12 }}>
                            Time by domain
                          </div>
                          <div style={{ display: 'grid', gap: 10 }}>
                            {domainSplit.work.map(renderDomainRow)}
                          </div>
                          {domainSplit.leisure.length > 0 && (
                            <>
                              {domainSplit.work.length > 0 && offToTheSideSubhead}
                              <div style={{ display: 'grid', gap: 10 }}>
                                {domainSplit.leisure.map(renderDomainRow)}
                              </div>
                            </>
                          )}
                        </section>
                      )}

                      {(pageSplit.work.length > 0 || pageSplit.leisure.length > 0) && (
                        <section style={{ borderRadius: 18, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', padding: '18px 20px' }}>
                          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 12 }}>
                            Pages visited
                          </div>
                          <div style={{ display: 'grid', gap: 12 }}>
                            {pageSplit.work.map(renderPageRow)}
                          </div>
                          {pageSplit.leisure.length > 0 && (
                            <>
                              {pageSplit.work.length > 0 && offToTheSideSubhead}
                              <div style={{ display: 'grid', gap: 12 }}>
                                {pageSplit.leisure.map(renderPageRow)}
                              </div>
                            </>
                          )}
                        </section>
                      )}
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
