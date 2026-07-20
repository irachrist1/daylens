// Entitlement snapshot validation and derivation.
//
// The billing service signs one EntitlementSnapshot per account with Ed25519.
// This module is the desktop's half of that contract:
//
//   • validate — signature against a build-pinned public key selected by
//     `kid`, expiry, and the 72-hour TTL ceiling. The desktop never infers
//     paid access from a UI flag or payment receipt alone.
//   • honor offline — the latest validated snapshot may be trusted until its
//     signed `expiresAt` when the billing service is unreachable.
//   • derive — what an entitlement state means for the product: managed AI
//     and cloud features pause on exhaustion/expiry while local capture,
//     Timeline, Apps, search, corrections, export, and BYOK keep working.
//   • warn — the pre-exhaustion notice fires once per period at 80% of the
//     period's credit allowance.
//
// Everything here is pure (no Electron, no network, no filesystem) so the
// whole contract is testable with fixture snapshots signed by test keys. The
// stateful wiring — fetching /v1/entitlement, persisting the snapshot, and
// gating BillingAccessSnapshot — lives in billing.ts.

import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto'
import type { EntitlementSnapshot, EntitlementState } from '@shared/types'

// JSON map of kid → base64 raw Ed25519 public key (32 bytes), pinned into the
// build (vite define, from DAYLENS_ENTITLEMENT_PUBLIC_KEYS). Empty until the
// owner mints a production signing key with
// services/billing/scripts/generate-entitlement-key.mjs — key rotation is
// kid-based: a new public key ships in an app update before the service
// starts signing with it.
declare const __DAYLENS_ENTITLEMENT_PUBLIC_KEYS__: string

// `expiresAt` may be at most 72 hours after `issuedAt`; anything longer is a
// forgery or a service bug and MUST NOT be honored offline for days.
export const MAX_ENTITLEMENT_TTL_MS = 72 * 60 * 60 * 1000

// Pre-exhaustion warning threshold: 80% of the period allowance consumed.
export const PRE_EXHAUSTION_WARN_FRACTION = 0.8

type EntitlementRejection =
  | 'malformed'
  | 'unknown_kid'
  | 'bad_signature'
  | 'ttl_too_long'
  | 'expired'

export type EntitlementValidation =
  | { valid: true; snapshot: EntitlementSnapshot }
  | { valid: false; reason: EntitlementRejection }

const ENTITLEMENT_STATES: readonly EntitlementState[] = ['trial', 'active', 'grace', 'exhausted', 'expired', 'refunded']

