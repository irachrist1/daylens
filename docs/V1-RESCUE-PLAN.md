# Daylens v1 Rescue Plan

**Status:** Plan, awaiting owner approval. No code in this doc — write the doc, then write the code.
**Date:** 2026-05-16.
**Author:** Synthesized from four parallel research agents (architecture, tests, docs/agent-org, capture/intent), grounded against the live DB at `~/Library/Application Support/DaylensWindows/daylens.sqlite` and the user's screenshots.

---

## 0. Honest accounting

I shipped three "fixes" this session. Two were technically correct against the bug as stated and tested green; one introduced a regression that crashed the AI tab in production. The user opened the app, none of it looked fixed, and they said so. They were right.

What actually happened, per layer:

1. **AI tab "Rendered more hooks than during the previous render."** I wrote `useRef(0)` inside `if (process.env.NODE_ENV === 'development') { ... }` in `AICompose.tsx`. That is a Rules of Hooks violation. Tests passed because there are zero React-component tests in the suite (Agent 2). Lint did not catch it because there is no `react-hooks/rules-of-hooks` rule configured (Agent 2). React StrictMode is enabled but does not catch hook-order violations. Already fixed in [AICompose.tsx](src/renderer/views/insights/AICompose.tsx) — but this is the canonical proof that the test+lint gates as configured cannot detect a renderer crash.

2. **Apps view: VS Code & Ghostty rows headlined with the porno video title.** My digest fix in `appActivityDigest.ts` correctly stopped *artifacts* from leaking across apps. It did NOT touch the path the symptom actually flows through: the **block label**. A query on the live DB shows blocks with `dominant_category = 'development'` and `label_current = 'Cutie Brunette … Pornhub.com'`, `label_source = 'artifact'`. The label is contaminated upstream — `preferredArtifactLabel` at `workBlocks.ts:1505-1513` picks the loudest artifact regardless of category — and my digest propagates that label to every app in `block.topApps` without filtering by who contributed to it (Agent 1).

3. **Tests passed, UI broke.** My `appActivityDigest.test.ts` used hand-crafted `WorkContextBlock` fixtures with clean ownership chains. Real DB rows from the legacy capture path have nulls in the ownership columns. The fixtures didn't reflect reality (Agent 2).

The lesson is structural, not just "be more careful." The verification loop ends at `npm run typecheck && tests pass && commit`; the user's reality starts at `npm start && open the app && use it`. Those two loops don't share a step. Until they do, I will keep shipping green-test red-UI fixes.

---

## 1. The two-layer bug behind the porno-title-on-VS-Code symptom

Trace, with file:line, from Agent 1's audit:

1. `tracking.ts` → captures Dia's foreground tab title `"Cutie ... Pornhub.com"` into `app_sessions.window_title`.
2. `browser.ts` → reads Dia history → `website_visits` row for `pornhub.com/view_video.php?viewkey=…`, `canonical_browser_id = 'dia'`. **Both fields present.**
3. `workBlocks.ts:1006-1092 buildPageCandidates` → derives a `PageRef` for that visit, with `displayTitle = "Cutie ..."` and `canonicalBrowserId = 'dia'`.
4. `workBlocks.ts:1220-1342 buildBlockFromCandidate` → constructs a block whose `topApps = [VS Code (foreground 21m), Codex (4m), Dia (background 5m)]` and whose `topArtifacts` includes the porno page (from Dia background activity).
5. `workBlocks.ts:1541-1590 finalizedLabelForBlock` → priority cascade: override → **artifact** → workflow → AI → rule → fallback. Calls `preferredArtifactLabel(block)`.
6. `workBlocks.ts:1505-1513 preferredArtifactLabel` → returns `block.documentRefs[0]?.displayTitle` first, else `block.pageRefs[0]?.displayTitle`. **No category check, no app-ownership check, no content filter.** Picks the porno page title.
7. Block persisted with `label_current = "Cutie ..."`, `label_source = 'artifact'`, `dominant_category = 'development'`.
8. `appActivityDigest.ts:81-95` → for every app in `block.topApps` (VS Code, Codex, Dia), the block label gets attached unconditionally as `topBlock.label`. **My recent patch fixed `topArtifacts` ownership but left `block.label` propagation untouched** — I documented this as intentional ("labels describe the whole block") and that reasoning is wrong for artifact-sourced labels.
9. `Apps.tsx:432` renders `digest.topBlockLabel || digest.topArtifactTitle` as the row headline. VS Code and Codex rows show "Cutie ..." in the DEVELOPMENT category.

