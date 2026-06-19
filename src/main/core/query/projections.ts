import type Database from 'better-sqlite3'
import type {
  AppCategory,
  AppSession,
  AppDetailPayload,
  ArtifactRef,
  DayTimelinePayload,
  HistoryDayPayload,
  LiveSession,
  TimelineSegment,
  WeeklySummary,
  WorkContextBlock,
  WorkflowPattern,
} from '@shared/types'
import { getArtifactDetails, getAppDetailPayload, getHistoryDayPayload, getTimelineDayPayload, getWorkflowSummaries, buildTimelineBlocksForDay } from '../../services/workBlocks'
import { getFocusSessionsForDateRange, getWebsiteSummariesForRange } from '../../db/queries'
import { projectDay, readDerivedDay, PROJECTION_VERSION, type DerivedDayResult } from '../projections/chunk2'
import { localDateString } from '../../lib/localDate'
import { isCategoryFocused } from '../../lib/focusScore'
import { resolveCanonicalApp } from '../../lib/appIdentity'
import { blockActiveSeconds } from '@shared/blockDuration'
import { isTrustedTimelineBlock } from '@shared/timelineReview'

function localDayBounds(dateStr: string): [number, number] {
  const [year, month, day] = dateStr.split('-').map(Number)
  return [
    new Date(year, month - 1, day).getTime(),
    new Date(year, month - 1, day + 1).getTime(),
  ]
}

const APP_CATEGORIES: ReadonlySet<string> = new Set([
  'development',
  'communication',
  'research',
  'writing',
  'aiTools',
  'design',
  'browsing',
  'meetings',
  'entertainment',
  'email',
  'productivity',
  'social',
  'system',
  'uncategorized',
])

function toAppCategory(category: string | null | undefined): AppCategory {
  return category && APP_CATEGORIES.has(category) ? category as AppCategory : 'uncategorized'
}

function derivedSessionToAppSession(session: DerivedDayResult['sessions'][number]): AppSession {
  const bundleId = session.app_bundle_id ?? session.app_name ?? 'unknown'
  const appName = session.app_name ?? session.app_bundle_id ?? 'Unknown app'
  const category = toAppCategory(session.category)
  const identity = resolveCanonicalApp(bundleId, appName)
  return {
    id: session.id,
    bundleId,
    appName: identity.displayName || appName,
    startTime: session.start_ts_ms,
    endTime: session.end_ts_ms,
    durationSeconds: session.active_seconds,
    category,
    isFocused: isCategoryFocused(category),
    windowTitle: session.window_title,
    rawAppName: appName,
    canonicalAppId: identity.canonicalAppId ?? bundleId,
    appInstanceId: bundleId,
    captureSource: 'focus_events',
    endedReason: null,
    captureVersion: PROJECTION_VERSION,
  }
}

const MIN_VISIBLE_GAP_MS = 15 * 60 * 1000

type GapReason = 'idle' | 'away' | 'machine_off' | 'paused' | 'permission_limited' | 'no_samples'

interface GapReasonInterval {
  reason: Exclude<GapReason, 'no_samples'>
  startTime: number
  endTime: number
}

