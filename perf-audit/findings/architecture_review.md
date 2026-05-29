# Daylens Architecture Review — composer

**Auditor:** composer · read-only · no app runs · no profiler traces

Research-heavy audit of what is structurally wrong, what could be done better, and why — against coding standards, Electron/React/SQLite best practices, known technology limitations, and the project’s own contracts in `docs/AGENTS.md` and `docs/adr/001-focus-events-contract.md`.

This is not a performance doc (see `composer.md`); it is about **shape, boundaries, and maintainability**. All findings below are tagged **[composer]**.

---

## How to read severity [composer]

| Tag | Meaning |
|-----|---------|
| **Critical** | Violates stated product contract, security guidance, or will block scale/maintainability soon |
| **High** | Clear anti-pattern with evidence; fix pays off across many features |
| **Medium** | Real issue but localized, or tradeoff was intentional |
| **Low** | Hygiene, consistency, or future-proofing |

---

## 1. Process & layer boundaries (Electron) [composer]

### 1.1 Main process imports renderer code
**[composer] · Severity: Critical**

**What:** `src/main/services/snapshotExporter.ts` imports `buildRecapSummaries` / `recapDateWindow` from `src/renderer/lib/recap.ts`. `src/main/lib/wrappedNarrative.ts` imports from `src/renderer/lib/wrappedFacts.ts`.

**Why it’s wrong:** Electron’s security and build model assumes **main ↔ preload ↔ renderer** are one-way (renderer never touches Node/DB; main never depends on UI bundle). Main importing renderer paths:
- Couples export/sync logic to React-adjacent folder layout
- Risks pulling DOM/browser assumptions into main at build time
- Makes it impossible to split renderer bundle without breaking sync
- Violates the mental model in `docs/AGENTS.md`: “database is source of truth,” logic should live in `shared/` or `main/lib/`

**Better:** Move `recap.ts` and `wrappedFacts.ts` to `src/shared/` or `src/main/lib/`. Renderer re-exports or imports from shared. One implementation for export, wrapped narrative, and Insights UI.

---

### 1.2 All heavy work on a single main-thread event loop
**[composer] · Severity: Critical**

**What:** No `worker_threads`, utility process, or background DB connection anywhere in `src/`. `better-sqlite3` sync API, timeline projection, attribution, AI orchestration, browser DB copies, and `execFileSync`/`execSync` all run on main.

**Why it’s wrong:** Electron documents the main process as responsible for **window lifecycle, native menus, and IPC**. Blocking main > ~16ms causes jank (window drag, tray, notifications). `better-sqlite3` is **intentionally synchronous** — community guidance is “fine on a worker thread, dangerous on UI thread.” Node’s own docs warn sync I/O on the event loop stalls timers (your 5s tracking poll included).

**Platform limit:** You cannot move `BrowserWindow` or `@paymoapp/active-window` to a worker. Correct split: **capture + IPC on main; projection/SQL analytics on worker or utility process** with message-passing.

**Better:** Utility process (Electron 28+) or dedicated worker for: timeline day build, recap aggregation, attribution normalize, FTS maintenance, sync snapshot build.

---

### 1.3 Sandbox explicitly disabled
**[composer] · Severity: High**

**What:** `src/main/index.ts` sets `sandbox: false` in `webPreferences` and appends `no-sandbox` / `disable-setuid-sandbox` CLI switches (lines ~121–122, ~525).

**Why it’s wrong:** Electron security checklist recommends **sandbox + contextIsolation + no nodeIntegration**. You have contextIsolation (good), but disabling sandbox increases blast radius if renderer is compromised (XSS, compromised dependency). Common in apps that need preload Node access — but should be **documented ADR + minimized preload surface**.

**Known Electron issue:** Many native modules and file pickers push teams toward `sandbox: false`; it is a **conscious tradeoff**, not best practice.

**Better:** ADR documenting why; shrink preload API; consider `utilityProcess` for MCP instead of full second Electron with sandbox off everywhere.

---

### 1.4 Preload imports main types; renderer imports preload types
**[composer] · Severity: Medium**

**What:** `preload/index.ts` imports `McpServerConfig` from `../main/services/mcpServer`. Renderer imports `DaylensAPI` from `../../preload/index` (and `TitleBar` calls `window.daylens` directly).

