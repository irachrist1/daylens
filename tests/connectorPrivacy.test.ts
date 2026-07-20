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
import {
  clearConnectorSecret,
  connectorSecretAccount,
  getConnectorSecret,
  hasConnectorSecret,
  setConnectorSecret,
  type ConnectorSecretStore,
} from '../src/main/connectors/credentials.ts'
import { ingestConnectorPage } from '../src/main/connectors/ingest.ts'
import { listConnectorListings } from '../src/main/connectors/service.ts'
import { saveConnectorConnection } from '../src/main/connectors/store.ts'
import type { ConnectorRecordEnvelope } from '../src/main/connectors/contract.ts'
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
    await setConnectorSecret('ics_calendar', FAKE_TOKEN, store)
    saveConnectorConnection(db, {
      connectorId: 'ics_calendar',
      accountLabel: 'work.ics',
      config: { filePath: '/home/person/work.ics' },
    })
    ingestConnectorPage(db, 'ics_calendar', {
      records: [{
        provenance: {
          connectorId: 'ics_calendar',
          accountLabel: 'work.ics',
          workspace: null,
          sourceRecordId: 'uid-1',
          retrievedAtMs: Date.now(),
          effectiveAtMs: Date.now(),
          sensitivity: 'standard',
          permissionScope: 'file:read',
        },
        entity: { kind: 'calendar_event', sourceEventId: 'ics:uid-1', title: 'Planning' },
      } satisfies ConnectorRecordEnvelope],
      nextCursor: 'cursor-1',
    }, { gate: OPEN_GATE })

    // The renderer-facing listing: no token, no cursor, no config, no path.
    const listingJson = JSON.stringify(listConnectorListings(db))
    assert.equal(listingJson.includes(FAKE_TOKEN), false)
    assert.equal(listingJson.includes('cursor'), false)
    assert.equal(listingJson.includes('config'), false)
    assert.equal(listingJson.includes('/home/person'), false)
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
  payload.connectors = [{ connectorId: 'ics_calendar', cursor: 'c1', token: FAKE_TOKEN }]
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
