import crypto from 'node:crypto'
import http from 'node:http'
import { Pool } from 'pg'

const required = [
  'DATABASE_URL',
  'PUBLIC_BASE_URL',
  'SESSION_SECRET',
  'INSTALLATION_HASH_SECRET',
  'LITELLM_URL',
  'LITELLM_MASTER_KEY',
  'LITELLM_KEY_ENCRYPTION_SECRET',
]
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable ${key}`)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })
const port = Number(process.env.PORT || 8787)
const publicBaseUrl = process.env.PUBLIC_BASE_URL.replace(/\/+$/, '')
const litellmUrl = process.env.LITELLM_URL.replace(/\/+$/, '')
const polarApiBaseUrl = (process.env.POLAR_API_BASE_URL || 'https://api.polar.sh/v1').replace(/\/+$/, '')
const flutterwaveApiBaseUrl = (process.env.FLUTTERWAVE_API_BASE_URL || 'https://api.flutterwave.com/v3').replace(/\/+$/, '')
const fairUseMicros = Math.round(Number(process.env.SUBSCRIPTION_FAIR_USE_USD || 20) * 1_000_000)
const managedProvider = process.env.DAYLENS_MANAGED_PROVIDER || 'anthropic'
// The real upstream model LiteLLM proxies to, and the name we show/record. This is
// the value litellm-config.yaml reads as `os.environ/DAYLENS_MANAGED_MODEL`.
const managedModel = process.env.DAYLENS_MANAGED_MODEL || 'anthropic/claude-sonnet-4-6'
// The public alias the billing server sends to LiteLLM as the request `model`. It MUST
// match a `model_name` in litellm-config.yaml (which maps it to `managedModel`). Sending
// the real model name here would match no model_name and every managed call would 404.
const litellmModelAlias = process.env.LITELLM_MODEL_ALIAS || 'daylens-default'
// Cheap-tier managed model (cost audit 2026-07-07): background and balanced jobs
// (block labels, relabels, wraps) ride this alias so a $5/mo subscriber's
// high-volume background work never burns frontier-model tokens. The alias is
// advertised to clients ONLY when DAYLENS_ECONOMY_MODEL is explicitly set,
// because it must also exist as a `model_name` in litellm-config.yaml —
// advertising an unconfigured alias would 404 every background call.
const economyModelConfigured = Boolean(process.env.DAYLENS_ECONOMY_MODEL)
const litellmEconomyModelAlias = process.env.LITELLM_ECONOMY_MODEL_ALIAS || 'daylens-economy'
const localPassAmount = Number(process.env.FLUTTERWAVE_LOCAL_PASS_RWF || 15000)

function assertProductionSafety() {
  if (!Number.isFinite(port) || port <= 0) throw new Error('PORT must be a positive number')
  if (!Number.isFinite(fairUseMicros) || fairUseMicros <= 0) throw new Error('SUBSCRIPTION_FAIR_USE_USD must be positive')
  if (!Number.isInteger(localPassAmount) || localPassAmount <= 0) throw new Error('FLUTTERWAVE_LOCAL_PASS_RWF must be a positive integer')
  if (!/^https:\/\//.test(publicBaseUrl) && process.env.NODE_ENV === 'production') {
    throw new Error('PUBLIC_BASE_URL must be HTTPS in production')
  }
  for (const key of ['SESSION_SECRET', 'INSTALLATION_HASH_SECRET', 'LITELLM_KEY_ENCRYPTION_SECRET']) {
    const value = process.env[key] || ''
    if (value.length < 32 || /^replace-with/.test(value)) throw new Error(`${key} must be a real high-entropy secret`)
  }
  if (process.env.NODE_ENV === 'production') {
    if (process.env.POLAR_ACCESS_TOKEN && !process.env.POLAR_WEBHOOK_SECRET) throw new Error('POLAR_WEBHOOK_SECRET is required when Polar is enabled')
    if (process.env.FLUTTERWAVE_SECRET_KEY && !process.env.FLUTTERWAVE_SECRET_HASH) throw new Error('FLUTTERWAVE_SECRET_HASH is required when Flutterwave is enabled')
  }
}

assertProductionSafety()

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

function signToken(payload, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000)
  const body = base64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }))
  const signature = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url')
  return `${body}.${signature}`
}

function verifyToken(token, expectedType) {
  const [body, signature] = String(token || '').split('.')
  if (!body || !signature) throw new Error('invalid_token')
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url')
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error('invalid_token')
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  if (payload.exp < Math.floor(Date.now() / 1000) || payload.type !== expectedType) throw new Error('invalid_token')
  return payload
}

function bearer(req) {
  const value = req.headers.authorization || ''
  return value.startsWith('Bearer ') ? value.slice(7) : ''
}

function hash(value, secret = process.env.INSTALLATION_HASH_SECRET) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex')
}

function safeEqualString(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function encryptionKey() {
  return crypto.createHash('sha256').update(process.env.LITELLM_KEY_ENCRYPTION_SECRET).digest()
}

function encrypt(value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}

function decrypt(value) {
  const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64url'))
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

async function body(req, maxBytes = 2_000_000) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('body_too_large')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks)
  return { raw, json: raw.length ? JSON.parse(raw.toString('utf8')) : {} }
}

async function generateLiteLLMKey(accountId, maxBudget = 5) {
  const response = await fetch(`${litellmUrl}/key/generate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.LITELLM_MASTER_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      key_alias: `daylens-${accountId}`,
      max_budget: maxBudget,
      metadata: { account_id: accountId },
    }),
  })
  const payload = await response.json()
  if (!response.ok || !payload.key) throw new Error(payload.error || 'litellm_key_generation_failed')
  return payload.key
}

