// Google Calendar connector (DEV-188): the FIRST real provider runs the SAME
// contract conformance suite the fake provider proved (connectors.md
// acceptance: "Direct and brokered adapters pass the same contract suite"),
// against an in-memory Google — plus the provider-specific legs the suite
// cannot know about: syncToken incrementality, cancellations under cursor
// semantics, 410 token invalidation with attested full-window recovery,
// mid-pagination failure atomicity, Retry-After respect, access-token
// refresh, credential hygiene across every persisted surface, and registry
// registration.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { assertConnectorContract, OPEN_GATE } from './support/connectorContractSuite.ts'
import {
  createFakeGoogleCalendarApi,
  createFakeSecretStore,
  FAKE_GOOGLE_ENDPOINTS,
  FAKE_REFRESH_TOKEN,
  type FakeGoogleCalendarApi,
} from './support/fakeGoogleCalendarApi.ts'
import {
  createGoogleCalendarAdapter,
  registerGoogleCalendarConnector,
  GOOGLE_CALENDAR_MANIFEST,
} from '../src/main/connectors/googleCalendar/adapter.ts'
import type { GoogleApiEvent } from '../src/main/connectors/googleCalendar/api.ts'
import { connectConnector, disconnectConnector, listConnectorListings, syncConnector } from '../src/main/connectors/service.ts'
import { getConnectorConnection, listConnectorRecords } from '../src/main/connectors/store.ts'
import { connectorSecretAccount } from '../src/main/connectors/credentials.ts'
import {
  getConnectorAdapter,
  getConnectorManifest,
  listConnectorManifests,
} from '../src/main/connectors/registry.ts'
import { addEntityEvidenceRef, listEntities } from '../src/main/services/entities/entityRepository.ts'
import { getExternalSignal } from '../src/main/services/externalSignals.ts'
import { indexMemoryForDay } from '../src/main/services/memoryIndex.ts'
import { searchExact } from '../src/main/services/exactSearch.ts'
import type { CalendarSignal, ConnectorId } from '../src/shared/types.ts'

const GOOGLE: ConnectorId = 'google_calendar'
const CLIENT_ID = 'testclient.apps.googleusercontent.com'

function isoDaysAgo(days: number, hour: number, minute = 0): string {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  at.setHours(hour, minute, 0, 0)
  return at.toISOString()
}

