import { randomUUID } from 'node:crypto'
import { finishAIUsageEvent, startAIUsageEvent } from '../db/queries'
import { getDb } from './database'
import { capture } from './analytics'
import { ANALYTICS_EVENT, classifyFailureKind } from '@shared/analytics'
import { getApiKey, getSettings, getSettingsAsync } from './settings'
import { friendlyProviderError as friendlyProviderErrorClassified } from './providerErrors'
import type {
  AIInvocationSource,
  AIJobType,
  AIModelStrategy,
  AIProviderMode,
  AISurface,
  AppSettings,
} from '@shared/types'

export interface ResolvedProviderConfig {
  provider: AIProviderMode
  apiKey: string | null
  model: string
}

export interface AIProviderUsage {
  inputTokens?: number | null
  outputTokens?: number | null
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
}

export interface ProviderTextResponse {
  text: string
  usage?: AIProviderUsage | null
}

export interface AITextJobExecutionOptions {
  cachePolicy: 'off' | 'stable_prefix' | 'repeated_payload'
  promptCachingEnabled: boolean
  onDelta?: (delta: string) => void | Promise<void>
  // Output token cap for this job. Defaults to DEFAULT_MAX_OUTPUT_TOKENS when
  // omitted. Long-form jobs (reports, week reviews) override upward; chat
  // answers stay at the default.
  maxOutputTokens?: number
}

// R5 context-32k: the cap is an upper bound, not a target — the model still
// stops when the answer is done, and per-job timeouts bound any runaway. Every
// model in the tier table (Haiku 4.5, Sonnet 4.6, plus the Opus override)
// supports >=32k output, so the surfaces that were clipping rich summaries no
// longer truncate. Short jobs (block labels, follow-up chips) naturally emit a
// handful of tokens regardless of this ceiling.
export const DEFAULT_MAX_OUTPUT_TOKENS = 32000
export const LONG_FORM_MAX_OUTPUT_TOKENS = 32000

interface AIJobDefinition {
  jobType: AIJobType
  screen: AISurface
  foreground: boolean
  timeoutMs: number
  providerPreferenceKey: 'aiChatProvider' | 'aiBlockNamingProvider' | 'aiSummaryProvider' | 'aiArtifactProvider'
  cachePolicy: 'off' | 'stable_prefix' | 'repeated_payload'
  modelStrategy: Extract<AIModelStrategy, 'balanced' | 'quality' | 'economy'>
  // Hard-pin a specific model for this job regardless of tier defaults.
  // Use sparingly — only for jobs that genuinely need a specific capability
  // (e.g., report_generation needs Opus for structured agentic output).
  providerModelOverride?: Partial<Record<AIProviderMode, string>>
  // Override the default output token cap for this job. Defaults to
  // DEFAULT_MAX_OUTPUT_TOKENS when omitted.
  maxOutputTokens?: number
}

