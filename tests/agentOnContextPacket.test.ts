// DEV-182: the chat agent runs ON the context packet. Every chat answer
// starts from the DEV-181 packet — assembled deterministically and recorded
// BEFORE any request leaves the device, rendered into the model prompt with
// citation markers, and bound to the persisted exchange. Proves:
//   1. ordering + binding — the disclosure record exists before the first
//      model call, and after the turn the packet is bound to the assistant
//      message ("what did the model see for THIS answer" is one lookup);
//   2. determinism — the same question against the same day state produces
//      the same packet content fingerprint and, through the fixture model
//      seam, the same grounded answer;
//   3. citation integrity — every persisted citation resolves to an item in
//      the bound packet; a marker the packet cannot back is dropped;
//   4. conflict naming — a correction-vs-automated-label disagreement reaches
//      the model as an explicit "name this" instruction, never silence;
//   5. honest failure — an empty day yields a packet that says what is
//      missing and instructs the agent not to invent activity;
//   6. degradation — a database without the packet ledger still answers
//      (tools-only turn), with no packet id claimed.
import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import type Database from 'better-sqlite3'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { setTestDb, clearTestDb } from './support/database-stub.mjs'
import { __resetSettings, __setSettings, setApiKey } from './support/settings-stub.mjs'
import { sendMessage } from '../src/main/jobs/aiService.ts'
import { runChatAgentTurn } from '../src/main/agent/chatAgent.ts'
import { resolvePacketCitations } from '../src/main/agent/contextCitations.ts'
import {
  getContextPacketById,
  getContextPacketForMessage,
} from '../src/main/services/contextPacket.ts'
import { indexMemoryForDay } from '../src/main/services/memoryIndex.ts'
import { materializeTimelineDayProjection } from '../src/main/core/query/projections.ts'
import { writeTimelineBlockReview } from '../src/main/services/workBlocks.ts'
import { writeAIBlockLabel } from '../src/main/db/queries.ts'

const DATE = '2026-04-22'
const NOW = new Date(2026, 3, 23, 12, 0, 0, 0)

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

function response(chunks: unknown[]) {
  return { stream: simulateReadableStream({ chunks }) }
}

function answerModel(
  text: string,
  onCall?: (options: { prompt: unknown }) => void,
): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async (options) => {
      onCall?.(options as { prompt: unknown })
      return response([
        { type: 'text-start', id: 'answer-1' },
        { type: 'text-delta', id: 'answer-1', delta: text },
        { type: 'text-end', id: 'answer-1' },
        { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
      ] as never[])
    },
  })
}

function localMs(hour: number, minute = 0): number {
  return new Date(2026, 3, 22, hour, minute, 0, 0).getTime()
}

