// Entitlement snapshot contract (DEV-194) and running-out-of-credit behavior
// (DEV-195), tested entirely with fixture snapshots signed by test keys — no
// billing service, no network. The signing side of these fixtures uses the
// same canonical payload the real billing service signs
// (services/billing/src/server.mjs), so a drift in either serialization
// fails these tests or the billing sandbox.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import {
  MAX_ENTITLEMENT_TTL_MS,
  PRE_EXHAUSTION_WARN_FRACTION,
  deriveEntitlementAccess,
  entitlementSigningPayload,
  preExhaustionWarning,
  usablePersistedSnapshot,
  validateEntitlementSnapshot,
} from '../src/main/services/entitlement.ts'
import type { EntitlementSnapshot } from '../src/shared/types.ts'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const KID = 'test-ent-1'
const RAW_PUBLIC = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
const KEYS = { [KID]: RAW_PUBLIC }
const NOW = Date.UTC(2026, 6, 20, 12, 0, 0)

function signedSnapshot(overrides: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot {
  const unsigned: Omit<EntitlementSnapshot, 'signature'> = {
    accountId: 'acct-1',
    state: 'trial',
    periodStart: null,
    periodEnd: null,
    managedCreditGrantedUsd: 5,
    managedCreditReservedUsd: 0,
    managedCreditConsumedUsd: 1.25,
    canUseManagedAI: true,
    canUseCloud: true,
    issuedAt: NOW,
    expiresAt: NOW + 6 * 3600_000,
    kid: KID,
    ...overrides,
  }
  const signature = cryptoSign(null, Buffer.from(entitlementSigningPayload(unsigned), 'utf8'), privateKey).toString('base64')
  return { ...unsigned, signature }
}

// ── Signature validation (DEV-194) ──────────────────────────────────────────

test('a correctly signed snapshot validates against the pinned key', () => {
  const result = validateEntitlementSnapshot(signedSnapshot(), KEYS, NOW)
  assert.equal(result.valid, true)
})

test('tampering with any signed field is rejected (access cannot be forged)', () => {
  const snapshot = signedSnapshot({ state: 'exhausted', canUseManagedAI: false, canUseCloud: false })
  for (const forgery of [
    { ...snapshot, state: 'active' as const },
    { ...snapshot, canUseManagedAI: true },
    { ...snapshot, canUseCloud: true },
    { ...snapshot, managedCreditGrantedUsd: 500 },
    { ...snapshot, expiresAt: snapshot.expiresAt + 365 * 86400_000 },
    { ...snapshot, accountId: 'acct-other' },
  ]) {
    const result = validateEntitlementSnapshot(forgery, KEYS, NOW)
    assert.equal(result.valid, false)
    assert.equal(!result.valid && result.reason, 'bad_signature')
  }
})

test('a snapshot signed by an unpinned key is rejected by kid', () => {
  const result = validateEntitlementSnapshot(signedSnapshot({ kid: 'rogue-key' }), KEYS, NOW)
  assert.equal(!result.valid && result.reason, 'unknown_kid')
})

test('an expired snapshot is rejected — no replay beyond expiresAt', () => {
  const snapshot = signedSnapshot()
  const result = validateEntitlementSnapshot(snapshot, KEYS, snapshot.expiresAt + 1)
  assert.equal(!result.valid && result.reason, 'expired')
})

test('a snapshot with a TTL beyond 72 hours is rejected even when correctly signed', () => {
  const snapshot = signedSnapshot({ expiresAt: NOW + MAX_ENTITLEMENT_TTL_MS + 60_000 })
  const result = validateEntitlementSnapshot(snapshot, KEYS, NOW)
  assert.equal(!result.valid && result.reason, 'ttl_too_long')
})

test('malformed payloads are rejected without throwing', () => {
  for (const garbage of [null, 42, 'snapshot', {}, { ...signedSnapshot(), state: 'superuser' }]) {
    const result = validateEntitlementSnapshot(garbage, KEYS, NOW)
    assert.equal(!result.valid && result.reason, 'malformed')
  }
})

// ── Offline honoring ─────────────────────────────────────────────────────────

test('a persisted snapshot is honored offline until its signed expiry and not a second longer', () => {
  const snapshot = signedSnapshot()
  assert.ok(usablePersistedSnapshot(snapshot, KEYS, snapshot.expiresAt - 1))
  assert.equal(usablePersistedSnapshot(snapshot, KEYS, snapshot.expiresAt), null)
})

test('a persisted snapshot tampered on disk fails closed', () => {
  const snapshot = signedSnapshot({ state: 'exhausted', canUseManagedAI: false })
  assert.equal(usablePersistedSnapshot({ ...snapshot, canUseManagedAI: true }, KEYS, NOW), null)
})

// ── Running out of credit (DEV-195) ─────────────────────────────────────────

test('exhaustion pauses managed AI and cloud while the message promises local use and BYOK', () => {
  const access = deriveEntitlementAccess(signedSnapshot({ state: 'exhausted', canUseManagedAI: false, canUseCloud: false, managedCreditConsumedUsd: 5 }), NOW)
  assert.equal(access.canUseManagedAI, false)
  assert.equal(access.canUseCloud, false)
  assert.match(access.message, /paused/i)
  assert.match(access.message, /Timeline, Apps, search, corrections, export/)
  assert.match(access.message, /your own key/i)
})

test('an exhausted snapshot never yields managed access even if the flags lie', () => {
  // Defense in depth: state wins over flags for terminal states.
  const access = deriveEntitlementAccess(signedSnapshot({ state: 'exhausted', canUseManagedAI: true, canUseCloud: true }), NOW)
  assert.equal(access.canUseManagedAI, false)
  assert.equal(access.canUseCloud, false)
})

test('exhaustion message names the period reset when the snapshot carries one', () => {
  const periodEnd = Date.UTC(2026, 7, 1)
  const access = deriveEntitlementAccess(signedSnapshot({ state: 'exhausted', canUseManagedAI: false, canUseCloud: false, periodEnd }), NOW)
  assert.match(access.message, /resumes on/i)
})

test('trial and active states keep managed AI on with honest messages', () => {
  const trial = deriveEntitlementAccess(signedSnapshot({ state: 'trial', managedCreditGrantedUsd: 5, managedCreditConsumedUsd: 1.25 }), NOW)
  assert.equal(trial.canUseManagedAI, true)
  assert.match(trial.message, /\$3\.75/)
  const active = deriveEntitlementAccess(signedSnapshot({ state: 'active' }), NOW)
  assert.equal(active.canUseManagedAI, true)
})

test('expired, refunded, and no-snapshot states fail closed for managed access, open for local', () => {
  for (const snapshot of [
    signedSnapshot({ state: 'expired', canUseManagedAI: false, canUseCloud: false }),
    signedSnapshot({ state: 'refunded', canUseManagedAI: false, canUseCloud: false }),
    null,
  ]) {
    const access = deriveEntitlementAccess(snapshot, NOW)
    assert.equal(access.canUseManagedAI, false)
    assert.match(access.message, /keep working/i)
  }
})

test('grace keeps managed AI only while the snapshot says credit remains', () => {
  const withCredit = deriveEntitlementAccess(signedSnapshot({ state: 'grace', canUseManagedAI: true }), NOW)
  assert.equal(withCredit.canUseManagedAI, true)
  assert.match(withCredit.message, /renewal payment failed/i)
  const withoutCredit = deriveEntitlementAccess(signedSnapshot({ state: 'grace', canUseManagedAI: false }), NOW)
  assert.equal(withoutCredit.canUseManagedAI, false)
})

// ── Pre-exhaustion warning at 80% (DEV-195) ─────────────────────────────────

test('the pre-exhaustion warning fires at 80% of the period allowance, once per period', () => {
  const below = signedSnapshot({ managedCreditGrantedUsd: 5, managedCreditConsumedUsd: 3.99 })
  assert.equal(preExhaustionWarning(below, []).shouldWarn, false)

  const at = signedSnapshot({ managedCreditGrantedUsd: 5, managedCreditConsumedUsd: 5 * PRE_EXHAUSTION_WARN_FRACTION })
  const first = preExhaustionWarning(at, [])
  assert.equal(first.shouldWarn, true)
  assert.equal(preExhaustionWarning(at, [first.periodKey]).shouldWarn, false)
})

test('the warning never fires after managed AI is already paused', () => {
  const exhausted = signedSnapshot({ state: 'exhausted', canUseManagedAI: false, managedCreditGrantedUsd: 5, managedCreditConsumedUsd: 5 })
  assert.equal(preExhaustionWarning(exhausted, []).shouldWarn, false)
})

// ── Allowance in money and estimated questions ──────────────────────────────

test('remaining allowance converts to whole estimated questions, model-specific', async () => {
  const { estimateQuestionsRemaining, typicalQuestionCostUsd } = await import('../src/main/services/modelPricing.ts')
  // The default managed tier prices a typical question at 8k in + 600 out.
  const defaultCost = typicalQuestionCostUsd(null)
  assert.ok(defaultCost > 0)
  assert.equal(estimateQuestionsRemaining(5, null), Math.floor(5 / defaultCost))
  // A cheaper model answers more questions from the same credit.
  const haiku = estimateQuestionsRemaining(5, 'claude-haiku-4-5')
  const sonnet = estimateQuestionsRemaining(5, 'claude-sonnet-4-6')
  assert.ok(haiku != null && sonnet != null && haiku > sonnet)
  // No meaningful remaining figure → no estimate (never a made-up number).
  assert.equal(estimateQuestionsRemaining(null, null), null)
  assert.equal(estimateQuestionsRemaining(-1, null), null)
  assert.equal(estimateQuestionsRemaining(0, null), 0)
})

// ── Cross-implementation pin ─────────────────────────────────────────────────

test('desktop and billing-service canonical signing payloads cannot drift apart', () => {
  // The signature covers a canonical serialization built independently in the
  // desktop and in the billing service. Extract both function bodies from
  // source and require them to be textually identical (modulo whitespace), so
  // a field added, removed, or reordered on one side fails this test instead
  // of silently invalidating every signature.
  const root = path.resolve(import.meta.dirname, '..')
  const extract = (source: string): string => {
    const match = source.match(/function entitlementSigningPayload\([^)]*\)[^{]*\{[\s\S]*?return JSON\.stringify\(\{([\s\S]*?)\}\)/)
    assert.ok(match, 'entitlementSigningPayload serialization not found')
    return match![1].replace(/\s+/g, '')
  }
  const desktop = extract(fs.readFileSync(path.join(root, 'src/main/services/entitlement.ts'), 'utf8'))
  const server = extract(fs.readFileSync(path.join(root, 'services/billing/src/server.mjs'), 'utf8'))
  assert.equal(desktop, server)
})
