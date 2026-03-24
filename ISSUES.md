# Daylens Windows Code Audit

Audit scope:
- Full read-through of the requested Electron main/preload/renderer/DB/config/workflow files
- Verified `npm run typecheck`
- Verified `npm run build:all` and captured the renderer bundle-size warning
- Verified packaged Windows binary signing state with `Get-AuthenticodeSignature`
- Verified packaged `app.asar` contents with `npx asar list`

## 1. Summary Table

| # | Title | Severity | Category |
|---|---|---|---|
| 1 | External navigation can expose the full preload API to remote pages | Critical | Security |
| 2 | Telemetry is enabled by default even though release copy says “no telemetry” | High | Security |
| 3 | The Anthropic API key is stored in plain-text settings and exposed to the renderer | High | Security |
| 4 | Main-process DB, browser, and icon work all run synchronously on Electron’s UI thread | High | Performance |
| 5 | Startup blocks on an immediate browser-history scan | High | Performance |
| 6 | The renderer ships as one eagerly-loaded 713 kB chunk | Medium | Performance |
| 7 | Insights rewrites the entire conversation JSON blob on every message | Medium | Performance |
| 8 | Browser polling can permanently lose visits when backlog exceeds 5,000 rows | High | Bug |
| 9 | Browser visit pagination and dedup use only millisecond timestamps, so tied visits are skipped or collapsed | High | Bug |
| 10 | Browser tracking only scans default Chromium profiles and skips Firefox | Medium | Missing Feature |
| 11 | The Today “Top Websites” card never refreshes after mount | Medium | Bug |
| 12 | Close-to-tray behavior ships without a real tray icon and still contains a Windows quit fallback | High | UX |
| 13 | Snapshot exports emit incorrect local timestamps | Medium | Bug |
| 14 | Final sync on quit is fire-and-forget and can lose the latest snapshot | Medium | Bug |
| 15 | Daily summaries ignore sessions that cross midnight | Medium | Bug |
| 16 | Query-side display-name normalization is wired to `app_name` instead of `bundle_id` | Medium | Bug |
| 17 | Packaged builds omit the normalization JSON required at runtime | Medium | Build-Deploy |
| 18 | Windows binaries are unsigned, so SmartScreen shows “Unknown publisher” | High | Build-Deploy |
| 19 | NSIS explicitly disables auto-launch after install | Medium | Build-Deploy |
| 20 | `launchOnLogin` defaults to `false` and there is no settings control to enable it | Medium | Missing Feature |
| 21 | Forge packaging metadata is frozen at `0.1.0` instead of following `package.json` | Low | Build-Deploy |
| 22 | App bootstrap and several renderer loaders have no error handling, so failures leave blank or perpetually loading screens | Medium | UX |
| 23 | History week view mixes raw noise into totals and mislabels summed daily uniques as “app opens” | Low | UX |
| 24 | The release workflow publishes without any typecheck or runtime smoke gate | Low | Build-Deploy |
| 25 | Connect to Computer — UI Trap | Medium | UX |
| 26 | Missing Logout / Disconnect Option | Medium | UX |
<!--

| 25 | Connect to Computer — UI Trap | Medium | UX |
| 26 | Missing Logout / Disconnect Option | Medium | UX |

-->
## 2. Detailed Findings Grouped By Category

## Security

### 1. External navigation can expose the full preload API to remote pages
- Severity: Critical
- Category: Security
- Affected files and lines: `src/main/index.ts:80-99`, `src/preload/index.ts:5-80`, `src/renderer/views/Settings.tsx:303-305`
- Root cause: The app exposes a broad privileged `window.daylens` API from preload to whatever page is loaded in the BrowserWindow. The window does not register any `will-navigate` or `setWindowOpenHandler` guard, and `Settings` renders a raw `<a href="https://daylens-web.vercel.app/link">` link instead of using the safe `shell:open-external` path. Clicking that link can navigate the Electron window to remote content, and that remote page would inherit the full preload API surface.
- Proposed fix: Block all in-window navigation to non-app URLs in `main/index.ts`, force external URLs through `shell.openExternal`, replace the raw anchor in `Settings` with `ipc.shell.openExternal`, and narrow the preload surface so remote content cannot read settings, local data, or sync APIs even if navigation slips through.

