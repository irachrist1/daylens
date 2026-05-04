# Daylens Remote Contract

Status: code-audited refresh on 2026-05-04. Merges the prior `REMOTE_PARITY_MATRIX.md` and `REMOTE_EXECUTION_PLAN.md` into one source of truth.

This file documents the shared remote contract as it exists in code today, the parity status between desktop and remote/web, and the next execution sequence after the audit.

## Shared Package

The contract lives in `packages/remote-contract` and is re-exported to the desktop snapshot layer from `src/shared/snapshot.ts`.

Code references:

- `packages/remote-contract/index.ts:1-318`
- `src/shared/snapshot.ts:1`

Current contract version:

- `2026-04-20-r2` (`packages/remote-contract/index.ts:1`)

## Code-Proven Contract Shapes

### Snapshot V2

Desktop snapshot v2 includes:

- focus score V2
- work blocks
- recap
- coverage
- top workstreams
- standout artifacts
- entities
- `privacyFiltered`

Code references:

- `packages/remote-contract/index.ts:179-193`
- `src/main/services/snapshotExporter.ts:343-552`

### Sync Health And Presence

Current contract types:

- `SyncHealth`: `linked | pending_first_sync | healthy | stale | failed`
- `WorkspacePresenceState`: `active | idle | meeting | sleeping | offline | stale`

Desktop runtime derivation also has a local-only pre-link state:

- `local_only | linked | pending_first_sync | healthy | stale | failed`

Code references:

- `packages/remote-contract/index.ts:199-212`
- `src/main/services/syncState.ts:5-24`
- `src/main/services/workspaceLinker.ts:183-198`

### Remote Payload Boundary

The launch payload already contains:

- one day summary
- work blocks
- entities
- artifacts
- contract version, device id, local date, generated-at

Desktop privacy shaping removes raw block artifact refs and generalized page labels before upload.

Code references:

- `packages/remote-contract/index.ts:235-263`
- `src/main/services/remoteSync.ts:43-69`
- `src/main/services/remoteSync.ts:192-227`

### Workspace AI Types

The shared contract already defines:

- `WorkspaceAIThread`
- `WorkspaceAIMessage`
- `WorkspaceAIArtifact`

Code references:

- `packages/remote-contract/index.ts:287-318`

## Important Narrowings In The Current Implementation

### Entity Rollups

The contract allows `client | project | repo | topic`. Desktop exporter currently loads only `client` and `project` (`src/main/services/snapshotExporter.ts:279-321`).

### Work Block Label Source

The remote contract exposes `user | ai | rule`. Local timeline finalization internally distinguishes `user | ai | artifact | workflow | rule` (`src/main/services/workBlocks.ts:1301-1349`, `src/main/services/snapshotExporter.ts:192-216`). Remote consumers see a normalized label-source surface instead of the fuller local provenance.

### Shared AI Continuity

The contract has shared workspace AI thread/message/artifact types, but desktop does not yet write those rows to the remote backend. Web-side AI persistence is therefore real but still web-originated today (`packages/remote-contract/index.ts:287-318`, `src/main/services/artifacts.ts:339-342`).

## Web Compatibility Layer Still Present

`daylens-web` still normalizes legacy `hiddenByPreferences` input into the stronger `privacyFiltered` field when reading older snapshot payloads (`daylens-web/convex/snapshots.ts:228-230`).

## Contract Truthfulness Rules

- Do not claim remote AI continuity across desktop and web until the desktop writes shared remote AI rows.
- Do not claim broader first-class entity support than the exporter actually emits.
- Do not widen the remote payload boundary beyond privacy-filtered work blocks, entities, artifacts, and day summary without an explicit decision.

---

## Parity Matrix

