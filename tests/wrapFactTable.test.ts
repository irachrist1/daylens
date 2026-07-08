// P0 tests for the one fact table the wrap agent writes from
// (wrapped-agent-plan.md "P0 — data integrity" + "The writing contract").
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDayFactTable,
  buildPeriodFactTable,
  buildGroundableForms,
  checkCopyGrounding,
  type WrapFact,
  type WrapFactTable,
} from '../src/main/lib/wrapFactTable.ts'
import { buildDayWrapFacts, type DayWrapFacts } from '../src/renderer/lib/dayWrapScenes.ts'
import type { AppCategory, AppSession, DayTimelinePayload, WorkContextBlock, WrappedPeriodFacts } from '../src/shared/types.ts'
import { DEFAULT_TIMELINE_BLOCK_REVIEW } from '../src/shared/timelineReview.ts'

// ─── Fixtures (mirrors tests/dayWrapScenes.test.ts) ────────────────────────────

function makeSession(opts: { start: number; durationSeconds: number; category: AppCategory; appName?: string }): AppSession {
  return {
    id: opts.start,
    bundleId: opts.appName ?? 'Test',
    appName: opts.appName ?? 'Test',
    startTime: opts.start,
    endTime: opts.start + opts.durationSeconds * 1000,
    durationSeconds: opts.durationSeconds,
    category: opts.category,
    isFocused: true,
  }
}

function makeBlock(opts: {
  label: string
  start: number
  durationSeconds: number
  category?: AppCategory
  sessions?: AppSession[]
}): WorkContextBlock {
  const category: AppCategory = opts.category ?? 'development'
  return {
    id: `b:${opts.label}:${opts.start}`,
    startTime: opts.start,
    endTime: opts.start + opts.durationSeconds * 1000,
    dominantCategory: category,
    categoryDistribution: { [category]: opts.durationSeconds },
    ruleBasedLabel: opts.label,
    aiLabel: null,
    sessions: opts.sessions ?? [],
    topApps: [],
    websites: [],
    keyPages: [],
    pageRefs: [],
    documentRefs: [],
    topArtifacts: [],
    workflowRefs: [],
    label: {
      current: opts.label,
      source: 'rule',
      confidence: 0.92,
      narrative: null,
      ruleBased: opts.label,
      aiSuggested: null,
      override: null,
    },
    focusOverlap: { totalSeconds: opts.durationSeconds, pct: 100, sessionIds: [] },
    evidenceSummary: { apps: [], pages: [], documents: [], domains: [] },
    heuristicVersion: 'test',
    computedAt: opts.start,
    switchCount: 0,
    confidence: 'high',
    review: { ...DEFAULT_TIMELINE_BLOCK_REVIEW, state: 'auto-approved' },
    isLive: false,
  }
}

function makeDayPayload(blocks: WorkContextBlock[]): DayTimelinePayload {
  const total = blocks.reduce((s, b) => s + Math.round((b.endTime - b.startTime) / 1000), 0)
  return {
    date: '2026-06-23',
    sessions: [],
    websites: [],
    blocks,
    segments: [],
    focusSessions: [],
    computedAt: Date.now(),
    version: 'test',
    totalSeconds: total,
    focusSeconds: total,
    focusPct: 100,
    appCount: 0,
    siteCount: 0,
  }
}

const NINE_AM = new Date('2026-06-23T09:00:00').getTime()
const ELEVEN_15 = new Date('2026-06-23T11:15:00').getTime()

function findFactByPrefix(table: WrapFactTable, prefix: string, suffix: string): WrapFact | undefined {
  return Object.entries(table.facts)
    .find(([id]) => id.startsWith(prefix) && id.endsWith(suffix) && id !== `${prefix}total${suffix}`)?.[1]
}

// ─── Meeting truth (P0 item 3) ──────────────────────────────────────────────────

