# Timeline Reconstruction — Progress & Handoff

**Status: R1–R4 and the P1/P3 label/shape problems resolved; P2/P4 follow-up in progress
(heuristic `timeline-v7`).** The §7 decisions below are now answered and implemented. Durations are
honest (active time, not bridged span), past-day blocks persist so edits and rebuild work, drift no
longer bridges into runaway blocks, and the "<noun> development" label leak is gone. This top
section records the resolution; sections 2–10 are preserved as the original handoff for context.

Last updated: 2026-05-29. Branch: `main`. App version: 1.0.37.

## FOLLOW-UP (2026-05-29, v7)

- **Re-analyze with AI now has real targets and feedback.** Artifact/workflow labels are treated as
  deterministic floors for manual/background AI cleanup, so raw titles like `owner/repo: Daylens`
  do not mark a block "done". The day-level button shows progress and surfaces provider failures
  instead of silently returning an unchanged day.
- **Sparse tool-switch spans no longer stand alone because their wall span is large.** The
  sub-5/sub-30-minute absorption passes now use active tracked time, and known AI/dev tools that
  arrived as `uncategorized` (Antigravity, cmux, Codex, etc.) are treated as focused evidence for
  timeline grouping.
- **GitHub repo/review pages badge as focused research.** A GitHub repo page can now agree with a
  review/research label instead of showing a generic BROWSING badge.
- **Repo-title labels are naturalized earlier.** `owner/repo: Project` collapses to `Project`, and
  leading marker cruft is stripped before block cards and day themes render.

## FOLLOW-UP (2026-05-29)

- **Rebuild day is now Re-analyze with AI.** The button no longer invalidates or wipes
  `timeline_blocks`. It forces AI naming only for blocks still on deterministic floors
  (rule/category/project hint) or low confidence, and preserves user overrides plus already-good AI
  labels.
- **AI naming is the primary upgrade path.** Floor-labeled blocks are queued for eager background
  relabeling once quiet, instead of being marked "reviewed" forever.
- **Category/label agreement tightened.** Mixed Daylens development/research blocks with substantial
  focused-work evidence no longer keep a browsing badge just because browser context was present.
- **Shape-of-day labels are naturalized and deduped.** Raw repo/page titles such as
  `owner/repo: Daylens` collapse to a human label, and drift copy does not repeat the cluster label.
- **History gets a gradual upgrade pass.** A one-time background sweep reopens stale unprocessed
  pre-current heuristic days in small batches so History/Apps/recap stop mixing old and current
  grouping. AI relabeling piggybacks on the same pass when background enrichment is enabled.
- **P2 addressed.** The coarse 15-minute cut is now a hard boundary only when activity-state evidence
  shows lock/unlock/sleep/wake/away/idle events inside the gap. Same-app work can still bridge an
  ordinary untracked lull, but not a real away/lock/suspend boundary.

## RESOLUTION (2026-05-28)

**§7 decisions, as implemented:**
- **Persistence model.** Kept two read paths but made them converge on one persisted truth: the
  derived (past-day) path now calls `persistTimelineDay`, so the blocks shown are the blocks
  stored (same content-derived IDs). Grouping is cached; **labeling is always re-derived on load**
  (`loadPersistedTimelineBlocksForDay` and `getLightweightDayPayload` both re-run
  `finalizedLabelForBlock`). This fixes R1/R2 and means stale stored labels can't outlive a logic fix.
- **Duration semantics.** A block's duration is its **active tracked time** (`blockActiveSeconds`)
  everywhere a number is shown — block card, narrative prose, Focus/Drift/Score, day themes. The
  clock range still shows wall-clock span, so a bridged block honestly reads "9:16–11:13 · 52m".
  Focused + Drift now equals tracked exactly (verified on real May 26/27/28).
- **Bridging scope.** Drift categories (`browsing`, `entertainment`, `social`) never bridge across
  a gap (`NON_BRIDGEABLE_CATEGORIES`); only focused work can. Fixes the "1h 57m watching" over-merge.
- **Heuristic versioning vs labels.** Version-in-ID is fine **because** processed (AI/user) days are
  kept as-is (IDs stable, labels preserved) and only unprocessed stale days are rebuilt — those have
  no labels worth keeping. Bumped `v4 → v5` to re-grade unprocessed days with the new logic.
