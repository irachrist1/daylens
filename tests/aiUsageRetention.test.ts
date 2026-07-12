// AI-telemetry retention (W1-B / storage audit): ai_usage_events grew forever
// (888k rows, ~364 MB with indexes in the founder's real DB — 55% of the
// file) because nothing pruned it. The retention job keeps recent per-event
// detail and rolls older rows into per-day aggregates, and this suite proves
// the one contract that matters: everything the Settings → Usage screen and
// the CSV export read is EXACTLY preserved across the rollup, the expired
// detail rows are gone, and nothing else in the DB is touched.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { setTestDb, clearTestDb } from './support/database-stub.mjs'
import {
  AI_USAGE_DETAIL_RETENTION_DAYS,
  aiUsageRetentionCutoff,
  maybeRunScheduledAIUsageRetention,
  rollupExpiredAIUsageEventsBatch,
  runAIUsageRetention,
} from '../src/main/services/aiUsageRetention.ts'
import { localUsage, exportUsageRows } from '../src/main/services/billing.ts'
import { startAIUsageEvent, finishAIUsageEvent } from '../src/main/db/queries.ts'
import { maintenanceRunAt } from '../src/main/db/maintenance.ts'

const NOW = new Date(2026, 6, 11, 12, 0, 0, 0).getTime()
const DAY_MS = 86_400_000

function makeDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  return db
}

interface EventSpec {
  id: string
  daysAgo: number
  jobType?: string
  triggerSource?: string
  provider?: string | null
  model?: string | null
  success?: boolean
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  costUsd?: number | null
  billingMode?: string
}

function insertEvent(db: InstanceType<typeof Database>, spec: EventSpec): void {
  const startedAt = NOW - spec.daysAgo * DAY_MS
  startAIUsageEvent(db, {
    id: spec.id,
    jobType: spec.jobType ?? 'block_cleanup_relabel',
    screen: 'background',
    triggerSource: spec.triggerSource ?? 'background',
    provider: spec.provider === undefined ? 'google' : spec.provider,
    model: spec.model === undefined ? 'gemini-3.1-flash-lite' : spec.model,
    startedAt,
  })
  finishAIUsageEvent(db, {
    id: spec.id,
    provider: spec.provider === undefined ? 'google' : spec.provider,
    model: spec.model === undefined ? 'gemini-3.1-flash-lite' : spec.model,
    success: spec.success ?? true,
    failureReason: spec.success === false ? 'quota' : null,
    completedAt: startedAt + 900,
    latencyMs: 900,
    inputTokens: spec.inputTokens ?? 100,
    outputTokens: spec.outputTokens ?? 20,
    cacheReadTokens: spec.cacheReadTokens ?? 0,
    cacheWriteTokens: spec.cacheWriteTokens ?? 0,
    cacheHit: false,
    costUsd: spec.costUsd ?? null,
    billingMode: spec.billingMode ?? 'own_key',
  })
}

function seedMixedHistory(db: InstanceType<typeof Database>): void {
  // Old rows — beyond the retention window, spanning several days, job types,
  // providers, outcomes, a NULL provider/model row, and a provider-priced row.
  insertEvent(db, { id: 'old-1', daysAgo: 120, jobType: 'block_cleanup_relabel', success: false, inputTokens: 500, outputTokens: 0 })
  insertEvent(db, { id: 'old-2', daysAgo: 120, jobType: 'block_cleanup_relabel', success: false, inputTokens: 500, outputTokens: 0 })
  insertEvent(db, { id: 'old-3', daysAgo: 120, jobType: 'block_label_finalize', success: true, inputTokens: 800, outputTokens: 60 })
  insertEvent(db, { id: 'old-4', daysAgo: 119, jobType: 'day_summary', triggerSource: 'user', provider: 'anthropic', model: 'claude-haiku-4-5-20251001', inputTokens: 1200, outputTokens: 400 })
  insertEvent(db, { id: 'old-5', daysAgo: 110, provider: null, model: null, success: false, inputTokens: 0, outputTokens: 0 })
  insertEvent(db, { id: 'old-6', daysAgo: 100, jobType: 'chat_answer', triggerSource: 'user', provider: 'anthropic', model: 'claude-sonnet-4-6', inputTokens: 5000, outputTokens: 900, cacheReadTokens: 300, cacheWriteTokens: 50, costUsd: 0.031, billingMode: 'subscription' })

  // Recent rows — inside the retention window; must survive untouched.
  insertEvent(db, { id: 'new-1', daysAgo: 5, jobType: 'chat_answer', triggerSource: 'user', provider: 'anthropic', model: 'claude-sonnet-4-6', inputTokens: 900, outputTokens: 150 })
  insertEvent(db, { id: 'new-2', daysAgo: 1, jobType: 'block_label_finalize', inputTokens: 300, outputTokens: 30 })
}

