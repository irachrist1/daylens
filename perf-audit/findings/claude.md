ID: F1
Symptom: Every cold launch stalls before the window is interactive, and the stall grows the longer the user has had Daylens installed (more tracked history = longer freeze).
Location: src/main/services/database.ts:48 → src/main/core/projections/metadata.ts:111-170
Root cause: `repairStoredIdentityColumns()` runs unconditionally inside `initDb()` on every launch. It does `SELECT id, bundle_id, app_name FROM app_sessions` (no WHERE) and `SELECT id, browser_bundle_id, url FROM website_visits` (no WHERE), then UPDATEs every single row, re-resolving canonical identity per row. This is a full rewrite of the two largest tables on each boot, even when nothing drifted.
Evidence: `const sessionRows = db.prepare(\`SELECT id, bundle_id, app_name FROM app_sessions\`).all()` then `for (const row of sessionRows) { ... updateSession.run(...) }` (metadata.ts:112-158); called every launch at `repairStoredIdentityColumns(_db)` (database.ts:48) with no version/dirty guard around it.
Fix: Guard the repair behind a one-time schema-version flag (it is a backfill, not a per-launch invariant) so it runs once after the migration that introduced the columns, not on every boot.
Impact: high
Risk: low

ID: F2
Symptom: Opening the Timeline or History on any past day is sluggish, and revisiting the same untouched past day is just as slow every time — it never feels "cached."
Location: src/main/core/query/projections.ts:109-153 (getDerivedDayTimelinePayload)
Root cause: The derived (past-day) read path always calls `buildTimelineBlocksFromSessions()` (full coalescing pipeline) and then `persistTimelineDay()` (a write transaction that re-invalidates and re-inserts every block row) on every read. Unlike the today path (`buildTimelineBlocksForDay`, workBlocks.ts:2824-2841) it has no "already persisted on current heuristic → return as-is" short circuit, so a read performs the entire rebuild plus a full DB rewrite each time.
Evidence: `const blocks = buildTimelineBlocksFromSessions(db, sessions)` immediately followed by `persistTimelineDay(db, dateStr, blocks)` (projections.ts:122,131), reached for every past day via `getTimelineDayProjection` (projections.ts:160-163).
Fix: In `getDerivedDayTimelinePayload`, reuse the persisted-and-current-heuristic fast path (as `buildTimelineBlocksForDay` does) and only rebuild+persist when the stored day is missing or stale.
Impact: high
Risk: medium

ID: F3
Symptom: While viewing today's Timeline the app does a periodic hitch every 30 seconds, worsening as the day accumulates sessions; CPU and disk spike on each tick.
Location: src/renderer/views/Timeline.tsx:1787-1793 + src/main/services/workBlocks.ts:2824-2841, 2419-2540
Root cause: The today resource polls `ipc.db.getTimelineDay(date)` every 30s. For today, `buildTimelineBlocksForDay` skips the persisted cache (`dateStr < todayStr` is false) and unconditionally runs `buildBlocksForSessions(...)` then `persistTimelineDay(...)`, which inside a transaction invalidates all of the day's `timeline_blocks`, re-`finalizedLabelForBlock`s each block, and re-INSERTs every block plus its members/labels — even when no session changed since the last tick.
Evidence: `intervalMs: isToday ? 30_000 : 0` (Timeline.tsx:1791); `const computed = buildBlocksForSessions(db, sessions).map(...); persistTimelineDay(db, dateStr, computed); return computed` (workBlocks.ts:2839-2841); per-tick rewrite loop `for (const rawBlock of blocks) { ... db.prepare(INSERT ... timeline_blocks ...) }` (workBlocks.ts:2441-2499).
Fix: Cache the computed blocks keyed by a hash of the day's session rows and only recompute/persist when that hash changes between polls (or persist at most once per real session change, not per read).
Impact: high
Risk: medium

ID: F4
Symptom: Switching the Apps view to "7 days" or "30 days" takes seconds to render the list, and the window is unresponsive while it loads.
Location: src/main/ipc/db.handlers.ts:447-461 (GET_APP_ACTIVITY_DIGEST)
Root cause: The handler loops over every day in the range and calls `getTimelineDayProjection(db, dateStr, ...)` per day. Each of those calls is the full block rebuild + DB rewrite from F2/F3, so a 30-day digest performs ~30 complete timeline reconstructions and ~30 persist transactions in one synchronous IPC call on the main thread.
Evidence: `for (let offset = 0; offset < dayCount; offset++) { ... const payload = getTimelineDayProjection(db, dateStr, getLiveSessionForDate(dateStr)); for (const block of payload.blocks) blocks.push(block) }` (db.handlers.ts:453-459).
Fix: Read the already-persisted `timeline_blocks` for the date range in a single query for the digest, instead of re-running `getTimelineDayProjection` (which rebuilds and rewrites) once per day.
Impact: high
Risk: medium

