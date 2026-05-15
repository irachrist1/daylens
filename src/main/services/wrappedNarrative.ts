// Wrapped narrative — structured AI gloss on top of the deterministic facts
// layer. Wrapped opens instantly using the fallback; the AI overlay loads
// asynchronously and is rejected outright when it contradicts facts or comes
// back empty / shaped wrong.
//
// Pure logic (facts construction, hash, prompt build, validation, fallback)
// lives in `../lib/wrappedNarrative` so it can be tested without the AI
// orchestration / settings chain.

import type { AIWrappedNarrative, DayTimelinePayload } from '@shared/types'
import {
  executeTextAIJob,
  type ResolvedProviderConfig,
  type AITextJobExecutionOptions,
  type ProviderTextResponse,
} from './aiOrchestration'
import {
  buildFallbackNarrative,
  buildWrappedFactsFromPayload,
  buildWrappedPrompts,
  computeFactsHash,
  validateWrappedNarrativeResponse,
  wrappedNarrativeCacheKey,
} from '../lib/wrappedNarrative'

const narrativeCache = new Map<string, AIWrappedNarrative>()

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

/**
 * Wire up the provider sender. Called once on main startup so this module
 * doesn't have to take a hard dependency on the ai.ts barrel.
 */
export function registerWrappedNarrativeProvider(runner: ProviderRunner): void {
  providerRunner = runner
}

const NARRATIVE_TIMEOUT_MS = 12_000

export async function getWrappedNarrative(
  payload: DayTimelinePayload,
): Promise<AIWrappedNarrative> {
  const facts = buildWrappedFactsFromPayload(payload)
  const factsHash = computeFactsHash(facts)
  const cacheKey = wrappedNarrativeCacheKey(facts, factsHash)

  const cached = narrativeCache.get(cacheKey)
  if (cached) return cached

  const fallback = buildFallbackNarrative(facts, factsHash)

  // Quality gates: no AI for empty/tooEarly days — the fallback is honest enough
  // and we don't want to spend tokens on "not enough data yet".
  if (facts.quality === 'empty' || facts.quality === 'tooEarly') {
    narrativeCache.set(cacheKey, fallback)
    return fallback
  }

  if (!providerRunner) {
    return fallback
  }

  const { systemPrompt, userMessage } = buildWrappedPrompts(facts)

  try {
    const { text } = await withTimeout(
      executeTextAIJob(
        {
          jobType: 'wrapped_narrative',
          screen: 'timeline_day',
          triggerSource: 'system',
          systemPrompt,
          userMessage,
        },
        providerRunner,
      ),
      NARRATIVE_TIMEOUT_MS,
      'wrapped_narrative timed out',
    )

    const parsed = validateWrappedNarrativeResponse(text, facts, factsHash)
    const result = parsed ?? fallback
    narrativeCache.set(cacheKey, result)
    return result
  } catch (error) {
    console.warn(`[ai] wrapped_narrative failed for ${facts.date}:`, error)
    return fallback
  }
}

/** Pre-warm the narrative cache without forcing the caller to wait on it. */
export function warmWrappedNarrative(payload: DayTimelinePayload): void {
  void getWrappedNarrative(payload).catch(() => undefined)
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

/** Test hook — drops cached narratives so tests can re-run with new facts. */
export function clearWrappedNarrativeCache(): void {
  narrativeCache.clear()
}
