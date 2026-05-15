// Period (week/month) narrative service. Mirrors `wrappedNarrative.ts` but
// for aggregated periods. The renderer aggregates facts from per-day payloads
// and ships them here; we keep the AI orchestration + cache in main.

import type { WrappedPeriodFacts, WrappedPeriodNarrative } from '@shared/types'
import {
  executeTextAIJob,
  type ResolvedProviderConfig,
  type AITextJobExecutionOptions,
  type ProviderTextResponse,
} from './aiOrchestration'
import {
  buildPeriodFallbackNarrative,
  buildPeriodPrompts,
  computePeriodFactsHash,
  periodNarrativeCacheKey,
  validatePeriodNarrativeResponse,
} from '../lib/wrappedPeriodNarrative'

const narrativeCache = new Map<string, WrappedPeriodNarrative>()

interface ProviderRunner {
  (
    config: ResolvedProviderConfig,
    systemPrompt: string,
    prior: Array<{ role: 'user' | 'assistant'; content: string }>,
    userMessage: string,
    options?: AITextJobExecutionOptions,
  ): Promise<ProviderTextResponse>
}

let providerRunner: ProviderRunner | null = null

export function registerWrappedPeriodNarrativeProvider(runner: ProviderRunner): void {
  providerRunner = runner
}

const NARRATIVE_TIMEOUT_MS = 14_000

export async function getWrappedPeriodNarrative(
  facts: WrappedPeriodFacts,
): Promise<WrappedPeriodNarrative> {
  const factsHash = computePeriodFactsHash(facts)
  const cacheKey = periodNarrativeCacheKey(facts, factsHash)

  const cached = narrativeCache.get(cacheKey)
  if (cached) return cached

  const fallback = buildPeriodFallbackNarrative(facts, factsHash)

  if (facts.totalSeconds <= 0 || !providerRunner) {
    narrativeCache.set(cacheKey, fallback)
    return fallback
  }

  const { systemPrompt, userMessage } = buildPeriodPrompts(facts)

  try {
    const { text } = await withTimeout(
      executeTextAIJob(
        {
          jobType: 'wrapped_period_narrative',
          screen: 'timeline_week',
          triggerSource: 'system',
          systemPrompt,
          userMessage,
        },
        providerRunner,
      ),
      NARRATIVE_TIMEOUT_MS,
      'wrapped_period_narrative timed out',
    )

    const parsed = validatePeriodNarrativeResponse(text, facts, factsHash)
    const result = parsed ?? fallback
    narrativeCache.set(cacheKey, result)
    return result
  } catch (error) {
    console.warn(`[ai] wrapped_period_narrative failed for ${facts.period} ${facts.anchorDate}:`, error)
    return fallback
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

export function clearWrappedPeriodNarrativeCache(): void {
  narrativeCache.clear()
}
