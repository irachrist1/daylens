// Retention for the app's own AI telemetry (V2 ship plan W1-B / storage audit).
//
// ai_usage_events grows one row per provider call and NOTHING ever pruned it:
// the founder's real DB carried 888,767 rows (~364 MB with indexes — 55% of a
// 660 MB database), most of them the May–June 2026 failing-relabel storm.
//
// The policy:
//   - Keep full per-event detail for the most recent 90 local days. That
//     covers every preset range the Settings → Usage screen offers (1d / 7d /
//     30d / month-to-date / last month) with a whole quarter of exact
//     per-event drill-down and CSV export to spare.
//   - Roll everything older into ai_usage_daily_rollup: one row per
//     (local day, job_type, screen, trigger_source, provider, model,
//     billing_mode) carrying call/success/failure counts, token sums, and the
//     sum of provider-reported costs. Spend in the Usage screen is priced
//     from model + token sums (billing.ts priceTokensUsd), and pricing is
//     linear in tokens, so the rolled-up aggregate prices IDENTICALLY to the
//     rows it replaced — headline totals, per-day charts, per-feature and
//     per-model splits, and yearly-recap style aggregates all survive.
//   - Delete the rolled-up detail rows. Aggregation and deletion of each
//     batch happen in ONE transaction, so a crash can never double-count or
//     lose a row.
//
// What is intentionally lost for >90-day-old data: per-event ids, latencies,
// failure_reason strings, cache_hit flags, and sub-day timing. No user data
// is involved anywhere — this table is telemetry about Daylens's own AI
// calls; corrections, blocks, sessions, and every other table are untouched.
//
// Blocking: better-sqlite3 is synchronous, so the work is chunked — each
// transaction handles at most ROLLUP_BATCH_SIZE rows (tens of milliseconds),
// and the loop yields to the event loop between batches. The first run on a
// ~900k-row backlog spreads ~45 batches across macrotasks instead of holding
// one multi-second write lock.
//
// Disk space: SQLite returns freed pages to the freelist, so the file stops
// growing and all reclaimed space is reused by future writes. Physically
// shrinking the file needs a VACUUM. On DBs with auto_vacuum=INCREMENTAL we
// reclaim pages right here with chunked `PRAGMA incremental_vacuum`; initDb
// now enables that mode for brand-new databases. Existing installs (like the
// founder's) were created with auto_vacuum=NONE, and flipping it on requires
// a full VACUUM first — a blocking, disk-doubling operation we deliberately
// do NOT run automatically behind the user's back. For those DBs the run
// logs the reclaimable freelist size so the win is visible and inspectable.

import type Database from 'better-sqlite3'
import { getDb } from './database'
import { capture } from './analytics'
import { ANALYTICS_EVENT } from '@shared/analytics'
import { maintenanceRunAt, markMaintenanceRun } from '../db/maintenance'
import { localDateString, localDayBounds, shiftLocalDateString } from '../lib/localDate'

export const AI_USAGE_DETAIL_RETENTION_DAYS = 90
// Sized from a measured 900k-row fixture (2026-07-12, M-series MacBook,
// file-backed WAL DB): 2k rows per transaction = ~157ms average / 654ms max
// write lock — short enough that the main process never visibly stalls —
// and a first-run backlog of 837k rows still cleared in ~66s of cumulative
// background slices across 419 yielding batches. (20k-row batches averaged
// 955ms and peaked at 2.2s: too long a lock.)
export const ROLLUP_BATCH_SIZE = 2_000

export const AI_USAGE_RETENTION_MAINTENANCE_KEY = 'ai_usage_retention_daily'
// Once a day is the cadence; re-checked more often so a machine that sleeps
// past the timer still runs within hours, not another full day.
const RETENTION_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000
const RETENTION_RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const RETENTION_STARTUP_DELAY_MS = 30_000

export interface AIUsageRetentionResult {
  cutoffMs: number
  rolledRows: number
  batches: number
  freelistPagesBefore: number
  freelistPagesAfter: number
  vacuumMode: 'incremental' | 'none'
}

/** Start (exclusive upper bound) of the detail window: local midnight, N days back. Rows strictly before it are rolled up. */
export function aiUsageRetentionCutoff(now = Date.now(), retentionDays = AI_USAGE_DETAIL_RETENTION_DAYS): number {
  const today = localDateString(new Date(now))
  return localDayBounds(shiftLocalDateString(today, -retentionDays))[0]
}

