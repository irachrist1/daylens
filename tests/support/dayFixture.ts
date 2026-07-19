import fs from 'node:fs'
import path from 'node:path'
import type { FocusEventType } from '../../src/main/core/evidence/focusEvent.ts'
import type {
  AppCategory,
  CalendarSignal,
  TimelineBlockReviewState,
  WorkIntentRole,
  WorkKind,
} from '../../src/shared/types.ts'
import { isWorkIntentRole } from '../../src/shared/types.ts'

export const DAY_FIXTURE_SCHEMA_VERSION = 1 as const

export interface DayFixtureSession {
  start: string
  end: string
  bundleId: string
  appName: string
  category: AppCategory
  title?: string | null
}

export interface DayFixtureBrowserEvidence {
  at: string
  durationMinutes?: number
  durationSeconds?: number
  browserBundleId?: string | null
  canonicalBrowserId?: string | null
  domain: string
  url: string
  title?: string | null
}

export interface DayFixtureActivityEvent {
  at: string
  type: string
}

export interface DayFixtureForegroundSample {
  at: string
  application: string
  path: string
  title: string | null
  tab?: {
    url: string
    title: string | null
    isPrivate?: boolean
    modeKnown?: boolean
  }
}

export interface DayFixtureFocusEvent {
  at: string
  eventType: FocusEventType
  appBundleId: string | null
  appName: string | null
  windowTitle: string | null
}

export interface ExpectedDayEpisode {
  id: string
  start: string
  end: string
  label: string
  labelIncludes?: string[]
  category?: AppCategory
  kind?: WorkKind
  intentRole?: WorkIntentRole
  intentSubjectIncludes?: string[]
  startToleranceMinutes?: number
  endToleranceMinutes?: number
  durationToleranceMinutes?: number
}

export interface ExpectedDayWrap {
  quality?: 'empty' | 'tooEarly' | 'partial' | 'full'
  isLeisureDay?: boolean
  workActivityIncludes?: string
  appSiteIncludes?: string
  topLeisureIncludes?: string
  standoutIncludes?: string
}

export interface ExpectedDayAnswer {
  question: string
  requiredFacts?: string[]
  acceptableInterpretations?: string[]
  prohibitedClaims?: string[]
  requiredSources?: string[]
  prohibitedDisclosures?: string[]
}

export const DAY_FIXTURE_PRIVACY_SURFACES = [
  'sessions',
  'pending evidence',
  'canonical evidence',
  'Timeline',
  'Apps',
  'search',
  'wrap',
  'memory',
  'AI context',
  'MCP',
  'sync',
] as const

export type DayFixturePrivacySurface = typeof DAY_FIXTURE_PRIVACY_SURFACES[number]

export interface KnownIssueDeferral {
  issue: string
  defectSignatures: string[]
}

export function isKnownIssueDefect(
  deferrals: readonly KnownIssueDeferral[],
  defect: string,
): boolean {
  return deferrals.some((deferral) => deferral.defectSignatures.includes(defect))
}

export interface DayFixtureExpected {
  episodes?: ExpectedDayEpisode[]
  wrap?: ExpectedDayWrap
  apps?: Array<{
    appName: string
    durationMinutes?: number
    durationToleranceMinutes?: number
  }>
  meetings?: Array<{
    title: string
    /** Restrict the match to one evidence source. 'timeline' proves a real
     *  meeting block was derived; 'calendar' asserts the stored record stays
     *  visible even when the device shows no attendance. Omit to accept either. */
    source?: 'calendar' | 'timeline'
    start?: string
    startToleranceMinutes?: number
    durationMinutes?: number
    durationToleranceMinutes?: number
  }>
  totals?: Record<string, number>
  search?: Array<{ query: string; requiredFacts?: string[]; prohibitedFacts?: string[] }>
  memory?: Array<{ query: string; requiredFacts?: string[]; prohibitedFacts?: string[] }>
  answers?: ExpectedDayAnswer[]
  privacy?: {
    prohibitedTerms?: string[]
    prohibitedSurfaces?: DayFixturePrivacySurface[]
  }
  knownIssues?: KnownIssueDeferral[]
}

