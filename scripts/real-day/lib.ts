import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chooseUserDataPath } from '../../src/main/services/userData'
import {
  normalizeDayFixture,
  type PrivateDatabaseCopyDayFixture,
} from '../../tests/support/dayFixture'

export const REAL_DAY_SCHEMA_VERSION = 1
export const DEFAULT_PRIVATE_ROOT = path.join(os.homedir(), '.daylens-real-day')

export interface DayCandidate {
  date: string
  sessionCount: number
  activeSeconds: number
  appCount: number
  firstActivityMs: number
  lastActivityMs: number
}

export interface RealDayManifest extends PrivateDatabaseCopyDayFixture {
  input: {
    kind: 'private-database-copy'
    database: {
      relativePath: string
      sha256: string
    }
    privateReplay: {
      configRelativePath: string | null
      capturedAt: string
      source: {
        selector: 'production-user-data' | 'explicit'
        userDataPath: string
        databasePath: string
      }
    }
  }
  review: {
    state: 'draft' | 'accepted'
    reviewedAt?: string
    sourceHash: string
  }
  privacy: {
    localOnly: true
    ciAllowed: false
    containsRealUserData: true
  }
}

export interface ObservedEpisode {
  id: string
  startMs: number
  endMs: number
  activeSeconds: number
  label: string
  category: string
  kind: string | null
  apps: Array<{ name: string; seconds: number }>
  pages: string[]
}

export interface ObservedApp {
  id: string
  name: string
  category: string
  seconds: number
  sessionCount: number
}

export interface ObservedMeeting {
  source: 'calendar' | 'timeline' | 'apps'
  title: string
  start: string | null
  minutes: number
}

export interface RealDayObservation {
  schemaVersion: 1
  fixtureId: string
  evaluatedAt: string
  date: string
  sourceSha256: string
  capture: Record<string, number | string | null>
  timeline: {
    productionProjection: { version: string; totalSeconds: number; episodes: ObservedEpisode[] }
    directPayload: { version: string; totalSeconds: number; episodes: ObservedEpisode[] }
  }
  apps: { totalSeconds: number; items: ObservedApp[] }
  meetings: ObservedMeeting[]
  calendar: unknown
  search: Array<{ query: string; resultCount: number; kinds: string[]; topTitles: string[] }>
  memory: { activeFactCount: number; relevantFacts: string[]; promptExcerpt: string }
  aiFacts: { dayOverview: unknown; topAppUsage: unknown; historySearch: unknown }
  hours: Array<{
    hour: string
    capturedActiveSeconds: number
    timelineActiveSeconds: number
    missingFromTimelineSeconds: number
    capturedApps: Array<{ name: string; seconds: number }>
    titles: string[]
    pages: string[]
    blocks: string[]
  }>
  agreement: AgreementMetrics
}

export interface AgreementMetrics {
  timelineAppsDeltaSeconds: number
  aiTimelineDeltaSeconds: number
  projectionDirect: ComparisonMetrics
  acceptedBaseline: ComparisonMetrics | null
}

export interface ComparisonMetrics {
  missingActivity: number
  inventedActivity: number
  incorrectTimes: number
  incorrectDurations: number
  badGrouping: number
  incorrectLabels: number
  meetingMistakes: number
  appDisagreements: number
  searchDisagreements: number
  memoryDisagreements: number
  aiFactDisagreements: number
  totalDisagreements: number
  hourlyDisagreements: number
}

export interface AcceptedRealDay {
  schemaVersion: 1
  fixtureId: string
  date: string
  acceptedAt: string
  expected: RealDayObservation
  review: {
    decision: 'confirmed'
    notes: string
  }
}

export function assertLocalOnly(root: string, repoRoot = process.cwd()): void {
  if (process.env.CI) {
    throw new Error('Real-day commands are local-only and refuse to run in CI.')
  }
  const absoluteRoot = path.resolve(root)
  const absoluteRepo = path.resolve(repoRoot)
  if (absoluteRoot === absoluteRepo || absoluteRoot.startsWith(`${absoluteRepo}${path.sep}`)) {
    throw new Error(`Real-day private root must be outside the Git workspace: ${absoluteRoot}`)
  }
}

