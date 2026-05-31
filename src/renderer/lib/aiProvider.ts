import type { AIProvider, AIProviderMode } from '@shared/types'

export interface AIModelOption {
  id: string
  label: string
  description: string
}

export interface AIProviderMeta {
  id: AIProviderMode
  label: string
  shortLabel: string
  docsUrl: string
  keyPlaceholder: string
  helperText: string
  defaultModel: string
  models: AIModelOption[]
}

// models reviewed: 2026-05-31 — ids verified against each provider's public
// model docs (ai.google.dev, platform.openai.com, Anthropic). Notable changes:
//   - Google: gemini-3.1-flash-lite-preview was SHUT DOWN 2026-05-25; replaced
//     with the GA gemini-3.1-flash-lite (cheapest/highest-RPM → the default,
//     which directly helps R1). Added GA gemini-3.5-flash; dropped the
//     gemini-3-flash-preview offering.
//   - OpenAI: flagship gpt-5.4 → gpt-5.5 (GA 2026-04-23); mini/nano stay 5.4.
//   - Anthropic: flagship opus 4.6 → 4.8 (current); Sonnet 4.6 / Haiku 4.5 hold.
// The main-process tier fallback (services/aiOrchestration.ts) is kept a subset
// of these ids. settings.ts read-time-migrates the dead flash-lite-preview id.
// Live answer-quality testing per provider is a separate device step (needs keys).
export const AI_PROVIDER_META: Record<AIProviderMode, AIProviderMeta> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    shortLabel: 'Claude',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-…',
    helperText: 'Use your Claude API key.',
    defaultModel: 'claude-opus-4-8',
    models: [
      {
        id: 'claude-opus-4-8',
        label: 'Claude Opus 4.8',
        description: 'Latest flagship for the hardest coding and reasoning work.',
      },
      {
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        description: 'Balanced Claude for speed plus high quality.',
      },
      {
        id: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        description: 'Fastest current Claude option for lighter workloads.',
      },
    ],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    docsUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-…',
    helperText: 'Use your OpenAI API key.',
    defaultModel: 'gpt-5.5',
    models: [
      {
        id: 'gpt-5.5',
        label: 'GPT-5.5',
        description: 'Latest flagship for complex reasoning, coding, and agentic work.',
      },
      {
        id: 'gpt-5.4-mini',
        label: 'GPT-5.4 mini',
        description: 'Strong mini model for coding and faster high-volume use.',
      },
      {
        id: 'gpt-5.4-nano',
        label: 'GPT-5.4 nano',
        description: 'Cheapest GPT-5.4-class model for simple fast requests.',
      },
    ],
  },
  google: {
    id: 'google',
    label: 'Google AI Studio',
    shortLabel: 'Gemini',
    docsUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza…',
    helperText: 'Use your Gemini Developer API key from AI Studio.',
    defaultModel: 'gemini-3.1-flash-lite',
    models: [
      {
        id: 'gemini-3.1-flash-lite',
        label: 'Gemini 3.1 Flash-Lite',
        description: 'Fastest, lowest-cost Gemini with the highest rate limits. The safest Daylens default.',
      },
      {
        id: 'gemini-3.5-flash',
        label: 'Gemini 3.5 Flash',
        description: 'Latest GA Gemini — most intelligent for agentic and coding work.',
      },
      {
        id: 'gemini-3.1-pro-preview',
        label: 'Gemini 3.1 Pro (Preview)',
        description: 'Advanced Gemini for the deepest reasoning. Preview — higher cost, lower limits.',
      },
    ],
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    shortLabel: 'OpenRouter',
    docsUrl: 'https://openrouter.ai/settings/keys',
    keyPlaceholder: 'sk-or-...',
    helperText: 'Use your OpenRouter API key.',
    defaultModel: 'anthropic/claude-sonnet-4.6',
    models: [
      {
        id: 'anthropic/claude-sonnet-4.6',
        label: 'Claude Sonnet 4.6',
        description: 'Balanced OpenRouter option for high-quality Daylens work.',
      },
      {
        id: 'openai/gpt-5.4-mini',
        label: 'GPT-5.4 mini',
        description: 'Faster OpenRouter option for lighter Daylens jobs.',
      },
    ],
  },
  'claude-cli': {
    id: 'claude-cli',
    label: 'Claude CLI',
    shortLabel: 'Claude CLI',
    docsUrl: 'https://docs.anthropic.com',
    keyPlaceholder: '',
    helperText: 'Uses the locally installed Claude CLI instead of an API key.',
    defaultModel: 'claude-opus-4-8',
    models: [
      {
        id: 'claude-opus-4-8',
        label: 'Claude Opus 4.8',
        description: 'Uses your local Claude CLI install and Anthropic account.',
      },
      {
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        description: 'Balanced local Claude CLI option.',
      },
    ],
  },
  'codex-cli': {
    id: 'codex-cli',
    label: 'Codex CLI',
    shortLabel: 'Codex CLI',
    docsUrl: 'https://platform.openai.com/docs',
    keyPlaceholder: '',
    helperText: 'Uses the locally installed Codex CLI instead of an API key.',
    defaultModel: 'gpt-5.5',
    models: [
      {
        id: 'gpt-5.5',
        label: 'GPT-5.5',
        description: 'Uses your local Codex CLI install and OpenAI account.',
      },
      {
        id: 'gpt-5.4-mini',
        label: 'GPT-5.4 mini',
        description: 'Faster local Codex CLI option.',
      },
    ],
  },
}

export const AI_PROVIDERS: AIProvider[] = ['anthropic', 'openai', 'google', 'openrouter']

export function detectProviderFromApiKey(key: string): AIProvider | null {
  const trimmed = key.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('sk-ant-')) return 'anthropic'
  if (trimmed.startsWith('sk-or-')) return 'openrouter'
  if (trimmed.startsWith('AIza')) return 'google'
  if (trimmed.startsWith('sk-')) return 'openai'
  return null
}

export function getSelectedModel(settings: {
  aiProvider: AIProviderMode
  anthropicModel: string
  openaiModel: string
  googleModel: string
  openrouterModel: string
}): string {
  switch (settings.aiProvider) {
    case 'openai':
    case 'codex-cli':
      return settings.openaiModel
    case 'google':
      return settings.googleModel
    case 'openrouter':
      return settings.openrouterModel
    case 'claude-cli':
      return settings.anthropicModel
    case 'anthropic':
    default:
      return settings.anthropicModel
  }
}
