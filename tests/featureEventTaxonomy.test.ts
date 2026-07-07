import test from 'node:test'
import assert from 'node:assert/strict'
import { ANALYTICS_EVENT, sanitizeAnalyticsProperties } from '../src/shared/analytics.ts'

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