**Why it’s wrong:** Type coupling across layers. Preload should depend only on **`@shared` contracts**. Renderer should depend on **`lib/ipc.ts` facade**, not preload module path (preload is a build artifact).

**Better:** Shared types package for IPC DTOs; generated or hand-maintained `DaylensAPI` interface in `@shared/ipc.ts`.

---

## 2. God modules & module boundaries [composer]

### 2.1 `aiService.ts` (~5,700 lines)
**[composer] · Severity: Critical**

**What:** Single file implements chat, streaming, tools, summaries, block insight, week review, CLI detection, thread CRUD, wrapped narratives, etc. `src/main/jobs/*.ts` mostly re-export from it (`blockInsight.ts` is one line).

**Why it’s wrong:** Violates SRP and every “max file length” guideline (~300–500 LOC). Changes to chat streaming risk breaking block labeling; code review is impractical; test targeting is hard. The `jobs/` folder **suggests** separation but doesn’t deliver it.

**Better:** Split by domain: `chat/`, `summaries/`, `blockLabeling/`, `threads/`, `cli/` — each with own tests. Keep `services/ai.ts` as thin facade.

---

### 2.2 `workBlocks.ts` (~3,925 lines, ~100 functions)
**[composer] · Severity: Critical**

**What:** Timeline heuristics, persistence, label finalization, payload assembly, block detail lookup, recap helpers, workflow refs — hub imported by projections, IPC, AI tools, export, notifier.

**Why it’s wrong:** `docs/AGENTS.md` correctly treats this as core product surface — which is **why** it must be splittable: `segmentation/`, `labeling/`, `persistence/`, `payload/` modules with explicit contracts. One file change can silently alter “proof surface” behavior across Timeline, Apps, AI, sync.

**Better:** Extract stable interfaces first (`TimelineDayBuilder`, `BlockStore`); keep heuristic version in one place; unit-test segmentation without DB.

---

### 2.3 `insightsQueryRouter.ts` (~2,791 lines)
**[composer] · Severity: High**

**What:** Deterministic routing before LLM; parallel to AI tools and chat.

**Why it’s wrong:** Router logic should be **data-driven** (table of intents → handlers) or split by query class. Monolith makes it hard to add intents without merge conflicts.

**Better:** `router/handlers/*.ts` + registry; golden tests per intent (you already have `routerHardPromptBenchmark.ts` — good pattern, extend it).

---

### 2.4 Renderer god views (Insights 2,626 / Timeline 2,130 / Settings 1,892 / DayWrapped 1,884 lines)
**[composer] · Severity: High**

**What:** UI + IPC + domain helpers + markdown + recap in single files. `Settings.tsx` has ~28 `useState` hooks.

**Why it’s wrong:** React best practice: components that re-render together live together; **unrelated concerns should not share one fiber tree**. Any keystroke in Settings AI section re-renders sync/clients/work-memory sections. Electron renderer is not free — large trees block input.

**Known React issue:** StrictMode double-mount (`main.tsx`) amplifies duplicate effects in dev — Settings fires 8+ IPC calls twice.

**Better:** Feature folders (`settings/ai/`, `settings/sync/`), colocated hooks, `React.memo` on heavy subtrees. Match the **good** pattern already used for `AICompose` + `streamingStore`.

---

### 2.5 `db.handlers.ts` — 52 handlers in one registrar
**[composer] · Severity: Medium**

**What:** Timeline, apps, attribution, tracking diagnostics, icons, work memory, AI spend — one `registerDbHandlers()`.

**Why it’s wrong:** IPC layer should mirror domain modules for discoverability and handler-level middleware (logging, timing, auth). Adding handler #53 increases collision risk.

**Better:** `ipc/timeline.handlers.ts`, `ipc/apps.handlers.ts`, etc.; shared `registerAllHandlers()` in index.

---

## 3. Data architecture & SQLite [composer]

### 3.1 Sync SQLite on main thread for all reads and writes
**[composer] · Severity: Critical**

**What:** `getDb()` singleton; every IPC handler calls `prepare().all/run` synchronously.

**Why it’s wrong:** `better-sqlite3` **blocks the event loop** for query duration. WAL helps concurrent readers but **one writer at a time**; long `transaction()` in `persistTimelineDay` or attribution blocks everything else.

