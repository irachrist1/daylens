// Maps raw provider SDK errors to a structured, branded, user-facing error
// (R4 + R2). The key job is telling a *transient* per-minute 429 (retry it,
// don't alarm the user) apart from a *hard wall* — daily/free-tier quota gone,
// credit balance too low, or a rejected key — which needs the user to act.
//
// The R1 on-device check surfaced the failure this fixes: on a free Gemini key
// the previous copy always said "your plan only allows a few requests per
// minute, and a single answer makes several." The real cause was the free-tier
// daily request allowance (generate_content_free_tier_requests, limit 500),
// which no amount of per-minute backoff recovers. Misdiagnosis → wrong advice.

import { extractRetryAfterMs, isRateLimitError } from './aiRateLimiter'
import {
  encodeProviderErrorMeta,
  isProviderErrorEncoded,
  type AIProviderErrorCode,
  type AIProviderErrorMeta,
} from '@shared/aiProviderError'

type RawProviderError = {
  status?: number
  code?: string | number
  type?: string
  message?: string
  error?: { code?: string | number; status?: string; type?: string; message?: string }
}

// Free-tier / daily allowance markers. If a RESOURCE_EXHAUSTED names a daily or
// free-tier metric (and not a per-minute one), it is a hard wall, not a blip.
const HARD_QUOTA_RE = /per\s*day|perday|free[_-]?tier|daily limit|quota exceeded for metric|exceeded your current quota/i
const PER_MINUTE_RE = /per\s*minute|perminute|_per_minute|requests per minute/i

export function classifyProviderError(error: unknown): AIProviderErrorMeta {
  if (!error || typeof error !== 'object') return { code: 'unknown' }
  const e = error as RawProviderError
  const status = typeof e.status === 'number' ? e.status : (typeof e.error?.code === 'number' ? e.error.code : undefined)
  const type = e.error?.type ?? e.type
  const haystack = `${e.message ?? ''} ${e.error?.message ?? ''} ${e.error?.status ?? ''}`.toLowerCase()
  const retryMs = extractRetryAfterMs(error)
  const retryAfterSeconds = retryMs != null ? Math.round(retryMs / 1000) : null

  // Auth first — a rejected key is never a rate limit.
  if (status === 401 || status === 403) return { code: 'auth' }

  // Pre-paid credit exhaustion (Anthropic credit_balance_too_low, OpenAI
  // insufficient_quota). Checked before the rate-limit family because OpenAI
  // returns insufficient_quota as a 429.
  if (
    type === 'credit_balance_too_low'
    || e.code === 'insufficient_quota'
    || type === 'insufficient_quota'
    || e.error?.code === 'insufficient_quota'
    || haystack.includes('credit balance')
    || haystack.includes('insufficient_quota')
  ) {
    return { code: 'credit_exhausted' }
  }

  // Custom spend/usage limit walls (e.g. Anthropic's "reached your specified API usage limits")
  if (
    haystack.includes('usage limits')
    || haystack.includes('usage limit')
    || haystack.includes('regain access on')
  ) {
    return { code: 'quota_exhausted' }
  }

  if (isRateLimitError(error)) {
    const longRetry = retryAfterSeconds != null && retryAfterSeconds > 120
    const hardQuota = HARD_QUOTA_RE.test(haystack) && !PER_MINUTE_RE.test(haystack)
    if (hardQuota || longRetry) return { code: 'quota_exhausted', retryAfterSeconds }
    return { code: 'transient_rate_limit', retryAfterSeconds }
  }

  return { code: 'unknown' }
}

/** Branded, channel-name-free, actionable copy for each error class. */
export function userMessageForProviderError(
  code: AIProviderErrorCode,
  label: string,
  retryAfterSeconds: number | null = null,
): string {
  switch (code) {
    case 'transient_rate_limit':
      return retryAfterSeconds
        ? `${label} is busy right now. Give it about ${retryAfterSeconds}s and try again.`
        : `${label} is busy right now. Give it a moment and try again.`
    case 'quota_exhausted':
      return `You've hit ${label}'s request limit for now. Add billing to that provider to raise it, switch providers in Settings → AI, or try again later.`
    case 'credit_exhausted':
      return `${label}'s credit balance is too low. Top it up with the provider, or switch providers in Settings → AI.`
    case 'auth':
      return `${label} rejected the saved key. Re-check or re-paste it in Settings → AI.`
    default:
      return `${label} couldn't complete that. Please try again.`
  }
}

/**
 * Build the friendly Error to throw across IPC. The message is the human copy
 * with the structured meta tagged on for the renderer to recover. If `error`
 * is already an encoded Daylens provider error, it is returned unchanged so we
 * never double-wrap (the chat path can run this after orchestration already did).
 */
export function friendlyProviderError(error: unknown, label: string): Error {
  if (error instanceof Error && isProviderErrorEncoded(error.message)) return error
  const meta = classifyProviderError(error)
  const message = userMessageForProviderError(meta.code, label, meta.retryAfterSeconds ?? null)
  return new Error(encodeProviderErrorMeta(message, meta))
}
