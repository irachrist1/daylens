import test from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { setTestDb, clearTestDb } from './support/database-stub.mjs'
import { __resetSettings, __setSettings, setApiKey } from './support/settings-stub.mjs'
import { insertAppSession } from '../src/main/db/queries.ts'
import { getThreadMessages } from '../src/main/db/queries.ts'
import { sendMessage } from '../src/main/jobs/aiService.ts'
import { getThread } from '../src/main/services/artifacts.ts'
import { getContextPacketForMessage } from '../src/main/services/contextPacket.ts'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

function response(chunks: unknown[]) {
  return { stream: simulateReadableStream({ chunks }) }
}

test('sendMessage completes a grounded tool turn and persists the streamed thread', async () => {
  const db = createProductionTestDatabase()
  const start = new Date(2026, 6, 14, 9, 0, 0, 0).getTime()
  insertAppSession(db, {
    bundleId: 'com.microsoft.VSCode',
    appName: 'Code',
    startTime: start,
    endTime: start + 30 * 60_000,
    durationSeconds: 30 * 60,
    category: 'development',
    isFocused: true,
    windowTitle: 'Acme launch plan.md',
    rawAppName: 'Code',
    canonicalAppId: 'vscode',
    appInstanceId: 'com.microsoft.VSCode',
    captureSource: 'foreground_poll',
    endedReason: 'app_switch',
    captureVersion: 2,
  })

  let modelCall = 0
  const model = new MockLanguageModelV3({
    doStream: async () => {
      modelCall += 1
      if (modelCall === 1) {
        return response([
          {
            type: 'tool-call',
            toolCallId: 'overview-1',
            toolName: 'get_day_overview',
            input: '{"date":"2026-07-14"}',
          },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
        ] as never[])
      }
      return response([
        { type: 'text-start', id: 'answer-1' },
        {
          type: 'text-delta',
          id: 'answer-1',
          delta: 'On "2026-07-14", Daylens captured 30 minutes in "Acme launch plan.md".',
        },
        { type: 'text-end', id: 'answer-1' },
        { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
      ] as never[])
    },
  })
  const streamEvents: Array<{ delta: string; snapshot: string; status?: string }> = []

  setTestDb(db)
  __setSettings({ aiProvider: 'anthropic', aiChatProvider: 'anthropic' })
  await setApiKey('anthropic', 'test-key')
  try {
    const result = await sendMessage(
      {
        message: 'Summarize my Acme launch planning on July 14.',
        threadId: null,
        clientRequestId: 'turn-1',
      },
      {
        model,
        onStreamEvent: (event) => streamEvents.push(event),
      },
    )

    assert.equal(result.providerCallCount, 2)
    assert.equal(
      result.assistantMessage.content,
      'On "2026-07-14", Daylens captured 30 minutes in "Acme launch plan.md".',
    )
    assert.equal(result.assistantMessage.agent?.groundingRetried, false)
    assert.deepEqual(
      result.assistantMessage.agent?.toolTrace.map((entry) => entry.tool),
      ['get_day_overview'],
    )
    assert.match(result.assistantMessage.agent?.toolTrace[0]?.output ?? '', /Acme launch plan\.md/)
    assert.ok(streamEvents.some((event) => event.status === 'Reading 2026-07-14'))
    assert.equal(streamEvents.at(-1)?.snapshot, result.assistantMessage.content)

    // DEV-182: every chat turn records its context packet before the request
    // leaves and binds it to the persisted assistant message.
    assert.ok(result.assistantMessage.agent?.contextPacketId, 'the turn recorded a context packet')
    const boundPacket = getContextPacketForMessage(db, result.assistantMessage.id)
    assert.equal(boundPacket?.id, result.assistantMessage.agent?.contextPacketId)
    assert.equal(boundPacket?.exchangeKind, 'chat')

    assert.ok(result.threadId)
    assert.ok(getThread(result.threadId))
    const messages = getThreadMessages(db, result.threadId)
    assert.deepEqual(
      messages.map((message) => message.role),
      ['user', 'assistant'],
    )
    assert.equal(messages[1].content, result.assistantMessage.content)
    assert.deepEqual(
      messages[1].agent?.toolTrace.map((entry) => entry.tool),
      ['get_day_overview'],
    )
  } finally {
    __resetSettings()
    clearTestDb()
    db.close()
  }
})
