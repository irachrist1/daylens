import type Database from 'better-sqlite3'
import crypto from 'node:crypto'
import {
  getActivityStateEventsForRange,
  getAppCharacter,
  getAppSummariesForRange,
  getBlockLabelOverride,
  getDomainSummariesForBrowser,
  getFocusSessionsForDateRange,
  getSessionsForRange,
  getTopPagesForDomains,
  getWebsiteVisitsForRange,
  getWebsiteSummariesForRange,
  getWorkContextInsightForRange,
  getDistractionByMonth,
  getDistractionByHour,
  getDistractionByDomain,
  getDaysTracked,
  type WebsiteVisitRecord,
} from '../db/queries'
import type {
  AppDetailPayload,
  AppCategory,
  AppProfile,
  AppSession,
  ArtifactRef,
  BlockConfidence,
  DayTimelinePayload,
  DistractionCostPayload,
  DocumentRef,
  HistoryDayPayload,
  LiveSession,
  PageRef,
  TimelineEvidenceSummary,
  TimelineSegment,
  WorkflowPattern,
  WorkflowRef,
  WorkContextAppSummary,
  WorkContextBlock,
  LabelSource,
  WebsiteSummary,
} from '@shared/types'
import { DISTRACTION_DOMAINS, FOCUSED_CATEGORIES } from '@shared/types'
import { isHostFilteredFromArtifacts, isHostBlockedForLabel, isHostBlockedForAppsRail, policyForHost } from '@shared/domainPolicy'
import { blockActiveSeconds } from '@shared/blockDuration'
import { localDayBounds, localDateString } from '../lib/localDate'
import { deriveWorkEvidenceSummary } from '../lib/workEvidence'
import {
  normalizeUrlForStorage,
  normalizeWebsiteTitleForDisplay,
  resolveCanonicalApp,
  titleLooksUseful,
  websiteDisplayLabel,
} from '../lib/appIdentity'
import {
  extractProjectHintFromEvidence,
  gatherConcurrentEvidence,
  matchPromotedPatterns,
  memoryEnabled,
} from './workMemory'

/**
 * Sanitize a label that might be a raw file path or bundle path.
 * e.g. "/System/Volumes/.../Safari.app/Contents/MacOS/Safari" → "Safari"
 * Returns null if the result is still not display-worthy.
 */
function sanitizeBlockLabel(label: string | null | undefined): string | null {
  if (!label) return null
  // Path-like strings: contain slashes and likely contain an app path segment
  if ((label.includes('/') || label.includes('\\')) && label.length > 40) {
    // Try to extract the last meaningful path component (strip .app/.exe suffix)
    const parts = label.replace(/\\/g, '/').split('/')
    const appPart = parts.find((p) => p.endsWith('.app')) ?? parts.find((p) => p.endsWith('.exe'))
    if (appPart) {
      const name = appPart.replace(/\.(app|exe)$/i, '')
      if (name.length > 0) return name
    }
    // Try the last non-empty segment
    const lastName = parts.filter(Boolean).pop()
    if (lastName && lastName.length > 0 && !lastName.includes(':')) return lastName
    return null
  }
  return label
}

const IDLE_GAP_THRESHOLD_MS = 15 * 60_000
const MEETING_THRESHOLD_SEC = 20 * 60
const LONG_SINGLE_APP_THRESHOLD_SEC = 45 * 60
const BRIEF_INTERRUPTION_THRESHOLD_SEC = 3 * 60
const SUSTAINED_CATEGORY_THRESHOLD_SEC = 15 * 60
const COMMUNICATION_INTERRUPTION_THRESHOLD_SEC = 5 * 60
const FAST_SWITCH_THRESHOLD_SEC = 5 * 60
const SLOW_SWITCH_THRESHOLD_SEC = 15 * 60
const SUSTAINED_CONTEXT_SHIFT_THRESHOLD_SEC = 5 * 60
// R2 block-sizing: the target shape is a 60-120 minute block, not a string of
// 20-minute slices. The base ceiling sits at 120 min so a sustained stretch of
// the same work is not chopped at 60, and the coalesce pass below re-joins
// adjacent fragments of the same work up to this same ceiling.
const TIMELINE_MAX_BLOCK_SPAN_MS = 120 * 60_000
// Blocks shorter than this are pure noise on the timeline (e.g. a 50-second
// "Terminal work" sliver). They are unconditionally merged into an adjacent
// block instead of being shown standalone.
const TIMELINE_MIN_BLOCK_SPAN_MS = 5 * 60_000
// A block under 30 minutes should generally not stand on its own as a calendar
// block — a focused stretch reads as continuous work, not a string of
// sub-half-hour slices. Blocks in the [5min, 30min) band are folded into a
// semantically related neighbour (same work, or the same continued app), but
// only when such a neighbour exists; an isolated 20-minute activity bounded by
// real gaps stays standalone rather than being forced into something unrelated.
const TIMELINE_MIN_STANDALONE_SPAN_MS = 30 * 60_000
// The same work continued across a moderate untracked gap is one block, not two.
// A 17-minute lull in the middle of a coding morning (stepped away, tracker
// missed a stretch) should not split one Ghostty session into "Terminal work"
// and a separate block. Two stretches of the same dominant app doing related
// work bridge a gap up to this size, even across a coarse-segment boundary.
// Genuine breaks (machine off for hours, long untracked spans) exceed this and
// stay split.
const TIMELINE_SAME_WORK_BRIDGE_GAP_MS = 30 * 60_000
// Higher ceiling for candidates where every session shares the same
// (bundleId, compacted window title) pair with no internal gap >= 5 min.
// Quality bar: a 90-minute block titled "Daylens AI refactor — extract
// chat_answer from ai.ts" is the right answer, not three 30-minute slices
// labelled "Cursor" / "Cursor" / "Untitled block".
const TIMELINE_MAX_COHERENT_BLOCK_SPAN_MS = 180 * 60_000
const TIMELINE_MAX_ASSISTED_WORK_SPAN_MS = 270 * 60_000
const TIMELINE_SPLIT_GAP_THRESHOLD_MS = 5 * 60_000
const TIMELINE_MIN_CHILD_SPAN_MS = 15 * 60_000
// Bumped to v7 with: short-block absorption is based on active tracked time
// instead of wall-clock span, uncategorized AI/dev tools are treated as focused
// timeline evidence, GitHub repo/review pages badge as research, and
// deterministic artifact labels are now AI-reanalysis targets instead of being
// marked stable forever.
//
// Bumped to v6 with: focused-work category ownership over incidental browsing,
// hard activity-state boundaries for the coarse idle cut, drift categories
// never bridge across gaps, and AI relabeling as the primary path
// for deterministic floor labels.
// (NON_BRIDGEABLE_CATEGORIES), work-memory "<project> development" labels gated
// to focused-work-dominant blocks, and project hints grounded only in real code
// signals (file activity, code repos, localhost dev servers). Past days
// persisted under an older version are reconstructed on revisit (see
// buildTimelineBlocksForDay) so the stale "Canva development" / "Notifications
// development" labels get replaced — unless the day was already AI/user
// processed, in which case that curated result is kept and its IDs stay stable.
const TIMELINE_HEURISTIC_VERSION = 'timeline-v7'

type FormationReason = 'coherent' | 'heuristic' | 'mixed' | 'meeting' | 'longSingleApp'

interface EffectiveSession {
  session: AppSession
  effectiveCategory: AppCategory
}

interface CoarseSegment {
  sessions: AppSession[]
  boundedBeforeGap: boolean
  boundedAfterGap: boolean
}

interface CandidateBlock {
  sessions: AppSession[]
  formation: FormationReason
  boundedBeforeGap: boolean
  boundedAfterGap: boolean
  forcedLabel?: string
}

interface CategoryRun {
  category: AppCategory
  startIndex: number
  totalSeconds: number
}

interface AppStreak {
  range: [number, number]
  targetDurationSeconds: number
  label: string
}

interface ContextRun {
  context: string
  startIndex: number
  totalSeconds: number
}

interface ArtifactCandidate {
  artifact: ArtifactRef
  pageRef?: PageRef
  documentRef?: DocumentRef
  sourceType: 'website_visit' | 'app_session'
  sourceId: string
  startTime: number
  endTime: number
}

interface PersistedWorkflow {
  workflow: WorkflowRef
  artifactKeys: string[]
}

interface AppDetailBlockSlice {
  id: string
  startTime: number
  endTime: number
  dominantCategory: AppCategory
  label: {
    current: string
  }
  topApps: WorkContextAppSummary[]
  topArtifacts: ArtifactRef[]
  pageRefs: PageRef[]
  workflowRefs: WorkflowRef[]
}

const BROWSER_KEYWORDS = [
  'chrome',
  'edge',
  'firefox',
  'brave',
  'arc',
  'dia',
  'browser',
  'safari',
]

const GENERIC_LABELS = new Set([
  'AI Tools',
  'Browsing',
  'Communication',
  'Design',
  'Development',
  'Email',
  'Insufficient Data',
  'Insufficient Data For Label',
  'Meetings',
  'Mixed Work',
  'Productivity',
  'Research',
  'Research & AI Chat',
  'System',
  'Uncategorized',
  'Web Session',
  'Writing',
])

function isBrowserSession(session: Pick<AppSession, 'bundleId' | 'appName' | 'category'>): boolean {
  if (session.category === 'browsing') return true
  const haystack = `${session.bundleId} ${session.appName}`.toLowerCase()
  return BROWSER_KEYWORDS.some((keyword) => haystack.includes(keyword))
}

function prettyCategory(category: AppCategory): string {
  if (category === 'aiTools') return 'AI Tools'
  return category
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}

function localDateKeyForTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function appCategoryIsFocused(category: AppCategory): boolean {
  return FOCUSED_CATEGORIES.includes(category)
}

function dominantCategoryFromDistribution(distribution: Partial<Record<AppCategory, number>>): AppCategory {
  const entries = Object.entries(distribution) as Array<[AppCategory, number]>
  return entries
    .sort((left, right) => {
      if (left[1] === right[1]) {
        if (appCategoryIsFocused(left[0]) !== appCategoryIsFocused(right[0])) {
          return appCategoryIsFocused(left[0]) ? -1 : 1
        }
        return left[0].localeCompare(right[0])
      }
      return right[1] - left[1]
    })[0]?.[0] ?? 'uncategorized'
}

