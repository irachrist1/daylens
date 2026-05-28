import type Database from 'better-sqlite3'
import type {
  AppCategory,
  AppSession,
  AppDetailPayload,
  ArtifactRef,
  DayTimelinePayload,
  FocusSession,
  HistoryDayPayload,
  LiveSession,
  TimelineSegment,
  WeeklySummary,
  WorkContextAppSummary,
  WorkContextBlock,
  WorkflowPattern,
} from '@shared/types'
import { getArtifactDetails, getAppDetailPayload, getHistoryDayPayload, getTimelineDayPayload, getWorkflowSummaries } from '../../services/workBlocks'
import { getFocusSessionsForDateRange, getWeeklySummary, getWebsiteSummariesForRange } from '../../db/queries'
import { readDerivedDay, PROJECTION_VERSION, type DerivedDayBlock, type DerivedDayResult } from '../projections/chunk2'
import { localDateString, localDayBounds } from '../../lib/localDate'
import { isCategoryFocused } from '../../lib/focusScore'
import { resolveCanonicalApp } from '../../lib/appIdentity'

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

function topAppsFromDerivedSessions(sessions: AppSession[]): WorkContextAppSummary[] {
  const grouped = new Map<string, WorkContextAppSummary>()
  for (const session of sessions) {
    const existing = grouped.get(session.bundleId)
    if (existing) {
      existing.totalSeconds += session.durationSeconds
      existing.sessionCount += 1
      continue
    }
    grouped.set(session.bundleId, {
      bundleId: session.bundleId,
      appName: session.appName,
      category: session.category,
      totalSeconds: session.durationSeconds,
      sessionCount: 1,
      isBrowser: session.category === 'browsing',
    })
  }
  return [...grouped.values()]
    .sort((left, right) => right.totalSeconds - left.totalSeconds || left.appName.localeCompare(right.appName))
    .slice(0, 5)
}

function categoryDistributionFor(sessions: AppSession[]): Partial<Record<AppCategory, number>> {
  const distribution: Partial<Record<AppCategory, number>> = {}
  for (const session of sessions) {
    distribution[session.category] = (distribution[session.category] ?? 0) + session.durationSeconds
  }
  return distribution
}

function focusOverlapForBlock(
  focusSessions: FocusSession[],
  startTime: number,
  endTime: number,
): { totalSeconds: number; pct: number; sessionIds: number[] } {
  const overlaps = focusSessions
    .map((session) => {
      const overlapStart = Math.max(session.startTime, startTime)
      const overlapEnd = Math.min(session.endTime ?? endTime, endTime)
      return { sessionId: session.id, seconds: Math.max(0, Math.round((overlapEnd - overlapStart) / 1000)) }
    })
    .filter((entry) => entry.seconds > 0)
  const totalSeconds = overlaps.reduce((sum, entry) => sum + entry.seconds, 0)
  const spanSeconds = Math.max(1, Math.round((endTime - startTime) / 1000))
  return {
    totalSeconds,
    pct: Math.min(100, Math.round((totalSeconds / spanSeconds) * 100)),
    sessionIds: overlaps.map((entry) => entry.sessionId),
  }
}

const MIN_VISIBLE_GAP_MS = 30 * 60 * 1000 // 30 minutes

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

function derivedBlockToWorkContextBlock(
  db: Database.Database,
  block: DerivedDayBlock,
  focusSessions: FocusSession[],
): WorkContextBlock {
  const sessions = block.sessions.map(derivedSessionToAppSession)
  const topApps = topAppsFromDerivedSessions(sessions)
  const websites = getWebsiteSummariesForRange(db, block.startTime, block.endTime).slice(0, 5)
  const pageTitles = block.sessions
    .map((session) => session.page_title?.trim())
    .filter((title): title is string => Boolean(title))
    .filter((title, index, titles) => titles.indexOf(title) === index)
    .slice(0, 4)
  const dominantCategory = toAppCategory(block.dominantCategory)
  const labelSource = block.labelSource === 'ai'
    ? 'ai'
    : block.labelSource === 'artifact'
      ? 'artifact'
      : 'rule'
  const confidence = block.confidence === 'observed' ? 'high' : 'low'
  return {
    id: block.id,
    startTime: block.startTime,
    endTime: block.endTime,
    dominantCategory,
    categoryDistribution: categoryDistributionFor(sessions),
    ruleBasedLabel: block.label,
    aiLabel: null,
    sessions,
    topApps,
    websites,
    keyPages: pageTitles,
    pageRefs: [],
    documentRefs: [],
    topArtifacts: [],
    workflowRefs: [],
    label: {
      current: block.label,
      source: labelSource,
      confidence: confidence === 'high' ? 0.9 : 0.45,
      narrative: null,
      ruleBased: block.label,
      aiSuggested: null,
      override: null,
    },
    focusOverlap: focusOverlapForBlock(focusSessions, block.startTime, block.endTime),
    evidenceSummary: {
      apps: topApps,
      pages: [],
      documents: [],
      domains: websites.map((website) => website.domain),
    },
    heuristicVersion: `derived:${PROJECTION_VERSION}`,
    computedAt: Date.now(),
    switchCount: Math.max(0, sessions.length - 1),
    confidence,
    isLive: false,
  }
}

function getDerivedDayTimelinePayload(db: Database.Database, dateStr: string): DayTimelinePayload | null {
  if (dateStr === localDateString()) return null
  const day = readDerivedDay(db, dateStr)
  if (!day) return null

  const [fromMs, toMs] = localDayBounds(dateStr)
  const sessions = day.sessions.map(derivedSessionToAppSession)
  const websites = getWebsiteSummariesForRange(db, fromMs, toMs)
  const focusSessions = getFocusSessionsForDateRange(db, fromMs, toMs)
  const blocks = day.blocks.map((block) => derivedBlockToWorkContextBlock(db, block, focusSessions))
  const segments = buildDerivedSegments(dateStr, blocks)
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
): DayTimelinePayload {
  if (!liveSession) {
    const derived = getDerivedDayTimelinePayload(db, dateStr)
    if (derived) return derived
  }
  return getTimelineDayPayload(db, dateStr, liveSession)
}

export function getHistoryDayProjection(
  db: Database.Database,
  dateStr: string,
  liveSession?: LiveSession | null,
): HistoryDayPayload {
  if (!liveSession) {
    const derived = getDerivedDayTimelinePayload(db, dateStr)
    if (derived) return derived
  }
  return getHistoryDayPayload(db, dateStr, liveSession)
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
  days = 7,
  liveSession?: LiveSession | null,
): AppDetailPayload {
  return getAppDetailPayload(db, canonicalAppId, days, liveSession)
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