### 2. Telemetry is enabled by default even though release copy says “no telemetry”
- Severity: High
- Category: Security
- Affected files and lines: `vite.main.config.ts:8-13`, `src/main/services/analytics.ts:8-45`, `src/main/index.ts:189-194`, `src/renderer/lib/analytics.ts:1-4`, `.github/workflows/release-windows.yml:72-79`
- Root cause: The app initializes PostHog unconditionally, hardcodes a production PostHog key/host fallback, and captures app launches, route opens, onboarding events, feedback, update events, and crash telemetry without any opt-in or settings toggle. The release workflow body simultaneously tells users there is “no telemetry,” which is materially false.
- Proposed fix: Add an explicit analytics opt-in setting that defaults off, gate every capture behind it, remove production analytics defaults from the build config, and correct the release copy so it matches the app’s actual behavior.

### 3. The Anthropic API key is stored in plain-text settings and exposed to the renderer
- Severity: High
- Category: Security
- Affected files and lines: `src/main/services/settings.ts:16-18`, `src/main/services/settings.ts:33-50`, `src/main/ipc/settings.handlers.ts:7-16`, `src/preload/index.ts:41-44`, `src/renderer/views/Settings.tsx:190-199`
- Root cause: `anthropicApiKey` is persisted inside `electron-store` alongside normal preferences, returned wholesale from `getSettings()`, and sent over IPC into the renderer. That means the key is not kept in the OS credential vault, and any renderer compromise or accidental remote navigation can read it directly.
- Proposed fix: Move the API key to `keytar`, expose only `hasAnthropicApiKey` plus dedicated `set/clear` IPC methods, and stop returning the key in `settings:get`.

## Performance

### 4. Main-process DB, browser, and icon work all run synchronously on Electron’s UI thread
- Severity: High
- Category: Performance
- Affected files and lines: `src/main/services/database.ts:14-28`, `src/main/ipc/db.handlers.ts:39-126`, `src/main/services/browser.ts:203-326`, `src/main/services/windowsHistory.ts:121-182`, `src/main/ipc/db.handlers.ts:101-125`, `src/renderer/views/Today.tsx:193-228`, `src/renderer/views/Apps.tsx:164-191`, `src/renderer/views/Focus.tsx:105-131`
- Root cause: The app uses synchronous `better-sqlite3`, synchronous file copies, synchronous icon extraction, and synchronous history parsing directly in the main process. Renderer views then poll those handlers every 30 seconds, so any heavier DB/history/icon workload blocks the same event loop that drives window responsiveness.
- Proposed fix: Move heavy DB/history/icon work into a worker thread or utility process, batch/collapse renderer refreshes, add memoized or persisted icon caching, and pause renderer polling when the window is hidden to tray.

### 5. Startup blocks on an immediate browser-history scan
- Severity: High
- Category: Performance
- Affected files and lines: `src/main/index.ts:205-211`, `src/main/services/browser.ts:182-186`, `src/main/services/browser.ts:203-326`
- Root cause: `startBrowserTracking()` is called during startup and immediately invokes `void pollAll()`. Even though `pollAll()` is marked `async`, its body performs synchronous file copy and SQLite work before any await, so the first browser-history pass blocks the main process right after window creation.
- Proposed fix: Defer the first browser poll until after the first paint, move it off the main thread, or chunk it so startup can show the window before the history catch-up begins.

### 6. The renderer ships as one eagerly-loaded 713 kB chunk
- Severity: Medium
- Category: Performance
- Affected files and lines: `src/renderer/App.tsx:9-16`, `vite.renderer.config.ts:7-23`
- Root cause: Every route view is imported eagerly at the top of `App.tsx`, so the renderer bundle includes the whole app, including heavy views and charting code, in the initial chunk. The audit build produced a 713.66 kB minified JS asset and Vite emitted a chunk-size warning.
- Proposed fix: Convert route views to `React.lazy`/dynamic imports, split large features like Insights/History charting out of the initial bundle, and keep the first-load path limited to the shell plus the default route.

