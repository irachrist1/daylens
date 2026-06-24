import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type {
  AnthropicApiKeySummary,
  BillingAccessSnapshot,
  BillingProviderReportStatus,
  BillingUsageCostSource,
  BillingUsageHourlyPoint,
  BillingUsageJobSummary,
  BillingUsagePoint,
  BillingUsageReport,
  BillingUsageRow,
  BillingUsageType,
} from '@shared/types'
import { getDb } from './database'
import { estimateUsageCostUsd } from './modelPricing'
import { getSecureStore } from './secureStore'
import { getApiKey, getSettingsAsync, hasApiKey, setSettings } from './settings'

declare const __DAYLENS_BILLING_API_URL__: string

const BILLING_SERVICE = 'Daylens Billing'
const BILLING_TOKEN_ACCOUNT = 'installation-session'
const PROVIDER_REPORT_SERVICE = 'Daylens Provider Reports'
const ANTHROPIC_ADMIN_ACCOUNT = 'anthropic-admin-api-key'
const REQUEST_TIMEOUT_MS = 15_000
const MANAGED_STATE_TTL_MS = 30_000
const USAGE_REPORT_CACHE_TTL_MS = 60_000
const ANTHROPIC_ADMIN_CACHE_TTL_MS = 5 * 60_000
const ANTHROPIC_ADMIN_API_URL = 'https://api.anthropic.com/v1/organizations'

interface RawUsageEvent {
  id: string
  job_type: string
  screen: string | null
  trigger_source: string | null
  provider: string | null
  model: string | null
  success: number
  started_at: number
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
  cost_usd: number | null
  billing_mode: string | null
}

type JobSummaryKey = string

let cachedAccess: { value: BillingAccessSnapshot; at: number } | null = null
let lastAnthropicReportSyncAt: number | null = null
const usageReportCache = new Map<string, { value: BillingUsageReport; at: number }>()
const anthropicAdminCache = new Map<string, { value: BillingUsageReport; at: number }>()

export interface ManagedAIConfig {
  accessToken: string
  baseUrl: string
  provider: 'anthropic' | 'openai' | 'google' | 'openrouter'
  model: string
  mode: 'free_credit' | 'subscription' | 'local_pass'
}

function apiUrl(): string {
  return (__DAYLENS_BILLING_API_URL__ || '').trim().replace(/\/+$/, '')
}

function unavailableSnapshot(message = 'Managed AI is unavailable in this build. You can still use your own provider key.'): BillingAccessSnapshot {
  return {
    mode: 'unavailable',
    canUseAI: false,
    managed: false,
    creditGrantedUsd: 5,
    creditRemainingUsd: 0,
    periodSpendUsd: 0,
    paidSpendUsd: 0,
    renewalAt: null,
    localPassExpiresAt: null,
    fairUseRemainingUsd: null,
    subscriptionStatus: null,
    providerLabel: null,
    checkoutAvailable: false,
    localCheckoutAvailable: false,
    portalAvailable: false,
    message,
  }
}

async function installationId(): Promise<string> {
  const settings = await getSettingsAsync()
  if (settings.billingInstallationId?.trim()) return settings.billingInstallationId.trim()
  const id = randomUUID()
  await setSettings({ billingInstallationId: id })
  return id
}

async function readToken(): Promise<string | null> {
  try {
    return await getSecureStore()?.getPassword(BILLING_SERVICE, BILLING_TOKEN_ACCOUNT) ?? null
  } catch {
    return null
  }
}

async function writeToken(token: string): Promise<void> {
  const store = getSecureStore()
  if (!store) throw new Error('Secure credential storage is required for managed AI.')
  await store.setPassword(BILLING_SERVICE, BILLING_TOKEN_ACCOUNT, token)
}

function envAnthropicAdminKey(): string | null {
  const value = process.env.DAYLENS_ANTHROPIC_ADMIN_KEY || process.env.ANTHROPIC_ADMIN_API_KEY
  return value?.trim() || null
}

function isAnthropicAdminKey(key: string | null | undefined): boolean {
  return Boolean(key?.trim().startsWith('sk-ant-admin'))
}

