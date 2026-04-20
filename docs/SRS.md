# Daylens Remote Companion SRS

Status: Draft for review on 2026-04-20

This document defines the system requirements for turning Daylens Web from a linked read-only companion into a scalable remote Daylens surface with AI parity.

## References

- [README.md](../README.md)
- [docs/AGENTS.md](AGENTS.md)
- [docs/PRD.md](PRD.md)
- [docs/REMOTE_PARITY_MATRIX.md](REMOTE_PARITY_MATRIX.md)
- [docs/REMOTE_CONTRACT.md](REMOTE_CONTRACT.md)
- [docs/REMOTE_EXECUTION_PLAN.md](REMOTE_EXECUTION_PLAN.md)
- [docs/ISSUES.md](ISSUES.md)
- [daylens-web/ARCHITECTURE.md](../../daylens-web/ARCHITECTURE.md) as the current implementation snapshot only

If the implementation snapshot and the planning docs disagree, `docs/PRD.md` and `docs/SRS.md` win.

## Scope

This SRS covers:

- the remote companion architecture across desktop sync, cloud storage, web clients, and AI
- the requirements needed for user-facing parity with desktop Daylens
- the constraints required for multi-user SaaS evolution

This SRS does not redefine desktop capture internals beyond what the remote stack depends on.

## Current System Summary

### Desktop Today

The desktop app in `daylens` is the product source of truth. It already provides:

- raw capture and local SQLite persistence
- timeline, apps, AI, recap, settings, notifications
- durable AI threads and artifacts in local tables such as `ai_threads` and `ai_artifacts`
- multi-provider AI orchestration with deterministic routing, streaming, reports, and focus-session workflows

### Web Today

The web companion in `daylens-web` currently provides:

- workspace linking and recovery
- cookie-based web sessions
- Convex-backed day snapshot storage
- legacy live/home and history shells that still need to converge back to the `Timeline` contract
- a simplified AI Q&A route over synced day snapshots

### Current Technical Gaps

- web queries still rely primarily on merged day snapshots, not a fuller remote query model
- web AI is not feature-parity with desktop AI
- web chat persistence is incomplete
- current Convex usage includes full-workspace scans for summary queries
- current `web_chats` storage is one growing document per workspace
- frontend deployment can drift from deployed Convex public functions

## External Research Findings

This section captures platform constraints and patterns verified against official Convex documentation during the 2026-04-20 planning pass.

### Convex Indexing And Query Shape

- Convex explicitly warns that generic filters can degrade into full table scans and recommends indexes instead.
- Convex supports cursor-based paginated queries and reactive pagination as a first-class pattern.
- Therefore the remote companion shall not rely on whole-workspace merges for standard Timeline live/home and historical reads once the cloud query model grows.

### Convex Document Limits

- Convex documents and values have a 1 MiB total size limit.
- Therefore unbounded workspace-level chat documents such as the current `web_chats` shape are not acceptable as the long-term model.

### Search

- Convex supports full-text search indexes with pagination.
- Convex also supports vector search in actions.
- Therefore remote search and AI retrieval should be designed around indexed search tables instead of repeated broad document scans.

### File And Artifact Storage

- Convex file storage supports uploading, storing generated files, serving files by URL, and referencing file IDs from normal documents.
- Therefore remote AI artifacts should move toward explicit artifact records plus file storage rather than inline-only payloads.

### Scheduling And Background Jobs

- Convex supports durable scheduled functions and cron jobs.
- Therefore recap generation, report jobs, notification jobs, and cleanup or rebuild flows should be modeled as durable background work where appropriate.

### Deployment Coordination

- Convex production guidance recommends deploying frontend and backend together and using preview or staging deployments to test changes safely.
- Therefore Daylens Remote must treat frontend-plus-Convex deployment parity as a release requirement, not optional hygiene.

### AI SDK Patterns

- Vercel AI SDK Core exposes `generateText` and `streamText`, and AI SDK UI exposes `useChat` with a default `/api/chat` transport.
- AI SDK UI documents message persistence via the server-side `onFinish` callback rather than client-only optimistic state.
- AI SDK UI also supports resumable streams, but stream resumption requires an external store such as Redis and is explicitly incompatible with abort semantics.
- AI SDK telemetry is based on OpenTelemetry and is still marked experimental.
- Therefore Daylens should treat the AI SDK as a transport, streaming, and typed-message layer for the web companion, not as the persistence layer or product memory model.

