# Performance & Coherence Map

Status: P0 (throttle) + P1 (relabel unification) + Phase 1 contentless-sliver absorption implemented and tested 2026-05-30. Remaining items open. Branch perf-pass-review.

## Implementation log (2026-05-30)

Shipped, typecheck clean, 88 ai-chat + 20 targeted tests passing (non-billed loader):
- **P0 invalidation throttle.** `src/main/lib/coalescer.ts` (new, `createLeadingTrailingThrottle`, leading+trailing, injectable clock/scheduler). Wired in `tracking.ts` so the per-app-switch `activity_recorded` timeline+insights invalidation coalesces to a 15s window; `apps` stays immediate (keeps its targeted canonicalAppId refresh). Tests `tests/coalescer.test.ts`. This stops the full-day rebuild firing on every app switch.
- **P1 relabel unification.** New single writer `writeAIBlockLabel(db, {blockId,label,narrative,confidence,force})` in `db/queries.ts`. `applyAIInsightToTimelineBlock` (db.handlers) now delegates with force=false (preserves overrides). The per-block Regenerate handler (ai.handlers) now uses `force:true` + passes `rejectedLabel` into `generateWorkBlockInsight`, which appends a "previous label X was rejected, produce a different one" line to the prompt so Regenerate no longer returns the same label. Duplicated inline writes + crypto imports removed from both handlers. Tests `tests/blockLabelWrite.test.ts`.
- **Phase 1 contentless-sliver absorption.** `candidateIsContentlessBrowserSliver` + relaxed relatedness gate in `absorbShortCandidates`. Only browser-only browsing candidates that sit between two non-meeting neighbours and have no useful window titles or page artifacts bypass the normal relatedness check; they attach to the nearest eligible neighbour by gap. Other titleless short activity, edge browser blocks, page-backed browser fragments, meetings, real idle boundaries, and span ceilings stay protected. Stale "15-min merge window" comments in the fixture corrected. Tests `tests/timelineSegmentation.test.ts` (9 cases: existing guards + target fix + nearest/page/non-browser/edge safeguards). Before/after on the target sliver case: 3 blocks → 1.

Deferred deliberately (not safe to do autonomously):
- **P0 today-memo.** Content-signature memo of today's payload was NOT done: the payload includes the live session (changes every poll), so a date-only memo would show stale live data. Needs a signature that includes the live-session window. Revisit with live testing.
- **P2 distraction/focus rewiring.** Product-shaping; needs owner decisions (what "personalized focus" means, the distraction-as-deviation model). Left for a grilling session.
- **P3 redundant-info.** Needs the owner to name the exact screen.
- Day-button copy ("Re-analyze with AI" oversells; it only cleans weak labels by design). Product/design copy decision — left alone, flagged here.

## Why this file exists