### 7. Insights rewrites the entire conversation JSON blob on every message
- Severity: Medium
- Category: Performance
- Affected files and lines: `src/main/db/queries.ts:287-324`
- Root cause: AI chat messages are stored as a single JSON array inside one `ai_conversations.messages` column. Every send reads the full blob, parses it, appends to it, stringifies the entire conversation again, and writes it back synchronously. As history grows, chat latency and main-process blocking will grow with it.
- Proposed fix: Normalize messages into an `ai_messages` table, append rows instead of rewriting one blob, and cap retained history before sending it to the model.

## Bug

### 8. Browser polling can permanently lose visits when backlog exceeds 5,000 rows
- Severity: High
- Category: Bug
- Affected files and lines: `src/main/services/browser.ts:244-276`, `src/main/services/browser.ts:309`
- Root cause: The poller hard-caps each run at 10 batches of 500 rows. If a browser has more than 5,000 unseen visits, the remaining rows are not processed, yet `lastPollMs` is still advanced to `pollNow`. That permanently moves the cursor past unprocessed rows, so they are never retried in a later poll.
- Proposed fix: Persist a per-browser “last processed visit_time” cursor instead of `pollNow`, keep polling until the backlog is drained, or explicitly carry the unfinished cursor forward when the batch cap is hit.

### 9. Browser visit pagination and dedup use only millisecond timestamps, so tied visits are skipped or collapsed
- Severity: High
- Category: Bug
- Affected files and lines: `src/main/services/browser.ts:33-35`, `src/main/services/browser.ts:244-276`, `src/main/db/schema.ts:39-52`
- Root cause: Chromium `visit_time` values are converted from microseconds to milliseconds, and the DB enforces `UNIQUE (browser_bundle_id, visit_time)`. Distinct visits that land in the same millisecond collapse to one row. On top of that, the pagination query advances with `WHERE v.visit_time > ?`, so if the last row of a batch shares the same timestamp as additional rows beyond the limit, those remaining rows are skipped entirely.
- Proposed fix: Preserve the original microsecond timestamp, deduplicate on a richer key such as `(browser_bundle_id, visit_time_us, url)`, and page with a composite cursor instead of a strict `>` on truncated timestamps.

### 10. Browser tracking only scans default Chromium profiles and skips Firefox
- Severity: Medium
- Category: Missing Feature
- Affected files and lines: `src/main/services/browser.ts:86-111`
- Root cause: The Windows browser registry only checks hardcoded `Default` profile paths for Chrome, Edge, and Brave, then explicitly filters Firefox out. Users on Profile 2/Profile 3, work profiles, portable installs, or Firefox get partial or zero website tracking.
- Proposed fix: Enumerate Chromium profile directories dynamically, add Firefox `places.sqlite` support, and store per-profile cursors so all active user profiles are tracked reliably.

### 11. The Today “Top Websites” card never refreshes after mount
- Severity: Medium
- Category: Bug
- Affected files and lines: `src/renderer/views/Today.tsx:813-822`
- Root cause: `WebsitesCard` fetches website summaries once in a mount-only effect and never refreshes again. The parent view refreshes app sessions every 30 seconds, but website data stays frozen until the whole view remounts, which makes browser tracking look broken or delayed.
- Proposed fix: Fold website summaries into the parent refresh loop, or subscribe the card to the same interval/push updates used for the rest of Today.

### 12. Snapshot exports emit incorrect local timestamps
- Severity: Medium
- Category: Bug
- Affected files and lines: `src/main/services/snapshotExporter.ts:146-153`
- Root cause: `toISOWithOffset()` starts from `toISOString()`, which is UTC, and then simply replaces the trailing `Z` with the local offset. That produces strings like `2026-03-23T10:00:00.000+02:00` for a local noon event, which is internally inconsistent and shifts the apparent wall-clock time.
- Proposed fix: Build the timestamp from local date/time components directly, or use a formatter that emits local time plus offset without going through UTC first.

