// Settings persistence via electron-store
// electron-store is ESM-only in v10 — dynamic import required
import type {
  AIProviderMode,
  AppSettings,
} from '@shared/types'
import { createDefaultOnboardingState, normalizeOnboardingState } from '../lib/onboardingState'
import { ensureSecureStore, getSecureStore } from './secureStore'

// We keep a synchronous in-memory cache after first load
let _store: { get: (k: string, d?: unknown) => unknown; set: (k: string, v: unknown) => void } | null = null

async function getStore() {
  if (!_store) {
    const { default: Store } = await import('electron-store')
    _store = new Store()
  }
  return _store
}

const DEFAULTS: AppSettings = {
  analyticsOptIn: false,
  shareAIFeedbackExamples: false,
  launchOnLogin: true,
  theme: 'system',
  onboardingComplete: false,
  onboardingState: createDefaultOnboardingState(),
  userName: '',
  userGoals: [],
  firstLaunchDate: 0,
  feedbackPromptShown: false,
  aiProvider: 'anthropic',
  anthropicModel: 'claude-sonnet-4-6',
  openaiModel: 'gpt-5.4',
  googleModel: 'gemini-3.1-flash-lite-preview',
  openrouterModel: 'anthropic/claude-sonnet-4.6',
  aiFallbackOrder: ['anthropic', 'openai', 'google'],
  aiModelStrategy: 'balanced',
  aiChatProvider: 'anthropic',
  aiBlockNamingProvider: 'google',
  aiSummaryProvider: 'anthropic',
  aiArtifactProvider: 'openai',
  aiBackgroundEnrichment: true,
  aiActiveBlockPreview: false,
  aiPromptCachingEnabled: true,
  aiSpendSoftLimitUsd: 10,
  aiRedactFilePaths: false,
  aiRedactEmails: false,
  allowThirdPartyWebsiteIconFallback: false,
  aiReportPersonalizationEnabled: false,
  dailySummaryEnabled: true,
  morningNudgeEnabled: true,
  distractionAlertThresholdMinutes: 10,
  distractionAlertsEnabled: false,
  mcpServerEnabled: false,
  workMemoryConsolidationEnabled: true,
  useRemoteAI: false,
}

export function getSettings(): AppSettings {
  if (!_store) {
    // Synchronous fallback before async init — return defaults
    return { ...DEFAULTS }
  }
  const onboardingComplete = (_store.get('onboardingComplete', false) as boolean)
  const onboardingState = normalizeOnboardingState(_store.get('onboardingState', null), onboardingComplete)
  return {
    analyticsOptIn: (_store.get('analyticsOptIn', false) as boolean),
    shareAIFeedbackExamples: (_store.get('shareAIFeedbackExamples', false) as boolean),
    launchOnLogin: (_store.get('launchOnLogin', true) as boolean),
    theme: (_store.get('theme', 'system') as AppSettings['theme']),
    onboardingComplete,
    onboardingState,
    userName: (_store.get('userName', '') as string),
    userGoals: (_store.get('userGoals', []) as string[]),
    firstLaunchDate: (_store.get('firstLaunchDate', 0) as number),
    feedbackPromptShown: (_store.get('feedbackPromptShown', false) as boolean),
    aiProvider: (_store.get('aiProvider', 'anthropic') as AIProviderMode),
    anthropicModel: (_store.get('anthropicModel', 'claude-sonnet-4-6') as string),
    openaiModel: (_store.get('openaiModel', 'gpt-5.4') as string),
    googleModel: (_store.get('googleModel', 'gemini-3.1-flash-lite-preview') as string),
    openrouterModel: (_store.get('openrouterModel', 'anthropic/claude-sonnet-4.6') as string),
    aiFallbackOrder: (_store.get('aiFallbackOrder', ['anthropic', 'openai', 'google']) as AppSettings['aiFallbackOrder']),
    aiModelStrategy: (_store.get('aiModelStrategy', 'balanced') as AppSettings['aiModelStrategy']),
    aiChatProvider: (_store.get('aiChatProvider', 'anthropic') as AppSettings['aiChatProvider']),
    aiBlockNamingProvider: (_store.get('aiBlockNamingProvider', 'google') as AppSettings['aiBlockNamingProvider']),
    aiSummaryProvider: (_store.get('aiSummaryProvider', 'anthropic') as AppSettings['aiSummaryProvider']),
    aiArtifactProvider: (_store.get('aiArtifactProvider', 'openai') as AppSettings['aiArtifactProvider']),
    aiBackgroundEnrichment: (_store.get('aiBackgroundEnrichment', true) as boolean),
    aiActiveBlockPreview: (_store.get('aiActiveBlockPreview', false) as boolean),
    aiPromptCachingEnabled: (_store.get('aiPromptCachingEnabled', true) as boolean),
    aiSpendSoftLimitUsd: (_store.get('aiSpendSoftLimitUsd', 10) as number),
    aiRedactFilePaths: (_store.get('aiRedactFilePaths', false) as boolean),
    aiRedactEmails: (_store.get('aiRedactEmails', false) as boolean),
    allowThirdPartyWebsiteIconFallback: (_store.get('allowThirdPartyWebsiteIconFallback', false) as boolean),
    aiReportPersonalizationEnabled: (_store.get('aiReportPersonalizationEnabled', false) as boolean),
    dailySummaryEnabled: (_store.get('dailySummaryEnabled', true) as boolean),
    morningNudgeEnabled: (_store.get('morningNudgeEnabled', true) as boolean),
    distractionAlertThresholdMinutes: (_store.get('distractionAlertThresholdMinutes', 10) as number),
    distractionAlertsEnabled: (_store.get('distractionAlertsEnabled', false) as boolean),
    mcpServerEnabled: (_store.get('mcpServerEnabled', false) as boolean),
    workMemoryConsolidationEnabled: (_store.get('workMemoryConsolidationEnabled', true) as boolean),
    useRemoteAI: (_store.get('useRemoteAI', false) as boolean),
  }
}

