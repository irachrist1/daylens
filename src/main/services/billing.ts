import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { deliverNotification } from './notificationDelivery'
import type {
  BillingAccessSnapshot,
  EntitlementSnapshot,
  BillingUsageCostSource,
  BillingUsageHourlyPoint,
  BillingUsageJobSummary,
  BillingUsagePoint,
  BillingUsageReport,
  BillingUsageRow,
  BillingUsageType,
  PaymentRecord,
} from '@shared/types'
import { ANALYTICS_EVENT, type PaywallTrigger } from '@shared/analytics'
import { capture } from './analytics'
import { getDb } from './database'
import { estimateQuestionsRemaining, estimateUsageCostUsd, lookupModelPricing } from './modelPricing'
import { getSecureStore } from './secureStore'
import { getSettingsAsync, hasApiKey, setSettings } from './settings'
import {
  deriveEntitlementAccess,
  pinnedEntitlementPublicKeys,
  preExhaustionWarning,
  usablePersistedSnapshot,
  validateEntitlementSnapshot,
} from './entitlement'
import { assertRealDayExternalAccessAllowed, isRealDayHarness } from '../lib/realDayHarness'

declare const __DAYLENS_BILLING_API_URL__: string

const BILLING_SERVICE = 'Daylens Billing'
const BILLING_TOKEN_ACCOUNT = 'installation-session'
const REQUEST_TIMEOUT_MS = 15_000
const MANAGED_STATE_TTL_MS = 30_000
const USAGE_REPORT_CACHE_TTL_MS = 60_000

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
const usageReportCache = new Map<string, { value: BillingUsageReport; at: number }>()

// The surface that launched the most recent checkout. A purchase completes in
// the browser, so when the access snapshot later flips into a paid mode this
// is the only record of where the sale actually started.
let lastCheckoutTrigger: PaywallTrigger | null = null

export interface ManagedAIConfig {
  accessToken: string
  baseUrl: string
  provider: 'anthropic' | 'openai' | 'google' | 'openrouter'
  model: string
  // LiteLLM alias for the cheap tier (e.g. Haiku), advertised by the billing
  // service when configured. Background and balanced jobs ride this alias so a
  // $5/mo subscriber's block labels don't burn frontier-model tokens. Absent on
  // older billing services — callers must fall back to `model`.
  economyModel?: string | null
  mode: 'free_credit' | 'subscription' | 'local_pass'
}

function apiUrl(): string {
  if (isRealDayHarness()) return ''
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
    estimatedQuestionsRemaining: null,
  }
}

// Allowance is shown in money AND estimated questions, never raw tokens first.
// The estimate divides the remaining managed allowance by a typical question's
// cost at the managed default tier (model-specific estimates arrive with the
// model picker). Null whenever managed AI is not actually usable — a paused
// account shows its pause message, not a question count.
function withEstimatedQuestions(value: BillingAccessSnapshot): BillingAccessSnapshot {
  const remainingUsd = value.mode === 'free_credit'
    ? value.creditRemainingUsd
    : value.mode === 'subscription' || value.mode === 'local_pass'
      ? value.fairUseRemainingUsd
      : null
  const estimatedQuestionsRemaining = value.managed && value.canUseAI
    ? estimateQuestionsRemaining(remainingUsd, null)
    : null
  return { ...value, estimatedQuestionsRemaining }
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
  assertRealDayExternalAccessAllowed('billing')
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

// Intercom Identity Verification. The user_hash is HMAC-SHA256(user_id, IV secret)
// and the secret lives only in services/billing/.env — never in this bundle, since
// anything shipped in the client is extractable. Resolves null whenever the hash
// can't be fetched; the Messenger then boots without identity verification.
// TODO(intercom): inert until INTERCOM_IDENTITY_VERIFICATION_SECRET is set
// in services/billing/.env and the billing service is deployed with
// DAYLENS_BILLING_API_URL wired into the build.
export async function getIntercomIdentity(): Promise<{ userId: string; userHash: string } | null> {
  if (!apiUrl()) return null
  try {
    const payload = await request<{ userId?: string; userHash?: string }>('/v1/intercom/user-hash', {
      method: 'POST',
      body: '{}',
    })
    return typeof payload.userId === 'string' && payload.userId
      && typeof payload.userHash === 'string' && payload.userHash
      ? { userId: payload.userId, userHash: payload.userHash }
      : null
  } catch {
    return null
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
  if (provider === 'claude-cli' || provider === 'chatgpt-cli' || provider === 'gemini-cli' || provider === 'codex-cli') return provider
  return await hasApiKey(provider) ? provider : null
}

// ─── Fair-use soft ceiling warning ───────────────────────────────────────────
// The billing service already enforces a HARD fair-use ceiling per period
// (SUBSCRIPTION_FAIR_USE_USD): past it, managed calls 429. This is the soft
// layer in front of it — when a managed plan crosses the warn fraction, tell
// the user once per billing period so they can slow down, upgrade, or switch
// to their own key BEFORE AI silently stops working.

const FAIR_USE_WARN_FRACTION = 0.8

function fairUseStatePath(): string {
  return path.join(app.getPath('userData'), 'billing-fair-use-state.json')
}

function readWarnedPeriods(): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(fairUseStatePath(), 'utf8')) as { warnedPeriods?: string[] }
    return Array.isArray(parsed.warnedPeriods) ? parsed.warnedPeriods : []
  } catch {
    return []
  }
}

