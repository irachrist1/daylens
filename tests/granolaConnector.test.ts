// Granola connector (DEV-193): the meetings provider runs the SAME contract
// conformance suite every other adapter proves, against fixture cache files —
// plus the local-connector legs the suite cannot know about: no credential
// anywhere in the flow, quiet syncs on an unchanged cache, in-Granola
// deletion tombstoning with day-layer cleanup, minimized note content,
// personal sensitivity end to end, transcripts NEVER ingested, and registry
// registration.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { assertConnectorContract, OPEN_GATE } from './support/connectorContractSuite.ts'
import {
  createFakeGranolaFilesystem,
  FAKE_GRANOLA_CACHE_PATH,
  type FakeGranolaFilesystem,
  type FakeGranolaState,
} from './support/fakeGranolaCache.ts'
import {
  createGranolaAdapter,
  registerGranolaConnector,
  GRANOLA_MANIFEST,
} from '../src/main/connectors/granola/adapter.ts'
import { extractNoteLines, parseGranolaCache } from '../src/main/connectors/granola/cache.ts'
import {
  connectConnector,
  disconnectConnector,
  listConnectorListings,
  syncConnector,
} from '../src/main/connectors/service.ts'
import { getConnectorConnection, listConnectorRecords } from '../src/main/connectors/store.ts'
import { getConnectorAdapter, getConnectorManifest } from '../src/main/connectors/registry.ts'
import { getExternalSignal } from '../src/main/services/externalSignals.ts'
import { indexMemoryForDay } from '../src/main/services/memoryIndex.ts'
import { searchExact } from '../src/main/services/exactSearch.ts'
import type { ConnectorId, MeetingNotesSignal } from '../src/shared/types.ts'

const GRANOLA: ConnectorId = 'granola'
const CONNECT_CONFIG = { cachePath: FAKE_GRANOLA_CACHE_PATH }

const TRANSCRIPT_SENTINEL = 'verbatim-transcript-sentinel-never-ingested'

function isoDaysAgo(days: number, hour: number, minute = 0): string {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  at.setHours(hour, minute, 0, 0)
  return at.toISOString()
}

function localDateDaysAgo(days: number): string {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

function seedState(): FakeGranolaState {
  return {
    user: { email: 'ada@acme.test' },
    documents: [
      {
        id: 'doc-sprint',
        title: 'Sprint planning',
        created_at: isoDaysAgo(1, 14, 0),
        updated_at: isoDaysAgo(1, 15, 5),
        notes_plain: '- Ship billing v2 on Thursday\n- Dana owns the rollout checklist\n',
        google_calendar_event: {
          id: 'evt-sprint',
          start: { dateTime: isoDaysAgo(1, 14, 0) },
          end: { dateTime: isoDaysAgo(1, 15, 0) },
          attendees: [
            { email: 'ada@acme.test', displayName: 'Ada', self: true },
            { email: 'dana@acme.test', displayName: 'Dana Reyes' },
          ],
        },
        transcript: [{ text: TRANSCRIPT_SENTINEL }],
      },
      {
        id: 'doc-acme',
        title: 'ACME kickoff',
        created_at: isoDaysAgo(2, 10, 0),
        updated_at: isoDaysAgo(2, 11, 0),
        notes: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Decided on the ' }, { type: 'text', text: 'phased rollout' }] },
            {
              type: 'bulletList',
              content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Send the SOW draft' }] }] },
              ],
            },
          ],
        },
        people: { creator: { email: 'ada@acme.test', name: 'Ada' }, attendees: [{ email: 'sam@client.test', name: 'Sam Chen' }] },
      },
    ],
  }
}

interface Harness {
  fs: FakeGranolaFilesystem
  adapter: ReturnType<typeof createGranolaAdapter>
}

function createHarness(state: FakeGranolaState = seedState()): Harness {
  const fs = createFakeGranolaFilesystem()
  fs.writeCache(state)
  const adapter = createGranolaAdapter({ readFileImpl: fs.readFileImpl, homeDir: '/granola-home' })
  return { fs, adapter }
}

test('the Granola adapter passes the full shared contract suite', async () => {
  const harness = createHarness()
  await assertConnectorContract({
    adapter: harness.adapter,
    connectInput: { config: CONNECT_CONFIG },
    minRecords: 2,
    removeOneRecord: () => {
      const state = seedState()
      state.documents = state.documents.filter((doc) => doc.id !== 'doc-acme')
      harness.fs.writeCache(state)
      return 'note:doc-acme'
    },
  })
})

