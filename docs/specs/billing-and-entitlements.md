# Billing and entitlements

**Status:** Accepted.

This specification defines what remains free, what managed access pays for, how usage is metered, and how billing failures affect Daylens.

Billing never controls access to a person’s local captured history.

## Product packaging

### Free local product

The following remain usable without a subscription or model provider:

- local capture
- Timeline
- Apps
- local exact and semantic search
- corrections and deletion
- export
- local memory management
- BYOK AI, subject to the person’s provider account

### Managed subscription

An active trial or subscription provides:

- managed AI provider calls
- encrypted cross-device sync
- remote memory search and chat on the later web companion
- managed cloud processing explicitly included in the plan

Core product behavior is not split into several paid feature tiers for the first launch.

### Prepaid passes

Fixed-duration prepaid passes are part of packaging. The shipped Rwanda mobile-money 30-day local pass, purchased through Flutterwave, is the first such pass and survives into this model. A prepaid pass maps to entitlement state `active` with `periodEnd` set to the end of the purchased duration and no renewal. When the pass ends, the account leaves `active` without entering grace; there is no failed-renewal path because there is no renewal.

## Trial and billing period

- The trial lasts seven consecutive days.
- The trial clock starts at the explicit "start trial" action during onboarding, not at first bootstrap.
- No payment card is required to begin.
- The trial includes a fixed managed-AI credit of $5 and encrypted cloud access.
- The trial ends when time or included credit is exhausted, whichever comes first.
- Unspent trial credit expires when the seven consecutive days end.
- Trial exhaustion does not charge automatically.
- Monthly and annual subscriptions are available.
- Annual billing is 20% lower than twelve monthly payments.

The permanent monthly price and included allowance are chosen after desktop beta, provider-cost benchmarks, and willingness-to-pay testing. `$14.99/month` is an internal planning assumption only and is not public pricing.

## Entitlement state

The billing service returns one signed entitlement snapshot. `EntitlementSnapshot` replaces the shipped `BillingAccessSnapshot`; desktop access checks consolidate on this contract.

```ts
interface EntitlementSnapshot {
  accountId: string
  state: 'trial' | 'active' | 'grace' | 'exhausted' | 'expired' | 'refunded'
  periodStart: number | null
  periodEnd: number | null
  managedCreditGrantedUsd: number
  managedCreditReservedUsd: number
  managedCreditConsumedUsd: number
  canUseManagedAI: boolean
  canUseCloud: boolean
  issuedAt: number
  expiresAt: number
  kid: string
  signature: string
}
```

- Snapshots are signed with Ed25519. The signing public key is pinned in the application build and selected by `kid`. Key rotation is kid-based: a new public key ships in an app update before the service starts signing with it.
- `expiresAt` is at most 72 hours after `issuedAt`.
- The desktop persists the latest validated signed snapshot locally and may honor it offline until `expiresAt`.
- The desktop revalidates the snapshot on launch and every 6 hours while online.
- `unavailable` is not a signed state. The client synthesizes it locally when the billing service is unreachable and no valid persisted snapshot exists; the service never signs it.
- `grace` means a renewal payment failed and the seven-day grace period defined under cancellation is running: `periodEnd` reflects the failed renewal boundary, local features continue, and managed access continues only while valid credit remains.

The desktop validates the signature and expiry. It does not infer paid access from a UI flag or payment receipt alone.

Allowance is a per-period credit grant, expressed by the `managedCredit*` fields: `managedCreditGrantedUsd` is granted at the start of each period and does not carry over. This replaces the implemented fair-use ceiling.

BYOK is a separate local access mode and does not require managed credit.

## Usage metering

Every managed request follows:

```text
estimate → reserve → provider call → settle actual cost → release remainder
```

- The desktop mints a client idempotency key for each managed request and sends it with the call. The billing service stores the key uniquely per account; a replay of the same key returns the original settlement. Request identity is never derived from the provider response. This replaces the shipped scheme that stored the provider response identifier.
- Reservation is atomic and idempotent.
- Duplicate retries with the same idempotency key cannot charge twice.
- Reservations are per-request and estimated: the reserved amount is computed from the versioned pricing table and the prompt size, allowing bounded concurrent managed requests per account. The shipped whole-balance single-flight reservation is the migration starting point, not the launch requirement.
- No provider call begins when sufficient credit cannot be reserved.
- Cancellation settles only provider cost already incurred.
- Provider failure releases unused reservation.
- Tool-only work that makes no provider request consumes no model credit.
- Usage records contain account, model, feature or job type, token or unit counts, provider cost, charged credit, status, and timestamps.
- Prompts, answers, evidence, titles, URLs, and personal activity never enter billing records. The feature or job-type field is a fixed enumeration and carries no personal content.

Allowance is displayed in understandable monetary credit and estimated questions, with model-specific estimates. Raw tokens may appear in a detailed usage view but are not the primary unit.

Estimated questions are defined as remaining credit divided by the median settled cost of the accepted benchmark fixture questions for the selected model at the attached price version. The benchmark artifact is the source of truth for this estimator and is re-run whenever a pricing version changes.

When consumed credit reaches 80% of the period allowance, Daylens shows a pre-exhaustion warning.

## Model choice and cost

People can choose among supported managed models. The picker shows relative quality, speed, and estimated allowance impact.

The billing service maintains versioned provider pricing. A price version is attached to every reservation and settlement so later price changes do not rewrite history.

