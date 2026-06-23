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
const fairUseMicros = Math.round(Number(process.env.SUBSCRIPTION_FAIR_USE_USD || 20) * 1_000_000)
const managedProvider = process.env.DAYLENS_MANAGED_PROVIDER || 'anthropic'
const managedModel = process.env.DAYLENS_MANAGED_MODEL || 'daylens-default'

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

function signToken(payload, ttlSeconds) {
  const body = base64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }))
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

async function generateLiteLLMKey(accountId) {
  const response = await fetch(`${litellmUrl}/key/generate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.LITELLM_MASTER_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      key_alias: `daylens-${accountId}`,
      max_budget: 5,
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

async function accountForToken(req, type = 'install') {
  const payload = verifyToken(bearer(req), type)
  const result = await pool.query('SELECT * FROM billing_accounts WHERE id = $1', [payload.accountId])
  if (!result.rows[0]) throw new Error('invalid_token')
  return result.rows[0]
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

async function periodSpendMicros(account) {
  const from = account.period_started_at || account.local_pass_expires_at
    ? account.period_started_at || new Date(new Date(account.local_pass_expires_at).getTime() - 30 * 86400000)
    : new Date(0)
  const result = await pool.query(
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
    portalAvailable: Boolean(account.polar_customer_id && process.env.POLAR_CUSTOMER_PORTAL_URL),
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
  return json(res, 200, { token: signToken({ type: 'install', accountId: account.id }, 90 * 86400) })
}

async function createPolarCheckout(account, res) {
  if (!process.env.POLAR_ACCESS_TOKEN || !process.env.POLAR_PRODUCT_ID) return json(res, 503, { error: 'Polar checkout is not configured.' })
  const response = await fetch('https://api.polar.sh/v1/checkouts/', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.POLAR_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      products: [process.env.POLAR_PRODUCT_ID],
      external_customer_id: account.id,
      success_url: process.env.CHECKOUT_SUCCESS_URL || 'https://daylens.app/billing/success',
      metadata: { account_id: account.id },
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
  const txRef = `daylens-${account.id}-${Date.now()}`
  const response = await fetch('https://api.flutterwave.com/v3/payments', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      tx_ref: txRef,
      amount: Number(process.env.FLUTTERWAVE_LOCAL_PASS_RWF || 15000),
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
  if (!response.ok || !url) return json(res, 502, { error: payload.message || 'Flutterwave checkout could not be created.' })
  await pool.query('UPDATE billing_accounts SET customer_email = $1, updated_at = now() WHERE id = $2', [email, account.id])
  return json(res, 200, { url })
}

function verifyStandardWebhook(req, raw, secret) {
  const id = req.headers['webhook-id']
  const timestamp = req.headers['webhook-timestamp']
  const signatures = String(req.headers['webhook-signature'] || '').split(' ')
  if (!id || !timestamp || !secret) return false
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = crypto.createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${raw}`).digest('base64')
  return signatures.some((entry) => {
    const candidate = entry.replace(/^v1,/, '')
    return candidate.length === expected.length && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))
  })
}

async function polarWebhook(req, res) {
  const parsed = await body(req)
  if (!verifyStandardWebhook(req, parsed.raw, process.env.POLAR_WEBHOOK_SECRET)) return json(res, 401, { error: 'invalid_signature' })
  const event = parsed.json
  const inserted = await pool.query(
    `INSERT INTO billing_payment_events (provider, event_id) VALUES ('polar', $1)
     ON CONFLICT DO NOTHING RETURNING event_id`,
    [event.id],
  )
  if (!inserted.rows[0]) return json(res, 200, { ok: true })
  const data = event.data || {}
  const accountId = data.external_customer_id || data.metadata?.account_id || data.customer?.external_id
  if (accountId && ['subscription.active', 'subscription.created', 'subscription.updated'].includes(event.type)) {
    await pool.query(
      `UPDATE billing_accounts SET plan = 'subscription', subscription_status = $1,
       period_started_at = COALESCE($2, now()), renewal_at = COALESCE($3, now() + interval '1 month'),
       polar_customer_id = COALESCE($4, polar_customer_id),
       polar_subscription_id = COALESCE($5, polar_subscription_id), updated_at = now()
       WHERE id = $6`,
      [
        data.status || 'active',
        data.current_period_start || null,
        data.current_period_end || null,
        data.customer_id || data.customer?.id || null,
        data.id || null,
        accountId,
      ],
    )
    const updated = await pool.query('SELECT * FROM billing_accounts WHERE id = $1', [accountId])
    if (updated.rows[0]) await setLiteLLMBudget(updated.rows[0], fairUseMicros / 1_000_000, '30d')
  }
  if (accountId && ['subscription.canceled', 'subscription.revoked'].includes(event.type)) {
    await pool.query(
      `UPDATE billing_accounts SET subscription_status = 'canceled', updated_at = now() WHERE id = $1`,
      [accountId],
    )
  }
  return json(res, 200, { ok: true })
}

