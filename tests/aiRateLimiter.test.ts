import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractRetryAfterMs,
  isRateLimitError,
  withProviderCallCount,
  withProviderRateLimit,
} from '../src/main/services/aiRateLimiter.ts'

// ── Rate-limit detection (R1) ──────────────────────────────────────────────

test('isRateLimitError recognizes 429 / RESOURCE_EXHAUSTED / quota shapes', () => {
  assert.equal(isRateLimitError({ status: 429 }), true)
  assert.equal(isRateLimitError({ error: { status: 'RESOURCE_EXHAUSTED' } }), true)
  assert.equal(isRateLimitError({ error: { code: 429 } }), true)
  assert.equal(isRateLimitError(new Error('Quota exceeded for this model')), true)
  assert.equal(isRateLimitError(new Error('429 Too Many Requests')), true)
  assert.equal(isRateLimitError({ status: 401 }), false)
  assert.equal(isRateLimitError(new Error('socket hang up')), false)
})

test('extractRetryAfterMs reads a Retry-After seconds header (object and getter forms)', () => {
  assert.equal(extractRetryAfterMs({ headers: { 'retry-after': '12' } }), 12_000)
  assert.equal(extractRetryAfterMs({ headers: { get: (k: string) => (k === 'retry-after' ? '5' : null) } }), 5_000)
  assert.equal(extractRetryAfterMs({ status: 429 }), null)
})

// ── Per-turn call counting (R1 instrumentation) ────────────────────────────

test('withProviderCallCount counts every wrapped provider call', async () => {
  let runs = 0
  await withProviderCallCount(async (getCount) => {
    await withProviderRateLimit('anthropic', async () => { runs += 1 }, { label: 'test' })
    await withProviderRateLimit('anthropic', async () => { runs += 1 }, { label: 'test' })
    assert.equal(getCount(), 2)
  })
  assert.equal(runs, 2)
})

// ── Retry behavior ─────────────────────────────────────────────────────────

test('withProviderRateLimit retries a transient 429 then succeeds (google)', async () => {
  let attempts = 0
  const result = await withProviderRateLimit('google', async () => {
    attempts += 1
    if (attempts === 1) throw { status: 429, headers: { 'retry-after': '0' } }
    return 'ok'
  }, { label: 'test' })
  assert.equal(result, 'ok')
  assert.equal(attempts, 2)
})

test('withProviderRateLimit does not retry a non-rate-limit error', async () => {
  let attempts = 0
  await assert.rejects(() => withProviderRateLimit('anthropic', async () => {
    attempts += 1
    throw new Error('boom')
  }, { label: 'test' }))
  assert.equal(attempts, 1)
})

test('withProviderRateLimit honors a single-attempt provider (SDK owns backoff)', async () => {
  let attempts = 0
  await assert.rejects(() => withProviderRateLimit('anthropic', async () => {
    attempts += 1
    throw { status: 429 }
  }, { label: 'test' }))
  assert.equal(attempts, 1)
})
