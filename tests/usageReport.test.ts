import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateUsageFromEvents } from '../src/main/services/billing.ts'
import { estimateUsageCostUsd, lookupModelPricing } from '../src/main/services/modelPricing.ts'
import { formatUsdAmount } from '../src/shared/formatUsd.ts'

test('estimateUsageCostUsd returns positive cost for haiku tokens', () => {
  const cost = estimateUsageCostUsd('claude-haiku-4-5', 10_000, 500)
  assert.ok(cost != null)
  assert.ok(cost > 0)
})

test('formatUsdAmount shows sub-cent costs instead of rounding to zero', () => {
  const cost = estimateUsageCostUsd('claude-haiku-4-5', 1_000, 100)
  assert.ok(cost != null)
  assert.match(formatUsdAmount(cost), /^\$0\.00[1-9]/)
})

test('lookupModelPricing matches versioned model ids', () => {
  const rates = lookupModelPricing('claude-haiku-4-5-20251001')
  assert.equal(rates.inputPerMillion, 1)
  assert.equal(rates.outputPerMillion, 5)
})

test('aggregateUsageFromEvents estimates spend for BYOK rows with null cost_usd', () => {
  const from = Date.parse('2026-06-24T00:00:00Z')
  const to = from + 86_400_000
  const report = aggregateUsageFromEvents([
    {
      id: 'evt-1',
      job_type: 'chat_answer',
      screen: 'insights',
      trigger_source: 'user',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      success: 1,
      started_at: from + 3_600_000,
      input_tokens: 10_000,
      output_tokens: 500,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd: null,
      billing_mode: 'own_key',
    },
  ], from, to)

  assert.ok(report.totalSpendUsd > 0)
  assert.equal(report.totalTokens, 10_500)
  assert.equal(report.rows[0]?.costSource, 'estimated')
  assert.equal(report.rows[0]?.type, 'own_key')
  assert.ok((report.points[0]?.spendUsd ?? 0) > 0)
})

test('aggregateUsageFromEvents maps subscription billing_mode to included type', () => {
  const from = Date.parse('2026-06-24T00:00:00Z')
  const to = from + 86_400_000
  const report = aggregateUsageFromEvents([
    {
      id: 'evt-2',
      job_type: 'day_summary',
      screen: 'timeline',
      trigger_source: 'background',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      success: 1,
      started_at: from + 3_600_000,
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd: 0.05,
      billing_mode: 'subscription',
    },
  ], from, to)

  assert.equal(report.rows[0]?.type, 'subscription')
  assert.equal(report.rows[0]?.costSource, 'provider')
  assert.equal(report.freeCreditUsedUsd, 0)
  assert.equal(report.paidSpendUsd, 0.05)
})

test('aggregateUsageFromEvents builds distinct feature points for different job types', () => {
  const from = Date.parse('2026-06-24T00:00:00Z')
  const to = from + 86_400_000
  // Usage is bucketed by the LOCAL calendar day, so derive the expected key the
  // same way (keeps this assertion timezone-independent).
  const at = new Date(from + 3_600_000)
  const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
  const report = aggregateUsageFromEvents([
    {
      id: 'evt-3',
      job_type: 'chat_answer',
      screen: 'insights',
      trigger_source: 'user',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      success: 1,
      started_at: from + 3_600_000,
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd: null,
      billing_mode: 'own_key',
    },
    {
      id: 'evt-4',
      job_type: 'block_label_finalize',
      screen: 'timeline',
      trigger_source: 'background',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      success: 1,
      started_at: from + 7_200_000,
      input_tokens: 200,
      output_tokens: 80,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd: null,
      billing_mode: 'own_key',
    },
  ], from, to)

  const features = new Set((report.featurePoints ?? []).map((point) => point.feature))
  assert.equal(features.size, 2)
  assert.ok(features.has('chat_answer'))
  assert.ok(features.has('block_label_finalize'))
  const chatPoint = report.featurePoints?.find((point) => point.feature === 'chat_answer' && point.day === day)
  assert.ok(chatPoint)
  assert.equal(chatPoint.tokens, 150)
})