export function productionAppDataPath(platform = process.platform, env = process.env): string {
  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support')
  if (platform === 'win32') return env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
  return env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')
}

export function discoverProductionUserData(explicitPath?: string): {
  userDataPath: string
  selector: 'production-user-data' | 'explicit'
} {
  if (explicitPath) return { userDataPath: path.resolve(explicitPath), selector: 'explicit' }
  return {
    userDataPath: chooseUserDataPath(productionAppDataPath(), process.platform),
    selector: 'production-user-data',
  }
}

export function sha256File(filePath: string): string {
  const hash = createHash('sha256')
  const fd = fs.openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead = 0
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead > 0)
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

function localDate(ms: number): string {
  const value = new Date(ms)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

export function selectRecentCompleteDay(
  db: Database.Database,
  options: {
    beforeDate?: string
    minimumSeconds?: number
    minimumSessions?: number
    lookbackDays?: number
  } = {},
): DayCandidate {
  const beforeDate = options.beforeDate ?? localDate(Date.now())
  const minimumSeconds = options.minimumSeconds ?? 2 * 60 * 60
  const minimumSessions = options.minimumSessions ?? 20
  const lookbackDays = options.lookbackDays ?? 30
  const rows = db
    .prepare(
      `
    SELECT
      strftime('%Y-%m-%d', start_time / 1000, 'unixepoch', 'localtime') AS date,
      COUNT(*) AS sessionCount,
      CAST(SUM(MAX(0, duration_sec)) AS INTEGER) AS activeSeconds,
      COUNT(DISTINCT COALESCE(canonical_app_id, bundle_id)) AS appCount,
      MIN(start_time) AS firstActivityMs,
      MAX(COALESCE(end_time, start_time + duration_sec * 1000)) AS lastActivityMs
    FROM app_sessions
    WHERE start_time < strftime('%s', ?, 'localtime') * 1000
      AND start_time >= strftime('%s', ?, 'localtime', ?) * 1000
    GROUP BY date
    ORDER BY date DESC
  `,
    )
    .all(
      `${beforeDate} 00:00:00`,
      `${beforeDate} 00:00:00`,
      `-${lookbackDays} days`,
    ) as DayCandidate[]

  const candidate = rows.find(
    (row) => row.activeSeconds >= minimumSeconds && row.sessionCount >= minimumSessions,
  )
  if (!candidate) {
    const detail = rows
      .slice(0, 5)
      .map((row) => `${row.date}: ${row.sessionCount} sessions, ${row.activeSeconds}s`)
      .join('; ')
    throw new Error(
      `No complete pre-live day met the activity threshold. Recent candidates: ${detail || 'none'}`,
    )
  }
  return candidate
}

export async function createConsistentSnapshot(
  sourceDbPath: string,
  destinationDbPath: string,
): Promise<string> {
  const source = new Database(sourceDbPath, { readonly: true, fileMustExist: true })
  try {
    source.pragma('query_only = ON')
    fs.mkdirSync(path.dirname(destinationDbPath), { recursive: true, mode: 0o700 })
    await source.backup(destinationDbPath)
  } finally {
    source.close()
  }
  fs.chmodSync(destinationDbPath, 0o600)
  return sha256File(destinationDbPath)
}

export function copyConfigIfPresent(
  sourceUserData: string,
  destinationUserData: string,
): string | null {
  const source = path.join(sourceUserData, 'config.json')
  if (!fs.existsSync(source)) return null
  const destination = path.join(destinationUserData, 'config.json')
  fs.copyFileSync(source, destination)
  fs.chmodSync(destination, 0o600)
  return destination
}

export function fixtureDirectory(root: string, date: string): string {
  return path.join(root, date)
}

export function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

export function loadRealDayManifest(filePath: string): RealDayManifest {
  const fixture = normalizeDayFixture(loadJson<unknown>(filePath), filePath)
  if (fixture.input.kind !== 'private-database-copy') {
    throw new Error(`Real-day manifest must use private-database-copy input: ${filePath}`)
  }
  return fixture as RealDayManifest
}

export function writePrivateJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(filePath, 0o600)
}