export async function getSettingsAsync(): Promise<AppSettings> {
  await getStore()
  return getSettings()
}

export async function setSettings(partial: Partial<AppSettings>): Promise<void> {
  const store = await getStore()
  const entries = { ...partial }
  if ('userName' in entries) {
    entries.userName = String(entries.userName ?? '').trim().slice(0, 80)
  }
  if (entries.onboardingState) {
    entries.onboardingState = normalizeOnboardingState(entries.onboardingState, entries.onboardingState.stage === 'complete')
    if (!('onboardingComplete' in entries)) {
      entries.onboardingComplete = entries.onboardingState.stage === 'complete'
    }
  }
  for (const [k, v] of Object.entries(entries)) {
    store.set(k, v)
  }
}

export async function initSettings(): Promise<void> {
  await getStore()
}

// ─── AI provider API keys — stored in OS credential vault, never in plain-text ─

const KEYTAR_SERVICE = 'Daylens Desktop'
const LEGACY_KEYTAR_SERVICES = ['Daylens', 'DaylensWindows']
const KEYTAR_ACCOUNTS: Record<'anthropic' | 'openai' | 'google' | 'openrouter', string> = {
  anthropic: 'anthropic-api-key',
  openai: 'openai-api-key',
  google: 'google-api-key',
  openrouter: 'openrouter-api-key',
}

function keytarAccount(provider: AIProviderMode): string {
  if (provider === 'claude-cli' || provider === 'codex-cli') {
    throw new Error(`Provider ${provider} does not use stored API keys`)
  }
  return KEYTAR_ACCOUNTS[provider]
}

async function readKeyWithMigration(account: string): Promise<string | null> {
  const keytar = getSecureStore()
  if (!keytar) return null
  const current = await keytar.getPassword(KEYTAR_SERVICE, account)
  if (current) return current

  for (const service of LEGACY_KEYTAR_SERVICES) {
    const legacy = await keytar.getPassword(service, account)
    if (!legacy) continue
    try {
      await keytar.setPassword(KEYTAR_SERVICE, account, legacy)
    } catch {
      // Best effort migration; returning the legacy key is still better than failing closed.
    }
    return legacy
  }

  return null
}

// Opt-in env override for headless / CI / eval runs: DAYLENS_ANTHROPIC_API_KEY,
// DAYLENS_OPENAI_API_KEY, DAYLENS_GOOGLE_API_KEY. Dedicated names so they never
// collide with the SDK-standard ANTHROPIC_API_KEY etc. that a shell may already
// export. Takes precedence over keytar when set; otherwise keytar is used.
function envApiKeyOverride(provider: AIProviderMode): string | null {
  if (provider === 'claude-cli' || provider === 'codex-cli') return null
  const value = process.env[`DAYLENS_${provider.toUpperCase()}_API_KEY`]
  return value && value.trim() ? value.trim() : null
}

function assertApiKeyWritable(provider: AIProviderMode, action: string): void {
  if (!envApiKeyOverride(provider)) return
  throw new Error(
    `${action} is disabled because DAYLENS_${provider.toUpperCase()}_API_KEY is set for this process.`,
  )
}

export async function hasApiKey(provider: AIProviderMode): Promise<boolean> {
  if (provider === 'claude-cli' || provider === 'codex-cli') return true
  if (envApiKeyOverride(provider)) return true
  try {
    const key = await readKeyWithMigration(keytarAccount(provider))
    return !!key
  } catch (err) {
    console.error(`[settings] hasApiKey failed for ${provider}:`, err)
    return false
  }
}

export async function getApiKey(provider: AIProviderMode): Promise<string | null> {
  if (provider === 'claude-cli' || provider === 'codex-cli') return null
  const override = envApiKeyOverride(provider)
  if (override) return override
  try {
    return await readKeyWithMigration(keytarAccount(provider))
  } catch {
    return null
  }
}

export async function setApiKey(provider: AIProviderMode, key: string): Promise<void> {
  if (provider === 'claude-cli' || provider === 'codex-cli') return
  assertApiKeyWritable(provider, `Saving the ${provider} API key`)
  try {
    const keytar = ensureSecureStore(`Saving the ${provider} API key`)
    await keytar.setPassword(KEYTAR_SERVICE, keytarAccount(provider), key)
  } catch (err) {
    console.error(`[settings] setApiKey failed for ${provider}:`, err)
    throw err
  }
}

export async function clearApiKey(provider: AIProviderMode): Promise<void> {
  if (provider === 'claude-cli' || provider === 'codex-cli') return
  assertApiKeyWritable(provider, `Clearing the ${provider} API key`)
  try {
    const keytar = getSecureStore()
    if (!keytar) return
    const account = keytarAccount(provider)
    await Promise.all([
      keytar.deletePassword(KEYTAR_SERVICE, account),
      ...LEGACY_KEYTAR_SERVICES.map((service) => keytar.deletePassword(service, account)),
    ])
  } catch {
    // Key may not exist — ignore
  }
}

export async function hasAnthropicApiKey(): Promise<boolean> {
  return hasApiKey('anthropic')
}

export async function getAnthropicApiKey(): Promise<string | null> {
  return getApiKey('anthropic')
}

export async function setAnthropicApiKey(key: string): Promise<void> {
  await setApiKey('anthropic', key)
}

export async function clearAnthropicApiKey(): Promise<void> {
  await clearApiKey('anthropic')
}
