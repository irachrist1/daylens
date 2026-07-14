// The chat turn lifecycle as pure state transitions (chatTurns.ts).
// These pin the reconciliation invariants the AI tab depends on:
//   cancel  → a cancelled turn NEVER becomes a completed answer or an error,
//             even when the superseded request settles late;
//   retry   → an errored turn is replaced in place, never duplicated;
//   quota   → a hard wall surfaces switch-provider and never auto-retries;
//   switch  → mid-generation navigation (tab/thread switch) blocks thread
//             adoption; a draft send adopts the exact server thread id;
//   paging  → prepending an older page never renders a message twice.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { AIThreadMessage } from '../src/shared/types.ts'
import {
  beginTurn,
  cancelTurn,
  classifyTurnFailure,
  completeTurn,
  failTurn,
  prependEarlierMessages,
  removeTurn,
  shouldAdoptThreadAfterTurn,
} from '../src/renderer/views/insights/chatTurns.ts'
import type { ThreadMessage } from '../src/renderer/views/insights/types.ts'

const REQ = '1700000000-abc123'
const USER_ID = `user:${REQ}`
const ASSISTANT_ID = `assistant:${REQ}`

function startedTurn(): ThreadMessage[] {
  return beginTurn([], { userId: USER_ID, assistantId: ASSISTANT_ID, prompt: 'What did I do today?', createdAt: 1_700_000_000_000 })
}

function persisted(content = 'You spent 3h 16m in your editor.'): AIThreadMessage {
  return {
    id: 42,
    role: 'assistant',
    content,
    createdAt: 1_700_000_005_000,
  } as AIThreadMessage
}

test('beginTurn appends the synthetic user/assistant pair with a pending row', () => {
  const messages = startedTurn()
  assert.equal(messages.length, 2)
  assert.deepEqual(messages.map((m) => m.id), [USER_ID, ASSISTANT_ID])
  assert.equal(messages[1].state, 'pending')
})

test('completeTurn flips the pending row to the persisted answer', () => {
  const messages = completeTurn(startedTurn(), ASSISTANT_ID, persisted())
  const answer = messages[1]
  assert.equal(answer.state, 'complete')
  assert.equal(answer.id, 42)
  assert.match(answer.content, /3h 16m/)
})

test('a cancelled turn stays cancelled when the superseded request completes late', () => {
  const cancelled = cancelTurn(startedTurn(), ASSISTANT_ID)
  assert.equal(cancelled[1].state, 'cancelled')
  assert.equal(cancelled[1].content, '')

  // Late resolve from the aborted request: must NOT become a fake answer.
  const afterLateComplete = completeTurn(cancelled, ASSISTANT_ID, persisted())
  assert.equal(afterLateComplete[1].state, 'cancelled')
  assert.equal(afterLateComplete[1].content, '')

  // Late reject (the abort error): must NOT become an error card either.
  const failure = classifyTurnFailure({ code: 'unknown', retryAfterSeconds: null }, 0, [])
  const afterLateFail = failTurn(cancelled, ASSISTANT_ID, { message: 'Generation stopped.', code: 'unknown', retryAfterSeconds: null }, failure.errorInfo)
  assert.equal(afterLateFail[1].state, 'cancelled')
})

test('retry after failure replaces the errored pair in place, never duplicating the question', () => {
  const failure = classifyTurnFailure({ code: 'unknown', retryAfterSeconds: null }, 0, [])
  const errored = failTurn(startedTurn(), ASSISTANT_ID, { message: 'Anthropic couldn’t complete that.', code: 'unknown', retryAfterSeconds: null }, failure.errorInfo)
  assert.equal(errored[1].state, 'error')

  const removed = removeTurn(errored, ASSISTANT_ID, USER_ID)
  assert.equal(removed.length, 0)

  const retried = beginTurn(removed, { userId: 'user:retry-1', assistantId: 'assistant:retry-1', prompt: 'What did I do today?', createdAt: 1_700_000_010_000 })
  assert.equal(retried.filter((m) => m.role === 'user').length, 1)
  assert.equal(retried[1].state, 'pending')
})

test('quota exhaustion surfaces switch-provider alternates and never schedules an auto-retry', () => {
  const alternates = [{ provider: 'openai' as const, label: 'OpenAI' }]
  const failure = classifyTurnFailure({ code: 'quota_exhausted', retryAfterSeconds: 3600 }, 0, alternates)
  assert.equal(failure.isHardWall, true)
  assert.equal(failure.willAutoRetry, false)
  assert.equal(failure.errorInfo.autoRetryScheduled, false)
  assert.equal(failure.errorInfo.code, 'quota_exhausted')
  assert.deepEqual(failure.errorInfo.alternateProviders, alternates)

  const errored = failTurn(startedTurn(), ASSISTANT_ID, { message: "You've hit the usage limit.", code: 'quota_exhausted', retryAfterSeconds: 3600 }, failure.errorInfo)
  assert.equal(errored[1].state, 'error')
  assert.equal(errored[1].errorInfo?.code, 'quota_exhausted')
  assert.equal(errored[1].errorInfo?.alternateProviders?.length, 1)
})