function localDateDaysAgo(days: number): string {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

function sourceEvents(): GoogleApiEvent[] {
  return [
    {
      id: 'ev-standup',
      status: 'confirmed',
      summary: 'Team standup',
      start: { dateTime: isoDaysAgo(2, 9, 30) },
      end: { dateTime: isoDaysAgo(2, 10, 0) },
      attendees: [
        { email: 'owner@example.com', self: true, responseStatus: 'accepted' },
        { email: 'ana@example.com', displayName: 'Ana Silva', responseStatus: 'accepted' },
        { email: 'ben@example.com', responseStatus: 'needsAction' },
      ],
    },
    {
      id: 'ev-design-review',
      status: 'confirmed',
      summary: 'Design review',
      start: { dateTime: isoDaysAgo(1, 14, 0) },
      end: { dateTime: isoDaysAgo(1, 15, 0) },
    },
  ]
}

interface Harness {
  fake: FakeGoogleCalendarApi
  store: ReturnType<typeof createFakeSecretStore>
  adapter: ReturnType<typeof createGoogleCalendarAdapter>
}

function createHarness(events: GoogleApiEvent[] = sourceEvents()): Harness {
  const fake = createFakeGoogleCalendarApi(events)
  const store = createFakeSecretStore()
  const adapter = createGoogleCalendarAdapter({
    fetchImpl: fake.fetchImpl,
    openExternal: (url) => fake.browse(url),
    secretStore: store,
    endpoints: FAKE_GOOGLE_ENDPOINTS,
    env: {},
    authTimeoutMs: 10_000,
  })
  return { fake, store, adapter }
}

const CONNECT_INPUT = { config: { clientId: CLIENT_ID } }

test('the Google Calendar adapter passes the full shared contract suite', async () => {
  const { fake, adapter } = createHarness()
  await assertConnectorContract({
    adapter,
    connectInput: CONNECT_INPUT,
    minRecords: 2,
    removeOneRecord: () => {
      fake.cancelEvent('ev-design-review')
      return 'ev-design-review'
    },
  })
  // The suite's final leg disconnects: provider-side revocation happened.
  assert.ok(fake.revokedTokens.length >= 1, 'disconnect revokes the grant at Google')
})

test('the adapter manifest matches the registry entry word for word, with available flipped', () => {
  const upcoming = getConnectorManifest(GOOGLE)!
  assert.equal(upcoming.available, false, 'the registry entry stays manifest-only until registration')
  assert.deepEqual(GOOGLE_CALENDAR_MANIFEST, { ...upcoming, available: true })
})

test('registering the adapter flips google_calendar to connectable without hiding the other manifests', () => {
  registerGoogleCalendarConnector()
  assert.ok(getConnectorAdapter(GOOGLE), 'the adapter is registered')
  const manifests = listConnectorManifests()
  assert.equal(manifests.length, 5, 'registration never hides the manifest-only wave')
  assert.equal(manifests.find((manifest) => manifest.id === GOOGLE)?.available, true)
  for (const other of ['outlook_calendar', 'github', 'linear', 'granola'] as const) {
    assert.equal(manifests.find((manifest) => manifest.id === other)?.available, false, `${other} stays manifest-only`)
  }
})

test('syncToken incrementality: adds, edits, and cancellations flow without re-reading the world', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    const connected = await connectConnector(db, GOOGLE, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    assert.equal(connected.status, 'ok')
    assert.equal(connected.ingested, 2)
    const cursorAfterFirst = getConnectorConnection(db, GOOGLE)!.sync_cursor
    assert.ok(cursorAfterFirst, 'the full window commits a syncToken cursor')
    const fullSyncRequests = fake.eventsRequests

    // Unchanged source → quiet incremental sync, cursor semantics intact.
    const quiet = await syncConnector(db, GOOGLE, { adapter, gate: OPEN_GATE })
    assert.equal(quiet.status, 'ok')
    assert.equal(quiet.ingested, 0)

    // A new event arrives: the incremental page carries ONLY the delta.
    fake.putEvent({
      id: 'ev-retro',
      status: 'confirmed',
      summary: 'Sprint retro',
      start: { dateTime: isoDaysAgo(0, 11, 0) },
      end: { dateTime: isoDaysAgo(0, 11, 45) },
      attendees: [{ email: 'ana@example.com', displayName: 'Ana Silva' }],
    })
    const delta = await syncConnector(db, GOOGLE, { adapter, gate: OPEN_GATE })
    assert.equal(delta.status, 'ok')
    assert.equal(delta.ingested, 1, 'only the changed record syncs')
    assert.equal(fake.eventsRequests, fullSyncRequests + 2, 'incremental syncs are single-page reads')
    assert.notEqual(getConnectorConnection(db, GOOGLE)!.sync_cursor, cursorAfterFirst)

    // A cancellation under syncToken semantics tombstones the local record
    // and retires the meeting entity it alone supported.
    fake.cancelEvent('ev-design-review')
    const cancelled = await syncConnector(db, GOOGLE, { adapter, gate: OPEN_GATE })
    assert.equal(cancelled.status, 'ok')
    assert.equal(cancelled.tombstoned, 1)
    const tombstone = listConnectorRecords(db, GOOGLE, { includeTombstoned: true })
      .find((row) => row.source_record_id === 'ev-design-review')
    assert.ok(tombstone?.tombstoned_at != null, 'the cancellation is an explicit tombstone')
    const meetings = listEntities(db, { type: 'meeting' }).map((entity) => entity.name).sort()
    assert.deepEqual(meetings, ['Sprint retro', 'Team standup'])

    // The day layer follows: the cancelled slot is gone, the new one exists.
    const today = new Date()
    const retroDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const daySignal = getExternalSignal<CalendarSignal>(db, retroDate, 'calendar')
    assert.ok(daySignal?.payload.events.some((event) => event.title === 'Sprint retro'))
  } finally {
    db.close()
  }
})

