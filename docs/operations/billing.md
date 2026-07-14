# Managed AI billing

> This runbook describes the implementation that exists today. Pricing, trial behavior, payment rails, and the paid product are not approved until the V2 billing specification is accepted. Re-verify vendor requirements before production deployment.

## What exists

`services/billing` is a standalone Node service for managed AI access. The current implementation supports:

- installation and session tokens
- account credit and entitlement state
- LiteLLM virtual keys and provider-cost metering
- Polar subscription checkout and webhooks
- Flutterwave Rwanda mobile-money pass checkout and webhooks
- reservation and settlement around managed model calls
- an in-memory and optional real-Postgres sandbox

Bring-your-own-key does not use this service. The desktop calls the chosen provider directly when a personal key is configured.

The billing database stores account state, usage metadata, payment events, and payment intents. It is not designed to store prompts, answers, resolved activity facts, or raw activity.

## Architecture

```text
Daylens desktop
    │ installation token + managed request
    ▼
billing API ───────── payment providers
    │ entitlement, reservation, settlement
    ├──────── Postgres
    │
    ▼
private LiteLLM ───── upstream model provider
```

The billing API must be public over HTTPS. LiteLLM and Postgres should remain private to the deployment network.

## Local verification

Syntax check:

```bash
npm run billing:check
```

The default sandbox requires no Postgres, Docker, payment accounts, or provider key. It starts the real server with ephemeral fakes and tests checkout, webhooks, token revocation, reservations, settlement, overspend, and concurrency:

```bash
npm run billing:sandbox
```

The same harness can run against a throwaway Postgres database whose name contains `sandbox`, `verify`, or `test`:

```bash
BILLING_SANDBOX_DATABASE_URL='postgresql://…/daylens_billing_sandbox_verify' npm run billing:sandbox
```

The harness refuses production-looking database names and truncates its target. It still does not replace provider test-mode and deployed end-to-end checks.

## Required deployment components

- Node 22 or newer for the billing service
- Postgres 15 or newer
- a private LiteLLM deployment
- a public HTTPS billing host
- an upstream model-provider account
- approved payment-provider accounts for every enabled rail

Configuration names and required values are documented in `services/billing/.env.example`. Secrets belong in the deployment secret store, never in the repository or desktop bundle.

The desktop release must be built with `DAYLENS_BILLING_API_URL`. Without it, Daylens continues to support bring-your-own-key while managed access remains unavailable.

## Deployment order

1. Accept the billing product specification and confirm pricing.
2. Confirm payout, KYC, currency, fees, settlement, refund, and webhook requirements directly with each provider.
3. Provision Postgres and apply `services/billing/schema.sql`.
4. Deploy LiteLLM on the private network using the repository configuration.
5. Deploy the billing API over HTTPS.
6. Configure secrets and model aliases.
7. Register sandbox or test-mode webhooks.
8. Run the health check and sandbox against real Postgres.
9. Complete end-to-end test payments and managed calls.
10. Switch to production credentials and repeat the smoke checks.
11. Build and verify a desktop release with the production billing URL.

## Production smoke checks

- A new installation receives only the approved trial or free-credit state.
- A managed model call records provider cost and updates available access correctly.
- Concurrent calls cannot overspend the account.
- Expired reservations recover after a failed or interrupted provider call.
- Subscription checkout returns the expected provider URL.
- Subscription webhooks change entitlement exactly once.
- The customer portal opens from Daylens.
- Mobile-money checkout and verified webhook grant the approved access period exactly once.
- Removing managed access stops managed calls without breaking capture or local product surfaces.
- Adding a personal provider key routes calls outside the billing service.

## Security and privacy invariants

- Never log prompts, answers, provider keys, installation identifiers, or payment secrets.
- Hash installation identifiers before persistence.
- Encrypt stored LiteLLM keys.
- Verify webhook signatures and provider transaction state before granting access.
- Keep webhook processing idempotent and retryable.
- Reserve credit before calling the provider and settle actual cost afterward.
- Refuse insecure production configuration.
- Keep managed access failure independent from local capture and non-AI views.