- **Order of operations.** Labeling was the bottleneck. Project hints are now grounded only in real
  code signals (file activity, code repos, localhost dev servers — never a web tab title/host), and
  work-memory labels are gated to focused-work-dominant blocks. Label priority is
  override → memory(user) → AI → artifact → workflow → projectHint(floor) → rule → category-name.
  "Untitled block" is now only for system/uncategorized; everything else floors to its category name.

**Verification:** `npx tsc --noEmit` clean; 58 block/label/memory/recap tests pass (incl. new
regression tests for drift-no-bridge, project-hint web-title rejection, "(N)" stripping, category
floor). The production `getTimelineDayProjection` was run over a copy of the real DB for May
26/27/28 (metrics balance, FK writes succeed, rebuild recomputes) and the live app migrated today to
`timeline-v5` with no runtime errors.

**Still open / next:** P2 (the blunt 15-min idle coarse-cut) and P4 (gradual AI-assisted
reconstruction) are untouched. Many deterministic floors still read as a bare category
("Development") until the background AI relabel job upgrades them — that path is unchanged and is now
the main lever for getting from "honest floor" to §6-quality names.

---

---

## 1. The product goal (what "done" looks like)

The Timeline should read like a human calendar of focused work stretches, not a log of every
app switch. The user asked for:

1. **Coalesce fragments.** Consecutive blocks of the same app / same work with small gaps are one
   block. Brief tab switches and tiny interruptions do not create blocks.
2. **No micro-blocks.** Avoid 1-minute / few-second blocks. Anything under ~30 min should generally
   not stand alone; it attaches to the previous/next block by semantic relatedness.
3. **Bridge the same work across moderate gaps.** A 17-minute untracked lull in the middle of a
   coding morning should not split one Ghostty session into two blocks.
4. **Shape-of-day summary** that is data-driven and gated: do not claim the shape of the day until
   there is enough tracked activity; otherwise say "not available yet".
5. **Historical reconstruction**: opening an older day should reconstruct it (ideally gradually,
   AI-assisted), persist the result, keep nightly-summarized days, but rebuild older unprocessed
   days more accurately on revisit.
6. **Rebuild day** button at the day level (not per-block) that forces a clean reconstruction.

Product philosophy: passive, inferred, zero required input. See `memory/product_philosophy.md`.

---

## 2. THE fundamental architecture fact (read this first)

There are **two separate block-building pipelines**, and almost every bug traces back to this:

| Path | Entry | Block builder | Persisted? |
|---|---|---|---|
| **Live / today** | `getTimelineDayPayload` (`workBlocks.ts:2895`) | `buildBlocksForSessions` (coalescing) | Yes, into `timeline_blocks` |
| **Past days (derived)** | `getDerivedDayTimelinePayload` (`projections.ts:166`) | now also `buildTimelineBlocksFromSessions` | **No** — computed on the fly |

`getTimelineDayProjection` (`projections.ts:~256`) checks the **derived path first** for any past day
(`dateStr !== today` and a `derived_*` projection exists). Today always uses the live path.

Before this work, the derived path mapped raw `derived_blocks` 1:1 with **zero coalescing** — that
was the "172 blocks on May 27" symptom. It now routes derived sessions through the same coalescing
builder, so both paths produce the same block shapes. **But the derived path never writes to
`timeline_blocks`.** That single fact is the confirmed cause of R1 and R2 below.

Block IDs are content-derived and embed the heuristic version:
`blockIdFor()` → `blk_<sha1(start:end:sessionIds:TIMELINE_HEURISTIC_VERSION)>` (`workBlocks.ts:~1019`).
Consequence: **any heuristic-version change re-IDs every block**, orphaning AI/user labels keyed by
old IDs.

---

## 3. What was changed (the full diff surface)

### `src/main/services/workBlocks.ts`
- `TIMELINE_MIN_STANDALONE_SPAN_MS = 30min` (`:109`). Blocks in [5min, 30min) fold into a related
  neighbour.
- `TIMELINE_SAME_WORK_BRIDGE_GAP_MS = 30min` (`:117`). Same-app related work bridges gaps up to this.
- `TIMELINE_HEURISTIC_VERSION` bumped `v3 → v4` (`:130`).
- `candidatesRelated()` (`:1685`) — relatedness test mirroring `shouldSoftMerge`: same category; for
  topic-sensitive categories (browsing/aiTools/research/entertainment/social) also requires shared
  top app + same dominant content context.
- `absorbShortCandidates(candidates, maxSpanMs, {requireRelated, maxCombinedMs})` (`:1706`) —
  generalized the old `absorbTinyCandidates`. Used twice in `coalesceTimelineCandidates` (`:1761`):
  sub-5min unconditional, then sub-30min require-related (capped at coherent ceiling 180min).
