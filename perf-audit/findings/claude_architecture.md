# Daylens Architecture Review — claude

**Auditor:** claude · read-only · no app runs · no profiler traces

A list of what we are not doing right architecturally, with the reasoning on each — against coding standards, the documented behavior of the actual stack (**Electron ^34, better-sqlite3 ^12, React ^19, react-router-dom ^7, electron-rebuild ^3, Vite ^6**), and the project's own contracts in `CONTEXT.md`. Every item cites code I read this session. Ranked by leverage.

Hard data this review leans on:
- **18 source files exceed 1,000 lines.** Densest: `aiService.ts` 5,700 · `workBlocks.ts` 3,925 · `insightsQueryRouter.ts` 2,791 · `Insights.tsx` 2,626 · `queries.ts` 2,267 · `Timeline.tsx` 2,130 · `Settings.tsx` 1,892 · `DayWrapped.tsx` 1,884 · `migrations.ts` 1,822 · `tracking.ts` 1,781. (~65k LOC total in `src`.)
- **Zero** uses of `worker_threads` or Electron `utilityProcess` anywhere in `src/main`.

> Note: `architecture_review.md` / `composer_architecture.md` (composer) and `architectural_audit.md` already cover this area. This is my independent pass; where I land on the same point I say so, and I flag the few things I think those reviews underweight.

---

## A1. Everything heavy runs synchronously on the Electron **main** process — there is no worker
**Evidence:** `better-sqlite3` (synchronous by design) is the only DB access layer; no `worker_threads`/`utilityProcess`/`new Worker` exists in `src/main`. The projection pipeline (`workBlocks.ts`, 3.9k LOC), the AI tool loop (`insightsQueryRouter.ts` 2.8k, `aiTools.ts` 1.3k), attribution (`attribution.ts`), and chunk2 projections all execute inline inside `ipcMain.handle` callbacks (`db.handlers.ts`).
**Why it's wrong:** The Electron main process is single-threaded and is also the only process servicing IPC, window events, tray, and menu. better-sqlite3's own docs are explicit that it is synchronous and that long operations shouldn't sit on a thread you need responsive. One multi-hundred-ms query or a full-day rebuild blocks **the entire app** for its duration. The projections are described in `CONTEXT.md` as "pure and deterministic… no clock, no randomness, no network" — the textbook profile of a workload that belongs in a `utilityProcess`/`worker_thread` with its own connection. None exists.
**Does it matter:** **Yes, most of all.** Root multiplier under perf findings F1–F4. Tuning individual queries still leaves a model where any heavy op freezes the UI.

## A2. Read paths perform writes — violates the project's own stated invariant
**Evidence:** `CONTEXT.md`: *"Projections stay pure and deterministic. No clock, no randomness, no network inside them."* But `getDerivedDayTimelinePayload` (a GET path) calls `persistTimelineDay(...)` and `Date.now()` on **every** read (`projections.ts:122,131,145`), and the today path `buildTimelineBlocksForDay` persists on read (`workBlocks.ts:2840`).
**Why it's wrong:** Read/write separation is baseline: GETs should be idempotent and side-effect-free so they are cacheable and safe to move off-thread. Writing inside reads produces F2/F3 write-amplification, makes handlers impossible to memoize, and breaks a *documented* contract — worse than an undocumented smell, because the system trusts the invariant.
**Does it matter:** **High.** Contract correctness + the mechanism behind the worst perf findings.

## A3. No data-access layer — domain logic lives in IPC handlers and a 2,267-line query grab-bag
**Evidence:** `db.handlers.ts` (872 LOC) holds domain logic: `buildWorkSessionPayloads` (with its N+1), `mergeAppSummaryRows`, `applyAIInsightToTimelineBlock` (SQL + label policy). `queries.ts` is 2,267 lines of raw SQL interleaved with JS post-processing across unrelated entities (sessions, focus, AI threads, usage events, websites).
**Why it's wrong:** By `CONTEXT.md`'s own vocabulary the IPC seam should be a thin adapter over **deep** modules; here the seam carries business logic, so it can't be reused or unit-tested without Electron, and `queries.ts` is a low-cohesion dumping ground (poor locality). A repository per aggregate restores both.
**Does it matter:** **High** for maintainability and the project's stated AI-navigability goal.

