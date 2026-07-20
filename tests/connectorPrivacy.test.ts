// Connector privacy proofs (DEV-186, connectors.md §Authorization + §Privacy
// and model access): credentials live only in the OS secure store and are
// deleted on disconnect; nothing renderer-visible, logged, or stored in the
// database ever contains the secret; connector data has no sync-allowlist
// keys, so it structurally CANNOT serialize into a remote payload.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { OPEN_GATE } from './support/connectorContractSuite.ts'
import { makeCleanRemoteSyncPayload } from './support/remoteSyncPayloadFixture.ts'
import { FAKE_CONNECTOR_ID, FAKE_CONNECTOR_MANIFEST } from './support/fakeConnectorProvider.ts'
import {
  clearConnectorSecret,
  connectorSecretAccount,
  getConnectorSecret,
  hasConnectorSecret,
  setConnectorSecret,
  type ConnectorSecretStore,
} from '../src/main/connectors/credentials.ts'
import { ingestConnectorPage } from '../src/main/connectors/ingest.ts'
import { listConnectorListings, syncConnector } from '../src/main/connectors/service.ts'
import { getConnectorConnection, saveConnectorConnection } from '../src/main/connectors/store.ts'
import type { ConnectorAdapter, ConnectorRecordEnvelope } from '../src/main/connectors/contract.ts'
import {
  assertSyncPayloadAllowed,
  SyncAllowlistViolation,
  REMOTE_SYNC_PAYLOAD_KEYS,
  SYNC_ALLOWLIST_KEY_SCHEMA_PAIRS,
} from '../src/shared/syncAllowlist/index.ts'
import { containsCredential } from '../src/shared/credentialPatterns.ts'

const FAKE_TOKEN = 'xoxb-000000000000-abcdefghijklmnopqrstuvwx'

function fakeStore(): ConnectorSecretStore & { secrets: Map<string, string> } {
  const secrets = new Map<string, string>()
  return {
    secrets,
    getPassword: async (_service, account) => secrets.get(account) ?? null,
    setPassword: async (_service, account, password) => { secrets.set(account, password) },
    deletePassword: async (_service, account) => secrets.delete(account),
  }
}

test('credential lifecycle: set → present → clear → absent, all in the secure store only', async () => {
  const store = fakeStore()
  assert.equal(await hasConnectorSecret('github', store), false)
  await setConnectorSecret('github', FAKE_TOKEN, store)
  assert.equal(await hasConnectorSecret('github', store), true)
  assert.equal(await getConnectorSecret('github', store), FAKE_TOKEN)
  // Per-connector accounts under the shared Daylens vault service.
  assert.equal(connectorSecretAccount('github'), 'connector-github-token')
  await clearConnectorSecret('github', store)
  assert.equal(await hasConnectorSecret('github', store), false)
  assert.equal(store.secrets.size, 0)
})

test('nothing readable about a connection carries the secret: not the listing, not the database', async () => {
  const db = createProductionTestDatabase()
  try {
    const store = fakeStore()
    await setConnectorSecret(FAKE_CONNECTOR_ID, FAKE_TOKEN, store)
    saveConnectorConnection(db, {
      connectorId: FAKE_CONNECTOR_ID,
      accountLabel: 'fake-account',
      config: { accountLabel: 'fake-account' },
    })
    ingestConnectorPage(db, FAKE_CONNECTOR_ID, {
      records: [{
        provenance: {
          connectorId: FAKE_CONNECTOR_ID,
          accountLabel: 'fake-account',
          workspace: null,
          sourceRecordId: 'rec-1',
          retrievedAtMs: Date.now(),
          effectiveAtMs: Date.now(),
          sensitivity: 'standard',
          permissionScope: 'records:read',
        },
        entity: { kind: 'calendar_event', sourceEventId: 'fake:rec-1', title: 'Planning' },
      } satisfies ConnectorRecordEnvelope],
      nextCursor: 'cursor-1',
    }, { gate: OPEN_GATE })

    // The renderer-facing listing: no token, no cursor, no config.
    const listingJson = JSON.stringify(listConnectorListings(db))
    assert.equal(listingJson.includes(FAKE_TOKEN), false)
    assert.equal(listingJson.includes('cursor'), false)
    assert.equal(listingJson.includes('config'), false)
    assert.equal(containsCredential(listingJson), false)

    // The database never saw the token at all — dump every connector row.
    const rows = [
      ...db.prepare(`SELECT * FROM connector_connections`).all(),
      ...db.prepare(`SELECT * FROM connector_records`).all(),
    ]
    assert.equal(JSON.stringify(rows).includes(FAKE_TOKEN), false)
  } finally {
    db.close()
  }
})

