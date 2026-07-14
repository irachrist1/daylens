export interface BenchModelSelection {
  provider: 'anthropic'
  model: string
  label: string
}

const MODELS: Record<string, BenchModelSelection> = {
  haiku: { provider: 'anthropic', model: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  'haiku-4.5': { provider: 'anthropic', model: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  sonnet: { provider: 'anthropic', model: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  'sonnet-5': { provider: 'anthropic', model: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  opus: { provider: 'anthropic', model: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  'opus-4.8': { provider: 'anthropic', model: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
}

export function resolveBenchModel(value: string | null): BenchModelSelection | null {
  if (!value || value === 'current') return null
  const normalized = value.trim().toLowerCase()
  const known = MODELS[normalized]
  if (known) return known
  if (/^claude-[a-z0-9-]+$/.test(normalized)) {
    return { provider: 'anthropic', model: normalized, label: normalized }
  }
  throw new Error(`Unknown bench model "${value}". Use current, haiku, sonnet, opus, or an exact Claude model id.`)
}
