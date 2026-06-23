import test from 'node:test'
import assert from 'node:assert/strict'
import { CONVERSE_SYSTEM_PROMPT, looksLikeGreeting } from '../src/main/ai/converse.ts'

test('treats whole-message greetings and check-ins as conversation', () => {
  for (const message of [
    'Hi',
    'hey',
    'Hello!',
    'Good morning',
    'how are you?',
    "How's it going?",
    'How’s it going?',
    'Hey, how’s it going?',
    "what's up",
    'sup',
    'testing',
  ]) {
    assert.equal(looksLikeGreeting(message), true, message)
  }
})

test('does not swallow real questions that merely open warmly', () => {
  for (const message of [
    'Hey, what did I work on today?',
    'Good morning — how long was I in Cursor yesterday?',
    'Hi, find the article I saw about transformers.',
    'How is my week looking by project?',
    'really why are you not excited to see me?',
  ]) {
    assert.equal(looksLikeGreeting(message), false, message)
  }
})

test('the conversation prompt inherits the voice and refuses a capability menu', () => {
  assert.match(CONVERSE_SYSTEM_PROMPT, /warm, clear, specific, and evidence-led/i)
  assert.match(CONVERSE_SYSTEM_PROMPT, /one or two short sentences/i)
  assert.match(CONVERSE_SYSTEM_PROMPT, /Never recite a list/i)
  assert.match(CONVERSE_SYSTEM_PROMPT, /never invent one/i)
})

test('the conversation prompt is fun: mirrors tone, allows emoji, does not interrogate', () => {
  assert.match(CONVERSE_SYSTEM_PROMPT, /Mirror their energy/i)
  assert.match(CONVERSE_SYSTEM_PROMPT, /if they joke, joke back/i)
  assert.match(CONVERSE_SYSTEM_PROMPT, /emoji/i)
  assert.match(CONVERSE_SYSTEM_PROMPT, /Don't interrogate/i)
})