export function pinnedEntitlementPublicKeys(): Record<string, string> {
  try {
    const parsed = JSON.parse(__DAYLENS_ENTITLEMENT_PUBLIC_KEYS__ || '{}') as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

// The signature covers the UTF-8 bytes of this exact serialization: every
// field except `signature`, in this exact order. The billing service builds
// the identical string before signing (entitlementSigningPayload in
// services/billing/src/server.mjs) — change one and you must change both.
export function entitlementSigningPayload(snapshot: Omit<EntitlementSnapshot, 'signature'>): string {
  return JSON.stringify({
    accountId: snapshot.accountId,
    state: snapshot.state,
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    managedCreditGrantedUsd: snapshot.managedCreditGrantedUsd,
    managedCreditReservedUsd: snapshot.managedCreditReservedUsd,
    managedCreditConsumedUsd: snapshot.managedCreditConsumedUsd,
    canUseManagedAI: snapshot.canUseManagedAI,
    canUseCloud: snapshot.canUseCloud,
    issuedAt: snapshot.issuedAt,
    expiresAt: snapshot.expiresAt,
    kid: snapshot.kid,
  })
}

// A pinned key is the 32 raw Ed25519 public-key bytes, base64. Node's verify
// wants a KeyObject, so wrap them in the fixed SPKI DER prefix for Ed25519
// (RFC 8410): SEQUENCE { AlgorithmIdentifier(id-Ed25519), BIT STRING key }.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function publicKeyFromRawBase64(rawBase64: string): KeyObject | null {
  try {
    const raw = Buffer.from(rawBase64, 'base64')
    if (raw.length !== 32) return null
    return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' })
  } catch {
    return null
  }
}

function isShapedLikeSnapshot(snapshot: unknown): snapshot is EntitlementSnapshot {
  if (!snapshot || typeof snapshot !== 'object') return false
  const candidate = snapshot as Record<string, unknown>
  return typeof candidate.accountId === 'string'
    && ENTITLEMENT_STATES.includes(candidate.state as EntitlementState)
    && (candidate.periodStart === null || typeof candidate.periodStart === 'number')
    && (candidate.periodEnd === null || typeof candidate.periodEnd === 'number')
    && typeof candidate.managedCreditGrantedUsd === 'number'
    && typeof candidate.managedCreditReservedUsd === 'number'
    && typeof candidate.managedCreditConsumedUsd === 'number'
    && typeof candidate.canUseManagedAI === 'boolean'
    && typeof candidate.canUseCloud === 'boolean'
    && typeof candidate.issuedAt === 'number'
    && typeof candidate.expiresAt === 'number'
    && typeof candidate.kid === 'string'
    && typeof candidate.signature === 'string'
}

// Full validation: shape, pinned key by kid, Ed25519 signature, TTL ceiling,
// and expiry. An invalid or expired snapshot fails CLOSED for managed access
// and open for local use — the caller treats it exactly like no snapshot.
export function validateEntitlementSnapshot(
  snapshot: unknown,
  publicKeysByKid: Record<string, string>,
  nowMs: number,
): EntitlementValidation {
  if (!isShapedLikeSnapshot(snapshot)) return { valid: false, reason: 'malformed' }
  const pinned = publicKeysByKid[snapshot.kid]
  if (!pinned) return { valid: false, reason: 'unknown_kid' }
  const key = publicKeyFromRawBase64(pinned)
  if (!key) return { valid: false, reason: 'unknown_kid' }

  let signatureOk = false
  try {
    signatureOk = cryptoVerify(
      null,
      Buffer.from(entitlementSigningPayload(snapshot), 'utf8'),
      key,
      Buffer.from(snapshot.signature, 'base64'),
    )
  } catch {
    signatureOk = false
  }
  if (!signatureOk) return { valid: false, reason: 'bad_signature' }
  if (snapshot.expiresAt - snapshot.issuedAt > MAX_ENTITLEMENT_TTL_MS) return { valid: false, reason: 'ttl_too_long' }
  if (nowMs >= snapshot.expiresAt) return { valid: false, reason: 'expired' }
  return { valid: true, snapshot }
}

// Offline honoring: a previously persisted snapshot is usable exactly when it
// still validates (tamper on disk fails closed) and its signed expiry has not
// passed. There is no additional offline grace beyond `expiresAt`.
export function usablePersistedSnapshot(
  persisted: unknown,
  publicKeysByKid: Record<string, string>,
  nowMs: number,
): EntitlementSnapshot | null {
  const result = validateEntitlementSnapshot(persisted, publicKeysByKid, nowMs)
  return result.valid ? result.snapshot : null
}

export interface EntitlementAccess {
  // 'unavailable' is never signed by the service; the client synthesizes it
  // locally when no valid snapshot exists.
  state: EntitlementState | 'unavailable'
  canUseManagedAI: boolean
  canUseCloud: boolean
  message: string
}

const LOCAL_KEEPS_WORKING = 'Local capture, Timeline, Apps, search, corrections, export, and your own key keep working.'

function formatPeriodEnd(periodEnd: number | null): string {
  if (!periodEnd) return ''
  return ` ${new Date(periodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
}

// What an entitlement means for the product (DEV-195). Managed AI and cloud
// features follow the signed snapshot; nothing local ever depends on it.
export function deriveEntitlementAccess(snapshot: EntitlementSnapshot | null, nowMs: number): EntitlementAccess {
  if (!snapshot || nowMs >= snapshot.expiresAt) {
    return {
      state: 'unavailable',
      canUseManagedAI: false,
      canUseCloud: false,
      message: `Daylens can’t confirm your managed AI access right now. ${LOCAL_KEEPS_WORKING}`,
    }
  }

  const base = {
    state: snapshot.state,
    canUseManagedAI: snapshot.canUseManagedAI,
    canUseCloud: snapshot.canUseCloud,
  }

  switch (snapshot.state) {
    case 'exhausted':
      return {
        ...base,
        canUseManagedAI: false,
        canUseCloud: false,
        message: `Your included AI credit is used up, so managed AI is paused. ${LOCAL_KEEPS_WORKING} Managed AI resumes${formatPeriodEnd(snapshot.periodEnd) ? ` on${formatPeriodEnd(snapshot.periodEnd)}` : ' next period'} — or right away with a subscription change.`,
      }
    case 'expired':
      return {
        ...base,
        canUseManagedAI: false,
        canUseCloud: false,
        message: `Your managed AI access has ended. ${LOCAL_KEEPS_WORKING} Subscribe to bring managed AI back.`,
      }
    case 'refunded':
      return {
        ...base,
        canUseManagedAI: false,
        canUseCloud: false,
        message: `Your payment was refunded, so managed AI is paused. ${LOCAL_KEEPS_WORKING}`,
      }
    case 'grace':
      return {
        ...base,
        message: snapshot.canUseManagedAI
          ? `A renewal payment failed. Managed AI keeps working while your included credit lasts — update your payment method to keep it. ${LOCAL_KEEPS_WORKING}`
          : `A renewal payment failed and your included credit is used up, so managed AI is paused. Update your payment method to bring it back. ${LOCAL_KEEPS_WORKING}`,
      }
    case 'trial': {
      const remaining = Math.max(0, snapshot.managedCreditGrantedUsd - snapshot.managedCreditConsumedUsd)
      return { ...base, message: `$${remaining.toFixed(2)} of trial AI credit left.` }
    }
    case 'active':
      return { ...base, message: 'Your Daylens plan is active.' }
  }
}

// One warning per period, at 80% of the period's credit allowance, only while
// managed AI still works (an exhausted account gets the exhaustion message
// instead, not a warning about something that already happened).
export function preExhaustionWarning(
  snapshot: EntitlementSnapshot,
  warnedPeriodKeys: readonly string[],
): { shouldWarn: boolean; periodKey: string; usedFraction: number } {
  const periodKey = `${snapshot.state}:${snapshot.periodEnd ?? 'no-period'}`
  const granted = snapshot.managedCreditGrantedUsd
  if (!(granted > 0) || !snapshot.canUseManagedAI) return { shouldWarn: false, periodKey, usedFraction: 0 }
  const usedFraction = Math.min(1, snapshot.managedCreditConsumedUsd / granted)
  const shouldWarn = usedFraction >= PRE_EXHAUSTION_WARN_FRACTION && !warnedPeriodKeys.includes(periodKey)
  return { shouldWarn, periodKey, usedFraction }
}
