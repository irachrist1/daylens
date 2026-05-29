ID: F1
Symptom: Severe application launch freeze or startup delay that degrades linearly as the user's tracking history grows over weeks and months.
Location: src/main/core/projections/metadata.ts:111
Root cause: The startup initialization synchronously executes the `repairStoredIdentityColumns` function, which performs full scans of the entire `app_sessions` and `website_visits` tables to load every row into memory, and then runs row-by-row updates on every single launch regardless of whether the database columns have already been repaired.
Evidence:
  const sessionRows = db.prepare(`
    SELECT id, bundle_id, app_name
    FROM app_sessions
  `).all() as Array<{
...
  const visitRows = db.prepare(`
    SELECT id, browser_bundle_id, url
    FROM website_visits
  `).all() as Array<{
...
  const tx = db.transaction(() => {
    for (const row of sessionRows) {
      const identity = resolveCanonicalApp(row.bundle_id, row.app_name)
      updateSession.run(
        identity.rawAppName,
        identity.canonicalAppId,
        identity.appInstanceId,
        row.id,
      )
    }
Fix: Move column repairs into a one-time database schema migration or execute them asynchronously in a low-priority background thread to keep startup fast.
Impact: high
Risk: low

ID: F2
Symptom: High startup lag and application freeze on launch, scaling with the size of tracking history.
Location: src/main/core/inference/appIdentityRegistry.ts:211
Root cause: During startup, `repairStoredAppIdentityObservations` is called synchronously inside `initDb()`, forcing SQLite to perform an expensive `GROUP BY` aggregation over the entire `app_sessions` table, load all aggregated records in-memory, and perform individual `SELECT` and `INSERT/UPDATE` operations for every group.
Evidence:
export function repairStoredAppIdentityObservations(db: Database.Database): void {
  const rows = db.prepare(`
    SELECT
      bundle_id,
      COALESCE(raw_app_name, app_name) AS raw_app_name,
      COALESCE(app_instance_id, bundle_id) AS app_instance_id,
      category,
      MIN(start_time) AS first_seen_at,
      MAX(COALESCE(end_time, start_time + duration_sec * 1000)) AS last_seen_at
    FROM app_sessions
    GROUP BY bundle_id, COALESCE(raw_app_name, app_name), COALESCE(app_instance_id, bundle_id), category
  `).all() as Array<{
...
  const tx = db.transaction(() => {
    for (const row of rows) {
      upsertAppIdentityObservation(db, {
Fix: Run app identity observation repairs as a one-time database migration or move the sequence to a background queue after startup.
Impact: high
Risk: low

ID: F3
Symptom: Severe typing lag or complete micro-freezes inside the AI chat prompt composer.
Location: src/renderer/views/insights/AICompose.tsx:26
Root cause: The auto-resize `useEffect` is bound to the `input` state and fires on every single keypress, setting `textarea.style.height = 'auto'` and immediately reading `textarea.scrollHeight` to recalculate size, triggering forced synchronous layouts (layout thrashing) that block the browser UI thread.
Evidence:
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const contentHeight = textarea.scrollHeight
    textarea.style.height = `${Math.min(Math.max(contentHeight, 24), 140)}px`
    textarea.style.overflowY = contentHeight > 140 ? 'auto' : 'hidden'
  }, [input])
Fix: Replace the layout-thrashing effect with a pure CSS auto-resize strategy or debounce layout property reads.
Impact: high
Risk: low

ID: F4
Symptom: Pronounced lag and slow loading of the timeline view, worsening on days with a high density of tracking blocks.
Location: src/main/services/workBlocks.ts:2656
Root cause: The timeline block reader `loadPersistedTimelineBlocksForDay` executes an N+1 query pattern inside its mapping loop, running three separate SQL queries (`timeline_block_labels`, and two `timeline_block_members` selections) for every block returned.
Evidence:
  for (const row of rows) {
...
    const labelRows = db.prepare(`
      SELECT label, source
      FROM timeline_block_labels
      WHERE block_id = ?
    `).all(row.id) as Array<{ label: string; source: string }>
...
    const memberRows = db.prepare(`
      SELECT member_id
      FROM timeline_block_members
      WHERE block_id = ? AND member_type = 'app_session'
    `).all(row.id) as Array<{ member_id: string }>
...
    const focusRows = db.prepare(`
      SELECT member_id, weight_seconds
      FROM timeline_block_members
      WHERE block_id = ? AND member_type = 'focus_session'
    `).all(row.id) as Array<{ member_id: string; weight_seconds: number }>
Fix: Bulk fetch labels and members using SQL `IN` operators or joins for the whole day, and map them to blocks in-memory to reduce query counts.
Impact: high
Risk: low

ID: F5
Symptom: Noticeable delay when loading or switching to the Client detail panels and work session timelines.
Location: src/main/ipc/db.handlers.ts:246
Root cause: The `buildWorkSessionPayloads` utility queries session segments and evidence inside a loop mapping over every retrieved work session record, causing a textbook N+1 query pattern.
Evidence:
  return rows.map(ws => {
    const members = db.prepare(`
      SELECT wss.role, wss.contribution_ms, aseg.primary_bundle_id
      FROM work_session_segments wss
      JOIN activity_segments aseg ON aseg.id = wss.segment_id
      WHERE wss.work_session_id = ?
    `).all(ws.id) as Array<{ role: string; contribution_ms: number; primary_bundle_id: string }>

    const evidence = db.prepare(`
      SELECT evidence_type, evidence_value, weight
      FROM work_session_evidence WHERE work_session_id = ?
      ORDER BY weight DESC LIMIT 10
    `).all(ws.id) as Array<{ evidence_type: string; evidence_value: string; weight: number }>
Fix: Execute bulk SQL select queries for segments and evidence using a single join or `IN` statement, resolving the mapping in-memory.
Impact: high
Risk: low

ID: F6
Symptom: Typing lag and visual stutters when writing inside the focus review note textarea of a timeline block.
Location: src/renderer/views/Insights.tsx:2099
Root cause: The `messageListItems` `useMemo` hooks `focusReviewDrafts` in its dependency array, which changes on every single keystroke as the user types, completely defeating the memoization and forcing the entire AI chat message list, Markdown renderers, and action cards to re-render.
Evidence:
  const messageListItems = useMemo(() => messages.map((message, index) => (
...
  )), [messages, messageActionState, focusReviewDrafts, actionFeedback, latestCompletedAssistantId, reducedMotion, activeFocusSession, scrollToBottom])
Fix: Isolate the focus review textarea in its own self-contained stateful component so typing updates do not trigger parent re-renders.
Impact: high
Risk: low

ID: F7
Symptom: High background CPU overhead and periodic micro-stuttering in the app every 60 seconds.
Location: src/main/services/browser.ts:431
Root cause: The browser tracking poller `pollAll` executes a synchronous file copy using `fs.copyFileSync` of large browser history files (which can be hundreds of megabytes) on the main thread for every discovered Chromium and Firefox profile.
Evidence:
    fs.copyFileSync(browser.historyPath, tmpDb)
    const walSrc = browser.historyPath + '-wal'
    const shmSrc = browser.historyPath + '-shm'
    if (fs.existsSync(walSrc)) fs.copyFileSync(walSrc, tmpWal)
    if (fs.existsSync(shmSrc)) fs.copyFileSync(shmSrc, tmpShm)
Fix: Copy the history SQLite files using asynchronous filesystem streams or offload the history database parser to a worker thread.
Impact: high
Risk: low

ID: F8
Symptom: Severe event loop blocking on Linux systems using Wayland compositors (Hyprland/Sway) or X11 when polling the active window.
Location: src/main/services/tracking.ts:146
Root cause: The active window polling loop runs every 5 seconds and invokes `execFileSync` synchronously to spawn sub-processes (`hyprctl`, `swaymsg`, `xdotool`, `xprop`) for fallback tracking, freezing the main thread if any command hangs or runs slowly.
Evidence:
function execText(command: string, args: string[]): string | null {
  try {
    const output = execFileSync(command, args, {
      timeout: 1_500,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
Fix: Replace synchronous `execFileSync` process spawns with asynchronous `execFile` calls inside the tracking loop.
Impact: high
Risk: low

ID: F9
Symptom: Periodic slow response or stuttering on the timeline view when switching between different blocks.
Location: src/renderer/views/Timeline.tsx:970
Root cause: Clicking a timeline block triggers a heavy IPC request that queries, aggregates, and retrieves detailed client lists from the main process, executing on every selection switch because the `useEffect` is bound to the `block?.id` dependency.
Evidence:
  useEffect(() => {
    void ipc.attribution.listClientsDetailed()
      .then((rows) => setClients(rows.filter((row) => row.status === 'active').map((row) => ({ id: row.id, name: row.name }))))
      .catch(() => setClients([]))
  }, [block?.id])
Fix: Lift client list fetching to the parent timeline view or cache it globally on mount to remove the block ID dependency.
Impact: medium
Risk: low

ID: F10
Symptom: Stutters and frame drops in the timeline view when selecting different blocks or scrolling.
Location: src/renderer/views/Timeline.tsx:2095
Root cause: The `TimelineRow` component is not memoized and receives an inline `onSelect` arrow function prop that gets recreated on every render of the parent `Timeline` component, forcing every single row on the timeline to re-render whenever the selected block ID changes.
Evidence:
                          <TimelineRow
                            key={segment.kind === 'work_block' ? segment.blockId : `${segment.kind}:${segment.startTime}:${segment.endTime}`}
                            segment={segment}
                            block={segment.kind === 'work_block' ? blockMap.get(segment.blockId) ?? null : null}
                            isSelected={segment.kind === 'work_block' && selectedBlockId === segment.blockId}
                            onSelect={() => {
                              if (segment.kind === 'work_block') {
                                setSelectedBlockId(segment.blockId)
                              }
                            }}
                          />
Fix: Wrap `TimelineRow` in `React.memo` and pass a stable callback handler for selections.
Impact: medium
Risk: low

ID: F11
Symptom: Disk write overhead and increased latency when changing dates or loading past timeline days.
Location: src/main/core/query/projections.ts:131
Root cause: The read-only query projections `getTimelineDayProjection` and `getHistoryDayProjection` perform a write-on-read anti-pattern by executing a synchronous write operation (`persistTimelineDay`) to database tables on every timeline page view of a historical day.
Evidence:
  const blocks = buildTimelineBlocksFromSessions(db, sessions)
  // Persist the reconstructed blocks into timeline_blocks.
  persistTimelineDay(db, dateStr, blocks)
Fix: Only write blocks to the database when they are explicitly edited or during background consolidation, keeping view projections read-only.
Impact: medium
Risk: medium

ID: F12
Symptom: High IPC traffic and database query overhead when navigating between chat threads in the AI tab.
Location: src/renderer/views/Insights.tsx:1128
Root cause: The `insightsResource` co-bundles global settings, CLI tool detections, API key status checks, active focus sessions, and today's timeline blocks into a single load function that executes in its entirety whenever `activeThreadId` changes.
Evidence:
    load: async () => {
      const currentSettings = await ipc.settings.get()
...
      const [history, cliToolsResult, apiProviderAccessChecks, today, activeFocusSession] = await Promise.all([
        activeThreadId == null
          ? Promise.resolve([])
          : ipc.ai.getHistory({ threadId: activeThreadId }).catch(() => []),
        ipc.ai.detectCliTools().catch(() => ({ claude: null, codex: null })),
...
    dependencies: [activeThreadId],
Fix: Split thread-history fetching into its own isolated resource to avoid refetching static global state on every thread selection switch.
Impact: medium
Risk: low

ID: F13
Symptom: Heavy background query lag and thread blocking during active attribution segmentation.
Location: src/main/services/attribution.ts:233
Root cause: The `normalizeToSegments` loop invokes `topBrowserEvidenceInRange` for every single browser app session in a date range, triggering N+1 separate SQL aggregates against the `website_visits` table.
Evidence:
  for (const session of sessions) {
...
      const browserEvidence = looksLikeBrowser(session.bundle_id, session.app_name)
        ? topBrowserEvidenceInRange(db, slice.start, slice.end, session.bundle_id)
        : null
Fix: Fetch all website visit samples for the given range in a single query and perform the interval intersections in-memory.
Impact: medium
Risk: low
