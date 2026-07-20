// Outlook Calendar connector (DEV-190): the Microsoft Graph provider runs the
// SAME contract conformance suite every other adapter passes (connectors.md
// acceptance: "Direct and brokered adapters pass the same contract suite"),
// against an in-memory Graph — plus the provider-specific legs the suite
// cannot know about: deltaLink incrementality, "@removed" deletion stubs and
// cancellations under cursor semantics, 410 delta invalidation with attested
// full-window recovery, the windowed-delta rollover Google does not have,
// mid-pagination failure atomicity, Retry-After respect, access-token
// refresh, credential hygiene across every persisted surface, and registry
// registration.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { assertConnectorContract, OPEN_GATE } from './support/connectorContractSuite.ts'
import {
  createFakeMicrosoftGraphApi,
  createFakeSecretStore,
  FAKE_GRAPH_ENDPOINTS,
  FAKE_MS_REFRESH_TOKEN,
  type FakeMicrosoftGraphApi,
} from './support/fakeMicrosoftGraphApi.ts'
import {
  createOutlookCalendarAdapter,
  registerOutlookCalendarConnector,
  OUTLOOK_CALENDAR_MANIFEST,
} from '../src/main/connectors/outlookCalendar/adapter.ts'
import type { OutlookApiEvent } from '../src/main/connectors/outlookCalendar/api.ts'
import { connectConnector, disconnectConnector, listConnectorListings, syncConnector } from '../src/main/connectors/service.ts'
import { getConnectorConnection, listConnectorRecords } from '../src/main/connectors/store.ts'
import { connectorSecretAccount } from '../src/main/connectors/credentials.ts'
import {
  getConnectorAdapter,
  getConnectorManifest,
  listConnectorManifests,
} from '../src/main/connectors/registry.ts'
import { listEntities } from '../src/main/services/entities/entityRepository.ts'
import { getExternalSignal } from '../src/main/services/externalSignals.ts'
import type { CalendarSignal, ConnectorId } from '../src/shared/types.ts'

const OUTLOOK: ConnectorId = 'outlook_calendar'
const CLIENT_ID = '11111111-2222-3333-4444-555555555555'

function graphIsoDaysAgo(days: number, hour: number, minute = 0): string {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  at.setHours(hour, minute, 0, 0)
  // Graph renders UTC times WITHOUT an offset suffix under
  // Prefer: outlook.timezone="UTC" — mirror that exactly.
  return at.toISOString().replace(/\.\d{3}Z$/, '.0000000')
}

