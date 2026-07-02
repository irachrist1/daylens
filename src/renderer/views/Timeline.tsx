import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Trash2, X } from 'lucide-react'
import { ANALYTICS_EVENT, blockCountBucket, trackedTimeBucket } from '@shared/analytics'
import type { AIDaySummaryResult, AISurfaceSummary, AppCategory, CalendarRangeBlock, CalendarRangeDay, DayTimelinePayload, TimelineGapSegment, WorkContextBlock } from '@shared/types'
import { activityColorForCategory, leisureBlocksDimmed } from '@shared/activityColors'
import { blockActiveSeconds } from '@shared/blockDuration'
import { isArtifactCompatibleWithBlockCategory, looksLikeRawArtifactLabel, naturalizeLabel, userVisibleBlockLabel } from '@shared/blockLabel'
import { blockTypeTag, effectiveBlockKind, kindForDomain } from '@shared/workKind'
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

// Browser keyword check used to filter the "in App and App" clause down to
// the apps that could plausibly own a page artifact (i.e. browsers).
function isBrowserAppName(bundleId: string, appName: string): boolean {
  const haystack = `${bundleId} ${appName}`.toLowerCase()
  return /(chrome|safari|firefox|edge|brave|arc|opera|vivaldi|dia|comet|browser)/.test(haystack)
}

const PAGE_ARTIFACT_LABEL_CATEGORIES: ReadonlySet<AppCategory> = new Set<AppCategory>([
  'browsing', 'research', 'entertainment', 'social', 'aiTools',
])

// The types a user can assign a block in Edit → Type. Category drives the
// block's color everywhere, so this doubles as the recolor control. The
// neutral system/uncategorized values are not offered — a corrected block
// always has a real type.
const BLOCK_CATEGORY_OPTIONS: Array<{ value: AppCategory; label: string }> = [
  { value: 'development', label: 'Development' },
  { value: 'design', label: 'Design' },
  { value: 'writing', label: 'Writing' },
  { value: 'research', label: 'Research' },
  { value: 'aiTools', label: 'AI tools' },
  { value: 'email', label: 'Email' },
  { value: 'communication', label: 'Communication' },
  { value: 'meetings', label: 'Meetings' },
  { value: 'productivity', label: 'Productivity' },
  { value: 'browsing', label: 'Browsing' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'social', label: 'Social' },
]

// Mirror of the R1 ownership gate at the renderer surface so the rail / day
// sentence / summary subject all reject browser-page leaks even if a stale
// label.current was persisted before the backend gate was tightened.
function pageArtifactLabelAllowed(block: WorkContextBlock): boolean {
  if (PAGE_ARTIFACT_LABEL_CATEGORIES.has(block.dominantCategory)) return true
  const totalSeconds = block.topApps.reduce((sum, app) => sum + (app.totalSeconds ?? 0), 0)
  if (totalSeconds <= 0) return false
  const top2 = block.topApps.slice(0, 2)
  const browserInTop2 = top2.find((app) => app.isBrowser || isBrowserAppName(app.bundleId, app.appName))
  if (!browserInTop2) return false
  return (browserInTop2.totalSeconds ?? 0) / totalSeconds > 0.5
}

// Strip raw URL query/fragment + secret-shaped tokens from any free-text the
// timeline displays. The renderer used to print page artifact displayTitles
// verbatim, so an OAuth callback URL stored as the artifact title leaked the
// `?code=…` straight into the block card.
function safeTimelineText(text: string): string {
  return sanitizeForModel(text)
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

function categoryLabel(category: AppCategory): string {
  if (category === 'aiTools') return 'AI tools'
  return category
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

// Human-readable phrasing for why an episode started or stopped.

function shortDomainLabel(domain: string): string {
  return domain.replace(/^www\./i, '')
}

function blockNarrative(block: WorkContextBlock): string | null {
  return block.label.narrative?.trim() || null
}

// Short deterministic summary used when the AI narrative hasn't landed yet, so
// every block on the timeline reads consistently instead of some having prose
// and others showing nothing between the title and the app icons.
//
// The duration in this prose summary is the block's *active tracked* time, not
// its wall-clock span. A block that bridges an untracked lull has a span far
// larger than what was logged inside it; saying "Spent 1h 57m watching …" for a
// window that only logged 1h 4m overstates the day (R4). blockActiveSeconds
// (summed session time clamped to span) is the honest figure, and it lines up
// with the Focus/Drift totals which now use the same basis.
// Pick a verb that fits the block's dominant category. Keeps deterministic
// summaries from reading like "56m on X in Y" and instead sounds like the
// human-voice examples in the V1 punch-list ("Spent 56m preparing …").
function categoryVerbPhrase(category: WorkContextBlock['dominantCategory']): { verb: string; noun: string } {
  switch (category) {
    case 'development': return { verb: 'editing', noun: 'code' }
    case 'design': return { verb: 'working on', noun: 'design work' }
    case 'writing': return { verb: 'writing', noun: 'a draft' }
    case 'research': return { verb: 'researching', noun: 'reference material' }
    case 'aiTools': return { verb: 'working with', noun: 'AI tools' }
    case 'email': return { verb: 'checking', noun: 'email' }
    case 'communication': return { verb: 'in', noun: 'conversation' }
    case 'meetings': return { verb: 'in', noun: 'meetings' }
    case 'browsing': return { verb: 'reviewing', noun: 'web context' }
    case 'productivity': return { verb: 'working through', noun: 'tasks' }
    case 'entertainment': return { verb: 'watching', noun: 'video content' }
    case 'social': return { verb: 'on', noun: 'social' }
    case 'system': return { verb: 'on', noun: 'system tasks' }
    default: return { verb: 'spent on', noun: 'mixed work' }
  }
}

function artifactPhraseForCategory(
  artifactTitle: string,
  artifactType: string,
  category: WorkContextBlock['dominantCategory'],
): string {
  // "Inbox (3)", "Inbox" → "email"; the title alone is noise here.
  if (/^inbox(?:\s*\(\d+\))?$/i.test(artifactTitle)) return 'email'
  if (artifactType === 'page' && category === 'browsing') return `the ${artifactTitle} page`
  if (artifactType === 'page' && (category === 'research' || category === 'aiTools')) {
    return `${artifactTitle}`
  }
  if (artifactType === 'document') return `${artifactTitle}`
  return artifactTitle
}

function blockShortSummary(block: WorkContextBlock): string {
  const duration = formatDuration(blockActiveSeconds(block))
  const allApps = block.topApps
    .filter((app) => app.category !== 'system' && app.category !== 'uncategorized')
  // Same ownership gate as the label/artifact path: a development block with a
  // background youtube.com tab must not read "across youtube.com". Only carry
  // site phrases when the block's category could plausibly own a page artifact.
  const allowPageSubject = pageArtifactLabelAllowed(block)
  const sites = allowPageSubject
    ? block.websites.slice(0, 2).map((site) => shortDomainLabel(site.domain))
    : []
  // Skip page/domain artifacts that don't fit the block's category — a dev
  // block with a co-occurring YouTube tab must not summarize itself as the
  // YouTube video.
  const topArtifact = block.topArtifacts.find(
    (artifact) =>
      artifact.displayTitle.trim().length > 0
      && isArtifactCompatibleWithBlockCategory(artifact, block.dominantCategory),
  )
  const rawArtifact = topArtifact ? safeTimelineText(topArtifact.displayTitle.trim()) : null
  // §3.5 / invariant 3: never let a raw file, slug, or article tab-title become
  // the subject of the summary ("editing AGENT-EXECUTION-PLAN.md"). Drop it and
  // fall back to the category noun ("editing code").
  const cleanArtifact = rawArtifact ? naturalizeLabel(rawArtifact) || rawArtifact : null
  const naturalizedArtifact = cleanArtifact && !looksLikeRawArtifactLabel(cleanArtifact) ? cleanArtifact : null

  // Same artifact-ownership filter as before: only attribute the artifact to
  // apps that could plausibly own it (browsers for page artifacts, the named
  // owner for document artifacts).
  const orderedApps = (() => {
    if (!topArtifact) return allApps
    if (topArtifact.artifactType === 'page') {
      const browsers = allApps.filter((app) => app.isBrowser || isBrowserAppName(app.bundleId, app.appName))
      return browsers.length > 0 ? browsers : allApps
    }
    if (topArtifact.ownerBundleId) {
      const owners = allApps.filter((app) => app.bundleId === topArtifact.ownerBundleId)
      return owners.length > 0 ? owners : allApps
    }
    return allApps
  })()
  const appNames = orderedApps.slice(0, 2).map((app) => formatDisplayAppName(app.appName))
  const primaryApp = appNames[0] ?? null
  const secondaryApp = appNames[1] ?? null
  const { verb, noun } = categoryVerbPhrase(block.dominantCategory)

  const supportingClause = secondaryApp
    ? `, mostly in ${primaryApp} with ${secondaryApp} as supporting context`
    : primaryApp
      ? `, mostly in ${primaryApp}`
      : ''

  if (naturalizedArtifact) {
    const artifactPhrase = artifactPhraseForCategory(naturalizedArtifact, topArtifact!.artifactType, block.dominantCategory)
    return `Spent ${duration} ${verb} ${artifactPhrase}${supportingClause}.`
  }
  if (primaryApp && sites.length > 0) {
    return `Spent ${duration} ${verb} ${noun} across ${sites.join(' and ')}${supportingClause}.`
  }
  if (primaryApp) {
    return `Spent ${duration} ${verb} ${noun}${supportingClause}.`
  }
  if (sites.length > 0) {
    return `Spent ${duration} ${verb} ${noun} across ${sites.join(' and ')}.`
  }
  return `Spent ${duration} on ${categoryLabel(block.dominantCategory).toLowerCase()}.`
}

// Calendar geometry. The timeline is drawn as a real calendar grid: a block
// sits at its wall-clock position (top = start, bottom = end), so height =
// duration falls out of the clock itself (timeline.md §3.4 / invariant 1) and
// gaps read as the empty space they are.
const DAY_HOUR_HEIGHT = 88
const WEEK_HOUR_HEIGHT = 52
const TIME_GUTTER_WIDTH = 56
// Smallest drawable card. The engine's 15-minute floor means a real block at
// the day scale is ≥ 22px; this only catches meetings and edge-case slivers,
// and 22px is the least height at which a one-line title still reads.
const MIN_CARD_HEIGHT = 22
// Day-view floor: a block that just started must still read and click like a
// real calendar event (title + time row), not a sliver — founder requirement
// (2026-07-02). 44px is the least height that shows both lines.
const MIN_DAY_CARD_HEIGHT = 44

// Daylens won't shape a day into named blocks until there's enough to work with
// (founder decision: at least 2 hours tracked). Below this the Analyze action
// stays disabled with a gentle "keep going" nudge.
const ANALYZE_MIN_SECONDS = 2 * 60 * 60

// The day's tracked seconds, from the same blocks the timeline draws (invariant
// 7) with the raw total as a floor. Shared by the recap footer and the gate.
function trackedSecondsFor(payload: DayTimelinePayload): number {
  const blockSeconds = payload.blocks.reduce((sum, block) => sum + blockActiveSeconds(block), 0)
  return blockSeconds > 0 ? blockSeconds : payload.totalSeconds
}

// Local midnight of a YYYY-MM-DD date — the top of that day's calendar track.
function dayStartMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

// The furthest the track may run past midnight. A block owned by the day can
// spill into the small hours (the owned day carries late-night work), so the
// track extends with it — up to 6 AM the next day as a sanity cap.
const MAX_TRACK_MINUTES = 30 * 60

// Minutes from local midnight. Not clamped to 24h: a block that runs past
// midnight extends the track instead of piling up at the bottom edge.
function minutesIntoDay(ts: number, dayStart: number): number {
  return Math.min(MAX_TRACK_MINUTES, Math.max(0, (ts - dayStart) / 60_000))
}

function hourLabel(hour: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2000, 0, 1, hour % 24))
}