## A4. God modules and god components
**Evidence:** 18 files >1,000 LOC. `aiService.ts` 5,700; `Insights.tsx` 2,626 with 20+ `useState`; `Settings.tsx` 1,892 ("28+ state slices → full-page re-render" per `features_matrix.md`); `workBlocks.ts` 3,925.
**Why it's wrong:** Cohesion/SRP. A 5.7k-line service has many reasons to change and is unsafe to edit; React 19 still re-renders the whole component on any state change, so a 2.6k-line component turns one keystroke into a full-subtree reconcile. Large files also resist tree-shaking and raise review/merge cost.
**Does it matter:** **High** for `aiService.ts`/`workBlocks.ts`/`Insights.tsx` (every change touches them); Medium for the rest.

## A5. Raw SQL with hand-written column mapping; planned ORM abandoned mid-migration
**Evidence:** `schema.ts:1` — *"Raw SQL schema — will be replaced by Drizzle in Phase 2a."* `drizzle-orm` is **not** in `package.json`. Every query hand-maps columns (`created_at AS createdAt`); `queries.ts` has 54 `.prepare()` sites.
**Why it's wrong:** No compile-time link between SQL column names and TS row types — a renamed column or mistyped alias fails silently at runtime on the affected shape only. "Phase 2a" debt that never landed is now load-bearing. Commit to the ORM or codegen types from the schema; the half-migrated state is the worst of both.
**Does it matter:** **Medium**, rising with schema churn.

## A6. Three overlapping schema mechanisms, all run on every launch
**Evidence:** `initDb()` runs `_db.exec(SCHEMA_SQL)` (full schema every boot) **and** `runMigrations()` **and** `ensureAIThreadSchema()` **and** `syncDerivedStateMetadata()`/`repairStoredIdentityColumns()`/`repairStoredAppIdentityObservations()` (`database.ts:31-49`).
**Why it's wrong:** No single source of truth. "Create" lives in `schema.ts`, "alter" in `migrations.ts` (1,822 LOC), "repair/backfill" in three more modules. New tables must be declared twice; schema state is ambiguous; and the repairs are *unconditional full-table rewrites* on every launch (perf F1). Migrations should be the sole schema authority, version-gated, run once.
**Does it matter:** **High** — causes F1 and ongoing correctness ambiguity.

## A7. `db.prepare()` re-invoked inside hot functions and loops instead of hoisted
**Evidence:** `persistTimelineDay` prepares `INSERT`/`DELETE`/member statements **inside** the per-block loop (`workBlocks.ts:2444-2536`); 54 prepares in `queries.ts`, 48 in `attributionResolvers.ts`, 31 in `workBlocks.ts`.
**Why it's wrong:** better-sqlite3 caches compiled statements by SQL text so the *parse* is amortized — but allocating the wrapper per call/iteration is avoidable, and the idiom signals statements aren't owned at a scope where they can be reasoned about. Canonical usage is "prepare once, run many."
**Does it matter:** **Medium** (overhead + smell, not a cliff).

## A8. Stored-row identity is a function of a source-code constant
**Evidence:** `workBlocks.ts:144` `const TIMELINE_HEURISTIC_VERSION = 'timeline-v7'`; `blockIdFor()` hashes the version into the block id; older-version days are reconstructed-on-revisit and re-persisted.
**Why it's wrong:** Coupling persisted identity to a code literal means any heuristic tweak (a) invalidates and forces a history-wide recompute (write-amplification on read) and (b) changes block IDs, silently orphaning anything referencing the old IDs unless every override is migrated. Versioning the *algorithm* is fine; making the *primary key* depend on it is fragile. **I think the other reviews underweight this** — it's the trigger that turns a one-line label tweak into a mass rebuild.
**Does it matter:** **Medium-High.**

