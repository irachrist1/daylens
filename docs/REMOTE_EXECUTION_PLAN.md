# Daylens Remote Execution Plan

Status: Draft for review on 2026-04-20

This document translates the remote companion PRD and SRS into milestones, dependencies, and exit gates.

## Planning Assumption

Build in the same order the product contract requires:

1. truth layer first
2. Timeline proof second
3. AI parity third
4. secondary surfaces after the proof stack is trustworthy

## Ownership Areas

Use these ownership areas even if one person currently owns more than one:

- `desktop-core`: desktop sync packaging, heartbeat, local persistence, versioning
- `cloud-core`: contract package, Convex schema/functions, indexes, jobs
- `web-app`: linked browser UI, navigation, Timeline, Apps, AI, Settings
- `ai-platform`: shared AI contract, routing, artifact/report flows, provider strategy
- `release-ops`: CI gates, staging smoke, observability, rollout controls

## Milestone Sequence

### M0: Freeze The Contract

Objective:

- remove product ambiguity before implementation keeps moving

Deliverables:

- approved nav mapping back to `Timeline`, `Apps`, `AI`, `Settings`
- approved launch sync boundary
- approved AI continuity model
- approved deployment-parity mechanism
- approved parity matrix and execution docs

Dependencies:

- none

Exit gate:

- PRD, SRS, parity matrix, remote contract, and execution plan all agree

### M1: Truth Layer

Objective:

- make remote state honest before expanding surfaces

Deliverables:

- shared `remote-contract` package
- shared sync-state and presence enums
- heartbeat/live-presence path
- incremental current-day sync
- sync runs and sync failures as first-class records
- frontend-plus-cloud parity checks in CI
- staging smoke for link, Timeline, AI, Settings
- Sentry/PostHog baseline for remote incidents and rollout flags

Dependencies:

- M0

Exit gate:

- linked browser can distinguish `pending_first_sync`, `healthy`, `stale`, and `failed`
- remote freshness updates within target budgets under healthy conditions
- staging catches frontend/cloud mismatch before production

### M2: Remote Timeline

Objective:

- ship a truthful remote proof surface based on synced work blocks

Deliverables:

- Timeline live/home subview
- Timeline historical browsing and day detail
- paginated recent history
- indexed day, block, entity, and artifact reads
- search across synced proof entities
- honest empty states for no-sync, stale-sync, and partial-coverage cases

Dependencies:

- M1

Exit gate:

- a linked user can answer "what am I doing now?" and "what did I do that day?" remotely
- normal Timeline reads do not require whole-workspace scans

### M3: Remote Apps Surface

Objective:

- make Apps explanatory, not vanity-driven

Deliverables:

- remote Apps surface mapped to the top-level `Apps` tab
- app-to-workstream, artifact, and co-occurrence explanations
- filters grounded in synced entities and work blocks

Dependencies:

- M2

Exit gate:

- the Apps surface helps explain work context instead of only reporting counts or durations

### M4: AI Parity

Objective:

- make remote AI behave like Daylens, not like a weaker sidecar

Deliverables:

- shared AI contract
- AI SDK-based streaming transport for web
- row-based threads/messages/artifacts/jobs
- deterministic-first routing on web
- cross-surface thread continuity
- recap and report/export flows inside AI
- remote artifact generation, persistence, open/download flows

Dependencies:

- M1 for contract + truth
- M2 for evidence availability

Exit gate:

- a user can start or continue a real Daylens AI thread remotely
- recap and report prompts run from the AI surface
- `web_chats` blob is removed from active product flows

### M5: Remote Settings Completion

Objective:

- make remote operations trustworthy and sparse

Deliverables:

- stable Settings reads
- linked devices and session management
- provider/API key status and opt-in remote key storage flow
- privacy/export/delete/disconnect flows
- honest sync-health presentation

Dependencies:

- M1
- parts of M4 for provider status

Exit gate:

- settings is reliable in deployed environments and explains real workspace state

### M6: Secondary On-The-Go Value

Objective:

- add valuable remote outcomes once proof and AI are already solid

Deliverables:

- remote notifications
- annual Wrapped-style recap
- background recap/report jobs
- selective share/export affordances where privacy allows

Dependencies:

- M2 and M4

Exit gate:

- these features sit on top of truthful proof and continuity rather than compensating for missing foundations

### M7: SaaS Foundation

Objective:

- prepare for multi-user SaaS without breaking the workspace-first model

Deliverables:

- `users`, `organizations`, and membership tables
- access-control model above workspace identity
- retention/deletion policies
- billing and admin design groundwork

Dependencies:

- M1 through M5 stable

Exit gate:

- tenancy can evolve without changing the local-first promise or the approved sync boundary accidentally

## Epic Backlog

### Epic A: Shared Contract And Deployment Gates

Tasks:

- define shared schemas and enums
- generate and validate Convex function manifest
- block production on contract mismatch
- add staging smoke harness and release checklist

### Epic B: Near-Live Sync And Presence

Tasks:

- add heartbeat records and expiry behavior
- add incremental current-day sync packaging
- surface sync failures and stale behavior
- attach correlation IDs across sync and logs

### Epic C: Cloud Query Index

Tasks:

- replace snapshot-heavy request-time merges with indexed query tables
- materialize day summaries, work blocks, entities, artifacts
- add paginated history and search indexes

### Epic D: Timeline

Tasks:

- converge legacy dashboard/history shells into Timeline
- implement live/home truth cards
- implement day detail and month/year browsing
- add honest empty and degraded states

### Epic E: Apps

Tasks:

- model remote app explanations from synced evidence
- show co-occurring workstreams and artifacts
- avoid vanity metrics and bundle-id leakage

### Epic F: AI

Tasks:

- adopt AI SDK transport on web
- add row-based thread/message/artifact/job tables
- build shared orchestration contract and evidence adapters
- move recap/report/export fully into AI

### Epic G: Settings

Tasks:

- stabilize deployed Settings reads
- add device/session controls
- add provider-key status and remote-key opt-in path
- finish privacy/export/delete flows

### Epic H: Observability And Rollout

Tasks:

- add Sentry release/error/performance baselines for web
- finalize PostHog feature-flag split
- define rollout cohorts and kill switches
- add dashboards for sync freshness, deploy drift, and AI failure rates

## Release Gates

Production promotion should stop if any of these are false:

- contract version mismatch exists across desktop/web/cloud
- staging smoke for link, Timeline, AI, or Settings fails
- live presence freshness exceeds the agreed budget without honest stale UX
- normal Timeline reads require whole-workspace scans
- remote AI still depends on `web_chats` or other blob-style persistence
- `ISSUES.md` truthfulness caveats are missing or stale

## Risks

- shipping web polish before truth layer completeness
- widening the cloud sync boundary without a privacy decision
- claiming AI parity while desktop and web still have separate memories
- adding extra top-level surfaces that break the product contract
- underinvesting in deploy parity and repeating production drift failures

## Immediate Next Sprint

The first real implementation sprint should contain only:

1. shared contract package and schema validation
2. sync-state/presence contract wiring
3. incremental current-day sync and live heartbeat
4. deploy-parity CI and staging smoke
5. Timeline convergence plan for legacy web routes

If those five do not land cleanly, do not expand recap, notifications, Wrapped, or SaaS scope yet.
