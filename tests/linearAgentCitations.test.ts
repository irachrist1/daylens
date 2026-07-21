// DEV-192 acceptance: the agent connects CAPTURED TIME to a NAMED ISSUE —
// "how much time did the payment bug actually take?" — citing both the
// observed session evidence and the connected Linear record in one answer.
// Through the deterministic AI-turn seam (fixture model, recorded context
// packet): the packet carries the captured session AND the Linear issue as
// separately-sourced items, the [Cn] markers resolve to exactly those
// disclosed records, and after disconnect-with-delete the same question
// yields a packet with no Linear item — removed from answers, not just
// storage.
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
  createFakeLinearApi,
  createFakeSecretStore,
  FAKE_LINEAR_API_KEY,
  FAKE_LINEAR_ENDPOINT,
} from './support/fakeLinearApi.ts'
import { createLinearAdapter } from '../src/main/connectors/linear/adapter.ts'
import { connectConnector, disconnectConnector } from '../src/main/connectors/service.ts'
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
            { type: 'text-start', id: 'answer-1', },
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
    artifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-agent-linear-')),
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

function insertSession(db: Database.Database, title: string, startMs: number, durationMinutes: number): void {
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, capture_source, capture_version
    ) VALUES ('com.mitchellh.ghostty', 'Ghostty', ?, ?, ?, 'development', 1, ?, 'Ghostty', 'test', 1)
  `).run(startMs, startMs + durationMinutes * 60_000, durationMinutes * 60, title)
}

test('captured time connects to the named issue: one answer cites the observed session and the Linear record', async () => {
  const db = createProductionTestDatabase()
  const fake = createFakeLinearApi({
    id: 'user-self',
    name: 'Ada',
    displayName: 'Ada',
    organization: { id: 'org-1', name: 'Acme', urlKey: 'acme' },
  })
  fake.putIssue({
    id: 'issue-pay',
    identifier: 'DAY-12',
    title: 'Payment bug: retries double-charge',
    createdAt: isoDaysAgo(4, 9, 0),
    updatedAt: isoDaysAgo(1, 16, 0),
    completedAt: isoDaysAgo(1, 16, 0),
    state: { name: 'Done', type: 'completed' },
    project: { id: 'proj-1', name: 'Billing hardening' },
    assignee: { id: 'user-self', name: 'Ada' },
    creator: { id: 'user-self', name: 'Ada' },
  })
  const store = createFakeSecretStore()
  const adapter = createLinearAdapter({
    fetchImpl: fake.fetchImpl,
    secretStore: store,
    endpoint: FAKE_LINEAR_ENDPOINT,
  })
  const date = localDateDaysAgo(1)
  const question = `How much time did the payment bug actually take on ${date}?`

  try {
    // The captured side: 2h05m of real foreground work on the bug.
    insertSession(db, 'Payment bug — reproducing the double charge', msDaysAgo(1, 9, 30), 75)
    insertSession(db, 'Payment bug — retry idempotency fix', msDaysAgo(1, 14, 0), 50)

    const connected = await connectConnector(db, 'linear', { apiKey: FAKE_LINEAR_API_KEY }, { adapter, gate: OPEN_GATE })
    assert.equal(connected.status, 'ok')

    const prompts: string[] = []
    const model = answerModel(
      'About 2h05m of captured work [C1][C2], and you completed DAY-12 that afternoon [C3].',
      (options) => prompts.push(JSON.stringify(options.prompt)),
    )
    const result = await runChatAgentTurn(question, [], agentDeps(db, model))

    // The prompt the model received carried BOTH evidence kinds.
    assert.match(prompts[0], /Payment bug/)
    assert.match(prompts[0], /Linear: completed DAY-12/)

    assert.ok(result.contextPacketId)
    const bound = getContextPacketById(db, result.contextPacketId!)
    assert.ok(bound)
    const linearItems = bound!.packet.items.filter((item) => item.statement.startsWith('Linear: '))
    assert.ok(linearItems.length >= 1, 'the issue is a disclosed item')
    for (const item of linearItems) {
      assert.equal(item.sourceType, 'connected', 'connected provenance is explicit')
    }
    const observedItems = bound!.packet.items.filter(
      (item) => item.sourceType === 'observed' && item.statement.includes('Payment bug'),
    )
    assert.ok(observedItems.length >= 1, 'the captured sessions are disclosed items')

    // Every marker resolved, spanning both sources.
    assert.equal(result.citations.length, 3)
    assert.ok(result.citations.some((citation) => citation.statement.startsWith('Linear: ')))
    assert.ok(result.citations.some((citation) => !citation.statement.startsWith('Linear: ')))

    // Disconnect WITH deletion: the same question keeps the captured time and
    // loses the Linear evidence.
    await disconnectConnector(db, 'linear', { deleteData: true, adapter, secretStore: store })
    const after = await runChatAgentTurn(
      question,
      [],
      agentDeps(db, answerModel('Roughly two hours of captured work remains on record [C1].')),
    )
    const afterBound = getContextPacketById(db, after.contextPacketId!)
    assert.equal(
      afterBound!.packet.items.filter((item) => item.statement.startsWith('Linear: ')).length,
      0,
      'deleted connector evidence never re-enters a packet',
    )
    assert.ok(
      afterBound!.packet.items.some((item) => item.sourceType === 'observed' && item.statement.includes('Payment bug')),
      'independent local evidence is untouched',
    )
  } finally {
    db.close()
  }
})