function maybeWarnFairUse(snapshot: BillingAccessSnapshot): void {
  try {
    if (!snapshot.managed) return
    if (snapshot.mode !== 'subscription' && snapshot.mode !== 'local_pass') return
    if (snapshot.fairUseRemainingUsd == null) return
    const ceiling = snapshot.periodSpendUsd + snapshot.fairUseRemainingUsd
    if (!(ceiling > 0)) return
    const usedFraction = snapshot.periodSpendUsd / ceiling
    if (usedFraction < FAIR_USE_WARN_FRACTION) return

    const periodKey = `${snapshot.mode}:${snapshot.renewalAt ?? 'no-renewal'}`
    const warned = readWarnedPeriods()
    if (warned.includes(periodKey)) return

    const resetNote = snapshot.renewalAt
      ? ` It resets on ${new Date(snapshot.renewalAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`
      : ''
    deliverNotification({
      title: 'Daylens AI: nearing this period’s included usage',
      body: `You’ve used ${Math.round(usedFraction * 100)}% of the AI included in your plan.${resetNote} To keep going without limits, add your own API key in Settings.`,
      surface: 'billing-fair-use',
    })
    fs.writeFileSync(fairUseStatePath(), JSON.stringify({ warnedPeriods: [...warned.slice(-11), periodKey] }, null, 2))
  } catch {
    // The warning is best-effort; never let it break the access snapshot path.
  }
}

// ─── Signed entitlement snapshot ─────────────────────────────────────────────
// The consolidation seam for desktop access checks: when the
// build pins an entitlement public key, the signed EntitlementSnapshot from
// GET /v1/entitlement governs managed access — validated, persisted, honored
// offline until its signed expiry, and failed CLOSED for managed AI (open for
// local use) when no valid snapshot exists. When no key is pinned (the state
// of every current build), the gate is unarmed and the legacy /v1/billing
// snapshot governs unchanged.

type EntitlementLookup =
  | { armed: false }
  | { armed: true; snapshot: EntitlementSnapshot | null }

function entitlementSnapshotPath(): string {
  return path.join(app.getPath('userData'), 'entitlement-snapshot.json')
}

function readPersistedEntitlement(keys: Record<string, string>): EntitlementSnapshot | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(entitlementSnapshotPath(), 'utf8')) as unknown
    // Re-validates signature and expiry, so a tampered or stale file on disk
    // fails closed exactly like a forged network response.
    return usablePersistedSnapshot(parsed, keys, Date.now())
  } catch {
    return null
  }
}

async function getEntitlement(): Promise<EntitlementLookup> {
  const keys = pinnedEntitlementPublicKeys()
  if (Object.keys(keys).length === 0 || !apiUrl()) return { armed: false }
  try {
    const fetched = await request<EntitlementSnapshot>('/v1/entitlement')
    const result = validateEntitlementSnapshot(fetched, keys, Date.now())
    if (result.valid) {
      try {
        fs.writeFileSync(entitlementSnapshotPath(), JSON.stringify(result.snapshot, null, 2))
      } catch {
        // Persistence is best-effort; the validated in-memory snapshot still governs.
      }
      return { armed: true, snapshot: result.snapshot }
    }
    // An invalid response never overwrites a previously validated snapshot.
    return { armed: true, snapshot: readPersistedEntitlement(keys) }
  } catch {
    // Service unreachable (or /v1/entitlement not deployed yet): honor the
    // persisted validated snapshot until its signed expiry, per the spec.
    return { armed: true, snapshot: readPersistedEntitlement(keys) }
  }
}