test('declining an event removes it from your day on the next incremental sync', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    await connectConnector(db, GOOGLE, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    // The person declines the standup in Google Calendar.
    const standup = sourceEvents()[0]
    fake.putEvent({
      ...standup,
      attendees: standup.attendees!.map((attendee) =>
        attendee.self ? { ...attendee, responseStatus: 'declined' } : attendee),
    })
    const afterDecline = await syncConnector(db, GOOGLE, { adapter, gate: OPEN_GATE })
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
    const failed = await connectConnector(db, GOOGLE, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    assert.equal(failed.status, 'failed')
    const row = getConnectorConnection(db, GOOGLE)!
    assert.equal(row.sync_cursor, null, 'a failed page never advances the cursor')
    assert.equal(listConnectorRecords(db, GOOGLE).length, 0, 'no partial evidence was stored')
    assert.ok(row.next_retry_at != null, 'the failure schedules a bounded retry')

    const recovered = await syncConnector(db, GOOGLE, { adapter, gate: OPEN_GATE })
    assert.equal(recovered.status, 'ok')
    assert.equal(recovered.ingested, 2, 'the retry reads the complete paginated window')
    assert.ok(getConnectorConnection(db, GOOGLE)!.sync_cursor)
  } finally {
    db.close()
  }
})

test('a rate-limited sync schedules its retry from the provider Retry-After hint, bounded', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    await connectConnector(db, GOOGLE, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    fake.failNextEventsRequest({ status: 429, retryAfterSec: 120 })
    const nowMs = Date.now()
    const limited = await syncConnector(db, GOOGLE, { adapter, gate: OPEN_GATE, nowMs })
    assert.equal(limited.status, 'failed')
    const row = getConnectorConnection(db, GOOGLE)!
    assert.equal(row.next_retry_at, nowMs + 120_000, 'the retry respects Retry-After over the computed backoff')
    assert.ok(!row.last_sync_error?.includes('ya29'), 'the stored error is sanitized')
  } finally {
    db.close()
  }
})

test('an invalidated syncToken (HTTP 410) falls back to an attested full window and tombstones stale records', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    await connectConnector(db, GOOGLE, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    fake.cancelEvent('ev-design-review')
    fake.expireSyncTokens()

    const recovered = await syncConnector(db, GOOGLE, { adapter, gate: OPEN_GATE })
    assert.equal(recovered.status, 'ok', 'the 410 is handled inside the adapter, not surfaced as a failure')
    assert.equal(recovered.tombstoned, 1, 'the full-window attestation tombstones the record deleted while the token was dead')
    const meetings = listEntities(db, { type: 'meeting' }).map((entity) => entity.name)
    assert.deepEqual(meetings, ['Team standup'])

    // The fresh syncToken works: the next sync is a quiet incremental one.
    const quiet = await syncConnector(db, GOOGLE, { adapter, gate: OPEN_GATE })
    assert.equal(quiet.status, 'ok')
    assert.equal(quiet.ingested, 0)
  } finally {
    db.close()
  }
})

test('an expired access token refreshes transparently and the refreshed token is re-vaulted', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter, store } = createHarness()
  try {
    await connectConnector(db, GOOGLE, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    assert.equal(fake.refreshRequests, 0)

    // Time passes: force the stored expiry into the past.
    const account = connectorSecretAccount(GOOGLE)
    const key = [...store.dump().keys()].find((entry) => entry.endsWith(account))!
    const stored = JSON.parse(store.dump().get(key)!) as { expiresAtMs: number }
    store.dump().set(key, JSON.stringify({ ...stored, expiresAtMs: 1 }))

    fake.putEvent({ id: 'ev-new', summary: 'New sync after refresh', start: { dateTime: isoDaysAgo(0, 16, 0) } })
    const synced = await syncConnector(db, GOOGLE, { adapter, gate: OPEN_GATE })
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
    await connectConnector(db, GOOGLE, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    fake.failNextEventsRequest({ status: 500 })
    await syncConnector(db, GOOGLE, { adapter, gate: OPEN_GATE })

    const secrets = [...fake.issuedAccessTokens, FAKE_REFRESH_TOKEN]
    assert.ok(secrets.length >= 1)
    // The vault HAS the secret (that is its job)…
    assert.ok([...store.dump().values()].some((value) => value.includes(FAKE_REFRESH_TOKEN)))

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
      assert.ok(!surface.includes(CLIENT_ID), 'the OAuth client id stays out of the database (vault-only)')
    }
  } finally {
    db.close()
  }
})