export function prepareWorkingCopy(fixtureDir: string): string {
  const pristine = path.join(fixtureDir, 'pristine')
  const working = path.join(fixtureDir, 'work', 'userData')
  fs.rmSync(path.dirname(working), { recursive: true, force: true })
  fs.mkdirSync(working, { recursive: true, mode: 0o700 })
  fs.copyFileSync(path.join(pristine, 'daylens.sqlite'), path.join(working, 'daylens.sqlite'))
  const config = path.join(pristine, 'config.json')
  if (fs.existsSync(config)) fs.copyFileSync(config, path.join(working, 'config.json'))
  return working
}

function overlapMs(left: ObservedEpisode, right: ObservedEpisode): number {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs))
}

function normalizedLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? String(value)
}

export function compareObservations(
  expected: RealDayObservation,
  actual: RealDayObservation,
): ComparisonMetrics {
  const expectedEpisodes = expected.timeline.productionProjection.episodes
  const actualEpisodes = actual.timeline.productionProjection.episodes
  const remaining = new Set(actualEpisodes.map((_, index) => index))
  let missingActivity = 0
  let incorrectTimes = 0
  let incorrectDurations = 0
  let incorrectLabels = 0

  for (const episode of expectedEpisodes) {
    let bestIndex = -1
    let bestOverlap = 0
    for (const index of remaining) {
      const overlap = overlapMs(episode, actualEpisodes[index])
      if (overlap > bestOverlap) {
        bestIndex = index
        bestOverlap = overlap
      }
    }
    if (bestIndex < 0 || bestOverlap < Math.min(episode.endMs - episode.startMs, 5 * 60_000) / 2) {
      missingActivity += 1
      continue
    }
    remaining.delete(bestIndex)
    const match = actualEpisodes[bestIndex]
    if (episode.startMs !== match.startMs || episode.endMs !== match.endMs) incorrectTimes += 1
    if (episode.activeSeconds !== match.activeSeconds) incorrectDurations += 1
    if (normalizedLabel(episode.label) !== normalizedLabel(match.label)) incorrectLabels += 1
  }

  const expectedMeetings = expected.meetings.map(
    (meeting) =>
      `${meeting.source}:${normalizedLabel(meeting.title)}:${meeting.start ?? ''}:${meeting.minutes}`,
  )
  const actualMeetings = new Set(
    actual.meetings.map(
      (meeting) =>
        `${meeting.source}:${normalizedLabel(meeting.title)}:${meeting.start ?? ''}:${meeting.minutes}`,
    ),
  )
  const meetingMistakes =
    expectedMeetings.filter((meeting) => !actualMeetings.has(meeting)).length +
    Math.max(0, actual.meetings.length - expected.meetings.length)

  const actualApps = new Map(actual.apps.items.map((app) => [app.id, app]))
  let appDisagreements = 0
  for (const expectedApp of expected.apps.items) {
    const actualApp = actualApps.get(expectedApp.id)
    if (
      !actualApp ||
      actualApp.seconds !== expectedApp.seconds ||
      actualApp.category !== expectedApp.category
    )
      appDisagreements += 1
    actualApps.delete(expectedApp.id)
  }
  appDisagreements += actualApps.size

  const searchDisagreements =
    canonicalJson(expected.search) === canonicalJson(actual.search) ? 0 : 1
  const memoryDisagreements =
    canonicalJson(expected.memory) === canonicalJson(actual.memory) ? 0 : 1
  const aiFactDisagreements =
    canonicalJson(expected.aiFacts) === canonicalJson(actual.aiFacts) ? 0 : 1
  const expectedTotals = {
    projection: expected.timeline.productionProjection.totalSeconds,
    direct: expected.timeline.directPayload?.totalSeconds,
    apps: expected.apps.totalSeconds,
    timelineAppsDelta: expected.agreement?.timelineAppsDeltaSeconds,
    aiTimelineDelta: expected.agreement?.aiTimelineDeltaSeconds,
  }
  const actualTotals = {
    projection: actual.timeline.productionProjection.totalSeconds,
    direct: actual.timeline.directPayload?.totalSeconds,
    apps: actual.apps.totalSeconds,
    timelineAppsDelta: actual.agreement?.timelineAppsDeltaSeconds,
    aiTimelineDelta: actual.agreement?.aiTimelineDeltaSeconds,
  }
  const totalDisagreements = Object.keys(expectedTotals).filter(
    (key) =>
      expectedTotals[key as keyof typeof expectedTotals] !==
      actualTotals[key as keyof typeof actualTotals],
  ).length
  const hourlyDisagreements = canonicalJson(expected.hours) === canonicalJson(actual.hours) ? 0 : 1

  return {
    missingActivity,
    inventedActivity: remaining.size,
    incorrectTimes,
    incorrectDurations,
    badGrouping: Math.abs(expectedEpisodes.length - actualEpisodes.length),
    incorrectLabels,
    meetingMistakes,
    appDisagreements,
    searchDisagreements,
    memoryDisagreements,
    aiFactDisagreements,
    totalDisagreements,
    hourlyDisagreements,
  }
}