test('a token in a provider error never reaches the logs, the database, or the stored error', async () => {
  const db = createProductionTestDatabase()
  const logged: string[] = []
  const original = { log: console.log, warn: console.warn, error: console.error }
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
  console.warn = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
  try {
    saveConnectorConnection(db, {
      connectorId: FAKE_CONNECTOR_ID,
      accountLabel: 'fake-account',
      config: { accountLabel: 'fake-account' },
    })
    const failing: ConnectorAdapter = {
      manifest: FAKE_CONNECTOR_MANIFEST,
      connect: async () => { throw new Error('unused') },
      sync: async () => { throw new Error(`401 from provider; refresh token ${FAKE_TOKEN} rejected`) },
      disconnect: async () => {},
    }
    const result = await syncConnector(db, FAKE_CONNECTOR_ID, { adapter: failing, gate: OPEN_GATE })
    assert.equal(result.status, 'failed')

    // Boundary: the token appears in NO console output…
    assert.equal(logged.some((line) => line.includes(FAKE_TOKEN)), false, 'the token must never be logged')
    // …not in the stored error…
    const row = getConnectorConnection(db, FAKE_CONNECTOR_ID)!
    assert.equal(row.last_sync_error?.includes(FAKE_TOKEN), false)
    assert.equal(containsCredential(row.last_sync_error ?? ''), false)
    // …and not anywhere else in the connector tables.
    const rows = db.prepare(`SELECT * FROM connector_connections`).all()
    assert.equal(JSON.stringify(rows).includes(FAKE_TOKEN), false)
  } finally {
    console.log = original.log
    console.warn = original.warn
    console.error = original.error
    db.close()
  }
})

test('connector data has NO sync-allowlist keys — a payload smuggling it is rejected structurally', () => {
  // No allowlisted key shape mentions connectors at all.
  for (const pair of SYNC_ALLOWLIST_KEY_SCHEMA_PAIRS) {
    for (const key of Object.keys(pair.keys)) {
      assert.equal(/connector/i.test(key), false, `${pair.name}.${key} must not exist`)
    }
  }
  assert.equal(Object.keys(REMOTE_SYNC_PAYLOAD_KEYS).some((key) => /connector/i.test(key)), false)

  // And the runtime gate rejects an injected connectors field as an extra key.
  const payload = makeCleanRemoteSyncPayload() as Record<string, unknown>
  payload.connectors = [{ connectorId: FAKE_CONNECTOR_ID, cursor: 'c1', token: FAKE_TOKEN }]
  assert.throws(
    () => assertSyncPayloadAllowed(payload),
    (error: unknown) => error instanceof SyncAllowlistViolation,
  )
})

test('raw connector content never syncs: the day summary carries organized facts, not source records', () => {
  // The clean payload passes; there is simply no field that could carry a
  // connector record, envelope, or credential — the allowlist is exact-key.
  const clean = assertSyncPayloadAllowed(makeCleanRemoteSyncPayload())
  const json = JSON.stringify(clean)
  assert.equal(/sourceRecordId|envelope_json|sync_cursor|permission_scope/i.test(json), false)
})
