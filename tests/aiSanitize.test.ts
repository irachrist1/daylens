import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeForModel, sanitizeForRender, stripLegacyMemoryNudge } from '../src/shared/aiSanitize'

test('legacy inline memory nudges are removed from stored chat answers', () => {
  const answer = 'Monday was your strongest work day.\n\nBy the way — you use Dia most often. Want me to remember that? Just say "remember that".'
  assert.equal(stripLegacyMemoryNudge(answer), 'Monday was your strongest work day.')
})

test('normal answer text is unchanged', () => {
  const answer = 'You asked me to remember that Acme is your largest client.'
  assert.equal(stripLegacyMemoryNudge(answer), answer)
})

test('public resource links keep a lone non-secret video id', () => {
  const link = 'https://media.example/watch?v=Abc_123-xyz'
  assert.equal(sanitizeForModel(link), link)
  assert.equal(sanitizeForRender(link).text, link)
  assert.equal(sanitizeForModel(`${link}&token=secret-value`), link)
})
