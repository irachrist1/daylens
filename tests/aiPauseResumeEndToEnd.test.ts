// Pause → (restart) → resume, end to end through the REAL sendMessage path
// (DEV-200): a paused turn settles as a persisted resumable checkpoint —
// never a cancelled discard and never a fake answer — survives a simulated
// restart, and a resume adopts the checkpoint, rejoins the SAME thread, and
// answers from a freshly assembled context packet.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { setTestDb, clearTestDb } from './support/database-stub.mjs'
import { __resetSettings, __setSettings, setApiKey } from './support/settings-stub.mjs'
import { getThreadMessages } from '../src/main/db/queries.ts'
import { sendMessage } from '../src/main/jobs/aiService.ts'
import { pauseAIRequest } from '../src/main/lib/aiCancellation.ts'
import {
  getTurnCheckpoint,
  listPausedTurns,
  recoverInterruptedTurns,
} from '../src/main/services/agentTurnState.ts'
import type { AIAgentTurnPhaseEvent } from '../src/shared/types.ts'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

test('pause persists a checkpoint, restart recovery keeps it, resume finishes in the same thread', async () => {
  const db = createProductionTestDatabase()
  setTestDb(db)
  __setSettings({ aiProvider: 'anthropic', aiChatProvider: 'anthropic' })
  await setApiKey('anthropic', 'test-key')

  const phases: AIAgentTurnPhaseEvent[] = []
  let releaseStarted: () => void = () => {}
  const started = new Promise<void>((resolve) => { releaseStarted = resolve })
  let call = 0
  const model = new MockLanguageModelV3({
    doStream: async ({ abortSignal }) => {
      call += 1
      if (call === 1) {
        // The paused turn: signal the test that the provider stream is live,
        // then hold it open until the pause aborts it.
        releaseStarted()
        return new Promise((_resolve, reject) => {
          const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          if (abortSignal?.aborted) return abort()
          abortSignal?.addEventListener('abort', abort)
        })
      }
      // The resumed turn answers plainly.
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 'answer-1' },
            { type: 'text-delta', id: 'answer-1', delta: 'Yesterday was a steady day of development.' },
            { type: 'text-end', id: 'answer-1' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
          ] as never[],
        }),
      }
    },
  })

  try {
    // ── Pause mid-turn ────────────────────────────────────────────────────
    const turn = sendMessage(
      { message: 'How did yesterday go?', threadId: null, clientRequestId: 'turn-pause-1' },
      { model, onPhaseEvent: (event) => phases.push(event) },
    )
    await started
    assert.equal(pauseAIRequest('turn-pause-1'), true)
    await assert.rejects(turn, /Generation paused\./)

    const pausedList = listPausedTurns(db)
    assert.equal(pausedList.length, 1)
    const checkpoint = pausedList[0]
    assert.equal(checkpoint.question, 'How did yesterday go?')
    assert.equal(checkpoint.pauseKind, 'user')
    assert.ok(checkpoint.threadId, 'the paused turn belongs to a real thread')
    // Nothing half-finished was persisted as an answer.
    assert.equal(getThreadMessages(db, checkpoint.threadId!).length, 0)
    // The machine reported the pause with the persisted checkpoint id.
    const pausedEvent = phases.find((event) => event.phase === 'paused')
    assert.ok(pausedEvent)
    assert.equal(pausedEvent!.checkpointId, checkpoint.id)
    assert.equal(pausedEvent!.pauseKind, 'user')

    // ── Simulated restart: recovery leaves the user-paused row intact ─────
    assert.equal(recoverInterruptedTurns(db), 0)
    assert.equal(listPausedTurns(db).length, 1)

    // ── Resume: adopts the checkpoint, same thread, fresh answer ──────────
    const result = await sendMessage(
      {
        message: checkpoint.question,
        threadId: null, // a draft view resuming — the checkpoint's thread must win
        clientRequestId: 'turn-resume-1',
        resumeOfCheckpointId: checkpoint.id,
      },
      { model, onPhaseEvent: (event) => phases.push(event) },
    )

    assert.equal(result.threadId, checkpoint.threadId, 'resume rejoined the paused turn’s thread')
    assert.equal(result.assistantMessage.content, 'Yesterday was a steady day of development.')
    // The completed turn left the outstanding-work ledger.
    assert.equal(getTurnCheckpoint(db, checkpoint.id), null)
    assert.equal(listPausedTurns(db).length, 0)
    assert.equal(phases.at(-1)?.phase, 'completed')
    // The resumed turn assembled its OWN context packet — fresh facts, not a
    // replay of in-flight state.
    assert.ok(result.assistantMessage.agent?.contextPacketId)

    const messages = getThreadMessages(db, checkpoint.threadId!)
    assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant'])
  } finally {
    __resetSettings()
    clearTestDb()
    db.close()
  }
})

test('cancel stays distinct: a cancelled turn leaves no resumable checkpoint', async () => {
  const db = createProductionTestDatabase()
  setTestDb(db)
  __setSettings({ aiProvider: 'anthropic', aiChatProvider: 'anthropic' })
  await setApiKey('anthropic', 'test-key')

  let releaseStarted: () => void = () => {}
  const started = new Promise<void>((resolve) => { releaseStarted = resolve })
  const model = new MockLanguageModelV3({
    doStream: async ({ abortSignal }) => {
      releaseStarted()
      return new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        if (abortSignal?.aborted) return abort()
        abortSignal?.addEventListener('abort', abort)
      })
    },
  })

  try {
    const { cancelAIRequest } = await import('../src/main/lib/aiCancellation.ts')
    const turn = sendMessage(
      { message: 'What did I ship?', threadId: null, clientRequestId: 'turn-cancel-1' },
      { model },
    )
    await started
    assert.equal(cancelAIRequest('turn-cancel-1'), true)
    await assert.rejects(turn, /Generation stopped\./)
    assert.equal(listPausedTurns(db).length, 0, 'cancel must not leave a resumable checkpoint')
  } finally {
    __resetSettings()
    clearTestDb()
    db.close()
  }
})