test('a transient rate limit auto-retries exactly once', () => {
  const first = classifyTurnFailure({ code: 'transient_rate_limit', retryAfterSeconds: 12 }, 0, [])
  assert.equal(first.willAutoRetry, true)
  assert.equal(first.errorInfo.isRateLimit, true)
  const second = classifyTurnFailure({ code: 'transient_rate_limit', retryAfterSeconds: 12 }, 1, [])
  assert.equal(second.willAutoRetry, false)
})

test('credit and auth walls also offer alternates without auto-retry', () => {
  const alternates = [{ provider: 'google' as const, label: 'Gemini' }]
  for (const code of ['credit_exhausted', 'auth'] as const) {
    const failure = classifyTurnFailure({ code, retryAfterSeconds: null }, 0, alternates)
    assert.equal(failure.isHardWall, true, code)
    assert.equal(failure.willAutoRetry, false, code)
    assert.deepEqual(failure.errorInfo.alternateProviders, alternates, code)
  }
})

test('switching provider mid-thread re-runs the exact turn: pair removed, fresh pending pair keyed by a NEW request id', () => {
  const failure = classifyTurnFailure({ code: 'quota_exhausted', retryAfterSeconds: null }, 0, [{ provider: 'openai', label: 'OpenAI' }])
  const errored = failTurn(startedTurn(), ASSISTANT_ID, { message: 'limit', code: 'quota_exhausted', retryAfterSeconds: null }, failure.errorInfo)
  const removed = removeTurn(errored, ASSISTANT_ID, USER_ID)
  const rerun = beginTurn(removed, { userId: 'user:switch-1', assistantId: 'assistant:switch-1', prompt: 'What did I do today?', createdAt: 1_700_000_020_000 })
  // The old synthetic ids are gone, so a late settle of the OLD request can
  // never touch the new pending row.
  assert.equal(rerun.some((m) => m.id === ASSISTANT_ID), false)
  assert.equal(rerun.find((m) => m.id === 'assistant:switch-1')?.state, 'pending')
  const lateSettled = completeTurn(rerun, ASSISTANT_ID, persisted())
  assert.deepEqual(lateSettled, rerun)
})

test('tab/thread switching mid-generation blocks thread adoption; a clean draft send adopts the server thread', () => {
  // Draft send, no navigation since: adopt the authoritative server thread id.
  assert.equal(shouldAdoptThreadAfterTurn({
    requestThreadId: null,
    responseThreadId: 187,
    navigationVersionAtSend: 3,
    navigationVersionNow: 3,
  }), true)
  // The user navigated (new chat / other thread) while generating: never yank
  // them into the finished turn's thread.
  assert.equal(shouldAdoptThreadAfterTurn({
    requestThreadId: null,
    responseThreadId: 187,
    navigationVersionAtSend: 3,
    navigationVersionNow: 4,
  }), false)
  // A send into an existing thread never re-adopts.
  assert.equal(shouldAdoptThreadAfterTurn({
    requestThreadId: 42,
    responseThreadId: 42,
    navigationVersionAtSend: 3,
    navigationVersionNow: 3,
  }), false)
  // Older main process without threadId in the result: no guess-adoption.
  assert.equal(shouldAdoptThreadAfterTurn({
    requestThreadId: null,
    responseThreadId: null,
    navigationVersionAtSend: 3,
    navigationVersionNow: 3,
  }), false)
})

test('prepending an earlier page never renders the same message id twice', () => {
  const current: ThreadMessage[] = [
    { id: 10, role: 'user', content: 'q', createdAt: 1_000, state: 'complete' } as ThreadMessage,
    { id: 11, role: 'assistant', content: 'a', createdAt: 1_001, state: 'complete' } as ThreadMessage,
  ]
  const earlierPage: ThreadMessage[] = [
    { id: 8, role: 'user', content: 'old q', createdAt: 900, state: 'complete' } as ThreadMessage,
    { id: 9, role: 'assistant', content: 'old a', createdAt: 901, state: 'complete' } as ThreadMessage,
    // Overlap with what's already on screen (cursor drift): must be dropped.
    { id: 10, role: 'user', content: 'q', createdAt: 1_000, state: 'complete' } as ThreadMessage,
  ]
  const merged = prependEarlierMessages(current, earlierPage)
  assert.deepEqual(merged.map((m) => m.id), [8, 9, 10, 11])
})