## A9. Two divergent day-payload read paths that are supposed to be one
**Evidence:** `getTimelineDayPayload` (today/live) and `getDerivedDayTimelinePayload` (past) assemble the same shape via different routes with different caching/persist behavior (`projections.ts`); today never caches, derived always persists. `CONTEXT.md` claims "there is no second, un-coalesced block builder," yet two payload-assembly paths exist and already diverge.
**Why it's wrong:** Duplicated assembly drifts — the caching divergence (F2 vs F3) *is* that drift. One pipeline parameterized by a `finalized?` flag removes both the divergence and the doc/code contradiction.
**Does it matter:** **Medium.**

## A10. Renderer: no shared query cache; lazy routes remount and refetch; coarse invalidation
**Evidence:** `App.tsx` `React.lazy` per route; `useProjectionResource` refetches on mount; each view owns its IPC. The invalidation bus broadcasts a scope (`timeline`/`apps`/`insights`/`all`) with **no** date/app granularity (`useProjectionResource.ts:113-121`), so any matching write refetches *all* mounted resources in that scope. No react-query/SWR.
**Why it's wrong:** Tab switches re-pay full IPC + main-thread compute every time (no stale-while-revalidate, no cross-view dedup). Coarse invalidation means one category override or session flush refetches every mounted timeline/apps/insights resource. A shared client cache keyed by (scope, date) with granular invalidation is the standard fix.
**Does it matter:** **Medium-High** — makes navigation feel like a cold load and amplifies every write.

## A11. Renderer: pervasive inline `style={{…}}` objects defeat memoization; inconsistent styling
**Evidence:** `Timeline.tsx`, `Insights.tsx`, `DayWrapped.tsx` build inline style objects throughout (new literal each render); Tailwind classes and CSS variables are also used.
**Why it's wrong:** A fresh object reference every render breaks `React.memo`/prop equality on children, forcing re-renders down the tree — the classic React footgun, compounding A4's god components. It's also three styling systems with no boundary, hurting theming/consistency.
**Does it matter:** **Medium** (perf on long lists), **Low** (consistency).

## A12. Polling architecture — many uncoordinated timers — over an event-sourced data model
**Evidence:** 30s Timeline/Apps polls (`Timeline.tsx:1791`, `Apps.tsx:168`), 5s tracking poll, 15s `processMonitor`, 60s browser import + notifier, 60s sync heartbeat + 20s debounce.
**Why it's wrong:** Capture already writes discrete events — the system is event-sourced at the bottom but polled at the top. Each timer wakes the single main thread to redo usually-unchanged work; combined with write-on-read (A2), the 30s timeline poll re-derives and re-persists the whole day for nothing (F3). Push-on-change (the invalidation bus already exists) is what the data wants.
**Does it matter:** **Medium-High.**

## A13. Large IPC payloads via structured clone, no slim/paged mode
**Evidence:** `GET_TIMELINE_DAY` returns full `sessions` + `blocks` + `websites` + `segments` + `focusSessions`; `GET_ARTIFACT` returns full content; recap fetches ~45–60 days; week 7×, Day Wrapped 14× parallel `getTimelineDay`.
**Why it's wrong:** Every `ipcMain.handle` return is **structured-cloned** across the process boundary — large arrays serialize on the main side and deserialize on the renderer side, blocking both. No field projection or pagination, so the renderer pays for data it doesn't display (all raw sessions when it only needs blocks).
**Does it matter:** **Medium-High** for week/wrapped/recap.

## A14. Native-module ABI coupling is a packaging-reliability risk (and timely)
**Evidence:** `better-sqlite3 ^12` + `electron-rebuild ^3` against `electron ^34`.
**Why it's wrong:** better-sqlite3 is a native addon compiled against the exact Electron ABI. Version bumps require a rebuild, and ABI mismatches are a documented source of `"compiled against a different Node.js version" / "module did not self-register"` crashes in **packaged** builds specifically (they often pass in dev). This is live risk on the current `fix/linux-deb-packaging` branch — Linux native packaging is exactly where it bites.
**Does it matter:** **Medium** (release reliability), and relevant right now.