- `shouldBridgeSameWork()` (`:1800`) + `bridgeSameWorkCandidates()` (`:1815`) — day-level pass over
  all coarse segments: fuse adjacent candidates led by the **same dominant app** doing related work
  across gaps < 30min, capped at 180min.
- `buildBlocksForSessions()` (`:1835`) restructured to collect candidates across coarse segments,
  then bridge, then build.
- **`buildTimelineBlocksFromSessions()` (`:1850`, exported)** — coalesce + finalize labels. Now used
  by both pipelines.
- `buildTimelineBlocksForDay()` (`:2586`) — version-aware revisit: keep a past day if it was
  AI/user-processed (`persistedDayWasProcessed`, `:2558`) or already on current heuristic; otherwise
  rebuild stale unprocessed days. (Only affects the live/persisted path.)
- `rebuildTimelineDay()` (`:2890`, exported) — invalidates `timeline_blocks` for the date and
  recomputes via `getTimelineDayPayload`.

### `src/main/core/query/projections.ts`
- `getDerivedDayTimelinePayload` now builds blocks via `buildTimelineBlocksFromSessions(db, sessions)`
  instead of mapping `derived_blocks`. **Deleted** the parallel un-coalesced
  `derivedBlockToWorkContextBlock` and its private helpers.

### `src/main/ipc/db.handlers.ts`, `src/shared/types.ts`, `src/preload/index.ts`
- New IPC `DB.REBUILD_TIMELINE_DAY` → `rebuildTimelineDay` + `scheduleTimelineAIJobs`; exposed as
  `ipc.db.rebuildTimelineDay(date)`.

### `src/renderer/views/Timeline.tsx`
- Shape-of-day gating: narrative only when `totalSeconds >= 90min && substantiveBlocks >= 3`
  (`SHAPE_OF_DAY_MIN_*`), else "Not enough tracked activity yet…". Stat tiles always show.
- "Rebuild day" button in `DaySummaryInspector` → `ipc.db.rebuildTimelineDay` then `onRefresh`.

### `tests/workBlockSplitting.test.ts`
- 5 new tests (same-app fold, no-related-neighbour survives, cross-gap bridge, stale-day rebuild,
  processed-day kept). 15/15 pass; 29/29 across block+recap suites; typecheck clean.

**Note:** main-process files don't hot-reload; a full `npm start` restart is required to see changes.

---

## 4. Confirmed regressions introduced by this work

Each entry is symptom + confirmed root cause. No prescription.

### R1 — "Rebuild day" button does nothing on past days (confirmed by user)
`rebuildTimelineDay` invalidates `timeline_blocks`, but past days render via the **derived path**,
which ignores `timeline_blocks` and recomputes deterministically from `derived_sessions`. Clicking
rebuild therefore produces an identical result. For *today* the day is recomputed on every load
regardless, so the button is also a no-op there.

### R2 — FK constraint failure on block mutations for past days (confirmed: screenshot)
`Error invoking 'ai:regenerate-block-label': SqliteError: FOREIGN KEY constraint failed`.
`timeline_block_labels.block_id`, `block_label_overrides.block_id`, and `workflow_occurrences.block_id`
all `REFERENCES timeline_blocks(id)` (`schema.ts:233,244,303`). Derived-day blocks are computed on
the fly and **never inserted into `timeline_blocks`**, so their IDs don't exist in that table; any
write keyed on `block_id` (regenerate label, save override, attribute-to-client) violates the FK.

### R3 — Focus / Drift / Score exceed tracked time (confirmed: screenshots)
May 28 header shows `tracked 9h26m` while the panel shows `Focused 5h12m + Drift 8h7m = 13h19m`.
`DaySummaryInspector` sums `blockDisplayedSpanSeconds(block)` (`Timeline.tsx:~697-703`). After
bridging, a block's **span includes the internal untracked gap it bridged**, so these totals count
dead time. (`blockActiveSeconds` and `blockDisplayedSpanSeconds` both exist in
`src/shared/blockDuration.ts`.)

### R4 — Over-merging; block span >> actual activity (confirmed: May 27 → 3 blocks)
A 1h4m-tracked evening collapsed into a block labeled "Spent 1h 57m watching …" (9:16–11:13).
Two compounding facts: (a) for entertainment/social, `candidatesRelated` allowed distinct YouTube
videos to count as the same work and bridge; (b) the bridged block's reported duration is its span
(9:16–11:13) including untracked gaps, not the ~1h4m actually logged that evening (same span-vs-active
issue as R3).

