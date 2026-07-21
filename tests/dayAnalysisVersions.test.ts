// Versioned day analysis (DEV-206). Every AI analysis of a day is an
// append-only version: reproducible (tied to the facts hash + model + prompt
// version), inspectable (old versions and their payloads stay readable), and
// honest about change (a correction retires the current version and the next
// generation names it as its reason — never silent divergence).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { clearTestDb, setTestDb } from './support/database-stub.mjs'
import {
  appendDayAnalysisVersion,
  getDayAnalysisVersionPayload,
  listDayAnalysisVersions,
  retireDayAnalysisVersionsForDate,
} from '../src/main/db/dayAnalysisVersions.ts'
import { deleteWrappedNarrativesForDate } from '../src/main/db/wrappedNarrativeStore.ts'
import { getWrappedNarrative } from '../src/main/services/wrappedNarrative.ts'
import { analyzeTimelineDay, ANALYZE_DAY_PROMPT_VERSION } from '../src/main/services/analyzeDay.ts'
import { materializeTimelineDayProjection } from '../src/main/core/query/projections.ts'
import {
  SYNC_ALLOWLIST_KEY_SCHEMA_PAIRS,
  SyncAllowlistViolation,
  assertSyncPayloadAllowed,
} from '../src/shared/syncAllowlist/index.ts'
import { makeCleanRemoteSyncPayload } from './support/remoteSyncPayloadFixture.ts'
import type Database from 'better-sqlite3'
import type { AppCategory, DayTimelinePayload } from '../src/shared/types.ts'

const DATE = '2026-04-22'

function baseInput(over: Record<string, unknown> = {}) {
  return {
    kind: 'day' as const,
    periodKey: DATE,
    factsHash: 'hash-a',
    model: 'test-model-1',
    promptVersion: 1,
    triggerSource: 'user',
    source: 'ai' as const,
    payload: { lead: 'A steady day on the auth work.' },
    ...over,
  }
}

// ─── The append-only ledger ───────────────────────────────────────────────────

test('versions append 1, 2, 3 with derived reasons, and old versions stay inspectable', () => {
  const db = createProductionTestDatabase()
  try {
    assert.equal(appendDayAnalysisVersion(db, baseInput()), 1)
    assert.equal(
      appendDayAnalysisVersion(db, baseInput({ factsHash: 'hash-b', payload: { lead: 'Rewritten over new facts.' } })),
      2,
    )

    const versions = listDayAnalysisVersions(db, 'day', DATE)
    assert.equal(versions.length, 2)
    assert.deepEqual(versions.map((v) => v.version), [2, 1], 'newest first')
    assert.equal(versions[1].reason, 'initial')
    assert.equal(versions[0].reason, 'facts-changed', 'a facts-hash move is named as the reason')
    assert.equal(versions[0].model, 'test-model-1')
    assert.equal(versions[0].factsHash, 'hash-b')
    assert.equal(versions[1].lead, 'A steady day on the auth work.')

    // The OLD version's full payload is still readable — inspectable forever.
    const old = getDayAnalysisVersionPayload(db, 'day', DATE, 1) as { lead: string }
    assert.equal(old.lead, 'A steady day on the auth work.')
  } finally {
    db.close()
  }
})

test('re-serving the same analysis appends nothing: identical facts + payload is not a new version', () => {
  const db = createProductionTestDatabase()
  try {
    assert.equal(appendDayAnalysisVersion(db, baseInput()), 1)
    assert.equal(appendDayAnalysisVersion(db, baseInput()), null, 'no-op re-persist adds no noise')
    assert.equal(listDayAnalysisVersions(db, 'day', DATE).length, 1)

    // Same facts but genuinely different prose (an explicit regenerate) IS a
    // new version, with the explicit reason winning.
    assert.equal(
      appendDayAnalysisVersion(db, baseInput({ payload: { lead: 'Same facts, new words.' }, reason: 'manual-regenerate' })),
      2,
    )
    assert.equal(listDayAnalysisVersions(db, 'day', DATE)[0].reason, 'manual-regenerate')
  } finally {
    db.close()
  }
})