const JOB_DEFINITIONS: Record<AIJobType, AIJobDefinition> = {
  block_label_preview: {
    jobType: 'block_label_preview',
    screen: 'timeline_day',
    foreground: false,
    timeoutMs: 8_000,
    providerPreferenceKey: 'aiBlockNamingProvider',
    cachePolicy: 'off',
    modelStrategy: 'economy',
  },
  block_label_finalize: {
    jobType: 'block_label_finalize',
    screen: 'timeline_day',
    foreground: false,
    timeoutMs: 12_000,
    providerPreferenceKey: 'aiBlockNamingProvider',
    cachePolicy: 'stable_prefix',
    modelStrategy: 'economy',
  },
  block_cleanup_relabel: {
    jobType: 'block_cleanup_relabel',
    screen: 'background',
    foreground: false,
    timeoutMs: 15_000,
    providerPreferenceKey: 'aiBlockNamingProvider',
    cachePolicy: 'stable_prefix',
    modelStrategy: 'balanced',
  },
  day_summary: {
    jobType: 'day_summary',
    screen: 'timeline_day',
    foreground: true,
    timeoutMs: 15_000,
    providerPreferenceKey: 'aiSummaryProvider',
    cachePolicy: 'repeated_payload',
    modelStrategy: 'balanced',
  },
  week_review: {
    jobType: 'week_review',
    screen: 'timeline_week',
    foreground: true,
    timeoutMs: 18_000,
    providerPreferenceKey: 'aiSummaryProvider',
    cachePolicy: 'repeated_payload',
    modelStrategy: 'balanced',
    // Week review prose spans multiple days; give it the full 32k budget.
    maxOutputTokens: 32000,
  },
  app_narrative: {
    jobType: 'app_narrative',
    screen: 'app_detail',
    foreground: true,
    timeoutMs: 15_000,
    providerPreferenceKey: 'aiSummaryProvider',
    cachePolicy: 'repeated_payload',
    modelStrategy: 'balanced',
    maxOutputTokens: 32000,
  },
  chat_answer: {
    jobType: 'chat_answer',
    screen: 'ai_chat',
    foreground: true,
    timeoutMs: 30_000,
    providerPreferenceKey: 'aiChatProvider',
    cachePolicy: 'stable_prefix',
    modelStrategy: 'quality',
  },
  chat_followup_suggestions: {
    jobType: 'chat_followup_suggestions',
    screen: 'ai_chat',
    foreground: true,
    timeoutMs: 8_000,
    providerPreferenceKey: 'aiChatProvider',
    cachePolicy: 'repeated_payload',
    modelStrategy: 'economy',
  },
  report_generation: {
    jobType: 'report_generation',
    screen: 'ai_chat',
    foreground: true,
    timeoutMs: 60_000,
    providerPreferenceKey: 'aiArtifactProvider',
    cachePolicy: 'repeated_payload',
    modelStrategy: 'quality',
    // Report generation is the one job that genuinely warrants Opus — it produces
    // long-form structured output (tables, charts, formatted exports) in an agentic
    // multi-step pattern where the extra capability pays for itself.
    providerModelOverride: {
      anthropic: 'claude-opus-4-6',
      'claude-cli': 'claude-opus-4-6',
    },
    maxOutputTokens: LONG_FORM_MAX_OUTPUT_TOKENS,
  },
  attribution_assist: {
    jobType: 'attribution_assist',
    screen: 'background',
    foreground: false,
    timeoutMs: 15_000,
    providerPreferenceKey: 'aiSummaryProvider',
    cachePolicy: 'stable_prefix',
    modelStrategy: 'balanced',
  },
  wrapped_narrative: {
    jobType: 'wrapped_narrative',
    screen: 'timeline_day',
    foreground: true,
    timeoutMs: 12_000,
    providerPreferenceKey: 'aiSummaryProvider',
    cachePolicy: 'repeated_payload',
    modelStrategy: 'balanced',
  },
  // Weekly/monthly Wrapped narration. Mirrors wrapped_narrative but targets the
  // period aggregate (see services/wrappedPeriodNarrative.ts). Same provider
  // routing and tier as the daily variant — the payload is slightly larger
  // (per-day buckets) but prose quality expectations are identical.
  wrapped_period_narrative: {
    jobType: 'wrapped_period_narrative',
    screen: 'timeline_week',
    foreground: true,
    timeoutMs: 14_000,
    providerPreferenceKey: 'aiSummaryProvider',
    cachePolicy: 'repeated_payload',
    modelStrategy: 'balanced',
  },
}

function providerUsesCLI(provider: AIProviderMode): provider is 'claude-cli' | 'codex-cli' {
  return provider === 'claude-cli' || provider === 'codex-cli'
}

// Model tier table — what runs at each cost level per provider.
//
// Tier intent:
//   economy  — background, high-volume, latency-tolerant jobs (block labeling, previews)
//   balanced — foreground summaries that need coherent prose but not frontier reasoning
//   quality  — interactive chat and complex queries where reasoning depth matters
//
// Opus is NOT in this table. It is only reached via providerModelOverride on specific
// jobs (currently: report_generation) where structured agentic output justifies the cost.
//
// M1 — models reviewed: 2026-05-31. This table is a LAST-RESORT fallback: under
// BYOK the user's chosen model (settings.<provider>Model) always wins
// (see modelForProvider). The ids here must therefore stay a subset of what the
// Settings catalog (src/renderer/lib/aiProvider.ts AI_PROVIDER_META) offers, so
// the fallback can never resolve to a model the UI doesn't list. (Previously the
// Google fallback pointed at gemini-2.0-flash-lite / gemini-3.1-flash, neither of
// which is offered — fixed.) A live-key GA-catalog refresh (e.g. Gemini 3.5)
// still needs verification against each provider before changing the offered ids.
const ANTHROPIC_TIER_MODELS: Record<'economy' | 'balanced' | 'quality', string> = {
  economy: 'claude-haiku-4-5-20251001',   // Fast and cheap — block labels, previews
  balanced: 'claude-haiku-4-5-20251001',  // Summaries are fine with Haiku
  quality: 'claude-sonnet-4-6',           // Chat answers, attribution reasoning
}
const OPENAI_TIER_MODELS: Record<'economy' | 'balanced' | 'quality', string> = {
  economy: 'gpt-5.4-mini',
  balanced: 'gpt-5.4-mini',
  quality: 'gpt-5.4',
}
const GOOGLE_TIER_MODELS: Record<'economy' | 'balanced' | 'quality', string> = {
  economy: 'gemini-3.1-flash-lite-preview',   // Cheapest/highest-RPM offered — keeps R1 budget low
  balanced: 'gemini-3.1-flash-lite-preview',
  quality: 'gemini-3-flash-preview',
}

