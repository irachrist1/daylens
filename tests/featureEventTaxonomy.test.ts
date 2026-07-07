import test from 'node:test'
import assert from 'node:assert/strict'
import { ANALYTICS_EVENT, buildAIGenerationProperties, sanitizeAnalyticsProperties } from '../src/shared/analytics.ts'

// The ten-event feature taxonomy (2026-07-07). Each entry mirrors the exact
// payload its call site sends; the assertion is that the sanitizer's allowlist
// passes every property through — a silently-dropped key is how these events
// break without any test going red.
const TAXONOMY_PAYLOADS: Array<{ event: string; payload: Record<string, unknown> }> = [
  {
    event: ANALYTICS_EVENT.APP_LAUNCHED,
    payload: {
      version: '1.0.45',
      days_since_install: 12,
      has_completed_onboarding: true,
      subscription_status: 'own_key',
      has_ai_provider: true,
      os_version: '25.0.0',
    },
  },
  {
    event: ANALYTICS_EVENT.VIEW_OPENED,
    payload: { view_name: 'timeline', date_context: 'today', block_count: 7 },
  },
  {
    event: ANALYTICS_EVENT.ANALYZE_DAY_CLICKED,
    payload: { date: '2026-07-07', tracked_hours: 5.42, block_count_before: 9 },
  },
  {
    event: ANALYTICS_EVENT.AI_CHAT_SENT,
    payload: { thread_id: '42', message_length: 180, has_date_context: false, model_used: 'claude-sonnet-5' },
  },
  {
    event: ANALYTICS_EVENT.BLOCK_EDITED,
    payload: { block_id: 'blk_2026-07-07_09', what_changed: 'label' },
  },
  {
    event: ANALYTICS_EVENT.TRACKING_PAUSED,
    payload: { reason: 'user' },
  },
  {
    event: ANALYTICS_EVENT.TRACKING_RESUMED,
    payload: { reason: 'user' },
  },
  {
    event: ANALYTICS_EVENT.ONBOARDING_STEP_COMPLETED,
    payload: { step_name: 'welcome', step_index: 0, total_steps: 13 },
  },
  {
    event: ANALYTICS_EVENT.PAYWALL_SEEN,
    payload: { trigger: 'settings' },
  },
  {
    event: ANALYTICS_EVENT.SUBSCRIPTION_STARTED,
    payload: { plan: 'subscription', trigger: 'settings' },
  },
]

test('every feature-taxonomy payload survives the sanitizer allowlist intact', () => {
  for (const { event, payload } of TAXONOMY_PAYLOADS) {
    const sanitized = sanitizeAnalyticsProperties(payload)
    assert.deepEqual(
      Object.keys(sanitized).sort(),
      Object.keys(payload).sort(),
      `${event}: sanitizer dropped or mangled a property`,
    )
  }
})

test('numeric properties keep fractional precision to two decimals', () => {
  const sanitized = sanitizeAnalyticsProperties({ tracked_hours: 5.4267, block_count: 7 })
  assert.equal(sanitized.tracked_hours, 5.43)
  assert.equal(sanitized.block_count, 7)
})

test('what_changed and date_context enums pass as plain strings', () => {
  for (const value of ['label', 'category', 'time', 'deleted']) {
    assert.equal(sanitizeAnalyticsProperties({ what_changed: value }).what_changed, value)
  }
  for (const value of ['today', 'past']) {
    assert.equal(sanitizeAnalyticsProperties({ date_context: value }).date_context, value)
  }
})

// $ai_generation (PostHog LLM analytics). Two invariants the build must never
// break: no prompt/completion content leaves the machine, and no $ai_*cost*
// property is sent — omitting cost is what makes PostHog price the tokens
// independently, so its number can arbitrate the local meter's accuracy.
test('$ai_generation payload maps usage without content or cost properties', () => {
  const properties = buildAIGenerationProperties({
    traceId: 'a1b2c3d4-0000-4000-8000-000000000000',
    jobType: 'day_summary',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    latencyMs: 1500,
    inputTokens: 1200,
    outputTokens: 340,
    cacheReadTokens: 800,
    cacheWriteTokens: 0,
    daylensCostUsd: 0.0123,
    daylensCostSource: 'estimated',
  })

  assert.equal(properties.$ai_trace_id, 'a1b2c3d4-0000-4000-8000-000000000000')
  assert.equal(properties.$ai_span_name, 'day_summary')
  assert.equal(properties.$ai_provider, 'anthropic')
  assert.equal(properties.$ai_model, 'claude-sonnet-5')
  assert.equal(properties.$ai_latency, 1.5)
  assert.equal(properties.$ai_input_tokens, 1200)
  assert.equal(properties.$ai_output_tokens, 340)
  assert.equal(properties.$ai_cache_read_input_tokens, 800)
  assert.equal(properties.$ai_cache_creation_input_tokens, 0)
  assert.equal(properties.daylens_cost_usd, 0.0123)
  assert.equal(properties.daylens_cost_source, 'estimated')

  for (const key of Object.keys(properties)) {
    assert.ok(!/cost_usd$/.test(key) || key === 'daylens_cost_usd', `unexpected cost property ${key}`)
    assert.ok(!['$ai_input', '$ai_output_choices', '$ai_error'].includes(key), `content property ${key} must never be sent`)
  }
})

test('$ai_generation failure payload carries the error flag and omits token fields', () => {
  const properties = buildAIGenerationProperties({
    traceId: 'a1b2c3d4-0000-4000-8000-000000000001',
    jobType: 'block_labeling',
    provider: null,
    model: null,
    latencyMs: 200,
    isError: true,
  })

  assert.equal(properties.$ai_is_error, true)
  assert.ok(!('$ai_provider' in properties))
  assert.ok(!('$ai_model' in properties))
  assert.ok(!('$ai_input_tokens' in properties))
  assert.ok(!('daylens_cost_usd' in properties))
})
