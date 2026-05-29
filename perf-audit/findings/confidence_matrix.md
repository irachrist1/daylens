# Daylens Confidence Matrix

How sure we are that features **work** and that noted **performance issues are real**, based on read-only code review and test coverage — not runtime profiling on a live install.

## How to read this

| Confidence | Meaning |
| :--- | :--- |
| **Very high** | Exact code path read; behavior is deterministic; often backed by automated tests. Would bet money without running the app. |
| **High** | Code path read; logic clear; minor platform/env caveats. No test seen but implementation is complete and wired. |
| **Medium** | Partially verified; works in some configs; gated (permissions, opt-in, OS); or UI/API exists but end-to-end path not fully traced. |
| **Low** | Schema/stub only, not wired to UI, or multiple untested platform fallbacks; “works” is an assumption. |

**Perf confidence** is separate: a issue can be **very high** confidence (code proves the pattern) while **impact magnitude** is unknown without measurement.

---

## A. Feature correctness confidence

| Feature | Works? (claim) | Confidence | Why |
| :--- | :--- | :--- | :--- |
| Foreground app tracking (macOS native / Windows) | Yes | **Very high** | Core `tracking.ts` path; `trackingSelfCapture.test.ts`, `trackingHeuristics.test.ts`. |
| Foreground app tracking (Linux) | Yes, with fallbacks | **Medium** | Multiple backends (`hyprctl`, sway, xdotool, xprop); `platformExpectations.test.ts` exists but not full desktop E2E per compositor. |
| Native focus capture helper (macOS) | Yes when binary built | **High** | `focusCapture.ts` + Swift helper; `captureHelperNeverGuess.test.ts`; fails soft if binary missing. |
| Browser history import | Yes | **Very high** | `browser.ts`; `browserDiscovery.test.ts`, `browserContextTracking.test.ts`. |
| Active browser tab context | Yes | **High** | Implemented + tested insert path; live osascript/history sampling not E2E tested in CI. |
| Windows ActivityCache backfill | Yes | **Medium** | Code complete; no dedicated test found; duplicate-insert risk unverified in tests. |
| iMessage capture | Partial | **Medium** | Service + IPC + Settings toggle; requires FDA on macOS; no test file found; cannot confirm on CI. |
| File activity capture | No | **Very high** (that it does *not* work) | Schema only; no INSERT writer found in `src/`. |
| Entity suggestions | No | **Very high** (that it does *not* work) | Schema only; no IPC/renderer. |
| Timeline day view | Yes | **Very high** | Primary path; `workBlockSplitting.test.ts`, `trackingHeuristics.test.ts`, many block tests. |
| Timeline week view | Yes | **High** | UI + 7× IPC wired; week aggregation logic simpler than day build; less test coverage. |
| Block inspector (override, regen, client assign) | Yes | **High** | UI in `Timeline.tsx`; IPC handlers exist; regen/assign not seen in dedicated UI E2E tests. |
| Derived projections / chunk2 finalize | Yes | **High** | `projectDay` in chunk2; used by sync/finalize; migration tests exist; full finalize chain not one integration test. |
| Apps tab (list, detail, date switch) | Yes | **Very high** | `appDetailPayload.test.ts`, `appActivityDigest.test.ts`, `appsTopDomains.test.ts`. |
| Per-app activity digest (multi-day) | Yes | **High** | `appActivityDigest.test.ts`; expensive handler path confirmed in code. |
| AI chat + streaming | Yes | **Very high** | `aiChatEndToEnd.test.ts`, `followUpChat.test.ts`, `rendererHookSafety.test.ts`. |
| AI threads / artifacts | Yes | **High** | `aiThreadSchema.test.ts`, `aiThreadDeletion.test.ts`; artifact preview E2E limited. |
| AI background enrichment | Yes when enabled | **Medium** | Jobs in `aiService.ts`; `blockCleanup.test.ts` partial; depends on API keys + settings. |
| AI spend panel | No (UI) | **Very high** (IPC works, UI not shipped) | `AiSpendPanel.tsx` never imported; `GET_AI_SPEND` handler exists. |
| Recap hero (day/week/month) | Yes | **High** | `recap.test.ts`, `recap.stress.test.ts`; stress test validates window size not perf. |
| Attribution pipeline | Yes | **High** | `attributionBrowserEvidence.test.ts`, router tests; full UI assign flow lightly tested. |
| Clients / projects (Settings + block inspector) | Yes | **High** | Settings CRUD wired; `listClientsDetailed` used; no full client billing E2E test. |
| Work memory / evening consolidation | Yes | **Very high** | `workMemory.test.ts`, `memoryBackfill.test.ts`. |
| Distraction alerter | Yes when enabled | **Medium** | Logic in `distractionAlerter.ts`; no test file found; notification UX unverified. |
| Focus sessions (palette / chat) | Yes | **Medium** | IPC + palette actions; no dedicated Focus view; break recommendation untested. |
| Global search (FTS) | Yes | **Very high** | `search.test.ts`. |
| Command palette | Yes | **High** | Wired in App; shortcut in main; search debounce manual only. |
| Day Wrapped overlay | Yes | **Very high** | `wrappedNarrative.test.ts`, `wrappedFacts.test.ts`. |
| Daily / morning notifications | Yes | **High** | `dailySummaryScheduler.test.ts`, `notificationNavigation.test.ts`. |
| Onboarding | Yes | **High** | `onboardingFirstRun.test.ts`; permission flows macOS-specific. |
| Settings (all sections) | Yes | **High** | Large surface; individual toggles not each tested; MCP/iMessage need real env. |
| Remote sync / workspace link | Yes | **Medium** | `syncStatus.test.ts`, `remoteSyncPayload.test.ts`, `remoteContractCheck.test.ts`; needs live Convex for full link. |
| Auto-updater | Yes (platform-dependent) | **Medium** | `updaterReleaseFeed.test.ts`; ad-hoc signing path macOS-specific; not tested in CI install. |
| MCP server | Yes when enabled | **Low** | Spawn code exists; no test; depends on external MCP clients. |
| Launch on login / tray | Yes | **High** | Standard Electron APIs; Linux autostart separate path; manual platform checks. |
| Analytics (PostHog/Sentry) | Yes when keys baked | **High** | `analytics.service.test.ts`, `analytics.test.ts`; disabled in dev without keys. |
| Daily summaries (`dailySummaries.ts`) | **No** (removed) | **Very high** | Stub no-op; still called at startup — confirmed dead. |

