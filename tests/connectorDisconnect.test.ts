// Disconnect and deletion (connectors.md §Disconnection and deletion,
// DEV-186): disconnecting stops sync and forgets credentials; the person
// chooses keep-or-delete for imported evidence; deletion removes every
// solely-supported derivative and NOTHING with independent support; the
// deletion journal replays the purge against a restored backup so deleted
// connector data can never resurrect.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { OPEN_GATE } from './support/connectorContractSuite.ts'
import { ingestConnectorPage } from '../src/main/connectors/ingest.ts'
import { disconnectConnector } from '../src/main/connectors/service.ts'
import { purgeConnectorDerivedData } from '../src/main/connectors/purge.ts'
import type { ConnectorRecordEnvelope, ConnectorAdapter } from '../src/main/connectors/contract.ts'
import { FAKE_CONNECTOR_ID, FAKE_CONNECTOR_MANIFEST } from './support/fakeConnectorProvider.ts'
import {
  getConnectorConnection,
  listConnectorRecords,
  saveConnectorConnection,
} from '../src/main/connectors/store.ts'
import { listEntities, addEntityEvidenceRef } from '../src/main/services/entities/entityRepository.ts'
import { getExternalSignal } from '../src/main/services/externalSignals.ts'
import { readDeletionJournal, replayDeletionJournal } from '../src/main/services/deletionJournal.ts'
import type { ConnectorSecretStore } from '../src/main/connectors/credentials.ts'

const T0 = new Date(2026, 6, 15, 10, 0, 0).getTime()

function envelope(uid: string, title: string, attendee?: { connectorId: string; displayName: string }): ConnectorRecordEnvelope {
  return {
    provenance: {
      connectorId: FAKE_CONNECTOR_ID,
      accountLabel: 'fake-account',
      workspace: null,
      sourceRecordId: uid,
      retrievedAtMs: T0,
      effectiveAtMs: T0,
      sensitivity: 'standard',
      permissionScope: 'records:read',
    },
    entity: {
      kind: 'calendar_event',
      sourceEventId: `fake:${uid}`,
      title,
      startMs: T0,
      attendees: attendee ? [attendee] : [],
    },
    daySignal: { date: '2026-07-15', title, startClock: '10:00', durationMinutes: 30, attendeeCount: attendee ? 1 : null },
  }
}

function seed(db: Database.Database): void {
  saveConnectorConnection(db, {
    connectorId: FAKE_CONNECTOR_ID,
    accountLabel: 'fake-account',
    config: { accountLabel: 'fake-account' },
  })
  ingestConnectorPage(db, FAKE_CONNECTOR_ID, {
    records: [
      envelope('uid-1', 'Weekly planning', { connectorId: 'email:ana@example.com', displayName: 'Ana Silva' }),
      envelope('uid-2', 'Board review'),
    ],
    nextCursor: 'c1',
  }, { gate: OPEN_GATE, nowMs: T0 })
}

function fakeSecretStore(): ConnectorSecretStore & { secrets: Map<string, string> } {
  const secrets = new Map<string, string>()
  return {
    secrets,
    getPassword: async (_service, account) => secrets.get(account) ?? null,
    setPassword: async (_service, account, password) => { secrets.set(account, password) },
    deletePassword: async (_service, account) => secrets.delete(account),
  }
}

const noopAdapter: ConnectorAdapter = {
  manifest: FAKE_CONNECTOR_MANIFEST,
  connect: async () => ({ accountLabel: 'fake-account', config: {} }),
  sync: async () => ({ records: [], nextCursor: null }),
  disconnect: async () => {},
}