// Everything the Usage screen reads, in comparable form. hourlyPoints are
// compared as sums: the rollup collapses hour buckets into day buckets by
// design (sub-day granularity only matters inside the detail window).
function usageSnapshot(db: InstanceType<typeof Database>, from: number, to: number) {
  setTestDb(db)
  try {
    const report = localUsage(from, to)
    return {
      totalSpendUsd: report.totalSpendUsd.toFixed(9),
      totalTokens: report.totalTokens,
      totalCalls: report.totalCalls,
      failedCalls: report.failedCalls,
      backgroundCalls: report.backgroundCalls,
      backgroundTokens: report.backgroundTokens,
      freeCreditUsedUsd: report.freeCreditUsedUsd.toFixed(9),
      paidSpendUsd: report.paidSpendUsd.toFixed(9),
      points: report.points.map((p) => ({ ...p, spendUsd: p.spendUsd.toFixed(9) })),
      featurePoints: (report.featurePoints ?? []).map((p) => ({ ...p, spendUsd: p.spendUsd.toFixed(9) })),
      jobSummaries: (report.jobSummaries ?? [])
        .map((s) => ({ ...s, costUsd: (s.costUsd ?? 0).toFixed(9) }))
        .sort((a, b) => `${a.feature}|${a.provider}|${a.model}|${a.triggerSource}`.localeCompare(`${b.feature}|${b.provider}|${b.model}|${b.triggerSource}`)),
      hourlyCallSum: (report.hourlyPoints ?? []).reduce((sum, p) => sum + p.calls, 0),
      hourlyTokenSum: (report.hourlyPoints ?? []).reduce((sum, p) => sum + p.tokens, 0),
    }
  } finally {
    clearTestDb()
  }
}

test('cutoff is the local midnight N days back — detail inside the window is never touched', () => {
  const cutoff = aiUsageRetentionCutoff(NOW)
  const cutoffDate = new Date(cutoff)
  assert.equal(cutoffDate.getHours(), 0)
  assert.equal(cutoffDate.getMinutes(), 0)
  assert.ok(NOW - cutoff >= AI_USAGE_DETAIL_RETENTION_DAYS * DAY_MS)
  assert.ok(NOW - cutoff < (AI_USAGE_DETAIL_RETENTION_DAYS + 2) * DAY_MS)

  const db = makeDb()
  insertEvent(db, { id: 'edge-old', daysAgo: 0 })
  db.prepare('UPDATE ai_usage_events SET started_at = ? WHERE id = ?').run(cutoff - 1, 'edge-old')
  insertEvent(db, { id: 'edge-new', daysAgo: 0 })
  db.prepare('UPDATE ai_usage_events SET started_at = ? WHERE id = ?').run(cutoff, 'edge-new')

  rollupExpiredAIUsageEventsBatch(db, cutoff)
  const remaining = db.prepare('SELECT id FROM ai_usage_events ORDER BY id').all() as { id: string }[]
  assert.deepEqual(remaining.map((r) => r.id), ['edge-new'])
  db.close()
})

test('rollup preserves every aggregate the Usage screen shows, and deletes the expired detail rows', async () => {
  const db = makeDb()
  seedMixedHistory(db)

  const from = NOW - 130 * DAY_MS
  const to = NOW + DAY_MS
  const before = usageSnapshot(db, from, to)

  setTestDb(db)
  const result = await runAIUsageRetention(db, { now: NOW })
  clearTestDb()

  assert.equal(result.rolledRows, 6)
  const after = usageSnapshot(db, from, to)
  assert.deepEqual(after, before)

  // The expired detail rows are gone; the recent ones are untouched.
  const remaining = db.prepare('SELECT id FROM ai_usage_events ORDER BY started_at').all() as { id: string }[]
  assert.deepEqual(remaining.map((r) => r.id), ['new-1', 'new-2'])

  // And the rollup actually holds the old days.
  const rollupRows = db.prepare('SELECT COUNT(*) AS n, SUM(calls) AS calls FROM ai_usage_daily_rollup').get() as { n: number; calls: number }
  assert.equal(rollupRows.calls, 6)
  assert.ok(rollupRows.n >= 4) // several distinct day/job/provider groups

  // Idempotent: a second pass finds nothing and changes nothing.
  setTestDb(db)
  const second = await runAIUsageRetention(db, { now: NOW })
  clearTestDb()
  assert.equal(second.rolledRows, 0)
  assert.deepEqual(usageSnapshot(db, from, to), before)
  db.close()
})