---

## B. Performance issue confidence

| Performance claim | Confidence | Evidence strength | Caveats (why not 100%) |
| :--- | :--- | :--- | :--- |
| Today timeline full rebuild + persist on every `GET_TIMELINE_DAY` | **Very high** | `buildTimelineBlocksForDay` skips cache when `dateStr >= todayStr`; `persistTimelineDay` always called after compute (`workBlocks.ts:2819–2840`). | Unmeasured ms; worse with more sessions/blocks. |
| Startup identity repair full-table scan every launch | **Very high** | Unconditional SELECT-all + UPDATE loops in `repairStoredIdentityColumns` / `repairStoredAppIdentityObservations` called from `initDb()` (`database.ts:47–49`). | Cost scales with row count; empty DB is cheap. |
| Write-on-read on derived past-day open | **Very high** | `persistTimelineDay` in `getDerivedDayTimelinePayload` (`projections.ts:131`). | Only when derived day exists; other past days use persisted path. |
| N+1 queries in `loadPersistedTimelineBlocksForDay` / lightweight loader | **Very high** | Per-block prepared statements in loop (`workBlocks.ts:2656+, 3228+`). | Block count dependent; could be ms not seconds. |
| `getBlockDetailPayload` up to 31× day rebuild | **Very high** | Literal for-loop (`workBlocks.ts:3498–3500`). | Only if block is old and early offsets empty; worst case rare. |
| Week view 7× parallel timeline IPC every 30s | **Very high** | `Promise.all` + `intervalMs: 30_000` (`Timeline.tsx:1419–1425`). | Only when week includes today; past weeks don’t poll. |
| Day Wrapped 14× parallel timeline IPC | **Very high** | `Promise.all` over 14 dates (`DayWrapped.tsx:1372`). | Only when week-comparison slide enabled. |
| Recap ~45–60 days in one `getRecapRange` | **Very high** | `recapDateWindow` math (`recap.ts:226–231`); tested for date count not perf (`recap.test.ts`). | Lightweight path may skip full rebuild for some days. |
| Triple projection invalidation on session flush | **Very high** | Three `invalidateProjectionScope` calls (`tracking.ts:1611–1618`). | Refetch only if Timeline/Apps/Insights mounted. |
| `scheduleTimelineAIJobs` on every timeline read | **Very high** | Handler line (`db.handlers.ts:317–318`). | AI jobs no-op if `aiBackgroundEnrichment` off. |
| `GET_APP_ACTIVITY_DIGEST` = N × full timeline projection | **Very high** | Loop in handler (`db.handlers.ts:453–458`). | Only multi-day Apps mode. |
| Attribution full-day rebuild after flushes (3s debounce) | **Very high** | `runAttributionForRange` in `flushPendingAttributionRefresh` (`tracking.ts:1088`). | Debounced; one day per flush batch. |
| Browser history sync file copy every 60s | **Very high** | `copyFileSync` in poll path (`browser.ts` — cited in prior audit). | Severity depends on History DB size. |
| Browser tab osascript on tracking poll | **High** | `execFileSync` in `browserContext.ts:107+`; called from tracking poll. | Only when browser is foreground app. |
| Linux tracking sync subprocess risk | **High** | Sync exec patterns in `tracking.ts` Linux branches. | Which compositor user runs changes which path fires. |
| 48h session lookback on range queries | **Very high** | `fromMs - 172800000` in `queries.ts:541`. | Extra rows, not necessarily full table scan if index used. |
| `getCategoryOverrides()` on every session query | **Very high** | Called at start of `getAppSummariesForRange` / `getSessionsForRange`. | Small table usually; still redundant. |
| `search:all` = 4 FTS queries per debounce | **Very high** | `searchAll` composition (`queries.ts:801–814`). | Debounced; only when searching. |
| Insights god-component / Markdown re-parse on stream | **High** | Code structure read (`Insights.tsx`); streaming store isolates parent (`streamingStore.ts`). | Hard to quantify without React profiler. |
| AICompose scrollHeight reflow every keystroke | **Very high** | Effect on `[input]` (`AICompose.tsx:26–32`). | Worse with long DOM; comment in code acknowledges it. |
| Settings 8+ IPC on mount + 5s diagnostics poll | **Very high** | Mount effect + interval (`Settings.tsx:588–639`). | Only while Settings open. |
| Per-icon IPC + base64 over clone | **High** | `useResolvedIcon` → `ipc.icons.resolve` (`useResolvedIcon.ts:62`). | Renderer cache reduces repeat cost. |
| Startup +10s finalize / reproject / sync chain | **Very high** | `index.ts:344–346`, `syncUploader.ts:132–137`, `chunk2 reprojectStaleDays`. | Skipped work if no stale days / empty yesterday. |
| Sync on tracking tick (20s debounce) | **Very high** | `syncUploader.ts:72–80`. | No-op if sync not linked. |
| SCHEMA_SQL full exec every launch | **Very high** | `_db.exec(SCHEMA_SQL)` (`database.ts:32–33`). | IF NOT EXISTS is fast on warm DB but still parses SQL. |
| Missing index on `focus_sessions.start_time` | **High** | Schema has table, no index; query exists (`queries.ts:2024`, `schema.ts:38`). | Matters only with many focus sessions. |
| Missing index on `timeline_block_members.block_id` | **High** | Index is on `(member_type, member_id)` only (`schema.ts:242`). | SQLite may still scan; N+1 dominates today. |
| Lazy routes refetch on every navigation | **High** | `React.lazy` + mount `refresh()` in hook. | User may not switch tabs often. |
| Process monitor WMIC every 15s (Windows) | **Very high** | `processMonitor.ts:48–58`. | Windows only. |
| MCP second process at startup | **Very high** | `startMcpServer` from `index.ts:748`. | Only when enabled. |
| iMessage immediate sync at startup | **Very high** | `imessageCapture.ts:70–76`. | Only when enabled + macOS. |
| Windows backfill duplicate sessions | **Medium** | No dedup in loop (`windowsHistory.ts:139+`); logical risk not test-proven. | May dedupe elsewhere on read — not verified. |
| Derived-state version bump wipes timeline | **High** | `resetDerivedState` in `metadata.ts:75–77`. | Only on version mismatch after upgrade. |
| FTS rebuild on v21 migration | **Very high** | Four `INSERT ... VALUES ('rebuild')` in migrations. | One-time per upgrade. |
| `compareClientsForRange` doubles work | **Very high** | Two `resolveClientQuery` calls (`attributionResolvers.ts:749`). | Only if that API used. |
| Entity/file-activity perf issues | **N/A** | Features not shipped — no runtime cost. | — |