function localDateDaysAgo(days: number): string {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

function sourceEvents(): OutlookApiEvent[] {
  return [
    {
      id: 'AAMkAGI1-standup',
      subject: 'Team standup',
      start: { dateTime: graphIsoDaysAgo(2, 9, 30), timeZone: 'UTC' },
      end: { dateTime: graphIsoDaysAgo(2, 10, 0), timeZone: 'UTC' },
      responseStatus: { response: 'accepted' },
      attendees: [
        { emailAddress: { address: 'owner@example.com', name: 'Owner Example' }, type: 'required', status: { response: 'accepted' } },
        { emailAddress: { address: 'ana@example.com', name: 'Ana Silva' }, type: 'required', status: { response: 'accepted' } },
        { emailAddress: { address: 'ben@example.com' }, type: 'optional', status: { response: 'none' } },
      ],
    },
    {
      id: 'AAMkAGI1-design-review',
      subject: 'Design review',
      start: { dateTime: graphIsoDaysAgo(1, 14, 0), timeZone: 'UTC' },
      end: { dateTime: graphIsoDaysAgo(1, 15, 0), timeZone: 'UTC' },
      responseStatus: { response: 'organizer' },
    },
  ]
}

interface Harness {
  fake: FakeMicrosoftGraphApi
  store: ReturnType<typeof createFakeSecretStore>
  adapter: ReturnType<typeof createOutlookCalendarAdapter>
}

function createHarness(events: OutlookApiEvent[] = sourceEvents()): Harness {
  const fake = createFakeMicrosoftGraphApi(events)
  const store = createFakeSecretStore()
  const adapter = createOutlookCalendarAdapter({
    fetchImpl: fake.fetchImpl,
    // The fake person approves at microsoft.com/devicelogin the moment the
    // browser opens — the device flow completes on the next poll.
    openExternal: () => fake.approveDevice(),
    secretStore: store,
    endpoints: FAKE_GRAPH_ENDPOINTS,
    env: {},
    authTimeoutMs: 10_000,
  })
  return { fake, store, adapter }
}

const CONNECT_INPUT = { config: { clientId: CLIENT_ID } }

test('the Outlook Calendar adapter passes the full shared contract suite', async () => {
  const { fake, adapter } = createHarness()
  await assertConnectorContract({
    adapter,
    connectInput: CONNECT_INPUT,
    minRecords: 2,
    removeOneRecord: () => {
      fake.removeEvent('AAMkAGI1-design-review')
      return 'AAMkAGI1-design-review'
    },
  })
})

test('the adapter manifest matches the registry entry word for word, with available flipped', () => {
  const upcoming = getConnectorManifest(OUTLOOK)!
  assert.equal(upcoming.available, false, 'the registry entry stays manifest-only until registration')
  assert.deepEqual(OUTLOOK_CALENDAR_MANIFEST, { ...upcoming, available: true })
})

test('registering the adapter flips outlook_calendar to connectable without hiding the other manifests', () => {
  registerOutlookCalendarConnector()
  assert.ok(getConnectorAdapter(OUTLOOK), 'the adapter is registered')
  const manifests = listConnectorManifests()
  assert.equal(manifests.length, 5, 'registration never hides the manifest-only wave')
  assert.equal(manifests.find((manifest) => manifest.id === OUTLOOK)?.available, true)
  for (const other of ['google_calendar', 'github', 'linear', 'granola'] as const) {
    assert.equal(manifests.find((manifest) => manifest.id === other)?.available, false, `${other} stays manifest-only`)
  }
})

test('deltaLink incrementality: adds, edits, deletions, and cancellations flow without re-reading the world', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    const connected = await connectConnector(db, OUTLOOK, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    assert.equal(connected.status, 'ok')
    assert.equal(connected.ingested, 2)
    const cursorAfterFirst = getConnectorConnection(db, OUTLOOK)!.sync_cursor
    assert.ok(cursorAfterFirst, 'the full window commits a deltaLink cursor')
    const fullSyncRequests = fake.eventsRequests

    // Unchanged source → quiet incremental sync, cursor semantics intact.
    const quiet = await syncConnector(db, OUTLOOK, { adapter, gate: OPEN_GATE })
    assert.equal(quiet.status, 'ok')
    assert.equal(quiet.ingested, 0)

    // A new event arrives: the incremental page carries ONLY the delta.
    fake.putEvent({
      id: 'AAMkAGI1-retro',
      subject: 'Sprint retro',
      start: { dateTime: graphIsoDaysAgo(0, 11, 0), timeZone: 'UTC' },
      end: { dateTime: graphIsoDaysAgo(0, 11, 45), timeZone: 'UTC' },
      attendees: [{ emailAddress: { address: 'ana@example.com', name: 'Ana Silva' }, type: 'required' }],
    })
    const delta = await syncConnector(db, OUTLOOK, { adapter, gate: OPEN_GATE })
    assert.equal(delta.status, 'ok')
    assert.equal(delta.ingested, 1, 'only the changed record syncs')
    assert.equal(fake.eventsRequests, fullSyncRequests + 2, 'incremental syncs are single-page reads')
    assert.notEqual(getConnectorConnection(db, OUTLOOK)!.sync_cursor, cursorAfterFirst)

    // A hard deletion arrives as an "@removed" stub and tombstones the local
    // record, retiring the meeting entity it alone supported.
    fake.removeEvent('AAMkAGI1-design-review')
    const removed = await syncConnector(db, OUTLOOK, { adapter, gate: OPEN_GATE })
    assert.equal(removed.status, 'ok')
    assert.equal(removed.tombstoned, 1)
    const tombstone = listConnectorRecords(db, OUTLOOK, { includeTombstoned: true })
      .find((row) => row.source_record_id === 'AAMkAGI1-design-review')
    assert.ok(tombstone?.tombstoned_at != null, 'the deletion is an explicit tombstone')

    // A cancellation tombstones the same way.
    fake.cancelEvent('AAMkAGI1-standup')
    const cancelled = await syncConnector(db, OUTLOOK, { adapter, gate: OPEN_GATE })
    assert.equal(cancelled.status, 'ok')
    assert.equal(cancelled.tombstoned, 1)
    const meetings = listEntities(db, { type: 'meeting' }).map((entity) => entity.name)
    assert.deepEqual(meetings, ['Sprint retro'])

    // The day layer follows: the new slot exists for today.
    const daySignal = getExternalSignal<CalendarSignal>(db, localDateDaysAgo(0), 'calendar')
    assert.ok(daySignal?.payload.events.some((event) => event.title === 'Sprint retro'))
  } finally {
    db.close()
  }
})