test('small batches spanning a single day still accumulate exactly once (crash-safe batching)', async () => {
  const db = makeDb()
  for (let i = 0; i < 10; i += 1) {
    insertEvent(db, { id: `storm-${i}`, daysAgo: 100, inputTokens: 100, outputTokens: 10, success: i % 2 === 0 })
  }
  const from = NOW - 130 * DAY_MS
  const to = NOW + DAY_MS
  const before = usageSnapshot(db, from, to)

  setTestDb(db)
  const result = await runAIUsageRetention(db, { now: NOW, batchSize: 3 })
  clearTestDb()

  assert.equal(result.rolledRows, 10)
  assert.ok(result.batches >= 4)
  assert.deepEqual(usageSnapshot(db, from, to), before)

  const rollup = db.prepare('SELECT calls, successes, failures FROM ai_usage_daily_rollup').all() as { calls: number; successes: number; failures: number }[]
  assert.equal(rollup.reduce((sum, r) => sum + r.calls, 0), 10)
  assert.equal(rollup.reduce((sum, r) => sum + r.successes, 0), 5)
  assert.equal(rollup.reduce((sum, r) => sum + r.failures, 0), 5)
  db.close()
})

test('CSV export still covers rolled-up days: aggregate lines carry exact call/failure counts and token sums', async () => {
  const db = makeDb()
  seedMixedHistory(db)

  const from = NOW - 130 * DAY_MS
  const to = NOW + DAY_MS

  setTestDb(db)
  try {
    const beforeRows = exportUsageRows(from, to)
    const beforeTokens = beforeRows.reduce((sum, r) => sum + (r.tokens ?? 0), 0)
    const beforeCalls = beforeRows.reduce((sum, r) => sum + (r.calls ?? 1), 0)
    const beforeFailures = beforeRows.reduce((sum, r) => sum + (r.failures ?? (r.success ? 0 : 1)), 0)

    await runAIUsageRetention(db, { now: NOW })

    const afterRows = exportUsageRows(from, to)
    assert.equal(afterRows.reduce((sum, r) => sum + (r.tokens ?? 0), 0), beforeTokens)
    assert.equal(afterRows.reduce((sum, r) => sum + (r.calls ?? 1), 0), beforeCalls)
    assert.equal(afterRows.reduce((sum, r) => sum + (r.failures ?? (r.success ? 0 : 1)), 0), beforeFailures)

    // Rolled days appear as aggregate lines, oldest first like the raw export.
    const aggregate = afterRows.filter((r) => r.id.startsWith('rollup:'))
    assert.ok(aggregate.length >= 4)
    assert.ok(aggregate.some((r) => (r.calls ?? 0) > 1))
    // The provider-priced old row keeps its provider-reported cost.
    const priced = aggregate.find((r) => r.feature === 'chat_answer')
    assert.ok(priced)
    assert.equal(priced.costUsd, 0.031)
    assert.equal(priced.costSource, 'provider')
  } finally {
    clearTestDb()
  }
  db.close()
})

test('retention touches ONLY ai_usage_events — corrections and user data are never involved', async () => {
  const db = makeDb()
  seedMixedHistory(db)

  // Representative user-owned rows in other tables.
  db.prepare(`
    INSERT INTO timeline_blocks (id, date, start_time, end_time, block_kind, dominant_category, label_current, label_source, heuristic_version, computed_at)
    VALUES ('blk-1', '2026-03-01', ?, ?, 'work', 'development', 'Deep work on daylens', 'user', 'v1', ?)
  `).run(NOW - 120 * DAY_MS, NOW - 120 * DAY_MS + 3_600_000, NOW)
  db.prepare(`INSERT INTO category_overrides (bundle_id, category, updated_at) VALUES ('com.example.app', 'development', ?)`).run(NOW)
  db.prepare(`
    INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec, category)
    VALUES ('com.example.app', 'Example', ?, ?, 3600, 'development')
  `).run(NOW - 120 * DAY_MS, NOW - 120 * DAY_MS + 3_600_000)

  setTestDb(db)
  await runAIUsageRetention(db, { now: NOW })
  clearTestDb()

  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM timeline_blocks').get() as { n: number }).n, 1)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM category_overrides').get() as { n: number }).n, 1)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM app_sessions').get() as { n: number }).n, 1)
  const block = db.prepare(`SELECT label_current, label_source FROM timeline_blocks WHERE id = 'blk-1'`).get() as { label_current: string; label_source: string }
  assert.equal(block.label_current, 'Deep work on daylens')
  assert.equal(block.label_source, 'user')
  db.close()
})

test('the scheduled wrapper runs at most once per day (maintenance_runs gate)', async () => {
  const db = makeDb()
  seedMixedHistory(db)
  setTestDb(db)
  try {
    const first = await maybeRunScheduledAIUsageRetention(NOW)
    assert.ok(first)
    assert.equal(first.rolledRows, 6)
    assert.equal(maintenanceRunAt(db, 'ai_usage_retention_daily'), NOW)

    // Same day: gated off.
    const again = await maybeRunScheduledAIUsageRetention(NOW + 60_000)
    assert.equal(again, null)

    // Next day: runs again (nothing left to roll, but the pass itself runs).
    const nextDay = await maybeRunScheduledAIUsageRetention(NOW + 25 * 60 * 60 * 1000)
    assert.ok(nextDay)
  } finally {
    clearTestDb()
  }
  db.close()
})
