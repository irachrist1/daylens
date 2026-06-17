import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCHEMA_SQL } from '../../src/main/db/schema.ts'
import { getAppSummariesForRange } from '../../src/main/db/queries.ts'
import { resolveCanonicalApp } from '../../src/main/lib/appIdentity.ts'
import { executeTool } from '../../src/main/services/aiTools.ts'
import { getAppDetailPayload, getBlockDetailPayload, getTimelineDayPayload, userVisibleLabelForBlock } from '../../src/main/services/workBlocks.ts'
import { buildFallbackNarrative, buildWrappedFactsFromPayload, computeFactsHash, type WrappedFacts } from '../../src/main/lib/wrappedNarrative.ts'
import { buildRecapSummaries } from '../../src/renderer/lib/recap.ts'
import { inferWorkIntent } from '../../src/shared/workIntent.ts'
import { effectiveBlockKind, kindForDomain, type WorkKind } from '../../src/shared/workKind.ts'
import { blockActiveSeconds } from '../../src/shared/blockDuration.ts'
import { isTrustedTimelineBlock } from '../../src/shared/timelineReview.ts'
import type { AppCategory, DayTimelinePayload, WorkContextBlock, WorkIntentRole } from '../../src/shared/types.ts'

type WrappedQuality = 'empty' | 'tooEarly' | 'partial' | 'full'
type Phase0CheckId =
  | 'dogfood'
  | 'segmentation'
  | 'duration'
  | 'kind-tag'
  | 'gap-reasons'
  | 'system-noise'
  | 'apps'
  | 'week-consistency'

interface FixtureSession {
  date?: string
  start: string
  end: string
  bundleId: string
  appName: string
  category: AppCategory
  title?: string | null
}

interface FixtureBrowserEvidence {
  date?: string
  at: string
  durationMinutes?: number
  durationSeconds?: number
  browserBundleId?: string | null
  canonicalBrowserId?: string | null
  domain: string
  url: string
  title?: string | null
}

interface FixtureActivityEvent {
  date?: string
  at: string
  type: string
}

interface ExpectedEpisode {
  date?: string
  id: string
  start: string
  end: string
  label: string
  labelIncludes?: string[]
  category?: AppCategory
  kind?: WorkKind
  intentRole?: WorkIntentRole
  intentSubjectIncludes?: string[]
}

interface ExpectedWrap {
  quality?: WrappedQuality
  dominantCategory?: AppCategory | 'unknown'
  topAppIncludes?: string
  topDomain?: string
  /** A subject/label the "what mattered" spine should name. */
  matteredSubjectIncludes?: string
  /** Exact number of pending blocks the wrap should report as needing review. */
  needsReviewCount?: number
  /** A subject the "carries into tomorrow" spine should name. */
  carryoverSubjectIncludes?: string
}

interface ExpectedDayTotals {
  date?: string
  trackedMinutes?: number
  workMinutes?: number
  leisureMinutes?: number
  toleranceMinutes?: number
  maxBlockCount?: number
  minMaterialBlockMinutes?: number
  forbiddenTopApps?: string[]
  forbiddenLabels?: string[]
  forbiddenMatteredIncludes?: string[]
  forbiddenCarryoverIncludes?: string[]
}

interface ExpectedWeek {
  startDate: string
  endDate: string
  trackedMinutes: number
  toleranceMinutes?: number
  dailyTrackedMinutes?: Array<{ date: string; minutes: number }>
  forbiddenTopApps?: string[]
}

interface ExpectedGap {
  start: string
  end: string
  reason: 'idle' | 'away' | 'machine_off' | 'paused' | 'permission_limited' | 'no_samples'
}

interface ExpectedSystemNoise {
  sentinelAppNames: string[]
}

interface TimelineFixture {
  id: string
  name: string
  date: string
  description?: string
  expectedToFailOnCurrentMain?: boolean
  phase0Checks?: Phase0CheckId[]
  truthSources?: string[]
  sessions: FixtureSession[]
  browserEvidence?: FixtureBrowserEvidence[]
  activityEvents?: FixtureActivityEvent[]
  expectedEpisodes: ExpectedEpisode[]
  expectedGaps?: ExpectedGap[]
  expectedSystemNoise?: ExpectedSystemNoise
  expectedWrap?: ExpectedWrap
  expectedDay?: ExpectedDayTotals
  expectedWeek?: ExpectedWeek
}

interface ActualBlock {
  index: number
  block: WorkContextBlock
  label: string
  kind: WorkKind
  role: WorkIntentRole
  subject: string | null
  startTime: number
  endTime: number
  startReasons: string[]
  endReasons: string[]
}

interface EpisodeResult {
  expected: ExpectedEpisode
  startTime: number
  endTime: number
  overlaps: Array<{ actual: ActualBlock; overlapMs: number }>
  primary: ActualBlock | null
  boundaryOk: boolean
  labelOk: boolean
  categoryOk: boolean
  kindOk: boolean
  roleOk: boolean
  subjectOk: boolean
  notes: string[]
}

interface Phase0Assertion {
  id: Phase0CheckId
  name: string
  evidenceCount: number
  issues: string[]
}

