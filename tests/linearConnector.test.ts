// Linear connector (DEV-192): the issues provider runs the SAME contract
// conformance suite every other adapter proves (connectors.md acceptance:
// "Direct and brokered adapters pass the same contract suite"), against an
// in-memory Linear — plus the provider-specific legs the suite cannot know
// about: personal-API-key authorization with vault-only storage, updatedAt
// watermark incrementality, archived/trashed tombstones, revocation flagging,
// rate-limit respect, project entities by provider identity that relate to
// supplied Daylens projects WITHOUT silent merging, issue context in
// memory/search, credential hygiene across every persisted surface, and
// registry registration.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { assertConnectorContract, OPEN_GATE } from './support/connectorContractSuite.ts'
import {
  createFakeLinearApi,
  createFakeSecretStore,
  FAKE_LINEAR_API_KEY,
  FAKE_LINEAR_ENDPOINT,
  type FakeLinearApi,
} from './support/fakeLinearApi.ts'
import {
  createLinearAdapter,
  registerLinearConnector,
  LINEAR_MANIFEST,
} from '../src/main/connectors/linear/adapter.ts'
import {
  connectConnector,
  disconnectConnector,
  listConnectorListings,
  syncConnector,
} from '../src/main/connectors/service.ts'
import { getConnectorConnection, listConnectorRecords } from '../src/main/connectors/store.ts'
import {
  getConnectorAdapter,
  getConnectorManifest,
  listConnectorManifests,
} from '../src/main/connectors/registry.ts'
import {
  listEntities,
  listSuggestedEntityMerges,
  upsertEntity,
} from '../src/main/services/entities/entityRepository.ts'
import { indexMemoryForDay } from '../src/main/services/memoryIndex.ts'
import { searchExact } from '../src/main/services/exactSearch.ts'
import type { ConnectorId } from '../src/shared/types.ts'

const LINEAR: ConnectorId = 'linear'
const CONNECT_CONFIG = { apiKey: FAKE_LINEAR_API_KEY }

const VIEWER = {
  id: 'user-self',
  name: 'Ada Lovelace',
  displayName: 'Ada',
  email: 'ada@acme.test',
  organization: { id: 'org-1', name: 'Acme', urlKey: 'acme' },
}

function isoDaysAgo(days: number, hour: number, minute = 0): string {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  at.setHours(hour, minute, 0, 0)
  return at.toISOString()
}

