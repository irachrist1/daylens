// DEV-191 acceptance: the agent's "what did I ship" answers CITE the
// connected GitHub records. Through the deterministic AI-turn seam
// (fixture model, recorded context packet): the day-scoped packet carries the
// synced pull request and review as connected-source items, the answer's
// [Cn] markers resolve to exactly those disclosed records, and after
// disconnect-with-delete the same question yields a packet with no GitHub
// item and no resolvable citation — removed from answers, not just storage.
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
  createFakeGithubApi,
  createFakeSecretStore,
  FAKE_GITHUB_ENDPOINTS,
} from './support/fakeGithubApi.ts'
import { createGithubAdapter } from '../src/main/connectors/github/adapter.ts'
import { connectConnector, disconnectConnector } from '../src/main/connectors/service.ts'
import { runChatAgentTurn } from '../src/main/agent/chatAgent.ts'
import { getContextPacketById } from '../src/main/services/contextPacket.ts'

const CLIENT_ID = 'Iv1.testdeviceclient01'
const REPO = 'octo-lab/api'

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
    artifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-agent-github-')),
    now: new Date(),
  }
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

test('"what did I ship" cites the connected GitHub records; disconnect-with-delete removes them from answers', async () => {
  const db = createProductionTestDatabase()
  const fake = createFakeGithubApi({ login: 'ada-dev' })
  fake.addRepo(REPO)
  fake.putPull(REPO, {
    number: 7,
    title: 'Connector foundation extensions',
    state: 'closed',
    merged_at: isoDaysAgo(1, 15, 0),
    created_at: isoDaysAgo(3, 9, 0),
    updated_at: isoDaysAgo(1, 15, 0),
    user: { login: 'ada-dev' },
  })
  fake.addReview(REPO, 7, {
    id: 501,
    state: 'APPROVED',
    submitted_at: isoDaysAgo(1, 14, 30),
    user: { login: 'ana-collab' },
  })
  const store = createFakeSecretStore()
  const adapter = createGithubAdapter({
    fetchImpl: fake.fetchImpl,
    openExternal: () => fake.approveDevice(),
    secretStore: store,
    endpoints: FAKE_GITHUB_ENDPOINTS,
    env: {},
    authTimeoutMs: 10_000,
  })
  const mergeDate = localDateDaysAgo(1)
  const question = `What did I ship on ${mergeDate}?`

  try {
    const connected = await connectConnector(
      db,
      'github',
      { clientId: CLIENT_ID, repositories: REPO },
      { adapter, gate: OPEN_GATE },
    )
    assert.equal(connected.status, 'ok')

    const prompts: string[] = []
    const model = answerModel(
      'You merged the connector foundation extensions [C2]; ana-collab approved the review [C1].',
      (options) => prompts.push(JSON.stringify(options.prompt)),
    )
    const result = await runChatAgentTurn(question, [], agentDeps(db, model))

    // The prompt the model actually received disclosed the connected records,
    // labeled by provider. (Quotes inside the captured JSON are escaped, so
    // the title is matched separately from the statement prefix.)
    assert.match(prompts[0], /GitHub: merged pull request/)
    assert.match(prompts[0], /Connector foundation extensions/)
    assert.match(prompts[0], /review by ana-collab/)

    // Every persisted citation resolves to a connected-source packet item.
    assert.ok(result.contextPacketId, 'the turn recorded its packet')
    const bound = getContextPacketById(db, result.contextPacketId!)
    assert.ok(bound)
    const githubItems = bound!.packet.items.filter((item) => item.statement.startsWith('GitHub: '))
    assert.equal(githubItems.length, 2, 'the merged PR and the review are disclosed items')
    for (const item of githubItems) {
      assert.equal(item.sourceType, 'connected', 'connected provenance is explicit on the item')
    }
    assert.equal(result.citations.length, 2, 'both markers resolved')
    for (const citation of result.citations) {
      assert.match(citation.statement, /^GitHub: /, 'the answer cites the connected records themselves')
      assert.ok(
        bound!.packet.items.some((item) => item.identity === citation.identity),
        'each citation resolves to a disclosed packet item',
      )
    }
    assert.match(result.text, /[¹²]/, 'the visible answer carries citation superscripts')

    // Disconnect WITH deletion: the same question now yields a packet with no
    // GitHub item, and a marker pointing at the old evidence is dropped.
    await disconnectConnector(db, 'github', { deleteData: true, adapter, secretStore: store })
    const afterModel = answerModel('Nothing synced from GitHub remains for that day [C1].')
    const after = await runChatAgentTurn(question, [], agentDeps(db, afterModel))
    assert.ok(after.contextPacketId)
    const afterBound = getContextPacketById(db, after.contextPacketId!)
    assert.ok(afterBound)
    assert.equal(
      afterBound!.packet.items.filter((item) => item.statement.includes('GitHub')).length,
      0,
      'deleted connector evidence never re-enters a packet',
    )
    assert.deepEqual(after.citations, [], 'no citation can point at deleted evidence')
    assert.ok(!after.text.includes('¹'), 'the unverifiable marker was dropped, not rendered')
  } finally {
    db.close()
  }
})