// The day bounds = actual activity (founder rule): the track runs from the
// hour of the first tracked event to the hour of the last — empty midnight
// hours simply don't exist in the view. On today the track extends to "now"
// so the current-time line always has a home.
interface TrackBounds {
  startHour: number
  endHour: number
}

function trackBoundsFor(
  days: Array<{ date: string; blocks: WorkContextBlock[] }>,
  nowMs: number | null,
): TrackBounds {
  let firstMin = Number.POSITIVE_INFINITY
  let lastMin = Number.NEGATIVE_INFINITY
  for (const day of days) {
    const dayStart = dayStartMs(day.date)
    for (const block of day.blocks) {
      firstMin = Math.min(firstMin, minutesIntoDay(block.startTime, dayStart))
      lastMin = Math.max(lastMin, minutesIntoDay(block.endTime, dayStart))
    }
    if (nowMs != null && nowMs >= dayStart && nowMs < dayStart + 24 * 60 * 60_000) {
      lastMin = Math.max(lastMin, minutesIntoDay(nowMs, dayStart))
    }
  }
  if (!Number.isFinite(firstMin) || !Number.isFinite(lastMin) || lastMin <= firstMin) {
    return { startHour: 8, endHour: 18 }
  }
  const startHour = Math.max(0, Math.floor(firstMin / 60))
  const endHour = Math.min(MAX_TRACK_MINUTES / 60, Math.max(startHour + 1, Math.ceil(lastMin / 60)))
  return { startHour, endHour }
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7)
}

function monthLabel(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1))
}