async function setLiteLLMBudget(account, maxBudget, budgetDuration = null) {
  const response = await fetch(`${litellmUrl}/key/update`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.LITELLM_MASTER_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      key: decrypt(account.litellm_key_cipher),
      max_budget: maxBudget,
      ...(budgetDuration ? { budget_duration: budgetDuration } : {}),
    }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error || 'litellm_budget_update_failed')
  }
}

async function reconcileLiteLLMBudget(accountId) {
  const result = await pool.query('SELECT * FROM billing_accounts WHERE id = $1', [accountId])
  const account = result.rows[0]
  if (!account) throw new Error('billing_account_not_found')
  const mode = accessMode(account)
  if (!account.litellm_budget_sync_required && account.litellm_budget_mode === mode) return account

  if (mode === 'free_credit') {
    // Paid-period spend belongs to a different entitlement. A fresh virtual
    // key gives the remaining free-credit ledger its own clean LiteLLM budget.
    const maxBudget = Math.max(0, Number(account.free_credit_remaining_micros)) / 1_000_000
    const key = await generateLiteLLMKey(`${account.id}-${crypto.randomBytes(4).toString('hex')}`, maxBudget)
    await pool.query(
      `UPDATE billing_accounts SET litellm_key_cipher = $1, litellm_budget_mode = $2,
       litellm_budget_sync_required = false, updated_at = now() WHERE id = $3`,
      [encrypt(key), mode, account.id],
    )
  } else {
    const maxBudget = mode === 'subscription' || mode === 'local_pass' ? fairUseMicros / 1_000_000 : 0
    await setLiteLLMBudget(account, maxBudget, mode === 'subscription' || mode === 'local_pass' ? '30d' : null)
    await pool.query(
      `UPDATE billing_accounts SET litellm_budget_mode = $1,
       litellm_budget_sync_required = false, updated_at = now() WHERE id = $2`,
      [mode, account.id],
    )
  }
  const updated = await pool.query('SELECT * FROM billing_accounts WHERE id = $1', [account.id])
  return updated.rows[0]
}

async function accountForToken(req, type = 'install') {
  const payload = verifyToken(bearer(req), type)
  const result = await pool.query('SELECT * FROM billing_accounts WHERE id = $1', [payload.accountId])
  const account = result.rows[0]
  if (
    !account
    || account.tokens_revoked_at
    || Number(payload.ver) !== Number(account.installation_token_version)
  ) throw new Error('invalid_token')
  return account
}

function accessMode(account) {
  const now = Date.now()
  if (
    account.plan === 'subscription'
    && ['active', 'canceled'].includes(account.subscription_status)
    && new Date(account.renewal_at).getTime() > now
  ) {
    return 'subscription'
  }
  if (account.plan === 'local_pass' && new Date(account.local_pass_expires_at).getTime() > now) return 'local_pass'
  if (Number(account.free_credit_remaining_micros) > 0) return 'free_credit'
  return 'none'
}

async function periodSpendMicros(account, db = pool) {
  const from = account.period_started_at || account.local_pass_expires_at
    ? account.period_started_at || new Date(new Date(account.local_pass_expires_at).getTime() - 30 * 86400000)
    : new Date(0)
  const result = await db.query(
    `SELECT COALESCE(SUM(cost_micros), 0)::bigint AS spend
     FROM billing_usage WHERE account_id = $1 AND occurred_at >= $2 AND mode <> 'free_credit'`,
    [account.id, from],
  )
  return Number(result.rows[0].spend)
}

