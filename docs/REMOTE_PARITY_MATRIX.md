# Daylens Remote Parity Matrix

Status: Draft for review on 2026-04-20

This document turns the remote companion PRD and SRS into a launch parity checklist.

If this file conflicts with `AGENTS.md`, `PRD.md`, or `SRS.md`, those docs win.

## Purpose

Use this matrix to answer four questions before implementation or release:

- what already exists on desktop
- what remote launch must match
- what is intentionally out of remote launch scope
- what concrete gate proves parity is good enough

## Parity Rule

Remote parity does not mean pixel-matching desktop.

Remote parity means a linked user away from their laptop can still:

- understand what is happening now
- reconstruct what happened recently and historically
- ask grounded AI questions with continuity
- access reports, recap, and artifacts remotely
- know whether sync and AI are healthy

## Surface Matrix

| Capability | Desktop today | Remote launch target | Not required for remote launch | Launch gate |
|---|---|---|---|---|
| Workspace creation and linking | create, recover, reveal recovery words, create browser link codes | link/recover in browser, durable session, device visibility, disconnect/revoke | browser-first workspace creation without desktop | fresh browser link works end to end and device/session state is visible |
| Sync truth | local state is authoritative | explicit `linked`, `pending-first-sync`, `healthy`, `stale`, `failed`; last sync and heartbeat shown honestly | pretending remote state is live when it is stale | stale and failure states are user-visible and tested against real workspace drift |
| Timeline live/home | live timeline and current-day proof exist locally | remote `Timeline` home shows latest known work block, current status, last heartbeat, tracked time, top workstreams, recent artifacts | perfect desktop visual parity | linked browser reflects live presence within target freshness budget and degrades honestly when laptop is offline |
| Timeline history | prior days and drill-down exist locally | remote `Timeline` history shows recent days, day detail, paginated browsing, month/year grouping, evidence drill-down | raw local event logs | user can open a prior day and understand what work blocks and evidence existed |
| Search | desktop AI and local evidence can search broadly | remote search across synced days, work blocks, entities, artifacts, apps, and sites | cloud search over unsynced raw capture | indexed search returns relevant results without whole-history scans |
| Apps surface | first-class top-level explanatory surface | remote `Apps` explains work in context, not app vanity counts | every desktop app diagnostic detail | user can answer "what work happened in this tool?" remotely |
| AI chat | full local AI with deterministic routing, streaming, providers, threads, artifacts | remote AI uses shared Daylens contract, streams, preserves threads, supports follow-up continuity, grounded evidence, retry/copy/feedback | desktop-only local shell actions that cannot run remotely | user can continue a thread from another device and get grounded answers |
| AI recap | recap lives inside AI locally | recap flows live inside remote AI, not separate top-level nav | separate recap top-level surface | daily/weekly/monthly recap prompts and views work from AI |
| AI reports and artifacts | reports and artifacts persist locally | remote AI can generate, persist, reopen, and download artifacts from synced evidence | a separate reports top-level product area | row-based artifact persistence exists and downloads/open flows work |
| Settings | local tracking, provider, notifications, privacy, workspace controls | remote `Settings` owns linking, sync health, provider/API key status, privacy, export/delete, disconnect | decorative usage settings or desktop-only controls | settings loads reliably and does not crash on deployed environment mismatch |
| Notifications | local recap/distraction notifications exist | remote notifications cover stale sync, recap ready, report ready, notable summaries | every local notification category on day one | notifications are behind flags and emit the expected events |
| Wrapped | recap direction already exists locally | annual Wrapped-style summary available through AI recap/report flows | dedicated top-level Wrapped tab | one annual recap flow exists with honest coverage messaging |
| Multi-device continuity | local state exists per machine | multiple browsers/devices can view one workspace with coherent sync status and AI thread continuity | multi-user org collaboration at launch | same workspace can be linked from more than one remote client without data confusion |
| SaaS tenancy | not yet first-class | workspace-first launch with a migration path to users/orgs | full billing, seats, and admin before remote proof is solid | data model and contract leave room for `users`, `organizations`, and memberships |

## Launch Evidence Matrix

| Evidence type | Desktop source | Sync to cloud at launch | Why |
|---|---|---|---|
| Raw capture rows | SQLite raw capture tables | No | too sensitive and too low-level for the approved remote boundary |
| Work blocks | local derived work-session model | Yes | this is the remote proof surface |
| Day summaries | local rollups | Yes | supports fast Timeline and AI recap reads |
| Entities | local attribution and derived labels | Yes | enables project/client/workstream search and AI grounding |
| Artifacts | local AI/output artifacts and meaningful work outputs | Yes | required for proof, recap, and remote report access |
| Live presence | local runtime heartbeat/current block preview | Yes | required for truthful near-live remote awareness |
| Sync runs/failures | local sync runtime | Yes | required for honest remote status |
| Full file paths | local capture detail | No by default | privacy boundary |
| Broad URL/title exhaust | local browser capture detail | No by default | privacy boundary |
| Provider-side conversation state | provider implementation detail | No | Daylens memory must stay Daylens-owned |

## AI Parity Matrix

| AI capability | Desktop today | Remote launch target | Remote launch blocker if missing |
|---|---|---|---|
| Deterministic-first routing | present | same rule | yes |
| Streaming | present | present via AI SDK transport | yes |
| Starter prompts | present | present | yes |
| Follow-up continuity | present | shared workspace thread continuity | yes |
| Thread switching | present | present | yes |
| Artifact persistence | present | present with row-based cloud records | yes |
| Report/export generation | present | present from synced evidence | yes |
| Provider selection/model routing | present | present with job-tier routing | important but can launch with a narrower provider set if explicit |
| Focus-session actions | present | can be deferred if remote cannot honestly execute them yet | no, unless web claims parity for that workflow |
| Local-only filesystem or shell operations | present | not required remotely | no |

## Explicit Non-Parity At Launch

These gaps are acceptable at remote launch only if they are documented honestly in `ISSUES.md`:

- desktop-native shell features that do not translate to browser surfaces
- local-only provider execution paths that require machine-local secrets or binaries
- org billing, seat management, and team administration
- advanced background jobs that are planned but still flagged off

These gaps are not acceptable at remote launch:

- remote state that looks fresh when it is stale
- separate top-level web navigation that contradicts the product contract
- cloud chat memory that cannot continue across surfaces
- whole-workspace query scans on normal Timeline reads
- production frontend and cloud deployments that can drift silently

## Release Checklist

- Navigation matches `Timeline`, `Apps`, `AI`, `Settings`.
- Launch sync boundary matches the approved evidence matrix.
- AI continuity uses row-based thread, message, and artifact records.
- Timeline live/home and history both work from synced work-block evidence.
- Settings loads without frontend-plus-backend drift failures.
- Shared contract and manifest checks pass in CI.
- Staging smoke covers link, Timeline, AI, and Settings.
- `ISSUES.md` records any remaining truthfulness caveats before release.
