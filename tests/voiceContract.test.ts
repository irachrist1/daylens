import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BANNED_VOCAB,
  CITATION_CONTRACT,
  VOICE_SYSTEM_PROMPT,
  assertNoBannedVocab,
} from '../src/main/ai/voiceContract.ts'

test('banned vocabulary mirrors PRODUCT-SPEC', () => {
  assert.deepEqual([...BANNED_VOCAB], [
    'dive into',
    'unleash',
    'navigate the landscape',
    "this isn't X, it's Y",
    "in today's fast-paced world",
    'game-changing',
    'seamless',
    'elevate',
    'great question',
    "let's explore",
    'at the end of the day',
    'fascinating perspective',
    "you're absolutely right",
    'harness the power',
    'empower',
    'robust',
    'streamline',
    'crush it',
    "you've got this",
    'great work',
    "let's dive in",
  ])
})

test('voice system prompt includes the citation contract', () => {
  for (const line of CITATION_CONTRACT) {
    assert.ok(VOICE_SYSTEM_PROMPT.includes(line))
  }
})

test('banned vocabulary assertion catches golden output drift', () => {
  assert.doesNotThrow(() => assertNoBannedVocab('Cursor appeared in the 9am block with github.com open.'))
  assert.throws(() => assertNoBannedVocab('Great question, let us dive into your day.'))
})