// ─── Corrections retire, never erase ─────────────────────────────────────────

test('a correction retires the current version, and the next generation names the correction as its reason', () => {
  const db = createProductionTestDatabase()
  try {
    appendDayAnalysisVersion(db, baseInput())
    appendDayAnalysisVersion(db, baseInput({ factsHash: 'hash-b', payload: { lead: 'Second take.' } }))

    // The correction path (writeTimelineBlockReview → deleteWrappedNarrativesForDate).
    deleteWrappedNarrativesForDate(db, DATE, 'correction')

    const afterRetire = listDayAnalysisVersions(db, 'day', DATE)
    assert.equal(afterRetire.length, 2, 'retirement erases nothing')
    assert.equal(afterRetire[0].retiredReason, 'correction', 'the CURRENT version is retired, with the reason')
    assert.ok(afterRetire[0].retiredAt, 'retirement is timestamped')
    assert.equal(afterRetire[1].retiredAt, null, 'older versions are already history; only the current one retires')

    // The next generation is visibly a new version because of the correction.
    appendDayAnalysisVersion(db, baseInput({ factsHash: 'hash-c', payload: { lead: 'Corrected take.' } }))
    const latest = listDayAnalysisVersions(db, 'day', DATE)[0]
    assert.equal(latest.version, 3)
    assert.equal(latest.reason, 'correction', 'why it changed is on the record, not inferred')
  } finally {
    db.close()
  }
})

test('retirement reaches every period containing the day (week/month/year keys), and deletions carry their own reason', () => {
  const db = createProductionTestDatabase()
  try {
    // A week wrap keyed 3 days before DATE contains it; one keyed 8 days
    // before does not.
    appendDayAnalysisVersion(db, baseInput({ kind: 'week', periodKey: '2026-04-19' }))
    appendDayAnalysisVersion(db, baseInput({ kind: 'week', periodKey: '2026-04-13' }))
    appendDayAnalysisVersion(db, baseInput({ kind: 'month', periodKey: '2026-04-01' }))
    appendDayAnalysisVersion(db, baseInput({ kind: 'timeline', periodKey: DATE, source: 'deterministic', model: null }))

    retireDayAnalysisVersionsForDate(db, DATE, 'deletion')

    assert.equal(listDayAnalysisVersions(db, 'week', '2026-04-19')[0].retiredReason, 'deletion')
    assert.equal(listDayAnalysisVersions(db, 'week', '2026-04-13')[0].retiredReason, null,
      'a week that does not contain the day is untouched')
    assert.equal(listDayAnalysisVersions(db, 'month', '2026-04-01')[0].retiredReason, 'deletion')
    assert.equal(listDayAnalysisVersions(db, 'timeline', DATE)[0].retiredReason, 'deletion')
  } finally {
    db.close()
  }
})

// ─── End to end through the wrap service ─────────────────────────────────────

function emptyDayPayload(): DayTimelinePayload {
  return {
    date: DATE,
    sessions: [],
    websites: [],
    blocks: [],
    segments: [],
    focusSessions: [],
    computedAt: Date.now(),
    version: 'test',
    totalSeconds: 0,
    focusSeconds: 0,
    focusPct: 0,
    appCount: 0,
    siteCount: 0,
  }
}

test('every persisted wrap is a ledger version; a correction makes the next one say why', async () => {
  const db = createProductionTestDatabase()
  setTestDb(db)
  try {
    // First generation (the honest empty-day fallback persists like any wrap).
    await getWrappedNarrative(emptyDayPayload())
    let versions = listDayAnalysisVersions(db, 'day', DATE)
    assert.equal(versions.length, 1)
    assert.equal(versions[0].reason, 'initial')
    assert.equal(versions[0].source, 'fallback')
    assert.equal(versions[0].model, null, 'deterministic output records no model')

    // Re-opening the same day re-serves the stored wrap: no new version.
    await getWrappedNarrative(emptyDayPayload())
    assert.equal(listDayAnalysisVersions(db, 'day', DATE).length, 1)

    // A correction on the day retires the current version and drops the
    // stored wrap; the next generation appends v2 with the reason attached.
    deleteWrappedNarrativesForDate(db, DATE, 'correction')
    await getWrappedNarrative(emptyDayPayload())
    versions = listDayAnalysisVersions(db, 'day', DATE)
    assert.equal(versions.length, 2)
    assert.equal(versions[0].reason, 'correction')
    assert.equal(versions[1].retiredReason, 'correction')
  } finally {
    clearTestDb()
    db.close()
  }
})