### Model Guidance

- OpenAI currently recommends `gpt-5.4` as the default model for important work and coding, with `gpt-5.4-mini` and `gpt-5.4-nano` for faster and cheaper workloads, and `gpt-5.4-pro` for harder long-running problems.
- Anthropic currently recommends Claude Opus 4.7 for the most complex tasks, Claude Sonnet 4.6 as the best speed-intelligence balance, and Claude Haiku 4.5 as the fastest tier.
- Therefore Daylens should move from ad hoc provider defaults toward an explicit per-job routing policy with separate tiers for background enrichment, interactive chat, and deep report generation.

### Sentry And AI Monitoring

- Sentry's Next.js SDK supports errors, source maps, logs, session replay, tracing, AI agent monitoring, metrics, profiling, crons, user feedback, and feature flags.
- Sentry's Electron SDK supports error monitoring, logs, session replay, tracing, and user feedback.
- Sentry also provides AI monitoring integrations for Vercel AI SDK and direct provider SDKs, with privacy controls for recording prompts and outputs.
- Therefore Daylens can standardize on Sentry as the primary error, performance, and AI-tracing system across desktop and web without inventing a custom tracing stack first.

### PostHog Product Instrumentation

- PostHog feature flags support phased rollouts, kill switches, targeting, A/B testing, and remote config.
- PostHog session replay is explicitly positioned for diagnosing UI issues and understanding nuanced user behavior.
- PostHog error tracking exists, but its strongest fit for Daylens is product analytics, rollout control, and web replay rather than becoming a second primary incident system next to Sentry.
- Therefore Daylens should use PostHog for product analytics, feature flags, experiments, and selective masked web replay, while leaving primary errors and traces to Sentry.

## Architectural Decision

Daylens Remote will remain a local-first product with a cloud query layer.

The intended layered model is:

1. local raw capture on desktop
2. local derived work-session and artifact graph
3. synced cloud query index for remote use
4. remote AI and UI built on that synced query index

The cloud layer must not become the only source of truth for capture. It must become the remote access layer for trustworthy synced evidence.

## Target System Architecture

```text
Desktop Capture + Local SQLite
  -> Sync Packaging + Upload Queue
  -> Cloud Identity + Sync API
  -> Cloud Query Index + Materialized Views
  -> Remote AI Orchestrator
  -> Web / Mobile Browser Clients
  -> Notifications / Reports / Recap Jobs
```

### Component 1: Desktop Capture And Local Persistence

Requirements:

- raw local capture remains on desktop
- raw capture is never overwritten
- local work blocks, entities, artifacts, and derived summaries remain available even when offline
- sync export must be idempotent and resumable

### Component 2: Sync Packaging

Requirements:

- sync must package enough evidence for remote parity, not only day totals
- sync payloads must be versioned
- uploads must be incremental or chunked, not dependent on full-history request-time merges
- sync must report health explicitly: linked, pending-first-sync, healthy, stale, failed
- sync retries must be safe and idempotent

### Component 3: Cloud Identity Layer

Requirements:

- maintain workspace identity and device linking
- evolve toward explicit user and organization entities
- support secure session issuance and revocation
- support retention and deletion controls

### Component 4: Cloud Query Index

Requirements:

- store remote-facing query data by day and by entity
- support efficient recent-history reads without scanning all workspace data
- support paginated history, search, recap, and AI evidence retrieval
- support materialized summary views for Timeline live/home and AI recap use cases

### Component 5: Remote AI Orchestrator

Requirements:

- enforce the same product contract as desktop AI
- prefer deterministic answers when possible
- support multi-turn state, thread persistence, artifact generation, and follow-up routing
- support provider abstraction so web and desktop share user-facing behavior even when provider capabilities differ

### Component 6: Web And Mobile Browser Clients

Requirements:

- browser clients must render honest sync state
- browser clients must prioritize remote decision usefulness over decorative summary surfaces
- layouts must support desktop and mobile browser access

## Concrete Architecture Decisions

