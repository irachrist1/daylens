// Connector ingestion (DEV-186): envelopes flow consent-gated into the entity
// repository and the external_signals day layer; re-ingestion is idempotent;
// a failed page never advances the cursor; malformed records quarantine whole;
// provider deletions tombstone locally and take their derived data with them.
import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { OPEN_GATE } from './support/connectorContractSuite.ts'
import { FAKE_CONNECTOR_ID, FAKE_CONNECTOR_MANIFEST } from './support/fakeConnectorProvider.ts'
import {
  ingestConnectorPage,
  type ConnectorIngestGate,
} from '../src/main/connectors/ingest.ts'
import type {
  ConnectorAdapter,
  ConnectorRecordEnvelope,
  ConnectorSyncPage,
} from '../src/main/connectors/contract.ts'
import {
  getConnectorConnection,
  listConnectorRecords,
  saveConnectorConnection,
} from '../src/main/connectors/store.ts'
import { syncConnector } from '../src/main/connectors/service.ts'
import { getExternalSignal } from '../src/main/services/externalSignals.ts'
import { listEntities, addEntityEvidenceRef } from '../src/main/services/entities/entityRepository.ts'
import type { CalendarSignal } from '../src/shared/types.ts'

const T0 = new Date(2026, 6, 15, 10, 0, 0).getTime()
const DATE = '2026-07-15'

function meetingEnvelope(overrides: {
  uid: string
  title: string
  startMs?: number
  attendees?: Array<{ connectorId: string; displayName: string }>
} ): ConnectorRecordEnvelope {
  const startMs = overrides.startMs ?? T0
  const at = new Date(startMs)
  const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
  return {
    provenance: {
      connectorId: FAKE_CONNECTOR_ID,
      accountLabel: 'fake-account',
      workspace: null,
      sourceRecordId: overrides.uid,
      retrievedAtMs: startMs,
      effectiveAtMs: startMs,
      sensitivity: 'standard',
      permissionScope: 'records:read',
    },
    entity: {
      kind: 'calendar_event',
      sourceEventId: `fake:${overrides.uid}`,
      title: overrides.title,
      startMs,
      endMs: startMs + 30 * 60_000,
      attendees: overrides.attendees ?? [],
    },
    daySignal: {
      date,
      title: overrides.title,
      startClock: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
      durationMinutes: 30,
      attendeeCount: overrides.attendees?.length || null,
    },
  }
}

function page(records: ConnectorRecordEnvelope[], cursor: string, present?: string[]): ConnectorSyncPage {
  return { records, nextCursor: cursor, presentSourceRecordIds: present }
}

function connectDb(db: Database.Database): void {
  saveConnectorConnection(db, {
    connectorId: FAKE_CONNECTOR_ID,
    accountLabel: 'fake-account',
    config: { accountLabel: 'fake-account' },
  })
}

function entityNames(db: Database.Database, type: 'meeting' | 'person'): string[] {
  return listEntities(db, { type }).map((entity) => entity.name).sort()
}

test('ingestion writes entities (meetings + people by connector id), evidence refs, and the day signal', () => {
  const db = createProductionTestDatabase()
  try {
    connectDb(db)
    const result = ingestConnectorPage(db, FAKE_CONNECTOR_ID, page([
      meetingEnvelope({
        uid: 'uid-standup',
        title: 'Team standup',
        attendees: [
          { connectorId: 'email:ana@example.com', displayName: 'Ana Silva' },
          { connectorId: 'email:ben@example.com', displayName: 'Ben Okafor' },
        ],
      }),
    ], 'cursor-1'), { gate: OPEN_GATE, nowMs: T0 })

    assert.deepEqual(result, { status: 'ok', ingested: 1, quarantined: 0, tombstoned: 0 })
    assert.deepEqual(entityNames(db, 'meeting'), ['Team standup'])
    assert.deepEqual(entityNames(db, 'person'), ['Ana Silva', 'Ben Okafor'])

    // People resolve by connector id (the spec's identity rule) — the meeting
    // has an 'attended' relationship from each person.
    const meeting = listEntities(db, { type: 'meeting' })[0]
    const related = db.prepare(`SELECT COUNT(*) AS c FROM entity_relationships WHERE related_entity_id = ?`)
      .get(meeting.id) as { c: number }
    assert.equal(related.c, 2)

    // Evidence refs carry the connector's source identity.
    const refs = db.prepare(`SELECT COUNT(*) AS c FROM entity_evidence_refs WHERE source_type = 'connector' AND source_id = ?`)
      .get(`${FAKE_CONNECTOR_ID}:uid-standup`) as { c: number }
    assert.equal(refs.c, 3) // meeting + two people

    // The record ledger row exists and the day signal landed.
    assert.equal(listConnectorRecords(db, FAKE_CONNECTOR_ID).length, 1)
    const signal = getExternalSignal<CalendarSignal>(db, DATE, 'calendar')
    assert.equal(signal?.payload.events.length, 1)
    assert.equal(signal?.payload.events[0].title, 'Team standup')
    assert.equal(signal?.payload.events[0].attendeeCount, 2)

    // The cursor committed together with the evidence.
    assert.equal(getConnectorConnection(db, FAKE_CONNECTOR_ID)?.sync_cursor, 'cursor-1')
  } finally {
    db.close()
  }
})