**Known sqlite/better-sqlite3 issues:**
- `SQLITE_BUSY` without `busy_timeout` → throws or hangs (main DB has no `busy_timeout`; MCP server package sets it — inconsistency)
- Long migrations on startup block first window
- FTS `rebuild` in migration v21 can freeze minutes on large DBs

**Better:** `pragma busy_timeout = 5000`; short transactions; move read-heavy aggregation off hot path; consider `better-sqlite3-multiple-ciphers` / readonly connection for analytics if staying in-process.

---

### 3.2 Triple schema path (SCHEMA_SQL + migrations + boot repair)
**[composer] · Severity: High**

**What:** Every launch: `exec(SCHEMA_SQL)` (~704 lines), `runMigrations()`, `ensureAIThreadSchema()`, `syncDerivedStateMetadata()`, `repairStoredIdentityColumns()`, `repairStoredAppIdentityObservations()`.

**Why it’s wrong:** Comment says migrations are “additive-only” but v14 **drops tables**. Boot repairs re-scan entire tables unconditionally — schema truth is split across three mechanisms. Hard to answer “what version is this DB?”

**Better:** Migrations only for drift; repairs as **versioned one-shot migrations**; skip full SCHEMA_SQL when `schema_version` current; ADR for destructive migrations.

---

### 3.3 Read handlers that write (GET mutates DB)
**[composer] · Severity: High**

**What:** `getDerivedDayTimelinePayload` calls `persistTimelineDay` during read (`projections.ts`). Today path always rebuilds + persists in `buildTimelineBlocksForDay`.

**Why it’s wrong:** Violates **CQRS** intuition and HTTP/IPC semantics — “get timeline” should be idempotent and side-effect free. Causes surprise invalidation, lock contention, and makes caching impossible.

**Better:** Separate `materializeTimelineDay(date)` job; GET returns cached/projection only.

---

### 3.4 Dual settings stores (electron-store + SQLite)
**[composer] · Severity: Medium**

**What:** User preferences in `electron-store` (`settings.ts`); activity in SQLite. API keys in `keytar`/secure store.

**Why it’s OK but fragile:** Common Electron pattern. Risk: **settings that affect DB behavior** (category overrides) live in SQLite while **AI provider** lives in JSON — backup/restore must handle both (`recoverFromUpdateIfNeeded` copies userData — good, but easy to drift).

**Better:** Document backup contract; consider mirroring critical settings into SQLite for single backup file story.

---

### 3.5 Raw SQL string layer vs query module sprawl
**[composer] · Severity: Medium**

**What:** `queries.ts` (2,267 lines) + inline SQL in `workBlocks.ts`, `attribution.ts`, handlers, `chunk2.ts`.

**Why it’s wrong:** No query planner centralization; N+1 patterns repeated; hard to audit indexes. Drizzle/ Kysely mentioned in schema comment (“will be replaced in Phase 2a”) — never happened.

**Better:** Either commit to lightweight query builder for hot paths or enforce “all SQL in `db/queries/`” rule with code review checklist.

---

### 3.6 Schema tables without product (file_activity, entity_suggestions)
**[composer] · Severity: Medium**

**What:** Tables + indexes migrated; no writers or UI.

**Why it’s wrong:** Dead schema increases migration time, confuses agents/humans (“is this shipped?”), and `workMemory`/`attribution` already branch on `tableExists`.

**Better:** Ship capture or remove from SCHEMA until ready; feature flags at migration level.

---

## 4. IPC & API design [composer]

### 4.1 Fat DTOs over structured clone
**[composer] · Severity: Critical**

**What:** `DayTimelinePayload` includes full `sessions`, `blocks[]` (each with nested `sessions` again), websites, segments, focus sessions — shipped whole over IPC. Recap sends **40–60 days** in one `getRecapRange` response.

**Why it’s wrong:** Electron IPC uses **structured clone** (copy semantics) — memory doubles, serialization is sync on main. Known Electron perf footgun. Duplicated session arrays multiply size.

**Better:** View models: `TimelineDaySummary` vs `TimelineDayDetail`; pagination; block references by id; server-side recap aggregation (logic already in `recap.ts` but run on wrong side).

---

### 4.2 ~105 handlers, preload exposes ~half
**[composer] · Severity: High**

