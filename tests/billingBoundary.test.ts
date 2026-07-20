// Billing boundary contract: with NO billing service configured, every free
// local feature and BYOK works — and provably makes zero billing-service (or
// any network) calls. "Local never depends on billing" is enforced here as a
// tested contract, not a convention: global fetch is replaced with a spy that
// records and refuses every call before the modules under test are imported.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// No billing service configured — the exact state of a build shipped without
// a billing URL. Must be set before the module under test is imported.
;(globalThis as Record<string, unknown>).__DAYLENS_BILLING_API_URL__ = ''
;(globalThis as Record<string, unknown>).__DAYLENS_ENTITLEMENT_PUBLIC_KEYS__ = '{}'

const fetchCalls: string[] = []
globalThis.fetch = ((input: unknown) => {
  const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input)
  fetchCalls.push(url)
  return Promise.reject(new Error(`network disabled by billingBoundary.test: attempted fetch to ${url}`))
}) as typeof fetch

const { __setSettings, __resetSettings, setApiKey } = await import('./support/settings-stub.mjs')
const billing = await import('../src/main/services/billing.ts')
const { createProductionTestDatabase } = await import('./support/testDatabase.ts')
const { setTestDb, clearTestDb } = await import('./support/database-stub.mjs')
const { getThread } = await import('../src/main/services/artifacts.ts')
const { getThreadMessagesPage } = await import('../src/main/db/queries.ts')

test('BYOK works with no billing service configured and makes zero billing calls', async () => {
  __resetSettings()
  __setSettings({ aiProvider: 'claude-cli' })
  fetchCalls.length = 0
  billing.invalidateBillingAccess()

  const access = await billing.getBillingAccess({ force: true })
  assert.equal(access.mode, 'own_key')
  assert.equal(access.canUseAI, true)
  assert.equal(access.managed, false)
  assert.equal(await billing.getManagedAIConfig(), null)
  assert.deepEqual(await billing.getPaymentHistory(), [])
  assert.equal(fetchCalls.length, 0, `local/BYOK paths fetched: ${fetchCalls.join(', ')}`)
})

test('a stored provider API key is BYOK too — still zero billing calls', async () => {
  __resetSettings()
  __setSettings({ aiProvider: 'anthropic' })
  await setApiKey('anthropic', 'sk-test-own-key')
  fetchCalls.length = 0
  billing.invalidateBillingAccess()

  const access = await billing.getBillingAccess({ force: true })
  assert.equal(access.mode, 'own_key')
  assert.equal(access.canUseAI, true)
  assert.equal(fetchCalls.length, 0)
})

test('with no billing service and no key, access is unavailable — locally, without a network call', async () => {
  __resetSettings()
  __setSettings({ aiProvider: 'anthropic' })
  fetchCalls.length = 0
  billing.invalidateBillingAccess()

  const access = await billing.getBillingAccess({ force: true })
  assert.equal(access.mode, 'unavailable')
  assert.equal(access.canUseAI, false)
  assert.match(access.message, /your own provider key/i)
  assert.equal(await billing.getManagedAIConfig(), null)
  assert.equal(fetchCalls.length, 0)
})

test('local features work against the local database with the network refused', async (t) => {
  const db = createProductionTestDatabase()
  setTestDb(db)
  t.after(() => clearTestDb())
  __resetSettings()
  __setSettings({ aiProvider: 'claude-cli' })
  billing.invalidateBillingAccess()
  fetchCalls.length = 0

  // Existing AI threads stay readable (the exhaustion guarantee's local half
  // shares this boundary: thread reads are database reads, never billing).
  const now = 1_700_000_000_000
  db.prepare(`INSERT INTO ai_conversations (id, messages, created_at) VALUES (1, '[]', ?)`).run(now)
  db.prepare(`
    INSERT INTO ai_threads (id, title, created_at, updated_at, last_message_at, archived, metadata_json)
    VALUES (1, 'Kept thread', ?, ?, ?, 0, '{}')
  `).run(now, now, now)
  db.prepare(`
    INSERT INTO ai_messages (id, conversation_id, thread_id, role, content, created_at, metadata_json)
    VALUES (1, 1, 1, 'assistant', 'An answer you already paid for.', ?, '{}')
  `).run(now)
  const thread = getThread(1)
  assert.equal(thread?.title, 'Kept thread')
  const page = getThreadMessagesPage(db, 1, { limit: 10 })
  assert.equal(page.messages.length, 1)

  // The local usage meter aggregates without any billing-service round trip.
  db.prepare(`
    INSERT INTO ai_usage_events (id, job_type, screen, trigger_source, provider, model, success, started_at, input_tokens, output_tokens, billing_mode)
    VALUES ('evt-1', 'chat', 'insights', 'user', 'anthropic', 'claude-sonnet-4-6', 1, ?, 1000, 200, 'own_key')
  `).run(now)
  const report = billing.localUsage(now - 86_400_000, now + 86_400_000)
  assert.equal(report.totalCalls, 1)
  assert.ok(report.totalSpendUsd > 0)

  // The full usage entry point stays local for BYOK users.
  const usage = await billing.getBillingUsage(now - 86_400_000, now + 86_400_000)
  assert.equal(usage.source, 'local_meter')

  assert.equal(fetchCalls.length, 0, `local paths fetched: ${fetchCalls.join(', ')}`)
})

test('no local-feature module imports the billing service module', () => {
  // Source-level half of the boundary: the modules serving capture, Timeline,
  // Apps, search, corrections, export, and AI-thread reads must not even
  // import the billing module, so no future code path can reach it.
  const servicesDir = path.resolve(import.meta.dirname, '../src/main/services')
  const localFeatureModules = [
    'activityFacts.ts',
    'appsFacts.ts',
    'artifacts.ts',
    'blockCorrections.ts',
    'captureEvidence.ts',
    'exactSearch.ts',
    'historyExport.ts',
    'naturalSearch.ts',
    'timelineBlockEdits.ts',
    'weeklyExport.ts',
  ]
  for (const module of localFeatureModules) {
    const source = fs.readFileSync(path.join(servicesDir, module), 'utf8')
    assert.doesNotMatch(source, /from '\.\/billing'/, `${module} imports the billing module`)
    assert.doesNotMatch(source, /__DAYLENS_BILLING_API_URL__/, `${module} reads the billing service URL`)
  }
})
