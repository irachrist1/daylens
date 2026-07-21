// Deterministic AI-turn gate with an exhausted entitlement: when the one
// validated snapshot says the credit is gone, managed access pauses with the
// calm exhaustion message and NO managed session is minted — so no provider
// call can start. Driven entirely by a fixture snapshot signed with a test
// key and persisted where the app would persist it; the network is a spy that
// records and refuses everything, proving the verdict comes from the signed
// snapshot rather than a live billing response.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const KID = 'gate-test-1'
const RAW_PUBLIC = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')

// Armed build: billing URL wired in AND the entitlement public key pinned.
// Must be set before the modules under test are imported.
;(globalThis as Record<string, unknown>).__DAYLENS_BILLING_API_URL__ = 'https://billing.gate.test'
;(globalThis as Record<string, unknown>).__DAYLENS_ENTITLEMENT_PUBLIC_KEYS__ = JSON.stringify({ [KID]: RAW_PUBLIC })

const fetchCalls: string[] = []
globalThis.fetch = ((input: unknown) => {
  const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input)
  fetchCalls.push(url)
  return Promise.reject(new Error('billing service unreachable (billingExhaustedGate.test)'))
}) as typeof fetch

const { app } = await import('electron')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-gate-test-'))
app.setPath('userData', userData)

const { entitlementSigningPayload } = await import('../src/main/services/entitlement.ts')
const { __resetSettings, __setSettings } = await import('./support/settings-stub.mjs')
const billing = await import('../src/main/services/billing.ts')

const NOW = Date.now()
const unsigned = {
  accountId: 'acct-gate',
  state: 'exhausted' as const,
  periodStart: null,
  periodEnd: null,
  managedCreditGrantedUsd: 5,
  managedCreditReservedUsd: 0,
  managedCreditConsumedUsd: 5,
  canUseManagedAI: false,
  canUseCloud: false,
  issuedAt: NOW,
  expiresAt: NOW + 6 * 3600_000,
  kid: KID,
}
const snapshot = {
  ...unsigned,
  signature: cryptoSign(null, Buffer.from(entitlementSigningPayload(unsigned), 'utf8'), privateKey).toString('base64'),
}
fs.writeFileSync(path.join(userData, 'entitlement-snapshot.json'), JSON.stringify(snapshot))

test('an exhausted entitlement pauses managed AI with the calm message and mints no session', async () => {
  __resetSettings()
  __setSettings({ aiProvider: 'anthropic' }) // no key stored: managed would be the only route
  billing.invalidateBillingAccess()
  fetchCalls.length = 0

  const access = await billing.getBillingAccess({ force: true })
  assert.equal(access.canUseAI, false)
  assert.equal(access.estimatedQuestionsRemaining ?? null, null)
  assert.match(access.message, /credit is used up/i)
  assert.match(access.message, /Timeline, Apps, search, corrections, export/)
  assert.match(access.message, /your own key/i)

  const managed = await billing.getManagedAIConfig()
  assert.equal(managed, null, 'no managed session may be minted while exhausted')

  // The gate is deterministic and provider-safe: the only attempted traffic
  // is to the billing host itself (the refused status refresh); no managed
  // session endpoint and no model-provider host is ever contacted.
  assert.ok(fetchCalls.every((url) => url.startsWith('https://billing.gate.test/')), `unexpected fetch targets: ${fetchCalls.join(', ')}`)
  assert.ok(!fetchCalls.some((url) => url.includes('/v1/ai/session')), 'attempted to mint a managed AI session while exhausted')
})

test('a tampered persisted snapshot cannot resurrect managed access — it fails closed instead', async () => {
  fs.writeFileSync(
    path.join(userData, 'entitlement-snapshot.json'),
    JSON.stringify({ ...snapshot, state: 'active', canUseManagedAI: true, canUseCloud: true }),
  )
  billing.invalidateBillingAccess()
  fetchCalls.length = 0

  const access = await billing.getBillingAccess({ force: true })
  assert.equal(access.canUseAI, false)
  assert.equal(await billing.getManagedAIConfig(), null)
  assert.ok(!fetchCalls.some((url) => url.includes('/v1/ai/session')))
})
