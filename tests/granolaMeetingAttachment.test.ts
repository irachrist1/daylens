// DEV-193 acceptance: Granola notes ATTACH to the meeting they document
// (source identity first, then corroborated title/timing/address — never
// title similarity alone), a note is occurrence evidence in the day-level
// meeting resolution, the agent cites notes when answering about a meeting,
// and transcript excerpts exist ONLY behind the explicit-question gate with
// the disclosure recorded — then vanish entirely on disconnect-with-delete.
import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import type Database from 'better-sqlite3'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { OPEN_GATE } from './support/connectorContractSuite.ts'
import {
  buildGranolaCacheRaw,
  createFakeGranolaFilesystem,
  FAKE_GRANOLA_CACHE_PATH,
  type FakeGranolaState,
} from './support/fakeGranolaCache.ts'
import { createGranolaAdapter } from '../src/main/connectors/granola/adapter.ts'
import { connectConnector, disconnectConnector, syncConnector } from '../src/main/connectors/service.ts'
import { putExternalSignal } from '../src/main/services/externalSignals.ts'
import { resolveMeetingEntity, listEntities, type EntityRow } from '../src/main/services/entities/entityRepository.ts'
import { resolveDayMeetingReport } from '../src/main/services/meetingResolution.ts'
import { indexMemoryForDay } from '../src/main/services/memoryIndex.ts'
import { runChatAgentTurn } from '../src/main/agent/chatAgent.ts'
import { getContextPacketById } from '../src/main/services/contextPacket.ts'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

function answerModel(text: string, onCall?: (options: { prompt: unknown }) => void): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async (options) => {
      onCall?.(options as { prompt: unknown })
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 'answer-1' },
            { type: 'text-delta', id: 'answer-1', delta: text },
            { type: 'text-end', id: 'answer-1' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
          ] as never[],
        }),
      }
    },
  })
}

function agentDeps(db: Database.Database, model: MockLanguageModelV3) {
  return {
    db,
    config: { provider: 'anthropic' as const, apiKey: null, model: 'test' },
    model,
    askUser: async () => '',
    artifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-agent-granola-')),
    now: new Date(),
  }
}

function isoDaysAgo(days: number, hour: number, minute = 0): string {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  at.setHours(hour, minute, 0, 0)
  return at.toISOString()
}

function msDaysAgo(days: number, hour: number, minute = 0): number {
  return Date.parse(isoDaysAgo(days, hour, minute))
}

