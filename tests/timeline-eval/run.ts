import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCHEMA_SQL } from '../../src/main/db/schema.ts'
import { getTimelineDayPayload, userVisibleLabelForBlock } from '../../src/main/services/workBlocks.ts'
import { buildFallbackNarrative, buildWrappedFactsFromPayload, computeFactsHash, type WrappedFacts } from '../../src/main/lib/wrappedNarrative.ts'
import { inferWorkIntent } from '../../src/shared/workIntent.ts'
import { effectiveBlockKind, type WorkKind } from '../../src/shared/workKind.ts'
import { blockActiveSeconds } from '../../src/shared/blockDuration.ts'
import { isTrustedTimelineBlock } from '../../src/shared/timelineReview.ts'
import type { AppCategory, DayTimelinePayload, WorkContextBlock, WorkIntentRole } from '../../src/shared/types.ts'

type WrappedQuality = 'empty' | 'tooEarly' | 'partial' | 'full'

interface FixtureSession {
  start: string
  end: string
  bundleId: string
  appName: string
  category: AppCategory
  title?: string | null
}

interface FixtureBrowserEvidence {
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
  at: string
  type: string
}

interface ExpectedEpisode {
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

interface TimelineFixture {
  id: string
  name: string
  date: string
  description?: string
  sessions: FixtureSession[]
  browserEvidence?: FixtureBrowserEvidence[]
  activityEvents?: FixtureActivityEvent[]
  expectedEpisodes: ExpectedEpisode[]
  expectedWrap?: ExpectedWrap
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

interface FixtureResult {
  fixture: TimelineFixture
  payload: DayTimelinePayload
  actualBlocks: ActualBlock[]
  episodes: EpisodeResult[]
  overSplits: EpisodeResult[]
  underSplits: Array<{ actual: ActualBlock; expectedIds: string[] }>
  extras: ActualBlock[]
  wrapIssues: string[]
  unsupportedWrapClaims: string[]
  wrapGroundingIssues: string[]
  boundaryIssues: string[]
  designIssues: string[]
  scores: {
    segmentationPassed: number
    segmentationTotal: number
    labelsPassed: number
    labelsTotal: number
    rolesPassed: number
    rolesTotal: number
    wrapsPassed: number
    wrapsTotal: number
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.join(HERE, 'fixtures')
const BASELINE_PATH = path.join(HERE, 'baseline.md')
const BOUNDARY_TOLERANCE_MS = 5 * 60_000

function msForClock(dateStr: string, clock: string): number {
  const [hourRaw, minuteRaw] = clock.split(':')
  const hour = Number(hourRaw)
  const minute = Number(minuteRaw)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`Invalid fixture clock "${clock}"`)
  }
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
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
    return Boolean(normalizedCandidate) && normalizedValue.includes(normalizedCandidate)
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
    const startTime = msForClock(fixture.date, session.start)
    const endTime = msForClock(fixture.date, session.end)
    insertSession.run(
      session.bundleId,
      session.appName,
      startTime,
      endTime,
      Math.max(1, Math.round((endTime - startTime) / 1000)),
      session.category,
      session.title ?? null,
      session.appName,
      session.bundleId,
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
    const visitTime = msForClock(fixture.date, visit.at)
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
    insertEvent.run(msForClock(fixture.date, event.at), event.type)
  }
}

function loadFixtures(): TimelineFixture[] {
  return fs.readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8')) as TimelineFixture
      if (!fixture.id || !fixture.name || !fixture.date || fixture.expectedEpisodes.length === 0) {
        throw new Error(`Invalid timeline eval fixture ${file}`)
      }
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
    const startTime = msForClock(fixture.date, expected.start)
    const endTime = msForClock(fixture.date, expected.end)
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

function evaluateFixture(fixture: TimelineFixture): FixtureResult {
  const db = createDb()
  try {
    seedFixture(db, fixture)
    const payload = getTimelineDayPayload(db, fixture.date, null, { materialize: false })
    const actualBlocks = actualBlocksFor(payload)
    const episodes = evaluateEpisodes(fixture, actualBlocks)
    const underSplits = findUnderSplits(fixture, actualBlocks)
    const extras = findExtras(fixture, actualBlocks)
    const wrapIssues = evaluateWrap(fixture, payload)
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

    return {
      fixture,
      payload,
      actualBlocks,
      episodes,
      overSplits: episodes.filter((episode) => episode.overlaps.length > 1),
      underSplits,
      extras,
      wrapIssues,
      unsupportedWrapClaims: unsupported,
      wrapGroundingIssues: wrapGrounding,
      boundaryIssues,
      designIssues,
      scores: {
        segmentationPassed,
        segmentationTotal,
        labelsPassed,
        labelsTotal,
        rolesPassed,
        rolesTotal: roles.length,
        wrapsPassed,
        wrapsTotal,
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
  lines.push('')
  lines.push(`Score: segmentation ${scores.segmentationPassed}/${scores.segmentationTotal} | labels ${scores.labelsPassed}/${scores.labelsTotal} | intent ${scores.rolesPassed}/${scores.rolesTotal} | wraps ${scores.wrapsPassed}/${scores.wrapsTotal}`)
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
  }), {
    segmentationPassed: 0,
    segmentationTotal: 0,
    labelsPassed: 0,
    labelsTotal: 0,
    rolesPassed: 0,
    rolesTotal: 0,
    wrapsPassed: 0,
    wrapsTotal: 0,
  })

  const lines = [
    '# Daylens Timeline Evaluation',
    '',
    'Command: `npm run timeline:eval`',
    '',
    `Fixtures: ${results.length}`,
    `Overall score: segmentation ${total.segmentationPassed}/${total.segmentationTotal} | labels ${total.labelsPassed}/${total.labelsTotal} | intent ${total.rolesPassed}/${total.rolesTotal} | wraps ${total.wrapsPassed}/${total.wrapsTotal}`,
    '',
    'This report compares editable offline fixtures against the current Daylens timeline, intent, and deterministic wrap logic.',
    '',
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
const boundaryDefects = results.flatMap((result) => result.boundaryIssues)
if (boundaryDefects.length > 0) {
  console.error(`\nBoundary-reason invariant violated:\n- ${boundaryDefects.join('\n- ')}`)
  process.exitCode = 1
}

// Target-Design invariants (always enforced): a green run must mean the design
// held. kind correctness, no dev apps inside leisure, humanized titles.
const designDefects = results.flatMap((result) =>
  result.designIssues.map((issue) => `${result.fixture.id}: ${issue}`))
if (designDefects.length > 0) {
  console.error(`\nTarget-Design invariant violated:\n- ${designDefects.join('\n- ')}`)
  process.exitCode = 1
}

if (strict) {
  const failed = results.some((result) => (
    result.scores.segmentationPassed !== result.scores.segmentationTotal
    || result.scores.labelsPassed !== result.scores.labelsTotal
    || result.scores.rolesPassed !== result.scores.rolesTotal
    || result.scores.wrapsPassed !== result.scores.wrapsTotal
  ))
  if (failed) process.exitCode = 1
}