test('declining an event removes it from your day on the next incremental sync', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    await connectConnector(db, OUTLOOK, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    // The person declines the standup in Outlook.
    const standup = sourceEvents()[0]
    fake.putEvent({ ...standup, responseStatus: { response: 'declined' } })
    const afterDecline = await syncConnector(db, OUTLOOK, { adapter, gate: OPEN_GATE })
    assert.equal(afterDecline.status, 'ok')
    assert.equal(afterDecline.tombstoned, 1, 'a declined event tombstones like a deletion')
    const meetings = listEntities(db, { type: 'meeting' }).map((entity) => entity.name)
    assert.deepEqual(meetings, ['Design review'])
  } finally {
    db.close()
  }
})

test('a failed page mid-pagination advances nothing; the retry ingests the whole window', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  fake.setPageSize(1)
  try {
    fake.failNextEventsRequest({ status: 500 }, 1) // page 1 succeeds, page 2 explodes
    const failed = await connectConnector(db, OUTLOOK, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    assert.equal(failed.status, 'failed')
    const row = getConnectorConnection(db, OUTLOOK)!
    assert.equal(row.sync_cursor, null, 'a failed page never advances the cursor')
    assert.equal(listConnectorRecords(db, OUTLOOK).length, 0, 'no partial evidence was stored')
    assert.ok(row.next_retry_at != null, 'the failure schedules a bounded retry')

    const recovered = await syncConnector(db, OUTLOOK, { adapter, gate: OPEN_GATE })
    assert.equal(recovered.status, 'ok')
    assert.equal(recovered.ingested, 2, 'the retry reads the complete paginated window')
    assert.ok(getConnectorConnection(db, OUTLOOK)!.sync_cursor)
  } finally {
    db.close()
  }
})

test('a rate-limited sync schedules its retry from the provider Retry-After hint, bounded', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    await connectConnector(db, OUTLOOK, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    fake.failNextEventsRequest({ status: 429, retryAfterSec: 120 })
    const nowMs = Date.now()
    const limited = await syncConnector(db, OUTLOOK, { adapter, gate: OPEN_GATE, nowMs })
    assert.equal(limited.status, 'failed')
    const row = getConnectorConnection(db, OUTLOOK)!
    assert.equal(row.next_retry_at, nowMs + 120_000, 'the retry respects Retry-After over the computed backoff')
    assert.ok(!row.last_sync_error?.includes('eyJfake'), 'the stored error is sanitized')
  } finally {
    db.close()
  }
})

test('an invalidated delta token (HTTP 410) falls back to an attested full window and tombstones stale records', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    await connectConnector(db, OUTLOOK, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    fake.removeEvent('AAMkAGI1-design-review')
    fake.expireDeltaTokens()

    const recovered = await syncConnector(db, OUTLOOK, { adapter, gate: OPEN_GATE })
    assert.equal(recovered.status, 'ok', 'the 410 is handled inside the adapter, not surfaced as a failure')
    assert.equal(recovered.tombstoned, 1, 'the full-window attestation tombstones the record deleted while the token was dead')
    const meetings = listEntities(db, { type: 'meeting' }).map((entity) => entity.name)
    assert.deepEqual(meetings, ['Team standup'])

    // The fresh deltaLink works: the next sync is a quiet incremental one.
    const quiet = await syncConnector(db, OUTLOOK, { adapter, gate: OPEN_GATE })
    assert.equal(quiet.status, 'ok')
    assert.equal(quiet.ingested, 0)
  } finally {
    db.close()
  }
})

