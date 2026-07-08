# Wrapped — the agentic storyteller (implementation plan)

Status: proposed 2026-07-08, pending founder approval. Supersedes the template-deck design in `docs/specs/wrapped.md` for generation + presentation; IPC and facts layers are preserved.

## Objective

Rebuild Wrapped's generation and presentation layer so every deck is **written fresh by an AI that investigated the period** — not assembled from templates. The pipeline reads the tracked record, mines the user's personal patterns, reaches into connected tools (meeting notes, commits, mail) through MCP, and writes a cinematic 10–30 slide story with tease→reveal beats. Every slide is askable and correctable; corrections update the Timeline itself and train future wraps. Numbers can never disagree with the database or with each other.

**Done means:** opening today's wrap produces a deck where every fact is verifiably true, every sentence was written for this specific day, the ML-Pipeline-class slide can say what the class covered, a correction typed on any slide rewrites it inline and relabels the Timeline block, "Export wrap" saves a complete shareable image via a native dialog, and the test suite covers rendering with real data, export output, first-open loading, and a real ask/fix round trip.

## Why the current output fails (grounded in the Jul 7 audit)

The existing pipeline (deterministic facts → fixed slide plan in `src/renderer/lib/wrapDeck.ts` → one strictly-validated AI sentence per slide → template fallback) produced, for Jul 7: a day "running 11:15am–10:26pm" while the user started ~9:10 (capture outage, stated as confident truth); a 2-hour meeting reported as 49m on three slides while its own timeline block reads 11:15–12:28; "5h 16m" on one slide and "7h 28m" on another; raw window titles in prose ("Afternoon went to building OC | Prompt cache hit rate drop investigation"); a chart bar literally labeled "App"; dev blocks classified `entertainment` (the Jul 7 category fix landed but the day was never re-analyzed); and a week deck that shamed the in-progress Wednesday ("barely happened, just 8 minutes") ten minutes into that Wednesday. The single-sentence-per-slide contract plus maximal validator strictness guarantees bland restatements even when nothing is wrong.

## What stays (reuse)