export interface CorrectBlockMutation {
  kind: 'correctBlock'
  matchLabelIncludes: string[]
  state?: Extract<TimelineBlockReviewState, 'corrected' | 'approved'>
  correctedLabel?: string
  correctedIntentRole?: WorkIntentRole
  correctedIntentSubject?: string
  correctedCategory?: AppCategory
}

export interface IgnoreBlockMutation {
  kind: 'ignoreBlock'
  matchLabelIncludes: string[]
}

export interface ExcludeAndPurgeAppMutation {
  kind: 'excludeAndPurgeApp'
  appName?: string
  bundleId?: string
}

export interface ExcludeAndPurgeSiteMutation {
  kind: 'excludeAndPurgeSite'
  domain: string
}

export type DayFixtureMutation =
  | CorrectBlockMutation
  | IgnoreBlockMutation
  | ExcludeAndPurgeAppMutation
  | ExcludeAndPurgeSiteMutation

const MUTATION_KINDS = new Set<DayFixtureMutation['kind']>([
  'correctBlock',
  'ignoreBlock',
  'excludeAndPurgeApp',
  'excludeAndPurgeSite',
])

interface DayFixtureBase {
  schemaVersion: typeof DAY_FIXTURE_SCHEMA_VERSION
  id: string
  name: string
  date: string
  timezone: string
  description?: string
  context?: {
    calendar?: CalendarSignal
    memoryFacts?: string[]
    files?: unknown[]
    connectors?: Record<string, unknown>
    permissions?: Record<string, unknown>
  }
  mutations?: DayFixtureMutation[]
  expected?: DayFixtureExpected
  review?: {
    state: 'draft' | 'accepted'
    reviewedAt?: string
    sourceHash?: string
    notes?: string[]
  }
}

export interface NormalizedEvidenceDayFixture extends DayFixtureBase {
  input: {
    kind: 'normalized-evidence'
    sessions: DayFixtureSession[]
    browserEvidence?: DayFixtureBrowserEvidence[]
    activityEvents?: DayFixtureActivityEvent[]
  }
  expected: DayFixtureExpected & { episodes: ExpectedDayEpisode[] }
}

export interface CaptureEventsDayFixture extends DayFixtureBase {
  input: {
    kind: 'capture-events'
    settings: Record<string, unknown>
    foregroundSamples: DayFixtureForegroundSample[]
    focusEvents: DayFixtureFocusEvent[]
  }
}

export interface PrivateDatabaseCopyDayFixture extends DayFixtureBase {
  input: {
    kind: 'private-database-copy'
    database: {
      relativePath: string
      sha256: string
    }
    privateReplay?: {
      configRelativePath?: string | null
      capturedAt: string
      source: {
        selector: 'production-user-data' | 'explicit'
        userDataPath: string
        databasePath: string
      }
    }
  }
}

export type DayFixture =
  | NormalizedEvidenceDayFixture
  | CaptureEventsDayFixture
  | PrivateDatabaseCopyDayFixture