async function readAnthropicAdminKey(): Promise<string | null> {
  const env = envAnthropicAdminKey()
  if (isAnthropicAdminKey(env)) return env!.trim()
  try {
    const dedicated = await getSecureStore()?.getPassword(PROVIDER_REPORT_SERVICE, ANTHROPIC_ADMIN_ACCOUNT) ?? null
    if (isAnthropicAdminKey(dedicated)) return dedicated!.trim()
  } catch {
    // Key may not exist.
  }
  const providerKey = await getApiKey('anthropic')
  if (isAnthropicAdminKey(providerKey)) return providerKey!.trim()
  return null
}

async function hasDedicatedAnthropicAdminKey(): Promise<boolean> {
  if (envAnthropicAdminKey()) return true
  try {
    const dedicated = await getSecureStore()?.getPassword(PROVIDER_REPORT_SERVICE, ANTHROPIC_ADMIN_ACCOUNT) ?? null
    return isAnthropicAdminKey(dedicated)
  } catch {
    return false
  }
}

export async function setAnthropicAdminKey(key: string): Promise<void> {
  const trimmed = key.trim()
  if (!trimmed.startsWith('sk-ant-admin')) {
    throw new Error('Anthropic usage reports require an Admin API key starting with sk-ant-admin.')
  }
  const store = getSecureStore()
  if (!store) throw new Error('Secure credential storage is required for provider reports.')
  await store.setPassword(PROVIDER_REPORT_SERVICE, ANTHROPIC_ADMIN_ACCOUNT, trimmed)
  lastAnthropicReportSyncAt = null
  usageReportCache.clear()
  anthropicAdminCache.clear()
}

export async function clearAnthropicAdminKey(): Promise<void> {
  if (envAnthropicAdminKey()) {
    throw new Error('The Anthropic Admin key is set by environment variable for this process.')
  }
  if (!(await hasDedicatedAnthropicAdminKey())) {
    throw new Error('Usage is using your Anthropic key from Settings → AI. Change or remove that key there instead.')
  }
  try {
    await getSecureStore()?.deletePassword(PROVIDER_REPORT_SERVICE, ANTHROPIC_ADMIN_ACCOUNT)
  } catch {
    // Key may not exist.
  }
  lastAnthropicReportSyncAt = null
  usageReportCache.clear()
  anthropicAdminCache.clear()
}

export async function getProviderReportStatus(): Promise<BillingProviderReportStatus> {
  const connected = Boolean(await readAnthropicAdminKey())
  const dedicated = await hasDedicatedAnthropicAdminKey()
  const settings = await getSettingsAsync()
  const selectedApiKeyId = settings.anthropicUsageApiKeyId?.trim() || null
  let selectedApiKeyName: string | null = null
  if (connected && selectedApiKeyId) {
    try {
      const keys = await listAnthropicApiKeys()
      selectedApiKeyName = keys.find((key) => key.id === selectedApiKeyId)?.name ?? null
    } catch {
      selectedApiKeyName = null
    }
  }
  const baseMessage = connected
    ? selectedApiKeyName
      ? `Anthropic platform reports are connected for API key “${selectedApiKeyName}”.`
      : 'Anthropic platform reports are connected. Spend comes from platform.claude.com when available.'
    : dedicated
      ? 'Add an Anthropic Admin API key (sk-ant-admin…) from Claude Console → API keys to show real platform spend.'
      : 'Add an Anthropic Admin API key in Usage below, or save an sk-ant-admin… key as your Anthropic provider in Settings → AI.'
  return {
    provider: 'anthropic',
    connected,
    source: connected ? 'anthropic_admin' : 'local_meter',
    message: connected && !dedicated
      ? `${baseMessage} (Using the Admin key already saved under Settings → AI.)`
      : baseMessage,
    lastSyncedAt: lastAnthropicReportSyncAt,
    selectedApiKeyId,
    selectedApiKeyName,
  }
}

export async function listAnthropicApiKeys(): Promise<AnthropicApiKeySummary[]> {
  const apiKey = await readAnthropicAdminKey()
  if (!apiKey) return []
  const keys: AnthropicApiKeySummary[] = []
  let afterId: string | null = null
  for (let index = 0; index < 10; index += 1) {
    const params = new URLSearchParams({ limit: '100', status: 'active' })
    if (afterId) params.set('after_id', afterId)
    const payload = await anthropicAdminRequest('api_keys', params, apiKey)
    const batch = Array.isArray(payload.data) ? payload.data.map(asRecord) : []
    for (const row of batch) {
      keys.push({
        id: String(row.id ?? ''),
        name: String(row.name ?? 'Unnamed key'),
        status: String(row.status ?? 'active'),
        partialKeyHint: typeof row.partial_key_hint === 'string' ? row.partial_key_hint : null,
      })
    }
    if (!payload.has_more || !payload.last_id) break
    afterId = String(payload.last_id)
  }
  return keys.filter((key) => key.id)
}