**What:** Many `ipcMain.handle` channels (attribution detail, work sessions, legacy DB getters) not in `preload/index.ts`.

**Why it’s wrong:** Orphan handlers = dead code or hidden API (MCP? future?). Increases audit surface. Search uses string channels `'search:all'` outside `IPC` constant.

**Better:** Handler registry code-generated into preload; delete or expose orphans explicitly; single enum for channels.

---

### 4.3 Side effects bundled into GET handlers
**[composer] · Severity: High**

**What:** `GET_TIMELINE_DAY` calls `scheduleTimelineAIJobs(payload)` before return (`db.handlers.ts:317–318`).

**Why it’s wrong:** Read path triggers AI scheduling, heuristic upgrade sweeps, overnight cleanup queues — **hidden coupling** between “user opened timeline” and “background AI spend.”

**Better:** Event bus: `timeline:materialized` → job scheduler subscribes with debounce.

---

### 4.4 No IPC sender validation
**[composer] · Severity: Medium**

**What:** Handlers ignore `event.sender` / frame origin.

**Why it’s wrong:** Electron best practice for multi-window apps. Low risk today (single window) but wrong template if you add popouts/devtools windows.

**Better:** Assert `event.sender === mainWindow.webContents` or use `event.senderFrame`.

---

### 4.5 Round-trip payloads (regenerateBlockLabel sends full block)
**[composer] · Severity: Medium**

**What:** Renderer sends entire `WorkContextBlock` to main for AI relabel — data main already had.

**Why it’s wrong:** Wastes clone bandwidth; stale block risk if timeline updated between fetch and regen.

**Better:** `{ blockId, date }` only.

---

## 5. React / renderer architecture [composer]

### 5.1 No global data layer; settings fetched 3×
**[composer] · Severity: High**

**What:** `App.tsx`, `Insights.tsx` (via insightsResource), and `Settings.tsx` each load settings independently.

**Why it’s wrong:** Violates DRY and `docs/AGENTS.md` “renderer is not source of truth” — you still **duplicate cached copies** in renderer. Effect sync (`insightsResource.data` → local `useState`) is a known anti-pattern (React docs: derive, don’t sync).

**Better:** Settings context at App shell, or invalidate-on-write projection for settings scope.

---

### 5.2 Two data-fetch patterns
**[composer] · Severity: High**

**What:** `useProjectionResource` (good) vs ad-hoc `useEffect` + `ipc.*.then` (Settings, DayWrapped, AiSpendPanel, ConnectAI).

**Why it’s wrong:** Inconsistent cancellation, no invalidation, no hidden-tab pause, duplicated loading/error UI.

**Better:** Extend projection hook or TanStack Query-style wrapper with shared semantics.

---

### 5.3 No ESLint / react-hooks plugin
**[composer] · Severity: High**

**What:** `tests/rendererHookSafety.test.ts` line 7: “This project has no ESLint.” Custom static scanner substitutes for `eslint-plugin-react-hooks`.

**Why it’s wrong:** Hooks rules are subtle; static regex misses cases and can false-positive. Industry standard is ESLint + TypeScript ESLint + react-hooks. You already **hit production crash** from hook-in-if (noted in test file comments).

**Better:** Add ESLint flat config; keep custom test as extra guard; wire `rendererHookSafety` into CI (`package.json` has no script for it).

---

### 5.4 Error boundaries incomplete
**[composer] · Severity: Medium**

**What:** Route-level only (`App.tsx`); no root boundary; overlays (DayWrapped, CommandPalette, Onboarding) unwrapped; `ErrorBoundary` has no `componentDidCatch` → Sentry despite `@sentry/electron` dependency.

**Why it’s wrong:** React error boundaries don’t recover child state without remount key; one throw in DayWrapped kills session. Sentry unused in renderer = blind to production UI crashes.

**Better:** Root + overlay boundaries; `componentDidCatch` reporting; remount via `key={errorCount}`.

---

### 5.5 Module-level caches without invalidation contract
**[composer] · Severity: Medium**

**What:** `daySummaryRecapCache` in Timeline (`Timeline.tsx` ~600); icon cache in `useResolvedIcon`; streaming store.