function categoryForTopPageArtifact(topArtifacts: ArtifactRef[]): AppCategory | null {
  const topArtifact = topArtifacts[0]
  if (!topArtifact || topArtifact.artifactType !== 'page') return null

  const page = topArtifact as PageRef
  const policy = policyForHost(page.domain ?? topArtifact.host ?? null)
  if (policy === 'social_feed') return 'social'
  if (policy === 'entertainment') return 'entertainment'
  const host = (page.domain ?? page.host ?? '').toLowerCase().replace(/^www\./, '')
  const url = page.normalizedUrl ?? page.url ?? ''
  if (host === 'github.com' && /^https?:\/\/github\.com\/[^/?#]+\/[^/?#]+(?:[/?#]|$)/i.test(url)) {
    return 'research'
  }
  return null
}

function dominantFocusedCategoryFromDistribution(distribution: Partial<Record<AppCategory, number>>): AppCategory | null {
  const entries = Object.entries(distribution) as Array<[AppCategory, number]>
  const total = entries.reduce((sum, [, seconds]) => sum + seconds, 0)
  if (total <= 0) return null

  const focused = entries
    .filter(([category]) => FOCUSED_CATEGORIES.includes(category) && category !== 'browsing')
    .sort((left, right) => right[1] - left[1])[0]
  if (!focused) return null

  return focused[1] / total >= 0.3 ? focused[0] : null
}

function hasLocalhostPageArtifact(topArtifacts: ArtifactRef[]): boolean {
  return topArtifacts.some((artifact) => {
    if (artifact.artifactType !== 'page' && artifact.artifactType !== 'domain') return false
    const host = artifact.host ?? (artifact as { domain?: string | null }).domain ?? null
    return typeof host === 'string' && /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?$/i.test(host)
  })
}

function dominantCategoryForBlock(
  distribution: Partial<Record<AppCategory, number>>,
  topArtifacts: ArtifactRef[],
): AppCategory {
  const baseCategory = dominantCategoryFromDistribution(distribution)
  const focusedCategory = dominantFocusedCategoryFromDistribution(distribution)
  const artifactCategory = categoryForTopPageArtifact(topArtifacts)

  if (baseCategory === 'browsing' && hasLocalhostPageArtifact(topArtifacts) && (distribution.development ?? 0) > 0) {
    return 'development'
  }
  if (focusedCategory && (baseCategory === 'browsing' || baseCategory === 'entertainment' || baseCategory === 'social')) {
    return focusedCategory
  }
  return artifactCategory ?? baseCategory
}

function coherenceScore(distribution: Partial<Record<AppCategory, number>>): number {
  const values = Object.values(distribution)
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return 0
  return Math.max(...values) / total
}

function countAppSwitches(sessions: AppSession[]): number {
  let switches = 0
  for (let index = 1; index < sessions.length; index++) {
    if (sessions[index].bundleId !== sessions[index - 1].bundleId) {
      switches++
    }
  }
  return switches
}

function averageDwellTime(sessions: AppSession[]): number {
  if (sessions.length === 0) return 0
  return sessions.reduce((sum, session) => sum + session.durationSeconds, 0) / sessions.length
}

function sessionEndMs(session: Pick<AppSession, 'startTime' | 'endTime' | 'durationSeconds'>): number {
  return session.endTime ?? (session.startTime + session.durationSeconds * 1000)
}

function inferredFocusedCategoryForSession(session: AppSession): AppCategory {
  if (session.category !== 'uncategorized') return session.category
  const haystack = `${session.bundleId} ${session.appName} ${session.rawAppName ?? ''}`.toLowerCase()
  if (/\b(codex|claude|chatgpt|copilot|perplexity|comet|dia)\b/.test(haystack)) return 'aiTools'
  if (/\b(antigravity|cursor|vscode|visual studio code|zed|xcode|sublime|warp|ghostty|iterm|terminal|cmux)\b/.test(haystack)) return 'development'
  return session.category
}

function effectiveSessionsFor(sessions: AppSession[]): EffectiveSession[] {
  if (sessions.length <= 2) {
    return sessions.map((session) => ({ session, effectiveCategory: inferredFocusedCategoryForSession(session) }))
  }

  const categories = sessions.map((session) => inferredFocusedCategoryForSession(session))
  for (let index = 1; index < sessions.length - 1; index++) {
    const session = sessions[index]
    const isPassiveInterruption =
      (session.category === 'communication'
        || session.category === 'email'
        || session.category === 'entertainment'
        || session.category === 'social')
      && session.durationSeconds < COMMUNICATION_INTERRUPTION_THRESHOLD_SEC

    if (!isPassiveInterruption) continue

    const previousCategory = categories[index - 1]
    const nextCategory = categories[index + 1]
    if (previousCategory === nextCategory && previousCategory !== session.category) {
      categories[index] = previousCategory
    }
  }

  return sessions.map((session, index) => ({
    session,
    effectiveCategory: categories[index],
  }))
}

function categoryDistributionFor(sessions: EffectiveSession[]): Partial<Record<AppCategory, number>> {
  const distribution: Partial<Record<AppCategory, number>> = {}
  for (const entry of sessions) {
    distribution[entry.effectiveCategory] = (distribution[entry.effectiveCategory] ?? 0) + entry.session.durationSeconds
  }
  return distribution
}

function categoryRunsFor(sessions: EffectiveSession[]): CategoryRun[] {
  if (sessions.length === 0) return []

  const runs: CategoryRun[] = []
  let currentCategory = sessions[0].effectiveCategory
  let startIndex = 0
  let totalSeconds = sessions[0].session.durationSeconds

  for (let index = 1; index < sessions.length; index++) {
    const session = sessions[index]
    if (session.effectiveCategory === currentCategory) {
      totalSeconds += session.session.durationSeconds
      continue
    }

    runs.push({ category: currentCategory, startIndex, totalSeconds })
    currentCategory = session.effectiveCategory
    startIndex = index
    totalSeconds = session.session.durationSeconds
  }

  runs.push({ category: currentCategory, startIndex, totalSeconds })
  return runs
}

function sustainedDifferentCategorySplitIndex(runs: CategoryRun[], dominantCategory: AppCategory): number | null {
  return runs.find((run) => run.startIndex > 0 && run.category !== dominantCategory && run.totalSeconds >= SUSTAINED_CATEGORY_THRESHOLD_SEC)?.startIndex ?? null
}

function slowSwitchBoundaryIndex(runs: CategoryRun[]): number | null {
  return runs.length > 1 ? runs[1].startIndex : null
}

function isDeveloperTestingFlow(categories: Set<AppCategory>, averageDwell: number): boolean {
  if (averageDwell >= FAST_SWITCH_THRESHOLD_SEC || !categories.has('development')) return false
  const devAndBrowsing = new Set<AppCategory>(['development', 'browsing'])
  const devAndResearch = new Set<AppCategory>(['development', 'research'])
  return Array.from(categories).every((category) => devAndBrowsing.has(category))
    || Array.from(categories).every((category) => devAndResearch.has(category))
}

function isStandaloneMeeting(session: AppSession): boolean {
  return session.category === 'meetings' && session.durationSeconds >= MEETING_THRESHOLD_SEC
}

function meetingLabel(session: AppSession): string {
  const appName = session.appName.toLowerCase()
  if (appName.includes('zoom')) return 'Zoom Call'
  if (appName.includes('teams')) return 'Teams Call'
  if (appName.includes('meet')) return 'Google Meet'
  return 'Meeting'
}

function isAllowedStreakInterruption(sessions: AppSession[], index: number, targetBundleId: string): boolean {
  const session = sessions[index]
  if (session.durationSeconds < BRIEF_INTERRUPTION_THRESHOLD_SEC) return true

  return index > 0
    && index < sessions.length - 1
    && (session.category === 'communication' || session.category === 'email')
    && session.durationSeconds < COMMUNICATION_INTERRUPTION_THRESHOLD_SEC
    && sessions[index - 1].bundleId === targetBundleId
    && sessions[index + 1].bundleId === targetBundleId
}

function longSingleAppStreak(sessions: AppSession[]): AppStreak | null {
  let best: AppStreak | null = null

  for (let startIndex = 0; startIndex < sessions.length; startIndex++) {
    const first = sessions[startIndex]
    const targetCategory = first.category
    if (!(appCategoryIsFocused(targetCategory) || targetCategory === 'communication' || targetCategory === 'email')) {
      continue
    }

    let totalTargetDuration = 0
    let bestEndIndex: number | null = null

    for (let endIndex = startIndex; endIndex < sessions.length; endIndex++) {
      const session = sessions[endIndex]
      if (session.bundleId === first.bundleId) {
        totalTargetDuration += session.durationSeconds
      } else if (!isAllowedStreakInterruption(sessions, endIndex, first.bundleId)) {
        break
      }

      if (totalTargetDuration > LONG_SINGLE_APP_THRESHOLD_SEC) {
        bestEndIndex = endIndex
      }
    }

    if (bestEndIndex === null) continue

    const streak: AppStreak = {
      range: [startIndex, bestEndIndex + 1],
      targetDurationSeconds: totalTargetDuration,
      label: first.appName,
    }

    if (!best || streak.targetDurationSeconds > best.targetDurationSeconds) {
      best = streak
    }
  }

  return best
}

function gapHasHardActivityBoundary(db: Database.Database, fromMs: number, toMs: number): boolean {
  const rows = db.prepare(`
    SELECT event_type
    FROM activity_state_events
    WHERE event_ts >= ? AND event_ts <= ?
    LIMIT 8
  `).all(fromMs, toMs) as Array<{ event_type: string }>
  return rows.some((row) => /^(sleep|wake|lock|unlock|lock_screen|unlock_screen|suspend|resume|away_start|away_end|idle_start|idle_end)$/.test(row.event_type))
}

function coarseSegmentsFromSessions(db: Database.Database, sessions: AppSession[]): CoarseSegment[] {
  if (sessions.length === 0) return []

  const segments: CoarseSegment[] = []
  let startIndex = 0

  for (let index = 1; index < sessions.length; index++) {
    const previous = sessions[index - 1]
    const current = sessions[index]
    const previousEnd = sessionEndMs(previous)
    if (current.startTime - previousEnd > IDLE_GAP_THRESHOLD_MS && gapHasHardActivityBoundary(db, previousEnd, current.startTime)) {
      segments.push({
        sessions: sessions.slice(startIndex, index),
        boundedBeforeGap: startIndex > 0,
        boundedAfterGap: true,
      })
      startIndex = index
    }
  }

  segments.push({
    sessions: sessions.slice(startIndex),
    boundedBeforeGap: startIndex > 0,
    boundedAfterGap: false,
  })

  return segments
}

function candidateSpanMs(candidate: CandidateBlock): number {
  if (candidate.sessions.length === 0) return 0
  return sessionEndMs(candidate.sessions[candidate.sessions.length - 1]) - candidate.sessions[0].startTime
}

function candidateActiveMs(candidate: CandidateBlock): number {
  return candidate.sessions.reduce((sum, session) => sum + Math.max(0, session.durationSeconds * 1000), 0)
}

function validTimelineSplit(index: number, sessions: AppSession[]): boolean {
  if (index <= 0 || index >= sessions.length) return false
  const leftSpan = sessionEndMs(sessions[index - 1]) - sessions[0].startTime
  const rightSpan = sessionEndMs(sessions[sessions.length - 1]) - sessions[index].startTime
  return leftSpan >= TIMELINE_MIN_CHILD_SPAN_MS && rightSpan >= TIMELINE_MIN_CHILD_SPAN_MS
}

function bestTimelineGapSplitIndex(sessions: AppSession[]): number | null {
  if (sessions.length < 2) return null
  const midpoint = sessions[0].startTime + ((sessionEndMs(sessions[sessions.length - 1]) - sessions[0].startTime) / 2)

  let bestIndex: number | null = null
  let bestScore = Number.NEGATIVE_INFINITY

  for (let index = 1; index < sessions.length; index++) {
    const gapMs = sessions[index].startTime - sessionEndMs(sessions[index - 1])
    if (gapMs < TIMELINE_SPLIT_GAP_THRESHOLD_MS || !validTimelineSplit(index, sessions)) continue

    const midpointDistancePenalty = Math.abs(sessions[index].startTime - midpoint) / 4
    const score = gapMs - midpointDistancePenalty
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }

  return bestIndex
}

function fallbackTimelineSplitIndex(sessions: AppSession[]): number | null {
  if (sessions.length < 2) return null

  const targetTime = sessions[0].startTime + TIMELINE_MAX_BLOCK_SPAN_MS
  for (let index = 1; index < sessions.length; index++) {
    if (sessions[index].startTime >= targetTime && validTimelineSplit(index, sessions)) {
      return index
    }
  }

  for (let index = Math.floor(sessions.length / 2); index < sessions.length; index++) {
    if (validTimelineSplit(index, sessions)) return index
  }
  for (let index = Math.floor(sessions.length / 2) - 1; index > 0; index--) {
    if (validTimelineSplit(index, sessions)) return index
  }

  return null
}

function splitSessionAt(session: AppSession, splitTime: number): [AppSession, AppSession] {
  const endTime = sessionEndMs(session)
  return [
    {
      ...session,
      endTime: splitTime,
      durationSeconds: Math.max(1, Math.round((splitTime - session.startTime) / 1000)),
    },
    {
      ...session,
      startTime: splitTime,
      endTime,
      durationSeconds: Math.max(1, Math.round((endTime - splitTime) / 1000)),
    },
  ]
}

function splitSessionsAtTime(sessions: AppSession[], splitTime: number): [AppSession[], AppSession[]] {
  const left: AppSession[] = []
  const right: AppSession[] = []

  for (const session of sessions) {
    const endTime = sessionEndMs(session)
    if (endTime <= splitTime) {
      left.push(session)
      continue
    }
    if (session.startTime >= splitTime) {
      right.push(session)
      continue
    }

    const [leftSession, rightSession] = splitSessionAt(session, splitTime)
    left.push(leftSession)
    right.push(rightSession)
  }

  return [left, right]
}

function normalizeTimelineCandidates(candidates: CandidateBlock[]): CandidateBlock[] {
  return candidates.flatMap((candidate) => {
    const spanMs = candidateSpanMs(candidate)
    const highlyCoherent = isHighlyCoherentCandidate(candidate)
    const ceilingMs = highlyCoherent ? TIMELINE_MAX_COHERENT_BLOCK_SPAN_MS : TIMELINE_MAX_BLOCK_SPAN_MS

    if (spanMs <= ceilingMs) {
      return [candidate]
    }

    const maxSplitTime = candidate.sessions[0].startTime + ceilingMs
    const [leftSessions, rightSessions] = splitSessionsAtTime(candidate.sessions, maxSplitTime)
    if (leftSessions.length > 0 && rightSessions.length > 0) {
      return normalizeTimelineCandidates(
        analyzeSessions(leftSessions, candidate.boundedBeforeGap, false)
          .concat(analyzeSessions(rightSessions, false, candidate.boundedAfterGap)),
      )
    }

    const splitIndex =
      bestTimelineGapSplitIndex(candidate.sessions)
      ?? fallbackTimelineSplitIndex(candidate.sessions)

    if (splitIndex === null) return [candidate]

    return normalizeTimelineCandidates(
      analyzeSessions(candidate.sessions.slice(0, splitIndex), candidate.boundedBeforeGap, false)
        .concat(analyzeSessions(candidate.sessions.slice(splitIndex), false, candidate.boundedAfterGap)),
    )
  })
}

// Returns true when every session in the candidate shares the same
// (bundleId, compactedWindowTitle) pair and no internal gap exceeds the
// split-gap threshold. Single-session candidates are trivially coherent and
// always qualify.
//
// "Coherent" here is deliberately stricter than the coherence score used in
// `analyzeSessions`: that score is a category-mix heuristic, this one is a
// "same thing, uninterrupted" test. A candidate that passes this test is a
// single continuous stretch the user was on one specific thing — so slicing
// it at 60 minutes just to satisfy a legacy cap is a regression, not a fix.
function isHighlyCoherentCandidate(candidate: CandidateBlock): boolean {
  if (candidate.sessions.length === 0) return false
  if (candidate.sessions.length === 1) return true

  const first = candidate.sessions[0]
  const firstContext = contentContextForSession(first)
  const firstBundleId = first.bundleId

  let previousEnd = sessionEndMs(first)
  for (let index = 1; index < candidate.sessions.length; index++) {
    const session = candidate.sessions[index]
    if (session.bundleId !== firstBundleId) return false
    if (contentContextForSession(session) !== firstContext) return false
    const gapMs = session.startTime - previousEnd
    if (gapMs >= TIMELINE_SPLIT_GAP_THRESHOLD_MS) return false
    previousEnd = sessionEndMs(session)
  }
  return true
}

function splitAndAnalyze(
  sessions: AppSession[],
  splitIndex: number,
  boundedBeforeGap: boolean,
  boundedAfterGap: boolean,
): CandidateBlock[] {
  if (splitIndex <= 0 || splitIndex >= sessions.length) {
    return [{
      sessions,
      formation: 'heuristic',
      boundedBeforeGap,
      boundedAfterGap,
    }]
  }

  return analyzeSessions(sessions.slice(0, splitIndex), boundedBeforeGap, false)
    .concat(analyzeSessions(sessions.slice(splitIndex), false, boundedAfterGap))
}

function hasCodeEvidence(candidate: CandidateBlock): boolean {
  return candidate.sessions.some((session) => {
    if (session.category === 'development') return true
    const haystack = `${session.bundleId} ${session.appName}`.toLowerCase()
    return [
      'cursor',
      'code',
      'xcode',
      'terminal',
      'powershell',
      'cmd.exe',
      'intellij',
      'pycharm',
      'webstorm',
      'idea',
      'sublime',
      'vim',
      'nvim',
    ].some((token) => haystack.includes(token))
  })
}

function labelForCandidate(
  candidate: CandidateBlock,
  dominantCategory: AppCategory,
  distribution: Partial<Record<AppCategory, number>>,
  coherence: number,
  switchCount: number,
): string {
  if (candidate.forcedLabel) return candidate.forcedLabel

  const categories = new Set(candidate.sessions.map((session) => session.category))
  if (coherence < 0.4) return 'Mixed Work'

  const codeEvidence = hasCodeEvidence(candidate)

  if (
    switchCount > 0
    && categories.has('development')
    && (categories.has('browsing') || categories.has('research'))
  ) {
    const totalTime = Object.values(distribution).reduce((sum, value) => sum + value, 0)
    const devTime = distribution.development ?? 0
    const socialTime = (distribution.social ?? 0) + (distribution.entertainment ?? 0)
    const devShare = totalTime > 0 ? devTime / totalTime : 0
    const socialShare = totalTime > 0 ? socialTime / totalTime : 0

    if (devShare >= 0.2 && socialShare < 0.2 && codeEvidence) {
      return switchCount >= 3 ? 'Building & Testing' : 'Development'
    }
  }

  if (dominantCategory === 'communication' || dominantCategory === 'email') {
    return 'Communication'
  }

  if (dominantCategory === 'browsing') {
    const titleLabel = bestTitleLabelForSessions(candidate.sessions)
    if (titleLabel) return titleLabel
    return 'Web Session'
  }

  if (!codeEvidence && (dominantCategory === 'development' || dominantCategory === 'aiTools')) {
    const browserAndAIOnly = candidate.sessions.every((session) => {
      return isBrowserSession(session) || session.category === 'aiTools' || session.category === 'browsing'
    })
    if (browserAndAIOnly) return ''
  }

  const focusedCategories = Array.from(categories).filter((category) => appCategoryIsFocused(category))
  if (focusedCategories.length > 1) return prettyCategory(dominantCategory)
  return prettyCategory(dominantCategory)
}

function bestTitleLabelForSessions(sessions: AppSession[]): string | null {
  const counts = new Map<string, { label: string; seconds: number }>()
  for (const session of sessions) {
    const title = usefulWindowTitle(session)
    if (!title) continue
    const label = compactWindowTitle(title)
    const key = label.toLowerCase()
    const current = counts.get(key)
    if (current) {
      current.seconds += session.durationSeconds
    } else {
      counts.set(key, { label, seconds: session.durationSeconds })
    }
  }
  const best = [...counts.values()]
    .sort((left, right) => right.seconds - left.seconds || left.label.localeCompare(right.label))[0]
  return best?.label ?? null
}

function websiteAwareLabel(block: WorkContextBlock): string {
  const dominated = block.dominantCategory === 'browsing' || block.dominantCategory === 'aiTools'
  const genericLabel =
    !block.ruleBasedLabel
    || block.ruleBasedLabel === 'Web Session'
    || block.ruleBasedLabel === 'Browsing'
    || block.ruleBasedLabel === 'Research & AI Chat'

  if ((!dominated && !genericLabel) || block.websites.length === 0) {
    return block.ruleBasedLabel
  }

  const labels = block.websites.slice(0, 3).map((site) => shortDomainLabel(site.domain))
  if (labels.length === 1) return labels[0]
  if (labels.length >= 2) return `${labels[0]} + ${labels[1]}`
  return block.ruleBasedLabel
}

function shortDomainLabel(domain: string): string {
  return websiteDisplayLabel(domain)
}

// F6: roll up block appearances under their promoted memory pattern. A
// block participates in a rollup only when `pattern_occurrences` records a
// match for one of its block IDs. Blocks without a match fall through as
// single-row rollups so the Apps view can still render every appearance.
function memoryRollupsForBlocks(
  db: Database.Database,
  appearances: Array<{ blockId: string; startTime: number; endTime: number; label: string }>,
): AppDetailPayload['blockMemoryRollups'] {
  if (appearances.length === 0) return []

  const blockIds = appearances.map((row) => row.blockId)
  const hasOccurrences = (() => {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='pattern_occurrences' LIMIT 1`).get() as { name: string } | undefined
    return Boolean(row)
  })()
  if (!hasOccurrences) {
    return appearances.map((row) => ({
      patternId: null,
      patternLabel: row.label,
      sessionCount: 1,
      totalSeconds: Math.max(0, Math.round((row.endTime - row.startTime) / 1000)),
      earliestStart: row.startTime,
      latestEnd: row.endTime,
      sampleBlockIds: [row.blockId],
    }))
  }

  const placeholders = blockIds.map(() => '?').join(', ')
  const occurrences = db.prepare(`
    SELECT
      pattern_occurrences.block_id AS blockId,
      pattern_occurrences.pattern_id AS patternId,
      context_patterns.label_suggestion AS label,
      context_patterns.status AS status
    FROM pattern_occurrences
    JOIN context_patterns ON context_patterns.id = pattern_occurrences.pattern_id
    WHERE pattern_occurrences.block_id IN (${placeholders})
      AND context_patterns.status = 'promoted'
  `).all(...blockIds) as Array<{ blockId: string; patternId: string; label: string; status: string }>

  const patternByBlock = new Map<string, { patternId: string; label: string }>()
  for (const row of occurrences) {
    if (!patternByBlock.has(row.blockId)) {
      patternByBlock.set(row.blockId, { patternId: row.patternId, label: row.label })
    }
  }

  type Rollup = {
    patternId: string | null
    patternLabel: string
    sessionCount: number
    totalSeconds: number
    earliestStart: number
    latestEnd: number
    sampleBlockIds: string[]
  }
  const rollupsByKey = new Map<string, Rollup>()
  const orderKeys: string[] = []
  for (const row of appearances) {
    const match = patternByBlock.get(row.blockId)
    const key = match?.patternId ?? `solo:${row.blockId}`
    const seconds = Math.max(0, Math.round((row.endTime - row.startTime) / 1000))
    const existing = rollupsByKey.get(key)
    if (existing) {
      existing.sessionCount += 1
      existing.totalSeconds += seconds
      existing.earliestStart = Math.min(existing.earliestStart, row.startTime)
      existing.latestEnd = Math.max(existing.latestEnd, row.endTime)
      if (existing.sampleBlockIds.length < 5) existing.sampleBlockIds.push(row.blockId)
      continue
    }
    rollupsByKey.set(key, {
      patternId: match?.patternId ?? null,
      patternLabel: match?.label ?? row.label,
      sessionCount: 1,
      totalSeconds: seconds,
      earliestStart: row.startTime,
      latestEnd: row.endTime,
      sampleBlockIds: [row.blockId],
    })
    orderKeys.push(key)
  }

  return orderKeys.map((key) => rollupsByKey.get(key)!)
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
}

function workflowRefsByBlockId(
  db: Database.Database,
  blockIds: string[],
): Map<string, WorkflowRef[]> {
  const grouped = new Map<string, WorkflowRef[]>()
  if (blockIds.length === 0) return grouped

  const placeholders = blockIds.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT
      workflow_occurrences.block_id,
      workflow_occurrences.confidence,
      workflow_signatures.id,
      workflow_signatures.signature_key,
      workflow_signatures.label,
      workflow_signatures.dominant_category,
      workflow_signatures.canonical_apps_json,
      workflow_signatures.artifact_keys_json
    FROM workflow_occurrences
    JOIN workflow_signatures
      ON workflow_signatures.id = workflow_occurrences.workflow_id
    WHERE workflow_occurrences.block_id IN (${placeholders})
  `).all(...blockIds) as Array<{
    block_id: string
    confidence: number
    id: string
    signature_key: string
    label: string
    dominant_category: AppCategory
    canonical_apps_json: string
    artifact_keys_json: string
  }>

  for (const row of rows) {
    const current = grouped.get(row.block_id) ?? []
    current.push({
      id: row.id,
      signatureKey: row.signature_key,
      label: row.label,
      confidence: row.confidence,
      dominantCategory: row.dominant_category,
      canonicalApps: JSON.parse(row.canonical_apps_json) as string[],
      artifactKeys: JSON.parse(row.artifact_keys_json) as string[],
    })
    grouped.set(row.block_id, current)
  }

  return grouped
}

function loadPersistedAppDetailBlocksForDates(
  db: Database.Database,
  dates: string[],
): Map<string, AppDetailBlockSlice[]> {
  const grouped = new Map<string, AppDetailBlockSlice[]>()
  if (dates.length === 0) return grouped

  const placeholders = dates.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT
      id,
      date,
      start_time,
      end_time,
      dominant_category,
      label_current,
      evidence_summary_json
    FROM timeline_blocks
    WHERE invalidated_at IS NULL
      AND date IN (${placeholders})
    ORDER BY start_time ASC
  `).all(...dates) as Array<{
    id: string
    date: string
    start_time: number
    end_time: number
    dominant_category: AppCategory
    label_current: string
    evidence_summary_json: string
  }>

  const workflowsByBlock = workflowRefsByBlockId(db, rows.map((row) => row.id))

  for (const row of rows) {
    let evidence: Partial<TimelineEvidenceSummary> = {}
    try {
      evidence = JSON.parse(row.evidence_summary_json || '{}') as Partial<TimelineEvidenceSummary>
    } catch {
      evidence = {}
    }

    const pageRefs = Array.isArray(evidence.pages) ? evidence.pages as PageRef[] : []
    const documentRefs = Array.isArray(evidence.documents) ? evidence.documents as DocumentRef[] : []
    const topArtifacts = [...pageRefs, ...documentRefs]
      .sort((left, right) => right.totalSeconds - left.totalSeconds)
      .slice(0, 8)

    const current = grouped.get(row.date) ?? []
    current.push({
      id: row.id,
      startTime: row.start_time,
      endTime: row.end_time,
      dominantCategory: row.dominant_category,
      label: {
        current: row.label_current,
      },
      topApps: Array.isArray(evidence.apps) ? evidence.apps as WorkContextAppSummary[] : [],
      topArtifacts,
      pageRefs,
      workflowRefs: workflowsByBlock.get(row.id) ?? [],
    })
    grouped.set(row.date, current)
  }

  return grouped
}

function confidenceForCandidate(candidate: CandidateBlock, coherence: number): BlockConfidence {
  if (candidate.formation === 'coherent' && candidate.boundedBeforeGap && candidate.boundedAfterGap && coherence > 0.75) {
    return 'high'
  }
  if (candidate.formation === 'mixed' && coherence < 0.4) {
    return 'low'
  }
  return 'medium'
}

function topAppsFromSessions(sessions: AppSession[]): WorkContextAppSummary[] {
  const grouped = new Map<string, WorkContextAppSummary>()

  for (const session of sessions) {
    const existing = grouped.get(session.bundleId)
    if (existing) {
      existing.totalSeconds += session.durationSeconds
      existing.sessionCount += 1
      continue
    }

    const identity = resolveCanonicalApp(session.bundleId, session.appName)
    grouped.set(session.bundleId, {
      bundleId: session.bundleId,
      appName: identity.displayName || sanitizeBlockLabel(session.appName) || session.appName,
      category: session.category,
      totalSeconds: session.durationSeconds,
      sessionCount: 1,
      isBrowser: isBrowserSession(session),
    })
  }

  return Array.from(grouped.values())
    .sort((left, right) => {
      if (left.totalSeconds === right.totalSeconds) {
        return left.appName.localeCompare(right.appName)
      }
      return right.totalSeconds - left.totalSeconds
    })
    .slice(0, 5)
}

function sha1(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex')
}

function artifactIdFor(canonicalKey: string): string {
  return `art_${sha1(canonicalKey).slice(0, 16)}`
}

function blockIdFor(blockStart: number, blockEnd: number, sessionIds: number[], isLive: boolean): string {
  const signature = `${blockStart}:${blockEnd}:${sessionIds.join(',')}:${TIMELINE_HEURISTIC_VERSION}`
  const prefix = isLive ? 'live' : 'blk'
  return `${prefix}_${sha1(signature).slice(0, 16)}`
}

function workflowIdFor(signatureKey: string): string {
  return `wf_${sha1(signatureKey).slice(0, 16)}`
}

function labelConfidenceValue(confidence: BlockConfidence): number {
  if (confidence === 'high') return 0.9
  if (confidence === 'medium') return 0.7
  return 0.45
}

function artifactKindForSession(session: AppSession): DocumentRef['artifactType'] {
  const title = session.windowTitle?.toLowerCase() ?? ''
  if (session.category === 'development') {
    if (title.includes('github') || title.includes('.git')) return 'repo'
    return 'project'
  }
  if (session.category === 'writing' || session.category === 'productivity' || session.category === 'design') {
    return 'document'
  }
  return 'window'
}

// B9: terminal apps (Warp, Ghostty, iTerm, Kiro terminal) frequently set
// their window title to whatever the shell prompt emits — the OS username,
// the current working-directory name, or a single bare token. Surfacing
// "tonny" or "Obsidian Vault" as a session label in the Apps "What you did
// there" list is a window-title leak masquerading as activity. Reject
// titles that match the running user's name or that are a single short
// bare token with no path/punctuation evidence. A path-shaped title like
// "~/Dev-Personal/daylens" or a multi-word title still passes through —
// only username-shaped noise is filtered.
const SHELL_PROMPT_TOKENS = new Set(['root', 'bash', 'zsh', 'sh', 'fish', 'admin', 'user'])
const HOME_USERNAME = (process.env.USER ?? process.env.LOGNAME ?? process.env.USERNAME ?? '').toLowerCase()

function looksLikeShellPromptTitle(title: string): boolean {
  const lower = title.toLowerCase().trim()
  if (HOME_USERNAME && lower === HOME_USERNAME) return true
  if (SHELL_PROMPT_TOKENS.has(lower)) return true
  // Single short bare token with no whitespace, slash, dot, or dash. Genuine
  // page titles ("Inbox", "Daylens") would still match this shape — but
  // those are filtered earlier by titleLooksUseful + appName/rawAppName
  // checks below; terminal-prompt noise is what slips through.
  if (lower.length <= 14 && !/[\s\/\\.\-:]/.test(lower)) {
    // Allow it through only if it looks like camelCase or contains digits —
    // a clue that it's a real entity rather than a shell username.
    if (!/[A-Z0-9]/.test(title)) return true
  }
  return false
}

function usefulWindowTitle(session: AppSession): string | null {
  if (!titleLooksUseful(session.windowTitle)) return null
  const title = session.windowTitle.trim()
  const lowerTitle = title.toLowerCase()
  if (lowerTitle === session.appName.toLowerCase()) return null
  if (lowerTitle === (session.rawAppName ?? '').toLowerCase()) return null
  if (looksLikeShellPromptTitle(title)) return null
  return title
}

function compactWindowTitle(title: string): string {
  return title
    .split(/\s[—-]\s/)
    .map((part) => part.trim())
    .find((part) => part.length > 2) ?? title.trim()
}

function contentContextForSession(session: AppSession): string {
  const title = usefulWindowTitle(session)
  if (title) return compactWindowTitle(title).toLowerCase()
  return `${session.category}:${session.bundleId}`.toLowerCase()
}

function contextRunsFor(sessions: AppSession[]): ContextRun[] {
  if (sessions.length === 0) return []

  const runs: ContextRun[] = []
  let currentContext = contentContextForSession(sessions[0])
  let startIndex = 0
  let totalSeconds = sessions[0].durationSeconds

  for (let index = 1; index < sessions.length; index++) {
    const session = sessions[index]
    const context = contentContextForSession(session)
    if (context === currentContext) {
      totalSeconds += session.durationSeconds
      continue
    }

    runs.push({ context: currentContext, startIndex, totalSeconds })
    currentContext = context
    startIndex = index
    totalSeconds = session.durationSeconds
  }

  runs.push({ context: currentContext, startIndex, totalSeconds })
  return runs
}

interface TimelineBuildContext {
  websiteVisits: WebsiteVisitRecord[]
}

function buildTimelineContext(db: Database.Database, sessions: AppSession[]): TimelineBuildContext {
  if (sessions.length === 0) return { websiteVisits: [] }
  const startTime = Math.min(...sessions.map((session) => session.startTime))
  const endTime = Math.max(...sessions.map((session) => sessionEndMs(session)))
  return {
    websiteVisits: getWebsiteVisitsForRange(db, startTime, endTime),
  }
}

function websiteVisitsForRange(
  db: Database.Database,
  startTime: number,
  endTime: number,
  context?: TimelineBuildContext,
): WebsiteVisitRecord[] {
  if (!context) return getWebsiteVisitsForRange(db, startTime, endTime)
  return context.websiteVisits.filter((visit) => visit.visitTime >= startTime && visit.visitTime < endTime)
}

function sustainedContextShiftSplitIndex(sessions: AppSession[]): number | null {
  const runs = contextRunsFor(sessions)
  if (runs.length < 2) return null

  let previousSustainedContext: string | null = null
  let previousSustainedSeconds = 0
  for (const run of runs) {
    if (run.totalSeconds < SUSTAINED_CONTEXT_SHIFT_THRESHOLD_SEC) continue
    const leftSpan = run.startIndex > 0 ? sessionEndMs(sessions[run.startIndex - 1]) - sessions[0].startTime : 0
    const rightSpan = sessionEndMs(sessions[sessions.length - 1]) - sessions[run.startIndex].startTime
    if (
      previousSustainedContext
      && previousSustainedContext !== run.context
      && previousSustainedSeconds >= SUSTAINED_CONTEXT_SHIFT_THRESHOLD_SEC
      && leftSpan >= SUSTAINED_CONTEXT_SHIFT_THRESHOLD_SEC * 1000
      && rightSpan >= SUSTAINED_CONTEXT_SHIFT_THRESHOLD_SEC * 1000
    ) {
      return run.startIndex
    }
    previousSustainedContext = run.context
    previousSustainedSeconds = run.totalSeconds
  }

  return null
}

function buildPageCandidates(
  db: Database.Database,
  startTime: number,
  endTime: number,
  context?: TimelineBuildContext,
): ArtifactCandidate[] {
  const grouped = new Map<string, {
    canonicalKey: string
    domain: string
    browserBundleId: string | null
    canonicalBrowserId: string | null
    displayTitle: string
    pageTitle: string | null
    normalizedUrl: string | null
    url: string | null
    totalSeconds: number
  }>()

  for (const visit of websiteVisitsForRange(db, startTime, endTime, context)) {
    // Domain policy gate: adult-host pages are filtered at source so they
    // never become artifact candidates, never get promoted to block labels,
    // and never appear in any app's topArtifacts list. The raw visit row
    // stays in website_visits.url so the user can still see their own
    // browsing history if they look — we just don't surface it as a
    // headline anywhere in the product.
    if (isHostFilteredFromArtifacts(visit.domain)) continue

    const canonicalKey = visit.normalizedUrl ?? normalizeUrlForStorage(visit.url) ?? `domain:${visit.domain}`
    const existing = grouped.get(canonicalKey)
    const pageTitle = normalizeWebsiteTitleForDisplay(visit.domain, visit.pageTitle)
    const displayTitle = pageTitle || websiteDisplayLabel(visit.domain)

    if (existing) {
      existing.totalSeconds += visit.durationSec
      if (!existing.pageTitle && pageTitle) {
        existing.pageTitle = pageTitle
        existing.displayTitle = displayTitle
      }
      continue
    }

    grouped.set(canonicalKey, {
      canonicalKey,
      domain: visit.domain,
      browserBundleId: visit.browserBundleId,
      canonicalBrowserId: visit.canonicalBrowserId,
      displayTitle,
      pageTitle,
      normalizedUrl: visit.normalizedUrl ?? null,
      url: visit.url ?? null,
      totalSeconds: visit.durationSec,
    })
  }

  return Array.from(grouped.values())
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
    .slice(0, 5)
    .map((page) => {
      const pageRef: PageRef = {
        id: artifactIdFor(`page:${page.canonicalKey}`),
        artifactType: 'page',
        canonicalKey: `page:${page.canonicalKey}`,
        displayTitle: page.displayTitle,
        subtitle: page.domain,
        totalSeconds: page.totalSeconds,
        confidence: 0.9,
        canonicalAppId: page.canonicalBrowserId
          ?? (page.browserBundleId
            ? resolveCanonicalApp(page.browserBundleId, page.browserBundleId).canonicalAppId
            : null),
        url: page.url,
        host: page.domain,
        openTarget: {
          kind: page.url ? 'external_url' : 'unsupported',
          value: page.url,
        },
        metadata: {
          normalizedUrl: page.normalizedUrl,
        },
        domain: page.domain,
        browserBundleId: page.browserBundleId,
        canonicalBrowserId: page.canonicalBrowserId,
        normalizedUrl: page.normalizedUrl,
        pageTitle: page.pageTitle,
      }

      return {
        artifact: pageRef,
        pageRef,
        sourceType: 'website_visit',
        sourceId: page.canonicalKey,
        startTime,
        endTime,
      }
    })
}

function buildWindowArtifactCandidates(sessions: AppSession[]): ArtifactCandidate[] {
  const grouped = new Map<string, {
    sessionIds: number[]
    title: string
    artifactType: DocumentRef['artifactType']
    totalSeconds: number
    canonicalAppId: string | null
    ownerBundleId: string | null
    ownerAppName: string | null
    ownerAppInstanceId: string | null
  }>()

  for (const session of sessions) {
    // Browser sessions' window titles ARE their page titles — those should
    // be sourced from website_visits via buildPageCandidates (which is
    // policy-aware), not from window-title heuristics. Creating a
    // window-type document artifact from a browser window title duplicates
    // the page and bypasses the adult-host filter at buildPageCandidates.
    if (isBrowserSession(session)) continue

    const title = usefulWindowTitle(session)
    if (!title) continue

    const artifactType = artifactKindForSession(session)
    const displayTitle = compactWindowTitle(title)
    const canonicalAppId = session.canonicalAppId ?? resolveCanonicalApp(session.bundleId, session.appName).canonicalAppId
    const canonicalKey = `${artifactType}:${canonicalAppId ?? session.bundleId}:${displayTitle.toLowerCase()}`
    const existing = grouped.get(canonicalKey)

    if (existing) {
      existing.totalSeconds += session.durationSeconds
      existing.sessionIds.push(session.id)
      existing.ownerBundleId = existing.ownerBundleId ?? session.bundleId
      existing.ownerAppName = existing.ownerAppName ?? session.appName
      existing.ownerAppInstanceId = existing.ownerAppInstanceId ?? session.appInstanceId ?? null
      continue
    }

    grouped.set(canonicalKey, {
      sessionIds: [session.id],
      title: displayTitle,
      artifactType,
      totalSeconds: session.durationSeconds,
      canonicalAppId,
      ownerBundleId: session.bundleId,
      ownerAppName: session.appName,
      ownerAppInstanceId: session.appInstanceId ?? null,
    })
  }

  return Array.from(grouped.entries())
    .sort((left, right) => right[1].totalSeconds - left[1].totalSeconds)
    .slice(0, 5)
    .map(([canonicalKey, value]) => {
      const documentRef: DocumentRef = {
        id: artifactIdFor(canonicalKey),
        artifactType: value.artifactType,
        canonicalKey,
        displayTitle: value.title,
        subtitle: value.canonicalAppId ?? null,
        totalSeconds: value.totalSeconds,
        confidence: 0.7,
        canonicalAppId: value.canonicalAppId,
        ownerBundleId: value.ownerBundleId,
        ownerAppName: value.ownerAppName,
        ownerAppInstanceId: value.ownerAppInstanceId,
        openTarget: {
          kind: 'unsupported',
          value: null,
        },
        metadata: {
          ownerBundleId: value.ownerBundleId,
          ownerAppName: value.ownerAppName,
          ownerAppInstanceId: value.ownerAppInstanceId,
        },
        sourceSessionIds: value.sessionIds,
      }

      return {
        artifact: documentRef,
        documentRef,
        sourceType: 'app_session',
        sourceId: value.sessionIds.join(','),
        startTime: sessions[0]?.startTime ?? 0,
        endTime: sessions[sessions.length - 1]?.endTime ?? sessions[sessions.length - 1]?.startTime ?? 0,
      }
    })
}

function workflowLabelForBlock(apps: string[], block: WorkContextBlock): string {
  if (apps.length === 0) return userVisibleLabelForBlock(block)
  // Map canonical IDs → display names using the block's own topApps list
  const idToName = new Map(
    block.topApps.map((a) => {
      const identity = resolveCanonicalApp(a.bundleId, a.appName)
      return [identity.canonicalAppId ?? a.bundleId, a.appName]
    })
  )
  const names = apps.map((id) => {
    const found = idToName.get(id)
    if (found) return found
    // Fallback: title-case the canonical ID (better than leaking raw id)
    return id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  })
  if (names.length === 1) return `${names[0]} loop`
  return `${names.slice(0, 2).join(' + ')}`
}

function focusOverlapForRange(
  db: Database.Database,
  startTime: number,
  endTime: number,
): { totalSeconds: number; pct: number; sessionIds: number[] } {
  const overlaps = getFocusSessionsForDateRange(db, startTime, endTime)
    .map((session) => {
      const overlapStart = Math.max(session.startTime, startTime)
      const overlapEnd = Math.min(session.endTime ?? endTime, endTime)
      return {
        sessionId: session.id,
        seconds: Math.max(0, Math.round((overlapEnd - overlapStart) / 1000)),
      }
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

function buildBlockFromCandidate(
  candidate: CandidateBlock,
  db: Database.Database,
  context?: TimelineBuildContext,
): WorkContextBlock {
  const effectiveSessions = effectiveSessionsFor(candidate.sessions)
  const distribution = categoryDistributionFor(effectiveSessions)
  const coherence = coherenceScore(distribution)
  const switchCount = countAppSwitches(candidate.sessions)
  const blockStart = candidate.sessions[0].startTime
  const lastSession = candidate.sessions[candidate.sessions.length - 1]
  const blockEnd = lastSession.endTime ?? (lastSession.startTime + lastSession.durationSeconds * 1000)
  const computedAt = Date.now()
  const websites = getWebsiteSummariesForRange(db, blockStart, blockEnd).slice(0, 5)
  const keyPagesByDomain = getTopPagesForDomains(db, blockStart, blockEnd, websites.map((site) => site.domain), 2)
  const keyPages = websites.flatMap((site) => keyPagesByDomain[site.domain] ?? [])
    .map((page) => page.title?.trim())
    .filter((title): title is string => Boolean(title))
    .filter((title, index, titles) => titles.indexOf(title) === index)
    .slice(0, 4)
  const isLive = candidate.sessions.some((session) => session.id === -1)
  const storedInsight = isLive ? null : getWorkContextInsightForRange(db, blockStart, blockEnd)
  const confidence = confidenceForCandidate(candidate, coherence)
  const topApps = topAppsFromSessions(candidate.sessions)
  const pageCandidates = buildPageCandidates(db, blockStart, blockEnd, context)
  const windowCandidates = buildWindowArtifactCandidates(candidate.sessions)
  const pageRefs = pageCandidates.flatMap((candidate) => candidate.pageRef ? [candidate.pageRef] : [])
  const documentRefs = windowCandidates.flatMap((candidate) => candidate.documentRef ? [candidate.documentRef] : [])
  const topArtifacts = [...pageRefs, ...documentRefs]
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
    .slice(0, 6)
  const dominantCategory = dominantCategoryForBlock(distribution, topArtifacts)
  const evidenceSummary = {
    apps: topApps,
    pages: pageRefs,
    documents: documentRefs,
    domains: websites.map((site) => site.domain),
  }
  const blockId = blockIdFor(
    blockStart,
    blockEnd,
    candidate.sessions.map((session) => session.id),
    isLive,
  )
  const rawRuleLabel = labelForCandidate(candidate, dominantCategory, distribution, coherence, switchCount)

  const baseBlock: WorkContextBlock = {
    id: blockId,
    startTime: blockStart,
    endTime: blockEnd,
    dominantCategory,
    categoryDistribution: distribution,
    ruleBasedLabel: rawRuleLabel,
    aiLabel: storedInsight?.label ?? null,
    sessions: candidate.sessions,
    topApps,
    websites,
    keyPages,
    pageRefs,
    documentRefs,
    topArtifacts,
    workflowRefs: [],
    label: {
      current: rawRuleLabel,
      source: 'rule',
      confidence: labelConfidenceValue(confidence),
      narrative: storedInsight?.narrative ?? null,
      ruleBased: rawRuleLabel,
      aiSuggested: storedInsight?.label ?? null,
      override: null,
    },
    focusOverlap: focusOverlapForRange(db, blockStart, blockEnd),
    evidenceSummary,
    heuristicVersion: TIMELINE_HEURISTIC_VERSION,
    computedAt,
    switchCount,
    confidence,
    isLive,
  }

  const normalizedBlock = {
    ...baseBlock,
    ruleBasedLabel: websiteAwareLabel(baseBlock),
  }

  const workflowApps = normalizedBlock.topApps
    .map((app) => app.bundleId)
    .map((bundleId, index) => {
      const identity = resolveCanonicalApp(bundleId, normalizedBlock.topApps[index].appName)
      return identity.canonicalAppId ?? bundleId
    })
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 3)
  const workflowArtifactKeys = normalizedBlock.topArtifacts
    .map((artifact) => artifact.canonicalKey ?? artifact.id)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 3)
  const signatureKey = JSON.stringify({
    apps: workflowApps,
    artifacts: workflowArtifactKeys,
    label: normalizedBlock.ruleBasedLabel.toLowerCase(),
    category: dominantCategory,
  })

  const workflowRef: WorkflowRef = {
    id: workflowIdFor(signatureKey),
    signatureKey,
    label: workflowLabelForBlock(workflowApps, normalizedBlock),
    confidence: Math.min(0.9, labelConfidenceValue(confidence)),
    dominantCategory,
    canonicalApps: workflowApps,
    artifactKeys: workflowArtifactKeys,
  }

  return {
    ...normalizedBlock,
    label: {
      ...normalizedBlock.label,
      current: normalizedBlock.ruleBasedLabel,
      ruleBased: normalizedBlock.ruleBasedLabel,
    },
    workflowRefs: workflowApps.length > 0 ? [workflowRef] : [],
  }
}

function analyzeSessions(
  sessions: AppSession[],
  boundedBeforeGap: boolean,
  boundedAfterGap: boolean,
): CandidateBlock[] {
  if (sessions.length === 0) return []

  const firstMeetingIndex = sessions.findIndex(isStandaloneMeeting)
  if (firstMeetingIndex >= 0) {
    const blocks: CandidateBlock[] = []
    const before = sessions.slice(0, firstMeetingIndex)
    if (before.length > 0) {
      blocks.push(...analyzeSessions(before, boundedBeforeGap, false))
    }

    const meeting = sessions[firstMeetingIndex]
    blocks.push({
      sessions: [meeting],
      formation: 'meeting',
      boundedBeforeGap: firstMeetingIndex === 0 ? boundedBeforeGap : false,
      boundedAfterGap: firstMeetingIndex === sessions.length - 1 ? boundedAfterGap : false,
      forcedLabel: meetingLabel(meeting),
    })

    const after = sessions.slice(firstMeetingIndex + 1)
    if (after.length > 0) {
      blocks.push(...analyzeSessions(after, false, boundedAfterGap))
    }
    return blocks
  }

  const contextSplitIndex = sustainedContextShiftSplitIndex(sessions)
  if (contextSplitIndex !== null) {
    return splitAndAnalyze(sessions, contextSplitIndex, boundedBeforeGap, boundedAfterGap)
  }

  const streak = longSingleAppStreak(sessions)
  if (streak) {
    const [startIndex, endIndex] = streak.range
    const blocks: CandidateBlock[] = []
    if (startIndex > 0) {
      blocks.push(...analyzeSessions(sessions.slice(0, startIndex), boundedBeforeGap, false))
    }
    blocks.push({
      sessions: sessions.slice(startIndex, endIndex),
      formation: 'longSingleApp',
      boundedBeforeGap: startIndex === 0 ? boundedBeforeGap : false,
      boundedAfterGap: endIndex === sessions.length ? boundedAfterGap : false,
      forcedLabel: streak.label,
    })
    if (endIndex < sessions.length) {
      blocks.push(...analyzeSessions(sessions.slice(endIndex), false, boundedAfterGap))
    }
    return blocks
  }

  const effectiveSessions = effectiveSessionsFor(sessions)
  const distribution = categoryDistributionFor(effectiveSessions)
  const dominant = dominantCategoryFromDistribution(distribution)
  const coherence = coherenceScore(distribution)
  const averageDwell = averageDwellTime(sessions)
  const runs = categoryRunsFor(effectiveSessions)

  if (coherence < 0.4) {
    const splitIndex = sustainedDifferentCategorySplitIndex(runs, dominant)
    if (splitIndex !== null) {
      return splitAndAnalyze(sessions, splitIndex, boundedBeforeGap, boundedAfterGap)
    }
  }

  if (coherence >= 0.4 && coherence <= 0.75) {
    if (isDeveloperTestingFlow(new Set(Object.keys(distribution) as AppCategory[]), averageDwell)) {
      return [{ sessions, formation: 'heuristic', boundedBeforeGap, boundedAfterGap }]
    }

    if (averageDwell > SLOW_SWITCH_THRESHOLD_SEC) {
      const splitIndex = slowSwitchBoundaryIndex(runs)
      if (splitIndex !== null) {
        return splitAndAnalyze(sessions, splitIndex, boundedBeforeGap, boundedAfterGap)
      }
    }
  }

  const formation: FormationReason =
    coherence > 0.75 ? 'coherent' : coherence < 0.4 ? 'mixed' : 'heuristic'

  return [{ sessions, formation, boundedBeforeGap, boundedAfterGap }]
}

// Categories where the page/topic IS the activity, so a topic change is a real
// boundary even when the app and category stay the same. A camera-research tab
// and a city-council tab are both "browsing" in the same browser, but they are
// two different things and must stay two blocks. Work categories are the
// opposite: switching from a source file to a terminal command is the same
// coding session and should read as one block.
const TOPIC_SENSITIVE_CATEGORIES = new Set<AppCategory>([
  'browsing',
  'aiTools',
  'research',
  'entertainment',
  'social',
])

// Drift / consumption categories that must never be bridged across a gap. Each
// stretch stands on its own; only same-segment near-contiguous slivers coalesce
// (see shouldSoftMerge / absorbShortCandidates). Focused work (development,
// writing, design, research, aiTools, etc.) can still bridge a moderate gap.
const NON_BRIDGEABLE_CATEGORIES = new Set<AppCategory>([
  'browsing',
  'entertainment',
  'social',
])

function candidateDominantCategory(candidate: CandidateBlock, db?: Database.Database, context?: TimelineBuildContext): AppCategory {
  const distribution = categoryDistributionFor(effectiveSessionsFor(candidate.sessions))
  if (!db) return dominantCategoryFromDistribution(distribution)
  return dominantCategoryForBlock(distribution, candidatePageArtifacts(candidate, db, context))
}

function candidatePageArtifacts(candidate: CandidateBlock, db: Database.Database, context?: TimelineBuildContext): ArtifactRef[] {
  return buildPageCandidates(
    db,
    candidate.sessions[0]?.startTime ?? 0,
    candidate.sessions.length > 0 ? sessionEndMs(candidate.sessions[candidate.sessions.length - 1]) : 0,
    context,
  )
    .flatMap((candidate) => candidate.pageRef ? [candidate.pageRef] : [])
    .slice(0, 6)
}

function candidateHasFocusedPageArtifact(candidate: CandidateBlock, db?: Database.Database, context?: TimelineBuildContext): boolean {
  if (!db) return false
  return Boolean(categoryForTopPageArtifact(candidatePageArtifacts(candidate, db, context)))
}

function candidateTopAppIds(candidate: CandidateBlock): Set<string> {
  return new Set(topAppsFromSessions(candidate.sessions).map((app) => app.bundleId))
}

function dominantContentContext(sessions: AppSession[]): string {
  const runs = contextRunsFor(sessions)
  if (runs.length === 0) return ''
  return runs.reduce((best, run) => (run.totalSeconds > best.totalSeconds ? run : best), runs[0]).context
}

function gapBetweenCandidates(left: CandidateBlock, right: CandidateBlock): number {
  return right.sessions[0].startTime - sessionEndMs(left.sessions[left.sessions.length - 1])
}

function combinedSpanMs(left: CandidateBlock, right: CandidateBlock): number {
  return sessionEndMs(right.sessions[right.sessions.length - 1]) - left.sessions[0].startTime
}

function candidateHasAssistedWorkCategory(candidate: CandidateBlock, db?: Database.Database, context?: TimelineBuildContext): boolean {
  const category = candidateDominantCategory(candidate, db, context)
  return category === 'aiTools' || category === 'development' || category === 'research' || category === 'productivity'
}

function candidatesAreAssistedWorkPair(left: CandidateBlock, right: CandidateBlock, db?: Database.Database, context?: TimelineBuildContext): boolean {
  if (!candidateHasAssistedWorkCategory(left, db, context) || !candidateHasAssistedWorkCategory(right, db, context)) return false
  const categories = new Set([candidateDominantCategory(left, db, context), candidateDominantCategory(right, db, context)])
  return categories.has('aiTools') && (
    categories.has('development')
    || categories.has('research')
    || categories.has('productivity')
    || candidateHasFocusedPageArtifact(left, db, context)
    || candidateHasFocusedPageArtifact(right, db, context)
  )
}

function mergeCandidatePair(left: CandidateBlock, right: CandidateBlock): CandidateBlock {
  return {
    sessions: [...left.sessions, ...right.sessions],
    // The merged stretch is no longer a single forced-label unit, so let
    // buildBlockFromCandidate re-derive the label from the combined evidence.
    formation: 'heuristic',
    boundedBeforeGap: left.boundedBeforeGap,
    boundedAfterGap: right.boundedAfterGap,
  }
}

// Soft-merge rule (R2): two adjacent candidates within 5 minutes of each other
// and under the 120-minute ceiling are the same work when they share a dominant
// category. For a work category that is enough — interleaving an editor and a
// terminal on one project splits into single-app fragments at every context
// shift, and those are one coding session, not four blocks. For a
// topic-sensitive category the dominant content context must also match (and we
// require a shared top app), so two distinct browsing topics stay separate.
function shouldSoftMerge(left: CandidateBlock, right: CandidateBlock, db?: Database.Database, context?: TimelineBuildContext): boolean {
  if (left.formation === 'meeting' || right.formation === 'meeting') return false
  if (gapBetweenCandidates(left, right) >= TIMELINE_SPLIT_GAP_THRESHOLD_MS) return false

  const category = candidateDominantCategory(left, db, context)
  if (category !== candidateDominantCategory(right, db, context)) {
    return candidatesAreAssistedWorkPair(left, right, db, context)
      && combinedSpanMs(left, right) <= TIMELINE_MAX_ASSISTED_WORK_SPAN_MS
  }

  if (
    combinedSpanMs(left, right) > TIMELINE_MAX_BLOCK_SPAN_MS
    && !(candidatesAreAssistedWorkPair(left, right, db, context) && combinedSpanMs(left, right) <= TIMELINE_MAX_ASSISTED_WORK_SPAN_MS)
  ) return false

  if (candidatesAreAssistedWorkPair(left, right, db, context) && combinedSpanMs(left, right) <= TIMELINE_MAX_ASSISTED_WORK_SPAN_MS) {
    return true
  }

  if (!TOPIC_SENSITIVE_CATEGORIES.has(category)) return true

  const leftApps = candidateTopAppIds(left)
  const sharesTopApp = [...candidateTopAppIds(right)].some((id) => leftApps.has(id))
  if (!sharesTopApp) return false
  return dominantContentContext(left.sessions) === dominantContentContext(right.sessions)
}

// Two candidates are "semantically related" — i.e. plausibly the same activity
// continued — when they share a dominant category. For a topic-sensitive
// category (browsing, AI tools, research, entertainment, social) that is not
// enough: two distinct browsing topics are the same category but different
// work, so we additionally require a shared top app and the same dominant
// content context. This mirrors shouldSoftMerge's relatedness test minus the
// gap/span constraints, and is the signal used to decide which neighbour a
// short block attaches to.
function candidatesRelated(a: CandidateBlock, b: CandidateBlock, db?: Database.Database, context?: TimelineBuildContext): boolean {
  const category = candidateDominantCategory(a, db, context)
  if (category !== candidateDominantCategory(b, db, context)) return candidatesAreAssistedWorkPair(a, b, db, context)
  if (!TOPIC_SENSITIVE_CATEGORIES.has(category)) return true
  const aApps = candidateTopAppIds(a)
  const sharesTopApp = [...candidateTopAppIds(b)].some((id) => aApps.has(id))
  if (!sharesTopApp) return false
  return dominantContentContext(a.sessions) === dominantContentContext(b.sessions)
}

// Fold short blocks into the adjacent block they most belong with — preferring
// a same-category neighbour, otherwise the one separated by the smaller gap —
// without ever swallowing a meeting.
//
// Two bands, controlled by the caller:
//   • Sub-5-minute slivers are pure noise: fold them into whichever non-meeting
//     neighbour exists (requireRelated = false), ignoring any span ceiling.
//   • Sub-30-minute blocks should generally not stand alone, but only collapse
//     when there is a *related* neighbour (requireRelated = true) and the merge
//     stays under the coherent ceiling. An isolated 20-minute activity with no
//     related neighbour keeps its own block.
function absorbShortCandidates(
  candidates: CandidateBlock[],
  maxSpanMs: number,
  options: { requireRelated: boolean; maxCombinedMs: number },
  db?: Database.Database,
  context?: TimelineBuildContext,
): CandidateBlock[] {
  if (candidates.length <= 1) return candidates

  const result = [...candidates]
  for (let index = 0; index < result.length; index++) {
    const candidate = result[index]
    if (candidate.formation === 'meeting') continue
    if (candidateActiveMs(candidate) >= maxSpanMs) continue

    const left = index > 0 ? result[index - 1] : null
    const right = index < result.length - 1 ? result[index + 1] : null
    const category = candidateDominantCategory(candidate, db, context)
    const leftOk = Boolean(
      left
      && left.formation !== 'meeting'
      && !(left.boundedAfterGap && candidate.boundedBeforeGap)
      && (!options.requireRelated || candidatesRelated(candidate, left, db, context))
      && combinedSpanMs(left, candidate) <= options.maxCombinedMs,
    )
    const rightOk = Boolean(
      right
      && right.formation !== 'meeting'
      && !(candidate.boundedAfterGap && right.boundedBeforeGap)
      && (!options.requireRelated || candidatesRelated(candidate, right, db, context))
      && combinedSpanMs(candidate, right) <= options.maxCombinedMs,
    )

    let mergeLeft: boolean
    if (leftOk && !rightOk) mergeLeft = true
    else if (!leftOk && rightOk) mergeLeft = false
    else if (!leftOk && !rightOk) continue
    else if (candidateDominantCategory(left!, db, context) === category && candidateDominantCategory(right!, db, context) !== category) mergeLeft = true
    else if (candidateDominantCategory(right!, db, context) === category && candidateDominantCategory(left!, db, context) !== category) mergeLeft = false
    else mergeLeft = gapBetweenCandidates(left!, candidate) <= gapBetweenCandidates(candidate, right!)

    if (mergeLeft) {
      result[index - 1] = mergeCandidatePair(left!, candidate)
      result.splice(index, 1)
      index -= 2
    } else {
      result[index] = mergeCandidatePair(candidate, right!)
      result.splice(index + 1, 1)
      index -= 1
    }
  }
  return result
}

// Coalesce a single coarse segment's candidates: re-join fragments of the same
// work, fold away sub-5-minute slivers, then fold sub-30-minute blocks into a
// related neighbour so the timeline reads as continuous focused stretches.
// Runs per coarse segment so it never merges across sleep / >15-minute idle
// boundaries.
function coalesceTimelineCandidates(candidates: CandidateBlock[], db: Database.Database, context: TimelineBuildContext): CandidateBlock[] {
  if (candidates.length <= 1) return candidates

  const merged: CandidateBlock[] = [candidates[0]]
  for (let index = 1; index < candidates.length; index++) {
    const previous = merged[merged.length - 1]
    const current = candidates[index]
    if (shouldSoftMerge(previous, current, db, context)) {
      merged[merged.length - 1] = mergeCandidatePair(previous, current)
    } else {
      merged.push(current)
    }
  }

  const tinyAbsorbed = absorbShortCandidates(merged, TIMELINE_MIN_BLOCK_SPAN_MS, {
    requireRelated: false,
    maxCombinedMs: Number.POSITIVE_INFINITY,
  }, db, context)
  return absorbShortCandidates(tinyAbsorbed, TIMELINE_MIN_STANDALONE_SPAN_MS, {
    requireRelated: true,
    maxCombinedMs: TIMELINE_MAX_COHERENT_BLOCK_SPAN_MS,
  }, db, context)
}

// The single app a candidate is dominated by (most foreground time). This is
// the spine of "same work" — two stretches led by the same app are the same
// activity resuming, even if the gap between them broke them into separate
// coarse segments.
function dominantAppId(candidate: CandidateBlock): string | null {
  return topAppsFromSessions(candidate.sessions)[0]?.bundleId ?? null
}

// Bridge two stretches of the same continued work across a moderate gap. Unlike
// shouldSoftMerge (which only joins zero/near-zero gaps within one coarse
// segment), this deliberately reaches across coarse-segment boundaries — the
// gap is exactly what split them — but only when the same dominant app is doing
// related work and the gap stays under the bridge ceiling. Meetings never
// bridge, and the result is capped at the coherent maximum so bridging cannot
// build a runaway block.
function shouldBridgeSameWork(left: CandidateBlock, right: CandidateBlock, db: Database.Database, context: TimelineBuildContext): boolean {
  if (left.formation === 'meeting' || right.formation === 'meeting') return false
  if (left.boundedAfterGap && right.boundedBeforeGap) return false
  // Drift categories never bridge across a gap. Two YouTube videos or two
  // X sessions separated by a 17-minute lull are not "the same work resuming" —
  // they are two separate detours, and the browser's content context is often
  // just `entertainment:<browser>` (window titles aren't reliably captured),
  // so without this guard every video in one browser collapses into a single
  // runaway "watching" block whose span (and old duration) dwarfed the actual
  // tracked time (R4). Bridging is for focused work continuing past an
  // interruption, not for stitching drift together.
  if (NON_BRIDGEABLE_CATEGORIES.has(candidateDominantCategory(left, db, context))) return false
  const gap = gapBetweenCandidates(left, right)
  if (gap >= TIMELINE_SAME_WORK_BRIDGE_GAP_MS) return false
  const assistedPair = candidatesAreAssistedWorkPair(left, right, db, context)
  const maxSpanMs = assistedPair ? TIMELINE_MAX_ASSISTED_WORK_SPAN_MS : TIMELINE_MAX_COHERENT_BLOCK_SPAN_MS
  if (combinedSpanMs(left, right) > maxSpanMs) return false
  if (assistedPair && gap < TIMELINE_SPLIT_GAP_THRESHOLD_MS) return true
  const leftApp = dominantAppId(left)
  if (!leftApp || leftApp !== dominantAppId(right)) return false
  return candidatesRelated(left, right, db, context)
}

// Day-level pass over the full block list (all coarse segments concatenated):
// fuse same-app continued work across moderate gaps, then fold any short block
// that now has a related neighbour. This is what turns a 50-second "Terminal
// work" sliver plus a 17-minute gap plus an hour of Ghostty into one continuous
// coding block.
function bridgeSameWorkCandidates(candidates: CandidateBlock[], db: Database.Database, context: TimelineBuildContext): CandidateBlock[] {
  if (candidates.length <= 1) return candidates

  const merged: CandidateBlock[] = [candidates[0]]
  for (let index = 1; index < candidates.length; index++) {
    const previous = merged[merged.length - 1]
    const current = candidates[index]
    if (shouldBridgeSameWork(previous, current, db, context)) {
      merged[merged.length - 1] = mergeCandidatePair(previous, current)
    } else {
      merged.push(current)
    }
  }

  return absorbShortCandidates(merged, TIMELINE_MIN_STANDALONE_SPAN_MS, {
    requireRelated: true,
    maxCombinedMs: TIMELINE_MAX_COHERENT_BLOCK_SPAN_MS,
  }, db, context)
}

function buildBlocksForSessions(db: Database.Database, sessions: AppSession[]): WorkContextBlock[] {
  const context = buildTimelineContext(db, sessions)
  const candidates = coarseSegmentsFromSessions(db, sessions)
    .flatMap((segment) => {
      const segmentCandidates = analyzeSessions(segment.sessions, segment.boundedBeforeGap, segment.boundedAfterGap)
        .flatMap((candidate) => normalizeTimelineCandidates([candidate]))
      return coalesceTimelineCandidates(segmentCandidates, db, context)
    })
  return bridgeSameWorkCandidates(candidates, db, context)
    .map((candidate) => buildBlockFromCandidate(candidate, db, context))
}

// Build the timeline blocks for a set of sessions through the one canonical
// coalescing pipeline, with labels finalized. Used by the live/today path and
// by the derived (past-day) projection so both render the same block shapes —
// there is no second, un-coalesced block builder.
export function buildTimelineBlocksFromSessions(
  db: Database.Database,
  sessions: AppSession[],
): WorkContextBlock[] {
  return buildBlocksForSessions(db, sessions).map((block) => finalizedLabelForBlock(db, block))
}

function blockKindFor(block: WorkContextBlock): string {
  if (block.dominantCategory === 'meetings') return 'meeting'
  if (block.dominantCategory === 'communication' || block.dominantCategory === 'email') return 'communication'
  if (block.dominantCategory === 'uncategorized') return 'mixed'
  return 'work'
}

// B10: tab-title soup like "Course | Perusall" or "W2_Reading | Intro to ML
// | Perusall" should not surface as a block label with a literal pipe. The
// pipe is join-logic leaking into prose; a colleague would say "Intro to ML
// on Perusall," not "Intro to ML | Perusall". Collapse pipe-joined values to
// their longest content-bearing segment so every label-selection path
// (artifact, workflow, rule-based, AI) emits clean prose.
function naturalizeLabel(value: string): string {
  if (!/ \| /.test(value)) return value
  const segments = value
    .split(/\s*\|\s*/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && !GENERIC_LABELS.has(segment))
  if (segments.length === 0) return value
  return segments.reduce((best, segment) => segment.length > best.length ? segment : best, segments[0])
}

function usefulDerivedLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const natural = naturalizeLabel(trimmed)
  if (!natural) return null
  if (GENERIC_LABELS.has(natural)) return null
  return natural
}

function normalizedLabelValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function labelLooksToolOnly(label: string, block: WorkContextBlock): boolean {
  const normalizedLabel = normalizedLabelValue(label)
  if (!normalizedLabel) return true
  const appNames = block.topApps
    .map((app) => normalizedLabelValue(app.appName))
    .filter(Boolean)
  if (appNames.includes(normalizedLabel)) return true
  if (appNames.some((appName) => normalizedLabel === `${appName}loop`)) return true
  if (appNames.length >= 2) {
    const pair = `${appNames[0]}${appNames[1]}`
    if (normalizedLabel === pair || normalizedLabel === `${pair}loop`) return true
  }
  return false
}

function usefulBlockLabel(block: WorkContextBlock, value: string | null | undefined): string | null {
  const label = usefulDerivedLabel(value)
  if (!label) return null
  return labelLooksToolOnly(label, block) ? null : label
}

// Browser tab titles typically join segments with " | " (pipe + spaces),
// e.g. "W2_Reading | Introduction to Machine Learning | Perusall". Real
// document or page titles use em-dashes, hyphens, middle-dots, or colons.
// Treat any " | "-joined string as raw tab-title evidence, not a label.
function looksLikeBrowserTabTitle(value: string): boolean {
  return / \| /.test(value)
}

// Categories where a browser page / website is the natural label source.
// For anything else (development, communication, design, etc.), a stray
// browser page should NOT be picked as the block label — that's how
// "Pornhub - $title" ended up labeling a development block.
const PAGE_LABEL_COMPATIBLE_CATEGORIES = new Set<AppCategory>([
  'browsing',
  'aiTools',
  'research',
  'entertainment',
  'social',
])

function isPageLabelCompatible(block: WorkContextBlock): boolean {
  return PAGE_LABEL_COMPATIBLE_CATEGORIES.has(block.dominantCategory)
}

// Share of the block's time spent in non-browser focused-work apps
// (development, writing, design, productivity, research — excluding
// browsing and aiTools since those legitimately host page artifacts).
// Used to detect "the user was actually working, the foreground tab is
// background noise" — the core F1 case.
const WORK_APP_DOMINANT_SHARE = 0.3

function workAppDominantShare(block: WorkContextBlock): number {
  const workAppSeconds = block.topApps
    .filter((app) =>
      FOCUSED_CATEGORIES.includes(app.category)
      && app.category !== 'browsing'
      && app.category !== 'aiTools'
      && !app.isBrowser,
    )
    .reduce((sum, app) => sum + app.totalSeconds, 0)
  const totalSeconds = block.topApps.reduce((sum, app) => sum + app.totalSeconds, 0)
  if (totalSeconds <= 0) return 0
  return workAppSeconds / totalSeconds
}

// F1 ownership rule: a development-dominant block (IDE/terminal top apps)
// must not adopt a co-occurring browser page artifact as its label. A
// 5-minute YouTube tab open while the user spent 90 minutes in Kiro and
// Ghostty is background noise, not the block headline. Applies to the
// post-F2(a) "artifact-driven" entertainment override too: even when the
// top page artifact rewrote the dominantCategory to 'entertainment', if
// the actual time spent was mostly in work apps, the entertainment page
// title still can't be the block label.
function blockHasWorkAppDominance(block: WorkContextBlock): boolean {
  return workAppDominantShare(block) >= WORK_APP_DOMINANT_SHARE
}

// Normalize for label-vs-page-title equivalence checks. Strip punctuation,
// collapse whitespace, lowercase.
function normalizeForLeakCheck(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// True when `label` looks like it was lifted verbatim from a page artifact
// hosted on an entertainment/social/adult domain inside this block. Catches
// the AI-labeler case where the model saw a YouTube tab in the evidence and
// emitted its title as the block headline.
function labelIsBrowserContentLeak(label: string, block: WorkContextBlock): boolean {
  if (!blockHasWorkAppDominance(block)) return false
  const normLabel = normalizeForLeakCheck(label)
  if (!normLabel) return false
  for (const page of block.pageRefs) {
    if (!isHostBlockedForAppsRail(page.domain ?? page.host ?? null)) continue
    const candidates = [page.pageTitle, page.displayTitle].filter((value): value is string => Boolean(value))
    for (const candidate of candidates) {
      const norm = normalizeForLeakCheck(candidate)
      if (!norm) continue
      if (norm === normLabel) return true
      if (norm.length >= 12 && normLabel.includes(norm)) return true
      if (normLabel.length >= 12 && norm.includes(normLabel)) return true
    }
  }
  return false
}

function preferredArtifactLabel(block: WorkContextBlock): string | null {
  // Document artifacts (files, repos, projects, window-derived) are
  // produced by the foreground app itself, so they're category-compatible
  // by construction — a VS Code window artifact reflects VS Code work.
  // Keep them unconditional.
  const documentLabel = usefulDerivedLabel(block.documentRefs[0]?.displayTitle)
  if (documentLabel && !looksLikeBrowserTabTitle(documentLabel)) return documentLabel

  // Page and website labels only apply when the block is browsing-dominant.
  // For a development block, a stray YouTube/Pornhub/news page is noise,
  // not a label.
  if (!isPageLabelCompatible(block)) return null

  // F1: even on a block whose dominantCategory is page-label-compatible (or
  // was rewritten to 'entertainment' by the top-artifact override), reject
  // entertainment/social/adult pages as the label when the user actually
  // spent most of the block in non-browser work apps. The IDE/terminal time
  // is what they were doing; the open tab is incidental.
  const workAppDominant = blockHasWorkAppDominance(block)
  const firstAllowedPage = block.pageRefs.find((page) => {
    const host = page.domain ?? page.host ?? null
    if (isHostBlockedForLabel(host)) return false
    if (workAppDominant && isHostBlockedForAppsRail(host)) return false
    return true
  })
  const rawPageLabel = firstAllowedPage?.displayTitle ?? firstAllowedPage?.pageTitle
  const pageLabel = usefulDerivedLabel(rawPageLabel)
  if (pageLabel && !looksLikeBrowserTabTitle(pageLabel)) return pageLabel

  const firstAllowedSite = block.websites.find((site) => {
    if (isHostBlockedForLabel(site.domain)) return false
    if (workAppDominant && isHostBlockedForAppsRail(site.domain)) return false
    return true
  })
  const domainLabel = firstAllowedSite ? shortDomainLabel(firstAllowedSite.domain) : null
  return usefulDerivedLabel(domainLabel)
}

export type BackgroundRelabelDisposition = 'skip' | 'review' | 'relabel'

export function hasStableDeterministicBlockLabel(block: WorkContextBlock): boolean {
  return Boolean(
    preferredArtifactLabel(block)
    || usefulBlockLabel(block, block.workflowRefs[0]?.label)
    || usefulBlockLabel(block, block.ruleBasedLabel),
  )
}

function hasLegacyWeakAiLabel(block: WorkContextBlock): boolean {
  const aiLabel = block.aiLabel?.trim()
  return Boolean(aiLabel) && !usefulBlockLabel(block, aiLabel)
}

function labelIsCategoryFloor(block: WorkContextBlock, label: string): boolean {
  return label.trim().toLowerCase() === prettyCategory(block.dominantCategory).toLowerCase()
}

function labelLooksProjectHintFloor(label: string): boolean {
  return /\b(development|research|design|writing|productivity)$/i.test(label.trim())
}

export function shouldReanalyzeBlockWithAI(block: WorkContextBlock): boolean {
  if (block.isLive) return false
  if (block.label.override?.trim() || block.label.source === 'user') return false

  const currentLabel = block.label.current?.trim() ?? ''
  const aiLabel = block.aiLabel?.trim()
  if (hasLegacyWeakAiLabel(block)) return true
  if (block.label.source === 'ai' && aiLabel && usefulBlockLabel(block, aiLabel)) return false

  if (block.confidence === 'low' || block.label.confidence < 0.58) return true
  if (block.label.source === 'rule') return true
  if (block.label.source === 'artifact' || block.label.source === 'workflow') return true
  if (block.label.source === 'memory' && currentLabel && labelLooksProjectHintFloor(currentLabel)) return true
  if (currentLabel && labelIsCategoryFloor(block, currentLabel)) return true

  return false
}

export function backgroundRelabelDispositionForBlock(block: WorkContextBlock): BackgroundRelabelDisposition {
  if (block.isLive) return 'skip'
  if (block.label.override?.trim()) return 'skip'
  if (shouldReanalyzeBlockWithAI(block)) return 'relabel'
  // Persisted AI labels do not yet carry a reliable quality score, so keep
  // already-specific AI labels instead of churning them.
  if (block.aiLabel?.trim()) return 'skip'
  return hasStableDeterministicBlockLabel(block) ? 'review' : 'relabel'
}

function finalizedLabelForBlock(
  db: Database.Database,
  block: WorkContextBlock,
): WorkContextBlock {
  const override = getBlockLabelOverride(db, block.id)
  // Work-memory labels ("<project> development", learned work patterns) only
  // make sense on a block whose dominant activity is focused work. On a
  // browsing / social / entertainment / email block they produce the exact P1
  // contradiction the quality bar calls out — "Canva development" (BROWSING),
  // "Notifications development" (SOCIAL), "Obsidian Vault development"
  // (ENTERTAINMENT) — because a dev/terminal app merely *co-occurred*. For
  // those blocks, skip memory entirely and let the artifact/page/site label
  // (which agrees with the category) win.
  const allowWorkMemoryLabel = FOCUSED_CATEGORIES.includes(block.dominantCategory)
  const concurrentEvidence = memoryEnabled() && allowWorkMemoryLabel && !override?.label?.trim()
    ? gatherConcurrentEvidence(db, block)
    : null
  const memoryPattern = concurrentEvidence
    ? matchPromotedPatterns(db, block, concurrentEvidence)
    : null
  const projectHint = concurrentEvidence
    ? extractProjectHintFromEvidence(block, concurrentEvidence)
    : null
  const artifactLabel = preferredArtifactLabel(block)
  const workflowLabel = usefulBlockLabel(block, block.workflowRefs[0]?.label)
  const ruleLabel = usefulBlockLabel(block, block.ruleBasedLabel)
  const rawAiLabel = usefulBlockLabel(block, block.aiLabel)
  // F1: the AI labeler can also lift a YouTube tab title verbatim into the
  // block headline when it sees that page in the evidence. Reject any
  // suggested label that matches an entertainment/social/adult page title
  // in the block when the user's actual time was spent on work apps.
  const aiLabel = rawAiLabel && labelIsBrowserContentLeak(rawAiLabel, block) ? null : rawAiLabel

  // Label priority. A user override always wins; a user-promoted memory pattern
  // next. Then the names that read like a human wrote them — the AI label and
  // the concrete artifact (page/document) title — before the deterministic
  // floors. The project hint ("<project> development") is a FLOOR, not an
  // override: it must never beat a real AI label like "Refactoring the timeline
  // coalescer" (the §6 quality bar). It sits just above the bare rule label.
  const chosen = override?.label?.trim()
    || memoryPattern?.label
    || aiLabel
    || artifactLabel
    || workflowLabel
    || projectHint?.label
    || ruleLabel
    || userVisibleLabelForBlock(block)

  const source = override?.label?.trim()
    ? 'user'
    : memoryPattern?.label && chosen === memoryPattern.label
      ? 'memory'
      : aiLabel && chosen === aiLabel
        ? 'ai'
        : artifactLabel && chosen === artifactLabel
          ? 'artifact'
          : workflowLabel && chosen === workflowLabel
            ? 'workflow'
            : projectHint?.label && chosen === projectHint.label
              ? 'memory'
              : ruleLabel && chosen === ruleLabel
                ? 'rule'
                : 'rule'

  return {
    ...block,
    label: {
      current: chosen,
      source,
      confidence: source === 'user'
        ? 1
        : source === 'memory'
          ? memoryPattern?.confidence ?? projectHint?.confidence ?? 0.72
        : source === 'artifact'
          ? 0.88
          : source === 'workflow'
            ? 0.8
            : source === 'ai'
              ? 0.65
              : block.label.confidence,
      narrative: override?.narrative ?? block.label.narrative,
      ruleBased: block.ruleBasedLabel,
      aiSuggested: block.aiLabel,
      override: override?.label ?? null,
    },
  }
}

function upsertArtifact(db: Database.Database, artifact: ArtifactRef, block: WorkContextBlock): void {
  db.prepare(`
    INSERT INTO artifacts (
      id,
      artifact_type,
      canonical_key,
      display_title,
      url,
      path,
      host,
      canonical_app_id,
      metadata_json,
      first_seen_at,
      last_seen_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_key) DO UPDATE SET
      display_title = excluded.display_title,
      url = COALESCE(excluded.url, artifacts.url),
      path = COALESCE(excluded.path, artifacts.path),
      host = COALESCE(excluded.host, artifacts.host),
      canonical_app_id = COALESCE(excluded.canonical_app_id, artifacts.canonical_app_id),
      metadata_json = excluded.metadata_json,
      last_seen_at = excluded.last_seen_at
  `).run(
    artifact.id,
    artifact.artifactType,
    artifact.canonicalKey ?? artifact.id,
    artifact.displayTitle,
    artifact.url ?? null,
    artifact.path ?? null,
    artifact.host ?? null,
    artifact.canonicalAppId ?? null,
    JSON.stringify(artifact.metadata ?? {}),
    block.startTime,
    block.endTime,
  )
}

function persistWorkflow(db: Database.Database, block: WorkContextBlock, dateStr: string): PersistedWorkflow[] {
  return block.workflowRefs.map((workflow) => {
    db.prepare(`
      INSERT INTO workflow_signatures (
        id,
        signature_key,
        label,
        dominant_category,
        canonical_apps_json,
        artifact_keys_json,
        rule_version,
        computed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(signature_key) DO UPDATE SET
        label = excluded.label,
        dominant_category = excluded.dominant_category,
        canonical_apps_json = excluded.canonical_apps_json,
        artifact_keys_json = excluded.artifact_keys_json,
        rule_version = excluded.rule_version,
        computed_at = excluded.computed_at
    `).run(
      workflow.id,
      workflow.signatureKey,
      workflow.label,
      workflow.dominantCategory,
      JSON.stringify(workflow.canonicalApps),
      JSON.stringify(workflow.artifactKeys),
      TIMELINE_HEURISTIC_VERSION,
      block.computedAt,
    )

    db.prepare(`
      INSERT INTO workflow_occurrences (workflow_id, block_id, date, confidence)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(workflow_id, block_id) DO UPDATE SET
        date = excluded.date,
        confidence = excluded.confidence
    `).run(workflow.id, block.id, dateStr, workflow.confidence)

    return {
      workflow,
      artifactKeys: workflow.artifactKeys,
    }
  })
}

// Invalidate every persisted block for a date so the next reconstruction starts
// clean. Exported so the rebuild path can clear stale blocks before recomputing.
export function invalidateTimelineDay(db: Database.Database, dateStr: string): void {
  db.prepare(`
    UPDATE timeline_blocks
    SET invalidated_at = ?
    WHERE date = ? AND invalidated_at IS NULL
  `).run(Date.now(), dateStr)
}

export function persistTimelineDay(
  db: Database.Database,
  dateStr: string,
  blocks: WorkContextBlock[],
  options: { finalized?: boolean } = {},
): void {
  const validIds = blocks.filter((block) => !block.isLive).map((block) => block.id)
  const persist = db.transaction(() => {
    if (validIds.length > 0) {
      const placeholders = validIds.map(() => '?').join(', ')
      db.prepare(`
        UPDATE timeline_blocks
        SET invalidated_at = ?
        WHERE date = ? AND invalidated_at IS NULL AND id NOT IN (${placeholders})
      `).run(Date.now(), dateStr, ...validIds)
    } else {
      db.prepare(`
        UPDATE timeline_blocks
        SET invalidated_at = ?
        WHERE date = ? AND invalidated_at IS NULL
      `).run(Date.now(), dateStr)
    }

    for (const rawBlock of blocks) {
      if (rawBlock.isLive) continue
      const block = options.finalized ? rawBlock : finalizedLabelForBlock(db, rawBlock)
      db.prepare(`
        INSERT INTO timeline_blocks (
          id,
          date,
          start_time,
          end_time,
          block_kind,
          dominant_category,
          category_distribution_json,
          switch_count,
          label_current,
          label_source,
          label_confidence,
          narrative_current,
          evidence_summary_json,
          is_live,
          heuristic_version,
          computed_at,
          invalidated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          date = excluded.date,
          start_time = excluded.start_time,
          end_time = excluded.end_time,
          block_kind = excluded.block_kind,
          dominant_category = excluded.dominant_category,
          category_distribution_json = excluded.category_distribution_json,
          switch_count = excluded.switch_count,
          label_current = excluded.label_current,
          label_source = excluded.label_source,
          label_confidence = excluded.label_confidence,
          narrative_current = excluded.narrative_current,
          evidence_summary_json = excluded.evidence_summary_json,
          is_live = excluded.is_live,
          heuristic_version = excluded.heuristic_version,
          computed_at = excluded.computed_at,
          invalidated_at = NULL
      `).run(
        block.id,
        dateStr,
        block.startTime,
        block.endTime,
        blockKindFor(block),
        block.dominantCategory,
        JSON.stringify(block.categoryDistribution),
        block.switchCount,
        block.label.current,
        block.label.source,
        block.label.confidence,
        block.label.narrative,
        JSON.stringify(block.evidenceSummary),
        0,
        block.heuristicVersion,
        block.computedAt,
      )

      db.prepare(`DELETE FROM timeline_block_members WHERE block_id = ?`).run(block.id)
      db.prepare(`DELETE FROM artifact_mentions WHERE source_type = 'timeline_block' AND source_id = ?`).run(block.id)
      db.prepare(`DELETE FROM workflow_occurrences WHERE block_id = ?`).run(block.id)

      const insertMember = db.prepare(`
        INSERT OR REPLACE INTO timeline_block_members (
          block_id,
          member_type,
          member_id,
          start_time,
          end_time,
          weight_seconds
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)

      for (const session of block.sessions) {
        insertMember.run(
          block.id,
          'app_session',
          String(session.id),
          session.startTime,
          session.endTime ?? (session.startTime + session.durationSeconds * 1000),
          session.durationSeconds,
        )
      }

      for (const focusId of block.focusOverlap.sessionIds) {
        insertMember.run(block.id, 'focus_session', String(focusId), block.startTime, block.endTime, block.focusOverlap.totalSeconds)
      }

      for (const page of block.pageRefs) {
        insertMember.run(block.id, 'website_visit', page.id, block.startTime, block.endTime, page.totalSeconds)
      }

      db.prepare(`
        INSERT OR REPLACE INTO timeline_block_labels (
          id,
          block_id,
          label,
          narrative,
          source,
          confidence,
          created_at,
          model_info_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `${block.id}:${block.label.source}:${sha1(block.label.current).slice(0, 8)}`,
        block.id,
        block.label.current,
        block.label.narrative,
        block.label.source,
        block.label.confidence,
        block.computedAt,
        null,
      )

      for (const artifact of block.topArtifacts) {
        upsertArtifact(db, artifact, block)
        db.prepare(`
          INSERT OR REPLACE INTO artifact_mentions (
            id,
            artifact_id,
            source_type,
            source_id,
            start_time,
            end_time,
            confidence,
            evidence_json
          )
          VALUES (?, ?, 'timeline_block', ?, ?, ?, ?, ?)
        `).run(
          `${artifact.id}:timeline_block:${block.id}`,
          artifact.id,
          block.id,
          block.startTime,
          block.endTime,
          artifact.confidence,
          JSON.stringify({
            blockId: block.id,
            label: block.label.current,
          }),
        )
      }

      persistWorkflow(db, block, dateStr)
    }
  })

  persist()
}

const timelineMaterializationFingerprints = new Map<string, string>()

type PersistedBlockLabelRow = { block_id: string; label: string; source: string }
type PersistedBlockMemberRow = { block_id: string; member_id: string; weight_seconds: number }

function sqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

function persistedBlockLabelsByBlockId(
  db: Database.Database,
  blockIds: string[],
): Map<string, PersistedBlockLabelRow[]> {
  const labelsByBlock = new Map<string, PersistedBlockLabelRow[]>()
  if (blockIds.length === 0) return labelsByBlock

  const rows = db.prepare(`
    SELECT block_id, label, source
    FROM timeline_block_labels
    WHERE block_id IN (${sqlPlaceholders(blockIds.length)})
    ORDER BY block_id ASC, created_at ASC, id ASC
  `).all(...blockIds) as PersistedBlockLabelRow[]

  for (const row of rows) {
    const labels = labelsByBlock.get(row.block_id)
    if (labels) labels.push(row)
    else labelsByBlock.set(row.block_id, [row])
  }
  return labelsByBlock
}

function persistedBlockMembersByBlockId(
  db: Database.Database,
  blockIds: string[],
  memberType: 'app_session' | 'focus_session',
): Map<string, PersistedBlockMemberRow[]> {
  const membersByBlock = new Map<string, PersistedBlockMemberRow[]>()
  if (blockIds.length === 0) return membersByBlock

  const rows = db.prepare(`
    SELECT block_id, member_id, weight_seconds
    FROM timeline_block_members
    WHERE member_type = ? AND block_id IN (${sqlPlaceholders(blockIds.length)})
    ORDER BY block_id ASC, start_time ASC, member_id ASC
  `).all(memberType, ...blockIds) as PersistedBlockMemberRow[]

  for (const row of rows) {
    const members = membersByBlock.get(row.block_id)
    if (members) members.push(row)
    else membersByBlock.set(row.block_id, [row])
  }
  return membersByBlock
}

function validPersistedTimelineBlockCount(db: Database.Database, dateStr: string): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM timeline_blocks
    WHERE date = ? AND invalidated_at IS NULL AND is_live = 0
  `).get(dateStr) as { count: number } | undefined
  return row?.count ?? 0
}

function timelineMaterializationFingerprint(
  dateStr: string,
  sessions: AppSession[],
  blocks: WorkContextBlock[],
): string {
  const hash = crypto.createHash('sha1')
  hash.update(dateStr)
  hash.update(TIMELINE_HEURISTIC_VERSION)
  for (const session of sessions) {
    hash.update(`s:${session.id}:${session.startTime}:${session.endTime ?? ''}:${session.durationSeconds}:${session.bundleId}:${session.category};`)
  }
  for (const block of blocks) {
    hash.update(`b:${block.id}:${block.startTime}:${block.endTime}:${block.label.current}:${block.label.source}:${block.heuristicVersion};`)
  }
  return hash.digest('hex')
}

function persistTimelineDayIfChanged(
  db: Database.Database,
  dateStr: string,
  sessions: AppSession[],
  blocks: WorkContextBlock[],
  force = false,
): void {
  const fingerprint = timelineMaterializationFingerprint(dateStr, sessions, blocks)
  const cacheKey = dateStr
  const hasPersistedBlocks = validPersistedTimelineBlockCount(db, dateStr) > 0
  if (!force && hasPersistedBlocks && timelineMaterializationFingerprints.get(cacheKey) === fingerprint) {
    return
  }

  persistTimelineDay(db, dateStr, blocks, { finalized: true })
  timelineMaterializationFingerprints.set(cacheKey, fingerprint)
}

function loadPersistedTimelineBlocksForDay(
  db: Database.Database,
  dateStr: string,
  sessions: AppSession[],
): WorkContextBlock[] | null {
  const rows = db.prepare(`
    SELECT
      id,
      start_time,
      end_time,
      dominant_category,
      category_distribution_json,
      switch_count,
      label_current,
      label_source,
      label_confidence,
      narrative_current,
      evidence_summary_json,
      heuristic_version,
      computed_at
    FROM timeline_blocks
    WHERE date = ? AND invalidated_at IS NULL AND is_live = 0
    ORDER BY start_time ASC
  `).all(dateStr) as Array<{
    id: string
    start_time: number
    end_time: number
    dominant_category: AppCategory
    category_distribution_json: string
    switch_count: number
    label_current: string
    label_source: string
    label_confidence: number
    narrative_current: string | null
    evidence_summary_json: string
    heuristic_version: string
    computed_at: number
  }>

  if (rows.length === 0) {
    return null
  }

  const blockIds = rows.map((row) => row.id)
  const workflowsByBlock = workflowRefsByBlockId(db, blockIds)
  const labelsByBlock = persistedBlockLabelsByBlockId(db, blockIds)
  const appSessionMembersByBlock = persistedBlockMembersByBlockId(db, blockIds, 'app_session')
  const focusSessionMembersByBlock = persistedBlockMembersByBlockId(db, blockIds, 'focus_session')

  const blocks: WorkContextBlock[] = []

  for (const row of rows) {
    let evidence: Partial<TimelineEvidenceSummary> = {}
    try {
      evidence = JSON.parse(row.evidence_summary_json || '{}') as Partial<TimelineEvidenceSummary>
    } catch {
      evidence = {}
    }

    const pageRefs = Array.isArray(evidence.pages) ? evidence.pages as PageRef[] : []
    const documentRefs = Array.isArray(evidence.documents) ? evidence.documents as DocumentRef[] : []
    const topArtifacts = [...pageRefs, ...documentRefs]
      .sort((left, right) => right.totalSeconds - left.totalSeconds)
      .slice(0, 6)

    const labelRows = labelsByBlock.get(row.id) ?? []

    let categoryDistribution: Partial<Record<AppCategory, number>> = {}
    try {
      categoryDistribution = JSON.parse(row.category_distribution_json)
    } catch {
      categoryDistribution = {}
    }

    const dominantCategory = dominantCategoryForBlock(categoryDistribution, topArtifacts)
    const ruleLabel = labelRows.find(r => r.source === 'rule')?.label || prettyCategory(dominantCategory)
    const aiLabel = labelRows.find(r => r.source === 'ai' || r.source === 'workflow')?.label || null
    const overrideRow = labelRows.find(r => r.source === 'user')

    const memberRows = appSessionMembersByBlock.get(row.id) ?? []

    const sessionIds = new Set(memberRows.map((r) => Number(r.member_id)))
    const blockSessions = sessions.filter((s) => sessionIds.has(s.id))

    const websites = getWebsiteSummariesForRange(db, row.start_time, row.end_time).slice(0, 5)

    const keyPagesByDomain = getTopPagesForDomains(db, row.start_time, row.end_time, websites.map((site) => site.domain), 2)
    const keyPages = websites.flatMap((site) => keyPagesByDomain[site.domain] ?? [])
      .map((page) => page.title?.trim())
      .filter((title): title is string => Boolean(title))
      .filter((title, index, titles) => titles.indexOf(title) === index)
      .slice(0, 4)

    const focusRows = focusSessionMembersByBlock.get(row.id) ?? []

    const focusSessionIds = focusRows.map((r) => Number(r.member_id))
    const focusTotalSeconds = focusRows[0]?.weight_seconds ?? 0
    const durationSec = Math.max(1, (row.end_time - row.start_time) / 1000)
    const focusOverlap = {
      totalSeconds: focusTotalSeconds,
      pct: Math.min(100, Math.round((focusTotalSeconds / durationSec) * 100)),
      sessionIds: focusSessionIds,
    }

    blocks.push({
      id: row.id,
      startTime: row.start_time,
      endTime: row.end_time,
      dominantCategory,
      categoryDistribution,
      ruleBasedLabel: ruleLabel,
      aiLabel: aiLabel,
      sessions: blockSessions,
      topApps: Array.isArray(evidence.apps) ? evidence.apps as WorkContextAppSummary[] : [],
      websites,
      keyPages,
      pageRefs,
      documentRefs,
      topArtifacts,
      workflowRefs: workflowsByBlock.get(row.id) ?? [],
      label: {
        current: row.label_current,
        source: row.label_source as LabelSource,
        confidence: row.label_confidence,
        narrative: row.narrative_current,
        ruleBased: ruleLabel,
        aiSuggested: aiLabel,
        override: overrideRow?.label ?? null,
      },
      focusOverlap,
      evidenceSummary: {
        apps: Array.isArray(evidence.apps) ? evidence.apps as WorkContextAppSummary[] : [],
        pages: pageRefs,
        documents: documentRefs,
        domains: Array.isArray(evidence.domains) ? evidence.domains as string[] : [],
      },
      heuristicVersion: row.heuristic_version,
      computedAt: row.computed_at,
      switchCount: row.switch_count,
      confidence: confidenceForCandidate({
        sessions: blockSessions,
        formation: 'mixed',
        boundedBeforeGap: false,
        boundedAfterGap: false,
      }, coherenceScore(categoryDistribution)),
      isLive: false,
    })
  }

  // Grouping is cached, but labeling is always derived fresh. Re-run the label
  // finalizer over every loaded block so the current logic (category-gated
  // memory, project hints grounded in real code signals, the AI-over-floor
  // priority) applies even to days frozen as "processed". This is what replaces
  // the stale "Canva development" / "Notifications development" strings that one
  // AI-labeled block used to freeze in place for a whole day. Stored user
  // overrides and AI suggestions are read back inside the finalizer, so curated
  // labels still win.
  return blocks.map((block) => finalizedLabelForBlock(db, block))
}

// A day is "processed" once any of its persisted blocks carries an AI,
// workflow, or user-authored label — i.e. the nightly consolidation job (or the
// user) has already named it. Such a day is kept exactly as it was summarized.
function persistedDayWasProcessed(db: Database.Database, dateStr: string): boolean {
  const row = db.prepare(`
    SELECT 1
    FROM timeline_block_labels labels
    JOIN timeline_blocks blocks ON blocks.id = labels.block_id
    WHERE blocks.date = ?
      AND blocks.invalidated_at IS NULL
      AND blocks.is_live = 0
      AND labels.source IN ('ai', 'workflow', 'user')
    LIMIT 1
  `).get(dateStr)
  return Boolean(row)
}

// True when the persisted blocks for a day were built by a superseded timeline
// heuristic, so a fresh reconstruction would group them more accurately.
function persistedDayHeuristicIsStale(db: Database.Database, dateStr: string): boolean {
  const row = db.prepare(`
    SELECT heuristic_version
    FROM timeline_blocks
    WHERE date = ? AND invalidated_at IS NULL AND is_live = 0
    ORDER BY computed_at ASC
    LIMIT 1
  `).get(dateStr) as { heuristic_version: string } | undefined
  if (!row) return false
  return row.heuristic_version !== TIMELINE_HEURISTIC_VERSION
}

export function listTimelineDaysNeedingHeuristicUpgrade(
  db: Database.Database,
  beforeDate: string = localDateString(),
  limit = 12,
): string[] {
  const rows = db.prepare(`
    SELECT blocks.date AS date
    FROM timeline_blocks blocks
    WHERE blocks.date < ?
      AND blocks.invalidated_at IS NULL
      AND blocks.is_live = 0
      AND blocks.heuristic_version <> ?
      AND NOT EXISTS (
        SELECT 1
        FROM timeline_block_labels labels
        WHERE labels.block_id = blocks.id
          AND labels.source IN ('ai', 'workflow', 'user')
      )
    GROUP BY blocks.date
    ORDER BY blocks.date DESC
    LIMIT ?
  `).all(beforeDate, TIMELINE_HEURISTIC_VERSION, limit) as Array<{ date: string }>
  return rows.map((row) => row.date)
}

export function buildTimelineBlocksForDay(
  db: Database.Database,
  dateStr: string,
  sessions: AppSession[],
  options: { materialize?: boolean } = {},
): WorkContextBlock[] {
  const shouldMaterialize = options.materialize ?? true
  const todayStr = localDateString()
  let forceMaterialize = false

  if (dateStr < todayStr) {
    const persisted = loadPersistedTimelineBlocksForDay(db, dateStr, sessions)
    if (persisted && persisted.length > 0) {
      // Keep nightly/user-processed days exactly as they were summarized, and
      // keep any day already on the current heuristic (no churn). Only an older
      // day the nightly job never reached AND built under a superseded
      // heuristic is reconstructed more accurately on revisit, then
      // re-persisted so the improvement sticks.
      if (persistedDayWasProcessed(db, dateStr) || !persistedDayHeuristicIsStale(db, dateStr)) {
        return persisted
      }
      forceMaterialize = true
    } else {
      forceMaterialize = true
    }
  } else if (validPersistedTimelineBlockCount(db, dateStr) === 0) {
    forceMaterialize = true
  }

  const computed = buildBlocksForSessions(db, sessions).map((block) => finalizedLabelForBlock(db, block))
  if (shouldMaterialize) {
    persistTimelineDayIfChanged(db, dateStr, sessions, computed, forceMaterialize)
  }
  return computed
}

function mergeAdjacentSegments(segments: TimelineSegment[]): TimelineSegment[] {
  if (segments.length <= 1) return segments

  const merged: TimelineSegment[] = [segments[0]]
  for (let index = 1; index < segments.length; index++) {
    const current = segments[index]
    const previous = merged[merged.length - 1]

    if (
      current.kind !== 'work_block'
      && previous.kind !== 'work_block'
      && current.kind === previous.kind
      && current.source === previous.source
      && current.startTime <= previous.endTime
    ) {
      previous.endTime = Math.max(previous.endTime, current.endTime)
      previous.label = current.kind === 'machine_off' ? 'Machine off' : current.kind === 'away' ? 'Away' : 'Idle gap'
      continue
    }

    merged.push(current)
  }

  return merged
}

const MIN_VISIBLE_GAP_MS = 30 * 60 * 1000 // 30 minutes

function isVisibleGapSegment(segment: TimelineSegment): boolean {
  if (segment.kind === 'work_block') return true
  return segment.endTime - segment.startTime >= MIN_VISIBLE_GAP_MS
}

function buildSegmentsForDay(
  db: Database.Database,
  dateStr: string,
  blocks: WorkContextBlock[],
): TimelineSegment[] {
  const [fromMs, toMs] = localDayBounds(dateStr)
  const events = getActivityStateEventsForRange(db, fromMs, toMs)
  const workSegments: TimelineSegment[] = blocks.map((block) => ({
    kind: 'work_block',
    startTime: block.startTime,
    endTime: block.endTime,
    blockId: block.id,
  }))

  const eventSegments: TimelineSegment[] = []
  let activeAwayStart: { kind: 'away' | 'machine_off'; startTime: number } | null = null
  for (const event of events) {
    if (event.eventType === 'away_start' || event.eventType === 'lock_screen' || event.eventType === 'idle_start') {
      const kind = event.eventType === 'lock_screen' ? 'away' : 'away'
      activeAwayStart = { kind, startTime: event.eventTs }
    } else if (event.eventType === 'suspend') {
      activeAwayStart = { kind: 'machine_off', startTime: event.eventTs }
    } else if ((event.eventType === 'away_end' || event.eventType === 'unlock_screen' || event.eventType === 'idle_end' || event.eventType === 'resume') && activeAwayStart) {
      eventSegments.push({
        kind: activeAwayStart.kind,
        startTime: activeAwayStart.startTime,
        endTime: event.eventTs,
        label: activeAwayStart.kind === 'machine_off' ? 'Machine off' : 'Away',
        source: 'activity_event',
      })
      activeAwayStart = null
    }
  }

  if (activeAwayStart) {
    eventSegments.push({
      kind: activeAwayStart.kind,
      startTime: activeAwayStart.startTime,
      endTime: toMs,
      label: activeAwayStart.kind === 'machine_off' ? 'Machine off' : 'Away',
      source: 'activity_event',
    })
  }

  const gapRanges: Array<{ startTime: number; endTime: number }> = []
  let cursor = fromMs
  const byStart = [...workSegments].sort((left, right) => left.startTime - right.startTime)
  for (const segment of byStart) {
    if (segment.startTime > cursor) {
      gapRanges.push({ startTime: cursor, endTime: segment.startTime })
    }
    cursor = Math.max(cursor, segment.endTime)
  }
  if (cursor < toMs) {
    gapRanges.push({ startTime: cursor, endTime: toMs })
  }

  const gapSegments: TimelineSegment[] = []
  for (const range of gapRanges) {
    let gapCursor = range.startTime
    const overlappingEvents = eventSegments
      .map((segment) => ({
        ...segment,
        startTime: Math.max(segment.startTime, range.startTime),
        endTime: Math.min(segment.endTime, range.endTime),
      }))
      .filter((segment) => segment.endTime > segment.startTime)
      .sort((left, right) => left.startTime - right.startTime)

    for (const eventSegment of overlappingEvents) {
      if (!isVisibleGapSegment(eventSegment)) continue

      if (eventSegment.startTime > gapCursor) {
        const gapDuration = eventSegment.startTime - gapCursor
        if (gapDuration >= MIN_VISIBLE_GAP_MS) {
          gapSegments.push({
            kind: 'idle_gap',
            startTime: gapCursor,
            endTime: eventSegment.startTime,
            label: 'Idle gap',
            source: 'derived_gap',
          })
        }
      }
      gapSegments.push(eventSegment)
      gapCursor = Math.max(gapCursor, eventSegment.endTime)
    }

    if (gapCursor < range.endTime) {
      const gapDuration = range.endTime - gapCursor
      if (gapDuration >= MIN_VISIBLE_GAP_MS) {
        gapSegments.push({
          kind: 'idle_gap',
          startTime: gapCursor,
          endTime: range.endTime,
          label: 'Idle gap',
          source: 'derived_gap',
        })
      }
    }
  }

  const merged = mergeAdjacentSegments([...workSegments, ...gapSegments]
    .filter((segment) => segment.endTime > segment.startTime && isVisibleGapSegment(segment))
    .sort((left, right) => left.startTime - right.startTime))

  return merged
}

function mergeLiveSession(sessions: AppSession[], liveSession?: LiveSession | null): AppSession[] {
  if (!liveSession) return sessions

  const liveEnd = Date.now()
  if (liveEnd <= liveSession.startTime) return sessions

  return [
    ...sessions,
    {
      id: -1,
      bundleId: liveSession.bundleId,
      appName: liveSession.appName,
      startTime: liveSession.startTime,
      endTime: liveEnd,
      durationSeconds: Math.max(1, Math.round((liveEnd - liveSession.startTime) / 1000)),
      category: liveSession.category,
      isFocused: FOCUSED_CATEGORIES.includes(liveSession.category),
      windowTitle: liveSession.windowTitle ?? null,
      rawAppName: liveSession.rawAppName ?? liveSession.appName,
      canonicalAppId: liveSession.canonicalAppId ?? null,
      appInstanceId: liveSession.appInstanceId ?? liveSession.bundleId,
      captureSource: liveSession.captureSource ?? 'foreground_poll',
      endedReason: null,
      captureVersion: 2,
    },
  ].sort((left, right) => left.startTime - right.startTime)
}

export function userVisibleLabelForBlock(block: WorkContextBlock, overrideLabel?: string | null): string {
  const preferred = overrideLabel ?? block.aiLabel
  if (preferred && preferred.trim() && !GENERIC_LABELS.has(preferred.trim())) {
    return preferred.trim()
  }

  if (block.ruleBasedLabel.trim() && !GENERIC_LABELS.has(block.ruleBasedLabel.trim())) {
    return block.ruleBasedLabel.trim()
  }

  // Browser site names are only an honest label when a page could own the
  // block. On a development/writing/etc. block, the open tabs are background
  // noise (the same ownership gate as the artifact path) — labeling a coding
  // block "Alueducation + Google" is the F1 leak. Only fall back to sites when
  // the block's category is page-label-compatible.
  if (isPageLabelCompatible(block)) {
    const websiteLabels = block.websites
      .map((site) => shortDomainLabel(site.domain))
      .filter((label, index, labels) => labels.indexOf(label) === index)
    if (websiteLabels.length >= 2) return `${websiteLabels[0]} + ${websiteLabels[1]}`
    if (websiteLabels.length === 1) return websiteLabels[0]
  }

  // Last resort: name the category. "Development" reads far better than
  // "Untitled block" as a floor, and it agrees with the badge. Only genuinely
  // contentless blocks (system/uncategorized) stay "Untitled block".
  if (block.dominantCategory !== 'uncategorized' && block.dominantCategory !== 'system') {
    return prettyCategory(block.dominantCategory)
  }
  return 'Untitled block'
}

export function fallbackNarrativeForBlock(block: WorkContextBlock): string {
  const label = userVisibleLabelForBlock(block)
  const duration = formatDuration(blockActiveSeconds(block))
  const evidenceSummary = deriveWorkEvidenceSummary({
    appSummaries: block.topApps.map((app) => ({
      bundleId: app.bundleId,
      appName: app.appName,
      category: app.category,
      totalSeconds: app.totalSeconds,
      isFocused: appCategoryIsFocused(app.category),
      sessionCount: app.sessionCount,
    })),
    sessions: block.sessions,
    websiteSummaries: block.websites,
  })
  const topSites = block.websites
    .slice(0, 2)
    .map((site) => shortDomainLabel(site.domain))
    .filter(Boolean)
  const topApps = block.topApps
    .filter((app) => !app.isBrowser && app.category !== 'system' && app.category !== 'uncategorized')
    .slice(0, 3)
    .map((app) => app.appName)
  const keyPage = block.keyPages.find((title) => title.trim().length > 0)
  const evidenceParts: string[] = []
  const synthesizedEvidence = evidenceSummary.evidenceText.trim()

  if (topApps.length > 0) {
    evidenceParts.push(`supporting apps included ${topApps.join(', ')}`)
  }
  if (topSites.length > 0) {
    evidenceParts.push(`top web activity was on ${topSites.join(' and ')}`)
  }
  if (keyPage) {
    evidenceParts.push(`key window: ${keyPage}`)
  }
  if (synthesizedEvidence) {
    evidenceParts.push(synthesizedEvidence)
  }

  const switchSummary = `${block.switchCount} app transition${block.switchCount === 1 ? '' : 's'}`
  if (evidenceParts.length === 0) {
    return `This block looks like ${label.toLowerCase()} for ${duration}, with ${switchSummary}.`
  }

  return `This block looks like ${label.toLowerCase()} for ${duration}. ${evidenceParts.join('. ')}. The block had ${switchSummary}.`
}

export function getTimelineDayPayload(
  db: Database.Database,
  dateStr: string,
  liveSession?: LiveSession | null,
  options: { materialize?: boolean } = {},
): DayTimelinePayload {
  const [fromMs, toMs] = localDayBounds(dateStr)
  const sessions = mergeLiveSession(getSessionsForRange(db, fromMs, toMs), liveSession)
  const websites = getWebsiteSummariesForRange(db, fromMs, toMs)
  const blocks = buildTimelineBlocksForDay(db, dateStr, sessions, options)
  const focusSessions = getFocusSessionsForDateRange(db, fromMs, toMs)
  const segments = buildSegmentsForDay(db, dateStr, blocks)
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
    version: TIMELINE_HEURISTIC_VERSION,
    totalSeconds,
    focusSeconds,
    focusPct: totalSeconds > 0 ? Math.round((focusSeconds / totalSeconds) * 100) : 0,
    appCount: new Set(sessions.map((session) => session.bundleId)).size,
    siteCount: websites.length,
  }
}

// Day-level "Re-analyze with AI" is implemented in the IPC handler. It does
// not invalidate blocks; it refreshes only deterministic-floor / low-confidence
// labels and preserves good AI labels plus user overrides.

export function getHistoryDayPayload(
  db: Database.Database,
  dateStr: string,
  liveSession?: LiveSession | null,
  options: { materialize?: boolean } = {},
): HistoryDayPayload {
  return getTimelineDayPayload(db, dateStr, liveSession, options)
}

function emptyLightweightDayPayload(dateStr: string): DayTimelinePayload {
  return {
    date: dateStr,
    sessions: [],
    websites: [],
    blocks: [],
    segments: [],
    focusSessions: [],
    computedAt: Date.now(),
    version: 'empty',
    totalSeconds: 0,
    focusSeconds: 0,
    focusPct: 0,
    appCount: 0,
    siteCount: 0,
  }
}

function getLightweightDayPayload(
  db: Database.Database,
  dateStr: string,
): DayTimelinePayload | null {
  const [fromMs, toMs] = localDayBounds(dateStr)
  const sessions = getSessionsForRange(db, fromMs, toMs)
  const websitesForDay = getWebsiteSummariesForRange(db, fromMs, toMs)

  const rows = db.prepare(`
    SELECT
      id,
      start_time,
      end_time,
      dominant_category,
      category_distribution_json,
      switch_count,
      label_current,
      label_source,
      label_confidence,
      narrative_current,
      evidence_summary_json,
      heuristic_version,
      computed_at
    FROM timeline_blocks
    WHERE date = ? AND invalidated_at IS NULL AND is_live = 0
    ORDER BY start_time ASC
  `).all(dateStr) as Array<{
    id: string
    start_time: number
    end_time: number
    dominant_category: AppCategory
    category_distribution_json: string
    switch_count: number
    label_current: string
    label_source: string
    label_confidence: number
    narrative_current: string | null
    evidence_summary_json: string
    heuristic_version: string
    computed_at: number
  }>

  if (rows.length === 0) {
    if (sessions.length === 0) {
      return emptyLightweightDayPayload(dateStr)
    }
    return null
  }

  const blockIds = rows.map((row) => row.id)
  const workflowsByBlock = workflowRefsByBlockId(db, blockIds)
  const labelsByBlock = persistedBlockLabelsByBlockId(db, blockIds)
  const appSessionMembersByBlock = persistedBlockMembersByBlockId(db, blockIds, 'app_session')
  const focusSessionMembersByBlock = persistedBlockMembersByBlockId(db, blockIds, 'focus_session')

  const blocks: WorkContextBlock[] = []

  let totalSeconds = 0
  let focusSeconds = 0

  for (const row of rows) {
    let evidence: Partial<TimelineEvidenceSummary> = {}
    try {
      evidence = JSON.parse(row.evidence_summary_json || '{}') as Partial<TimelineEvidenceSummary>
    } catch {
      evidence = {}
    }

    const pageRefs = Array.isArray(evidence.pages) ? evidence.pages as PageRef[] : []
    const documentRefs = Array.isArray(evidence.documents) ? evidence.documents as DocumentRef[] : []
    const topArtifacts = [...pageRefs, ...documentRefs]
      .sort((left, right) => right.totalSeconds - left.totalSeconds)
      .slice(0, 6)

    const labelRows = labelsByBlock.get(row.id) ?? []

    let categoryDistribution: Partial<Record<AppCategory, number>> = {}
    try {
      categoryDistribution = JSON.parse(row.category_distribution_json)
    } catch {
      categoryDistribution = {}
    }
    const dominantCategory = dominantCategoryForBlock(categoryDistribution, topArtifacts)
    const ruleLabel = labelRows.find(r => r.source === 'rule')?.label || prettyCategory(dominantCategory)
    const aiLabel = labelRows.find(r => r.source === 'ai' || r.source === 'workflow')?.label || null
    const overrideRow = labelRows.find(r => r.source === 'user')

    const memberRows = appSessionMembersByBlock.get(row.id) ?? []

    const sessionIds = new Set(memberRows.map((r) => Number(r.member_id)))
    const blockSessions = sessions.filter((session) => sessionIds.has(session.id))

    const blockWebsites = getWebsiteSummariesForRange(db, row.start_time, row.end_time).slice(0, 5)
    const websites = blockWebsites.length > 0
      ? blockWebsites
      : (evidence.domains ?? []).map((domain) => ({
          domain,
          totalSeconds: 0,
          visitCount: 0,
          topTitle: null,
          browserBundleId: null,
        })) as WebsiteSummary[]

    const keyPagesByDomain = getTopPagesForDomains(db, row.start_time, row.end_time, websites.map((site) => site.domain), 2)
    const keyPages = websites.flatMap((site) => keyPagesByDomain[site.domain] ?? [])
      .map((page) => page.title?.trim())
      .filter((title): title is string => Boolean(title))
      .filter((title, index, titles) => titles.indexOf(title) === index)
      .slice(0, 4)

    const focusRows = focusSessionMembersByBlock.get(row.id) ?? []

    const focusSessionIds = focusRows.map((r) => Number(r.member_id))
    const focusTotalSeconds = focusRows.reduce((sum, r) => sum + r.weight_seconds, 0)
    const durationSec = Math.max(1, (row.end_time - row.start_time) / 1000)
    const focusOverlap = {
      totalSeconds: focusTotalSeconds,
      pct: Math.min(100, Math.round((focusTotalSeconds / durationSec) * 100)),
      sessionIds: focusSessionIds,
    }

    const blockActiveSec = blockSessions.length > 0
      ? blockSessions.reduce((sum, session) => sum + session.durationSeconds, 0)
      : memberRows.reduce((sum, r) => sum + r.weight_seconds, 0)
    totalSeconds += blockActiveSec
    if (FOCUSED_CATEGORIES.includes(dominantCategory)) {
      focusSeconds += blockActiveSec
    }
    const evidenceApps = Array.isArray(evidence.apps) ? evidence.apps as WorkContextAppSummary[] : []
    const topApps = evidenceApps.length > 0 ? evidenceApps : topAppsFromSessions(blockSessions)

    blocks.push({
      id: row.id,
      startTime: row.start_time,
      endTime: row.end_time,
      dominantCategory,
      categoryDistribution,
      ruleBasedLabel: ruleLabel,
      aiLabel: aiLabel,
      sessions: blockSessions,
      topApps,
      websites,
      keyPages,
      pageRefs,
      documentRefs,
      topArtifacts,
      workflowRefs: workflowsByBlock.get(row.id) ?? [],
      label: {
        current: row.label_current,
        source: row.label_source as LabelSource,
        confidence: row.label_confidence,
        narrative: row.narrative_current,
        ruleBased: ruleLabel,
        aiSuggested: aiLabel,
        override: overrideRow?.label ?? null,
      },
      focusOverlap,
      evidenceSummary: {
        apps: topApps,
        pages: pageRefs,
        documents: documentRefs,
        domains: Array.isArray(evidence.domains) ? evidence.domains as string[] : [],
      },
      heuristicVersion: row.heuristic_version,
      computedAt: row.computed_at,
      switchCount: row.switch_count,
      confidence: confidenceForCandidate({
        sessions: blockSessions,
        formation: 'mixed',
        boundedBeforeGap: false,
        boundedAfterGap: false,
      }, coherenceScore(categoryDistribution)),
      isLive: false,
    })
  }

  // Derive labels through the same finalizer as the timeline so recap surfaces
  // never show the stale "<x> development" strings either (see the persisted
  // loader). Grouping stays as persisted; only the label is recomputed.
  const finalizedBlocks = blocks.map((block) => finalizedLabelForBlock(db, block))
  blocks.length = 0
  blocks.push(...finalizedBlocks)

  const focusSessions = getFocusSessionsForDateRange(db, fromMs, toMs)
  const segments = buildSegmentsForDay(db, dateStr, blocks)
  const activeSeconds = sessions.reduce((sum, session) => sum + session.durationSeconds, 0)
  const focusedSeconds = sessions
    .filter((session) => session.isFocused)
    .reduce((sum, session) => sum + session.durationSeconds, 0)
  const payloadTotalSeconds = activeSeconds > 0 ? activeSeconds : totalSeconds
  const payloadFocusSeconds = activeSeconds > 0 ? focusedSeconds : focusSeconds

  return {
    date: dateStr,
    sessions,
    websites: websitesForDay,
    blocks,
    segments,
    focusSessions,
    computedAt: Date.now(),
    version: TIMELINE_HEURISTIC_VERSION,
    totalSeconds: payloadTotalSeconds,
    focusSeconds: payloadFocusSeconds,
    focusPct: payloadTotalSeconds > 0 ? Math.round((payloadFocusSeconds / payloadTotalSeconds) * 100) : 0,
    appCount: new Set(sessions.map((session) => session.bundleId)).size,
    siteCount: websitesForDay.length,
  }
}

export function getRecapRange(
  db: Database.Database,
  dateStrs: string[],
): DayTimelinePayload[] {
  const todayStr = localDateString()
  return dateStrs.map((dateStr) => {
    if (dateStr >= todayStr) {
      return getTimelineDayPayload(db, dateStr)
    }
    const lightweight = getLightweightDayPayload(db, dateStr)
    if (lightweight) {
      return lightweight
    }
    return getTimelineDayPayload(db, dateStr)
  })
}

function localDateStringForOffset(offsetDays: number): string {
  const target = new Date()
  target.setDate(target.getDate() + offsetDays)
  const year = target.getFullYear()
  const month = String(target.getMonth() + 1).padStart(2, '0')
  const day = String(target.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function lookupPersistedTimelineBlockDate(db: Database.Database, blockId: string): string | null {
  const row = db.prepare(`
    SELECT date
    FROM timeline_blocks
    WHERE id = ?
      AND invalidated_at IS NULL
    LIMIT 1
  `).get(blockId) as { date: string } | undefined

  return row?.date ?? null
}

const APP_DETAIL_FALLBACK_MERGE_GAP_MS = 5 * 60_000

function dominantCategoryForSessions(sessions: AppSession[]): AppCategory {
  const distribution: Partial<Record<AppCategory, number>> = {}
  for (const session of sessions) {
    distribution[session.category] = (distribution[session.category] ?? 0) + session.durationSeconds
  }
  return dominantCategoryFromDistribution(distribution)
}

function labelForSessionCluster(sessions: AppSession[]): string {
  if (sessions.length === 0) return 'Work block'

  const lead = sessions.reduce((best, current) => (
    current.durationSeconds > best.durationSeconds ? current : best
  ))
  const titled = usefulWindowTitle(lead)
  if (titled) return compactWindowTitle(titled)

  const identity = resolveCanonicalApp(lead.bundleId, lead.appName)
  return sanitizeBlockLabel(identity.displayName)
    ?? sanitizeBlockLabel(lead.appName)
    ?? prettyCategory(lead.category)
}

function normalizedAppActivityLabel(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function labelMatchesSelectedApp(label: string, displayName: string): boolean {
  return normalizedAppActivityLabel(label) === normalizedAppActivityLabel(displayName)
}

function buildSessionDerivedAppDetailBlocksByDate(
  sessions: AppSession[],
  canonicalAppId: string,
): Map<string, AppDetailBlockSlice[]> {
  const sessionsByDate = new Map<string, AppSession[]>()

  for (const session of sessions) {
    const dateKey = localDateKeyForTimestamp(session.startTime)
    const current = sessionsByDate.get(dateKey) ?? []
    current.push(session)
    sessionsByDate.set(dateKey, current)
  }

  const blocksByDate = new Map<string, AppDetailBlockSlice[]>()
  for (const [dateKey, appSessions] of sessionsByDate.entries()) {
    const ordered = [...appSessions].sort((left, right) => left.startTime - right.startTime)
    const clusters: AppSession[][] = []

    for (const session of ordered) {
      const currentCluster = clusters[clusters.length - 1]
      if (!currentCluster || currentCluster.length === 0) {
        clusters.push([session])
        continue
      }

      const previous = currentCluster[currentCluster.length - 1]
      const gapMs = session.startTime - sessionEndMs(previous)
      if (gapMs <= APP_DETAIL_FALLBACK_MERGE_GAP_MS) {
        currentCluster.push(session)
      } else {
        clusters.push([session])
      }
    }

    const slices = clusters.map((cluster) => {
      const startTime = cluster[0].startTime
      const endTime = cluster.reduce((latest, session) => Math.max(latest, sessionEndMs(session)), startTime)
      const signature = `${canonicalAppId}:${startTime}:${endTime}:${cluster.map((session) => session.id).join(',')}`
      return {
        id: `appd_${sha1(signature).slice(0, 16)}`,
        startTime,
        endTime,
        dominantCategory: dominantCategoryForSessions(cluster),
        label: {
          current: labelForSessionCluster(cluster),
        },
        topApps: topAppsFromSessions(cluster),
        topArtifacts: [],
        pageRefs: [],
        workflowRefs: [],
      }
    })

    blocksByDate.set(dateKey, slices)
  }

  return blocksByDate
}

export function getBlockDetailPayload(
  db: Database.Database,
  blockId: string,
  liveSession?: LiveSession | null,
): WorkContextBlock | null {
  const persistedDate = lookupPersistedTimelineBlockDate(db, blockId)
  if (persistedDate) {
    const payload = getTimelineDayPayload(db, persistedDate, liveSession)
    const match = payload.blocks.find((block) => block.id === blockId)
    if (match) return match
  }

  for (let offset = 0; offset >= -30; offset--) {
    const dateStr = localDateStringForOffset(offset)
    if (dateStr === persistedDate) continue
    const payload = getTimelineDayPayload(db, dateStr, liveSession)
    const match = payload.blocks.find((block) => block.id === blockId)
    if (match) return match
  }
  return null
}

export function getWorkflowSummaries(
  db: Database.Database,
  days = 14,
): WorkflowPattern[] {
  const today = localDateStringForOffset(0)
  const [todayStart] = localDayBounds(today)
  const fromMs = todayStart - Math.max(0, days - 1) * 86_400_000
  const fromDate = new Date(fromMs)
  const fromDateStr = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`

  const rows = db.prepare(`
    SELECT
      workflow_signatures.id,
      workflow_signatures.signature_key,
      workflow_signatures.label,
      workflow_signatures.dominant_category,
      workflow_signatures.canonical_apps_json,
      workflow_signatures.artifact_keys_json,
      COUNT(workflow_occurrences.block_id) AS occurrence_count,
      MAX(timeline_blocks.end_time) AS last_seen_at
    FROM workflow_signatures
    JOIN workflow_occurrences
      ON workflow_occurrences.workflow_id = workflow_signatures.id
    JOIN timeline_blocks
      ON timeline_blocks.id = workflow_occurrences.block_id
    WHERE workflow_occurrences.date >= ?
      AND timeline_blocks.invalidated_at IS NULL
    GROUP BY workflow_signatures.id
    ORDER BY occurrence_count DESC, last_seen_at DESC
    LIMIT 20
  `).all(fromDateStr) as Array<{
    id: string
    signature_key: string
    label: string
    dominant_category: AppCategory
    canonical_apps_json: string
    artifact_keys_json: string
    occurrence_count: number
    last_seen_at: number
  }>

  return rows.map((row) => ({
    id: row.id,
    signatureKey: row.signature_key,
    label: row.label,
    dominantCategory: row.dominant_category,
    canonicalApps: JSON.parse(row.canonical_apps_json) as string[],
    artifactKeys: JSON.parse(row.artifact_keys_json) as string[],
    occurrenceCount: row.occurrence_count,
    lastSeenAt: row.last_seen_at,
  }))
}

export function getArtifactDetails(
  db: Database.Database,
  artifactId: string,
): ArtifactRef | null {
  const row = db.prepare(`
    SELECT
      id,
      artifact_type,
      canonical_key,
      display_title,
      url,
      path,
      host,
      canonical_app_id,
      metadata_json
    FROM artifacts
    WHERE id = ?
    LIMIT 1
  `).get(artifactId) as {
    id: string
    artifact_type: ArtifactRef['artifactType']
    canonical_key: string
    display_title: string
    url: string | null
    path: string | null
    host: string | null
    canonical_app_id: string | null
    metadata_json: string
  } | undefined

  if (!row) return null
  const metadata = JSON.parse(row.metadata_json || '{}') as Record<string, unknown>
  return {
    id: row.id,
    artifactType: row.artifact_type,
    canonicalKey: row.canonical_key,
    displayTitle: row.display_title,
    totalSeconds: 0,
    confidence: 0.5,
    canonicalAppId: row.canonical_app_id,
    ownerBundleId: typeof metadata.ownerBundleId === 'string' ? metadata.ownerBundleId : null,
    ownerAppName: typeof metadata.ownerAppName === 'string' ? metadata.ownerAppName : null,
    ownerAppInstanceId: typeof metadata.ownerAppInstanceId === 'string' ? metadata.ownerAppInstanceId : null,
    url: row.url,
    path: row.path,
    host: row.host,
    openTarget: row.url
      ? { kind: 'external_url', value: row.url }
      : row.path
        ? { kind: 'local_path', value: row.path }
        : { kind: 'unsupported', value: null },
    metadata,
  }
}

export function getAppDetailPayload(
  db: Database.Database,
  canonicalAppId: string,
  daysOrDate: number | string = 7,
  liveSession?: LiveSession | null,
): AppDetailPayload {
  const isDate = typeof daysOrDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(daysOrDate)
  const today = isDate ? (daysOrDate as string) : localDateStringForOffset(0)
  const days = isDate ? 1 : Number(daysOrDate)

  const [todayFrom, todayTo] = localDayBounds(today)
  const fromMs = todayFrom - Math.max(0, days - 1) * 86_400_000
  const rangeKey = isDate ? `1d:${today}` : `${days}d:${today}`

  const allSessions = mergeLiveSession(getSessionsForRange(db, fromMs, todayTo), liveSession)
  const sessions = allSessions.filter((session) => {
    const identity = resolveCanonicalApp(session.bundleId, session.appName)
    return (session.canonicalAppId ?? identity.canonicalAppId ?? session.bundleId) === canonicalAppId
  })

  const relevantDates = Array.from(new Set(sessions.map((session) => localDateKeyForTimestamp(session.startTime))))
  const historicalDates = relevantDates.filter((date) => !(date === today && liveSession))
  const persistedBlocksByDate = loadPersistedAppDetailBlocksForDates(db, historicalDates)
  const blocksByDate = new Map<string, AppDetailBlockSlice[]>(persistedBlocksByDate)
  const sessionDerivedBlocksByDate = buildSessionDerivedAppDetailBlocksByDate(sessions, canonicalAppId)

  for (const date of relevantDates) {
    const fallbackBlocks = sessionDerivedBlocksByDate.get(date) ?? []
    const persistedBlocks = blocksByDate.get(date) ?? []

    // Keep app detail responsive even when timeline blocks have not yet been
    // persisted for this date by deriving coarse slices from app sessions.
    if (persistedBlocks.length === 0 && fallbackBlocks.length > 0) {
      blocksByDate.set(date, fallbackBlocks)
      continue
    }

    // For today with a live session, prefer the session-derived slices so the
    // currently running block is reflected immediately in the app panel.
    if (date === today && liveSession && fallbackBlocks.length > 0) {
      blocksByDate.set(date, fallbackBlocks)
    }
  }

  const relatedBlocks = Array.from(blocksByDate.values()).flat()
    .filter((block) => block.topApps.some((app) => {
      const identity = resolveCanonicalApp(app.bundleId, app.appName)
      return (identity.canonicalAppId ?? app.bundleId) === canonicalAppId
    }))

  const artifactTotals = new Map<string, ArtifactRef>()
  for (const block of relatedBlocks) {
    const blockContainsOnlySelectedApp = block.topApps.every((app) => {
      const identity = resolveCanonicalApp(app.bundleId, app.appName)
      return (identity.canonicalAppId ?? app.bundleId) === canonicalAppId
    })

    for (const artifact of block.topArtifacts) {
      let belongsToSelectedApp: boolean
      if (artifact.canonicalAppId) {
        belongsToSelectedApp = artifact.canonicalAppId === canonicalAppId
      } else if (artifact.ownerBundleId) {
        const ownerIdentity = resolveCanonicalApp(artifact.ownerBundleId, artifact.ownerAppName ?? artifact.ownerBundleId)
        belongsToSelectedApp = (ownerIdentity.canonicalAppId ?? artifact.ownerBundleId) === canonicalAppId
      } else if (artifact.artifactType === 'page') {
        // Pages always belong to the browser that tracked them. For legacy data where
        // canonicalAppId was not persisted, resolve ownership from browserBundleId.
        const pageArtifact = artifact as PageRef
        const browserId = pageArtifact.canonicalBrowserId
          ?? (pageArtifact.browserBundleId
            ? resolveCanonicalApp(pageArtifact.browserBundleId, pageArtifact.browserBundleId).canonicalAppId
            : null)
        belongsToSelectedApp = browserId !== null ? browserId === canonicalAppId : false
      } else {
        belongsToSelectedApp = blockContainsOnlySelectedApp
      }

      if (!belongsToSelectedApp) continue

      const existing = artifactTotals.get(artifact.id)
      if (existing) {
        existing.totalSeconds += artifact.totalSeconds
      } else {
        artifactTotals.set(artifact.id, { ...artifact })
      }
    }
  }

  const topArtifacts = Array.from(artifactTotals.values())
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
    .slice(0, 8)

  const pageTotals = new Map<string, PageRef>()
  for (const block of relatedBlocks) {
    for (const page of block.pageRefs) {
      const pageBrowserId = page.canonicalAppId
        ?? page.canonicalBrowserId
        ?? (page.browserBundleId
          ? resolveCanonicalApp(page.browserBundleId, page.browserBundleId).canonicalAppId
          : null)
      if (pageBrowserId !== canonicalAppId) continue

      const existing = pageTotals.get(page.id)
      if (existing) {
        existing.totalSeconds += page.totalSeconds
      } else {
        pageTotals.set(page.id, { ...page })
      }
    }
  }

  const topPages = Array.from(pageTotals.values())
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
    .slice(0, 8)

  const pairedAppsMap = new Map<string, { canonicalAppId: string; bundleId: string | null; displayName: string; totalSeconds: number }>()
  for (const block of relatedBlocks) {
    for (const app of block.topApps) {
      const identity = resolveCanonicalApp(app.bundleId, app.appName)
      const pairedCanonicalId = identity.canonicalAppId ?? app.bundleId
      if (pairedCanonicalId === canonicalAppId) continue
      const existing = pairedAppsMap.get(pairedCanonicalId)
      if (existing) {
        existing.totalSeconds += app.totalSeconds
        if (!existing.bundleId && app.bundleId) existing.bundleId = app.bundleId
      } else {
        pairedAppsMap.set(pairedCanonicalId, {
          canonicalAppId: pairedCanonicalId,
          bundleId: app.bundleId ?? null,
          displayName: identity.displayName,
          totalSeconds: app.totalSeconds,
        })
      }
    }
  }

  const pairedApps = Array.from(pairedAppsMap.values())
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
    .slice(0, 8)

  const timeOfDayDistribution = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    totalSeconds: 0,
  }))
  for (const session of sessions) {
    const hour = new Date(session.startTime).getHours()
    timeOfDayDistribution[hour].totalSeconds += session.durationSeconds
  }

  const sampleSession = sessions[0]
  const appCharacter = sampleSession
    ? getAppCharacter(db, sampleSession.bundleId, days)
    : null
  const displayName = sampleSession
    ? resolveCanonicalApp(sampleSession.bundleId, sampleSession.appName).displayName
    : resolveCanonicalApp(canonicalAppId, canonicalAppId).displayName
  const profile: AppProfile = {
    canonicalAppId,
    displayName,
    roleSummary: appCharacter?.label ?? 'Activity profile',
    topArtifacts,
    pairedApps,
    topBlockIds: relatedBlocks.slice(0, 8).map((block) => block.id),
    computedAt: Date.now(),
  }
  const blockAppearances = Array.from(sessionDerivedBlocksByDate.values())
    .flat()
    .sort((left, right) => right.startTime - left.startTime)
    .map((block) => {
      const rawLabel = block.label.current
      const cleanLabel = sanitizeBlockLabel(rawLabel) ?? prettyCategory(block.dominantCategory)
      return {
        blockId: block.id,
        startTime: block.startTime,
        endTime: block.endTime,
        label: cleanLabel,
        dominantCategory: block.dominantCategory,
      }
    })
    .filter((block) => !labelMatchesSelectedApp(block.label, displayName))
    .slice(0, 12)

  const blockMemoryRollups = memoryRollupsForBlocks(db, blockAppearances)

  // Totals and session counts must match the Apps rail so the same app on the
  // same day reads identically in every surface. Both derive from
  // getAppSummariesForRange (no MIN_DISPLAY_SEC filter, canonicalApp keyed).
  // The `sessions` list above keeps the ≥15s filter for legibility — that is
  // a display concern, not a totals concern. See BUGS.md B4.
  const summariesForRange = getAppSummariesForRange(db, fromMs, todayTo)
  const canonicalSummary = summariesForRange.find((row) => row.canonicalAppId === canonicalAppId)
    ?? summariesForRange.find((row) => row.bundleId === canonicalAppId)
    ?? null
  // The rail mixes in the ongoing live session via liveAwareSummaries in
  // src/renderer/views/Apps.tsx. Mirror the same math here so a currently-
  // running app's total/sessionCount also agrees.
  let liveExtraSeconds = 0
  let liveExtraSessions = 0
  if (liveSession) {
    const liveCanonicalId = liveSession.canonicalAppId ?? liveSession.bundleId
    if (liveCanonicalId === canonicalAppId) {
      const liveStart = Math.max(liveSession.startTime, fromMs)
      liveExtraSeconds = Math.max(0, Math.round((Date.now() - liveStart) / 1000))
      liveExtraSessions = canonicalSummary ? 0 : 1
    }
  }
  const totalSeconds = (canonicalSummary?.totalSeconds ?? sessions.reduce((sum, s) => sum + s.durationSeconds, 0))
    + liveExtraSeconds
  const sessionCount = (canonicalSummary?.sessionCount ?? sessions.length) + liveExtraSessions

  return {
    canonicalAppId,
    displayName,
    appCharacter,
    profile,
    totalSeconds,
    sessionCount,
    topArtifacts,
    topPages,
    topDomains: topDomainsForBrowser(db, canonicalAppId, sessions, fromMs, todayTo),
    pairedApps,
    blockAppearances,
    blockMemoryRollups,
    workflowAppearances: relatedBlocks.flatMap((block) => block.workflowRefs)
      .filter((workflow, index, workflows) => workflows.findIndex((entry) => entry.id === workflow.id) === index)
      .slice(0, 10),
    timeOfDayDistribution,
    computedAt: profile.computedAt,
    rangeKey,
  }
}

// When the selected app is a browser, resolve the per-domain rollup grouped
// by `canonical_browser_id` so Chrome profiles merge into one total. Returns
// undefined for non-browser apps so the renderer can hide the section.
//
// Detection strategy: treat the app as a browser if any of its sessions are
// categorised `browsing` OR the canonical id matches the bundle-resolved
// browser id of a website_visits row inside the range. This avoids a
// hardcoded browser-id list and keeps the check resilient to new browsers.
function topDomainsForBrowser(
  db: Database.Database,
  canonicalAppId: string,
  sessions: AppSession[],
  fromMs: number,
  toMs: number,
): AppDetailPayload['topDomains'] {
  if (sessions.length === 0) return undefined
  const isBrowser = sessions.some((session) => isBrowserSession(session))
  if (!isBrowser) return undefined
  const summaries = getDomainSummariesForBrowser(db, fromMs, toMs, canonicalAppId, 8)
  if (summaries.length === 0) return []
  return summaries.map((summary) => ({
    domain: summary.domain,
    totalSeconds: summary.totalSeconds,
    visitCount: summary.visitCount,
    topTitle: summary.topTitle,
  }))
}

export function getDistractionCostPayload(
  db: Database.Database,
  domains: string[] = DISTRACTION_DOMAINS,
): DistractionCostPayload {
  const now = Date.now()
  const ms30d = 30 * 24 * 60 * 60 * 1000
  const ms60d = 60 * 24 * 60 * 60 * 1000
  const ms6mo = 182 * 24 * 60 * 60 * 1000

  const from30d = now - ms30d
  const from60d = now - ms60d
  const from6mo = now - ms6mo

  const daysTracked = getDaysTracked(db, from30d)
  const byDomain = getDistractionByDomain(db, domains, from30d)
  const byHour = getDistractionByHour(db, domains, from30d)
  const byMonth = getDistractionByMonth(db, domains, from6mo)

  const totalDistractionSeconds = byDomain.reduce((s, d) => s + d.totalSeconds, 0)

  const annualExtrapolatedSeconds = daysTracked > 0
    ? Math.round((totalDistractionSeconds / daysTracked) * 365)
    : 0

  const peakHour = byHour.length > 0
    ? byHour.reduce((best, h) => h.totalSeconds > best.totalSeconds ? h : best).hour
    : null

  // Trend: compare last 30 days vs previous 30 days
  const prevDomain = getDistractionByDomain(db, domains, from60d)
  const prevTotal = prevDomain.reduce((s, d) => s + d.totalSeconds, 0) - totalDistractionSeconds
  const previousPeriodSeconds = Math.max(0, prevTotal)

  let trendDirection: DistractionCostPayload['trendDirection'] = 'flat'
  if (previousPeriodSeconds > 0) {
    const changePct = (totalDistractionSeconds - previousPeriodSeconds) / previousPeriodSeconds
    if (changePct < -0.1) trendDirection = 'improving'
    else if (changePct > 0.1) trendDirection = 'worsening'
  }

  return {
    daysTracked,
    totalDistractionSeconds,
    annualExtrapolatedSeconds,
    byMonth,
    byHour,
    byDomain,
    peakHour,
    trendDirection,
    previousPeriodSeconds,
  }
}
