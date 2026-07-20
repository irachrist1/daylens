// The weekly brief can never disagree with the week wrap it opens (briefs.md:
// one fact system). Its content path mirrors the evening recap's: the wrap's
// own AI lead when a provider can write it — generated or verified fresh at
// delivery time (onStale 'regenerate') — else the deterministic fact-only
// weekly line summed from the same frozen daily snapshots the wrap shows,
// else silence. Every number in the fact-only line must ground in the
// period's fact table.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { clearTestDb, setTestDb } from './support/database-stub.mjs'
import { getWrappedPeriodWrap, buildWrappedPeriodFacts } from '../src/main/services/wrappedPeriodNarrative.ts'
import { computePeriodFactsHash, factOnlyWeeklyLine } from '../src/main/lib/wrappedPeriodNarrative.ts'
import { buildPeriodFactTable, firstUngroundedNumericToken, groundingFormsForRuntime } from '../src/main/lib/wrapFactTable.ts'
import { buildDaySnapshot } from '../src/main/lib/daySnapshot.ts'
import { upsertDaySnapshot } from '../src/main/db/queries.ts'
import { computePeriodRange } from '../src/main/lib/wrappedPeriodRange.ts'
import { getStoredWrappedNarrative, putStoredWrappedNarrative } from '../src/main/db/wrappedNarrativeStore.ts'
import { localDateString, shiftLocalDateString } from '../src/main/lib/localDate.ts'
import { formatHm } from '../src/renderer/lib/dayWrapScenes.ts'
import { DEFAULT_TIMELINE_BLOCK_REVIEW } from '../src/shared/timelineReview.ts'
import type {
  AppCategory,
  DayTimelinePayload,
  WorkContextBlock,
  WrappedPeriodNarrative,
} from '../src/shared/types.ts'
import type Database from 'better-sqlite3'

// The completed week under test ends yesterday — every day is a past day, so
// its frozen snapshots are served as stored (the closed-period path the
// Monday-morning brief actually reads).
const ANCHOR = shiftLocalDateString(localDateString(new Date()), -1)

function dayMs(dateStr: string, hour: number, minute = 0): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, hour, minute, 0, 0).getTime()
}

function makeBlock(opts: {
  date: string
  label: string
  startHour: number
  durationSeconds: number
  category?: AppCategory
  appName?: string
}): WorkContextBlock {
  const category: AppCategory = opts.category ?? 'development'
  const appName = opts.appName ?? 'Cursor'
  const start = dayMs(opts.date, opts.startHour)
  return {
    id: `b:${opts.date}:${opts.label}:${start}`,
    startTime: start,
    endTime: start + opts.durationSeconds * 1000,
    dominantCategory: category,
    categoryDistribution: { [category]: opts.durationSeconds },
    ruleBasedLabel: opts.label,
    aiLabel: null,
    sessions: [],
    topApps: [{ bundleId: appName.toLowerCase(), appName, category, totalSeconds: opts.durationSeconds, sessionCount: 1, isBrowser: false }],
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
    computedAt: start,
    switchCount: 0,
    confidence: 'high',
    review: { ...DEFAULT_TIMELINE_BLOCK_REVIEW, state: 'auto-approved' },
    isLive: false,
  }
}