interface LegacyTimelineFixture {
  id: string
  name: string
  date: string
  description?: string
  sessions: DayFixtureSession[]
  browserEvidence?: DayFixtureBrowserEvidence[]
  activityEvents?: DayFixtureActivityEvent[]
  expectedEpisodes: ExpectedDayEpisode[]
  expectedWrap?: ExpectedDayWrap
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fixtureError(filePath: string, message: string): Error {
  return new Error(`Invalid day fixture ${path.basename(filePath)}: ${message}`)
}

function requireFixtureIdentity(
  value: Record<string, unknown>,
  filePath: string,
): asserts value is Record<string, unknown> & { id: string; name: string; date: string } {
  for (const field of ['id', 'name', 'date'] as const) {
    if (typeof value[field] !== 'string' || value[field].trim() === '') {
      throw fixtureError(filePath, `missing ${field}`)
    }
  }
}

function normalizeLegacyTimelineFixture(
  value: Record<string, unknown>,
  filePath: string,
): NormalizedEvidenceDayFixture {
  requireFixtureIdentity(value, filePath)
  if (!Array.isArray(value.sessions) || !Array.isArray(value.expectedEpisodes)) {
    throw fixtureError(filePath, 'unsupported unversioned format')
  }
  if (value.expectedEpisodes.length === 0) {
    throw fixtureError(filePath, 'expected.episodes must not be empty')
  }
  const legacy = value as unknown as LegacyTimelineFixture
  return {
    schemaVersion: DAY_FIXTURE_SCHEMA_VERSION,
    id: legacy.id,
    name: legacy.name,
    date: legacy.date,
    timezone: 'local',
    description: legacy.description,
    input: {
      kind: 'normalized-evidence',
      sessions: legacy.sessions,
      browserEvidence: legacy.browserEvidence,
      activityEvents: legacy.activityEvents,
    },
    expected: {
      episodes: legacy.expectedEpisodes,
      wrap: legacy.expectedWrap,
    },
  }
}

export function normalizeDayFixture(value: unknown, filePath = '<memory>'): DayFixture {
  if (!isRecord(value)) throw fixtureError(filePath, 'root must be an object')
  if (value.schemaVersion == null) return normalizeLegacyTimelineFixture(value, filePath)
  if (value.schemaVersion !== DAY_FIXTURE_SCHEMA_VERSION) {
    throw fixtureError(filePath, `unsupported schemaVersion ${String(value.schemaVersion)}`)
  }
  requireFixtureIdentity(value, filePath)
  if (typeof value.timezone !== 'string' || value.timezone.trim() === '') {
    throw fixtureError(filePath, 'missing timezone')
  }
  if (!isRecord(value.input) || typeof value.input.kind !== 'string') {
    throw fixtureError(filePath, 'missing input.kind')
  }
  if (value.mutations != null) {
    if (!Array.isArray(value.mutations)) throw fixtureError(filePath, 'mutations must be an array')
    for (const mutation of value.mutations) {
      if (!isRecord(mutation) || !MUTATION_KINDS.has(mutation.kind as DayFixtureMutation['kind'])) {
        throw fixtureError(filePath, `unsupported mutation ${JSON.stringify(mutation)}`)
      }
      if (
        (mutation.kind === 'correctBlock' || mutation.kind === 'ignoreBlock') &&
        (!Array.isArray(mutation.matchLabelIncludes) || mutation.matchLabelIncludes.length === 0)
      ) {
        throw fixtureError(filePath, `${mutation.kind} mutation requires matchLabelIncludes`)
      }
      if (mutation.kind === 'correctBlock') {
        if (mutation.state != null && mutation.state !== 'corrected' && mutation.state !== 'approved') {
          throw fixtureError(filePath, `correctBlock state must be corrected or approved`)
        }
        for (const field of [
          'correctedLabel',
          'correctedIntentSubject',
          'correctedCategory',
        ] as const) {
          if (mutation[field] != null && typeof mutation[field] !== 'string') {
            throw fixtureError(filePath, `correctBlock ${field} must be a string`)
          }
        }
        if (
          mutation.correctedIntentRole != null &&
          !isWorkIntentRole(mutation.correctedIntentRole)
        ) {
          throw fixtureError(
            filePath,
            `correctBlock correctedIntentRole must be one of execution, research, communication, review, coordination, ambient, ambiguous`,
          )
        }
      }
      if (
        mutation.kind === 'excludeAndPurgeApp' &&
        typeof mutation.appName !== 'string' &&
        typeof mutation.bundleId !== 'string'
      ) {
        throw fixtureError(filePath, 'excludeAndPurgeApp mutation requires appName or bundleId')
      }
      if (mutation.kind === 'excludeAndPurgeSite' && typeof mutation.domain !== 'string') {
        throw fixtureError(filePath, 'excludeAndPurgeSite mutation requires domain')
      }
    }
  }

  if (value.expected != null) {
    if (!isRecord(value.expected)) throw fixtureError(filePath, 'expected must be an object')
    if (value.expected.privacy != null) {
      if (!isRecord(value.expected.privacy)) {
        throw fixtureError(filePath, 'expected.privacy must be an object')
      }
      const surfaces = value.expected.privacy.prohibitedSurfaces
      if (surfaces != null) {
        if (!Array.isArray(surfaces)) {
          throw fixtureError(filePath, 'expected.privacy.prohibitedSurfaces must be an array')
        }
        const allowed = new Set<string>(DAY_FIXTURE_PRIVACY_SURFACES)
        for (const surface of surfaces) {
          if (typeof surface !== 'string' || !allowed.has(surface)) {
            throw fixtureError(filePath, `unsupported prohibited surface ${JSON.stringify(surface)}`)
          }
        }
      }
    }
    if (value.expected.knownIssues != null) {
      if (!Array.isArray(value.expected.knownIssues)) {
        throw fixtureError(filePath, 'expected.knownIssues must be an array')
      }
      for (const deferral of value.expected.knownIssues) {
        if (
          !isRecord(deferral) ||
          typeof deferral.issue !== 'string' ||
          deferral.issue.trim() === '' ||
          !Array.isArray(deferral.defectSignatures) ||
          deferral.defectSignatures.length === 0 ||
          deferral.defectSignatures.some(
            (signature) => typeof signature !== 'string' || signature.trim() === '',
          )
        ) {
          throw fixtureError(filePath, 'knownIssues entries require issue and non-empty defectSignatures')
        }
      }
    }
  }

  if (value.input.kind === 'normalized-evidence') {
    if (!Array.isArray(value.input.sessions)) {
      throw fixtureError(filePath, 'normalized-evidence input requires sessions')
    }
    if (
      !isRecord(value.expected) ||
      !Array.isArray(value.expected.episodes) ||
      value.expected.episodes.length === 0
    ) {
      throw fixtureError(filePath, 'normalized-evidence input requires expected.episodes')
    }
  } else if (value.input.kind === 'capture-events') {
    if (
      !isRecord(value.input.settings) ||
      !Array.isArray(value.input.foregroundSamples) ||
      !Array.isArray(value.input.focusEvents)
    ) {
      throw fixtureError(
        filePath,
        'capture-events input requires settings, foregroundSamples, and focusEvents',
      )
    }
  } else if (value.input.kind === 'private-database-copy') {
    if (
      !isRecord(value.input.database) ||
      typeof value.input.database.relativePath !== 'string' ||
      typeof value.input.database.sha256 !== 'string'
    ) {
      throw fixtureError(filePath, 'private-database-copy input requires database path and hash')
    }
    if (
      path.isAbsolute(value.input.database.relativePath) ||
      value.input.database.relativePath.split(/[\\/]/).includes('..')
    ) {
      throw fixtureError(
        filePath,
        'database.relativePath must stay within the private fixture root',
      )
    }
    if (!/^[a-f0-9]{64}$/i.test(value.input.database.sha256)) {
      throw fixtureError(filePath, 'database.sha256 must be a SHA-256 digest')
    }
  } else {
    throw fixtureError(filePath, `unsupported input.kind ${value.input.kind}`)
  }

  return value as unknown as DayFixture
}

export function loadDayFixture(filePath: string): DayFixture {
  return normalizeDayFixture(JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown, filePath)
}

export function loadDayFixtures(directory: string): DayFixture[] {
  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => loadDayFixture(path.join(directory, file)))
}

export function isNormalizedEvidenceDayFixture(
  fixture: DayFixture,
): fixture is NormalizedEvidenceDayFixture {
  return fixture.input.kind === 'normalized-evidence'
}

export function isCaptureEventsDayFixture(fixture: DayFixture): fixture is CaptureEventsDayFixture {
  return fixture.input.kind === 'capture-events'
}
