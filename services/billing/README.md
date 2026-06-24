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

## Production safety

The server refuses to start in production when:

- public base URL is not HTTPS
- core secrets are missing, placeholders, or too short
- Polar is enabled without a webhook secret
- Flutterwave is enabled without a secret hash
- local pass/fair-use numbers are invalid

Webhook handlers are idempotent. Failed processing leaves the event retryable; processed duplicates return `200` without granting duplicate access.