**Why it’s wrong:** Projection invalidation doesn’t clear these — stale UI until reload. `window.location.reload()` used as recovery (`App.tsx`) nukes all state (heavy in Electron).

**Better:** Tie caches to projection version or date keys; clear on `onInvalidated`.

---

### 5.6 Inline styles at scale
**[composer] · Severity: Low**

**What:** Insights/Timeline use hundreds of `style={{...}}` objects — new reference every render, defeats memoization.

**Why it’s wrong:** Performance and maintainability; Tailwind is already in project (`globals.css`, Settings uses classes in places).

**Better:** CSS modules or Tailwind consistently in hot paths.

---

## 6. AI subsystem architecture [composer]

### 6.1 AI logic split across too many entry points
**[composer] · Severity: High**

**What:** `aiService.ts`, `aiTools.ts`, `insightsQueryRouter.ts`, `aiOrchestration.ts`, `assistantEvidence.ts`, providers — overlapping responsibilities.

**Why it’s wrong:** `docs/AGENTS.md` requires “route AI through backend orchestration” — true for providers, but **routing is duplicated** (router vs tools vs chat system prompt). Hard to enforce “deterministic first, AI second.”

**Better:** Single `AIRequestPipeline`: classify → deterministic handler → optional LLM prose pass.

---

### 6.2 Background enrichment coupled to timeline reads
**[composer] · Severity: High**

**What:** Opening timeline schedules heuristic upgrades, block relabel jobs, overnight cleanup (`scheduleTimelineAIJobs`).

**Why it’s wrong:** Violates user expectation and `docs/AGENTS.md`: “do not make live timeline depend on AI availability” — UI doesn’t block, but **cost and side effects** scale with views, not with user intent.

**Better:** Job queue with budgets (`aiSpendSoftLimitUsd` exists — use it globally); idle-only processing.

---

### 6.3 Unbounded chat history over IPC
**[composer] · Severity: Medium**

**What:** `getHistory` / `getThread` load full message bodies without pagination.

**Why it’s wrong:** Long threads → large clone, slow Insights mount, memory pressure in Electron renderer (Chromium heap).

**Better:** Cursor pagination; load last N messages + “load more.”

---

## 7. Testing & quality gates [composer]

### 7.1 Strong main-process unit tests; weak renderer/integration tests
**[composer] · Severity: High**

**What:** ~65 test files, mostly main/lib (`workMemory.test.ts`, `search.test.ts`, `migrationRoundtrip.test.ts`). No `@testing-library/react`; no component tests; no Electron integration test harness in CI scripts.

**Why it’s wrong:** God components and IPC glue are **untested**; regressions found in production (hooks crash). `typecheck` only in default scripts — no automated renderer safety in CI.

**Better:** Add RTL tests for `useProjectionResource`, `StreamingMessage`, `ErrorBoundary`; run `rendererHookSafety.test.ts` in CI.

---

### 7.2 No circular dependency check
**[composer] · Severity: Medium**

**What:** No `madge` or similar in `package.json`.

**Why it’s wrong:** As `workBlocks` ↔ `projections` ↔ `tracking` grow, subtle cycles become likely. Manual trace says acyclic today — **not enforced**.

**Better:** CI step `madge --circular src/main`.

---

### 7.3 Behaviour tests cost money; no cheap perf regression suite
**[composer] · Severity: Medium**

**What:** `docs/CLAUDE.md` documents expensive `test:behaviour`. No automated benchmark for timeline IPC latency or startup time.

**Why it’s wrong:** Performance and architecture regressions won’t show in unit tests.

**Better:** Lightweight perf smoke (cold start ms, `getTimelineDay` ms on fixture DB) in CI without LLM calls.

---

## 8. Cross-platform & native constraints [composer]

### 8.1 Linux tracking = multiple sync subprocess strategies
**[composer] · Severity: High**

**What:** `tracking.ts` branches across Hyprland, Sway, X11 tools — sync exec.

**Why it’s wrong:** Wayland **has no standard** active-window API; each compositor differs. Architecture should treat Linux as **best-effort tier** with explicit capability flags in UI — not same code path assumptions as macOS.

**Platform limit:** No fix makes Linux ≡ macOS; document parity as “value when available.”

**Better:** Capability matrix in Settings diagnostics; async subprocess pool; degrade gracefully.

---

