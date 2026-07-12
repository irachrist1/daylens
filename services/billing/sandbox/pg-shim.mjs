// Dev-only, in-memory Postgres-compatible shim for the billing sandbox.
//
// sandbox/loader.mjs swaps this module in for `pg` so services/billing/src/server.mjs
// can run with NO external Postgres. It is NOT a general SQL engine: it implements
// exactly the queries server.mjs issues, matched by their stable text. If server.mjs
// grows a new query, this throws loudly rather than returning wrong data.
//
// `npm start` never loads this — only the sandbox harness does, via the loader.
import { randomUUID } from 'node:crypto'

if (process.env.NODE_ENV === 'production') {
  throw new Error('pg-shim is a dev-only sandbox store and must never load in production')
}

const db = {
  accounts: new Map(), // id -> row
  usage: [], // usage rows
  paymentEvents: new Map(), // `${provider}\0${event_id}` -> row
  paymentIntents: new Map(), // `${provider}\0${tx_ref}` -> row
  bootstrapAttempts: [], // { ip_hash, attempted_at }
}

// Dev-only escape hatch for the sandbox's revocation/failure fixtures.
export const sandboxState = db
export const sandboxControl = { failNextContaining: null }

const now = () => new Date()
const toMs = (v) => (v == null ? null : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v))
const addDays = (date, n) => new Date(date.getTime() + n * 86_400_000)
const addMonth = (date) => {
  const out = new Date(date.getTime())
  out.setMonth(out.getMonth() + 1)
  return out
}

function newAccount(installationHash, cipher) {
  const ts = now()
  return {
    id: randomUUID(),
    installation_hash: installationHash,
    created_at: ts,
    updated_at: ts,
    free_credit_granted_micros: 5_000_000,
    free_credit_remaining_micros: 5_000_000,
    plan: 'free',
    subscription_status: null,
    period_started_at: null,
    renewal_at: null,
    local_pass_expires_at: null,
    polar_customer_id: null,
    polar_subscription_id: null,
    polar_event_occurred_at: null,
    polar_event_rank: 0,
    customer_email: null,
    installation_token_version: 1,
    tokens_revoked_at: null,
    spend_reserved_micros: 0,
    spend_reserved_until: null,
    litellm_budget_mode: 'free_credit',
    litellm_budget_sync_required: false,
    litellm_key_cipher: cipher,
  }
}

function accountByHash(hash) {
  for (const row of db.accounts.values()) if (row.installation_hash === hash) return row
  return null
}

function intentKey(provider, txRef) {
  return `${provider}\0${txRef}`
}

let transactionTail = Promise.resolve()

function restore(snapshot) {
  for (const key of Object.keys(db)) db[key] = snapshot[key]
}

async function acquireTransaction() {
  let release
  const previous = transactionTail
  transactionTail = new Promise((resolve) => { release = resolve })
  await previous
  return release
}

