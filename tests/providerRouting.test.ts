// Invariant #12: every AI surface uses the provider/model the user picked in
// Settings. The only exception is an explicit per-chat override in the AI tab.
// These tests pin that rule so a future change can't quietly route a background
// surface (block naming, summaries, reports, wraps) to a different provider —
// the "Settings says Claude, re-analyze runs Gemini" bug this issue fixes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { selectJobProvider } from '../src/main/lib/providerRouting.ts'

test('non-chat surfaces always follow the Settings provider', () => {
  // Even with a different per-chat override set, a background job uses aiProvider.
  const provider = selectJobProvider(false, { aiProvider: 'anthropic', aiChatProvider: 'google' })
  assert.equal(provider, 'anthropic')
})

test('non-chat surfaces follow Settings even when aiChatProvider is openai', () => {
  const provider = selectJobProvider(false, { aiProvider: 'google', aiChatProvider: 'openai' })
  assert.equal(provider, 'google')
})

test('chat honours an explicit per-chat override', () => {
  const provider = selectJobProvider(true, { aiProvider: 'anthropic', aiChatProvider: 'google' })
  assert.equal(provider, 'google')
})

test('chat falls back to the Settings provider when no override is set', () => {
  const provider = selectJobProvider(true, { aiProvider: 'openai', aiChatProvider: undefined })
  assert.equal(provider, 'openai')
})

test('defaults to anthropic when nothing is configured', () => {
  assert.equal(selectJobProvider(false, { aiProvider: undefined as never, aiChatProvider: undefined }), 'anthropic')
  assert.equal(selectJobProvider(true, { aiProvider: undefined as never, aiChatProvider: undefined }), 'anthropic')
})