- **IPC surface** — the four channels in `src/shared/types.ts:1906-1909` (`ai:get-wrapped-narrative`, `ai:get-wrapped-period-narrative`, `ai:get-wrap-provider-state`, `ai:ask-wrapped`) and the preload API in `src/preload/index.ts:238-245`. Response payloads gain a `deck` field; callers keep working during migration.
- **Facts builders** — `buildDayWrapFacts` (`src/renderer/lib/dayWrapScenes.ts`) and `buildWrappedPeriodFacts` (`src/main/lib/wrappedPeriodFacts.ts`) remain the numeric substrate, consolidated behind one fact table (below).
- **Persistence pattern** — the `wrapped_narratives` store keyed by cadence+key (`src/main/db/wrappedNarrativeStore.ts`) extends to store decks, keeping its deliberate DATE-keyed contract: a generated deck is stable for its period; only explicit Regenerate or a timeline rebuild replaces it (DEV-118).
- **Timeline write paths** — `writeTimelineBlockReview` (`src/main/services/workBlocks.ts:1744`) and `REBUILD_TIMELINE_DAY` (`db:rebuild-timeline-day`, `src/shared/types.ts:1841`) already exist; the fix loop and P0 re-analysis call them rather than inventing new mutation paths.
- **Job orchestration** — `executeTextAIJob` in `src/main/services/aiOrchestration.ts` stays for the ask/fix path. Note: model *tiers* no longer route models (`modelForProvider`, `aiOrchestration.ts:312-338` — the user's chosen model always wins), so deck generation gets an explicit **per-job model override**: `wrapped_deck` forces the top model for the user's provider (Anthropic → the latest Opus/Fable-class id, OpenAI → the flagship, etc.), ignoring the everyday model picked in Settings. That is the only way "best model, always" is real.

## Architecture — resolve → enrich → write → verify

This design honors ADR 0002 (`docs/adr/0002-ai-data-access.md`), which deleted the model-driven tool loop: **the model never decides whether data exists.** The wrap pipeline resolves all evidence deterministically first, then hands the model one complete bundle to write from. The "agentic" behavior the product needs — reaching into Granola for the class notes, pulling commits for the shipped-work slide — lives in a deterministic **enrichment planner**: code (not the model) inspects the resolved facts for enrichment opportunities (a meeting block overlapping Granola activity → fetch notes for that exact time range; a day with github.com sessions and a connected GitHub → fetch that day's commits), executes them with timeouts, and folds results into the bundle. The user experiences a true agent; the architecture stays loop-free and provider-agnostic — which also resolves the fact that `executeTextAIJob` is single-shot and several provider modes (CLI providers, weak models) have no structured tool calling at all.

Pipeline, all in main process (`src/main/services/wrapAgent.ts`, a new orchestration entry — not `executeTextAIJob`):

1. **Resolve** (deterministic): fact table, timeline evidence, patterns ≥ 0.70 support, memory (corrections + past Q&A), capture health.
2. **Enrich** (deterministic planner → MCP registry, read-only): notes/commits/etc. fetched for specific evidence-backed opportunities, each tagged with its source.
3. **Write** (one call, forced top model): the complete bundle plus the writing contract; the model authors the whole deck — slide selection, order, reveals, all copy.
4. **Verify** (+ at most one repair call): the validator returns violations; the writer fixes them once, or the pipeline degrades honestly.

Each stage emits a humanized progress step over the existing `IPC.AI.STREAM_EVENT` channel (wired at `src/preload/index.ts:221`) with a new `wrap-progress` event kind. Providers with real tool-use support may later get an opt-in interactive mode behind the same interface, but resolve-then-write is the contract. Generation cost and latency are accepted product decisions: minutes are fine when the writing justifies them; the waiting room owns that time.

**Generation lifecycle:** decks are cached by `cadence+periodKey` (DATE-keyed, per the existing store contract) — never auto-regenerated by facts drift. Regeneration happens only on explicit **Regenerate**, after `REBUILD_TIMELINE_DAY` touches the period, or when a provisional deck's period closes (a week deck generated mid-week is marked `provisional` and regenerates once the week ends). A changed `factsHash` on an open period surfaces a "your day grew — regenerate?" nudge, nothing more. An in-flight registry keyed by `cadence+periodKey` joins concurrent openers to the same run so day+week opened together never double-generate, and MCP calls are rate-limited across simultaneous runs.

### The evidence bundle (what the writing call receives)

| Bundle section | Resolver | What the writer gets |
| --- | --- | --- |
| facts | new `src/main/lib/wrapFactTable.ts` | The one fact table: totals, spans, sanitized app/site slices, meetings with true block durations, splits, per-day rollups — every value carries a fact id |
| timeline | `getTimelineDayPayload` / snapshots | Block evidence: cleaned labels ("Prompt cache hit rate drop investigation"), categories, specifics for "what got done" |
| patterns | new `src/main/lib/patternMiner.ts` | Recurring meetings, gap windows, weekday medians, records, streaks, tool trends — each with support + sample size; only ≥ 0.70 support is included |
| memory | `wrap_feedback` + past decks | The user's corrections, past questions and answers, profile — the self-evolving layer |
| captureHealth | `focus_events` × `app_sessions` × `activity_state_events` | Per-gap verdicts: asleep vs blind (monotonic-vs-wall-clock delta), overlap with known gap windows |
| enrichments | enrichment planner → MCP registry | Notes/commits/etc. fetched deterministically for specific evidence-backed opportunities, each tagged with its source |
| verifyDeck | validator (below), post-write | Violations list; the writer gets one repair call |

### The deck contract

```typescript
// src/shared/types.ts — new
export type WrapSlideKind =
  | 'opening' | 'ledger' | 'story' | 'stat' | 'bars' | 'split'
  | 'reveal' | 'gap' | 'question' | 'reflection' | 'finale'

export interface WrapSlide {
  id: string
  kind: WrapSlideKind
  kicker?: string
  tease?: string            // present => two-beat reveal
  headline: string
  body?: string
  stat?: { value: string; sublabel?: string }
  bars?: Array<{ label: string; value: string; ratio: number }>
  split?: { leftPct: number; leftLabel: string; rightLabel: string }
  factRefs: string[]        // every number/clock in copy must resolve here
  patternRefs?: string[]    // required for any speculation
  sources?: string[]        // e.g. ['timeline','patterns','granola']
  speculative?: boolean
}

export interface WrapDeckDoc {
  schemaVersion: 1          // read-time migration for persisted decks
  cadence: 'day' | 'week' | 'month' | 'year'
  periodKey: string         // local-tz; week = rolling 7-day per wrappedPeriodRange.ts
  provisional: boolean      // generated while the period was still open
  voice: 'punchy' | 'warm' | 'narrator'
  slides: WrapSlide[]       // day 10–14, week 20–24, month 24–28, year 30–34
  generatedAt: number
  factsHash: string         // staleness marker only — never a cache key
}
```

Required beats enforced by the validator, not the prompt: `opening`, `ledger` (tracked vs focused + where the focus went), at least one `story` carrying *what got done*, `question`, `reflection`, `finale`. Everything else — order, emphasis, which reveals to stage, which slides exist at all — is the writer's editorial call, which is what makes decks different every day. Voice rotates through three registers (punchy-minimal-with-a-quote, warm friend, cheeky narrator) seeded by period key; **Regenerate** reseeds both voice and angles.

### The writing contract (replaces per-line strangulation)

- Copy budget: headline + up to 3 sentences; question marks and cross-slide clock references allowed.
- Grounding: every number, clock time, and percentage must resolve to a `factRef`; `verifyDeck` extends `wrapNarrativeShared.ts` to scan against the whole fact table instead of one slide's note. Each fact carries its **groundable forms**: the exact value plus generated approximations — rounded ("~1 hour", "about an hour" for 59m), spelled-out ("five threads"), and clock roundings within ±10m ("about 12:30" for 12:28). A number in copy matches if it equals any groundable form of a cited fact; prose quantities with no numeric content ("a couple of tabs") are style, not claims, and pass.
- Speculation: any claim beyond the record ("probably lunch or a walk 😄", "your usual Tuesday class") must cite a `patternRef` with support ≥ 0.70 or a `wrap_feedback` memory; otherwise it must be phrased as a question to the user.
- The raw-artifact scan (`looksLikeRawArtifactLabel`, `src/renderer/lib/wrappedFacts.ts:348`) runs on all copy AND all bar labels — the "App"-bar class of bug becomes a validation failure.
- Entity resolution (decided 2026-07-08): copy never contains a raw URL, file path, or verbatim tab title. Sites and content resolve to real entities before naming — "YouTube, watching a Marques Brownlee podcast, 2 to 4pm", never "youtube.com" or "Askquestions.com/html/cmpasmdf". The resolver lives with the fact table (domain → product name via `classifyDomain`/app identity data; page titles → content entity when confidently parseable, else the product name alone) and the raw-artifact scan enforces it.
- Failure mode: violations → one repair round → if still failing, serve the last good cached deck, or the **no-AI deck**: a deliberately designed, honest, still-fun deterministic deck (ledger, what-got-done chips, one big number, reflection prompt as a question to the user) — crafted copy variations, never the old template voice, never fake richness.

## Pattern miner — the "how do you know that" engine

`src/main/lib/patternMiner.ts`, deterministic, incremental (on generation + after `REBUILD_TIMELINE_DAY`). Computed over trailing 8 weeks of `timeline_blocks` + `app_sessions`: recurring meetings (title similarity × weekday × hour), recurring gap windows (the user's real lunch/gym hours), weekday start/end medians, personal records (longest block in N weeks), streaks, app adoption/abandonment, night-owl drift. Support = qualifying windows ÷ observed windows; the ≥ 0.70 gate is enforced at the bundle boundary so the writer never sees weak patterns. Corrections adjust priors: a fix like "that gap is the gym" writes a `wrap_feedback` row the miner folds in as a labeled example.

## MCP connectors — reach into the user's real context

Core abstraction: `src/main/services/mcpConnectors.ts` — a registry of MCP client connections owned by the main process. Per connector: id, transport (stdio or HTTP), auth flow (OAuth device / API key), tool allowlist (**read-only tools only** reach the wrap pipeline), enabled flag in settings. Granola, GitHub, Gmail, and Microsoft 365 are adapters over this one registry, not four bespoke integrations.

- **Discovery-based enrichment (decided 2026-07-08)**: the enrichment planner does not hardcode a source list. Per generation it enumerates what exists for *this* user — connected MCP servers, plus local read-only sources (e.g. Granola's local note cache, browser history stores, platform caches on both macOS and Windows) — and picks the relevant ones from the evidence. Granola and GitHub both ship in P4; a standing research item catalogs further sources for all Daylens users (see Research below).
- **Settings → Connections**: connect/disconnect, auth status, what Wrapped may read. Connecting installs and authenticates the MCP server for the user.
- **Suggested connections**: when evidence implies an unconnected source (Granola active during a meeting; github.com all over the tab record), the deck may end with one non-nagging suggestion ("Connect Granola and next time I'll tell you what the class actually covered").
- **Privacy contract**: external tools are called only for connected sources; each slide's `sources` records what was consulted and the finale shows the union in small print. Nothing from MCP tools is persisted except through the deck itself.
- Each adapter ships with the smallest useful surface (fetch notes/commits overlapping a block's time range), not a general client.

## Ask / Fix — the self-evolving loop

One input on every slide, two intents. **Ask** → grounded conversational answer, multi-turn. **Fix** → the slide is rewritten inline (with undo), and the correction teaches the whole system: a `wrap_feedback` row persists it, `writeTimelineBlockReview` relabels the underlying Timeline block with provenance `user`, the pattern prior gets a labeled example, and every future wrap reads it through the memory bundle — guesses stop repeating disproven reads, and reflections can call back to past answers.

`ai:ask-wrapped` gains `mode?: 'ask' | 'fix'` (inferred when omitted); the result gains `updatedSlide?: WrapSlide` and `timelineUpdate?: { blockId, label }`. Fixes apply immediately — the user knows their day best — with one-tap undo. Corrections never mutate tracked numbers; they own labels, interpretation, and future guesses. `src/main/services/wrappedQuestion.ts` grows into this (or is replaced by `wrapAsk.ts`) keeping its server-side grounding approach.

**Durable anchors, undo, and propagation.** Slide ids are ephemeral (decks are re-authored), so a correction is anchored to what persists: the timeline `blockId` and/or `factRef` plus the period key — never the slide id alone.

```sql
CREATE TABLE wrap_feedback (
  id TEXT PRIMARY KEY,
  cadence TEXT NOT NULL,
  period_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('ask','fix')),
  slide_id TEXT,                -- display context only
  block_id TEXT,                -- durable anchor (nullable for period-level fixes)
  fact_ref TEXT,                -- durable anchor
  user_text TEXT NOT NULL,
  resolution_json TEXT NOT NULL, -- rewritten slide, answer, inferred correction
  timeline_review_key TEXT,      -- key of the writeTimelineBlockReview row, for undo
  undone_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE wrap_patterns (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,            -- recurring_meeting | gap_window | median_edge | record | streak | tool_trend
  params_json TEXT NOT NULL,
  support REAL NOT NULL,
  sample_size INTEGER NOT NULL,
  last_computed INTEGER NOT NULL
);
```

Undo reverts via `timeline_review_key` and restores the prior slide from the persisted deck history, stamping `undone_at`. A fix that relabels a block also **rebuilds the affected day** (`REBUILD_TIMELINE_DAY`) and marks stale every cached deck of an enclosing period (that day's week/month/year), since period wraps sum frozen day snapshots — those decks show the regenerate nudge next open. Feedback rows whose block no longer exists survive as memory (they still teach guesses) but stop offering undo.

## Capture-gap honesty

`get_capture_health` formalizes the Jul 7 investigation: for each within-day gap ≥ 45m it compares wall-clock delta vs monotonic delta across the gap's edge events (the monotonic clock pauses during macOS sleep) and checks `activity_state_events` for sleep/lock markers. Verdicts: `asleep` (say nothing), `blind` (the tracker missed real usage → the ledger slide says so plainly and asks "were you at it before I woke up?"), `unknown` (time-of-day guess gated by a gap-window pattern). The week ledger lists which days were fully vs partially seen; in-progress days render as "still being written" and are excluded from best/worst verdicts.

## Waiting room

`GeneratingScreen.tsx` upgrade: ETA from a rolling median of recent generation times per cadence; live pipeline steps streamed over the existing `IPC.AI.STREAM_EVENT` channel with a new `wrap-progress` event kind — no parallel streaming pattern. While it writes (decided 2026-07-08): a short reading list matched to the user's interests ("I found these on Hacker News — I promise your wrap is ready before you finish the first one"), kept simple and real. If the user navigates away, an OS notification fires when the deck lands ("Your wrap is ready"), and an evening notification offers to start one ("Want to wrap your day?") — both reusing the `dailySummaryNotifier`/`dailySummaryScheduler` pattern (`src/main/services/dailySummaryNotifier.ts`, `src/main/lib/dailySummaryScheduler.ts`). No fake progress bars — if the run is slow, the steps show why.

## Export via main process

Keep the pure model builders in `src/renderer/components/wrap/wrapExport.ts` (already tested for one-panel-per-slide and grid sizing), but replace the `<a download>` sink: the rendered PNG buffer goes over a new `wrap:export-save` IPC call to main, which shows a native save dialog and writes the file. Failure surfaces as a visible error state, never a silent reset (today `WrapDeck.tsx:163-165` maps failure back to idle with no message). Decks beyond canvas limits export as a paged sequence of images rather than failing.

## P0 — data integrity (before anything else is judged)

1. Run `db:rebuild-timeline-day` for 2026-07-06 and 2026-07-07 so blocks pick up the corrected categorization (dev blocks are still `entertainment` in the live DB).
2. One fact table: `wrapFactTable.ts` becomes the only reader the deck path uses; a consistency test asserts a deck's every `factRef` resolves and no two facts about the same quantity differ.
3. Meeting truth: meeting durations come from meeting-block spans (`timeline_blocks` kind `meeting`), not category-weighted seconds — kills "49m" for the 73-minute block.
4. Period app slices route through the same sanitizer as day slices (today `wrappedPeriodFacts.ts:82-84` bypasses `looksLikeRawArtifactLabel`).
5. Capture-gap detector + tests pinned to the real Jul 7 shape (blind morning) and Jul 8 (healthy).

## Phases

| Phase | Scope | Key files |
| --- | --- | --- |
| P0 | Data integrity + re-analyze (above) | `wrapFactTable.ts` (new), `wrappedPeriodFacts.ts`, `workBlocks.ts` |
| P1 | Deck contract, wrap pipeline with local resolvers, validator, new WrapDeck player (day + week), waiting room, export fix | `wrapAgent.ts` (new), `types.ts`, `ai.handlers.ts`, `WrapDeck.tsx`, `WrapSlideView.tsx`, `GeneratingScreen.tsx`, `wrapExport.ts` |
| P2 | Ask/Fix loop end-to-end: feedback store, timeline writes, memory injection, undo | `wrapAsk.ts`, `wrap_feedback` migration, `WrapDeck.tsx` panel |
| P3 | Pattern miner + speculation gating + gap-window guesses | `patternMiner.ts` (new), `wrap_patterns` migration |
| P4 | MCP connector registry + first adapter, suggestion slide; month/year decks; waiting-room teasers | `mcpConnectors.ts` (new), `Settings.tsx` |

The founder tests on real days after P1 and after P2 — each phase leaves the app shippable.

## Verification

- Deck renders with real data: fixture built from the actual Jul 7 DB shape renders 10+ slides, required beats present, no raw artifact strings anywhere (extends `wrappedDeckRender.test.ts`).
- Export produces a file: full-deck export writes PNG(s) through the main-process sink; failure path shows a visible error (extends `wrapExport.test.ts` + new IPC test).
- Loading state on first open: generating screen with ETA + streamed steps appears before the first deck (extends `wrappedDeckRender.test.ts`).
- Interactive question returns a real AI response: ask round-trip against a stubbed provider returns a grounded answer; fix round-trip rewrites the slide, writes `wrap_feedback` + a timeline review, and undo reverts both (new `wrapAsk.test.ts`).
- Validator: a deck with an unresolvable factRef, ungated speculation, or a missing required beat is rejected; the repair round works (new `wrapDeckValidate.test.ts`).
- Consistency: no two slides can state different values for the same fact id; the meeting slide duration equals its block span (new `wrapFactTable.test.ts`).
- Capture health: the Jul 7 fixture yields a "blind" morning verdict; a sleep fixture yields "asleep"; in-progress days are excluded from week verdicts (new `captureHealth.test.ts`).
- Pattern miner: support math, the 0.70 gate at the bundle boundary, and a correction folding into the prior (new `patternMiner.test.ts`).
- End-to-end smoke: launch the dev app, generate today's wrap against the live DB, walk every slide, submit one ask and one fix, export — the founder verifies on a real day (manual, the only "done" that counts).

## Risks

- **Latency/cost variance** — bounded by the accepted product decision (minutes are OK), the waiting room, DATE-keyed caching with an in-flight registry, and the single-repair-round cap.
- **The model writes something ungrounded despite the bundle** — the validator is the backstop; it rejects, repairs once, then degrades honestly. It never ships an unverifiable claim.
- **MCP tool surface security** — read-only allowlist, connected-only, per-deck source logging, per-run rate limits; connectors land in P4, after the core is trusted.
- **Module placement** — `wrapFactTable.ts` lives in `src/main/lib/` (the deck is authored in main; the renderer only plays `WrapDeckDoc`), so the old renderer-lib-imported-by-main subtlety of `wrapDeck.ts`/`dayWrapScenes.ts` retires with the planner. Keep the fact table free of Electron APIs for testability.
- **Regression during migration** — legacy `lines` fields stay populated (derived from deck slides) until DayWrapped/PeriodWrapped fully switch, so a mid-migration build still renders; `schemaVersion` gives persisted decks a read-time migration path.

## Decisions (founder, 2026-07-08)

1. **Connectors:** Granola AND GitHub in P4; enrichment is discovery-based — enumerate available MCP servers + local sources per user and pick by relevance. Standing research item below.
2. **Waiting room:** real ETA + interest-matched reading list ("your wrap is ready before you finish the first one"); wrap-ready OS notification when the user navigates away; evening "want to wrap your day?" notification.
3. **Hard fail:** honest, minimal, still fun — a deliberately crafted no-AI deck, never the old template voice.
4. **Hard lines:** never raw URLs, file paths, or verbatim tab titles — resolve to real entities ("YouTube — a Marques Brownlee podcast") before naming anything.

## Research

Catalog additional context sources the enrichment planner should discover, for all Daylens users on macOS and Windows: local app caches (Granola, Slack, calendar stores), browser history databases, OS-level activity sources, and the practical/permission constraints of each. Output feeds the P4 connector/discovery design.
