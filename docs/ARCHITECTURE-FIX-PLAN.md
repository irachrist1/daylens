# Architecture Fix Plan

Status: **plan — implementation not started.** Each chunk has verification tests. A chunk is not done until its tests pass against the running app.

Read `BUGS.md` first. Read `CAPTURE-HELPER-SPEC.md` for Chunk 1 detail.

## The four chunks

```
Chunk 1 (capture) ──▶ Chunk 2 (projections) ──▶ Chunk 4 (migration)

Chunk 3 (queries + search) ──▶ independent, start now
```

| Chunk | What | Fixes | Depends on |
|---|---|---|---|
| 1. Capture + event store | Swift helper writes correct focus_events | Full-screen drops, tab time, permission degradation | Nothing |
| 2. Session + block projections | Derive sessions and blocks as replayable functions over focus_events | 45-min split guess, blocks collapsing heterogeneous activity, pipe-soup labels, B1/B9/B10/B11 | Chunk 1 |
| 3. Single-source queries + unified search | One canonical function per metric. AI search covers website_visits | B2 (AI refusal), B4 (three different values), B3 (impossible math) | Nothing (existing tables) |
| 4. Data migration | Relabel old timeline_blocks with new label function | Old pipe-soup labels, raw window titles in historical data | Chunk 2 |

Chunks 1 and 3 are parallel. **Start Chunk 3 now** because it delivers visible improvements against existing data while Chunk 1 builds the foundation.

---

## Chunk 3 — Single-source queries + unified search

### Problem 1: Same metric, different values (B4)

Three surfaces show different numbers for the same app on the same day:
- Apps left rail: `getAppSummariesForRange` in `src/main/db/queries.ts`
- Apps right-panel narrative: `getAppDetailPayload` in `src/main/services/workBlocks.ts` (recomputes from raw sessions)
- AI chat: AI tools recompute from `getSessionsForRange` or inline SQL in `src/main/services/aiTools.ts`

Each applies slightly different filters (min-duration cutoffs, canonical-app collapsing, live-session merge). The numbers diverge.

**Fix:** `getAppSummariesForRange` in `queries.ts` is the canonical source. All paths that produce per-app totals must read FROM it, not recompute. Specifically:

1. `getAppDetailPayload` in `workBlocks.ts` (~line 2399): its `totalSeconds` and `sessionCount` must come from the matching `getAppSummariesForRange` row for that app/range, not from re-aggregating raw sessions.
2. The AI tools `getDaySummary` and `getWeekSummary` in `aiTools.ts`: their per-app breakdowns must come from `getAppSummariesForRange`, not from separate inline queries.
3. The Apps narrative builder (wherever it gets its input for "X hours across Y sessions"): same source.

**Verification (B4):** Open the Apps view for Safari, today. Note the header numbers (hours, sessions). Read the narrative below. Ask the AI "how long was I in Safari today." All three must show the same hours and session count. If they differ by even one session, the fix is incomplete.

### Problem 2: AI search blind to website content (B2)

`searchSessions` in `queries.ts` queries only `app_sessions_fts` (app_name + window_title). The Coursera "Deep Neural Network" page titles live in `website_visits_fts` (url + page_title). The AI literally cannot see them.

`searchBrowser` exists at `queries.ts:709` and queries `website_visits_fts`. It is not wired into any AI tool.

**Fix:** In `execSearchSessions` in `aiTools.ts` (~line 629), after the strict and broadened search against `app_sessions_fts`, also search `website_visits_fts` via `searchBrowser` (already imported or importable from `queries.ts`). Merge results by time, deduplicate, and tag each hit with `kind: 'session' | 'page'` so the model can cite the source type. The existing `_instruction` and broadening logic applies to the merged result set.

The `searchBrowser` function needs to be exported from `queries.ts` if it isn't already. Import it in `aiTools.ts` alongside `searchSessions`.

**Verification (B2):** In the AI chat, ask: "What did I learn about machine learning this week?" The answer must cite specific Coursera page titles (e.g., "Deep Neural Network - Application", "Key Concepts on Deep Neural Networks", "Planar Data Classification with One Hidden Layer") with dates. If the AI says "I can't find" or only mentions browser app names without page content, the fix is incomplete.