---

## C. Cross-cut: high confidence, high impact (fix first)

These are the intersection of **very high perf confidence** and **very high feature-work confidence** (feature actually ships and is used):

1. Today timeline rebuild + persist on read/poll  
2. Startup DB identity repair (full scans)  
3. Projection invalidation storm → refetch without debounce  
4. Week view / Day Wrapped / recap multi-day IPC amplification  
5. Browser history sync copy on main thread  
6. Attribution pipeline on session flush  
7. `scheduleTimelineAIJobs` coupled to timeline reads  

---

## D. Cross-cut: low confidence — verify before investing

| Item | Concern |
| :--- | :--- |
| **Linux tracking reliability** | Works confidence medium; perf varies by compositor; fix may not help all users. |
| **iMessage capture** | Works + perf both medium; FDA gate; small user base. |
| **MCP server** | Low works confidence; perf cost real but opt-in niche. |
| **Distraction alerter UX** | Logic exists; unclear if notifications fire correctly in all OS states. |
| **Windows backfill duplicates** | Perf medium confidence; data correctness unproven. |
| **Remote sync under load** | Contract tests pass; real Convex latency/payload size not profiled here. |
| **Exact ms savings from any fix** | **None of the perf claims include measurements** — patterns are code-proven, not benchmark-proven. |