### AD-000 Navigation And Surface Contract

- Top-level web navigation shall remain `Timeline`, `Apps`, `AI`, and `Settings`.
- `Timeline` shall contain the live/home view and historical browsing as subviews.
- `AI` shall contain chat, recap, reports/exports, artifacts, and related review flows.
- Dedicated routes such as `/history`, `/dashboard`, `/recap`, or `/reports/...` may exist for implementation or deep-link reasons, but they must resolve back to one of those four product surfaces.
- The remote companion shall not ship top-level `Dashboard`, `History`, `Recap`, or `Reports` navigation.

### AD-001 AI SDK Adoption

- Daylens Web shall adopt Vercel AI SDK Core and UI for server-side streaming, typed chat transport, and client message handling.
- Daylens shall keep Daylens-owned threads, messages, artifacts, and usage records as the source of truth instead of delegating memory to provider-side stores or SDK examples.
- Daylens shall not require Vercel AI Gateway for launch because the product is built around user-owned provider keys and a local-first trust model.
- Desktop may later share server-side AI SDK abstractions where they improve parity, but desktop orchestration does not need to migrate wholesale before remote parity ships.

### AD-002 Model Routing Strategy

- Background enrichment, titling, and preview jobs shall default to fast economical models such as Claude Haiku 4.5, GPT-5.4-mini, or Gemini Flash-class models.
- Interactive grounded chat shall default to strong mid-to-frontier models such as Claude Sonnet 4.6 or GPT-5.4.
- Deep exports, reports, and hard synthesis jobs shall run on the strongest available tier such as Claude Opus 4.7 or GPT-5.4-pro, preferably as background jobs.
- The system shall persist provider, model, latency, token usage, cache usage, and failure reason for every AI job so model-routing choices can be tuned empirically.
- Provider-side conversation IDs or stored responses may be used as performance hints, but Daylens-owned thread/message records remain canonical.

### AD-003 Near-Live Sync Strategy

- Daylens will not promise literal zero latency. It shall promise honest near-live visibility when the laptop is online.
- The remote stack shall split live presence from durable history sync:
- `live presence`: heartbeat, active block preview, idle or meeting state, and freshness markers
- `durable sync`: work blocks, summaries, artifacts, entities, and recap materialization
- Desktop shall move away from 5-minute-only polling toward event-driven or short-interval incremental sync for current-day changes.
- Convex subscriptions or equivalent reactive cloud delivery shall push freshness updates to web clients instead of relying on repeated full reload polling.

### AD-004 Data Persistence Strategy

- SQLite remains the raw and durable source of truth on desktop.
- The cloud layer shall store appendable, queryable records for sync runs, day summaries, work blocks, entities, artifacts, AI threads, AI messages, and job state.
- Large artifacts shall be stored as files or object references, with metadata records in the query database.
- Provider API keys shall stay local by default in the OS credential vault; encrypted cloud copies for remote AI shall be explicit, revocable, and treated as an opt-in remote capability.

### AD-005 Observability And Rollout Strategy

- Sentry shall be the primary system for errors, traces, release health, source maps, and AI-call tracing across desktop and web.
- PostHog shall be the primary system for product analytics, feature flags, experiments, and selective masked web replay.
- Daylens shall avoid double-instrumenting equivalent replay products by default.
- Risky remote launches shall be protected by feature flags and staged rollouts rather than direct global release.

### AD-006 Launch Sync Boundary

- The approved launch sync payload is limited to `workspace_live_presence`, `sync_runs`, `sync_failures`, `synced_day_summaries`, `synced_work_blocks`, `synced_entities`, and `synced_artifacts`.
- Raw local capture tables, full file paths, broad URL/title exhaust, and other uncurated evidence logs shall not be uploaded as standard remote payloads.
- Any synced title, page label, or artifact label must already be part of the user-visible proof model and must pass privacy filtering before upload.

### AD-007 Cross-Surface AI Continuity

- Desktop and web shall converge on one logical workspace thread model for synced Daylens AI conversations.
- Cross-surface continuation requires row-based cloud records for threads, messages, artifacts, and AI job metadata.
- Provider-side conversation state is never canonical.
- The legacy `web_chats` blob is transitional only and is not part of the approved launch design.