test('the adapter manifest matches the registry entry word for word, with available flipped', () => {
  const upcoming = getConnectorManifest(GRANOLA)!
  assert.equal(upcoming.available, false)
  assert.deepEqual(GRANOLA_MANIFEST, { ...upcoming, available: true })
  assert.equal(GRANOLA_MANIFEST.integration, 'local', 'no network, no account')
  assert.equal(GRANOLA_MANIFEST.authKind, 'local_file')
  assert.equal(GRANOLA_MANIFEST.sensitivity, 'personal')
})

test('registering the adapter flips granola to connectable', () => {
  registerGranolaConnector()
  assert.ok(getConnectorAdapter(GRANOLA))
})

test('connect resolves the standard cache location when no path is given', async () => {
  const { adapter } = createHarness()
  const connected = await adapter.connect({ config: {} })
  assert.equal(connected.accountLabel, 'ada@acme.test')
  assert.equal(connected.config.cachePath, FAKE_GRANOLA_CACHE_PATH)
})

test('a missing Granola install fails the connect with plain copy', async () => {
  const fs = createFakeGranolaFilesystem()
  const adapter = createGranolaAdapter({ readFileImpl: fs.readFileImpl, homeDir: '/granola-home' })
  await assert.rejects(adapter.connect({ config: {} }), /Is Granola installed/i)
})

test('both cache dialects parse: the wrapped {"cache": "<json>"} shape and the direct object', () => {
  const state = seedState()
  const fsWrapped = createFakeGranolaFilesystem()
  fsWrapped.writeCache(state)
  const fsDirect = createFakeGranolaFilesystem()
  fsDirect.writeCache(state, { wrapped: false })
  const parse = async (fs: FakeGranolaFilesystem) =>
    parseGranolaCache(await fs.readFileImpl(FAKE_GRANOLA_CACHE_PATH))
  return Promise.all([parse(fsWrapped), parse(fsDirect)]).then(([wrapped, direct]) => {
    assert.equal(wrapped.docs.length, 2)
    assert.deepEqual(
      wrapped.docs.map((doc) => doc.id).sort(),
      direct.docs.map((doc) => doc.id).sort(),
    )
    const sprint = wrapped.docs.find((doc) => doc.id === 'doc-sprint')!
    assert.equal(sprint.calendarEventId, 'evt-sprint')
    assert.deepEqual(sprint.participants, [{ email: 'dana@acme.test', name: 'Dana Reyes' }])
    assert.deepEqual(sprint.noteLines, ['Ship billing v2 on Thursday', 'Dana owns the rollout checklist'])
    const acme = wrapped.docs.find((doc) => doc.id === 'doc-acme')!
    assert.deepEqual(acme.noteLines, ['Decided on the phased rollout', 'Send the SOW draft'])
  })
})

