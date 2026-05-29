// Read-time AI spend reporting, computed from ACTUAL token usage stored in
// `ai_usage_events`. The table stores raw token counts (no cost column); cost is
// derived here via the shared pricing table so the UI never shows the old,
// inflated `estimatedCostUSD`.
import type Database from 'better-sqlite3'
import { computeCostUSD, type AiSpendBucket, type AiSpendSummary } from '../../shared/aiPricing'

export type { AiSpendBucket, AiSpendSummary }

interface UsageRow {
  job_type: string | null
  model: string | null
  success: number | null
  started_at: number
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
}

function emptyBucket(key: string): AiSpendBucket {
  return { key, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUSD: 0 }
}

function addRow(b: AiSpendBucket, r: UsageRow, cost: number): void {
  b.calls += 1
  b.inputTokens += r.input_tokens ?? 0
  b.outputTokens += r.output_tokens ?? 0
  b.cacheReadTokens += r.cache_read_tokens ?? 0
  b.cacheWriteTokens += r.cache_write_tokens ?? 0
  b.costUSD += cost
}

function localDayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Summarize AI spend over [fromMs, toMs]. Cost is computed per row from the
 * stored actual token counts and the row's model.
 */
export function getAiSpendSummary(db: Database.Database, fromMs: number, toMs: number): AiSpendSummary {
  const rows = db
    .prepare(
      `SELECT job_type, model, success, started_at,
              input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
         FROM ai_usage_events
        WHERE started_at >= ? AND started_at <= ?`,
    )
    .all(fromMs, toMs) as UsageRow[]

  const summary: AiSpendSummary = {
    fromMs,
    toMs,
    totalCostUSD: 0,
    totalCalls: 0,
    failedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheReuseRatio: 0,
    byJobType: [],
    byModel: [],
    byDay: [],
  }

  const jobMap = new Map<string, AiSpendBucket>()
  const modelMap = new Map<string, AiSpendBucket>()
  const dayMap = new Map<string, AiSpendBucket>()

  for (const r of rows) {
    const cost = computeCostUSD(r.model, {
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheReadTokens: r.cache_read_tokens,
      cacheWriteTokens: r.cache_write_tokens,
    })
    summary.totalCalls += 1
    if (r.success === 0) summary.failedCalls += 1
    summary.totalCostUSD += cost
    summary.inputTokens += r.input_tokens ?? 0
    summary.outputTokens += r.output_tokens ?? 0
    summary.cacheReadTokens += r.cache_read_tokens ?? 0
    summary.cacheWriteTokens += r.cache_write_tokens ?? 0

    const jobKey = r.job_type ?? 'unknown'
    if (!jobMap.has(jobKey)) jobMap.set(jobKey, emptyBucket(jobKey))
    addRow(jobMap.get(jobKey)!, r, cost)

    const modelKey = r.model ?? 'unknown'
    if (!modelMap.has(modelKey)) modelMap.set(modelKey, emptyBucket(modelKey))
    addRow(modelMap.get(modelKey)!, r, cost)

    const dayKey = localDayKey(r.started_at)
    if (!dayMap.has(dayKey)) dayMap.set(dayKey, emptyBucket(dayKey))
    addRow(dayMap.get(dayKey)!, r, cost)
  }

  const cacheTotal = summary.cacheReadTokens + summary.cacheWriteTokens
  summary.cacheReuseRatio = cacheTotal > 0 ? summary.cacheReadTokens / cacheTotal : 0
  summary.byJobType = [...jobMap.values()].sort((a, b) => b.costUSD - a.costUSD)
  summary.byModel = [...modelMap.values()].sort((a, b) => b.costUSD - a.costUSD)
  summary.byDay = [...dayMap.values()].sort((a, b) => a.key.localeCompare(b.key))
  return summary
}

/** Spend for the current local calendar month. */
export function getCurrentMonthSpend(db: Database.Database, now: number = Date.now()): AiSpendSummary {
  const d = new Date(now)
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime()
  return getAiSpendSummary(db, start, now)
}

/**
 * Month-to-date spend used by the budget breaker. Returns just the number so
 * callers can gate background jobs cheaply.
 */
export function getMonthToDateCostUSD(db: Database.Database, now: number = Date.now()): number {
  const d = new Date(now)
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const rows = db
    .prepare(
      `SELECT model,
              SUM(input_tokens) i, SUM(output_tokens) o,
              SUM(cache_read_tokens) cr, SUM(cache_write_tokens) cw
         FROM ai_usage_events
        WHERE started_at >= ?
        GROUP BY model`,
    )
    .all(start) as Array<{ model: string | null; i: number | null; o: number | null; cr: number | null; cw: number | null }>
  let total = 0
  for (const m of rows) {
    total += computeCostUSD(m.model, {
      inputTokens: m.i,
      outputTokens: m.o,
      cacheReadTokens: m.cr,
      cacheWriteTokens: m.cw,
    })
  }
  return total
}