ID: F5
Symptom: The Clients/work-session views and any app's "work sessions" list are slow to open and get slower as tracked history grows, independent of how many sessions are shown.
Location: src/main/ipc/db.handlers.ts:198-208 (buildAppNameMap) and 246-294 (buildWorkSessionPayloads)
Root cause: Two problems on the same path. (1) `buildAppNameMap` runs `SELECT DISTINCT bundle_id, app_name FROM app_sessions WHERE bundle_id NOT IN (SELECT bundle_id FROM apps)` — a full scan of the entire (large) `app_sessions` table with a correlated NOT IN — on every work-session IPC call. (2) `buildWorkSessionPayloads` is N+1: for each work session it issues a separate members query and a separate evidence query, plus a per-id query for each distinct client and project.
Evidence: `db.prepare(\`SELECT DISTINCT bundle_id, app_name FROM app_sessions WHERE bundle_id NOT IN (SELECT bundle_id FROM apps)\`).all()` (db.handlers.ts:202); inside `rows.map(ws => { const members = db.prepare(... WHERE wss.work_session_id = ?).all(ws.id); ... const evidence = db.prepare(... WHERE work_session_id = ?).all(ws.id) })` (db.handlers.ts:247-272); per-entity lookups `for (const cid of clientIds) { db.prepare(\`SELECT name, color FROM clients WHERE id = ?\`).get(cid) }` (db.handlers.ts:237-244).
Fix: Drop the `app_sessions` NOT IN scan (resolve unknown bundle ids lazily), and batch the member/evidence/client/project lookups into single `WHERE ... IN (...)` queries grouped in memory.
Impact: high
Risk: medium

ID: F6
Symptom: Building any day's timeline (today poll, past-day open, digests) is disproportionately slow on days with lots of browsing, beyond what the session count alone would suggest.
Location: src/main/services/workBlocks.ts:1241-1258 (buildPageCandidates) called at 1493 and 1714
Root cause: `buildPageCandidates` calls `getWebsiteVisitsForRange(db, startTime, endTime)` and is invoked once per block in `buildBlockFromCandidate` (line 1493) AND again from `candidatePageArtifacts` (line 1714) during the coalesce/bridge merge evaluations. So a single day build issues many `website_visits` range queries — proportional to block count and to merge-pass comparisons — instead of fetching the day's visits once.
Evidence: `for (const visit of getWebsiteVisitsForRange(db, startTime, endTime)) { ... }` (workBlocks.ts:1258); `const pageCandidates = buildPageCandidates(db, blockStart, blockEnd)` (workBlocks.ts:1493); `return buildPageCandidates(db, ...)` inside `candidatePageArtifacts` (workBlocks.ts:1713-1714) used by coalesce predicates.
Fix: Fetch the day's `website_visits` once and pass the in-memory rows down to per-block/per-candidate page-candidate construction instead of re-querying per block and per merge check.
Impact: medium
Risk: medium

ID: F7
Symptom: Past-day timeline reads do roughly twice the label-finalization work they need to, each pass hitting the DB per block.
Location: src/main/services/workBlocks.ts:2001 and 2443
Root cause: On the derived/persist path each block is finalized twice. `buildTimelineBlocksFromSessions` maps every block through `finalizedLabelForBlock` (line 2001); the result is then passed to `persistTimelineDay`, which calls `finalizedLabelForBlock(db, rawBlock)` again for every block (line 2443). `finalizedLabelForBlock` is not cheap: it runs `getBlockLabelOverride` (a query) and, for focused blocks, `gatherConcurrentEvidence` + `matchPromotedPatterns` (more queries) per block.
Evidence: `return buildBlocksForSessions(db, sessions).map((block) => finalizedLabelForBlock(db, block))` (workBlocks.ts:2001); within the persist loop `const block = finalizedLabelForBlock(db, rawBlock)` (workBlocks.ts:2443); per-block queries `const override = getBlockLabelOverride(db, block.id)` (2239) and `gatherConcurrentEvidence(db, block)` / `matchPromotedPatterns(db, block, ...)` (2250-2253).
Fix: Have `persistTimelineDay` accept already-finalized blocks (skip re-finalizing) when the caller has finalized them, or finalize once and persist that exact result.
Impact: medium
Risk: low