test('an aged delta window re-windows with a fresh attested full sync (Graph deltas are windowed)', async () => {
  const db = createProductionTestDatabase()
  const { adapter } = createHarness()
  try {
    await connectConnector(db, OUTLOOK, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    const firstCursor = JSON.parse(getConnectorConnection(db, OUTLOOK)!.sync_cursor!) as { windowEndMs: number }

    // 55 days later "now" is inside the 7-day refresh margin of the +60-day
    // window edge: the adapter must NOT keep walking the old deltaLink.
    const laterMs = Date.now() + 55 * 24 * 60 * 60 * 1000
    const rewindowed = await syncConnector(db, OUTLOOK, { adapter, gate: OPEN_GATE, nowMs: laterMs })
    assert.equal(rewindowed.status, 'ok')
    const nextCursor = JSON.parse(getConnectorConnection(db, OUTLOOK)!.sync_cursor!) as { windowEndMs: number }
    assert.ok(nextCursor.windowEndMs > firstCursor.windowEndMs, 'the window edge advanced with the re-sync')
  } finally {
    db.close()
  }
})

test('an expired access token refreshes transparently and the rotated tokens are re-vaulted', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter, store } = createHarness()
  try {
    await connectConnector(db, OUTLOOK, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    assert.equal(fake.refreshRequests, 0)

    // Time passes: force the stored expiry into the past.
    const account = connectorSecretAccount(OUTLOOK)
    const key = [...store.dump().keys()].find((entry) => entry.endsWith(account))!
    const stored = JSON.parse(store.dump().get(key)!) as { expiresAtMs: number }
    store.dump().set(key, JSON.stringify({ ...stored, expiresAtMs: 1 }))

    fake.putEvent({ id: 'AAMkAGI1-new', subject: 'New sync after refresh', start: { dateTime: graphIsoDaysAgo(0, 16, 0), timeZone: 'UTC' } })
    const synced = await syncConnector(db, OUTLOOK, { adapter, gate: OPEN_GATE })
    assert.equal(synced.status, 'ok')
    assert.equal(fake.refreshRequests, 1, 'the sync refreshed instead of failing')
    const revaulted = JSON.parse(store.dump().get(key)!) as { accessToken: string; expiresAtMs: number }
    assert.ok(revaulted.expiresAtMs > Date.now(), 'the refreshed expiry was persisted')
    assert.equal(revaulted.accessToken, fake.issuedAccessTokens.at(-1))
  } finally {
    db.close()
  }
})

test('credential hygiene: tokens never reach the database, the listing, entities, or error text', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter, store } = createHarness()
  try {
    await connectConnector(db, OUTLOOK, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    fake.failNextEventsRequest({ status: 500 })
    await syncConnector(db, OUTLOOK, { adapter, gate: OPEN_GATE })

    const secrets = [...fake.issuedAccessTokens, FAKE_MS_REFRESH_TOKEN]
    assert.ok(secrets.length >= 1)
    // The vault HAS the secret (that is its job)…
    assert.ok([...store.dump().values()].some((value) => value.includes(FAKE_MS_REFRESH_TOKEN)))

    // …and NOTHING persisted or renderer-visible does.
    const persisted: string[] = []
    for (const table of ['connector_connections', 'connector_records', 'entities', 'entity_aliases', 'external_signals']) {
      for (const row of db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>) {
        persisted.push(JSON.stringify(row))
      }
    }
    persisted.push(JSON.stringify(listConnectorListings(db)))
    for (const surface of persisted) {
      for (const secret of secrets) {
        assert.ok(!surface.includes(secret), `a token leaked into: ${surface.slice(0, 120)}…`)
      }
      assert.ok(!surface.includes(CLIENT_ID), 'the client id stays out of the database (vault-only)')
    }
  } finally {
    db.close()
  }
})

