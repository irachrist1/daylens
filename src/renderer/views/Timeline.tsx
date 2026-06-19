import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { ANALYTICS_EVENT, blockCountBucket, trackedTimeBucket } from '@shared/analytics'
import type { AIDaySummaryResult, AppCategory, DayTimelinePayload, TimelineGapSegment, TimelineSegment, WorkContextBlock } from '@shared/types'
import { blockActiveSeconds, blockDisplayedActiveSeconds } from '@shared/blockDuration'
import { isArtifactCompatibleWithBlockCategory, naturalizeLabel, userVisibleBlockLabel } from '@shared/blockLabel'
import { isTrustedTimelineBlock } from '@shared/timelineReview'
import { effectiveBlockKind } from '@shared/workKind'
import AppIcon from '../components/AppIcon'
import EntityIcon from '../components/EntityIcon'
import InlineRevealText from '../components/InlineRevealText'
import { useProjectionResource } from '../hooks/useProjectionResource'
import { track } from '../lib/analytics'
import { ipc } from '../lib/ipc'
import { sanitizeIpcError } from '../lib/ipcError'
import { formatDisplayAppName } from '../lib/apps'
import { formatDuration, formatFullDate, todayString } from '../lib/format'
import { openArtifact } from '../lib/openTarget'
import { sanitizeForModel } from '@shared/aiSanitize'

const SYSTEM_NOISE_TOKENS = [
  'loginwindow',
  'usernotificationcenter',
  'notificationcenter',
  'finder',
  'screensaver',
  'screen saver',
  'windowserver',
  'systemuiserver',
  'electron helper',
  'com.daylens',
]

function isSystemNoiseApp(app: Pick<WorkContextBlock['topApps'][number], 'appName' | 'bundleId' | 'category'>): boolean {
  if (app.category === 'system') return true
  const identity = `${app.bundleId} ${app.appName}`.toLowerCase()
  return SYSTEM_NOISE_TOKENS.some((token) => identity.includes(token))
}

// Strip raw URL query/fragment + secret-shaped tokens from any free-text the
// timeline displays. The renderer used to print page artifact displayTitles
// verbatim, so an OAuth callback URL stored as the artifact title leaked the
// `?code=…` straight into the block card.
function safeTimelineText(text: string): string {
  return sanitizeForModel(text)
}

function normalizedTimelineLabel(value: string): string {
  return naturalizeLabel(value)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function timelineBlockLabel(block: WorkContextBlock): string {
  const label = userVisibleBlockLabel(block)
  if (block.label.override?.trim()) return label
  if (/^(leisure activity|browsing|web session)$/i.test(label)) {
    if (block.dominantCategory === 'entertainment') return 'Watching entertainment'
    if (block.dominantCategory === 'social') return 'Social browsing'
    return 'Web browsing'
  }

  const normalized = normalizedTimelineLabel(label)
  const rawEvidence = [
    ...block.topApps.flatMap((app) => [app.appName, app.bundleId]),
    ...block.websites.flatMap((site) => [
      site.domain,
      site.domain.replace(/^www\./i, '').split('.')[0] ?? '',
      site.topTitle ?? '',
    ]),
    ...block.pageRefs.flatMap((page) => [
      page.pageTitle ?? '',
      page.displayTitle,
      page.domain ?? '',
      page.host ?? '',
    ]),
    ...block.topArtifacts.map((artifact) => artifact.displayTitle),
  ]
    .map(normalizedTimelineLabel)
    .filter(Boolean)

  if (!rawEvidence.includes(normalized)) return label

  switch (block.dominantCategory) {
    case 'development': return 'Software development'
    case 'research':
    case 'aiTools': return 'Research and analysis'
    case 'writing': return 'Writing'
    case 'design': return 'Design work'
    case 'meetings': return 'Meeting'
    case 'communication':
    case 'email': return 'Communication'
    case 'productivity': return 'Planning and administration'
    case 'browsing': return 'Web research'
    case 'social': return 'Social browsing'
    case 'entertainment': return 'Watching video content'
    default: return 'Computer activity'
  }
}

const CATEGORY_COLORS: Record<AppCategory, string> = {
  development: '#5b8cff',
  communication: '#f97316',
  research: '#7c5cff',
  writing: '#a855f7',
  aiTools: '#c084fc',
  design: '#ec4899',
  browsing: '#fb923c',
  meetings: '#14b8a6',
  entertainment: '#f59e0b',
  email: '#38bdf8',
  productivity: '#6366f1',
  social: '#f43f5e',
  system: '#94a3b8',
  uncategorized: '#94a3b8',
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const next = new Date(y, m - 1, d + days)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
}

function getWeekStart(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const next = new Date(y, m - 1, d)
  const day = next.getDay()
  const diff = day === 0 ? -6 : 1 - day
  next.setDate(next.getDate() + diff)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
}

function weekRangeLabel(dateStr: string): string {
  const start = getWeekStart(dateStr)
  const end = shiftDate(start, 6)
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const startLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(sy, sm - 1, sd))
  const endLabel = sm === em
    ? String(ed)
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(ey, em - 1, ed))
  return `${startLabel}–${endLabel}`
}

function formatClockTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)
}

function blockDurationSeconds(block: WorkContextBlock): number {
  return blockActiveSeconds(block)
}

function segmentDurationSeconds(segment: TimelineSegment): number {
  return Math.max(1, Math.round((segment.endTime - segment.startTime) / 1000))
}