// ─── The timeline analysis run is versioned too ──────────────────────────────

function insertSession(
  db: Database.Database,
  title: string,
  startMinute: number,
  durationMinutes: number,
  category: AppCategory = 'browsing',
): void {
  const startTime = new Date(2026, 3, 22, 9, startMinute, 0, 0).getTime()
  const endTime = startTime + durationMinutes * 60_000
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, capture_source, capture_version
    ) VALUES ('com.google.Chrome', 'Google Chrome', ?, ?, ?, ?, 1, ?, 'Google Chrome', 'test', 1)
  `).run(startTime, endTime, durationMinutes * 60, category, title)
}

test('a regroup/relabel run that changes the day appends a timeline analysis version', async () => {
  const db = createProductionTestDatabase()
  setTestDb(db)
  try {
    insertSession(db, 'Camera comparison research - Google Search - Google Chrome', 0, 12)
    insertSession(db, 'Camera comparison research - DPReview - Google Chrome', 12, 10)
    insertSession(db, 'City council election results - Local News - Google Chrome', 22, 12)
    insertSession(db, 'City council election results - Analysis - Google Chrome', 34, 10)
    materializeTimelineDayProjection(db, DATE, null)

    const result = await analyzeTimelineDay(db, DATE, {
      triggerSource: 'background',
      regroupPlan: async (blocks) => [blocks.map((_, index) => index)],
      blockInsight: async () => ({ label: 'Researching cameras and local news', narrative: 'Merged intent.' }),
    })
    assert.equal(result.changed, true)

    const versions = listDayAnalysisVersions(db, 'timeline', DATE)
    assert.equal(versions.length, 1, 'a state-writing analysis run is one version')
    assert.equal(versions[0].reason, 'initial')
    assert.equal(versions[0].promptVersion, ANALYZE_DAY_PROMPT_VERSION)
    assert.equal(versions[0].triggerSource, 'background')
    assert.ok(versions[0].factsHash, 'tied to the day facts hash the wraps key on')
    const payload = getDayAnalysisVersionPayload(db, 'timeline', DATE, 1) as { blockLabels: string[]; merged: boolean }
    assert.equal(payload.merged, true)
    assert.ok(payload.blockLabels.includes('Researching cameras and local news'),
      'what the analysis said is on the record')

    // Re-running with nothing to change appends nothing — no divergence, no row.
    const second = await analyzeTimelineDay(db, DATE, {
      triggerSource: 'background',
      regroupPlan: async () => [],
      blockInsight: async () => ({ label: 'unused', narrative: null }),
    })
    if (!second.changed) {
      assert.equal(listDayAnalysisVersions(db, 'timeline', DATE).length, 1)
    }
  } finally {
    clearTestDb()
    db.close()
  }
})

// ─── Sync allowlist proof: the ledger is local, it never rides a sync payload ─

test('day analysis versions can never ride a remote sync payload', () => {
  assert.ok(
    !SYNC_ALLOWLIST_KEY_SCHEMA_PAIRS.some((pair) => /analysis/i.test(pair.name)),
    'no allowlist schema exists for analysis versions',
  )
  const dirty = {
    ...makeCleanRemoteSyncPayload(),
    dayAnalysisVersions: [{ lead: 'A steady day on the auth work.', model: 'test-model-1' }],
  }
  assert.throws(
    () => assertSyncPayloadAllowed(dirty),
    (error: unknown) => {
      assert.ok(error instanceof SyncAllowlistViolation)
      assert.ok(
        error.violations.some((item) => item.class === 'extra_field'
          && (item.path.includes('dayAnalysisVersions') || item.detail?.includes('dayAnalysisVersions'))),
        'expected extra_field violation for dayAnalysisVersions',
      )
      return true
    },
  )
})
