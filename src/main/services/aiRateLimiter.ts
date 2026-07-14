// Per-provider request throttle + retry, and per-turn call instrumentation.
//
// A single chat question used to fan out
// into many provider HTTP calls with no coordination, so a free/low-tier key
// (a handful of requests per minute) would 429 mid-answer — "works, then fails,
// then works." This module is the choke point that makes every provider call:
//   1. respect a light per-provider spacing budget (token bucket),
//   2. retry transient 429 / RESOURCE_EXHAUSTED with exponential backoff +
//      jitter, honoring Retry-After, so the user never sees a transient limit,
//   3. count itself, so we can log calls-per-turn and hold the median low.
//
// Anthropic and OpenAI SDKs already retry 429s internally (Anthropic is
// constructed with maxRetries), so for those providers we wrap with
// maxAttempts: 1 — the wrapper is then just instrumentation + a shared cooldown
// gate, and the SDK owns the backoff. Google's SDK does not auto-retry, so it
// gets the full retry treatment here.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { AIProviderMode } from '@shared/types'

// ── Per-turn provider-call instrumentation ─────────────────────────────────

interface CallCounter {
  count: number
}

const callCounterStore = new AsyncLocalStorage<CallCounter>()

/**
 * Run `fn` inside a counting context. Every provider call made (directly or
 * transitively) while `fn` runs increments a counter, exposed to `fn` via the
 * `getCount` argument. Used by sendMessage to log/emit calls-per-turn (R1).
 */
export function withProviderCallCount<T>(fn: (getCount: () => number) => Promise<T>): Promise<T> {
  const counter: CallCounter = { count: 0 }
  return callCounterStore.run(counter, () => fn(() => counter.count))
}

// Exported for the chat agent loop, which makes its provider calls
// through the AI SDK rather than withProviderRateLimit and must still count
// per-turn calls for the R1 instrumentation.
export function recordProviderCall(): void {
  const counter = callCounterStore.getStore()
  if (counter) {
    counter.count += 1
    // Opt-in diagnostic: prints the running per-turn call count so a failing
    // turn's fan-out is visible even when it throws (R1 investigation).
    if (process.env.DAYLENS_AI_DEBUG_CALLS) console.log(`[ai:calls] provider call #${counter.count}`)
  }
}

// ── Rate-limit detection ────────────────────────────────────────────────────

type MaybeProviderError = {
  status?: number
  code?: string | number
  message?: string
  headers?: Record<string, string> | { get?: (key: string) => string | null }
  error?: { code?: string | number; status?: string; type?: string; message?: string }
}

export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as MaybeProviderError
  if (e.status === 429 || e.code === 429 || e.error?.code === 429) return true
  if (e.error?.status === 'RESOURCE_EXHAUSTED') return true
  if (e.error?.type === 'rate_limit_error') return true
  const haystack = `${e.message ?? ''} ${e.error?.message ?? ''} ${e.error?.status ?? ''}`.toLowerCase()
  return /\b429\b|rate.?limit|resource_exhausted|too many requests|quota exceeded/.test(haystack)
}

/** Extract a Retry-After delay in ms from provider error headers, if present. */
export function extractRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const headers = (error as MaybeProviderError).headers
  if (!headers) return null
  const raw = typeof (headers as { get?: (k: string) => string | null }).get === 'function'
    ? (headers as { get: (k: string) => string | null }).get('retry-after')
    : (headers as Record<string, string>)['retry-after']
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  // Retry-After may be an HTTP date.
  const asDate = Date.parse(raw)
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now())
  return null
}

// ── Per-provider token bucket + cooldown ────────────────────────────────────

interface ProviderBucket {
  // Earliest time the next call to this provider may start (proactive spacing).
  nextAllowedAt: number
  // Hard pause after an observed 429 (set from Retry-After / backoff).
  cooldownUntil: number
}

const buckets = new Map<AIProviderMode, ProviderBucket>()

// Minimum spacing between calls, per provider. Only Google's free tier is
// aggressive enough to warrant proactive spacing; the others rely on SDK
// backoff. Kept small so a multi-call turn stays well under the chat timeout.
const MIN_GAP_MS: Partial<Record<AIProviderMode, number>> = {
  google: 1200,
}

const DEFAULT_MAX_ATTEMPTS: Partial<Record<AIProviderMode, number>> = {
  // Google's SDK does not auto-retry — give it real retries here.
  google: 3,
  // The Anthropic / OpenAI SDKs retry internally, so the wrapper only needs a
  // single pass (instrumentation + shared cooldown).
  anthropic: 1,
  openai: 1,
  openrouter: 1,
  'claude-cli': 1,
  'chatgpt-cli': 1,
  'gemini-cli': 1,
  'codex-cli': 1,
}

const BASE_BACKOFF_MS = 800
const MAX_BACKOFF_MS = 20_000

function bucketFor(provider: AIProviderMode): ProviderBucket {
  let bucket = buckets.get(provider)
  if (!bucket) {
    bucket = { nextAllowedAt: 0, cooldownUntil: 0 }
    buckets.set(provider, bucket)
  }
  return bucket
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

export interface ProviderRateLimitOptions {
  /** Human label for logs (e.g. 'chat', 'followups'). */
  label?: string
  /** Override the per-provider attempt cap. */
  maxAttempts?: number
}

/**
 * Wrap a single provider HTTP call with spacing, retry-on-429, and call
 * counting. The returned promise resolves with the call's result, or rejects
 * with the underlying error once retries are exhausted (so callers' existing
 * friendly-error mapping still runs).
 */
export async function withProviderRateLimit<T>(
  provider: AIProviderMode,
  fn: () => Promise<T>,
  options: ProviderRateLimitOptions = {},
): Promise<T> {
  const bucket = bucketFor(provider)
  const minGap = MIN_GAP_MS[provider] ?? 0
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS[provider] ?? 1

  for (let attempt = 1; ; attempt += 1) {
    const now = Date.now()
    const waitUntil = Math.max(bucket.nextAllowedAt, bucket.cooldownUntil)
    if (waitUntil > now) await delay(waitUntil - now)
    if (minGap > 0) bucket.nextAllowedAt = Date.now() + minGap

    recordProviderCall()
    try {
      return await fn()
    } catch (error) {
      if (process.env.DAYLENS_AI_DEBUG_CALLS) {
        const e = error as MaybeProviderError
        console.log(`[ai:rawerr] provider=${provider} status=${e.status ?? e.error?.code ?? '?'} msg=${(e.message ?? e.error?.message ?? '').slice(0, 600)}`)
      }
      if (!isRateLimitError(error) || attempt >= maxAttempts) throw error
      const retryAfterMs = extractRetryAfterMs(error)
      const backoff = retryAfterMs ?? Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1))
      const wait = backoff + Math.round(Math.random() * 250)
      // Slow subsequent calls to this provider until the cooldown clears.
      bucket.cooldownUntil = Date.now() + wait
      bucket.nextAllowedAt = Math.max(bucket.nextAllowedAt, bucket.cooldownUntil)
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[ai] ${options.label ?? provider} hit a rate limit (attempt ${attempt}/${maxAttempts}); retrying in ${wait}ms`)
      }
      await delay(wait)
    }
  }
}
