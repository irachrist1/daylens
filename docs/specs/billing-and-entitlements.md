# Billing and entitlements

**Status:** Ready for review.

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

## Trial and billing period

- The trial lasts seven consecutive days.
- No payment card is required to begin.
- The trial includes a fixed managed-AI credit and encrypted cloud access.
- The trial ends when time or included credit is exhausted, whichever comes first.
- Trial exhaustion does not charge automatically.
- Monthly and annual subscriptions are available.
- Annual billing is 20% lower than twelve monthly payments.

The permanent monthly price and included allowance are chosen after desktop beta, provider-cost benchmarks, and willingness-to-pay testing. `$14.99/month` is an internal planning assumption only and is not public pricing.

## Entitlement state

The billing service returns one signed entitlement snapshot:

```ts
interface EntitlementSnapshot {
  accountId: string
  state: 'trial' | 'active' | 'grace' | 'exhausted' | 'expired' | 'refunded' | 'unavailable'
  periodStart: number | null
  periodEnd: number | null
  managedCreditGrantedUsd: number
  managedCreditReservedUsd: number
  managedCreditConsumedUsd: number
  canUseManagedAI: boolean
  canUseCloud: boolean
  issuedAt: number
  expiresAt: number
  signature: string
}
```

The desktop validates the signature and expiry. It does not infer paid access from a UI flag or payment receipt alone.

BYOK is a separate local access mode and does not require managed credit.

## Usage metering

Every managed request has a stable request identifier and follows:

```text
estimate → reserve → provider call → settle actual cost → release remainder
```

- Reservation is atomic and idempotent.
- Duplicate retries with the same request identifier cannot charge twice.
- No provider call begins when sufficient credit cannot be reserved.
- Cancellation settles only provider cost already incurred.
- Provider failure releases unused reservation.
- Tool-only work that makes no provider request consumes no model credit.
- Usage records contain account, model, token or unit counts, provider cost, charged credit, status, and timestamps.
- Prompts, answers, evidence, titles, URLs, and personal activity never enter billing records.

Allowance is displayed in understandable monetary credit and estimated questions, with model-specific estimates. Raw tokens may appear in a detailed usage view but are not the primary unit.

## Model choice and cost

People can choose among supported managed models. The picker shows relative quality, speed, and estimated allowance impact.

The billing service maintains versioned provider pricing. A price version is attached to every reservation and settlement so later price changes do not rewrite history.

If a model’s estimated request cost exceeds remaining allowance, Daylens offers another selected model or waits for reset. It does not silently change models.

## Exhaustion

When managed credit is exhausted:

- managed AI pauses
- cloud sync upload and download pause
- web remote recall and chat pause
- existing local memory and AI threads remain readable
- local capture, Timeline, Apps, search, corrections, export, and BYOK continue
- queued cloud changes remain encrypted and bounded locally

There is no automatic overage charge in the first launch. Access resumes at the next period, after a subscription change, or after an explicitly purchased allowance product introduced by a later specification.

## Offline and billing outages

- A recently validated active snapshot may be used offline until its signed expiry.
- After expiry, managed calls and cloud sync pause safely.
- Billing unavailability never disables local features or BYOK.
- Payment-provider webhooks are idempotent and processed into an internal account ledger.
- Conflicting provider events resolve by provider event identity and effective time, not delivery order alone.
- The desktop never stores payment-card details.

## Cancellation, grace, and refunds

- Cancellation takes effect at the end of the paid period.
- Managed access remains active until that time unless the payment is refunded or fraudulent.
- A failed renewal enters a seven-day grace period with visible notice and retry.
- During grace, local features continue and managed access may continue only while valid credit remains.
- After grace, managed AI, cloud sync, and web access pause.
- Encrypted cloud data is retained for 30 days after expiration, then deleted after notice; remote tombstones and legally required billing records may remain.
- Monthly payments are non-refundable after use except duplicate charges, material service failure, or applicable law.
- A first annual purchase is fully refundable within 14 days. Refunding ends managed and cloud entitlement and begins the 30-day cloud-data deletion window.

Support can grant a signed entitlement adjustment or refund through an audited provider-side command. It cannot edit local history.

## Payment providers

Payment providers are adapters behind one internal billing ledger. Polar, Flutterwave, or another provider may be used only after availability, payout, fees, tax, settlement, dispute, and refund behavior are verified for the launch markets.

Provider-specific customer and payment identifiers remain in the billing service. The desktop receives only account and entitlement information needed to operate the product.

## Security and privacy

- Billing uses a random account or installation linkage, not raw activity identity.
- Prompts, answers, model context, evidence, and connector records never enter payment metadata.
- Webhooks verify provider signatures and reject replay.
- Entitlement snapshots are signed and short-lived.
- Administrative adjustments are audited.
- Usage and financial records have separate retention and access controls.
- Billing analytics use plan, model, cost, and status only.

## Failure behavior

- Reservation timeout produces no provider call.
- Settlement failure retries idempotently and keeps the reservation visible.
- Provider cost above reservation settles to actual cost only within an accepted bounded tolerance; larger discrepancies enter review and do not create silent debt.
- Duplicate webhooks do not duplicate entitlement or payment records.
- Refund, dispute, or fraud events revoke managed access without touching local data.
- An invalid or expired snapshot fails closed for managed access and open for local use.
- A billing database outage leaves previously validated snapshots usable until expiry.

## Acceptance criteria

- Free local features and BYOK work with no billing service configured.
- Trial begins without a card and stops without an automatic charge.
- Reservation, settlement, cancellation, retry, duplicate request, and partial provider failure have end-to-end tests.
- Exhaustion pauses managed AI and cloud access while local use and BYOK continue.
- Signed snapshots cannot be forged or replayed beyond expiry.
- Usage totals reconcile with provider invoices within the accepted tolerance.
- No prompt, answer, evidence, title, URL, or personal content reaches billing storage or analytics.
- Cancellation, grace, refund, expiration, and cloud-data deletion behavior are visible and tested.
- Packaged desktop builds work against a real staging billing environment before release.
- Permanent price and allowance are not published until the beta benchmarks are complete.

## Implementation starting point

The first ticket should consolidate desktop access checks around one validated entitlement snapshot and prove that local features and BYOK never depend on the billing service. Provider and checkout work follows after that contract passes.
