// The passive background cleanup/relabel scheduler was deleted on 2026-07-05
// (docs/issues-2026-07-05.md §1): a stale production build ran its loop against
// blocks whose relabel result never changed their eligibility, re-spending the
// same tokens every ~10s. What remains — and what this file guards — is the
// eligibility gate itself, `shouldReanalyzeBlockWithAI`, which the once-per-day
// auto-analyze and the manual Analyze action both use to decide which blocks
// are worth an AI call: deterministic floors reopen, good AI labels and user
// overrides are never churned.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { WorkContextBlock } from '../src/shared/types.ts'
import { DEFAULT_TIMELINE_BLOCK_REVIEW } from '../src/shared/timelineReview.ts'
import { shouldReanalyzeBlockWithAI } from '../src/main/services/workBlocks.ts'

function localMs(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function makeBlock(overrides: Partial<WorkContextBlock> = {}): WorkContextBlock {
  return {
    id: overrides.id ?? 'block-1',
    startTime: overrides.startTime ?? localMs(2026, 4, 12, 10, 0),
    endTime: overrides.endTime ?? localMs(2026, 4, 12, 11, 0),
    dominantCategory: overrides.dominantCategory ?? 'development',
    categoryDistribution: overrides.categoryDistribution ?? { development: 1 },
    ruleBasedLabel: overrides.ruleBasedLabel ?? '',
    aiLabel: overrides.aiLabel ?? null,
    sessions: overrides.sessions ?? [],
    topApps: overrides.topApps ?? [],
    websites: overrides.websites ?? [],
    keyPages: overrides.keyPages ?? [],
    pageRefs: overrides.pageRefs ?? [],
    documentRefs: overrides.documentRefs ?? [],
    topArtifacts: overrides.topArtifacts ?? [],
    workflowRefs: overrides.workflowRefs ?? [],
    label: overrides.label ?? {
      current: '',
      source: 'rule',
      confidence: 0.4,
      narrative: null,
      ruleBased: overrides.ruleBasedLabel ?? '',
      aiSuggested: overrides.aiLabel ?? null,
      override: null,
    },
    focusOverlap: overrides.focusOverlap ?? {
      totalSeconds: 0,
      pct: 0,
      sessionIds: [],
    },
    evidenceSummary: overrides.evidenceSummary ?? {
      apps: [],
      pages: [],
      documents: [],
      domains: [],
    },
    heuristicVersion: overrides.heuristicVersion ?? 'test',
    computedAt: overrides.computedAt ?? Date.now(),
    switchCount: overrides.switchCount ?? 0,
    confidence: overrides.confidence ?? 'medium',
    review: overrides.review ?? DEFAULT_TIMELINE_BLOCK_REVIEW,
    isLive: overrides.isLive ?? false,
  }
}

test('AI re-analysis reopens deterministic floors while preserving good AI and overrides', () => {
  const strongRuleBlock = makeBlock({
    ruleBasedLabel: 'GitHub',
    label: {
      current: 'GitHub',
      source: 'rule',
      confidence: 0.8,
      narrative: null,
      ruleBased: 'GitHub',
      aiSuggested: null,
      override: null,
    },
  })
  assert.equal(shouldReanalyzeBlockWithAI(strongRuleBlock), true)

  const artifactFloorBlock = makeBlock({
    id: 'block-artifact-floor',
    label: {
      current: 'irachrist1/daylens-v1: Daylens',
      source: 'artifact',
      confidence: 0.88,
      narrative: null,
      ruleBased: 'Research',
      aiSuggested: null,
      override: null,
    },
  })
  assert.equal(shouldReanalyzeBlockWithAI(artifactFloorBlock), true)

  const weakFallbackBlock = makeBlock({
    id: 'block-2',
    ruleBasedLabel: '',
    label: {
      current: 'Claude',
      source: 'rule',
      confidence: 0.4,
      narrative: null,
      ruleBased: '',
      aiSuggested: null,
      override: null,
    },
  })
  assert.equal(shouldReanalyzeBlockWithAI(weakFallbackBlock), true)

  // A generic single-word AI label ("Research") is a legacy weak label — it
  // stays eligible so a better pass can replace it…
  const weakAiBlock = makeBlock({
    id: 'block-3',
    aiLabel: 'Research',
    label: {
      current: 'Research',
      source: 'ai',
      confidence: 0.65,
      narrative: null,
      ruleBased: '',
      aiSuggested: 'Research',
      override: null,
    },
  })
  assert.equal(shouldReanalyzeBlockWithAI(weakAiBlock), true)

  // …but a specific AI label is settled: re-running it would only re-spend
  // tokens for no change (the exact failure mode of the deleted background loop).
  const aiBlock = makeBlock({
    id: 'block-4',
    aiLabel: 'Fixing sync uploader retries',
    label: {
      current: 'Fixing sync uploader retries',
      source: 'ai',
      confidence: 0.65,
      narrative: null,
      ruleBased: '',
      aiSuggested: 'Fixing sync uploader retries',
      override: null,
    },
  })
  assert.equal(shouldReanalyzeBlockWithAI(aiBlock), false)

  const overrideBlock = makeBlock({
    id: 'block-5',
    label: {
      current: 'Client billing follow-up',
      source: 'user',
      confidence: 1,
      narrative: null,
      ruleBased: '',
      aiSuggested: null,
      override: 'Client billing follow-up',
    },
  })
  assert.equal(shouldReanalyzeBlockWithAI(overrideBlock), false)

  const liveBlock = makeBlock({ id: 'block-6', isLive: true })
  assert.equal(shouldReanalyzeBlockWithAI(liveBlock), false)
})