// One pre-exhaustion warning per period at 80% of the allowance (DEV-195).
// Same once-per-period persistence pattern as the fair-use warning above, in
// its own state file because the period keys are entitlement-shaped.
function entitlementWarnStatePath(): string {
  return path.join(app.getPath('userData'), 'entitlement-warn-state.json')
}

function maybeWarnPreExhaustion(snapshot: EntitlementSnapshot): void {
  try {
    let warned: string[] = []
    try {
      const parsed = JSON.parse(fs.readFileSync(entitlementWarnStatePath(), 'utf8')) as { warnedPeriods?: string[] }
      warned = Array.isArray(parsed.warnedPeriods) ? parsed.warnedPeriods : []
    } catch {
      warned = []
    }
    const { shouldWarn, periodKey, usedFraction } = preExhaustionWarning(snapshot, warned)
    if (!shouldWarn) return
    const resetNote = snapshot.periodEnd
      ? ` It resets on ${new Date(snapshot.periodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`
      : ''
    deliverNotification({
      title: 'Daylens AI: nearing this period’s included credit',
      body: `You’ve used ${Math.round(usedFraction * 100)}% of your included AI credit.${resetNote} To keep going without limits, add your own API key in Settings.`,
      surface: 'billing-pre-exhaustion',
    })
    fs.writeFileSync(entitlementWarnStatePath(), JSON.stringify({ warnedPeriods: [...warned.slice(-11), periodKey] }, null, 2))
  } catch {
    // The warning is best-effort; never let it break the access snapshot path.
  }
}

// Apply the entitlement verdict to the legacy access snapshot. Managed access
// follows the signed snapshot; own-key and local behavior are untouched.
function applyEntitlementGate(value: BillingAccessSnapshot, lookup: EntitlementLookup): BillingAccessSnapshot {
  if (!lookup.armed) return value
  if (lookup.snapshot) maybeWarnPreExhaustion(lookup.snapshot)
  const derived = deriveEntitlementAccess(lookup.snapshot, Date.now())
  if (derived.canUseManagedAI || !value.managed) return value
  return { ...value, canUseAI: false, message: derived.message }
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
    const fetched = await request<BillingAccessSnapshot>('/v1/billing')
    const value = withEstimatedQuestions(applyEntitlementGate(fetched, await getEntitlement()))
    // subscription_started: the app learns a purchase completed only by the
    // access snapshot flipping into a paid mode after the browser checkout.
    // (The API reports no price; `plan` carries the billing mode.) `trigger`
    // is the surface that launched the checkout, falling back to 'settings'
    // for purchases completed without an in-app checkout (e.g. portal).
    const previousMode = cachedAccess?.value.mode
    const enteredPaidMode = (value.mode === 'subscription' || value.mode === 'local_pass') && previousMode !== value.mode
    if (previousMode && enteredPaidMode) {
      capture(ANALYTICS_EVENT.SUBSCRIPTION_STARTED, { plan: value.mode, trigger: lastCheckoutTrigger ?? 'settings' })
    }
    cachedAccess = { value, at: Date.now() }
    maybeWarnFairUse(value)
    return value
  } catch (error) {
    // Billing service unreachable. When the entitlement gate is armed and a
    // validated snapshot is persisted, say what the person actually keeps
    // (until the snapshot's signed expiry) instead of a bare error.
    const keys = pinnedEntitlementPublicKeys()
    if (Object.keys(keys).length > 0) {
      const persisted = readPersistedEntitlement(keys)
      if (persisted) {
        const derived = deriveEntitlementAccess(persisted, Date.now())
        // A snapshot that pauses managed access (exhausted, expired, refunded)
        // keeps its calm pause message even while the service is unreachable —
        // the outage never masks the real state.
        if (!derived.canUseManagedAI) return unavailableSnapshot(derived.message)
        const until = new Date(persisted.expiresAt).toLocaleString('en-US', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        return unavailableSnapshot(`Daylens can’t reach the billing service right now. Your ${persisted.state === 'trial' ? 'trial' : 'plan'} status is remembered until ${until}; local features and your own key keep working.`)
      }
    }
    return unavailableSnapshot(error instanceof Error ? error.message : String(error))
  }
}

export async function getManagedAIConfig(): Promise<ManagedAIConfig | null> {
  if (await selectedOwnKeyProvider() || !apiUrl()) return null
  const access = await getBillingAccess()
  if (!access.canUseAI || !access.managed) return null
  return request<ManagedAIConfig>('/v1/ai/session', { method: 'POST', body: '{}' })
}