---

## 5. Pre-existing problems still unsolved (not caused by this work)

### P1 — Labeling is wrong/nonsensical (most visible)
Examples: "YouTube development" (BROWSING) for *email in Dia*; "Inbox (1) development" (SOCIAL) for
*X/Twitter*; "Settings development"; "Youtube" on a DEVELOPMENT coding block. Two threads: a
**browser-content leak** (a tab title becomes the label even when the real work was a dev app;
partial defense `labelIsBrowserContentLeak` in `finalizedLabelForBlock` is not catching these), and
a **spurious "<title> development" composition** plus label/category-badge contradictions. This is
the F1/labeling track in `docs/AI-FIX-STRATEGY.md`. Grouping and naming are separate layers; naming
is now the bottleneck.

### P2 — Coarse-segment boundary is a blunt 15-min idle cut
`coarseSegmentsFromSessions` (`workBlocks.ts:~450`, `IDLE_GAP_THRESHOLD_MS = 15min`) splits sessions
at any 15-min gap regardless of whether it was a real away/lock/suspend event or just untracked time.
Bridging papers over this for same-app work but the underlying model is unchanged.

### P3 — Shape-of-day "What mattered" semantics
"31m · 41 related stretches", "(1) Home / X", "Factory" — `buildDayThemes` grouping and the
"related stretches" counts are confusing and sometimes wrong. Not yet reviewed.

### P4 — Gradual / AI-assisted reconstruction not built
Goal #5 wanted older days to reconstruct gradually and AI-assisted. Current behavior is a synchronous
full recompute. No streaming/progressive render. AI relabel only runs via the existing
background/nightly path (`scheduleTimelineAIJobs` + `backgroundRelabelDispositionForBlock`).

---

## 6. Quality bar: what good block names and summaries look like

This section defines *what good looks like* and *what's wrong now*, in plain terms, with real
examples from the current build. It does not say how to achieve it.

### Block names

**What good looks like.** A block name is what a colleague would say you were doing if they glanced
over your shoulder. It names the *work*, not the tool and not a raw browser tab. It is short,
specific, and the category badge agrees with it.

Good examples (the shape to aim for):
- "Refactoring the timeline coalescer"
- "Reviewing the Lenny's Product Pass article"
- "Watching an MLK assassination documentary"
- "Catching up on X"
- "Course work — logistic regression notes"

**What's wrong now.** Names are formulaic, leak raw titles, and contradict their own category:
- `YouTube development` on a BROWSING block that was actually 12m of **email in Dia**. Wrong subject
  (YouTube), wrong template (" development"), wrong vs. the work.
- `Inbox (1) development`, badge SOCIAL, actually 42m on **X/Twitter**. "Inbox (1)" is a raw
  notification-count tab title; " development" is bogus; the real subject is X.
- `Settings development` (BROWSING) for reviewing the Daylens page.
- `Youtube` as the name of a DEVELOPMENT coding block in Kiro/Ghostty — a browser tab leaked over the
  real coding work.
- `(1) Instagram development`, `(5) Andersen In Rwanda: Company Page Ad…` — leading "(N)" counts and
  raw page titles surfaced verbatim.

The patterns to recognize as broken: a " development" (or similar) suffix stapled onto an unrelated
noun; a browser tab/video/post title used as the label of a non-browser block; leading "(N)" counts;
the name's subject not matching what the person actually spent time on; the label disagreeing with
the category badge.

### Block narratives (the one-line description under the name)

**What good looks like.** Specific, grounded in what was tracked, cautious about inference, and the
stated duration matches the *active* time. Example from the current build that is close to good:
"Spent 33 minutes in Ghostty terminal with a brief 45-second Safari interruption. Activity pattern
suggests command-line or scripting work without visible code editor involvement."

**What's wrong now.** "Spent 1h 57m watching Eyewitness to Murder…" on a day where only ~1h4m was
tracked all evening — the duration is overstated (it counts bridged gap time, see R4), and it is
paired with a leaked video title.

### Shape-of-the-day summary

**What good looks like.** One or two specific sentences about what the day was actually about,
grounded in the real top activities, that distinguish the main work from the drift and never claim a
theme the evidence doesn't support. Reads like a human recap.

Good shape: "Most of the day went to timeline reconstruction work in Ghostty and Cursor, with a long
afternoon stretch on the coalescing logic. The main drift was an hour of YouTube documentaries late
at night."