Two distinct fixes:

- **Patch (small, immediate):** in `appActivityDigest.ts`, when `block.label.source === 'artifact'`, only propagate the label to apps that own the source artifact (same ownership rule as the artifact-attribution fix already in place).
- **Restructure (necessary, not optional):** rewrite `preferredArtifactLabel` to take `dominantCategory` and `topApps` as inputs. A `dominant_category = 'development'` block must prefer development-typed artifacts (window titles → `documentRefs`) over `pageRefs` (browser pages). If only browser artifacts exist, fall back to the rule-based label (`"Development"`) instead of forcing a wrong artifact through.

Both changes are needed. The patch closes the symptom on existing blocks once digest re-runs. The restructure closes it for new blocks at the source.

---

## 2. What to rewrite vs patch vs leave alone

From Agent 1, prioritized:

### Patch-fixable (close the symptom)

| What | File:line | Effort |
|---|---|---|
| Block label propagation in digest | `src/main/services/appActivityDigest.ts:81-95` | 30 min |
| Site allow/deny list at L3 read time | `src/main/db/queries.ts` (new gate) + `src/main/services/appActivityDigest.ts` | 4–6 hr |
| Render-side sanitize on `block.label.narrative` | `src/renderer/views/Timeline.tsx` (right-panel narrative) | 30 min |
| Consolidate duplicated `GENERIC_LABELS` constant | `src/main/services/workBlocks.ts:174-192` + `src/shared/blockLabel.ts:3-20` | 15 min |
| `react-hooks/rules-of-hooks` ESLint rule + CI gate | `eslint.config.mjs` (create) + CI step | 1 hr |

### Restructure (the abstraction is wrong)

| What | File | Effort |
|---|---|---|
| `preferredArtifactLabel` takes category + apps; biases by dominant category; rejects loud-but-wrong artifacts | `src/main/services/workBlocks.ts:1505-1513` | 4–6 hr |
| Block label propagation in digest respects label provenance (artifact-sourced → owner-only; rule/AI-sourced → all apps) | `src/main/services/appActivityDigest.ts` | 2–3 hr |
| Per-app title extractors for VS Code/Cursor/Ghostty/Slack (extends existing `windowTitleFilenames.ts` model) | new `src/main/lib/titleExtractors/{vscode,cursor,ghostty,slack}.ts` | 1–2 days |
| Label decision audit trail — store `label_candidates` + `label_reason` so we can debug bad labels in production | schema migration + `workBlocks.ts` | 1 day |

### Rewrite candidate (post-v1)

| What | Why | Effort |
|---|---|---|
| `aiService.ts` (5,370 lines) → finish the per-job extraction already started under `src/main/jobs/` | Today every change has to load the whole monolith into a model's context; per-job modules can be reasoned about independently | 3–5 days, post-v1 |
| Per-event window-title aggregation: `activity_events.window_title` (already captured per 5s) → `session_window_title_history` so a 30-min Cursor session shows all 10 files instead of one | Closes ~50% of the "what was the user actually doing" gap with no new capture | 1–2 days |

### Leave alone

- The streaming store / `<StreamingMessage />` extraction. It works; the typing flicker fix held; the bug there was the conditional `useRef`, not the architecture.
- `sanitizeForModel` / `sanitizeForRender`. The corpus is sound; the integration test passes against real tool output.
- `appActivityDigest`'s artifact-ownership filter (the part of the previous fix that DID work).

---

## 3. Tests: delete the stupid ones, write ones that map to real failures

From Agent 2, ordered:

### Delete
1. `tests/aiSanitize.test.ts` — pure-regex tautology tests. The integration test (`aiSanitizeIntegration.test.ts`) covers the only thing that matters: real tool output through the executor. Keep that one; delete the in-file regex round-trip tests, OR move the corpus to `tests/fixtures/sanitize-corpus.json` so it's data, not test prose.
2. Any test asserting TS-enum length / cardinality (e.g. "anthropic and openai tool arrays have the same length"). The compiler enforces this; the test is duplicate.
3. Inline fixture constants that should live in `tests/fixtures/` so multiple tests share them.