test('meeting fact equals the block span, not category-weighted active seconds', () => {
  // 11:15am -> 12:28pm is a 73-minute span. Give it sessions that only sum to
  // 49 minutes of active time — mirroring the real Jul 7 bug where the
  // category-weighted seconds under-reported a 73-minute meeting as 49m.
  const meetingBlock = makeBlock({
    label: 'Roadmap sync',
    start: ELEVEN_15,
    durationSeconds: 73 * 60,
    category: 'meetings',
    sessions: [makeSession({ start: ELEVEN_15, durationSeconds: 49 * 60, category: 'meetings' })],
  })
  const facts = buildDayWrapFacts(makeDayPayload([meetingBlock]))
  const table = buildDayFactTable(facts, [meetingBlock], '2026-06-23')

  const durationFact = findFactByPrefix(table, 'meeting.', '.duration')
  assert.ok(durationFact, 'expected a meeting duration fact')
  assert.equal(durationFact!.value, 73 * 60)
  assert.equal(durationFact!.display, '1h 13m')
})

// ─── Consistency invariant (P0 item 2) ─────────────────────────────────────────

test('consistency invariant fires when the split disagrees with the total', () => {
  const contradictory: DayWrapFacts = {
    date: '2026-06-23',
    weekday: 'TUESDAY',
    dateLabel: 'JUN 23',
    workSeconds: 3600,
    leisureSeconds: 3600,
    personalSeconds: 0,
    meetingsSeconds: 0,
    // Should be 7200 (work + leisure + personal) — deliberately wrong.
    activeSeconds: 10800,
    workActivities: [],
    ribbon: [],
    ribbonStartClock: null,
    ribbonEndClock: null,
    standout: null,
    topLeisure: [],
    isLeisureDay: false,
    quality: 'full',
    seed: 1,
    appSites: [],
    candidateHooks: [],
    wildcardHook: null,
    dayStory: [],
    mainStartClock: null,
  }
  assert.throws(() => buildDayFactTable(contradictory, [], '2026-06-23'))
})

test('period consistency invariant fires the same way', () => {
  const contradictory = {
    period: 'week',
    anchorDate: '2026-06-23',
    rangeLabel: 'Jun 16 - Jun 22',
    totalSeconds: 999999,
    workSeconds: 3600,
    leisureSeconds: 0,
    personalSeconds: 0,
    previousPeriodSeconds: 0,
    daysWithActivity: 1,
    dominantWorkCategory: 'development',
    dominantWorkCategoryPct: 100,
    categories: [],
    topApps: [],
    threads: [],
    leisureSurfaces: [],
    busiestDay: null,
    quietestActiveDay: null,
    longestStretch: null,
    buckets: [],
    busiestBucket: null,
    days: [],
    meetingsSeconds: 0,
    dayEdges: [],
  } as unknown as WrappedPeriodFacts
  assert.throws(() => buildPeriodFactTable(contradictory))
})

// ─── Groundable forms ───────────────────────────────────────────────────────────

