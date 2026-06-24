/** Per-million-token USD rates for cost estimation when providers don't return dollar amounts. */
export interface ModelPricingRates {
  inputPerMillion: number
  outputPerMillion: number
  cacheReadPerMillion?: number
  cacheWritePerMillion?: number
}

const PRICING_TABLE: Array<{ pattern: RegExp; rates: ModelPricingRates }> = [
  {
    pattern: /haiku/i,
    rates: { inputPerMillion: 1, outputPerMillion: 5, cacheReadPerMillion: 0.1, cacheWritePerMillion: 1.25 },
  },
  {
    pattern: /sonnet/i,
    rates: { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  },
  {
    pattern: /opus/i,
    rates: { inputPerMillion: 15, outputPerMillion: 75, cacheReadPerMillion: 1.5, cacheWritePerMillion: 18.75 },
  },
  {
    pattern: /gpt-4o-mini|gpt-4\.1-mini/i,
    rates: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  },
  {
    pattern: /gpt-4o|gpt-4\.1(?!-mini)/i,
    rates: { inputPerMillion: 2.5, outputPerMillion: 10 },
  },
  {
    pattern: /o3-mini/i,
    rates: { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  },
  {
    pattern: /o3(?!-mini)/i,
    rates: { inputPerMillion: 10, outputPerMillion: 40 },
  },
  {
    pattern: /gemini-2\.0-flash|gemini-2\.5-flash/i,
    rates: { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  },
  {
    pattern: /gemini-2\.5-pro|gemini-2\.0-pro/i,
    rates: { inputPerMillion: 1.25, outputPerMillion: 10 },
  },
]

const DEFAULT_RATES: ModelPricingRates = { inputPerMillion: 3, outputPerMillion: 15 }

export function normalizeModelId(model: string | null | undefined): string {
  return (model ?? '').trim().toLowerCase()
}

export function lookupModelPricing(model: string | null | undefined): ModelPricingRates {
  const normalized = normalizeModelId(model)
  if (!normalized) return DEFAULT_RATES
  for (const entry of PRICING_TABLE) {
    if (entry.pattern.test(normalized)) return entry.rates
  }
  return DEFAULT_RATES
}

export function estimateUsageCostUsd(
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
  cacheReadTokens?: number | null,
  cacheWriteTokens?: number | null,
): number | null {
  const input = Math.max(0, inputTokens ?? 0)
  const output = Math.max(0, outputTokens ?? 0)
  const cacheRead = Math.max(0, cacheReadTokens ?? 0)
  const cacheWrite = Math.max(0, cacheWriteTokens ?? 0)
  if (input + output + cacheRead + cacheWrite === 0) return null

  const rates = lookupModelPricing(model)
  const inputCost = (input / 1_000_000) * rates.inputPerMillion
  const outputCost = (output / 1_000_000) * rates.outputPerMillion
  const cacheReadCost = (cacheRead / 1_000_000) * (rates.cacheReadPerMillion ?? rates.inputPerMillion * 0.1)
  const cacheWriteCost = (cacheWrite / 1_000_000) * (rates.cacheWritePerMillion ?? rates.inputPerMillion * 1.25)
  const total = inputCost + outputCost + cacheReadCost + cacheWriteCost
  return total > 0 ? Math.round(total * 1_000_000) / 1_000_000 : null
}