| Capability | Desktop code | Remote/web code | Status | What still needs proof or work |
|---|---|---|---|---|
| Workspace creation and recovery | Mnemonic-based create/recover, browser link, disconnect (`src/main/services/workspaceLinker.ts:64-178`) | Web recovery/session issuance (`daylens-web/convex/workspaces.ts:48-93`) | Code-proven | Real linked-workspace user validation across devices |
| Sync truth | Heartbeat + durable day sync split; state derived from durable outcome + heartbeat freshness (`src/main/services/syncUploader.ts:125-202`, `src/main/services/syncState.ts:5-24`) | Remote truth tables, session-scoped status (`daylens-web/convex/remoteSync.ts`) | Code-proven | Real stale/failure UX validation |
| Timeline proof surface | Persisted blocks, gaps, day/week views, drill-down (`src/main/services/workBlocks.ts:1438-1607`, `src/renderer/views/Timeline.tsx:1184-1545`) | Desktop-style Timeline from v2 snapshots; summaries/day/range route through remoteSync (`daylens-web/app/components/SnapshotContent.tsx:16-35`) | Implemented pending verification | Retire legacy snapshot reads, real linked validation |
| Apps surface | Contextual app summaries and detail/narrative (`src/renderer/views/Apps.tsx:144-245`) | Dedicated `Apps` nav and client (`daylens-web/app/components/AppsDayClient.tsx`) | Partial | Remote Apps lighter than desktop context depth |
| AI surface | Persistent local threads/artifacts, recap, streaming, retry/copy/rating, focus actions (`src/renderer/views/Insights.tsx:957-1715`) | Web AI threads/artifacts UI (`daylens-web/app/components/GlobalChat.tsx`) | Partial | Desktop-to-web shared AI continuity unimplemented |
| Reports and artifacts | Local artifact persistence/open/export (`src/main/services/artifacts.ts:24-170`) | Web artifact listing exists | Implemented pending verification | End-to-end cross-surface artifact continuity |
| Settings | Tracking, Sync, AI, Labels, Notifications, Appearance, Updates, Privacy (`src/renderer/views/Settings.tsx:799-1334`) | Remote Settings page exists | Implemented pending verification | Real deployed-environment validation |
| Recap inside AI | Desktop recap real in AI surface (`src/renderer/views/Insights.tsx:1608-1715`) | Web AI recap panel (`daylens-web/app/components/GlobalChat.tsx:247-320`) | Implemented pending verification | Broader runtime validation and usefulness review |
| Structured entities | Exports clients/projects (`src/main/services/snapshotExporter.ts:279-321`) | Contract allows more kinds (`packages/remote-contract/index.ts:153-159`) | Partial | Broaden exporter or narrow contract/docs |
| Browser evidence | macOS/Windows browser history capture (`src/main/services/browser.ts`) plus active-tab context on macOS (`src/main/services/browserContext.ts`) | Receives privacy-filtered evidence via synced work blocks | Partial | Linux browser-history capture still absent; Windows active-tab context still absent |

### Parity summary

Code-proven foundation: workspace linking, sync truth model, remote shell/navigation, privacy-filtered sync payloads.

Main remaining gaps: desktop-to-web AI continuity, full remote Apps/context parity, broader entity export parity, linked multi-device runtime validation.

---

## Execution Order After This Audit

1. **Prove the existing truth layer.** Real linked-workspace desktop-to-browser validation; stale/failure-state validation under real disconnect/recovery; packaged-app validation for workspace linking and sync status on macOS, Windows, and Linux. The architecture is already correct — the truthfulness risk is now runtime validation, not missing scaffolding.
2. **Finish shared AI continuity.** Write desktop AI turns/artifacts into the shared remote AI rows; load those rows on web; preserve local-first desktop behavior while enabling remote continuation. The contract already exists and this is the biggest remaining product gap between desktop AI and web AI.
3. **Remove the remaining legacy snapshot read path.** Replace remaining legacy `snapshots` full-read dependency; keep migration compatibility only as long as necessary.
4. **Deepen remote proof surfaces.** Strengthen remote Apps context from synced work blocks and artifacts; add indexed remote search over synced proof entities; improve day/week/month remote recap usefulness only after continuity and truth are solid.
5. **Broaden attribution carefully.** Decide whether to truly support `repo` and `topic` as first-class exported entities, or narrow the contract/docs so they stop implying more than the exporter produces.

### Exit criteria for the next major remote pass

- Real linked-workspace validation is documented separately from code-only proof.
- Desktop and web can continue the same remote AI thread.
- `remoteSync` is the active read path for normal remote proof flows.
- `docs/ISSUES.md` and remote docs remain aligned with the code after each step.