### Add (in priority of "would have prevented this session's bugs")

1. **`tests/aiCompose.hooks.test.ts`** — instantiate `AICompose` via React Testing Library, re-render with varied props, assert no React error boundary fires and no `Rendered more hooks` warning is logged. This single test would have caught the AI tab crash. Requires adding `@testing-library/react` + `jsdom` to devDeps. ~30 lines.

2. **`tests/smoke.electron.test.ts`** — Playwright Electron test. Boot the real app against a seeded DB; click each of Timeline / Apps / AI tabs; assert no React error boundary fires and no console error contains `Error:` or `Warning:`. ~80 lines + Playwright config. Slow (~10s), gated behind `npm run test:smoke`. **Single highest-value test in the proposed suite** — would have caught the AI tab crash AND would catch any future render-time regression.

3. **`tests/appActivityDigest.live-shape.test.ts`** — load a snapshot of the user's anonymized live DB (committed as `tests/fixtures/live-snapshot.sql.gz`), run `getTimelineDayProjection` for a known date, run `computeAppActivityDigest`, assert: no non-browser app row has a `topBlockLabel` whose source is a browser-only page artifact. This would have caught the porno-title-on-VS-Code bug.

4. **`tests/blockLabel.contract.test.ts`** — for each combination of `(dominant_category, top_artifact_type)`, assert the chosen label is "category-coherent" (development blocks prefer file-shaped artifacts, browsing blocks prefer page-shaped, etc.). Drives the `preferredArtifactLabel` rewrite.

5. **`tests/integration.real-db.test.ts`** — single end-to-end test: seed DB with realistic legacy nulls (no canonicalAppId, no canonicalBrowserId, raw window titles with URLs), run the full Apps view IPC chain, assert headlines are coherent.

### Adopt
- ESLint `react-hooks/rules-of-hooks: error` and `react-hooks/exhaustive-deps: warn`. Wire into CI.
- `tests/fixtures/live-snapshot.sql.gz` — a one-time export from the live DB, with sensitive titles redacted (deterministic transform). Re-export quarterly.
- A `npm run preflight` script: `typecheck && test && test:smoke`. Renderer changes can't ship without smoke passing.

### Honest constraint
Smoke tests cost ~10s and require an X server / display in CI. Acceptable cost; the alternative is more sessions like this one.

---

## 4. Capture & intent — what "knowing what the user was doing" actually requires

From Agent 4, ordered by ROI:

### What's true today (cite, not summarize)
- One `window_title` per `app_sessions` row. A 30-minute Cursor session that touched 10 files retains one title. The richer per-event titles ARE captured into `activity_events.window_title` but session-level readers don't consume them ([V1-PHASE-0-READ.md §1a](docs/V1-PHASE-0-READ.md)).
- Browser tab visits land in `website_visits` with `canonical_browser_id`, `browser_bundle_id`, `url`, `page_title`. This is the richest L1 signal we have.
- iMessage capture path exists, gated on Full Disk Access, off by default.
- No screenshots, no DOM extraction, no shell hooks, no terminal cwd capture.

### Roadmap (ordered, opinionated)

1. **Site allow/deny list at L3 read.** New table `domain_classification (domain TEXT PRIMARY KEY, attention_class TEXT, hidden INTEGER)`. Three classes: `tracked`, `background_noise`, `hidden`. `hidden` domains are dropped from `website_visits` reads in the digest, the Timeline narrative, and the AI tool output. Default seed list bundles obvious adult/social/streaming. Settings UI: domain → toggle. **This is what closes the porno-title problem at the *user-control* layer, after the architectural fix at §2 closes it at the data layer.** Effort: 6–10 hr.

2. **Per-app title extractors for the top 4 apps** (VS Code/Cursor, Ghostty/Warp, Slack desktop, Notion desktop). Extends the model already in [src/main/lib/windowTitleFilenames.ts](src/main/lib/windowTitleFilenames.ts). Outputs structured `{ project, file, channel, document }` fields. Stored alongside the raw title. Effort: 1–2 days. **Closes ~70% of "VS Code was open but I have no idea what for."**

