# DAYLENS BACKEND PLAN

## 1. Purpose and Source of Truth

This document defines the backend and data plan needed to support the current Daylens product vision cleanly.

Primary sources used:

- `Daylens Product Vision V2` provided in-thread
- [DAYLENS_REDESIGN_MASTER_SPEC.md](/Users/tonny/Dev-Personal/daylens-windows/DAYLENS_REDESIGN_MASTER_SPEC.md)
- [DAYLENS_FRONTEND_UI_PLAN.md](/Users/tonny/Dev-Personal/daylens-windows/DAYLENS_FRONTEND_UI_PLAN.md)

Code audited for this plan includes:

- tracking and browser ingestion
- work block generation
- SQLite schema, migrations, and queries
- AI routing and cached observations
- IPC handlers and shared types
- current Timeline, Apps, and AI consumers
- sync/export paths that reveal the current backend truth model

This is intentionally a backend/data plan only. It does not propose frontend/UI implementation details except where IPC contracts must change.

## 2. Executive Summary

Daylens already has a strong base:

- local-first SQLite storage
- reliable foreground app session tracking
- browser history ingestion with URLs and titles
- a meaningful v1 work block heuristic pipeline in [src/main/services/workBlocks.ts](/Users/tonny/Dev-Personal/daylens-windows/src/main/services/workBlocks.ts)
- clean preload/IPC boundaries
- useful app normalization and category overrides

But the current backend truth model is still too app-session-centric for the product vision.

The biggest gaps are:

1. native window/document context is not captured at all
2. work blocks are derived on demand, not persisted as stable first-class records
3. browser/app identity is not canonicalized well enough for clean joins
4. clickable artifacts are only partially supported for browser domains, not pages/documents/projects
5. app detail data is assembled inefficiently in the renderer because backend contracts are too thin
6. there is no workflow/entity layer for repeated cross-app work
7. AI answers are grounded in useful aggregates, but not yet in a durable timeline/artifact/workflow graph

The target backend shape should be:

- raw capture layer: sessions, page visits, activity-state events, captured window titles
- derived timeline layer: persisted work blocks with stable IDs and label provenance
- artifact layer: pages, domains, documents, projects, repos, and openable targets
- workflow layer: repeated cross-app patterns inferred from blocks
- summary/cache layer: app profiles, daily reports, workflow rollups
- correction layer: category overrides now, block label overrides next, project/client tags later

## 3. Current-State Assessment

### 3.1 What is already good enough

These should be kept and extended, not replaced:

- `src/main/services/tracking.ts`
  - The polling/flush model is fine for v1 raw app session capture.
- `src/main/services/browser.ts`
  - Browser ingestion already preserves domain, URL, title, visit time, and duration estimates.
- `src/main/services/workBlocks.ts`
  - The grouping logic is directionally right for v1 segmentation.
  - It already avoids the simplistic “every switch is bad” trap better than many tracker apps.
- `shared/app-normalization.v1.json`
  - Good foundation for canonical app naming and default roles.
- `src/main/ipc/*` + `src/preload/index.ts`
  - The renderer already consumes everything through typed IPC, which is the right trust boundary.
- `src/main/services/ai.ts` and `src/main/lib/insightsQueryRouter.ts`
  - Good start for query routing, deterministic fallbacks, and provider-optional AI.

### 3.2 What is blocking the product vision today

#### A. No native window/document capture

`tracking.ts` receives `win.title` from `@paymoapp/active-window` but does not persist it. `app_sessions` stores only app identity and time. That means Daylens currently cannot answer these well for non-browser work:

- which PowerPoint deck mattered
- which Excel file was open
- which VS Code project/repo/folder was active
- which document or note was being edited

This is the biggest missing backend input for work-first labeling and useful app detail.

#### B. Work blocks are not first-class persisted entities

`getHistoryDayPayload()` rebuilds blocks from `app_sessions` each time. Effects:

- no stable block ID across recomputation
- no durable label provenance/versioning
- no easy block correction workflow later
- expensive repeated computation as history grows
- renderer and AI can see subtly different truths over time

#### C. Current block payload throws away clickability

`WorkContextBlock.keyPages` is only `string[]`. That strips URL/path/provenance and makes future “open source item” actions weak. This also prevents later AI reasoning over the actual artifact identity.