test('disconnect KEEPING data: sync stops, credentials clear, evidence stays', async () => {
  const db = createProductionTestDatabase()
  try {
    seed(db)
    const store = fakeSecretStore()
    store.secrets.set('connector-fake_provider-token', 'xoxb-000000000000-fakefakefake')

    await disconnectConnector(db, FAKE_CONNECTOR_ID, {
      deleteData: false,
      secretStore: store,
      adapter: noopAdapter,
    })

    assert.equal(getConnectorConnection(db, FAKE_CONNECTOR_ID)?.status, 'disconnected')
    assert.equal(store.secrets.size, 0, 'credentials are deleted on disconnect')
    // The imported evidence remains — the person chose to keep it.
    assert.equal(listEntities(db, { type: 'meeting' }).length, 2)
    assert.ok(getExternalSignal(db, '2026-07-15', 'calendar'))
    assert.equal(listConnectorRecords(db, FAKE_CONNECTOR_ID).length, 2)
  } finally {
    db.close()
  }
})

test('disconnect DELETING data: every solely-supported derivative goes; independent evidence survives', async () => {
  const db = createProductionTestDatabase()
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-userdata-'))
  try {
    seed(db)
    // "Board review" gains independent support (another source saw it too).
    const board = listEntities(db, { type: 'meeting' }).find((entity) => entity.name === 'Board review')!
    addEntityEvidenceRef(db, board.id, { sourceType: 'external_signal', sourceId: '2026-07-15:notes' })

    await disconnectConnector(db, FAKE_CONNECTOR_ID, {
      deleteData: true,
      userDataPath,
      secretStore: fakeSecretStore(),
      adapter: noopAdapter,
    })

    const meetings = listEntities(db, { type: 'meeting' }).map((entity) => entity.name)
    assert.deepEqual(meetings, ['Board review'], 'independently supported evidence survives')
    assert.equal(listEntities(db, { type: 'person' }).length, 0, 'people only this source knew are retired')
    assert.equal(listConnectorRecords(db, FAKE_CONNECTOR_ID, { includeTombstoned: true }).length, 0)
    assert.equal(getExternalSignal(db, '2026-07-15', 'calendar'), null, 'the day-signal events are removed')
    assert.equal(getConnectorConnection(db, FAKE_CONNECTOR_ID)?.status, 'disconnected')

    // The deletion is journaled for backup-restore replay.
    const entries = readDeletionJournal(userDataPath)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].kind, 'connector-purge')
  } finally {
    db.close()
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('deletion-journal replay re-purges a restored backup — deleted connector data cannot resurrect', async () => {
  // The "backup": a database captured BEFORE the disconnect.
  const backupDb = createProductionTestDatabase()
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-userdata-'))
  try {
    seed(backupDb)
    assert.equal(listEntities(backupDb, { type: 'meeting' }).length, 2)

    // The live database disconnects with delete → journal entry appended.
    const liveDb = createProductionTestDatabase()
    try {
      seed(liveDb)
      await disconnectConnector(liveDb, FAKE_CONNECTOR_ID, {
        deleteData: true,
        userDataPath,
        secretStore: fakeSecretStore(),
        adapter: noopAdapter,
      })
    } finally {
      liveDb.close()
    }

    // "Restore" = replay the journal against the pre-deletion database.
    const result = replayDeletionJournal(backupDb, userDataPath)
    assert.equal(result.failed, 0)
    assert.ok(result.replayed >= 1)
    assert.equal(listEntities(backupDb, { type: 'meeting' }).length, 0)
    assert.equal(listEntities(backupDb, { type: 'person' }).length, 0)
    assert.equal(listConnectorRecords(backupDb, FAKE_CONNECTOR_ID, { includeTombstoned: true }).length, 0)
    assert.equal(getExternalSignal(backupDb, '2026-07-15', 'calendar'), null)

    // Replay is idempotent: running it again changes nothing and fails nothing.
    const again = replayDeletionJournal(backupDb, userDataPath)
    assert.equal(again.failed, 0)
  } finally {
    backupDb.close()
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('purge is a no-op on a database that never had the connector', () => {
  const db = createProductionTestDatabase()
  try {
    const result = purgeConnectorDerivedData(db, FAKE_CONNECTOR_ID)
    assert.equal(result.recordsRemoved, 0)
  } finally {
    db.close()
  }
})
