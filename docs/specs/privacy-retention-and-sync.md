# Privacy, retention, and sync

**Status:** Ready for review.

This specification defines what Daylens stores, what may leave the device, how long it remains, how model context is inspected, and how organized memory syncs without turning raw desktop observation into a cloud surveillance dataset.

## Principles

- Local activity stays local by default.
- Permissions are requested when a feature needs them and explain the benefit.
- Private windows and exclusions are enforced before persistence.
- Model requests receive only what the current question needs.
- Raw screen content, audio, and unrestricted page content are never part of normal sync.
- Deletion covers raw evidence, derivatives, indexes, generated content, and remote copies.
- Organizational sharing is explicit and separate from personal sync.

## Data classes

| Class                     | Examples                                              | Default location                   | Default retention                                  |
| ------------------------- | ----------------------------------------------------- | ---------------------------------- | -------------------------------------------------- |
| Core evidence             | Application intervals, verified pages, machine state  | Local device                       | Until deleted                                      |
| Organized facts           | Timeline blocks, entities, corrections, relationships | Local; encrypted sync when enabled | Until deleted                                      |
| Conversation data         | AI threads, confirmed conversational memory           | Local; encrypted sync when enabled | Until deleted                                      |
| Connected evidence        | Calendar, repository, meeting, communication records  | Local, source-scoped               | Until disconnected and deleted or manually deleted |
| High-sensitivity evidence | Screen-derived text, transcripts, message bodies      | Local and separately controlled    | Source-specific                                    |
| Raw screen frames         | Experiment images                                     | Local only                         | Delete after extraction, target under 24 hours     |
| Operational analytics     | Content-free health and performance events            | PostHog                            | Analytics policy period                            |
| Billing records           | Entitlements, usage cost, payment events              | Billing service                    | Financial and legal policy period                  |

Core history remains available until the person deletes it. After one year, Daylens recommends an export and explains storage use. It does not imply that old memory must be deleted.

## Permission model

Every sensitive capability has a separate permission and visible state:

- foreground and window observation
- browser history or active page context
- connector account and scopes
- screen-context experiment
- managed model access
- remote embedding
- encrypted cross-device sync
- MCP access
- organizational sharing

One permission cannot silently grant another. Revocation stops new access immediately and identifies which retained data remains available for review or deletion.

## Local storage

- Evidence, facts, indexes, and corrections use the application-data directory and local SQLite or typed local stores.
- Provider keys and connector credentials use the operating-system secure store.
- Raw screen files are encrypted separately and never stored as database blobs.
- Logs exclude captured content and rotate on a bounded schedule.
- Crash reports contain error structure and application state, not titles, URLs, prompts, answers, or evidence.
- Database migrations are forward-only and preserve existing deletions and corrections.

## Retention and performance

- Core evidence, organized memory, and conversation data have no automatic age deletion.
- Time-partitioned indexes keep active periods fast.
- Old immutable evidence may move to compressed local cold storage after one year.
- Cold storage remains searchable, exportable, and deletable.
- Derived projections and embeddings may be rebuilt and compacted because canonical evidence and corrections remain authoritative.
- Storage pressure produces a clear size report and export or deletion choices; it never silently deletes history.
- The one-year reminder appears once per meaningful storage threshold and can be dismissed.

## Export

Export supports:

- machine-readable JSON for evidence, entities, relationships, corrections, and provenance
- CSV for canonical time and common entity totals
- readable Markdown or HTML summaries selected by the person
- AI threads and confirmed conversational memories
- connector source references permitted by provider terms

Exports exclude credentials, internal encryption keys, billing secrets, and raw screen frames. High-sensitivity derived evidence requires an explicit export selection.

An export is generated locally, reports failures, and includes schema and timezone metadata.

## Model requests

Before any model call, the model-context builder:

1. Resolves the question’s time and entities.
2. Retrieves only relevant corrected facts.
3. Applies exclusions and redaction.
4. Removes credentials, sensitive URL values, and unrelated content.
5. Enforces source and model permissions.
6. Records a local context manifest.

Every AI answer shows source and privacy indicators. On demand, the person can inspect the facts and excerpts sent to the model, the provider and model used, and the sources omitted by privacy rules.

The context manifest contains local evidence references and permitted excerpts. It is not sent to PostHog or billing.

## Encrypted cross-device sync

