// Model choice never changes deterministic facts (DEV-201, ai-agent.md
// §Models): switching models re-answers the same fixture question with
// IDENTICAL deterministic totals. Two "providers" that phrase things
// completely differently call the same tool over the same corrected ledger —
// and because deterministic time-chunk answers are rendered from the tool
// result (not model prose), the final answers match to the character.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { setTestDb, clearTestDb } from './support/database-stub.mjs'
import { __resetSettings, __setSettings, setApiKey } from './support/settings-stub.mjs'
import { insertAppSession } from '../src/main/db/queries.ts'
import { sendMessage } from '../src/main/jobs/aiService.ts'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

function chunkCallingModel(prose: string): MockLanguageModelV3 {
  let call = 0
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1
      const chunks = call === 1
        ? [
            {
              type: 'tool-call',
              toolCallId: `chunks-${prose.length}`,
              toolName: 'get_time_chunks',
              input: '{"date":"2026-07-14","startTime":"09:00","endTime":"10:00","incrementMinutes":30}',
            },
            { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
          ]
        : [
            { type: 'text-start', id: 'answer-1' },
            { type: 'text-delta', id: 'answer-1', delta: prose },
            { type: 'text-end', id: 'answer-1' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
          ]
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) }
    },
  })
}

test('switching models re-answers the fixture with identical deterministic totals', async () => {
  const db = createProductionTestDatabase()
  const start = new Date(2026, 6, 14, 9, 0, 0, 0).getTime()
  insertAppSession(db, {
    bundleId: 'com.microsoft.VSCode',
    appName: 'Code',
    startTime: start,
    endTime: start + 45 * 60_000,
    durationSeconds: 45 * 60,
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

  setTestDb(db)
  __setSettings({ aiProvider: 'anthropic', aiChatProvider: 'anthropic' })
  await setApiKey('anthropic', 'test-key')
  try {
    const question = 'Break 9 to 10am on July 14 into 30 minute chunks.'
    const first = await sendMessage(
      { message: question, threadId: null, clientRequestId: 'model-a-1' },
      { model: chunkCallingModel('Model A says: a bright and busy morning!') },
    )
    const second = await sendMessage(
      { message: question, threadId: null, clientRequestId: 'model-b-1' },
      { model: chunkCallingModel('Model B answers tersely. Different words entirely, twice as long, none of them numbers you can trust.') },
    )

    // Identical deterministic answers — the totals come from the corrected
    // ledger through the tool, and the rendered chunk answer ignores prose.
    assert.equal(first.assistantMessage.content, second.assistantMessage.content)
    assert.match(first.assistantMessage.content, /45\s?min|45 minutes|9:00/i)

    // And the underlying tool facts are byte-identical across models.
    const firstTrace = first.assistantMessage.agent?.toolTrace.find((entry) => entry.tool === 'get_time_chunks')
    const secondTrace = second.assistantMessage.agent?.toolTrace.find((entry) => entry.tool === 'get_time_chunks')
    assert.ok(firstTrace && secondTrace)
    assert.equal(firstTrace!.output, secondTrace!.output)
  } finally {
    __resetSettings()
    clearTestDb()
    db.close()
  }
})