// Execute one normalized statement. Returns { rows }.
function run(text, params = []) {
  const q = String(text).replace(/\s+/g, ' ').trim()
  const p = params

  if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(q)) return { rows: [] }

  // ── billing_accounts ──────────────────────────────────────────────
  if (q.startsWith('SELECT * FROM billing_accounts WHERE id =')) {
    const row = db.accounts.get(p[0])
    return { rows: row ? [structuredClone(row)] : [] }
  }
  if (q.startsWith('SELECT * FROM billing_accounts WHERE installation_hash =')) {
    const row = accountByHash(p[0])
    return { rows: row ? [structuredClone(row)] : [] }
  }
  if (q.startsWith('INSERT INTO billing_accounts (installation_hash, litellm_key_cipher)')) {
    if (accountByHash(p[0])) return { rows: [] } // ON CONFLICT DO NOTHING
    const row = newAccount(p[0], 'pending')
    db.accounts.set(row.id, row)
    return { rows: [structuredClone(row)] }
  }
  if (q.startsWith('UPDATE billing_accounts SET litellm_key_cipher = $1 WHERE id = $2')) {
    const row = db.accounts.get(p[1])
    if (row) {
      row.litellm_key_cipher = p[0]
      row.updated_at = now()
    }
    return { rows: [] }
  }
  if (q.startsWith('UPDATE billing_accounts SET litellm_key_cipher = $1, litellm_budget_mode = $2')) {
    const row = db.accounts.get(p[2])
    if (row) {
      row.litellm_key_cipher = p[0]
      row.litellm_budget_mode = p[1]
      row.litellm_budget_sync_required = false
      row.updated_at = now()
    }
    return { rows: [] }
  }
  if (q.startsWith('UPDATE billing_accounts SET litellm_budget_mode = $1')) {
    const row = db.accounts.get(p[1])
    if (row) {
      row.litellm_budget_mode = p[0]
      row.litellm_budget_sync_required = false
      row.updated_at = now()
    }
    return { rows: [] }
  }
  if (q.startsWith("UPDATE billing_accounts SET plan = 'subscription'")) {
    // params: [status, period_start, period_end, customer_id, subscription_id, event_at, event_rank, accountId]
    const row = db.accounts.get(p[7])
    if (row) {
      row.plan = 'subscription'
      row.subscription_status = p[0]
      row.period_started_at = p[1] ? new Date(p[1]) : now()
      row.renewal_at = p[2] ? new Date(p[2]) : addMonth(now())
      row.polar_customer_id = p[3] ?? row.polar_customer_id
      row.polar_subscription_id = p[4] ?? row.polar_subscription_id
      row.polar_event_occurred_at = p[5]
      row.polar_event_rank = p[6]
      row.litellm_budget_sync_required = true
      row.updated_at = now()
    }
    return { rows: [] }
  }
  if (q.startsWith("UPDATE billing_accounts SET subscription_status = 'canceled'")) {
    const row = db.accounts.get(p[2])
    if (row) {
      row.subscription_status = 'canceled'
      row.polar_event_occurred_at = p[0]
      row.polar_event_rank = p[1]
      row.litellm_budget_sync_required = true
      row.updated_at = now()
    }
    return { rows: [] }
  }
  if (q.startsWith("UPDATE billing_accounts SET subscription_status = 'revoked'")) {
    const row = db.accounts.get(p[2])
    if (row) {
      row.subscription_status = 'revoked'
      row.renewal_at = now()
      row.polar_event_occurred_at = p[0]
      row.polar_event_rank = p[1]
      row.litellm_budget_sync_required = true
      row.updated_at = now()
    }
    return { rows: [] }
  }
  if (q.startsWith("UPDATE billing_accounts SET plan = 'local_pass'")) {
    // params: [customer_email_or_null, accountId]
    const row = db.accounts.get(p[1])
    if (row) {
      const base = Math.max(toMs(row.local_pass_expires_at) ?? Date.now(), Date.now())
      row.plan = 'local_pass'
      row.local_pass_expires_at = addDays(new Date(base), 30)
      row.period_started_at = now()
      row.customer_email = p[0] ?? row.customer_email
      row.litellm_budget_sync_required = true
      row.updated_at = now()
    }
    return { rows: [] }
  }
  if (q.startsWith('UPDATE billing_accounts SET free_credit_remaining_micros = free_credit_remaining_micros - $1')) {
    const row = db.accounts.get(p[2])
    if (!row || Number(row.free_credit_remaining_micros) < Number(p[0])) return { rows: [] }
    row.free_credit_remaining_micros -= Number(p[0])
    row.spend_reserved_micros = 0
    row.spend_reserved_until = null
    row.updated_at = now()
    return { rows: [{ id: row.id }] }
  }
  if (q.startsWith('UPDATE billing_accounts SET customer_email = $1, updated_at = now() WHERE id = $2')) {
    const row = db.accounts.get(p[1])
    if (row) {
      row.customer_email = p[0]
      row.updated_at = now()
    }
    return { rows: [] }
  }
  if (q.startsWith('UPDATE billing_accounts SET installation_token_version = installation_token_version + 1')) {
    const row = db.accounts.get(p[0])
    if (!row || Number(row.installation_token_version) !== Number(p[1])) return { rows: [] }
    row.installation_token_version += 1
    row.updated_at = now()
    return { rows: [{ installation_token_version: row.installation_token_version }] }
  }
  if (q.startsWith('UPDATE billing_accounts SET spend_reserved_micros = $1,')) {
    const row = db.accounts.get(p[1])
    if (row) {
      row.spend_reserved_micros = Number(p[0])
      row.spend_reserved_until = new Date(Date.now() + 120_000)
      row.updated_at = now()
    }
    return { rows: [] }
  }
  if (q.startsWith('UPDATE billing_accounts SET spend_reserved_micros = 0,')) {
    const row = db.accounts.get(p[1])
    if (row && Number(row.spend_reserved_micros) === Number(p[0])) {
      row.spend_reserved_micros = 0
      row.spend_reserved_until = null
      row.updated_at = now()
    }
    return { rows: [] }
  }

  // ── billing_bootstrap_attempts ────────────────────────────────────
  if (q.startsWith('SELECT COUNT(*)::int AS count FROM billing_bootstrap_attempts')) {
    const cutoff = Date.now() - 3_600_000
    const count = db.bootstrapAttempts.filter((a) => a.ip_hash === p[0] && a.attempted_at.getTime() > cutoff).length
    return { rows: [{ count }] }
  }
  if (q.startsWith('INSERT INTO billing_bootstrap_attempts')) {
    db.bootstrapAttempts.push({ ip_hash: p[0], attempted_at: now() })
    return { rows: [] }
  }

  // ── billing_payment_events (idempotency) ──────────────────────────
  if (q.startsWith('INSERT INTO billing_payment_events')) {
    const key = `${p[0]}\0${p[1]}`
    if (db.paymentEvents.has(key)) return { rows: [] } // ON CONFLICT DO NOTHING
    db.paymentEvents.set(key, { provider: p[0], event_id: p[1], received_at: now(), processed_at: null, last_error: null })
    return { rows: [{ event_id: p[1] }] }
  }
  if (q.startsWith('SELECT processed_at FROM billing_payment_events')) {
    const row = db.paymentEvents.get(`${p[0]}\0${p[1]}`)
    return { rows: row ? [{ processed_at: row.processed_at }] : [] }
  }
  if (q.startsWith('UPDATE billing_payment_events SET processed_at = now(), last_error = NULL')) {
    const row = db.paymentEvents.get(`${p[0]}\0${p[1]}`)
    if (row) {
      row.processed_at = now()
      row.last_error = null
    }
    return { rows: [] }
  }
  if (q.startsWith('UPDATE billing_payment_events SET last_error = $3')) {
    const row = db.paymentEvents.get(`${p[0]}\0${p[1]}`)
    if (row) row.last_error = p[2]
    return { rows: [] }
  }

  // ── billing_payment_intents ───────────────────────────────────────
  if (q.startsWith('INSERT INTO billing_payment_intents')) {
    // params: [tx_ref, account_id, amount]; provider/currency are literals
    const row = {
      provider: 'flutterwave',
      tx_ref: p[0],
      account_id: p[1],
      amount: p[2],
      currency: 'RWF',
      status: 'pending',
      provider_reference: null,
      checkout_url: null,
      created_at: now(),
      updated_at: now(),
    }
    db.paymentIntents.set(intentKey('flutterwave', p[0]), row)
    return { rows: [] }
  }
  if (q.startsWith("SELECT * FROM billing_payment_intents WHERE provider = 'flutterwave' AND tx_ref =")) {
    const row = db.paymentIntents.get(intentKey('flutterwave', p[0]))
    return { rows: row ? [row] : [] }
  }
  if (q.includes("SET status = 'checkout_failed'")) {
    const row = db.paymentIntents.get(intentKey('flutterwave', p[0]))
    if (row) {
      row.status = 'checkout_failed'
      row.updated_at = now()
    }
    return { rows: [] }
  }
  if (q.startsWith('UPDATE billing_payment_intents SET checkout_url = $1')) {
    const row = db.paymentIntents.get(intentKey('flutterwave', p[1]))
    if (row) {
      row.checkout_url = p[0]
      row.updated_at = now()
    }
    return { rows: [] }
  }
  if (q.includes('SET status = $1, provider_reference = $2')) {
    // params: [status, reference, tx_ref]
    const row = db.paymentIntents.get(intentKey('flutterwave', p[2]))
    if (row) {
      row.status = p[0]
      row.provider_reference = p[1]
      row.updated_at = now()
    }
    return { rows: [] }
  }
  if (q.includes("SET status = 'successful', provider_reference = $1")) {
    // params: [reference, tx_ref]
    const row = db.paymentIntents.get(intentKey('flutterwave', p[1]))
    if (row) {
      row.status = 'successful'
      row.provider_reference = p[0]
      row.updated_at = now()
    }
    return { rows: [] }
  }

  // ── billing_usage ─────────────────────────────────────────────────
  if (q.startsWith('INSERT INTO billing_usage')) {
    // params: [account_id, mode, feature, provider, model, input_tokens, output_tokens, cost_micros, request_id]
    db.usage.push({
      id: randomUUID(),
      account_id: p[0],
      occurred_at: now(),
      mode: p[1],
      feature: p[2],
      provider: p[3],
      model: p[4],
      input_tokens: p[5],
      output_tokens: p[6],
      cost_micros: p[7],
      success: true,
      request_id: p[8],
    })
    return { rows: [] }
  }
  if (q.includes('COALESCE(SUM(cost_micros), 0)')) {
    // periodSpendMicros: sum of non-free_credit usage at/after $2
    const from = toMs(p[1]) ?? 0
    const spend = db.usage
      .filter((u) => u.account_id === p[0] && u.occurred_at.getTime() >= from && u.mode !== 'free_credit')
      .reduce((sum, u) => sum + Number(u.cost_micros), 0)
    return { rows: [{ spend }] }
  }
  if (q.startsWith('SELECT id, occurred_at, mode, feature')) {
    const from = toMs(p[1]) ?? 0
    const to = toMs(p[2]) ?? Number.MAX_SAFE_INTEGER
    const rows = db.usage
      .filter((u) => u.account_id === p[0] && u.occurred_at.getTime() >= from && u.occurred_at.getTime() < to)
      .sort((a, b) => b.occurred_at.getTime() - a.occurred_at.getTime())
      .slice(0, 2000)
      .map((u) => ({
        id: u.id,
        occurred_at: u.occurred_at,
        mode: u.mode,
        feature: u.feature,
        provider: u.provider,
        model: u.model,
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        cost_micros: u.cost_micros,
        success: u.success,
      }))
    return { rows }
  }

  throw new Error(`pg-shim: unhandled query: ${q}`)
}