function categoryLabel(category: AppCategory): string {
  if (category === 'aiTools') return 'AI tools'
  return category
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function boundaryButtonStyle(disabled: boolean): CSSProperties {
  return {
    height: 30,
    padding: '0 10px',
    borderRadius: 8,
    border: '1px solid var(--color-border-ghost)',
    background: 'var(--color-surface)',
    color: 'var(--color-text-secondary)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  }
}

function shortDomainLabel(domain: string): string {
  return domain.replace(/^www\./i, '')
}

function artifactSubtitle(block: WorkContextBlock): string | null {
  const titles = block.topArtifacts
    .filter((artifact) => isArtifactCompatibleWithBlockCategory(artifact, block.dominantCategory))
    .slice(0, 3)
    .map((artifact) => safeTimelineText(artifact.displayTitle.trim()))
    .filter(Boolean)

  if (titles.length > 0) return titles.join(' • ')

  const domains = block.websites
    .slice(0, 3)
    .map((site) => shortDomainLabel(site.domain))
    .filter(Boolean)

  return domains.length > 0 ? domains.join(' • ') : null
}

// Short deterministic summary used when the AI narrative hasn't landed yet, so
// every block on the timeline reads consistently instead of some having prose
// and others showing nothing between the title and the app icons.
//
// The duration in this prose summary is the block's *active tracked* time, not
// its wall-clock span. A block that bridges an untracked lull has a span far
// larger than what was logged inside it; saying "Spent 1h 57m watching …" for a
// window that only logged 1h 4m overstates the day (R4). blockActiveSeconds
// (summed session time clamped to span) is the honest figure used everywhere
// this renderer displays time.
function blockShortSummary(block: WorkContextBlock): string {
  const duration = formatDuration(blockActiveSeconds(block))
  const label = timelineBlockLabel(block).trim()
  const naturalized = label.charAt(0).toLowerCase() + label.slice(1)
  const startsWithActivityVerb = /^(?:attending|authorizing|building|checking|completing|configuring|creating|developing|discussing|drafting|evaluating|generating|managing|planning|preparing|reading|researching|reviewing|streaming|taking|testing|watching|working|writing)\b/i.test(label)
  return startsWithActivityVerb
    ? `Spent ${duration} ${naturalized}.`
    : `Spent ${duration} on ${naturalized}.`
}

function gapKindLabel(kind: TimelineGapSegment['kind']): string {
  if (kind === 'machine_off') return 'Machine off'
  if (kind === 'away') return 'Away'
  return 'Untracked gap'
}

type DisplayTimelineSegment = TimelineSegment | {
  kind: 'gap_group'
  startTime: number
  endTime: number
  items: TimelineGapSegment[]
}

const MIN_VISIBLE_GAP_SECONDS = 15 * 60
const LONG_GAP_ANCHOR_SECONDS = 75 * 60

function compressTimelineSegments(segments: TimelineSegment[]): DisplayTimelineSegment[] {
  const compressed: DisplayTimelineSegment[] = []
  let gapCluster: TimelineGapSegment[] = []

  const flushGapCluster = () => {
    if (gapCluster.length === 0) return

    if (gapCluster.length >= 2) {
      compressed.push({
        kind: 'gap_group',
        startTime: gapCluster[0].startTime,
        endTime: gapCluster[gapCluster.length - 1].endTime,
        items: gapCluster,
      })
    } else {
      compressed.push(...gapCluster)
    }

    gapCluster = []
  }

  for (const segment of segments) {
    if (segment.kind === 'work_block') {
      flushGapCluster()
      compressed.push(segment)
      continue
    }

    const gapSeconds = segmentDurationSeconds(segment)
    if (gapSeconds < MIN_VISIBLE_GAP_SECONDS) continue

    if (gapSeconds >= LONG_GAP_ANCHOR_SECONDS) {
      flushGapCluster()
      compressed.push(segment)
      continue
    }

    gapCluster.push(segment)
  }

  flushGapCluster()
  return compressed
}

interface TimelineNavState {
  view: 'day' | 'week'
  date: string
}

function timelineNavStateFromParams(searchParams: URLSearchParams): TimelineNavState {
  return {
    view: searchParams.get('view') === 'week' ? 'week' : 'day',
    date: searchParams.get('date') ?? todayString(),
  }
}

function IconChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="m10 3.5-4.5 4.5 4.5 4.5" />
    </svg>
  )
}

function IconChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  )
}

function visibleBlocks(blocks: WorkContextBlock[]): WorkContextBlock[] {
  return blocks.filter((block) => isTrustedTimelineBlock(block) && blockActiveSeconds(block) >= 60)
}

function visibleBlockTotal(blocks: WorkContextBlock[]): number {
  return blocks.reduce((sum, block) => sum + blockDisplayedActiveSeconds(block), 0)
}

function visibleAppCount(blocks: WorkContextBlock[]): number {
  return new Set(
    blocks.flatMap((block) =>
      block.topApps
        .filter((app) => !isSystemNoiseApp(app))
        .map((app) => app.bundleId || app.appName.toLowerCase()),
    ),
  ).size
}

function blockCardHeight(block: WorkContextBlock): number {
  const hours = blockActiveSeconds(block) / 3600
  return Math.max(120, Math.round(hours * 120))
}

