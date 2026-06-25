import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { ANALYTICS_EVENT, blockCountBucket, trackedTimeBucket } from '@shared/analytics'
import type { AIDaySummaryResult, AISurfaceSummary, AppCategory, DayTimelinePayload, TimelineGapSegment, TimelineSegment, WorkContextBlock } from '@shared/types'
import { blockActiveSeconds } from '@shared/blockDuration'
import { isArtifactCompatibleWithBlockCategory, naturalizeLabel, userVisibleBlockLabel } from '@shared/blockLabel'
import { isTrustedTimelineBlock } from '@shared/timelineReview'
import { effectiveBlockKind, kindForDomain } from '@shared/workKind'
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

// Human-readable phrasing for why an episode started or stopped.

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
  const naturalizedArtifact = rawArtifact ? naturalizeLabel(rawArtifact) || rawArtifact : null

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

const MIN_VISIBLE_GAP_SECONDS = 30 * 60
const LONG_GAP_ANCHOR_SECONDS = 75 * 60

// timeline.md §3.4 / invariant 1: a block is drawn as tall as it is long, so the
// shape of the day shows where time went before you read a label. Height is
// linear in active minutes. The engine's 15-minute floor is the shortest a block
// can be, and at this slope a 15-minute block clears the readable minimum, so the
// scale stays genuinely proportional (a 3-hour block is ~12× a 15-minute one)
// without squashing the short end. MIN_BLOCK_HEIGHT is a defensive floor for any
// sub-floor block (live/edge cases) so a card can always show its title + meta.
const PX_PER_MINUTE = 3.2
const MIN_BLOCK_HEIGHT = 48
// Below this height a card shows only its title + meta line; taller cards add the
// narrative so a short block stays legible instead of clipping mid-sentence.
const BLOCK_NARRATIVE_MIN_HEIGHT = 104

// Daylens won't shape a day into named blocks until there's enough to work with
// (founder decision: at least 2 hours tracked). Below this the Analyze action
// stays disabled with a gentle "keep going" nudge.
const ANALYZE_MIN_SECONDS = 2 * 60 * 60

// Lightly absurd statuses cycled while the AI shapes the day, so the wait feels
// like Daylens having fun rather than spinning.
const WRAP_LOADING_MESSAGES = [
  'Computing…',
  'Discombobulating…',
  'Untangling your tabs…',
  'Reticulating splines…',
  'Consulting the timeline…',
  'Making it make sense…',
]

// The day's tracked seconds, from the same blocks the timeline draws (invariant
// 7) with the raw total as a floor. Shared by the recap footer and the gate.
function trackedSecondsFor(payload: DayTimelinePayload): number {
  const blockSeconds = payload.blocks.reduce((sum, block) => sum + blockActiveSeconds(block), 0)
  return blockSeconds > 0 ? blockSeconds : payload.totalSeconds
}

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

    // Derived untracked spans (start/end of day, gaps between blocks) stay in the
    // payload but are not drawn — only real Away / Machine off breaks surface.
    if (segment.kind === 'idle_gap') continue

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

function SummaryStrip({ payload }: { payload: DayTimelinePayload }) {
  const trackedSeconds = payload.blocks.reduce((sum, block) => sum + blockActiveSeconds(block), 0)
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px 14px',
      padding: '0 0 18px',
      fontSize: 12.5,
      color: 'var(--color-text-tertiary)',
    }}>
      <span>
        <strong style={{ color: 'var(--color-text-primary)' }}>{formatDuration(trackedSeconds)}</strong> tracked
      </span>
      <span>{payload.blocks.length} block{payload.blocks.length !== 1 ? 's' : ''}</span>
      <span>{payload.appCount} app{payload.appCount !== 1 ? 's' : ''}</span>
      <span>{payload.siteCount} site{payload.siteCount !== 1 ? 's' : ''}</span>
    </div>
  )
}