3. **Per-event title history aggregation** — `activity_events.window_title` → new `session_title_timeline` table or computed-column on the session reader. Lets a 30-min block show "touched router.ts, schema.ts, queries.ts" instead of "router.ts." Effort: 1–2 days. **Highest single ROI on signal richness.** Co-ships with #2.

4. **Terminal cwd capture for Ghostty/Warp/iTerm** — title parsing first (regex on `cwd@hostname` patterns); shell hook integration second (opt-in zsh/fish hook). Effort: 4–6 hr (parsing), 12+ hr (hook). **Promote terminal sessions from "Ghostty was open" to "worked in /Dev-Personal/daylens."**

5. **Block intent layer (deterministic, with AI polish)** — `inferIntentFromEvidence(block) → { verb, object, context, confidence }`. Deterministic templates for the common cases (development → "edit `<file>` in `<project>`"; browsing → "research `<top-domain>`"; communication → "messaged in `<channel>`"). AI polishes the deterministic version asynchronously into natural prose. The deterministic version is always the answer if AI is slow. Effort: 1–2 days. Spec already exists at [V1-PHASE-5-APPS §5a](docs/V1-PHASE-5-APPS.md).

6. **Browser DOM extraction (post-v1).** Browser extension with accessibility-tree read on each foreground tab. Catches Slack web channel routes, Notion page UUIDs, Linear issue IDs that don't show in window history. Requires separate distribution; opt-in. Roadmap, not v1.

7. **Visual capture / VLM (post-v1).** Screenshot every N seconds + on-device VLM inference. High privacy/UX cost. Not v1; flag for v1.x consideration only after the cheaper alternatives above are exhausted.

### What this *doesn't* require
- A Rust rewrite. Performance pain is concentrated in `getAppActivityDigest` walking 30 days of `getTimelineDayProjection` per Apps tab open ([V1-PHASE-5-APPS §10a](docs/V1-PHASE-5-APPS.md)). Fix is precompute + cache invalidation, not a language port. See §6 below.

---

## 5. Doc & agent organization

From Agent 3:

### The actual problem
Docs are prose; code is the source of truth; the two drift. Agents read prose, write code, ship green tests, miss the live UI bug. The docs *describe a system that doesn't entirely exist* (e.g. AGENTS.md says "DB is the source of truth" but the renderer re-derives from `app_sessions` on every read in 12 files).

### Reorg, three concrete moves

1. **Add `docs/VERIFICATION.md`** — the missing protocol between agent and user.
   ```
   Before reporting a fix as shipped:
   1. npm run preflight (typecheck + tests + smoke)
   2. npm start, open the app, exercise the affected view
   3. For digest/labeling fixes: query the live DB and confirm a polluted row's
      label changes after re-derivation
   4. Commit only after step 3 passes
   ```
   This codifies the loop the user actually runs and forces the agent to share it.

2. **Add `docs/ARCHITECTURE.md`** — one page. Five layers (Capture → Clean → Structure → Read → Render). Per layer: which files own it, what the contract is, what reading/writing pattern is allowed. Specifically: "Layer 3 readers are thin SELECTs in `src/main/projections/readers.ts`. Any `SELECT FROM app_sessions` outside of `tracking.ts` is suspect — it's a Layer 1 read in a Layer 3 path." This is the doc that prevents the next "85 raw SELECTs scattered across 12 files" finding (Agent 3 §3).

3. **Per-subdirectory `AGENTS.md`** — short, contract-only:
   - `src/main/services/AGENTS.md` — readers vs writers; which side this dir owns.
   - `src/main/jobs/AGENTS.md` — every job registers with `aiOrchestration.ts`; system prompt contract; tool surface contract; why `chatAnswer.ts` is a one-line re-export today.
   - `src/renderer/views/AGENTS.md` — pure read; never invokes capture or writes; goes through preload IPC; lists which projection it depends on.