#### D. Browser identity is not canonicalized cleanly

Foreground app tracking uses bundle IDs like `msedge.exe`. Browser history uses per-profile IDs like `msedge.exe:Profile 1`. This makes clean joins harder and is one reason the current browser app detail falls back to broad/global site summaries.

#### E. App detail is being reconstructed in the renderer

[src/renderer/views/Apps.tsx](/Users/tonny/Dev-Personal/daylens-windows/src/renderer/views/Apps.tsx) currently:

- fetches sessions, live state, website summaries, and multiple history days separately
- scans day payloads client-side to infer “appears in work blocks”
- cannot ask the backend for app-scoped artifacts, paired tools, or workflow roles directly

This is a contract problem, not just a UI problem.

#### F. AI context is rich but still too shallow for project/client/workflow questions

The AI layer can answer many “today/this week” questions, but it still reasons mostly over:

- app summaries
- website summaries
- raw sessions
- a day context string

There is no durable entity layer for:

- client X
- project Y
- repeated workflow Z
- important document/page/repo references

#### G. Gap/away/off states are not modeled as timeline entities

The product vision wants deliberate handling of:

- short gaps
- idle/away periods
- machine off periods

The current backend only returns blocks plus raw sessions. It does not expose a first-class day timeline with segment types.

### 3.3 Current codebase inconsistencies worth noting

- `docs/CURRENT_STATE.md` lists tables like `user_profiles`, `user_memories`, and `generated_reports`, but those are not present in the current SQLite schema. The codebase should be treated as the actual source of truth here.
- `daily_summaries` exists, but it is still app/category/focus-score oriented rather than timeline/artifact/workflow oriented.
- `snapshotExporter.ts` exports app-centric snapshots, not the future Daylens product truth model.

## 4. Backend Design Principles

### 4.1 Raw and derived data must stay separate

Do not collapse inferred work blocks back into raw tracking tables.

Keep:

- raw capture immutable or append-only
- derived summaries recomputable and versioned
- user corrections stored separately from generated labels

### 4.2 Daylens should store evidence, not just conclusions

Every useful label or summary should remain traceable to evidence:

- apps
- page visits
- captured window titles
- focus overlap
- timing
- workflow co-occurrence

### 4.3 Purposeful switching must remain possible

The backend should not encode “switch count = distraction.”

Instead it should preserve:

- switch rate
- switch pattern
- dwell time
- supporting evidence that a multi-app loop was coherent

That keeps later AI and deterministic logic from making simplistic judgments.

### 4.4 The true product unit is the timeline block

`app_sessions` are raw ingredients.
`timeline_blocks` should become the main product record.

That is the right level for:

- timeline rendering
- app detail rollups
- workflow inference
- AI summaries
- future user corrections

## 5. Target Data Model Direction

## 5.1 Layer 1: Raw Capture

Keep `app_sessions`, but extend it instead of replacing it immediately.

Recommended additions to `app_sessions`:

- `window_title TEXT NULL`
- `raw_app_name TEXT NULL`
- `canonical_app_id TEXT NULL`
- `app_instance_id TEXT NULL`
- `capture_source TEXT NOT NULL DEFAULT 'foreground_poll'`
- `ended_reason TEXT NULL`
- `capture_version INTEGER NOT NULL DEFAULT 1`

Why:

- `window_title` is required for documents/projects/native artifacts
- `canonical_app_id` separates “Chrome” from “Chrome Profile 2”
- `app_instance_id` keeps the raw source instance available
- `ended_reason` helps distinguish app switch vs away vs lock/suspend

Add a new raw table:

- `activity_state_events`

Suggested fields:

- `id`
- `event_ts`
- `event_type` (`idle_start`, `idle_end`, `away_start`, `away_end`, `lock_screen`, `unlock_screen`, `suspend`, `resume`)
- `source`
- `metadata_json`

Why:

- needed to render explicit away/off segments later
- avoids pretending all empty time is the same

Keep `website_visits`, but extend it:

- `canonical_browser_id TEXT NULL`
- `browser_profile_id TEXT NULL`
- `normalized_url TEXT NULL`
- `page_key TEXT NULL`

Why:

- the same browser should join cleanly across profile-specific raw IDs
- future artifact grouping needs canonical page identity

## 5.2 Layer 2: Derived Timeline

Add persisted derived block tables.