test('re-ingesting the same records is idempotent — no duplicate entities, refs, or events', () => {
  const db = createProductionTestDatabase()
  try {
    connectDb(db)
    const records = [
      meetingEnvelope({ uid: 'uid-1', title: 'Design review', attendees: [{ connectorId: 'email:ana@example.com', displayName: 'Ana Silva' }] }),
    ]
    ingestConnectorPage(db, FAKE_CONNECTOR_ID, page(records, 'c1'), { gate: OPEN_GATE, nowMs: T0 })
    ingestConnectorPage(db, FAKE_CONNECTOR_ID, page(records, 'c2'), { gate: OPEN_GATE, nowMs: T0 })

    assert.deepEqual(entityNames(db, 'meeting'), ['Design review'])
    assert.deepEqual(entityNames(db, 'person'), ['Ana Silva'])
    assert.equal(listConnectorRecords(db, FAKE_CONNECTOR_ID).length, 1)
    const signal = getExternalSignal<CalendarSignal>(db, DATE, 'calendar')
    assert.equal(signal?.payload.events.length, 1)
  } finally {
    db.close()
  }
})

test('the consent gate refuses the page whole — closed consent or a global off-switch writes NOTHING', () => {
  const db = createProductionTestDatabase()
  try {
    connectDb(db)
    const noConsent: ConnectorIngestGate = { isConsentCurrent: () => false, connectedSourcesEnabled: () => true }
    const disabled: ConnectorIngestGate = { isConsentCurrent: () => true, connectedSourcesEnabled: () => false }

    const blocked = ingestConnectorPage(db, FAKE_CONNECTOR_ID, page([
      meetingEnvelope({ uid: 'uid-1', title: 'Secret sync' }),
    ], 'c1'), { gate: noConsent })
    assert.equal(blocked.status, 'blocked_consent')

    const off = ingestConnectorPage(db, FAKE_CONNECTOR_ID, page([
      meetingEnvelope({ uid: 'uid-1', title: 'Secret sync' }),
    ], 'c1'), { gate: disabled })
    assert.equal(off.status, 'blocked_disabled')

    assert.equal(listEntities(db, { type: 'meeting' }).length, 0)
    assert.equal(listConnectorRecords(db, FAKE_CONNECTOR_ID).length, 0)
    assert.equal(getExternalSignal(db, DATE, 'calendar'), null)
    assert.equal(getConnectorConnection(db, FAKE_CONNECTOR_ID)?.sync_cursor, null)
  } finally {
    db.close()
  }
})

test('a malformed or credential-bearing record quarantines whole; the rest of the page lands', () => {
  const db = createProductionTestDatabase()
  try {
    connectDb(db)
    const leaky = meetingEnvelope({ uid: 'uid-leak', title: 'Sync ya29.a0AbCdEfGhIjKlMnOpQrStUvWxYz1234' })
    const fine = meetingEnvelope({ uid: 'uid-fine', title: 'Planning' })
    const result = ingestConnectorPage(db, FAKE_CONNECTOR_ID, page([leaky, fine], 'c1'), { gate: OPEN_GATE, nowMs: T0 })
    assert.equal(result.ingested, 1)
    assert.equal(result.quarantined, 1)
    assert.deepEqual(entityNames(db, 'meeting'), ['Planning'])
    // Not even partially normalized: no ledger row for the quarantined identity.
    assert.equal(listConnectorRecords(db, FAKE_CONNECTOR_ID).length, 1)
    // And nothing credential-shaped anywhere in the stored day signal.
    const signal = getExternalSignal<CalendarSignal>(db, DATE, 'calendar')
    assert.equal(signal?.payload.events.length, 1)
  } finally {
    db.close()
  }
})