test('disconnect with deletion: revokes at Google, clears the vault, and removes every derivative', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter, store } = createHarness()
  try {
    await connectConnector(db, GOOGLE, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    assert.ok(listEntities(db, { type: 'meeting' }).length >= 2)

    await disconnectConnector(db, GOOGLE, { deleteData: true, adapter, secretStore: store })

    assert.ok(fake.revokedTokens.includes(FAKE_REFRESH_TOKEN), 'the refresh grant was revoked provider-side')
    assert.equal(store.dump().size, 0, 'no credential survives the disconnect')
    assert.equal(listConnectorRecords(db, GOOGLE, { includeTombstoned: true }).length, 0)
    assert.equal(listEntities(db, { type: 'meeting' }).length, 0)
    assert.equal(listEntities(db, { type: 'person' }).length, 0)
    assert.equal(getConnectorConnection(db, GOOGLE)?.status, 'disconnected')
  } finally {
    db.close()
  }
})

test('connecting reports honest progress phases: authorizing, then the bounded initial import', async () => {
  const db = createProductionTestDatabase()
  const { adapter } = createHarness()
  try {
    const phases: string[] = []
    const summary = await connectConnector(db, GOOGLE, { clientId: CLIENT_ID }, {
      adapter,
      gate: OPEN_GATE,
      onProgress: (phase) => phases.push(phase),
    })
    assert.equal(summary.status, 'ok')
    assert.deepEqual(phases, ['authorizing', 'syncing'])
  } finally {
    db.close()
  }
})

test('a revoked authorization flags needs_attention on the FIRST failure; reconnecting recovers', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter, store } = createHarness()
  try {
    await connectConnector(db, GOOGLE, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })

    // The person revokes the grant (or the vault entry is lost): the stored
    // authorization is gone.
    store.dump().clear()
    fake.putEvent({ id: 'ev-late', summary: 'After revocation', start: { dateTime: isoDaysAgo(0, 17, 0) } })
    const failed = await syncConnector(db, GOOGLE, { adapter, gate: OPEN_GATE })
    assert.equal(failed.status, 'failed')
    const row = getConnectorConnection(db, GOOGLE)!
    assert.equal(row.consecutive_failures, 1)
    assert.equal(row.status, 'needs_attention', 'auth trouble is flagged immediately, not after a retry loop')
    assert.match(row.last_sync_error ?? '', /Reconnect/)

    // Settings' Reconnect affordance re-runs the same connect flow.
    const reconnected = await connectConnector(db, GOOGLE, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    assert.equal(reconnected.status, 'ok')
    assert.equal(getConnectorConnection(db, GOOGLE)!.status, 'connected')
  } finally {
    db.close()
  }
})