### Recommended tables

`timeline_blocks`

- `id TEXT PRIMARY KEY`
- `date TEXT`
- `start_time INTEGER`
- `end_time INTEGER`
- `block_kind TEXT`
  - `work`, `meeting`, `communication`, `mixed`
- `dominant_category TEXT`
- `category_distribution_json TEXT`
- `switch_count INTEGER`
- `label_current TEXT`
- `label_source TEXT`
  - `rule`, `artifact`, `workflow`, `ai`, `user`
- `label_confidence REAL`
- `narrative_current TEXT`
- `evidence_summary_json TEXT`
- `is_live INTEGER`
- `heuristic_version TEXT`
- `computed_at INTEGER`
- `invalidated_at INTEGER NULL`

`timeline_block_members`

- `block_id TEXT`
- `member_type TEXT`
  - `app_session`, `website_visit`, `focus_session`
- `member_id TEXT`
- `start_time INTEGER`
- `end_time INTEGER`
- `weight_seconds INTEGER`

`timeline_block_labels`

- `id`
- `block_id`
- `label`
- `narrative`
- `source`
- `confidence`
- `created_at`
- `model_info_json NULL`

Why this shape:

- stable block row for primary product records
- membership mapping for evidence traceability
- label history/provenance instead of a single mutable string

Do not store idle gaps as raw rows yet. Derive them from:

- `timeline_blocks`
- `activity_state_events`
- day bounds

Then return them through the day timeline payload as segment objects.

## 5.3 Layer 3: Artifact Model

Needed now:

- browser pages must be returned as structured refs with URLs
- native window/document titles must be captured

Needed shortly after:

- generic artifact identity for pages/documents/projects/repos

Recommended table set:

`artifacts`

- `id TEXT PRIMARY KEY`
- `artifact_type TEXT`
  - `domain`, `page`, `document`, `project`, `repo`, `window`
- `canonical_key TEXT UNIQUE`
- `display_title TEXT`
- `url TEXT NULL`
- `path TEXT NULL`
- `host TEXT NULL`
- `canonical_app_id TEXT NULL`
- `metadata_json TEXT`
- `first_seen_at INTEGER`
- `last_seen_at INTEGER`

`artifact_mentions`

- `id`
- `artifact_id`
- `source_type`
  - `app_session`, `website_visit`, `timeline_block`
- `source_id`
- `start_time`
- `end_time`
- `confidence`
- `evidence_json`

Why not overengineered:

- it is still a small generic artifact layer
- it solves clickability and later AI grounding
- it avoids building a full graph system prematurely

## 5.4 Layer 4: App and Workflow Cache

Add:

`app_profile_cache`

- `canonical_app_id`
- `range_key`
  - `day:YYYY-MM-DD`, `7d:YYYY-MM-DD`, etc.
- `character_json`
- `top_artifacts_json`
- `paired_apps_json`
- `top_block_ids_json`
- `computed_at`

`workflow_signatures`

- `id TEXT PRIMARY KEY`
- `signature_key TEXT UNIQUE`
- `label TEXT`
- `dominant_category TEXT`
- `canonical_apps_json`
- `artifact_keys_json`
- `rule_version TEXT`
- `computed_at`

`workflow_occurrences`

- `workflow_id`
- `block_id`
- `date`
- `confidence`

Near-term workflow inference should stay deterministic:

- recurring app combinations
- recurring artifact/domain clusters
- recurring label stems

Not a heavy ML system.

## 5.5 Layer 5: User Corrections and Future Entity Tags

Needed now:

- keep `category_overrides`
- add `block_label_overrides`

Suggested `block_label_overrides` fields:

- `block_id`
- `label`
- `narrative NULL`
- `updated_at`

Later, not now:

- `block_tags`
- `project_entities`
- `client_entities`
- `entity_mentions`

These become necessary once Daylens must reliably answer “client X this week” instead of only inferring from free text.

## 6. What Is Needed for Each Product Requirement

### 6.1 What backend/data limitations are blocking the product vision today

Most important blockers:

1. no stored window titles, so non-browser work lacks artifact identity
2. blocks are ephemeral derived output, not stable records
3. no structured page/document refs in block payloads
4. no backend app-detail payloads; renderer is compensating
5. no workflow layer
6. no gap/away/off segment model
7. AI has no stable block/artifact/workflow corpus to reason over

