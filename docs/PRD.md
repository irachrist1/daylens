# Daylens Remote Companion PRD

Status: Draft for review on 2026-04-20

This is the product definition for the Daylens remote companion across web and linked browser surfaces. It is a living doc and should stay aligned with `README.md`, `docs/AGENTS.md`, `docs/SRS.md`, `docs/REMOTE_PARITY_MATRIX.md`, `docs/REMOTE_CONTRACT.md`, `docs/REMOTE_EXECUTION_PLAN.md`, `docs/ISSUES.md`, and the shipped desktop product.

## Why This Exists

Daylens already works as a local-first desktop product. The next product step is not "put the desktop in a browser." It is:

- preserve Daylens as the source of truth for tracking and local evidence
- make that truth accessible remotely, on the go, and across devices
- give the user the same confidence they would have if they were sitting at their laptop
- make AI on the web feel like Daylens, not like a weaker sidecar

## Product Problem

Today, a linked browser can authenticate into Daylens Web, but the remote experience is still incomplete:

- the web app can look connected before synced history is actually available
- remote history is driven by synced day snapshots rather than a fuller searchable work-history model
- web AI is a simplified one-day Q&A flow instead of feature parity with desktop AI
- settings, chat persistence, and deployment parity are not yet reliable enough to act like a durable companion

The result is that the user can log in remotely, but cannot yet depend on the remote surface as "Daylens away from my laptop."

## Vision

Daylens Remote should let a user answer these questions from any browser:

- What am I working on right now, and how has today gone?
- What did I do earlier today, yesterday, this week, or last month?
- What changed in this workstream, repo, or client context?
- How much time did I spend on it, and what exactly was I doing?
- What deserves my attention now?
- Can I get the same grounded AI help, recaps, reports, and artifacts I get locally?

The remote companion should feel like:

- Daylens in your pocket
- a truthful work-history proof surface
- a grounded AI copilot over synced evidence

It should not feel like:

- a vanity dashboard
- a disconnected marketing demo
- a weaker chat window beside the real product

## Product Principles

- Desktop remains the capture engine and local source of truth.
- The remote surface must be truthful about sync freshness, coverage, and missing data.
- Near-live awareness matters more than decorative freshness claims. If the laptop is online, the user should see what is happening now within seconds; if not, the product must say the signal is delayed.
- Remote usefulness matters more than UI parity. The user should get answer parity, not necessarily pixel parity.
- AI parity means the same quality bar, the same grounded behavior, and the same core workflows, even if provider plumbing differs.
- The remote surface must be usable on laptop and mobile browsers.
- If remote sync, AI, or persistence is stale or broken, the UI must say so clearly.

## Primary Users

Primary:

- solo professionals, founders, contractors, developers, and students who already run Daylens on their laptop and need remote access to their work history

Secondary:

- power users who want remote recap, reports, and AI answers from phone or another machine
- future team and workspace admins once SaaS account layers exist

Not the primary user:

- someone who only wants a cloud dashboard without running the desktop app

## Core User Jobs

### Job 0: Live Awareness

"I am away from my laptop. Tell me what is happening right now."

Success looks like:

- latest active block or current inferred block within seconds when the laptop is online
- honest state such as active, idle, meeting, sleeping, offline, or stale
- last heartbeat / last capture time clearly visible
- a direct jump from live state into Today, History, or Ask AI

### Job 1: Remote Proof

"I am away from my laptop. Show me what I worked on and when."

Success looks like:

- current or latest work block
- today so far
- recent days
- supporting apps, sites, files, artifacts, and workstream evidence
- sync freshness clearly visible

### Job 2: Remote AI Recall

"Answer a work-history question as well as the desktop AI would."

Success looks like:

- grounded answers over synced evidence
- follow-up context preserved
- reports, exports, and artifacts available remotely
- deterministic answers when deterministic evidence is enough

### Job 3: Remote Recap

"Catch me up on my day, week, month, and eventually year."

Success looks like:

- daily, weekly, monthly, and annual recap
- meaningful workstream summaries
- standout artifacts
- changes vs prior period
- notifications when a recap or report is ready

### Job 4: Remote Operations

"Tell me if tracking, sync, and AI are actually healthy."

Success looks like:

- linked devices
- last successful sync
- stale or failed sync warnings
- API key status
- privacy controls

## Why The Web Interface Matters

The web companion exists to extend Daylens into moments where the desktop app is not in front of the user:

- on a phone before a meeting
- on another computer
- in a browser while traveling
- when sharing a grounded recap or report
- when an AI tool needs synced context outside the local machine

