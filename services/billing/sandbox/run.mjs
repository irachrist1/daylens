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
const fake = { flwById: new Map(), flwByAccount: new Map(), lastChatModel: null }

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
        const cost = feature === 'drain' ? 6.0 : 0.0123 // 'drain' busts the $5 credit in one call
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
          data: { id: rec.id, tx_ref: rec.tx_ref, status: 'successful', currency: rec.currency, amount: rec.amount, customer: { email: rec.email } },
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
process.env.POLAR_WEBHOOK_SECRET = `whsec_${crypto.randomBytes(24).toString('base64')}`
process.env.FLUTTERWAVE_API_BASE_URL = `http://127.0.0.1:${UPSTREAM}/flutterwave`
process.env.FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST-sandbox'
process.env.FLUTTERWAVE_SECRET_HASH = `sandbox-verif-hash-${randHex()}`
const LOCAL_PASS_RWF = Number(process.env.FLUTTERWAVE_LOCAL_PASS_RWF)

const fakeServer = await startFakeUpstream(UPSTREAM)
register('./loader.mjs', import.meta.url) // map `pg` -> in-memory shim
await import('../src/server.mjs') // boots and listens on PORT

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
  const bytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  return crypto.createHmac('sha256', bytes).update(`${id}.${ts}.${raw}`).digest('base64')
}

async function sendPolarWebhook(eventId, type, accountId) {
  const payload = {
    id: eventId,
    type,
    data: {
      external_customer_id: accountId,
      status: 'active',
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      customer_id: `polar-cust-${accountId.slice(0, 8)}`,
      id: `polar-sub-${accountId.slice(0, 8)}`,
    },
  }
  const raw = JSON.stringify(payload)
  const id = `msg_${randHex()}`
  const ts = Math.floor(Date.now() / 1000)
  const res = await fetch(`${BASE}/v1/webhooks/polar`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(ts),
      'webhook-signature': `v1,${polarSignature(process.env.POLAR_WEBHOOK_SECRET, id, ts, raw)}`,
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