### 8.2 Dual packaging toolchain (Forge + electron-builder)
**[composer] · Severity: Medium**

**What:** `electron-forge` for dev; `electron-builder` for `dist:*` scripts; native rebuild for `better-sqlite3`, `keytar`, `active-window`.

**Why it’s wrong:** Two configs drift (icons, entitlements, extraResources for capture-helper). Common source of “works in forge, fails in dist” bugs.

**Better:** Single packaging pipeline or shared config module; ADR for why dual.

---

### 8.3 Native addon fragility
**[composer] · Severity: Medium**

**What:** `postinstall: electron-rebuild` for native modules; capture-helper separate Swift build.

**Why it’s wrong:** Known Electron pain — Node ABI vs Electron ABI mismatch breaks after upgrades (`electron ^34`). CI must rebuild per platform.

**Better:** Pin Electron in lockfile; matrix CI builds per OS; document rebuild when bumping Electron.

---

### 8.4 macOS permissions (Screen Recording, FDA, Automation)
**[composer] · Severity: Medium (architectural)**

**What:** Tracking, browser tab osascript, iMessage FDA — each separate permission story.

**Why it’s wrong:** Users blame “app is slow/broken” when permission partial. Architecture should **centralize permission state machine** (you have onboarding stages — extend with runtime degradation).

**Platform limit:** Apple restricts iMessage, Safari automation — features cannot be fully cross-platform.

---

## 9. Security & privacy architecture [composer]

### 9.1 Preload surface growing without audit
**[composer] · Severity: Medium**

**What:** Large `daylens` API object (~340 lines preload) — db, ai, attribution, sync, shell, dev, analytics.

**Why it’s wrong:** Every exposed method is **trust boundary**. `dev:fireTestDailyNotification`, `memory.backfill`, `attribution.reassignRange` are powerful.

**Better:** Split `daylens.dev` behind `app.isPackaged` check; minimal production API.

---

### 9.2 `shell.openExternal` restricted to HTTPS (good) but `openPath` exposes filesystem
**[composer] · Severity: Low**

**What:** Preload exposes `shell.openPath` for artifacts.

**Why it’s OK with care:** Needed for exports; ensure paths always from main-validated artifact records, never renderer-supplied raw paths.

---

## 10. Duplication & drift [composer]

### 10.1 Recap logic on wrong side of boundary
**[composer] · Severity: High**

**What:** `buildRecapSummaries` in renderer; export uses via main import hack; Insights computes client-side from `recapResource.data`.

**Why it’s wrong:** Same business rules must run for **sync payload**, **UI**, and **AI context** — three entry points, one wrong folder.

**Better:** `src/shared/recap/` or `src/main/lib/recap/` consumed by renderer through thin wrapper or IPC `getRecapSummaries(dates)` returning **aggregates only**.

---

### 10.2 Date/window helpers duplicated
**[composer] · Severity: Low**

**What:** `shiftDate`, `getWeekStart` in Timeline and similar in `recap.ts` / `localDate` lib.

**Why it’s wrong:** Timezone bugs love duplication. You document local-midnight rules in multiple places.

**Better:** Single `@shared/dates` module (partially exists in main `localDate.ts`).

---

### 10.3 Jobs folder as façade only
**[composer] · Severity: Medium**

**What:** `src/main/jobs/blockInsight.ts` re-exports from `aiService.ts`.

**Why it’s wrong:** False modularity — suggests boundaries that don’t exist, misleads new contributors.

**Better:** Real files or delete folder until split lands.

---

## 11. Documentation & governance [composer]

### 11.1 Minimal ADR set vs large deleted doc tree
**[composer] · Severity: Medium**

**What:** On disk: `docs/adr/001-focus-events-contract.md` only (+ README). Git status shows many deleted phase/spec docs; `docs/AGENTS.md` and `docs/CLAUDE.md` exist and are strong.

**Why it’s wrong:** Architecture decisions (sandbox off, main-thread SQLite, recap placement) are **undocumented as ADRs**. New agents rely on code archaeology.

**Better:** ADR per major decision: process model, SQLite thread, IPC DTO strategy, cross-platform parity tiers.

---

### 11.2 Product contract vs code drift
**[composer] · Severity: Medium**