export function modelForProvider(
  provider: AIProviderMode,
  strategyOrSettings: AIModelStrategy | AppSettings = getSettings(),
  settings = getSettings(),
): string {
  // Simplified BYOK model: the one model the user picked for a provider is used
  // for every job. The legacy strategy argument is still accepted for call-site
  // compatibility, but it no longer changes the result — the user's chosen model
  // always wins. The per-tier tables remain only as last-resort defaults.
  const resolvedSettings: AppSettings =
    typeof strategyOrSettings === 'string' ? settings : strategyOrSettings

  switch (provider) {
    case 'openai':
    case 'codex-cli':
      return resolvedSettings.openaiModel || OPENAI_TIER_MODELS.quality
    case 'google':
      return resolvedSettings.googleModel || GOOGLE_TIER_MODELS.quality
    case 'openrouter':
      return resolvedSettings.openrouterModel || 'anthropic/claude-sonnet-4.6'
    case 'claude-cli':
    case 'anthropic':
    default:
      return resolvedSettings.anthropicModel || ANTHROPIC_TIER_MODELS.quality
  }
}

export function providerLabel(provider: AIProviderMode): string {
  switch (provider) {
    case 'openai':
      return 'OpenAI'
    case 'google':
      return 'Google Gemini'
    case 'openrouter':
      return 'OpenRouter'
    case 'claude-cli':
      return 'Claude CLI'
    case 'codex-cli':
      return 'Codex CLI'
    case 'anthropic':
    default:
      return 'Anthropic Claude'
  }
}

// BYOK routing (R2): each job resolves to the provider its definition declares
// via `providerPreferenceKey` — for chat that is `aiChatProvider`, which is
// exactly what the chat UI shows — falling back to the global `aiProvider`.
// This closes the latent seam where orchestration always ran on `aiProvider`
// while the chat surface displayed `aiChatProvider ?? aiProvider`. Still no
// cross-provider fallback (see applyStrategyProviderFallback): we never
// silently route to a provider the user did not choose.
function preferredProviderForJob(jobType: AIJobType, settings: AppSettings): AIProviderMode {
  const preferenceKey = JOB_DEFINITIONS[jobType].providerPreferenceKey
  return settings[preferenceKey] ?? settings.aiProvider ?? 'anthropic'
}

function applyStrategyProviderFallback(preferred: AIProviderMode): AIProviderMode[] {
  return [preferred]
}

function isQuotaOrAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const maybeError = error as { status?: number; code?: string; type?: string; message?: string; error?: { code?: string | number; status?: string; type?: string } }
  return maybeError.status === 401
    || maybeError.status === 403
    || maybeError.status === 429
    || maybeError.status === 400
    || maybeError.code === 'insufficient_quota'
    || maybeError.type === 'insufficient_quota'
    || maybeError.error?.code === 'insufficient_quota'
    || maybeError.error?.code === 429
    || maybeError.error?.status === 'RESOURCE_EXHAUSTED'
    || maybeError.error?.type === 'credit_balance_too_low'
    || (typeof maybeError.message === 'string' && maybeError.message.toLowerCase().includes('credit balance'))
}

// Delegate to the shared classifier (R4 + R2) so every AI surface — chat,
// timeline re-analyze (T1), regenerate label (T2), reports — distinguishes a
// transient per-minute 429 from a hard quota/credit/auth wall, with branded
// copy and a structured code the renderer can act on.
function friendlyProviderError(error: unknown, label: string): Error {
  return friendlyProviderErrorClassified(error, label)
}

export function promptCachingPolicyForJob(jobType: AIJobType): AIJobDefinition['cachePolicy'] {
  return JOB_DEFINITIONS[jobType].cachePolicy
}

function redactAIText(input: string, settings: AppSettings): string {
  let output = input
  if (settings.aiRedactEmails) {
    output = output.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
  }
  if (settings.aiRedactFilePaths) {
    output = output
      .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, '[redacted-path]')
      .replace(/(?:^|[\s(])\/(?:Users|home|tmp|var|private|mnt)\/[^\s)]+/g, (match) => match[0] === '/' ? '[redacted-path]' : `${match[0]}[redacted-path]`)
  }
  return output
}

async function resolveProviderConfigsForJob(
  jobType: AIJobType,
  settings: AppSettings,
  preferredProviderOverride?: AIProviderMode | null,
): Promise<ResolvedProviderConfig[]> {
  const preferredProvider = preferredProviderOverride ?? preferredProviderForJob(jobType, settings)
  const orderedProviders = applyStrategyProviderFallback(preferredProvider)
  const definition = JOB_DEFINITIONS[jobType]
  const configs: ResolvedProviderConfig[] = []

  for (const provider of orderedProviders) {
    const apiKey = await getApiKey(provider)
    if (!providerUsesCLI(provider) && !apiKey) continue

    configs.push({
      provider,
      apiKey,
      model: definition.providerModelOverride?.[provider]
        ?? modelForProvider(provider, definition.modelStrategy, settings),
    })
  }

  if (configs.length === 0) {
    throw new Error('No AI provider is configured for this job. Check AI Settings.')
  }

  return configs
}

