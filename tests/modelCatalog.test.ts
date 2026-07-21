// Model picker costs (DEV-201): money and estimated questions, priced from
// the SAME table billing settlement estimates use — the picker can never quote
// a different price than the meter charges. Plus the managed-allowance view's
// honest availability.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildModelCostCatalog } from '../src/main/services/modelCatalog.ts'
import { estimateQuestionsRemaining, lookupModelPricing, typicalQuestionCostUsd } from '../src/main/services/modelPricing.ts'
import type { BillingAccessSnapshot } from '../src/shared/types.ts'

function billing(over: Partial<BillingAccessSnapshot> = {}): BillingAccessSnapshot {
  return {
    mode: 'trial',
    canUseAI: true,
    managed: true,
    creditGrantedUsd: 5,
    creditRemainingUsd: 3.2,
    periodSpendUsd: 1.8,
    paidSpendUsd: 0,
    renewalAt: null,
    localPassExpiresAt: null,
    fairUseRemainingUsd: null,
    subscriptionStatus: null,
    providerLabel: null,
    checkoutAvailable: true,
    localCheckoutAvailable: false,
    portalAvailable: false,
    message: 'Trial active.',
    ...over,
  } as BillingAccessSnapshot
}

// ─── The typical-question estimator ───────────────────────────────────────────

test('typical question cost derives from the settlement pricing table (8k in / 600 out)', () => {
  for (const model of ['claude-sonnet-4-6', 'gpt-5.4-mini', 'gemini-3.1-flash-lite', 'claude-haiku-4-5']) {
    const rates = lookupModelPricing(model)
    const expected = (8_000 / 1_000_000) * rates.inputPerMillion + (600 / 1_000_000) * rates.outputPerMillion
    assert.ok(Math.abs(typicalQuestionCostUsd(model) - expected) < 1e-9, model)
  }
  // Cheaper models cost less per question — the ordering people rely on.
  assert.ok(typicalQuestionCostUsd('claude-haiku-4-5') < typicalQuestionCostUsd('claude-sonnet-4-6'))
  assert.ok(typicalQuestionCostUsd('gpt-5.4-nano') < typicalQuestionCostUsd('gpt-5.5'))
})

test('estimateQuestionsRemaining floors to whole questions and refuses meaningless input', () => {
  const perQuestion = typicalQuestionCostUsd(null)
  assert.equal(estimateQuestionsRemaining(perQuestion * 4.9, null), 4)
  assert.equal(estimateQuestionsRemaining(0, null), 0)
  assert.equal(estimateQuestionsRemaining(null, null), null)
  assert.equal(estimateQuestionsRemaining(-1, null), null)
  assert.equal(estimateQuestionsRemaining(Number.NaN, null), null)
})

// ─── The catalog ──────────────────────────────────────────────────────────────

test('the catalog prices every requested model in money and questions-per-dollar', () => {
  const catalog = buildModelCostCatalog([
    { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    { provider: 'google', modelId: 'gemini-3.1-flash-lite' },
  ], null)
  assert.equal(catalog.models.length, 2)
  for (const entry of catalog.models) {
    assert.ok(entry.typicalQuestionCostUsd > 0, entry.modelId)
    assert.equal(entry.questionsPerUsd, Math.floor(1 / entry.typicalQuestionCostUsd))
  }
  // No billing service → no allowance block, never a made-up figure.
  assert.equal(catalog.allowance, null)
})

test('duplicate and malformed requests are dropped, not double-priced', () => {
  const catalog = buildModelCostCatalog([
    { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    { provider: 'anthropic', modelId: '' },
  ], null)
  assert.equal(catalog.models.length, 1)
})

test('the allowance view shows remaining money and estimated questions when managed AI is usable', () => {
  const catalog = buildModelCostCatalog([], billing())
  assert.ok(catalog.allowance)
  assert.equal(catalog.allowance!.grantedUsd, 5)
  assert.equal(catalog.allowance!.remainingUsd, 3.2)
  assert.equal(catalog.allowance!.estimatedQuestionsRemaining, estimateQuestionsRemaining(3.2, null))
  assert.equal(catalog.allowance!.canUseManagedAI, true)
  assert.equal(catalog.allowance!.unavailableReason, null)
})

test('exhausted managed access says why, honestly, instead of hiding', () => {
  const catalog = buildModelCostCatalog([], billing({
    canUseAI: false,
    creditRemainingUsd: 0,
    message: 'Trial credit is used up. Subscribe or add your own key in Settings.',
  }))
  assert.ok(catalog.allowance)
  assert.equal(catalog.allowance!.canUseManagedAI, false)
  assert.equal(catalog.allowance!.estimatedQuestionsRemaining, 0)
  assert.match(catalog.allowance!.unavailableReason ?? '', /used up/i)
})

test('a build without a billing service has no managed allowance block', () => {
  const catalog = buildModelCostCatalog([], billing({ mode: 'unavailable' as BillingAccessSnapshot['mode'] }))
  assert.equal(catalog.allowance, null)
})

test('a negative remaining balance clamps to zero — never negative questions', () => {
  const catalog = buildModelCostCatalog([], billing({ creditRemainingUsd: -0.4 }))
  assert.equal(catalog.allowance!.remainingUsd, 0)
  assert.equal(catalog.allowance!.estimatedQuestionsRemaining, 0)
})