async function billingSnapshot(account) {
  const mode = accessMode(account)
  const paidSpend = await periodSpendMicros(account)
  const managed = mode !== 'none'
  return {
    mode,
    canUseAI: managed,
    managed,
    creditGrantedUsd: Number(account.free_credit_granted_micros) / 1_000_000,
    creditRemainingUsd: Math.max(0, Number(account.free_credit_remaining_micros)) / 1_000_000,
    periodSpendUsd: paidSpend / 1_000_000,
    paidSpendUsd: paidSpend / 1_000_000,
    renewalAt: account.renewal_at ? new Date(account.renewal_at).getTime() : null,
    localPassExpiresAt: account.local_pass_expires_at ? new Date(account.local_pass_expires_at).getTime() : null,
    fairUseRemainingUsd: mode === 'subscription' || mode === 'local_pass'
      ? Math.max(0, fairUseMicros - paidSpend) / 1_000_000
      : null,
    subscriptionStatus: account.subscription_status,
    providerLabel: 'Daylens managed AI',
    checkoutAvailable: Boolean(process.env.POLAR_ACCESS_TOKEN && process.env.POLAR_PRODUCT_ID),
    localCheckoutAvailable: Boolean(process.env.FLUTTERWAVE_SECRET_KEY),
    portalAvailable: Boolean(account.polar_customer_id && process.env.POLAR_ACCESS_TOKEN),
    message: mode === 'free_credit'
      ? `$${(Math.max(0, Number(account.free_credit_remaining_micros)) / 1_000_000).toFixed(2)} of AI credit left.`
      : mode === 'subscription'
        ? 'Your Daylens subscription is active.'
        : mode === 'local_pass'
          ? 'Your Rwanda mobile-money pass is active.'
          : 'AI is paused. Subscribe or add your own key; capture and local views keep working.',
  }
}

async function bootstrap(req, res) {
  const parsed = await body(req, 64_000)
  const installationId = String(parsed.json.installationId || '')
  if (installationId.length < 20) return json(res, 400, { error: 'invalid_installation' })
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'
  const ipHash = hash(ip, process.env.SESSION_SECRET)
  const recent = await pool.query(
    `SELECT COUNT(*)::int AS count FROM billing_bootstrap_attempts
     WHERE ip_hash = $1 AND attempted_at > now() - interval '1 hour'`,
    [ipHash],
  )
  if (recent.rows[0].count >= 20) return json(res, 429, { error: 'Too many new-install attempts. Try again later.' })
  await pool.query('INSERT INTO billing_bootstrap_attempts (ip_hash) VALUES ($1)', [ipHash])

  const installationHash = hash(installationId)
  let result = await pool.query('SELECT * FROM billing_accounts WHERE installation_hash = $1', [installationHash])
  if (!result.rows[0]) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const inserted = await client.query(
        `INSERT INTO billing_accounts (installation_hash, litellm_key_cipher)
         VALUES ($1, 'pending') ON CONFLICT (installation_hash) DO NOTHING RETURNING *`,
        [installationHash],
      )
      if (inserted.rows[0]) {
        const key = await generateLiteLLMKey(inserted.rows[0].id)
        await client.query(
          'UPDATE billing_accounts SET litellm_key_cipher = $1 WHERE id = $2',
          [encrypt(key), inserted.rows[0].id],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    result = await pool.query('SELECT * FROM billing_accounts WHERE installation_hash = $1', [installationHash])
  }
  const account = result.rows[0]
  if (account.tokens_revoked_at) {
    return json(res, 403, { error: 'This installation was revoked. Contact support to restore it.' })
  }
  return json(res, 200, { token: signToken({ type: 'install', accountId: account.id, ver: account.installation_token_version }, 30 * 86400) })
}

async function rotateInstallationToken(account, req, res) {
  const parsed = await body(req, 64_000)
  const installationId = String(parsed.json.installationId || '')
  if (installationId.length < 20 || !safeEqualString(hash(installationId), account.installation_hash)) {
    return json(res, 403, { error: 'Installation proof did not match.' })
  }
  const result = await pool.query(
    `UPDATE billing_accounts SET installation_token_version = installation_token_version + 1,
     updated_at = now() WHERE id = $1 AND installation_token_version = $2
     RETURNING installation_token_version`,
    [account.id, account.installation_token_version],
  )
  const version = result.rows[0]?.installation_token_version
  if (!version) return json(res, 409, { error: 'The installation token was already rotated. Retry with the newest token.' })
  return json(res, 200, {
    token: signToken({ type: 'install', accountId: account.id, ver: version }, 30 * 86400),
  })
}

async function payments(account, res) {
  const result = await pool.query(
    `SELECT provider, tx_ref, amount, currency, status, provider_reference, created_at, updated_at
     FROM billing_payment_intents
     WHERE account_id = $1 AND status IN ('successful', 'checkout_failed')
     ORDER BY created_at DESC LIMIT 100`,
    [account.id],
  )
  const rows = result.rows.map((row) => ({
    provider: row.provider,
    txRef: row.tx_ref,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    providerReference: row.provider_reference,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }))
  return json(res, 200, { payments: rows })
}

async function createPolarCheckout(account, res) {
  if (!process.env.POLAR_ACCESS_TOKEN || !process.env.POLAR_PRODUCT_ID) return json(res, 503, { error: 'Polar checkout is not configured.' })
  const response = await fetch(`${polarApiBaseUrl}/checkouts/`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.POLAR_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      products: [process.env.POLAR_PRODUCT_ID],
      external_customer_id: account.id,
      success_url: process.env.CHECKOUT_SUCCESS_URL || 'https://daylens.app/billing/success',
      return_url: process.env.CHECKOUT_RETURN_URL || process.env.CHECKOUT_SUCCESS_URL || 'https://daylens.app/billing',
      metadata: { account_id: account.id },
      customer_metadata: { daylens_account_id: account.id },
    }),
  })
  const payload = await response.json()
  if (!response.ok || !payload.url) return json(res, 502, { error: payload.detail || 'Polar checkout could not be created.' })
  return json(res, 200, { url: payload.url })
}

