# Web companion

**Status:** Ready for review. Implementation waits for desktop acceptance and the browser-encryption feasibility research in the to-do list.

This specification defines the first individual web companion built after the V2 desktop milestone is dependable.

Its first job is remote recall and AI chat. It is not a full mirror of the desktop application and does not capture activity.

## Migration from the current web application

This specification replaces the existing `apps/web` architecture, not just extends it. The current implementation syncs day summaries, work blocks, and entities to Convex as server-readable plaintext, serves linked Timeline, Apps, and AI pages over them, and runs web AI on the server with workspace-stored keys. None of that survives the encrypted design: here the server stores ciphertext it cannot read, search runs in the browser, and AI context is assembled client-side.

The transition rules:

1. The current web surfaces are frozen — no new features — and continue for already-linked people until the encrypted companion replaces them.
2. Existing server-readable synced data is a liability, not an asset to migrate. When the encrypted companion ships, organized facts are re-uploaded from the desktop under the new encrypted contract, and the plaintext Convex tables for memory content are deleted after visible notice. Nothing attempts to convert old plaintext rows in place.
3. Workspace linking is re-established through the device-link flow below; old link sessions are not carried over.
4. Marketing, documentation, download, status, and changelog routes are unaffected.
5. Server-side web AI over synced facts is retired. Managed AI on the web moves to the gateway model in this specification.

The desktop remains the source of truth throughout, so no personal memory is lost by deleting the cloud copy.

## Entry condition

Web implementation begins only after desktop acceptance proves:

- dependable capture on supported platforms
- one canonical corrected activity-fact path
- Timeline and Apps reconciliation
- accepted exact and semantic retrieval
- accepted AI question fixtures
- working deletion, privacy, and model-context inspection

The web companion consumes accepted organized memory. It does not become an alternative place to solve incomplete desktop foundations.

## Product behavior

From an authorized browser, a person can:

- ask the AI agent questions about synced organized memory
- search exact titles, entities, meetings, projects, clients, and summaries
- continue AI threads from desktop
- inspect the organized sources supporting an answer
- manage web sessions and unlink the device

The first release does not reproduce desktop capture, full Timeline editing, Apps analytics, screen context, connector administration, or every desktop setting.

## Web interface

The first interface contains:

- thread list and search
- AI conversation view
- one remote-memory search input
- result cards for blocks, projects, clients, meetings, people, pages, and saved summaries
- source and privacy inspection
- account, device, model, usage, and sign-out controls

A result may show a compact time range and relationship context. It links back to the desktop application for unsupported correction or detailed evidence actions.

## Data boundary

The web companion receives only encrypted organized facts defined by [Privacy, retention, and sync](privacy-retention-and-sync.md).

It does not receive:

- raw foreground events or application sessions
- raw browser history
- unrestricted page titles, URLs, filenames, or local paths
- raw screen frames or screen-derived text
- credentials
- local search indexes
- unreviewed organizational data

Organized source references identify why an answer is supported without transferring the complete underlying desktop record.

## Device linking and encryption

1. The person signs in to the Daylens account.
2. The web browser creates an ephemeral device key pair.
3. An already authorized desktop or recovery method approves the browser.
4. The desktop transfers encrypted account key material through the linking channel.
5. The browser decrypts organized memory locally.
6. The server stores only ciphertext, routing metadata, revisions, and tombstones.

The browser key is stored using the strongest available protected browser storage and is bound to the signed-in session. Signing out or unlinking removes local key material, decrypted caches, indexes, and session data.

A public or shared computer uses a temporary session that clears keys and decrypted data when the tab session ends.

## Remote search

Because the server cannot read encrypted memory, the authorized browser builds a local index from decrypted organized facts.

- Structured filters and exact full-text search run in the browser.
- The index is stored encrypted at rest when persistent browser storage is enabled.
- Semantic search is optional in the first web release and runs locally only when the supported browser can load the accepted embedding model.
- Search results never ask the server to inspect plaintext memory.
- A locked or signed-out browser exposes no result titles or snippets.

## AI chat

The web client resolves relevant organized facts locally and builds the minimum model context for the question.

For managed AI:

1. The browser creates a context manifest.
2. The person can inspect the selected sources on demand.
3. The browser sends the minimized request through the managed AI gateway.
4. The gateway authenticates entitlement, meters provider cost, streams the response, and does not persist prompt or answer content.
5. The browser encrypts the completed thread update before sync.

BYOK in the first web release is available only when the provider can be called safely from the browser without exposing a long-lived key. Otherwise BYOK remains desktop-only until a secure user-controlled relay is specified.

The web agent has read tools only in the first release. Daylens corrections remain on desktop.

## Thread continuity

- Desktop and web use the same stable thread identities.
- Messages are append-only encrypted sync objects.
- A message created offline uploads on reconnection without duplicating it.
- Thread rename, archive, and deletion synchronize across devices.
- Concurrent messages retain stable order by account revision and creation identity.
- A thread opened on web uses its synced conversation plus newly retrieved organized facts, not hidden raw desktop context.
- Deleting a thread removes every encrypted remote copy and local browser cache.

## Entitlement and offline behavior

- Remote recall, sync, and managed web chat require active cloud entitlement.
- Exhausted allowance locks new managed requests and cloud refresh while leaving already decrypted local data visible only for the current authorized session.
- Expired entitlement signs the web surface into an account-only state with billing and data-deletion controls.
- The desktop and its local memory continue to work.
- The web interface explains whether data is stale, sync is paused, or the desktop has not uploaded organized facts.

## Privacy and security

- Account authentication and memory decryption are separate requirements.
- Session cookies are secure, HTTP-only, same-site, rotated, and revocable.
- Content Security Policy blocks unapproved scripts and destinations.
- Decrypted memory never enters analytics, error reporting, logs, browser notification text, or page metadata.
- Browser history and page titles use generic Daylens routes rather than personal thread names.
- Clipboard and download actions are explicit.
- Linking, unlinking, recovery, and sensitive account changes require recent authentication.
- The person can see and revoke every authorized browser and desktop device.

## Failure behavior

- Missing or invalid key material shows a locked state and offers relinking; it does not request plaintext from the server.
- Corrupt ciphertext is quarantined and reported by opaque object identity.
- Interrupted linking leaves no authorized device or usable key.
- Managed AI or billing outage leaves decrypted search and existing threads readable during the authorized session.
- Sync conflict preserves both edits where automatic resolution would lose meaning.
- Unlinking a browser invalidates its session and prevents further encrypted downloads.
- Server rendering never attempts to render personal memory plaintext.

## Acceptance criteria

- A newly linked browser can decrypt, search, and chat over organized facts without receiving raw desktop evidence.
- The server database, logs, analytics, and error reports contain no memory or thread plaintext.
- Desktop and web thread creation, rename, archive, continuation, offline append, and deletion synchronize correctly.
- Remote search answers accepted exact-memory fixtures from encrypted organized facts.
- Managed web answers use the same factual tool semantics and voice as desktop.
- Exhaustion, expiration, unlinking, lost keys, corrupt ciphertext, and offline operation have tests.
- Sign-out removes local keys, decrypted caches, indexes, and personal route metadata.
- The web interface remains intentionally smaller than desktop and does not introduce a second activity model.

## Implementation starting point

The first ticket should define and validate the encrypted organized-fact payload and a browser-only decryption fixture. No production web interface or managed AI call begins until the server is proven unable to inspect the fixture’s plaintext.
