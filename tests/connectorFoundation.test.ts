// Connector foundation (DEV-186): the registry knows the whole Connections
// wave, every manifest passes contract validation, backoff stays bounded and
// respects provider reset hints, the record gate quarantines malformed and
// credential-bearing envelopes, and the store refuses credential-shaped
// connection config.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeBackoffMs,
  validateConnectorManifest,
  validateRecordEnvelope,
  type ConnectorManifest,
  type ConnectorRecordEnvelope,
} from '../src/main/connectors/contract.ts'
import {
  getConnectorAdapter,
  getConnectorManifest,
  listConnectorManifests,
} from '../src/main/connectors/registry.ts'
import { saveConnectorConnection } from '../src/main/connectors/store.ts'
import { createProductionTestDatabase } from './support/testDatabase.ts'

const WAVE: Array<{ id: string; available: boolean }> = [
  { id: 'ics_calendar', available: true },
  { id: 'google_calendar', available: false },
  { id: 'outlook_calendar', available: false },
  { id: 'github', available: false },
  { id: 'linear', available: false },
  { id: 'granola', available: false },
]

test('the registry lists the whole Connections wave with valid, read-only manifests', () => {
  const manifests = listConnectorManifests()
  assert.equal(manifests.length, WAVE.length)
  for (const expected of WAVE) {
    const manifest = manifests.find((entry) => entry.id === expected.id)
    assert.ok(manifest, `${expected.id} must be listed`)
    assert.equal(manifest.available, expected.available, `${expected.id} availability`)
    assert.deepEqual(validateConnectorManifest(manifest), [], `${expected.id} manifest must validate`)
    assert.equal(manifest.readOnly, true)
    assert.ok(manifest.whatItBrings.length > 20, `${expected.id} needs real what-it-brings copy`)
    assert.ok(manifest.scopes.every((scope) => scope.grants.length > 10), `${expected.id} scopes need plain-language copy`)
  }
  // Working adapters exist exactly for the available manifests.
  for (const expected of WAVE) {
    const adapter = getConnectorAdapter(expected.id as ConnectorManifest['id'])
    assert.equal(adapter != null, expected.available, `${expected.id} adapter presence`)
  }
  // Available connectors sort first so Settings leads with what works today.
  assert.equal(manifests[0].id, 'ics_calendar')
})

test('manifest validation rejects write scopes, missing copy, and unbounded sync', () => {
  const base = getConnectorManifest('ics_calendar')!
  assert.ok(validateConnectorManifest({
    ...base,
    scopes: [{ scope: 'repo:write', grants: 'writes things' }],
  }).some((problem) => problem.includes('not read-only')))
  assert.ok(validateConnectorManifest({ ...base, scopes: [] }).length > 0)
  assert.ok(validateConnectorManifest({ ...base, whatItBrings: '' }).length > 0)
  assert.ok(validateConnectorManifest({ ...base, lookbackDays: 10_000 }).some((p) => p.includes('bounded')))
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
      connectorId: 'ics_calendar',
      accountLabel: 'work.ics',
      workspace: null,
      sourceRecordId: 'uid-1',
      retrievedAtMs: Date.now(),
      effectiveAtMs: Date.now(),
      sensitivity: 'standard',
      permissionScope: 'file:read',
    },
    entity: { kind: 'calendar_event', sourceEventId: 'ics:uid-1', title: 'Weekly sync' },
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
  // ids (Outlook UIDs are 100+ hex chars) must not be false-positived.
  const longUid = validEnvelope()
  longUid.entity = {
    kind: 'calendar_event',
    sourceEventId: `ics:${'0123456789abcdef'.repeat(8)}`,
    title: 'Design review',
  }
  longUid.provenance.sourceRecordId = '0123456789abcdef'.repeat(8)
  assert.deepEqual(validateRecordEnvelope(longUid), [])
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
      connectorId: 'ics_calendar',
      accountLabel: 'work.ics',
      config: { filePath: '/home/person/calendars/work.ics' },
    })
    assert.equal(row.status, 'connected')
  } finally {
    db.close()
  }
})