async function createFlutterwaveCheckout(account, req, res) {
  if (!process.env.FLUTTERWAVE_SECRET_KEY) return json(res, 503, { error: 'Flutterwave checkout is not configured.' })
  const parsed = await body(req, 64_000)
  const email = String(parsed.json.email || '').trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'Enter a valid email for the payment receipt.' })
  const txRef = `daylens-${account.id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  await pool.query(
    `INSERT INTO billing_payment_intents (provider, tx_ref, account_id, amount, currency)
     VALUES ('flutterwave', $1, $2, $3, 'RWF')`,
    [txRef, account.id, localPassAmount],
  )
  const response = await fetch(`${flutterwaveApiBaseUrl}/payments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      tx_ref: txRef,
      amount: localPassAmount,
      currency: 'RWF',
      redirect_url: process.env.CHECKOUT_SUCCESS_URL || 'https://daylens.app/billing/success',
      payment_options: 'mobilemoneyrwanda',
      customer: { email },
      customizations: { title: 'Daylens — 30 days of managed AI' },
      meta: { account_id: account.id, access_days: 30 },
    }),
  })
  const payload = await response.json()
  const url = payload?.data?.link
  if (!response.ok || !url) {
    await pool.query(
      `UPDATE billing_payment_intents SET status = 'checkout_failed', updated_at = now()
       WHERE provider = 'flutterwave' AND tx_ref = $1`,
      [txRef],
    )
    return json(res, 502, { error: payload.message || 'Flutterwave checkout could not be created.' })
  }
  await pool.query(
    `UPDATE billing_payment_intents SET checkout_url = $1, updated_at = now()
     WHERE provider = 'flutterwave' AND tx_ref = $2`,
    [url, txRef],
  )
  await pool.query('UPDATE billing_accounts SET customer_email = $1, updated_at = now() WHERE id = $2', [email, account.id])
  return json(res, 200, { url })
}

async function createPolarPortalSession(account, res) {
  if (!process.env.POLAR_ACCESS_TOKEN) return json(res, 503, { error: 'Polar customer portal is not configured.' })
  const body = account.polar_customer_id
    ? { customer_id: account.polar_customer_id }
    : { external_customer_id: account.id }
  const response = await fetch(`${polarApiBaseUrl}/customer-sessions/`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.POLAR_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      ...body,
      return_url: process.env.CHECKOUT_RETURN_URL || process.env.CHECKOUT_SUCCESS_URL || 'https://daylens.app/billing',
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.customer_portal_url) {
    return json(res, 502, { error: payload.detail || 'Polar portal could not be opened.' })
  }
  return json(res, 200, { url: payload.customer_portal_url })
}

