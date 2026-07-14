// Maps the app's ResolvedProviderConfig (Settings-chosen provider + model)
// onto an AI SDK LanguageModel for the chat agent loop.
// Direct API providers and the managed proxy are supported; CLI providers
// cannot make structured tool calls, so the chat surface says so honestly
// instead of silently degrading.
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { AIProviderMode } from '@shared/types'
import type { ResolvedProviderConfig } from '../services/aiOrchestration'
import { assertRealDayExternalAccessAllowed } from '../lib/realDayHarness'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export function providerSupportsAgentTools(provider: AIProviderMode, transport?: 'direct' | 'managed'): boolean {
  if (transport === 'managed') return true
  return provider === 'anthropic' || provider === 'openai' || provider === 'google' || provider === 'openrouter'
}

export function languageModelFor(config: ResolvedProviderConfig): LanguageModel {
  assertRealDayExternalAccessAllowed('model-provider')
  if (config.transport === 'managed') {
    if (!config.baseUrl) throw new Error('Managed AI transport is missing its base URL.')
    return createOpenAICompatible({
      name: 'daylens-managed',
      baseURL: config.baseUrl,
      apiKey: config.apiKey ?? undefined,
    })(config.model)
  }
  const apiKey = config.apiKey ?? undefined
  switch (config.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })(config.model)
    case 'openai':
      return createOpenAI({ apiKey })(config.model)
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(config.model)
    case 'openrouter':
      return createOpenAICompatible({
        name: 'openrouter',
        baseURL: OPENROUTER_BASE_URL,
        apiKey,
      })(config.model)
    default:
      throw new Error(`The chat agent needs an API provider; ${config.provider} runs through a CLI and can't make tool calls. Pick an API provider in Settings.`)
  }
}
