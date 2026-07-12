// Daylens billing sandbox — dev-only end-to-end harness.
//
// Runs services/billing/src/server.mjs on this machine with NO external accounts:
//   • storage  → in-memory pg-shim (loaded in place of `pg`)
//   • LiteLLM  → fake upstream returning a canned completion + fake cost header
//   • Polar    → fake checkout / customer-session endpoints
//   • Flutterwave → fake payment / transaction-verify endpoints
//
// Then it scripts the README's 10 smoke checks against the live HTTP API, signing
// the Polar and Flutterwave webhooks with the sandbox's own secrets.
//
// It can NEVER run in production: it refuses if NODE_ENV=production, and forces a
// dev environment for the server it boots.
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import { register } from 'node:module'
import { readFile } from 'node:fs/promises'

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run the billing sandbox with NODE_ENV=production.')
  process.exit(1)
}

const randHex = () => crypto.randomBytes(6).toString('hex')
const randSecret = () => crypto.randomBytes(48).toString('base64')

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => resolve(data))
  })
}

// ── Fake upstreams (LiteLLM + Polar + Flutterwave) on one server ────────────
const fake = { flwById: new Map(), flwByAccount: new Map(), lastChatModel: null, omitVerifiedTxRef: false }

function startFakeUpstream(port) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const { pathname } = new URL(req.url, 'http://x')
      const raw = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : ''
      let body = {}
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch {
        body = {}
      }
      const send = (code, obj, headers = {}) => {
        res.writeHead(code, { 'content-type': 'application/json', ...headers })
        res.end(JSON.stringify(obj))
      }

      // LiteLLM
      if (pathname === '/key/generate') return send(200, { key: `sk-fake-${randHex()}` })
      if (pathname === '/key/update') return send(200, {})
      if (pathname === '/chat/completions') {
        // Record the model the billing server forwarded. Real LiteLLM matches this against
        // its `model_name` list, so it MUST be the alias, not the real upstream model.
        fake.lastChatModel = body.model
        const feature = body?.metadata?.feature
        const cost = feature === 'drain' ? 5.0 : feature === 'oversize' ? 6.0 : feature === 'race' ? 5.0 : 0.0123
        return send(
          200,
          {
            id: `chatcmpl-${randHex()}`,
            model: body.model || 'daylens-default',
            choices: [{ index: 0, message: { role: 'assistant', content: 'Sandbox canned completion.' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 42, completion_tokens: 18 },
            _hidden_params: { response_cost: cost },
          },
          { 'x-litellm-response-cost': String(cost) },
        )
      }

      // Polar
      if (pathname === '/polar/checkouts/') return send(200, { url: `https://sandbox.polar.test/checkout/${randHex()}` })
      if (pathname === '/polar/customer-sessions/') return send(200, { customer_portal_url: `https://sandbox.polar.test/portal/${randHex()}` })

      // Flutterwave
      if (pathname === '/flutterwave/payments') {
        const id = `flw-${randHex()}`
        const rec = { id, tx_ref: body.tx_ref, amount: body.amount, currency: body.currency, email: body?.customer?.email }
        fake.flwById.set(id, rec)
        if (body?.meta?.account_id) fake.flwByAccount.set(body.meta.account_id, rec)
        return send(200, { status: 'success', message: 'ok', data: { id, link: `https://sandbox.flutterwave.test/pay/${id}` } })
      }
      const verify = pathname.match(/^\/flutterwave\/transactions\/([^/]+)\/verify$/)
      if (verify) {
        const rec = fake.flwById.get(decodeURIComponent(verify[1]))
        if (!rec) return send(404, { status: 'error', message: 'unknown transaction' })
        return send(200, {
          status: 'success',
          message: 'ok',
          data: { id: rec.id, ...(!fake.omitVerifiedTxRef ? { tx_ref: rec.tx_ref } : {}), status: 'successful', currency: rec.currency, amount: rec.amount, customer: { email: rec.email } },
        })
      }

      send(404, { error: `fake upstream: no route for ${pathname}` })
    })
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

