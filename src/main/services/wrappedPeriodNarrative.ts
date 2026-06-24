// Period (week / month / year) Wrapped — service layer. Builds the facts by
// SUMMING frozen daily snapshots (so the stat card and narrative agree), then
// overlays the AI narrative. briefs-wraps.md §6, invariant 4.

import type {
  AIInvocationSource,
  WrappedPeriod,
  WrappedPeriodFacts,
  WrappedPeriodNarrative,
} from '@shared/types'
import {
  executeTextAIJob,
  type ResolvedProviderConfig,
  type AITextJobExecutionOptions,
  type ProviderTextResponse,
} from './aiOrchestration'
import { voiceDirective } from '@shared/summaryVoice'
import { getSettings } from './settings'
import { getDaySnapshotsForRange } from './daySnapshots'
import { computePeriodRange } from '../lib/wrappedPeriodRange'
import { rollupSnapshots, bucketTotals } from '../lib/wrappedPeriodFacts'
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

const NARRATIVE_TIMEOUT_MS = 16_000

/** Build period facts purely from frozen daily snapshots — the single source the
 *  stat card and the narrative both read. */
function buildWrappedPeriodFacts(period: WrappedPeriod, anchorDate: string): WrappedPeriodFacts {
  const range = computePeriodRange(period, anchorDate)
  const snapshots = getDaySnapshotsForRange(range.startDate, range.endDate)
  const prevSnapshots = getDaySnapshotsForRange(range.prevStartDate, range.prevEndDate)
  const rollup = rollupSnapshots(snapshots, range.dayLabel)

  const previousPeriodSeconds = prevSnapshots.reduce((s, snap) => s + snap.totalActiveSeconds, 0)

  const bySnapshotDate = new Map(snapshots.map((s) => [s.date, s]))
  const bucketInput = range.buckets.map((b) => ({
    label: b.label,
    snapshots: snapshots.filter((s) => s.date >= b.startDate && s.date <= b.endDate),
  }))
  void bySnapshotDate
  const { buckets, busiestBucket } = bucketTotals(bucketInput)

  return {
    period,
    anchorDate,
    rangeLabel: range.rangeLabel,
    totalSeconds: rollup.totalSeconds,
    workSeconds: rollup.workSeconds,
    leisureSeconds: rollup.leisureSeconds,
    personalSeconds: rollup.personalSeconds,
    previousPeriodSeconds,
    daysWithActivity: rollup.daysWithActivity,
    dominantWorkCategory: rollup.dominantWorkCategory,
    dominantWorkCategoryPct: rollup.dominantWorkCategoryPct,
    categories: rollup.categories,
    topApps: rollup.topApps,
    threads: rollup.threads,
    leisureSurfaces: rollup.leisureSurfaces,
    busiestDay: rollup.busiestDay,
    quietestActiveDay: rollup.quietestActiveDay,
    longestStretch: rollup.longestStretch,
    buckets,
    busiestBucket,
  }
}

/** Facts + narrative for a period. Facts always come from snapshots; the
 *  narrative is AI when a provider is configured, else the deterministic
 *  baseline (the renderer gates on provider state and shows the connect message
 *  when none is connected — §7). */
export async function getWrappedPeriodWrap(
  period: WrappedPeriod,
  anchorDate: string,
  options: { triggerSource?: AIInvocationSource } = {},
): Promise<{ facts: WrappedPeriodFacts; narrative: WrappedPeriodNarrative }> {
  const facts = buildWrappedPeriodFacts(period, anchorDate)
  const narrative = await getWrappedPeriodNarrative(facts, options)
  return { facts, narrative }
}

async function getWrappedPeriodNarrative(
  facts: WrappedPeriodFacts,
  options: { triggerSource?: AIInvocationSource } = {},
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
  const tunedSystemPrompt = `${systemPrompt}\n\n${voiceDirective(getSettings().summaryVoice)}`

  try {
    const { text } = await withTimeout(
      executeTextAIJob(
        {
          jobType: 'wrapped_period_narrative',
          screen: 'timeline_week',
          triggerSource: options.triggerSource ?? 'user',
          systemPrompt: tunedSystemPrompt,
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