**What's wrong now.** "The day clustered around (1) Instagram development and Inbox (1) development.
The main drift came from (1) Instagram development and Inbox (1) development." — it names the **same
items** as both the cluster and the drift, carries the same "(N)" counts and " development" template
as the broken block names, and says nothing real about the day.

---

## 7. Open decisions (no answer implied)

These are the forks the next session has to resolve. They are stated as questions, not directions,
because the current design choices may be wrong.

- **Persistence model.** Should there be one block pipeline or two? Should past/derived days be
  persisted, cached, or always recomputed? The two-pipeline split + non-persistence of derived blocks
  is what makes R1 and R2 possible — but "persist everything" is not necessarily the right answer
  (sync, history rewrites, heuristic-version re-IDing all interact here).
- **Duration semantics.** What does a block's "duration" mean once it bridges a gap — wall-clock span
  or summed active time? Whatever is chosen has to be consistent across the timeline card, the
  narrative text, and the focus/drift/score metrics (R3/R4).
- **Bridging scope.** Should same-app bridging apply to all categories or only some? Should the
  bridge gap be one constant or per-category? Should a bridged gap stay visible?
- **Heuristic versioning vs. labels.** Block IDs embed the heuristic version, so bumping it orphans
  AI/user labels. Is version-in-ID the right design, or should labels survive re-grouping?
- **Order of operations.** Grouping and labeling are independent layers. Which matters more to get
  right first for the user's perception of accuracy?

---

## 8. Key files & symbols reference

- `src/main/services/workBlocks.ts` — block building, coalescing, bridging, persistence, day payload.
  - `buildTimelineBlocksFromSessions` (`:1850`) — builder used by both pipelines.
  - `coalesceTimelineCandidates` (`:1761`), `bridgeSameWorkCandidates` (`:1815`).
  - `buildTimelineBlocksForDay` (`:2586`), `rebuildTimelineDay` (`:2890`).
  - `blockIdFor` (`:~1019`) — IDs embed `TIMELINE_HEURISTIC_VERSION`.
  - `coarseSegmentsFromSessions` (`:~450`), `finalizedLabelForBlock`, `labelIsBrowserContentLeak`.
- `src/main/core/query/projections.ts` — `getTimelineDayProjection` / `getDerivedDayTimelinePayload`
  (derived-first short-circuit at `:~256`).
- `src/main/core/projections/chunk2.ts` — `readDerivedDay` / `hasDerivedDay`, `derived_blocks`/
  `derived_sessions` tables.
- `src/main/ipc/db.handlers.ts` — `GET_TIMELINE_DAY` (`:312`), `REBUILD_TIMELINE_DAY` (`:318`).
- `src/main/ipc/ai.handlers.ts` — `REGENERATE_BLOCK_LABEL` (`:112`, the FK-failing write).
- `src/main/db/schema.ts` — block tables + FKs (`:233/244/303`).
- `src/shared/blockDuration.ts` — `blockActiveSeconds`, `blockDisplayedSpanSeconds`.
- `src/renderer/views/Timeline.tsx` — `DaySummaryInspector` (shape-of-day + Rebuild button),
  `BlockInspector` (per-block regenerate/override), metric calc (`:~697`).
- `tests/workBlockSplitting.test.ts` — grouping behavior tests.

## 9. How to verify / reproduce

- Tests: `ELECTRON_RUN_AS_NODE=1 npx electron --loader ./tests/support/ts-loader.mjs --test ./tests/workBlockSplitting.test.ts`
- Typecheck: `npx tsc --noEmit`
- App: full restart of `npm start` (main process does not hot-reload), then open Today and past days.
- Repro R2: open a past day (e.g. May 27), select a block, click "Regenerate label" → FK error.
- Repro R3: compare header `tracked` vs `Focused + Drift` in the shape-of-day panel.
- Repro R4: open a day that collapsed to ~3 blocks; compare a block's stated duration to actual
  tracked time and to the gaps it spans.

## 10. What actually works today (the real ~10%)

- On a fresh restart, both pipelines coalesce: today and past days dropped from 100s of micro-blocks
  to ~10–15. Same-app cross-gap bridging joins the 7:20→8:41 coding session into one block.
- Shape-of-day gating shows "not available yet" on thin days.
- Grouping test suite is green and documents the intended grouping behavior.

Everything else — correctness of durations, the rebuild button, editing past days, and labels — is
broken or unbuilt.