export async function setAnthropicUsageApiKeyId(apiKeyId: string | null): Promise<BillingProviderReportStatus> {
  await setSettings({ anthropicUsageApiKeyId: apiKeyId?.trim() ?? '' })
  usageReportCache.clear()
  anthropicAdminCache.clear()
  lastAnthropicReportSyncAt = null
  return getProviderReportStatus()
}

async function request<T>(path: string, init: RequestInit = {}, retryBootstrap = true): Promise<T> {
  const base = apiUrl()
  if (!base) throw new Error('Managed AI is not configured for this build.')
  let token = await readToken()
  if (!token && path !== '/v1/installations/bootstrap') token = await bootstrap()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    })
    if (response.status === 401 && retryBootstrap && path !== '/v1/installations/bootstrap') {
      await writeToken(await bootstrap())
      return request<T>(path, init, false)
    }
    const payload = await response.json().catch(() => ({})) as T & { error?: string }
    if (!response.ok) throw new Error(payload.error || `Billing service returned ${response.status}.`)
    return payload
  } finally {
    clearTimeout(timeout)
  }
}

async function bootstrap(): Promise<string> {
  const payload = await request<{ token: string }>('/v1/installations/bootstrap', {
    method: 'POST',
    body: JSON.stringify({
      installationId: await installationId(),
      appVersion: app.getVersion(),
      platform: process.platform,
    }),
  }, false)
  await writeToken(payload.token)
  return payload.token
}

async function selectedOwnKeyProvider(): Promise<string | null> {
  const settings = await getSettingsAsync()
  const provider = settings.aiProvider
  if (provider === 'claude-cli' || provider === 'codex-cli') return provider
  return await hasApiKey(provider) ? provider : null
}

export async function getBillingAccess(options: { force?: boolean } = {}): Promise<BillingAccessSnapshot> {
  const ownKeyProvider = await selectedOwnKeyProvider()
  if (ownKeyProvider) {
    return {
      ...unavailableSnapshot(),
      mode: 'own_key',
      canUseAI: true,
      managed: false,
      providerLabel: ownKeyProvider,
      message: 'Your own key is active. Calls go straight to your provider and do not use Daylens credit.',
    }
  }
  if (!apiUrl()) return unavailableSnapshot()
  if (!options.force && cachedAccess && Date.now() - cachedAccess.at < MANAGED_STATE_TTL_MS) return cachedAccess.value
  try {
    const value = await request<BillingAccessSnapshot>('/v1/billing')
    cachedAccess = { value, at: Date.now() }
    return value
  } catch (error) {
    return unavailableSnapshot(error instanceof Error ? error.message : String(error))
  }
}

