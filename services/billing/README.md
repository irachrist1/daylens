# Daylens billing service

This service powers managed AI access:

- $5 free credit per Daylens installation.
- Polar subscription for international card payments.
- Flutterwave Rwanda mobile-money 30-day pass.
- LiteLLM + Postgres metering for real provider cost.

BYOK does not use this service. When a user has their own provider key, the desktop app calls the provider directly.

## Required services

- Node 22+
- Postgres 15+
- LiteLLM proxy with a Postgres database
- A public HTTPS host for this service, for example `https://billing.daylens.app`
- Polar organization account
- Flutterwave merchant account with Rwanda mobile-money collections enabled

## Environment

Copy `.env.example` to your production secret store and set real values.

Generate the three local secrets with:

```bash
openssl rand -base64 48
```

Required core values:

- `DATABASE_URL`: Postgres for Daylens billing tables.
- `PUBLIC_BASE_URL`: public HTTPS base URL for this service.
- `SESSION_SECRET`: signs desktop install/session tokens.
- `INSTALLATION_HASH_SECRET`: hashes local installation IDs before storage.
- `LITELLM_URL`: private URL for LiteLLM.
- `LITELLM_MASTER_KEY`: LiteLLM admin key for virtual key creation.
- `LITELLM_KEY_ENCRYPTION_SECRET`: encrypts per-account LiteLLM keys at rest.
- `DAYLENS_PROVIDER_API_KEY`: upstream provider key used by LiteLLM.

Desktop builds must be compiled with:

```bash
DAYLENS_BILLING_API_URL=https://billing.daylens.app npm run build:all
```

Without `DAYLENS_BILLING_API_URL`, the desktop app still works with BYOK but managed credit/subscription access is unavailable.

## Database setup

Run the schema once before starting the service:

```bash
psql "$DATABASE_URL" -f services/billing/schema.sql
```

The schema stores account state, usage metadata, payment events, and payment intents. It does not store prompts, resolved facts, answers, or raw activity.

## LiteLLM setup

Run LiteLLM with `services/billing/litellm-config.yaml`.

Important settings already in the config:

- `turn_off_message_logging: true`
- `redact_user_api_key_info: true`
- Postgres spend tracking enabled through `database_url`

The billing service creates one LiteLLM virtual key per Daylens account and adjusts that key's budget when credit, subscription, or local-pass access changes.

## Polar setup

Use Polar for international subscriptions/cards.

1. Create a Polar organization.
2. Create a recurring Daylens subscription product.
3. Copy the product ID into `POLAR_PRODUCT_ID`.
4. Create an Organization Access Token with checkout, customer session, and webhook access. Put it in `POLAR_ACCESS_TOKEN`.
5. Add a webhook endpoint:

```text
https://billing.daylens.app/v1/webhooks/polar
```

6. Subscribe to at least:

- `subscription.created`
- `subscription.active`
- `subscription.updated`
- `subscription.canceled`
- `subscription.revoked`
- `order.paid`

7. Copy the webhook secret into `POLAR_WEBHOOK_SECRET`.
8. Complete Polar Finance -> Account:

- Submit the account review.
- Complete identity/KYC.
- Connect a Rwanda payout account through Stripe Connect Express.
- Wait for payout readiness before claiming production payments are live.

The service creates checkout sessions with `external_customer_id` set to the Daylens billing account ID. The customer portal opens through Polar customer sessions; do not configure a static portal URL.

## Flutterwave setup

Use Flutterwave for Rwanda mobile-money local access.

1. Create or finish your Flutterwave merchant account.
2. Complete business KYC.
3. Ask Flutterwave to enable Rwanda collections and `Mobile Money Rwanda` for live mode.
4. Confirm settlement/payout configuration for Rwanda.
5. Put the live secret key in `FLUTTERWAVE_SECRET_KEY`.
6. Set a webhook secret hash in Flutterwave, then copy it into `FLUTTERWAVE_SECRET_HASH`.
7. Add this webhook URL:

```text
https://billing.daylens.app/v1/webhooks/flutterwave
```

8. Enable webhook retries in Flutterwave.
9. Set `FLUTTERWAVE_LOCAL_PASS_RWF` to the live 30-day pass price.

The service uses Flutterwave Standard Checkout restricted to `mobilemoneyrwanda`. It records each `tx_ref` before redirecting the user, then credits the pass only after the webhook signature is valid and Flutterwave transaction verification confirms:

- status is `successful`
- currency is `RWF`
- amount matches the recorded intent
- transaction reference matches a known Daylens intent

Flutterwave's public recurring-payment docs say tokenized recurring payments are card-only. Treat Rwanda mobile money as renewable 30-day access unless Flutterwave explicitly approves unattended mobile-money renewal.

## Deploy order

1. Provision Postgres.
2. Run `schema.sql`.
3. Deploy LiteLLM privately with the provided config.
4. Deploy this billing service publicly over HTTPS.
5. Set all environment variables.
6. Build the desktop app with `DAYLENS_BILLING_API_URL`.
7. Configure Polar and Flutterwave webhooks to the deployed service.
8. Run the smoke checks below.

