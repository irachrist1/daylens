# Daylens Remote Contract

Status: Draft for review on 2026-04-20

This document defines the shared product and data contract between desktop Daylens, the cloud sync layer, and the remote web companion.

It is the implementation-facing companion to `PRD.md` and `SRS.md`.

## Purpose

This contract exists to stop three recurring failure modes:

- frontend and backend deploying out of sync
- remote features shipping before the sync boundary is frozen
- desktop and web drifting into separate AI and data models

## Contract Ownership

The contract should live in a shared versioned package, referenced here as:

- `packages/remote-contract`

That package should own the shared types and validation schemas used across repos.

It should not own desktop-only capture internals or renderer-only UI types.

## Contract Versioning

Every remote release must expose:

- `contractVersion`
- `minimumSupportedDesktopVersion`
- `minimumSupportedWebVersion`
- `minimumSupportedCloudVersion`

Rules:

- breaking sync-shape changes require a contract version bump
- frontend and cloud must not promote to production on different approved contract versions
- desktop may lag temporarily only if the contract explicitly supports backward compatibility for that version window

## Approved Launch Entities

The contract must define the following shared remote entities:

- `workspace`
- `device`
- `webSession`
- `workspaceLivePresence`
- `syncRun`
- `syncFailure`
- `syncedDaySummary`
- `syncedWorkBlock`
- `syncedEntity`
- `syncedArtifact`
- `webAiThread`
- `webAiMessage`
- `webAiArtifact`
- `aiJob`

## Sync Boundary

The approved launch sync boundary is limited to:

- live presence
- sync runs
- sync failures
- day summaries
- work blocks
- entities
- artifacts

The contract must explicitly reject these as standard launch payloads:

- raw capture rows
- full file paths
- broad URL/title exhaust
- provider-side memory as Daylens memory

## Identity And Session Contract

Shared identity/session fields must include:

- `workspaceId`
- `deviceId`
- `sessionId`
- `issuedAt`
- `expiresAt`
- `contractVersion`

Web session claims must always scope reads and writes to a workspace, and later must allow extension to user/org membership without breaking workspace-based linking.

## Sync State Contract

The shared sync-state enum must include:

- `unlinked`
- `pending_first_sync`
- `healthy`
- `stale`
- `failed`
- `offline`

The shared live-presence enum should include:

- `active`
- `idle`
- `meeting`
- `sleeping`
- `offline`
- `unknown`

Every remote Timeline read must carry enough state to answer:

- is this workspace linked?
- when did it last heartbeat?
- when did it last sync durably?
- is the current view fresh enough to trust?

## Launch Payload Shapes

### Heartbeat / Live Presence

Minimum fields:

- `workspaceId`
- `deviceId`
- `capturedAt`
- `status`
- `currentBlockPreview`
- `lastMeaningfulActivityAt`
- `syncState`
- `contractVersion`

Behavior rules:

- this payload is low-latency and overwrite-friendly
- it is not the canonical durable history model
- expiry or stale cleanup must be bounded and automatic

### Sync Run

Minimum fields:

- `syncRunId`
- `workspaceId`
- `deviceId`
- `startedAt`
- `completedAt`
- `status`
- `contractVersion`
- `payloadKinds`
- `highWatermark`

Behavior rules:

- sync runs are append-only records
- retries must be idempotent
- failures must retain reason codes safe for UI and observability

### Day Summary

Minimum fields:

- `workspaceId`
- `date`
- `trackedMinutes`
- `focusScore`
- `topWorkstreams`
- `artifactCount`
- `coverage`
- `lastSyncedAt`
- `contractVersion`

### Work Block

Minimum fields:

- `workspaceId`
- `blockId`
- `date`
- `startAt`
- `endAt`
- `label`
- `workIntent`
- `confidence`
- `entityRefs`
- `artifactRefs`
- `evidenceRefs`
- `lastSyncedAt`
- `contractVersion`

Behavior rules:

- work blocks are the primary remote proof unit
- unattributed or low-confidence blocks must remain visible
- labels must prefer stable deterministic or reviewed labels over churn

### Entity

Minimum fields:

- `workspaceId`
- `entityId`
- `type`
- `name`
- `aliases`
- `evidenceCount`
- `lastSeenAt`
- `contractVersion`

### Artifact

Minimum fields:

- `workspaceId`
- `artifactId`
- `type`
- `title`
- `source`
- `createdAt`
- `fileRef`
- `relatedBlockIds`
- `relatedEntityIds`
- `contractVersion`

Behavior rules:

- metadata lives in queryable records
- large files live in durable object/file storage

## AI Continuity Contract

Cross-surface AI continuity requires shared row-based records:

- `webAiThread`
- `webAiMessage`
- `webAiArtifact`
- `aiJob`

Minimum thread fields:

- `threadId`
- `workspaceId`
- `title`
- `origin`
- `createdAt`
- `updatedAt`
- `lastMessageAt`
- `archivedAt`

Minimum message fields:

- `messageId`
- `threadId`
- `workspaceId`
- `role`
- `content`
- `status`
- `provider`
- `model`
- `createdAt`
- `tokenUsage`
- `latencyMs`
- `deterministic`
- `evidenceRefs`

Rules:

- provider-side state is optional and non-canonical
- successful turns must persist Daylens-owned messages
- thread continuity across desktop and web must use the same logical workspace thread identity
- the legacy `web_chats` blob is outside the approved contract

## API Key Contract

Provider-key rules:

- local OS credential storage remains default
- cloud-stored encrypted copies are an explicit opt-in remote feature
- key presence and provider status may sync; raw secrets must not appear in analytics or generic logs
- remote AI should degrade honestly when no remote-usable key exists

## Deploy-Parity Contract

The release process must enforce:

- shared contract package version match
- generated Convex public-function manifest compatibility
- environment validation for required remote secrets
- staging smoke success for link, Timeline, AI, and Settings before production promotion

## Compatibility Rules

- additive fields are preferred over destructive replacements
- deprecated fields must remain readable for at least one planned migration window
- schema migrations must not silently orphan old synced records
- clients must reject unknown critical contract versions loudly rather than rendering misleading state

## Acceptance Criteria

- desktop, web, and cloud all compile against the same shared contract package
- remote reads expose sync state and contract version
- work blocks, day summaries, entities, and artifacts validate against shared schemas
- AI turns persist row-based threads/messages/artifacts instead of workspace blob documents
- production deployment blocks on contract or manifest mismatch