## A15. `sandbox: false` weakens the Electron security model
**Evidence:** `index.ts:521-526` — `webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false }`.
**Why it's wrong:** Electron's official security checklist recommends `sandbox: true` unless a hard requirement forces otherwise. With the sandbox off, the preload (and anything it imports) runs with full Node privileges, enlarging the attack surface if renderer content is ever compromised. `contextIsolation`/`nodeIntegration` are set correctly but don't substitute for the sandbox.
**Does it matter:** **Low-Medium.** Local-data app bounds the practical risk, but it's an undocumented deviation that should be justified in an ADR/comment or removed.

## A16. `uncaughtException` is caught and the process keeps running
**Evidence:** `index.ts:2-24` — `process.on('uncaughtException', …)` logs, reports analytics, shows a dialog, and **returns** (no `app.exit`).
**Why it's wrong:** Node's docs state that after an `uncaughtException` the process is in an undefined state and shouldn't resume normal operation. Continuing with an open SQLite handle and an active WAL risks silent data corruption. Report-then-relaunch (or exit) is the safe pattern; resuming is not.
**Does it matter:** **Medium** (integrity of the SQLite file — which is the whole product).

## A17. Read-time filtering/derivation in JS that belongs in SQL or at write time
**Evidence:** `getAppSummariesForRange` over-fetches with a 48h look-back (`fromMs - 172800000`, `queries.ts:541`), then in JS filters `isUxNoise`, resolves category, and calls `resolveCanonicalApp` per row; the noise filter is duplicated as a read-layer backstop *and* a write-layer filter (`queries.ts:36-43`).
**Why it's wrong:** Pulling extra rows into JS and doing per-row work the DB could do (or that could be precomputed at write time) is an O(rows) tax on every read that grows with history. Over-fetch + JS post-filter is a scalability cliff; the duplicated filter is a consistency hazard.
**Does it matter:** **Medium**, scaling with data volume.

## A18. Test seam exists but the default isn't isolated — AI tests hit live APIs
**Evidence:** `CONTEXT.md`/memory: *"Never run the billed AI commands without explicit human approval"*; tests are **not** auto-mocked (mock is opt-in); `test:behaviour`, `ai:bench`, `test:entity-prompts` are live API.
**Why it's wrong:** The provider seam/adapter the project describes (real client in prod, fake in tests) is what *should* make AI logic testable offline — but the **default** path is live, so the suite is slow, flaky, costly, and unsafe in a CI gate. The adapter should default to a fake; live runs should be the explicit opt-in, not the reverse.
**Does it matter:** **Medium** (dev velocity + the real-dollar cost in your AI-cost memory).

---

## Where we are structurally limited (a ceiling, not a bug)

- **One process, one synchronous DB connection (A1).** Until projections move to a worker, there is a hard ceiling on compute-without-jank regardless of query tuning. The codebase is already past where this is felt.
- **Code-version-coupled derived state (A8).** Heuristic iteration vs. data stability are in tension: every algorithm tweak risks a history-wide rebuild. This caps how freely the timeline heuristics can evolve post-launch.
- **No shared renderer cache (A10).** View independence was bought with refetch-on-everything; navigation can't get faster without a caching layer the architecture has no current home for.

## If you only change three things
1. **Move SQLite + projections + AI tool loops off the main process** (utilityProcess/worker_thread with its own connection). Unblocks A1, de-risks A2/A12, prerequisite for the rest to matter.
2. **Make reads pure** — persist only on write/edit/rollover, never inside a GET (A2); let migrations be the sole schema authority (A6, kills F1).
3. **Decompose the three god files** (`aiService.ts`, `workBlocks.ts`, `Insights.tsx`) behind a repository layer (A3/A4) — this is what makes every later fix safe.

---

*Read-only; no app run, no profiler. Reasoning combines code I read this session with documented behavior of better-sqlite3 (synchronous, ABI-bound), Electron (single-threaded main, structured-clone IPC, sandbox guidance), and React 19 (whole-component re-render, referential-equality memo). Perf finding IDs (F1–F11) reference `claude.md` in this directory.*