test('a synced event is scheduled context in memory and search — never automatically an attended meeting', async () => {
  const db = createProductionTestDatabase()
  const { adapter } = createHarness()
  const standupDate = localDateDaysAgo(2)
  try {
    await connectConnector(db, GOOGLE, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    indexMemoryForDay(db, standupDate)

    // The memory record SAYS it is scheduled context (connectors.md: a
    // calendar event becomes "you met" only with supporting evidence). This
    // statement is what search results, packets, and agent answers show.
    const statements = (db.prepare(
      `SELECT statement, memory_type FROM memory_records WHERE record_kind = 'meeting'`,
    ).all() as Array<{ statement: string; memory_type: string }>)
    const standup = statements.find((record) => record.statement.includes('Team standup'))
    assert.ok(standup, 'the synced event is findable memory')
    assert.match(standup!.statement, /^Scheduled: /)
    assert.match(standup!.statement, /not confirmed attended/)
    assert.equal(standup!.memory_type, 'connected', 'connected origin — distinct from captured activity')

    // Exact search returns it: the entity (typed, connected) and a moment
    // whose visible label says SCHEDULED — clearly distinct from captured
    // activity (which reads as an app session with sourceType 'observed').
    const results = searchExact(db, 'Team standup')
    const entityHit = results.find((result) => result.type === 'entity' && result.name === 'Team standup')
    assert.ok(entityHit, 'the meeting entity is searchable')
    assert.equal((entityHit as { sourceType: string }).sourceType, 'connected')
    const momentHit = results.find((result) =>
      result.type === 'session' && 'appName' in result && result.appName === 'Scheduled meeting')
    assert.ok(momentHit, 'the scheduled moment surfaces in exact search, labeled as scheduled')
    assert.equal((momentHit as { sourceType?: string }).sourceType, 'connected')

    // Non-calendar evidence lands (device activity, notes, confirmation…):
    // NOW the record may say the meeting happened.
    const meeting = listEntities(db, { type: 'meeting' }).find((entity) => entity.name === 'Team standup')!
    addEntityEvidenceRef(db, meeting.id, {
      sourceType: 'meeting_presence',
      sourceId: 'call-window-overlap-1',
      spanStartMs: Date.now() - 2 * 24 * 60 * 60 * 1000,
    })
    indexMemoryForDay(db, standupDate)
    const after = (db.prepare(
      `SELECT statement FROM memory_records WHERE record_kind = 'meeting'`,
    ).all() as Array<{ statement: string }>).find((record) => record.statement.includes('Team standup'))
    assert.match(after!.statement, /^Meeting: /, 'occurrence support upgrades scheduled context to a meeting')
  } finally {
    db.close()
  }
})

test('disconnect-with-delete removes synced events from memory and search, not just the ledger', async () => {
  const db = createProductionTestDatabase()
  const { adapter, store } = createHarness()
  const standupDate = localDateDaysAgo(2)
  try {
    await connectConnector(db, GOOGLE, { clientId: CLIENT_ID }, { adapter, gate: OPEN_GATE })
    indexMemoryForDay(db, standupDate)
    assert.ok(searchExact(db, 'Team standup').length > 0)

    await disconnectConnector(db, GOOGLE, { deleteData: true, adapter, secretStore: store })
    indexMemoryForDay(db, standupDate)

    assert.equal(db.prepare(
      `SELECT COUNT(*) AS c FROM memory_records WHERE record_kind = 'meeting'`,
    ).get()!.c, 0, 'no meeting memory survives the deletion')
    const results = searchExact(db, 'Team standup')
    assert.equal(results.length, 0, 'search cannot resurrect deleted connector evidence')
  } finally {
    db.close()
  }
})

test('connect without an OAuth client id fails with plain-language guidance, before any browser opens', async () => {
  const { adapter } = createHarness()
  await assert.rejects(
    adapter.connect({ config: {} }),
    (error: Error) => error.message.includes('Desktop app'),
  )
})

test('health inspection is credential-free and honest about a missing authorization', async () => {
  const { adapter, store } = createHarness()
  const connection = {
    connectorId: GOOGLE,
    status: 'connected' as const,
    accountLabel: 'owner@example.com',
    config: { calendarId: 'primary' },
    cursor: null,
  }
  const missing = await adapter.inspect!(connection)
  assert.equal(missing.state, 'needs_attention')
  assert.match(missing.summary, /Reconnect/)

  await adapter.connect(CONNECT_INPUT)
  const healthy = await adapter.inspect!(connection)
  assert.equal(healthy.state, 'ok')
  assert.ok(!JSON.stringify(healthy).includes('ya29'), 'health never carries token material')
  assert.ok(store.dump().size > 0)
})