export function comparisonHasChanges(metrics: ComparisonMetrics): boolean {
  return Object.values(metrics).some((value) => value !== 0)
}

export function comparisonFailureLines(metrics: ComparisonMetrics): string[] {
  const labels: Record<keyof ComparisonMetrics, string> = {
    missingActivity: 'expected Timeline episodes missing',
    inventedActivity: 'unexpected Timeline episodes added',
    incorrectTimes: 'Timeline episode boundary changes',
    incorrectDurations: 'Timeline episode duration changes',
    badGrouping: 'Timeline grouping count changes',
    incorrectLabels: 'Timeline label changes',
    meetingMistakes: 'calendar/meeting changes',
    appDisagreements: 'Apps item changes',
    searchDisagreements: 'search result changes',
    memoryDisagreements: 'memory fact/context changes',
    aiFactDisagreements: 'AI-facing tool fact changes',
    totalDisagreements: 'Timeline/Apps/AI total or delta changes',
    hourlyDisagreements: 'hour-by-hour reconstruction changes',
  }
  return (Object.entries(metrics) as Array<[keyof ComparisonMetrics, number]>)
    .filter(([, count]) => count !== 0)
    .map(([key, count]) => `${count} ${labels[key]}`)
}

export function acceptReviewedCandidate(
  reviewPath: string,
  baselinePath: string,
  options: { confirmed: boolean; now?: Date } = { confirmed: false },
): AcceptedRealDay {
  if (!options.confirmed) throw new Error('Acceptance requires the explicit --confirmed flag.')
  const review = loadJson<{
    decision?: string
    notes?: string
    candidate?: RealDayObservation
  }>(reviewPath)
  if (review.decision !== 'confirmed') {
    throw new Error('Acceptance requires review.json decision to be exactly "confirmed".')
  }
  if (!review.candidate?.fixtureId || !review.candidate.date) {
    throw new Error('review.json does not contain a complete candidate observation.')
  }
  const accepted: AcceptedRealDay = {
    schemaVersion: REAL_DAY_SCHEMA_VERSION,
    fixtureId: review.candidate.fixtureId,
    date: review.candidate.date,
    acceptedAt: (options.now ?? new Date()).toISOString(),
    expected: review.candidate,
    review: { decision: 'confirmed', notes: review.notes?.trim() ?? '' },
  }
  writePrivateJson(baselinePath, accepted)
  return accepted
}
