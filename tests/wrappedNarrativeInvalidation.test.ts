// Stored wrap narratives are prose written over one set of facts. When a
// correction, a deletion, or an evidence purge changes a day's facts, the
// narratives covering that day — the day wrap and every week/month/year wrap
// containing it — are dropped at the write seam, so no surface can serve
// lines that contradict the corrected Timeline. Same seams that drop the
// frozen day snapshot; the two caches go stale together.
import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import {
  deleteWrappedNarrativesForDate,
  getStoredWrappedNarrative,
  putStoredWrappedNarrative,
  type WrappedCadence,
} from '../src/main/db/wrappedNarrativeStore.ts'
import {
  invalidateTimelineDayBlocks,
  writeIgnoredBlockReviewBackstop,
  writeTimelineBlockReview,
} from '../src/main/services/workBlocks.ts'
import { DEFAULT_TIMELINE_BLOCK_REVIEW } from '../src/shared/timelineReview.ts'
import type { AppCategory, WorkContextBlock } from '../src/shared/types.ts'

const TEST_DATE = '2026-04-22'

function seedNarrative(db: Database.Database, cadence: WrappedCadence, periodKey: string): void {
  putStoredWrappedNarrative(
    db,
    cadence,
    periodKey,
    { lead: 'A stored lead.', lines: { opening: 'A stored lead.' }, question: null, reflection: null, source: 'ai', factsHash: 'h' },
    'h',
    Date.now(),
  )
}

function has(db: Database.Database, cadence: WrappedCadence, periodKey: string): boolean {
  return getStoredWrappedNarrative(db, cadence, periodKey) != null
}

test('deleteWrappedNarrativesForDate drops exactly the periods containing the date', () => {
  const db = createProductionTestDatabase()

  seedNarrative(db, 'day', TEST_DATE)
  seedNarrative(db, 'day', '2026-04-21')
  // Rolling 7-day week windows keyed by their start date: windows starting
  // six days before through zero days before contain the date; a window
  // ending the day before, or starting the day after, does not.
  seedNarrative(db, 'week', '2026-04-16')
  seedNarrative(db, 'week', '2026-04-19')
  seedNarrative(db, 'week', '2026-04-22')
  seedNarrative(db, 'week', '2026-04-15')
  seedNarrative(db, 'week', '2026-04-23')
  seedNarrative(db, 'month', '2026-04-01')
  seedNarrative(db, 'month', '2026-05-01')
  seedNarrative(db, 'year', '2026-01-01')
  seedNarrative(db, 'year', '2025-01-01')

  deleteWrappedNarrativesForDate(db, TEST_DATE)

  assert.equal(has(db, 'day', TEST_DATE), false, 'the day narrative is gone')
  assert.equal(has(db, 'day', '2026-04-21'), true, 'other days keep theirs')
  assert.equal(has(db, 'week', '2026-04-16'), false)
  assert.equal(has(db, 'week', '2026-04-19'), false)
  assert.equal(has(db, 'week', '2026-04-22'), false)
  assert.equal(has(db, 'week', '2026-04-15'), true, 'a window ending the day before survives')
  assert.equal(has(db, 'week', '2026-04-23'), true, 'a window starting the day after survives')
  assert.equal(has(db, 'month', '2026-04-01'), false)
  assert.equal(has(db, 'month', '2026-05-01'), true)
  assert.equal(has(db, 'year', '2026-01-01'), false)
  assert.equal(has(db, 'year', '2025-01-01'), true)

  db.close()
})

// ─── The correction write seams ───────────────────────────────────────────────

function makeBlock(opts: { label: string; start: number; durationSeconds: number }): WorkContextBlock {
  const category: AppCategory = 'development'
  return {
    id: `b:${opts.label}:${opts.start}`,
    startTime: opts.start,
    endTime: opts.start + opts.durationSeconds * 1000,
    dominantCategory: category,
    categoryDistribution: { [category]: opts.durationSeconds },
    ruleBasedLabel: opts.label,
    aiLabel: null,
    sessions: [],
    topApps: [{ bundleId: 'cursor', appName: 'Cursor', category, totalSeconds: opts.durationSeconds, sessionCount: 1, isBrowser: false }],
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

function seedAllCadences(db: Database.Database): void {
  seedNarrative(db, 'day', TEST_DATE)
  seedNarrative(db, 'week', '2026-04-19')
  seedNarrative(db, 'month', '2026-04-01')
  seedNarrative(db, 'year', '2026-01-01')
}

function assertAllGone(db: Database.Database, seam: string): void {
  assert.equal(has(db, 'day', TEST_DATE), false, `${seam}: day narrative dropped`)
  assert.equal(has(db, 'week', '2026-04-19'), false, `${seam}: containing week dropped`)
  assert.equal(has(db, 'month', '2026-04-01'), false, `${seam}: containing month dropped`)
  assert.equal(has(db, 'year', '2026-01-01'), false, `${seam}: containing year dropped`)
}

test('a block correction drops every stored narrative covering the day', () => {
  const db = createProductionTestDatabase()
  seedAllCadences(db)
  const nineAm = new Date(2026, 3, 22, 9, 0, 0, 0).getTime()
  writeTimelineBlockReview(db, TEST_DATE, makeBlock({ label: 'Auth refactor', start: nineAm, durationSeconds: 3600 }), {
    state: 'corrected',
    correctedLabel: 'Billing refactor',
  })
  assertAllGone(db, 'correction')
  db.close()
})

test('deleting (ignoring) a block drops every stored narrative covering the day', () => {
  const db = createProductionTestDatabase()
  seedAllCadences(db)
  writeIgnoredBlockReviewBackstop(db, {
    date: TEST_DATE,
    blockId: 'ignored_1',
    evidenceKey: 'ignored_1',
    originalBlockJson: JSON.stringify({ startTime: 0, endTime: 1 }),
  })
  assertAllGone(db, 'deletion')
  db.close()
})

test('an evidence purge drops every stored narrative covering the day', () => {
  const db = createProductionTestDatabase()
  seedAllCadences(db)
  invalidateTimelineDayBlocks(db, TEST_DATE)
  assertAllGone(db, 'purge')
  db.close()
})