const TimelineRow = memo(function TimelineRow({
  segment,
  block,
  isSelected,
}: {
  segment: TimelineSegment
  block: WorkContextBlock | null
  isSelected: boolean
}) {
  if (!block) {
    const gapSegment = segment as TimelineGapSegment
    const duration = formatDuration(segmentDurationSeconds(segment))

    return (
      <div style={{ display: 'grid', gridTemplateColumns: '104px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{formatClockTime(gapSegment.startTime)}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{duration}</div>
        </div>
        <div style={{
          borderTop: '1px solid var(--color-border-ghost)',
          paddingTop: 10,
          paddingBottom: 10,
          color: 'var(--color-text-tertiary)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span style={{ fontSize: 12 }}>{gapKindLabel(gapSegment.kind)}</span>
          <span style={{ fontSize: 11 }}>{duration}</span>
        </div>
      </div>
    )
  }

  const accent = CATEGORY_COLORS[block.dominantCategory] ?? CATEGORY_COLORS.uncategorized
  const ignored = block.review.state === 'ignored'
  // Leisure / personal rows are muted so the eye finds work first. Work is
  // full-strength; everything else recedes. This is the whole point of the
  // `kind` axis on the surface.
  const blockKind = effectiveBlockKind(block)
  const muted = blockKind !== 'work'
  const artifactLine = artifactSubtitle(block)
  const duration = formatDuration(blockDurationSeconds(block))
  const height = blockCardHeight(block)

  return (
    <button
      type="button"
      data-timeline-block-id={block.id}
      style={{
        display: 'grid',
        gridTemplateColumns: '104px minmax(0, 1fr)',
        gap: 16,
        alignItems: 'start',
        width: '100%',
        border: 'none',
        background: 'transparent',
        padding: 0,
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <div style={{ paddingTop: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)' }}>{formatClockTime(block.startTime)}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          {duration}
        </div>
      </div>
      <div style={{
        position: 'relative',
        height,
        padding: '14px 16px 14px 18px',
        borderRadius: 16,
        border: isSelected ? `1px solid ${accent}55` : '1px solid var(--color-border-ghost)',
        background: isSelected ? 'var(--color-surface-low)' : 'var(--color-surface)',
        boxShadow: isSelected ? '0 10px 30px rgba(0,0,0,0.10)' : 'none',
        transition: 'border-color 120ms, background 120ms',
        overflow: 'hidden',
        minWidth: 0,
        opacity: ignored ? 0.5 : muted ? 0.72 : 1,
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          position: 'absolute',
          left: 0,
          top: 12,
          bottom: 12,
          width: 3,
          borderRadius: 999,
          background: accent,
        }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <InlineRevealText
              text={timelineBlockLabel(block)}
              style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.25 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: accent,
              background: `${accent}18`,
              borderRadius: 999,
              padding: '3px 7px',
            }}>
              {categoryLabel(block.dominantCategory)}
            </span>
            {block.isLive && (
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: '#22c55e',
              }}>
                Live
              </span>
            )}
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
          {formatClockTime(block.startTime)} – {formatClockTime(block.endTime)}
        </div>
        <p style={{
          fontSize: 13.5,
          lineHeight: 1.5,
          color: 'var(--color-text-secondary)',
          margin: 0,
          overflowWrap: 'break-word',
          minWidth: 0,
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: height >= 220 ? 5 : 2,
          overflow: 'hidden',
        }}>
          {blockShortSummary(block)}
        </p>
        {isSelected && artifactLine && height >= 180 && (
          <InlineRevealText
            text={artifactLine}
            style={{ fontSize: 12.5, color: 'var(--color-text-primary)', marginTop: 10 }}
          />
        )}
      </div>
    </button>
  )
})

function GapGroupRow({ segment }: { segment: Extract<DisplayTimelineSegment, { kind: 'gap_group' }> }) {
  const duration = formatDuration(Math.max(1, Math.round((segment.endTime - segment.startTime) / 1000)))
  const totals = segment.items.reduce<Map<TimelineGapSegment['kind'], number>>((map, item) => {
    map.set(item.kind, (map.get(item.kind) ?? 0) + segmentDurationSeconds(item))
    return map
  }, new Map())

  const chips = (['machine_off', 'away'] as const)
    .filter((kind) => totals.has(kind))
    .map((kind) => ({
      kind,
      label: gapKindLabel(kind),
      duration: formatDuration(totals.get(kind) ?? 0),
    }))

  if (chips.length === 0) return null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '104px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
      <div style={{ paddingTop: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{formatClockTime(segment.startTime)}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{duration}</div>
      </div>
      <div style={{
        borderTop: '1px solid var(--color-border-ghost)',
        paddingTop: 10,
        paddingBottom: 10,
        display: 'grid',
        gap: 8,
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {chips.map((chip) => (
            <span
              key={`${segment.startTime}:${chip.kind}`}
              style={{
                color: 'var(--color-text-tertiary)',
                fontSize: 12,
              }}
            >
              {chip.label} {chip.duration}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

const daySummaryRecapCache = new Map<string, AIDaySummaryResult>()

function invalidateDaySummaryRecap(date: string): void {
  daySummaryRecapCache.delete(date)
}

function DaySummaryInspector({ payload, blocks, onRefresh }: { payload: DayTimelinePayload; blocks: WorkContextBlock[]; onRefresh?: () => Promise<void> }) {
  const [recap, setRecap] = useState<AIDaySummaryResult | null>(null)
  const [recapLoading, setRecapLoading] = useState(false)
  const [recapError, setRecapError] = useState<string | null>(null)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [reanalyzeStatus, setReanalyzeStatus] = useState<string | null>(null)

  const handleAnalyzeDay = async () => {
    if (reanalyzing) return
    setReanalyzing(true)
    setReanalyzeStatus(null)
    try {
      await ipc.db.rebuildTimelineDay(payload.date)
      invalidateDaySummaryRecap(payload.date)
      setRecap(null)
      setReanalyzeStatus('Day analyzed. Blocks and labels are up to date.')
    } catch (error) {
      const { message } = sanitizeIpcError(error, "Couldn't analyze this day. Try again.")
      setReanalyzeStatus(message)
    } finally {
      await onRefresh?.().catch(() => undefined)
      setReanalyzing(false)
    }
  }

  const handleGenerateRecap = async () => {
    if (recapLoading) return
    setRecapLoading(true)
    setRecapError(null)
    try {
      const result = await ipc.ai.generateDaySummary(payload.date)
      daySummaryRecapCache.set(payload.date, result)
      setRecap(result)
    } catch (error) {
      setRecapError(sanitizeIpcError(error, "Couldn't generate the recap. Try again.").message)
    } finally {
      setRecapLoading(false)
    }
  }

  useEffect(() => {
    setReanalyzeStatus(null)
    setRecapError(null)
    const cached = daySummaryRecapCache.get(payload.date)
    if (cached) {
      setRecap(cached)
      setRecapLoading(false)
      return
    }
    setRecap(null)
    setRecapLoading(false)
  }, [payload.date])

  const totalSeconds = visibleBlockTotal(blocks)
  const appCount = visibleAppCount(blocks)

  return (
    <div style={{
      position: 'sticky',
      top: 24,
      maxHeight: 'calc(100vh - 140px)',
      overflowY: 'auto',
      scrollbarWidth: 'none',
      msOverflowStyle: 'none',
      overscrollBehavior: 'contain',
      borderRadius: 18,
      border: '1px solid var(--color-border-ghost)',
      background: 'var(--color-surface)',
      padding: 22,
      display: 'grid',
      gap: 16,
    }} className="timeline-summary-inspector">
      <div>
        <div style={{ fontSize: 18, fontWeight: 750, color: 'var(--color-text-primary)', marginBottom: 6 }}>
          Day recap
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>
          {formatFullDate(payload.date)}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <div style={{ borderRadius: 12, background: 'var(--color-surface-high)', padding: '10px 11px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Tracked</div>
          <div style={{ fontSize: 16, color: 'var(--color-text-primary)', fontWeight: 720 }}>{formatDuration(totalSeconds)}</div>
        </div>
        <div style={{ borderRadius: 12, background: 'var(--color-surface-high)', padding: '10px 11px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Blocks</div>
          <div style={{ fontSize: 16, color: 'var(--color-text-primary)', fontWeight: 720 }}>{blocks.length}</div>
        </div>
        <div style={{ borderRadius: 12, background: 'var(--color-surface-high)', padding: '10px 11px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Apps</div>
          <div style={{ fontSize: 16, color: 'var(--color-text-primary)', fontWeight: 720 }}>{appCount}</div>
        </div>
      </div>

      {totalSeconds > 0 && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              onClick={() => { void handleAnalyzeDay() }}
              disabled={reanalyzing}
              style={{
                border: '1px solid var(--color-border-ghost)',
                background: 'var(--color-surface-high)',
                color: 'var(--color-text-secondary)',
                borderRadius: 10,
                padding: '7px 12px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: reanalyzing ? 'default' : 'pointer',
                opacity: reanalyzing ? 0.6 : 1,
              }}
            >
              {reanalyzing ? 'Analyzing…' : 'Analyze Day'}
            </button>
            <button
              type="button"
              onClick={() => { void handleGenerateRecap() }}
              disabled={recapLoading}
              style={{
                border: 'none',
                background: 'var(--gradient-primary)',
                color: 'var(--color-primary-contrast)',
                borderRadius: 10,
                padding: '7px 12px',
                fontSize: 12.5,
                fontWeight: 700,
                cursor: recapLoading ? 'default' : 'pointer',
                opacity: recapLoading ? 0.6 : 1,
              }}
            >
              {recapLoading ? 'Generating…' : recap ? 'Generate Again' : 'Generate Recap'}
            </button>
          </div>
          {reanalyzeStatus && (
            <div role="status" style={{ fontSize: 11.5, color: reanalyzeStatus.startsWith("Couldn't") ? '#f87171' : 'var(--color-text-tertiary)', lineHeight: 1.4 }}>
              {reanalyzeStatus}
            </div>
          )}
          {recapError && (
            <div role="alert" style={{ fontSize: 11.5, color: '#f87171', lineHeight: 1.4 }}>
              {recapError}
            </div>
          )}
        </div>
      )}

      {recap?.summary && (
        <div style={{
          fontSize: 14,
          lineHeight: 1.65,
          color: 'var(--color-text-secondary)',
        }}>
          {recap.summary}
        </div>
      )}

      {totalSeconds === 0 && (
        <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
          Nothing tracked in visible blocks for this day.
        </div>
      )}
    </div>
  )
}

function BlockInspector({
  block,
  payload,
  blocks,
  onRefresh,
}: {
  block: WorkContextBlock | null
  payload: DayTimelinePayload
  blocks: WorkContextBlock[]
  onRefresh: () => Promise<void>
}) {
  const [overrideDraft, setOverrideDraft] = useState('')
  const [overrideSaving, setOverrideSaving] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [boundarySaving, setBoundarySaving] = useState<'merge-prev' | 'merge-next' | null>(null)
  const [boundaryError, setBoundaryError] = useState<string | null>(null)

  useEffect(() => {
    setOverrideDraft(block?.label.override ?? block?.label.current ?? '')
    setReviewError(null)
    setBoundarySaving(null)
    setBoundaryError(null)
  }, [block?.id, block?.label.current, block?.label.override])

  if (!block) {
    return <DaySummaryInspector payload={payload} blocks={blocks} onRefresh={onRefresh} />
  }

  const accent = CATEGORY_COLORS[block.dominantCategory] ?? CATEGORY_COLORS.uncategorized
  const hasOverride = Boolean(block.label.override?.trim())
  const sortedDayBlocks = [...blocks].sort((a, b) => a.startTime - b.startTime)
  const blockIndex = sortedDayBlocks.findIndex((candidate) => candidate.id === block.id)
  const previousBlock = blockIndex > 0 ? sortedDayBlocks[blockIndex - 1] : null
  const nextBlock = blockIndex >= 0 && blockIndex < sortedDayBlocks.length - 1 ? sortedDayBlocks[blockIndex + 1] : null

  const mergeBlockWith = async (other: WorkContextBlock, side: 'merge-prev' | 'merge-next') => {
    setBoundarySaving(side)
    setBoundaryError(null)
    try {
      await ipc.db.mergeTimelineEpisodes({ blockIds: [block.id, other.id], date: payload.date })
      invalidateDaySummaryRecap(payload.date)
      await onRefresh()
    } catch (error) {
      setBoundaryError(sanitizeIpcError(error, "Couldn't merge these blocks. Try again.").message)
    } finally {
      setBoundarySaving(null)
    }
  }

  return (
    <div data-timeline-inspector="true" className="timeline-summary-inspector" style={{
      position: 'sticky',
      top: 24,
      maxHeight: 'calc(100vh - 140px)',
      overflowY: 'auto',
      scrollbarWidth: 'none',
      msOverflowStyle: 'none',
      overscrollBehavior: 'contain',
      borderRadius: 18,
      border: '1px solid var(--color-border-ghost)',
      background: 'var(--color-surface)',
      padding: 22,
    }}>
      <div style={{ marginBottom: 18 }}>
        <div
          title={timelineBlockLabel(block)}
          style={{
            fontSize: 18,
            fontWeight: 750,
            color: 'var(--color-text-primary)',
            marginBottom: 6,
            lineHeight: 1.3,
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 3,
            overflow: 'hidden',
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
          }}
        >
          {timelineBlockLabel(block)}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>
          {formatClockTime(block.startTime)} – {formatClockTime(block.endTime)} • {formatDuration(blockActiveSeconds(block))}
        </div>
      </div>

      <div style={{ marginBottom: 18, display: 'grid', gap: 12, borderRadius: 12, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface-high)', padding: '12px 13px' }}>
        <div style={{ fontSize: 11.5, fontWeight: 760, color: 'var(--color-text-secondary)' }}>Corrections</div>
        <form
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
          onSubmit={(event) => {
            event.preventDefault()
            const label = overrideDraft.trim()
            if (!label || overrideSaving || label === block.label.current) return
            setOverrideSaving(true)
            setReviewError(null)
            void ipc.db.setBlockLabelOverride({ blockId: block.id, date: payload.date, label, narrative: block.label.narrative })
              .then(() => {
                invalidateDaySummaryRecap(payload.date)
                return onRefresh()
              })
              .catch((error) => setReviewError(sanitizeIpcError(error, "Couldn't save the rename. Try again.").message))
              .finally(() => setOverrideSaving(false))
          }}
        >
          <label htmlFor="timeline-block-label-override" style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}>Rename block</label>
          <input
            id="timeline-block-label-override"
            type="text"
            value={overrideDraft}
            onChange={(event) => setOverrideDraft(event.target.value)}
            placeholder={timelineBlockLabel(block)}
            style={{ flex: 1, minWidth: 150, height: 32, borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', padding: '0 12px', fontSize: 13, outline: 'none' }}
          />
          <button
            type="submit"
            disabled={overrideSaving || !overrideDraft.trim() || overrideDraft.trim() === block.label.current}
            style={{ height: 32, padding: '0 14px', borderRadius: 9, border: 'none', background: 'var(--gradient-primary)', color: 'var(--color-primary-contrast)', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: overrideSaving || !overrideDraft.trim() || overrideDraft.trim() === block.label.current ? 0.6 : 1 }}
          >
            {overrideSaving ? 'Saving…' : 'Rename'}
          </button>
          {hasOverride && (
            <button
              type="button"
              disabled={overrideSaving}
              onClick={() => {
                setOverrideSaving(true)
                setReviewError(null)
                void ipc.db.clearBlockLabelOverride(block.id).then(() => {
                  invalidateDaySummaryRecap(payload.date)
                  return onRefresh()
                }).catch((error) => setReviewError(sanitizeIpcError(error, "Couldn't reset this rename. Try again.").message)).finally(() => setOverrideSaving(false))
              }}
              style={{ height: 32, padding: '0 12px', borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >
              Reset
            </button>
          )}
        </form>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {previousBlock && (
            <button type="button" title={`Merge with ${timelineBlockLabel(previousBlock)}`} disabled={boundarySaving !== null} onClick={() => { void mergeBlockWith(previousBlock, 'merge-prev') }} style={boundaryButtonStyle(boundarySaving !== null)}>
              <ArrowUp size={13} strokeWidth={2} aria-hidden="true" />{boundarySaving === 'merge-prev' ? 'Merging…' : 'Merge with above'}
            </button>
          )}
          {nextBlock && (
            <button type="button" title={`Merge with ${timelineBlockLabel(nextBlock)}`} disabled={boundarySaving !== null} onClick={() => { void mergeBlockWith(nextBlock, 'merge-next') }} style={boundaryButtonStyle(boundarySaving !== null)}>
              <ArrowDown size={13} strokeWidth={2} aria-hidden="true" />{boundarySaving === 'merge-next' ? 'Merging…' : 'Merge with below'}
            </button>
          )}
        </div>

        {(reviewError || boundaryError) && (
          <div role="alert" style={{ fontSize: 11.5, lineHeight: 1.5, color: '#f87171' }}>{reviewError || boundaryError}</div>
        )}
      </div>

      <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--color-text-secondary)', margin: '0 0 20px' }}>
        {blockShortSummary(block)}
      </p>

      <div style={{ display: 'grid', gap: 18 }}>
        <section>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', color: 'var(--color-text-tertiary)', marginBottom: 10 }}>
            Evidence
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {block.topApps.filter((app) => !isSystemNoiseApp(app)).slice(0, 6).map((app) => (
              <div key={`${block.id}:${app.bundleId}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <AppIcon bundleId={app.bundleId} appName={app.appName} size={24} fontSize={10} color={accent} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <InlineRevealText
                    text={formatDisplayAppName(app.appName)}
                    style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}
                  />
                  <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>{categoryLabel(app.category)}</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatDuration(app.totalSeconds)}
                </div>
              </div>
            ))}
            {block.topArtifacts.slice(0, 6).map((artifact) => {
              return (
                <div
                  key={artifact.id}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'start',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void openArtifact(artifact)}
                    disabled={artifact.openTarget.kind === 'unsupported' || !artifact.openTarget.value}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      alignItems: 'start',
                      gap: 10,
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
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        title={artifact.displayTitle}
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--color-text-primary)',
                          lineHeight: 1.35,
                          display: '-webkit-box',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: 2,
                          overflow: 'hidden',
                          overflowWrap: 'break-word',
                          wordBreak: 'break-word',
                        }}
                      >
                        {artifact.displayTitle}
                      </div>
                      {(artifact.subtitle || artifact.host || artifact.path) && (
                        <InlineRevealText
                          text={artifact.subtitle || artifact.host || artifact.path || ''}
                          style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 2 }}
                        />
                      )}
                    </div>
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                      {formatDuration(artifact.totalSeconds)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {block.websites.length > 0 && (
          <section>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', color: 'var(--color-text-tertiary)', marginBottom: 10 }}>
              Websites
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {block.websites.slice(0, 6).map((site) => (
                <span
                  key={`${block.id}:${site.domain}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    borderRadius: 999,
                    padding: '6px 8px 6px 10px',
                    background: 'var(--color-surface-low)',
                    color: 'var(--color-text-secondary)',
                    fontSize: 12,
                  }}
                >
                  <EntityIcon artifactType="page" domain={site.domain} title={site.domain} size={18} />
                  {shortDomainLabel(site.domain)} • {formatDuration(site.totalSeconds)}
                </span>
              ))}
            </div>
          </section>
        )}

        {block.workflowRefs.length > 0 && (
          <section>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', color: 'var(--color-text-tertiary)', marginBottom: 10 }}>
              Workflow clues
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {block.workflowRefs.slice(0, 4).map((workflow) => (
                <div key={workflow.id} style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                  {workflow.label}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

interface WeekDaySummary {
  date: string
  totalSeconds: number
  categories: Array<{ category: AppCategory; seconds: number }>
  workCategories: Array<{ category: AppCategory; seconds: number }>
  blockCount: number
  topLabels: string[]
}

function WeekView({
  selectedDate,
  onSelectDate,
}: {
  selectedDate: string
  onSelectDate: (date: string) => void
}) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null)
  const [hoveredStack, setHoveredStack] = useState<{ date: string; category: AppCategory; seconds: number } | null>(null)
  const weekStart = getWeekStart(selectedDate)
  const today = todayString()
  const includesToday = Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index)).includes(today)

  const weekResource = useProjectionResource<WeekDaySummary[]>({
    scope: 'timeline',
    dependencies: [weekStart],
    intervalMs: includesToday ? 30_000 : 0,
    load: async () => {
      const dates = Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index))
      const days = await Promise.all(dates.map((date) => ipc.db.getTimelineDay(date)))
      return days.map((payload) => {
        const categories = new Map<AppCategory, number>()
        const workCategories = new Map<AppCategory, number>()
        const dayBlocks = visibleBlocks(payload.blocks)
        for (const block of dayBlocks) {
          const seconds = blockDisplayedActiveSeconds(block)
          categories.set(block.dominantCategory, (categories.get(block.dominantCategory) ?? 0) + seconds)
          if (effectiveBlockKind(block) === 'work') {
            workCategories.set(block.dominantCategory, (workCategories.get(block.dominantCategory) ?? 0) + seconds)
          }
        }
        const dayTotalSeconds = visibleBlockTotal(dayBlocks)
        return {
          date: payload.date,
          totalSeconds: dayTotalSeconds,
          categories: [...categories.entries()]
            .sort((left, right) => right[1] - left[1])
            .map(([category, seconds]) => ({ category, seconds })),
          workCategories: [...workCategories.entries()]
            .sort((left, right) => right[1] - left[1])
            .map(([category, seconds]) => ({ category, seconds })),
          blockCount: dayBlocks.length,
          topLabels: [...new Set(
            dayBlocks
              .slice(0, 5)
              .map((block) => timelineBlockLabel(block))
              .filter(Boolean)
          )].slice(0, 3),
        }
      })
    },
  })

  const data = weekResource.data ?? []
  const maxSeconds = data.length > 0 ? Math.max(...data.map((day) => day.totalSeconds), 1) : 1
  const activeDays = data.filter((day) => day.totalSeconds > 0)
  const totalWeekSeconds = activeDays.reduce((sum, day) => sum + day.totalSeconds, 0)
  const averageTrackedSeconds = activeDays.length > 0 ? Math.round(totalWeekSeconds / activeDays.length) : 0
  const mostActiveDay = activeDays.length > 0
    ? activeDays.reduce((best, day) => day.totalSeconds > best.totalSeconds ? day : best)
    : null
  const topWeekCategory = Array.from(activeDays.reduce<Map<AppCategory, number>>((map, day) => {
    for (const category of day.workCategories) {
      map.set(category.category, (map.get(category.category) ?? 0) + category.seconds)
    }
    return map
  }, new Map()).entries())
    .sort((left, right) => right[1] - left[1])[0] ?? null
  const legendCategories = Array.from(activeDays.reduce<Map<AppCategory, number>>((map, day) => {
    for (const entry of day.categories) {
      map.set(entry.category, (map.get(entry.category) ?? 0) + entry.seconds)
    }
    return map
  }, new Map()).entries())
    .sort((left, right) => right[1] - left[1])
    .map(([category]) => category)
  const activeDay = data.find((day) => day.date === hoveredDate)
    ?? data.find((day) => day.date === selectedDate)
    ?? activeDays[0]
    ?? null

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(96px, 1fr))', gap: 10, minWidth: 720 }}>
          {data.map((day) => {
            const [y, m, d] = day.date.split('-').map(Number)
            const isSelected = day.date === selectedDate
            const isToday = day.date === today
            const height = Math.max(14, (day.totalSeconds / maxSeconds) * 148)

            return (
              <button
                key={day.date}
                type="button"
                onClick={() => onSelectDate(day.date)}
                onMouseEnter={() => setHoveredDate(day.date)}
                style={{
                  border: isSelected ? '1px solid var(--color-border-ghost)' : '1px solid transparent',
                  background: isToday || isSelected ? 'var(--color-surface-low)' : 'transparent',
                  borderRadius: 14,
                  padding: '12px 8px 10px',
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>
                  {new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(y, m - 1, d))}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-primary)', marginTop: 2 }}>
                  {d}
                </div>
                <div style={{
                  height: 168,
                  display: 'flex',
                  alignItems: 'end',
                  justifyContent: 'center',
                  marginTop: 10,
                }}>
                  <div style={{
                    width: 76,
                    height,
                    borderRadius: 12,
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border-ghost)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'end',
                  }}>
                    {day.categories.map((category, index) => {
                      const segmentHeight = `${(category.seconds / Math.max(1, day.totalSeconds)) * 100}%`
                      return (
                        <div
                          key={`${day.date}:${category.category}`}
                          onMouseEnter={(event) => {
                            event.stopPropagation()
                            setHoveredDate(day.date)
                            setHoveredStack({ date: day.date, category: category.category, seconds: category.seconds })
                          }}
                          onMouseLeave={() => setHoveredStack((current) => current?.date === day.date && current.category === category.category ? null : current)}
                          style={{
                            height: segmentHeight,
                            background: CATEGORY_COLORS[category.category],
                            opacity: Math.max(0.35, 1 - (index * 0.08)),
                          }}
                        />
                      )
                    })}
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                  {day.totalSeconds > 0 ? formatDuration(day.totalSeconds) : day.date > today ? 'Future' : 'No data'}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {legendCategories.length > 0 && (
        <div aria-label="Timeline category legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px' }}>
          {legendCategories.map((category) => (
            <span key={category} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--color-text-secondary)' }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: CATEGORY_COLORS[category] }} />
              {categoryLabel(category)}
            </span>
          ))}
        </div>
      )}

      <div style={{
        borderRadius: 16,
        border: '1px solid var(--color-border-ghost)',
        background: 'var(--color-surface)',
        padding: '18px 20px',
        display: 'grid',
        gap: 14,
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', color: 'var(--color-text-tertiary)', marginBottom: 6 }}>
              Week total
            </div>
            <div style={{ fontSize: 24, fontWeight: 780, color: 'var(--color-text-primary)' }}>
              {formatDuration(totalWeekSeconds)}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
              {activeDays.length > 0
                ? `${activeDays.length} tracked day${activeDays.length !== 1 ? 's' : ''}`
                : 'No tracked days'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', color: 'var(--color-text-tertiary)', marginBottom: 6 }}>
              Daily average
            </div>
            <div style={{ fontSize: 24, fontWeight: 780, color: 'var(--color-text-primary)' }}>
              {activeDays.length > 0 ? formatDuration(averageTrackedSeconds) : '0m'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', color: 'var(--color-text-tertiary)', marginBottom: 6 }}>
              Most active
            </div>
            <div style={{ fontSize: 24, fontWeight: 780, color: 'var(--color-text-primary)' }}>
              {mostActiveDay ? formatDuration(mostActiveDay.totalSeconds) : '0m'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
              {mostActiveDay ? formatFullDate(mostActiveDay.date) : 'No tracked days'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', color: 'var(--color-text-tertiary)', marginBottom: 6 }}>
              Main mode
            </div>
            <div style={{ fontSize: 16, fontWeight: 760, color: 'var(--color-text-primary)' }}>
              {topWeekCategory ? categoryLabel(topWeekCategory[0]) : 'No work mode yet'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
              {topWeekCategory ? formatDuration(topWeekCategory[1]) : 'Leisure stays in the breakdown'}
            </div>
          </div>
        </div>

        {activeDay && (
          <div style={{
            borderTop: '1px solid var(--color-border-ghost)',
            paddingTop: 14,
            display: 'grid',
            gap: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 730, color: 'var(--color-text-primary)' }}>
                  {formatFullDate(activeDay.date)}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                  {activeDay.totalSeconds > 0
                    ? `${formatDuration(activeDay.totalSeconds)} tracked • ${activeDay.blockCount} block${activeDay.blockCount !== 1 ? 's' : ''}`
                    : activeDay.date > today
                      ? 'Future'
                      : 'No data'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onSelectDate(activeDay.date)}
                style={{
                  padding: '7px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--color-border-ghost)',
                  background: 'var(--color-surface-low)',
                  color: 'var(--color-text-primary)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Open day
              </button>
            </div>

            {activeDay.topLabels.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {activeDay.topLabels.map((label, index) => (
                  <span
                    key={`${activeDay.date}:${index}:${label}`}
                    style={{
                      borderRadius: 999,
                      padding: '5px 9px',
                      background: 'var(--color-surface-low)',
                      color: 'var(--color-text-secondary)',
                      fontSize: 11.5,
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}

            {activeDay.categories.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {activeDay.categories.slice(0, 4).map((entry) => {
                  const highlighted = hoveredStack?.date === activeDay.date && hoveredStack.category === entry.category
                  return (
                    <span
                      key={`${activeDay.date}:${entry.category}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 7,
                        borderRadius: 999,
                        padding: '5px 10px',
                        background: highlighted ? `${CATEGORY_COLORS[entry.category]}20` : 'var(--color-surface-low)',
                        color: highlighted ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                        fontSize: 11.5,
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: CATEGORY_COLORS[entry.category] }} />
                      {categoryLabel(entry.category)} {formatDuration(entry.seconds)}
                    </span>
                  )
                })}
              </div>
            )}

            {hoveredStack && hoveredStack.date === activeDay.date && (
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                Hovered segment: {categoryLabel(hoveredStack.category)} for {formatDuration(hoveredStack.seconds)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Timeline() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [isCompact, setIsCompact] = useState(() => window.innerWidth < 1120)
  const [navState, setNavState] = useState<TimelineNavState>(() => timelineNavStateFromParams(searchParams))
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lastTimelineOpenKeyRef = useRef<string | null>(null)
  const lastBlockOpenKeyRef = useRef<string | null>(null)

  const searchSignature = searchParams.toString()
  const view = navState.view
  const date = navState.date
  const isToday = date === todayString()

  useEffect(() => {
    const next = timelineNavStateFromParams(searchParams)
    setNavState((current) => (
      current.view === next.view && current.date === next.date
        ? current
        : next
    ))
  }, [searchSignature])

  useEffect(() => {
    const onResize = () => setIsCompact(window.innerWidth < 1120)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const timelineResource = useProjectionResource<DayTimelinePayload>({
    scope: 'timeline',
    enabled: view === 'day',
    dependencies: [date, view],
    intervalMs: isToday ? 30_000 : 0,
    load: () => ipc.db.getTimelineDay(date),
  })

  const payload = timelineResource.data?.date === date ? timelineResource.data : null
  const error = timelineResource.error
  const loading = view === 'day' && (!payload || timelineResource.loading)
  const dayBlocks = useMemo(
    () => visibleBlocks(payload?.blocks ?? []),
    [payload],
  )
  const dayTotalSeconds = useMemo(
    () => visibleBlockTotal(dayBlocks),
    [dayBlocks],
  )

  const blockMap = useMemo(() => {
    const map = new Map<string, WorkContextBlock>()
    for (const block of dayBlocks) {
      map.set(block.id, block)
    }
    return map
  }, [dayBlocks])

  useEffect(() => {
    if (!selectedBlockId) return
    if (blockMap.has(selectedBlockId)) return
    setSelectedBlockId(null)
  }, [payload, selectedBlockId, blockMap])

  useEffect(() => {
    setSelectedBlockId(null)
  }, [date])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = 0
  }, [view, date])

  useEffect(() => {
    const openKey = view === 'week'
      ? `week:${date}`
      : payload
        ? `day:${payload.date}:${dayBlocks.length}:${dayTotalSeconds}`
        : null
    if (!openKey || lastTimelineOpenKeyRef.current === openKey) return
    lastTimelineOpenKeyRef.current = openKey
    track(ANALYTICS_EVENT.TIMELINE_OPENED, {
      block_count_bucket: blockCountBucket(dayBlocks.length),
      surface: 'timeline',
      tracked_time_bucket: trackedTimeBucket(dayTotalSeconds),
      trigger: 'navigation',
      view,
    })
  }, [date, dayBlocks.length, dayTotalSeconds, payload, view])

  const selectedBlock = selectedBlockId ? blockMap.get(selectedBlockId) ?? null : null
  const displaySegments = useMemo(
    () => compressTimelineSegments(
      (payload?.segments ?? []).filter((segment) =>
        segment.kind !== 'work_block' || blockMap.has(segment.blockId),
      ),
    ),
    [blockMap, payload],
  )

  useEffect(() => {
    if (!selectedBlock) {
      lastBlockOpenKeyRef.current = null
      return
    }
    if (lastBlockOpenKeyRef.current === selectedBlock.id) return
    lastBlockOpenKeyRef.current = selectedBlock.id
    track(ANALYTICS_EVENT.TIMELINE_BLOCK_OPENED, {
      block_count_bucket: blockCountBucket(dayBlocks.length),
      surface: 'timeline',
      tracked_time_bucket: trackedTimeBucket(dayTotalSeconds),
      trigger: 'click',
      view,
    })
  }, [dayBlocks.length, dayTotalSeconds, selectedBlock, view])

  function updateNavState(nextState: TimelineNavState) {
    setNavState((current) => (
      current.view === nextState.view && current.date === nextState.date
        ? current
        : nextState
    ))
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('view', nextState.view)
      next.set('date', nextState.date)
      return next
    }, { replace: true })
  }

  function setView(nextView: 'day' | 'week') {
    updateNavState({ view: nextView, date })
  }

  function setDate(nextDate: string) {
    updateNavState({ view, date: nextDate })
  }

  const forwardDisabled = view === 'day'
    ? date >= todayString()
    : getWeekStart(date) >= getWeekStart(todayString())

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: 'var(--color-bg)',
        borderBottom: '1px solid var(--color-border-ghost)',
        padding: isCompact ? '16px 18px 14px' : '20px 32px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={() => setDate(view === 'week' ? shiftDate(getWeekStart(date), -7) : shiftDate(date, -1))}
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconChevronLeft />
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
            {view === 'week' ? weekRangeLabel(date) : isToday ? 'Today' : formatFullDate(date)}
          </div>
          <button
            type="button"
            onClick={() => {
              if (!forwardDisabled) {
                setDate(view === 'week' ? shiftDate(getWeekStart(date), 7) : shiftDate(date, 1))
              }
            }}
            disabled={forwardDisabled}
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              border: 'none',
              background: 'transparent',
              cursor: forwardDisabled ? 'default' : 'pointer',
              color: 'var(--color-text-secondary)',
              opacity: forwardDisabled ? 0.3 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconChevronRight />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(view === 'day' ? !isToday : getWeekStart(date) !== getWeekStart(todayString())) && (
            <button
              type="button"
              onClick={() => setDate(todayString())}
              style={{
                padding: '7px 12px',
                borderRadius: 8,
                border: '1px solid var(--color-border-ghost)',
                background: 'var(--color-surface)',
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
          }}>
            {(['day', 'week'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 7,
                  border: 'none',
                  cursor: 'pointer',
                  background: view === mode ? 'var(--gradient-primary)' : 'transparent',
                  color: view === mode ? 'var(--color-primary-contrast)' : 'var(--color-text-secondary)',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {mode === 'day' ? 'Day' : 'Week'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
        {view === 'week' && (
          <div style={{ padding: isCompact ? '20px 18px 36px' : '24px 32px 40px' }}>
            <WeekView
              selectedDate={date}
              onSelectDate={(nextDate) => {
                updateNavState({ view: 'day', date: nextDate })
              }}
            />
          </div>
        )}

        {view === 'day' && (
          <div style={{ padding: isCompact ? '20px 18px 36px' : '24px 32px 40px' }}>
            {error && (
              <div style={{
                borderRadius: 16,
                border: '1px solid rgba(248, 113, 113, 0.28)',
                background: 'rgba(248, 113, 113, 0.08)',
                color: '#f87171',
                padding: '16px 18px',
                marginBottom: 18,
              }}>
                Could not load the timeline: {error}
              </div>
            )}

            {!error && loading && (
              <div style={{ display: 'grid', gap: 12 }}>
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} style={{ display: 'grid', gridTemplateColumns: '104px minmax(0, 1fr)', gap: 16 }}>
                    <div style={{ height: 20, borderRadius: 8, background: 'var(--color-surface-low)', opacity: 0.5 }} />
                    <div style={{ height: 110 - (index * 10), borderRadius: 16, background: 'var(--color-surface-low)', opacity: 0.5 }} />
                  </div>
                ))}
              </div>
            )}

            {!error && !loading && payload && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isCompact ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 360px',
                  gap: 24,
                  alignItems: 'start',
                }}
                onClickCapture={(event) => {
                  const target = event.target as HTMLElement | null
                  if (target?.closest('[data-timeline-inspector="true"]')) {
                    return
                  }
                  const blockButton = target?.closest<HTMLElement>('[data-timeline-block-id]')
                  const nextSelectedId = blockButton?.dataset.timelineBlockId ?? null
                  if (nextSelectedId !== selectedBlockId) {
                    setSelectedBlockId(nextSelectedId)
                  }
                }}
              >
                {dayBlocks.length === 0 ? (
                  <div style={{
                    borderRadius: 18,
                    border: '1px solid var(--color-border-ghost)',
                    background: 'var(--color-surface)',
                    padding: '48px 24px',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 750, color: 'var(--color-text-primary)', marginBottom: 8 }}>
                      No tracked activity for this day
                    </div>
                    <div style={{ fontSize: 13.5, color: 'var(--color-text-tertiary)', maxWidth: 420, margin: '0 auto' }}>
                      Daylens rebuilds this view from persisted local activity. Once foreground activity exists for the day, blocks and gaps appear here automatically.
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 14 }}>
                    {displaySegments.map((segment) => (
                      segment.kind === 'gap_group' ? (
                        <GapGroupRow
                          key={`gap-group:${segment.startTime}:${segment.endTime}`}
                          segment={segment}
                        />
                      ) : (
                        <TimelineRow
                          key={segment.kind === 'work_block' ? segment.blockId : `${segment.kind}:${segment.startTime}:${segment.endTime}`}
                          segment={segment}
                          block={segment.kind === 'work_block' ? blockMap.get(segment.blockId) ?? null : null}
                          isSelected={segment.kind === 'work_block' && selectedBlockId === segment.blockId}
                        />
                      )
                    ))}
                  </div>
                )}
                <BlockInspector
                  block={selectedBlock}
                  payload={payload}
                  blocks={dayBlocks}
                  onRefresh={timelineResource.refresh}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
