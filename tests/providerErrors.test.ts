import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyProviderError,
  friendlyProviderError,
  userMessageForProviderError,
} from '../src/main/services/providerErrors.ts'
import {
  decodeProviderErrorMeta,
  encodeProviderErrorMeta,
  isHardProviderWall,
  isProviderErrorEncoded,
} from '../src/shared/aiProviderError.ts'
import { sanitizeIpcError } from '../src/renderer/lib/ipcError.ts'

// ── Classification (R4/R2) ──────────────────────────────────────────────────

test('Gemini free-tier daily allowance → quota_exhausted (the R1 case)', () => {
  // The exact shape seen on-device: a 429 RESOURCE_EXHAUSTED naming the
  // free-tier *requests* metric. Must NOT be treated as a per-minute blip.
  const err = {
    status: 429,
    message:
      'You exceeded your current quota. Quota exceeded for metric: ' +
      'generativelanguage.googleapis.com/generate_content_free_tier_requests, ' +
      'limit: 500, model: gemini-3.1-flash-lite. Please retry in 57.6s.',
    error: { code: 429, status: 'RESOURCE_EXHAUSTED' },
  }
  assert.equal(classifyProviderError(err).code, 'quota_exhausted')
})

test('transient per-minute 429 (Anthropic rate_limit_error) → transient_rate_limit', () => {
  const err = { status: 429, error: { type: 'rate_limit_error' }, headers: { 'retry-after': '8' } }
  const meta = classifyProviderError(err)
  assert.equal(meta.code, 'transient_rate_limit')
  assert.equal(meta.retryAfterSeconds, 8)
})

test('a long Retry-After promotes a 429 to a hard quota wall', () => {
  const meta = classifyProviderError({ status: 429, headers: { 'retry-after': '3600' } })
  assert.equal(meta.code, 'quota_exhausted')
})

test('an explicit per-minute quota stays transient even if "quota" appears', () => {
  const err = { status: 429, message: 'Quota exceeded: 10 requests per minute. Retry shortly.' }
  assert.equal(classifyProviderError(err).code, 'transient_rate_limit')
})

test('401 → auth; credit balance → credit_exhausted; OpenAI insufficient_quota → credit_exhausted', () => {
  assert.equal(classifyProviderError({ status: 401 }).code, 'auth')
  assert.equal(classifyProviderError({ status: 403 }).code, 'auth')
  assert.equal(classifyProviderError({ status: 400, error: { type: 'credit_balance_too_low' } }).code, 'credit_exhausted')
  assert.equal(classifyProviderError({ status: 429, code: 'insufficient_quota' }).code, 'credit_exhausted')
})

test('non-provider error → unknown', () => {
  assert.equal(classifyProviderError(new Error('socket hang up')).code, 'unknown')
  assert.equal(classifyProviderError(null).code, 'unknown')
})

// ── Copy accuracy (no more "a few requests per minute" misdiagnosis) ────────

test('quota_exhausted copy names the limit + actions, not per-minute fan-out', () => {
  const msg = userMessageForProviderError('quota_exhausted', 'Google Gemini')
  assert.match(msg, /Google Gemini/)
  assert.match(msg, /limit/i)
  assert.doesNotMatch(msg, /few requests per minute/i)
  assert.doesNotMatch(msg, /a single answer makes several/i)
})

// ── Envelope round-trip + no double-wrap ────────────────────────────────────

test('encode/decode round-trips and the clean message is sentinel-free', () => {
  const encoded = encodeProviderErrorMeta('Provider busy.', { code: 'transient_rate_limit', retryAfterSeconds: 5 })
  assert.equal(isProviderErrorEncoded(encoded), true)
  const { message, meta } = decodeProviderErrorMeta(encoded)
  assert.equal(message, 'Provider busy.')
  assert.equal(meta?.code, 'transient_rate_limit')
  assert.equal(meta?.retryAfterSeconds, 5)
  assert.equal(isProviderErrorEncoded(message), false)
})

test('friendlyProviderError tags meta and never double-wraps', () => {
  const wrapped = friendlyProviderError({ status: 401 }, 'OpenAI')
  assert.equal(isProviderErrorEncoded(wrapped.message), true)
  // Re-running on an already-tagged error returns it unchanged (chat path can
  // run after orchestration already classified).
  assert.equal(friendlyProviderError(wrapped, 'OpenAI'), wrapped)
})

test('isHardProviderWall flags quota/credit/auth, not transient', () => {
  assert.equal(isHardProviderWall('quota_exhausted'), true)
  assert.equal(isHardProviderWall('credit_exhausted'), true)
  assert.equal(isHardProviderWall('auth'), true)
  assert.equal(isHardProviderWall('transient_rate_limit'), false)
  assert.equal(isHardProviderWall('unknown'), false)
})

// ── End-to-end renderer decode (strips IPC prefix, recovers the code) ───────

test('sanitizeIpcError strips the IPC prefix and recovers the provider code', () => {
  const thrown = friendlyProviderError(
    { status: 429, message: 'free_tier_requests quota exceeded for metric', error: { status: 'RESOURCE_EXHAUSTED' } },
    'Google Gemini',
  )
  // Simulate Electron's ipcRenderer.invoke wrapping.
  const ipcShaped = new Error(`Error invoking remote method 'ai:send-message': Error: ${thrown.message}`)
  const sanitized = sanitizeIpcError(ipcShaped)
  assert.equal(sanitized.code, 'quota_exhausted')
  assert.equal(sanitized.isRateLimit, false) // hard wall → no auto-retry
  assert.doesNotMatch(sanitized.message, /remote method|ai:send-message|⟦dlerr/)
  assert.match(sanitized.message, /Google Gemini/)
})

test('sanitizeIpcError keeps transient limits auto-retryable', () => {
  const thrown = friendlyProviderError({ status: 429, error: { type: 'rate_limit_error' }, headers: { 'retry-after': '7' } }, 'Anthropic')
  const sanitized = sanitizeIpcError(new Error(`Error invoking remote method 'ai:send-message': ${thrown.message}`))
  assert.equal(sanitized.code, 'transient_rate_limit')
  assert.equal(sanitized.isRateLimit, true)
  assert.equal(sanitized.retryAfterSeconds, 7)
})