export async function getManagedAIConfig(): Promise<ManagedAIConfig | null> {
  if (await selectedOwnKeyProvider() || !apiUrl()) return null
  const access = await getBillingAccess()
  if (!access.canUseAI || !access.managed) return null
  return request<ManagedAIConfig>('/v1/ai/session', { method: 'POST', body: '{}' })
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function billingModeToType(mode: string | null): BillingUsageType {
  if (mode === 'free_credit' || mode === 'subscription' || mode === 'local_pass') return mode
  return 'own_key'
}

function rowTokens(row: Pick<RawUsageEvent, 'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'cache_write_tokens'>): number {
  return (row.input_tokens ?? 0) + (row.output_tokens ?? 0) + (row.cache_read_tokens ?? 0) + (row.cache_write_tokens ?? 0)
}

function resolveRowCost(row: RawUsageEvent): { costUsd: number | null; costSource: BillingUsageCostSource } {
  if (row.cost_usd != null && Number.isFinite(row.cost_usd)) {
    return { costUsd: row.cost_usd, costSource: 'provider' }
  }
  const estimated = estimateUsageCostUsd(
    row.model,
    row.input_tokens,
    row.output_tokens,
    row.cache_read_tokens,
    row.cache_write_tokens,
  )
  if (estimated != null) return { costUsd: estimated, costSource: 'estimated' }
  return { costUsd: null, costSource: 'unknown' }
}

function jobSummaryKey(row: Pick<RawUsageEvent, 'job_type' | 'screen' | 'trigger_source' | 'provider' | 'model'>): JobSummaryKey {
  return [row.job_type, row.screen ?? '', row.trigger_source ?? '', row.provider ?? '', row.model ?? ''].join('\0')
}

export function aggregateUsageFromEvents(
  events: RawUsageEvent[],
  from: number,
  to: number,
  sourceLabel = 'Daylens local meter',
): BillingUsageReport {
  const sorted = [...events].sort((left, right) => right.started_at - left.started_at)
  const displayRows = sorted.slice(0, 2000)

  const normalized: BillingUsageRow[] = displayRows.map((row) => {
    const { costUsd, costSource } = resolveRowCost(row)
    const tokens = rowTokens(row) || null
    return {
      id: row.id,
      occurredAt: row.started_at,
      type: billingModeToType(row.billing_mode),
      feature: row.job_type,
      screen: row.screen,
      triggerSource: row.trigger_source,
      provider: row.provider,
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
      tokens,
      costUsd,
      costSource,
      success: Boolean(row.success),
    }
  })

  const jobMap = new Map<JobSummaryKey, BillingUsageJobSummary>()
  const hourlyMap = new Map<string, BillingUsageHourlyPoint>()
  const modelPointMap = new Map<string, BillingUsagePoint>()
  const featurePointMap = new Map<string, BillingUsagePoint>()

  let totalSpendUsd = 0
  let freeCreditUsedUsd = 0
  let paidSpendUsd = 0
  let totalTokens = 0
  let totalCalls = 0
  let failedCalls = 0
  let backgroundCalls = 0
  let backgroundTokens = 0

  for (const row of sorted) {
    const { costUsd } = resolveRowCost(row)
    const tokens = rowTokens(row)
    const type = billingModeToType(row.billing_mode)
    const spend = costUsd ?? 0
    const day = utcDay(row.started_at)
    const model = row.model ?? 'Unknown model'
    const feature = row.job_type

    totalCalls += 1
    totalTokens += tokens
    totalSpendUsd += spend
    if (type === 'free_credit') freeCreditUsedUsd += spend
    else paidSpendUsd += spend
    if (!row.success) failedCalls += 1
    if (row.trigger_source === 'background' || row.trigger_source === 'system') {
      backgroundCalls += 1
      backgroundTokens += tokens
    }

    const summaryKey = jobSummaryKey(row)
    const existingSummary = jobMap.get(summaryKey) ?? {
      feature,
      screen: row.screen,
      triggerSource: row.trigger_source,
      provider: row.provider,
      model: row.model,
      calls: 0,
      successes: 0,
      failures: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      tokens: 0,
      costUsd: 0,
    }
    existingSummary.calls += 1
    if (row.success) existingSummary.successes += 1
    else existingSummary.failures += 1
    existingSummary.inputTokens += row.input_tokens ?? 0
    existingSummary.outputTokens += row.output_tokens ?? 0
    existingSummary.cacheReadTokens += row.cache_read_tokens ?? 0
    existingSummary.cacheWriteTokens += row.cache_write_tokens ?? 0
    existingSummary.tokens += tokens
    existingSummary.costUsd = (existingSummary.costUsd ?? 0) + spend
    jobMap.set(summaryKey, existingSummary)

    const hour = Math.floor(row.started_at / 3_600_000) * 3_600_000
    const hourKey = `${hour}:${feature}`
    const existingHour = hourlyMap.get(hourKey) ?? {
      hour,
      label: new Date(hour).toISOString(),
      feature,
      calls: 0,
      tokens: 0,
      costUsd: 0,
    }
    existingHour.calls += 1
    existingHour.tokens += tokens
    existingHour.costUsd = (existingHour.costUsd ?? 0) + spend
    hourlyMap.set(hourKey, existingHour)

    const modelKey = `${day}:${model}`
    const modelPoint = modelPointMap.get(modelKey) ?? { day, model, spendUsd: 0, tokens: 0 }
    modelPoint.spendUsd += spend
    modelPoint.tokens += tokens
    modelPointMap.set(modelKey, modelPoint)

    const featureKey = `${day}:${feature}`
    const featurePoint = featurePointMap.get(featureKey) ?? { day, model: feature, feature, spendUsd: 0, tokens: 0 }
    featurePoint.spendUsd += spend
    featurePoint.tokens += tokens
    featurePointMap.set(featureKey, featurePoint)
  }

  const jobSummaries = [...jobMap.values()].sort((left, right) => right.tokens - left.tokens || right.calls - left.calls)
  const hourlyPoints = [...hourlyMap.values()].sort((left, right) => left.hour - right.hour || right.tokens - left.tokens)
  const points = [...modelPointMap.values()].sort((left, right) => left.day.localeCompare(right.day) || left.model.localeCompare(right.model))
  const featurePoints = [...featurePointMap.values()].sort((left, right) => left.day.localeCompare(right.day) || (left.feature ?? '').localeCompare(right.feature ?? ''))

  return {
    from,
    to,
    source: 'local_meter',
    sourceLabel,
    totalSpendUsd,
    totalTokens,
    totalCalls,
    failedCalls,
    backgroundCalls,
    backgroundTokens,
    freeCreditUsedUsd,
    paidSpendUsd,
    points,
    featurePoints,
    rows: normalized,
    jobSummaries,
    hourlyPoints,
  }
}

function localUsage(from: number, to: number, sourceLabel = 'Daylens local meter'): BillingUsageReport {
  const events = getDb().prepare(`
    SELECT id, job_type, screen, trigger_source, provider, model, success, started_at,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, billing_mode
    FROM ai_usage_events
    WHERE started_at >= ? AND started_at < ?
    ORDER BY started_at DESC
    LIMIT 2000
  `).all(from, to) as RawUsageEvent[]
  return aggregateUsageFromEvents(events, from, to, sourceLabel)
}

function toIso(value: number): string {
  return new Date(value).toISOString()
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function cacheCreationTokens(result: Record<string, unknown>): number {
  const cache = result.cache_creation
  if (!cache || typeof cache !== 'object') return 0
  const typed = cache as Record<string, unknown>
  return numberValue(typed.ephemeral_1h_input_tokens) + numberValue(typed.ephemeral_5m_input_tokens)
}

function parseModelFromDescription(description: string | null | undefined): string | null {
  if (!description) return null
  const match = description.match(/Claude\s+(.+?)\s+Usage/i)
  if (!match?.[1]) return null
  return normalizeAnthropicModelName(`claude-${match[1].trim().toLowerCase().replace(/\s+/g, '-')}`)
}

function normalizeAnthropicModelName(model: string): string {
  const raw = model.trim()
  if (!raw) return 'Unknown model'
  if (/^claude\s/i.test(raw)) return raw
  const match = raw.match(/^claude-([a-z]+)-(\d+(?:\.\d+)?)(?:-(\d+))?/i)
  if (!match) return raw
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1)
  const version = match[3] ? `${match[2]}.${match[3]}` : match[2]
  return `Claude ${family} ${version}`
}

function appendAnthropicFilters(params: URLSearchParams, apiKeyId: string | null): void {
  if (apiKeyId) params.append('api_key_ids[]', apiKeyId)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

async function anthropicAdminRequest(endpoint: string, params: URLSearchParams, apiKey: string): Promise<Record<string, unknown>> {
  const url = `${ANTHROPIC_ADMIN_API_URL}/${endpoint}?${params.toString()}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
        'user-agent': `Daylens/${app.getVersion()}`,
      },
    })
    const body = asRecord(await response.json().catch(() => ({})))
    if (!response.ok) {
      const error = body.error
      const errorRecord = asRecord(error)
      const message = typeof errorRecord.message === 'string'
        ? errorRecord.message
        : typeof error === 'string'
          ? error
          : `Anthropic report returned ${response.status}.`
      throw new Error(message)
    }
    return body
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchAllAnthropicAdmin(endpoint: string, baseParams: URLSearchParams, apiKey: string): Promise<Record<string, unknown>[]> {
  const buckets: Record<string, unknown>[] = []
  let page: string | null = null
  for (let index = 0; index < 20; index += 1) {
    const params = new URLSearchParams(baseParams)
    if (page) params.set('page', page)
    const payload = await anthropicAdminRequest(endpoint, params, apiKey)
    if (Array.isArray(payload.data)) buckets.push(...payload.data.map(asRecord))
    if (!payload.has_more || !payload.next_page) break
    page = String(payload.next_page)
  }
  return buckets
}

function applyAnthropicAdminRowCosts(
  rows: BillingUsageRow[],
  points: BillingUsagePoint[],
): BillingUsageRow[] {
  const spendByDayModel = new Map<string, number>()
  const tokensByDayModel = new Map<string, number>()
  for (const point of points) {
    const key = `${point.day}:${point.model}`
    spendByDayModel.set(key, (spendByDayModel.get(key) ?? 0) + point.spendUsd)
    tokensByDayModel.set(key, (tokensByDayModel.get(key) ?? 0) + point.tokens)
  }

  return rows.map((row) => {
    if (row.costSource === 'provider') return row
    const day = utcDay(row.occurredAt)
    const model = row.model ?? 'Unknown model'
    const key = `${day}:${model}`
    const daySpend = spendByDayModel.get(key) ?? 0
    const dayTokens = tokensByDayModel.get(key) ?? 0
    const rowTokens = row.tokens ?? 0
    if (daySpend > 0 && dayTokens > 0 && rowTokens > 0) {
      const allocated = Math.round((daySpend * (rowTokens / dayTokens)) * 1_000_000) / 1_000_000
      return { ...row, costUsd: allocated, costSource: 'anthropic_admin' as const }
    }
    return row
  })
}

async function anthropicAdminUsage(from: number, to: number, local: BillingUsageReport): Promise<BillingUsageReport | null> {
  const apiKey = await readAnthropicAdminKey()
  if (!apiKey) return null

  const settings = await getSettingsAsync()
  const apiKeyId = settings.anthropicUsageApiKeyId?.trim() || null
  const cacheKey = `${from}:${to}:${apiKeyId ?? 'all'}`
  const cached = anthropicAdminCache.get(cacheKey)
  if (cached && Date.now() - cached.at < ANTHROPIC_ADMIN_CACHE_TTL_MS) {
    return cached.value
  }

  const usageParams = new URLSearchParams({
    starting_at: toIso(from),
    ending_at: toIso(to),
    bucket_width: '1d',
    limit: '31',
  })
  usageParams.append('group_by[]', 'model')
  appendAnthropicFilters(usageParams, apiKeyId)

  const costParams = new URLSearchParams({
    starting_at: toIso(from),
    ending_at: toIso(to),
    limit: '31',
  })
  costParams.append('group_by[]', 'description')
  appendAnthropicFilters(costParams, apiKeyId)

  const [usageBuckets, costBuckets] = await Promise.all([
    fetchAllAnthropicAdmin('usage_report/messages', usageParams, apiKey),
    fetchAllAnthropicAdmin('cost_report', costParams, apiKey),
  ])

  const byDayModel = new Map<string, BillingUsagePoint>()
  let totalTokens = 0
  for (const bucket of usageBuckets) {
    const day = String(bucket?.starting_at ?? '').slice(0, 10)
    if (!day) continue
    for (const result of Array.isArray(bucket?.results) ? bucket.results : []) {
      const typed = result as Record<string, unknown>
      const model = normalizeAnthropicModelName(String(typed.model || 'Anthropic'))
      const tokens = numberValue(typed.uncached_input_tokens)
        + numberValue(typed.output_tokens)
        + numberValue(typed.cache_read_input_tokens)
        + cacheCreationTokens(typed)
      totalTokens += tokens
      const key = `${day}:${model}`
      const point = byDayModel.get(key) ?? { day, model, spendUsd: 0, tokens: 0 }
      point.tokens += tokens
      byDayModel.set(key, point)
    }
  }

  let totalSpendUsd = 0
  for (const bucket of costBuckets) {
    const day = String(bucket?.starting_at ?? '').slice(0, 10)
    if (!day) continue
    for (const result of Array.isArray(bucket?.results) ? bucket.results : []) {
      const typed = result as Record<string, unknown>
      if (typed.cost_type && typed.cost_type !== 'tokens') continue
      const amountUsd = numberValue(typed.amount) / 100
      totalSpendUsd += amountUsd
      const model = normalizeAnthropicModelName(
        String(typed.model || parseModelFromDescription(String(typed.description ?? '')) || 'Anthropic'),
      )
      const key = `${day}:${model}`
      const point = byDayModel.get(key) ?? { day, model, spendUsd: 0, tokens: 0 }
      point.spendUsd += amountUsd
      byDayModel.set(key, point)
    }
  }

  lastAnthropicReportSyncAt = Date.now()
  const status = await getProviderReportStatus()
  const points = [...byDayModel.values()].sort((a, b) => a.day.localeCompare(b.day) || a.model.localeCompare(b.model))
  const rows = applyAnthropicAdminRowCosts(local.rows, points)
  const report: BillingUsageReport = {
    ...local,
    source: 'anthropic_admin',
    sourceLabel: 'Anthropic platform report',
    providerReport: status,
    totalSpendUsd,
    paidSpendUsd: totalSpendUsd,
    totalTokens: totalTokens || local.totalTokens,
    points,
    rows,
  }
  anthropicAdminCache.set(cacheKey, { value: report, at: Date.now() })
  return report
}

function mergeRemoteWithLocal(remote: BillingUsageReport, local: BillingUsageReport): BillingUsageReport {
  return {
    ...remote,
    source: remote.source ?? 'daylens_managed',
    sourceLabel: remote.sourceLabel ?? 'Daylens managed AI',
    rows: remote.rows?.length ? remote.rows : local.rows,
    jobSummaries: remote.jobSummaries?.length ? remote.jobSummaries : local.jobSummaries,
    hourlyPoints: remote.hourlyPoints?.length ? remote.hourlyPoints : local.hourlyPoints,
    featurePoints: remote.featurePoints?.length ? remote.featurePoints : local.featurePoints,
    totalCalls: remote.totalCalls ?? local.totalCalls,
    failedCalls: remote.failedCalls ?? local.failedCalls,
    backgroundCalls: remote.backgroundCalls ?? local.backgroundCalls,
    backgroundTokens: remote.backgroundTokens ?? local.backgroundTokens,
  }
}

function usageCacheKey(from: number, to: number): string {
  return `${from}:${to}`
}

async function buildBillingUsage(from: number, to: number): Promise<BillingUsageReport> {
  const local = localUsage(from, to)
  try {
    const providerReport = await anthropicAdminUsage(from, to, local)
    if (providerReport) return providerReport
  } catch (error) {
    const status = await getProviderReportStatus()
    return {
      ...local,
      providerReport: {
        ...status,
        connected: true,
        source: 'local_meter',
        message: error instanceof Error ? error.message : String(error),
        lastSyncedAt: lastAnthropicReportSyncAt,
      },
    }
  }

  const access = await getBillingAccess()
  if (access.mode === 'own_key' || !apiUrl()) return { ...local, providerReport: await getProviderReportStatus() }
  try {
    return mergeRemoteWithLocal(
      await request<BillingUsageReport>(`/v1/usage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      local,
    )
  } catch {
    return {
      ...local,
      sourceLabel: 'Daylens local meter',
      providerReport: await getProviderReportStatus(),
    }
  }
}

export async function getBillingUsage(from: number, to: number): Promise<BillingUsageReport> {
  const cacheKey = usageCacheKey(from, to)
  const cached = usageReportCache.get(cacheKey)
  if (cached && Date.now() - cached.at < USAGE_REPORT_CACHE_TTL_MS) {
    return cached.value
  }
  const report = await buildBillingUsage(from, to)
  usageReportCache.set(cacheKey, { value: report, at: Date.now() })
  return report
}

export async function createPolarCheckout(): Promise<string> {
  return (await request<{ url: string }>('/v1/checkout/polar', { method: 'POST', body: '{}' })).url
}

export async function createFlutterwaveCheckout(email: string): Promise<string> {
  return (await request<{ url: string }>('/v1/checkout/flutterwave', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim() }),
  })).url
}

export async function getBillingPortalUrl(): Promise<string> {
  return (await request<{ url: string }>('/v1/billing/portal', { method: 'POST', body: '{}' })).url
}

export function invalidateBillingAccess(): void {
  cachedAccess = null
  usageReportCache.clear()
  anthropicAdminCache.clear()
}