Sync begins only after explicit enablement and an active cloud entitlement.

Sync includes:

- organized Timeline block facts
- entity identities and confirmed relationships
- corrections and deletion tombstones
- saved summaries
- AI thread messages and metadata
- confirmed conversational memories
- source references needed to explain synced facts

Sync excludes:

- raw foreground events
- raw application sessions and browser history rows
- raw URLs or titles that were not promoted into organized facts
- local file paths and unrestricted filenames
- raw screen frames and screen-derived text
- audio
- provider and connector credentials
- full local search and embedding indexes

The desktop creates a client-side encryption key stored in the operating-system secure store. New devices join through an authenticated device-link flow that transfers encrypted key material. The server stores ciphertext, account routing metadata, versions, and tombstones but cannot read personal memory or thread content.

Losing every authorized device without a recovery method means encrypted memory cannot be recovered. Daylens explains this before sync is enabled.

## Sync protocol

- Every sync object has stable identity, object type, revision, originating device, update time, and deletion state.
- Upload is incremental and idempotent.
- The server assigns monotonic account revisions for download ordering.
- Explicit corrections beat automated facts.
- Deletion tombstones beat older updates and remain long enough to reach every known device.
- Concurrent text or relationship corrections surface a conflict instead of silently merging incompatible values.
- AI messages are append-only except explicit deletion or local redaction.
- An interrupted sync resumes from the last committed revision.
- A new device downloads organized facts only after key transfer and local confirmation.

Sync is a transport for accepted organized memory, not a second place to calculate time or interpretation.

## Subscription and offline behavior

- Local capture and memory continue when sync is disabled, exhausted, expired, or offline.
- When managed allowance is exhausted, uploads, remote access, and managed AI pause; local changes queue in bounded encrypted form.
- BYOK AI continues locally.
- Existing encrypted cloud data remains during a short billing grace period defined by the billing specification.
- Resuming entitlement uploads queued organized changes after applying local privacy and deletion rules again.
- The web companion cannot display new or existing memory without an active cloud entitlement and successful decryption on an authorized client surface.

## Deletion

Deletion is defined by ownership, not a hand-maintained list of screens.

A deletion command:

1. Identifies canonical evidence and organized objects in scope.
2. Deletes or tombstones every dependent local record, index, embedding, artifact, and context manifest.
3. Cancels queued model and sync work.
4. Writes encrypted remote tombstones when sync is enabled.
5. Invalidates every affected projection and cache.
6. Verifies that rebuild and search cannot restore the data.

Deleting the account removes cloud ciphertext, device records, billing linkage permitted by financial retention law, and connector credentials. Local data deletion is a separate explicit device operation so an offline device cannot be falsely described as erased.

## Organizational boundary

Personal sync never implies organizational sharing. An organization receives only a reviewed summary the person explicitly approves through the organizational-sharing flow.

No organization receives raw evidence, personal Timeline access, AI threads, private pages, message bodies, screenshots, or monitoring feeds.

## Failure behavior

- Encryption or keychain failure stops sync before plaintext can leave the device.
- An undecryptable remote object is quarantined and never partially applied.
- Server unavailability queues bounded encrypted changes and leaves local use intact.
- A conflict preserves both values and requests resolution.
- A deletion tombstone is retried until acknowledged by the server and known devices.
- Export failure leaves the source data unchanged and identifies incomplete sections.
- Storage pressure never bypasses retention or privacy policy.
- A model-context build failure sends no partial request.

## Acceptance criteria

- Permission boundaries can be enabled and revoked independently.
- Raw desktop evidence, raw screen content, credentials, and unrestricted paths never enter sync payloads.
- Server-side inspection cannot recover organized memory or AI thread plaintext.
- Multi-device corrections, conflicts, offline changes, tombstones, key transfer, and lost-key behavior have tests.
- Model-context inspection matches the actual permitted evidence sent.
- Export is complete, versioned, local, and usable without Daylens.
- A representative year remains fast without automatic deletion.
- Deletion survives restart, rebuild, reindex, sync, and reconnection.
- Local features and BYOK continue through network, billing, and sync outages.
- Organizational accounts cannot access personal sync objects.

## Implementation starting point

The first ticket should define the organized-fact sync allowlist and prove with contract tests that raw evidence and credentials cannot serialize into a sync payload. Encryption and transport follow only after the local allowlist is accepted.