// ── Boot ────────────────────────────────────────────────────────────────────
const PORT = await freePort()
const UPSTREAM = await freePort()
const BASE = `http://127.0.0.1:${PORT}`

process.env.NODE_ENV = 'development'
process.env.PORT = String(PORT)
process.env.PUBLIC_BASE_URL = BASE
process.env.DATABASE_URL = 'postgres://sandbox/in-memory'
process.env.SESSION_SECRET = randSecret()
process.env.INSTALLATION_HASH_SECRET = randSecret()
process.env.LITELLM_KEY_ENCRYPTION_SECRET = randSecret()
process.env.LITELLM_URL = `http://127.0.0.1:${UPSTREAM}`
process.env.LITELLM_MASTER_KEY = 'sk-litellm-sandbox-master'
process.env.DAYLENS_MANAGED_PROVIDER = 'anthropic'
// A realistic upstream model (as production would set it). The server must still forward
// the alias `daylens-default` to LiteLLM, not this string — check 2 asserts exactly that.
process.env.DAYLENS_MANAGED_MODEL = 'anthropic/claude-sonnet-4-6'
process.env.SUBSCRIPTION_FAIR_USE_USD = '20'
process.env.FLUTTERWAVE_LOCAL_PASS_RWF = '15000'
process.env.POLAR_API_BASE_URL = `http://127.0.0.1:${UPSTREAM}/polar`
process.env.POLAR_ACCESS_TOKEN = 'polar-sandbox-token'
process.env.POLAR_PRODUCT_ID = 'polar-sandbox-product'
process.env.POLAR_WEBHOOK_SECRET = `polar_whs_${randHex()}${randHex()}`
process.env.FLUTTERWAVE_API_BASE_URL = `http://127.0.0.1:${UPSTREAM}/flutterwave`
process.env.FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST-sandbox'
process.env.FLUTTERWAVE_SECRET_HASH = `sandbox-verif-hash-${randHex()}`
process.env.INTERCOM_IDENTITY_VERIFICATION_SECRET = randSecret()
const LOCAL_PASS_RWF = Number(process.env.FLUTTERWAVE_LOCAL_PASS_RWF)

const fakeServer = await startFakeUpstream(UPSTREAM)
register('./loader.mjs', import.meta.url) // map `pg` -> in-memory shim
await import('../src/server.mjs') // boots and listens on PORT
const { sandboxControl, sandboxState } = await import('./pg-shim.mjs')

// Wait for /health.
for (let i = 0; i < 100; i++) {
  try {
    const r = await fetch(`${BASE}/health`)
    if (r.ok) break
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 50))
}

// ── HTTP helpers ──────────────────────────────────────────────────────────
async function api(path, { method = 'GET', token, body, headers } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  })
  const text = await res.text()
  let json = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { _raw: text }
  }
  return { status: res.status, json }
}

function accountIdFromToken(token) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')).accountId
}

async function bootstrapInstall(label) {
  const installationId = `sandbox-install-${label}-${randHex()}${randHex()}`
  const res = await api('/v1/installations/bootstrap', { method: 'POST', body: { installationId } })
  return res.json.token
}

async function bootstrapFixture(label) {
  const installationId = `sandbox-install-${label}-${randHex()}${randHex()}`
  const res = await api('/v1/installations/bootstrap', { method: 'POST', body: { installationId } })
  return { installationId, token: res.json.token }
}

async function managedCall(session, feature = 'chat') {
  const res = await fetch(`${session.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken}`, 'x-daylens-feature': feature },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Say hi from the sandbox.' }] }),
  })
  const text = await res.text()
  let cost = null
  let content = ''
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (data === '[DONE]') continue
    try {
      const obj = JSON.parse(data)
      if (typeof obj.daylens_cost_usd === 'number') cost = obj.daylens_cost_usd
      const piece = obj.choices?.[0]?.delta?.content
      if (piece) content += piece
    } catch {
      // ignore non-JSON SSE lines
    }
  }
  return { status: res.status, cost, content }
}