### AD-008 Cross-Repo Deployment Parity Mechanism

- A shared versioned contract package shall own snapshot schemas, sync-state enums, auth/session claims, and shared AI thread/message types consumed across repos.
- Production deploys shall require the frontend and cloud backend to reference the same approved contract version.
- CI shall validate a generated Convex public-function manifest against frontend usage and fail on incompatibilities.
- Staging shall deploy frontend and backend together and run smoke tests for link, Timeline, AI, and Settings before production promotion.

## Shared AI Architecture Requirement

Web AI must not remain a separate lightweight prompt path.

Required target model:

- a shared AI product contract
- a shared orchestration layer or shared orchestration library
- evidence adapters for local and cloud data sources

Recommended structure:

- `Shared AI Contract`: prompts, routing rules, answer kinds, thread state, artifact semantics
- `Local Evidence Adapter`: reads SQLite and local derived data
- `Cloud Evidence Adapter`: reads synced cloud query index

This preserves parity while allowing web to be faster through:

- precomputed evidence packs
- materialized recap context
- cached workstream and day summaries

## Functional Requirements

### FR-001 Identity And Linking

- The system shall support workspace creation, recovery, browser linking, and device listing.
- The system shall distinguish `linked` from `synced`.
- The system shall allow revocation of individual web sessions and devices.

### FR-002 Sync Health

- The system shall expose current sync status and last successful sync time.
- The system shall surface stale or failed sync states in the UI and to AI.
- The system shall not present remote data as current when sync is stale beyond a configurable threshold.

### FR-003 Navigation Contract

- The system shall expose only `Timeline`, `Apps`, `AI`, and `Settings` as top-level product navigation on the web companion.
- Dedicated routes and deep links shall map back to one of those top-level categories rather than creating a second navigation model.

### FR-004 Timeline Surface

- The system shall provide a top-level `Timeline` surface on the web companion.
- The Timeline surface shall include a live/home subview showing the latest known work context.
- The Timeline surface shall include historical day detail, recent-day browsing, and paginated history.
- The Timeline surface shall support month and year grouping as history grows.
- The Timeline surface shall preserve unattributed and low-confidence blocks instead of collapsing them.

### FR-005 Search

- The system shall support remote search across days, work blocks, artifacts, apps, sites, and entity labels.
- Search shall operate on indexed remote query data rather than full-history scans.

### FR-006 Apps Surface

- The system shall expose an apps surface that explains work in context.
- The apps surface shall show associated workstreams, artifacts, files, pages, and co-occurring tools where synced evidence exists.

### FR-007 AI Parity

- The system shall support freeform grounded chat on web.
- The system shall support deterministic answer routing where deterministic evidence suffices.
- The system shall support starter prompts, follow-up continuity, retry, copy, and feedback.
- The system shall support persisted threads, messages, and artifacts.
- The system shall support report/export generation from the AI surface.
- The system shall support recap and review prompts from the AI surface.

### FR-008 Recap And Wrapped

- The system shall provide daily, weekly, monthly, and annual recap flows remotely through the AI surface.
- The system shall provide standout artifacts, top workstreams, and comparison narratives.
- The system shall support a Wrapped-style annual summary.

### FR-009 Notifications

- The system shall support remote notifications for stale sync, recap readiness, report readiness, and notable summaries.
- Notifications shall degrade gracefully when platform notification support is unavailable.

### FR-010 Settings

- The system shall expose linked devices, privacy controls, notifications, API key management, export, delete, and disconnect flows.
- The settings surface shall remain sparse and functional.

### FR-011 Privacy And Export

- The system shall support hidden apps/domains and privacy-controlled rendering remotely.
- The system shall support export and deletion controls for synced remote data.

### FR-012 Accounts And Organizations

- The system shall evolve from workspace identity to explicit user and organization entities without breaking the local-first workspace contract.
- The system shall support multiple devices per workspace and later multiple users per organization.

### FR-013 Near-Live Presence

- The system shall expose a live or latest-known workspace state independently from historical day summaries.
- The system shall distinguish `active`, `idle`, `meeting`, `sleeping`, `offline`, and `stale` where evidence is available.
- The system shall show the last heartbeat or last meaningful capture time prominently on the remote home surface.

