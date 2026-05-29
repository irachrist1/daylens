---
ID: F1
Symptom: Timeline on Today never feels "cached"; CPU and disk spike every ~30 seconds and after every app switch.
Location: src/main/services/workBlocks.ts:2819
Root cause: `buildTimelineBlocksForDay` only reads persisted blocks when `dateStr < todayStr`; for today it always runs `buildBlocksForSessions` → `finalizedLabelForBlock` per block → `persistTimelineDay`, which DELETE/INSERTs the entire block graph. Renderer polls via `useProjectionResource` at 30s (`Timeline.tsx:1791`) and tracking invalidates timeline scope on every session flush (`tracking.ts:1611`), so this path runs continuously during active use.
Evidence: if (dateStr < todayStr) { const persisted = loadPersistedTimelineBlocksForDay(...) ... } const computed = buildBlocksForSessions(db, sessions).map((block) => finalizedLabelForBlock(db, block)); persistTimelineDay(db, dateStr, computed)
Fix: Serve today from an incremental in-memory projection keyed by session watermark, persisting only on explicit finalize or debounced idle, not on every IPC read.
Impact: high
Risk: medium
---
ID: F2
Symptom: Cold start gets slower every month of tracked history; app feels stuck before the window appears.
Location: src/main/core/projections/metadata.ts:111
Root cause: `initDb()` synchronously calls `repairStoredIdentityColumns()` before `createWindow()` (`index.ts:745-771`). It SELECTs every row in `app_sessions` and `website_visits` and UPDATEs identity columns unconditionally on every launch, even when already correct.
Evidence: const sessionRows = db.prepare(`SELECT id, bundle_id, app_name FROM app_sessions`).all() ... for (const row of sessionRows) { updateSession.run(identity.rawAppName, identity.canonicalAppId, identity.appInstanceId, row.id) } ... const visitRows = db.prepare(`SELECT id, browser_bundle_id, url FROM website_visits`).all()
Fix: Gate repair behind a one-time migration flag or update only rows where identity columns are NULL or stale.
Impact: high
Risk: low
---
ID: F3
Symptom: Startup delay scales with total session count; SQLite busy on first launch after long use.
Location: src/main/core/inference/appIdentityRegistry.ts:211
Root cause: Chained immediately after F2 in `initDb()` (`database.ts:49`). `repairStoredAppIdentityObservations` runs a full-table GROUP BY over `app_sessions` and upserts every identity group on every boot.
Evidence: const rows = db.prepare(`SELECT bundle_id, COALESCE(raw_app_name, app_name) AS raw_app_name, COALESCE(app_instance_id, bundle_id) AS app_instance_id, category, MIN(start_time) AS first_seen_at, MAX(COALESCE(end_time, start_time + duration_sec * 1000)) AS last_seen_at FROM app_sessions GROUP BY bundle_id, COALESCE(raw_app_name, app_name), COALESCE(app_instance_id, bundle_id), category`).all()
Fix: Incremental repair from last-seen watermark or run once in a versioned migration.
Impact: high
Risk: low
---
ID: F4
Symptom: Opening any past day with derived projection data is slow and writes to disk just from viewing.
Location: src/main/core/query/projections.ts:109
Root cause: `getTimelineDayProjection` tries `getDerivedDayTimelinePayload` first for non-live days. That path rebuilds blocks via `buildTimelineBlocksFromSessions` and calls `persistTimelineDay` on every IPC read—a write-on-read anti-pattern that bypasses the persisted-block fast path in `loadPersistedTimelineBlocksForDay`.
Evidence: const blocks = buildTimelineBlocksFromSessions(db, sessions) ... persistTimelineDay(db, dateStr, blocks) ... return { date: dateStr, sessions, websites, blocks, segments, focusSessions, ... }
Fix: Return derived blocks read-only during navigation; persist only when labels are edited or during background consolidation.
Impact: high
Risk: medium
---
ID: F5
Symptom: Block detail lookup can freeze the app for seconds; worst case feels like opening 31 timeline days at once.
Location: src/main/services/workBlocks.ts:3493
Root cause: `GET_BLOCK_DETAIL` IPC (`db.handlers.ts:479`) calls `getBlockDetailPayload`, which loops offsets 0..-30 and runs full `getTimelineDayPayload` for each day until a matching block id is found—up to 31 complete timeline rebuilds per invoke.
Evidence: for (let offset = 0; offset >= -30; offset--) { const payload = getTimelineDayPayload(db, localDateStringForOffset(offset), liveSession); const match = payload.blocks.find((block) => block.id === blockId); if (match) return match }
Fix: Resolve block by id with a direct SQL lookup on `timeline_blocks` + bulk member fetch, falling back to day rebuild only when row is missing.
Impact: high
Risk: low
---
ID: F6
Symptom: Past-day timeline loads degrade linearly with block count; SQLite statement count explodes on heavy days.
Location: src/main/services/workBlocks.ts:2656
Root cause: `loadPersistedTimelineBlocksForDay` (used when past days hit the cache path in F1) runs 4–6 prepared queries per block inside a loop: labels, session members, focus members, plus `getWebsiteSummariesForRange` and `getTopPagesForDomains` per block time range.
Evidence: for (const row of rows) { const labelRows = db.prepare(`SELECT label, source FROM timeline_block_labels WHERE block_id = ?`).all(row.id) ... const memberRows = db.prepare(`SELECT member_id FROM timeline_block_members WHERE block_id = ? AND member_type = 'app_session'`).all(row.id) ... const websites = getWebsiteSummariesForRange(db, row.start_time, row.end_time).slice(0, 5)
Fix: Bulk-fetch labels, members, and website aggregates for all block IDs in the day with `IN` queries, then assemble in memory.
Impact: high
Risk: low
---
ID: F7
Symptom: AI tab recap hero and Insights invalidation reloads feel like opening two months of timeline data.
Location: src/renderer/lib/recap.ts:226
Root cause: `recapResource` in Insights calls `ipc.db.getRecapRange(dates)` where `recapDateWindow` spans from previous-month-start through today (~45–60 calendar days). Handler `getRecapRange` (`workBlocks.ts:3375`) runs `getLightweightDayPayload` or full `getTimelineDayPayload` per date. Each lightweight path repeats the N+1 pattern from F6 at `workBlocks.ts:3228`.
Evidence: export function recapDateWindow(currentDate = todayString()): string[] { const previousMonthStart = toDateKey(new Date(year, month - 2, 1)); const dayCount = dayDistanceInclusive(previousMonthStart, currentDate); return Array.from({ length: dayCount }, (_, index) => shiftDate(previousMonthStart, index)) }
Fix: Precompute recap aggregates in main process (totals only) and return a slim summary payload instead of full `DayTimelinePayload[]`.
Impact: high
Risk: medium
---
ID: F8
Symptom: Week view on Timeline stutters; CPU fans while week strip is visible on a week that includes today.
Location: src/renderer/views/Timeline.tsx:1419
Root cause: `weekResource` sets `intervalMs: includesToday ? 30_000 : 0` and loads seven parallel `ipc.db.getTimelineDay` calls. Each invoke hits F1's full rebuild path for today plus six other days through `getTimelineDayProjection` (`db.handlers.ts:316-318`), then `scheduleTimelineAIJobs` (F15).
Evidence: intervalMs: includesToday ? 30_000 : 0, load: async () => { const dates = Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index)); const days = await Promise.all(dates.map((date) => ipc.db.getTimelineDay(date)))
Fix: Single IPC returning week aggregates (seconds per category per day) without full block payloads; poll only today's slice.
Impact: high
Risk: low
---
ID: F9
Symptom: Day Wrapped overlay shows a long spinner on open; brief main-process freeze.
Location: src/renderer/components/DayWrapped.tsx:1372
Root cause: `useWeekData` fires fourteen parallel `ipc.db.getTimelineDay` invokes (two weeks of dates) even though `data` prop already carries today's payload. Each invoke runs the full projection chain from F1.
Evidence: Promise.all(dates.map(date => ipc.db.getTimelineDay(date).catch(() => null))) where dates = Array.from({ length: 14 }, (_, i) => dateStringFromMs(anchorMs - (13 - i) * 86_400_000))
Fix: Batch week summaries via one IPC or derive chart data from precomputed rollups; reuse passed-in payload for anchor day.
Impact: high
Risk: low
---
ID: F10
Symptom: Timeline and Apps hitch on every app switch during active tracking; views feel like they never stop refreshing.
Location: src/main/services/tracking.ts:1611
Root cause: Session flush emits `invalidateProjectionScope` for timeline, apps, and insights (`1611-1618`). Preload broadcasts to renderer (`preload/index.ts:333`). `useProjectionResource` (`115-119`) refetches immediately with no debounce and no date/canonicalAppId filtering—so Timeline, Apps (if mounted), and Insights all invoke heavy handlers in parallel after every switch (~every few minutes of use, debounced attribution at 3s adds more load at `1088`).
Evidence: invalidateProjectionScope('timeline', 'activity_recorded', { date: localDateString(new Date(endTime)) }); invalidateProjectionScope('apps', 'activity_recorded', { canonicalAppId: currentSession.canonicalAppId }); invalidateProjectionScope('insights', 'activity_recorded', { date: localDateString(new Date(endTime)) })
Fix: Debounce invalidation in renderer (200–500ms coalesce) and ignore events whose date/canonicalAppId don't match the mounted view's dependencies.
Impact: high
Risk: medium
---
ID: F11
Symptom: ~10 seconds after launch, CPU/IO spike even when idle; sync icon may flicker.
Location: src/main/index.ts:344
Root cause: `startBackgroundServices` schedules `finalizePreviousDay()` at +10s (`index.ts:346`), which chains: `projectFinalizedDay` (full `projectDay` over all focus_events for yesterday—`chunk2.ts:103`), `runEveningConsolidation`, `reprojectStaleDays({ maxDays: 7 })` (up to 7 more `projectDay` runs—`chunk2.ts:697`), and `syncNow()` which builds remote snapshot via `exportSnapshot` → `getTimelineDayPayload` per dirty day.
Evidence: setTimeout(() => { try { computeAllMissingSummaries() } catch ... setTimeout(() => finalizePreviousDay(), 0) }, 10_000) ... export function finalizePreviousDay(): void { projectFinalizedDay(yesterday, 'startup-finalize'); reprojectStaleProjectionDays(); void syncNow() }
Fix: Stagger finalize/consolidation/reproject/sync across idle callbacks; skip reproject sweep when projection version unchanged.
Impact: high
Risk: medium
---
ID: F12
Symptom: Steady background CPU/network while tracking; sync feels constant.
Location: src/main/services/syncUploader.ts:72
Root cause: Every tracking poll tick (5s—`tracking.ts:72`) can trigger `syncNow()` debounced to 20s (`TRACKING_SYNC_DEBOUNCE_MS`). `syncNow` builds full remote payload per dirty day including timeline export. Separate 60s timer also calls `syncNow()` (`syncUploader.ts:60-69`).
Evidence: unsubscribeTrackingTick = onTrackingTick(() => { markDirty(todayStr()); ... void heartbeatNow(); void syncNow() })
Fix: Heartbeat-only on tracking tick; sync on longer interval or when day finalizes; incremental sync from rollups not full snapshot.
Impact: high
Risk: medium
---
ID: F13
Symptom: Each timeline rebuild for a busy day runs hundreds of SQLite queries before any IPC serialization.
Location: src/main/services/workBlocks.ts:1482
Root cause: `buildBlockFromCandidate` (called for every coalesced block in `buildBlocksForSessions`) runs `getWebsiteSummariesForRange`, `getTopPagesForDomains`, `buildPageCandidates`, `getWorkContextInsightForRange`, and `focusOverlapForRange` per block. Coalescing paths call `candidatePageArtifacts` which re-queries visits (`1258`). Gap detection in `coarseSegmentsFromSessions` calls `gapHasHardActivityBoundary` per inter-session gap (`523-543`).
Evidence: const websites = getWebsiteSummariesForRange(db, blockStart, blockEnd).slice(0, 5); const pageCandidates = buildPageCandidates(db, blockStart, blockEnd); ... if (current.startTime - previousEnd > IDLE_GAP_THRESHOLD_MS && gapHasHardActivityBoundary(db, previousEnd, current.startTime))
Fix: Prefetch all website visits and activity events for the day once, then slice in memory per block/gap.
Impact: high
Risk: medium
---
ID: F14
Symptom: Label finalization during block build adds 4+ DB round-trips per block on days with work memory enabled.
Location: src/main/services/workBlocks.ts:2235
Root cause: `finalizedLabelForBlock` calls `getBlockLabelOverride`, then `gatherConcurrentEvidence` (3 overlap queries on website_visits, browser_context_events, file_activity_events—`workMemory.ts:169-220`), then `matchPromotedPatterns` which loads up to 100 promoted patterns and scores each (`workMemory.ts:518-529`). Called once in `buildTimelineBlocksForDay:2839` and again inside `persistTimelineDay:2443` for each block—double finalization on persist.
Evidence: const concurrentEvidence = memoryEnabled() && allowWorkMemoryLabel ? gatherConcurrentEvidence(db, block) : null; const memoryPattern = concurrentEvidence ? matchPromotedPatterns(db, block, concurrentEvidence) : null ... for (const rawBlock of blocks) { const block = finalizedLabelForBlock(db, rawBlock)
Fix: Cache promoted patterns and per-block evidence for the rebuild pass; skip second finalization in persist when block object is already finalized.
Impact: high
Risk: medium
---
ID: F15
Symptom: Innocent timeline reads trigger background AI work and historical day reprocessing.
Location: src/main/ipc/db.handlers.ts:316
Root cause: Every `GET_TIMELINE_DAY` calls `scheduleTimelineAIJobs(payload)` after projection. That schedules `runHistoryHeuristicUpgrade` after 1s (`aiService.ts:5055-5060`), which loops `listTimelineDaysNeedingHeuristicUpgrade` and for each date runs full `getTimelineDayPayload` plus optional per-block AI relabel (`5024-5039`). Also enqueues `runBlockInsightJob` for eligible blocks (`5070-5074`) and `scheduleOvernightCleanup` which queries pending cleanup dates and processes AI batches (`5006-5021`).
Evidence: ipcMain.handle(IPC.DB.GET_TIMELINE_DAY, (_e, dateStr: string) => { const payload = getTimelineDayProjection(...); scheduleTimelineAIJobs(payload); return payload })
Fix: Decouple read path from AI scheduling; gate jobs on idle, spend limits, and explicit dirty flags.
Impact: high
Risk: medium
---
ID: F16
Symptom: Apps view multi-day mode (7/30 days) is very slow to open; IPC handler blocks for seconds.
Location: src/main/ipc/db.handlers.ts:453
Root cause: `GET_APP_ACTIVITY_DIGEST` loops `dayCount` days and calls `getTimelineDayProjection` for each, collecting all blocks then running `computeAppActivityDigest`. For 30 days this is 30× the cost of F1/F4 per invoke. Renderer calls this for multi-day Apps ranges (`Apps.tsx:177-179`).
Evidence: for (let offset = 0; offset < dayCount; offset++) { const payload = getTimelineDayProjection(db, dateStr, getLiveSessionForDate(dateStr)); for (const block of payload.blocks) blocks.push(block) }
Fix: Build digest from derived rollups or cached block summaries without full projection rebuild per day.
Impact: high
Risk: medium
---
ID: F17
Symptom: Client/work-session views and attribution queries slow down as session count grows.
Location: src/main/core/query/attributionResolvers.ts:401
Root cause: `sessionApps` loops segment members and runs `SELECT primary_bundle_id FROM activity_segments WHERE id = ?` per member—classic N+1. Called from `resolveClientQuery`, `resolveDayContext`, and `buildWorkSessionPayloads` (`db.handlers.ts:246-272`), which adds another N+1 for evidence queries per work session. `GET_CLIENT_DETAIL` doubles this by calling `buildWorkSessionPayloads` twice (`602-607`).
Evidence: for (const member of members) { const seg = db.prepare(`SELECT primary_bundle_id FROM activity_segments WHERE id = ?`).get(member.segment_id) ... const evidence = db.prepare(`SELECT evidence_type, evidence_value, weight FROM work_session_evidence WHERE work_session_id = ? ORDER BY weight DESC LIMIT 10`).all(ws.id)
Fix: Bulk-load segments and evidence for all session IDs in one JOIN query; hydrate in memory.
Impact: high
Risk: low
---
ID: F18
Symptom: Every session flush (3s debounce) triggers full-day attribution rebuild on main thread.
Location: src/main/services/tracking.ts:1088
Root cause: `flushPendingAttributionRefresh` calls `runAttributionForRange(fromMs, toMs, {}, db)` per affected date. Attribution deletes and reinserts all activity segments for the range (`attribution.ts:358-371`), loads all active rules (`438-444`), and runs `topBrowserEvidenceInRange` per browser slice (`233-235`). Then invalidates apps and insights scopes, triggering renderer refetches (F10).
Evidence: runAttributionForRange(fromMs, toMs, {}, db); invalidateProjectionScope('apps', 'attribution_refreshed', { date }); invalidateProjectionScope('insights', 'attribution_refreshed', { date })
Fix: Incremental attribution for changed session IDs only; increase debounce; move pipeline off hot path.
Impact: high
Risk: medium
---
ID: F19
Symptom: macOS users with browser-heavy workflows see periodic freezes every 5 seconds.
Location: src/main/services/browserContext.ts:107
Root cause: Tracking poll runs every 5s (`POLL_INTERVAL_MS = 5_000`). When a browser is foreground, `recordActiveBrowserContextSample` uses synchronous `execFileSync('osascript', ...)` with 1.5s timeout per sample. Separately, browser history poll at +5s launch copies each Chromium/Firefox History DB to temp and opens SQLite (`browser.ts:624-639`).
Evidence: const output = execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 1_500 }) ... for (const browser of browsers) { const { inserted, error } = browser.type === 'firefox' ? pollFirefox(browser, db) : pollChromium(browser, db)
Fix: Sample tabs at lower frequency; cache last tab; run AppleScript and history polls in worker threads.
Impact: high
Risk: medium
---
ID: F20
Symptom: App launch blocked on database work; window appears late.
Location: src/main/index.ts:745
Root cause: `initDb()` is synchronous and runs schema exec, migrations, `ensureAIThreadSchema`, `syncDerivedStateMetadata`, and both repair passes (F2, F3) before `createWindow()` at line 771. Entire `SCHEMA_SQL` (~704 lines) parsed every launch (`database.ts:32-33`).
Evidence: initDb() ... mainWindow = createWindow()
Fix: Open window after minimal DB open + pragma; defer migrations/repairs to post-first-paint idle work with splash/progress.
Impact: high
Risk: medium
---
ID: F21
Symptom: After app upgrade, first launch may wipe and rebuild all timeline projections.
Location: src/main/core/projections/metadata.ts:75
Root cause: `syncDerivedStateMetadata` compares component versions; if any changed component is in `DERIVED_STATE_RESET_COMPONENTS`, `resetDerivedState` DELETEs timeline_blocks, artifacts, workflow data, and work_context_observations synchronously at startup (`6-17`).
Evidence: if (changed.some((component) => DERIVED_STATE_RESET_COMPONENTS.has(component))) { resetDerivedState(db, `Derived state version changed: ${changed.join(', ')}`) }
Fix: Defer destructive reset to background job; scope reset per component instead of broad DELETE.
Impact: high
Risk: high
---
ID: F22
Symptom: Session range queries pull more rows than the visible day requires.
Location: src/main/db/queries.ts:534
Root cause: `getAppSummariesForRange`, `getSessionsForRange`, and related loaders query `start_time >= fromMs - 172800000` (48-hour lookback) then clip in JS. With only `idx_app_sessions_start`, the extra 48h of rows are scanned on every timeline/apps IPC call. Same path uses `SELECT *` pulling all columns.
Evidence: .prepare(`SELECT * FROM app_sessions WHERE start_time >= ? AND start_time < ? AND COALESCE(end_time, start_time + duration_sec * 1000) > ?`).all(fromMs - 172800000, toMs, fromMs)
Fix: Narrow query to true overlap window; select only needed columns; add composite index if overlap predicate cannot be simplified.
Impact: medium
Risk: low
---
ID: F23
Symptom: Every session query also reads all category overrides from SQLite.
Location: src/main/db/queries.ts:532
Root cause: `getCategoryOverrides(db)` runs `SELECT bundle_id, category FROM category_overrides` on every call to `getAppSummariesForRange` and `getSessionsForRange`—both hot paths for timeline and apps. Overrides change rarely but invalidate three scopes when they do (`db.handlers.ts:391-393`).
Evidence: export function getAppSummariesForRange(...) { const overrides = getCategoryOverrides(db); const rows = db.prepare(`SELECT * FROM app_sessions WHERE ...`)
Fix: Cache overrides in main-process memory; invalidate cache only from override IPC handlers.
Impact: medium
Risk: low
---
ID: F24
Symptom: Focus session queries on timeline days may scan full table on heavy focus-capture users.
Location: src/main/db/queries.ts:2024
Root cause: `getFocusSessionsForDateRange` filters by `start_time` range but `focus_sessions` table has no index on `start_time` (`schema.ts:38-47`). Called from every `getTimelineDayPayload` (`3113`).
Evidence: SELECT * FROM focus_sessions WHERE end_time IS NOT NULL AND start_time >= ? AND start_time < ?
Fix: Add `CREATE INDEX idx_focus_sessions_start ON focus_sessions (start_time)`.
Impact: medium
Risk: low
---
ID: F25
Symptom: Block member lookups in persisted-day loaders cannot use an optimal index.
Location: src/main/db/schema.ts:242
Root cause: `timeline_block_members` has index on `(member_type, member_id)` but hot queries filter `WHERE block_id = ?` (F6, F7 lightweight path). Reverse lookups by block_id require full index scan or table scan.
Evidence: CREATE INDEX IF NOT EXISTS idx_timeline_block_members_member ON timeline_block_members (member_type, member_id);
Fix: Add `CREATE INDEX idx_timeline_block_members_block ON timeline_block_members (block_id)`.
Impact: medium
Risk: low
---
ID: F26
Symptom: Command palette and AI history search feel sluggish while typing.
Location: src/main/db/queries.ts:801
Root cause: `searchAll` runs four separate FTS5 queries (sessions, blocks, browser, artifacts), merges, sorts, and slices. Command palette debounces 120ms per keystroke (`CommandPalette.tsx:74`); Insights local search debounces 180ms (`Insights.tsx:937`). AI tools broadened search loops tokens × 2 FTS calls (`aiTools.ts:744-762`).
Evidence: return [ ...searchSessions(db, query, { ...opts, limit }), ...searchBlocks(db, query, { ...opts, limit }), ...searchBrowser(db, query, { ...opts, limit }), ...searchArtifacts(db, query, { ...opts, limit }) ].sort((left, right) => right.startTime - left.startTime).slice(0, limit)
Fix: Single ranked FTS pass with early exit; search highest-yield tables first.
Impact: medium
Risk: low
---
ID: F27
Symptom: Timeline IPC responses are large and slow to structured-clone across the Electron boundary.
Location: src/main/services/workBlocks.ts:3110
Root cause: `getTimelineDayPayload` returns full `sessions`, `websites`, `blocks` (each with nested sessions, artifacts, websites, label metadata), `segments`, and `focusSessions` in one object. Week view (F8), Day Wrapped (F9), and recap (F7) multiply this by N parallel invokes. No slim/summary mode exists.
Evidence: return { date: dateStr, sessions, websites, blocks, segments, focusSessions, computedAt: Date.now(), version: TIMELINE_HEURISTIC_VERSION, totalSeconds, focusSeconds, focusPct: ..., appCount: ..., siteCount: ... }
Fix: Add projection modes (summary-only vs detail) so consumers request only fields they render.
Impact: medium
Risk: medium
---
ID: F28
Symptom: Apps view on Today polls two IPC channels every 30 seconds.
Location: src/renderer/views/Apps.tsx:168
Root cause: `appsResource` sets `intervalMs: isAppsToday ? 30_000 : 0` and parallel-fetches `getAppSummaries` + `getLiveSession`. Each poll triggers F22/F23 query paths; invalidation from F10 can stack on top of timer polls. `useProjectionResource` sets `reloading: true` even when payload unchanged (`useProjectionResource.ts:66-67`).
Evidence: intervalMs: isAppsToday ? 30_000 : 0, load: async () => { const summariesP = ... ipc.db.getAppSummaries(...); const liveP = isAppsToday ? ipc.tracking.getLiveSession() : Promise.resolve(null); const [summaries, live, digest] = await Promise.all([summariesP, liveP, digestP])
Fix: Deep-equal check before setState; single IPC returning summaries + live session; pause poll when window hidden.
Impact: medium
Risk: low
---
ID: F29
Symptom: Settings page mount triggers 8+ parallel IPC calls including 30-day app summary walk.
Location: src/renderer/views/Settings.tsx:588
Root cause: Mount effect fires in parallel: `settings.get`, `detectCliTools`, `getDiagnostics`, `sync.getStatus`, `getAppSummaries(30)`, `getCategoryOverrides`, `getWorkMemorySummary`, `getDefaultUserName`. `getAppSummaries(30)` hits `getCachedRangeAppSummaries` which loops 30 days (`db.handlers.ts:110-126`). Diagnostics then poll every 5s (`631-639`).
Evidence: void ipc.db.getAppSummaries(30).catch(() => []).then((summaries) => { setRecentApps(...) }) ... const timer = window.setInterval(() => { void refresh() }, 5_000)
Fix: Lazy-load sections on scroll/expand; cache 30-day summaries; pause diagnostics poll when tab hidden.
Impact: medium
Risk: low
---
ID: F30
Symptom: Scrubbing blocks in Timeline inspector repeatedly refetches the full client list.
Location: src/renderer/views/Timeline.tsx:970
Root cause: `BlockInspector` `useEffect` depends on `[block?.id]` and calls `ipc.attribution.listClientsDetailed()` on every block selection change, even though client list is stable across blocks on the same day.
Evidence: useEffect(() => { void ipc.attribution.listClientsDetailed().then((rows) => setClients(rows.filter((row) => row.status === 'active').map(...))).catch(() => setClients([])) }, [block?.id])
Fix: Fetch client list once when Timeline mounts; pass as prop to BlockInspector.
Impact: medium
Risk: low
---
ID: F31
Symptom: Selecting a block re-renders every row on a busy timeline day.
Location: src/renderer/views/Timeline.tsx:2095
Root cause: `TimelineRow` is not memoized. Parent passes fresh inline `onSelect={() => { setSelectedBlockId(segment.blockId) }}` each render, defeating any future memo. Full segment list renders with no virtualization (`2087-2107`); each row includes styled layout and `AppIcon`/`EntityIcon` children.
Evidence: <TimelineRow ... onSelect={() => { if (segment.kind === 'work_block') { setSelectedBlockId(segment.blockId) } }} />
Fix: Memoize TimelineRow; use event delegation on container (`onClickCapture` already exists at 2076) for selection instead of per-row callbacks.
Impact: medium
Risk: low
---
ID: F32
Symptom: AI chat streaming still causes heavy main-thread work per chunk despite external store fix.
Location: src/renderer/views/Insights.tsx:201
Root cause: `StreamingMessage` isolates re-renders (`streamingStore.ts:1-11`) but each chunk still re-renders `StreamingMessage` and runs full `MarkdownMessage` parse: `content.split(/\n{2,}/)`, regex inline parsing (`inlineNodes` at `68-86`), table detection. Parent passes fresh inline `renderContent={(text) => <MarkdownMessage content={text} />}` (`1809-1817`), busting memo. `scrollIntoView` fires on every message/loading change (`1182-1184`) plus per-chunk via `scrollToBottom` (`1456-1458`).
Evidence: function MarkdownMessage({ content }: { content: string }) { const blocks = content.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean) ... renderContent={(text) => <MarkdownMessage content={text} />}
Fix: Memoize MarkdownMessage on content; plain-text mode while pending; throttle scroll to animation frame.
Impact: medium
Risk: low
---
ID: F33
Symptom: Typing in AI composer lags with long conversation mounted.
Location: src/renderer/views/insights/AICompose.tsx:26
Root cause: Auto-resize effect keyed on `[input]` sets height to auto then reads `scrollHeight` every keystroke—forced synchronous reflow. Comment at line 22-25 acknowledges cost. AICompose is memoized (`110-114`) but parent `loading` prop still triggers re-renders.
Evidence: useEffect(() => { textarea.style.height = 'auto'; const contentHeight = textarea.scrollHeight; textarea.style.height = `${Math.min(Math.max(contentHeight, 24), 140)}px` }, [input])
Fix: CSS-based auto-grow or measure via ResizeObserver debounced to animation frame.
Impact: medium
Risk: low
---
ID: F34
Symptom: Any state change in AI tab re-renders hero, recap, thread picker, files panel, and composer shell together.
Location: src/renderer/views/Insights.tsx:1076
Root cause: ~2,600-line god component holds 20+ `useState` hooks (messages, loading, threads, artifacts, hero summary, recap period, action feedback, focus drafts, thread picker, etc.). `messageListItems` useMemo depends on `messageActionState`, `actionFeedback`, `focusReviewDrafts` (`2099`)—rating one message rebuilds entire message list JSX. Duplicate settings load: App already has settings (`App.tsx:242`); Insights refetches via `insightsResource` (`1121`) and copies to local state (`1170-1174`).
Evidence: const [messages, setMessages] = useState<ThreadMessage[]>([]); const [loading, setLoading] = useState(false); ... const [threadPickerFocusIdx, setThreadPickerFocusIdx] = useState(0)
Fix: Split into ChatThread, RecapHero, ThreadPicker, FilesPanel with colocated state; narrow memo deps to per-message components.
Impact: medium
Risk: medium
---
ID: F35
Symptom: App list sidebar jank when scrolling; many icon IPC calls on mount.
Location: src/renderer/views/Apps.tsx:624
Root cause: No list virtualization—every app row renders with `EntityIcon` which calls `useResolvedIcon` → `ipc.icons.resolve` per icon (`useResolvedIcon.ts:62`). Each resolve may read disk/fetch and return base64 `dataUrl` over structured clone. Timeline and Apps both lack react-window/virtual equivalent (zero matches in renderer).
Evidence: {items.map((summary) => { return (<button key={key} ...><EntityIcon appName={...} bundleId={...} /></button>) })}
Fix: Virtualize long lists; resolve icons lazily for visible rows only; serve file:// URLs instead of base64 over IPC.
Impact: medium
Risk: medium
---
ID: F36
Symptom: Each completed chat turn triggers redundant thread list fetch.
Location: src/renderer/views/Insights.tsx:1196
Root cause: `useEffect` on `[messages.length]` calls `ipc.ai.listThreads` after every message count change. `handleSend` also calls `listThreads` after send completes (`1392-1401`). Thread picker renders full list with hover/delete UI, no pagination (`2404+`).
Evidence: useEffect(() => { ipc.ai.listThreads({ includeArchived: false }).then((rows) => { setThreads(rows); setActiveThreadId((current) => current ?? rows[0]?.id ?? null) }) }, [messages.length])
Fix: Update thread metadata optimistically from send response; debounce list refresh.
Impact: medium
Risk: low
---
ID: F37
Symptom: Insights mount/reload bundles 5+ IPC calls including full today timeline.
Location: src/renderer/views/Insights.tsx:1128
Root cause: `insightsResource.load` parallel-fetches: settings.get, getHistory, detectCliTools, N×hasApiKey, getTimelineDay(today), focus.getActive. Any insights-scope invalidation (F10, settings AI changes at `settings.handlers.ts:50-52`) reruns entire bundle. Separate `recapResource` adds F7 on timeline scope invalidation.
Evidence: const [history, cliToolsResult, apiProviderAccessChecks, today, activeFocusSession] = await Promise.all([ ... ipc.db.getTimelineDay(todayString()).catch(() => null), ipc.focus.getActive().catch(() => null), ])
Fix: Split stable probes from timeline payload; cache today's summary independently from chat invalidation.
Impact: medium
Risk: medium
---
ID: F38
Symptom: Focus capture generates high WAL churn on dense tab-switching.
Location: src/main/services/focusCapture.ts:169
Root cause: Native helper emits JSON lines; each event calls `insertEvent()` with immediate `db.prepare().run()`—no batching. Feeds into `projectDay`/`focus_events` table which startup finalize processes (F11).
Evidence: try { insertEvent(ev) (called for each parsed helper event line)
Fix: Batch inserts in a transaction every 250ms or N events; flush on shutdown.
Impact: medium
Risk: low
---
ID: F39
Symptom: Windows startup hitches; recurring 15s process list stalls.
Location: src/main/services/processMonitor.ts:48
Root cause: `startProcessMonitor()` runs synchronously at startup (`index.ts:746`) and uses `execSync('wmic ...')` immediately, then every `PROCESS_POLL_MS`. Snapshot served to diagnostics IPC.
Evidence: latestSnapshot = getRunningProcesses(); monitorInterval = setInterval(() => { latestSnapshot = getRunningProcesses() }, PROCESS_POLL_MS)
Fix: Async spawn; lazy-start monitor only when diagnostics requested; longer interval.
Impact: medium
Risk: low
---
ID: F40
Symptom: iMessage capture adds startup IO on macOS when enabled.
Location: src/main/services/imessageCapture.ts:70
Root cause: Unlike browser tracking (deferred 5s—`index.ts:328-329`), iMessage scheduler runs `syncImessageCapture()` immediately on start, opening `~/Library/Messages/chat.db` with JOIN query before window is interactive.
Evidence: export function startImessageCaptureScheduler(): void { void syncImessageCapture(); pollTimer = setInterval(() => { void syncImessageCapture() }, POLL_MS)
Fix: Defer first sync 5–10s after window; backoff on permission errors.
Impact: medium
Risk: low
---
ID: F41
Symptom: MCP enabled adds second Electron process and spawn cost at startup.
Location: src/main/services/mcpServer.ts:68
Root cause: `startMcpServer()` spawns packaged Electron during `whenReady` if `mcpServerEnabled` (`index.ts:748-750`).
Evidence: _proc = spawn(config.command, config.args, { env: { ...process.env, ...config.env }, stdio: ['pipe', 'pipe', 'pipe'] })
Fix: Lazy-start MCP on first client connection.
Impact: medium
Risk: low
---
ID: F42
Symptom: Settings toggling AI provider/key reloads entire Insights projection.
Location: src/main/ipc/settings.handlers.ts:50
Root cause: Settings SET handler calls `invalidateProjectionScope('insights', ...)` on AI model/provider changes and API key set/clear (`95-96`, `101`). Category/block overrides triple-invalidate timeline/apps/insights (`db.handlers.ts:391-393`). No debounce on invalidation broadcast (`invalidation.ts:13-16` sends to all windows).
Evidence: invalidateProjectionScope('insights', 'ai_settings_changed')
Fix: Narrow invalidation to affected sub-resources; debounce broadcast.
Impact: medium
Risk: low
---
ID: F43
Symptom: Rebuild timeline day button blocks IPC handler for long periods.
Location: src/main/ipc/db.handlers.ts:333
Root cause: `REBUILD_TIMELINE_DAY` loops blocks, `await generateWorkBlockInsight` per eligible block sequentially, then triple-invalidates scopes (`352-356`). Renderer calls from Timeline regenerate UI (`Timeline.tsx:712`).
Evidence: for (const block of payload.blocks) { if (!shouldReanalyzeBlockWithAI(block)) continue; attempted++; try { const insight = await generateWorkBlockInsight(...); changed = applyAIInsightToTimelineBlock(db, block, insight) || changed
Fix: Queue rebuild as background job with progress events; return immediately.
Impact: medium
Risk: medium
---
ID: F44
Symptom: Regenerate block label ships entire WorkContextBlock over IPC.
Location: src/main/ipc/ai.handlers.ts:112
Root cause: Renderer passes full block object (`Timeline.tsx:1116`); handler runs AI + SQLite updates. Block includes nested sessions, artifacts, websites, label metadata—large structured-clone payload for one click.
Evidence: ipcMain.handle(IPC.AI.REGENERATE_BLOCK_LABEL, async (_e, block: WorkContextBlock) => { ... generateWorkBlockInsight(block, ...) })
Fix: Pass blockId only; load block on main side.
Impact: medium
Risk: low
---
ID: F45
Symptom: Lazy route navigation discards renderer cache and refetches everything.
Location: src/renderer/App.tsx:19
Root cause: Timeline, Apps, Insights, Settings are `lazy()` imports. Switching sidebar routes unmounts view; `useProjectionResource` runs full `refresh()` on remount (`useProjectionResource.ts:95-98`). No cross-route data cache except icon renderer cache.
Evidence: const Timeline = lazy(() => import('./views/Timeline')); ... useEffect(() => { if (enabled) { void refresh() } }, [enabled, ...dependencies])
Fix: Keep mounted views alive (display:none) or shared query cache keyed by scope+date.
Impact: medium
Risk: medium
---
ID: F46
Symptom: `getPeakHours` and similar analytics scan sessions twice.
Location: src/main/db/queries.ts:873
Root cause: First query loads all session start times for distinct-day count; then `getHourlyBreakdown` scans `app_sessions` again with JOIN to category_overrides.
Evidence: const dayRows = db.prepare(`SELECT start_time, app_name FROM app_sessions WHERE start_time >= ? AND start_time < ?`).all(fromMs, toMs); ... const hourlyBreakdown = getHourlyBreakdown(db, fromMs, toMs)
Fix: Single grouped SQL query returning hourly buckets and distinct days.
Impact: low
Risk: low
---
ID: F47
Symptom: `tableExists()` hits sqlite_master repeatedly in warm paths.
Location: src/main/ipc/db.handlers.ts:129
Root cause: `getWorkMemorySettingsSummary`, `forgetWorkMemoryPattern`, and `gatherConcurrentEvidence` each call `tableExists` → `SELECT name FROM sqlite_master` per invocation. Called from settings IPC and per-block during F14.
Evidence: function tableExists(db, tableName) { const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`).get(tableName)
Fix: Cache table-existence set at initDb time.
Impact: low
Risk: low
---
ID: F48
Symptom: macOS packaged startup pays subprocess cost for ad-hoc codesign probe.
Location: src/main/services/updater.ts:77
Root cause: `initUpdater` path calls `getAutoUpdateSupport()` → `isMacAdhocSigned()` using synchronous `spawnSync('/usr/bin/codesign', ['-dv', appBundlePath])`.
Evidence: const result = spawnSync('/usr/bin/codesign', ['-dv', appBundlePath], { encoding: 'utf8' })
Fix: Cache ad-hoc result in userData manifest at install time.
Impact: low
Risk: low
---
ID: F49
Symptom: Keychain/credential read adds latency before first window on non-CLI AI setups.
Location: src/main/index.ts:735
Root cause: `APP_LAUNCHED` analytics awaits `hasApiKey(launchProvider)` before `initDb()` and window creation path completes—network/keychain latency on critical path.
Evidence: const hasAiProvider = launchProvider === 'claude-cli' || launchProvider === 'codex-cli' ? true : await hasApiKey(launchProvider)
Fix: Fire analytics after window show; cache key presence in memory.
Impact: low
Risk: low
---
ID: F50
Symptom: Settings page re-renders entirely on any toggle; 28+ state slices in one component.
Location: src/renderer/views/Settings.tsx:551
Root cause: Monolithic Settings holds separate state for AI, sync, MCP, work memory, clients, categories, updater, tracking diagnostics, etc. Toggling one client color re-renders all sections. Mirrors Insights god-component pattern (F34).
Evidence: const [settings, setSettings] = useState<AppSettings | null>(null); const [hasApiKey, setHasApiKey] = useState(false); ... (28 useState declarations through editingClientColor)
Fix: Split into section components with isolated state; memoize heavy sections.
Impact: medium
Risk: medium
---
ID: F51
Symptom: CommandPalette hooks run even when palette is closed.
Location: src/renderer/components/CommandPalette.tsx:47
Root cause: Component mounted from AppContent always; only JSX returns null when closed (`244`). Search debounce effect registers when open but component still re-renders on parent state changes (F3 AppContent modal state).
Evidence: export default function CommandPalette({ isOpen, ... }) { const [query, setQuery] = useState('') ... if (!isOpen) return null
Fix: Conditionally mount palette (portal) only when `paletteOpen` is true.
Impact: low
Risk: low
---
ID: F52
Symptom: Day Wrapped slide animations schedule multiple RAF loops simultaneously.
Location: src/renderer/components/DayWrapped.tsx:166
Root cause: `useCountUp` runs `requestAnimationFrame` + setState for ~850ms per numeric display. Used on multiple slides (lines 419-420, 472-474, 532-533, 622-623, 678, 740, 1097-1098). Click handler reads `getBoundingClientRect` on every slide advance (`1672-1676`).
Evidence: function useCountUp(target: number, duration = 850): number { ... function tick(now: number) { setVal(Math.round(...)); if (t < 1) raf = requestAnimationFrame(tick)
Fix: Single shared animation driver; use CSS transitions for numeric reveals.
Impact: low
Risk: low
---
ID: F53
Symptom: Windows backfill may insert duplicate sessions on repeated launches.
Location: src/main/services/windowsHistory.ts:139
Root cause: `backfillWindowsHistory` runs 5s after startup (`index.ts:331`) with no "already backfilled" cursor; loops up to 2000 ActivityCache rows calling `insertAppSession` each without dedup key.
Evidence: for (const row of rows) { ... insertAppSession(mainDb, { bundleId, appName, startTime: startMs, endTime: endMs, ... }); totalImported++ }
Fix: Track backfill cursor in settings; use INSERT OR IGNORE on (bundle_id, start_time).
Impact: medium
Risk: medium
---
ID: F54
Symptom: First launch after v21 migration can freeze during FTS rebuild.
Location: src/main/db/migrations.ts:299
Root cause: `ensureSearchSchema` ends with FTS5 rebuild on all four virtual tables—full reindex of sessions, blocks, browser, artifacts. Runs synchronously inside migration transaction on upgrade path.
Evidence: INSERT INTO app_sessions_fts(app_sessions_fts) VALUES ('rebuild'); INSERT INTO timeline_blocks_fts(timeline_blocks_fts) VALUES ('rebuild'); INSERT INTO website_visits_fts(website_visits_fts) VALUES ('rebuild'); INSERT INTO ai_artifacts_fts(ai_artifacts_fts) VALUES ('rebuild');
Fix: Background incremental FTS rebuild with progress flag; degrade search gracefully until complete.
Impact: high
Risk: medium
---
ID: F55
Symptom: Phantom startup timer at +10s still scheduled despite no-op implementation.
Location: src/main/db/dailySummaries.ts:30
Root cause: `computeAllMissingSummaries` is a stub after v14 removed `daily_summaries`, but `index.ts:345` still invokes it inside the 10s startup timer block—misleading and adds unnecessary try/catch overhead adjacent to real finalize work (F11).
Evidence: export function computeAllMissingSummaries(): void { // no-op } ... setTimeout(() => { try { computeAllMissingSummaries() } catch ... setTimeout(() => finalizePreviousDay(), 0) }, 10_000)
Fix: Remove dead call site and stub module.
Impact: low
Risk: low
---
ID: F56
Symptom: App settings fetched twice on cold start before interactive UI.
Location: src/renderer/App.tsx:249
Root cause: App blocks render until `ipc.settings.get()` completes. Navigating to Settings runs another full fetch (`Settings.tsx:588-590`). Handler returns full `AppSettings` object; SET handler reloads previous settings for diff (`settings.handlers.ts:29-35`).
Evidence: ipc.settings.get().then((s) => { applyTheme(s.theme); setSettings(s) }) ... void ipc.settings.get().then((next) => { setSettings(next) }) (Settings mount)
Fix: Pass settings from App context to Settings view; avoid duplicate invoke.
Impact: low
Risk: low
---
ID: F57
Symptom: Sidebar nav links recreate style objects every render.
Location: src/renderer/components/Sidebar.tsx:65
Root cause: `NavLink` receives inline `style={({ isActive }) => ({ display: 'flex', ... })}` function creating new objects per link per render. AppContent parent re-renders on palette/wrapped/feedback state (F3).
Evidence: <NavLink to={to} style={({ isActive }) => ({ display: 'flex', alignItems: 'center', gap: 8, ... })}
Fix: Extract static classNames or memoize style callback per route.
Impact: low
Risk: low
---
ID: F58
Symptom: AI artifact preview can transfer very large strings over IPC.
Location: src/main/ipc/ai.handlers.ts:196
Root cause: `getArtifact` handler calls `readArtifactContent` which reads filesystem or large inline SQL blob and returns full content string to renderer for preview.
Evidence: ipcMain.handle(IPC.AI.GET_ARTIFACT, async (_e, artifactId: number) => { ... return readArtifactContent(record) })
Fix: Stream or paginate large artifacts; preview first N KB only.
Impact: medium
Risk: low
---
ID: F59
Symptom: Wrapped narrative invoke rebuilds full timeline then calls AI synchronously.
Location: src/main/ipc/ai.handlers.ts:86
Root cause: `GET_WRAPPED_NARRATIVE` calls `getTimelineDayPayload` then AI generation in one handler. Renderer `DayWrapped` triggers via `ipc.ai.getWrappedNarrative` (`DayWrapped.tsx:1548`).
Evidence: const dayPayload = getTimelineDayPayload(getDb(), payload.date, liveSession); ... return generateWrappedNarrative(...)
Fix: Use cached day summary; queue narrative generation asynchronously.
Impact: medium
Risk: low
---
ID: F60
Symptom: Attribution evidence search uses non-indexable LIKE scans.
Location: src/main/core/query/attributionResolvers.ts:1109
Root cause: `resolveEvidenceBackedQuery` runs `LOWER(COALESCE(ws.title, '')) LIKE ?` and same on evidence values across joined work_sessions/work_session_evidence—full scan in range.
Evidence: WHERE ws.started_at >= ? AND ws.started_at < ? AND (LOWER(COALESCE(ws.title, '')) LIKE ? OR LOWER(COALESCE(wse.evidence_value, '')) LIKE ?)
Fix: FTS index on titles/evidence or prefix-only search with dedicated index.
Impact: medium
Risk: medium
---
