// Connector foundation (DEV-186): the registry knows the whole upcoming
// provider list, every manifest passes contract validation, backoff stays
// bounded and respects provider reset hints, the record gate quarantines
// malformed and credential-bearing envelopes, the evidence projection
// satisfies the shared contract, and the store refuses credential-shaped
// connection config.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeBackoffMs,
  toConnectedEvidenceEnvelope,
  validateConnectorManifest,
  validateRecordEnvelope,
  type ConnectorRecordEnvelope,
} from '../src/main/connectors/contract.ts'
import {
  CONNECTED_SOURCE_EVIDENCE_KINDS,
  isEvidenceConfidence,
  isEvidenceSensitivity,
} from '../src/main/core/evidence/envelope.ts'
import {
  getConnectorAdapter,
  getConnectorManifest,
  listConnectorManifests,
} from '../src/main/connectors/registry.ts'
import { saveConnectorConnection } from '../src/main/connectors/store.ts'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { FAKE_CONNECTOR_ID, FAKE_CONNECTOR_MANIFEST } from './support/fakeConnectorProvider.ts'

const UPCOMING = ['google_calendar', 'outlook_calendar', 'github', 'linear', 'granola'] as const

test('the registry lists the upcoming providers with valid, read-only, manifest-only entries', () => {
  const manifests = listConnectorManifests()
  assert.equal(manifests.length, UPCOMING.length)
  for (const id of UPCOMING) {
    const manifest = manifests.find((entry) => entry.id === id)
    assert.ok(manifest, `${id} must be listed`)
    assert.equal(manifest.available, false, `${id} is manifest-only until its adapter lands`)
    assert.deepEqual(validateConnectorManifest(manifest), [], `${id} manifest must validate`)
    assert.equal(manifest.readOnly, true)
    assert.ok(manifest.whatItBrings.length > 20, `${id} needs real what-it-brings copy`)
    assert.ok(manifest.scopes.every((scope) => scope.grants.length > 10), `${id} scopes need plain-language copy`)
    // No adapter ships for a manifest-only entry.
    assert.equal(getConnectorAdapter(id), null)
  }
})

test('manifest validation rejects write scopes, missing copy, and unbounded sync', () => {
  const base = getConnectorManifest('google_calendar')!
  assert.ok(validateConnectorManifest({
    ...base,
    scopes: [{ scope: 'repo:write', grants: 'writes things' }],
  }).some((problem) => problem.includes('not read-only')))
  assert.ok(validateConnectorManifest({ ...base, scopes: [] }).length > 0)
  assert.ok(validateConnectorManifest({ ...base, whatItBrings: '' }).length > 0)
  assert.ok(validateConnectorManifest({ ...base, lookbackDays: 10_000 }).some((p) => p.includes('bounded')))
  // The fake provider's manifest passes the same validation as real ones.
  assert.deepEqual(validateConnectorManifest(FAKE_CONNECTOR_MANIFEST), [])
})

test('backoff grows exponentially, stays bounded, and honors provider reset hints', () => {
  const policy = { maxRequestsPerMinute: 10, backoffBaseMs: 1_000, backoffMaxMs: 60_000 }
  assert.equal(computeBackoffMs(policy, 1), 1_000)
  assert.equal(computeBackoffMs(policy, 2), 2_000)
  assert.equal(computeBackoffMs(policy, 3), 4_000)
  assert.equal(computeBackoffMs(policy, 50), 60_000) // bounded, no overflow
  // A later provider reset wins over the computed delay…
  assert.equal(computeBackoffMs(policy, 1, 30_000), 30_000)
  // …but never beyond the bound.
  assert.equal(computeBackoffMs(policy, 1, 10 * 60_000), 60_000)
})

function validEnvelope(): ConnectorRecordEnvelope {
  return {
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
    entity: { kind: 'calendar_event', sourceEventId: 'fake:rec-1', title: 'Weekly sync' },
  }
}

test('the record gate quarantines malformed and credential-bearing envelopes whole', () => {
  assert.deepEqual(validateRecordEnvelope(validEnvelope()), [])

  const missingIdentity = validEnvelope()
  missingIdentity.provenance.sourceRecordId = ''
  assert.ok(validateRecordEnvelope(missingIdentity).length > 0)

  const missingScope = validEnvelope()
  missingScope.provenance.permissionScope = ''
  assert.ok(validateRecordEnvelope(missingScope).length > 0)

  // A token-shaped string in CONTENT is a hard reject (credential hygiene).
  const leaky = validEnvelope()
  leaky.entity = { ...leaky.entity, title: 'Standup ghp_abcdefghijklmnopqrstuvwxyz0123456789' } as typeof leaky.entity
  assert.ok(validateRecordEnvelope(leaky).some((problem) => problem.includes('credential')))

  // …but legitimately long OPAQUE identity fields are exempt: provider record
  // ids are often 100+ hex characters and must not be false-positived.
  const longUid = validEnvelope()
  longUid.entity = {
    kind: 'calendar_event',
    sourceEventId: `fake:${'0123456789abcdef'.repeat(8)}`,
    title: 'Design review',
  }
  longUid.provenance.sourceRecordId = '0123456789abcdef'.repeat(8)
  assert.deepEqual(validateRecordEnvelope(longUid), [])
})

test('normalized records project onto the shared evidence contract, deterministically', () => {
  const record = validEnvelope()
  const evidence = toConnectedEvidenceEnvelope(record, 'device-1')
  assert.ok((CONNECTED_SOURCE_EVIDENCE_KINDS as readonly string[]).includes(evidence.kind))
  assert.ok(isEvidenceSensitivity(evidence.sensitivity))
  assert.ok(isEvidenceConfidence(evidence.confidence))
  assert.equal(evidence.source.adapter, `connector:${FAKE_CONNECTOR_ID}`)
  assert.equal(evidence.source.sourceRecordId, 'rec-1')
  assert.equal(evidence.provenance.method, 'connector_sync')
  assert.equal(evidence.provenance.permissionScope, 'records:read')
  // Idempotency is visible in the identity: same record, same evidence id.
  assert.equal(evidence.evidenceId, toConnectedEvidenceEnvelope(record, 'device-1').evidenceId)
})

test('the connection store refuses credential-shaped config values', () => {
  const db = createProductionTestDatabase()
  try {
    assert.throws(() => saveConnectorConnection(db, {
      connectorId: 'github',
      accountLabel: 'me',
      config: { token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
    }), /credential/i)
    // A normal, credential-free config is accepted.
    const row = saveConnectorConnection(db, {
      connectorId: FAKE_CONNECTOR_ID,
      accountLabel: 'fake-account',
      config: { accountLabel: 'fake-account' },
    })
    assert.equal(row.status, 'connected')
  } finally {
    db.close()
  }
})