### 13. Final sync on quit is fire-and-forget and can lose the latest snapshot
- Severity: Medium
- Category: Bug
- Affected files and lines: `src/main/index.ts:163-170`, `src/main/services/syncUploader.ts:37-45`, `src/main/services/syncUploader.ts:67-114`
- Root cause: `before-quit` calls `stopSync()`, which kicks off an async `syncNow()` but does not await it. The app then immediately closes the DB, destroys the tray, and proceeds with shutdown. That makes the final sync attempt race against teardown and process exit.
- Proposed fix: Add an orderly shutdown path that awaits the last sync before closing the DB and quitting, or persist an explicit unsynced cursor that is guaranteed to retry on next launch.

### 14. Daily summaries ignore sessions that cross midnight
- Severity: Medium
- Category: Bug
- Affected files and lines: `src/main/db/dailySummaries.ts:30-45`, `src/main/db/dailySummaries.ts:54-61`, `src/main/db/dailySummaries.ts:71-101`
- Root cause: Daily summary queries filter on `start_time >= dayStart AND start_time < dayEnd`. Any session that started before midnight but continued into the day is excluded from that day’s totals, and any session that starts before midnight and ends after is fully attributed to the previous day instead of being clipped.
- Proposed fix: Reuse the overlap-and-clip logic from `getAppSummariesForRange()`/`getSessionsForRange()`, or query overlapping sessions with `COALESCE(end_time, start_time + duration_sec * 1000) > dayStart AND start_time < dayEnd` and clip them to day bounds before aggregation.

### 15. Query-side display-name normalization is wired to `app_name` instead of `bundle_id`
- Severity: Medium
- Category: Bug
- Affected files and lines: `src/main/db/queries.ts:22-25`, `src/main/db/queries.ts:169-176`, `src/main/db/queries.ts:203-205`
- Root cause: `resolveDisplayName()` looks up aliases using `rawName.toLowerCase()`, but the alias map is keyed by bundle IDs and executable names like `code.exe` or `com.google.Chrome`. The call sites pass `row.app_name`, so normalization rarely matches even when the JSON map exists.
- Proposed fix: Resolve display names from `bundle_id` or normalized executable basename, normalize alias keys once when the map loads, and keep `app_name` as fallback display text only.

### 16. App bootstrap and several renderer loaders have no error handling, so failures leave blank or perpetually loading screens
- Severity: Medium
- Category: UX
- Affected files and lines: `src/renderer/App.tsx:82-105`, `src/renderer/views/Today.tsx:205-228`, `src/renderer/views/Apps.tsx:171-190`, `src/renderer/views/Apps.tsx:513-530`, `src/renderer/views/Focus.tsx:109-130`, `src/renderer/views/Insights.tsx:218-228`, `src/renderer/views/History.tsx:123-151`
- Root cause: Most data-loading effects assume every IPC request succeeds. If any promise rejects, the component usually keeps `loading` true forever or, in `App.tsx`, keeps returning `null`, which leaves the user with a blank window or endless skeleton state and no actionable error.
- Proposed fix: Wrap each loader in `try/catch`, surface a visible retry/error state, and ensure `loading` is cleared on both success and failure paths.

### 17. History week view mixes raw noise into totals and mislabels summed daily uniques as “app opens”
- Severity: Low
- Category: UX
- Affected files and lines: `src/renderer/views/History.tsx:123-149`, `src/renderer/views/History.tsx:160-163`, `src/renderer/views/History.tsx:211-212`
- Root cause: The week view aggregates raw `getHistory()` sessions without the day view’s presentation-noise filter, so system/uncategorized noise can inflate weekly bars. It also sums each day’s unique-app count and labels the result as `app opens`, which is not the same metric and double-counts the same app across days.
- Proposed fix: Apply the same noise filtering as day view before computing week aggregates, and rename the footer metric to something accurate such as `sum of daily unique apps` or compute real launch/open counts separately.

## UX

