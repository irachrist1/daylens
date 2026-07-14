# Build the encrypted sync production path and terminal roundtrip

## Why

The current desktop sync uploader is intentionally offline, while the frozen web implementation accepts server-readable snapshots. A terminal test can verify that existing server boundary, but there is no accepted V2 desktop serializer, encrypted queue, or browser decryptor to run end to end.

## Current behavior

`npm run verify:remote-web` verifies the current production remote HTTP route, Convex mutations and projections, sanitization, idempotency, omission deletion, retry, revocation, and web presentation. `npm run verify:synthetic-day` verifies that the offline desktop sync boundary does not mutate or upload local facts. No test claims that these paths implement the encrypted V2 contract.

## Desired behavior

Implement the accepted organized-fact allowlist, client-side encryption, durable desktop queue, revisions and tombstones, retry and offline recovery, device revocation, key transfer, and browser-side decryption without restoring the removed plaintext desktop serializer.

## Dependencies

- Acceptance of `docs/specs/privacy-retention-and-sync.md`.
- Completion of the desktop organized-fact model.
- The browser-encryption feasibility decision required by `docs/specs/web-companion.md`.

## Acceptance checks

- Raw activity, page content, unrestricted paths, credentials, and screen context cannot serialize.
- The server stores ciphertext and routing metadata only.
- Duplicate, reordered, interrupted, offline, retried, corrected, and deleted objects converge.
- Revoked devices cannot read or write; local capture and BYOK continue offline.
- Desktop and web queries agree after decrypting the same revisions.

## Verification

- Extend the local roundtrip harness from the production desktop serializer through the transport adapter, production remote mutations, browser decryptor, and web queries.
- Run the same cases against approved staging credentials before shipping.