function durationFact(seconds: number, id = 'd'): WrapFact {
  const display = seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`
  const fact: WrapFact = { id, kind: 'duration', value: seconds, display, groundableForms: [] }
  fact.groundableForms = buildGroundableForms(fact)
  return fact
}

function clockFact(minutes: number, id = 'c'): WrapFact {
  const h24 = Math.floor(minutes / 60)
  const mm = minutes % 60
  const period = h24 >= 12 ? 'pm' : 'am'
  let h12 = h24 % 12
  if (h12 === 0) h12 = 12
  const display = `${h12}:${String(mm).padStart(2, '0')}${period}`
  const fact: WrapFact = { id, kind: 'clock', value: minutes, display, groundableForms: [] }
  fact.groundableForms = buildGroundableForms(fact)
  return fact
}

function countFact(n: number, id = 'n'): WrapFact {
  const fact: WrapFact = { id, kind: 'count', value: n, display: String(n), groundableForms: [] }
  fact.groundableForms = buildGroundableForms(fact)
  return fact
}

function tableOf(...facts: WrapFact[]): WrapFactTable {
  const record: Record<string, WrapFact> = {}
  for (const f of facts) record[f.id] = f
  return { cadence: 'day', periodKey: '2026-06-23', facts: record, factsHash: 'h' }
}

test('rounded-hour approximations ground a 59-minute fact', () => {
  const fact = durationFact(59 * 60)
  assert.ok(fact.groundableForms.includes('about an hour'), fact.groundableForms.join(', '))
  assert.ok(fact.groundableForms.includes('~1 hour'), fact.groundableForms.join(', '))
})

test('a 92-minute fact does not ground "1h 45m"', () => {
  const table = tableOf(durationFact(92 * 60))
  const result = checkCopyGrounding('The sync ran about 1h 45m today.', table, ['d'])
  assert.equal(result.ok, false)
  assert.ok(result.violations.some((v) => v.includes('1h 45m')))
})

test('"five threads" grounds a count of 5', () => {
  const table = tableOf(countFact(5))
  const result = checkCopyGrounding('You picked up five threads today.', table, ['n'])
  assert.equal(result.ok, true, result.violations.join(', '))
})

test('clock rounding: "12:30pm" grounds 12:28, "3:00pm" does not', () => {
  const table = tableOf(clockFact(12 * 60 + 28))
  const near = checkCopyGrounding('You wrapped up around 12:30pm.', table, ['c'])
  assert.equal(near.ok, true, near.violations.join(', '))
  const far = checkCopyGrounding('You wrapped up around 3:00pm.', table, ['c'])
  assert.equal(far.ok, false)
})

// ─── checkCopyGrounding ─────────────────────────────────────────────────────────

test('an uncited number fails with a violation naming the token', () => {
  const table = tableOf(durationFact(30 * 60, 'a'))
  const result = checkCopyGrounding('You spent 45m on it.', table, ['a'])
  assert.equal(result.ok, false)
  assert.ok(result.violations.some((v) => v.includes('45m')))
})

test('prose with no numeric content always passes', () => {
  const table = tableOf(durationFact(30 * 60, 'a'))
  const result = checkCopyGrounding('A couple of tabs, nothing dramatic.', table, [])
  assert.equal(result.ok, true)
  assert.equal(result.violations.length, 0)
})

test('a cited approximation passes', () => {
  const table = tableOf(durationFact(59 * 60, 'a'))
  const result = checkCopyGrounding('That took about an hour.', table, ['a'])
  assert.equal(result.ok, true, result.violations.join(', '))
})

// ─── Period topApps sanitizer routing (P0 item 4) ──────────────────────────────

test('a raw artifact app name never appears in the period fact table; a clean name does', () => {
  const period: WrappedPeriodFacts = {
    period: 'week',
    anchorDate: '2026-06-23',
    rangeLabel: 'Jun 16 - Jun 22',
    totalSeconds: 7200,
    workSeconds: 7200,
    leisureSeconds: 0,
    personalSeconds: 0,
    previousPeriodSeconds: 0,
    daysWithActivity: 1,
    dominantWorkCategory: 'development',
    dominantWorkCategoryPct: 100,
    categories: [],
    topApps: [
      { appName: 'wrapped-agent-plan.mdx.bak | LinkedIn', seconds: 3600 },
      { appName: 'Dia', seconds: 3600 },
    ],
    threads: [],
    leisureSurfaces: [],
    busiestDay: null,
    quietestActiveDay: null,
    longestStretch: null,
    buckets: [],
    busiestBucket: null,
    days: [],
    meetingsSeconds: 0,
    dayEdges: [],
  }
  const table = buildPeriodFactTable(period)
  const labels = Object.values(table.facts).map((f) => f.display)
  assert.ok(!labels.some((l) => l.includes('wrapped-agent-plan')), labels.join(', '))
  assert.ok(labels.includes('Dia'), labels.join(', '))
})

// ─── factsHash stability ────────────────────────────────────────────────────────

test('factsHash is stable across rebuilds of identical input and changes when a duration changes', () => {
  const block = makeBlock({ label: 'Roadmap sync', start: ELEVEN_15, durationSeconds: 73 * 60, category: 'meetings' })
  const facts = buildDayWrapFacts(makeDayPayload([block]))
  const t1 = buildDayFactTable(facts, [block], '2026-06-23')
  const t2 = buildDayFactTable(facts, [block], '2026-06-23')
  assert.equal(t1.factsHash, t2.factsHash)

  const otherBlock = makeBlock({ label: 'Roadmap sync', start: ELEVEN_15, durationSeconds: 40 * 60, category: 'meetings' })
  const otherFacts = buildDayWrapFacts(makeDayPayload([otherBlock]))
  const t3 = buildDayFactTable(otherFacts, [otherBlock], '2026-06-23')
  assert.notEqual(t1.factsHash, t3.factsHash)
})
