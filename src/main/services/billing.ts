import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type {
  BillingAccessSnapshot,
  BillingProviderReportStatus,
  BillingUsageHourlyPoint,
  BillingUsageJobSummary,
  BillingUsageReport,
  BillingUsageRow,
} from '@shared/types'
import { getDb } from './database'
import { getSecureStore } from './secureStore'
import { getSettingsAsync, hasApiKey, setSettings } from './settings'

declare const __DAYLENS_BILLING_API_URL__: string

const BILLING_SERVICE = 'Daylens Billing'
const BILLING_TOKEN_ACCOUNT = 'installation-session'
const PROVIDER_REPORT_SERVICE = 'Daylens Provider Reports'
const ANTHROPIC_ADMIN_ACCOUNT = 'anthropic-admin-api-key'
const REQUEST_TIMEOUT_MS = 15_000
const MANAGED_STATE_TTL_MS = 30_000
const ANTHROPIC_ADMIN_API_URL = 'https://api.anthropic.com/v1/organizations'

export interface ManagedAIConfig {
  accessToken: string
  baseUrl: string
  provider: 'anthropic' | 'openai' | 'google' | 'openrouter'
  model: string
  mode: 'free_credit' | 'subscription' | 'local_pass'
}

let cachedAccess: { value: BillingAccessSnapshot; at: number } | null = null
let lastAnthropicReportSyncAt: number | null = null

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

