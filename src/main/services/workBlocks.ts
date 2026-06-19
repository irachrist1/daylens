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
  BlockBoundary,
  BlockConfidence,
  BoundaryReason,
  DayTimelinePayload,
  DistractionCostPayload,
  DocumentRef,
  HistoryDayPayload,
  LiveSession,
  PageRef,
  TimelineEvidenceSummary,
  TimelineSegment,
  TimelineBlockReview,
  TimelineBlockReviewState,
  TimelineBlockReviewUpdate,
  WorkflowPattern,
  WorkflowRef,
  WorkContextAppSummary,
  WorkContextBlock,
  LabelSource,
  WorkIntentRole,
  WebsiteSummary,
} from '@shared/types'
import { DISTRACTION_DOMAINS, FOCUSED_CATEGORIES } from '@shared/types'
import { isHostFilteredFromArtifacts, isHostBlockedForAppsRail, policyForHost } from '@shared/domainPolicy'
import { blockActiveSeconds } from '@shared/blockDuration'
import { DEFAULT_TIMELINE_BLOCK_REVIEW, isTimelineBlockReviewState, isTrustedTimelineBlock } from '@shared/timelineReview'
import { inferWorkIntent } from '@shared/workIntent'
import { resolveKind, dominantKind, effectiveBlockKind, kindForDomain, type WorkKind } from '@shared/workKind'
import { humanizeTitle, leisureActivityTitle } from '@shared/humanize'
import { localDateString } from '../lib/localDate'
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

function localDayBounds(dateStr: string): [number, number] {
  const [year, month, day] = dateStr.split('-').map(Number)
  return [
    new Date(year, month - 1, day).getTime(),
    new Date(year, month - 1, day + 1).getTime(),
  ]
}

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
const SUSTAINED_CATEGORY_THRESHOLD_SEC = 10 * 60
const COMMUNICATION_INTERRUPTION_THRESHOLD_SEC = 5 * 60
const FAST_SWITCH_THRESHOLD_SEC = 5 * 60
const SLOW_SWITCH_THRESHOLD_SEC = 15 * 60
const SUSTAINED_CONTEXT_SHIFT_THRESHOLD_SEC = 5 * 60
// A continuous intent is allowed to span the working day. Real gaps, meetings,
// and sustained intent changes create boundaries; elapsed time alone does not.
const TIMELINE_MAX_BLOCK_SPAN_MS = 8 * 60 * 60_000
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
const TIMELINE_COORDINATION_RESUME_GAP_MS = 35 * 60_000
const TIMELINE_LEISURE_RESUME_GAP_MS = 45 * 60_000
// Same-day safety ceiling only; normal segmentation is signal-driven.
const TIMELINE_MAX_COHERENT_BLOCK_SPAN_MS = 8 * 60 * 60_000
const TIMELINE_MAX_ASSISTED_WORK_SPAN_MS = 8 * 60 * 60_000
const TIMELINE_SPLIT_GAP_THRESHOLD_MS = 5 * 60_000
const TIMELINE_MIN_CHILD_SPAN_MS = 15 * 60_000
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
// Bumped to v8 with: 15-minute hard gaps, sub-10-minute detour absorption,
// correction lineage across reshaped blocks, system-noise projection filters,
// and block-derived duration/count truth.
//
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
const TIMELINE_HEURISTIC_VERSION = 'timeline-v8'

function isSystemNoiseSession(session: Pick<AppSession, 'bundleId' | 'appName' | 'rawAppName'>): boolean {
  const identity = `${session.bundleId} ${session.appName} ${session.rawAppName ?? ''}`.toLowerCase()
  return SYSTEM_NOISE_TOKENS.some((token) => identity.includes(token))
}

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
  // Set by the boundary-scoring reconciliation pass: why this candidate's
  // start and end edges were cut. Projected onto the block as `boundary`.
  startReasons?: BoundaryReason[]
  endReasons?: BoundaryReason[]
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

function nativeFocusedDistribution(sessions: AppSession[]): Partial<Record<AppCategory, number>> {
  const distribution: Partial<Record<AppCategory, number>> = {}
  for (const session of sessions) {
    if (isBrowserSession(session)) continue
    const category = inferredFocusedCategoryForSession(session)
    if ((!FOCUSED_CATEGORIES.includes(category) && category !== 'meetings') || category === 'browsing') continue
    distribution[category] = (distribution[category] ?? 0) + session.durationSeconds
  }
  return distribution
}

function strongNativeWorkCategory(sessions: AppSession[]): AppCategory | null {
  const nativeDistribution = nativeFocusedDistribution(sessions)
  const entries = Object.entries(nativeDistribution) as Array<[AppCategory, number]>
  const nativeSeconds = entries.reduce((sum, [, seconds]) => sum + seconds, 0)
  const totalSeconds = sessions.reduce((sum, session) => sum + Math.max(0, session.durationSeconds), 0)
  if (nativeSeconds < 3 * 60 || nativeSeconds / Math.max(1, totalSeconds) < 0.15) return null
  return dominantCategoryFromDistribution(nativeDistribution)
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
  sessions: AppSession[] = [],
): AppCategory {
  const baseCategory = dominantCategoryFromDistribution(distribution)
  const focusedCategory = dominantFocusedCategoryFromDistribution(distribution)
  const artifactCategory = categoryForTopPageArtifact(topArtifacts)
  const nativeWorkCategory = strongNativeWorkCategory(sessions)
  const totalSeconds = Object.values(distribution).reduce((sum, seconds) => sum + seconds, 0)
  const leisureArtifactSeconds = topArtifacts
    .filter((artifact) => {
      const policy = policyForHost(artifact.host ?? null)
      return policy === 'social_feed' || policy === 'entertainment'
    })
    .reduce((sum, artifact) => sum + artifact.totalSeconds, 0)

  if (baseCategory === 'browsing' && hasLocalhostPageArtifact(topArtifacts) && (distribution.development ?? 0) > 0) {
    return 'development'
  }
  // Browser evidence can explain a browser-led block, but it cannot relabel a
  // stretch with material native work. This is the episode-level version of
  // "one Netflix/X tab never turns debugging into leisure."
  if (nativeWorkCategory && artifactCategory) {
    if (leisureArtifactSeconds / Math.max(1, totalSeconds) >= 0.8) {
      return artifactCategory
    }
    return nativeWorkCategory
  }
  if (focusedCategory && (baseCategory === 'browsing' || baseCategory === 'entertainment' || baseCategory === 'social')) {
    return focusedCategory
  }
  if (artifactCategory && isBrowserLedCategory(baseCategory)) {
    return artifactCategory
  }
  return baseCategory
}