// ─── Usage report ───────────────────────────────────────────────────────────
//
// Spend is token usage × Anthropic's published per-model price — which IS the
// real bill (it reconciles to platform.claude.com within a percent or two). We
// meter every AI call we make in `ai_usage_events`, so the headline totals and
// the per-day chart are computed by aggregating that table over the FULL range
// in SQL — not a capped sample. No external/admin API and no key required.

// Bucket a timestamp by the LOCAL calendar day. The renderer builds the chart's
// day axis and the range bounds from the user's local calendar, so points have
// to be keyed the same way — otherwise an evening call (whose UTC date is the
// next day) lands on a day the axis doesn't contain and silently disappears.
function localDayKey(ms: number): string {
  const date = new Date(ms)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Inverse of localDayKey: local midnight (ms) for a YYYY-MM-DD day key.
function localDayStartMs(day: string): number {
  const [year, month, dayOfMonth] = day.split('-').map(Number)
  return new Date(year, month - 1, dayOfMonth).getTime()
}

function billingModeToType(mode: string | null): BillingUsageType {
  if (mode === 'free_credit' || mode === 'subscription' || mode === 'local_pass') return mode
  return 'own_key'
}

function rowTokens(row: Pick<RawUsageEvent, 'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'cache_write_tokens'>): number {
  return (row.input_tokens ?? 0) + (row.output_tokens ?? 0) + (row.cache_read_tokens ?? 0) + (row.cache_write_tokens ?? 0)
}

// Price a (summed) bundle of tokens for one model. Pricing is linear in tokens,
// so pricing a SQL-summed group equals the sum of pricing each row — the
// aggregate is exact, not an approximation.
function priceTokensUsd(
  model: string | null,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
): number {
  const rates = lookupModelPricing(model)
  return (input / 1_000_000) * rates.inputPerMillion
    + (output / 1_000_000) * rates.outputPerMillion
    + (cacheRead / 1_000_000) * (rates.cacheReadPerMillion ?? rates.inputPerMillion * 0.1)
    + (cacheWrite / 1_000_000) * (rates.cacheWritePerMillion ?? rates.inputPerMillion * 1.25)
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

function normalizeUsageRow(row: RawUsageEvent): BillingUsageRow {
  const { costUsd, costSource } = resolveRowCost(row)
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
    tokens: rowTokens(row) || null,
    costUsd,
    costSource,
    success: Boolean(row.success),
  }
}

// Aggregate a concrete list of events into a report. Used for the unit tests and
// reusable anywhere we already hold the rows; the live path uses the SQL
// aggregation in `localUsage` so it never has to load every row into memory.
export function aggregateUsageFromEvents(
  events: RawUsageEvent[],
  from: number,
  to: number,
  sourceLabel = 'Daylens local meter',
): BillingUsageReport {
  const sorted = [...events].sort((left, right) => right.started_at - left.started_at)
  const displayRows = sorted.slice(0, 2000)

  const normalized: BillingUsageRow[] = displayRows.map(normalizeUsageRow)

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
    const day = localDayKey(row.started_at)
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
    const hourKey = `${hour}:${feature}:${model}`
    const existingHour = hourlyMap.get(hourKey) ?? {
      hour,
      label: new Date(hour).toISOString(),
      feature,
      model,
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

interface GroupedUsageRow {
  hour: number
  model: string | null
  feature: string
  screen: string | null
  trigger_source: string | null
  provider: string | null
  billing_mode: string | null
  calls: number
  successes: number
  failures: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
}

// Rolled-up telemetry for days older than the retention window (see
// aiUsageRetention.ts). Grouping keys were stored as '' where the original
// event had NULL provider/model, so the read path maps '' back to null.
interface RawUsageRollup {
  day: string
  job_type: string
  screen: string
  trigger_source: string
  provider: string
  model: string
  billing_mode: string
  calls: number
  successes: number
  failures: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost_usd: number
}

function readUsageRollupsInRange(db: ReturnType<typeof getDb>, from: number, to: number): RawUsageRollup[] {
  // Rollup granularity is whole local days; every Usage-screen range is
  // midnight-aligned, so string day-key comparison is exact: a day is in
  // [from, to) iff fromDay <= day < toDay.
  return db.prepare(`
    SELECT day, job_type, screen, trigger_source, provider, model, billing_mode,
           calls, successes, failures,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd
    FROM ai_usage_daily_rollup
    WHERE day >= ? AND day < ?
    ORDER BY day ASC
  `).all(localDayKey(from), localDayKey(to)) as RawUsageRollup[]
}

function rollupToGroupedUsageRow(rollup: RawUsageRollup): GroupedUsageRow {
  return {
    hour: localDayStartMs(rollup.day),
    model: rollup.model || null,
    feature: rollup.job_type,
    screen: rollup.screen || null,
    trigger_source: rollup.trigger_source || null,
    provider: rollup.provider || null,
    billing_mode: rollup.billing_mode || null,
    calls: rollup.calls,
    successes: rollup.successes,
    failures: rollup.failures,
    input_tokens: rollup.input_tokens,
    output_tokens: rollup.output_tokens,
    cache_read_tokens: rollup.cache_read_tokens,
    cache_write_tokens: rollup.cache_write_tokens,
  }
}

// The live usage report. Headline totals + the per-day chart aggregate the WHOLE
// range in SQL (grouped, so memory stays flat no matter how many events); the
// detailed rows table is the most recent 2000 for display only.
export function localUsage(from: number, to: number, sourceLabel = 'Daylens local meter'): BillingUsageReport {
  const db = getDb()

  const grouped = db.prepare(`
    SELECT
      CAST(started_at / 3600000 AS INTEGER) * 3600000 AS hour,
      model,
      job_type AS feature,
      screen,
      trigger_source,
      provider,
      billing_mode,
      COUNT(*) AS calls,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens
    FROM ai_usage_events
    WHERE started_at >= ? AND started_at < ?
    GROUP BY hour, model, feature, screen, trigger_source, provider, billing_mode
  `).all(from, to) as GroupedUsageRow[]

  // Days older than the retention window live only in ai_usage_daily_rollup
  // (aiUsageRetention.ts): same counts and token sums, per local day instead
  // of per event. Spend prices from model + token sums exactly like the raw
  // grouped path above (pricing is linear in tokens), so totals and charts
  // are unchanged by the rollup. A rolled day appears as one "hour" at its
  // local midnight — sub-day granularity only matters for the 1-day view,
  // which is always inside the detail window.
  const rollups = readUsageRollupsInRange(db, from, to)
  const allGroups: GroupedUsageRow[] = [...grouped, ...rollups.map(rollupToGroupedUsageRow)]

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

  for (const group of allGroups) {
    const tokens = group.input_tokens + group.output_tokens + group.cache_read_tokens + group.cache_write_tokens
    const spend = priceTokensUsd(group.model, group.input_tokens, group.output_tokens, group.cache_read_tokens, group.cache_write_tokens)
    const type = billingModeToType(group.billing_mode)
    const day = localDayKey(group.hour)
    const model = group.model ?? 'Unknown model'
    const feature = group.feature
    const isBackground = group.trigger_source === 'background' || group.trigger_source === 'system'

    totalCalls += group.calls
    totalTokens += tokens
    totalSpendUsd += spend
    if (type === 'free_credit') freeCreditUsedUsd += spend
    else paidSpendUsd += spend
    failedCalls += group.failures
    if (isBackground) {
      backgroundCalls += group.calls
      backgroundTokens += tokens
    }

    const summaryKey = jobSummaryKey({ job_type: feature, screen: group.screen, trigger_source: group.trigger_source, provider: group.provider, model: group.model })
    const existingSummary = jobMap.get(summaryKey) ?? {
      feature,
      screen: group.screen,
      triggerSource: group.trigger_source,
      provider: group.provider,
      model: group.model,
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
    existingSummary.calls += group.calls
    existingSummary.successes += group.successes
    existingSummary.failures += group.failures
    existingSummary.inputTokens += group.input_tokens
    existingSummary.outputTokens += group.output_tokens
    existingSummary.cacheReadTokens += group.cache_read_tokens
    existingSummary.cacheWriteTokens += group.cache_write_tokens
    existingSummary.tokens += tokens
    existingSummary.costUsd = (existingSummary.costUsd ?? 0) + spend
    jobMap.set(summaryKey, existingSummary)

    const hourKey = `${group.hour}:${feature}:${model}`
    const existingHour = hourlyMap.get(hourKey) ?? {
      hour: group.hour,
      label: new Date(group.hour).toISOString(),
      feature,
      model,
      calls: 0,
      tokens: 0,
      costUsd: 0,
    }
    existingHour.calls += group.calls
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

  const recent = db.prepare(`
    SELECT id, job_type, screen, trigger_source, provider, model, success, started_at,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, billing_mode
    FROM ai_usage_events
    WHERE started_at >= ? AND started_at < ?
    ORDER BY started_at DESC
    LIMIT 2000
  `).all(from, to) as RawUsageEvent[]

  const rows: BillingUsageRow[] = recent.map(normalizeUsageRow)

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
    points: [...modelPointMap.values()].sort((a, b) => a.day.localeCompare(b.day) || a.model.localeCompare(b.model)),
    featurePoints: [...featurePointMap.values()].sort((a, b) => a.day.localeCompare(b.day) || (a.feature ?? '').localeCompare(b.feature ?? '')),
    rows,
    jobSummaries: [...jobMap.values()].sort((a, b) => b.tokens - a.tokens || b.calls - a.calls),
    hourlyPoints: [...hourlyMap.values()].sort((a, b) => a.hour - b.hour || b.tokens - a.tokens),
  }
}

// Every event in the [from, to) window, normalized for export — NOT the 2000-row
// display cap. A busy day (AI labeling alone can fire ~1800 calls/hour) blows past
// 2000 easily, so the CSV must read straight from the table, oldest first, to
// truly cover the whole selected range.
export function exportUsageRows(from: number, to: number): BillingUsageRow[] {
  const db = getDb()
  const events = db.prepare(`
    SELECT id, job_type, screen, trigger_source, provider, model, success, started_at,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, billing_mode
    FROM ai_usage_events
    WHERE started_at >= ? AND started_at < ?
    ORDER BY started_at ASC
  `).all(from, to) as RawUsageEvent[]

  // Days older than the retention window export as one aggregate line per
  // (day, feature, provider, model, …) group, carrying the group's call and
  // failure counts (the `calls` column — 1 on ordinary per-event lines) so
  // the CSV's totals still cover the whole selected range exactly.
  const rollupRows: BillingUsageRow[] = readUsageRollupsInRange(db, from, to).map((rollup, index) => {
    const tokens = rollup.input_tokens + rollup.output_tokens + rollup.cache_read_tokens + rollup.cache_write_tokens
    const estimated = priceTokensUsd(
      rollup.model || null,
      rollup.input_tokens,
      rollup.output_tokens,
      rollup.cache_read_tokens,
      rollup.cache_write_tokens,
    )
    return {
      id: `rollup:${rollup.day}:${index}`,
      occurredAt: localDayStartMs(rollup.day),
      type: billingModeToType(rollup.billing_mode),
      feature: rollup.job_type,
      screen: rollup.screen || null,
      triggerSource: rollup.trigger_source || null,
      provider: rollup.provider || null,
      model: rollup.model || null,
      inputTokens: rollup.input_tokens,
      outputTokens: rollup.output_tokens,
      cacheReadTokens: rollup.cache_read_tokens,
      cacheWriteTokens: rollup.cache_write_tokens,
      tokens: tokens || null,
      costUsd: rollup.cost_usd > 0 ? rollup.cost_usd : estimated,
      costSource: rollup.cost_usd > 0 ? 'provider' : 'estimated',
      success: rollup.failures === 0,
      calls: rollup.calls,
      failures: rollup.failures,
    }
  })

  return [...rollupRows, ...events.map(normalizeUsageRow)]
    .sort((left, right) => left.occurredAt - right.occurredAt)
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

  // Own-key users (the common case): the local meter is the whole truth.
  const access = await getBillingAccess()
  if (access.mode === 'own_key' || !apiUrl()) return local

  // Managed-AI users: the billing service reports actual managed spend; fall
  // back to the local meter if it's unreachable.
  try {
    return mergeRemoteWithLocal(
      await request<BillingUsageReport>(`/v1/usage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      local,
    )
  } catch {
    return local
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

export async function createPolarCheckout(trigger: PaywallTrigger = 'settings'): Promise<string> {
  lastCheckoutTrigger = trigger
  return (await request<{ url: string }>('/v1/checkout/polar', { method: 'POST', body: '{}' })).url
}

export async function createFlutterwaveCheckout(email: string, trigger: PaywallTrigger = 'settings'): Promise<string> {
  lastCheckoutTrigger = trigger
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
}

export async function getPaymentHistory(): Promise<PaymentRecord[]> {
  const base = apiUrl()
  if (!base) return []
  try {
    const result = await request<{ payments: PaymentRecord[] }>('/v1/payments')
    return result.payments ?? []
  } catch {
    return []
  }
}