### Problem 3: Mathematically impossible narrative (B3)

The Apps narrative for an app can claim "33 sessions in a 46-minute window" with "1h 37m total" — numbers that don't add up because the narrative builder reads different inputs than the header.

**Fix:** This is a consequence of Problem 1. Once the narrative builder reads from `getAppSummariesForRange` (the same source as the header), the numbers will agree. No separate fix needed. But verify explicitly.

**Verification (B3):** Open any app's detail panel. Check that every number in the narrative (total time, session count, time window) is arithmetically consistent with the header. The narrative's "X hours across Y sessions" must exactly match the header's "Xh Ym . Y sessions".

### Problem 4: Router short-circuits before tools run (B2 related)

`insightsQueryRouter.ts` (2699 lines) answers some entity/topic questions deterministically without calling `searchSessions`. When it has no match, it can produce a refusal-shaped string that never gives the tool-use path a chance to search `website_visits`.

**Fix:** When the router's deterministic path finds no entity match for a topic/learning question, it must fall through to the tool-use path instead of returning a deterministic "No X activity captured." Specifically: in `tryRouteEntityQuestion` and the no-match branches, return `null` (which signals "let the model try with tools") instead of returning a canned string.

Identify the lines that return refusal-shaped strings like "No tracked activity" or "No X activity captured in that range" (grep for these in `insightsQueryRouter.ts`). For topic/learning questions (not time-at-moment questions which the router handles well), these should return `null`.

**Verification:** Ask the AI "What was I doing around Perusall?" or "What did I study about neural networks?" If the answer cites specific page titles and times instead of "I can't find any sessions matching that," the fix works.

### Files to read before starting

1. `docs/BUGS.md` — B1-B12, especially B2, B3, B4. Read the "confirmed broken" section (after the 2026-05-13 update).
2. `src/main/db/queries.ts` — `getAppSummariesForRange` (the canonical source), `searchSessions`, `searchBrowser`.
3. `src/main/services/aiTools.ts` — `execSearchSessions`, `execGetDaySummary`, `execGetWeekSummary`, tool definitions.
4. `src/main/services/workBlocks.ts` — `getAppDetailPayload` (~line 2399).
5. `src/main/lib/insightsQueryRouter.ts` — no-match / fallthrough branches.
6. `docs/AI-PRODUCT-DIRECTION.md` — D4 (never refuse with "I don't know"). Any fix must respect this.

### What NOT to touch

- Do not change `tracking.ts`, `browserContext.ts`, or `browser.ts`. Capture is a separate chunk.
- Do not refactor `ai.ts` or `aiOrchestration.ts`. That's downstream.
- Do not touch block construction or labels. That's Chunk 2.
- Do not run the full behavioural harness without explicit authorization. Use the scenario filter: `npm run test:behaviour -- <scenario_id>`.
- One fix at a time. Verify each before starting the next.

### Fix order

1. **B4 first** (single source of truth). It's the smallest, most contained, and proves the canonical-source pattern.
2. **B2 search** (add website_visits to AI search). Wires in the missing data.
3. **B2 router** (fall through to tools on no-match). Lets the search fix actually reach the model.
4. **Verify B3** (narrative math). Should be fixed by B4. If not, trace the narrative builder's input.

---

## Chunk 1 — Capture + event store

Fully specced in `docs/CAPTURE-HELPER-SPEC.md`. Summary: Swift helper binary, event-driven foreground via NSWorkspace, 1s Apple Events tab polling, permission-gated, never-guess invariant, `focus_events` table.

## Chunk 2 — Session + block projections

Not yet specced in detail. Design principles:
- Sessions and blocks are pure, deterministic, replayable functions over `focus_events`.
- Segment blocks on real content boundaries (domain/artifact change, idle gap, category shift), not a fixed 45-minute timer.
- Labels are a versioned derived function. A relabel pass re-runs the function over existing blocks idempotently.
- Built after Chunk 1 lands real events to project over.

## Chunk 4 — Data migration

Not yet specced. Runs the Chunk 2 label function over all existing `timeline_blocks` rows. Any block whose label is pipe-soup, a raw window title, or a shell username gets relabeled. Idempotent and re-runnable.
