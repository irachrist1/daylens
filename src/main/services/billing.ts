import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type {
  BillingAccessSnapshot,
  BillingUsageReport,
  BillingUsageRow,
} from '@shared/types'
import { getDb } from './database'
import { getSecureStore } from './secureStore'
import { getSettingsAsync, hasApiKey, setSettings } from './settings'

declare const __DAYLENS_BILLING_API_URL__: string

const BILLING_SERVICE = 'Daylens Billing'
const BILLING_TOKEN_ACCOUNT = 'installation-session'
const REQUEST_TIMEOUT_MS = 15_000
const MANAGED_STATE_TTL_MS = 30_000

export interface ManagedAIConfig {
  accessToken: string
  baseUrl: string
  provider: 'anthropic' | 'openai' | 'google' | 'openrouter'
  model: string
  mode: 'free_credit' | 'subscription' | 'local_pass'
}

let cachedAccess: { value: BillingAccessSnapshot; at: number } | null = null

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

function localOwnKeyUsage(from: number, to: number): BillingUsageReport {
  const rows = getDb().prepare(`
    SELECT id, job_type, provider, model, success, started_at,
           input_tokens, output_tokens, cost_usd
    FROM ai_usage_events
    WHERE started_at >= ? AND started_at < ?
    ORDER BY started_at DESC
    LIMIT 2000
  `).all(from, to) as Array<{
    id: string
    job_type: string
    provider: string | null
    model: string | null
    success: number
    started_at: number
    input_tokens: number | null
    output_tokens: number | null
    cost_usd: number | null
  }>
  const normalized: BillingUsageRow[] = rows.map((row) => ({
    id: row.id,
    occurredAt: row.started_at,
    type: 'own_key',
    feature: row.job_type,
    provider: row.provider,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    tokens: (row.input_tokens ?? 0) + (row.output_tokens ?? 0) || null,
    costUsd: row.cost_usd,
    success: Boolean(row.success),
  }))
  const pointMap = new Map<string, { day: string; model: string; spendUsd: number; tokens: number }>()
  for (const row of normalized) {
    const day = new Date(row.occurredAt).toISOString().slice(0, 10)
    const model = row.model || 'Unknown model'
    const key = `${day}:${model}`
    const point = pointMap.get(key) ?? { day, model, spendUsd: 0, tokens: 0 }
    point.spendUsd += row.costUsd ?? 0
    point.tokens += row.tokens ?? 0
    pointMap.set(key, point)
  }
  const spend = normalized.reduce((sum, row) => sum + (row.costUsd ?? 0), 0)
  return {
    from,
    to,
    totalSpendUsd: spend,
    totalTokens: normalized.reduce((sum, row) => sum + (row.tokens ?? 0), 0),
    freeCreditUsedUsd: 0,
    paidSpendUsd: spend,
    points: [...pointMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    rows: normalized,
  }
}

export async function getBillingUsage(from: number, to: number): Promise<BillingUsageReport> {
  const access = await getBillingAccess()
  if (access.mode === 'own_key' || !apiUrl()) return localOwnKeyUsage(from, to)
  return request<BillingUsageReport>(`/v1/usage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
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