### 6.2 What data model is needed for a true calendar-first timeline

The day payload should move from:

- `HistoryDayPayload { sessions, websites, blocks, totals... }`

to something closer to:

- `DayTimelinePayload { date, summary, segments, focusSessions, computedAt, version }`

Where `segments` is a union:

- `work_block`
- `idle_gap`
- `away`
- `machine_off`

Each `work_block` should include:

- stable `id`
- exact `startTime` and `endTime`
- `blockKind`
- label object with source and confidence
- top apps
- top artifacts
- top domains and page refs
- document/window refs
- workflow refs when available
- focus overlap summary
- provenance/version info

This is the minimum backend shape needed to support a true calendar-style truth record.

### 6.3 What is needed to support better work-block labeling

Needed now:

- capture `window_title`
- persist blocks
- persist label provenance
- add block label overrides
- keep rule-first labeling before AI
- make artifact-aware labeling deterministic where possible

Recommended label precedence:

1. user override
2. artifact-derived label
3. workflow-derived label
4. rule-based label
5. AI refinement
6. app/category fallback

Important implementation point:

Do not make `aiLabel` the only elevated label source. AI should refine a block that already has strong evidence, not substitute for missing raw capture.

### 6.4 What is needed to support better app detail pages

Add a backend-owned `AppDetailPayload` instead of making the renderer stitch it together.

It should include:

- canonical app identity
- role/character summary
- top artifacts
- top pages for browser apps
- paired apps
- time-of-day distribution
- session distribution
- block appearances
- workflow appearances

Current limitation to fix:

- browser detail is not properly filtered by canonical browser identity
- block appearances are assembled by scanning multiple day payloads in the renderer

### 6.5 What is needed for clickable sites/pages/documents/artifacts

Needed now:

- replace `keyPages: string[]` with structured page/document refs
- expose page URL, title, domain, time, browser identity
- start storing raw window titles in `app_sessions`

Needed next:

- derive document/project/repo artifact candidates from window titles
- return `openTarget` metadata
  - `external_url`
  - `local_path`
  - `unsupported`

Without this, “open source item” in the product vision remains shallow.

### 6.6 What is needed to infer workflows across apps

Start with deterministic recurring-pattern inference, not heavy AI.

Workflow signals should include:

- repeated canonical app combinations
- repeated app + artifact combinations
- repeated block label stems
- repeated time adjacency between blocks

Examples the backend should eventually detect:

- `Ghostty + VS Code + GitHub` development/test loop
- `Safari + ChatGPT + docs` research/prompt/implementation loop
- `PowerPoint + browser + Finder` deck-prep loop

Store the inferred workflow as:

- reusable signature
- repeated occurrences by block/date

This creates the substrate for both Apps and AI.

### 6.7 What is needed for future AI summaries and questions

AI should reason over durable objects, not only transient aggregates.

Needed AI inputs:

- persisted timeline blocks
- block memberships
- artifact refs
- workflow occurrences
- app profile cache
- label overrides and later entity tags

Needed cached outputs:

- day summary
- week summary
- app role summary
- workflow summary

Needed query support:

- block range lookup
- app/block/artifact/workflow joins by date range
- “top artifacts by time”
- “repeated workflows”
- “tools used together”

Without that, questions like “what documents/pages mattered most?” remain approximate.

### 6.8 What categorization/caching strategy should exist

#### Categorization

Keep the existing layered approach, but formalize it:

1. canonical app normalization file
2. deterministic classifier rules
3. user category overrides
4. optional AI suggestion only for unresolved cases

Add one more distinction:

- `canonical_app_id`
- `app_instance_id`

This is critical for browsers and profile-based tools.

#### Caching

Add explicit caches for:

- persisted block computation by day
- app character/profile by range
- workflow signature/occurrence rolls
- day/week AI-ready summaries

Invalidate caches when:

- raw sessions change
- website visits change
- focus sessions change
- category overrides change
- heuristic version changes
- block label overrides change

### 6.9 What IPC/shared-type changes are likely needed

In [src/shared/types.ts](/Users/tonny/Dev-Personal/daylens-windows/src/shared/types.ts), add or replace with:

- `TimelineSegment`
- `TimelineBlock`
- `TimelineGapSegment`
- `BlockLabel`
- `ArtifactRef`
- `PageRef`
- `DocumentRef`
- `WorkflowRef`
- `DayTimelinePayload`
- `AppDetailPayload`
- `AppProfile`
- `WorkflowPattern`
- `RangeSummaryPayload`

Likely IPC additions:

- `db:get-timeline-day`
- `db:get-app-detail`
- `db:get-block-detail`
- `db:get-workflow-summaries`
- `db:get-artifact-details`
- `db:set-block-label-override`

Likely AI additions later:

- `ai:get-day-summary`
- `ai:get-range-summary`

Compatibility note:

- keep `db:get-history-day` temporarily as a compatibility layer
- migrate consumers to richer payloads once backend contracts exist

### 6.10 What order the backend work should happen in

See Section 9. The short version:

1. fix raw capture gaps first
2. make blocks persistent and stable
3. add artifact refs and app-detail payloads
4. add workflow inference
5. then deepen AI summaries and entity reasoning

## 7. Likely File and Module Touch Points

### Core backend

- [src/main/services/tracking.ts](/Users/tonny/Dev-Personal/daylens-windows/src/main/services/tracking.ts)
  - persist `window_title`
  - emit activity-state events
  - canonical app identity separation
- [src/main/services/browser.ts](/Users/tonny/Dev-Personal/daylens-windows/src/main/services/browser.ts)
  - canonical browser identity
  - profile identity fields
  - richer page normalization
- [src/main/services/workBlocks.ts](/Users/tonny/Dev-Personal/daylens-windows/src/main/services/workBlocks.ts)
  - block persistence
  - stable IDs
  - label provenance
  - artifact-aware block payloads
  - workflow occurrence generation
- [src/main/db/schema.ts](/Users/tonny/Dev-Personal/daylens-windows/src/main/db/schema.ts)
  - new tables/columns
- [src/main/db/migrations.ts](/Users/tonny/Dev-Personal/daylens-windows/src/main/db/migrations.ts)
  - migration path
- [src/main/db/queries.ts](/Users/tonny/Dev-Personal/daylens-windows/src/main/db/queries.ts)
  - richer timeline, artifact, app-detail, workflow queries

### AI and summaries

- [src/main/services/ai.ts](/Users/tonny/Dev-Personal/daylens-windows/src/main/services/ai.ts)
  - consume block/artifact/workflow entities instead of assembling mostly from raw app/site aggregates
- [src/main/lib/insightsQueryRouter.ts](/Users/tonny/Dev-Personal/daylens-windows/src/main/lib/insightsQueryRouter.ts)
  - query durable block/artifact/workflow structures
- [src/main/db/dailySummaries.ts](/Users/tonny/Dev-Personal/daylens-windows/src/main/db/dailySummaries.ts)
  - expand from app-centric aggregates to block/workflow/artifact rollups

### IPC and shared contracts

- [src/main/ipc/db.handlers.ts](/Users/tonny/Dev-Personal/daylens-windows/src/main/ipc/db.handlers.ts)
  - new timeline/app-detail/workflow handlers
- [src/main/ipc/ai.handlers.ts](/Users/tonny/Dev-Personal/daylens-windows/src/main/ipc/ai.handlers.ts)
  - summary endpoints later
- [src/shared/types.ts](/Users/tonny/Dev-Personal/daylens-windows/src/shared/types.ts)
  - richer contracts

### Secondary but important

- [src/main/services/snapshotExporter.ts](/Users/tonny/Dev-Personal/daylens-windows/src/main/services/snapshotExporter.ts)
  - evolve sync/export truth model from app totals toward blocks/artifacts/workflows
- [shared/app-normalization.v1.json](/Users/tonny/Dev-Personal/daylens-windows/shared/app-normalization.v1.json)
  - maintain canonical IDs and role defaults

## 8. Needed Now vs Later

### Needed now

- persist `window_title` in raw app session capture
- add canonical app identity vs raw instance identity
- persist timeline blocks with stable IDs
- store label provenance and add block label overrides
- return structured page/document refs instead of `string[]`
- add backend-owned app detail payloads
- add block/app/artifact caches with clear invalidation
- expose focus overlap and day timeline segment data

### Needed soon after

- artifact tables and mentions
- app profile cache
- deterministic workflow signatures and occurrences
- cached day/week summaries grounded in blocks and artifacts

### Later / nice-to-have