### Delete / mark stale
- `docs/PRODUCT-SPEC.md` §"Work Block Heuristics" lines 136-149 describes merging behavior that doesn't exist in code. Either implement (out of v1 scope) or strike the section with a `// not implemented` marker.
- Empty/zombie tables in schema (`daily_entity_rollups`, `idle_periods`, `raw_window_sessions`) — comment in the migration: `-- DEPRECATED: see docs/V1-PHASE-2-CLEAN.md §3`. An agent reading the schema today thinks they're load-bearing.

### What I will NOT propose
- A renaming pass on the codebase. Renames break agent context across sessions.
- A new top-level CLAUDE.md. The existing `~/.claude/CLAUDE.md` and `docs/CLAUDE.md` are sufficient if `VERIFICATION.md` lands.
- Replacing `MEMORY.md` with anything fancier.

---

## 6. Performance — "rewrite in Rust" question

Agent 1 found the actual bottleneck: `getAppActivityDigest(days)` walks every day in the range, calling `getTimelineDayProjection` per day. For `days=30` that's 30 full timeline-day projections, each re-derives blocks/artifacts/page-refs from raw rows. Apps tab open at 30d range = ~30 × O(blocks) × O(artifacts) work. Per Apps tab visit. Not cached.

Three orders of fix, in order:

1. **Precompute the digest at timeline-rollup time.** `daily_rollups` table already exists. Add a per-app digest field per day. Apps tab reads the rollup and merges across the period. **Removes the dominant cost.** Effort: 1 day.

2. **Cache `getAppDetailPayload` keyed on `(canonicalAppId, rangeKey)`** with invalidation on the `apps` projection scope. The function is already pure in inputs. **Removes the per-click cost.** Effort: 4 hr.

3. **`getWebsiteVisitsForRange` per-block-then-cache** — Agent 1 spotted that block construction calls this per block, repeatedly, for the same day. Day-level cache shared across blocks. Effort: 2 hr.

Together, those three close the perceived "slow app" complaint for the Apps view. **No Rust required.** If after all three the app is still slow, profile and we revisit — but reach for profiling, not a language port.

The honest case for Rust would be: native macOS tracking (`@paymoapp/active-window` is Node + N-API and forks on each poll on Linux per V1-PHASE-0-READ §Power/idle). That's a real perf concern but it's L1 capture, not the L3 read path the user is complaining about. Defer.

---

## 7. Sequenced execution plan

Numbered, ordered by "what closes the most user-visible pain per hour spent." Each item is small enough to be a single PR.

### Phase A — stop the bleeding (immediate; ~1 day total)

1. **Patch the digest's block-label propagation** to respect label provenance (`label_source === 'artifact'` → owner-only). Closes the porno-title symptom on the Apps tab for *new* derivations. (~1 hr.)
2. **Add ESLint `react-hooks/rules-of-hooks` rule** + wire to CI. Prevents the next AI-tab-crash class of bug. (~1 hr.)
3. **Force-invalidate the `apps` and `timeline` projection scopes once** so the porno-titled blocks re-derive with the patched labeler. (~30 min.)
4. **Sanitize `block.label.narrative` at render time** in Timeline detail panel. Closes the OAuth-URL-in-narrative leak for already-persisted narratives. (~30 min.)

### Phase B — restructure the labeler (1–2 days)

5. **Rewrite `preferredArtifactLabel` to take `dominantCategory` + `topApps`.** Tested with the new `blockLabel.contract.test.ts` (§3). After: development blocks never label as a browser page; browsing blocks never label as a code file; mixed blocks fall back to the rule label.
6. **Add label-decision audit trail** — store `label_candidates_json` + `label_reason` on `timeline_blocks`. Every label gets a debuggable trace in production.
7. **Force-invalidate again** after #5 lands.

### Phase C — site allow/deny list (~1 day)

8. **Add `domain_classification` table** (migration) with three states (`tracked`, `background_noise`, `hidden`).
9. **Filter `website_visits` reads** in digest, Timeline, AI tools by `attention_class`. `hidden` domains are dropped from rendered output and from AI tool results.
10. **Settings UI** — list domains by total time, toggle each between the three states. Seeds from a bundled list (adult, gambling, common social/streaming).

### Phase D — testing protocol (~1 day, parallel with B/C)

