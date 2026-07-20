// The connector contract conformance suite (connectors.md acceptance:
// "Direct and brokered adapters pass the same contract suite").
//
// Every adapter — the fake provider that proves the contract in this ticket,
// then Google Calendar / Outlook / GitHub / Linear / Granola as they land —
// runs these SAME checks from its own test file:
//
//   1. manifest validity (read-only, exact scopes with copy, bounded sync)
//   2. connect produces a credential-free connection
//   3. sync produces envelopes that pass the record gate, with unique
//      source-native identity, the adapter's own connector id, and a valid
//      projection onto the shared evidence contract
//   4. re-sync from the committed cursor is quiet (unchanged or empty) and a
//      full re-ingest never duplicates entities (idempotency)
//   5. a failed page never advances the cursor; the failure records a
//      SANITIZED summary and a bounded retry, and the next good sync recovers
//   6. health inspection (when implemented) reports a credential-free state
//   7. nothing renderer-visible ever contains credential-shaped content
//   8. disconnect-with-delete removes every derived record and entity
//
// Usage: `await assertConnectorContract({ adapter, connectInput, ... })`
// inside a node:test test. The suite builds its own production-schema
// database and an always-open gate, so adapters need only describe how to
// reach a working source (an in-memory fixture, a fake server, a sandbox
// account).

import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './testDatabase.ts'
import { containsCredential } from '../../src/shared/credentialPatterns.ts'
import {
  toConnectedEvidenceEnvelope,
  validateConnectorManifest,
  validateRecordEnvelope,
  type ConnectorAdapter,
  type ConnectorConnectInput,
} from '../../src/main/connectors/contract.ts'
import {
  CONNECTED_SOURCE_EVIDENCE_KINDS,
  isEvidenceConfidence,
  isEvidenceSensitivity,
} from '../../src/main/core/evidence/envelope.ts'
import { saveConnectorConnection, listConnectorRecords, getConnectorConnection } from '../../src/main/connectors/store.ts'
import { listConnectorListings, syncConnector, disconnectConnector } from '../../src/main/connectors/service.ts'
import type { ConnectorIngestGate } from '../../src/main/connectors/ingest.ts'
import { listEntities } from '../../src/main/services/entities/entityRepository.ts'

export const OPEN_GATE: ConnectorIngestGate = {
  isConsentCurrent: () => true,
  connectedSourcesEnabled: () => true,
}

const SUITE_FAKE_TOKEN = 'ghp_suiteinjectedtoken0123456789abcdefgh'

export interface ConnectorContractContext {
  adapter: ConnectorAdapter
  /** Connect input that reaches a REAL working source in the test
   *  environment (in-memory fixture, fake server, sandbox account). */
  connectInput: ConnectorConnectInput
  /** The source must contain at least this many records for the suite to
   *  prove ingestion actually happened. Default 1. */
  minRecords?: number
  /** Provider-deletion leg: remove one record from the source and return its
   *  source record id. When provided, the suite proves the next sync
   *  tombstones it locally. */
  removeOneRecord?: () => string
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
  const connectorId = adapter.manifest.id