// First day of the month `delta` months away, as YYYY-MM-DD.
function shiftMonth(dateStr: string, delta: number): string {
  const [y, m] = dateStr.split('-').map(Number)
  const next = new Date(y, m - 1 + delta, 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
}

// Every date drawn on the month grid: full Monday-start weeks covering the
// month, so the grid is always 7 columns × 4–6 rows.
function monthGridDates(dateStr: string): string[] {
  const [y, m] = dateStr.split('-').map(Number)
  const first = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const last = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  const start = getWeekStart(first)
  const end = shiftDate(getWeekStart(last), 6)
  const dates: string[] = []
  for (let d = start; d <= end; d = shiftDate(d, 1)) dates.push(d)
  return dates
}

interface TimelineNavState {
  view: 'day' | 'week' | 'month'
  date: string
}

function timelineNavStateFromParams(searchParams: URLSearchParams): TimelineNavState {
  const rawView = searchParams.get('view')
  return {
    view: rawView === 'week' ? 'week' : rawView === 'month' ? 'month' : 'day',
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

// One block drawn as a calendar event: absolutely positioned at its clock
// time inside a day track. `compact` is the week-column variant (smaller
// type, title-first, no prose).
function CalendarBlockCard({
  block,
  top,
  height,
  compact,
  isSelected,
  inMergeRange,
  dimmed = false,
  onClick,
  onContextMenu,
}: {
  block: WorkContextBlock
  top: number
  height: number
  compact: boolean
  isSelected: boolean
  inMergeRange: boolean
  // True when a tag filter is active and this block isn't in it. Filtered
  // blocks fade but stay in place — the shape of the day never lies.
  dimmed?: boolean
  onClick?: () => void
  onContextMenu?: (event: ReactMouseEvent) => void
}) {
  const accent = block.provisional ? '#8b93a7' : activityColorForCategory(block.dominantCategory)
  // Leisure / personal blocks are muted so the eye finds work first —
  // unless the user turned that off (Settings → General → Dim leisure blocks).
  const muted = effectiveBlockKind(block) !== 'work' && leisureBlocksDimmed()
  const label = userVisibleBlockLabel(block)
  const timeRange = `${formatClockTime(block.startTime)} – ${formatClockTime(block.endTime)}`
  const showTime = height >= (compact ? 34 : 40)
  const showSummary = !compact && height >= 128
  const titleLines = height >= (compact ? 48 : 56) ? 2 : 1

  return (
    <button
      type="button"
      data-timeline-block-id={block.id}
      aria-label={`Open ${label}, ${formatDuration(blockActiveSeconds(block))}`}
      aria-pressed={isSelected}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={`${label} · ${timeRange}`}
      style={{
        position: 'absolute',
        top,
        height,
        left: compact ? 2 : 4,
        right: compact ? 2 : 8,
        // Explicit top-aligned column: a calendar event's title sits at its
        // start time. (A bare <button> vertically centers its content, which
        // floated the title into the middle of tall blocks.)
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
        textAlign: 'left',
        cursor: 'pointer',
        borderRadius: compact ? 6 : 8,
        // The thin border stays on every block so neighbouring blocks read as
        // separate cards; the solid accent stripe on the left carries the
        // category colour unmistakably at every size (founder ask, Jul 2026 —
        // the low-alpha fills alone read as "no colour" on the light theme).
        // The live block reads as "happening now": solid accent border and a
        // stronger fill, against the quieter tint of finished blocks.
        border: block.isLive
          ? `1.5px solid ${accent}`
          : (isSelected || inMergeRange) ? `1px solid ${accent}88` : `1px solid ${accent}30`,
        borderLeft: `3px solid ${accent}`,
        // Frosted glass: a stronger tint over a backdrop blur, so the hour
        // lines behind the card haze out instead of striking through the
        // title and summary text (founder ask, Jul 2026).
        background: (isSelected || inMergeRange) ? `${accent}40` : block.isLive ? `${accent}36` : `${accent}2a`,
        backdropFilter: 'blur(10px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(10px) saturate(1.4)',
        boxShadow: isSelected ? '0 6px 20px rgba(0,0,0,0.18)' : 'none',
        transition: 'border-color 120ms, background 120ms',
        padding: compact ? '2px 6px' : '4px 9px',
        overflow: 'hidden',
        minWidth: 0,
        opacity: dimmed ? 0.22 : muted ? 0.75 : 1,
        zIndex: isSelected ? 3 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'start', gap: 6, minWidth: 0 }}>
        <span style={{
          flex: 1,
          minWidth: 0,
          fontSize: compact ? 11 : 12.5,
          fontWeight: 650,
          color: 'var(--color-text-primary)',
          lineHeight: 1.25,
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: titleLines,
          overflow: 'hidden',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
        }}>
          {label}
        </span>
        {block.isLive && (
          <span aria-label="Live" style={{
            flexShrink: 0,
            marginTop: 3,
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: '#22c55e',
            animation: 'live-pulse 2s ease-in-out infinite',
          }} />
        )}
      </div>
      {showTime && (
        <div style={{ fontSize: compact ? 10 : 11, color: 'var(--color-text-tertiary)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {timeRange} · {formatDuration(blockActiveSeconds(block))}
        </div>
      )}
      {showSummary && (
        <p style={{
          fontSize: 12,
          lineHeight: 1.5,
          color: 'var(--color-text-secondary)',
          margin: '4px 0 0',
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: Math.max(1, Math.floor((height - 64) / 18)),
          overflow: 'hidden',
          overflowWrap: 'break-word',
        }}>
          {blockNarrative(block) ?? blockShortSummary(block)}
        </p>
      )}
    </button>
  )
}

// The hour labels column shared by the day and week grids. Runs only over the
// bounded span — the hours the day actually lived in.
function HourGutter({ hourHeight, bounds }: { hourHeight: number; bounds: TrackBounds }) {
  const hours = Array.from(
    { length: Math.max(0, bounds.endHour - bounds.startHour + 1) },
    (_, index) => bounds.startHour + index,
  )
  return (
    <div style={{ position: 'relative', height: (bounds.endHour - bounds.startHour) * hourHeight, width: TIME_GUTTER_WIDTH }}>
      {hours.map((hour) => (
        <div
          key={hour}
          style={{
            position: 'absolute',
            top: (hour - bounds.startHour) * hourHeight,
            right: 8,
            transform: 'translateY(-50%)',
            fontSize: 10,
            color: 'var(--color-text-tertiary)',
            whiteSpace: 'nowrap',
          }}
        >
          {hourLabel(hour)}
        </div>
      ))}
    </div>
  )
}

// One day as a 24-hour calendar track: hour lines, blocks at their clock
// positions, and the current-time line on today. Idle/away time renders as
// blank space between blocks, sized by the clock — no card, no fill, nothing
// clickable — but never unexplained (founder decision, Jul 2, 2026): each
// visible gap carries one quiet line saying what kind of absence it was
// (Asleep / Away / Idle / Passive / Tracking paused / Untracked) and for how
// long. Blocks are buttons carrying data-timeline-block-id, so the day view's
// click-capture selection (plain click, shift-click merge, click-empty
// deselect) works unchanged.
function CalendarDayTrack({
  date,
  blocks,
  bounds,
  gapSegments = [],
  hourHeight,
  compact = false,
  selectedBlockId = null,
  selectedSpanIds,
  nowMs = null,
  dimBlock,
  onBlockClick,
  onBlockContextMenu,
}: {
  date: string
  blocks: WorkContextBlock[]
  bounds: TrackBounds
  gapSegments?: TimelineGapSegment[]
  hourHeight: number
  compact?: boolean
  selectedBlockId?: string | null
  selectedSpanIds?: ReadonlySet<string>
  nowMs?: number | null
  // When set, blocks outside the active tag filter render dimmed.
  dimBlock?: (block: WorkContextBlock) => boolean
  onBlockClick?: (block: WorkContextBlock) => void
  // Right-click on a block, Google-Calendar style (day view only).
  onBlockContextMenu?: (block: WorkContextBlock, event: ReactMouseEvent) => void
}) {
  const dayStart = dayStartMs(date)
  const trackStartMin = bounds.startHour * 60
  const trackEndMin = bounds.endHour * 60
  const trackHeight = ((trackEndMin - trackStartMin) / 60) * hourHeight
  const topFor = (ts: number) => ((minutesIntoDay(ts, dayStart) - trackStartMin) / 60) * hourHeight
  const nowMinutes = nowMs != null ? (nowMs - dayStart) / 60_000 : null
  const showNowLine = nowMinutes != null && nowMinutes >= trackStartMin && nowMinutes <= trackEndMin
  const hourCount = Math.max(0, bounds.endHour - bounds.startHour + 1)

  return (
    <div style={{ position: 'relative', height: trackHeight, minWidth: 0 }}>
      {/* Faint hour lines, Google-Calendar style: the grid reads as a grid
          without any wrapping chrome, in both the day and week tracks. */}
      {Array.from({ length: hourCount }, (_, index) => (
        <div
          key={index}
          style={{
            position: 'absolute',
            top: index * hourHeight,
            left: 0,
            right: 0,
            borderTop: '1px solid var(--color-border-ghost)',
            pointerEvents: 'none',
          }}
        />
      ))}

      {/* Gap reasons: the blank space stays blank — one quiet, non-interactive
          line names the kind of absence and its length. */}
      {!compact && gapSegments.map((gap) => {
        const top = topFor(gap.startTime)
        const gapHeight = topFor(gap.endTime) - top
        if (gapHeight < 26) return null
        return (
          <div
            key={`gap:${gap.startTime}`}
            style={{
              position: 'absolute',
              top,
              height: gapHeight,
              left: 4,
              right: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
              {gap.label} · {formatDuration(Math.max(60, Math.round((gap.endTime - gap.startTime) / 1000)))}
            </span>
          </div>
        )
      })}

      {blocks.map((block) => {
        const top = topFor(block.startTime)
        // The live block's payload end freezes at the moment the payload was
        // computed; glue its bottom to the current-time line so the active
        // session visibly grows between refreshes instead of lagging the clock.
        const layoutEnd = block.isLive && nowMs != null ? Math.max(block.endTime, nowMs) : block.endTime
        const height = Math.max(compact ? MIN_CARD_HEIGHT : MIN_DAY_CARD_HEIGHT, topFor(layoutEnd) - top)
        return (
          <CalendarBlockCard
            key={block.id}
            block={block}
            top={top}
            height={height}
            compact={compact}
            isSelected={selectedBlockId === block.id}
            inMergeRange={selectedBlockId !== block.id && (selectedSpanIds?.has(block.id) ?? false)}
            dimmed={dimBlock ? dimBlock(block) : false}
            onClick={onBlockClick ? () => onBlockClick(block) : undefined}
            onContextMenu={onBlockContextMenu ? (event) => onBlockContextMenu(block, event) : undefined}
          />
        )
      })}

      {/* The current-time line, Google-Calendar style: a thin red line across
          the track with a dot at its left edge, drawn over the blocks. */}
      {showNowLine && (
        <div style={{
          position: 'absolute',
          top: ((nowMinutes - trackStartMin) / 60) * hourHeight,
          left: 0,
          right: 0,
          zIndex: 4,
          pointerEvents: 'none',
        }}>
          <div style={{ position: 'absolute', left: -3, top: -3.5, width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
          <div style={{ borderTop: '2px solid #ef4444' }} />
        </div>
      )}
    </div>
  )
}

// The right-click menu on a block, Google-Calendar style: Edit, Regenerate
// summary, Delete. Rendered fixed at the cursor; a full-screen backdrop closes
// it on any click or Escape.
function BlockContextMenu({
  x,
  y,
  busy,
  onEdit,
  onRegenerate,
  onDelete,
  onClose,
}: {
  x: number
  y: number
  busy: boolean
  onEdit: () => void
  onRegenerate: () => void
  onDelete: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const MENU_WIDTH = 200
  const MENU_HEIGHT = 118
  const left = Math.min(x, window.innerWidth - MENU_WIDTH - 8)
  const top = Math.min(y, window.innerHeight - MENU_HEIGHT - 8)

  const itemStyle = (danger = false): CSSProperties => ({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    border: 'none',
    background: 'transparent',
    borderRadius: 7,
    padding: '7px 10px',
    fontSize: 12.5,
    fontWeight: 600,
    color: danger ? '#f87171' : 'var(--color-text-primary)',
    cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.5 : 1,
  })

  return (
    <div
      // Marked as inspector chrome so the day grid's capture-phase click
      // handler leaves the selection alone — clicking a menu item (or the
      // backdrop to dismiss) must not bleed into select/deselect state.
      data-timeline-inspector="true"
      style={{ position: 'fixed', inset: 0, zIndex: 60 }}
      onClick={onClose}
      onContextMenu={(event) => { event.preventDefault(); onClose() }}
    >
      <div
        role="menu"
        style={{
          position: 'fixed',
          left,
          top,
          width: MENU_WIDTH,
          borderRadius: 10,
          border: '1px solid var(--color-border-ghost)',
          background: 'var(--color-surface)',
          boxShadow: '0 12px 36px rgba(0,0,0,0.24)',
          padding: 5,
          zIndex: 61,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" role="menuitem" disabled={busy} onClick={onEdit} style={itemStyle()}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-high)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
          Edit
        </button>
        <button type="button" role="menuitem" disabled={busy} onClick={onRegenerate} style={itemStyle()}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-high)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
          {busy ? 'Regenerating…' : 'Regenerate summary'}
        </button>
        <button type="button" role="menuitem" disabled={busy} onClick={onDelete} style={itemStyle(true)}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-high)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
          Delete
        </button>
      </div>
    </div>
  )
}

// ─── The block editor modal ──────────────────────────────────────────────────
// Right-click → Edit opens this separate centered popup, Google Calendar's
// event editor shape: title, time range, type/color with the suggested color
// and a one-sentence reason, the tracked records with a permanent-remove per
// row, and Delete block (full erasure of the block and its tracked data).
// Save applies every change and closes; Discard closes with nothing applied.
// The read-only detail panel never hosts any of this.

function toTimeInputValue(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fromTimeInputValue(value: string, baseMs: number): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const d = new Date(baseMs)
  d.setHours(Number(match[1]), Number(match[2]), 0, 0)
  return d.getTime()
}

function BlockEditModal({
  block,
  payload,
  onClose,
  onDeleted,
  onRefresh,
}: {
  block: WorkContextBlock
  payload: DayTimelinePayload
  onClose: () => void
  // Called after the block is permanently purged, so the parent can drop the
  // (now dangling) selection before the refreshed day lands.
  onDeleted: () => void
  onRefresh: () => Promise<void>
}) {
  const [titleDraft, setTitleDraft] = useState(() => userVisibleBlockLabel(block))
  const [categoryDraft, setCategoryDraft] = useState<AppCategory>(block.dominantCategory)
  const [startDraft, setStartDraft] = useState(() => toTimeInputValue(block.startTime))
  const [endDraft, setEndDraft] = useState(() => toTimeInputValue(block.endTime))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [purgingKey, setPurgingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = saving || deleting || purgingKey !== null

  // Escape = Discard, like closing GCal's editor without saving.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  // The suggested type: what the evidence says this block mostly was — shown
  // as its color plus one plain sentence saying why that color was chosen.
  const suggestion = useMemo(() => {
    const split = Object.entries(block.categoryDistribution ?? {})
      .filter((entry): entry is [AppCategory, number] => typeof entry[1] === 'number' && entry[1] >= 60)
      .sort((a, b) => b[1] - a[1])
    const topCategory = split[0]?.[0]
    if (!topCategory || !BLOCK_CATEGORY_OPTIONS.some((option) => option.value === topCategory)) return null
    const topApp = block.topApps[0]
    const topSite = block.websites[0]
    const carrier = topApp && (!topSite || topApp.totalSeconds >= topSite.totalSeconds)
      ? formatDisplayAppName(topApp.appName)
      : topSite ? shortDomainLabel(topSite.domain) : null
    const label = BLOCK_CATEGORY_OPTIONS.find((option) => option.value === topCategory)?.label ?? categoryLabel(topCategory)
    return {
      category: topCategory,
      color: activityColorForCategory(topCategory),
      reason: carrier
        ? `This is the ${label} color — most of this block's time was in ${carrier}.`
        : `This is the ${label} color — it covers the largest share of this block's time.`,
    }
  }, [block])

  // Delete the block AND its tracked data, permanently. This is the full
  // erasure path for sensitive stretches: the main process confirms with a
  // native dialog, then the underlying records — app sessions, site visits,
  // focus events — are deleted from Daylens entirely, not hidden.
  const deleteBlock = async () => {
    if (busy) return
    setDeleting(true)
    setError(null)
    try {
      const { purged } = await ipc.db.purgeTimelineBlock({ blockId: block.id, date: payload.date })
      if (purged) {
        daySummaryRecapCache.delete(payload.date)
        onDeleted()
        await onRefresh()
        onClose()
        return
      }
    } catch (err) {
      setError(sanitizeIpcError(err, "Couldn't delete the block. Try again in a moment.").message)
    }
    setDeleting(false)
  }

  const save = async () => {
    if (busy) return
    setSaving(true)
    setError(null)
    try {
      const title = titleDraft.trim()
      if (title && title !== block.label.current) {
        await ipc.db.setBlockLabelOverride({ blockId: block.id, date: payload.date, label: title, narrative: block.label.narrative })
      }
      if (categoryDraft !== block.dominantCategory) {
        await ipc.db.setBlockReview({ blockId: block.id, date: payload.date, state: 'corrected', correctedCategory: categoryDraft })
      }
      const startMs = fromTimeInputValue(startDraft, block.startTime)
      const endMs = fromTimeInputValue(endDraft, block.endTime)
      if (startMs != null && endMs != null && (startMs !== block.startTime || endMs !== block.endTime)) {
        // Applied last: a trim re-shapes the day and retires block ids.
        await ipc.db.setBlockSpan({ blockId: block.id, date: payload.date, startMs, endMs })
      }
      daySummaryRecapCache.delete(payload.date)
      await onRefresh()
      onClose()
    } catch (err) {
      setError(sanitizeIpcError(err, "Couldn't save the changes. Try again in a moment.").message)
      setSaving(false)
    }
  }

  // Permanently remove a sensitive tracked record. The main process shows the
  // native "are you sure" dialog; on confirm the underlying rows are deleted
  // everywhere — not hidden — and the day re-forms from what remains.
  const purgeRow = async (row: { key: string; kind: 'app' | 'site'; bundleId?: string; appName?: string; domain?: string }) => {
    if (busy) return
    setPurgingKey(row.key)
    setError(null)
    try {
      const { purged } = await ipc.db.purgeTrackedEvidence({
        kind: row.kind,
        bundleId: row.bundleId,
        appName: row.appName,
        domain: row.domain,
        fromMs: block.startTime,
        toMs: block.endTime,
      })
      if (purged) {
        daySummaryRecapCache.delete(payload.date)
        await onRefresh()
        onClose()
      }
    } catch (err) {
      setError(sanitizeIpcError(err, "Couldn't remove the record. Try again in a moment.").message)
    } finally {
      setPurgingKey(null)
    }
  }

  const trackedRows = [
    ...block.topApps.slice(0, 10).map((app) => ({
      key: `app:${app.bundleId}`,
      kind: 'app' as const,
      bundleId: app.bundleId,
      appName: app.appName,
      name: formatDisplayAppName(app.appName),
      detail: categoryLabel(app.category),
      seconds: app.totalSeconds,
      icon: <AppIcon bundleId={app.bundleId} appName={app.appName} size={22} fontSize={9} color={activityColorForCategory(app.category)} />,
    })),
    ...block.websites.slice(0, 10).map((site) => ({
      key: `site:${site.domain}`,
      kind: 'site' as const,
      domain: site.domain,
      name: shortDomainLabel(site.domain),
      detail: site.topTitle?.trim() || null,
      seconds: site.totalSeconds,
      icon: <EntityIcon artifactType="page" domain={site.domain} title={site.domain} size={22} />,
    })),
  ].sort((a, b) => b.seconds - a.seconds)

  const inputBase: CSSProperties = {
    borderRadius: 9,
    border: '1px solid var(--color-border-ghost)',
    background: 'var(--color-surface-low)',
    color: 'var(--color-text-primary)',
    fontSize: 13,
    outline: 'none',
  }

  return (
    <div
      // Inspector-marked so the day grid's capture-phase click handler never
      // treats modal clicks (backdrop included) as select/deselect intent.
      data-timeline-inspector="true"
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={() => { if (!busy) onClose() }}
    >
      <div
        role="dialog"
        aria-label="Edit block"
        style={{
          width: 560,
          maxWidth: '100%',
          maxHeight: '84vh',
          overflowY: 'auto',
          borderRadius: 18,
          border: '1px solid var(--color-border-ghost)',
          background: 'var(--color-surface)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
          padding: '16px 24px 20px',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Title row, GCal editor style: close on the left, the title as a big
            underlined field. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <button
            type="button"
            aria-label="Discard changes"
            title="Discard"
            onClick={() => { if (!busy) onClose() }}
            style={{ width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', border: 'none', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', flexShrink: 0 }}
          >
            <X size={17} strokeWidth={2} aria-hidden="true" />
          </button>
          <input
            type="text"
            aria-label="Block title"
            value={titleDraft}
            autoFocus
            onChange={(event) => setTitleDraft(event.target.value)}
            placeholder="Block title"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 19,
              fontWeight: 650,
              border: 'none',
              borderBottom: '1.5px solid var(--color-border-ghost)',
              background: 'transparent',
              color: 'var(--color-text-primary)',
              padding: '4px 2px 7px',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'grid', gap: 16, paddingLeft: 44 }}>
          {/* Time range. Trim-only: a block is tracked activity, so its edges
              move inward — Daylens never turns idle time into work. */}
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 600 }}>{formatFullDate(payload.date)}</span>
              <input
                type="time"
                aria-label="Start time"
                value={startDraft}
                disabled={block.provisional}
                onChange={(event) => setStartDraft(event.target.value)}
                style={{ ...inputBase, padding: '5px 8px', opacity: block.provisional ? 0.5 : 1 }}
              />
              <span style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>to</span>
              <input
                type="time"
                aria-label="End time"
                value={endDraft}
                disabled={block.provisional}
                onChange={(event) => setEndDraft(event.target.value)}
                style={{ ...inputBase, padding: '5px 8px', opacity: block.provisional ? 0.5 : 1 }}
              />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 6, lineHeight: 1.5 }}>
              {block.provisional
                ? 'Time edits unlock after Analyze day — this block is still settling.'
                : 'Edges move inward only — the trimmed-off stretch becomes its own block. Daylens never counts idle time as activity.'}
            </div>
          </div>

          {/* Type + color, with the evidence-based suggestion and its reason. */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <select
                aria-label="Block type"
                value={categoryDraft}
                onChange={(event) => setCategoryDraft(event.target.value as AppCategory)}
                style={{ ...inputBase, height: 32, padding: '0 8px', cursor: 'pointer' }}
              >
                {!BLOCK_CATEGORY_OPTIONS.some((option) => option.value === categoryDraft) && (
                  <option value={categoryDraft}>{categoryLabel(categoryDraft)}</option>
                )}
                {BLOCK_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 4, background: activityColorForCategory(categoryDraft), flexShrink: 0 }} />
            </div>
            {/* The suggested color and, in one plain sentence, why. Always
                visible — the user should never wonder where a color came from. */}
            {suggestion && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: suggestion.color, flexShrink: 0 }} />
                <span>{suggestion.reason}</span>
                {suggestion.category !== categoryDraft && (
                  <button
                    type="button"
                    onClick={() => setCategoryDraft(suggestion.category)}
                    style={{ border: 'none', background: 'transparent', color: 'var(--color-primary)', fontSize: 12, fontWeight: 650, cursor: 'pointer', padding: 0 }}
                  >
                    Use
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Tracked records, each permanently removable — real deletion of
              the underlying data, for anything the user doesn't want Daylens
              to hold (native confirm before anything is touched). */}
          {trackedRows.length > 0 && (
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', color: 'var(--color-text-tertiary)', marginBottom: 10, textTransform: 'uppercase' }}>
                Tracked in this block
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {trackedRows.map((row) => (
                  <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {row.icon}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</div>
                      {row.detail && (
                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.detail}</div>
                      )}
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{formatDuration(row.seconds)}</span>
                    <button
                      type="button"
                      aria-label={`Permanently remove ${row.name} from Daylens`}
                      title="Remove permanently"
                      disabled={purgingKey !== null}
                      onClick={() => { void purgeRow(row) }}
                      style={{ width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, border: 'none', background: 'transparent', color: purgingKey === row.key ? 'var(--color-text-tertiary)' : '#f87171', cursor: purgingKey ? 'default' : 'pointer', opacity: purgingKey && purgingKey !== row.key ? 0.4 : 1, flexShrink: 0 }}
                    >
                      <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 8, lineHeight: 1.5 }}>
                Removing deletes the record from Daylens entirely — timeline, apps, and AI — not just from this view.
              </div>
            </div>
          )}

          {error && (
            <div style={{ fontSize: 11.5, lineHeight: 1.5, color: '#f87171' }}>{error}</div>
          )}
        </div>

        {/* Delete erases the block and its tracked data entirely (native
            confirm first); Save applies and closes; Discard closes with no
            changes. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 20 }}>
          <button
            type="button"
            disabled={busy}
            onClick={() => { void deleteBlock() }}
            title="Permanently delete this block and everything tracked inside it"
            style={{ border: '1px solid rgba(248, 113, 113, 0.4)', background: 'transparent', color: '#f87171', fontSize: 12.5, fontWeight: 650, cursor: busy ? 'default' : 'pointer', padding: '7px 14px', borderRadius: 9, opacity: busy && !deleting ? 0.5 : 1, marginRight: 'auto' }}
          >
            {deleting ? 'Deleting…' : 'Delete block'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            style={{ border: '1px solid var(--color-border-ghost)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: 12.5, fontWeight: 650, cursor: busy ? 'default' : 'pointer', padding: '7px 14px', borderRadius: 9 }}
          >
            Discard
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { void save() }}
            style={{ border: 'none', background: 'var(--gradient-primary)', color: 'var(--color-primary-contrast)', fontSize: 12.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', padding: '7px 16px', borderRadius: 9, opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

const daySummaryRecapCache = new Map<string, AIDaySummaryResult>()

function DaySummaryInspector({ payload, onRefresh }: { payload: DayTimelinePayload; onSelectBlock?: (blockId: string) => void; onRefresh?: () => Promise<void> }) {
  const [recap, setRecap] = useState<AIDaySummaryResult | null>(null)
  const [recapLoading, setRecapLoading] = useState(false)
  const [recapError, setRecapError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeStatus, setAnalyzeStatus] = useState<string | null>(null)
  // The optional-note step of Analyze day: a one-line hint grounds the AI.
  const [wrapOpen, setWrapOpen] = useState(false)
  const [wrapNote, setWrapNote] = useState('')

  const isToday = payload.date === todayString()
  const provisional = payload.blocks.some((block) => block.provisional)
  // Daylens makes no claim about the day until it has enough to work with.
  const enoughToAnalyze = trackedSecondsFor(payload) >= ANALYZE_MIN_SECONDS

  useEffect(() => {
    setAnalyzeStatus(null)
    setRecapError(null)
    setWrapOpen(false)
    setWrapNote('')
    const cached = daySummaryRecapCache.get(payload.date)
    setRecap(cached ?? null)
    setRecapLoading(false)
  }, [payload.date])

  // Analyze Day (today) / Re-analyze (a past day): finalize the provisional day
  // into named blocks and refresh deterministic-floor / low-confidence labels.
  // An optional hint (what the user typed they did) grounds the AI when the
  // evidence is thin.
  const handleAnalyze = async (hint?: string) => {
    if (analyzing) return
    setAnalyzing(true)
    setAnalyzeStatus(null)
    try {
      await ipc.db.rebuildTimelineDay(payload.date, hint)
      daySummaryRecapCache.delete(payload.date)
      await onRefresh?.()
      setWrapOpen(false)
      setWrapNote('')
      setAnalyzeStatus(provisional ? 'Day shaped into blocks' : 'Labels refreshed')
    } catch (error) {
      const { message } = sanitizeIpcError(error, 'Analysis failed. Try again in a moment.')
      setAnalyzeStatus(message)
    } finally {
      setAnalyzing(false)
    }
  }

  // Generate Recap: a short, grounded AI summary of the day built from the same
  // blocks. Cached per date so re-opening the day doesn't re-spend the call.
  const handleGenerateRecap = async () => {
    if (recapLoading) return
    setRecapLoading(true)
    setRecapError(null)
    try {
      const result = await ipc.ai.generateDaySummary(payload.date)
      daySummaryRecapCache.set(payload.date, result)
      setRecap(result)
    } catch (error) {
      const { message } = sanitizeIpcError(error, "Couldn't generate the recap. Try again in a moment.")
      setRecapError(message)
    } finally {
      setRecapLoading(false)
    }
  }

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
      <div style={{ fontSize: 18, fontWeight: 750, color: 'var(--color-text-primary)' }}>
        {isToday ? 'Today' : formatFullDate(payload.date)}
      </div>

      {payload.totalSeconds === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
          Nothing tracked yet.
        </div>
      ) : (
        <>
          {/* The day recap — calm, grounded prose once generated. */}
          {recap?.summary && (
            <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-text-primary)' }}>
              {recap.summary}
            </div>
          )}

          {recapError && (
            <div style={{ fontSize: 11.5, lineHeight: 1.5, color: '#f87171' }}>{recapError}</div>
          )}

          {onRefresh && (
            <div style={{ borderTop: '1px solid var(--color-border-ghost)', paddingTop: 14, display: 'grid', gap: 8, justifyItems: 'start', width: '100%' }}>
              {analyzing ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 650, color: 'var(--color-text-primary)' }}>
                  <span style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid var(--color-border-ghost)', borderTopColor: 'var(--color-text-secondary)', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                  Analyzing day…
                </div>
              ) : provisional ? (
                // TODAY, unanalyzed: Analyze day shapes the provisional day into
                // named blocks. Gated until there's at least 2 hours to work with.
                !wrapOpen ? (
                  <>
                    <button
                      type="button"
                      disabled={!enoughToAnalyze}
                      onClick={() => setWrapOpen(true)}
                      style={{ justifySelf: 'start', border: 'none', background: 'var(--gradient-primary)', color: 'var(--color-primary-contrast)', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: enoughToAnalyze ? 'pointer' : 'default', opacity: enoughToAnalyze ? 1 : 0.5 }}
                    >
                      Analyze day
                    </button>
                    {!enoughToAnalyze && (
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}>
                        Available after ~2 hours of tracked time.
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ display: 'grid', gap: 8, width: '100%' }}>
                    <textarea
                      value={wrapNote}
                      onChange={(event) => setWrapNote(event.target.value)}
                      placeholder="Optional: in a line, what were you working on today?"
                      rows={2}
                      style={{ width: '100%', resize: 'vertical', borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', padding: '8px 10px', fontSize: 12.5, outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => { void handleAnalyze(wrapNote) }}
                        style={{ border: 'none', background: 'var(--gradient-primary)', color: 'var(--color-primary-contrast)', borderRadius: 9, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Analyze
                      </button>
                      <button
                        type="button"
                        onClick={() => { setWrapOpen(false); setWrapNote('') }}
                        style={{ border: '1px solid var(--color-border-ghost)', background: 'transparent', color: 'var(--color-text-secondary)', borderRadius: 9, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )
              ) : (
                // A past / already-analyzed day: re-analyze + recap, side by side.
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => { void handleAnalyze() }}
                    style={{ border: '1px solid var(--color-border-ghost)', background: 'transparent', color: 'var(--color-text-secondary)', borderRadius: 10, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Re-analyze with AI
                  </button>
                  <button
                    type="button"
                    onClick={() => { void handleGenerateRecap() }}
                    disabled={recapLoading}
                    style={{ border: '1px solid var(--color-border-ghost)', background: 'transparent', color: 'var(--color-text-secondary)', borderRadius: 10, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: recapLoading ? 'default' : 'pointer', opacity: recapLoading ? 0.6 : 1 }}
                  >
                    {recapLoading ? 'Generating…' : recap ? 'Regenerate recap' : 'Generate recap'}
                  </button>
                </div>
              )}
              {analyzeStatus && !analyzing && (
                <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}>
                  {analyzeStatus}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// The block detail in the persistent right panel: clicking a block swaps the
// right column from the day recap to this READ-ONLY view — color chip +
// title, the date/time line, type tags, the summary, and the app/site
// evidence underneath — and clicking anywhere outside the block swaps it
// back (founder decision, Jul 2, 2026, reverting the floating event card:
// nothing ever floats over the timeline). Selection state lives in Timeline;
// this component just renders the selected block. No edit controls live
// here: editing happens exclusively through right-click → Edit, which opens
// the separate editor modal.
function BlockDetailInspector({
  block,
  payload,
  onSelectBlock,
  onClose,
  mergeSelection,
  onMerged,
  onRefresh,
}: {
  block: WorkContextBlock
  payload: DayTimelinePayload
  onSelectBlock?: (blockId: string) => void
  onClose: () => void
  // The blocks in the current shift-selected span (ordered, includes the anchor).
  // Length ≥ 2 means a merge is on the table.
  mergeSelection: WorkContextBlock[]
  // Called after a successful merge with the merged span's start time, so the
  // timeline can collapse the selection back onto the single merged block.
  onMerged: (mergedStartTime: number) => void
  onRefresh: () => Promise<void>
}) {
  const [merging, setMerging] = useState(false)
  const [boundaryError, setBoundaryError] = useState<string | null>(null)

  useEffect(() => {
    setBoundaryError(null)
  }, [block.id])

  const accent = activityColorForCategory(block.dominantCategory)
  // A provisional (live, not-yet-analyzed) block is never merged — that
  // control appears once the day is analyzed (timeline.md §4).

  // A merge is on the table once the user has shift-selected a second block.
  // Blocks are continuous time, so the span the user sees highlighted — first
  // through last — is exactly what fuses, in-between blocks included.
  const mergeStart = mergeSelection[0] ?? null
  const mergeEnd = mergeSelection[mergeSelection.length - 1] ?? null
  const hasMergeSpan = mergeSelection.length >= 2 && mergeStart != null && mergeEnd != null
  const mergeHasLiveBlock = mergeSelection.some((candidate) => candidate.provisional)

  const mergeSelectedBlocks = async () => {
    if (!hasMergeSpan || !mergeStart || !mergeEnd) return
    setMerging(true)
    setBoundaryError(null)
    try {
      await ipc.db.mergeTimelineEpisodes({ blockIds: [mergeStart.id, mergeEnd.id], date: payload.date })
      daySummaryRecapCache.delete(payload.date)
      // Hand the merged span's start time back so the timeline can reselect the
      // single block that now covers it (block ids change when the span fuses).
      onMerged(mergeStart.startTime)
      await onRefresh()
    } catch (error) {
      setBoundaryError(sanitizeIpcError(error, "Couldn't merge these blocks. Try again in a moment.").message)
    } finally {
      setMerging(false)
    }
  }

  // One evidence view (timeline.md §2/§3.0): the apps, sites, and files behind
  // the block, in a single list sorted by time — the old "Apps used" and "Key
  // artifacts" merged into one. Work-first ordering falls out of sorting by
  // seconds. Off-task evidence is split out below as side trips (§6).
  type EvidenceRow = {
    key: string
    name: string
    detail: string | null
    seconds: number
    icon: ReactNode
    onOpen?: () => void
    offTask: boolean
  }
  const isOffTaskCategory = (category: AppCategory): boolean =>
    category === 'entertainment' || category === 'social'
  const appRows: EvidenceRow[] = block.topApps.slice(0, 8).map((app) => ({
    key: `app:${app.bundleId}`,
    name: formatDisplayAppName(app.appName),
    detail: categoryLabel(app.category),
    seconds: app.totalSeconds,
    icon: <AppIcon bundleId={app.bundleId} appName={app.appName} size={24} fontSize={10} color={accent} />,
    offTask: isOffTaskCategory(app.category),
  }))
  const artifactRows: EvidenceRow[] = block.topArtifacts.slice(0, 8).map((artifact) => ({
    key: `art:${artifact.id}`,
    name: safeTimelineText(artifact.displayTitle.trim()),
    detail: artifact.subtitle || artifact.host || artifact.path || null,
    seconds: artifact.totalSeconds,
    icon: (
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
        size={24}
      />
    ),
    onOpen: artifact.openTarget.kind === 'unsupported' || !artifact.openTarget.value ? undefined : () => void openArtifact(artifact),
    // A page artifact on a leisure host (a YouTube/Netflix tab that leaked into
    // the block's evidence) is a side trip, mirroring how site rows are routed.
    offTask: kindForDomain(artifact.host) === 'leisure',
  }))
  // Sites already represented by an artifact row are not repeated.
  const artifactHosts = new Set(block.topArtifacts.map((a) => a.host?.toLowerCase()).filter(Boolean) as string[])
  const siteRows: EvidenceRow[] = block.websites
    .filter((site) => !artifactHosts.has(site.domain.toLowerCase()))
    .slice(0, 8)
    .map((site) => ({
      key: `site:${site.domain}`,
      name: shortDomainLabel(site.domain),
      detail: site.topTitle?.trim() || null,
      seconds: site.totalSeconds,
      icon: <EntityIcon artifactType="page" domain={site.domain} title={site.domain} size={24} />,
      offTask: kindForDomain(site.domain) === 'leisure',
    }))
  const allEvidence = [...appRows, ...artifactRows, ...siteRows].sort((a, b) => b.seconds - a.seconds)
  const evidence = allEvidence.filter((row) => !row.offTask)
  // "Detours" (§6): where ACTIVE time went elsewhere inside this block — the
  // leisure sites and apps you were actually in. Idle/away time is never a
  // detour (founder rule, Jul 2, 2026): it isn't something you were "in", it's
  // the absence of activity, and it renders as blank space on the grid instead.
  const detours = allEvidence.filter((row) => row.offTask)
  const detourSeconds = detours.reduce((sum, row) => sum + row.seconds, 0)

  // The block's type tag + how the time inside splits by category. Real facts,
  // compactly: "Focused work" · Development 2h 10m · AI tools 40m.
  const typeTag = blockTypeTag(block)
  const categorySplit = Object.entries(block.categoryDistribution ?? {})
    .filter((entry): entry is [AppCategory, number] => typeof entry[1] === 'number' && entry[1] >= 60)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  const renderEvidenceRow = (row: EvidenceRow, dimmed: boolean) => {
    const content = (
      <>
        {row.icon}
        <div style={{ flex: 1, minWidth: 0 }}>
          <InlineRevealText
            text={row.name}
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}
          />
          {row.detail && (
            <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.detail}</div>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {formatDuration(row.seconds)}
        </div>
      </>
    )
    const baseStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', minWidth: 0, opacity: dimmed ? 0.6 : 1 }
    if (row.onOpen) {
      return (
        <button key={row.key} type="button" onClick={row.onOpen} style={{ ...baseStyle, border: 'none', background: 'transparent', padding: 0, textAlign: 'left', cursor: 'pointer' }}>
          {content}
        </button>
      )
    }
    return <div key={row.key} style={baseStyle}>{content}</div>
  }

  const iconButtonStyle = (disabled = false): CSSProperties => ({
    width: 32,
    height: 32,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    border: 'none',
    background: 'transparent',
    color: 'var(--color-text-secondary)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  })
  const iconHover = {
    onMouseEnter: (e: ReactMouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'var(--color-surface-high)' },
    onMouseLeave: (e: ReactMouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'transparent' },
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
      padding: '10px 22px 22px',
    }}>
      {/* Read-only panel: close is the only control here — it returns the
          panel to the day summary. Editing goes through right-click → Edit
          (the separate editor modal), never this view. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 2, marginBottom: 2 }}>
        <button type="button" aria-label="Back to day summary" title="Back to day summary" onClick={onClose} style={iconButtonStyle()} {...iconHover}>
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        {/* Color chip + title, GCal event-card style. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 4, background: accent, flexShrink: 0, marginTop: 5 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              title={userVisibleBlockLabel(block)}
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--color-text-primary)',
                lineHeight: 1.3,
                overflowWrap: 'break-word',
                wordBreak: 'break-word',
              }}
            >
              {userVisibleBlockLabel(block)}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 4 }}>
              {formatFullDate(payload.date)} ⋅ {formatClockTime(block.startTime)} – {formatClockTime(block.endTime)} · {formatDuration(blockActiveSeconds(block))}
            </div>
          </div>
        </div>
        {/* What kind of block this was, and how the time inside splits. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 10, paddingLeft: 26 }}>
          <span style={{
            padding: '3px 9px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            color: accent,
            background: `${accent}1c`,
            border: `1px solid ${accent}40`,
          }}>
            {typeTag}
          </span>
          {categorySplit.map(([category, seconds]) => (
            <span key={category} style={{
              padding: '3px 9px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--color-text-tertiary)',
              border: '1px solid var(--color-border-ghost)',
            }}>
              {categoryLabel(category)} · {formatDuration(seconds)}
            </span>
          ))}
        </div>
        {mergeStart && mergeEnd && mergeSelection.length >= 2 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            <button
              type="button"
              aria-label={`Merge ${mergeSelection.length} blocks into one, ${formatClockTime(mergeStart.startTime)} to ${formatClockTime(mergeEnd.endTime)}`}
              disabled={merging || mergeHasLiveBlock}
              onClick={() => { void mergeSelectedBlocks() }}
              style={{ border: 'none', background: accent, color: '#fff', fontSize: 12, fontWeight: 700, cursor: (merging || mergeHasLiveBlock) ? 'default' : 'pointer', padding: '4px 12px', borderRadius: 8, opacity: mergeHasLiveBlock ? 0.5 : 1 }}
            >
              {merging ? 'Merging…' : `Merge ${mergeSelection.length} blocks`}
            </button>
            <button
              type="button"
              onClick={() => onSelectBlock?.(block.id)}
              disabled={merging}
              style={{ border: '1px solid var(--color-border-ghost)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 600, cursor: merging ? 'default' : 'pointer', padding: '4px 10px', borderRadius: 8 }}
            >
              Cancel
            </button>
          </div>
        )}
        {mergeStart && mergeEnd && mergeSelection.length >= 2 && (
          <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
            {mergeHasLiveBlock
              ? 'This selection includes a live block — give it a moment to settle, then merge.'
              : `Fuses ${formatClockTime(mergeStart.startTime)} – ${formatClockTime(mergeEnd.endTime)} into one block.`}
          </div>
        )}
        {mergeSelection.length < 2 && !block.provisional && payload.blocks.length > 1 && (
          <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
            Tip: Shift-click another block to merge them. Right-click the block to edit it.
          </div>
        )}
      </div>

      {boundaryError && (
        <div style={{ fontSize: 11.5, lineHeight: 1.5, color: '#f87171', marginBottom: 12 }}>{boundaryError}</div>
      )}

      {/* The block's summary — AI narrative once it lands, deterministic
          fallback before, same rule the block card follows. */}
      <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--color-text-secondary)', margin: '0 0 20px' }}>
        {blockNarrative(block) ?? blockShortSummary(block)}
      </p>

      <div style={{ display: 'grid', gap: 18 }}>
        {evidence.length > 0 && (
          <section>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', color: 'var(--color-text-tertiary)', marginBottom: 10, textTransform: 'uppercase' }}>
              What you were in
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {evidence.map((row) => renderEvidenceRow(row, false))}
            </div>
          </section>
        )}

        {/* Where active time went elsewhere inside this window: the leisure
            detours you were actually in. Honest, not a grade. Idle/away time
            never appears here — it isn't a detour, it's blank space. */}
        {detours.length > 0 && (
          <section>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>
                Detours
              </div>
              {detourSeconds > 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatDuration(detourSeconds)}
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {detours.map((row) => renderEvidenceRow(row, true))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

// The week as a real calendar grid: seven day columns on a shared 24-hour
// track, Google-Calendar shape, Daylens data. The stats + week review card
// keeps living underneath, computed from the same blocks the grid draws so
// the totals cannot disagree with what's on screen.
function CalendarWeekView({
  selectedDate,
  onSelectDate,
  onOpenBlock,
  nowMs,
  scrollerRef,
}: {
  selectedDate: string
  onSelectDate: (date: string) => void
  onOpenBlock: (date: string, startTime: number) => void
  nowMs: number
  scrollerRef: React.RefObject<HTMLDivElement | null>
}) {
  const weekStart = getWeekStart(selectedDate)
  const today = todayString()
  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index)), [weekStart])
  const includesToday = dates.includes(today)

  const weekResource = useProjectionResource<DayTimelinePayload[]>({
    scope: 'timeline',
    dependencies: [weekStart],
    intervalMs: includesToday ? 30_000 : 0,
    load: () => Promise.all(dates.map((date) => ipc.db.getTimelineDay(date))),
  })

  const expectedWeekReviewScopeKey = `week:${weekStart}`
  const weekReviewResource = useProjectionResource<AISurfaceSummary | null>({
    scope: 'timeline',
    dependencies: [weekStart],
    intervalMs: 0,
    load: () => ipc.ai.getWeekReview(weekStart).catch(() => null),
  })
  const [generatingWeekReview, setGeneratingWeekReview] = useState(false)

  const days = useMemo(() => weekResource.data ?? [], [weekResource.data])
  const byDate = useMemo(() => new Map(days.map((payload) => [payload.date, payload])), [days])
  const rawWeekReview = weekReviewResource.data ?? null
  const weekReview = rawWeekReview && rawWeekReview.scopeKey === expectedWeekReviewScopeKey
    ? rawWeekReview
    : null

  const handleGenerateWeekReview = useCallback(async () => {
    setGeneratingWeekReview(true)
    try {
      await ipc.ai.getWeekReview(weekStart, true).catch(() => null)
      await weekReviewResource.refresh()
    } finally {
      setGeneratingWeekReview(false)
    }
  }, [weekStart, weekReviewResource])

  // Every number below comes from the same blocks the grid draws.
  const dayTotals = dates.map((date) => {
    const blocks = byDate.get(date)?.blocks ?? []
    return { date, seconds: blocks.reduce((sum, block) => sum + blockActiveSeconds(block), 0), blocks }
  })
  const activeDays = dayTotals.filter((day) => day.seconds > 0)
  const totalWeekSeconds = activeDays.reduce((sum, day) => sum + day.seconds, 0)
  const averageTrackedSeconds = activeDays.length > 0 ? Math.round(totalWeekSeconds / activeDays.length) : 0
  const mostActiveDay = activeDays.length > 0
    ? activeDays.reduce((best, day) => day.seconds > best.seconds ? day : best)
    : null
  const topWeekCategory = [...dayTotals
    .flatMap((day) => day.blocks)
    .reduce<Map<AppCategory, number>>((map, block) => {
      map.set(block.dominantCategory, (map.get(block.dominantCategory) ?? 0) + blockActiveSeconds(block))
      return map
    }, new Map())
    .entries()]
    .sort((left, right) => right[1] - left[1])[0] ?? null

  // The shared hour scale covers only the hours the week actually lived in
  // (first tracked event to last across all seven days), so there is no dead
  // space to scroll through — the grid starts where the week starts.
  const weekBounds = useMemo(
    () => trackBoundsFor(days.map((payload) => ({ date: payload.date, blocks: payload.blocks })), includesToday ? nowMs : null),
    [days, includesToday, nowMs],
  )
  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller) scroller.scrollTop = 0
  }, [weekStart, scrollerRef])

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* The week grid sits directly on the page background — no wrapping card. */}
      <div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `${TIME_GUTTER_WIDTH}px repeat(7, minmax(0, 1fr))`,
          borderBottom: '1px solid var(--color-border-ghost)',
        }}>
          <div />
          {dates.map((date) => {
            const [y, m, d] = date.split('-').map(Number)
            const isToday = date === today
            return (
              <button
                key={`head:${date}`}
                type="button"
                onClick={() => onSelectDate(date)}
                title={`Open ${formatFullDate(date)}`}
                style={{
                  border: 'none',
                  borderLeft: '1px solid var(--color-border-ghost)',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: '10px 4px 8px',
                  textAlign: 'center',
                  minWidth: 0,
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>
                  {new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(y, m - 1, d))}
                </div>
                <div style={{
                  margin: '4px auto 0',
                  width: 26,
                  height: 26,
                  lineHeight: '26px',
                  borderRadius: '50%',
                  fontSize: 13,
                  fontWeight: 700,
                  color: isToday ? 'var(--color-primary-contrast)' : 'var(--color-text-primary)',
                  background: isToday ? 'var(--gradient-primary)' : 'transparent',
                }}>
                  {d}
                </div>
              </button>
            )
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: `${TIME_GUTTER_WIDTH}px repeat(7, minmax(0, 1fr))` }}>
          <HourGutter hourHeight={WEEK_HOUR_HEIGHT} bounds={weekBounds} />
          {dates.map((date) => (
            <div key={`col:${date}`} style={{ borderLeft: '1px solid var(--color-border-ghost)', minWidth: 0 }}>
              <CalendarDayTrack
                date={date}
                blocks={byDate.get(date)?.blocks ?? []}
                bounds={weekBounds}
                hourHeight={WEEK_HOUR_HEIGHT}
                compact
                nowMs={date === today ? nowMs : null}
                onBlockClick={(block) => onOpenBlock(date, block.startTime)}
              />
            </div>
          ))}
        </div>
      </div>

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
              {mostActiveDay ? formatDuration(mostActiveDay.seconds) : '0m'}
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
              {topWeekCategory ? categoryLabel(topWeekCategory[0]) : 'No data'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
              {topWeekCategory ? formatDuration(topWeekCategory[1]) : 'Waiting for tracked time'}
            </div>
          </div>
        </div>

        <div style={{
          borderTop: '1px solid var(--color-border-ghost)',
          paddingTop: 14,
          display: 'grid',
          gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', color: 'var(--color-text-tertiary)' }}>
              Week review
            </div>
            <button
              type="button"
              onClick={() => void handleGenerateWeekReview()}
              disabled={generatingWeekReview || weekReviewResource.loading}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid var(--color-border-ghost)',
                background: 'var(--color-surface-low)',
                color: 'var(--color-text-secondary)',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: generatingWeekReview || weekReviewResource.loading ? 'default' : 'pointer',
                opacity: generatingWeekReview || weekReviewResource.loading ? 0.6 : 1,
              }}
            >
              {generatingWeekReview ? 'Generating…' : weekReview ? 'Refresh' : 'Generate'}
            </button>
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--color-text-secondary)' }}>
            {generatingWeekReview
              ? 'Generating a grounded review for this week…'
              : weekReview
                ? weekReview.summary
                : weekReviewResource.loading
                  ? 'Checking for a saved review…'
                  : 'No saved review for this week yet. Click Generate to summarize what happened.'}
          </div>
        </div>
      </div>
    </div>
  )
}

// The month as a day-cell grid: full Monday-start weeks, each cell listing
// the day's first blocks plus its tracked total. Fed by the lightweight
// range-blocks read over the same persisted blocks the day view renders;
// today's cell comes from the live day payload so the two views agree.
function CalendarMonthView({
  selectedDate,
  onSelectDate,
}: {
  selectedDate: string
  onSelectDate: (date: string) => void
}) {
  const key = monthKey(selectedDate)
  const gridDates = useMemo(() => monthGridDates(selectedDate), [selectedDate])
  const today = todayString()
  const from = gridDates[0]
  const to = gridDates[gridDates.length - 1]
  const includesToday = from <= today && today <= to

  const monthResource = useProjectionResource<CalendarRangeDay[]>({
    scope: 'timeline',
    dependencies: [key],
    intervalMs: includesToday ? 60_000 : 0,
    load: async () => {
      const rangeDays = await ipc.db.getTimelineRangeBlocks(from, to)
      if (!includesToday) return rangeDays
      // Today is still live (not persisted) — read it from the same day
      // payload the day view renders so the month cell can't disagree.
      const todayPayload = await ipc.db.getTimelineDay(today)
      const todayBlocks: CalendarRangeBlock[] = todayPayload.blocks.map((block) => ({
        id: block.id,
        date: today,
        startTime: block.startTime,
        endTime: block.endTime,
        dominantCategory: block.dominantCategory,
        label: userVisibleBlockLabel(block),
        kind: effectiveBlockKind(block),
        activeSeconds: blockActiveSeconds(block),
      }))
      const rest = rangeDays.filter((day) => day.date !== today)
      if (todayBlocks.length === 0) return rest
      return [...rest, {
        date: today,
        blocks: todayBlocks,
        activeSeconds: todayBlocks.reduce((sum, block) => sum + block.activeSeconds, 0),
      }]
    },
  })

  const byDate = useMemo(
    () => new Map((monthResource.data ?? []).map((day) => [day.date, day])),
    [monthResource.data],
  )

  const weekdayNames = useMemo(() => gridDates.slice(0, 7).map((date) => {
    const [y, m, d] = date.split('-').map(Number)
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(y, m - 1, d))
  }), [gridDates])

  return (
    <div style={{
      borderRadius: 16,
      border: '1px solid var(--color-border-ghost)',
      background: 'var(--color-surface)',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
        {weekdayNames.map((name) => (
          <div key={`wd:${name}`} style={{
            padding: '10px 10px 8px',
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-text-tertiary)',
            textAlign: 'right',
            borderBottom: '1px solid var(--color-border-ghost)',
          }}>
            {name}
          </div>
        ))}
        {gridDates.map((date, index) => {
          const day = byDate.get(date)
          const blocks = day?.blocks ?? []
          const inMonth = monthKey(date) === key
          const isToday = date === today
          const isFuture = date > today
          const shown = blocks.slice(0, 3)
          const dayNumber = Number(date.split('-')[2])
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelectDate(date)}
              title={`Open ${formatFullDate(date)}`}
              style={{
                border: 'none',
                borderLeft: index % 7 === 0 ? 'none' : '1px solid var(--color-border-ghost)',
                borderTop: index < 7 ? 'none' : '1px solid var(--color-border-ghost)',
                background: 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                padding: '8px 8px 10px',
                minHeight: 118,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                // Buttons don't stretch their flex children by default
                // (UA style), so without this a nowrap row keeps its content
                // width and bleeds across the neighbouring cells.
                alignItems: 'stretch',
                overflow: 'hidden',
                gap: 4,
                opacity: inMonth ? 1 : 0.4,
              }}
            >
              <div style={{ alignSelf: 'flex-end' }}>
                <span style={{
                  display: 'inline-block',
                  minWidth: 24,
                  height: 24,
                  lineHeight: '24px',
                  borderRadius: '50%',
                  textAlign: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: isToday ? 'var(--color-primary-contrast)' : isFuture ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                  background: isToday ? 'var(--gradient-primary)' : 'transparent',
                }}>
                  {dayNumber}
                </span>
              </div>
              {shown.map((block) => (
                <div key={block.id} style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, opacity: block.kind !== 'work' ? 0.7 : 1 }}>
                  <span style={{
                    flexShrink: 0,
                    width: 7,
                    height: 7,
                    borderRadius: 2,
                    background: activityColorForCategory(block.dominantCategory),
                  }} />
                  <span style={{ flexShrink: 0, fontSize: 10.5, color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatClockTime(block.startTime)}
                  </span>
                  <span style={{
                    fontSize: 11,
                    color: 'var(--color-text-secondary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                  }}>
                    {block.label}
                  </span>
                </div>
              ))}
              {blocks.length > shown.length && (
                <div style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)' }}>
                  +{blocks.length - shown.length} more
                </div>
              )}
              {day && day.activeSeconds > 0 && (
                <div style={{ marginTop: 'auto', fontSize: 10.5, fontWeight: 650, color: 'var(--color-text-tertiary)' }}>
                  {formatDuration(day.activeSeconds)} tracked
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function Timeline() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  // The far end of a shift-selected merge span. Null means a plain single
  // selection; set means "select everything between the anchor and here".
  const [mergeRangeEndId, setMergeRangeEndId] = useState<string | null>(null)
  const [isCompact, setIsCompact] = useState(() => window.innerWidth < 1120)
  const [navState, setNavState] = useState<TimelineNavState>(() => timelineNavStateFromParams(searchParams))
  // Clock tick for the current-time line and the live block's growing bottom
  // edge — 30s keeps the active session visibly moving between data refreshes.
  const [nowMs, setNowMs] = useState(() => Date.now())
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lastTimelineOpenKeyRef = useRef<string | null>(null)
  const lastBlockOpenKeyRef = useRef<string | null>(null)
  // After a merge the old block ids vanish; we stash the merged span's start
  // time so the next payload can reselect the single block that now covers it.
  const pendingSelectAtRef = useRef<number | null>(null)

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

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000)
    return () => window.clearInterval(timer)
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

  const blockMap = useMemo(() => {
    const map = new Map<string, WorkContextBlock>()
    for (const block of payload?.blocks ?? []) {
      map.set(block.id, block)
    }
    return map
  }, [payload])

  // Blocks sorted by start — the order shift-selection ranges over.
  const sortedBlocks = useMemo(
    () => [...(payload?.blocks ?? [])].sort((a, b) => a.startTime - b.startTime),
    [payload],
  )

  // The day track runs from the first tracked event to the last (or "now" on
  // today) — hours with no activity are simply not part of the view.
  const dayBounds = useMemo(
    () => trackBoundsFor(payload ? [{ date: payload.date, blocks: sortedBlocks }] : [], isToday ? nowMs : null),
    [payload, sortedBlocks, isToday, nowMs],
  )

  // The GCal-style right-click menu on a block: position + the block it's for.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; blockId: string } | null>(null)
  // The block being edited in the editor modal (right-click → Edit). The
  // read-only detail panel never hosts edit controls.
  const [editBlockId, setEditBlockId] = useState<string | null>(null)
  const [menuBusy, setMenuBusy] = useState(false)

  // Filter the day by block type ("Focused work", "Meeting", "Leisure"…).
  // Filtering dims the other blocks in place — the day's shape stays honest.
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const dayTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const block of sortedBlocks) {
      if (block.provisional) continue
      const tag = blockTypeTag(block)
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [sortedBlocks])

  // The contiguous span the user has selected: just the anchor for a plain
  // click, or the inclusive run of blocks between the anchor and the
  // shift-clicked end. Everything in here renders selected and merges together.
  const mergeSelection = useMemo<WorkContextBlock[]>(() => {
    if (!selectedBlockId) return []
    const anchor = blockMap.get(selectedBlockId)
    if (!anchor) return []
    if (!mergeRangeEndId || mergeRangeEndId === selectedBlockId || !blockMap.has(mergeRangeEndId)) return [anchor]
    const i = sortedBlocks.findIndex((candidate) => candidate.id === selectedBlockId)
    const j = sortedBlocks.findIndex((candidate) => candidate.id === mergeRangeEndId)
    if (i < 0 || j < 0) return [anchor]
    const [lo, hi] = i <= j ? [i, j] : [j, i]
    return sortedBlocks.slice(lo, hi + 1)
  }, [selectedBlockId, mergeRangeEndId, blockMap, sortedBlocks])

  const selectedSpanIds = useMemo(
    () => new Set(mergeSelection.map((candidate) => candidate.id)),
    [mergeSelection],
  )

  useEffect(() => {
    if (!selectedBlockId) return
    if (blockMap.has(selectedBlockId)) return
    setSelectedBlockId(null)
  }, [payload, selectedBlockId, blockMap])

  // Drop a stale range end the moment its block leaves the day (e.g. after a
  // rebuild) so the selection collapses cleanly to the anchor.
  useEffect(() => {
    if (mergeRangeEndId && !blockMap.has(mergeRangeEndId)) setMergeRangeEndId(null)
  }, [blockMap, mergeRangeEndId])

  useEffect(() => {
    setSelectedBlockId(null)
    setMergeRangeEndId(null)
    setTagFilter(null)
  }, [date])

  // Escape steps the selection down: first it drops a multi-block merge span,
  // then it deselects entirely. While the context menu or editor modal is
  // open, Escape belongs to that overlay — it must not also touch selection.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (contextMenu || editBlockId) return
      if (mergeRangeEndId) setMergeRangeEndId(null)
      else if (selectedBlockId) setSelectedBlockId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mergeRangeEndId, selectedBlockId, contextMenu, editBlockId])

  // Once the post-merge payload lands, reselect the single block now covering
  // the merged span and clear the pending marker.
  useEffect(() => {
    const at = pendingSelectAtRef.current
    if (at == null || !payload) return
    const hit = payload.blocks.find((candidate) => at >= candidate.startTime && at <= candidate.endTime)
      ?? payload.blocks.find((candidate) => candidate.startTime >= at)
    if (hit) {
      pendingSelectAtRef.current = null
      setSelectedBlockId(hit.id)
    }
  }, [payload])

  // Past days, week, and month open at the top (their tracks are clamped to
  // the tracked hours, so the top is the first tracked event). Today's day
  // view instead anchors on the live "Active now" block once the payload
  // lands — the user opens the timeline to see what is happening now, not the
  // empty morning above it. Anchor once per view/date so 30s refreshes never
  // fight the user's own scrolling.
  const anchoredKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const key = `${view}:${date}`
    if (anchoredKeyRef.current === key) return
    if (view !== 'day' || !isToday) {
      anchoredKeyRef.current = key
      node.scrollTop = 0
      return
    }
    if (!payload) return // wait for the day to land, then anchor once
    anchoredKeyRef.current = key
    const liveBlock = payload.blocks.find((block) => block.isLive)
    const el = liveBlock
      ? node.querySelector<HTMLElement>(`[data-timeline-block-id="${liveBlock.id}"]`)
      : null
    if (el) el.scrollIntoView({ block: 'center' })
    else node.scrollTop = 0
  }, [view, date, isToday, payload])

  useEffect(() => {
    const openKey = view === 'week'
      ? `week:${date}`
      : view === 'month'
        ? `month:${monthKey(date)}`
        : payload
          ? `day:${payload.date}:${payload.blocks.length}:${payload.totalSeconds}`
          : null
    if (!openKey || lastTimelineOpenKeyRef.current === openKey) return
    lastTimelineOpenKeyRef.current = openKey
    track(ANALYTICS_EVENT.TIMELINE_OPENED, {
      block_count_bucket: blockCountBucket(payload?.blocks.length ?? 0),
      surface: 'timeline',
      tracked_time_bucket: trackedTimeBucket(payload?.totalSeconds ?? 0),
      trigger: 'navigation',
      view,
    })
  }, [date, payload, view])

  const selectedBlock = selectedBlockId ? blockMap.get(selectedBlockId) ?? null : null

  // The day's typed gaps — each visible blank stretch with its reason
  // (Asleep / Away / Idle / Passive / Tracking paused / Untracked).
  const gapSegments = useMemo(
    () => (payload?.segments ?? []).filter((segment): segment is TimelineGapSegment => segment.kind !== 'work_block'),
    [payload],
  )

  // Right-click on a block (GCal-style). Selecting it first means the
  // inspector already shows the block the menu is acting on. Provisional
  // (not-yet-analyzed) blocks get the menu too — that's the common case on a
  // live day; the editor itself limits what a provisional block can change.
  const openBlockContextMenu = (block: WorkContextBlock, event: ReactMouseEvent) => {
    event.preventDefault()
    setSelectedBlockId(block.id)
    setMergeRangeEndId(null)
    setContextMenu({ x: event.clientX, y: event.clientY, blockId: block.id })
  }

  const menuRegenerate = async () => {
    if (!contextMenu || menuBusy) return
    setMenuBusy(true)
    try {
      await ipc.ai.regenerateBlockLabel(contextMenu.blockId)
      daySummaryRecapCache.delete(date)
      await timelineResource.refresh()
    } catch {
      // The inspector surfaces regenerate errors; the menu just closes.
    } finally {
      setMenuBusy(false)
      setContextMenu(null)
    }
  }

  const menuDelete = async () => {
    if (!contextMenu || menuBusy) return
    setMenuBusy(true)
    try {
      const { deleted } = await ipc.db.deleteTimelineBlock({ blockId: contextMenu.blockId, date })
      if (deleted) {
        daySummaryRecapCache.delete(date)
        setSelectedBlockId(null)
        await timelineResource.refresh()
      }
    } catch {
      // Native dialog cancelled or delete failed — nothing to clean up.
    } finally {
      setMenuBusy(false)
      setContextMenu(null)
    }
  }

  useEffect(() => {
    if (!selectedBlock) {
      lastBlockOpenKeyRef.current = null
      return
    }
    if (lastBlockOpenKeyRef.current === selectedBlock.id) return
    lastBlockOpenKeyRef.current = selectedBlock.id
    track(ANALYTICS_EVENT.TIMELINE_BLOCK_OPENED, {
      block_count_bucket: blockCountBucket(payload?.blocks.length ?? 0),
      surface: 'timeline',
      tracked_time_bucket: trackedTimeBucket(payload?.totalSeconds ?? 0),
      trigger: 'click',
      view,
    })
  }, [payload, selectedBlock, view])

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

  function setView(nextView: TimelineNavState['view']) {
    updateNavState({ view: nextView, date })
  }

  function setDate(nextDate: string) {
    updateNavState({ view, date: nextDate })
  }

  const today = todayString()
  const onCurrentPeriod = view === 'day'
    ? isToday
    : view === 'week'
      ? getWeekStart(date) === getWeekStart(today)
      : monthKey(date) === monthKey(today)
  const forwardDisabled = onCurrentPeriod

  const headerLabel = view === 'week'
    ? weekRangeLabel(date)
    : view === 'month'
      ? monthLabel(date)
      : isToday ? 'Today' : formatFullDate(date)

  function stepDate(direction: -1 | 1) {
    if (view === 'week') {
      setDate(shiftDate(getWeekStart(date), direction * 7))
    } else if (view === 'month') {
      setDate(shiftMonth(date, direction))
    } else {
      setDate(shiftDate(date, direction))
    }
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
      // Selection is deliberate two-state plumbing: clicking a block sets
      // selectedBlockId (the right panel renders that block's detail);
      // clicking anywhere that isn't a block, the inspector panel, or an
      // overlay (context menu / editor modal) clears it (the panel returns to
      // the day summary). Capture-phase on the view root so "anywhere
      // outside the block" means exactly that — header and empty space
      // included.
      onClickCapture={(event) => {
        const target = event.target as HTMLElement | null
        if (target?.closest('[data-timeline-inspector="true"]')) {
          return
        }
        const blockButton = target?.closest<HTMLElement>('[data-timeline-block-id]')
        const clickedId = blockButton?.dataset.timelineBlockId ?? null
        // Clicking empty space deselects everything.
        if (!clickedId) {
          setSelectedBlockId(null)
          setMergeRangeEndId(null)
          return
        }
        // Shift- (or Cmd-) click with something already selected extends
        // the selection into a merge span instead of replacing it.
        if ((event.shiftKey || event.metaKey) && selectedBlockId && clickedId !== selectedBlockId) {
          setMergeRangeEndId(clickedId)
          return
        }
        setMergeRangeEndId(null)
        if (clickedId !== selectedBlockId) {
          setSelectedBlockId(clickedId)
        }
      }}
    >
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: 'var(--color-bg)',
        borderBottom: '1px solid var(--color-border-ghost)',
        padding: '20px 32px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={() => stepDate(-1)}
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
            {headerLabel}
          </div>
          <button
            type="button"
            onClick={() => {
              if (!forwardDisabled) stepDate(1)
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
          {!onCurrentPeriod && (
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
            {(['day', 'week', 'month'] as const).map((mode) => (
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
                {mode === 'day' ? 'Day' : mode === 'week' ? 'Week' : 'Month'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
        {view === 'week' && (
          <div style={{ padding: '24px 32px 40px' }}>
            <CalendarWeekView
              selectedDate={date}
              nowMs={nowMs}
              scrollerRef={scrollRef}
              onSelectDate={(nextDate) => {
                updateNavState({ view: 'day', date: nextDate })
              }}
              onOpenBlock={(nextDate, startTime) => {
                // Open the day with that block selected: the pending marker is
                // resolved against the day payload once it lands (same
                // mechanism a merge uses to reselect its fused block).
                pendingSelectAtRef.current = startTime
                updateNavState({ view: 'day', date: nextDate })
              }}
            />
          </div>
        )}

        {view === 'month' && (
          <div style={{ padding: '24px 32px 40px' }}>
            <CalendarMonthView
              selectedDate={date}
              onSelectDate={(nextDate) => {
                updateNavState({ view: 'day', date: nextDate })
              }}
            />
          </div>
        )}

        {view === 'day' && (
          <div style={{ padding: '24px 32px 40px' }}>
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
                  <div key={index} style={{ display: 'grid', gridTemplateColumns: `${TIME_GUTTER_WIDTH}px minmax(0, 1fr)`, gap: 16 }}>
                    <div style={{ height: 20, borderRadius: 8, background: 'var(--color-surface-low)', opacity: 0.5 }} />
                    <div style={{ height: 110 - (index * 10), borderRadius: 16, background: 'var(--color-surface-low)', opacity: 0.5 }} />
                  </div>
                ))}
              </div>
            )}

            {!error && !loading && payload && (
              <>
                {/* Filter the day by block type. Dims the rest in place. */}
                {dayTags.length > 1 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 0 16px' }}>
                    {dayTags.map(([tag, count]) => {
                      const active = tagFilter === tag
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setTagFilter(active ? null : tag)}
                          style={{
                            padding: '4px 11px',
                            borderRadius: 999,
                            fontSize: 11.5,
                            fontWeight: 650,
                            cursor: 'pointer',
                            border: '1px solid var(--color-border-ghost)',
                            background: active ? 'var(--gradient-primary)' : 'var(--color-surface)',
                            color: active ? 'var(--color-primary-contrast)' : 'var(--color-text-secondary)',
                          }}
                        >
                          {tag} · {count}
                        </button>
                      )
                    })}
                  </div>
                )}

                {payload.blocks.length === 0 && (
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
                )}

                {payload.blocks.length > 0 && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: isCompact ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 360px',
                    gap: 24,
                    alignItems: 'start',
                  }}>
                    {/* Cards aren't text to select; killing user-select here keeps
                        shift-click from smearing a text highlight across the run. */}
                    {/* The grid renders directly on the page background — no card,
                        no border. Hour labels on the rail, blocks filling the rest. */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: `${TIME_GUTTER_WIDTH}px minmax(0, 1fr)`,
                        userSelect: 'none',
                      }}
                    >
                      <HourGutter hourHeight={DAY_HOUR_HEIGHT} bounds={dayBounds} />
                      <CalendarDayTrack
                        date={payload.date}
                        blocks={sortedBlocks}
                        bounds={dayBounds}
                        gapSegments={gapSegments}
                        hourHeight={DAY_HOUR_HEIGHT}
                        selectedBlockId={selectedBlockId}
                        selectedSpanIds={selectedSpanIds}
                        nowMs={isToday ? nowMs : null}
                        dimBlock={tagFilter ? (block) => blockTypeTag(block) !== tagFilter : undefined}
                        onBlockContextMenu={openBlockContextMenu}
                      />
                    </div>
                    {contextMenu && (
                      <BlockContextMenu
                        x={contextMenu.x}
                        y={contextMenu.y}
                        busy={menuBusy}
                        onEdit={() => {
                          setEditBlockId(contextMenu.blockId)
                          setContextMenu(null)
                        }}
                        onRegenerate={() => { void menuRegenerate() }}
                        onDelete={() => { void menuDelete() }}
                        onClose={() => { if (!menuBusy) setContextMenu(null) }}
                      />
                    )}
                    {editBlockId && blockMap.get(editBlockId) && (
                      <BlockEditModal
                        block={blockMap.get(editBlockId)!}
                        payload={payload}
                        onClose={() => setEditBlockId(null)}
                        onDeleted={() => {
                          setSelectedBlockId(null)
                          setMergeRangeEndId(null)
                        }}
                        onRefresh={timelineResource.refresh}
                      />
                    )}
                    {/* The right column is one panel with two mutually
                        exclusive states, keyed off selectedBlock: a selected
                        block shows its detail; no selection shows the day
                        summary. Nothing floats over the timeline. */}
                    {selectedBlock ? (
                      <BlockDetailInspector
                        block={selectedBlock}
                        payload={payload}
                        onRefresh={timelineResource.refresh}
                        onClose={() => {
                          setSelectedBlockId(null)
                          setMergeRangeEndId(null)
                        }}
                        mergeSelection={mergeSelection}
                        onMerged={(mergedStartTime) => {
                          pendingSelectAtRef.current = mergedStartTime
                          setMergeRangeEndId(null)
                          setSelectedBlockId(null)
                        }}
                        onSelectBlock={(blockId) => {
                          setMergeRangeEndId(null)
                          setSelectedBlockId(blockId)
                          requestAnimationFrame(() => {
                            const el = document.querySelector<HTMLElement>(`[data-timeline-block-id="${blockId}"]`)
                            el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          })
                        }}
                      />
                    ) : (
                      <DaySummaryInspector payload={payload} onRefresh={timelineResource.refresh} />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
