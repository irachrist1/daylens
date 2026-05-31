import test from 'node:test'
import assert from 'node:assert/strict'
import { clearApiKey, getApiKey, hasApiKey, setApiKey } from '../src/main/services/settings.ts'

test('DAYLENS provider API key env overrides are read-only', async () => {
  const previous = process.env.DAYLENS_OPENAI_API_KEY
  process.env.DAYLENS_OPENAI_API_KEY = 'env-openai-key'
  try {
    assert.equal(await hasApiKey('openai'), true)
    assert.equal(await getApiKey('openai'), 'env-openai-key')
    await assert.rejects(
      () => setApiKey('openai', 'stored-key'),
      /DAYLENS_OPENAI_API_KEY is set/,
    )
    await assert.rejects(
      () => clearApiKey('openai'),
      /DAYLENS_OPENAI_API_KEY is set/,
    )
  } finally {
    if (previous === undefined) {
      delete process.env.DAYLENS_OPENAI_API_KEY
    } else {
      process.env.DAYLENS_OPENAI_API_KEY = previous
    }
  }
})
