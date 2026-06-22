import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONVERSATIONAL_GREETING_SYSTEM_PROMPT,
  isConversationalGreeting,
} from '../src/main/ai/smallTalk.ts'

test('recognizes short greetings and conversational check-ins', () => {
  for (const message of [
    'Hey',
    'Hello!',
    'Good morning',
    'How are you?',
    'How’s your day going?',
    "Hey? how's it going?",
    'Hey? how’s it going?',
    "Hi — what's up?",
    'Hi — what’s up?',
  ]) {
    assert.equal(isConversationalGreeting(message), true, message)
  }
})

test('does not swallow real Daylens questions that happen to start warmly', () => {
  for (const message of [
    'Hey, what did I work on today?',
    'Good morning — how long was I in Cursor yesterday?',
    'Hi, find the article I saw about transformers.',
    'How is my week looking by project?',
  ]) {
    assert.equal(isConversationalGreeting(message), false, message)
  }
})

test('greeting prompt inherits the shared voice and avoids a capability dump', () => {
  assert.match(CONVERSATIONAL_GREETING_SYSTEM_PROMPT, /warm, clear, specific, and evidence-led/i)
  assert.match(CONVERSATIONAL_GREETING_SYSTEM_PROMPT, /one short sentence/i)
  assert.match(CONVERSATIONAL_GREETING_SYSTEM_PROMPT, /Do not list every Daylens capability/i)
  assert.match(CONVERSATIONAL_GREETING_SYSTEM_PROMPT, /Do not claim anything about their activity/i)
})