interface FixtureResult {
  fixture: TimelineFixture
  payload: DayTimelinePayload
  actualBlocks: ActualBlock[]
  episodes: EpisodeResult[]
  overSplits: EpisodeResult[]
  underSplits: Array<{ actual: ActualBlock; expectedIds: string[] }>
  extras: ActualBlock[]
  wrapIssues: string[]
  dayIssues: string[]
  weekIssues: string[]
  unsupportedWrapClaims: string[]
  wrapGroundingIssues: string[]
  boundaryIssues: string[]
  designIssues: string[]
  phase0Assertions: Phase0Assertion[]
  scores: {
    segmentationPassed: number
    segmentationTotal: number
    labelsPassed: number
    labelsTotal: number
    rolesPassed: number
    rolesTotal: number
    wrapsPassed: number
    wrapsTotal: number
    dayPassed: number
    dayTotal: number
    weekPassed: number
    weekTotal: number
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.join(HERE, 'fixtures')
const BASELINE_PATH = path.join(HERE, 'baseline.md')
const BOUNDARY_TOLERANCE_MS = 5 * 60_000

interface LocalDateParts {
  year: number
  month: number
  day: number
}

function parseLocalDateParts(dateStr: string): LocalDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) throw new Error(`Invalid fixture date "${dateStr}"`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid fixture date "${dateStr}"`)
  }
  if (month < 1 || month > 12) throw new Error(`Invalid fixture date "${dateStr}": month out of range`)
  const maxDay = new Date(year, month, 0).getDate()
  if (day < 1 || day > maxDay) throw new Error(`Invalid fixture date "${dateStr}": day out of range`)
  return { year, month, day }
}

function msForClock(dateStr: string, clock: string): number {
  const parts = clock.split(':')
  if (parts.length !== 2 && parts.length !== 3) throw new Error(`Invalid fixture clock "${clock}"`)
  const [hourRaw, minuteRaw, secondRaw = '0'] = parts
  const hour = Number(hourRaw)
  const minute = Number(minuteRaw)
  const second = Number(secondRaw)
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)) {
    throw new Error(`Invalid fixture clock "${clock}"`)
  }
  if (hour < 0 || hour > 23) throw new Error(`Invalid fixture clock "${clock}": hour out of range`)
  if (minute < 0 || minute > 59) throw new Error(`Invalid fixture clock "${clock}": minute out of range`)
  if (second < 0 || second > 59) throw new Error(`Invalid fixture clock "${clock}": second out of range`)
  const { year, month, day } = parseLocalDateParts(dateStr)
  return new Date(year, month - 1, day, hour, minute, second, 0).getTime()
}

function localDateMs(dateStr: string): number {
  const { year, month, day } = parseLocalDateParts(dateStr)
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
}

function shiftDateString(dateStr: string, days: number): string {
  const next = new Date(localDateMs(dateStr))
  next.setDate(next.getDate() + days)
  const year = next.getFullYear()
  const month = String(next.getMonth() + 1).padStart(2, '0')
  const day = String(next.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  for (let date = startDate; date <= endDate; date = shiftDateString(date, 1)) {
    dates.push(date)
  }
  return dates
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatRange(startTime: number, endTime: number): string {
  return `${formatClock(startTime)}-${formatClock(endTime)}`
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function containsAny(value: string | null | undefined, expected: string[]): boolean {
  const normalizedValue = normalizeText(value)
  return expected.some((candidate) => {
    const normalizedCandidate = normalizeText(candidate)
    if (!normalizedCandidate) return false
    return ` ${normalizedValue} `.includes(` ${normalizedCandidate} `)
  })
}

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

function createDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  return db
}

function seedFixture(db: Database.Database, fixture: TimelineFixture): void {
  const insertSession = db.prepare(`
    INSERT INTO app_sessions (
      bundle_id,
      app_name,
      start_time,
      end_time,
      duration_sec,
      category,
      is_focused,
      window_title,
      raw_app_name,
      canonical_app_id,
      app_instance_id,
      capture_source,
      ended_reason,
      capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'timeline_eval_fixture', NULL, 2)
  `)

  for (const session of fixture.sessions) {
    const sessionDate = session.date ?? fixture.date
    const startTime = msForClock(sessionDate, session.start)
    const endTime = msForClock(sessionDate, session.end)
    const identity = resolveCanonicalApp(session.bundleId, session.appName)
    insertSession.run(
      session.bundleId,
      session.appName,
      startTime,
      endTime,
      Math.max(1, Math.round((endTime - startTime) / 1000)),
      session.category,
      session.title ?? null,
      session.appName,
      identity.canonicalAppId ?? session.bundleId,
      session.bundleId,
    )
  }

  const insertVisit = db.prepare(`
    INSERT INTO website_visits (
      domain,
      page_title,
      url,
      visit_time,
      visit_time_us,
      duration_sec,
      browser_bundle_id,
      canonical_browser_id,
      normalized_url,
      page_key,
      source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'timeline_eval_fixture')
  `)

  for (const [index, visit] of (fixture.browserEvidence ?? []).entries()) {
    const visitDate = visit.date ?? fixture.date
    const visitTime = msForClock(visitDate, visit.at)
    const durationSeconds = visit.durationSeconds ?? Math.round((visit.durationMinutes ?? 1) * 60)
    insertVisit.run(
      visit.domain,
      visit.title ?? null,
      visit.url,
      visitTime,
      visitTime * 1000 + index,
      durationSeconds,
      visit.browserBundleId ?? null,
      visit.canonicalBrowserId ?? visit.browserBundleId ?? null,
      visit.url,
      visit.url,
    )
  }

  const insertEvent = db.prepare(`
    INSERT INTO activity_state_events (event_ts, event_type, source, metadata_json)
    VALUES (?, ?, 'timeline_eval_fixture', '{}')
  `)
  for (const event of fixture.activityEvents ?? []) {
    insertEvent.run(msForClock(event.date ?? fixture.date, event.at), event.type)
  }
}

function assertFounderFixturePrivacy(file: string, raw: string): void {
  if (!file.startsWith('founder-real-')) return
  const forbidden: Array<[string, RegExp]> = [
    ['founder identity', /\b(?:christian\s+tonny|irachrist1|tonny)\b/i],
    ['email address', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
    ['local user path', /(?:\/Users\/|[A-Za-z]:\\Users\\)/i],
    ['private IP address', /\b(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2,3}\b/i],
    ['private Slack workspace', /[a-z0-9-]+\.slack\.com/i],
    ['raw account or mail host', /"(?:domain|url)":\s*"[^"]*(?:accounts?|auth|calendar|login|mail|outlook|passwords)\.(?!example\b)/i],
  ]
  const violations = forbidden.filter(([, pattern]) => pattern.test(raw)).map(([label]) => label)
  if (violations.length > 0) {
    throw new Error(`Unsafe founder fixture ${file}: ${violations.join(', ')}`)
  }
}

const FOUNDER_SAFE_DOMAINS = new Set([
  'chatgpt.com',
  'claude.ai',
  'cursor.com',
  'docs.google.com',
  'figma.com',
  'github.com',
  'linear.app',
  'meet.google.com',
  'netflix.com',
  'nextdns.io',
  'notion.so',
  'reddit.com',
  'slack.com',
  'starlink.com',
  'x.com',
  'youtube.com',
])
const FOUNDER_SAFE_TITLE_TERMS = [
  'ChatGPT',
  'Claude',
  'Cursor',
  'Daylens',
  'Figma',
  'GitHub',
  'Google Meet',
  'Linear',
  'Machine Learning Pipeline',
  'Netflix',
  'NextDNS',
  'Notion',
  'Reddit',
  'Slack',
  'Starlink',
  'YouTube',
]

function isSafeFounderTitle(value: string | null | undefined): boolean {
  if (!value) return true
  if (/^\[redacted page on [a-z0-9.-]+\]$/.test(value)) return true
  const terms = value.split(' + ')
  return terms.length > 0 && terms.every((term) => FOUNDER_SAFE_TITLE_TERMS.includes(term))
}

function assertFounderFixtureStructure(file: string, fixture: TimelineFixture): void {
  if (!file.startsWith('founder-real-')) return
  for (const session of fixture.sessions) {
    if (/[\\/]/.test(session.bundleId)) {
      throw new Error(`Unsafe founder fixture ${file}: raw app path in bundleId`)
    }
    if (!isSafeFounderTitle(session.title)) {
      throw new Error(`Unsafe founder fixture ${file}: unapproved session title "${session.title}"`)
    }
  }
  for (const visit of fixture.browserEvidence ?? []) {
    const domain = visit.domain.toLowerCase()
    if (!FOUNDER_SAFE_DOMAINS.has(domain) && !domain.endsWith('.example')) {
      throw new Error(`Unsafe founder fixture ${file}: unapproved domain "${visit.domain}"`)
    }
    if (!isSafeFounderTitle(visit.title)) {
      throw new Error(`Unsafe founder fixture ${file}: unapproved page title "${visit.title}"`)
    }
    const url = new URL(visit.url)
    if (url.hostname !== domain || !url.pathname.startsWith('/daylens-fixture/')) {
      throw new Error(`Unsafe founder fixture ${file}: URL is not a fixture placeholder`)
    }
  }
}

function loadFixtures(): TimelineFixture[] {
  return fs.readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const raw = fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8')
      assertFounderFixturePrivacy(file, raw)
      const fixture = JSON.parse(raw) as TimelineFixture
      if (!fixture.id || !fixture.name || !fixture.date || fixture.expectedEpisodes.length === 0) {
        throw new Error(`Invalid timeline eval fixture ${file}`)
      }
      for (const expected of fixture.expectedEpisodes) {
        if (expected.date && expected.date !== fixture.date) {
          throw new Error(`Invalid timeline eval fixture ${file}: expectedEpisodes[].date must match fixture.date; split multi-day expected timelines into separate fixtures.`)
        }
      }
      assertFounderFixtureStructure(file, fixture)
      return fixture
    })
}

function actualBlocksFor(payload: DayTimelinePayload): ActualBlock[] {
  return payload.blocks.map((block, index) => {
    const intent = inferWorkIntent(block)
    return {
      index,
      block,
      label: userVisibleLabelForBlock(block),
      kind: effectiveBlockKind(block),
      role: intent.role,
      subject: intent.subject,
      startTime: block.startTime,
      endTime: block.endTime,
      startReasons: block.boundary?.startReasons ?? [],
      endReasons: block.boundary?.endReasons ?? [],
    }
  })
}

function evaluateEpisodes(fixture: TimelineFixture, actualBlocks: ActualBlock[]): EpisodeResult[] {
  return fixture.expectedEpisodes.map((expected) => {
    const episodeDate = expected.date ?? fixture.date
    const startTime = msForClock(episodeDate, expected.start)
    const endTime = msForClock(episodeDate, expected.end)
    const overlaps = actualBlocks
      .map((actual) => ({ actual, overlapMs: overlapMs(startTime, endTime, actual.startTime, actual.endTime) }))
      .filter((entry) => entry.overlapMs > 0)
      .sort((left, right) => right.overlapMs - left.overlapMs)
    const primary = overlaps[0]?.actual ?? null
    const notes: string[] = []

    const boundaryOk = Boolean(
      primary
      && Math.abs(primary.startTime - startTime) <= BOUNDARY_TOLERANCE_MS
      && Math.abs(primary.endTime - endTime) <= BOUNDARY_TOLERANCE_MS,
    )
    if (!primary) {
      notes.push('missing actual block')
    } else if (!boundaryOk) {
      notes.push(`boundary ${formatRange(primary.startTime, primary.endTime)}`)
    }

    if (overlaps.length > 1) {
      notes.push(`over-split into ${overlaps.length} blocks`)
    }

    const labelTerms = expected.labelIncludes ?? [expected.label]
    const labelOk = primary ? containsAny(primary.label, labelTerms) : false
    if (primary && !labelOk) notes.push(`label "${primary.label}"`)

    const categoryOk = !expected.category || (primary ? primary.block.dominantCategory === expected.category : false)
    if (primary && expected.category && !categoryOk) {
      notes.push(`category ${primary.block.dominantCategory}`)
    }

    const kindOk = !expected.kind || (primary ? primary.kind === expected.kind : false)
    if (primary && expected.kind && !kindOk) {
      notes.push(`kind ${primary.kind}, expected ${expected.kind}`)
    }

    const roleOk = !expected.intentRole || (primary ? primary.role === expected.intentRole : false)
    if (primary && expected.intentRole && !roleOk) notes.push(`role ${primary.role}`)

    const subjectTerms = expected.intentSubjectIncludes ?? []
    const subjectOk = subjectTerms.length === 0 || (primary ? containsAny(primary.subject, subjectTerms) : false)
    if (primary && subjectTerms.length > 0 && !subjectOk) {
      notes.push(`subject ${primary.subject ?? 'null'}`)
    }

    return {
      expected,
      startTime,
      endTime,
      overlaps,
      primary,
      boundaryOk,
      labelOk,
      categoryOk,
      kindOk,
      roleOk,
      subjectOk,
      notes,
    }
  })
}

function minutesClose(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance
}

function dayPayloadMinutes(payload: DayTimelinePayload): number {
  return Math.round(payload.blocks.reduce((sum, block) => sum + blockActiveSeconds(block), 0) / 60)
}

function evaluateExpectedDay(fixture: TimelineFixture, payload: DayTimelinePayload, actualBlocks: ActualBlock[]): string[] {
  const expected = fixture.expectedDay
  if (!expected) return []
  const issues: string[] = []
  const tolerance = expected.toleranceMinutes ?? 15
  const targetDate = expected.date ?? fixture.date

  if (targetDate !== fixture.date) {
    issues.push(`expectedDay.date ${targetDate} does not match fixture.date ${fixture.date}`)
  }

  const trackedMinutes = dayPayloadMinutes(payload)
  if (expected.trackedMinutes != null && !minutesClose(trackedMinutes, expected.trackedMinutes, tolerance)) {
    issues.push(`tracked ${trackedMinutes}m, expected ${expected.trackedMinutes}m ±${tolerance}m`)
  }

  const kindSeconds = actualBlocks.reduce<Record<WorkKind, number>>((acc, actual) => {
    acc[actual.kind] = (acc[actual.kind] ?? 0) + blockActiveSeconds(actual.block)
    return acc
  }, { work: 0, leisure: 0, personal: 0, idle: 0 })
  const kindMinutes: Record<WorkKind, number> = {
    work: Math.round(kindSeconds.work / 60),
    leisure: Math.round(kindSeconds.leisure / 60),
    personal: Math.round(kindSeconds.personal / 60),
    idle: Math.round(kindSeconds.idle / 60),
  }
  if (expected.workMinutes != null && !minutesClose(kindMinutes.work, expected.workMinutes, tolerance)) {
    issues.push(`work ${kindMinutes.work}m, expected ${expected.workMinutes}m ±${tolerance}m`)
  }
  if (expected.leisureMinutes != null && !minutesClose(kindMinutes.leisure, expected.leisureMinutes, tolerance)) {
    issues.push(`leisure ${kindMinutes.leisure}m, expected ${expected.leisureMinutes}m ±${tolerance}m`)
  }

  if (expected.maxBlockCount != null && actualBlocks.length > expected.maxBlockCount) {
    issues.push(`block count ${actualBlocks.length}, expected <= ${expected.maxBlockCount}`)
  }

  if (expected.minMaterialBlockMinutes != null) {
    for (const actual of actualBlocks) {
      const minutes = Math.round(blockActiveSeconds(actual.block) / 60)
      if (minutes > 0 && minutes < expected.minMaterialBlockMinutes) {
        issues.push(`material block ${formatRange(actual.startTime, actual.endTime)} is ${minutes}m, expected >= ${expected.minMaterialBlockMinutes}m`)
      }
    }
  }

  for (const forbidden of expected.forbiddenTopApps ?? []) {
    const found = actualBlocks.some((actual) =>
      actual.block.topApps.some((app) => containsAny(app.appName, [forbidden])))
    if (found) issues.push(`forbidden app appears in top apps: ${forbidden}`)
  }

  for (const forbidden of expected.forbiddenLabels ?? []) {
    const found = actualBlocks.some((actual) => containsAny(actual.label, [forbidden]))
    if (found) issues.push(`forbidden label appears: ${forbidden}`)
  }

  if ((expected.forbiddenMatteredIncludes?.length ?? 0) > 0 || (expected.forbiddenCarryoverIncludes?.length ?? 0) > 0) {
    const facts = buildWrappedFactsFromPayload(payload)
    for (const forbidden of expected.forbiddenMatteredIncludes ?? []) {
      const found = facts.mattered.some((item) =>
        containsAny(item.label, [forbidden]) || containsAny(item.intentSubject, [forbidden]))
      if (found) issues.push(`forbidden mattered item appears: ${forbidden}`)
    }
    for (const forbidden of expected.forbiddenCarryoverIncludes ?? []) {
      const found = facts.carryover.some((item) =>
        containsAny(item.label, [forbidden]) || containsAny(item.intentSubject, [forbidden]))
      if (found) issues.push(`forbidden carryover item appears: ${forbidden}`)
    }
  }

  return issues
}

function evaluateExpectedWeek(db: Database.Database, fixture: TimelineFixture): string[] {
  const expected = fixture.expectedWeek
  if (!expected) return []
  const issues: string[] = []
  const tolerance = expected.toleranceMinutes ?? 15
  const expectedByDate = new Map((expected.dailyTrackedMinutes ?? []).map((entry) => [entry.date, entry.minutes]))
  let weekTotal = 0
  const topAppNames = new Set<string>()

  for (const date of dateRange(expected.startDate, expected.endDate)) {
    const payload = getTimelineDayPayload(db, date, null, { materialize: false })
    const minutes = dayPayloadMinutes(payload)
    weekTotal += minutes
    for (const block of payload.blocks) {
      for (const app of block.topApps) topAppNames.add(app.appName)
    }

    if (expectedByDate.size > 0) {
      const expectedMinutes = expectedByDate.get(date)
      if (expectedMinutes == null) {
        issues.push(`missing expected daily total for ${date}`)
      } else if (!minutesClose(minutes, expectedMinutes, tolerance)) {
        issues.push(`${date} tracked ${minutes}m, expected ${expectedMinutes}m ±${tolerance}m`)
      }
    }
  }

  if (!minutesClose(weekTotal, expected.trackedMinutes, tolerance)) {
    issues.push(`week tracked ${weekTotal}m, expected ${expected.trackedMinutes}m ±${tolerance}m`)
  }

  if (expected.dailyTrackedMinutes) {
    const dailyExpectedTotal = expected.dailyTrackedMinutes.reduce((sum, entry) => sum + entry.minutes, 0)
    if (!minutesClose(dailyExpectedTotal, expected.trackedMinutes, tolerance)) {
      issues.push(`expected daily total ${dailyExpectedTotal}m does not match expected week ${expected.trackedMinutes}m ±${tolerance}m`)
    }
  }

  for (const forbidden of expected.forbiddenTopApps ?? []) {
    if ([...topAppNames].some((appName) => containsAny(appName, [forbidden]))) {
      issues.push(`forbidden app appears in week top apps: ${forbidden}`)
    }
  }

  return issues
}

function findUnderSplits(fixture: TimelineFixture, actualBlocks: ActualBlock[]): Array<{ actual: ActualBlock; expectedIds: string[] }> {
  return actualBlocks
    .map((actual) => {
      const expectedIds = fixture.expectedEpisodes
        .filter((expected) => {
          const startTime = msForClock(fixture.date, expected.start)
          const endTime = msForClock(fixture.date, expected.end)
          return overlapMs(actual.startTime, actual.endTime, startTime, endTime) > 0
        })
        .map((expected) => expected.id)
      return { actual, expectedIds }
    })
    .filter((entry) => entry.expectedIds.length > 1)
}

function findExtras(fixture: TimelineFixture, actualBlocks: ActualBlock[]): ActualBlock[] {
  return actualBlocks.filter((actual) => {
    return !fixture.expectedEpisodes.some((expected) => {
      const startTime = msForClock(fixture.date, expected.start)
      const endTime = msForClock(fixture.date, expected.end)
      return overlapMs(actual.startTime, actual.endTime, startTime, endTime) > 0
    })
  })
}

function wrappedTexts(payload: DayTimelinePayload): string[] {
  const facts = buildWrappedFactsFromPayload(payload)
  const narrative = buildFallbackNarrative(facts, computeFactsHash(facts))
  return [
    narrative.lead,
    narrative.peakInsight,
    narrative.nudge,
    ...Object.values(narrative.slides),
  ].filter((line): line is string => Boolean(line))
}

function unsupportedWrapClaims(payload: DayTimelinePayload): string[] {
  const facts = buildWrappedFactsFromPayload(payload)
  const allowedDomain = facts.topDomain?.domain.toLowerCase().replace(/^www\./, '') ?? null
  const issues: string[] = []

  // An hour figure is grounded if it matches total tracked OR any reconciled
  // kind sub-total (a breakdown card legitimately says "Leisure 3h 51m"). Only
  // numbers matching none of these are invented.
  const kb = facts.kindBreakdown
  const allowedHours = [
    facts.totalSeconds,
    kb.work, kb.leisure, kb.personal,
    facts.peakBlock?.durationSeconds ?? 0,
    ...facts.mattered.map((m) => m.durationSeconds),
    ...facts.needsReview.items.map((i) => i.durationSeconds),
  ]
    .filter((s) => s > 0)
    .map((s) => s / 3600)

  for (const text of wrappedTexts(payload)) {
    const domainMatches = text.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|io|dev|app|net|ai|co))\b/gi) ?? []
    for (const match of domainMatches) {
      const normalized = match.toLowerCase().replace(/^www\./, '')
      if (allowedDomain && normalized === allowedDomain) continue
      issues.push(`untracked domain "${match}" in "${text}"`)
    }

    const hourMatches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b)/gi)]
    for (const match of hourMatches) {
      const claimed = Number(match[1])
      if (!Number.isFinite(claimed)) continue
      if (!allowedHours.some((hours) => Math.abs(claimed - hours) <= 1.05)) {
        issues.push(`unsupported hour claim "${match[0]}" in "${text}"`)
      }
    }
  }

  return issues
}

function evaluateWrap(fixture: TimelineFixture, payload: DayTimelinePayload): string[] {
  const expected = fixture.expectedWrap
  if (!expected) return []
  const facts = buildWrappedFactsFromPayload(payload)
  const issues: string[] = []

  if (expected.quality && facts.quality !== expected.quality) {
    issues.push(`quality ${facts.quality}, expected ${expected.quality}`)
  }
  if (expected.dominantCategory && facts.dominantCategory !== expected.dominantCategory) {
    issues.push(`dominantCategory ${facts.dominantCategory}, expected ${expected.dominantCategory}`)
  }
  if (expected.topAppIncludes && !containsAny(facts.topApp?.appName, [expected.topAppIncludes])) {
    issues.push(`topApp ${facts.topApp?.appName ?? 'null'}, expected ${expected.topAppIncludes}`)
  }
  if (expected.topDomain && facts.topDomain?.domain !== expected.topDomain) {
    issues.push(`topDomain ${facts.topDomain?.domain ?? 'null'}, expected ${expected.topDomain}`)
  }
  if (expected.matteredSubjectIncludes) {
    const found = facts.mattered.some((m) =>
      containsAny(m.intentSubject, [expected.matteredSubjectIncludes!])
      || containsAny(m.label, [expected.matteredSubjectIncludes!]))
    if (!found) {
      const got = facts.mattered.map((m) => m.intentSubject ?? m.label).join(' | ') || 'none'
      issues.push(`mattered missing "${expected.matteredSubjectIncludes}" (got ${got})`)
    }
  }
  if (expected.needsReviewCount != null && facts.needsReview.count !== expected.needsReviewCount) {
    issues.push(`needsReview.count ${facts.needsReview.count}, expected ${expected.needsReviewCount}`)
  }
  if (expected.carryoverSubjectIncludes) {
    const found = facts.carryover.some((c) =>
      containsAny(c.intentSubject, [expected.carryoverSubjectIncludes!])
      || containsAny(c.label, [expected.carryoverSubjectIncludes!]))
    if (!found) {
      const got = facts.carryover.map((c) => c.intentSubject ?? c.label).join(' | ') || 'none'
      issues.push(`carryover missing "${expected.carryoverSubjectIncludes}" (got ${got})`)
    }
  }

  return issues
}

// Structural groundedness: the review-derived spine must trace back to real
// blocks, recomputed here independently of buildWrappedFactsFromPayload so the
// check actually guards against the derivation drifting from the timeline.
const NEEDS_REVIEW_MIN_SECONDS = 5 * 60

function evalEffectiveLabel(block: WorkContextBlock): string {
  return block.review?.correctedLabel?.trim() || block.label.current.trim()
}

function evalEffectiveSubject(block: WorkContextBlock): string | null {
  return block.review?.correctedIntentSubject ?? inferWorkIntent(block).subject
}

function checkWrapGrounding(facts: WrappedFacts, payload: DayTimelinePayload): string[] {
  const issues: string[] = []
  const trusted = payload.blocks.filter(isTrustedTimelineBlock)

  // 1. "Needs review" count must equal the independently-counted pending pile.
  const pendingCount = trusted.filter((b) =>
    b.review.state === 'pending' && blockActiveSeconds(b) >= NEEDS_REVIEW_MIN_SECONDS).length
  if (facts.needsReview.count !== pendingCount) {
    issues.push(`needsReview.count ${facts.needsReview.count} != ${pendingCount} pending blocks in payload`)
  }

  // 2. Every "mattered" item is a trusted, decided (non-pending) block — matched
  //    by rounded active duration, which the facts builder copies verbatim.
  for (const m of facts.mattered) {
    if (m.reviewState === 'pending') {
      issues.push(`mattered "${m.label}" is pending — should never be claimed as decided work`)
      continue
    }
    const traced = trusted.some((b) =>
      b.review.state !== 'pending'
      && Math.round(blockActiveSeconds(b)) === m.durationSeconds
      && containsAny(evalEffectiveLabel(b), [m.label]))
    if (!traced) issues.push(`mattered "${m.label}" (${m.durationSeconds}s) traces to no decided block`)
  }

  // 3. Every "carryover" item traces to a real trusted block by subject.
  for (const c of facts.carryover) {
    const traced = trusted.some((b) => {
      const subject = evalEffectiveSubject(b)
      return subject != null && c.intentSubject != null
        && normalizeText(subject) === normalizeText(c.intentSubject)
    })
    if (!traced) issues.push(`carryover "${c.intentSubject ?? c.label}" traces to no real block`)
  }

  return issues
}

// The Target Design encoded as hard invariants. A green eval run is meaningless
// unless it actually verifies the design held — Wave 1's gates passed while the
// product regressed. These checks make a green run mean the design is met:
// kind correctness, no dev apps inside a leisure episode, and humanized titles.
const NATIVE_WORK_CATEGORIES = new Set<AppCategory>(['development', 'aiTools', 'writing', 'design'])
// Data/office files (and underscore-mangled names) must be humanized before they
// reach the UI. Clean code paths ("run.ts", "src/.../Insights.tsx") are
// developer-readable and intentionally allowed.
const RAW_FILENAME_PATTERN = /\.(ipynb|pdf|docx?|xlsx?|pptx?|csv|key|numbers|pages)\b/i
const RAW_URL_PATTERN = /https?:\/\//i
const FILENAME_UNDERSCORE_PATTERN = /[a-z0-9]_[a-z0-9]/i

function titleLooksRaw(value: string | null | undefined): string | null {
  const text = (value ?? '').trim()
  if (!text) return null
  if (RAW_FILENAME_PATTERN.test(text)) return 'file extension'
  if (RAW_URL_PATTERN.test(text)) return 'raw URL'
  if (FILENAME_UNDERSCORE_PATTERN.test(text)) return 'underscore filename'
  return null
}

// The wrap must never contradict itself, scold, invent, or assign homework.
// These guard the Wave 1 wrap defects directly so a green run means the cards
// are honest.
const WRAP_GUILT_PATTERNS = [
  /\b100%\b/i,                                  // the "100% entertainment" contradiction
  /needs?\b[^.]{0,24}\breview\b/i,              // the "needs review" homework closing
  /review in the timeline/i,
  /\bdistraction(?:s)?\b/i,                     // guilt framing
  /books you (?:didn'?t|did not)/i,
  /\blost to\b/i,
  /courses? (?:left )?unstarted/i,
  /extrapolat/i,
]

function wrapDesignIssues(payload: DayTimelinePayload, actualBlocks: ActualBlock[]): string[] {
  const issues: string[] = []
  const facts = buildWrappedFactsFromPayload(payload)
  const texts = wrappedTexts(payload)

  for (const text of texts) {
    for (const pattern of WRAP_GUILT_PATTERNS) {
      if (pattern.test(text)) issues.push(`wrap line trips "${pattern.source}": "${text}"`)
    }
  }

  // A leisure day must carry no focus-% scoring anywhere in the wrap.
  if (facts.kindBreakdown.isLeisureDay) {
    for (const text of texts) {
      if (/\d+\s*%/.test(text) || /\bfocus(?:ed)?\b/i.test(text)) {
        issues.push(`leisure-day wrap scores focus: "${text}"`)
      }
    }
  }

  // "What mattered" and carryover must never name a leisure block — watching is
  // never the work that mattered.
  const leisureLabels = new Set(
    actualBlocks.filter((b) => b.kind === 'leisure').map((b) => normalizeText(b.label)),
  )
  for (const m of facts.mattered) {
    if (leisureLabels.has(normalizeText(m.label))) {
      issues.push(`mattered names a leisure block: "${m.label}"`)
    }
  }
  for (const c of facts.carryover) {
    if (leisureLabels.has(normalizeText(c.label))) {
      issues.push(`carryover names a leisure block: "${c.label}"`)
    }
  }

  return issues
}

function designInvariantIssues(fixture: TimelineFixture, actualBlocks: ActualBlock[], episodes: EpisodeResult[]): string[] {
  const issues: string[] = []

  // 1. Kind correctness: every expected episode's kind must match.
  for (const episode of episodes) {
    if (episode.expected.kind && episode.primary && !episode.kindOk) {
      issues.push(`kind: ${episode.expected.id} is ${episode.primary.kind}, expected ${episode.expected.kind}`)
    }
  }

  for (const actual of actualBlocks) {
    // 2. No native work app may sit inside a leisure episode — a documentary
    //    block must never list Ghostty/Codex.
    if (actual.kind === 'leisure') {
      const workApps = actual.block.topApps
        .filter((app) => !app.isBrowser && NATIVE_WORK_CATEGORIES.has(app.category))
        .map((app) => app.appName)
      if (workApps.length > 0) {
        issues.push(`leisure ${formatRange(actual.startTime, actual.endTime)} contains work apps: ${workApps.join(', ')}`)
      }
      // A leisure label must be activity-shaped, never a raw page/video title.
      if (!/^(watching|on |listening|browsing)/i.test(actual.label)) {
        issues.push(`leisure ${formatRange(actual.startTime, actual.endTime)} label "${actual.label}" is not activity-shaped`)
      }
    }

    // 3. No raw filename / URL may reach a user-facing label or subject.
    const labelRaw = titleLooksRaw(actual.label)
    if (labelRaw) issues.push(`unhumanized label "${actual.label}" (${labelRaw})`)
    const subjectRaw = titleLooksRaw(actual.subject)
    if (subjectRaw) issues.push(`unhumanized subject "${actual.subject}" (${subjectRaw})`)
  }

  return issues
}

const PHASE0_CHECK_NAMES: Record<Phase0CheckId, string> = {
  dogfood: '1. Dogfood real-week fixture',
  segmentation: '2. Segmentation scenario',
  duration: '3. Duration invariant',
  'kind-tag': '4. Kind/tag invariant',
  'gap-reasons': '5. Gap reasons',
  'system-noise': '6. System-noise exclusion',
  apps: '7. Apps aggregation',
  'week-consistency': '8. Week consistency',
}

function phase0Assertion(id: Phase0CheckId, evidenceCount: number, issues: string[]): Phase0Assertion {
  return { id, name: PHASE0_CHECK_NAMES[id], evidenceCount, issues }
}

function phase0DogfoodIssues(
  fixture: TimelineFixture,
  actualBlocks: ActualBlock[],
  designIssues: string[],
  dayIssues: string[],
): string[] {
  const issues = [
    ...designIssues,
    ...dayIssues.filter((issue) => (
      issue.startsWith('forbidden mattered')
      || issue.startsWith('forbidden carryover')
      || issue.startsWith('forbidden label')
    )),
  ]
  if ((fixture.truthSources?.length ?? 0) < 2) {
    issues.push('founder day/week targets do not cite independent observation sources')
  }

  for (const actual of actualBlocks) {
    const nativeWorkSeconds = actual.block.topApps
      .filter((app) => !app.isBrowser && NATIVE_WORK_CATEGORIES.has(app.category))
      .reduce((sum, app) => sum + app.totalSeconds, 0)
    const leisureSeconds = actual.block.websites
      .filter((site) => kindForDomain(site.domain) === 'leisure')
      .reduce((sum, site) => sum + site.totalSeconds, 0)
    if (nativeWorkSeconds >= 5 * 60 && leisureSeconds >= 5 * 60) {
      issues.push(
        `mixed sustained work/leisure in ${formatRange(actual.startTime, actual.endTime)} `
        + `(${Math.round(nativeWorkSeconds / 60)}m native work, ${Math.round(leisureSeconds / 60)}m leisure)`,
      )
    }
  }
  return [...new Set(issues)]
}

function phase0SegmentationIssues(
  fixture: TimelineFixture,
  episodes: EpisodeResult[],
  underSplits: Array<{ actual: ActualBlock; expectedIds: string[] }>,
  actualBlocks: ActualBlock[],
): string[] {
  const issues: string[] = []
  for (const episode of episodes) {
    if (!episode.primary) issues.push(`${episode.expected.id}: missing block`)
    if (episode.overlaps.length !== 1) issues.push(`${episode.expected.id}: overlaps ${episode.overlaps.length} blocks`)
    if (!episode.boundaryOk) issues.push(`${episode.expected.id}: boundary mismatch`)
  }
  for (const entry of underSplits) {
    issues.push(`${formatRange(entry.actual.startTime, entry.actual.endTime)} spans ${entry.expectedIds.join(', ')}`)
  }
  const expected = fixture.expectedDay
  if (expected?.maxBlockCount != null && actualBlocks.length > expected.maxBlockCount) {
    issues.push(`day has ${actualBlocks.length} blocks, expected <= ${expected.maxBlockCount}`)
  }
  if (expected?.minMaterialBlockMinutes != null) {
    const tiny = actualBlocks.filter((block) => {
      const minutes = blockActiveSeconds(block.block) / 60
      return minutes > 0 && minutes < expected.minMaterialBlockMinutes!
    })
    if (tiny.length > 0) {
      issues.push(`${tiny.length} material blocks are shorter than ${expected.minMaterialBlockMinutes}m`)
    }
  }
  return issues
}

function phase0DurationIssues(
  db: Database.Database,
  fixture: TimelineFixture,
  payload: DayTimelinePayload,
  actualBlocks: ActualBlock[],
): string[] {
  const issues: string[] = []
  let blockTotalSeconds = 0
  for (const actual of actualBlocks) {
    const activeSeconds = blockActiveSeconds(actual.block)
    const appSeconds = actual.block.sessions.reduce(
      (sum, session) => sum + Math.max(0, session.durationSeconds || 0),
      0,
    )
    blockTotalSeconds += activeSeconds
    if (Math.abs(activeSeconds - appSeconds) > 2) {
      issues.push(
        `${formatRange(actual.startTime, actual.endTime)} active ${Math.round(activeSeconds)}s `
        + `!= app sum ${Math.round(appSeconds)}s`,
      )
    }
    const detail = getBlockDetailPayload(db, actual.block.id, null)
    if (!detail) {
      issues.push(`${formatRange(actual.startTime, actual.endTime)} is missing from block detail`)
    } else {
      const detailSeconds = blockActiveSeconds(detail)
      if (Math.abs(activeSeconds - detailSeconds) > 2) {
        issues.push(
          `${formatRange(actual.startTime, actual.endTime)} list ${Math.round(activeSeconds)}s `
          + `!= detail ${Math.round(detailSeconds)}s`,
        )
      }
    }
  }
  if (Math.abs(payload.totalSeconds - blockTotalSeconds) > 2) {
    issues.push(
      `day header ${Math.round(payload.totalSeconds)}s != block sum ${Math.round(blockTotalSeconds)}s`,
    )
  }
  if (fixture.expectedDay?.trackedMinutes != null) {
    const tolerance = fixture.expectedDay.toleranceMinutes ?? 15
    const actualMinutes = Math.round(blockTotalSeconds / 60)
    if (!minutesClose(actualMinutes, fixture.expectedDay.trackedMinutes, tolerance)) {
      issues.push(
        `one-duration total ${actualMinutes}m != observed truth `
        + `${fixture.expectedDay.trackedMinutes}m ±${tolerance}m`,
      )
    }
  }
  return issues
}

function phase0KindIssues(episodes: EpisodeResult[]): string[] {
  return episodes
    .filter((episode) => episode.expected.kind && (!episode.primary || !episode.kindOk))
    .map((episode) => (
      `${episode.expected.id}: displayed ${episode.primary?.kind ?? 'missing'}, expected ${episode.expected.kind}`
    ))
}

function actualGapReason(segment: DayTimelinePayload['segments'][number]): string | null {
  if (segment.kind === 'work_block') return null
  if (segment.kind === 'machine_off') return 'machine_off'
  if (segment.kind === 'away') return 'away'
  return 'idle'
}

function phase0GapIssues(fixture: TimelineFixture, payload: DayTimelinePayload): string[] {
  const issues: string[] = []
  for (const expected of fixture.expectedGaps ?? []) {
    const startTime = msForClock(fixture.date, expected.start)
    const endTime = msForClock(fixture.date, expected.end)
    const primary = payload.segments
      .filter((segment) => segment.kind !== 'work_block')
      .map((segment) => ({ segment, overlap: overlapMs(startTime, endTime, segment.startTime, segment.endTime) }))
      .sort((left, right) => right.overlap - left.overlap)[0]
    if (!primary || primary.overlap <= 0) {
      issues.push(`${expected.start}-${expected.end}: missing ${expected.reason} gap`)
      continue
    }
    const actualReason = actualGapReason(primary.segment)
    if (actualReason !== expected.reason) {
      issues.push(`${expected.start}-${expected.end}: ${actualReason ?? 'unknown'}, expected ${expected.reason}`)
    }
  }
  return issues
}

function phase0SystemNoiseIssues(
  db: Database.Database,
  fixture: TimelineFixture,
  payload: DayTimelinePayload,
): string[] {
  const sentinels = fixture.expectedSystemNoise?.sentinelAppNames ?? []
  const issues: string[] = []
  const fromMs = localDateMs(fixture.date)
  const summaries = getAppSummariesForRange(db, fromMs, localDateMs(shiftDateString(fixture.date, 1)))
  for (const sentinel of sentinels) {
    if (!fixture.sessions.some((session) => containsAny(session.appName, [sentinel]))) {
      issues.push(`fixture has no source witness for ${sentinel}`)
      continue
    }
    if (payload.sessions.some((session) => containsAny(session.appName, [sentinel]))) {
      issues.push(`${sentinel} survives into timeline sessions`)
    }
    if (payload.blocks.some((block) => block.topApps.some((app) => containsAny(app.appName, [sentinel])))) {
      issues.push(`${sentinel} survives into block top apps`)
    }
    if (summaries.some((summary) => containsAny(summary.appName, [sentinel]))) {
      issues.push(`${sentinel} survives into Apps summaries`)
    }
  }
  return issues
}

function phase0AppsIssues(db: Database.Database, fixture: TimelineFixture): { evidenceCount: number; issues: string[] } {
  const issues: string[] = []
  const observedDates = [
    fixture.date,
    ...fixture.sessions.map((session) => session.date ?? fixture.date),
    ...(fixture.browserEvidence ?? []).map((visit) => visit.date ?? fixture.date),
  ]
  const anchorDate = observedDates.sort().at(-1) ?? fixture.date
  const dayFrom = localDateMs(anchorDate)
  const dayTo = localDateMs(shiftDateString(anchorDate, 1))
  const sevenDayFrom = localDateMs(shiftDateString(anchorDate, -6))
  const thirtyDayFrom = localDateMs(shiftDateString(anchorDate, -29))
  const dayApps = getAppSummariesForRange(db, dayFrom, dayTo)
  const sevenDayApps = getAppSummariesForRange(db, sevenDayFrom, dayTo)
  const thirtyDayApps = getAppSummariesForRange(db, thirtyDayFrom, dayTo)
  const periods = [
    { name: 'Today', apps: dayApps },
    { name: '7d', apps: sevenDayApps },
    { name: '30d', apps: thirtyDayApps },
  ]
  const periodMaps = periods.map((period) => ({
    ...period,
    byId: new Map(period.apps.map((app) => [app.canonicalAppId ?? app.bundleId, app])),
  }))

  for (const period of periodMaps) {
    if (period.byId.size !== period.apps.length) {
      issues.push(`${period.name} Apps rail contains duplicate canonical app rows`)
    }
  }

  const allIds = new Set(periodMaps.flatMap((period) => [...period.byId.keys()]))
  for (const canonicalId of allIds) {
    const appearances = periodMaps
      .map((period) => ({ period: period.name, app: period.byId.get(canonicalId) }))
      .filter((entry): entry is { period: string; app: (typeof dayApps)[number] } => Boolean(entry.app))
    const names = new Set(appearances.map((entry) => normalizeText(entry.app.appName)))
    if (names.size > 1) {
      issues.push(
        `${canonicalId}: name changes across periods: `
        + appearances.map((entry) => `${entry.period}="${entry.app.appName}"`).join(', '),
      )
    }
  }

  for (const [canonicalId, dayApp] of periodMaps[0].byId) {
    const detail = getAppDetailPayload(db, canonicalId, anchorDate, null)
    if (Math.abs(detail.totalSeconds - dayApp.totalSeconds) > 2) {
      issues.push(
        `${dayApp.appName}: Apps row ${Math.round(dayApp.totalSeconds)}s `
        + `!= detail ${Math.round(detail.totalSeconds)}s`,
      )
    }
    if (detail.topPages) {
      const pageKeys = detail.topPages.map((page) => (
        page.normalizedUrl
        ?? `${normalizeText(page.domain)}:${normalizeText(page.pageTitle ?? page.displayTitle)}`
      ))
      if (new Set(pageKeys).size !== pageKeys.length) {
        issues.push(`${dayApp.appName}: duplicate pages in app detail`)
      }
    }
  }

  const browserEvidence = fixture.browserEvidence ?? []
  const browserIds = new Set(browserEvidence.map((visit) => visit.canonicalBrowserId).filter(Boolean))
  const domainOwners = new Map<string, Set<string>>()
  for (const visit of browserEvidence) {
    if (!visit.canonicalBrowserId) continue
    const owners = domainOwners.get(visit.domain) ?? new Set<string>()
    owners.add(visit.canonicalBrowserId)
    domainOwners.set(visit.domain, owners)
  }
  if (browserEvidence.length === 0 || browserIds.size === 0) {
    issues.push('fixture has no browser ownership evidence')
  }
  for (const browserId of browserIds) {
    if (!periodMaps[2].byId.has(browserId!)) {
      issues.push(`browser evidence owner ${browserId} has no Apps row`)
      continue
    }
    const detail = getAppDetailPayload(db, browserId!, anchorDate, null)
    for (const domain of detail.topDomains ?? []) {
      const owners = domainOwners.get(domain.domain)
      if (owners && !owners.has(browserId!)) {
        issues.push(`${domain.domain} is attributed to ${browserId}, but its evidence belongs to ${[...owners].join(', ')}`)
      }
    }
  }

  return {
    evidenceCount: periods.reduce((sum, period) => sum + period.apps.length, 0) + browserEvidence.length,
    issues,
  }
}

function phase0WeekIssues(db: Database.Database, fixture: TimelineFixture): { evidenceCount: number; issues: string[] } {
  const expected = fixture.expectedWeek
  if (!expected) return { evidenceCount: 0, issues: ['fixture has no independent week target'] }

  const payloads = dateRange(expected.startDate, expected.endDate)
    .map((date) => getTimelineDayPayload(db, date, null, { materialize: false }))
  const dayRows = payloads.map((payload) => ({
    date: payload.date,
    seconds: payload.blocks
      .filter(isTrustedTimelineBlock)
      .reduce((sum, block) => sum + blockActiveSeconds(block), 0),
  }))
  const chartSeconds = dayRows.reduce((sum, day) => sum + day.seconds, 0)
  const recap = buildRecapSummaries(payloads, expected.endDate).week
  const recapSeconds = recap.trend.reduce((sum, day) => sum + day.trackedSeconds, 0)
  const tool = executeTool('getWeekSummary', { weekStartDate: expected.startDate }, db) as {
    totalTrackedSeconds?: number
    dailyBreakdown?: Array<{ totalSeconds: number }>
  }
  const reviewSeconds = tool.totalTrackedSeconds ?? 0
  const reviewDaySeconds = (tool.dailyBreakdown ?? []).reduce((sum, day) => sum + day.totalSeconds, 0)
  const truthSeconds = expected.trackedMinutes * 60
  const toleranceSeconds = (expected.toleranceMinutes ?? 15) * 60
  const issues: string[] = []

  if (Math.abs(chartSeconds - recapSeconds) > 2) {
    issues.push(`week chart ${Math.round(chartSeconds)}s != recap ${Math.round(recapSeconds)}s`)
  }
  if (Math.abs(chartSeconds - reviewSeconds) > 2) {
    issues.push(`week chart ${Math.round(chartSeconds)}s != review source ${Math.round(reviewSeconds)}s`)
  }
  if (Math.abs(reviewSeconds - reviewDaySeconds) > 2) {
    issues.push(`review total ${Math.round(reviewSeconds)}s != review day rows ${Math.round(reviewDaySeconds)}s`)
  }
  if (Math.abs(chartSeconds - truthSeconds) > toleranceSeconds) {
    issues.push(
      `week chart ${Math.round(chartSeconds / 60)}m != observed truth `
      + `${expected.trackedMinutes}m ±${expected.toleranceMinutes ?? 15}m`,
    )
  }
  return { evidenceCount: payloads.length + (tool.dailyBreakdown?.length ?? 0) + 2, issues }
}

function evaluatePhase0Assertions(
  db: Database.Database,
  fixture: TimelineFixture,
  payload: DayTimelinePayload,
  actualBlocks: ActualBlock[],
  episodes: EpisodeResult[],
  underSplits: Array<{ actual: ActualBlock; expectedIds: string[] }>,
  designIssues: string[],
  dayIssues: string[],
): Phase0Assertion[] {
  const enabled = new Set(fixture.phase0Checks ?? [])
  const assertions: Phase0Assertion[] = []
  if (enabled.has('dogfood')) {
    assertions.push(phase0Assertion(
      'dogfood',
      fixture.sessions.length + (fixture.browserEvidence?.length ?? 0),
      phase0DogfoodIssues(fixture, actualBlocks, designIssues, dayIssues),
    ))
  }
  if (enabled.has('segmentation')) {
    assertions.push(phase0Assertion(
      'segmentation',
      episodes.length,
      phase0SegmentationIssues(fixture, episodes, underSplits, actualBlocks),
    ))
  }
  if (enabled.has('duration')) {
    assertions.push(phase0Assertion(
      'duration',
      actualBlocks.length * 3 + 1,
      phase0DurationIssues(db, fixture, payload, actualBlocks),
    ))
  }
  if (enabled.has('kind-tag')) {
    const kindEpisodes = episodes.filter((episode) => episode.expected.kind)
    assertions.push(phase0Assertion('kind-tag', kindEpisodes.length, phase0KindIssues(kindEpisodes)))
  }
  if (enabled.has('gap-reasons')) {
    assertions.push(phase0Assertion(
      'gap-reasons',
      fixture.expectedGaps?.length ?? 0,
      phase0GapIssues(fixture, payload),
    ))
  }
  if (enabled.has('system-noise')) {
    assertions.push(phase0Assertion(
      'system-noise',
      fixture.expectedSystemNoise?.sentinelAppNames.length ?? 0,
      phase0SystemNoiseIssues(db, fixture, payload),
    ))
  }
  if (enabled.has('apps')) {
    const apps = phase0AppsIssues(db, fixture)
    assertions.push(phase0Assertion('apps', apps.evidenceCount, apps.issues))
  }
  if (enabled.has('week-consistency')) {
    const week = phase0WeekIssues(db, fixture)
    assertions.push(phase0Assertion('week-consistency', week.evidenceCount, week.issues))
  }
  return assertions
}

function evaluateFixture(fixture: TimelineFixture): FixtureResult {
  const db = createDb()
  try {
    seedFixture(db, fixture)
    const payload = getTimelineDayPayload(db, fixture.date, null)
    const actualBlocks = actualBlocksFor(payload)
    const episodes = evaluateEpisodes(fixture, actualBlocks)
    const underSplits = findUnderSplits(fixture, actualBlocks)
    const extras = findExtras(fixture, actualBlocks)
    const wrapIssues = evaluateWrap(fixture, payload)
    const dayIssues = evaluateExpectedDay(fixture, payload, actualBlocks)
    const weekIssues = evaluateExpectedWeek(db, fixture)
    const unsupported = unsupportedWrapClaims(payload)
    const wrapGrounding = checkWrapGrounding(buildWrappedFactsFromPayload(payload), payload)

    // Every block must explain why it started and stopped — segmentation now
    // records a boundary reason on each edge, so an empty one is a hole in the
    // model, not a cosmetic gap.
    const boundaryIssues: string[] = []
    for (const actual of actualBlocks) {
      if (actual.startReasons.length === 0) {
        boundaryIssues.push(`block ${formatRange(actual.startTime, actual.endTime)} has no start boundary reason`)
      }
      if (actual.endReasons.length === 0) {
        boundaryIssues.push(`block ${formatRange(actual.startTime, actual.endTime)} has no end boundary reason`)
      }
    }

    const designIssues = [
      ...designInvariantIssues(fixture, actualBlocks, episodes),
      ...wrapDesignIssues(payload, actualBlocks),
    ]
    const phase0Assertions = evaluatePhase0Assertions(
      db,
      fixture,
      payload,
      actualBlocks,
      episodes,
      underSplits,
      designIssues,
      dayIssues,
    )

    const segmentationTotal = episodes.length
    const segmentationPassed = episodes.filter((episode) => (
      episode.primary
      && episode.overlaps.length === 1
      && episode.boundaryOk
      && !underSplits.some((entry) => entry.actual === episode.primary)
    )).length
    const labelsTotal = episodes.length
    const labelsPassed = episodes.filter((episode) => episode.labelOk).length
    const roles = episodes.filter((episode) => episode.expected.intentRole)
    const rolesPassed = roles.filter((episode) => episode.roleOk && episode.subjectOk).length
    const wrapsTotal = fixture.expectedWrap ? 1 : 0
    const wrapsPassed = wrapsTotal > 0
      && wrapIssues.length === 0
      && unsupported.length === 0
      && wrapGrounding.length === 0 ? 1 : 0
    const dayTotal = fixture.expectedDay ? 1 : 0
    const dayPassed = dayTotal > 0 && dayIssues.length === 0 ? 1 : 0
    const weekTotal = fixture.expectedWeek ? 1 : 0
    const weekPassed = weekTotal > 0 && weekIssues.length === 0 ? 1 : 0

    return {
      fixture,
      payload,
      actualBlocks,
      episodes,
      overSplits: episodes.filter((episode) => episode.overlaps.length > 1),
      underSplits,
      extras,
      wrapIssues,
      dayIssues,
      weekIssues,
      unsupportedWrapClaims: unsupported,
      wrapGroundingIssues: wrapGrounding,
      boundaryIssues,
      designIssues,
      phase0Assertions,
      scores: {
        segmentationPassed,
        segmentationTotal,
        labelsPassed,
        labelsTotal,
        rolesPassed,
        rolesTotal: roles.length,
        wrapsPassed,
        wrapsTotal,
        dayPassed,
        dayTotal,
        weekPassed,
        weekTotal,
      },
    }
  } finally {
    db.close()
  }
}

function status(ok: boolean): string {
  return ok ? 'pass' : 'fail'
}

function formatActualBlock(actual: ActualBlock): string {
  const apps = actual.block.topApps.map((app) => app.appName).slice(0, 3).join(', ')
  const subject = actual.subject ? ` on ${actual.subject}` : ''
  const boundary = ` ⟦${actual.startReasons.join('+') || '?'} → ${actual.endReasons.join('+') || '?'}⟧`
  return `${formatRange(actual.startTime, actual.endTime)} ${actual.label} (${actual.block.dominantCategory}, ${actual.role}${subject}, apps: ${apps})${boundary}`
}

function formatFixture(result: FixtureResult): string {
  const lines: string[] = []
  const { fixture, scores } = result
  lines.push(`## ${fixture.name} (${fixture.id})`)
  if (fixture.description) lines.push(fixture.description)
  if (fixture.expectedToFailOnCurrentMain) {
    lines.push('Expected-red baseline: this fixture should fail under `--strict` until the v2 truth packets fix the real-day defects.')
  }
  lines.push('')
  lines.push(`Score: segmentation ${scores.segmentationPassed}/${scores.segmentationTotal} | labels ${scores.labelsPassed}/${scores.labelsTotal} | intent ${scores.rolesPassed}/${scores.rolesTotal} | wraps ${scores.wrapsPassed}/${scores.wrapsTotal} | day ${scores.dayPassed}/${scores.dayTotal} | week ${scores.weekPassed}/${scores.weekTotal}`)
  if (result.phase0Assertions.length > 0) {
    lines.push(`Phase 0: ${result.phase0Assertions.map((assertion) => (
      `${assertion.id} ${status(assertion.evidenceCount > 0 && assertion.issues.length === 0)}`
    )).join(' | ')}`)
  }
  lines.push('')
  lines.push('| Expected episode | Actual primary block | Result | Notes |')
  lines.push('| --- | --- | --- | --- |')
  for (const episode of result.episodes) {
    const checksOk = Boolean(
      episode.primary
      && episode.overlaps.length === 1
      && episode.boundaryOk
      && episode.labelOk
      && episode.categoryOk
      && episode.roleOk
      && episode.subjectOk,
    )
    const expected = `${episode.expected.id} ${formatRange(episode.startTime, episode.endTime)} "${episode.expected.label}"`
    const actual = episode.primary ? formatActualBlock(episode.primary) : 'missing'
    lines.push(`| ${expected} | ${actual} | ${status(checksOk)} | ${episode.notes.join('; ') || 'ok'} |`)
  }

  lines.push('')
  lines.push('Actual blocks:')
  for (const actual of result.actualBlocks) {
    const pages = actual.block.pageRefs.map((page) => page.displayTitle).slice(0, 2)
    const pageText = pages.length > 0 ? ` pages: ${pages.join(' | ')}` : ''
    lines.push(`- ${formatActualBlock(actual)}; active ${formatDuration(blockActiveSeconds(actual.block))}${pageText}`)
  }

  const facts = buildWrappedFactsFromPayload(result.payload)
  lines.push('')
  lines.push(
    `Wrap check: quality ${facts.quality}; dominant ${facts.dominantCategory}; `
    + `top app ${facts.topApp?.appName ?? 'none'}; top domain ${facts.topDomain?.domain ?? 'none'}; `
    + `unsupported claims ${result.unsupportedWrapClaims.length === 0 ? 'none' : result.unsupportedWrapClaims.length}`,
  )
  lines.push(
    `Review spine: mattered [${facts.mattered.map((m) => m.intentSubject ?? m.label).join(' | ') || 'none'}]; `
    + `needs review ${facts.needsReview.count}; `
    + `carryover [${facts.carryover.map((c) => `${c.intentSubject ?? c.label} (${c.reason})`).join(' | ') || 'none'}]`,
  )

  const issueLines: string[] = []
  for (const episode of result.overSplits) {
    issueLines.push(`over-split ${episode.expected.id}: ${episode.overlaps.map((entry) => formatRange(entry.actual.startTime, entry.actual.endTime)).join(', ')}`)
  }
  for (const entry of result.underSplits) {
    issueLines.push(`under-split ${formatRange(entry.actual.startTime, entry.actual.endTime)} spans ${entry.expectedIds.join(', ')}`)
  }
  for (const episode of result.episodes.filter((entry) => entry.primary && !entry.labelOk)) {
    issueLines.push(`wrong label ${episode.expected.id}: got "${episode.primary!.label}", expected "${episode.expected.label}"`)
  }
  for (const episode of result.episodes.filter((entry) => entry.primary && !entry.roleOk)) {
    issueLines.push(`wrong intent role ${episode.expected.id}: got ${episode.primary!.role}, expected ${episode.expected.intentRole}`)
  }
  for (const episode of result.episodes.filter((entry) => entry.primary && !entry.subjectOk)) {
    issueLines.push(`wrong intent subject ${episode.expected.id}: got ${episode.primary!.subject ?? 'null'}`)
  }
  for (const issue of result.wrapIssues) {
    issueLines.push(`wrap fact mismatch: ${issue}`)
  }
  for (const issue of result.dayIssues) {
    issueLines.push(`day baseline: ${issue}`)
  }
  for (const issue of result.weekIssues) {
    issueLines.push(`week baseline: ${issue}`)
  }
  for (const issue of result.unsupportedWrapClaims) {
    issueLines.push(`unsupported wrap claim: ${issue}`)
  }
  for (const issue of result.wrapGroundingIssues) {
    issueLines.push(`wrap grounding: ${issue}`)
  }
  for (const issue of result.boundaryIssues) {
    issueLines.push(`boundary: ${issue}`)
  }
  for (const issue of result.designIssues) {
    issueLines.push(`design: ${issue}`)
  }
  for (const assertion of result.phase0Assertions) {
    if (assertion.evidenceCount === 0) {
      issueLines.push(`phase0 ${assertion.id}: no acceptance witness`)
    }
    for (const issue of assertion.issues) {
      issueLines.push(`phase0 ${assertion.id}: ${issue}`)
    }
  }
  for (const extra of result.extras) {
    issueLines.push(`extra actual block: ${formatActualBlock(extra)}`)
  }

  lines.push('')
  lines.push('Issues:')
  if (issueLines.length === 0) {
    lines.push('- none')
  } else {
    for (const issue of issueLines) lines.push(`- ${issue}`)
  }
  lines.push('')

  return lines.join('\n')
}

function formatPhase0Matrix(results: FixtureResult[]): string[] {
  const lines = [
    '## Phase 0 external-behavior checks',
    '',
    '| Check | Witnesses | Result | Current-main defects |',
    '| --- | ---: | --- | --- |',
  ]
  const assertions = results.flatMap((result) => (
    result.phase0Assertions.map((assertion) => ({ fixtureId: result.fixture.id, assertion }))
  ))

  for (const id of Object.keys(PHASE0_CHECK_NAMES) as Phase0CheckId[]) {
    const matches = assertions.filter((entry) => entry.assertion.id === id)
    const evidenceCount = matches.reduce((sum, entry) => sum + entry.assertion.evidenceCount, 0)
    const issues = matches.flatMap((entry) => (
      entry.assertion.issues.map((issue) => `${entry.fixtureId}: ${issue}`)
    ))
    if (matches.length === 0 || evidenceCount === 0) {
      issues.unshift('no acceptance witness')
    }
    const result = issues.length === 0 ? 'pass' : 'fail'
    const summary = issues.slice(0, 3).join('; ') || 'none'
    lines.push(`| ${PHASE0_CHECK_NAMES[id]} | ${evidenceCount} | ${result} | ${summary} |`)
  }
  lines.push('')
  lines.push('The strict founder-baseline command fails while any row above is red.')
  lines.push('')
  return lines
}

function formatReport(results: FixtureResult[]): string {
  const total = results.reduce((sum, result) => ({
    segmentationPassed: sum.segmentationPassed + result.scores.segmentationPassed,
    segmentationTotal: sum.segmentationTotal + result.scores.segmentationTotal,
    labelsPassed: sum.labelsPassed + result.scores.labelsPassed,
    labelsTotal: sum.labelsTotal + result.scores.labelsTotal,
    rolesPassed: sum.rolesPassed + result.scores.rolesPassed,
    rolesTotal: sum.rolesTotal + result.scores.rolesTotal,
    wrapsPassed: sum.wrapsPassed + result.scores.wrapsPassed,
    wrapsTotal: sum.wrapsTotal + result.scores.wrapsTotal,
    dayPassed: sum.dayPassed + result.scores.dayPassed,
    dayTotal: sum.dayTotal + result.scores.dayTotal,
    weekPassed: sum.weekPassed + result.scores.weekPassed,
    weekTotal: sum.weekTotal + result.scores.weekTotal,
  }), {
    segmentationPassed: 0,
    segmentationTotal: 0,
    labelsPassed: 0,
    labelsTotal: 0,
    rolesPassed: 0,
    rolesTotal: 0,
    wrapsPassed: 0,
    wrapsTotal: 0,
    dayPassed: 0,
    dayTotal: 0,
    weekPassed: 0,
    weekTotal: 0,
  })

  const lines = [
    '# Daylens Timeline Evaluation',
    '',
    'Command: `npm run timeline:eval`',
    '',
    `Fixtures: ${results.length}`,
    `Overall score: segmentation ${total.segmentationPassed}/${total.segmentationTotal} | labels ${total.labelsPassed}/${total.labelsTotal} | intent ${total.rolesPassed}/${total.rolesTotal} | wraps ${total.wrapsPassed}/${total.wrapsTotal} | day ${total.dayPassed}/${total.dayTotal} | week ${total.weekPassed}/${total.weekTotal}`,
    '',
    'This report compares editable offline fixtures against the current Daylens timeline, intent, and deterministic wrap logic.',
    '',
    ...formatPhase0Matrix(results),
    ...results.map(formatFixture),
  ]

  return lines.join('\n')
}

const writeBaseline = process.argv.includes('--write-baseline')
const strict = process.argv.includes('--strict')
const fixtureFilter = process.argv
  .filter((arg) => !arg.startsWith('--'))
  .slice(2)
const fixtures = loadFixtures()
  .filter((fixture) => fixtureFilter.length === 0 || fixtureFilter.some((value) => fixture.id.includes(value)))

if (fixtures.length === 0) {
  throw new Error('No timeline eval fixtures matched.')
}

const results = fixtures.map(evaluateFixture)
const report = formatReport(results)
console.log(report)

if (writeBaseline) {
  fs.writeFileSync(BASELINE_PATH, `${report}\n`)
  console.log(`\nWrote ${BASELINE_PATH}`)
}

// Hard invariant (always enforced, not just under --strict): every block must
// carry a non-empty boundary reason on both edges. A block that cannot explain
// why it started or stopped is a defect in the segmentation model.
const enforcedBoundaryDefects = results
  .filter((result) => strict || !result.fixture.expectedToFailOnCurrentMain)
  .flatMap((result) => result.boundaryIssues)
if (enforcedBoundaryDefects.length > 0) {
  console.error(`\nBoundary-reason invariant violated:\n- ${enforcedBoundaryDefects.join('\n- ')}`)
  process.exitCode = 1
}

// Target-Design invariants (always enforced): a green run must mean the design
// held. kind correctness, no dev apps inside leisure, humanized titles.
const enforcedDesignDefects = results
  .filter((result) => strict || !result.fixture.expectedToFailOnCurrentMain)
  .flatMap((result) => result.designIssues.map((issue) => `${result.fixture.id}: ${issue}`))
if (enforcedDesignDefects.length > 0) {
  console.error(`\nTarget-Design invariant violated:\n- ${enforcedDesignDefects.join('\n- ')}`)
  process.exitCode = 1
}

const enforcedWrapGroundingDefects = strict
  ? results.flatMap((result) => [
      ...result.unsupportedWrapClaims.map((issue) => `${result.fixture.id}: ${issue}`),
      ...result.wrapGroundingIssues.map((issue) => `${result.fixture.id}: ${issue}`),
    ])
  : []
if (enforcedWrapGroundingDefects.length > 0) {
  console.error(`\nWrap grounding invariant violated:\n- ${enforcedWrapGroundingDefects.join('\n- ')}`)
  process.exitCode = 1
}

if (strict) {
  const phase0ById = new Map<Phase0CheckId, Phase0Assertion[]>()
  for (const result of results) {
    for (const assertion of result.phase0Assertions) {
      const entries = phase0ById.get(assertion.id) ?? []
      entries.push(assertion)
      phase0ById.set(assertion.id, entries)
    }
  }
  const hasPhase0Fixtures = results.some((result) => result.phase0Assertions.length > 0)
  const phase0Failed = hasPhase0Fixtures && (Object.keys(PHASE0_CHECK_NAMES) as Phase0CheckId[]).some((id) => {
    const assertions = phase0ById.get(id) ?? []
    return assertions.length === 0
      || assertions.reduce((sum, assertion) => sum + assertion.evidenceCount, 0) === 0
      || assertions.some((assertion) => assertion.issues.length > 0)
  })
  const failed = results.some((result) => (
    result.scores.segmentationPassed !== result.scores.segmentationTotal
    || result.scores.labelsPassed !== result.scores.labelsTotal
    || result.scores.rolesPassed !== result.scores.rolesTotal
    || result.scores.wrapsPassed !== result.scores.wrapsTotal
    || result.scores.dayPassed !== result.scores.dayTotal
    || result.scores.weekPassed !== result.scores.weekTotal
  ))
  if (
    failed
    || phase0Failed
    || enforcedBoundaryDefects.length > 0
    || enforcedDesignDefects.length > 0
    || enforcedWrapGroundingDefects.length > 0
  ) {
    process.exitCode = 1
  }
}