  // 1 — manifest.
  const manifestProblems = validateConnectorManifest(adapter.manifest)
  assert.deepEqual(manifestProblems, [], `manifest must be valid: ${manifestProblems.join('; ')}`)
  assert.equal(adapter.manifest.readOnly, true, 'connectors are read-only')

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
      connectorId,
      accountLabel: connected.accountLabel,
      config: connected.config,
    })
    assert.equal(row.status, 'connected')
    const contractConnection = {
      connectorId,
      status: 'connected' as const,
      accountLabel: connected.accountLabel,
      config: connected.config,
      cursor: null as string | null,
    }

    // 3 — first sync: gate-passing envelopes, unique identity, and a valid
    // projection onto the shared evidence contract.
    const first = await adapter.sync({ connection: contractConnection, cursor: null, nowMs: Date.now() })
    assert.ok(first.records.length >= minRecords, `first sync must yield ≥ ${minRecords} record(s)`)
    const ids = new Set<string>()
    const connectedKinds = new Set<string>(CONNECTED_SOURCE_EVIDENCE_KINDS)
    for (const record of first.records) {
      const problems = validateRecordEnvelope(record)
      assert.deepEqual(problems, [], `record must pass the envelope gate: ${problems.join('; ')}`)
      assert.equal(record.provenance.connectorId, connectorId, 'records carry their own connector id')
      assert.equal(ids.has(record.provenance.sourceRecordId), false, 'source record ids are unique within a page')
      ids.add(record.provenance.sourceRecordId)

      const evidence = toConnectedEvidenceEnvelope(record, 'device-test')
      assert.ok(connectedKinds.has(evidence.kind), 'projection uses a connected-source evidence kind')
      assert.ok(isEvidenceSensitivity(evidence.sensitivity))
      assert.ok(isEvidenceConfidence(evidence.confidence))
      assert.equal(evidence.source.sourceRecordId, record.provenance.sourceRecordId)
      assert.ok(evidence.provenance.permissionScope.length > 0)
      // Idempotency is visible in the projection: same record, same identity.
      assert.equal(evidence.evidenceId, toConnectedEvidenceEnvelope(record, 'device-test').evidenceId)
    }

    // Ingest through the real service path.
    const synced = await syncConnector(db, connectorId, { adapter, gate: OPEN_GATE })
    assert.equal(synced.status, 'ok')
    assert.ok(synced.ingested >= minRecords)
    const committedCursor = getConnectorConnection(db, connectorId)?.sync_cursor ?? null
    assert.ok(committedCursor != null, 'a successful sync commits a cursor')

    // 4 — idempotency: quiet re-sync, and re-ingesting never duplicates.
    const second = await adapter.sync({
      connection: { ...contractConnection, cursor: committedCursor },
      cursor: committedCursor,
      nowMs: Date.now(),
    })
    assert.ok(
      second.unchanged === true || second.records.length === 0 || second.records.length === first.records.length,
      'a re-sync from the committed cursor is unchanged, empty, or a stable full view',
    )
    const before = connectedEntityCounts(db)
    const resynced = await syncConnector(db, connectorId, { adapter, gate: OPEN_GATE })
    assert.equal(resynced.status, 'ok')
    assert.deepEqual(connectedEntityCounts(db), before, 'a re-ingest must not duplicate entities')
    for (const [key, count] of before) {
      assert.equal(count, 1, `entity ${key} must exist exactly once`)
    }

    // 5 — failure and retry: a throwing page advances NOTHING, records a
    // sanitized summary and a bounded retry, and the next good sync recovers.
    const failing: ConnectorAdapter = {
      ...adapter,
      manifest: adapter.manifest,
      sync: async () => {
        throw new Error(`provider exploded (429); do not persist token ${SUITE_FAKE_TOKEN}`)
      },
    }
    const failed = await syncConnector(db, connectorId, { adapter: failing, gate: OPEN_GATE })
    assert.equal(failed.status, 'failed')
    const afterFailure = getConnectorConnection(db, connectorId)!
    assert.equal(afterFailure.sync_cursor, committedCursor, 'a failed page never advances the cursor')
    assert.equal(afterFailure.consecutive_failures, 1)
    assert.ok(afterFailure.next_retry_at != null, 'a failure schedules a retry')
    assert.ok(
      afterFailure.next_retry_at! - afterFailure.updated_at <= adapter.manifest.rateLimit.backoffMaxMs,
      'the retry delay is bounded by the manifest backoff policy',
    )
    assert.equal(afterFailure.last_sync_error?.includes(SUITE_FAKE_TOKEN), false, 'stored errors are sanitized')
    const recovered = await syncConnector(db, connectorId, { adapter, gate: OPEN_GATE })
    assert.equal(recovered.status, 'ok')
    const afterRecovery = getConnectorConnection(db, connectorId)!
    assert.equal(afterRecovery.consecutive_failures, 0)
    assert.equal(afterRecovery.last_sync_error, null)

    // 6 — health inspection, when the adapter implements it.
    if (adapter.inspect) {
      const health = await adapter.inspect({ ...contractConnection, cursor: committedCursor })
      assert.ok(health.state === 'ok' || health.state === 'needs_attention')
      assert.equal(containsCredential(health.summary), false, 'health summaries are credential-free')
    }

    // 7 — provider deletions become local tombstones (when the source can be
    // mutated from the test).
    if (context.removeOneRecord) {
      const removedId = context.removeOneRecord()
      const afterRemoval = await syncConnector(db, connectorId, { adapter, gate: OPEN_GATE })
      assert.equal(afterRemoval.status, 'ok')
      assert.ok(afterRemoval.tombstoned >= 1, 'a provider deletion tombstones the local record')
      const tombstoned = listConnectorRecords(db, connectorId, { includeTombstoned: true })
        .find((recordRow) => recordRow.source_record_id === removedId)
      assert.ok(tombstoned?.tombstoned_at != null, 'the tombstone is an explicit row, not silent deletion')
    }

    // 8 — renderer-visible surface is credential-free.
    const listingJson = JSON.stringify(listConnectorListings(db))
    assert.equal(containsCredential(listingJson), false, 'the Settings listing must be credential-free')
    assert.equal(listingJson.includes('sync_cursor'), false)

    // 9 — disconnect-with-delete removes records and unsupported entities.
    await disconnectConnector(db, connectorId, {
      deleteData: true,
      adapter,
      secretStore: { getPassword: async () => null, setPassword: async () => {}, deletePassword: async () => true },
    })
    assert.equal(listConnectorRecords(db, connectorId, { includeTombstoned: true }).length, 0)
    assert.equal(connectedEntityCounts(db).size, 0, 'disconnect-with-delete retires every solely-supported entity')
    assert.equal(getConnectorConnection(db, connectorId)?.status, 'disconnected')
  } finally {
    db.close()
  }
}
