// What a chat turn SENDS to the provider is bounded to the newest
// MAX_PROVIDER_HISTORY_MESSAGES messages — message paging bounded the screen,
// this bounds the payload. The answer-quality contract: recent turns (what
// follow-ups actually reference) always survive the cut.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boundProviderHistory, MAX_PROVIDER_HISTORY_MESSAGES } from '../src/main/jobs/aiService.ts'

type Msg = { role: 'user' | 'assistant'; content: string }

function exchanges(count: number): Msg[] {
  const out: Msg[] = []
  for (let i = 1; i <= count; i += 1) {
    out.push({ role: 'user', content: `question ${i}` })
    out.push({ role: 'assistant', content: `answer ${i}` })
  }
  return out
}

test('a short thread passes through untouched', () => {
  const prior = exchanges(3)
  assert.deepEqual(boundProviderHistory(prior), prior)
})

test('a long thread is cut to the newest MAX_PROVIDER_HISTORY_MESSAGES messages', () => {
  const prior = exchanges(100) // 200 messages
  const bounded = boundProviderHistory(prior)
  assert.equal(bounded.length, MAX_PROVIDER_HISTORY_MESSAGES)
  // Newest exchanges survive — the ones follow-ups actually reference.
  assert.equal(bounded[bounded.length - 1].content, 'answer 100')
  assert.equal(bounded[bounded.length - 2].content, 'question 100')
  // And the payload no longer grows with thread length.
  assert.equal(bounded.some((m) => m.content === 'question 1'), false)
})

test('the bounded history always starts with a user turn', () => {
  // 21 messages ending on an assistant turn: a naive tail-slice of 20 would
  // start with an assistant message, which Anthropic/Google reject.
  const prior: Msg[] = [{ role: 'user', content: 'q0' }, ...exchanges(10)]
  const bounded = boundProviderHistory(prior)
  assert.equal(bounded[0].role, 'user')
  assert.ok(bounded.length <= MAX_PROVIDER_HISTORY_MESSAGES)
})

test('a degenerate all-assistant history bounds to empty rather than assistant-first', () => {
  const prior: Msg[] = [
    { role: 'assistant', content: 'orphan a' },
    { role: 'assistant', content: 'orphan b' },
  ]
  assert.deepEqual(boundProviderHistory(prior), [])
})

test('empty history stays empty', () => {
  assert.deepEqual(boundProviderHistory([]), [])
})