### FR-014 AI Streaming And Persistence

- The system shall stream AI responses on the web rather than waiting for full completion before rendering output.
- The system shall persist web AI threads and messages in Daylens-owned storage on every successful turn.
- The system shall support reconnect-safe streaming or explicit recovery behavior after reloads or disconnects.
- The system shall persist AI usage metadata per request, including provider, model, tokens, latency, cache behavior, and failure reason.

### FR-015 Observability And Error Tracking

- The system shall emit structured error and performance telemetry from desktop and web with release correlation.
- The system shall capture sync, auth, deployment, and AI failures with enough metadata to debug without leaking private work evidence.
- The system shall support AI-call tracing with prompts and responses disabled by default in third-party observability unless an explicit debug mode or privacy policy allows otherwise.

### FR-016 Controlled Rollout

- The system shall gate high-risk remote features behind feature flags.
- The system shall support phased rollout, kill-switch rollback, and cohort targeting for remote features.
- The system shall allow release operators to disable unstable remote capabilities without redeploying the entire product.

## Data Requirements

### Approved Launch Sync Payload

The approved launch sync payload is:

- `workspace_live_presence`
- `sync_runs`
- `sync_failures`
- `synced_day_summaries`
- `synced_work_blocks`
- `synced_entities`
- `synced_artifacts`

The launch payload explicitly excludes:

- raw capture rows
- full file paths
- broad browser URL/title exhaust
- unrelated renderer state or analytics breadcrumbs

### Current Remote Tables

Current Convex tables already include:

- `workspaces`
- `devices`
- `link_codes`
- `day_snapshots`
- `encrypted_keys`
- `web_chats`
- `workspace_preferences`
- `http_rate_limits`

### Required Cloud Data Model Evolution

The cloud model shall evolve to support:

- `users`
- `organizations`
- `workspace_memberships`
- `workspace_live_presence`
- `sync_runs`
- `sync_failures`
- `synced_day_summaries`
- `synced_work_blocks`
- `synced_artifacts`
- `synced_entities`
- `web_ai_threads`
- `web_ai_messages`
- `web_ai_artifacts`
- `ai_jobs`
- `notification_events`
- `recap_jobs`
- `report_jobs`

### Data Modeling Rules

- avoid single growing documents for chat or long-lived history
- prefer row-like appendable records for messages, artifacts, jobs, and sync events
- separate raw upload payloads from query-optimized materialized views
- preserve schema versioning and backward compatibility during rollout
- keep provider-side state optional and non-canonical
- attach correlation IDs across sync runs, AI jobs, logs, and user-visible errors
- do not let desktop and web become separate unrelated memories for synced AI threads

## Scalability Requirements

### SR-001 Query Scalability

- Request paths shall not scan the entire workspace history for standard Timeline live/home or historical reads.
- Recent-history and summary queries shall be indexed and paginated.

### SR-002 Chat Scalability

- Chat persistence shall use thread and message records, not one document per workspace.
- Artifact records shall be independently queryable.

### SR-003 Sync Scalability

- Sync uploads shall be incremental, chunked, or event-batched.
- Sync shall be idempotent and safe under retry.

### SR-004 AI Scalability

- AI context assembly shall use cached or materialized evidence packs where practical.
- AI answer latency shall be reduced by precomputed summaries and deterministic routing.

### SR-005 Deployment Safety

- frontend deployment shall not be considered valid unless required Convex functions and schema are deployed
- frontend and backend shall pin the same approved shared contract version before production promotion
- CI shall validate a generated Convex public-function manifest against frontend imports
- CI/CD shall include contract checks between frontend code and deployed cloud functions
- preview or staging deployments shall be used to validate remote flows before production rollout
- staging smoke tests shall cover linking, Timeline/history, AI, and Settings

### SR-006 Near-Live Update Scalability

- live state delivery shall use heartbeat or delta-style updates instead of repeatedly recomputing full day summaries
- standard live updates shall not require full workspace scans or full-day snapshot merges
- stale-heartbeat cleanup shall be automatic and bounded

## Non-Functional Requirements

### NFR-001 Performance