test('disconnect with deletion: clears the vault and removes every derivative', async () => {
  const db = createProductionTestDatabase()
  const { adapter, store } = createHarness()
  try {
    await connectConnector(db, OUTLOOK, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    assert.ok(listEntities(db, { type: 'meeting' }).length >= 2)

    await disconnectConnector(db, OUTLOOK, { deleteData: true, adapter, secretStore: store })

    assert.equal(store.dump().size, 0, 'no credential survives the disconnect')
    assert.equal(listConnectorRecords(db, OUTLOOK, { includeTombstoned: true }).length, 0)
    assert.equal(listEntities(db, { type: 'meeting' }).length, 0)
    assert.equal(listEntities(db, { type: 'person' }).length, 0)
    assert.equal(getConnectorConnection(db, OUTLOOK)?.status, 'disconnected')
  } finally {
    db.close()
  }
})

test('connecting surfaces the device code through the progress notice — the person can always see it', async () => {
  const db = createProductionTestDatabase()
  const { adapter } = createHarness()
  try {
    const phases: string[] = []
    const notices: string[] = []
    const summary = await connectConnector(db, OUTLOOK, { clientId: CLIENT_ID }, {
      adapter,
      gate: OPEN_GATE,
      onProgress: (phase, notice) => {
        phases.push(phase)
        if (notice) notices.push(notice)
      },
    })
    assert.equal(summary.status, 'ok')
    assert.deepEqual([...new Set(phases)], ['authorizing', 'syncing'])
    assert.ok(notices.some((notice) => notice.includes('H7PQ-XR4M')), 'the USER code is shown')
    assert.ok(notices.some((notice) => notice.includes('microsoft.com/devicelogin')), 'and where to enter it')
    assert.ok(!notices.some((notice) => notice.includes('msdevicecode')), 'the DEVICE code never surfaces')
  } finally {
    db.close()
  }
})

test('a revoked authorization flags needs_attention on the FIRST failure; reconnecting recovers', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter, store } = createHarness()
  try {
    await connectConnector(db, OUTLOOK, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })

    // The person revokes the grant (or the vault entry is lost): the stored
    // authorization is gone.
    store.dump().clear()
    fake.putEvent({ id: 'AAMkAGI1-late', subject: 'After revocation', start: { dateTime: graphIsoDaysAgo(0, 17, 0), timeZone: 'UTC' } })
    const failed = await syncConnector(db, OUTLOOK, { adapter, gate: OPEN_GATE })
    assert.equal(failed.status, 'failed')
    const row = getConnectorConnection(db, OUTLOOK)!
    assert.equal(row.consecutive_failures, 1)
    assert.equal(row.status, 'needs_attention', 'auth trouble is flagged immediately, not after a retry loop')
    assert.match(row.last_sync_error ?? '', /Reconnect/)

    // Settings' Reconnect affordance re-runs the same connect flow.
    const reconnected = await connectConnector(db, OUTLOOK, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    assert.equal(reconnected.status, 'ok')
    assert.equal(getConnectorConnection(db, OUTLOOK)!.status, 'connected')
  } finally {
    db.close()
  }
})

test('a continuation link that leaves the Graph origin is refused — the bearer token never follows it', async () => {
  const { fake, adapter } = createHarness()
  const db = createProductionTestDatabase()
  try {
    await connectConnector(db, OUTLOOK, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    // Corrupt the committed cursor to point at a foreign origin.
    db.prepare(`UPDATE connector_connections SET sync_cursor = ? WHERE connector_id = ?`)
      .run(JSON.stringify({ deltaLink: 'https://evil.test/steal', windowEndMs: Date.now() + 30 * 24 * 60 * 60 * 1000 }), OUTLOOK)
    const result = await syncConnector(db, OUTLOOK, { adapter, gate: OPEN_GATE })
    assert.equal(result.status, 'failed')
    assert.match(result.error ?? '', /origin/)
    assert.equal(fake.eventsRequests > 0, true)
  } finally {
    db.close()
  }
})

test('connect without a client id fails with plain-language guidance, before any browser opens', async () => {
  const { adapter } = createHarness()
  await assert.rejects(
    adapter.connect({ config: {} }),
    (error: Error) => error.message.includes('Application ID'),
  )
})

test('health inspection is credential-free and honest about a missing authorization', async () => {
  const { adapter, store } = createHarness()
  const connection = {
    connectorId: OUTLOOK,
    status: 'connected' as const,
    accountLabel: 'owner@example.com',
    config: { calendarId: 'default' },
    cursor: null,
  }
  const missing = await adapter.inspect!(connection)
  assert.equal(missing.state, 'needs_attention')
  assert.match(missing.summary, /Reconnect/)

  await adapter.connect(CONNECT_INPUT)
  const healthy = await adapter.inspect!(connection)
  assert.equal(healthy.state, 'ok')
  assert.ok(!JSON.stringify(healthy).includes('eyJfake'), 'health never carries token material')
  assert.ok(store.dump().size > 0)
})