function projectionTables(db: Database.Database): Set<string> {
  const rows = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN (
        'focus_events',
        'derived_projection_runs',
        'derived_sessions',
        'derived_blocks',
        'derived_block_sessions'
      )
  `).all() as Array<{ name: string }>
  return new Set(rows.map((row) => row.name))
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).get(table)
  return Boolean(row)
}

function gapReasonMarker(eventType: string): {
  reason: Exclude<GapReason, 'no_samples'>
  edge: 'start' | 'end'
} | null {
  switch (eventType.toLowerCase()) {
    case 'idle_start': return { reason: 'idle', edge: 'start' }
    case 'idle_end': return { reason: 'idle', edge: 'end' }
    case 'away_start':
    case 'lock':
    case 'lock_screen': return { reason: 'away', edge: 'start' }
    case 'away_end':
    case 'unlock':
    case 'unlock_screen': return { reason: 'away', edge: 'end' }
    case 'sleep':
    case 'suspend': return { reason: 'machine_off', edge: 'start' }
    case 'wake':
    case 'resume': return { reason: 'machine_off', edge: 'end' }
    case 'tracking_paused': return { reason: 'paused', edge: 'start' }
    case 'tracking_resumed': return { reason: 'paused', edge: 'end' }
    case 'permission_denied_start':
    case 'permission_limited_start': return { reason: 'permission_limited', edge: 'start' }
    case 'permission_denied_end':
    case 'permission_limited_end': return { reason: 'permission_limited', edge: 'end' }
    default: return null
  }
}

function readGapReasonIntervals(
  db: Database.Database,
  fromMs: number,
  toMs: number,
): GapReasonInterval[] {
  if (!tableExists(db, 'activity_state_events')) return []
  const rows = db.prepare(`
    SELECT event_ts AS eventTs, event_type AS eventType
    FROM activity_state_events
    WHERE event_ts >= ? AND event_ts < ?
    ORDER BY event_ts ASC, id ASC
  `).all(fromMs, toMs) as Array<{ eventTs: number; eventType: string }>
  const open = new Map<GapReasonInterval['reason'], number>()
  const intervals: GapReasonInterval[] = []

  for (const row of rows) {
    const marker = gapReasonMarker(row.eventType)
    if (!marker) continue
    if (marker.edge === 'start') {
      open.set(marker.reason, row.eventTs)
      continue
    }
    const startTime = open.get(marker.reason)
    if (startTime == null) continue
    if (row.eventTs > startTime) {
      intervals.push({ reason: marker.reason, startTime, endTime: row.eventTs })
    }
    open.delete(marker.reason)
  }
  for (const [reason, startTime] of open) {
    if (toMs > startTime) intervals.push({ reason, startTime, endTime: toMs })
  }
  return intervals
}

function gapLabel(reason: GapReason): string {
  switch (reason) {
    case 'idle': return 'Idle gap'
    case 'away': return 'Away'
    case 'machine_off': return 'Machine off'
    case 'paused': return 'Tracking paused'
    case 'permission_limited': return 'Permission limited'
    case 'no_samples': return 'No samples'
  }
}

function projectGapReasons(
  db: Database.Database,
  dateStr: string,
  payload: DayTimelinePayload,
): DayTimelinePayload {
  const [fromMs, toMs] = localDayBounds(dateStr)
  const evidence = readGapReasonIntervals(db, fromMs, toMs)
  const segments = payload.segments.map((segment): TimelineSegment => {
    if (segment.kind === 'work_block') return segment
    const match = evidence
      .map((interval) => ({
        interval,
        overlap: Math.max(
          0,
          Math.min(segment.endTime, interval.endTime) - Math.max(segment.startTime, interval.startTime),
        ),
      }))
      .filter((candidate) => candidate.overlap > 0)
      .sort((left, right) => right.overlap - left.overlap)[0]?.interval
    const reason: GapReason = match?.reason
      ?? (segment.kind === 'machine_off' ? 'machine_off' : segment.kind === 'away' ? 'away' : 'no_samples')
    return {
      kind: reason === 'machine_off' ? 'machine_off' : reason === 'away' ? 'away' : 'idle_gap',
      startTime: segment.startTime,
      endTime: segment.endTime,
      label: gapLabel(reason),
      source: match ? 'activity_event' : segment.source,
    }
  })
  return { ...payload, segments }
}

function buildDerivedSegments(dateStr: string, blocks: WorkContextBlock[]): TimelineSegment[] {
  const [fromMs, toMs] = localDayBounds(dateStr)
  const segments: TimelineSegment[] = []
  let cursor = fromMs
  for (const block of blocks) {
    if (block.startTime > cursor) {
      const gapDuration = block.startTime - cursor
      if (gapDuration >= MIN_VISIBLE_GAP_MS) {
        segments.push({
          kind: 'idle_gap',
          startTime: cursor,
          endTime: block.startTime,
          label: 'Idle gap',
          source: 'derived_gap',
        })
      }
    }
    segments.push({
      kind: 'work_block',
      startTime: block.startTime,
      endTime: block.endTime,
      blockId: block.id,
    })
    cursor = Math.max(cursor, block.endTime)
  }
  if (cursor < toMs) {
    const gapDuration = toMs - cursor
    if (gapDuration >= MIN_VISIBLE_GAP_MS) {
      segments.push({
        kind: 'idle_gap',
        startTime: cursor,
        endTime: toMs,
        label: 'Idle gap',
        source: 'derived_gap',
      })
    }
  }
  return segments.filter((segment) => segment.endTime > segment.startTime)
}

function getDerivedDayTimelinePayload(
  db: Database.Database,
  dateStr: string,
  options: { materialize?: boolean } = {},
): DayTimelinePayload | null {
  if (dateStr === localDateString()) return null
  const tables = projectionTables(db)
  const hasDerivedSchema = [
    'derived_projection_runs',
    'derived_sessions',
    'derived_blocks',
    'derived_block_sessions',
  ].every((table) => tables.has(table))
  if (!hasDerivedSchema) return null

  let day = readDerivedDay(db, dateStr)
  if (!day && tables.has('focus_events')) {
    const [fromMs, toMs] = localDayBounds(dateStr)
    const eventCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM focus_events
      WHERE ts_ms >= ? AND ts_ms < ?
    `).get(fromMs, toMs) as { count: number }
    if (eventCount.count > 0) {
      projectDay(db, dateStr, { finalize: true })
      day = readDerivedDay(db, dateStr)
    }
  }
  if (!day) return null

  const [fromMs, toMs] = localDayBounds(dateStr)
  const sessions = day.sessions.map(derivedSessionToAppSession)
  const websites = getWebsiteSummariesForRange(db, fromMs, toMs)
  const focusSessions = getFocusSessionsForDateRange(db, fromMs, toMs)
  // Past days must go through the same coalescing pipeline as today. The
  // precomputed derived_blocks are raw, un-coalesced chunks (the source of the
  // 100+ micro-block timelines on past days), so rebuild blocks from the
  // derived sessions instead of mapping derived_blocks one-to-one.
  const blocks = buildTimelineBlocksForDay(db, dateStr, sessions, options)
  const segments = buildDerivedSegments(dateStr, blocks)
  const trustedBlocks = blocks.filter(isTrustedTimelineBlock)
  const totalSeconds = trustedBlocks.reduce((sum, block) => sum + blockActiveSeconds(block), 0)
  const focusSeconds = trustedBlocks.reduce(
    (sum, block) => sum + (isCategoryFocused(block.dominantCategory) ? blockActiveSeconds(block) : 0),
    0,
  )
  const visibleAppIds = new Set(trustedBlocks.flatMap((block) => block.topApps.map((app) => app.bundleId)))
  const visibleDomains = new Set(trustedBlocks.flatMap((block) => [
    ...block.pageRefs.map((page) => page.domain ?? page.host).filter((domain): domain is string => Boolean(domain)),
    ...(block.evidenceSummary.domains ?? []),
  ]))
  const visibleWebsites = websites.filter((website) => visibleDomains.has(website.domain))

  return {
    date: dateStr,
    sessions,
    websites: visibleWebsites,
    blocks,
    segments,
    focusSessions,
    computedAt: Date.now(),
    version: `derived:${PROJECTION_VERSION}`,
    totalSeconds,
    focusSeconds,
    focusPct: totalSeconds > 0 ? Math.round((focusSeconds / totalSeconds) * 100) : 0,
    appCount: visibleAppIds.size,
    siteCount: visibleWebsites.length,
  }
}