function localDateDaysAgo(days: number): string {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

function seedSource(fake: FakeLinearApi): void {
  fake.putIssue({
    id: 'issue-pay',
    identifier: 'DAY-12',
    title: 'Payment bug: retries double-charge',
    createdAt: isoDaysAgo(5, 9, 0),
    updatedAt: isoDaysAgo(1, 15, 0),
    state: { name: 'In Progress', type: 'started' },
    team: { id: 'team-1', key: 'DAY', name: 'Daylens' },
    project: { id: 'proj-1', name: 'Billing hardening' },
    cycle: { id: 'cycle-1', number: 23 },
    assignee: { id: 'user-self', name: 'Ada' },
    creator: { id: 'user-dana', name: 'Dana Reyes', displayName: 'dana' },
  })
  fake.putIssue({
    id: 'issue-done',
    identifier: 'DAY-9',
    title: 'Sync loses its watermark on restart',
    createdAt: isoDaysAgo(6, 9, 0),
    updatedAt: isoDaysAgo(2, 11, 0),
    completedAt: isoDaysAgo(2, 11, 0),
    state: { name: 'Done', type: 'completed' },
    team: { id: 'team-1', key: 'DAY', name: 'Daylens' },
    project: { id: 'proj-1', name: 'Billing hardening' },
    creator: { id: 'user-self', name: 'Ada' },
  })
  fake.putIssue({
    id: 'issue-open',
    identifier: 'DAY-15',
    title: 'Cycle summaries drift from board state',
    createdAt: isoDaysAgo(3, 10, 0),
    updatedAt: isoDaysAgo(3, 10, 0),
    state: { name: 'Todo', type: 'unstarted' },
    team: { id: 'team-1', key: 'DAY', name: 'Daylens' },
    creator: { id: 'user-self', name: 'Ada' },
  })
  // Someone ELSE's issue: never requested into the person's evidence.
  fake.putIssue({
    id: 'issue-other',
    identifier: 'DAY-99',
    title: 'Not your issue',
    createdAt: isoDaysAgo(2, 9, 0),
    updatedAt: isoDaysAgo(2, 9, 0),
    state: { name: 'Todo', type: 'unstarted' },
    creator: { id: 'user-zoe', name: 'Zoe' },
    assignee: { id: 'user-zoe', name: 'Zoe' },
  })
}

interface Harness {
  fake: FakeLinearApi
  store: ReturnType<typeof createFakeSecretStore>
  adapter: ReturnType<typeof createLinearAdapter>
}

function createHarness(): Harness {
  const fake = createFakeLinearApi(VIEWER)
  seedSource(fake)
  const store = createFakeSecretStore()
  const adapter = createLinearAdapter({
    fetchImpl: fake.fetchImpl,
    secretStore: store,
    endpoint: FAKE_LINEAR_ENDPOINT,
  })
  return { fake, store, adapter }
}

test('the Linear adapter passes the full shared contract suite', async () => {
  const { fake, adapter } = createHarness()
  await assertConnectorContract({
    adapter,
    connectInput: { config: CONNECT_CONFIG },
    minRecords: 3,
    removeOneRecord: () => {
      fake.removeIssue('issue-open')
      return 'issue:issue-open'
    },
  })
})

test('the adapter manifest matches the registry entry word for word, with available flipped', () => {
  const upcoming = getConnectorManifest(LINEAR)!
  assert.equal(upcoming.available, false, 'the registry entry stays manifest-only until registration')
  assert.deepEqual(LINEAR_MANIFEST, { ...upcoming, available: true })
  assert.equal(LINEAR_MANIFEST.authKind, 'token', 'personal API key is the individual authorization')
  assert.equal(LINEAR_MANIFEST.readOnly, true)
})

test('registering the adapter flips linear to connectable without hiding the other manifests', () => {
  registerLinearConnector()
  assert.ok(getConnectorAdapter(LINEAR), 'the adapter is registered')
  const manifests = listConnectorManifests()
  assert.equal(manifests.find((manifest) => manifest.id === LINEAR)?.available, true)
  for (const other of ['google_calendar', 'outlook_calendar'] as const) {
    assert.ok(manifests.find((manifest) => manifest.id === other), `${other} stays listed`)
  }
})

test('connect validates the key first, stores it vault-only, and persists a credential-free config', async () => {
  const db = createProductionTestDatabase()
  const { store, adapter } = createHarness()
  try {
    const connected = await connectConnector(db, LINEAR, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    assert.equal(connected.status, 'ok')
    assert.equal(connected.ingested, 3, 'only the person\'s own issues ingest')

    const row = getConnectorConnection(db, LINEAR)!
    assert.equal(row.account_label, 'Ada · acme')
    assert.equal(row.config_json.includes(FAKE_LINEAR_API_KEY), false, 'the key never enters the database')
    assert.ok(row.config_json.includes('user-self'), 'the config carries only credential-free identity')
    const vaulted = [...store.dump().values()]
    assert.ok(vaulted.some((secret) => secret === FAKE_LINEAR_API_KEY), 'the key lives in the OS secure store')

    // Every renderer-visible and persisted surface stays key-free.
    const surfaces = [
      JSON.stringify(listConnectorListings(db)),
      JSON.stringify(db.prepare(`SELECT * FROM connector_connections`).all()),
      JSON.stringify(db.prepare(`SELECT * FROM connector_records`).all()),
    ]
    for (const surface of surfaces) {
      assert.equal(surface.includes(FAKE_LINEAR_API_KEY), false)
    }
  } finally {
    db.close()
  }
})

test('a bad key fails the connect with plain copy and stores nothing', async () => {
  const db = createProductionTestDatabase()
  const fake = createFakeLinearApi(VIEWER)
  const store = createFakeSecretStore()
  const adapter = createLinearAdapter({ fetchImpl: fake.fetchImpl, secretStore: store, endpoint: FAKE_LINEAR_ENDPOINT })
  try {
    await assert.rejects(
      connectConnector(db, LINEAR, { apiKey: 'lin_api_wrongkey00000000000000000000000000' }, { adapter, gate: OPEN_GATE }),
      /rejected the stored API key/i,
    )
    assert.equal(store.dump().size, 0, 'a rejected key is never stored')
    assert.equal(getConnectorConnection(db, LINEAR), null)
  } finally {
    db.close()
  }
})

test('watermark incrementality: a quiet source syncs empty; a moved issue syncs alone and updates its own row', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    await connectConnector(db, LINEAR, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    const cursorAfterFirst = getConnectorConnection(db, LINEAR)!.sync_cursor
    assert.ok(cursorAfterFirst, 'the full window commits a watermark cursor')

    const quiet = await syncConnector(db, LINEAR, { adapter, gate: OPEN_GATE })
    assert.equal(quiet.status, 'ok')
    assert.equal(quiet.ingested, 0)
    assert.equal(getConnectorConnection(db, LINEAR)!.sync_cursor, cursorAfterFirst)

    // The payment issue MOVES to Done: only the delta syncs, and it lands on
    // the same ledger row — a status change is not a second issue.
    const before = listConnectorRecords(db, LINEAR).length
    fake.putIssue({
      id: 'issue-pay',
      identifier: 'DAY-12',
      title: 'Payment bug: retries double-charge',
      createdAt: isoDaysAgo(5, 9, 0),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      state: { name: 'Done', type: 'completed' },
      team: { id: 'team-1', key: 'DAY', name: 'Daylens' },
      project: { id: 'proj-1', name: 'Billing hardening' },
      assignee: { id: 'user-self', name: 'Ada' },
      creator: { id: 'user-dana', name: 'Dana Reyes', displayName: 'dana' },
    })
    const delta = await syncConnector(db, LINEAR, { adapter, gate: OPEN_GATE })
    assert.equal(delta.status, 'ok')
    assert.equal(delta.ingested, 1, 'only the changed issue syncs')
    assert.notEqual(getConnectorConnection(db, LINEAR)!.sync_cursor, cursorAfterFirst)
    assert.equal(listConnectorRecords(db, LINEAR).length, before, 'the moved issue updated its own row')

    const moved = listConnectorRecords(db, LINEAR).find((row) => row.source_record_id === 'issue:issue-pay')!
    assert.ok(moved.envelope_json.includes('"completed"'), 'the row carries the new state category')
  } finally {
    db.close()
  }
})

test('status changes become searchable connected memory: "moved" and "completed" statements, labeled Linear', async () => {
  const db = createProductionTestDatabase()
  const { adapter } = createHarness()
  try {
    await connectConnector(db, LINEAR, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    indexMemoryForDay(db, localDateDaysAgo(1))
    indexMemoryForDay(db, localDateDaysAgo(2))

    const moved = searchExact(db, 'Payment bug')
    assert.ok(moved.length >= 1, 'the moved issue is findable by its title')
    const record = moved.find((result) => result.appName === 'Linear')
    assert.ok(record, 'the result is honestly labeled by its provider')

    const rows = db.prepare(
      `SELECT statement FROM memory_records WHERE record_kind = 'connected_activity' ORDER BY statement`,
    ).all() as Array<{ statement: string }>
    assert.ok(rows.some((row) => /^Linear: moved DAY-12 "Payment bug: retries double-charge" to In Progress in project Billing hardening \(cycle 23\)$/.test(row.statement)))
    assert.ok(rows.some((row) => /^Linear: completed DAY-9 /.test(row.statement)))
  } finally {
    db.close()
  }
})

test('Linear projects and Daylens project entities RELATE without silent merging', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    // A supplied Daylens project of the same name exists first.
    upsertEntity(db, {
      type: 'project',
      identityKey: 'supplied:proj-daylens-1',
      name: 'Billing hardening',
      origin: 'supplied',
    })
    await connectConnector(db, LINEAR, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })

    const projects = listEntities(db, { type: 'project' })
    const names = projects.filter((entity) => entity.name === 'Billing hardening')
    assert.equal(names.length, 2, 'the provider project and the supplied project stay two entities')

    const suggestions = listSuggestedEntityMerges(db)
    assert.ok(
      suggestions.some((suggestion) =>
        suggestion.type === 'project'
        && suggestion.leftName === 'Billing hardening'
        && suggestion.rightName === 'Billing hardening'),
      'the relationship surfaces as a person-decided merge suggestion',
    )

    // Provider identity survives a rename: same source project id, new name,
    // still ONE provider entity.
    fake.putIssue({
      id: 'issue-pay',
      identifier: 'DAY-12',
      title: 'Payment bug: retries double-charge',
      createdAt: isoDaysAgo(5, 9, 0),
      updatedAt: new Date().toISOString(),
      state: { name: 'In Progress', type: 'started' },
      project: { id: 'proj-1', name: 'Billing hardening v2' },
      assignee: { id: 'user-self', name: 'Ada' },
      creator: { id: 'user-self', name: 'Ada' },
    })
    await syncConnector(db, LINEAR, { adapter, gate: OPEN_GATE })
    const providerProjects = listEntities(db, { type: 'project' })
      .filter((entity) => entity.origin === 'connected')
    assert.equal(providerProjects.length, 1, 'a renamed provider project stays one entity')
    assert.equal(providerProjects[0].name, 'Billing hardening v2')
  } finally {
    db.close()
  }
})

