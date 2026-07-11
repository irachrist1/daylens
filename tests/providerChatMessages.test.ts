// The provider senders (OpenAI, OpenRouter, managed proxy, Google) all shape
// conversation history through src/main/lib/providerChatMessages.ts. These
// tests pin the shared shape and Google's alternation repair so the senders
// can't drift apart again.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  historyWithUserTurn,
  toChatCompletionMessages,
  toGoogleHistory,
} from '../src/main/lib/providerChatMessages.ts'

const prior = [
  { role: 'user' as const, content: 'What did I do today?' },
  { role: 'assistant' as const, content: 'You mostly worked in Cursor.' },
]

test('historyWithUserTurn appends the new user message after prior turns', () => {
  assert.deepEqual(historyWithUserTurn(prior, 'And yesterday?'), [
    { role: 'user', content: 'What did I do today?' },
    { role: 'assistant', content: 'You mostly worked in Cursor.' },
    { role: 'user', content: 'And yesterday?' },
  ])
})

test('toChatCompletionMessages leads with the system prompt', () => {
  assert.deepEqual(toChatCompletionMessages('be brief', prior, 'And yesterday?'), [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: 'What did I do today?' },
    { role: 'assistant', content: 'You mostly worked in Cursor.' },
    { role: 'user', content: 'And yesterday?' },
  ])
})

test('toGoogleHistory maps assistant to model and keeps alternation', () => {
  assert.deepEqual(toGoogleHistory(prior), [
    { role: 'user', parts: [{ text: 'What did I do today?' }] },
    { role: 'model', parts: [{ text: 'You mostly worked in Cursor.' }] },
  ])
})

test('toGoogleHistory keeps only the last message of a same-role run', () => {
  const corrupted = [
    { role: 'user' as const, content: 'first ask' },
    { role: 'user' as const, content: 'second ask' },
    { role: 'assistant' as const, content: 'reply' },
    { role: 'assistant' as const, content: 'retry reply' },
  ]
  assert.deepEqual(toGoogleHistory(corrupted), [
    { role: 'user', parts: [{ text: 'second ask' }] },
    { role: 'model', parts: [{ text: 'retry reply' }] },
  ])
})