function makeDayPayload(date: string, blocks: WorkContextBlock[]): DayTimelinePayload {
  const total = blocks.reduce((s, b) => s + Math.round((b.endTime - b.startTime) / 1000), 0)
  return {
    date,
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

/** Freeze a realistic 5-active-day week into day_snapshots — the single source
 *  the weekly wrap (and therefore the weekly brief) reads. */
function seedWeekSnapshots(db: Database.Database): void {
  // Five active days: anchor-6 .. anchor-2 (the last two days stay empty).
  for (let offset = 6; offset >= 2; offset -= 1) {
    const date = shiftLocalDateString(ANCHOR, -offset)
    const payload = makeDayPayload(date, [
      makeBlock({ date, label: 'The notification rebuild', startHour: 9, durationSeconds: 150 * 60 }),
      makeBlock({ date, label: 'Design review', startHour: 14, durationSeconds: 45 * 60, category: 'design', appName: 'Figma' }),
    ])
    const snapshot = { ...buildDaySnapshot(payload), finalizedAt: Date.now() }
    upsertDaySnapshot(db, snapshot)
  }
}

const STORED_WEEK_LEAD = 'A week carried by the notification rebuild, steady and unhurried.'

function storedWeekNarrative(factsHash: string): WrappedPeriodNarrative {
  return {
    period: 'week',
    lead: STORED_WEEK_LEAD,
    lines: { opening: STORED_WEEK_LEAD },
    question: null,
    reflection: null,
    source: 'ai',
    factsHash,
  }
}

test('a stored week wrap whose facts still hold IS the weekly brief: same lead, no regeneration', async () => {
  const db = createProductionTestDatabase()
  setTestDb(db)
  try {
    seedWeekSnapshots(db)
    const facts = buildWrappedPeriodFacts('week', ANCHOR)
    assert.ok(facts.totalSeconds > 0, 'the seeded week has real totals')
    const factsHash = computePeriodFactsHash(facts)
    const periodKey = computePeriodRange('week', ANCHOR).startDate
    const generatedAt = Date.now() - 3_600_000
    putStoredWrappedNarrative(db, 'week', periodKey, storedWeekNarrative(factsHash), factsHash, generatedAt)

    const { narrative } = await getWrappedPeriodWrap('week', ANCHOR, { triggerSource: 'system', onStale: 'regenerate' })
    assert.equal(narrative.source, 'ai')
    assert.equal(narrative.lead, STORED_WEEK_LEAD, 'the notification line is the stored wrap lead, verbatim')
    assert.equal(narrative.generatedAt, generatedAt, 'served as stored, not regenerated')
  } finally {
    clearTestDb()
    db.close()
  }
})

test('delivery of a drifted week wrap without a provider yields the fallback — silence, never a stale line', async () => {
  const db = createProductionTestDatabase()
  setTestDb(db)
  try {
    seedWeekSnapshots(db)
    const periodKey = computePeriodRange('week', ANCHOR).startDate
    putStoredWrappedNarrative(db, 'week', periodKey, storedWeekNarrative('stale-hash'), 'stale-hash', Date.now())

    const { narrative } = await getWrappedPeriodWrap('week', ANCHOR, { triggerSource: 'system', onStale: 'regenerate' })
    assert.equal(narrative.source, 'fallback',
      'not AI output → the notifier fires the fact-only line or nothing, never the stale stored lead')
    assert.notEqual(narrative.lead, STORED_WEEK_LEAD)

    const stored = getStoredWrappedNarrative<WrappedPeriodNarrative>(db, 'week', periodKey)
    assert.equal(stored?.narrative.lead, STORED_WEEK_LEAD,
      'a failed delivery-time regeneration does not clobber the stored wrap')
  } finally {
    clearTestDb()
    db.close()
  }
})

test('an in-app open of the same drifted closed week still re-grounds instead of spending a call', async () => {
  const db = createProductionTestDatabase()
  setTestDb(db)
  try {
    seedWeekSnapshots(db)
    const periodKey = computePeriodRange('week', ANCHOR).startDate
    const generatedAt = Date.now() - 3_600_000
    putStoredWrappedNarrative(db, 'week', periodKey, storedWeekNarrative('stale-hash'), 'stale-hash', generatedAt)

    // Default (reconcile): the numberless stored lead survives re-grounding.
    const { narrative } = await getWrappedPeriodWrap('week', ANCHOR, { triggerSource: 'user' })
    assert.equal(narrative.source, 'ai')
    assert.equal(narrative.lead, STORED_WEEK_LEAD)
    assert.equal(narrative.generatedAt, generatedAt)
  } finally {
    clearTestDb()
    db.close()
  }
})

// ─── The fact-only weekly line (fallback order: fact-only, then silence) ─────

test('the fact-only weekly line speaks only numbers the period fact table grounds', async () => {
  const db = createProductionTestDatabase()
  setTestDb(db)
  try {
    seedWeekSnapshots(db)
    const facts = buildWrappedPeriodFacts('week', ANCHOR)
    const line = factOnlyWeeklyLine(facts)
    assert.ok(line, 'a real week has a fact-only line')
    assert.ok(line!.includes(formatHm(facts.totalSeconds)), 'the line carries the summed frozen-snapshot total')
    assert.ok(line!.includes(`${facts.daysWithActivity} tracked days`), 'the line names the real active-day count')

    const table = buildPeriodFactTable(facts)
    const forms = groundingFormsForRuntime(table, '')
    assert.equal(
      firstUngroundedNumericToken(line!, forms),
      null,
      'every number in the notification line is a period fact-table fact',
    )
  } finally {
    clearTestDb()
    db.close()
  }
})

test('an empty week yields no line at all: silence over invention', async () => {
  const db = createProductionTestDatabase()
  setTestDb(db)
  try {
    const facts = buildWrappedPeriodFacts('week', ANCHOR)
    assert.equal(facts.totalSeconds, 0)
    assert.equal(factOnlyWeeklyLine(facts), null)
  } finally {
    clearTestDb()
    db.close()
  }
})

test('the fact-only weekly line reflects a deletion: corrected facts in, corrected line out', async () => {
  const db = createProductionTestDatabase()
  setTestDb(db)
  try {
    seedWeekSnapshots(db)
    const before = factOnlyWeeklyLine(buildWrappedPeriodFacts('week', ANCHOR))

    // A deletion re-freezes one day smaller (the correction path drops the
    // snapshot and the next read rebuilds; here we freeze the corrected day
    // directly — same table, same reader).
    const date = shiftLocalDateString(ANCHOR, -3)
    const corrected = makeDayPayload(date, [
      makeBlock({ date, label: 'The notification rebuild', startHour: 9, durationSeconds: 30 * 60 }),
    ])
    upsertDaySnapshot(db, { ...buildDaySnapshot(corrected), finalizedAt: Date.now() })

    const after = factOnlyWeeklyLine(buildWrappedPeriodFacts('week', ANCHOR))
    assert.ok(before && after)
    assert.notEqual(before, after, 'deleted evidence changes the notification line with the week')
  } finally {
    clearTestDb()
    db.close()
  }
})