If a model’s estimated request cost exceeds remaining allowance, Daylens offers another selected model or waits for reset.

Daylens does not silently change the person’s chosen conversational model. Automatic economy-tier routing is permitted for background jobs only, and every economy-routed job is visible in the usage view.

## Exhaustion

When managed credit is exhausted:

- managed AI calls pause
- the future encrypted web companion and its sync pause
- existing local memory and AI threads remain readable
- local capture, Timeline, Apps, search, corrections, export, and BYOK continue
- queued cloud changes remain encrypted and bounded locally

The cloud features paused by exhaustion are scoped to managed AI calls and the future encrypted web companion and sync. The frozen legacy Convex sync is out of scope for this specification and is not gated by entitlement state.

There is no automatic overage charge beyond the settlement tolerance defined under failure behavior. Access resumes at the next period, after a subscription change, or after an explicitly purchased allowance product introduced by a later specification.

## Offline and billing outages

- The persisted validated snapshot may be used offline until its signed expiry, at most 72 hours after issue.
- After expiry, managed calls and managed cloud access pause safely.
- Billing unavailability never disables local features or BYOK.
- Payment-provider webhooks are idempotent and processed into an internal account ledger.
- Conflicting provider events resolve by provider event identity and effective time, not delivery order alone.
- The desktop never stores payment-card details.

## Cancellation, grace, and refunds

- Cancellation takes effect at the end of the paid period.
- Managed access remains active until that time unless the payment is refunded or fraudulent.
- A failed renewal enters a seven-day grace period, signed as state `grace`, with visible notice and retry.
- During grace, local features continue and managed access may continue only while valid credit remains.
- After grace, managed AI and future web-companion access pause.
- Encrypted cloud data is retained for 30 days after expiration, then deleted after notice; remote tombstones and legally required billing records may remain.
- Monthly payments are non-refundable after use except duplicate charges, material service failure, or applicable law.
- A first annual purchase is fully refundable within 14 days. Refunding ends managed and cloud entitlement and begins the 30-day cloud-data deletion window.

Support can grant a signed entitlement adjustment or refund through an audited provider-side command. It cannot edit local history.

## Payment providers

Payment providers are adapters behind one internal billing ledger. Polar, Flutterwave, or another provider may be used only after availability, payout, fees, tax, settlement, dispute, and refund behavior are verified for the launch markets. Flutterwave is the provider for the Rwanda mobile-money prepaid pass.

Provider-specific customer and payment identifiers remain in the billing service. The desktop receives only account and entitlement information needed to operate the product.

## Security and privacy

- Billing uses a random account or installation linkage, not raw activity identity.
- Prompts, answers, model context, evidence, and connector records never enter payment metadata.
- Webhooks verify provider signatures and reject replay.
- Entitlement snapshots are signed with Ed25519 against a build-pinned, kid-rotated public key and are short-lived.
- Administrative adjustments are audited.
- Usage and financial records have separate retention and access controls.
- Billing analytics use plan, model, feature or job type, cost, and status only.

## Failure behavior

- Reservation timeout produces no provider call.
- Settlement failure is retried idempotently by the server from the stored reservation. The client shows the reservation as pending until it is settled or expires.
- Provider cost above the reservation settles to actual cost within a tolerance of min(5%, $0.05) per request. Beyond that tolerance, the response is still delivered to the person and the account is paused for new managed calls until the discrepancy is settled. A delivered response is never silently discarded, and no charge is created beyond the tolerance. "No automatic overage" means exactly this: no charges beyond the tolerance.
- Duplicate webhooks do not duplicate entitlement or payment records.
- Refund, dispute, or fraud events revoke managed access without touching local data.
- An invalid or expired snapshot fails closed for managed access and open for local use.
- A billing database outage leaves previously validated snapshots usable until expiry.

## Acceptance criteria

`npm run billing:sandbox` is the acceptance harness; every criterion below that exercises the billing service maps to a sandbox check.

- Free local features and BYOK work with no billing service configured.
- Trial begins without a card, starts only at the explicit "start trial" action, and stops without an automatic charge when seven days or the $5 credit ends.
- Reservation, settlement, cancellation, retry, duplicate request, and partial provider failure have end-to-end tests.
- Exhaustion pauses managed AI and in-scope cloud access while local use and BYOK continue.
- Signed snapshots cannot be forged or replayed beyond expiry; the sandbox includes a forge/replay rejection check.
- The sandbox includes a duplicate managed-request check proving one idempotency key settles exactly once.
- The sandbox includes a cancellation settlement check proving cancellation settles only incurred provider cost.
- The sandbox includes an exhaustion-pauses-cloud check covering the in-scope cloud features.
- Usage totals reconcile with provider invoices within the min(5%, $0.05) per-request tolerance.
- No prompt, answer, evidence, title, URL, or personal content reaches billing storage or analytics.
- Cancellation, grace, refund, expiration, and cloud-data deletion behavior are visible and tested.
- The pre-exhaustion warning appears at 80% of the period allowance.
- Packaged desktop builds work against a real staging billing environment before release.
- Permanent price and allowance are not published until the beta benchmarks are complete.

## Implementation starting point

The first ticket should consolidate desktop access checks around one validated entitlement snapshot — replacing `BillingAccessSnapshot` — and prove that local features and BYOK never depend on the billing service. Reservation work migrates from the shipped whole-balance single-flight reservation to per-request estimated reservations. Provider and checkout work follows after the snapshot contract passes.