const TimelineRow = memo(function TimelineRow({
  segment,
  block,
  isSelected,
  inMergeRange = false,
}: {
  segment: TimelineSegment
  block: WorkContextBlock | null
  isSelected: boolean
  // True for blocks caught inside a shift-selected merge span but not the open
  // (anchor) block — they get the selected highlight without the detail reveal.
  inMergeRange?: boolean
}) {
  const duration = formatDuration(segmentDurationSeconds(segment))

  if (!block) {
    const gapSegment = segment as TimelineGapSegment

    // Away / Machine off breaks read as thin dividers, not cards — labelled so
    // you know why the time is blank ("Away · 45m") without competing with blocks.
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '104px minmax(0, 1fr)', gap: 16, alignItems: 'center' }}>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'right' }}>
          {formatClockTime(gapSegment.startTime)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 0' }}>
          <div style={{ flex: '0 0 16px', borderTop: '1px dashed var(--color-border-ghost)' }} />
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
            {gapKindLabel(gapSegment.kind)} · {duration}
          </span>
          <div style={{ flex: 1, borderTop: '1px dashed var(--color-border-ghost)' }} />
        </div>
      </div>
    )
  }

  const accent = CATEGORY_COLORS[block.dominantCategory] ?? CATEGORY_COLORS.uncategorized
  // timeline.md §3.4 / invariant 1: a block is drawn as tall as it is long — a
  // 3-hour block towers over a 15-minute one. Height is linear in active minutes
  // (PX_PER_MINUTE), with MIN_BLOCK_HEIGHT only as a defensive floor for any
  // sub-floor block so its title and meta stay readable.
  const proportionalHeight = Math.max(MIN_BLOCK_HEIGHT, Math.round((blockActiveSeconds(block) / 60) * PX_PER_MINUTE))
  // A short card can't fit a narrative without clipping mid-sentence, so it shows
  // title + meta only; taller cards (or the open one) add the prose.
  const showNarrative = isSelected || proportionalHeight >= BLOCK_NARRATIVE_MIN_HEIGHT
  const ignored = block.review.state === 'ignored'
  // Leisure / personal rows are muted so the eye finds work first. Work is
  // full-strength; everything else recedes. This is the whole point of the
  // `kind` axis on the surface.
  const blockKind = effectiveBlockKind(block)
  const muted = blockKind !== 'work'
  const artifactLine = artifactSubtitle(block)
  const appsLine = block.topApps
    .slice(0, 3)
    .map((app) => formatDisplayAppName(app.appName))
    .join(' • ')

  return (
    <button
      type="button"
      data-timeline-block-id={block.id}
      aria-label={`Open ${userVisibleBlockLabel(block)}, ${duration}`}
      aria-pressed={isSelected}
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
        padding: '14px 16px 14px 18px',
        borderRadius: 16,
        // Both the open block and every block inside a merge span read as
        // selected; only the open one gets the lifted shadow so it stays primary.
        border: (isSelected || inMergeRange) ? `1px solid ${accent}55` : '1px solid var(--color-border-ghost)',
        background: (isSelected || inMergeRange) ? 'var(--color-surface-low)' : 'var(--color-surface)',
        boxShadow: isSelected ? '0 10px 30px rgba(0,0,0,0.10)' : 'none',
        transition: 'border-color 120ms, background 120ms',
        overflow: 'hidden',
        minWidth: 0,
        // Height is proportional to duration (the calendar invariant), but used
        // as a *floor* so a short block with a long, full title grows just enough
        // to show it instead of clipping. Tall blocks keep their exact
        // proportional height — their text never reaches this floor.
        minHeight: proportionalHeight,
        opacity: ignored ? 0.5 : muted ? 0.72 : 1,
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
        <div style={{ display: 'flex', alignItems: 'start', gap: 10, minWidth: 0, marginBottom: 6 }}>
          <div
            title={userVisibleBlockLabel(block)}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              lineHeight: 1.25,
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              overflow: 'hidden',
              overflowWrap: 'break-word',
              wordBreak: 'break-word',
            }}
          >
            {userVisibleBlockLabel(block)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {/* A provisional live block stays neutral — no category badge until
                the day is analyzed (timeline.md §4). */}
            {!block.provisional && (
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
            )}
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
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: showNarrative ? 8 : 0 }}>
          {formatClockTime(block.startTime)} – {formatClockTime(block.endTime)}
        </div>
        {showNarrative && (
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--color-text-secondary)', margin: '0 0 10px', overflowWrap: 'break-word', minWidth: 0 }}>
            {blockNarrative(block) ?? blockShortSummary(block)}
          </p>
        )}
        {isSelected && artifactLine && (
          <InlineRevealText
            text={artifactLine}
            style={{ fontSize: 12.5, color: 'var(--color-text-primary)', marginBottom: appsLine ? 6 : 0 }}
          />
        )}
        {isSelected && appsLine && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {block.topApps.slice(0, 2).map((app) => (
                <AppIcon
                  key={`${block.id}:${app.bundleId}`}
                  bundleId={app.bundleId}
                  appName={app.appName}
                  size={18}
                  fontSize={9}
                  color={accent}
                />
              ))}
            </div>
            <InlineRevealText
              text={appsLine}
              style={{ fontSize: 12, color: 'var(--color-text-tertiary)', flex: 1 }}
            />
          </div>
        )}
      </div>
    </button>
  )
})