function localDateDaysAgo(days: number): string {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

function activeMeetings(db: Database.Database): EntityRow[] {
  return db.prepare(`SELECT * FROM entities WHERE entity_type = 'meeting' AND status = 'active'`)
    .all() as EntityRow[]
}

function connectAndSync(db: Database.Database, state: FakeGranolaState) {
  const granolaFs = createFakeGranolaFilesystem()
  granolaFs.writeCache(state)
  const adapter = createGranolaAdapter({ readFileImpl: granolaFs.readFileImpl, homeDir: '/granola-home' })
  return {
    adapter,
    granolaFs,
    connect: () => connectConnector(db, 'granola', { cachePath: FAKE_GRANOLA_CACHE_PATH }, { adapter, gate: OPEN_GATE }),
  }
}

test('source identity attaches directly: the note merges into the calendar meeting sharing its event id, even with a different title', async () => {
  const db = createProductionTestDatabase()
  try {
    const calendarEntity = resolveMeetingEntity(db, {
      sourceEventId: 'gcal:evt-88',
      title: 'Q3 planning with the platform group',
      startMs: msDaysAgo(1, 14, 0),
      endMs: msDaysAgo(1, 15, 0),
      origin: 'connected',
      sourceType: 'connected_envelope',
      sourceId: 'calendar_event:gcal:evt-88',
    })

    const { connect } = connectAndSync(db, {
      user: { email: 'ada@acme.test' },
      documents: [{
        id: 'doc-q3',
        title: 'Q3 planning (my notes)',
        created_at: isoDaysAgo(1, 14, 2),
        updated_at: isoDaysAgo(1, 15, 10),
        notes_plain: 'Platform group owns the migration',
        google_calendar_event: {
          id: 'evt-88',
          start: { dateTime: isoDaysAgo(1, 14, 0) },
          end: { dateTime: isoDaysAgo(1, 15, 0) },
        },
      }],
    })
    const connected = await connect()
    assert.equal(connected.status, 'ok')

    const meetings = activeMeetings(db)
    assert.equal(meetings.length, 1, 'one meeting — the note attached by source identity')
    assert.equal(meetings[0].id, calendarEntity.id, 'the calendar identity survives')
    const merged = db.prepare(`SELECT merged_into_id FROM entities WHERE identity_key = 'event:granola:doc-q3'`)
      .get() as { merged_into_id: string | null }
    assert.equal(merged.merged_into_id, calendarEntity.id)
  } finally {
    db.close()
  }
})

test('title + timing corroboration attaches to the locally-probed calendar meeting; title alone never merges', async () => {
  const db = createProductionTestDatabase()
  try {
    const date = localDateDaysAgo(1)
    putExternalSignal(db, date, 'calendar', {
      events: [
        { title: 'ACME kickoff', startClock: '10:00', durationMinutes: 60, attendeeCount: 3 },
        { title: 'Design review', startClock: '16:00', durationMinutes: 45, attendeeCount: 2 },
      ],
    })
    assert.equal(activeMeetings(db).length, 2)

    const { connect } = connectAndSync(db, {
      user: { email: 'ada@acme.test' },
      documents: [
        {
          // Same title, start within tolerance → attaches.
          id: 'doc-acme',
          title: 'ACME kickoff',
          created_at: isoDaysAgo(1, 10, 5),
          updated_at: isoDaysAgo(1, 11, 0),
          notes_plain: 'Decided on the phased rollout',
          google_calendar_event: { start: { dateTime: isoDaysAgo(1, 10, 5) }, end: { dateTime: isoDaysAgo(1, 11, 0) } },
        },
        {
          // Same title as the 16:00 review but five hours off, no shared
          // address, no linked event: display-name similarity alone — stays
          // its OWN meeting.
          id: 'doc-review',
          title: 'Design review',
          created_at: isoDaysAgo(1, 21, 0),
          updated_at: isoDaysAgo(1, 21, 30),
          notes_plain: 'Late-night solo review of the mocks',
          google_calendar_event: { start: { dateTime: isoDaysAgo(1, 21, 0) }, end: { dateTime: isoDaysAgo(1, 21, 30) } },
        },
      ],
    })
    const connected = await connect()
    assert.equal(connected.status, 'ok')

    const meetings = activeMeetings(db)
    assert.equal(meetings.length, 3, 'kickoff (attached) + scheduled review + the unmatched note meeting')
    const kickoff = db.prepare(
      `SELECT merged_into_id FROM entities WHERE identity_key = 'event:granola:doc-acme'`,
    ).get() as { merged_into_id: string | null }
    assert.ok(kickoff.merged_into_id != null, 'the corroborated note merged')
    const review = db.prepare(
      `SELECT merged_into_id, status FROM entities WHERE identity_key = 'event:granola:doc-review'`,
    ).get() as { merged_into_id: string | null; status: string }
    assert.equal(review.merged_into_id, null, 'title-only similarity never merges')
    assert.equal(review.status, 'active')
  } finally {
    db.close()
  }
})

test('a user rename on the note\'s meeting blocks the automatic merge — corrections outrank inference', async () => {
  const db = createProductionTestDatabase()
  try {
    const date = localDateDaysAgo(1)
    const harness = connectAndSync(db, {
      user: { email: 'ada@acme.test' },
      documents: [{
        id: 'doc-solo',
        title: 'Roadmap sync',
        created_at: isoDaysAgo(1, 9, 0),
        updated_at: isoDaysAgo(1, 9, 30),
        notes_plain: 'Personal planning notes',
        google_calendar_event: { start: { dateTime: isoDaysAgo(1, 9, 0) }, end: { dateTime: isoDaysAgo(1, 9, 30) } },
      }],
    })
    await harness.connect()
    assert.equal(activeMeetings(db).length, 1, 'the note stands alone — nothing to attach to yet')

    // The person renames the note's meeting; then a matching calendar event
    // appears and the note re-syncs.
    db.prepare(`UPDATE entities SET canonical_name = 'My private planning', name_source = 'user' WHERE identity_key = 'event:granola:doc-solo'`).run()
    putExternalSignal(db, date, 'calendar', {
      events: [{ title: 'Roadmap sync', startClock: '09:00', durationMinutes: 30, attendeeCount: 2 }],
    })
    harness.granolaFs.writeCache({
      user: { email: 'ada@acme.test' },
      documents: [{
        id: 'doc-solo',
        title: 'Roadmap sync',
        created_at: isoDaysAgo(1, 9, 0),
        updated_at: new Date().toISOString(),
        notes_plain: 'Personal planning notes, updated',
        google_calendar_event: { start: { dateTime: isoDaysAgo(1, 9, 0) }, end: { dateTime: isoDaysAgo(1, 9, 30) } },
      }],
    })
    await syncConnector(db, 'granola', { adapter: harness.adapter, gate: OPEN_GATE })

    const noteRow = db.prepare(
      `SELECT status, canonical_name FROM entities WHERE identity_key = 'event:granola:doc-solo'`,
    ).get() as { status: string; canonical_name: string }
    assert.equal(noteRow.status, 'active', 'the renamed entity never auto-merges')
    assert.equal(noteRow.canonical_name, 'My private planning', 'the rename survives re-sync')
  } finally {
    db.close()
  }
})

test('a Granola note is occurrence evidence: the scheduled meeting lands in the matched bucket with no captured time and no invented minutes', async () => {
  const db = createProductionTestDatabase()
  try {
    const date = localDateDaysAgo(1)
    putExternalSignal(db, date, 'calendar', {
      events: [
        { title: 'ACME kickoff', startClock: '10:00', durationMinutes: 60, attendeeCount: 3 },
        { title: 'Skipped sync', startClock: '15:00', durationMinutes: 30, attendeeCount: 2 },
      ],
    })
    const { connect } = connectAndSync(db, {
      user: { email: 'ada@acme.test' },
      documents: [{
        id: 'doc-acme',
        title: 'ACME kickoff',
        created_at: isoDaysAgo(1, 10, 0),
        updated_at: isoDaysAgo(1, 11, 0),
        notes_plain: 'Decided on the phased rollout',
        google_calendar_event: { start: { dateTime: isoDaysAgo(1, 10, 0) }, end: { dateTime: isoDaysAgo(1, 11, 0) } },
      }],
    })
    await connect()

    const report = resolveDayMeetingReport(db, date)
    assert.ok(report)
    const kickoff = report!.meetings.find((meeting) => meeting.title === 'ACME kickoff')!
    assert.equal(kickoff.attendance, 'matched', 'the note corroborates occurrence')
    assert.equal(kickoff.noteSupported, true)
    assert.equal(kickoff.observedSeconds, null, 'no observed minutes are invented')
    const skipped = report!.meetings.find((meeting) => meeting.title === 'Skipped sync')!
    assert.equal(skipped.attendance, 'calendar_only', 'an un-noted event stays scheduled context')
    assert.equal(skipped.noteSupported, false)

    // Search follows: the attached meeting reads as a meeting, not a schedule claim.
    indexMemoryForDay(db, date)
    const statements = (db.prepare(
      `SELECT statement FROM memory_records WHERE record_kind = 'meeting'`,
    ).all() as Array<{ statement: string }>).map((row) => row.statement)
    assert.ok(statements.some((statement) => statement === 'Meeting: ACME kickoff'), `got: ${statements.join(' | ')}`)
    assert.ok(statements.some((statement) => statement.startsWith('Scheduled: Skipped sync')))
  } finally {
    db.close()
  }
})

test('the agent cites the notes when answering about the meeting; disconnect-with-delete removes them from answers', async () => {
  const db = createProductionTestDatabase()
  const date = localDateDaysAgo(1)
  putExternalSignal(db, date, 'calendar', {
    events: [{ title: 'ACME kickoff', startClock: '10:00', durationMinutes: 60, attendeeCount: 3 }],
  })
  const harness = connectAndSync(db, {
    user: { email: 'ada@acme.test' },
    documents: [{
      id: 'doc-acme',
      title: 'ACME kickoff',
      created_at: isoDaysAgo(1, 10, 0),
      updated_at: isoDaysAgo(1, 11, 0),
      notes_plain: 'Decided on the phased rollout\nSam sends the SOW draft',
      google_calendar_event: { start: { dateTime: isoDaysAgo(1, 10, 0) }, end: { dateTime: isoDaysAgo(1, 11, 0) } },
    }],
  })
  const question = `What did we decide in the ACME kickoff on ${date}?`
  try {
    await harness.connect()

    const prompts: string[] = []
    const model = answerModel(
      'You decided on the phased rollout; Sam sends the SOW draft [C1].',
      (options) => prompts.push(JSON.stringify(options.prompt)),
    )
    const result = await runChatAgentTurn(question, [], agentDeps(db, model))

    assert.match(prompts[0], /Granola: notes from/)
    assert.match(prompts[0], /phased rollout/)

    assert.ok(result.contextPacketId)
    const bound = getContextPacketById(db, result.contextPacketId!)
    const noteItems = bound!.packet.items.filter((item) => item.statement.startsWith('Granola: notes from'))
    assert.ok(noteItems.length >= 1, 'the notes are a disclosed packet item')
    for (const item of noteItems) {
      assert.equal(item.sourceType, 'connected')
      assert.equal(item.sensitivity, 'personal', 'notes ride their personal sensitivity into the disclosure')
    }
    assert.ok(result.citations.length >= 1, 'the answer resolves a citation')
    assert.ok(result.citations.some((citation) => citation.statement.startsWith('Granola: notes from')))

    await disconnectConnector(db, 'granola', {
      deleteData: true,
      adapter: harness.adapter,
      secretStore: { getPassword: async () => null, setPassword: async () => {}, deletePassword: async () => true },
    })
    const after = await runChatAgentTurn(question, [], agentDeps(db, answerModel('Nothing from Granola remains [C1].')))
    const afterBound = getContextPacketById(db, after.contextPacketId!)
    assert.equal(
      afterBound!.packet.items.filter((item) => item.statement.includes('Granola')).length,
      0,
      'deleted notes never re-enter a packet',
    )
  } finally {
    db.close()
  }
})

test('transcript excerpts: only an explicit question retrieves one, the disclosure is recorded, and disconnect deletes the trace', async () => {
  const db = createProductionTestDatabase()
  const date = localDateDaysAgo(1)
  const transcriptPhrase = 'we agreed the rollout slips one sprint if the audit lands late'
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-granola-cache-'))
  const cachePath = path.join(cacheDir, 'cache-v3.json')
  fs.writeFileSync(cachePath, buildGranolaCacheRaw({
    user: { email: 'ada@acme.test' },
    documents: [{
      id: 'doc-sprint',
      title: 'Sprint planning',
      created_at: isoDaysAgo(1, 14, 0),
      updated_at: isoDaysAgo(1, 15, 0),
      notes_plain: 'Ship billing v2 on Thursday',
      google_calendar_event: { start: { dateTime: isoDaysAgo(1, 14, 0) }, end: { dateTime: isoDaysAgo(1, 15, 0) } },
    }],
    transcripts: { 'doc-sprint': [{ text: transcriptPhrase }] },
  }))
  const adapter = createGranolaAdapter()
  try {
    const connected = await connectConnector(db, 'granola', { cachePath }, { adapter, gate: OPEN_GATE })
    assert.equal(connected.status, 'ok')

    // A non-transcript question about the same meeting: NO transcript item.
    const plain = await runChatAgentTurn(
      `What happened in sprint planning on ${date}?`,
      [],
      agentDeps(db, answerModel('You planned the billing ship [C1].')),
    )
    const plainPacket = getContextPacketById(db, plain.contextPacketId!)
    assert.equal(
      plainPacket!.packet.items.some((item) => item.identity.startsWith('transcript:')),
      false,
      'no transcript is retrieved without an explicit ask',
    )
    assert.equal(JSON.stringify(plainPacket!.packet).includes(transcriptPhrase), false)

    // The explicit ask: the excerpt is disclosed as a recorded high-sensitivity item.
    const explicit = await runChatAgentTurn(
      `Show me the transcript of sprint planning on ${date} — what was said about the rollout?`,
      [],
      agentDeps(db, answerModel('The rollout slips one sprint if the audit lands late [C1].')),
    )
    const explicitPacket = getContextPacketById(db, explicit.contextPacketId!)
    const transcriptItems = explicitPacket!.packet.items.filter((item) => item.identity === 'transcript:granola:doc-sprint')
    assert.equal(transcriptItems.length, 1, 'the excerpt is disclosed exactly once')
    assert.equal(transcriptItems[0].sensitivity, 'high')
    assert.equal(transcriptItems[0].sourceType, 'connected')
    assert.match(transcriptItems[0].statement, /Granola transcript of "Sprint planning"/)
    assert.ok(transcriptItems[0].statement.includes(transcriptPhrase))
    assert.match(transcriptItems[0].reason, /explicitly asked/i)

    // The transcript still never entered any index or store.
    indexMemoryForDay(db, date)
    for (const table of ['memory_records', 'connector_records', 'external_signals']) {
      const dump = JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all())
      assert.equal(dump.includes(transcriptPhrase), false, `${table} stays transcript-free`)
    }

    // Disconnect-with-delete removes the recorded disclosure trace too.
    await disconnectConnector(db, 'granola', {
      deleteData: true,
      adapter,
      secretStore: { getPassword: async () => null, setPassword: async () => {}, deletePassword: async () => true },
    })
    assert.equal(getContextPacketById(db, explicit.contextPacketId!), null, 'the transcript-bearing packet is gone')
    assert.ok(getContextPacketById(db, plain.contextPacketId!) != null, 'packets without transcript content remain')
    const afterAsk = await runChatAgentTurn(
      `Show me the transcript of sprint planning on ${date}`,
      [],
      agentDeps(db, answerModel('There is no transcript to show.')),
    )
    const afterPacket = getContextPacketById(db, afterAsk.contextPacketId!)
    assert.equal(afterPacket!.packet.items.some((item) => item.identity.startsWith('transcript:')), false)
  } finally {
    db.close()
    fs.rmSync(cacheDir, { recursive: true, force: true })
  }
})