test('note minimization caps line count and length; the summary is the fallback when nothing was typed', () => {
  const many = extractNoteLines({ notes_plain: Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n') })
  assert.equal(many.length, 12, 'line count is capped')
  const long = extractNoteLines({ notes_plain: 'x'.repeat(500) })
  assert.ok(long[0].length <= 200, 'line length is capped')
  const summary = extractNoteLines({ summary: 'Weekly sync recap: shipped the importer' })
  assert.deepEqual(summary, ['Weekly sync recap: shipped the importer'])
})

test('notes ingest as personal-sensitivity meeting records and land in the notes day layer', async () => {
  const db = createProductionTestDatabase()
  const { adapter } = createHarness()
  try {
    const connected = await connectConnector(db, GRANOLA, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    assert.equal(connected.status, 'ok')
    assert.equal(connected.ingested, 2)

    for (const row of listConnectorRecords(db, GRANOLA)) {
      assert.equal(row.sensitivity, 'personal')
      assert.equal(row.kind, 'meeting_record')
      assert.equal(row.permission_scope, 'file:read')
    }

    const signal = getExternalSignal<MeetingNotesSignal>(db, localDateDaysAgo(1), 'notes')
    assert.ok(signal, 'the notes day row exists')
    assert.equal(signal!.payload.app, 'Granola')
    const note = signal!.payload.notes.find((entry) => entry.title === 'Sprint planning')!
    assert.deepEqual(note.participants, ['Dana'], 'first names only — never emails, never surnames')
    assert.deepEqual(note.actionItems, ['Ship billing v2 on Thursday', 'Dana owns the rollout checklist'])
    assert.equal(JSON.stringify(signal!.payload).includes('dana@acme.test'), false)
  } finally {
    db.close()
  }
})

test('an unchanged cache syncs quiet; a note deleted inside Granola tombstones with its day-layer entry', async () => {
  const db = createProductionTestDatabase()
  const harness = createHarness()
  try {
    await connectConnector(db, GRANOLA, CONNECT_CONFIG, { adapter: harness.adapter, gate: OPEN_GATE })
    const cursorAfterFirst = getConnectorConnection(db, GRANOLA)!.sync_cursor

    const quiet = await syncConnector(db, GRANOLA, { adapter: harness.adapter, gate: OPEN_GATE })
    assert.equal(quiet.status, 'ok')
    assert.equal(quiet.ingested, 0)
    assert.equal(quiet.tombstoned, 0, 'a quiet page never tombstones')
    assert.equal(getConnectorConnection(db, GRANOLA)!.sync_cursor, cursorAfterFirst)

    // The person deletes the sprint note inside Granola (updatedAt of nothing
    // else moves — only the live-id fingerprint catches it).
    const state = seedState()
    state.documents = state.documents.filter((doc) => doc.id !== 'doc-sprint')
    harness.fs.writeCache(state)
    const afterDelete = await syncConnector(db, GRANOLA, { adapter: harness.adapter, gate: OPEN_GATE })
    assert.equal(afterDelete.status, 'ok')
    assert.equal(afterDelete.tombstoned, 1)

    const tombstoned = listConnectorRecords(db, GRANOLA, { includeTombstoned: true })
      .find((row) => row.source_record_id === 'note:doc-sprint')
    assert.ok(tombstoned?.tombstoned_at != null, 'an explicit tombstone, not silent deletion')
    assert.equal(
      getExternalSignal<MeetingNotesSignal>(db, localDateDaysAgo(1), 'notes'),
      null,
      'the emptied notes day row is gone',
    )
  } finally {
    db.close()
  }
})

test('transcripts are NEVER ingested: no persisted surface carries transcript content', async () => {
  const db = createProductionTestDatabase()
  const { adapter } = createHarness()
  try {
    await connectConnector(db, GRANOLA, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    indexMemoryForDay(db, localDateDaysAgo(1))
    indexMemoryForDay(db, localDateDaysAgo(2))
    const tables = ['connector_records', 'external_signals', 'memory_records', 'entities', 'entity_aliases']
    for (const table of tables) {
      const dump = JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all())
      assert.equal(dump.includes(TRANSCRIPT_SENTINEL), false, `${table} must not carry transcript content`)
    }
  } finally {
    db.close()
  }
})

test('notes become searchable personal memory, labeled Granola, and disconnect-with-delete removes the index entries', async () => {
  const db = createProductionTestDatabase()
  const { adapter } = createHarness()
  try {
    await connectConnector(db, GRANOLA, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    const date = localDateDaysAgo(2)
    indexMemoryForDay(db, date)

    const results = searchExact(db, 'phased rollout')
    assert.ok(results.length >= 1, 'note content is findable')
    assert.ok(results.some((result) => result.appName === 'Granola'), 'honestly labeled by its source')
    const memoryRows = db.prepare(
      `SELECT sensitivity, statement FROM memory_records WHERE record_kind = 'connected_activity'`,
    ).all() as Array<{ sensitivity: string; statement: string }>
    assert.ok(memoryRows.length >= 1)
    for (const row of memoryRows) {
      assert.equal(row.sensitivity, 'personal', 'notes memory carries its source sensitivity')
      assert.match(row.statement, /^Granola: notes from /)
    }

    await disconnectConnector(db, GRANOLA, {
      deleteData: true,
      adapter,
      secretStore: { getPassword: async () => null, setPassword: async () => {}, deletePassword: async () => true },
    })
    indexMemoryForDay(db, date)
    assert.equal(searchExact(db, 'phased rollout').length, 0, 'index entries are gone with the source')
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM memory_records WHERE record_kind = 'connected_activity'`).get() as { c: number }).c,
      0,
    )
    assert.equal(getExternalSignal<MeetingNotesSignal>(db, date, 'notes'), null)
  } finally {
    db.close()
  }
})

test('the renderer-visible listing is path-free and honest about the local integration', async () => {
  const db = createProductionTestDatabase()
  const { adapter } = createHarness()
  try {
    await connectConnector(db, GRANOLA, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    const listing = listConnectorListings(db).find((entry) => entry.id === GRANOLA)!
    assert.equal(listing.integration, 'local')
    assert.equal(listing.accountLabel, 'ada@acme.test')
    assert.equal(JSON.stringify(listing).includes(FAKE_GRANOLA_CACHE_PATH), false, 'no path crosses to the renderer')
  } finally {
    db.close()
  }
})