## Smoke checks

```bash
npm run billing:check
curl -fsS https://billing.daylens.app/health
```

Then test in sandbox/test mode:

1. Fresh installation bootstraps and shows `$5.00` free credit.
2. One managed AI call records usage and reduces free credit by provider cost.
3. Polar subscription checkout returns a Polar URL.
4. Polar subscription webhook sets plan to `subscription`.
5. Polar portal opens from Settings -> Billing.
6. Flutterwave checkout returns a hosted payment URL.
7. Flutterwave test payment webhook grants a 30-day local pass.
8. Replaying the same webhook does not extend access twice.
9. Removing all managed access pauses AI without breaking capture or local views.
10. Adding a BYOK provider key makes calls go directly to the provider.

## Local sandbox (dev only)

You can exercise the whole backend on your machine with **no Postgres, no Docker, and
no Polar/Flutterwave/LiteLLM accounts**. From the repo root:

```bash
npm run billing:sandbox
```

It boots `src/server.mjs` unmodified and scripts the 10 smoke checks above against it,
printing `PASS`/`FAIL` per check and exiting non-zero on any failure.

What it stands up (all in one Node process, all ephemeral):

- **Store** - an in-memory shim loaded in place of `pg` (`sandbox/pg-shim.mjs`), so the
  server runs with no database. It implements only the queries the server issues; an
  unrecognised query throws loudly. Transactions are simulated as no-ops, so this is a
  functional harness, not a concurrency test.
- **LiteLLM** - a fake upstream that returns a canned completion plus a fake
  `x-litellm-response-cost`, so metering and the `$5` credit draw-down are real.
- **Polar + Flutterwave** - fake checkout, customer-session, and transaction-verify
  endpoints. The harness signs the Polar webhook (Standard Webhooks HMAC) and the
  Flutterwave webhook (`verif-hash`) with the sandbox's own generated secrets.

Smoke check #10 (BYOK) is reported as **N/A**: with an own key the desktop app calls the
provider directly and never touches this service, so there is nothing for the backend
harness to exercise. That precedence lives in the desktop code and is covered by
`tests/billingArchitecture.test.ts`.

It is hard-guarded to dev: both `sandbox/run.mjs` and `sandbox/pg-shim.mjs` refuse to run
when `NODE_ENV=production`, and the shim is only ever loaded by the sandbox (never by
`npm start`). The fakes are not a substitute for the sandbox/test-mode checks against real
Polar/Flutterwave/LiteLLM before going live.

## Production safety

The server refuses to start in production when:

- public base URL is not HTTPS
- core secrets are missing, placeholders, or too short
- Polar is enabled without a webhook secret
- Flutterwave is enabled without a secret hash
- local pass/fair-use numbers are invalid

Webhook handlers are idempotent. Failed processing leaves the event retryable; processed duplicates return `200` without granting duplicate access.

## Deployment & payout verification

This is the founder runbook for taking the backend from "built" to "live" from Rwanda,
where Stripe and Paddle do not pay out. The chosen rails are Polar (international cards,
Merchant of Record) + Flutterwave (Rwanda MTN/Airtel mobile money) + self-hosted LiteLLM.

Vendor facts below were checked **June 2026**. Re-verify the ones marked UNCONFIRMED with
the vendor before spending, and re-check the dated facts if you read this much later.

### Verified vendor facts (June 2026)

