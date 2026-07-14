// Provider circuit breaker for background AI jobs.
//
// One real-world install logged ~850,000 block_cleanup_relabel /
// block_label_finalize calls, ~740,000 of them FAILING on
// quota_exhausted ("You've hit Google Gemini's request limit") or
// credit_exhausted ("Anthropic Claude credit balance is too low") — errors
// that retrying can never fix. aiRateLimiter.ts already backs off transient
// per-minute 429s in seconds; nothing stopped a background scheduler from
// re-hitting a provider that told us, unambiguously, that it is out until the
// user acts. This module is that stop: once a provider reports a hard wall
// (quota_exhausted / credit_exhausted), background AI jobs for that provider
// are refused for a real cooldown — hours, not seconds — persisted across
// restarts in provider_breaker_state (schema.ts). A successful call, or the
// user changing provider/key in Settings, closes it again.
//
// Foreground (user-initiated) jobs are never gated here — see the call site
// in aiOrchestration.ts, which only checks the breaker for job types whose
// JOB_DEFINITIONS entry has `foreground: false`. A user who explicitly asks
// for something still gets one honest attempt and the existing friendly
// error (providerErrors.ts) if it fails.

import type Database from 'better-sqlite3'
import type { AIProviderMode } from '@shared/types'
import type { AIProviderErrorCode } from '@shared/aiProviderError'
import { ANALYTICS_EVENT } from '@shared/analytics'
import { capture } from './analytics'

export type ProviderBreakerReason = Extract<AIProviderErrorCode, 'quota_exhausted' | 'credit_exhausted'>

export interface ProviderBreakerState {
  open: boolean
  openedAt: number | null
  cooldownUntil: number | null
  reason: ProviderBreakerReason | null
}

const CLOSED: ProviderBreakerState = { open: false, openedAt: null, cooldownUntil: null, reason: null }

// A hard wall gets a real cooldown, not the seconds-scale backoff
// aiRateLimiter uses for transient 429s. Retry-After is honored when the
// provider gives one (capped so a mis-parsed header can't wedge the breaker
// open for a year); otherwise a hard-wall failure defaults to a multi-hour
// cooldown, since quota/credit walls do not clear on their own within
// minutes and re-probing costs real, already-exhausted spend.
export const MIN_COOLDOWN_MS = 30 * 60 * 1000 // 30 minutes — never trust a near-zero Retry-After for a hard wall
export const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000 // 6 hours
export const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000 // 24 hours

function cooldownMsFor(retryAfterSeconds: number | null | undefined): number {
  if (retryAfterSeconds == null || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    return DEFAULT_COOLDOWN_MS
  }
  const requested = retryAfterSeconds * 1000
  return Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, requested))
}

function isBreakerReason(value: string): value is ProviderBreakerReason {
  return value === 'quota_exhausted' || value === 'credit_exhausted'
}

/** Current breaker state for a provider. Closed (open: false) when no row exists or the cooldown has elapsed. */
export function getProviderBreakerState(
  db: Database.Database,
  provider: AIProviderMode,
  now = Date.now(),
): ProviderBreakerState {
  const row = db.prepare(`
    SELECT opened_at, cooldown_until, reason
    FROM provider_breaker_state
    WHERE provider = ?
  `).get(provider) as { opened_at: number; cooldown_until: number; reason: string } | undefined

  if (!row || row.cooldown_until <= now) return CLOSED
  return {
    open: true,
    openedAt: row.opened_at,
    cooldownUntil: row.cooldown_until,
    reason: isBreakerReason(row.reason) ? row.reason : null,
  }
}

/**
 * Record a quota/credit hard-wall failure for a provider, opening (or
 * extending) its breaker. Called for BOTH foreground and background jobs —
 * the fact "this provider is out" is true regardless of who discovered it —
 * but only background job dispatch (aiOrchestration.ts) actually checks it.
 */
export function recordProviderHardFailure(
  db: Database.Database,
  provider: AIProviderMode,
  reason: ProviderBreakerReason,
  retryAfterSeconds: number | null | undefined,
  now = Date.now(),
): ProviderBreakerState {
  const cooldownMs = cooldownMsFor(retryAfterSeconds)
  const cooldownUntil = now + cooldownMs

  const existing = db.prepare(`
    SELECT opened_at FROM provider_breaker_state WHERE provider = ?
  `).get(provider) as { opened_at: number } | undefined
  const openedAt = existing?.opened_at ?? now

  db.prepare(`
    INSERT INTO provider_breaker_state (provider, opened_at, cooldown_until, reason, retry_after_seconds, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      cooldown_until = excluded.cooldown_until,
      reason = excluded.reason,
      retry_after_seconds = excluded.retry_after_seconds,
      updated_at = excluded.updated_at
  `).run(provider, openedAt, cooldownUntil, reason, retryAfterSeconds ?? null, now)

  console.warn(
    `[ai:breaker] OPEN ${provider} — ${reason}, cooling down ${Math.round(cooldownMs / 60_000)}m until ${new Date(cooldownUntil).toISOString()}`,
  )
  capture(ANALYTICS_EVENT.AI_PROVIDER_BREAKER_OPENED, {
    provider,
    reason,
    cooldown_ms: cooldownMs,
    retry_after_seconds: retryAfterSeconds ?? null,
  })

  return { open: true, openedAt, cooldownUntil, reason }
}

/** Close a provider's breaker (successful call, or an explicit Settings-driven reset). Cheap no-op if already closed. */
export function resetProviderBreaker(
  db: Database.Database,
  provider: AIProviderMode,
  trigger: 'success' | 'provider_changed' | 'key_changed' = 'success',
): void {
  const existing = db.prepare(`SELECT 1 FROM provider_breaker_state WHERE provider = ?`).get(provider)
  if (!existing) return

  db.prepare(`DELETE FROM provider_breaker_state WHERE provider = ?`).run(provider)
  console.log(`[ai:breaker] CLOSE ${provider} — ${trigger}`)
  capture(ANALYTICS_EVENT.AI_PROVIDER_BREAKER_CLOSED, { provider, trigger })
}

/** Reset every provider's breaker (e.g. all keys cleared / a broad Settings reset). */
export function resetAllProviderBreakers(db: Database.Database, trigger: 'provider_changed' | 'key_changed'): void {
  const rows = db.prepare(`SELECT provider FROM provider_breaker_state`).all() as { provider: string }[]
  for (const row of rows) resetProviderBreaker(db, row.provider as AIProviderMode, trigger)
}
