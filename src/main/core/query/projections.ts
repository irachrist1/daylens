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
import { getFocusSessionsForDateRange, getWeeklySummary, getWebsiteSummariesForRange } from '../../db/queries'
import { readDerivedDay, PROJECTION_VERSION, type DerivedDayResult } from '../projections/chunk2'
import { localDateString } from '../../lib/localDate'
import { ownedDayBounds } from '../../lib/dayOwnership'
import { isAppFocused } from '../../lib/focusScore'
import { resolveCanonicalApp } from '../../lib/appIdentity'
import { getSettings } from '../../services/settings'
import { isSystemNoiseApp } from '@shared/systemNoise'
import { isTrustedTimelineBlock } from '@shared/timelineReview'

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

function derivedSessionToAppSession(
  session: DerivedDayResult['sessions'][number],
  focusApps: string[] | undefined,
): AppSession {
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
    isFocused: isAppFocused(category, bundleId, identity.displayName || appName, focusApps),
    windowTitle: session.window_title,
    rawAppName: appName,
    canonicalAppId: identity.canonicalAppId ?? bundleId,
    appInstanceId: bundleId,
    captureSource: 'focus_events',
    endedReason: null,
    captureVersion: PROJECTION_VERSION,
  }
}

// Aligned with the 15-minute session break (timeline.md §3.1): a real gap of
// 15+ minutes ends a block and shows as blank space, so it becomes a visible
// segment at the same threshold.
const MIN_VISIBLE_GAP_MS = 15 * 60 * 1000

function buildDerivedSegments(
  db: Database.Database,
  dateStr: string,
  blocks: WorkContextBlock[],
): TimelineSegment[] {
  const [fromMs, toMs] = ownedDayBounds(db, dateStr)
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
  const day = readDerivedDay(db, dateStr)
  if (!day) return null

  const [fromMs, toMs] = ownedDayBounds(db, dateStr)
  const focusApps = getSettings().focusApps
  // Invariant 11: system noise (loginwindow, SecurityAgent, Finder…) is
  // invisible and never counts as time. The app_sessions read path filters it
  // in getSessionsForRange; this derived path must apply the same shared
  // policy, or an overnight loginwindow session becomes a 9-hour
  // "Uncategorized long idle period" block on a past day.
  const sessions = day.sessions
    .filter((session) => !isSystemNoiseApp({ bundleId: session.app_bundle_id, appName: session.app_name }))
    .map((session) => derivedSessionToAppSession(session, focusApps))
  const websites = getWebsiteSummariesForRange(db, fromMs, toMs)
  const focusSessions = getFocusSessionsForDateRange(db, fromMs, toMs)
  // Past days must go through the same coalescing pipeline as today. The
  // precomputed derived_blocks are raw, un-coalesced chunks (the source of the
  // 100+ micro-block timelines on past days), so rebuild blocks from the
  // derived sessions instead of mapping derived_blocks one-to-one. A block the
  // user deleted (review state 'ignored') is filtered from every read.
  const blocks = buildTimelineBlocksForDay(db, dateStr, sessions, options)
    .filter(isTrustedTimelineBlock)
  const segments = buildDerivedSegments(db, dateStr, blocks)
  const totalSeconds = sessions.reduce((sum, session) => sum + session.durationSeconds, 0)
  const focusSeconds = sessions
    .filter((session) => session.isFocused)
    .reduce((sum, session) => sum + session.durationSeconds, 0)

  return {
    date: dateStr,
    sessions,
    websites,
    blocks,
    segments,
    focusSessions,
    computedAt: Date.now(),
    version: `derived:${PROJECTION_VERSION}`,
    totalSeconds,
    focusSeconds,
    focusPct: totalSeconds > 0 ? Math.round((focusSeconds / totalSeconds) * 100) : 0,
    appCount: new Set(sessions.map((session) => session.bundleId)).size,
    siteCount: websites.length,
  }
}

export function getTimelineDayProjection(
  db: Database.Database,
  dateStr: string,
  liveSession?: LiveSession | null,
  options: { materialize?: boolean } = {},
): DayTimelinePayload {
  if (!liveSession) {
    const derived = getDerivedDayTimelinePayload(db, dateStr, options)
    if (derived) return derived
  }
  return getTimelineDayPayload(db, dateStr, liveSession, options)
}

export function getHistoryDayProjection(
  db: Database.Database,
  dateStr: string,
  liveSession?: LiveSession | null,
  options: { materialize?: boolean } = {},
): HistoryDayPayload {
  if (!liveSession) {
    const derived = getDerivedDayTimelinePayload(db, dateStr, options)
    if (derived) return derived
  }
  return getHistoryDayPayload(db, dateStr, liveSession, options)
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
  return getWeeklySummary(db, endDateStr)
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