function polarSignature(secret, id, ts, raw) {
  // Polar tells Standard Webhooks callers to base64-encode the complete raw
  // secret. That library decodes it before HMAC, so the effective key here is
  // the complete raw UTF-8 secret bytes.
  const bytes = Buffer.from(secret, 'utf8')
  return crypto.createHmac('sha256', bytes).update(`${id}.${ts}.${raw}`).digest('base64')
}

async function sendPolarWebhook(eventId, type, accountId, {
  productId = process.env.POLAR_PRODUCT_ID,
  occurredAt = new Date(),
  includeBodyId = true,
  signatureSecret = process.env.POLAR_WEBHOOK_SECRET,
  headerTimestamp = null,
  subscriptionId = `polar-sub-${accountId.slice(0, 8)}`,
} = {}) {
  const payload = {
    ...(includeBodyId ? { id: eventId } : {}),
    type,
    created_at: occurredAt.toISOString(),
    data: {
      external_customer_id: accountId,
      status: 'active',
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      customer_id: `polar-cust-${accountId.slice(0, 8)}`,
      id: subscriptionId,
      product_id: productId,
    },
  }
  const raw = JSON.stringify(payload)
  const id = `msg_${randHex()}`
  const ts = headerTimestamp ?? Math.floor(Date.now() / 1000)
  const res = await fetch(`${BASE}/v1/webhooks/polar`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(ts),
      'webhook-signature': `v1,${polarSignature(signatureSecret, id, ts, raw)}`,
    },
    body: raw,
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

async function sendFlutterwaveWebhook(eventId, accountId) {
  const rec = fake.flwByAccount.get(accountId)
  const payload = {
    event: 'charge.completed',
    id: eventId,
    data: { id: rec.id, tx_ref: rec.tx_ref, status: 'successful', amount: rec.amount, currency: rec.currency, customer: { email: rec.email } },
  }
  const res = await fetch(`${BASE}/v1/webhooks/flutterwave`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'verif-hash': process.env.FLUTTERWAVE_SECRET_HASH },
    body: JSON.stringify(payload),
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

// ── Smoke checks ────────────────────────────────────────────────────────────
const results = []
function check(n, title, passed, detail) {
  results.push({ n, title, passed, detail })
  const tag = passed === null ? 'SKIP' : passed ? 'PASS' : 'FAIL'
  console.log(`  ${tag}  ${n}. ${title}${detail ? `\n          ${detail}` : ''}`)
}

console.log(`\nDaylens billing sandbox`)
console.log(`  billing service : ${BASE}`)
console.log(`  fake upstreams  : http://127.0.0.1:${UPSTREAM} (LiteLLM + Polar + Flutterwave)`)
console.log(`  store           : in-memory pg-shim (no Postgres, no Docker)\n`)

try {
  // 1 — fresh install shows $5
  const tokenA = await bootstrapInstall('A')
  const billA0 = await api('/v1/billing', { token: tokenA })
  check(
    1,
    'Fresh install bootstraps and shows $5.00 free credit',
    billA0.status === 200 && billA0.json.mode === 'free_credit' && billA0.json.creditRemainingUsd === 5,
    `mode=${billA0.json.mode}, credit=$${billA0.json.creditRemainingUsd}`,
  )

  // 2 — one managed call meters and reduces credit
  const sessA = (await api('/v1/ai/session', { method: 'POST', token: tokenA, body: {} })).json
  const callA = await managedCall(sessA, 'chat')
  const billA1 = await api('/v1/billing', { token: tokenA })
  const dropped = billA0.json.creditRemainingUsd - billA1.json.creditRemainingUsd
  check(
    2,
    'One managed AI call records usage and reduces free credit by provider cost',
    callA.status === 200 && callA.cost > 0 && Math.abs(dropped - callA.cost) < 1e-6 && billA1.json.creditRemainingUsd < 5
      && fake.lastChatModel === 'daylens-default',
    `metered cost=$${callA.cost}, credit $5 → $${billA1.json.creditRemainingUsd.toFixed(6)}, model forwarded to LiteLLM="${fake.lastChatModel}" (must be the alias)`,
  )

  // 3 — Polar checkout returns a URL
  const polarCheckout = await api('/v1/checkout/polar', { method: 'POST', token: tokenA, body: {} })
  check(
    3,
    'Polar subscription checkout returns a Polar URL',
    polarCheckout.status === 200 && /^https?:\/\//.test(polarCheckout.json.url || ''),
    polarCheckout.json.url,
  )

  // 4 — Polar webhook activates subscription
  const accA = accountIdFromToken(tokenA)
  const polarHook = await sendPolarWebhook(`polar-evt-${randHex()}`, 'subscription.active', accA)
  const billA2 = await api('/v1/billing', { token: tokenA })
  check(
    4,
    'Polar subscription webhook sets plan to subscription',
    polarHook.status === 200 && billA2.json.mode === 'subscription',
    `webhook=${polarHook.status}, mode=${billA2.json.mode}, status=${billA2.json.subscriptionStatus}`,
  )

  // 5 — Polar customer portal opens
  const portal = await api('/v1/billing/portal', { method: 'POST', token: tokenA, body: {} })
  check(5, 'Polar portal opens from Settings → Billing', portal.status === 200 && /^https?:\/\//.test(portal.json.url || ''), portal.json.url)

  // 6 — Flutterwave checkout returns a URL (fresh install B)
  const tokenB = await bootstrapInstall('B')
  const flwCheckout = await api('/v1/checkout/flutterwave', { method: 'POST', token: tokenB, body: { email: 'sandbox@daylens.test' } })
  check(
    6,
    'Flutterwave checkout returns a hosted payment URL',
    flwCheckout.status === 200 && /^https?:\/\//.test(flwCheckout.json.url || ''),
    flwCheckout.json.url,
  )

  // 7 — Flutterwave webhook grants a 30-day local pass
  const accB = accountIdFromToken(tokenB)
  const flwHook = await sendFlutterwaveWebhook('flw-evt-B', accB)
  const billB1 = await api('/v1/billing', { token: tokenB })
  const expiry = billB1.json.localPassExpiresAt
  check(
    7,
    'Flutterwave webhook grants a 30-day local pass',
    flwHook.status === 200 && billB1.json.mode === 'local_pass' && expiry && expiry > Date.now() + 25 * 86_400_000,
    `webhook=${flwHook.status}, mode=${billB1.json.mode}, expires in ~${Math.round((expiry - Date.now()) / 86_400_000)} days`,
  )

  // 8 — replaying the same webhook does not extend access twice
  const flwReplay = await sendFlutterwaveWebhook('flw-evt-B', accB)
  const billB2 = await api('/v1/billing', { token: tokenB })
  check(
    8,
    'Replaying the same webhook does not extend access twice',
    flwReplay.status === 200 && billB2.json.localPassExpiresAt === expiry,
    `replay=${flwReplay.status}, expiry unchanged=${billB2.json.localPassExpiresAt === expiry}`,
  )

  // 9 — removing all access pauses AI (fresh install C, drained in one call)
  const tokenC = await bootstrapInstall('C')
  const sessC = (await api('/v1/ai/session', { method: 'POST', token: tokenC, body: {} })).json
  const drain = await managedCall(sessC, 'drain')
  const billC = await api('/v1/billing', { token: tokenC })
  const sessAfter = await api('/v1/ai/session', { method: 'POST', token: tokenC, body: {} })
  check(
    9,
    'Removing all managed access pauses AI without breaking capture/local views',
    drain.status === 200 && billC.json.mode === 'none' && billC.json.canUseAI === false && /paused/i.test(billC.json.message) && sessAfter.status === 402,
    `after drain: mode=${billC.json.mode}, canUseAI=${billC.json.canUseAI}, ai/session → ${sessAfter.status}; message: "${billC.json.message}"`,
  )

  // 10 — BYOK: desktop-side only, the backend never sees it
  check(
    10,
    'Adding a BYOK provider key makes calls go directly to the provider',
    null,
    'N/A for the backend harness — with an own key the desktop app calls the provider directly and never touches this service. Precedence (own-key over managed) lives in src/main/services/billing.ts + aiOrchestration.ts and is covered by tests/billingArchitecture.test.ts.',
  )

  const tokenProduct = await bootstrapInstall('polar-product')
  const productAccount = accountIdFromToken(tokenProduct)
  const wrongProduct = await sendPolarWebhook(`polar-wrong-product-${randHex()}`, 'subscription.active', productAccount, { productId: 'some-other-product' })
  const wrongProductBill = await api('/v1/billing', { token: tokenProduct })
  check(11, 'Polar grants only the configured Daylens product', wrongProduct.status === 200 && wrongProductBill.json.mode === 'free_credit', `webhook=${wrongProduct.status}, mode=${wrongProductBill.json.mode}`)

  const revokedAt = new Date()
  const cancel = await sendPolarWebhook(`polar-cancel-${randHex()}`, 'subscription.canceled', accA, { occurredAt: revokedAt })
  const billCanceled = await api('/v1/billing', { token: tokenA })
  const revoke = await sendPolarWebhook(`polar-revoke-${randHex()}`, 'subscription.revoked', accA, { occurredAt: revokedAt })
  const billRevoked = await api('/v1/billing', { token: tokenA })
  await sendPolarWebhook(`polar-stale-${randHex()}`, 'subscription.active', accA, { occurredAt: revokedAt })
  const billAfterStale = await api('/v1/billing', { token: tokenA })
  check(12, 'Polar end-period cancellation stays active; revocation is immediate and terminal', cancel.status === 200 && billCanceled.json.mode === 'subscription' && revoke.status === 200 && billRevoked.json.mode !== 'subscription' && billAfterStale.json.mode !== 'subscription', `canceled=${billCanceled.json.mode}, revoked=${billRevoked.json.mode}, after stale=${billAfterStale.json.mode}`)

  const tokenD = await bootstrapInstall('D')
  await api('/v1/checkout/flutterwave', { method: 'POST', token: tokenD, body: { email: 'sandbox-d@daylens.test' } })
  fake.omitVerifiedTxRef = true
  const missingVerifiedRef = await sendFlutterwaveWebhook('flw-evt-D', accountIdFromToken(tokenD))
  fake.omitVerifiedTxRef = false
  const billD = await api('/v1/billing', { token: tokenD })
  check(13, 'Flutterwave never trusts webhook tx_ref when verification omits it', missingVerifiedRef.status >= 400 && billD.json.mode === 'free_credit', `webhook=${missingVerifiedRef.status}, mode=${billD.json.mode}`)

  const firstIdentity = await api('/v1/intercom/user-hash', { method: 'POST', token: tokenB, body: { userId: 'victim-user' } })
  const otherIdentity = await api('/v1/intercom/user-hash', { method: 'POST', token: tokenA, body: { userId: 'victim-user' } })
  const expectedHash = crypto.createHmac('sha256', process.env.INTERCOM_IDENTITY_VERIFICATION_SECRET).update(accB).digest('hex')
  check(14, 'Intercom identity is derived from the authenticated billing account', firstIdentity.status === 200 && firstIdentity.json.userId === accB && firstIdentity.json.userHash === expectedHash && otherIdentity.json.userId === accA && otherIdentity.json.userId !== firstIdentity.json.userId, `account B=${firstIdentity.json.userId}, account A=${otherIdentity.json.userId}`)

  const tokenFixture = await bootstrapFixture('token-rotation')
  const rotated = await api('/v1/installations/rotate-token', { method: 'POST', token: tokenFixture.token, body: { installationId: tokenFixture.installationId } })
  const oldTokenResult = await api('/v1/billing', { token: tokenFixture.token })
  const newTokenResult = await api('/v1/billing', { token: rotated.json.token })
  check(15, 'Installation token rotation immediately revokes the old bearer', rotated.status === 200 && oldTokenResult.status === 401 && newTokenResult.status === 200, `rotate=${rotated.status}, old=${oldTokenResult.status}, new=${newTokenResult.status}`)

  const tokenRace = await bootstrapInstall('spend-race')
  const raceSessionA = (await api('/v1/ai/session', { method: 'POST', token: tokenRace, body: {} })).json
  const raceSessionB = (await api('/v1/ai/session', { method: 'POST', token: tokenRace, body: {} })).json
  const raceCalls = await Promise.all([managedCall(raceSessionA, 'race'), managedCall(raceSessionB, 'race')])
  const raceBill = await api('/v1/billing', { token: tokenRace })
  check(16, 'Concurrent AI calls cannot both spend the same free-credit balance', raceCalls.filter((call) => call.status === 200).length === 1 && raceCalls.some((call) => call.status === 402) && raceBill.json.creditRemainingUsd === 0, `statuses=${raceCalls.map((call) => call.status).join(',')}, remaining=$${raceBill.json.creditRemainingUsd}`)

  const tokenConcurrentPayment = await bootstrapInstall('flutterwave-race')
  await api('/v1/checkout/flutterwave', { method: 'POST', token: tokenConcurrentPayment, body: { email: 'sandbox-race@daylens.test' } })
  const paymentAccount = accountIdFromToken(tokenConcurrentPayment)
  const concurrentHooks = await Promise.all([
    sendFlutterwaveWebhook(`flw-race-a-${randHex()}`, paymentAccount),
    sendFlutterwaveWebhook(`flw-race-b-${randHex()}`, paymentAccount),
  ])
  const concurrentBill = await api('/v1/billing', { token: tokenConcurrentPayment })
  const daysGranted = Math.round((concurrentBill.json.localPassExpiresAt - Date.now()) / 86_400_000)
  check(17, 'Concurrent Flutterwave deliveries grant one 30-day entitlement', concurrentHooks.every((hook) => hook.status === 200) && daysGranted === 30, `statuses=${concurrentHooks.map((hook) => hook.status).join(',')}, days=${daysGranted}`)

  const rootConfig = await readFile(new URL('../litellm-config.yaml', import.meta.url), 'utf8')
  const deployedConfig = await readFile(new URL('../litellm/litellm-config.yaml', import.meta.url), 'utf8')
  const aliases = (text) => [...text.matchAll(/^\s*- model_name:\s*(\S+)/gm)].map((match) => match[1]).sort().join(',')
  check(18, 'Railway LiteLLM config exposes every reviewed model alias', aliases(rootConfig) === aliases(deployedConfig) && aliases(deployedConfig).includes('daylens-economy'), `root=${aliases(rootConfig)}, deployed=${aliases(deployedConfig)}`)

  const tokenCrash = await bootstrapInstall('flutterwave-crash')
  await api('/v1/checkout/flutterwave', { method: 'POST', token: tokenCrash, body: { email: 'sandbox-crash@daylens.test' } })
  const crashAccount = accountIdFromToken(tokenCrash)
  sandboxControl.failNextContaining = "UPDATE billing_accounts SET plan = 'local_pass'"
  const crashedHook = await sendFlutterwaveWebhook('flw-crash-event', crashAccount)
  const crashBill = await api('/v1/billing', { token: tokenCrash })
  const retriedHook = await sendFlutterwaveWebhook('flw-crash-event', crashAccount)
  const recoveredBill = await api('/v1/billing', { token: tokenCrash })
  check(19, 'Flutterwave fulfillment rolls back fully and the same delivery recovers after a crash', crashedHook.status === 500 && crashBill.json.mode === 'free_credit' && retriedHook.status === 200 && recoveredBill.json.mode === 'local_pass', `crash=${crashedHook.status}/${crashBill.json.mode}, retry=${retriedHook.status}/${recoveredBill.json.mode}`)

  const tokenHeaderId = await bootstrapInstall('polar-header-id')
  const headerIdAccount = accountIdFromToken(tokenHeaderId)
  const headerOnlyEvent = await sendPolarWebhook(`polar-header-only-${randHex()}`, 'subscription.active', headerIdAccount, { includeBodyId: false })
  const headerIdBill = await api('/v1/billing', { token: tokenHeaderId })
  check(20, 'Polar idempotency uses the Standard Webhooks header id when the body has none', headerOnlyEvent.status === 200 && headerIdBill.json.mode === 'subscription', `webhook=${headerOnlyEvent.status}, mode=${headerIdBill.json.mode}`)

  const tokenSameDelivery = await bootstrapInstall('flutterwave-same-delivery')
  await api('/v1/checkout/flutterwave', { method: 'POST', token: tokenSameDelivery, body: { email: 'sandbox-same@daylens.test' } })
  const sameDeliveryAccount = accountIdFromToken(tokenSameDelivery)
  const sameDeliveryId = `flw-same-${randHex()}`
  const sameDeliveryHooks = await Promise.all([
    sendFlutterwaveWebhook(sameDeliveryId, sameDeliveryAccount),
    sendFlutterwaveWebhook(sameDeliveryId, sameDeliveryAccount),
  ])
  const sameDeliveryBill = await api('/v1/billing', { token: tokenSameDelivery })
  const sameDeliveryDays = Math.round((sameDeliveryBill.json.localPassExpiresAt - Date.now()) / 86_400_000)
  check(21, 'Two simultaneous copies of one Flutterwave delivery are claimed once', sameDeliveryHooks.every((hook) => hook.status === 200) && sameDeliveryDays === 30, `statuses=${sameDeliveryHooks.map((hook) => hook.status).join(',')}, days=${sameDeliveryDays}`)

  const rejectedSecret = await sendPolarWebhook(`polar-wrong-secret-${randHex()}`, 'subscription.active', headerIdAccount, {
    signatureSecret: `polar_whs_wrong_${randHex()}`,
  })
  const rejectedStale = await sendPolarWebhook(`polar-stale-header-${randHex()}`, 'subscription.active', headerIdAccount, {
    headerTimestamp: Math.floor(Date.now() / 1000) - 301,
  })
  check(22, 'Polar verification rejects the wrong raw secret and timestamps outside five minutes', rejectedSecret.status === 401 && rejectedStale.status === 401, `wrong-secret=${rejectedSecret.status}, stale=${rejectedStale.status}`)

  // The shim serializes transactions so rollback/crash behavior is testable,
  // but that is stronger than Postgres READ COMMITTED. Pin the production row
  // locks explicitly so removing either cannot be hidden by the harness.
  const serverSource = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8')
  const locksPaymentIntent = /billing_payment_intents[\s\S]{0,180}FOR UPDATE/.test(serverSource)
  const locksSpendAccount = /billing_accounts WHERE id = \$1 FOR UPDATE/.test(serverSource)
  const reservationCommit = serverSource.indexOf("await client.query('COMMIT')", serverSource.indexOf('async function reserveManagedSpend'))
  const providerCall = serverSource.indexOf("fetch(`${litellmUrl}/chat/completions`")
  check(23, 'Production concurrency guards lock payment intents and commit spend reservations before provider calls', locksPaymentIntent && locksSpendAccount && reservationCommit > 0 && reservationCommit < providerCall, `payment-intent=${locksPaymentIntent}, spend-account=${locksSpendAccount}, reservation-before-provider=${reservationCommit < providerCall}`)

  const oversizedToken = await bootstrapInstall('oversized-spend')
  const oversizedSession = (await api('/v1/ai/session', { method: 'POST', token: oversizedToken, body: {} })).json
  const oversized = await managedCall(oversizedSession, 'oversize')
  const oversizedBill = await api('/v1/billing', { token: oversizedToken })
  check(24, 'A single response cannot charge beyond the remaining entitlement', oversized.status === 502 && oversizedBill.json.creditRemainingUsd === 5, `response=${oversized.status}, remaining=$${oversizedBill.json.creditRemainingUsd}`)

  const rotateRace = await bootstrapFixture('rotate-race')
  const simultaneousRotations = await Promise.all([
    api('/v1/installations/rotate-token', { method: 'POST', token: rotateRace.token, body: { installationId: rotateRace.installationId } }),
    api('/v1/installations/rotate-token', { method: 'POST', token: rotateRace.token, body: { installationId: rotateRace.installationId } }),
  ])
  check(25, 'Concurrent installation-token rotations issue exactly one current token', simultaneousRotations.filter((result) => result.status === 200).length === 1 && simultaneousRotations.some((result) => [401, 409].includes(result.status)), `statuses=${simultaneousRotations.map((result) => result.status).join(',')}`)

  const revokedFixture = await bootstrapFixture('server-revoked')
  const revokedAccount = sandboxState.accounts.get(accountIdFromToken(revokedFixture.token))
  revokedAccount.tokens_revoked_at = new Date()
  const revokedBearer = await api('/v1/billing', { token: revokedFixture.token })
  const revokedBootstrap = await api('/v1/installations/bootstrap', { method: 'POST', body: { installationId: revokedFixture.installationId } })
  check(26, 'Server-revoked installations cannot mint fresh bearer tokens', revokedBearer.status === 401 && revokedBootstrap.status === 403, `bearer=${revokedBearer.status}, bootstrap=${revokedBootstrap.status}`)

  const scopedToken = await bootstrapInstall('polar-subscription-scope')
  const scopedAccount = accountIdFromToken(scopedToken)
  const subA = `polar-sub-a-${randHex()}`
  const subB = `polar-sub-b-${randHex()}`
  await sendPolarWebhook(`polar-a-active-${randHex()}`, 'subscription.active', scopedAccount, { subscriptionId: subA })
  await sendPolarWebhook(`polar-a-revoked-${randHex()}`, 'subscription.revoked', scopedAccount, { subscriptionId: subA })
  await sendPolarWebhook(`polar-a-late-${randHex()}`, 'subscription.active', scopedAccount, { subscriptionId: subA, occurredAt: new Date(Date.now() + 1000) })
  const sameSubscriptionBill = await api('/v1/billing', { token: scopedToken })
  await sendPolarWebhook(`polar-b-active-${randHex()}`, 'subscription.active', scopedAccount, { subscriptionId: subB })
  const newSubscriptionBill = await api('/v1/billing', { token: scopedToken })
  await sendPolarWebhook(`polar-a-after-b-${randHex()}`, 'subscription.active', scopedAccount, { subscriptionId: subA, occurredAt: new Date(Date.now() + 2000) })
  const oldSubscriptionAfterNewBill = await api('/v1/billing', { token: scopedToken })
  const currentSubscriptionId = sandboxState.accounts.get(scopedAccount)?.polar_subscription_id
  check(27, 'Polar terminal ordering is scoped to one subscription ID', sameSubscriptionBill.json.mode !== 'subscription' && newSubscriptionBill.json.mode === 'subscription' && oldSubscriptionAfterNewBill.json.mode === 'subscription' && currentSubscriptionId === subB, `same=${sameSubscriptionBill.json.mode}, new=${newSubscriptionBill.json.mode}, after-old=${oldSubscriptionAfterNewBill.json.mode}, current=${currentSubscriptionId}`)
} catch (error) {
  console.error('\nSandbox run threw:', error)
  results.push({ n: -1, title: 'harness', passed: false, detail: String(error) })
}

// ── Summary ───────────────────────────────────────────────────────────────
const failed = results.filter((r) => r.passed === false)
const passed = results.filter((r) => r.passed === true)
const skipped = results.filter((r) => r.passed === null)
console.log(`\n  ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped\n`)

fakeServer.close()
process.exit(failed.length === 0 ? 0 : 1)