11. **`tests/smoke.electron.test.ts`** with Playwright Electron — the single test that would have caught the AI hooks crash.
12. **`tests/aiCompose.hooks.test.ts`** — React Testing Library + jsdom for hook-order regressions.
13. **`tests/fixtures/live-snapshot.sql.gz`** — one-time anonymized export from the live DB.
14. **`tests/integration.real-db.test.ts`** — runs the digest + Apps IPC against the live snapshot, asserts no porno-style cross-contamination.
15. **Delete the tautological pure-regex tests** from `aiSanitize.test.ts`; keep the integration version.

### Phase E — capture richness (1–2 weeks, post-rescue)

16. **Per-app title extractors** for VS Code/Cursor, Ghostty/Warp, Slack desktop, Notion desktop. Outputs structured fields.
17. **Per-event title history** — `session_window_title_history` table; readers consume it; UI shows "touched X, Y, Z" instead of one file.
18. **Deterministic intent layer** per V1-PHASE-5-APPS §5a, with AI polish as background enrichment.

### Phase F — perf (parallel; 2–3 days)

19. **Precompute Apps digest** into `daily_rollups`.
20. **Cache `getAppDetailPayload`** with projection-scope invalidation.
21. **Day-level cache** for `getWebsiteVisitsForRange`.

### Phase G — docs (~half-day)

22. **`docs/VERIFICATION.md`** — the missing protocol.
23. **`docs/ARCHITECTURE.md`** — one page, five layers.
24. **Per-subdir `AGENTS.md`** — services, jobs, views.
25. **Delete or mark `// not implemented`** the stale spec sections.

### Out of v1 (roadmap, named explicitly so we don't re-litigate)

- Browser DOM extraction extension.
- Visual capture + on-device VLM.
- `aiService.ts` monolith decomposition (in progress per `src/main/jobs/`; finish post-v1).
- Rust port of anything.

---

## 8. Decisions I need from you before starting

Numbered, each with a stated lean.

1. **Scope of Phase A vs Phase B before re-shipping.** Lean: ship A immediately (1 day), then B as the next cut. Don't bundle. Smaller PRs, faster verification turn.
2. **Site allow/deny list seed list.** Lean: bundle a default list of obvious adult/gambling/streaming domains, but require user opt-in to enable filtering on first launch. No silent suppression of user data.
3. **Smoke test in CI.** Lean: required for renderer changes. Adds ~10s to CI; eliminates the entire class of "passes tests, crashes UI" bug.
4. **`label_candidates_json` trail — keep forever or 7-day TTL?** Lean: 7-day TTL. Debuggable in production; doesn't bloat DB.
5. **Per-app title extractors — order.** Lean: VS Code, Cursor, Ghostty, Slack first (per Agent 4's coverage estimate). Notion second. Anything else by request.
6. **Per-event title history.** Lean: scope into Phase E, not Phase A. Real ROI but requires schema change + read-path migration. Don't squeeze into the rescue.
7. **Doc reorg (Phase G) — before or after Phase A–C?** Lean: after. Closing the live UI bugs is what the user is paying for; the doc reorg is what makes the *next* agent session cheaper.
8. **`aiSanitize.test.ts` — delete the pure tests today, or move corpus to fixtures first?** Lean: move corpus to a fixture file, then delete the in-file regex tests. ~20 min of work; preserves the test data.
9. **Live-DB snapshot — anonymization scheme?** Lean: deterministic hash of titles, URLs, and emails (so cross-references survive); domains kept verbatim (they're not user-secret); never check in raw page titles. I'll write the export script as part of Phase D.
10. **"Rewrite in Rust" question.** Lean: no. Reach for profiling and the perf wins in §6/Phase F first. Re-open if Phase F doesn't move the needle.

---

## 9. What I will NOT do without explicit approval

- Implement any of §7 before you give the go-ahead on the decisions in §8.
- Touch the streaming store / `<StreamingMessage />` extraction (it works).
- Re-run the behavioural harness (it costs real money per `docs/CLAUDE.md`).
- Push commits to `origin/main` (still 2 commits ahead from this session — let's land the rescue plan PR first, then push the lot together).
- Promise "this is fixed" without going through `docs/VERIFICATION.md`'s steps.
