import type { AIProvider, ProviderConnectionResult } from '@shared/types'

function detectProviderFromApiKey(key: string): AIProvider | null {
  const trimmed = key.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('sk-ant-')) return 'anthropic'
  if (trimmed.startsWith('sk-or-')) return 'openrouter'
  if (trimmed.startsWith('AIza')) return 'google'
  if (trimmed.startsWith('sk-')) return 'openai'
  return null
}

function providerDisplayName(provider: AIProvider): string {
  switch (provider) {
    case 'anthropic': return 'Claude'
    case 'openai': return 'OpenAI'
    case 'google': return 'Gemini'
    case 'openrouter': return 'OpenRouter'
  }
}

function unsupportedFormat(provider: AIProvider, detectedProvider: AIProvider | null): ProviderConnectionResult {
  return {
    status: 'unsupported_format',
    provider,
    detectedProvider,
    message: detectedProvider && detectedProvider !== provider
      ? `That looks like a ${providerDisplayName(detectedProvider)} key, not a ${providerDisplayName(provider)} key.`
      : 'That key format does not match the selected provider yet.',
    canSaveAnyway: false,
  }
}

function endpointForProvider(provider: AIProvider): { url: string; headers: Record<string, string> } {
  switch (provider) {
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models',
        headers: {
          'x-api-key': '',
          'anthropic-version': '2023-06-01',
        },
      }
    case 'google':
      return {
        url: 'https://generativelanguage.googleapis.com/v1beta/models',
        headers: {},
      }
    case 'openrouter':
      return {
        url: 'https://openrouter.ai/api/v1/key',
        headers: {
          Authorization: '',
        },
      }
    case 'openai':
    default:
      return {
        url: 'https://api.openai.com/v1/models',
        headers: {
          Authorization: '',
        },
      }
  }
}

export async function validateProviderConnection(provider: AIProvider, key: string): Promise<ProviderConnectionResult> {
  const trimmed = key.trim()
  const detectedProvider = detectProviderFromApiKey(trimmed)
  if (!trimmed) {
    return {
      status: 'unsupported_format',
      provider,
      detectedProvider,
      message: 'Paste an API key to connect this provider.',
      canSaveAnyway: false,
    }
  }

  if (detectedProvider && detectedProvider !== provider) {
    return unsupportedFormat(provider, detectedProvider)
  }

  const endpoint = endpointForProvider(provider)
  const headers = { ...endpoint.headers }
  if (provider === 'anthropic') {
    headers['x-api-key'] = trimmed
  } else if (provider === 'google') {
    endpoint.url = `${endpoint.url}?key=${encodeURIComponent(trimmed)}`
  } else {
    headers.Authorization = `Bearer ${trimmed}`
  }

  try {
    const response = await fetch(endpoint.url, { headers })
    if (response.ok || response.status === 429) {
      return {
        status: 'valid',
        provider,
        detectedProvider,
        message: `${providerDisplayName(provider)} is connected and ready.`,
        canSaveAnyway: false,
      }
    }

    if (response.status === 400 || response.status === 401 || response.status === 403) {
      return {
        status: 'invalid_credentials',
        provider,
        detectedProvider,
        message: 'That key was rejected by the provider. Double-check the key and try again.',
        canSaveAnyway: false,
      }
    }

    return {
      status: 'provider_unreachable',
      provider,
      detectedProvider,
      message: `The provider could not be reached right now (${response.status}). You can save the key anyway and retry later.`,
      canSaveAnyway: true,
    }
  } catch (err) {
    return {
      status: 'provider_unreachable',
      provider,
      detectedProvider,
      message: `The provider could not be reached right now. ${err instanceof Error ? err.message : 'Try again in a moment.'}`,
      canSaveAnyway: true,
    }
  }
}