export async function executeTextAIJob(
  payload: {
    jobType: AIJobType
    screen?: AISurface
    triggerSource: AIInvocationSource
    systemPrompt: string
    userMessage: string
    prior?: Array<{ role: 'user' | 'assistant'; content: string }>
    preferredProviderOverride?: AIProviderMode | null
  },
  runner: (
    config: ResolvedProviderConfig,
    systemPrompt: string,
    prior: Array<{ role: 'user' | 'assistant'; content: string }>,
    userMessage: string,
    options: AITextJobExecutionOptions,
  ) => Promise<ProviderTextResponse>,
  streamOptions?: {
    onDelta?: (delta: string) => void | Promise<void>
  },
): Promise<{ text: string; config: ResolvedProviderConfig; usage: AIProviderUsage | null; cachePolicy: AIJobDefinition['cachePolicy'] }> {
  const settings = await getSettingsAsync()
  const definition = JOB_DEFINITIONS[payload.jobType]
  const executionOptions: AITextJobExecutionOptions = {
    cachePolicy: definition.cachePolicy,
    promptCachingEnabled: settings.aiPromptCachingEnabled ?? true,
    onDelta: streamOptions?.onDelta,
    maxOutputTokens: definition.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  }
  const eventId = randomUUID()
  const startedAt = Date.now()
  const prior = payload.prior ?? []
  const systemPrompt = redactAIText(payload.systemPrompt, settings)
  const userMessage = redactAIText(payload.userMessage, settings)
  const sanitizedPrior = prior.map((message) => ({
    role: message.role,
    content: redactAIText(message.content, settings),
  }))

  const configs = await resolveProviderConfigsForJob(payload.jobType, settings, payload.preferredProviderOverride)

  startAIUsageEvent(getDb(), {
    id: eventId,
    jobType: payload.jobType,
    screen: payload.screen ?? definition.screen,
    triggerSource: payload.triggerSource,
    provider: configs[0]?.provider ?? null,
    model: configs[0]?.model ?? null,
    startedAt,
  })

  let lastError: unknown = null
  let lastConfig: ResolvedProviderConfig | null = null

  for (const config of configs) {
    try {
      const response = await runner(config, systemPrompt, sanitizedPrior, userMessage, executionOptions)
      const completedAt = Date.now()
      const usage = response.usage ?? null
      const cacheHit = Boolean((usage?.cacheReadTokens ?? 0) > 0)

      finishAIUsageEvent(getDb(), {
        id: eventId,
        provider: config.provider,
        model: config.model,
        success: true,
        completedAt,
        latencyMs: completedAt - startedAt,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        cacheReadTokens: usage?.cacheReadTokens ?? null,
        cacheWriteTokens: usage?.cacheWriteTokens ?? null,
        cacheHit,
      })
      capture(ANALYTICS_EVENT.AI_JOB_COMPLETED, {
        job_type: payload.jobType,
        screen: payload.screen ?? definition.screen,
        provider: config.provider,
        model: config.model,
        trigger_source: payload.triggerSource,
        latency_ms: completedAt - startedAt,
        input_tokens: usage?.inputTokens ?? null,
        output_tokens: usage?.outputTokens ?? null,
        cache_hit: cacheHit,
        cache_policy: definition.cachePolicy,
      })

      return {
        text: response.text,
        config,
        usage,
        cachePolicy: definition.cachePolicy,
      }
    } catch (error) {
      lastError = error
      lastConfig = config
      if (!isQuotaOrAuthError(error)) {
        break
      }
    }
  }

  const completedAt = Date.now()
  const friendlyError = friendlyProviderError(lastError, providerLabel(lastConfig?.provider ?? configs[0]?.provider ?? 'anthropic'))

  finishAIUsageEvent(getDb(), {
    id: eventId,
    provider: lastConfig?.provider ?? null,
    model: lastConfig?.model ?? null,
    success: false,
    failureReason: friendlyError.message,
    completedAt,
    latencyMs: completedAt - startedAt,
  })
  capture(ANALYTICS_EVENT.AI_JOB_FAILED, {
    failure_kind: classifyFailureKind(lastError),
    job_type: payload.jobType,
    screen: payload.screen ?? definition.screen,
    provider: lastConfig?.provider ?? null,
    model: lastConfig?.model ?? null,
    trigger_source: payload.triggerSource,
    latency_ms: completedAt - startedAt,
    cache_policy: definition.cachePolicy,
  })

  throw friendlyError
}