test('a revoked key flags needs_attention on the FIRST failure, with a sanitized error', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    await connectConnector(db, LINEAR, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    fake.revokeKey()
    // Push something past the watermark so the sync must actually read.
    fake.putIssue({
      id: 'issue-new',
      identifier: 'DAY-20',
      title: 'Post-revocation issue',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      creator: { id: 'user-self', name: 'Ada' },
    })
    const failed = await syncConnector(db, LINEAR, { adapter, gate: OPEN_GATE })
    assert.equal(failed.status, 'failed')
    const row = getConnectorConnection(db, LINEAR)!
    assert.equal(row.status, 'needs_attention', 'reauthorization-shaped failures flag immediately')
    assert.equal(row.consecutive_failures, 1)
    assert.equal(row.last_sync_error?.includes(FAKE_LINEAR_API_KEY), false)
  } finally {
    db.close()
  }
})

test('a 429 schedules the retry at the provider reset hint, bounded by the manifest backoff', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    await connectConnector(db, LINEAR, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    const nowMs = Date.now()
    fake.failNext({ status: 429, retryAfterSec: 300 })
    const failed = await syncConnector(db, LINEAR, { adapter, gate: OPEN_GATE, nowMs })
    assert.equal(failed.status, 'failed')
    const row = getConnectorConnection(db, LINEAR)!
    assert.ok(row.next_retry_at != null)
    assert.ok(row.next_retry_at! >= nowMs + 300_000, 'the provider reset hint is respected')
    assert.ok(
      row.next_retry_at! <= nowMs + LINEAR_MANIFEST.rateLimit.backoffMaxMs,
      'the retry stays inside the bounded backoff',
    )
  } finally {
    db.close()
  }
})