function GapGroupRow({ segment }: { segment: Extract<DisplayTimelineSegment, { kind: 'gap_group' }> }) {
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

  const breakSummary = chips.map((chip) => `${chip.label} ${chip.duration}`).join(' · ')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '104px minmax(0, 1fr)', gap: 16, alignItems: 'center' }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'right' }}>
        {formatClockTime(segment.startTime)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 0' }}>
        <div style={{ flex: '0 0 16px', borderTop: '1px dashed var(--color-border-ghost)' }} />
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>{breakSummary}</span>
        <div style={{ flex: 1, borderTop: '1px dashed var(--color-border-ghost)' }} />
      </div>
    </div>
  )
}

const daySummaryRecapCache = new Map<string, AIDaySummaryResult>()

// Plain-English count line for the recap footer: "8 blocks · 12 apps · 9 sites".
function countSummaryLine(blockCount: number, appCount: number, siteCount: number): string {
  const parts = [
    `${blockCount} block${blockCount === 1 ? '' : 's'}`,
    `${appCount} app${appCount === 1 ? '' : 's'}`,
  ]
  if (siteCount > 0) parts.push(`${siteCount} site${siteCount === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

function DaySummaryInspector({ payload, onRefresh }: { payload: DayTimelinePayload; onSelectBlock?: (blockId: string) => void; onRefresh?: () => Promise<void> }) {
  const [recap, setRecap] = useState<AIDaySummaryResult | null>(null)
  const [recapLoading, setRecapLoading] = useState(false)
  const [recapError, setRecapError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeStatus, setAnalyzeStatus] = useState<string | null>(null)
  // The playful "done for the day?" confirm card, with its optional note box.
  const [wrapOpen, setWrapOpen] = useState(false)
  const [wrapNote, setWrapNote] = useState('')
  const [userName, setUserName] = useState<string>('')
  // Rotating, lightly absurd status while the AI shapes the day.
  const [loadingMsg, setLoadingMsg] = useState(WRAP_LOADING_MESSAGES[0])

  const isToday = payload.date === todayString()
  const provisional = payload.blocks.some((block) => block.provisional)
  // Daylens makes no claim about the day until it has enough to work with.
  const enoughToAnalyze = trackedSecondsFor(payload) >= ANALYZE_MIN_SECONDS
  const firstName = userName.trim().split(/\s+/)[0] ?? ''

  // Invariant 5: every number on the recap comes from the same blocks the
  // timeline draws. The headline tracked time is the sum of the blocks'
  // active seconds — never a separately-computed total that could disagree.
  const trackedSeconds = trackedSecondsFor(payload)
  const countLine = countSummaryLine(payload.blocks.length, payload.appCount, payload.siteCount)

  useEffect(() => {
    setAnalyzeStatus(null)
    setRecapError(null)
    setWrapOpen(false)
    setWrapNote('')
    const cached = daySummaryRecapCache.get(payload.date)
    setRecap(cached ?? null)
    setRecapLoading(false)
  }, [payload.date])

  // Load the user's name once so the wrap prompt can greet them by name.
  useEffect(() => {
    let alive = true
    void ipc.settings.get().then((s) => { if (alive) setUserName(s?.userName ?? '') })
    return () => { alive = false }
  }, [])

  // Cycle the funny loading copy every ~1.4s while analyzing; reset when idle.
  useEffect(() => {
    if (!analyzing) { setLoadingMsg(WRAP_LOADING_MESSAGES[0]); return }
    let i = 0
    const timer = setInterval(() => {
      i = (i + 1) % WRAP_LOADING_MESSAGES.length
      setLoadingMsg(WRAP_LOADING_MESSAGES[i])
    }, 1400)
    return () => clearInterval(timer)
  }, [analyzing])

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

  // A short, human summary of the day for the wrap prompt: "~3h across Cursor,
  // Chrome and 2 more". Grounded in the same totals the footer shows.
  const wrapSummary = (() => {
    const topApps = [...payload.blocks.flatMap((b) => b.topApps)]
      .reduce<Map<string, number>>((map, app) => {
        map.set(app.appName, (map.get(app.appName) ?? 0) + app.totalSeconds)
        return map
      }, new Map())
    const names = [...topApps.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => formatDisplayAppName(name))
    const lead = names.slice(0, 2).join(', ')
    const more = names.length > 2 ? ` and ${names.length - 2} more` : ''
    return `${formatDuration(trackedSeconds)} tracked${lead ? ` across ${lead}${more}` : ''}.`
  })()

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
          Nothing tracked yet. Daylens fills this in once the day has something to say.
        </div>
      ) : (
        <>
          {/* The recap leads — calm, grounded prose, Dia-style. */}
          {recap && recap.summary ? (
            <div style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--color-text-primary)' }}>
              {recap.summary}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10, justifyItems: 'start' }}>
              {provisional && (
                <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
                  Today is one block while it’s still going. When you wrap up, Daylens shapes it into named blocks and a recap.
                </div>
              )}
              {!provisional && (
                <button
                  type="button"
                  onClick={() => { void handleGenerateRecap() }}
                  disabled={recapLoading}
                  style={{
                    border: '1px solid var(--color-border-ghost)',
                    background: 'var(--color-surface-high)',
                    color: 'var(--color-text-primary)',
                    borderRadius: 10,
                    padding: '8px 13px',
                    fontSize: 13,
                    fontWeight: 650,
                    cursor: recapLoading ? 'default' : 'pointer',
                    opacity: recapLoading ? 0.6 : 1,
                  }}
                >
                  {recapLoading ? 'Generating recap…' : 'Generate recap'}
                </button>
              )}
            </div>
          )}

          {recapError && (
            <div style={{ fontSize: 11.5, lineHeight: 1.5, color: '#f87171' }}>{recapError}</div>
          )}

          {/* Counts footer — secondary to the prose. */}
          <div style={{ borderTop: '1px solid var(--color-border-ghost)', paddingTop: 14, display: 'grid', gap: 4 }}>
            <div style={{ fontSize: 15, fontWeight: 720, color: 'var(--color-text-primary)' }}>
              {formatDuration(trackedSeconds)} tracked
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>{countLine}</div>
          </div>

          {onRefresh && (
            <div style={{ display: 'grid', gap: 8, justifyItems: 'start', width: '100%' }}>
              {/* While analyzing, the whole control is the funny rotating status. */}
              {analyzing ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 650, color: 'var(--color-text-primary)' }}>
                  <span style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid var(--color-border-ghost)', borderTopColor: 'var(--color-text-secondary)', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                  {loadingMsg}
                </div>
              ) : provisional ? (
                // TODAY, unanalyzed: the playful "done for the day?" wrap flow,
                // gated until there's at least 2 hours to work with.
                !enoughToAnalyze ? (
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
                    Keep going{firstName ? `, ${firstName}` : ''}. Daylens needs about 2 hours before it can shape your day.
                  </div>
                ) : !wrapOpen ? (
                  <button
                    type="button"
                    onClick={() => setWrapOpen(true)}
                    style={{ justifySelf: 'start', border: 'none', background: 'var(--gradient-primary)', color: 'var(--color-primary-contrast)', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                  >
                    {firstName ? `Done for the day, ${firstName}? 😄` : 'Done for the day? 😄'}
                  </button>
                ) : (
                  <div style={{ display: 'grid', gap: 10, width: '100%', border: '1px solid var(--color-border-ghost)', borderRadius: 12, padding: 14, background: 'var(--color-surface-high)' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                      Wrapping up? 😄
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', lineHeight: 1.55 }}>
                      {wrapSummary} I’ll shape this into named blocks and a recap.
                    </div>
                    <textarea
                      value={wrapNote}
                      onChange={(event) => setWrapNote(event.target.value)}
                      placeholder="Optional: in a line, what were you actually working on today?"
                      rows={2}
                      style={{ width: '100%', resize: 'vertical', borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', padding: '8px 10px', fontSize: 12.5, outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => { void handleAnalyze(wrapNote) }}
                        style={{ border: 'none', background: 'var(--gradient-primary)', color: 'var(--color-primary-contrast)', borderRadius: 9, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Yes, wrap it up
                      </button>
                      <button
                        type="button"
                        onClick={() => { setWrapOpen(false); setWrapNote('') }}
                        style={{ border: '1px solid var(--color-border-ghost)', background: 'transparent', color: 'var(--color-text-secondary)', borderRadius: 9, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Not yet
                      </button>
                    </div>
                  </div>
                )
              ) : (
                // A past / already-analyzed day: plain re-analyze, no gate.
                <button
                  type="button"
                  onClick={() => { void handleAnalyze() }}
                  style={{ justifySelf: 'start', border: '1px solid var(--color-border-ghost)', background: 'transparent', color: 'var(--color-text-secondary)', borderRadius: 10, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                >
                  Re-analyze with AI
                </button>
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

function BlockInspector({
  block,
  payload,
  onRefresh,
  onSelectBlock,
  mergeSelection,
  onMerged,
}: {
  block: WorkContextBlock | null
  payload: DayTimelinePayload
  onRefresh: () => Promise<void>
  onSelectBlock?: (blockId: string) => void
  // The blocks in the current shift-selected span (ordered, includes the anchor).
  // Length ≥ 2 means a merge is on the table.
  mergeSelection: WorkContextBlock[]
  // Called after a successful merge with the merged span's start time, so the
  // timeline can collapse the selection back onto the single merged block.
  onMerged: (mergedStartTime: number) => void
}) {
  const [overrideDraft, setOverrideDraft] = useState('')
  const [overrideSaving, setOverrideSaving] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  const [boundaryError, setBoundaryError] = useState<string | null>(null)
  // The rename input is revealed only when the user clicks Rename — the panel
  // stays calm until then.
  const [renaming, setRenaming] = useState(false)
  // The "let AI name it" sparkle inside the rename row.
  const [suggesting, setSuggesting] = useState(false)

  useEffect(() => {
    setOverrideDraft(block?.label.override ?? block?.label.current ?? '')
    setReviewError(null)
    setBoundaryError(null)
    setRenaming(false)
    setSuggesting(false)
  }, [block?.id, block?.label.current, block?.label.override])

  if (!block) {
    return <DaySummaryInspector payload={payload} onSelectBlock={onSelectBlock} onRefresh={onRefresh} />
  }

  const accent = CATEGORY_COLORS[block.dominantCategory] ?? CATEGORY_COLORS.uncategorized
  const hasOverride = Boolean(block.label.override?.trim())
  // The name this block had before the user renamed it — shown so they can see
  // what changed and undo it (timeline.md acceptance: previous name + undo).
  const previousName = block.review.originalLabel?.trim()
    || block.label.aiSuggested?.trim()
    || block.label.ruleBased?.trim()
    || null
  // A provisional (live, not-yet-analyzed) block is never renamed or merged —
  // those controls appear once the day is analyzed (timeline.md §4).
  const correctable = !block.provisional

  // A merge is on the table once the user has shift-selected a second block.
  // Blocks are continuous time, so the span the user sees highlighted — first
  // through last — is exactly what fuses, in-between blocks included.
  const mergeStart = mergeSelection[0] ?? null
  const mergeEnd = mergeSelection[mergeSelection.length - 1] ?? null
  const hasMergeSpan = mergeSelection.length >= 2 && mergeStart != null && mergeEnd != null
  const mergeHasLiveBlock = mergeSelection.some((candidate) => candidate.provisional)

  // Fixing a block (rename / undo / merge) makes any generated recap that named
  // the old version stale — drop the cached recap for the day so it regenerates
  // against the corrected blocks (timeline.md acceptance: a fix refreshes the
  // recap). The backend already invalidates the insights projection scope.
  const invalidateDayRecap = () => { daySummaryRecapCache.delete(payload.date) }

  const mergeSelectedBlocks = async () => {
    if (!hasMergeSpan || !mergeStart || !mergeEnd) return
    setMerging(true)
    setBoundaryError(null)
    try {
      await ipc.db.mergeTimelineEpisodes({ blockIds: [mergeStart.id, mergeEnd.id], date: payload.date })
      invalidateDayRecap()
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

  const submitRename = () => {
    const label = overrideDraft.trim()
    if (!label || label === block.label.current) return
    setOverrideSaving(true)
    setReviewError(null)
    void ipc.db.setBlockLabelOverride({ blockId: block.id, date: payload.date, label, narrative: block.label.narrative })
      .then(() => { invalidateDayRecap(); return onRefresh() })
      .then(() => setRenaming(false))
      .catch((error) => setReviewError(sanitizeIpcError(error, "Couldn't save the rename. Try again in a moment.").message))
      .finally(() => setOverrideSaving(false))
  }

  const undoRename = () => {
    setOverrideSaving(true)
    setReviewError(null)
    void ipc.db.clearBlockLabelOverride(block.id)
      .then(() => { invalidateDayRecap(); return onRefresh() })
      .catch((error) => setReviewError(sanitizeIpcError(error, "Couldn't undo the rename. Try again in a moment.").message))
      .finally(() => setOverrideSaving(false))
  }

  // The sparkle in the rename row: ask the AI to write a fresh, accurate title
  // from the block's evidence and drop it into the input for the user to keep or
  // tweak before saving. The AI label is applied immediately (the model also
  // persists it), and a manual edit + Save still overrides it.
  const suggestName = async () => {
    if (suggesting) return
    setSuggesting(true)
    setReviewError(null)
    try {
      const insight = await ipc.ai.regenerateBlockLabel(block.id)
      const label = insight.label?.trim()
      if (label) setOverrideDraft(label)
      invalidateDayRecap()
      await onRefresh()
    } catch (error) {
      setReviewError(sanitizeIpcError(error, "Couldn't name this with AI. Try again in a moment.").message)
    } finally {
      setSuggesting(false)
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
  const sideTrips = allEvidence.filter((row) => row.offTask)

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
      <div style={{ marginBottom: 16 }}>
        {/* The title gets the full panel width — the Rename / Merge controls sit
            on their own row below so a long block name is never squeezed or
            clipped against the buttons. */}
        <div
          title={userVisibleBlockLabel(block)}
          style={{
            fontSize: 18,
            fontWeight: 750,
            color: 'var(--color-text-primary)',
            lineHeight: 1.3,
            marginBottom: 6,
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
          }}
        >
          {userVisibleBlockLabel(block)}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>
          {formatClockTime(block.startTime)} – {formatClockTime(block.endTime)} • {formatDuration(blockActiveSeconds(block))}
        </div>
        {(correctable || (mergeStart && mergeEnd && mergeSelection.length >= 2)) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {correctable && (
              <button
                type="button"
                onClick={() => setRenaming((value) => !value)}
                style={{ border: '1px solid var(--color-border-ghost)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 10px', borderRadius: 8 }}
              >
                Rename
              </button>
            )}
            {mergeStart && mergeEnd && mergeSelection.length >= 2 && (
              <>
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
              </>
            )}
          </div>
        )}
        {mergeStart && mergeEnd && mergeSelection.length >= 2 && (
          <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
            {mergeHasLiveBlock
              ? 'This selection includes a live block — give it a moment to settle, then merge.'
              : `Fuses ${formatClockTime(mergeStart.startTime)} – ${formatClockTime(mergeEnd.endTime)} into one block.`}
          </div>
        )}
        {mergeSelection.length < 2 && correctable && payload.blocks.length > 1 && (
          <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
            Tip: Shift-click another block to merge them.
          </div>
        )}
        {hasOverride && previousName && (
          <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
            Renamed from “{previousName}” ·{' '}
            <button type="button" disabled={overrideSaving} onClick={undoRename} style={{ border: 'none', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: 0, textDecorationLine: 'underline', textUnderlineOffset: 2 }}>
              Undo
            </button>
          </div>
        )}
      </div>

      {renaming && correctable && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <label htmlFor="timeline-block-label-override" style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}>Rename block</label>
          <input
            id="timeline-block-label-override"
            type="text"
            autoFocus
            value={overrideDraft}
            onChange={(event) => setOverrideDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') submitRename() }}
            placeholder={userVisibleBlockLabel(block)}
            style={{ flex: 1, minWidth: 150, height: 32, borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', padding: '0 12px', fontSize: 13, outline: 'none' }}
          />
          <button
            type="button"
            aria-label="Name this block with AI"
            title="Let AI name this block"
            disabled={suggesting || overrideSaving}
            onClick={() => { void suggestName() }}
            style={{ height: 32, width: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', color: 'var(--color-primary)', cursor: (suggesting || overrideSaving) ? 'default' : 'pointer', opacity: (suggesting || overrideSaving) ? 0.6 : 1 }}
          >
            <Sparkles size={15} strokeWidth={2} className={suggesting ? 'rename-ai-spin' : undefined} aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={overrideSaving || suggesting || !overrideDraft.trim() || overrideDraft.trim() === block.label.current}
            onClick={submitRename}
            style={{ height: 32, padding: '0 14px', borderRadius: 9, border: 'none', background: 'var(--gradient-primary)', color: 'var(--color-primary-contrast)', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: overrideSaving || suggesting || !overrideDraft.trim() || overrideDraft.trim() === block.label.current ? 0.6 : 1 }}
          >
            {overrideSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {(reviewError || boundaryError) && (
        <div style={{ fontSize: 11.5, lineHeight: 1.5, color: '#f87171', marginBottom: 12 }}>{reviewError || boundaryError}</div>
      )}

      {blockNarrative(block) && (
        <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--color-text-secondary)', margin: '0 0 20px' }}>
          {blockNarrative(block)}
        </p>
      )}

      <div style={{ display: 'grid', gap: 18 }}>
        {evidence.length > 0 && (
          <section>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', color: 'var(--color-text-tertiary)', marginBottom: 10, textTransform: 'uppercase' }}>
              Evidence
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {evidence.map((row) => renderEvidenceRow(row, false))}
            </div>
          </section>
        )}

        {sideTrips.length > 0 && (
          <section>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', color: 'var(--color-text-tertiary)', marginBottom: 10, textTransform: 'uppercase' }}>
              Side trips
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {sideTrips.map((row) => renderEvidenceRow(row, true))}
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
        const trustedBlocks = payload.blocks.filter(isTrustedTimelineBlock)
        for (const block of trustedBlocks) {
          categories.set(block.dominantCategory, (categories.get(block.dominantCategory) ?? 0) + blockDurationSeconds(block))
        }
        const trustedTotalSeconds = trustedBlocks.reduce((sum, block) => sum + blockDurationSeconds(block), 0)
        return {
          date: payload.date,
          totalSeconds: trustedTotalSeconds,
          categories: [...categories.entries()]
            .sort((left, right) => right[1] - left[1])
            .map(([category, seconds]) => ({ category, seconds })),
          blockCount: trustedBlocks.length,
          topLabels: [...new Set(
            trustedBlocks
              .slice(0, 5)
              .map((block) => userVisibleBlockLabel(block))
              .filter(Boolean)
          )].slice(0, 3),
        }
      })
    },
  })
  const expectedWeekReviewScopeKey = `week:${weekStart}`
  const weekReviewResource = useProjectionResource<AISurfaceSummary | null>({
    scope: 'timeline',
    dependencies: [weekStart],
    intervalMs: 0,
    load: () => ipc.ai.getWeekReview(weekStart).catch(() => null),
  })
  const [generatingWeekReview, setGeneratingWeekReview] = useState(false)

  const data = weekResource.data ?? []
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
  const maxSeconds = data.length > 0 ? Math.max(...data.map((day) => day.totalSeconds), 1) : 1
  const activeDays = data.filter((day) => day.totalSeconds > 0)
  const totalWeekSeconds = activeDays.reduce((sum, day) => sum + day.totalSeconds, 0)
  const averageTrackedSeconds = activeDays.length > 0 ? Math.round(totalWeekSeconds / activeDays.length) : 0
  const mostActiveDay = activeDays.length > 0
    ? activeDays.reduce((best, day) => day.totalSeconds > best.totalSeconds ? day : best)
    : null
  const topWeekCategory = Array.from(activeDays.reduce<Map<AppCategory, number>>((map, day) => {
    for (const category of day.categories) {
      map.set(category.category, (map.get(category.category) ?? 0) + category.seconds)
    }
    return map
  }, new Map()).entries())
    .sort((left, right) => right[1] - left[1])[0] ?? null
  const activeDay = data.find((day) => day.date === hoveredDate)
    ?? data.find((day) => day.date === selectedDate)
    ?? activeDays[0]
    ?? null

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 10 }}>
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
                  {day.categories.slice(0, 4).map((category, index, array) => {
                    const total = array.reduce((sum, item) => sum + item.seconds, 0) || 1
                    const segmentHeight = `${Math.max(8, (category.seconds / total) * 100)}%`
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
                          opacity: 1 - (index * 0.08),
                        }}
                      />
                    )
                  })}
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                {day.totalSeconds > 0 ? formatDuration(day.totalSeconds) : 'No data'}
              </div>
            </button>
          )
        })}
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
                  {formatDuration(activeDay.totalSeconds)} tracked • {activeDay.blockCount} block{activeDay.blockCount !== 1 ? 's' : ''}
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
  // The far end of a shift-selected merge span. Null means a plain single
  // selection; set means "select everything between the anchor and here".
  const [mergeRangeEndId, setMergeRangeEndId] = useState<string | null>(null)
  const [isCompact, setIsCompact] = useState(() => window.innerWidth < 1120)
  const [navState, setNavState] = useState<TimelineNavState>(() => timelineNavStateFromParams(searchParams))
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
  }, [date])

  // Escape steps the selection down: first it drops a multi-block merge span,
  // then it deselects entirely.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (mergeRangeEndId) setMergeRangeEndId(null)
      else if (selectedBlockId) setSelectedBlockId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mergeRangeEndId, selectedBlockId])

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

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = 0
  }, [view, date])

  useEffect(() => {
    const openKey = view === 'week'
      ? `week:${date}`
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
  const displaySegments = useMemo(
    () => compressTimelineSegments(payload?.segments ?? []),
    [payload],
  )

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

  function setView(nextView: 'day' | 'week') {
    updateNavState({ view: nextView, date })
  }

  function setDate(nextDate: string) {
    updateNavState({ view, date: nextDate })
  }

  const forwardDisabled = view === 'day'
    ? isToday
    : getWeekStart(date) === getWeekStart(todayString())

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
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
          <div style={{ padding: '24px 32px 40px' }}>
            <WeekView
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
                  <div key={index} style={{ display: 'grid', gridTemplateColumns: '104px minmax(0, 1fr)', gap: 16 }}>
                    <div style={{ height: 20, borderRadius: 8, background: 'var(--color-surface-low)', opacity: 0.5 }} />
                    <div style={{ height: 110 - (index * 10), borderRadius: 16, background: 'var(--color-surface-low)', opacity: 0.5 }} />
                  </div>
                ))}
              </div>
            )}

            {!error && !loading && payload && (
              <>
                <SummaryStrip payload={payload} />

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
                }}
                  onClickCapture={(event) => {
                    const target = event.target as HTMLElement | null
                    if (target?.closest('[data-timeline-inspector="true"]')) {
                      return
                    }
                    const blockButton = target?.closest<HTMLElement>('[data-timeline-block-id]')
                    const clickedId = blockButton?.dataset.timelineBlockId ?? null
                    // Clicking empty track space deselects everything.
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
                  }}>
                    {/* Cards aren't text to select; killing user-select here keeps
                        shift-click from smearing a text highlight across the run. */}
                    <div style={{ display: 'grid', gap: 14, userSelect: 'none' }}>
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
                            inMergeRange={segment.kind === 'work_block' && selectedBlockId !== segment.blockId && selectedSpanIds.has(segment.blockId)}
                          />
                        )
                      ))}
                    </div>
                    <BlockInspector
                      block={selectedBlock}
                      payload={payload}
                      onRefresh={timelineResource.refresh}
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