This is the durable handoff for the slowness + "doesn't feel like one connected engine" work. It is written so a fresh context (mine or anyone's) can reopen it and have the whole picture back without re-investigating. When we implement, read this first, then jump to the file:line anchors. Findings were derived by tracing control flow in code, not by running a live profiler. The rebuild-loop finding is unambiguous in the control flow. Anything inferred rather than traced is marked "inferred."

The two felt symptoms, in the owner's words: the app is extremely slow, and features don't behave like one connected engine (rebuild day doesn't fix a bad block, outputs read as if the app doesn't understand the user). File length is NOT a runtime-speed cause. Do not "split files for speed."

---

## 1. The whole-system data flow

```
You use the computer
   │
   ▼
CAPTURE  (always-on sampling)
   focusCapture · processMonitor · browserContext · browser · tracking
   writes → focus_events, app_sessions, activity_state_events, idle_periods,
            website_visits, browser_context_events, raw_window_sessions, file_activity_events
   │
   ▼
PROJECTION  (raw → sessions → blocks)
   core/projections/chunk2.ts  projectDay / readDerivedDay   → derived_* tables (PAST days, cached)
   services/workBlocks.ts      getTimelineDayPayload          → live rebuild   (TODAY, NOT cached)  ← hot spot
   services/attribution.ts     normalizeToSegments            → activity_segments
   core/query/attributionResolvers.ts                         → work_sessions / segment_attributions / clients / projects
   │
   ▼
LEARNING BRAIN  (the only part that actually "understands the user")
   services/workMemory.ts      gatherConcurrentEvidence · matchPromotedPatterns · learnFromBlockOverride
   jobs/eveningConsolidation.ts  promotes/decays patterns at day rollover
   tables: work_context_observations, promoted patterns
   │
   ▼
AI ENGINE  (derived data → narratives)
   jobs/aiService.ts (5802 lines, the real engine) + aiOrchestration.ts + providers/*
   jobs: daySummary, weeklyBrief(getWeekReview), appNarrative, blockInsight, chatAnswer, reportGeneration
   caches AI output → ai_surface_summaries  (signature-gated, GOOD pattern)
   │
   ▼
IPC SEAM  (preload/index.ts ↔ ipc/*.handlers.ts)  ~110 methods, clean
   │
   ▼
VIEWS (renderer)
   Timeline · Apps · Insights · DayWrapped · Settings · Onboarding
   useProjectionResource hook = the one data-fetch + invalidation listener
   renderer/lib/recap.ts · activity.ts · wrappedFacts.ts (transforms — some imported by MAIN, see leak)
```

---

## 2. The nervous system: projection invalidation

Scopes: `'timeline' | 'apps' | 'insights' | 'settings' | 'all'` (`src/shared/core.ts:12`).
`invalidateProjectionScope(scope, reason, meta?)` (`core/projections/invalidation.ts:21`) → emits `PROJECTIONS.INVALIDATED` → every `useProjectionResource` with that scope refetches (250 ms debounce, `useProjectionResource.ts:46`).

Who fires it (consumers all refetch):
- `tracking.ts:1634` — **on every foreground session flush (every app/window switch ≥ MIN_SESSION_SEC)**. Fires timeline + apps + insights for today. THIS is the engine of the rebuild loop.
- `tracking.ts:1210` — restart recovery (once).
- `tracking.ts:1112` — attribution refreshed.
- `browser.ts:665`, `browserContext.ts:357` — browser activity.
- `aiService.ts:5022-5024, 4148, 4258, 5107-5109` — when an AI job finishes (so views show the new narrative).
- `db.handlers.ts` (many) — category/label override, rebuild, client archive.
- `focus.handlers.ts:27-69`, `settings.handlers.ts:43-85`, `syncUploader.ts:151-153`.

Key point: invalidation is correct in intent (views should refresh when data changes) but the cost of each refresh for TODAY is a full day rebuild (section 4). So a cheap signal triggers expensive work, continuously, while you work.

---

## 3. Caching map (what is reused vs recomputed)

GOOD — reuse via signature/derived:
- Past-day timeline: `readDerivedDay` reads precomputed `derived_*` rows. `core/query/projections.ts` `getDerivedDayTimelinePayload`.
- AI surface summaries: `getAISurfaceSummarySignature` vs current signature; if equal, return cached without re-running AI. Week review `aiService.ts:4101-4103`; app narrative `aiService.ts:4182-4184`; stale fallback returns last good while regenerating (`{stale:true}`).
- AI job scheduling dedupe: `lastTimelineAIJobFingerprint` (`aiService.ts:5124,5155`) — same day state won't reschedule identical jobs.
- In-memory: `daySummaryCache`, `weeklyBriefCache`, `_categorySuggestionCache` (`aiService.ts:222-223,4843`); icon `memoryCache` (`iconResolver.ts:66`).

BAD — recompute every time:
- **TODAY's timeline.** `getDerivedDayTimelinePayload` returns `null` for `dateStr === localDateString()` (`core/query/projections.ts`, the `if (dateStr === localDateString()) return null`). So today always falls through to `getTimelineDayPayload` (`workBlocks.ts:3224`) = full live rebuild. No memoization keyed on "did anything actually change since last build."

The fix pattern already exists in this repo (signature gate + derived read). The work is to apply it to the today path, or to make today incremental.

---

## 4. THE performance hot path (the big one)

Loop, exact anchors:
1. App switch → `tracking.ts:1634` invalidates timeline/apps/insights for today.
2. `useProjectionResource` refetches `GET_TIMELINE_DAY`.
3. Handler `db.handlers.ts:367` calls `getTimelineDayProjection(..., {materialize:false})` and ALSO `scheduleTimelineAIJobs(payload)` on every fetch.
4. For today, projection returns null → `getTimelineDayPayload` (`workBlocks.ts:3224`) runs:
   - `getSessionsForRange` (all sessions of the day)
   - `buildTimelineBlocksForDay` → `buildTimelineBlocksFromSessions` (`workBlocks.ts:2026`)
   - **per block**: `gatherConcurrentEvidence(db, block)` + `matchPromotedPatterns(db, block, …)` (`workBlocks.ts:2279-2282`) = DB work proportional to (#blocks × memory queries). This is an N+1 over blocks.
   - `buildSegmentsForDay`, focus aggregation, etc.

Cost grows through the day as #blocks grows, and reruns on every app switch. This matches "snappy in the morning, sluggish by afternoon." Indexes are fine (124 of them); this is recompute, not missing indexes.

Fix directions (pick during implementation):
- A. Materialize/cache today like past days; rebuild only the tail that changed (incremental projection), or memoize the payload and skip rebuild when the day's session set is unchanged (reuse the signature-gate idea).
- B. Coarsen invalidation so a single micro-session does not invalidate the whole day; batch/throttle at the source.
- C. Make the rebuild not block; precompute on capture write rather than on view read.
Recommended first: A (memoize today's payload behind a content signature) — smallest, uses the existing pattern, low risk.

Secondary perf items:
- `rebuildTimelineDay` materializes the day twice (`db.handlers.ts:379` and `:409`) around the AI loop. The first could be a read.
- `GET_TIMELINE_DAY` schedules AI jobs on every fetch (mitigated by fingerprint dedupe, but still computes the fingerprint each time).
- Renderer god-views (Insights 2649, Timeline 2138) and `recap.ts` (1110) likely recompute transforms on each render (INFERRED — not yet traced for memoization). Verify before acting.

---

## 5. THE coherence problem: one brain, three consumers, two ignore it

The app has exactly one component that learns the user: **work memory / promoted patterns** (`services/workMemory.ts`, fed by `learnFromBlockOverride:633` and `eveningConsolidation`). It only feeds **Timeline block labels**. The other two "understanding" features bypass it:

- **Distraction** (`services/distractionAlerter.ts`) is a fixed category timer. It alerts after N minutes in a leisure category (`thresholdMinutes`, `leisureState.consecutiveSeconds`, lines ~166-223). Its OWN header comment (lines 8-33) says it *should* use deviation from learned patterns and onboarding role context. It does not. So distraction ≠ "deviation from your patterns" (the product's stated definition).
- **Focus %** (`lib/focusScore.ts:67` `isCategoryFocused`) is membership in a hardcoded `FOCUSED_CATEGORIES` list (`shared/types.ts:1099`). Not personalized, not learned. (This is the "focus score is wrong" already flagged in project memory.)

So the felt symptom "the app doesn't understand me" has a precise cause: understanding lives in work memory, but distraction and focus never ask it.

### 5b. The relabel pipeline is fragmented (the two-button bug)

Four separate places decide when AI relabels a block, each with slightly different rules:
1. Day "Re-analyze with AI" → `db.handlers.ts:373` → gate `shouldReanalyzeBlockWithAI` (`workBlocks.ts:2236`). Line 2243 SKIPS any block that already has a "useful-looking" AI label, so a bad-but-AI-labeled block is never redone. jobType `block_cleanup_relabel`. Comment: "preserves good AI labels." It cannot tell bad AI labels from good ones.
2. Per-block "Regenerate label" → `ai.handlers.ts:113` → NO gate, forces overwrite. jobType `block_label_finalize`. Feeds the model the same evidence with no "previous label was wrong" signal, so output is often ~identical (feels like nothing happened).
3. Background cleanup → `backgroundRelabelDispositionForBlock` (`workBlocks.ts:2254`) → skip/relabel/review.
4. Live preview → `block_label_preview`.

Label resolution itself merges six competing sources (override, ai, rule, artifact, workflow, memory) in `finalizedLabelForBlock` (`workBlocks.ts:2264`). Different entry points resolve differently → inconsistent results = "not one connected engine."

Fix direction: one relabel decision function + one execution path, with an explicit "force / user thinks this is wrong" mode that bypasses the preserve-good-labels gate and passes that signal to the model. Unifies #1 and #2 and fixes the bad-block bug.

### 5c. Seam leak (architecture, smaller)

MAIN imports RENDERER code, against the app's one invariant:
- `services/wrappedNarrative.ts:12` imports `renderer/lib/wrappedFacts`.
- `services/snapshotExporter.ts:18` imports `renderer/lib/recap`.
Fix: move those pure transforms to a shared module both sides import.

---

## 6. Feature connectedness table

| Feature | Reads from | Uses learning brain? | Recompute / duplication risk |
|---|---|---|---|
| Timeline (today) | live `getTimelineDayPayload` | yes (per-block) | FULL REBUILD per app switch (hot) |
| Timeline (past) | `readDerivedDay` (cached) | baked into derived | fine |
| Apps | `getAppSummaries` / `getAppDetail` | partial | rebuilds on activity_recorded |
| Insights chat | `sendMessage` + aiTools over DB | reads patterns via tools | per-turn AI |
| Day summary / Week review | `ai_surface_summaries` (signature cached) | indirectly | GOOD caching |
| Wrapped (day/period) | recap transforms + AI | no | recompute; main↔renderer leak |
| Distraction | live category state | NO (should) | category timer only |
| Focus % | session categories | NO (static list) | not personalized |
| Attribution / Clients | work_sessions / segment_attributions | separate pipeline | 2 split modules (attribution + attributionResolvers) |
| Work memory | observations / promoted patterns | IS the brain | only Timeline consumes it |
| Search | `searchSessions/Blocks` | no | fine |
| Sync | syncUploader/remoteSync | no | invalidates on pull |

---

## 7. Ranked fix backlog (implement in this order)

P0 — Speed, biggest felt win, low risk.
- [x] DONE — Throttle/coarsen `activity_recorded` invalidation so micro-sessions batch. `coalescer.ts` + `tracking.ts`.
- [ ] Memoize today's timeline payload behind a content signature so an app switch that doesn't change the day's session set skips the full rebuild. DEFERRED — must include the live-session window in the signature or it shows stale live data. Anchors: `core/query/projections.ts` (today→null branch), `workBlocks.ts:3224`.

P1 — Coherence, fixes the two-button bug.
- [x] DONE — Unified the relabel write path (`writeAIBlockLabel`, force mode) + rejectedLabel prompt signal so Regenerate varies. Anchors: `db/queries.ts` writeAIBlockLabel, `db.handlers.ts` applyAIInsightToTimelineBlock, `ai.handlers.ts` REGENERATE_BLOCK_LABEL, `aiService.ts` generateWorkBlockInsight. Note: the day "Re-analyze" gate (`workBlocks.ts:2236`) is intentionally left preserving good AI labels; the reliable "this one is wrong" path is per-block Regenerate.

P1b — Timeline segmentation (Phase 1, lower-risk half).
- [x] DONE — Contentless browser-sliver absorption in `absorbShortCandidates`. Anchors: `workBlocks.ts` `candidateIsContentlessBrowserSliver` and the `contentlessSliver` relatedness bypass. Fixture: `tests/timelineSegmentation.test.ts`.
- [ ] STOP — Project-aware remerge (architecture-fragment case) needs a real "same project" signal from second brain / attribution. High regression risk against the distinct-topics guard. Owner decision required before implementing.
- [ ] OPEN — 2-hour block ceiling vs true calendar (should one coherent activity exceed 2h?).

P2 — Coherence, the "understands me" gap.
- [ ] Wire distraction to learned deviation (work memory) instead of a fixed category timer. Anchor: `distractionAlerter.ts`.
- [ ] Make Focus % reflect learned/personalized focus, not a static category list. Anchors: `lib/focusScore.ts:67`, `shared/types.ts:1099`.

P3 — Cleanup.
- [ ] Remove the redundant on-screen info (NEEDS the owner to point at the exact screen; six-source label merge in `finalizedLabelForBlock` is the suspect).
- [ ] Move recap/wrapped transforms to a shared module (fix the main↔renderer leak). Anchors: `wrappedNarrative.ts:12`, `snapshotExporter.ts:18`.
- [ ] `rebuildTimelineDay` double-materialize. Anchor: `db.handlers.ts:379,409`.

Architecture deepenings (separate, see /tmp architecture reports + improve-codebase-architecture): provider adapter seam, AI job harness, workBlocks pure-assembly extraction, query seam. These help maintainability; they are not the speed fix.

## 8. Open / not yet verified
- Renderer re-render cost in Insights/Timeline/recap.ts (memoization) — inferred, not traced.
- Exact "redundant information" screen — awaiting owner.
- No live profiler numbers — can instrument if hard numbers are wanted.