The web interface is not optional polish. It is the remote access layer for the product's core promise.

## Product Definition Of Remote Parity

Remote parity does not mean the browser must mirror every local implementation detail. It means the user can still answer the same high-value questions with confidence.

Remote parity requires:

- trustworthy sync status
- searchable recent and historical work evidence
- work-block-centered history, not app-centric filler
- AI thread persistence and follow-up continuity
- reports and artifacts accessible remotely
- recap and Wrapped-style summaries
- notifications for time-sensitive remote value

Remote parity does not require:

- raw local event logs to leave the machine unchanged
- browser support for local CLI providers
- desktop-native shell features like tray-only behavior

## Scope

### In Scope

- linked web and mobile-browser access
- top-level web navigation that still maps to `Timeline`, `Apps`, `AI`, and `Settings`
- sync-health truthfulness
- remote AI parity with desktop user-facing workflows
- online API-key management for supported cloud providers
- notifications for recap, stale sync, and report readiness
- annual recap / Wrapped-style storytelling
- multi-device sync within a single workspace
- later SaaS account and org model above workspace identity

### Out Of Scope

- replacing the desktop tracker with browser-only capture
- decorative SaaS metrics
- public social feeds or leaderboards
- admin-heavy settings sprawl

## Navigation Mapping

The remote companion does not get a new top-level product model.

Top-level navigation on web must stay:

- `Timeline`
- `Apps`
- `AI`
- `Settings`

Mapping rules:

- `Timeline` contains the live/home view plus historical browsing. Legacy route names such as `/dashboard` or `/history` may exist during migration, but they are Timeline subviews, not separate product surfaces.
- `Apps` remains secondary and explanatory.
- `AI` contains chat, recap, review, reports/exports, and artifacts. Dedicated deep links such as `/recap` or `/reports/...` are allowed only as AI entry points, not as separate top-level product categories.
- `Settings` contains linking, sync health, provider setup, privacy, export/delete, and disconnect.

The web companion must not reintroduce top-level `Dashboard`, `History`, `Recap`, or `Reports` navigation.

## Current State Upon Review

Strong foundations already exist:

- desktop tracking, persistence, timeline, apps, and AI are the canonical product
- desktop already supports threads, artifacts, recaps, notifications, and richer AI orchestration
- web already has linking, recovery, session auth, legacy live/home and history shells, Convex sync storage, and a basic AI route

Current gaps:

- web currently depends on synced day snapshots rather than a fuller remote evidence model
- web AI is materially weaker than desktop AI
- web chat persistence is incomplete
- settings are incomplete and production reliability is currently affected by frontend and Convex deployment drift
- remote sync health is not modeled clearly enough for users

## Current Parity Snapshot

This parity read is based on:

- desktop routes in `src/renderer/App.tsx`
- web routes in `daylens-web/app`
- the product contracts in `docs/AGENTS.md`
- the current desktop and web AI/data stacks

### Timeline / Proof Surface

- Desktop: first-class proof surface with reconstructed work blocks, prior days, drill-down, and evidence
- Web: partial parity through legacy Timeline-related live/history shells and recap entry points, but still driven mostly by synced day snapshots and missing stronger remote search and proof-state modeling

### Apps Surface

- Desktop: first-class top-level Apps surface
- Web: no true remote Apps surface yet, only app/site fragments embedded inside other screens

### AI Surface

- Desktop: multi-provider orchestration, deterministic routing, streaming, reports, artifacts, focus-session actions, durable threads
- Web: simplified single-day Q&A over synced snapshots, incomplete chat persistence, and no parity for reports, artifacts, or focus-session workflows

### Settings

- Desktop: broader functional Settings including tracking, providers, notifications, privacy, updates, and workspace linking
- Web: narrower Settings surface and currently affected by production reliability gaps when frontend and cloud deployments drift

### Notifications

- Desktop: recap and distraction-related notification flows exist
- Web: remote notification product shape is planned but not yet implemented

### Wrapped / Annual Recap

- Desktop: daily / weekly / monthly recap direction is live or implemented pending verification
- Web: recap can be reached in partial form through the AI-related web flows, but annual Wrapped-style remote storytelling is still future scope

## Launch Synced Evidence MVP

The launch sync boundary is now frozen for planning purposes.

Must sync:

- workspace live presence
- sync runs and sync failures
- synced day summaries
- synced work blocks
- synced entities
- synced artifacts

Must not sync by default:

- raw local capture tables
- full file paths
- broad browser URL or title exhaust
- provider-side conversation state as the canonical memory model