function isBrowserLedCategory(category: AppCategory): boolean {
  return category === 'browsing'
    || category === 'aiTools'
    || category === 'research'
    || category === 'entertainment'
    || category === 'social'
    || category === 'uncategorized'
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

function coarseSegmentsFromSessions(sessions: AppSession[]): CoarseSegment[] {
  if (sessions.length === 0) return []

  const segments: CoarseSegment[] = []
  let startIndex = 0

  for (let index = 1; index < sessions.length; index++) {
    const previous = sessions[index - 1]
    const current = sessions[index]
    const previousEnd = sessionEndMs(previous)
    const gap = current.startTime - previousEnd
    // Fifteen minutes without trusted activity is a hard boundary regardless
    // of whether the platform also emitted a lock/idle event. Sparse focused
    // support captures carry only seconds of activity across a long capture
    // window, so they remain evidence for the preceding work instead of
    // pretending the whole wall-clock window was a new active stretch.
    if (gap >= IDLE_GAP_THRESHOLD_MS && !isSparseFocusedSupportSession(current)) {
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

function isSparseFocusedSupportSession(session: AppSession): boolean {
  const wallSpanMs = Math.max(0, sessionEndMs(session) - session.startTime)
  const activeMs = Math.max(0, session.durationSeconds * 1000)
  const category = inferredFocusedCategoryForSession(session)
  return activeMs < TIMELINE_MIN_BLOCK_SPAN_MS
    && wallSpanMs >= IDLE_GAP_THRESHOLD_MS
    && activeMs * 4 < wallSpanMs
    && (category === 'development' || category === 'aiTools' || category === 'research')
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

function topAppsForBlock(
  sessions: AppSession[],
  dominantCategory: AppCategory,
): WorkContextAppSummary[] {
  const apps = topAppsFromSessions(sessions)
  if (dominantCategory !== 'entertainment' && dominantCategory !== 'social') return apps
  return apps.filter((app) => (
    app.isBrowser
    || !FOCUSED_CATEGORIES.includes(app.category)
    || app.totalSeconds >= 5 * 60
  ))
}

function sha1(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex')
}

function artifactIdFor(canonicalKey: string): string {
  return `art_${sha1(canonicalKey).slice(0, 16)}`
}

function blockIdFor(blockStart: number, blockEnd: number, sessionIds: number[], isLive: boolean): string {
  // The live block is re-derived on every refresh tick: its end advances each
  // second and new sessions flush onto its tail. Hashing those volatile inputs
  // churns its id constantly, which drops the user's selection (the id leaves
  // blockMap, the inspector closes) and breaks merge lookups (the id the
  // renderer sent no longer exists by the time the handler re-materializes).
  // Anchor the live id on its start alone — there is only ever one live block
  // and its start is stable as it grows — so it keeps a single identity.
  const signature = isLive
    ? `live:${blockStart}`
    : `${blockStart}:${blockEnd}:${sessionIds.join(',')}:${TIMELINE_HEURISTIC_VERSION}`
  const prefix = isLive ? 'live' : 'blk'
  return `${prefix}_${sha1(signature).slice(0, 16)}`
}

function reviewEvidenceKeyForBlock(block: WorkContextBlock): string {
  const sessionIds = block.sessions
    .map((session) => session.id)
    .filter((id) => id >= 0)
    .sort((left, right) => left - right)
  if (sessionIds.length > 0) {
    return `sessions:${sessionIds.join(',')}`
  }

  const artifactKeys = block.topArtifacts
    .map((artifact) => artifact.canonicalKey ?? artifact.id)
    .filter(Boolean)
    .sort()
    .slice(0, 8)
  const appKeys = block.topApps
    .map((app) => app.bundleId)
    .filter(Boolean)
    .sort()
    .slice(0, 8)
  return `span:${block.startTime}:${block.endTime}:apps:${appKeys.join(',')}:artifacts:${artifactKeys.join(',')}`
}

function defaultReviewStateForBlock(block: WorkContextBlock): TimelineBlockReviewState {
  if (block.isLive) return 'pending'
  if (block.label.source === 'user' || block.label.override?.trim()) return 'corrected'
  if (block.confidence === 'low' || block.label.confidence < 0.58) return 'pending'
  if (block.label.source === 'rule') return 'pending'
  return 'auto-approved'
}

function originalReviewSnapshotForBlock(block: WorkContextBlock): Record<string, unknown> {
  const intent = inferWorkIntent(block)
  return {
    blockId: block.id,
    startTime: block.startTime,
    endTime: block.endTime,
    dominantCategory: block.dominantCategory,
    label: block.label.current,
    labelSource: block.label.source,
    labelConfidence: block.label.confidence,
    ruleBasedLabel: block.ruleBasedLabel,
    aiLabel: block.aiLabel,
    intentRole: intent.role,
    intentSubject: intent.subject,
    confidence: block.confidence,
    heuristicVersion: block.heuristicVersion,
    sessionIds: block.sessions.map((session) => session.id).filter((id) => id >= 0),
    appBundles: block.topApps.slice(0, 6).map((app) => app.bundleId),
    artifactIds: block.topArtifacts.slice(0, 8).map((artifact) => artifact.id),
  }
}

function parseReviewJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function intentRoleValue(value: unknown): WorkIntentRole | null {
  if (typeof value !== 'string') return null
  return ([
    'execution',
    'research',
    'communication',
    'review',
    'coordination',
    'ambient',
    'ambiguous',
  ] as WorkIntentRole[]).includes(value as WorkIntentRole)
    ? value as WorkIntentRole
    : null
}

interface PersistedReviewRow {
  id: string
  block_id: string
  date: string
  evidence_key: string
  review_state: string
  original_block_json: string
  correction_json: string
  updated_at: number
}

function reviewFromRow(
  row: PersistedReviewRow | null,
  source: TimelineBlockReview['source'],
  fallbackState: TimelineBlockReviewState,
): TimelineBlockReview {
  if (!row || !isTimelineBlockReviewState(row.review_state)) {
    return {
      ...DEFAULT_TIMELINE_BLOCK_REVIEW,
      state: fallbackState,
    }
  }

  const original = parseReviewJson(row.original_block_json)
  const correction = parseReviewJson(row.correction_json)
  return {
    state: row.review_state,
    source,
    originalBlockId: stringValue(original.blockId) ?? row.block_id,
    originalLabel: stringValue(original.label),
    originalIntentRole: intentRoleValue(original.intentRole),
    originalIntentSubject: stringValue(original.intentSubject),
    correctedLabel: stringValue(correction.label),
    correctedIntentRole: intentRoleValue(correction.intentRole),
    correctedIntentSubject: stringValue(correction.intentSubject),
    updatedAt: row.updated_at,
  }
}

function compareReviewRows(left: PersistedReviewRow, right: PersistedReviewRow): number {
  const stateRank = (state: string): number => {
    switch (state) {
      case 'corrected': return 5
      case 'ignored': return 4
      case 'approved': return 3
      case 'pending': return 2
      case 'auto-approved': return 1
      default: return 0
    }
  }
  const rankDiff = stateRank(right.review_state) - stateRank(left.review_state)
  if (rankDiff !== 0) return rankDiff
  return right.updated_at - left.updated_at
}

function findReviewRowForBlock(
  db: Database.Database,
  dateStr: string,
  block: WorkContextBlock,
): { row: PersistedReviewRow | null; source: TimelineBlockReview['source'] } {
  const evidenceKey = reviewEvidenceKeyForBlock(block)
  const rows = db.prepare(`
    SELECT
      id,
      block_id,
      date,
      evidence_key,
      review_state,
      original_block_json,
      correction_json,
      updated_at
    FROM timeline_block_reviews
    WHERE block_id = ?
       OR (date = ? AND evidence_key = ?)
    ORDER BY updated_at DESC
  `).all(block.id, dateStr, evidenceKey) as PersistedReviewRow[]

  const blockRow = rows
    .filter((row) => row.block_id === block.id)
    .sort(compareReviewRows)[0] ?? null
  if (blockRow) return { row: blockRow, source: 'stored_block' }

  const evidenceRow = rows
    .filter((row) => row.evidence_key === evidenceKey)
    .sort(compareReviewRows)[0] ?? null
  if (evidenceRow) return { row: evidenceRow, source: 'stored_evidence' }

  // Segmentation upgrades can merge or reshape a corrected block, so its exact
  // session-set evidence key changes. Reattach explicit user decisions when
  // the rebuilt block still contains nearly all of the evidence the user
  // corrected. Default/automatic review rows are intentionally excluded.
  const currentSessionIds = new Set(
    block.sessions.map((session) => session.id).filter((id) => id >= 0),
  )
  if (currentSessionIds.size === 0) return { row: null, source: 'default' }

  const lineageRows = db.prepare(`
    SELECT
      id,
      block_id,
      date,
      evidence_key,
      review_state,
      original_block_json,
      correction_json,
      updated_at
    FROM timeline_block_reviews
    WHERE date = ?
      AND review_state IN ('corrected', 'ignored', 'approved')
    ORDER BY updated_at DESC
  `).all(dateStr) as PersistedReviewRow[]

  const sessionIdsForReview = (row: PersistedReviewRow): number[] => {
    const original = parseReviewJson(row.original_block_json)
    if (Array.isArray(original.sessionIds)) {
      return original.sessionIds.filter((value): value is number => Number.isInteger(value) && value >= 0)
    }
    if (row.evidence_key.startsWith('sessions:')) {
      return row.evidence_key.slice('sessions:'.length)
        .split(',')
        .map(Number)
        .filter((value) => Number.isInteger(value) && value >= 0)
    }
    return []
  }

  const overlapRow = lineageRows
    .map((row) => {
      const priorSessionIds = sessionIdsForReview(row)
      const overlap = priorSessionIds.filter((id) => currentSessionIds.has(id)).length
      const retainedShare = priorSessionIds.length > 0 ? overlap / priorSessionIds.length : 0
      if (retainedShare >= 0.8) return { row, retainedShare, overlap }

      // Derived-session reprojection can assign new row ids. Fall back to the
      // original corrected span plus app evidence so the decision still
      // follows the same real activity rather than a database surrogate key.
      const original = parseReviewJson(row.original_block_json)
      const priorStart = typeof original.startTime === 'number' ? original.startTime : null
      const priorEnd = typeof original.endTime === 'number' ? original.endTime : null
      const priorApps = Array.isArray(original.appBundles)
        ? original.appBundles.filter((value): value is string => typeof value === 'string')
        : []
      if (priorStart === null || priorEnd === null || priorEnd <= priorStart) return null
      const overlapMs = Math.max(0, Math.min(priorEnd, block.endTime) - Math.max(priorStart, block.startTime))
      const spanShare = overlapMs / (priorEnd - priorStart)
      const currentApps = new Set(block.topApps.map((app) => app.bundleId))
      const sharesApp = priorApps.length === 0 || priorApps.some((app) => currentApps.has(app))
      return spanShare >= 0.8 && sharesApp
        ? { row, retainedShare: spanShare, overlap: Math.round(overlapMs / 1000) }
        : null
    })
    .filter((candidate): candidate is { row: PersistedReviewRow; retainedShare: number; overlap: number } => candidate !== null)
    .sort((left, right) =>
      right.retainedShare - left.retainedShare
      || right.overlap - left.overlap
      || compareReviewRows(left.row, right.row),
    )[0]?.row ?? null

  return { row: overlapRow, source: overlapRow ? 'stored_evidence' : 'default' }
}

function reviewForBlock(db: Database.Database, dateStr: string, block: WorkContextBlock): TimelineBlockReview {
  const fallbackState = defaultReviewStateForBlock(block)
  const { row, source } = findReviewRowForBlock(db, dateStr, block)
  const review = reviewFromRow(row, source, fallbackState)
  if (review.state === 'corrected' && !review.correctedLabel && block.label.override?.trim()) {
    return {
      ...review,
      correctedLabel: block.label.override.trim(),
    }
  }
  return review
}

function applyReviewToBlock(block: WorkContextBlock, review: TimelineBlockReview): WorkContextBlock {
  if (review.state === 'corrected' && review.correctedLabel) {
    return {
      ...block,
      review,
      label: {
        ...block.label,
        current: review.correctedLabel,
        source: 'user',
        confidence: 1,
        override: review.correctedLabel,
      },
    }
  }
  return {
    ...block,
    review,
  }
}

function ensureDefaultReviewRowForBlock(db: Database.Database, dateStr: string, block: WorkContextBlock): void {
  const evidenceKey = reviewEvidenceKeyForBlock(block)
  const existing = findReviewRowForBlock(db, dateStr, block).row
  if (existing) return

  const now = Date.now()
  const state = defaultReviewStateForBlock(block)
  db.prepare(`
    INSERT OR IGNORE INTO timeline_block_reviews (
      id,
      block_id,
      date,
      evidence_key,
      review_state,
      original_block_json,
      correction_json,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)
  `).run(
    `review_${sha1(`${block.id}:${evidenceKey}`).slice(0, 18)}`,
    block.id,
    dateStr,
    evidenceKey,
    state,
    JSON.stringify(originalReviewSnapshotForBlock(block)),
    now,
    now,
  )
}

export function writeTimelineBlockReview(
  db: Database.Database,
  dateStr: string,
  block: WorkContextBlock,
  update: Omit<TimelineBlockReviewUpdate, 'blockId' | 'date'>,
): void {
  const state = update.state
  const evidenceKey = reviewEvidenceKeyForBlock(block)
  const existing = findReviewRowForBlock(db, dateStr, block).row
  const now = Date.now()
  const existingCorrection = existing ? parseReviewJson(existing.correction_json) : {}
  const nextCorrection: Record<string, unknown> = { ...existingCorrection }

  if (update.correctedLabel !== undefined) {
    const label = update.correctedLabel?.trim() ?? ''
    if (label) nextCorrection.label = label
    else delete nextCorrection.label
  }
  if (update.correctedIntentRole !== undefined) {
    if (update.correctedIntentRole) nextCorrection.intentRole = update.correctedIntentRole
    else delete nextCorrection.intentRole
  }
  if (update.correctedIntentSubject !== undefined) {
    const subject = update.correctedIntentSubject?.trim() ?? ''
    if (subject) nextCorrection.intentSubject = subject
    else delete nextCorrection.intentSubject
  }

  const originalJson = existing?.original_block_json && existing.original_block_json !== '{}'
    ? existing.original_block_json
    : JSON.stringify(originalReviewSnapshotForBlock(block))

  if (existing) {
    db.prepare(`
      UPDATE timeline_block_reviews
      SET block_id = ?,
          date = ?,
          evidence_key = ?,
          review_state = ?,
          original_block_json = ?,
          correction_json = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      block.id,
      dateStr,
      evidenceKey,
      state,
      originalJson,
      JSON.stringify(nextCorrection),
      now,
      existing.id,
    )
    return
  }

  db.prepare(`
    INSERT INTO timeline_block_reviews (
      id,
      block_id,
      date,
      evidence_key,
      review_state,
      original_block_json,
      correction_json,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `review_${sha1(`${block.id}:${evidenceKey}`).slice(0, 18)}`,
    block.id,
    dateStr,
    evidenceKey,
    state,
    originalJson,
    JSON.stringify(nextCorrection),
    now,
    now,
  )
}

// Persist a user merge correction keyed by the two sessions straddling the
// boundary, so it survives a rebuild and feeds back into the boundary scorer as
// the highest-weight "user correction memory" signal. A pair is unique, and a
// later correction on the same pair overwrites the earlier one.
function writeBoundaryCorrection(
  db: Database.Database,
  dateStr: string,
  leftSessionId: number,
  rightSessionId: number,
): void {
  if (leftSessionId < 0 || rightSessionId < 0) {
    throw new Error('Cannot record a boundary correction without persisted session evidence.')
  }
  const now = Date.now()
  const id = `bnd_${sha1(`${leftSessionId}:${rightSessionId}`).slice(0, 18)}`
  db.prepare(`
    INSERT INTO timeline_boundary_corrections (id, date, left_session_id, right_session_id, kind, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'merge', ?, ?)
    ON CONFLICT(left_session_id, right_session_id)
    DO UPDATE SET kind = excluded.kind, date = excluded.date, updated_at = excluded.updated_at
  `).run(id, dateStr, leftSessionId, rightSessionId, now, now)
}

// Merge two adjacent episodes into one: record a forced join between the last
// session of the earlier block and the first session of the later block.
export function mergeTimelineEpisodes(
  db: Database.Database,
  dateStr: string,
  firstBlock: WorkContextBlock,
  secondBlock: WorkContextBlock,
): void {
  const [earlier, later] = firstBlock.startTime <= secondBlock.startTime
    ? [firstBlock, secondBlock]
    : [secondBlock, firstBlock]
  const leftLast = [...earlier.sessions].filter((s) => s.id >= 0).sort((a, b) => a.startTime - b.startTime).pop()
  const rightFirst = [...later.sessions].filter((s) => s.id >= 0).sort((a, b) => a.startTime - b.startTime)[0]
  if (!leftLast || !rightFirst) {
    // A boundary correction is keyed by two persisted sessions. The live block
    // holds only its in-flight session until the tracker flushes it, so a merge
    // touching a just-started episode has nothing to anchor on yet.
    throw new Error('This episode is still live — give it a moment to settle, then merge.')
  }
  writeBoundaryCorrection(db, dateStr, leftLast.id, rightFirst.id)
  invalidateTimelineDay(db, dateStr)
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
  if (lower.length <= 14 && !/[\s/\\.\-:]/.test(lower)) {
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
  // Per-session work/leisure/personal kind, keyed by session identity. Resolved
  // once from category + (for browser sessions) the dominant domain in the
  // session's window. This is what makes a `kind` change a hard segmentation
  // boundary — coding can never be absorbed into a video block.
  sessionKind: Map<AppSession, WorkKind>
}

function browserBundleMatchesSession(visit: WebsiteVisitRecord, session: AppSession): boolean {
  if (!visit.browserBundleId && !visit.canonicalBrowserId) return true
  return visit.browserBundleId === session.bundleId
    || visit.canonicalBrowserId === session.bundleId
    || (session.canonicalAppId != null && visit.canonicalBrowserId === session.canonicalAppId)
}

// Resolve one session's kind, or null when it is neutral (bare browsing with no
// domain signal) and should inherit a neighbour's kind. Browser sessions take
// the kind of the domains they actually sat on (youtube → leisure, github →
// work); native app sessions trust their category.
function resolveSessionKindRaw(session: AppSession, visits: WebsiteVisitRecord[]): WorkKind | null {
  if (!isBrowserSession(session)) {
    const native = resolveKind({ category: session.category, isBrowser: false })
    return native.neutral ? null : native.kind
  }
  const start = session.startTime
  const end = sessionEndMs(session)
  const byDomain = new Map<string, number>()
  for (const visit of visits) {
    if (visit.visitTime < start || visit.visitTime >= end) continue
    if (!browserBundleMatchesSession(visit, session)) continue
    byDomain.set(visit.domain, (byDomain.get(visit.domain) ?? 0) + Math.max(1, visit.durationSec))
  }
  const domains = [...byDomain.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([domain]) => domain)
  const resolution = resolveKind({ category: session.category, isBrowser: true, domains })
  return resolution.neutral ? null : resolution.kind
}

function buildTimelineContext(db: Database.Database, sessions: AppSession[]): TimelineBuildContext {
  if (sessions.length === 0) return { websiteVisits: [], sessionKind: new Map() }
  const startTime = Math.min(...sessions.map((session) => session.startTime))
  const endTime = Math.max(...sessions.map((session) => sessionEndMs(session)))
  const websiteVisits = getWebsiteVisitsForRange(db, startTime, endTime)

  // Resolve raw kinds, then let neutral (bare-browsing) sessions inherit the
  // nearest concrete neighbour so a contentless tab-flip never forces a kind
  // boundary inside an otherwise-continuous episode.
  const raw = sessions.map((session) => resolveSessionKindRaw(session, websiteVisits))
  const sessionKind = new Map<AppSession, WorkKind>()
  sessions.forEach((session, index) => {
    if (raw[index]) {
      sessionKind.set(session, raw[index]!)
      return
    }
    let inherited: WorkKind | null = null
    for (let j = index - 1; j >= 0 && !inherited; j--) inherited = raw[j]
    for (let j = index + 1; j < raw.length && !inherited; j++) inherited = raw[j]
    sessionKind.set(session, inherited ?? 'personal')
  })

  return { websiteVisits, sessionKind }
}

// The kind of a session as seen by the build context; falls back to a
// category-only resolution when the session predates the context map (live
// sessions spliced in after the fact).
function sessionKindFor(session: AppSession, context?: TimelineBuildContext): WorkKind {
  const cached = context?.sessionKind.get(session)
  if (cached) return cached
  return resolveKind({ category: session.category, isBrowser: isBrowserSession(session) }).kind
}

// The dominant kind across a candidate's sessions, weighted by active time.
function candidateKind(candidate: CandidateBlock, context?: TimelineBuildContext): WorkKind {
  if (strongNativeWorkCategory(candidate.sessions)) return 'work'
  const weighted = candidate.sessions.map((session) => ({
    kind: sessionKindFor(session, context),
    seconds: session.durationSeconds,
  }))
  return dominantKind(weighted)
}

// Two candidates may only be merged when they belong to the same kind. A
// work↔leisure (or any kind) change is a hard boundary, never erased.
function candidatesShareKind(left: CandidateBlock, right: CandidateBlock, context?: TimelineBuildContext): boolean {
  return candidateKind(left, context) === candidateKind(right, context)
}

function sustainedKindShiftSplitIndex(
  sessions: AppSession[],
  context: TimelineBuildContext,
): number | null {
  if (sessions.length < 2) return null
  const MIN_SIDE_MS = 10 * 60_000
  const MIN_PURITY = 0.7
  let best: { index: number; score: number } | null = null

  for (let index = 1; index < sessions.length; index++) {
    const left = sessions.slice(0, index)
    const right = sessions.slice(index)
    const leftMs = left.reduce((sum, session) => sum + session.durationSeconds * 1000, 0)
    const rightMs = right.reduce((sum, session) => sum + session.durationSeconds * 1000, 0)
    if (leftMs < MIN_SIDE_MS || rightMs < MIN_SIDE_MS) continue

    const leftKind = dominantKind(left.map((session) => ({
      kind: sessionKindFor(session, context),
      seconds: session.durationSeconds,
    })))
    const rightKind = dominantKind(right.map((session) => ({
      kind: sessionKindFor(session, context),
      seconds: session.durationSeconds,
    })))
    if (leftKind === rightKind) continue

    const leftKindMs = left
      .filter((session) => sessionKindFor(session, context) === leftKind)
      .reduce((sum, session) => sum + session.durationSeconds * 1000, 0)
    const rightKindMs = right
      .filter((session) => sessionKindFor(session, context) === rightKind)
      .reduce((sum, session) => sum + session.durationSeconds * 1000, 0)
    const leftPurity = leftKindMs / leftMs
    const rightPurity = rightKindMs / rightMs
    if (leftPurity < MIN_PURITY || rightPurity < MIN_PURITY) continue

    const score = leftPurity + rightPurity
    if (!best || score > best.score) best = { index, score }
  }
  if (!best) return null

  const leftKind = dominantKind(sessions.slice(0, best.index).map((session) => ({
    kind: sessionKindFor(session, context),
    seconds: session.durationSeconds,
  })))
  const rightKind = dominantKind(sessions.slice(best.index).map((session) => ({
    kind: sessionKindFor(session, context),
    seconds: session.durationSeconds,
  })))
  if (leftKind === 'leisure' && rightKind === 'work') {
    const sustainedNativeIndex = sessions.findIndex((session, index) => {
      if (index < best.index || isBrowserSession(session) || session.durationSeconds < 5 * 60) return false
      const category = inferredFocusedCategoryForSession(session)
      return FOCUSED_CATEGORIES.includes(category) || category === 'meetings'
    })
    if (sustainedNativeIndex >= best.index) return sustainedNativeIndex

    for (let index = best.index; index < sessions.length; index++) {
      const windowStart = sessions[index].startTime
      const nativeWorkSeconds = sessions.slice(index)
        .filter((session) => session.startTime < windowStart + 10 * 60_000)
        .filter((session) => !isBrowserSession(session))
        .filter((session) => {
          const category = inferredFocusedCategoryForSession(session)
          return FOCUSED_CATEGORIES.includes(category) || category === 'meetings'
        })
        .reduce((sum, session) => sum + session.durationSeconds, 0)
      if (nativeWorkSeconds >= 5 * 60) return index
    }
  }
  return best.index
}

function splitCandidateOnSustainedKindShift(
  candidate: CandidateBlock,
  context: TimelineBuildContext,
): CandidateBlock[] {
  const splitIndex = sustainedKindShiftSplitIndex(candidate.sessions, context)
  if (splitIndex === null) return [candidate]
  return [
    {
      ...candidate,
      sessions: candidate.sessions.slice(0, splitIndex),
      formation: 'heuristic',
      boundedAfterGap: false,
    },
    {
      ...candidate,
      sessions: candidate.sessions.slice(splitIndex),
      formation: 'heuristic',
      boundedBeforeGap: false,
    },
  ]
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
  const rawWebsites = getWebsiteSummariesForRange(db, blockStart, blockEnd).slice(0, 5)
  const keyPagesByDomain = getTopPagesForDomains(db, blockStart, blockEnd, rawWebsites.map((site) => site.domain), 2)
  const keyPages = rawWebsites.flatMap((site) => keyPagesByDomain[site.domain] ?? [])
    .map((page) => page.title?.trim())
    .filter((title): title is string => Boolean(title))
    .filter((title, index, titles) => titles.indexOf(title) === index)
    .slice(0, 4)
  const isLive = candidate.sessions.some((session) => session.id === -1)
  const storedInsight = isLive ? null : getWorkContextInsightForRange(db, blockStart, blockEnd)
  const confidence = confidenceForCandidate(candidate, coherence)
  const pageCandidates = buildPageCandidates(db, blockStart, blockEnd, context)
  const windowCandidates = buildWindowArtifactCandidates(candidate.sessions)
  const pageRefs = pageCandidates.flatMap((candidate) => candidate.pageRef ? [candidate.pageRef] : [])
  const documentRefs = windowCandidates.flatMap((candidate) => candidate.documentRef ? [candidate.documentRef] : [])
  const topArtifacts = [...pageRefs, ...documentRefs]
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
    .slice(0, 6)
  const dominantCategory = dominantCategoryForBlock(distribution, topArtifacts, candidate.sessions)
  const topApps = topAppsForBlock(candidate.sessions, dominantCategory)
  const leisureWebsiteSeconds = rawWebsites
    .filter((site) => kindForDomain(site.domain) === 'leisure')
    .reduce((sum, site) => sum + site.totalSeconds, 0)
  const websites = strongNativeWorkCategory(candidate.sessions)
    && leisureWebsiteSeconds < 10 * 60
    ? rawWebsites.filter((site) => kindForDomain(site.domain) !== 'leisure')
    : rawWebsites
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
    review: {
      ...DEFAULT_TIMELINE_BLOCK_REVIEW,
      state: confidence === 'low' ? 'pending' : 'auto-approved',
    },
    isLive,
    kind: candidateKind(candidate, context),
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

  const boundary: BlockBoundary = {
    startReasons: candidate.startReasons && candidate.startReasons.length > 0 ? candidate.startReasons : ['day-start'],
    endReasons: candidate.endReasons && candidate.endReasons.length > 0 ? candidate.endReasons : ['day-end'],
  }

  return {
    ...normalizedBlock,
    label: {
      ...normalizedBlock.label,
      current: normalizedBlock.ruleBasedLabel,
      ruleBased: normalizedBlock.ruleBasedLabel,
    },
    workflowRefs: workflowApps.length > 0 ? [workflowRef] : [],
    boundary,
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
  return dominantCategoryForBlock(distribution, candidatePageArtifacts(candidate, db, context), candidate.sessions)
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

function candidateHasNoContentSignal(candidate: CandidateBlock, db?: Database.Database, context?: TimelineBuildContext): boolean {
  if (candidate.sessions.some((session) => usefulWindowTitle(session) !== null)) return false
  if (db && candidatePageArtifacts(candidate, db, context).length > 0) return false
  return true
}

// Narrow special case for the real "Safari browsing, no specific window
// titles" fragment: a browser-only browsing candidate, between two non-meeting
// neighbours, with no title or page artifact of its own. Other titleless short
// activities may still be meaningful, and edge blocks are not slivers.
function candidateIsContentlessBrowserSliver(
  candidate: CandidateBlock,
  left: CandidateBlock | null,
  right: CandidateBlock | null,
  db?: Database.Database,
  context?: TimelineBuildContext,
): boolean {
  if (!left || !right) return false
  if (left.formation === 'meeting' || right.formation === 'meeting') return false
  if (!candidate.sessions.every(isBrowserSession)) return false
  if (candidateDominantCategory(candidate, db, context) !== 'browsing') return false
  return candidateHasNoContentSignal(candidate, db, context)
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
  if (!candidatesShareKind(left, right, context)) return false
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
  if (!candidatesShareKind(a, b, context)) return false
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
    // A contentless browser sliver has no topic of its own, so the relatedness
    // gate is dropped only for that narrow case. The gap-boundary guard and span
    // ceiling below still apply, so it never bridges a real >15-min idle gap and
    // never builds a runaway block.
    const contentlessSliver = options.requireRelated && candidateIsContentlessBrowserSliver(candidate, left, right, db, context)
    const relatednessRequired = options.requireRelated && !contentlessSliver
    const leftOk = Boolean(
      left
      && left.formation !== 'meeting'
      && candidatesShareKind(candidate, left, context)
      && !(left.boundedAfterGap && candidate.boundedBeforeGap)
      && (!relatednessRequired || candidatesRelated(candidate, left, db, context))
      && combinedSpanMs(left, candidate) <= options.maxCombinedMs,
    )
    const rightOk = Boolean(
      right
      && right.formation !== 'meeting'
      && candidatesShareKind(candidate, right, context)
      && !(candidate.boundedAfterGap && right.boundedBeforeGap)
      && (!relatednessRequired || candidatesRelated(candidate, right, db, context))
      && combinedSpanMs(candidate, right) <= options.maxCombinedMs,
    )

    let mergeLeft: boolean
    if (leftOk && !rightOk) mergeLeft = true
    else if (!leftOk && rightOk) mergeLeft = false
    else if (!leftOk && !rightOk) continue
    else if (contentlessSliver) mergeLeft = gapBetweenCandidates(left!, candidate) <= gapBetweenCandidates(candidate, right!)
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

function candidateHasLeisurePageEvidence(
  candidate: CandidateBlock,
  db: Database.Database,
  context: TimelineBuildContext,
): boolean {
  return candidatePageArtifacts(candidate, db, context).some((artifact) => {
    const policy = policyForHost(artifact.host ?? null)
    return policy === 'social_feed' || policy === 'entertainment'
  })
}

function isCoordinationResumeAcrossGap(
  left: CandidateBlock,
  right: CandidateBlock,
  gapMs: number,
  db: Database.Database,
  context: TimelineBuildContext,
): boolean {
  return gapMs < TIMELINE_COORDINATION_RESUME_GAP_MS
    && candidateHasCoordinationEvidence(left)
    && candidateHasCoordinationEvidence(right)
    && (
      candidatesShareIntentEvidence(left, right, db, context)
      || (dominantAppId(left) != null && dominantAppId(left) === dominantAppId(right))
      || Math.min(candidateActiveMs(left), candidateActiveMs(right)) < 15 * 60_000
    )
}

function isLeisureResumeAcrossGap(
  left: CandidateBlock,
  right: CandidateBlock,
  gapMs: number,
  db: Database.Database,
  context: TimelineBuildContext,
): boolean {
  return gapMs < TIMELINE_LEISURE_RESUME_GAP_MS
    && candidateKind(left, context) === 'leisure'
    && candidateKind(right, context) === 'leisure'
    && dominantAppId(left) != null
    && dominantAppId(left) === dominantAppId(right)
    && candidateHasLeisurePageEvidence(left, db, context)
    && candidateHasLeisurePageEvidence(right, db, context)
}

// Bridge two stretches of the same continued work across a moderate gap. Unlike
// shouldSoftMerge (which only joins zero/near-zero gaps within one coarse
// segment), this deliberately reaches across coarse-segment boundaries — the
// gap is exactly what split them — but only when the same dominant app is doing
// related work and the gap stays under the bridge ceiling. Meetings never
// bridge, and the result is capped at the coherent maximum so bridging cannot
// build a runaway block.
function shouldBridgeSameWork(left: CandidateBlock, right: CandidateBlock, db: Database.Database, context: TimelineBuildContext): boolean {
  const gap = gapBetweenCandidates(left, right)
  const coordinationResume = isCoordinationResumeAcrossGap(left, right, gap, db, context)
  const leisureResume = isLeisureResumeAcrossGap(left, right, gap, db, context)
  if ((left.formation === 'meeting' || right.formation === 'meeting') && !coordinationResume) return false
  if (!candidatesShareKind(left, right, context)) return false
  if (left.boundedAfterGap && right.boundedBeforeGap && !coordinationResume && !leisureResume) return false
  // Drift categories never bridge across a gap. Two YouTube videos or two
  // X sessions separated by a 17-minute lull are not "the same work resuming" —
  // they are two separate detours, and the browser's content context is often
  // just `entertainment:<browser>` (window titles aren't reliably captured),
  // so without this guard every video in one browser collapses into a single
  // runaway "watching" block whose span (and old duration) dwarfed the actual
  // tracked time (R4). Bridging is for focused work continuing past an
  // interruption, not for stitching drift together.
  if (NON_BRIDGEABLE_CATEGORIES.has(candidateDominantCategory(left, db, context)) && !leisureResume) return false
  if (gap >= TIMELINE_SAME_WORK_BRIDGE_GAP_MS && !coordinationResume && !leisureResume) return false
  const assistedPair = candidatesAreAssistedWorkPair(left, right, db, context)
  const maxSpanMs = assistedPair ? TIMELINE_MAX_ASSISTED_WORK_SPAN_MS : TIMELINE_MAX_COHERENT_BLOCK_SPAN_MS
  if (combinedSpanMs(left, right) > maxSpanMs) return false
  if (coordinationResume || leisureResume) return true
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

function attachBoundarySupportSessions(
  candidates: CandidateBlock[],
  db: Database.Database,
  context: TimelineBuildContext,
): CandidateBlock[] {
  const result = candidates.map((candidate) => ({ ...candidate, sessions: [...candidate.sessions] }))
  for (let index = 0; index < result.length - 1; index++) {
    const left = result[index]
    const right = result[index + 1]
    if (runSignalsFor(left, db, context).mode !== 'drift' || runSignalsFor(right, db, context).mode === 'drift') continue

    if (!candidateHasCoordinationEvidence(right) && strongNativeWorkCategory(right.sessions)) {
      const sustainedNativeIndex = right.sessions.findIndex((session) => {
        if (isBrowserSession(session) || session.durationSeconds < 5 * 60) return false
        const category = inferredFocusedCategoryForSession(session)
        return FOCUSED_CATEGORIES.includes(category) || category === 'meetings'
      })
      if (sustainedNativeIndex > 0) {
        left.sessions.push(...right.sessions.splice(0, sustainedNativeIndex))
      }
    }

    let suffixSeconds = 0
    let suffixStart = left.sessions.length
    let suffixHasWorkSupport = false
    for (let sessionIndex = left.sessions.length - 1; sessionIndex >= 0; sessionIndex--) {
      const session = left.sessions[sessionIndex]
      suffixSeconds += session.durationSeconds
      if (suffixSeconds > 2 * 60) break
      suffixStart = sessionIndex
      const category = inferredFocusedCategoryForSession(session)
      if ((!isBrowserSession(session) || sessionKindFor(session, context) === 'work') && (
        category === 'meetings'
        || category === 'development'
        || category === 'aiTools'
        || category === 'research'
      )) {
        suffixHasWorkSupport = true
      }
    }
    if (suffixHasWorkSupport && suffixStart < left.sessions.length) {
      right.sessions.unshift(...left.sessions.splice(suffixStart))
    }

    const moved: AppSession[] = []
    while (left.sessions.length > 1) {
      const trailing = left.sessions[left.sessions.length - 1]
      const category = inferredFocusedCategoryForSession(trailing)
      const supportsWork = !isBrowserSession(trailing) && (
        category === 'meetings'
        || category === 'development'
        || category === 'aiTools'
        || category === 'research'
      )
      if (!supportsWork || trailing.durationSeconds >= 5 * 60) break
      moved.unshift(left.sessions.pop()!)
    }
    if (moved.length > 0) {
      right.sessions.unshift(...moved)
    }
  }
  return result
}

// ── Boundary-scoring reconciliation ─────────────────────────────────────────
//
// The passes above (analyze → normalize → coalesce → bridge) PROPOSE
// boundaries from a cascade of single-signal hard splits. They reliably
// over-split: a brief same-subject research peek inside an implementation
// stretch, one research thread spread across several sources, or a string of
// short admin tasks each become their own block. This pass is the final
// arbiter: it scores every proposed boundary from the full signal set and
// keeps the boundary only when the score clears the cut threshold. A boundary
// that does not clear it is erased and the two runs become one episode. The
// upstream heuristics are inputs to the score, not the decision.
//
// The score is intentionally coarse-grained and additive so its behaviour is
// predictable: hard signals (a meeting edge, a real idle gap) force a cut;
// soft cut signals (category shift, topic change, a research→execution
// handoff, a detour) push the score up; continuity signals (the same app
// carrying across, one research thread, a brief peek, a short-admin run) pull
// it down. A user split forces a cut; a user merge forces a join — that is the
// "user correction memory" signal feeding back into the model.

const BOUNDARY_CUT_THRESHOLD = 1
const BOUNDARY_HARD_SCORE = 100
const BRIEF_PEEK_MAX_ACTIVE_MS = 12 * 60_000

// ── User correction memory for boundaries ───────────────────────────────────
//
// When the user splits an episode at a chosen point they assert "there IS a
// boundary here"; a merge asserts "there is NOT". Both are persisted in the
// review ledger (timeline_boundary_corrections) keyed by the two sessions that
// straddle the boundary, so they survive rebuilds and feed back into the
// scorer as the highest-weight signal. The key is evidence-based (session ids),
// matching Agent B's correction lineage, so a re-cut day re-attaches them.
function boundaryKeyForSessionIds(leftLastId: number, rightFirstId: number): string {
  return `${leftLastId}:${rightFirstId}`
}

function boundaryKeyForCandidates(left: CandidateBlock, right: CandidateBlock): string | null {
  const leftLast = left.sessions[left.sessions.length - 1]
  const rightFirst = right.sessions[0]
  if (!leftLast || !rightFirst || leftLast.id < 0 || rightFirst.id < 0) return null
  return boundaryKeyForSessionIds(leftLast.id, rightFirst.id)
}

interface BoundaryCorrections {
  merges: Set<string>
  lookup(left: CandidateBlock, right: CandidateBlock): 'merge' | null
}

const EMPTY_BOUNDARY_CORRECTIONS: BoundaryCorrections = {
  merges: new Set(),
  lookup: () => null,
}

function makeBoundaryCorrections(merges: Set<string>): BoundaryCorrections {
  return {
    merges,
    lookup(left, right) {
      const key = boundaryKeyForCandidates(left, right)
      if (!key) return null
      if (merges.has(key)) return 'merge'
      return null
    },
  }
}

function boundaryCorrectionsTableExists(db: Database.Database): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='timeline_boundary_corrections' LIMIT 1`,
  ).get() as { name: string } | undefined
  return Boolean(row)
}

function loadBoundaryCorrections(db: Database.Database, dateStr?: string): BoundaryCorrections {
  if (!dateStr || !boundaryCorrectionsTableExists(db)) return EMPTY_BOUNDARY_CORRECTIONS
  const rows = db.prepare(`
    SELECT left_session_id AS leftId, right_session_id AS rightId, kind
    FROM timeline_boundary_corrections
    WHERE date = ?
  `).all(dateStr) as Array<{ leftId: number; rightId: number; kind: string }>
  const merges = new Set<string>()
  for (const row of rows) {
    const key = boundaryKeyForSessionIds(row.leftId, row.rightId)
    if (row.kind === 'merge') merges.add(key)
  }
  return makeBoundaryCorrections(merges)
}

type RunMode = 'execution' | 'research' | 'browse' | 'admin' | 'drift' | 'meeting'

const EXECUTION_RUN_CATEGORIES = new Set<AppCategory>(['development', 'writing', 'design'])
// Research is genuine investigation (research-categorised sources + AI tools).
// Plain `browsing` is its OWN topic-sensitive mode: two unrelated browsing
// topics are two different things, so browsing must not coalesce as one
// "research thread" the way research/AI sources do.
const RESEARCH_RUN_CATEGORIES = new Set<AppCategory>(['research', 'aiTools'])
const ADMIN_RUN_CATEGORIES = new Set<AppCategory>(['email', 'communication', 'productivity'])
const DRIFT_RUN_CATEGORIES = new Set<AppCategory>(['social', 'entertainment'])

// "Session-run-level intent": the coarse role/subject/app signals derived for a
// run of sessions BEFORE it is a finished block, so a shift in any of them can
// be weighed as a boundary signal rather than discovered post-hoc as a label.
interface RunSignals {
  mode: RunMode
  dominantCategory: AppCategory
  dominantApp: string | null
  contentContext: string
  activeMs: number
  isAdmin: boolean
}

function runModeFor(dominantCategory: AppCategory, isMeeting: boolean): RunMode {
  if (isMeeting) return 'meeting'
  if (EXECUTION_RUN_CATEGORIES.has(dominantCategory)) return 'execution'
  if (DRIFT_RUN_CATEGORIES.has(dominantCategory)) return 'drift'
  if (RESEARCH_RUN_CATEGORIES.has(dominantCategory)) return 'research'
  if (dominantCategory === 'browsing') return 'browse'
  if (ADMIN_RUN_CATEGORIES.has(dominantCategory)) return 'admin'
  return 'admin'
}

function runSignalsFor(candidate: CandidateBlock, db: Database.Database, context: TimelineBuildContext): RunSignals {
  const dominantCategory = candidateDominantCategory(candidate, db, context)
  const isMeeting = candidate.formation === 'meeting'
  const mode = runModeFor(dominantCategory, isMeeting)
  return {
    mode,
    dominantCategory,
    dominantApp: dominantAppId(candidate),
    contentContext: dominantContentContext(candidate.sessions),
    activeMs: candidateActiveMs(candidate),
    isAdmin: mode === 'admin' && candidateActiveMs(candidate) < TIMELINE_MIN_STANDALONE_SPAN_MS,
  }
}

// A short administrative slice — an email check, a calendar glance, a Slack
// reply, a checklist tick. A run of these belongs to one "triage" episode, not
// six separate blocks.
function isShortAdminRun(left: RunSignals, right: RunSignals): boolean {
  return left.isAdmin && right.isAdmin
}

function candidateHasCoordinationEvidence(candidate: CandidateBlock): boolean {
  return candidate.sessions.some((session) => session.category === 'meetings')
}

// Two runs are one research thread when both sit in the research family and are
// effectively contiguous — the user is gathering context across sources (Rize,
// then Toggl, then ChatGPT) on one investigation, even though each source has
// its own page title.
function isOneResearchThread(left: RunSignals, right: RunSignals, gapMs: number): boolean {
  return left.mode === 'research' && right.mode === 'research' && gapMs < TIMELINE_SAME_WORK_BRIDGE_GAP_MS
}

function intentTokens(
  candidate: CandidateBlock,
  db?: Database.Database,
  context?: TimelineBuildContext,
): Set<string> {
  const tokens = new Set<string>()
  const values = candidate.sessions
    .map((session) => usefulWindowTitle(session))
    .filter((value): value is string => Boolean(value))
  if (db) {
    values.push(...buildPageCandidates(
      db,
      candidate.sessions[0]?.startTime ?? 0,
      candidate.sessions.length > 0 ? sessionEndMs(candidate.sessions[candidate.sessions.length - 1]) : 0,
      context,
    ).flatMap((candidate) => candidate.pageRef
      ? [candidate.pageRef.displayTitle, candidate.pageRef.host ?? '']
      : []))
  }
  for (const value of values) {
    for (const token of compactWindowTitle(value).toLowerCase().match(/[a-z0-9]{4,}/g) ?? []) {
      if (![
        'with', 'from', 'this', 'that', 'google', 'safari', 'chrome', 'cursor', 'codex',
        'redacted', 'page', 'site', 'example', 'account',
      ].includes(token)) {
        tokens.add(token)
      }
    }
  }
  return tokens
}

function sameSurroundingIntent(
  left: CandidateBlock,
  right: CandidateBlock,
  db: Database.Database,
  context: TimelineBuildContext,
): boolean {
  const leftSig = runSignalsFor(left, db, context)
  const rightSig = runSignalsFor(right, db, context)
  if (leftSig.mode === 'drift' || rightSig.mode === 'drift' || leftSig.mode === 'meeting' || rightSig.mode === 'meeting') {
    return false
  }
  if (candidatesRelated(left, right, db, context)) return true
  if (leftSig.contentContext && leftSig.contentContext === rightSig.contentContext) return true

  const leftTokens = intentTokens(left, db, context)
  if ([...intentTokens(right, db, context)].some((token) => leftTokens.has(token))) return true

  // Sharing a browser is not evidence that the subject stayed the same.
  return leftSig.mode !== 'browse'
    && rightSig.mode !== 'browse'
    && leftSig.dominantApp != null
    && leftSig.dominantApp === rightSig.dominantApp
}

function candidatesShareIntentEvidence(
  left: CandidateBlock,
  right: CandidateBlock,
  db: Database.Database,
  context: TimelineBuildContext,
): boolean {
  const leftTokens = intentTokens(left, db, context)
  return [...intentTokens(right, db, context)].some((token) => leftTokens.has(token))
}

// Score a single proposed boundary. Positive ⇒ lean cut, negative ⇒ lean merge.
// Reasons accumulate the signals that argued for a cut; they survive only if
// the boundary is ultimately kept.
function scoreBoundary(
  left: CandidateBlock,
  right: CandidateBlock,
  leftSig: RunSignals,
  rightSig: RunSignals,
  db: Database.Database,
  context: TimelineBuildContext,
  corrections: BoundaryCorrections,
): { score: number; reasons: BoundaryReason[] } {
  const reasons: BoundaryReason[] = []
  // A user merge erases this boundary and overrides every heuristic below it,
  // including a kind change — the user's intent always wins over segmentation.
  if (corrections.lookup(left, right) === 'merge') return { score: -BOUNDARY_HARD_SCORE, reasons: [] }

  // Hard cuts — never erased.
  // A kind change (work↔leisure↔personal) is the hardest boundary of all: it is
  // the fix for coding being absorbed into a video block. Watching and shipping
  // are never one episode no matter how small the gap between them.
  if (candidateKind(left, context) !== candidateKind(right, context)) {
    return { score: BOUNDARY_HARD_SCORE, reasons: ['kind-shift'] }
  }
  if (leftSig.mode === 'meeting') return { score: BOUNDARY_HARD_SCORE, reasons: ['meeting-end'] }
  if (rightSig.mode === 'meeting') return { score: BOUNDARY_HARD_SCORE, reasons: ['meeting-start'] }
  const gapMs = gapBetweenCandidates(left, right)
  if ((left.boundedAfterGap && right.boundedBeforeGap) || gapMs >= TIMELINE_SAME_WORK_BRIDGE_GAP_MS) {
    return { score: BOUNDARY_HARD_SCORE, reasons: ['idle-gap'] }
  }

  // A merge can never build a runaway block; respect the same span ceiling the
  // upstream passes use. If joining would exceed it, the boundary stays.
  const assistedPair = candidatesAreAssistedWorkPair(left, right, db, context)
  const ceilingMs = assistedPair ? TIMELINE_MAX_ASSISTED_WORK_SPAN_MS : TIMELINE_MAX_COHERENT_BLOCK_SPAN_MS
  if (combinedSpanMs(left, right) > ceilingMs) {
    return { score: BOUNDARY_HARD_SCORE, reasons: ['idle-gap'] }
  }

  let score = 0

  // A detour (a short social/entertainment dip between work) is its own thing.
  if (leftSig.mode !== 'drift' && rightSig.mode === 'drift') {
    score += 6
    reasons.push('detour-start')
  } else if (leftSig.mode === 'drift' && rightSig.mode !== 'drift') {
    score += 6
    reasons.push('detour-end')
  }

  // Topic change inside plain browsing — two unrelated browsing subjects are
  // two different things even in the same browser. (A research thread, by
  // contrast, legitimately spans topics across sources and is held together by
  // the continuity pulls below.)
  if (leftSig.mode === 'browse' && rightSig.mode === 'browse' && leftSig.contentContext !== rightSig.contentContext) {
    score += 6
    reasons.push('subject-change')
  }

  // A work-mode shift (e.g. coding → writing, research → admin).
  if (leftSig.mode !== rightSig.mode && leftSig.mode !== 'drift' && rightSig.mode !== 'drift') {
    score += 2
    reasons.push('category-shift')
    if (leftSig.mode === 'research' && rightSig.mode === 'execution') {
      score += 1
      reasons.push('research-to-execution')
    }
  }

  // A repo/project change is a stronger artifact change than a page swap.
  if (leftSig.dominantApp && leftSig.dominantApp === rightSig.dominantApp
    && leftSig.contentContext !== rightSig.contentContext
    && leftSig.mode === 'execution' && rightSig.mode === 'execution') {
    score += 1
    reasons.push('artifact-change')
  }

  // A visible (sub-idle) gap is a mild boundary signal.
  if (gapMs >= TIMELINE_SPLIT_GAP_THRESHOLD_MS) {
    score += 1
    if (!reasons.includes('idle-gap')) reasons.push('idle-gap')
  }

  // ── Continuity pulls (merge) ──
  // Drift (entertainment/social) never gets a continuity pull: two videos in
  // the same browser across a lull are two separate detours, not one runaway
  // "watching" block (R4). Only the gap/detour signals decide drift edges.
  const eitherDrift = leftSig.mode === 'drift' || rightSig.mode === 'drift'
  if (!eitherDrift) {
    // The same app carrying straight across is the single strongest "same
    // session" signal — it overrides a category shift (a research tab followed
    // by a notes tab in the same browser is one synthesis session).
    if (leftSig.dominantApp && leftSig.dominantApp === rightSig.dominantApp) {
      score -= 4
    }
    if (isOneResearchThread(leftSig, rightSig, gapMs)) score -= 4
    if (isShortAdminRun(leftSig, rightSig)) score -= 5
    const shortBrowseResearchHandoff = (
      (leftSig.mode === 'browse' && leftSig.activeMs < 10 * 60_000 && rightSig.mode === 'research')
      || (rightSig.mode === 'browse' && rightSig.activeMs < 10 * 60_000 && leftSig.mode === 'research')
    )
    if (shortBrowseResearchHandoff) score -= 4
    const sustainedInvestigationHandoff =
      leftSig.activeMs >= 15 * 60_000
      && rightSig.activeMs >= 15 * 60_000
      && (leftSig.mode === 'research' || leftSig.mode === 'browse')
      && (rightSig.mode === 'research' || rightSig.mode === 'browse')
      && (strongNativeWorkCategory(left.sessions) || strongNativeWorkCategory(right.sessions))
    if (sustainedInvestigationHandoff) score -= 4
    if (
      (candidateHasCoordinationEvidence(left) && rightSig.mode === 'research')
      || (candidateHasCoordinationEvidence(right) && leftSig.mode === 'research')
    ) {
      score -= 4
    }
  }

  return { score, reasons }
}

// Brief same-subject research peek inside execution: a < ~12-minute
// research/browse that sits between two execution runs on the same app (look
// up a PR, then back to the editor). It is part of the implementation episode,
// not a boundary of its own. Fold it into the preceding run first so the two
// execution runs can then merge on app continuity.
function foldBriefPeeks(candidates: CandidateBlock[], db: Database.Database, context: TimelineBuildContext): CandidateBlock[] {
  if (candidates.length < 3) return candidates
  const signals = candidates.map((c) => runSignalsFor(c, db, context))
  const result: CandidateBlock[] = []
  const sig: RunSignals[] = []
  for (let index = 0; index < candidates.length; index++) {
    const current = candidates[index]
    const left = result[result.length - 1]
    const leftSig = sig[sig.length - 1]
    const right = candidates[index + 1]
    const rightSig = signals[index + 1]
    const isPeek =
      left && right
      && current.formation !== 'meeting'
      && candidatesShareKind(left, current, context)
      && signals[index].mode === 'research'
      && signals[index].activeMs < BRIEF_PEEK_MAX_ACTIVE_MS
      && leftSig?.mode === 'execution'
      && rightSig?.mode === 'execution'
      && leftSig.dominantApp != null
      && leftSig.dominantApp === rightSig.dominantApp
      && gapBetweenCandidates(left, current) < TIMELINE_SAME_WORK_BRIDGE_GAP_MS
      && gapBetweenCandidates(current, right) < TIMELINE_SAME_WORK_BRIDGE_GAP_MS
    if (isPeek) {
      result[result.length - 1] = mergeCandidatePair(left, current)
      sig[sig.length - 1] = runSignalsFor(result[result.length - 1], db, context)
      continue
    }
    result.push(current)
    sig.push(signals[index])
  }
  return result
}

// A brief leisure/social detour belongs to the work intent surrounding it.
// Ten minutes is the product boundary: 9:59 is absorbed; 10:00 remains a
// distinct episode. The neighbours must independently agree on intent so a
// short detour never glues two unrelated pieces of work together.
function foldBriefDetours(candidates: CandidateBlock[], db: Database.Database, context: TimelineBuildContext): CandidateBlock[] {
  if (candidates.length < 3) return candidates

  let current = candidates
  let changed = true
  while (changed) {
    changed = false
    const result: CandidateBlock[] = []
    for (let index = 0; index < current.length; index++) {
      const left = current[index]
      const detour = current[index + 1]
      const right = current[index + 2]
      const detourActiveMs = detour ? candidateActiveMs(detour) : 0
      const coordinationDetour = Boolean(
        detour && left && right
        && candidateHasCoordinationEvidence(detour)
        && detourActiveMs < 30 * 60_000
        && (
          candidatesShareIntentEvidence(detour, left, db, context)
          || candidatesShareIntentEvidence(detour, right, db, context)
        ),
      )
      if (
        left && detour && right
        && detour.formation !== 'meeting'
        && runSignalsFor(detour, db, context).mode === 'drift'
        && (detourActiveMs < 10 * 60_000 || coordinationDetour)
        && gapBetweenCandidates(left, detour) < IDLE_GAP_THRESHOLD_MS
        && gapBetweenCandidates(detour, right) < IDLE_GAP_THRESHOLD_MS
        && (sameSurroundingIntent(left, right, db, context) || coordinationDetour)
      ) {
        result.push(mergeCandidatePair(mergeCandidatePair(left, detour), right))
        index += 2
        changed = true
        continue
      }
      result.push(left)
    }
    current = result
  }
  return current
}

// The reconciliation pass: fold brief peeks, then walk the proposed boundaries
// and keep only those that clear the cut threshold. Records the surviving
// reasons on each resulting candidate's edges so every block can explain why it
// started and stopped.
function reconcileBoundaries(
  candidates: CandidateBlock[],
  db: Database.Database,
  context: TimelineBuildContext,
  corrections: BoundaryCorrections,
): CandidateBlock[] {
  if (candidates.length === 0) return candidates
  const folded = foldBriefPeeks(foldBriefDetours(candidates, db, context), db, context)

  const result: CandidateBlock[] = [{ ...folded[0], startReasons: ['day-start'], endReasons: ['day-end'] }]
  let prevSig = runSignalsFor(folded[0], db, context)
  if (folded[0].boundedBeforeGap) result[0].startReasons = ['day-start', 'idle-gap']

  for (let index = 1; index < folded.length; index++) {
    const previous = result[result.length - 1]
    const current = folded[index]
    const currentSig = runSignalsFor(current, db, context)
    const { score, reasons } = scoreBoundary(previous, current, prevSig, currentSig, db, context, corrections)

    if (score < BOUNDARY_CUT_THRESHOLD) {
      // Erase the boundary: the two runs are one episode.
      const mergedReasons = previous.startReasons ?? ['day-start']
      const joined = mergeCandidatePair(previous, current)
      result[result.length - 1] = { ...joined, startReasons: mergedReasons, endReasons: ['day-end'] }
      prevSig = runSignalsFor(result[result.length - 1], db, context)
      continue
    }

    const cutReasons: BoundaryReason[] = reasons.length > 0 ? reasons : ['category-shift']
    previous.endReasons = cutReasons
    result.push({ ...current, startReasons: cutReasons, endReasons: ['day-end'] })
    prevSig = currentSig
  }

  if (folded[folded.length - 1]?.boundedAfterGap) {
    const last = result[result.length - 1]
    last.endReasons = last.endReasons && !last.endReasons.includes('idle-gap')
      ? [...last.endReasons.filter((r) => r !== 'day-end'), 'idle-gap']
      : last.endReasons
  }
  return result
}

function buildBlocksForSessions(db: Database.Database, sessions: AppSession[], dateStr?: string): WorkContextBlock[] {
  const visibleSessions = sessions.filter((session) => !isSystemNoiseSession(session))
  if (visibleSessions.length === 0) return []
  const context = buildTimelineContext(db, visibleSessions)
  const corrections = loadBoundaryCorrections(db, dateStr)
  const candidates = coarseSegmentsFromSessions(visibleSessions)
    .flatMap((segment) => {
      // Kind is an episode-level result, not a boundary at every app sample.
      // Analyze the full continuous stretch first so brief browser detours and
      // neutral/system samples can be judged against the surrounding intent.
      const segmentCandidates = analyzeSessions(
        segment.sessions,
        segment.boundedBeforeGap,
        segment.boundedAfterGap,
      )
        .flatMap((candidate) => normalizeTimelineCandidates([candidate]))
        .flatMap((candidate) => splitCandidateOnSustainedKindShift(candidate, context))
      return coalesceTimelineCandidates(segmentCandidates, db, context)
    })
  const bridged = bridgeSameWorkCandidates(attachBoundarySupportSessions(candidates, db, context), db, context)
  const reconciled = reconcileBoundaries(bridged, db, context, corrections)
  return attachBoundarySupportSessions(reconciled, db, context)
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

function labelMatchesRawEvidence(label: string, block: WorkContextBlock): boolean {
  const normalized = normalizeForLeakCheck(label)
  if (!normalized) return true
  const rawValues = [
    ...block.sessions.flatMap((session) => [session.appName, session.rawAppName, session.windowTitle]),
    ...block.pageRefs.flatMap((page) => [page.pageTitle, page.displayTitle]),
    ...block.documentRefs.map((document) => document.displayTitle),
  ]
  return rawValues.some((value) => {
    if (!value) return false
    const raw = normalizeForLeakCheck(value)
    return raw.length > 0 && raw === normalized
  })
}

function usefulBlockLabel(block: WorkContextBlock, value: string | null | undefined): string | null {
  const label = usefulDerivedLabel(value)
  if (!label) return null
  return labelLooksToolOnly(label, block) || labelMatchesRawEvidence(label, block) ? null : label
}

function isActivityShapedLabel(label: string): boolean {
  return /^(building|testing|developing|researching|writing|designing|planning|organizing|configuring|debugging|reviewing|watching|browsing|communicating|meeting|communication|software development|research and analysis|design work|web research)\b/i.test(label.trim())
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

export type BackgroundRelabelDisposition = 'skip' | 'review' | 'relabel'

export function hasStableDeterministicBlockLabel(block: WorkContextBlock): boolean {
  return Boolean(
    usefulBlockLabel(block, block.workflowRefs[0]?.label)
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
  dateStr: string = localDateKeyForTimestamp(block.startTime),
): WorkContextBlock {
  // Today's blocks are recomputed from live sessions on every read. Reapply an
  // explicit AI category written by Analyze Day so the badge does not snap
  // back to the pre-analysis heuristic while the label remains AI-authored.
  const persistedAiCategory = db.prepare(`
    SELECT dominant_category AS category
    FROM timeline_blocks
    WHERE id = ?
      AND invalidated_at IS NULL
      AND label_source = 'ai'
    LIMIT 1
  `).get(block.id) as { category: AppCategory } | undefined
  if (
    persistedAiCategory
    && persistedAiCategory.category !== 'system'
    && persistedAiCategory.category !== 'uncategorized'
  ) {
    block = { ...block, dominantCategory: persistedAiCategory.category }
  }

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
  const memoryLabel = usefulBlockLabel(block, memoryPattern?.label)
  const projectLabel = usefulBlockLabel(block, projectHint?.label)
  const workflowLabel = usefulBlockLabel(block, block.workflowRefs[0]?.label)
  const rawRuleLabel = usefulBlockLabel(block, block.ruleBasedLabel)
  const ruleLabel = rawRuleLabel && isActivityShapedLabel(rawRuleLabel) ? rawRuleLabel : null
  const rawAiLabel = usefulBlockLabel(block, block.aiLabel)
  // F1: the AI labeler can also lift a YouTube tab title verbatim into the
  // block headline when it sees that page in the evidence. Reject any
  // suggested label that matches an entertainment/social/adult page title
  // in the block when the user's actual time was spent on work apps.
  const aiLabel = rawAiLabel && labelIsBrowserContentLeak(rawAiLabel, block) ? null : rawAiLabel

  // Label priority. User corrections always win. Learned and AI labels are
  // accepted only after the raw-evidence leak check; deterministic output is an
  // activity phrase, never a copied app/window/page title.
  const chosen = override?.label?.trim()
    || memoryLabel
    || aiLabel
    || workflowLabel
    || projectLabel
    || ruleLabel
    || deterministicActivityLabel(block)

  const source = override?.label?.trim()
    ? 'user'
    : memoryLabel && chosen === memoryLabel
      ? 'memory'
      : aiLabel && chosen === aiLabel
        ? 'ai'
        : workflowLabel && chosen === workflowLabel
            ? 'workflow'
            : projectLabel && chosen === projectLabel
              ? 'memory'
              : ruleLabel && chosen === ruleLabel
                ? 'rule'
                : 'rule'

  const finalized: WorkContextBlock = {
    ...block,
    label: {
      current: chosen,
      source,
      confidence: source === 'user'
        ? 1
        : source === 'memory'
          ? memoryPattern?.confidence ?? projectHint?.confidence ?? 0.72
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

  return applyReviewToBlock(finalized, reviewForBlock(db, dateStr, finalized))
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
      const block = options.finalized ? rawBlock : finalizedLabelForBlock(db, rawBlock, dateStr)
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

      ensureDefaultReviewRowForBlock(db, dateStr, block)

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
    ORDER BY block_id ASC, created_at DESC, id DESC
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

    const dominantCategory = row.dominant_category
    const ruleLabel = labelRows.find(r => r.source === 'rule')?.label || prettyCategory(dominantCategory)
    const aiLabel = labelRows.find(r => r.source === 'ai' || r.source === 'workflow')?.label || null
    const overrideRow = labelRows.find(r => r.source === 'user')

    const memberRows = appSessionMembersByBlock.get(row.id) ?? []

    const sessionIds = new Set(memberRows.map((r) => Number(r.member_id)))
    const matchedSessions = sessions.filter((s) => sessionIds.has(s.id))
    // Derived-session ids are projection-local and can change after a startup
    // reprojection. Preserve the persisted block's duration truth by
    // reattaching sessions through its stable time range when member ids no
    // longer resolve.
    const blockSessions = matchedSessions.length === memberRows.length && matchedSessions.length > 0
      ? matchedSessions
      : sessions.filter((session) => {
          const sessionEnd = session.endTime
            ?? session.startTime + Math.max(1, session.durationSeconds) * 1000
          return session.startTime < row.end_time && sessionEnd > row.start_time
        })

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
      review: {
        ...DEFAULT_TIMELINE_BLOCK_REVIEW,
        state: 'pending',
      },
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
  return blocks.map((block) => finalizedLabelForBlock(db, block, dateStr))
}

// True when the persisted blocks for a day were built by a superseded timeline
// heuristic, so a fresh reconstruction would group them more accurately.
function persistedDayHeuristicIsStale(db: Database.Database, dateStr: string): boolean {
  const row = db.prepare(`
    SELECT MIN(heuristic_version) AS heuristic_version, COUNT(*) AS block_count
    FROM timeline_blocks
    WHERE date = ? AND invalidated_at IS NULL AND is_live = 0
  `).get(dateStr) as { heuristic_version: string | null; block_count: number } | undefined
  if (!row) return false
  return row.heuristic_version !== TIMELINE_HEURISTIC_VERSION || row.block_count > 24
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
    GROUP BY blocks.date
    HAVING MIN(blocks.heuristic_version) <> ? OR COUNT(*) > 24
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
      // Persisted labels are not permission to freeze bad segmentation. Every
      // past day is lazily rebuilt when the block heuristic changes (or when a
      // pathological legacy materialization still has dozens of blocks).
      // Review and boundary corrections reattach through evidence lineage.
      if (!persistedDayHeuristicIsStale(db, dateStr)) {
        return persisted
      }
      forceMaterialize = true
    } else {
      forceMaterialize = true
    }
  } else if (validPersistedTimelineBlockCount(db, dateStr) === 0) {
    forceMaterialize = true
  }

  const computed = buildBlocksForSessions(db, sessions, dateStr).map((block) => finalizedLabelForBlock(db, block, dateStr))
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

const MIN_VISIBLE_GAP_MS = 15 * 60 * 1000

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

// Leisure/personal blocks are named by their activity, derived from the
// domains they sat on — "Watching YouTube & Netflix", "On X" — never the raw
// video/page title and never an inferred work label.
function leisureLabelForBlock(block: WorkContextBlock): string {
  const leisureDomains = block.websites
    .filter((site) => kindForDomain(site.domain) === 'leisure')
    .map((site) => site.domain)
  if (leisureDomains.length > 0) return leisureActivityTitle(leisureDomains)
  // No leisure domain captured (titleless browsing): fall back to the top
  // domains, still activity-shaped.
  const fallback = leisureActivityTitle(block.websites.map((site) => site.domain))
  if (fallback && fallback !== 'Leisure activity') return fallback
  if (block.dominantCategory === 'social') return 'Social browsing'
  if (block.dominantCategory === 'entertainment') return 'Watching entertainment'
  if (block.dominantCategory === 'browsing') return 'Web browsing'
  return 'Personal activity'
}

function deterministicActivityLabel(block: WorkContextBlock): string {
  const rawSubject = inferWorkIntent(block).subject
    ?? block.documentRefs[0]?.displayTitle
    ?? block.pageRefs.find((page) => !isHostBlockedForAppsRail(page.domain ?? page.host ?? null))?.displayTitle
    ?? bestTitleLabelForSessions(block.sessions)
    ?? null
  const subject = rawSubject
    ? humanizeTitle(
        naturalizeLabel(rawSubject)
          .replace(/\.[a-z0-9]{1,6}\b/gi, '')
          .replace(/[/_]+/g, ' ')
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/\s+/g, ' ')
          .trim(),
      )
    : null
  const safeSubject = subject
    && subject.length >= 3
    && !/^(npm|pnpm|yarn|git|node|python|cargo|swift|make)\b/i.test(subject)
    && !/^https?:\/\//i.test(subject)
    && !block.topApps.some((app) => normalizedLabelValue(app.appName) === normalizedLabelValue(subject))
    ? subject.split(/\s+/).slice(0, 8).join(' ')
    : null

  // Bare browsing without domain evidence can resolve to a neutral/personal
  // kind. Keep its sustained topics distinct with an activity-shaped subject
  // instead of collapsing every block to the same "Leisure activity" floor.
  if (block.dominantCategory === 'browsing' && safeSubject) {
    return `Browsing ${safeSubject}`
  }

  if (effectiveBlockKind(block) !== 'work') {
    const leisure = leisureLabelForBlock(block)
    return leisure && !GENERIC_LABELS.has(leisure) ? leisure : 'Leisure activity'
  }

  switch (block.dominantCategory) {
    case 'development': return safeSubject ? `Developing ${safeSubject}` : 'Software development'
    case 'research':
    case 'aiTools': return safeSubject ? `Researching ${safeSubject}` : 'Research and analysis'
    case 'writing': return safeSubject ? `Writing ${safeSubject}` : 'Writing'
    case 'design': return safeSubject ? `Designing ${safeSubject}` : 'Design work'
    case 'meetings': return safeSubject ? `Meeting about ${safeSubject}` : 'Meeting'
    case 'communication':
    case 'email': return safeSubject ? `Communicating about ${safeSubject}` : 'Communication'
    case 'productivity': return safeSubject ? `Organizing ${safeSubject}` : 'Planning and administration'
    case 'browsing': return safeSubject ? `Researching ${safeSubject}` : 'Web research'
    case 'social': return 'Social browsing'
    case 'entertainment': return 'Watching'
    default:
      return block.sessions.length > 0 || block.topApps.length > 0 || block.topArtifacts.length > 0
        ? 'Computer activity'
        : 'Untracked activity'
  }
}

export function userVisibleLabelForBlock(block: WorkContextBlock, overrideLabel?: string | null): string {
  // A user rename always wins, verbatim.
  if (overrideLabel && overrideLabel.trim() && !GENERIC_LABELS.has(overrideLabel.trim())) {
    return overrideLabel.trim()
  }
  if (block.review?.correctedLabel?.trim()) {
    return block.review.correctedLabel.trim()
  }

  if (effectiveBlockKind(block) !== 'work') {
    return leisureLabelForBlock(block)
  }

  return humanizeTitle(rawWorkLabelForBlock(block)) ?? rawWorkLabelForBlock(block)
}

function rawWorkLabelForBlock(block: WorkContextBlock): string {
  const preferred = usefulBlockLabel(block, block.aiLabel)
  if (preferred) {
    return preferred
  }

  // The finalized label (artifact / workflow / memory / corrected) is the name
  // the work earned — "timeline-eval/run.ts", "Design critique", "Budget
  // tracker" — and is strictly better than the rule-based floor it supersedes.
  // Prefer it whenever it is a real, specific label rather than a generic
  // category floor. This is what lets earlier intent name the block instead of
  // the block reading "Development" / "Writing" / "Productivity".
  const current = usefulBlockLabel(block, block.label.current)
  if (current) {
    return current
  }

  const ruleLabel = usefulBlockLabel(block, block.ruleBasedLabel)
  if (ruleLabel) {
    return ruleLabel
  }

  const intentSubject = usefulBlockLabel(block, inferWorkIntent(block).subject)
  if (intentSubject) {
    return intentSubject
  }

  return deterministicActivityLabel(block)
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

function dayTruthForBlocks(blocks: WorkContextBlock[]): {
  totalSeconds: number
  focusSeconds: number
  appCount: number
  siteDomains: Set<string>
} {
  const trusted = blocks.filter(isTrustedTimelineBlock)
  const totalSeconds = trusted.reduce((sum, block) => sum + blockActiveSeconds(block), 0)
  const focusSeconds = trusted.reduce(
    (sum, block) => sum + (FOCUSED_CATEGORIES.includes(block.dominantCategory) ? blockActiveSeconds(block) : 0),
    0,
  )
  const appIds = new Set<string>()
  const siteDomains = new Set<string>()
  for (const block of trusted) {
    for (const app of block.topApps) appIds.add(app.bundleId)
    for (const page of block.pageRefs) {
      const domain = page.domain ?? page.host
      if (domain) siteDomains.add(domain)
    }
    for (const domain of block.evidenceSummary.domains ?? []) {
      if (domain) siteDomains.add(domain)
    }
  }
  return { totalSeconds, focusSeconds, appCount: appIds.size, siteDomains }
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
  const truth = dayTruthForBlocks(blocks)
  const visibleWebsites = websites.filter((website) => truth.siteDomains.has(website.domain))

  return {
    date: dateStr,
    sessions,
    websites: visibleWebsites,
    blocks,
    segments,
    focusSessions,
    computedAt: Date.now(),
    version: TIMELINE_HEURISTIC_VERSION,
    totalSeconds: truth.totalSeconds,
    focusSeconds: truth.focusSeconds,
    focusPct: truth.totalSeconds > 0 ? Math.round((truth.focusSeconds / truth.totalSeconds) * 100) : 0,
    appCount: truth.appCount,
    siteCount: visibleWebsites.length,
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
  if (persistedDayHeuristicIsStale(db, dateStr)) return null
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
      review: {
        ...DEFAULT_TIMELINE_BLOCK_REVIEW,
        state: 'pending',
      },
      isLive: false,
    })
  }

  // Derive labels through the same finalizer as the timeline so recap surfaces
  // never show the stale "<x> development" strings either (see the persisted
  // loader). Grouping stays as persisted; only the label is recomputed.
  const finalizedBlocks = blocks.map((block) => finalizedLabelForBlock(db, block, dateStr))
  blocks.length = 0
  blocks.push(...finalizedBlocks)

  const focusSessions = getFocusSessionsForDateRange(db, fromMs, toMs)
  const segments = buildSegmentsForDay(db, dateStr, blocks)
  const truth = dayTruthForBlocks(blocks)
  const visibleWebsites = websitesForDay.filter((website) => truth.siteDomains.has(website.domain))

  return {
    date: dateStr,
    sessions,
    websites: visibleWebsites,
    blocks,
    segments,
    focusSessions,
    computedAt: Date.now(),
    version: TIMELINE_HEURISTIC_VERSION,
    totalSeconds: truth.totalSeconds,
    focusSeconds: truth.focusSeconds,
    focusPct: truth.totalSeconds > 0 ? Math.round((truth.focusSeconds / truth.totalSeconds) * 100) : 0,
    appCount: truth.appCount,
    siteCount: visibleWebsites.length,
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
    const payload = getTimelineDayPayload(db, persistedDate, liveSession, { materialize: false })
    const match = payload.blocks.find((block) => block.id === blockId)
    if (match) return match
  }

  for (let offset = 0; offset >= -30; offset--) {
    const dateStr = localDateStringForOffset(offset)
    if (dateStr === persistedDate) continue
    const payload = getTimelineDayPayload(db, dateStr, liveSession, { materialize: false })
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
  const [year, month, day] = today.split('-').map(Number)
  const fromDateStr = localDateString(new Date(year, month - 1, day - Math.max(0, days - 1)))

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

  const [, todayTo] = localDayBounds(today)
  const [year, month, day] = today.split('-').map(Number)
  const fromDate = localDateString(new Date(year, month - 1, day - Math.max(0, days - 1)))
  const [fromMs] = localDayBounds(fromDate)
  const rangeKey = isDate ? `1d:${today}` : `${days}d:${today}`

  const allSessions = mergeLiveSession(getSessionsForRange(db, fromMs, todayTo), liveSession)
  const sessions = allSessions.filter((session) => {
    const identity = resolveCanonicalApp(session.bundleId, session.appName)
    return (session.canonicalAppId ?? identity.canonicalAppId ?? session.bundleId) === canonicalAppId
  })

  const relevantDates = Array.from(new Set(sessions.map((session) => localDateKeyForTimestamp(session.startTime))))
  const historicalDates = relevantDates.filter((date) => !(date === today && liveSession))
  for (const date of historicalDates) {
    if (!persistedDayHeuristicIsStale(db, date) && validPersistedTimelineBlockCount(db, date) > 0) continue
    const [dayFrom, dayTo] = localDayBounds(date)
    buildTimelineBlocksForDay(db, date, getSessionsForRange(db, dayFrom, dayTo), { materialize: true })
  }
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