test('disconnect-with-delete removes the records everywhere: ledger, entities, memory, search', async () => {
  const db = createProductionTestDatabase()
  const { store, adapter } = createHarness()
  try {
    await connectConnector(db, LINEAR, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    indexMemoryForDay(db, localDateDaysAgo(1))
    assert.ok(searchExact(db, 'Payment bug').length >= 1)
    assert.ok(listEntities(db, { type: 'project' }).length >= 1)

    await disconnectConnector(db, LINEAR, { deleteData: true, adapter, secretStore: store })

    assert.equal(listConnectorRecords(db, LINEAR, { includeTombstoned: true }).length, 0)
    assert.equal(listEntities(db, { type: 'project' }).filter((entity) => entity.origin === 'connected').length, 0)
    assert.equal(listEntities(db, { type: 'person' }).length, 0)
    assert.equal([...store.dump().values()].includes(FAKE_LINEAR_API_KEY), false, 'the vault entry is gone')
    // Search cannot resurrect: the day re-projects without the ledger rows.
    indexMemoryForDay(db, localDateDaysAgo(1))
    assert.equal(searchExact(db, 'Payment bug').filter((result) => result.appName === 'Linear').length, 0)
  } finally {
    db.close()
  }
})

test('the fake refuses mutations — and the adapter never sends one across the whole lifecycle', async () => {
  const db = createProductionTestDatabase()
  const { fake, store, adapter } = createHarness()
  try {
    const connected = await connectConnector(db, LINEAR, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    assert.equal(connected.status, 'ok')
    await syncConnector(db, LINEAR, { adapter, gate: OPEN_GATE })
    await disconnectConnector(db, LINEAR, { deleteData: false, adapter, secretStore: store })
    assert.ok(fake.requestCount() > 0)
    // Every request succeeded read-only; a mutation would have failed the run.
  } finally {
    db.close()
  }
})