export function getTimelineDayProjection(
  db: Database.Database,
  dateStr: string,
  liveSession?: LiveSession | null,
  options: { materialize?: boolean } = {},
): DayTimelinePayload {
  const canonical = getTimelineDayPayload(db, dateStr, liveSession, options)
  if (canonical.sessions.length > 0) {
    return projectGapReasons(db, dateStr, canonical)
  }
  if (!liveSession) {
    const derived = getDerivedDayTimelinePayload(db, dateStr, options)
    if (derived) return projectGapReasons(db, dateStr, derived)
  }
  return projectGapReasons(db, dateStr, canonical)
}

export function getHistoryDayProjection(
  db: Database.Database,
  dateStr: string,
  liveSession?: LiveSession | null,
  options: { materialize?: boolean } = {},
): HistoryDayPayload {
  const canonical = getHistoryDayPayload(db, dateStr, liveSession, options)
  if (canonical.sessions.length > 0) return canonical
  if (!liveSession) {
    const derived = getDerivedDayTimelinePayload(db, dateStr, options)
    if (derived) return derived
  }
  return canonical
}

export function materializeTimelineDayProjection(
  db: Database.Database,
  dateStr: string,
  liveSession?: LiveSession | null,
): DayTimelinePayload {
  return getTimelineDayProjection(db, dateStr, liveSession, { materialize: true })
}

