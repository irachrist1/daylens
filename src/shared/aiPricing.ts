// Single source of truth for LLM pricing and cost computation.
//
// Why this exists: the app previously stored `estimatedCostUSD` derived from a
// token estimator that overcounted input by ~30x (measured: estimated $62.58 vs
// actual ~$1 on a real machine). Cost must be computed from the ACTUAL token
// usage returned by each provider, priced here. Display layers and the usage
// recorder both call `computeCostUSD`.
//
// Prices are USD per 1,000,000 tokens. Update when providers change pricing.

export interface ModelPrice {
  /** USD per 1M input (uncached) tokens */
  input: number
  /** USD per 1M output tokens */
  output: number
  /** USD per 1M cache-read input tokens */
  cacheRead: number
  /** USD per 1M cache-write (5-minute ephemeral) tokens */
  cacheWrite: number
}

// Anthropic published pricing (per 1M tokens). Cache write is the 5m ephemeral rate.
const ANTHROPIC_OPUS: ModelPrice = { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }
const ANTHROPIC_SONNET: ModelPrice = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
const ANTHROPIC_HAIKU: ModelPrice = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }

// NOTE: OpenAI/Google prices below are best-effort placeholders for the model
// names this app exposes. Verify against the provider's current price sheet
// before surfacing OpenAI/Gemini cost to users. Anthropic is the default and is
// the one with real billing data behind it.
const OPENAI_GPT54: ModelPrice = { input: 5, output: 15, cacheRead: 0.5, cacheWrite: 0 }
const OPENAI_GPT54_MINI: ModelPrice = { input: 0.6, output: 2.4, cacheRead: 0.06, cacheWrite: 0 }
const OPENAI_GPT54_NANO: ModelPrice = { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 }
const GEMINI_FLASH: ModelPrice = { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 }
const GEMINI_FLASH_LITE: ModelPrice = { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 }
const GEMINI_PRO: ModelPrice = { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }

// Exact id -> price. Keep keys lowercase; lookup is case-insensitive.
const EXACT_PRICES: Record<string, ModelPrice> = {
  'claude-opus-4-7': ANTHROPIC_OPUS,
  'claude-opus-4-6': ANTHROPIC_OPUS,
  'claude-opus-4-1': ANTHROPIC_OPUS,
  'claude-sonnet-4-6': ANTHROPIC_SONNET,
  'claude-sonnet-4-5': ANTHROPIC_SONNET,
  'claude-sonnet-4-5-20250929': ANTHROPIC_SONNET,
  'claude-haiku-4-5': ANTHROPIC_HAIKU,
  'claude-haiku-4-5-20251001': ANTHROPIC_HAIKU,
  'gpt-5.4': OPENAI_GPT54,
  'gpt-5.4-mini': OPENAI_GPT54_MINI,
  'gpt-5.4-nano': OPENAI_GPT54_NANO,
  'gemini-3-flash-preview': GEMINI_FLASH,
  'gemini-2.5-flash': GEMINI_FLASH,
  'gemini-3.1-flash-lite-preview': GEMINI_FLASH_LITE,
  'gemini-3.1-pro-preview': GEMINI_PRO,
}

/**
 * Resolve a price for a model id. Falls back by family substring, then to a
 * conservative Sonnet-equivalent default so unknown models never cost $0.
 */
export function priceForModel(model: string | null | undefined): ModelPrice {
  const id = (model ?? '').toLowerCase().trim()
  if (id && EXACT_PRICES[id]) return EXACT_PRICES[id]
  if (id.includes('opus')) return ANTHROPIC_OPUS
  if (id.includes('haiku')) return ANTHROPIC_HAIKU
  if (id.includes('sonnet')) return ANTHROPIC_SONNET
  if (id.includes('nano')) return OPENAI_GPT54_NANO
  if (id.includes('mini')) return OPENAI_GPT54_MINI
  if (id.includes('gpt')) return OPENAI_GPT54
  if (id.includes('flash-lite')) return GEMINI_FLASH_LITE
  if (id.includes('flash')) return GEMINI_FLASH
  if (id.includes('gemini')) return GEMINI_PRO
  // Unknown: default to Sonnet-equivalent (mid pricing) rather than 0.
  return ANTHROPIC_SONNET
}

export interface TokenUsage {
  inputTokens?: number | null
  outputTokens?: number | null
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
}

/**
 * Compute USD cost from ACTUAL token usage. Anthropic reports `input_tokens` as
 * the uncached input only, with cache read/write counted separately, so all four
 * buckets are additive. Returns 0 only when there is genuinely no usage.
 */
export function computeCostUSD(model: string | null | undefined, usage: TokenUsage): number {
  const p = priceForModel(model)
  const inp = Math.max(0, usage.inputTokens ?? 0)
  const out = Math.max(0, usage.outputTokens ?? 0)
  const cr = Math.max(0, usage.cacheReadTokens ?? 0)
  const cw = Math.max(0, usage.cacheWriteTokens ?? 0)
  return (inp * p.input + out * p.output + cr * p.cacheRead + cw * p.cacheWrite) / 1_000_000
}

/** Format a USD amount for UI. Shows more precision for tiny figures. */
export function formatUSD(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '$0.00'
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  if (amount < 1) return `$${amount.toFixed(3)}`
  return `$${amount.toFixed(2)}`
}

// Shared spend-report shapes (used by the main query layer and renderer panel).
export interface AiSpendBucket {
  key: string
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUSD: number
}

export interface AiSpendSummary {
  /** Inclusive window in epoch ms. */
  fromMs: number
  toMs: number
  totalCostUSD: number
  totalCalls: number
  failedCalls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** cacheReadTokens / (cacheReadTokens + cacheWriteTokens), 0..1; surfaces the cache regression. */
  cacheReuseRatio: number
  byJobType: AiSpendBucket[]
  byModel: AiSpendBucket[]
  byDay: AiSpendBucket[]
}