class Client {
  inTransaction = false
  snapshot = null
  releaseTransaction = null

  async query(text, params) {
    const command = String(text).trim().toUpperCase()
    if (command === 'BEGIN') {
      if (this.inTransaction) throw new Error('pg-shim: transaction already open')
      this.releaseTransaction = await acquireTransaction()
      this.snapshot = structuredClone(db)
      this.inTransaction = true
      return { rows: [] }
    }
    if (command === 'COMMIT') {
      if (!this.inTransaction) throw new Error('pg-shim: no transaction')
      this.inTransaction = false
      this.snapshot = null
      this.releaseTransaction()
      this.releaseTransaction = null
      return { rows: [] }
    }
    if (command === 'ROLLBACK') {
      if (!this.inTransaction) return { rows: [] }
      restore(this.snapshot)
      this.inTransaction = false
      this.snapshot = null
      this.releaseTransaction()
      this.releaseTransaction = null
      return { rows: [] }
    }
    if (sandboxControl.failNextContaining && String(text).includes(sandboxControl.failNextContaining)) {
      const marker = sandboxControl.failNextContaining
      sandboxControl.failNextContaining = null
      throw new Error(`pg-shim: injected failure at ${marker}`)
    }
    return run(text, params)
  }

  release() {
    if (this.inTransaction) throw new Error('pg-shim: client released with transaction open')
  }
}

export class Pool {
  async query(text, params) {
    return run(text, params)
  }

  async connect() {
    return new Client()
  }

  async end() {}
}

export { Client }
export default { Pool, Client }