export function getWeeklySummaryProjection(
  db: Database.Database,
  endDateStr: string,
): WeeklySummary {
  const [year, month, day] = endDateStr.split('-').map(Number)
  const dates = Array.from({ length: 7 }, (_, index) =>
    localDateString(new Date(year, month - 1, day - (6 - index))),
  )
  const days = dates.map((date) => getTimelineDayProjection(db, date, null, { materialize: true }))
  const totalTrackedSeconds = days.reduce((sum, current) => sum + current.totalSeconds, 0)
  const totalFocusSeconds = days.reduce((sum, current) => sum + current.focusSeconds, 0)
  const focusPct = totalTrackedSeconds > 0 ? Math.round((totalFocusSeconds / totalTrackedSeconds) * 100) : 0
  const activeDays = days.filter((current) => current.totalSeconds > 0)
  const bestDay = activeDays.reduce<{ date: string; focusPct: number } | null>((best, current) => {
    const currentPct = current.totalSeconds > 0 ? Math.round((current.focusSeconds / current.totalSeconds) * 100) : 0
    return !best || currentPct > best.focusPct ? { date: current.date, focusPct: currentPct } : best
  }, null)
  const mostActiveDay = activeDays.reduce<{ date: string; totalSeconds: number } | null>(
    (best, current) => !best || current.totalSeconds > best.totalSeconds
      ? { date: current.date, totalSeconds: current.totalSeconds }
      : best,
    null,
  )
  const apps = new Map<string, { appName: string; bundleId: string; totalSeconds: number; category: AppCategory }>()
  for (const current of days) {
    for (const block of current.blocks.filter(isTrustedTimelineBlock)) {
      for (const app of block.topApps) {
        const existing = apps.get(app.bundleId)
        if (existing) existing.totalSeconds += app.totalSeconds
        else apps.set(app.bundleId, {
          appName: app.appName,
          bundleId: app.bundleId,
          totalSeconds: app.totalSeconds,
          category: app.category,
        })
      }
    }
  }

  return {
    totalTrackedSeconds,
    totalFocusSeconds,
    focusPct,
    avgFocusScore: activeDays.length > 0
      ? Math.round(activeDays.reduce((sum, current) => sum + (current.focusPct ?? 0), 0) / activeDays.length)
      : 0,
    bestDay,
    mostActiveDay,
    topApps: [...apps.values()].sort((left, right) => right.totalSeconds - left.totalSeconds).slice(0, 5),
    dailyBreakdown: days.map((current) => ({
      date: current.date,
      focusSeconds: current.focusSeconds,
      totalSeconds: current.totalSeconds,
      focusScore: current.focusPct,
    })),
  }
}

export function getAppDetailProjection(
  db: Database.Database,
  canonicalAppId: string,
  days: number | string = 7,
  liveSession?: LiveSession | null,
): AppDetailPayload {
  return getAppDetailPayload(db, canonicalAppId, days as any, liveSession)
}

export function getWorkflowPatternsProjection(
  db: Database.Database,
  days = 14,
): WorkflowPattern[] {
  return getWorkflowSummaries(db, days)
}

export function getArtifactDetailProjection(
  db: Database.Database,
  artifactId: string,
): ArtifactRef | null {
  return getArtifactDetails(db, artifactId)
}