function insertSession(db: Database.Database, title: string, startHour: number, durationMinutes: number): void {
  const startTime = localMs(startHour)
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, capture_source, capture_version
    ) VALUES ('com.mitchellh.ghostty', 'Ghostty', ?, ?, ?, 'development', 1, ?, 'Ghostty', 'test', 1)
  `).run(startTime, startTime + durationMinutes * 60_000, durationMinutes * 60, title)
}

function agentDeps(db: Database.Database, model: MockLanguageModelV3) {
  return {
    db,
    config: { provider: 'anthropic' as const, apiKey: null, model: 'test' },
    model,
    askUser: async () => '',
    artifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-agent-packet-')),
    now: NOW,
  }
}

test('the packet is recorded before the model call, binds to the exchange, and the same question + state yields the same packet and answer', async () => {
  const db = createProductionTestDatabase()
  insertSession(db, 'Refactoring the retrieval planner', 9, 45)
  indexMemoryForDay(db, DATE)

  const packetRowsSeenAtModelCall: number[] = []
  const unboundRowsSeenAtModelCall: number[] = []
  const capturedPrompts: string[] = []
  const model = answerModel(
    'The retrieval planner refactor led that day [C1].',
    (options) => {
      capturedPrompts.push(JSON.stringify(options.prompt))
      packetRowsSeenAtModelCall.push(
        (db.prepare('SELECT COUNT(*) AS c FROM context_packets').get() as { c: number }).c,
      )
      unboundRowsSeenAtModelCall.push(
        (db.prepare('SELECT COUNT(*) AS c FROM context_packets WHERE message_id IS NULL').get() as { c: number }).c,
      )
    },
  )

  setTestDb(db)
  __setSettings({ aiProvider: 'anthropic', aiChatProvider: 'anthropic' })
  await setApiKey('anthropic', 'test-key')
  try {
    const question = `What retrieval planner work happened on ${DATE}?`
    const first = await sendMessage(
      { message: question, threadId: null, clientRequestId: 'packet-turn-1' },
      { model },
    )

    // The disclosure record existed before the request "left": the model call
    // observed a persisted, not-yet-bound packet row.
    assert.equal(packetRowsSeenAtModelCall[0], 1, 'the packet row exists before the first model call')
    assert.equal(unboundRowsSeenAtModelCall[0], 1, 'the packet is not yet bound while the model runs')

    // The prompt the model actually received carries the packet and the
    // citation contract.
    assert.match(capturedPrompts[0], /Context packet ctx_/)
    assert.match(capturedPrompts[0], /\[C1\]/)
    assert.match(capturedPrompts[0], /recorded in the local disclosure ledger/)
    assert.match(capturedPrompts[0], /Refactoring the retrieval planner/)

    // Binding: the packet behind THIS assistant message is one lookup.
    const firstPacketId = first.assistantMessage.agent?.contextPacketId
    assert.ok(firstPacketId, 'the answer records its packet id')
    const bound = getContextPacketForMessage(db, first.assistantMessage.id)
    assert.ok(bound, 'the packet is bound to the assistant message')
    assert.equal(bound?.id, firstPacketId)
    assert.equal(bound?.exchangeKind, 'chat')
    assert.equal(bound?.packet.request.originalText, question)

    // Citations: the marker became a superscript and the persisted citation
    // resolves to the first packet item.
    assert.equal(first.assistantMessage.content, 'The retrieval planner refactor led that day¹.')
    const citations = first.assistantMessage.agent?.citations ?? []
    assert.equal(citations.length, 1)
    assert.equal(citations[0].marker, 1)
    assert.equal(citations[0].identity, bound?.packet.items[0].identity)

    // Determinism: same question + same day state ⇒ same packet content
    // fingerprint and the same grounded answer through the fixture seam.
    const second = await sendMessage(
      { message: question, threadId: null, clientRequestId: 'packet-turn-2' },
      { model },
    )
    const secondBound = getContextPacketForMessage(db, second.assistantMessage.id)
    assert.ok(secondBound)
    assert.notEqual(secondBound?.id, bound?.id, 'packet identity is per exchange')
    assert.equal(
      secondBound?.packet.contentFingerprint,
      bound?.packet.contentFingerprint,
      'same state ⇒ same packet content',
    )
    assert.deepEqual(secondBound?.packet.items, bound?.packet.items)
    assert.equal(second.assistantMessage.content, first.assistantMessage.content)
    assert.deepEqual(second.assistantMessage.agent?.citations, first.assistantMessage.agent?.citations)
  } finally {
    __resetSettings()
    clearTestDb()
    db.close()
  }
})

test('citation integrity: markers the packet cannot back are dropped; every kept citation exists in the bound packet', async () => {
  const db = createProductionTestDatabase()
  insertSession(db, 'Refactoring the retrieval planner', 9, 45)
  indexMemoryForDay(db, DATE)

  const model = answerModel(
    `Planner work happened [C1]. Nothing else stands out [C99]. Same source again [C1].`,
  )

  setTestDb(db)
  __setSettings({ aiProvider: 'anthropic', aiChatProvider: 'anthropic' })
  await setApiKey('anthropic', 'test-key')
  try {
    const result = await sendMessage(
      { message: `What retrieval planner work happened on ${DATE}?`, threadId: null, clientRequestId: 'cite-turn-1' },
      { model },
    )
    assert.equal(
      result.assistantMessage.content,
      'Planner work happened¹. Nothing else stands out. Same source again¹.',
      'valid markers render as superscripts; the unverifiable one vanishes; repeats reuse the number',
    )
    const citations = result.assistantMessage.agent?.citations ?? []
    assert.equal(citations.length, 1, 'one distinct source was cited')
    const bound = getContextPacketForMessage(db, result.assistantMessage.id)
    assert.ok(bound)
    for (const citation of citations) {
      assert.ok(
        bound!.packet.items.some((item) => item.identity === citation.identity),
        `cited id ${citation.identity} exists in the bound packet`,
      )
      assert.ok(citation.statement.length > 0)
    }
  } finally {
    __resetSettings()
    clearTestDb()
    db.close()
  }
})

test('a correction-vs-automated-label conflict reaches the model as an explicit name-this instruction', async () => {
  const db = createProductionTestDatabase()
  insertSession(db, 'Quarterly report drafting', 9, 60)
  const payload = materializeTimelineDayProjection(db, DATE, null)
  const block = payload.blocks.find((candidate) => !candidate.isLive)
  assert.ok(block, 'the seeded day produced a block')
  writeAIBlockLabel(db, { blockId: block!.id, label: 'Casual reading', narrative: null })
  writeTimelineBlockReview(db, DATE, block!, { state: 'corrected', correctedLabel: 'Board report drafting' })
  indexMemoryForDay(db, DATE)

  const prompts: string[] = []
  const model = answerModel(
    'You corrected that block to Board report drafting; the automated label said Casual reading, so the sources disagreed.',
    (options) => prompts.push(JSON.stringify(options.prompt)),
  )

  const result = await runChatAgentTurn(`what happened on ${DATE}`, [], agentDeps(db, model))
  try {
    assert.match(prompts[0], /disagrees with itself/)
    assert.match(prompts[0], /NAME each disagreement/)
    assert.match(prompts[0], /Board report drafting/)
    assert.match(prompts[0], /Casual reading/)
    assert.ok(result.contextPacketId, 'the conflicted packet was still recorded')
    const stored = getContextPacketById(db, result.contextPacketId!)
    assert.ok(stored)
    const conflict = stored!.packet.conflicts.find((entry) => entry.identity === `block:${block!.id}`)
    assert.ok(conflict, 'the conflict rides the recorded packet')
    assert.match(result.text, /disagreed/)
  } finally {
    db.close()
  }
})

test('honest failure: an empty day produces a packet that says what is missing instead of inviting invention', async () => {
  const db = createProductionTestDatabase()
  const prompts: string[] = []
  const model = answerModel(
    `Daylens has nothing recorded for ${DATE} — tracking captured no signal that day.`,
    (options) => prompts.push(JSON.stringify(options.prompt)),
  )

  const result = await runChatAgentTurn(`What did I do on ${DATE}?`, [], agentDeps(db, model))
  try {
    assert.match(prompts[0], /contains NO recorded items/)
    assert.match(prompts[0], /Never invent activity/)
    assert.match(prompts[0], /No capture signal for this day/)
    assert.ok(result.contextPacketId, 'emptiness is still a recorded disclosure')
    const stored = getContextPacketById(db, result.contextPacketId!)
    assert.equal(stored?.packet.items.length, 0)
    assert.ok(stored!.packet.gaps.some((gap) => gap.kind === 'no-capture'))
    assert.deepEqual(result.citations, [])
    assert.match(result.text, /nothing recorded/)
  } finally {
    db.close()
  }
})

test('a database without the packet ledger still answers: tools-only turn, no packet id claimed', async () => {
  const db = createProductionTestDatabase()
  insertSession(db, 'Refactoring the retrieval planner', 9, 45)
  indexMemoryForDay(db, DATE)
  db.exec('DROP TABLE context_packets')

  const model = answerModel('Planner work led the day [C1].')
  const result = await runChatAgentTurn(`What retrieval planner work happened on ${DATE}?`, [], agentDeps(db, model))
  try {
    assert.equal(result.contextPacketId, null, 'no ledger ⇒ no packet id claimed')
    assert.equal(result.text, 'Planner work led the day¹.', 'the in-memory packet still resolves markers')
    assert.equal(result.citations.length, 1)
  } finally {
    db.close()
  }
})

test('resolvePacketCitations drops every marker when no packet exists', () => {
  const resolved = resolvePacketCitations('A claim [C1]. Another [C2, C3].', null)
  assert.equal(resolved.text, 'A claim. Another.')
  assert.deepEqual(resolved.citations, [])
})
