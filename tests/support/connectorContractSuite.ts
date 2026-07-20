// The connector contract conformance suite (connectors.md §Acceptance
// criteria: "Direct and brokered adapters pass the same contract suite").
//
// Every adapter — the reference .ics connector today, Google Calendar /
// Outlook / GitHub / Linear / Granola as they land — runs these SAME checks
// from its own test file:
//
//   1. manifest validity (read-only, exact scopes with copy, bounded sync)
//   2. connect produces a credential-free connection
//   3. sync produces envelopes that pass the record gate, with unique
//      source-native identity and the adapter's own connector id
//   4. re-sync from the committed cursor is quiet (unchanged or empty) and a
//      full re-ingest never duplicates entities (idempotency)
//   5. nothing renderer-visible ever contains credential-shaped content
//   6. disconnect-with-delete removes every derived record and entity
//
// Usage: `await assertConnectorContract({ adapter, connectInput, ... })`
// inside a node:test test. The suite builds its own production-schema
// database and an always-open gate, so adapters need only describe how to
// reach a working source (a temp file, a fake server, a sandbox account).

import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './testDatabase.ts'
import { containsCredential } from '../../src/shared/credentialPatterns.ts'
import {
  validateConnectorManifest,
  validateRecordEnvelope,
  type ConnectorAdapter,
  type ConnectorConnectInput,
} from '../../src/main/connectors/contract.ts'
import { saveConnectorConnection, listConnectorRecords, getConnectorConnection } from '../../src/main/connectors/store.ts'
import { listConnectorListings, syncConnector, disconnectConnector } from '../../src/main/connectors/service.ts'
import type { ConnectorIngestGate } from '../../src/main/connectors/ingest.ts'
import { listEntities } from '../../src/main/services/entities/entityRepository.ts'

export const OPEN_GATE: ConnectorIngestGate = {
  isConsentCurrent: () => true,
  connectedSourcesEnabled: () => true,
}

export interface ConnectorContractContext {
  adapter: ConnectorAdapter
  /** Connect input that reaches a REAL working source in the test
   *  environment (temp .ics file, fake server, sandbox account). */
  connectInput: ConnectorConnectInput
  /** The source must contain at least this many records for the suite to
   *  prove ingestion actually happened. Default 1. */
  minRecords?: number
}

function connectedEntityCounts(db: ReturnType<typeof createProductionTestDatabase>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const entity of listEntities(db, { limit: 10_000 })) {
    if (entity.origin !== 'connected') continue
    counts.set(`${entity.type}:${entity.name}`, (counts.get(`${entity.type}:${entity.name}`) ?? 0) + 1)
  }
  return counts
}

export async function assertConnectorContract(context: ConnectorContractContext): Promise<void> {
  const { adapter } = context
  const minRecords = context.minRecords ?? 1

  // 1 — manifest.
  const manifestProblems = validateConnectorManifest(adapter.manifest)
  assert.deepEqual(manifestProblems, [], `manifest must be valid: ${manifestProblems.join('; ')}`)
  assert.equal(adapter.manifest.readOnly, true, 'V2 adapters are read-only')

  // 2 — connect.
  const connected = await adapter.connect(context.connectInput)
  assert.ok(connected.accountLabel.trim().length > 0, 'connect must label the account/source')
  for (const value of Object.values(connected.config)) {
    // Absolute paths are legitimate local-connector config and may contain
    // long high-entropy folder names; everything else must scan clean.
    if (typeof value === 'string' && !value.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(value)) {
      assert.equal(containsCredential(value), false, 'connection config must be credential-free')
    }
  }

  const db = createProductionTestDatabase()
  try {
    const row = saveConnectorConnection(db, {
      connectorId: adapter.manifest.id,
      accountLabel: connected.accountLabel,
      config: connected.config,
    })
    assert.equal(row.status, 'connected')

    // 3 — first sync produces gate-passing envelopes with unique identity.
    const first = await adapter.sync({
      connection: {
        connectorId: adapter.manifest.id,
        status: 'connected',
        accountLabel: connected.accountLabel,
        config: connected.config,
        cursor: null,
      },
      cursor: null,
      nowMs: Date.now(),
    })
    assert.ok(first.records.length >= minRecords, `first sync must yield ≥ ${minRecords} record(s)`)
    const ids = new Set<string>()
    for (const record of first.records) {
      const problems = validateRecordEnvelope(record)
      assert.deepEqual(problems, [], `record must pass the envelope gate: ${problems.join('; ')}`)
      assert.equal(record.provenance.connectorId, adapter.manifest.id, 'records carry their own connector id')
      assert.equal(ids.has(record.provenance.sourceRecordId), false, 'source record ids are unique within a page')
      ids.add(record.provenance.sourceRecordId)
    }

    // Ingest through the real service path.
    const synced = await syncConnector(db, adapter.manifest.id, { adapter, gate: OPEN_GATE })
    assert.equal(synced.status, 'ok')
    assert.ok(synced.ingested >= minRecords)
    const committedCursor = getConnectorConnection(db, adapter.manifest.id)?.sync_cursor ?? null
    assert.ok(committedCursor != null, 'a successful sync commits a cursor')

    // 4 — idempotency: quiet re-sync, and re-ingesting never duplicates.
    const second = await adapter.sync({
      connection: {
        connectorId: adapter.manifest.id,
        status: 'connected',
        accountLabel: connected.accountLabel,
        config: connected.config,
        cursor: committedCursor,
      },
      cursor: committedCursor,
      nowMs: Date.now(),
    })
    assert.ok(
      second.unchanged === true || second.records.length === 0 || second.records.length === first.records.length,
      'a re-sync from the committed cursor is unchanged, empty, or a stable full view',
    )
    const before = connectedEntityCounts(db)
    const resynced = await syncConnector(db, adapter.manifest.id, { adapter, gate: OPEN_GATE })
    assert.equal(resynced.status, 'ok')
    assert.deepEqual(connectedEntityCounts(db), before, 'a re-ingest must not duplicate entities')
    for (const [key, count] of before) {
      assert.equal(count, 1, `entity ${key} must exist exactly once`)
    }

    // 5 — renderer-visible surface is credential-free.
    const listingJson = JSON.stringify(listConnectorListings(db))
    assert.equal(containsCredential(listingJson), false, 'the Settings listing must be credential-free')
    assert.equal(listingJson.includes('sync_cursor'), false)

    // 6 — disconnect-with-delete removes records and unsupported entities.
    await disconnectConnector(db, adapter.manifest.id, {
      deleteData: true,
      adapter,
      secretStore: { getPassword: async () => null, setPassword: async () => {}, deletePassword: async () => true },
    })
    assert.equal(listConnectorRecords(db, adapter.manifest.id, { includeTombstoned: true }).length, 0)
    assert.equal(connectedEntityCounts(db).size, 0, 'disconnect-with-delete retires every solely-supported entity')
    assert.equal(getConnectorConnection(db, adapter.manifest.id)?.status, 'disconnected')
  } finally {
    db.close()
  }
}