function verifyStandardWebhook(req, raw, secret) {
  const id = req.headers['webhook-id']
  const timestamp = req.headers['webhook-timestamp']
  const signatures = String(req.headers['webhook-signature'] || '').split(' ')
  if (!id || !timestamp || !secret) return false
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(ageSeconds) || ageSeconds > 5 * 60) return false
  // Polar exposes a raw `polar_whs_...` value. Their Standard Webhooks helper
  // base64-encodes then decodes it; direct HMAC therefore uses the entire raw
  // UTF-8 secret as the key.
  const secretBytes = Buffer.from(secret, 'utf8')
  const expected = crypto.createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${raw}`).digest('base64')
  return signatures.some((entry) => {
    const candidate = entry.replace(/^v1,/, '')
    return safeEqualString(candidate, expected)
  })
}

async function rememberPaymentEvent(client, provider, eventId) {
  if (!eventId) throw new Error('missing_payment_event_id')
  const inserted = await client.query(
    `INSERT INTO billing_payment_events (provider, event_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING event_id`,
    [provider, eventId],
  )
  if (inserted.rows[0]) return true
  const existing = await client.query(
    `SELECT processed_at FROM billing_payment_events WHERE provider = $1 AND event_id = $2 FOR UPDATE`,
    [provider, eventId],
  )
  return Boolean(existing.rows[0] && !existing.rows[0].processed_at)
}

async function markPaymentEventProcessed(client, provider, eventId) {
  await client.query(
    `UPDATE billing_payment_events SET processed_at = now(), last_error = NULL WHERE provider = $1 AND event_id = $2`,
    [provider, eventId],
  )
}

async function markPaymentEventFailed(provider, eventId, error) {
  await pool.query(
    `UPDATE billing_payment_events SET last_error = $3 WHERE provider = $1 AND event_id = $2`,
    [provider, eventId, String(error?.message || error).slice(0, 500)],
  )
}

async function polarWebhook(req, res) {
  const parsed = await body(req)
  if (!verifyStandardWebhook(req, parsed.raw, process.env.POLAR_WEBHOOK_SECRET)) return json(res, 401, { error: 'invalid_signature' })
  const event = parsed.json
  // Standard Webhooks defines webhook-id as the delivery/event id. Polar
  // payloads are not required to duplicate it in the JSON body.
  const eventId = String(req.headers['webhook-id'] || '')
  const data = event.data || {}
  const accountId = data.external_customer_id || data.metadata?.account_id || data.customer?.external_id
  const productId = data.product_id || data.product?.id
  const occurredAt = new Date(data.modified_at || event.created_at)
  const desiredState = event.type === 'subscription.revoked' || data.status === 'revoked'
    ? 'revoked'
    : event.type === 'subscription.canceled' || data.status === 'canceled' || data.cancel_at_period_end === true
      ? 'canceled'
      : 'active'
  const eventRank = { active: 1, canceled: 2, revoked: 3 }[desiredState]
  const incomingSubscriptionId = String(data.id || '')
  let shouldReconcile = false
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (!await rememberPaymentEvent(client, 'polar', eventId)) {
      await client.query('COMMIT')
      return json(res, 200, { ok: true })
    }
    if (!Number.isFinite(occurredAt.getTime())) throw new Error('missing_polar_event_timestamp')
    if (productId !== process.env.POLAR_PRODUCT_ID) {
      await markPaymentEventProcessed(client, 'polar', eventId)
      await client.query('COMMIT')
      return json(res, 200, { ok: true })
    }

    const currentResult = accountId
      ? await client.query('SELECT * FROM billing_accounts WHERE id = $1 FOR UPDATE', [accountId])
      : { rows: [] }
    const current = currentResult.rows[0]
    const subscriptionResult = incomingSubscriptionId
      ? await client.query(
        'SELECT * FROM billing_polar_subscriptions WHERE subscription_id = $1 FOR UPDATE',
        [incomingSubscriptionId],
      )
      : { rows: [] }
    const subscription = subscriptionResult.rows[0]
    const sameSubscription = Boolean(incomingSubscriptionId && incomingSubscriptionId === current?.polar_subscription_id)
    const previousAt = subscription?.event_occurred_at ? new Date(subscription.event_occurred_at).getTime() : -Infinity
    const isCurrent = occurredAt.getTime() > previousAt
      || (occurredAt.getTime() === previousAt && eventRank >= Number(subscription?.event_rank || 0))
    const accepted = isCurrent && !(subscription?.status === 'revoked' && desiredState === 'active')
    if (current && incomingSubscriptionId && accepted) {
      await client.query(
        `INSERT INTO billing_polar_subscriptions
         (subscription_id, account_id, status, event_occurred_at, event_rank)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (subscription_id) DO UPDATE SET status = EXCLUDED.status,
         event_occurred_at = EXCLUDED.event_occurred_at, event_rank = EXCLUDED.event_rank,
         updated_at = now()`,
        [incomingSubscriptionId, accountId, desiredState, occurredAt, eventRank],
      )
    }
    if (current && incomingSubscriptionId && accepted && (sameSubscription || !subscription) && desiredState === 'active' && ['subscription.active', 'subscription.created', 'subscription.updated', 'subscription.uncanceled'].includes(event.type)) {
      await client.query(
        `UPDATE billing_accounts SET plan = 'subscription', subscription_status = $1,
         period_started_at = COALESCE($2, now()), renewal_at = COALESCE($3, now() + interval '1 month'),
         polar_customer_id = COALESCE($4, polar_customer_id),
         polar_subscription_id = COALESCE($5, polar_subscription_id), polar_event_occurred_at = $6,
         polar_event_rank = $7, litellm_budget_sync_required = true, updated_at = now()
         WHERE id = $8`,
        [
          data.status || 'active',
          data.current_period_start || null,
          data.current_period_end || null,
          data.customer_id || data.customer?.id || null,
          data.id || null,
          occurredAt,
          eventRank,
          accountId,
        ],
      )
      shouldReconcile = true
    }
    if (current && sameSubscription && accepted && desiredState === 'canceled') {
      await client.query(
        `UPDATE billing_accounts SET subscription_status = 'canceled', polar_event_occurred_at = $1,
         polar_event_rank = $2, litellm_budget_sync_required = true, updated_at = now() WHERE id = $3`,
        [occurredAt, eventRank, accountId],
      )
      shouldReconcile = true
    }
    if (current && sameSubscription && accepted && desiredState === 'revoked') {
      await client.query(
        `UPDATE billing_accounts SET subscription_status = 'revoked', renewal_at = now(), polar_event_occurred_at = $1,
         polar_event_rank = $2, litellm_budget_sync_required = true, updated_at = now() WHERE id = $3`,
        [occurredAt, eventRank, accountId],
      )
      shouldReconcile = true
    }
    await markPaymentEventProcessed(client, 'polar', eventId)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    await markPaymentEventFailed('polar', eventId, error)
    throw error
  } finally {
    client.release()
  }
  if (shouldReconcile) await reconcileLiteLLMBudget(accountId)
  return json(res, 200, { ok: true })
}

async function flutterwaveWebhook(req, res) {
  const parsed = await body(req)
  if (!process.env.FLUTTERWAVE_SECRET_HASH || !safeEqualString(req.headers['verif-hash'], process.env.FLUTTERWAVE_SECRET_HASH)) {
    return json(res, 401, { error: 'invalid_signature' })
  }
  const event = parsed.json
  const eventId = String(event.id || event.data?.id || event.data?.tx_ref || '')
  let reconcileAccountId = null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (!await rememberPaymentEvent(client, 'flutterwave', eventId)) {
      await client.query('COMMIT')
      return json(res, 200, { ok: true })
    }
    const verified = await verifyFlutterwaveTransaction(event.data?.id)
    const data = verified.data || {}
    const txRef = String(data.tx_ref || '')
    if (!txRef) throw new Error('missing_verified_flutterwave_tx_ref')
    const intent = await client.query(
      `SELECT * FROM billing_payment_intents WHERE provider = 'flutterwave' AND tx_ref = $1 FOR UPDATE`,
      [txRef],
    )
    const payment = intent.rows[0]
    if (!payment) throw new Error('unknown_flutterwave_payment_intent')
    if (payment.status === 'successful') {
      await markPaymentEventProcessed(client, 'flutterwave', eventId)
      await client.query('COMMIT')
      return json(res, 200, { ok: true })
    }
    if (data.status !== 'successful') {
      await client.query(
        `UPDATE billing_payment_intents SET status = $1, provider_reference = $2, updated_at = now()
         WHERE provider = 'flutterwave' AND tx_ref = $3`,
        [data.status || 'failed', String(data.id || ''), txRef],
      )
      await markPaymentEventProcessed(client, 'flutterwave', eventId)
      await client.query('COMMIT')
      return json(res, 200, { ok: true })
    }
    if (data.currency !== payment.currency || Number(data.amount) !== Number(payment.amount)) {
      throw new Error('flutterwave_payment_mismatch')
    }
    await client.query(
      `UPDATE billing_payment_intents SET status = 'successful', provider_reference = $1, updated_at = now()
       WHERE provider = 'flutterwave' AND tx_ref = $2`,
      [String(data.id || ''), txRef],
    )
    await client.query(
      `UPDATE billing_accounts SET plan = 'local_pass',
       local_pass_expires_at = GREATEST(COALESCE(local_pass_expires_at, now()), now()) + interval '30 days',
       period_started_at = now(), customer_email = COALESCE($1, customer_email),
       litellm_budget_sync_required = true, updated_at = now()
       WHERE id = $2`,
      [data.customer?.email || event.data?.customer?.email || null, payment.account_id],
    )
    reconcileAccountId = payment.account_id
    await markPaymentEventProcessed(client, 'flutterwave', eventId)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    await markPaymentEventFailed('flutterwave', eventId, error)
    throw error
  } finally {
    client.release()
  }
  if (reconcileAccountId) await reconcileLiteLLMBudget(reconcileAccountId)
  return json(res, 200, { ok: true })
}

async function verifyFlutterwaveTransaction(id) {
  if (!id) throw new Error('missing_flutterwave_transaction_id')
  const response = await fetch(`${flutterwaveApiBaseUrl}/transactions/${encodeURIComponent(id)}/verify`, {
    headers: { authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.status !== 'success') {
    throw new Error(payload.message || 'flutterwave_verification_failed')
  }
  return payload
}

// Intercom Identity Verification: user_hash = HMAC-SHA256(user_id, IV secret).
// The IV secret lives only in this service's .env — the desktop client must never
// bundle it (anything in the Electron bundle is extractable), so the hash is
// computed here and returned to the app.
async function intercomUserHash(account, req, res) {
  const secret = process.env.INTERCOM_IDENTITY_VERIFICATION_SECRET
  if (!secret) return json(res, 503, { error: 'Intercom identity verification is not configured yet.' })
  await body(req, 10_000)
  const userId = account.id
  return json(res, 200, {
    userId,
    userHash: crypto.createHmac('sha256', secret).update(userId).digest('hex'),
  })
}

async function reserveManagedSpend(accountId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query('SELECT * FROM billing_accounts WHERE id = $1 FOR UPDATE', [accountId])
    const account = locked.rows[0]
    if (!account) throw new Error('invalid_token')
    const mode = accessMode(account)
    if (mode === 'none') {
      await client.query('ROLLBACK')
      return { status: 402, error: 'AI access is paused. Subscribe or add your own key.' }
    }
    const reserved = account.spend_reserved_until && new Date(account.spend_reserved_until).getTime() > Date.now()
      ? Number(account.spend_reserved_micros || 0)
      : 0
    const available = mode === 'free_credit'
      ? Number(account.free_credit_remaining_micros) - reserved
      : fairUseMicros - await periodSpendMicros(account, client) - reserved
    if (available <= 0) {
      await client.query('ROLLBACK')
      return {
        status: mode === 'free_credit' ? 402 : 429,
        error: mode === 'free_credit'
          ? 'AI access is paused. Subscribe or add your own key.'
          : 'This plan reached its fair-use ceiling for the current period.',
      }
    }
    await client.query(
      `UPDATE billing_accounts SET spend_reserved_micros = $1,
       spend_reserved_until = now() + interval '2 minutes', updated_at = now() WHERE id = $2`,
      [available, account.id],
    )
    await client.query('COMMIT')
    return { account, mode, amountMicros: available }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function releaseManagedSpend(accountId, amountMicros) {
  await pool.query(
    `UPDATE billing_accounts SET spend_reserved_micros = 0,
     spend_reserved_until = NULL, updated_at = now()
     WHERE id = $2 AND spend_reserved_micros = $1`,
    [amountMicros, accountId],
  )
}

async function managedCompletion(req, res) {
  const tokenAccount = await accountForToken(req, 'ai')
  const parsed = await body(req)
  const feature = String(req.headers['x-daylens-feature'] || 'ai')
  await reconcileLiteLLMBudget(tokenAccount.id)
  const reservation = await reserveManagedSpend(tokenAccount.id)
  if (reservation.status) return json(res, reservation.status, { error: reservation.error })

  let payload
  let costUsd
  let usage
  const { account, mode, amountMicros } = reservation
  let upstream
  try {
    upstream = await fetch(`${litellmUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${decrypt(account.litellm_key_cipher)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ...parsed.json,
        model: economyModelConfigured && parsed.json?.model === litellmEconomyModelAlias
          ? litellmEconomyModelAlias
          : litellmModelAlias,
        stream: false,
        metadata: { account_id: account.id, feature },
      }),
      signal: AbortSignal.timeout(90_000),
    })
    payload = await upstream.json()
    if (!upstream.ok) {
      await releaseManagedSpend(account.id, amountMicros)
      return json(res, upstream.status, { error: payload?.error?.message || 'Managed AI provider failed.' })
    }
    costUsd = Number(upstream.headers.get('x-litellm-response-cost') || payload?._hidden_params?.response_cost)
    if (!Number.isFinite(costUsd) || costUsd < 0) {
      await releaseManagedSpend(account.id, amountMicros)
      return json(res, 502, { error: 'The provider answered, but its cost could not be metered safely. Please retry.' })
    }
    const costMicros = Math.round(costUsd * 1_000_000)
    if (costMicros > amountMicros) {
      await releaseManagedSpend(account.id, amountMicros)
      return json(res, 502, { error: 'The provider response exceeded the reserved spend limit and was discarded safely.' })
    }
    usage = payload.usage || {}
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const locked = await client.query('SELECT * FROM billing_accounts WHERE id = $1 FOR UPDATE', [account.id])
      if (!locked.rows[0]) throw new Error('billing_account_not_found')
      await client.query(
        `INSERT INTO billing_usage
         (account_id, mode, feature, provider, model, input_tokens, output_tokens, cost_micros, success, request_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9)`,
        [account.id, mode, feature, managedProvider, payload.model || managedModel, usage.prompt_tokens || null, usage.completion_tokens || null, costMicros, payload.id || null],
      )
      if (mode === 'free_credit') {
        const charged = await client.query(
          `UPDATE billing_accounts SET free_credit_remaining_micros = free_credit_remaining_micros - $1,
           spend_reserved_micros = 0, spend_reserved_until = NULL, updated_at = now()
           WHERE id = $3 AND free_credit_remaining_micros >= $1 RETURNING id`,
          [costMicros, amountMicros, account.id],
        )
        if (!charged.rows[0]) throw new Error('reserved_spend_settlement_failed')
      } else {
        await client.query(
          `UPDATE billing_accounts SET spend_reserved_micros = 0,
           spend_reserved_until = NULL, updated_at = now()
           WHERE id = $2 AND spend_reserved_micros = $1`,
          [amountMicros, account.id],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    if (!upstream) await releaseManagedSpend(account.id, amountMicros).catch(() => {})
    throw error
  }

  const text = payload.choices?.[0]?.message?.content || ''
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  const pieces = text.match(/.{1,180}(?:\s|$)/gs) || [text]
  for (const piece of pieces) {
    res.write(`data: ${JSON.stringify({
      id: payload.id,
      object: 'chat.completion.chunk',
      model: payload.model || managedModel,
      choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
    })}\n\n`)
  }
  res.write(`data: ${JSON.stringify({
    id: payload.id,
    object: 'chat.completion.chunk',
    model: payload.model || managedModel,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage,
    daylens_cost_usd: costUsd,
  })}\n\n`)
  res.end('data: [DONE]\n\n')
}

