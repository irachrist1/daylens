// BYOK survives managed exhaustion (DEV-201, ai-agent.md §Models): a person's
// own key keeps serving chats no matter what the managed allowance says. The
// provider resolution consults billing only as a FALLBACK when no key or CLI
// exists — so an exhausted, expired, or unreachable billing state cannot touch
// a BYOK turn. Keys ride the OS secure-store boundary (getApiKey), never
// settings JSON.
import test from 'node:test'
import assert from 'node:assert/strict'

// billing.ts reads this vite define at call time; the hermetic run has no
// billing service, which is exactly the condition under test.
;(globalThis as Record<string, unknown>).__DAYLENS_BILLING_API_URL__ = ''

import { resolveProviderConfigsForJob } from '../src/main/services/aiOrchestration.ts'
import { buildModelSources } from '../src/shared/aiModelSources.ts'
import { __resetSettings, __setSettings, getSettings, setApiKey, clearApiKey } from './support/settings-stub.mjs'

test('a saved key resolves an own_key chat config without consulting managed billing', async () => {
  __setSettings({ aiProvider: 'anthropic', aiChatProvider: 'anthropic' })
  await setApiKey('anthropic', 'byok-test-key')
  try {
    const configs = await resolveProviderConfigsForJob('chat_answer', getSettings())
    assert.ok(configs.length >= 1)
    assert.equal(configs[0].provider, 'anthropic')
    assert.equal(configs[0].billingMode, 'own_key')
    assert.equal(configs[0].transport, 'direct')
    // The key came through the secure-store accessor, not a settings field.
    assert.equal(configs[0].apiKey, 'byok-test-key')
    assert.equal((getSettings() as Record<string, unknown>).anthropicApiKey, undefined)
    // With at least one own-key config, the managed fallback is never reached:
    // getManagedAIConfig would need a billing token this hermetic run does not
    // have — resolution succeeding at all proves billing was not required.
    assert.ok(configs.every((config) => config.transport === 'direct'))
  } finally {
    await clearApiKey('anthropic')
    __resetSettings()
  }
})

test('with no key and no billing, resolution fails closed for managed — never a silent substitute', async () => {
  __setSettings({ aiProvider: 'anthropic', aiChatProvider: 'anthropic' })
  try {
    await assert.rejects(
      resolveProviderConfigsForJob('chat_answer', getSettings()),
      /AI access is paused/,
    )
  } finally {
    __resetSettings()
  }
})

test('the picker mirrors the same independence: exhausted managed leaves BYOK selectable', () => {
  const sources = buildModelSources({
    providerAvailability: { anthropic: true },
    billing: { mode: 'trial', canUseAI: false, message: 'Trial credit is used up.' },
  })
  const managed = sources.find((source) => source.id === 'managed')!
  const byok = sources.find((source) => source.id === 'byok:anthropic')!
  assert.equal(managed.available, false)
  assert.match(managed.unavailableReason ?? '', /used up/i)
  assert.equal(byok.available, true)
})
