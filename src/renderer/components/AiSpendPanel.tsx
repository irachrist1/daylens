import { useEffect, useState } from 'react'
import type { AiSpendSummary } from '@shared/aiPricing'
import { formatUSD } from '@shared/aiPricing'
import { ipc } from '../lib/ipc'

function startOfMonthMs(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime()
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/**
 * In-app AI spend meter. Reads `ai_usage_events` (priced from actual tokens) for
 * the current calendar month and shows totals, per-feature/model breakdown, and
 * cache reuse.
 */
export function AiSpendPanel(): JSX.Element {
  const [summary, setSummary] = useState<AiSpendSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    ipc.db
      .getAiSpend(startOfMonthMs(), Date.now())
      .then((s) => {
        if (alive) {
          setSummary(s)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load spend')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  if (loading) return <div className="text-sm text-neutral-400">Loading AI spend…</div>
  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!summary) return <div className="text-sm text-neutral-400">No AI usage recorded yet.</div>

  const cachePct = Math.round(summary.cacheReuseRatio * 100)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-2xl font-semibold text-neutral-100">{formatUSD(summary.totalCostUSD)}</div>
          <div className="text-xs text-neutral-400">this month · {summary.totalCalls.toLocaleString()} AI calls</div>
        </div>
        <div className="text-right text-xs text-neutral-400">
          <div>cache reuse {cachePct}%</div>
          {summary.failedCalls > 0 && <div className="text-amber-400">{summary.failedCalls} failed</div>}
        </div>
      </div>

      {summary.byJobType.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">By feature</div>
          <div className="flex flex-col gap-1">
            {summary.byJobType.slice(0, 8).map((b) => (
              <div key={b.key} className="flex items-center justify-between text-sm">
                <span className="text-neutral-300">{b.key}</span>
                <span className="text-neutral-400">
                  {formatUSD(b.costUSD)} · {b.calls.toLocaleString()} calls · {fmtTokens(b.inputTokens + b.outputTokens)} tok
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary.byModel.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">By model</div>
          <div className="flex flex-col gap-1">
            {summary.byModel.map((b) => (
              <div key={b.key} className="flex items-center justify-between text-sm">
                <span className="text-neutral-300">{b.key}</span>
                <span className="text-neutral-400">{formatUSD(b.costUSD)} · {b.calls.toLocaleString()} calls</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-[11px] text-neutral-500">
        Estimated from recorded token usage and current model prices. May differ slightly from
        your provider invoice. Cache reuse below ~10% means prompt caching is not landing.
      </div>
    </div>
  )
}