async function usage(account, url, res) {
  const from = new Date(Number(url.searchParams.get('from')))
  const to = new Date(Number(url.searchParams.get('to')))
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return json(res, 400, { error: 'Invalid usage range.' })
  const result = await pool.query(
    `SELECT id, occurred_at, mode, feature, provider, model, input_tokens, output_tokens, cost_micros, success
     FROM billing_usage WHERE account_id = $1 AND occurred_at >= $2 AND occurred_at < $3
     ORDER BY occurred_at DESC LIMIT 2000`,
    [account.id, from, to],
  )
  const rows = result.rows.map((row) => ({
    id: row.id,
    occurredAt: new Date(row.occurred_at).getTime(),
    type: row.mode,
    feature: row.feature,
    provider: row.provider,
    model: row.model,
    inputTokens: row.input_tokens == null ? null : Number(row.input_tokens),
    outputTokens: row.output_tokens == null ? null : Number(row.output_tokens),
    tokens: Number(row.input_tokens || 0) + Number(row.output_tokens || 0),
    costUsd: Number(row.cost_micros) / 1_000_000,
    success: row.success,
  }))
  const points = new Map()
  for (const row of rows) {
    const day = new Date(row.occurredAt).toISOString().slice(0, 10)
    const model = row.model || 'Unknown model'
    const key = `${day}:${model}`
    const point = points.get(key) || { day, model, spendUsd: 0, tokens: 0 }
    point.spendUsd += row.costUsd
    point.tokens += row.tokens
    points.set(key, point)
  }
  const totalSpendUsd = rows.reduce((sum, row) => sum + row.costUsd, 0)
  return json(res, 200, {
    from: from.getTime(),
    to: to.getTime(),
    totalSpendUsd,
    totalTokens: rows.reduce((sum, row) => sum + row.tokens, 0),
    freeCreditUsedUsd: rows.filter((row) => row.type === 'free_credit').reduce((sum, row) => sum + row.costUsd, 0),
    paidSpendUsd: rows.filter((row) => row.type !== 'free_credit').reduce((sum, row) => sum + row.costUsd, 0),
    points: [...points.values()].sort((a, b) => a.day.localeCompare(b.day)),
    rows,
  })
}