---

## E. What would raise confidence

| Gap | Action |
| :--- | :--- |
| Perf impact magnitude | Cold-start timer, Timeline open trace, IPC payload sizes, SQLite `EXPLAIN QUERY PLAN` on hot queries. |
| Linux / Windows desktop | Manual smoke on target compositors / WMIC availability. |
| iMessage / MCP / distraction alerts | Manual test with permissions; optional integration tests with mocks. |
| AI Spend Panel | Import into Settings and confirm one render path. |
| File activity / entity suggestions | Either implement writers + UI or remove from schema to avoid confusion. |

---

*Generated from read-only audit (composer). No app runs, no profiler traces. Perf confidence = pattern exists in code; not = user-visible lag quantified.*

---

## F. Claude independent confidence pass (this session's reads)

Sections A–E above are composer's and lean heavily on test-file *names*. This section is calibrated to what **I personally traced this session** — the actual code paths, not test filenames I did not open. Where I only saw structure (not the end-to-end behavior), I down-rate. I did **not** run the app, the tests, or a profiler.

### F.1 — What I am *very confident* actually works (read the exact path)

| Feature / behavior | Confidence | What I verified myself |
| :--- | :--- | :--- |
| Foreground session storage + read-back (`app_sessions`, clip/merge/category-resolve) | **Very high** | Read `insertAppSession`, `getSessionsForRange`, `getAppSummariesForRange`, `clipRowToRange`, `mergeSessions` end-to-end (queries.ts). Logic is deterministic and self-consistent. |
| Timeline day assembly (coalesce → label → segments) | **Very high** | Read the full pipeline: `coarseSegmentsFromSessions` → `analyzeSessions` → `normalizeTimelineCandidates` → `coalesceTimelineCandidates` → `buildBlockFromCandidate` → `finalizedLabelForBlock`. It produces a coherent payload. |
| Derived past-day read (`chunk2.readDerivedDay`, `readDerivedAppSummariesForDate`) | **Very high** | Read both; the block/session reassembly and app-summary rollup are correct. |
| FTS search (`searchAll` = sessions+blocks+browser+artifacts) | **High** | Read all four queries + `toFtsQuery`. Sound; I did not exercise tokenizer edge cases. |
| AI streaming isolation (composer↔message) | **Very high** | Read `streamingStore.ts` + `StreamingMessage.tsx`; the `useSyncExternalStore` design genuinely keeps the composer from re-rendering per chunk. |
| Icon resolution caching (renderer + main) | **High** | Read `useResolvedIcon.ts` (Map cache) + iconResolver cache layers. Correct cache keys. |
| Projection invalidation → refetch wiring | **High** | Read `useProjectionResource` + the bus subscribe. Refetch fires on scope match as claimed. |