async function flutterwaveWebhook(req, res) {
  const parsed = await body(req)
  if (!process.env.FLUTTERWAVE_SECRET_HASH || req.headers['verif-hash'] !== process.env.FLUTTERWAVE_SECRET_HASH) {
    return json(res, 401, { error: 'invalid_signature' })
  }
  const event = parsed.json
  const eventId = String(event.id || event.data?.id || event.data?.tx_ref || '')
  const inserted = await pool.query(
    `INSERT INTO billing_payment_events (provider, event_id) VALUES ('flutterwave', $1)
     ON CONFLICT DO NOTHING RETURNING event_id`,
    [eventId],
  )
  if (!inserted.rows[0]) return json(res, 200, { ok: true })
  const accountId = event.data?.meta?.account_id
  if (accountId && event.event === 'charge.completed' && event.data?.status === 'successful') {
    await pool.query(
      `UPDATE billing_accounts SET plan = 'local_pass',
       local_pass_expires_at = GREATEST(COALESCE(local_pass_expires_at, now()), now()) + interval '30 days',
       period_started_at = now(), customer_email = COALESCE($1, customer_email), updated_at = now()
       WHERE id = $2`,
      [event.data?.customer?.email || null, accountId],
    )
    const updated = await pool.query('SELECT * FROM billing_accounts WHERE id = $1', [accountId])
    if (updated.rows[0]) await setLiteLLMBudget(updated.rows[0], fairUseMicros / 1_000_000, '30d')
  }
  return json(res, 200, { ok: true })
}

async function managedCompletion(req, res) {
  const account = await accountForToken(req, 'ai')
  const mode = accessMode(account)
  if (mode === 'none') return json(res, 402, { error: 'AI access is paused. Subscribe or add your own key.' })
  if ((mode === 'subscription' || mode === 'local_pass') && await periodSpendMicros(account) >= fairUseMicros) {
    return json(res, 429, { error: 'This plan reached its fair-use ceiling for the current period.' })
  }
  const parsed = await body(req)
  const feature = String(req.headers['x-daylens-feature'] || 'ai')
  const upstream = await fetch(`${litellmUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${decrypt(account.litellm_key_cipher)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...parsed.json,
      model: managedModel,
      stream: false,
      metadata: { account_id: account.id, feature },
    }),
  })
  const payload = await upstream.json()
  if (!upstream.ok) return json(res, upstream.status, { error: payload?.error?.message || 'Managed AI provider failed.' })
  const costUsd = Number(upstream.headers.get('x-litellm-response-cost') || payload?._hidden_params?.response_cost)
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    return json(res, 502, { error: 'The provider answered, but its cost could not be metered safely. Please retry.' })
  }
  const costMicros = Math.round(costUsd * 1_000_000)
  const usage = payload.usage || {}
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO billing_usage
       (account_id, mode, feature, provider, model, input_tokens, output_tokens, cost_micros, success, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9)`,
      [account.id, mode, feature, managedProvider, payload.model || managedModel, usage.prompt_tokens || null, usage.completion_tokens || null, costMicros, payload.id || null],
    )
    if (mode === 'free_credit') {
      await client.query(
        `UPDATE billing_accounts SET free_credit_remaining_micros =
         GREATEST(0, free_credit_remaining_micros - $1), updated_at = now() WHERE id = $2`,
        [costMicros, account.id],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
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
  if (req.method === 'POST' && url.pathname === '/v1/ai/session') {
    const snapshot = await billingSnapshot(account)
    if (!snapshot.canUseAI) return json(res, 402, { error: snapshot.message })
    return json(res, 200, {
      accessToken: signToken({ type: 'ai', accountId: account.id }, 600),
      baseUrl: `${publicBaseUrl}/v1/managed`,
      provider: managedProvider,
      model: managedModel,
      mode: snapshot.mode,
    })
  }
  if (req.method === 'POST' && url.pathname === '/v1/checkout/polar') return createPolarCheckout(account, res)
  if (req.method === 'POST' && url.pathname === '/v1/checkout/flutterwave') return createFlutterwaveCheckout(account, req, res)
  if (req.method === 'POST' && url.pathname === '/v1/billing/portal') {
    if (!account.polar_customer_id || !process.env.POLAR_CUSTOMER_PORTAL_URL) return json(res, 404, { error: 'No subscription portal is available yet.' })
    return json(res, 200, { url: process.env.POLAR_CUSTOMER_PORTAL_URL })
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