**What:** `docs/AGENTS.md` says Apps is secondary, clients not first-class nav — code matches. But `AiSpendPanel` built not wired; `dailySummaries` stub still called — contract says “persistence first” yet boot repairs dominate startup.

**Why it matters:** Agents and humans follow AGENTS.md; code sends mixed signals.

**Better:** CHANGELOG + remove dead entry points; wire or delete AiSpend.

---

## 12. Incomplete / misleading surfaces [composer]

| Item | Issue | Severity |
|------|--------|----------|
| **AiSpendPanel** | Component + IPC exist; never imported in Settings | Medium |
| **dailySummaries.ts** | No-op; still invoked at startup | Low |
| **Legacy routes** (`/clients`, `/focus`, `/history`) | Redirect to Timeline — APIs exist without UI | Low |
| **GET_CLIENT_DETAIL, work session IPC** | Handlers without preload | Medium |
| **useKeyboardNav hook** | Defined, never used | Low |

---

## 13. Technology-specific “known bugs” you are exposed to [composer]

| Technology | Known issue | How Daylens is exposed |
|------------|-------------|------------------------|
| **Electron main thread** | Single-threaded JS; blocking freezes UI | All SQLite, projections, copies, WMIC, osascript |
| **structured clone IPC** | Large objects = sync serialize + 2× memory | Timeline, recap, chat history |
| **better-sqlite3 sync** | Blocks event loop; not for heavy analytics on main | Every query |
| **SQLite WAL** | One writer; readers don’t block writers but writes queue | Tracking flush + persistTimelineDay + IPC reads |
| **React StrictMode** | Double effects in dev | Settings mount IPC ×2, duplicate fetches |
| **React 19 + Electron** | Fewer ecosystem patterns documented vs 18 | Generally OK; verify router v7 + lazy Suspense |
| **electron-store v10 ESM** | Dynamic import in settings — async init race if getSettings before load | Mitigated by sync cache after first load — document ordering |
| **keytar / safeStorage** | OS keychain prompts, headless CI failures | Startup `hasApiKey` await |
| **FTS5** | Rebuild locks virtual tables; contentless triggers expensive | Migration v21, label inserts |
| **@paymoapp/active-window** | Native crash / permission dependent | Core tracking |
| **Chromium in Electron** | Memory growth on large DOM (Insights chat) | Long threads, no virtualization |

---

## 14. What you are doing **right** (keep these) [composer]

1. **`contextIsolation: true`, `nodeIntegration: false`** — correct baseline.
2. **Typed IPC constants in `@shared/types`** — single source for channel names.
3. **`useProjectionResource`** — thoughtful Electron-aware fetch (invalidation, hidden pause, in-flight dedup).
4. **Streaming store + `useSyncExternalStore`** — correct fix for AI stream re-render storm.
5. **Layered data model** (raw → segments → sessions/blocks → rollups) — matches AGENTS.md; keep enforcing.
6. **focus_events contract ADR** — good precedent; extend ADR practice.
7. **Strong main-process unit test culture** for domain logic (`workMemory`, `search`, migrations).
8. **Browser history readonly copy pattern** — avoids locking live Chrome DB.
9. **Single-instance lock** (`requestSingleInstanceLock`) — correct for tracker app.

---

## 15. Recommended sequencing (architecture, not perf) [composer]

If you refactor, this order minimizes risk:

1. **Move `recap` / `wrappedFacts` to shared** — fixes main→renderer leak immediately.
2. **Split read vs write timeline paths** — idempotent GET; materialize job.
3. **Slim IPC DTOs** — recap aggregates, week summary, paginated history.
4. **Extract `workBlocks` segmentation vs persistence** — test heuristics without SQLite.
5. **Split `aiService`** along existing `jobs/` names — make re-exports real.
6. **ESLint + react-hooks + CI** — cheap win before more Insights splits.
7. **Utility process for projection** — largest structural win for Electron correctness.
8. **ADR backlog** — sandbox, SQLite thread, IPC DTO policy.

---

*Generated from read-only architecture audit (**composer**). Based on `src/` (~45k LOC main, ~16k renderer), `docs/AGENTS.md`, ADR 001, `package.json`, and Electron/React/SQLite documented constraints. No runtime profiling. Related: `composer.md` (perf), `confidence_matrix.md` (composer + claude confidence passes).*