- Polar supports **sellers based in Rwanda** for payouts via **Stripe Connect Express**.
  You do not need Stripe Payments to operate in Rwanda, only Express payout eligibility,
  and Rwanda is on Polar's supported-country list.
  (https://polar.sh/docs/merchant-of-record/supported-countries)
- Polar orgs created on/after **2026-05-12** have a **7-day settlement delay** before funds
  are payable. (https://polar.sh/docs/features/finance/payouts)
- Polar has a **sandbox**: API base `https://sandbox-api.polar.sh/v1`, dashboard at
  `sandbox.polar.sh`. Sandbox tokens only talk to sandbox.
  (https://polar.sh/docs/integrate/sandbox)
- Flutterwave supports **Rwanda mobile money (MTN + Airtel), RWF**, with **T+1** local
  settlement, and requires a **registered Rwandan business** (RDB registration, RRA tax
  clearance, national ID, proof of address, verifiable website).
  (https://flutterwave.com/ng/support/onboarding/onboarding-requirements-for-opening-a-business-account-in-rwanda)

### UNCONFIRMED - confirm with the vendor before spending

1. The exact **currency and bank type** Polar/Stripe Express pays a Rwanda seller in
   (RWF bank vs USD vs debit-card-only). Biggest unknown; confirm during Stripe onboarding
   and in writing with Polar support.
2. Whether Polar accepts an **individual** in Rwanda or wants a registered company.
3. Flutterwave's **go-live timeline** and whether Rwanda mobile-money collections need
   manual enablement by their compliance team beyond submitting KYC.
4. Polar's current **fee** and the real first-payout timing under the 7-day delay + any
   first-payout account-review hold.

### Step 1 - Payout verification (free, reversible, do this FIRST)

Do not spend on hosting until both pass.

**Polar:** create org -> Finance -> Account -> "Continue with account setup" -> select
Rwanda -> complete Stripe Connect Express onboarding (ID, business info, bank account).
Watch whether Stripe Express accepts a Rwandan bank account and what payout currency it
offers. Ask Polar support, in writing: can a Rwanda seller be paid to a Rwandan bank and
in what currency; when does the first payout land given the 7-day delay; is there a
first-payout review hold; individual vs company difference. Pass = active payout account
+ written confirmation.

**Flutterwave:** create a Rwanda business account, complete KYC (docs above), enable
Mobile Money under Settings -> Business Preferences -> Payment Methods. Open a support
ticket: confirm Rwanda mobile-money collections (MTN + Airtel, RWF) are enabled in **live**
mode, and confirm RWF settlement + schedule. Pass = account Approved/Live + mobile money
enabled + written settlement confirmation.

**Gate:** both pass -> deploy. Only Polar passes -> international + BYOK. Only Flutterwave
passes -> Rwanda pass + BYOK. Neither -> ship a **BYOK-only desktop build** (omit
`DAYLENS_BILLING_API_URL`); the app works fully on users' own keys and no hosting spend is
wasted.

### Step 2 - Cheapest-viable hosting

One small VPS (~EUR 4-5/month, e.g. Hetzner CX22) running Docker Compose: `postgres` +
`litellm` (using `litellm-config.yaml`) + `billing` (`node src/server.mjs`) + `caddy`
(free automatic HTTPS). Expose only Caddy :443; keep Postgres and LiteLLM on the private
Docker network. Recurring cost = VPS + your upstream Anthropic usage; Polar/Flutterwave are
per-transaction with no monthly fee. Managed alternative (more cost, less ops): Neon
Postgres + Fly.io for the billing service and a private LiteLLM app.

### Step 3 - Deploy order (nothing wasted; the gate already passed)

1. Point `billing.daylens.app` (A record) at the VPS.
2. Bring up Postgres; run `psql "$DATABASE_URL" -f services/billing/schema.sql`.
3. Bring up LiteLLM (private) and the billing service behind Caddy.
4. Set env vars (map below); generate secrets with `openssl rand -base64 48`.
5. `curl -fsS https://billing.daylens.app/health` -> `{"ok":true}`.
6. Register webhooks against **Polar sandbox + Flutterwave test keys** first.
7. Run the Smoke checks (steps 1-10) end-to-end in sandbox/test mode.
8. Flip to production tokens/keys, re-register prod webhooks, re-run smoke checks.
9. Rebuild desktop: `DAYLENS_BILLING_API_URL=https://billing.daylens.app npm run build:all`.

### Env var sources (maps to `.env.example`)

- `DATABASE_URL`, `PUBLIC_BASE_URL`, `PORT`, `NODE_ENV=production` - your infra/domain.
- `SESSION_SECRET`, `INSTALLATION_HASH_SECRET`, `LITELLM_KEY_ENCRYPTION_SECRET` -
  `openssl rand -base64 48` each.
- `LITELLM_URL=http://litellm:4000`, `LITELLM_MASTER_KEY` - private LiteLLM.
- `DAYLENS_PROVIDER_API_KEY` - your upstream Anthropic key; it belongs to the **LiteLLM**
  container (referenced by `litellm-config.yaml`), not used by `server.mjs` directly.
- `POLAR_API_BASE_URL` - `https://sandbox-api.polar.sh/v1` for sandbox,
  `https://api.polar.sh/v1` for production.
- `POLAR_ACCESS_TOKEN` / `POLAR_PRODUCT_ID` / `POLAR_WEBHOOK_SECRET` - from Polar; sandbox
  and production values differ and never mix.
- `FLUTTERWAVE_API_BASE_URL=https://api.flutterwave.com/v3` (same for test + live);
  `FLUTTERWAVE_SECRET_KEY` is `FLWSECK_TEST-...` for test, `FLWSECK-...` for live;
  `FLUTTERWAVE_SECRET_HASH` is whatever you set in the dashboard webhook settings.
- `FLUTTERWAVE_LOCAL_PASS_RWF`, `SUBSCRIPTION_FAIR_USE_USD` - your pricing.

Webhook URLs to register:
`https://billing.daylens.app/v1/webhooks/polar` and
`https://billing.daylens.app/v1/webhooks/flutterwave`.

### Managed-model wiring (fixed)

This was a deploy blocker and is now resolved. The split is explicit:

- The server sends `LITELLM_MODEL_ALIAS` (default `daylens-default`) as the request `model`.
  It must equal a `model_name` in `litellm-config.yaml`.
- `DAYLENS_MANAGED_MODEL` is the real upstream model (e.g. `anthropic/claude-sonnet-4-6`)
  that the yaml maps the alias to, and the name shown/recorded.

So the alias and the real model are intentionally different, and a fresh `.env` no longer
defaults the alias into the upstream slot. The sandbox now guards this: smoke check 2
asserts the model the billing server forwards to LiteLLM is the alias, so a regression back
to sending the real model name fails the check.