- Timeline live/home initial load should use precomputed summaries
- common remote reads should avoid noticeable blocking on large workspaces
- AI first-token latency should be minimized through streaming and cached context assembly
- when the laptop is online, live workspace freshness should update remotely within 15 seconds
- current-day durable changes should appear remotely within 60 seconds under healthy conditions
- deterministic answers should begin rendering within 2 seconds, and provider-backed streamed answers should begin rendering within 6 seconds at p95 under normal load

### NFR-002 Reliability

- sync failures must be observable and recoverable
- remote clients must degrade honestly when data is missing or stale
- failed background jobs must be retryable

### NFR-003 Security

- session tokens shall be signed and revocable
- stored provider keys shall be encrypted at rest
- cloud access shall be scoped by workspace, and later by user/org membership

### NFR-004 Privacy

- privacy-hidden apps and domains shall be filtered before browser delivery
- users shall be able to export and delete synced data
- the product shall remain explicit that desktop is the local source of truth

### NFR-005 Observability

- track sync success, sync latency, sync failure reason, stale workspace count, AI latency, AI failure reason, live-heartbeat freshness, and deployment mismatch failures
- desktop and web releases shall publish source maps and release identifiers to Sentry
- PostHog analytics shall focus on high-value product events, rollout cohorts, and funnel truth rather than raw evidence exhaust
- production logs must be queryable by route, status, release, workspace correlation ID, and request class without leaking private evidence
- replay or tracing tools must default to masked or redacted behavior and avoid capturing raw titles, paths, URLs, prompts, or responses unless explicitly enabled for debugging

### NFR-006 Cost Control

- use deterministic answers whenever possible
- use cached context and materialized summaries to reduce repeated AI token costs
- keep heavy recap/report generation on background jobs where appropriate

## Deployment And Operations Requirements

- frontend and cloud function deployments must be version-coordinated
- required migrations must complete before traffic is shifted
- production readiness must include environment validation for auth keys, encryption secrets, and provider configuration
- release checks must include remote smoke tests for link, Timeline live/history, Settings, and AI
- Sentry release health and source-map upload must be part of the production deployment path
- phased rollout and rollback controls must exist for high-risk remote features

## Rollout Plan

### R0: Freeze The Contract

- freeze the nav mapping back to `Timeline`, `Apps`, `AI`, and `Settings`
- freeze the launch synced-evidence MVP and privacy boundary
- freeze the cross-surface AI continuity model
- assign shared-contract and deploy-parity ownership across repos

### R1: Truth Layer

- enforce frontend/Convex deployment parity with CI and staging gates
- replace 5-minute-only remote expectations with heartbeat plus incremental current-day sync
- define explicit sync states and stale-state behavior
- complete base-path correctness and truth-related settings reliability

### R2: Remote Timeline

- build the top-level Timeline surface over synced work blocks and evidence
- keep live/home and history as Timeline subviews, not separate product categories
- add search and stronger work-block drill-down

### R3: AI Parity And Persistence

- implement the shared AI contract
- adopt AI SDK transport and streaming on web
- replace blob chat persistence with row-based threads, messages, artifacts, and usage records
- keep recap and report generation inside the AI surface

### R4: Secondary On-The-Go Value

- keep Apps secondary and explanatory
- add daily, weekly, monthly, annual recap jobs and AI-entry views
- add stale-sync and recap/report notifications

### R5: SaaS Foundation

- add user and organization layers
- add access control, billing hooks, retention, and admin operations

## Known Risks

- over-syncing private evidence
- under-syncing enough evidence for parity
- maintaining separate desktop and web AI behavior
- treating AI SDK, provider stores, or Convex documents as the product memory instead of Daylens-owned persistence
- promising "live" remote behavior while the sync path still operates on coarse delayed polling
- request-time merging costs growing with user history
- deployment drift between frontend and cloud contracts
- fragmented observability if PostHog and Sentry responsibilities are not kept distinct

## Open Questions

- should report generation run synchronously or as a remote background job?
- what retention defaults should apply for synced remote history?
- when should the cloud model introduce user/org records relative to public remote launch?
- should Daylens remain user-key-first for remote AI at launch, or offer a managed SaaS fallback later?
- should remote AI default to user-provided keys only, or should a managed Daylens fallback exist for SaaS plans?
