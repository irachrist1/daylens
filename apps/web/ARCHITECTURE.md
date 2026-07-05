# Daylens Web — Implementation Snapshot

This document describes the current `apps/web` implementation snapshot.

It is not the planning source of truth for the remote companion. Product and architecture decisions live at the Daylens monorepo root:

- `docs/PRD.md`
- `docs/SRS.md`
- `docs/ISSUES.md`

If this file and those planning docs disagree, the planning docs win.

## What `apps/web` Is

`apps/web` is the web companion for Daylens. It is not a standalone tracker and it is not a browser-first SaaS dashboard.

Today it contains three responsibilities:

- the linked web experience
- the public marketing/docs site
- the Convex backend used by browser linking, snapshot storage, and web AI

The desktop app in the `daylens` repo remains the capture engine and the local source of truth.

## Product Mapping

The approved product model is still:

- `Timeline`
- `Apps`
- `AI`
- `Settings`

The linked-app chrome now exposes those exact top-level labels. Some underlying route paths are still legacy implementation details (`/dashboard`, `/history`, `/chat`, `/recap`), but they are mapped back to the approved product model:

- `Timeline` = live/home plus history
- `Apps` = secondary explanation
- `AI` = chat plus recap plus reports/artifacts
- `Settings` = linking, sync health, privacy, provider setup, export/delete/disconnect

## Repo Responsibilities

Daylens currently spans a unified desktop repo plus a small set of companion or archival repos:

| Repo | Responsibility |
|------|----------------|
| repository root | canonical product contract, desktop capture, SQLite persistence, sync export, local AI orchestration |
| `apps/web` | linked web UI, marketing/docs routes, Convex backend, web session/auth flow |
| `daylens-linux` | public transition repo pointing contributors back to `daylens` |
| `daylens-swiftUI` | legacy archived prototype |

## Current End-To-End Flow

### 1. Workspace Creation And Linking

Desktop creates or recovers a workspace, stores the session locally, and creates browser link codes through Convex-backed HTTP endpoints.

Web redeems a link code through a Next.js route, receives a session token, and stores it in the `daylens_session` cookie.

### 2. Current Sync Flow

The current launch-foundation sync path is contract-driven and limited to the approved cloud boundary:

- desktop and `apps/web` share the canonical `packages/remote-contract`
- desktop emits `/remote/heartbeat` roughly every 15 seconds with `workspace_live_presence`
- desktop emits `/remote/syncDay` on startup, on a periodic current-day cadence, and on tracking-driven dirty-day flushes
- desktop now keeps heartbeat freshness separate from durable day-sync success/failure, so a fresh heartbeat does not clear a failed current-day sync
- desktop remote payload shaping now strips raw window titles, raw page titles, raw page URLs, and raw block artifact refs before upload
- the shared remote privacy indicator is now `privacyFiltered`, which truthfully covers both local preference filtering and boundary-required redaction instead of implying user preferences alone
- Convex records `sync_runs`, `sync_failures`, `synced_day_summaries`, `synced_work_blocks`, `synced_entities`, and `synced_artifacts`
- desktop Settings now derive truthful sync state (`local_only | linked | pending_first_sync | healthy | stale | failed`) from live runtime state instead of assuming linked means healthy

Important current limitation:

- local validation cannot prove deployed parity by itself; staging smoke and live Convex codegen still depend on real deployment credentials

### 3. Current Web Read Path

The current browser experience reads from the new truth tables and renders:

- linked-session state
- Timeline/home + history shells backed by `convex/remoteSync.ts`
- `app/api/snapshots` compatibility payloads that are rebuilt from synced day summaries, work blocks, entities, and artifacts
- `app/api/workspace-status` sync health and live presence state for the Timeline banner, with heartbeat freshness shown separately from durable sync success/failure
- a row-based web AI thread/message path grounded on synced Timeline context for web-originated AI flows
- deterministic report/export artifact generation plus row-based artifact reads inside the AI surface through `convex/webAiArtifacts.ts` and `app/api/ai-artifacts/*`
- `/recap` as an AI-entry redirect back into `/chat`, so recap now resolves into the AI surface instead of a separate web shell

Important current limitation:

- Timeline UI still rides on legacy route structure and snapshot-shaped adapters during the migration back to a native proof-first remote surface
- desktop still does not upload shared cloud AI thread/message continuity rows, so true desktop-to-web thread continuation remains pending

## Current Convex Data Model

The current schema includes:

- `workspaces`
- `devices`
- `link_codes`
- `workspace_live_presence`
- `sync_runs`
- `sync_failures`
- `synced_day_summaries`
- `synced_work_blocks`
- `synced_entities`
- `synced_artifacts`
- `web_ai_threads`
- `web_ai_messages`
- `web_ai_artifacts`
- `day_snapshots`
- `encrypted_keys`
- `workspace_preferences`
- `http_rate_limits`

Important current status:

- Snapshot v2 remains the compatibility payload returned to the web UI, but it is now rebuilt from the synced truth tables for the primary Timeline read path
- `day_snapshots` remains a legacy compatibility/fallback path
- `web_chats` is no longer part of the active persistence model; web AI now uses row-based thread/message/artifact tables

## Current Major Gaps

These are the main reasons `daylens-web` is not yet a finished remote companion:

- staging parity still needs a real deployed smoke environment and release credentials
- local Convex codegen still requires a configured `CONVEX_DEPLOYMENT`
- the Timeline UI still uses legacy route internals and compatibility payload adapters
- web AI is still materially thinner than desktop AI for provider-backed orchestration, focus-session workflows, and background-job handling
- there is not yet a full remote-native proof surface for search, review flows, and richer artifact continuation

## Key Files

### Convex Backend

| File | Purpose |
|------|---------|
| `convex/schema.ts` | current Convex tables |
| `convex/http.ts` | HTTP endpoints such as workspace creation, recovery, link-code creation, remote heartbeat/day sync, snapshot upload fallback, and encrypted-key storage |
| `convex/remoteSync.ts` | synced truth-table writes plus Timeline/status reads |
| `convex/snapshots.ts` | snapshot storage, merging, and query helpers |
| `convex/ai.ts` | current web AI action grounded on synced Timeline context |
| `convex/webAiArtifacts.ts` | deterministic web report/export generation plus row-based artifact persistence |
| `convex/webAiThreads.ts` | row-based web AI thread/message persistence |
| `convex/linkCodes.ts` | link-code creation and redemption |
| `convex/sessionTokens.ts` | session token issuance |

### Next.js Frontend

| File | Purpose |
|------|---------|
| `app/link/page.tsx` | browser-link entry flow |
| `app/recover/page.tsx` | workspace recovery flow |
| `app/(app)/layout.tsx` | current linked-app layout and navigation shell |
| `app/(app)/dashboard/*` | current live/home-style shell that should converge into Timeline |
| `app/(app)/history/*` | current historical browsing shell that should converge into Timeline |
| `app/(app)/apps/page.tsx` | Apps top-level redirect into the latest synced day |
| `app/(app)/chat/*` | current AI surface |
| `app/(app)/recap/page.tsx` | AI-entry redirect that resolves recap requests back into `/chat` |
| `app/(app)/settings/*` | settings surface |
| `app/api/ai-threads/route.ts` | authenticated thread-list endpoint for the AI surface |
| `app/api/ai-artifacts/*` | authenticated artifact list/generation/download endpoints for the AI surface |
| `app/api/chat/route.ts` | web AI route |
| `app/api/link/route.ts` | token redemption and session cookie |
| `app/api/snapshots/route.ts` | Timeline compatibility endpoint rebuilt from synced truth tables |
| `app/api/workspace-status/route.ts` | linked workspace sync health/live-presence endpoint |

## Deployment And Ownership

Current reality:

- desktop and web now share the Daylens monorepo
- `apps/web` deploys Next.js and Convex as the remote companion
- production issues can happen if the frontend expects Convex functions that are not deployed yet

Approved direction from the planning docs:

- a shared versioned contract package owns snapshot schemas, sync-state enums, session claims, and shared AI thread/message types
- frontend and backend must pin the same approved contract version before production promotion
- CI validates a generated Convex public-function manifest against frontend usage
- staging must deploy frontend and backend together and run smoke tests for link, Timeline, AI, and Settings before production promotion
- this repo now carries `scripts/check-remote-contract.mjs`, `scripts/check-convex-manifest.mjs`, `scripts/smoke-staging.mjs`, and `.github/workflows/remote-parity.yml` to enforce that parity

## Approved Direction To Build Toward

The remote companion plan is now frozen around these constraints:

- top-level web navigation stays `Timeline`, `Apps`, `AI`, and `Settings`
- launch synced evidence is limited to live presence, sync runs/failures, day summaries, work blocks, entities, and artifacts
- raw capture tables, full file paths, and broad URL/title exhaust are out of the standard cloud sync boundary
- cross-surface AI continuity must use one logical workspace thread model with row-based cloud persistence
- `web_chats` is removed from the active web persistence path

This file should stay descriptive of the implementation snapshot. Strategy and future-state decisions belong in the planning docs, not here.
