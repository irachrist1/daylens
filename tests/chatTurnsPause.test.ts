// Renderer turn transitions for pause/resume (DEV-200): the paused row is
// honestly resumable (never a fake answer, never an error card), restored
// checkpoints render without duplicating an on-screen pause, and cancelled
// rows stay cancelled.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendPausedCheckpoints,
  attachPausedCheckpointId,
  beginTurn,
  cancelTurn,
  pauseTurn,
  removeTurn,
} from '../src/renderer/views/insights/chatTurns.ts'
import type { ThreadMessage } from '../src/renderer/views/insights/types.ts'

function pendingPair(requestId: string, prompt = 'How did my day go?'): ThreadMessage[] {
  return beginTurn([], {
    userId: `user:${requestId}`,
    assistantId: `assistant:${requestId}`,
    prompt,
    createdAt: 1_000,
  })
}

test('pauseTurn flips the pending row to a paused, resumable state — no partial answer text', () => {
  const messages = pauseTurn(pendingPair('r1'), 'assistant:r1', { question: 'How did my day go?', checkpointId: null })
  const paused = messages.find((m) => m.id === 'assistant:r1')!
  assert.equal(paused.state, 'paused')
  assert.equal(paused.content, '')
  assert.equal(paused.pausedInfo?.question, 'How did my day go?')
  assert.equal(paused.pausedInfo?.checkpointId, null)
  assert.equal(paused.pausedInfo?.pauseKind, 'user')
})

test('the checkpoint id arriving later fills into the paused row', () => {
  let messages = pauseTurn(pendingPair('r2'), 'assistant:r2', { question: 'q', checkpointId: null })
  messages = attachPausedCheckpointId(messages, 'assistant:r2', 'atc_abc')
  assert.equal(messages.find((m) => m.id === 'assistant:r2')!.pausedInfo?.checkpointId, 'atc_abc')
  // A non-paused row is never touched.
  const untouched = attachPausedCheckpointId(pendingPair('r3'), 'assistant:r3', 'atc_x')
  assert.equal(untouched.find((m) => m.id === 'assistant:r3')!.state, 'pending')
})

test('a cancelled row stays cancelled — pause cannot rewrite it', () => {
  const cancelled = cancelTurn(pendingPair('r4'), 'assistant:r4')
  const after = pauseTurn(cancelled, 'assistant:r4', { question: 'q', checkpointId: 'atc_1' })
  assert.equal(after.find((m) => m.id === 'assistant:r4')!.state, 'cancelled')
})

test('restored checkpoints append as question + paused pairs, without duplicating an on-screen pause', () => {
  let messages = pauseTurn(pendingPair('r5'), 'assistant:r5', { question: 'q5', checkpointId: null })
  messages = attachPausedCheckpointId(messages, 'assistant:r5', 'atc_live')

  const restored = appendPausedCheckpoints(messages, [
    { id: 'atc_live', question: 'q5', pauseKind: 'user', lastStatus: null, createdAt: 900 },
    { id: 'atc_restart', question: 'What did I ship?', pauseKind: 'restart', lastStatus: 'Searching your repos', createdAt: 950 },
  ])

  // The live pause is not duplicated; the restart one appends as a pair.
  assert.equal(restored.filter((m) => m.pausedInfo?.checkpointId === 'atc_live').length, 1)
  const restartRow = restored.find((m) => m.pausedInfo?.checkpointId === 'atc_restart')!
  assert.equal(restartRow.state, 'paused')
  assert.equal(restartRow.pausedInfo?.pauseKind, 'restart')
  assert.equal(restartRow.pausedInfo?.lastStatus, 'Searching your repos')
  const questionRow = restored.find((m) => m.id === 'user:ckpt:atc_restart')!
  assert.equal(questionRow.role, 'user')
  assert.equal(questionRow.content, 'What did I ship?')
})

test('appending nothing returns the same array; resume removes the pair in place', () => {
  const messages = pendingPair('r6')
  assert.equal(appendPausedCheckpoints(messages, []), messages)

  let paused = pauseTurn(messages, 'assistant:r6', { question: 'q6', checkpointId: 'atc_6' })
  paused = removeTurn(paused, 'assistant:r6', 'user:r6')
  assert.equal(paused.length, 0)
})