async function route(req, res) {
  const url = new URL(req.url, publicBaseUrl)
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true })
  if (req.method === 'POST' && url.pathname === '/v1/installations/bootstrap') return bootstrap(req, res)
  if (req.method === 'POST' && url.pathname === '/v1/webhooks/polar') return polarWebhook(req, res)
  if (req.method === 'POST' && url.pathname === '/v1/webhooks/flutterwave') return flutterwaveWebhook(req, res)
  if (req.method === 'POST' && url.pathname === '/v1/managed/chat/completions') return managedCompletion(req, res)

  const account = await accountForToken(req)
  if (req.method === 'GET' && url.pathname === '/v1/billing') return json(res, 200, await billingSnapshot(account))
  if (req.method === 'GET' && url.pathname === '/v1/usage') return usage(account, url, res)
  if (req.method === 'GET' && url.pathname === '/v1/payments') return payments(account, res)
  if (req.method === 'POST' && url.pathname === '/v1/installations/rotate-token') return rotateInstallationToken(account, req, res)
  if (req.method === 'POST' && url.pathname === '/v1/ai/session') {
    const snapshot = await billingSnapshot(account)
    if (!snapshot.canUseAI) return json(res, 402, { error: snapshot.message })
    return json(res, 200, {
      accessToken: signToken({ type: 'ai', accountId: account.id, ver: account.installation_token_version }, 600),
      baseUrl: `${publicBaseUrl}/v1/managed`,
      provider: managedProvider,
      model: managedModel,
      economyModel: economyModelConfigured ? litellmEconomyModelAlias : null,
      mode: snapshot.mode,
    })
  }
  if (req.method === 'POST' && url.pathname === '/v1/intercom/user-hash') return intercomUserHash(account, req, res)
  if (req.method === 'POST' && url.pathname === '/v1/checkout/polar') return createPolarCheckout(account, res)
  if (req.method === 'POST' && url.pathname === '/v1/checkout/flutterwave') return createFlutterwaveCheckout(account, req, res)
  if (req.method === 'POST' && url.pathname === '/v1/billing/portal') {
    if (!account.polar_customer_id) return json(res, 404, { error: 'No subscription portal is available yet.' })
    return createPolarPortalSession(account, res)
  }
  return json(res, 404, { error: 'Not found' })
}

http.createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error('[billing]', error)
    if (!res.headersSent) json(res, error.message === 'invalid_token' ? 401 : 500, { error: error.message === 'invalid_token' ? 'Session expired.' : 'Billing service error.' })
    else res.destroy(error)
  })
}).listen(port, () => {
  console.log(`[billing] listening on :${port}`)
})