async function readAnthropicAdminKey(): Promise<string | null> {
  const env = envAnthropicAdminKey()
  if (env) return env
  try {
    return await getSecureStore()?.getPassword(PROVIDER_REPORT_SERVICE, ANTHROPIC_ADMIN_ACCOUNT) ?? null
  } catch {
    return null
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
}

export async function clearAnthropicAdminKey(): Promise<void> {
  if (envAnthropicAdminKey()) {
    throw new Error('The Anthropic Admin key is set by environment variable for this process.')
  }
  try {
    await getSecureStore()?.deletePassword(PROVIDER_REPORT_SERVICE, ANTHROPIC_ADMIN_ACCOUNT)
  } catch {
    // Key may not exist.
  }
  lastAnthropicReportSyncAt = null
}

export async function getProviderReportStatus(): Promise<BillingProviderReportStatus> {
  const connected = Boolean(await readAnthropicAdminKey())
  return {
    provider: 'anthropic',
    connected,
    source: connected ? 'anthropic_admin' : 'local_meter',
    message: connected
      ? 'Anthropic platform reports are connected. Spend comes from the provider report when available.'
      : 'Add an Anthropic Admin API key to reconcile spend with platform.anthropic.com. Token usage still comes from Daylens local metering.',
    lastSyncedAt: lastAnthropicReportSyncAt,
  }
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

function localUsage(from: number, to: number, sourceLabel = 'Daylens local meter'): BillingUsageReport {
  const rows = getDb().prepare(`
    SELECT id, job_type, screen, trigger_source, provider, model, success, started_at,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd
    FROM ai_usage_events
    WHERE started_at >= ? AND started_at < ?
    ORDER BY started_at DESC
    LIMIT 2000
  `).all(from, to) as Array<{
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
  }>
  const jobRows = getDb().prepare(`
    SELECT job_type, screen, trigger_source, provider, model,
           COUNT(*) AS calls,
           SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS successes,
           SUM(CASE WHEN success = 1 THEN 0 ELSE 1 END) AS failures,
           SUM(COALESCE(input_tokens, 0)) AS input_tokens,
           SUM(COALESCE(output_tokens, 0)) AS output_tokens,
           SUM(COALESCE(cache_read_tokens, 0)) AS cache_read_tokens,
           SUM(COALESCE(cache_write_tokens, 0)) AS cache_write_tokens,
           SUM(COALESCE(cost_usd, 0)) AS cost_usd,
           SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown_cost_rows
    FROM ai_usage_events
    WHERE started_at >= ? AND started_at < ?
    GROUP BY job_type, screen, trigger_source, provider, model
    ORDER BY
      SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) + COALESCE(cache_read_tokens, 0) + COALESCE(cache_write_tokens, 0)) DESC,
      COUNT(*) DESC
  `).all(from, to) as Array<{
    job_type: string
    screen: string | null
    trigger_source: string | null
    provider: string | null
    model: string | null
    calls: number
    successes: number
    failures: number
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    cache_write_tokens: number
    cost_usd: number
    unknown_cost_rows: number
  }>
  const hourlyRows = getDb().prepare(`
    SELECT (started_at / 3600000) * 3600000 AS hour,
           job_type,
           COUNT(*) AS calls,
           SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) + COALESCE(cache_read_tokens, 0) + COALESCE(cache_write_tokens, 0)) AS tokens,
           SUM(COALESCE(cost_usd, 0)) AS cost_usd,
           SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown_cost_rows
    FROM ai_usage_events
    WHERE started_at >= ? AND started_at < ?
    GROUP BY hour, job_type
    ORDER BY hour ASC, tokens DESC
  `).all(from, to) as Array<{
    hour: number
    job_type: string
    calls: number
    tokens: number
    cost_usd: number
    unknown_cost_rows: number
  }>
  const normalized: BillingUsageRow[] = rows.map((row) => ({
    id: row.id,
    occurredAt: row.started_at,
    type: 'own_key',
    feature: row.job_type,
    screen: row.screen,
    triggerSource: row.trigger_source,
    provider: row.provider,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    tokens: (row.input_tokens ?? 0) + (row.output_tokens ?? 0) + (row.cache_read_tokens ?? 0) + (row.cache_write_tokens ?? 0) || null,
    costUsd: row.cost_usd,
    success: Boolean(row.success),
  }))
  const jobSummaries: BillingUsageJobSummary[] = jobRows.map((row) => ({
    feature: row.job_type,
    screen: row.screen,
    triggerSource: row.trigger_source,
    provider: row.provider,
    model: row.model,
    calls: row.calls,
    successes: row.successes,
    failures: row.failures,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    tokens: row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_write_tokens,
    costUsd: row.unknown_cost_rows > 0 ? null : row.cost_usd,
  }))
  const hourlyPoints: BillingUsageHourlyPoint[] = hourlyRows.map((row) => ({
    hour: row.hour,
    label: new Date(row.hour).toISOString(),
    feature: row.job_type,
    calls: row.calls,
    tokens: row.tokens,
    costUsd: row.unknown_cost_rows > 0 ? null : row.cost_usd,
  }))
  const pointMap = new Map<string, { day: string; model: string; spendUsd: number; tokens: number }>()
  const dayRows = getDb().prepare(`
    SELECT date(started_at / 1000, 'unixepoch') AS day,
           COALESCE(model, 'Unknown model') AS model,
           SUM(COALESCE(cost_usd, 0)) AS spend_usd,
           SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) + COALESCE(cache_read_tokens, 0) + COALESCE(cache_write_tokens, 0)) AS tokens
    FROM ai_usage_events
    WHERE started_at >= ? AND started_at < ?
    GROUP BY day, model
    ORDER BY day ASC
  `).all(from, to) as Array<{ day: string; model: string; spend_usd: number; tokens: number }>
  for (const row of dayRows) {
    const day = row.day
    const model = row.model
    const key = `${day}:${model}`
    const point = pointMap.get(key) ?? { day, model, spendUsd: 0, tokens: 0 }
    point.spendUsd += row.spend_usd
    point.tokens += row.tokens
    pointMap.set(key, point)
  }
  const spend = jobSummaries.reduce((sum, row) => sum + (row.costUsd ?? 0), 0)
  const totalCalls = jobSummaries.reduce((sum, row) => sum + row.calls, 0)
  const failedCalls = jobSummaries.reduce((sum, row) => sum + row.failures, 0)
  const backgroundRows = jobSummaries.filter((row) => row.triggerSource === 'background' || row.triggerSource === 'system')
  return {
    from,
    to,
    source: 'local_meter',
    sourceLabel,
    totalSpendUsd: spend,
    totalTokens: jobSummaries.reduce((sum, row) => sum + row.tokens, 0),
    totalCalls,
    failedCalls,
    backgroundCalls: backgroundRows.reduce((sum, row) => sum + row.calls, 0),
    backgroundTokens: backgroundRows.reduce((sum, row) => sum + row.tokens, 0),
    freeCreditUsedUsd: 0,
    paidSpendUsd: spend,
    points: [...pointMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    rows: normalized,
    jobSummaries,
    hourlyPoints,
  }
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
  return `Claude ${match[1].trim()}`
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

async function anthropicAdminUsage(from: number, to: number, local: BillingUsageReport): Promise<BillingUsageReport | null> {
  const apiKey = await readAnthropicAdminKey()
  if (!apiKey) return null

  const usageParams = new URLSearchParams({
    starting_at: toIso(from),
    ending_at: toIso(to),
    bucket_width: '1d',
    limit: '31',
  })
  usageParams.append('group_by[]', 'model')

  const costParams = new URLSearchParams({
    starting_at: toIso(from),
    ending_at: toIso(to),
    limit: '31',
  })
  costParams.append('group_by[]', 'description')

  const [usageBuckets, costBuckets] = await Promise.all([
    fetchAllAnthropicAdmin('usage_report/messages', usageParams, apiKey),
    fetchAllAnthropicAdmin('cost_report', costParams, apiKey),
  ])

  const byDayModel = new Map<string, { day: string; model: string; spendUsd: number; tokens: number }>()
  let totalTokens = 0
  for (const bucket of usageBuckets) {
    const day = String(bucket?.starting_at ?? '').slice(0, 10)
    if (!day) continue
    for (const result of Array.isArray(bucket?.results) ? bucket.results : []) {
      const typed = result as Record<string, unknown>
      const model = String(typed.model || 'Anthropic')
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
      const amountUsd = numberValue(typed.amount) / 100
      totalSpendUsd += amountUsd
      const model = String(typed.model || parseModelFromDescription(String(typed.description ?? '')) || 'Anthropic')
      const key = `${day}:${model}`
      const point = byDayModel.get(key) ?? { day, model, spendUsd: 0, tokens: 0 }
      point.spendUsd += amountUsd
      byDayModel.set(key, point)
    }
  }

  lastAnthropicReportSyncAt = Date.now()
  const status = await getProviderReportStatus()
  return {
    ...local,
    source: 'anthropic_admin',
    sourceLabel: 'Anthropic platform report',
    providerReport: status,
    totalSpendUsd,
    paidSpendUsd: totalSpendUsd,
    totalTokens: totalTokens || local.totalTokens,
    points: [...byDayModel.values()].sort((a, b) => a.day.localeCompare(b.day) || a.model.localeCompare(b.model)),
  }
}

function mergeRemoteWithLocal(remote: BillingUsageReport, local: BillingUsageReport): BillingUsageReport {
  return {
    ...remote,
    source: remote.source ?? 'daylens_managed',
    sourceLabel: remote.sourceLabel ?? 'Daylens managed AI',
    rows: remote.rows?.length ? remote.rows : local.rows,
    jobSummaries: remote.jobSummaries?.length ? remote.jobSummaries : local.jobSummaries,
    hourlyPoints: remote.hourlyPoints?.length ? remote.hourlyPoints : local.hourlyPoints,
    totalCalls: remote.totalCalls ?? local.totalCalls,
    failedCalls: remote.failedCalls ?? local.failedCalls,
    backgroundCalls: remote.backgroundCalls ?? local.backgroundCalls,
    backgroundTokens: remote.backgroundTokens ?? local.backgroundTokens,
  }
}

export async function getBillingUsage(from: number, to: number): Promise<BillingUsageReport> {
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
}
