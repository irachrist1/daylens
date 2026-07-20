// The fake provider proves the connector contract end to end (the ticket's
// deliverable): it passes the full shared conformance suite — including the
// failure, retry, tombstone, and deletion legs — and the lifecycle reads like
// a real source: connect brings records in as entities and day signals, an
// unchanged source re-syncs quietly, source edits follow the same identity,
// provider deletions clean up, and provider-side disconnect actually runs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { assertConnectorContract, OPEN_GATE } from './support/connectorContractSuite.ts'
import {
  createFakeConnectorProvider,
  FAKE_CONNECTOR_ID,
  type FakeSourceRecord,
} from './support/fakeConnectorProvider.ts'
import { connectConnector, syncConnector } from '../src/main/connectors/service.ts'
import { getConnectorConnection, listConnectorRecords } from '../src/main/connectors/store.ts'
import { listEntities } from '../src/main/services/entities/entityRepository.ts'
import { getExternalSignal } from '../src/main/services/externalSignals.ts'
import type { CalendarSignal } from '../src/shared/types.ts'

const T0 = new Date(2026, 6, 15, 9, 30, 0).getTime()
const DATE = '2026-07-15'

function sourceRecords(): FakeSourceRecord[] {
  return [
    {
      id: 'rec-standup',
      title: 'Team standup',
      startMs: T0,
      endMs: T0 + 30 * 60_000,
      attendees: [
        { connectorId: 'fake:ana', displayName: 'Ana Silva' },
        { connectorId: 'fake:ben', displayName: 'Ben Okafor' },
      ],
    },
    { id: 'rec-review', title: 'Design review', startMs: T0 + 4 * 60 * 60_000 },
  ]
}

test('the fake provider passes the full contract suite, including failure, retry, and deletion paths', async () => {
  const provider = createFakeConnectorProvider(sourceRecords())
  await assertConnectorContract({
    adapter: provider,
    connectInput: { config: { accountLabel: 'contract-suite' } },
    minRecords: 2,
    removeOneRecord: () => {
      provider.deleteRecord('rec-review')
      return 'rec-review'
    },
  })
  // The suite's final leg disconnects with delete; provider-side cleanup ran.
  assert.equal(provider.revoked, true)
})

test('end to end: connect → entities + people + day signals; edits and provider deletions follow', async () => {
  const db = createProductionTestDatabase()
  const provider = createFakeConnectorProvider(sourceRecords())
  try {
    // Connect = validate + first sync, one step.
    const summary = await connectConnector(db, FAKE_CONNECTOR_ID, { accountLabel: 'work-account' }, {
      adapter: provider,
      gate: OPEN_GATE,
    })
    assert.equal(summary.status, 'ok')
    assert.equal(summary.ingested, 2)

    const connection = getConnectorConnection(db, FAKE_CONNECTOR_ID)!
    assert.equal(connection.status, 'connected')
    assert.equal(connection.account_label, 'work-account')
    assert.ok(connection.sync_cursor)

    // Meetings exist by SOURCE identity; attendees are people by connector id.
    const meetings = listEntities(db, { type: 'meeting' }).map((entity) => entity.name).sort()
    assert.deepEqual(meetings, ['Design review', 'Team standup'])
    const people = listEntities(db, { type: 'person' }).map((entity) => entity.name).sort()
    assert.deepEqual(people, ['Ana Silva', 'Ben Okafor'])

    // The day layer sees both events, with clock and attendee count.
    const signal = getExternalSignal<CalendarSignal>(db, DATE, 'calendar')!
    const standup = signal.payload.events.find((event) => event.title === 'Team standup')!
    assert.equal(standup.startClock, '09:30')
    assert.equal(standup.attendeeCount, 2)

    // An unchanged source re-syncs quietly (cursor short-circuit).
    const unchanged = await syncConnector(db, FAKE_CONNECTOR_ID, { adapter: provider, gate: OPEN_GATE })
    assert.equal(unchanged.status, 'ok')
    assert.equal(unchanged.ingested, 0)

    // Source edit: retitle + move one record, delete the other.
    provider.putRecord({
      id: 'rec-standup',
      title: 'Team standup (moved)',
      startMs: T0 + 5 * 60 * 60_000,
      attendees: [{ connectorId: 'fake:ana', displayName: 'Ana Silva' }],
    })
    provider.deleteRecord('rec-review')
    const resync = await syncConnector(db, FAKE_CONNECTOR_ID, { adapter: provider, gate: OPEN_GATE })
    assert.equal(resync.status, 'ok')
    assert.equal(resync.ingested, 1)
    assert.equal(resync.tombstoned, 1)

    // Same source id → same entity, renamed; deleted id → entity retired.
    const after = listEntities(db, { type: 'meeting' }).map((entity) => entity.name).sort()
    assert.deepEqual(after, ['Team standup (moved)'])

    // The day layer moved with it: the old clock slot is gone.
    const daySignal = getExternalSignal<CalendarSignal>(db, DATE, 'calendar')!
    assert.deepEqual(
      daySignal.payload.events.map((event) => [event.title, event.startClock]),
      [['Team standup (moved)', '14:30']],
    )

    // Ledger: one active record, one explicit tombstone.
    const rows = listConnectorRecords(db, FAKE_CONNECTOR_ID, { includeTombstoned: true })
    assert.equal(rows.filter((row) => row.tombstoned_at == null).length, 1)
    assert.equal(rows.filter((row) => row.tombstoned_at != null).length, 1)
  } finally {
    db.close()
  }
})

test('health inspection reports the provider state without leaking anything', async () => {
  const provider = createFakeConnectorProvider(sourceRecords())
  const connection = {
    connectorId: FAKE_CONNECTOR_ID,
    status: 'connected' as const,
    accountLabel: 'work-account',
    config: {},
    cursor: null,
  }
  assert.deepEqual(await provider.inspect!(connection), { state: 'ok', summary: 'The source is reachable.' })
  provider.setUnhealthy('Authorization expired; reconnect to resume syncing.')
  const health = await provider.inspect!(connection)
  assert.equal(health.state, 'needs_attention')
})