ID: F8
Symptom: Every Timeline poll and every week-view load also kicks off background AI scheduling work, multiplying main-process activity during normal browsing of the app.
Location: src/main/ipc/db.handlers.ts:318 + src/main/jobs/aiService.ts:5063-5077; week fan-out at src/renderer/views/Timeline.tsx:1425
Root cause: `GET_TIMELINE_DAY` calls `scheduleTimelineAIJobs(payload)` on every read. With the today poll firing every 30s, and the week view issuing `Promise.all(dates.map(date => ipc.db.getTimelineDay(date)))` for 7 dates on mount/refresh, `scheduleTimelineAIJobs` (which itself walks all blocks and calls `scheduleHistoryHeuristicUpgrade` / `scheduleOvernightCleanup`) runs far more often than the underlying data changes.
Evidence: `scheduleTimelineAIJobs(payload)` in the handler (db.handlers.ts:318); `for (const block of payload.blocks) { ... void runBlockInsightJob(...) } ... scheduleOvernightCleanup(...)` (aiService.ts:5070-5076); `const days = await Promise.all(dates.map((date) => ipc.db.getTimelineDay(date)))` (Timeline.tsx:1425).
Fix: Decouple AI scheduling from the read handler — trigger it on real data-change events (new finalized blocks) rather than on every `getTimelineDay`, and give the week view a dedicated lightweight multi-day endpoint that does not schedule AI per day.
Impact: medium
Risk: medium

ID: F9
Symptom: All the summary/timeline/apps aggregations are slower than the row counts suggest, with CPU spent in string work during every build and every IPC aggregation.
Location: src/main/lib/appIdentity.ts:88-123 (resolveCanonicalApp)
Root cause: `resolveCanonicalApp` is called once per session row in every aggregation loop (e.g. queries.ts:549, 563, 606, 612; workBlocks.ts:1081, 1431, 1557; chunk2.ts:655) but is not memoized. Although the normalization map itself is cached, each call rebuilds a 6-element candidate array, lowercases/strips multiple strings, and loops the candidates — repeated for the same (bundleId, appName) pairs thousands of times per render.
Evidence: `const candidates = [trimmedBundleId, trimmedBundleId.toLowerCase(), bundleBase, bundleBaseNoExe, lowerName, lowerNameNoExe].filter(Boolean)` then `for (const candidate of candidates) { ... }` runs on every call (appIdentity.ts:97-113); invoked per-row at `resolveCanonicalApp(session.bundleId, session.appName)` in summary loops (queries.ts:563, workBlocks.ts:1081).
Fix: Wrap `resolveCanonicalApp` in a `Map`-backed memo keyed by `bundleId|appName` (the inputs are highly repetitive), invalidated when the normalization map reloads.
Impact: medium
Risk: low

ID: F10
Symptom: While an AI answer streams in, the chat visibly stutters and scroll jumps on every token, more so for long reports/tables.
Location: src/renderer/views/insights/StreamingMessage.tsx:17-34 + src/renderer/views/Insights.tsx:201-212, 1456-1457
Root cause: `StreamingMessage` re-renders on every snapshot push and re-runs the full markdown parser over the entire accumulated text each time (`renderContent` → `MarkdownMessage`, which `content.split(/\n{2,}/)` and re-parses every block), making per-chunk cost grow with answer length (O(n²) over the stream). On top of that, each snapshot fires `onSnapshotUpdate` → `scrollToBottom` → `scrollIntoView`, forcing a layout/scroll on every token.
Evidence: `return <>{renderContent(snapshot)}</>` re-parses on each `useSyncExternalStore` update (StreamingMessage.tsx:34); `onSnapshotUpdate?.()` fired per snapshot length change (StreamingMessage.tsx:27-31); `MarkdownMessage` re-splits/re-renders the whole string each call (Insights.tsx:201-212); `bottomRef.current?.scrollIntoView({ behavior: 'auto' })` (Insights.tsx:1457).
Fix: Throttle streaming snapshot rendering and the scroll callback (e.g. one render/scroll per animation frame), and/or render the streaming body as plain text until the message finalizes, then parse markdown once.
Impact: medium
Risk: low

ID: F11
Symptom: Per-app drill-downs ("this app over 7/30 days") scan more rows than necessary as history grows.
Location: src/main/db/schema.ts:22 vs src/main/db/queries.ts:1650-1656 (getSessionsForApp)
Root cause: `app_sessions` has only `idx_app_sessions_start (start_time)`. `getSessionsForApp` filters `WHERE bundle_id = ? AND start_time >= ? AND start_time < ? AND COALESCE(...) > ?`, so SQLite uses the start-time index and then filters `bundle_id` row-by-row over the whole window rather than seeking directly to the app's rows.
Evidence: only `CREATE INDEX IF NOT EXISTS idx_app_sessions_start ON app_sessions (start_time)` exists (schema.ts:22); query `SELECT * FROM app_sessions WHERE bundle_id = ? AND start_time >= ? AND start_time < ? AND COALESCE(end_time, start_time + duration_sec * 1000) > ?` (queries.ts:1651-1655).
Fix: Add a composite index `CREATE INDEX idx_app_sessions_bundle_start ON app_sessions (bundle_id, start_time)`.
Impact: low
Risk: low