### 18. Close-to-tray behavior ships without a real tray icon and still contains a Windows quit fallback
- Severity: High
- Category: UX
- Affected files and lines: `src/main/tray.ts:6-13`, `src/main/index.ts:129-135`, `src/main/index.ts:238-241`, `electron-builder.yml:9-11`
- Root cause: `createTray()` looks for `../../assets/icon.png`, but the repo’s `assets/` folder contains no tray icon and packaged builds only include `dist/**/*` plus `package.json`. That means the tray falls back to an empty image, so the app can hide itself with no visible tray affordance. The main process also still calls `app.quit()` on Windows if all windows ever do close, which conflicts with the intended background-tray model.
- Proposed fix: Bundle an actual tray asset that is available in both dev and packaged builds, resolve it from a packaged-safe path, and remove the Windows `window-all-closed -> app.quit()` fallback while tray/background mode is enabled.

### 25. Connect to Computer — UI Trap
- Severity: Medium
- Category: UX
- Affected files and lines: `src/renderer/App.tsx:62-70`, `src/renderer/App.tsx:112-114`, `src/renderer/views/Settings.tsx:106-133`, `src/renderer/views/Settings.tsx:263-326`, `src/renderer/views/Settings.tsx:416-422`, `src/main/ipc/sync.handlers.ts:17-26`, `src/main/services/workspaceLinker.ts:242-269`
- Root cause: The workspace connect flow is not a separate route or a dismissible modal. `App.tsx` only exposes the normal `/settings` route, and `Settings.tsx` swaps the Web Companion card inline with `linkResult ? ... : syncStatus?.isLinked ? ... : ...`. During `handleLink()` and `handleCreateBrowserLink()`, the renderer sets `linking=true`, disables the action button, and waits for IPC to settle. There is no cancel button, back button, escape handler, or timeout path. On the main side, the sync IPC handlers simply await `createWorkspace()` / `createBrowserLink()`, and `callConvex()` uses raw `fetch()` with no `AbortController` or timeout, so a stalled backend or network request can leave the user stuck on `Setting up...` or `Creating...` indefinitely. Even after success, the `linkResult` branch replaces the normal connected controls with an instruction panel whose only exit is a small `Done` button, with no explicit back/dismiss flow or disconnect action on that screen.
- Proposed fix: Move pairing into a dismissible modal or dedicated nested route, add an explicit Back/Close control plus `Esc` handling, and keep a visible secondary action that returns to the normal Settings card. In parallel, wrap the `createWorkspace()` / `createBrowserLink()` network path in an `AbortController` timeout and add a renderer-side cancel/reset path that clears `linking`, `linkResult`, `linkError`, `showMnemonic`, and `showDisconnectConfirm` if the request hangs or the user abandons the flow.

### 26. Missing Logout / Disconnect Option
- Severity: Medium
- Category: UX
- Affected files and lines: `src/renderer/views/Settings.tsx:135-141`, `src/renderer/views/Settings.tsx:263-326`, `src/renderer/views/Settings.tsx:327-405`, `src/preload/index.ts:51-56`, `src/main/ipc/sync.handlers.ts:28-31`, `src/main/services/workspaceLinker.ts:107-112`, `src/main/services/credentials.ts:55-61`, `src/main/services/syncUploader.ts:76-82`
- Root cause: The main/preload layers already implement a safe disconnect path: preload exposes `sync.disconnect()`, the main handler calls `stopSync()` and `disconnect()`, and `disconnect()` only clears the keytar entries for `workspaceId`, `workspaceToken`, `deviceId`, and `recoveryMnemonic`. That means local SQLite tracking data stays intact, and missing credentials naturally stop future uploads. The UI problem is discoverability and state coverage. The Disconnect button exists only in the `syncStatus?.isLinked` branch, while the higher-priority `linkResult` branch shown immediately after connecting has no logout/disconnect action at all. A user who lands on the pairing/instructions screen cannot return directly to the unlinked state from there, which makes the app look like it has no logout option. `handleDisconnect()` also does not clear `showMnemonic`, `mnemonic`, or `linkError`, so the sync UI is not fully reset after logout.
- Proposed fix: Keep the existing main-side disconnect implementation, but surface it as a persistent `Disconnect workspace` / `Log out of web sync` action whenever workspace credentials exist, including inside the `linkResult` branch. Reuse `ipc.sync.disconnect()` so `app_sessions`, `website_visits`, and `focus_sessions` remain untouched, and extend `handleDisconnect()` to reset all sync-specific renderer state: `setSyncStatus({ isLinked: false, workspaceId: null, lastSyncAt: null })`, `setLinkResult(null)`, `setShowMnemonic(false)`, `setMnemonic(null)`, `setLinkError(null)`, and `setShowDisconnectConfirm(false)`.