function ensureBatchTable(db: Database.Database): void {
  db.exec(`CREATE TEMP TABLE IF NOT EXISTS _ai_usage_retention_batch (rid INTEGER PRIMARY KEY)`)
}

/**
 * Roll up + delete ONE batch of expired ai_usage_events rows, atomically.
 * Returns how many detail rows were rolled (0 = nothing left to do).
 *
 * The batch is selected oldest-first; a day split across batches still
 * aggregates correctly because the rollup upsert ACCUMULATES (+=) into the
 * existing (day, job, …) row. Grouping keys are COALESCEd to '' so NULL
 * provider/model collapse into one deterministic rollup row per group; the
 * read path maps '' back to null.
 */
export function rollupExpiredAIUsageEventsBatch(
  db: Database.Database,
  cutoffMs: number,
  batchSize = ROLLUP_BATCH_SIZE,
): number {
  ensureBatchTable(db)

  const run = db.transaction((): number => {
    db.prepare(`DELETE FROM _ai_usage_retention_batch`).run()
    const selected = db.prepare(`
      INSERT INTO _ai_usage_retention_batch (rid)
      SELECT rowid
      FROM ai_usage_events
      WHERE started_at < ?
      ORDER BY started_at
      LIMIT ?
    `).run(cutoffMs, batchSize).changes
    if (selected === 0) return 0

    // date(..., 'localtime') keys the rollup by the same local day the Usage
    // screen's charts use (billing.ts localDayKey) — both resolve through the
    // OS timezone.
    db.prepare(`
      INSERT INTO ai_usage_daily_rollup (
        day, job_type, screen, trigger_source, provider, model, billing_mode,
        calls, successes, failures,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd
      )
      SELECT
        date(e.started_at / 1000, 'unixepoch', 'localtime'),
        e.job_type,
        COALESCE(e.screen, ''),
        COALESCE(e.trigger_source, ''),
        COALESCE(e.provider, ''),
        COALESCE(e.model, ''),
        COALESCE(e.billing_mode, 'own_key'),
        COUNT(*),
        SUM(CASE WHEN e.success = 1 THEN 1 ELSE 0 END),
        SUM(CASE WHEN e.success = 1 THEN 0 ELSE 1 END),
        COALESCE(SUM(e.input_tokens), 0),
        COALESCE(SUM(e.output_tokens), 0),
        COALESCE(SUM(e.cache_read_tokens), 0),
        COALESCE(SUM(e.cache_write_tokens), 0),
        COALESCE(SUM(e.cost_usd), 0)
      FROM ai_usage_events e
      JOIN _ai_usage_retention_batch b ON b.rid = e.rowid
      GROUP BY 1, 2, 3, 4, 5, 6, 7
      ON CONFLICT(day, job_type, screen, trigger_source, provider, model, billing_mode) DO UPDATE SET
        calls = calls + excluded.calls,
        successes = successes + excluded.successes,
        failures = failures + excluded.failures,
        input_tokens = input_tokens + excluded.input_tokens,
        output_tokens = output_tokens + excluded.output_tokens,
        cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
        cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
        cost_usd = cost_usd + excluded.cost_usd
    `).run()

    db.prepare(`
      DELETE FROM ai_usage_events
      WHERE rowid IN (SELECT rid FROM _ai_usage_retention_batch)
    `).run()
    db.prepare(`DELETE FROM _ai_usage_retention_batch`).run()
    return selected
  })

  return run()
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function pragmaNumber(db: Database.Database, pragma: string): number {
  const value = db.pragma(pragma, { simple: true })
  return typeof value === 'number' ? value : 0
}

/**
 * Full retention pass: roll up + delete everything older than the cutoff in
 * yielding batches, then reclaim disk where the DB's auto_vacuum mode allows.
 */
export async function runAIUsageRetention(
  db: Database.Database,
  options: { now?: number; batchSize?: number; retentionDays?: number } = {},
): Promise<AIUsageRetentionResult> {
  const cutoffMs = aiUsageRetentionCutoff(options.now ?? Date.now(), options.retentionDays ?? AI_USAGE_DETAIL_RETENTION_DAYS)
  const batchSize = options.batchSize ?? ROLLUP_BATCH_SIZE

  let rolledRows = 0
  let batches = 0
  for (;;) {
    const rolled = rollupExpiredAIUsageEventsBatch(db, cutoffMs, batchSize)
    if (rolled === 0) break
    rolledRows += rolled
    batches += 1
    await yieldToEventLoop()
  }

  const freelistPagesBefore = pragmaNumber(db, 'freelist_count')
  const autoVacuum = pragmaNumber(db, 'auto_vacuum')
  const vacuumMode: AIUsageRetentionResult['vacuumMode'] = autoVacuum === 2 ? 'incremental' : 'none'

  if (vacuumMode === 'incremental' && freelistPagesBefore > 0) {
    // Reclaim in ~8 MB slices (2000 × 4 KiB pages) with a yield between each,
    // so even a huge first-run freelist never holds one long write lock.
    for (let guard = 0; guard < 1000; guard += 1) {
      db.pragma('incremental_vacuum(2000)')
      if (pragmaNumber(db, 'freelist_count') === 0) break
      await yieldToEventLoop()
    }
  }
  const freelistPagesAfter = pragmaNumber(db, 'freelist_count')

  if (rolledRows > 0 || freelistPagesBefore !== freelistPagesAfter) {
    const pageSize = pragmaNumber(db, 'page_size') || 4096
    const freedMb = ((freelistPagesBefore - freelistPagesAfter) * pageSize / (1024 * 1024)).toFixed(1)
    const reusableMb = (freelistPagesAfter * pageSize / (1024 * 1024)).toFixed(1)
    console.log(
      `[ai:retention] rolled up ${rolledRows} ai_usage_events rows (< ${new Date(cutoffMs).toISOString().slice(0, 10)}) in ${batches} batches; `
      + (vacuumMode === 'incremental'
        ? `reclaimed ${freedMb} MB from the file`
        : `${reusableMb} MB now on the freelist for reuse (auto_vacuum off — file shrinks only on a manual VACUUM)`),
    )
  }

  return { cutoffMs, rolledRows, batches, freelistPagesBefore, freelistPagesAfter, vacuumMode }
}

// ── Scheduling: on startup (deferred) + daily, never blocking launch ─────────

let retentionStartupTimer: ReturnType<typeof setTimeout> | null = null
let retentionRecheckTimer: ReturnType<typeof setInterval> | null = null
let retentionRunning = false

export async function maybeRunScheduledAIUsageRetention(now = Date.now()): Promise<AIUsageRetentionResult | null> {
  if (retentionRunning) return null
  const db = getDb()
  const lastRun = maintenanceRunAt(db, AI_USAGE_RETENTION_MAINTENANCE_KEY)
  if (lastRun != null && now - lastRun < RETENTION_MIN_INTERVAL_MS) return null

  retentionRunning = true
  try {
    const result = await runAIUsageRetention(db, { now })
    markMaintenanceRun(db, AI_USAGE_RETENTION_MAINTENANCE_KEY, now)
    if (result.rolledRows > 0) {
      capture(ANALYTICS_EVENT.AI_USAGE_RETENTION_RUN, {
        rolled_rows: result.rolledRows,
        batches: result.batches,
        vacuum_mode: result.vacuumMode,
        freelist_pages_after: result.freelistPagesAfter,
      })
    }
    return result
  } catch (error) {
    console.warn('[ai:retention] retention pass failed:', error)
    return null
  } finally {
    retentionRunning = false
  }
}

/** Kick off the retention schedule: one deferred pass shortly after launch, re-checked every few hours. */
export function startAIUsageRetentionSchedule(): void {
  if (retentionStartupTimer || retentionRecheckTimer) return
  retentionStartupTimer = setTimeout(() => {
    void maybeRunScheduledAIUsageRetention()
  }, RETENTION_STARTUP_DELAY_MS)
  retentionRecheckTimer = setInterval(() => {
    void maybeRunScheduledAIUsageRetention()
  }, RETENTION_RECHECK_INTERVAL_MS)
}

export function stopAIUsageRetentionSchedule(): void {
  if (retentionStartupTimer) {
    clearTimeout(retentionStartupTimer)
    retentionStartupTimer = null
  }
  if (retentionRecheckTimer) {
    clearInterval(retentionRecheckTimer)
    retentionRecheckTimer = null
  }
}