- project/client entity system
- entity mention extraction and correction tools
- repo/path-specific extraction for IDEs beyond title parsing
- external calendar event ingestion and overlay contracts
- heavier AI labeling/reflection beyond evidence-led summaries

## 9. Recommended Backend Implementation Order

## Phase 1: Raw Capture and Identity Foundation

Goal:

- make the raw data good enough for work-first labeling and artifact linking

Tasks:

1. extend `app_sessions` with `window_title`, identity, and source metadata
2. add `activity_state_events`
3. canonicalize browser identity in `website_visits`
4. update normalization helpers to emit `canonical_app_id`

Why first:

- every later layer depends on this evidence existing

## Phase 2: Persisted Timeline Blocks

Goal:

- turn blocks into stable first-class records

Tasks:

1. add `timeline_blocks`, `timeline_block_members`, and `timeline_block_labels`
2. make `workBlocks.ts` write/read persisted blocks
3. version block computation and add invalidation rules
4. return day timeline segments, not only blocks
5. include focus-session overlap in the timeline payload

Why second:

- the Timeline is the product center of gravity
- Apps and AI both need a stable block layer

## Phase 3: Artifact and App Detail Backend

Goal:

- support useful app detail and clickable evidence

Tasks:

1. add structured `PageRef`/`DocumentRef` contracts
2. introduce `artifacts` and `artifact_mentions`
3. derive artifact candidates from window titles and visits
4. add `db:get-app-detail` backend payload
5. add block detail payloads with openable targets

Why third:

- this unlocks useful app detail and artifact-driven labeling without waiting for workflow inference

## Phase 4: App Profile and Workflow Cache

Goal:

- explain how tools fit together over time

Tasks:

1. add `app_profile_cache`
2. add deterministic paired-app summaries
3. add `workflow_signatures` and `workflow_occurrences`
4. surface repeated workflows by day/week/range

Why fourth:

- this is where Daylens starts answering “what tools were used together” and “what repeated”

## Phase 5: AI-Ready Summary Layer

Goal:

- make AI reason over durable product truth

Tasks:

1. cache day/week summaries grounded in blocks, artifacts, workflows
2. update `insightsQueryRouter.ts` to query timeline blocks, artifacts, workflows
3. add AI summary/report endpoints only after deterministic payloads exist
4. separate tracked facts from inferred summary text in storage

Why fifth:

- AI quality improves dramatically once the backend has stable derived entities

## Phase 6: User Corrections and Future Entity Reasoning

Goal:

- support client/project questions with confidence

Tasks:

1. ship block label overrides
2. add optional block tags/project tags
3. later introduce entity mentions for clients/projects/topics

Why last:

- it should build on stable blocks and artifacts, not precede them

## 10. Concrete Recommendations by Existing Module

### `tracking.ts`

Keep:

- polling cadence
- away detection basics

Change:

- store `win.title`
- distinguish raw app identity from canonical app identity
- persist end reason and state events

### `workBlocks.ts`

Keep:

- current heuristic grouping direction

Change:

- stop treating block generation as purely request-time work
- persist stable block rows and label history
- return structured artifact refs instead of `keyPages: string[]`

### `queries.ts`

Keep:

- general read-helper pattern

Change:

- move app detail assembly and block appearance lookup into backend queries
- stop relying on client-side scanning for block membership use cases

### `ai.ts` and `insightsQueryRouter.ts`

Keep:

- provider abstraction
- deterministic fallback answers

Change:

- feed AI from block/artifact/workflow summaries first
- use raw sessions only as fallback evidence

### `dailySummaries.ts`

Keep:

- daily recomputation job

Change:

- store summary facts that matter to the product vision:
  - top blocks
  - top artifacts
  - repeated workflows
  - tracked/away composition

## 11. Final Recommendation

Do not start by rebuilding the heuristic logic in `workBlocks.ts`.

The right backend sequence is:

1. capture missing evidence
2. persist blocks
3. return richer artifact-aware contracts
4. add workflow and app-profile caches
5. upgrade AI to reason over those durable structures

If Daylens wants to become a trustworthy calendar-first record of real work, the backend must promote these concepts to first-class records:

- timeline blocks
- artifacts
- workflows
- label provenance
- user corrections

Until those exist, the app will keep having strong raw ingredients but an underpowered product truth model.