### F.2 — What I am *not confident* actually works (did not trace to a verdict)

| Feature / behavior | Confidence | Why I can't sign off |
| :--- | :--- | :--- |
| Linux foreground tracking across compositors | **Low** | I did not read the Linux branches of `tracking.ts` this session; multiple backends, no runtime check. Composer rates Medium; I won't claim better than Low without reading them. |
| iMessage / MCP / distraction alerter | **Low** | Did not read these services this session. Opt-in + OS-gated. Unverified by me. |
| Auto-updater + NSIS/userData recovery | **Medium** | Read the recovery/backup flow in `index.ts`; logic is plausible but it is exactly the kind of path that only proves out on a real upgrade, which I cannot do. |
| Remote sync correctness under real Convex | **Low** | Did not read `syncUploader`/`remoteSync` internals this session. |
| AI background enrichment producing *good* labels | **Low (quality), High (it runs)** | I confirmed `scheduleTimelineAIJobs` fires and dispatches jobs; whether the resulting labels are correct is a model-output question I can't judge from code. |
| Focus-score correctness | **Low** | `isCategoryFocused` runs everywhere, but the memory note says the scoring model is *wrong*. I believe it *executes*; I do not believe it is *right*. |

### F.3 — Performance claims: my confidence vs. composer's

These map to my own findings file (`CLAUDE.md`, F1–F11), which are based on lines I read this session, so I hold them at **very high** code-confidence. The universal caveat applies to all: **no measurement — pattern-proven, not benchmark-proven.**

| Perf claim (mine) | Code confidence | Magnitude confidence | Note vs. composer |
| :--- | :--- | :--- | :--- |
| Startup full-table identity rewrite every launch (`repairStoredIdentityColumns`, metadata.ts:111-170) | **Very high** | **Medium** | Agree; I read the unconditional `SELECT *`-then-`UPDATE` loop directly. Magnitude scales with history. |
| Past-day write-on-read (`getDerivedDayTimelinePayload` persists, projections.ts:122-131) | **Very high** | **Medium-high** | Agree. |
| Today timeline rebuild+persist every 30s poll | **Very high** | **Medium-high** | Agree. |
| `GET_APP_ACTIVITY_DIGEST` = N × full projection | **Very high** | **High** | Agree; multi-day Apps mode is the worst case. |
| `buildAppNameMap` full `app_sessions` scan + `NOT IN` per work-session IPC call (F5) | **Very high** | **Medium-high** | **Composer did not isolate this one** — it's a full-table scan on every Clients/work-session call, independent of result size. |
| Double `finalizedLabelForBlock` on derived/persist path (F7) | **Very high** | **Medium** | **Composer did not flag the double-finalize**; I read both call sites (workBlocks.ts:2001 and 2443). |
| `website_visits` re-queried per block *and* during coalesce passes (F6) | **High** | **Medium** | Composer noted per-block website re-query for segments; I additionally confirmed the coalesce-time calls (`candidatePageArtifacts`, line 1714). |
| `resolveCanonicalApp` un-memoized, per-row in every loop (F9) | **Very high** | **Low-medium** | Agree; map is cached but the per-call string work is not. |
| Streaming markdown re-parse + scrollIntoView per chunk (F10) | **High** | **Medium** | Agree; O(n²) over the stream. |
| Missing composite index `app_sessions(bundle_id, start_time)` (F11) | **High** | **Low** | Agree; matters only at scale. |

### F.4 — Where I'd refuse to give *any* confidence without instrumentation

- **Absolute cold-start time** and **Timeline-open latency** — every "this is slow" claim is structural. I have read the code that makes it *expensive in principle*; I have not seen a single millisecond. A `console.time` around `initDb()` and one `EXPLAIN QUERY PLAN` on `getSessionsForRange` would settle most of Section B in an afternoon.
- **Whether users actually feel it** — depends entirely on data volume (sessions/visits per day × days installed). On a 3-day-old install most of this is invisible; on a year-old install F1/F2/F3 likely dominate. The bug is real; the *blast radius* is unmeasured.