test('a failed sync never advances the cursor and schedules a bounded retry with a sanitized error', async () => {
  const db = createProductionTestDatabase()
  try {
    connectDb(db)
    // Seed a committed cursor first.
    ingestConnectorPage(db, FAKE_CONNECTOR_ID, page([
      meetingEnvelope({ uid: 'uid-1', title: 'Planning' }),
    ], 'cursor-committed'), { gate: OPEN_GATE, nowMs: T0 })

    const failing: ConnectorAdapter = {
      manifest: FAKE_CONNECTOR_MANIFEST,
      connect: async () => { throw new Error('unused') },
      sync: async () => {
        throw new Error('HTTP 429 from provider: retry with token ghp_abcdefghijklmnopqrstuvwxyz0123456789')
      },
      disconnect: async () => {},
    }
    const result = await syncConnector(db, FAKE_CONNECTOR_ID, { adapter: failing, gate: OPEN_GATE, nowMs: T0 })
    assert.equal(result.status, 'failed')

    const row = getConnectorConnection(db, FAKE_CONNECTOR_ID)!
    assert.equal(row.sync_cursor, 'cursor-committed') // untouched
    assert.equal(row.consecutive_failures, 1)
    assert.ok(row.next_retry_at != null && row.next_retry_at > T0)
    // The stored error summary is sanitized — the token never persists.
    assert.ok(row.last_sync_error != null)
    assert.equal(row.last_sync_error!.includes('ghp_'), false)
  } finally {
    db.close()
  }
})

test('provider deletions tombstone locally and remove derived data — independent evidence survives', () => {
  const db = createProductionTestDatabase()
  try {
    connectDb(db)
    ingestConnectorPage(db, FAKE_CONNECTOR_ID, page([
      meetingEnvelope({ uid: 'uid-keep', title: 'Kept meeting' }),
      meetingEnvelope({ uid: 'uid-gone', title: 'Deleted meeting' }),
      meetingEnvelope({ uid: 'uid-shared', title: 'Shared meeting' }),
    ], 'c1'), { gate: OPEN_GATE, nowMs: T0 })

    // Give the "shared" meeting INDEPENDENT support (as if a transcript source
    // also saw it) — deletion must not take it.
    const shared = listEntities(db, { type: 'meeting' }).find((entity) => entity.name === 'Shared meeting')!
    addEntityEvidenceRef(db, shared.id, { sourceType: 'external_signal', sourceId: `${DATE}:notes` })

    // Next full sync: uid-gone and uid-shared vanished from the source.
    const result = ingestConnectorPage(db, FAKE_CONNECTOR_ID, page([
      meetingEnvelope({ uid: 'uid-keep', title: 'Kept meeting' }),
    ], 'c2', ['uid-keep']), { gate: OPEN_GATE, nowMs: T0 + 1000 })
    assert.equal(result.tombstoned, 2)

    const names = entityNames(db, 'meeting')
    assert.ok(names.includes('Kept meeting'))
    assert.ok(!names.includes('Deleted meeting'), 'a provider-deleted record loses its derived entity')
    assert.ok(names.includes('Shared meeting'), 'independent evidence keeps the entity alive')

    // The day signal lost exactly the unsupported events.
    const signal = getExternalSignal<CalendarSignal>(db, DATE, 'calendar')
    const titles = signal?.payload.events.map((event) => event.title).sort()
    assert.deepEqual(titles, ['Kept meeting'])

    // Tombstones are explicit rows, not silent deletion.
    const all = listConnectorRecords(db, FAKE_CONNECTOR_ID, { includeTombstoned: true })
    assert.equal(all.length, 3)
    assert.equal(all.filter((row) => row.tombstoned_at != null).length, 2)
  } finally {
    db.close()
  }
})