## Build-Deploy

### 19. Packaged builds omit the normalization JSON required at runtime
- Severity: Medium
- Category: Build-Deploy
- Affected files and lines: `electron-builder.yml:9-11`, `src/main/db/queries.ts:10-20`, `src/main/services/snapshotExporter.ts:93-113`
- Root cause: Runtime code expects `shared/app-normalization.v1.json`, but `electron-builder.yml` only packages `dist/**/*` and `package.json`. During the audit, `npx asar list dist-release/win-unpacked/resources/app.asar` confirmed the normalization file is absent from the packaged app, so installed builds fall back to empty normalization maps.
- Proposed fix: Copy the JSON into `dist/resources` during build or include `shared/app-normalization.v1.json` in the packaged files, then resolve it from `process.resourcesPath` in production.

### 20. Windows binaries are unsigned, so SmartScreen shows “Unknown publisher”
- Severity: High
- Category: Build-Deploy
- Affected files and lines: `electron-builder.yml:16-45`, `.github/workflows/release-windows.yml:57-60`
- Root cause: The Windows build config contains no code-signing certificate, no signing env vars, and no publisher identity. A packaged audit build verified `DaylensWindows.exe` is `NotSigned`, so SmartScreen will correctly show the “Unknown publisher” warning.
- Proposed fix: Obtain an OV/EV code-signing certificate, sign the installer and executable in CI, set the relevant electron-builder signing configuration, and publish only signed artifacts.

### 21. NSIS explicitly disables auto-launch after install
- Severity: Medium
- Category: Build-Deploy
- Affected files and lines: `electron-builder.yml:23-33`
- Root cause: NSIS is configured with `runAfterFinish: false`, so the installer never offers or performs an immediate app launch after setup completes.
- Proposed fix: Set `runAfterFinish: true`, or add an installer finish-page checkbox that defaults on if you want the app to start after installation.

### 22. Forge packaging metadata is frozen at `0.1.0` instead of following `package.json`
- Severity: Low
- Category: Build-Deploy
- Affected files and lines: `forge.config.ts:7-15`, `package.json:2-5`
- Root cause: Forge packaging overrides `appVersion` to `0.1.0` even though `package.json` is `1.0.7`. Any build path that uses `electron-forge package` or `electron-forge make` will stamp the wrong version metadata into the app.
- Proposed fix: Remove the hardcoded `appVersion` override or read it from `package.json` so every packaging path emits the same version.

### 23. The release workflow publishes without any typecheck or runtime smoke gate
- Severity: Low
- Category: Build-Deploy
- Affected files and lines: `.github/workflows/release-windows.yml:43-58`, `package.json:7-18`
- Root cause: The release job installs dependencies, rebuilds natives, builds Vite bundles, and publishes artifacts without running `npm run typecheck` or any smoke/e2e check. That means a tagged release can ship without the minimal validation already available in the repo.
- Proposed fix: Add `npm run typecheck` and at least one packaged-app smoke check before the publish step, and block release creation if those checks fail.

## Missing Feature

### 24. `launchOnLogin` defaults to `false` and there is no settings control to enable it
- Severity: Medium
- Category: Missing Feature
- Affected files and lines: `src/main/services/settings.ts:16-18`, `src/main/services/settings.ts:34-36`, `src/main/index.ts:180-182`, `src/renderer/views/Settings.tsx:182-470`
- Root cause: Startup uses `app.setLoginItemSettings({ openAtLogin: getSettings().launchOnLogin })`, but the default value is `false` and the Settings screen never renders a launch-on-login toggle. So Windows auto-start is off by default and users have no in-app way to turn it on.
- Proposed fix: Add a Settings toggle wired to `launchOnLogin`, consider prompting during onboarding, and choose the product-default intentionally instead of silently defaulting to `false`.