If a title, page, or artifact label is synced, it must be because it survived the privacy filters and is already part of the user-visible proof surface, not because raw exhaust was copied wholesale.

## AI Continuity Decision

Cross-surface continuity is a launch requirement.

Rules:

- desktop and web must converge on one logical workspace thread model for synced Daylens AI threads
- thread, message, artifact, and usage records needed for remote continuation must be stored in row-based cloud records
- desktop-local provider state is never canonical
- the legacy `web_chats` blob model is transitional only and is not part of the approved launch design

The product must not claim AI follow-up continuity across desktop and web until this shared thread model exists.

## Required Product Surfaces

### Timeline

Must answer:

- are we connected?
- are we synced?
- what is the latest known work context?
- what happened today?

Must include:

- sync state
- last sync time
- live heartbeat freshness and current-state truth
- latest work block or current inferred block
- today's tracked time and focus score
- top workstreams
- recent artifacts
- deep links into Ask AI when the user needs explanation or recap

#### History Subview

Must answer:

- what happened on this date?
- what other recent days exist?
- what changed over time?

Must include:

- recent days by default
- month and year grouping as history grows
- search or filter by workstream, client, project, repo, app, or artifact

### Apps

Must remain secondary and explanatory.

It should explain:

- what work happened in this tool
- what files, pages, docs, or repos were touched
- which workstreams commonly co-occurred here

### AI

Must reach user-facing parity with desktop Daylens AI.

It must support:

- freeform grounded chat
- starter prompts
- follow-up continuity
- report and export generation
- artifact persistence
- recap and review flows
- grounded deterministic answers where possible

#### Recap And Wrapped

Must include:

- daily recap
- weekly recap
- monthly recap
- annual recap / Wrapped-style summary
- same-period comparisons
- top workstreams
- standout artifacts

### Notifications

Remote value notifications should cover:

- stale sync
- daily recap ready
- report ready
- notable distraction or focus pattern summaries when relevant

### Settings

Must stay sparse and real:

- linked devices
- tracking and sync health
- AI provider / API key
- notifications
- privacy
- export / delete / disconnect

## Success Metrics

- linked users who receive first synced day within minutes of linking
- percentage of remote sessions with usable synced data
- AI answer success rate and follow-up continuation rate on web
- recap open rate and report generation rate
- time to answer "what did I do?" remotely
- support volume for sync confusion, missing data, and AI mismatch

## Phased Roadmap

### Phase 0: Contract Freeze

- freeze web nav mapping back to `Timeline`, `Apps`, `AI`, `Settings`
- freeze the synced-evidence MVP and privacy boundary
- freeze the cross-surface AI continuity model
- assign deploy-parity ownership and release-gate responsibility across repos

### Phase 1: Truth Layer

- enforce deployment parity between frontend and Convex
- add explicit sync states, heartbeat/live presence, and incremental current-day sync
- complete route/base-path correctness
- fix settings reliability only where it affects truthful sync/provider state

### Phase 2: Remote Timeline

- build the top-level Timeline surface over synced work blocks and evidence
- keep live/home and history as Timeline subviews, not separate product models
- add search and better day navigation
- expose last-sync and stale-sync warnings everywhere they matter

### Phase 3: AI Parity

- move web AI onto the same user-facing orchestration model as desktop
- replace blob chat persistence with row-based threads, messages, artifacts, and follow-up state
- keep reports, recap prompts, and remote artifact access inside AI

### Phase 4: Secondary On-The-Go Value

- keep Apps secondary and explanatory
- daily / weekly / monthly / annual recap remotely inside AI
- report-ready and recap-ready notifications
- richer on-the-go catch-up experiences

### Phase 5: SaaS Foundation

- accounts, users, and organizations
- billing and retention controls
- workspace sharing and permissions
- stronger cloud observability and operational tooling

## Risks

- drifting into a cloud-first product that weakens the local-first contract
- syncing too little evidence and producing a weak remote experience
- syncing too much raw evidence and creating privacy or cost problems
- drifting into extra top-level web surfaces that violate the core navigation contract
- rebuilding a second AI stack instead of sharing one product contract
- shipping a "connected" state that still does not mean "useful"

## Open Questions

- which AI providers should be supported on web at launch?
- what is the first annual recap shape worth shipping?
- how much mobile-specific optimization is required for the first meaningful remote release?
- which notifications should be in-product only vs email or push later?
- should Daylens ever offer a managed cloud AI fallback, or remain user-key-first for remote AI at launch?
