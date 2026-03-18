# Daylens — MVP Status and Todos

## Worked Well

- Onboarding visuals: 5-step flow with calm, native-feeling design and clear privacy messaging
- Three-column layout: sidebar + content + inspector is correctly structured and feels native
- Sidebar hierarchy: expandable "Web" folder with Browsers/Websites children
- Design system: restrained teal-blue accent, SF typography, neutral-first palette
- Data models: comprehensive, well-typed with GRDB persistence conformance
- Architecture: clean separation (Capture → Processing → Storage → ViewModels → Views)
- Component library: HorizontalBarChart, DensityStrip, SessionRow, CommandBar, ConfidenceBadge
- Browser extensions: Manifest V3 Chrome extension + Safari Web Extension with WebSocket bridge
- Test suite: 50+ tests covering normalization, debouncing, privacy, AI prompts, performance

## Broken (found in audit)

### Critical — Pipeline completely disconnected (NOW FIXED)
1. ~~`AppState.setupServices()` was never called — `captureEngine` stayed nil~~ **FIXED**: AppState now wires directly to `ServiceContainer.shared.captureEngine`
2. ~~`CaptureEngine.onEventsReady` was never assigned~~ **FIXED**: ServiceContainer.wirePipeline() now connects the full pipeline
3. ~~No event processing pipeline existed~~ **FIXED**: Full pipeline: capture → filter → debounce → resolve IDs → persist events → normalize sessions → classify → persist sessions → rebuild daily summary
4. ~~UUID mismatch between capture and storage~~ **FIXED**: Pipeline resolves deterministic UUIDs to stored record UUIDs via `findOrCreateApp` before inserting
5. ~~`DailySummaryBuilder` was never invoked~~ **FIXED**: Pipeline calls `rebuildTodaySummary` after each event batch
6. ~~Auto-start tracking for returning users was missing~~ **FIXED**: `AppState.init()` calls `startTracking()` if onboarding was completed

### Critical — AI completely disconnected (NOW FIXED)
7. ~~`AIAnalyst` and `ConversationManager` were never instantiated~~ **FIXED**: ServiceContainer creates them with API key from env or UserDefaults
8. ~~`AIConversationViewModel.sendMessage()` returned hardcoded placeholder~~ **FIXED**: Wired to `ConversationManager.processMessage()` with real evidence
9. ~~`DashboardViewModel.generateAISummary()` was a placeholder~~ **FIXED**: Wired to `ConversationManager.generateDailySummary()`
10. ~~No API key management~~ **FIXED**: Settings now has API key configuration section

### Critical — Permissions disconnected (NOW FIXED)
11. ~~`PermissionManager` existed but was never used by UI~~ **FIXED**: Onboarding and Settings both wire to real `PermissionManager`
12. ~~Onboarding accessibility step didn't check if permission was granted~~ **FIXED**: Polls permission status every 1.5s during accessibility step, shows green checkmark when granted
13. ~~`SettingsViewModel.loadPermissions()` hardcoded `.notDetermined`~~ **FIXED**: Now reads from `PermissionManager.allPermissions`
14. ~~`SettingsViewModel.requestPermission()` did nothing~~ **FIXED**: Now calls `PermissionManager.requestAccessibility()` / `openScreenRecordingSettings()`

### Broken — UI displayed fake data (NOW FIXED)
15. ~~Today page showed `0s, 0%, 0, 0` despite "Tracking active"~~ **FIXED**: Real data flows from pipeline → DailySummary → TodayView
16. ~~`SessionRow` hardcoded `appName: "App"`~~ **FIXED**: Resolves app name from `DashboardViewModel.appNames[session.appId]`
17. ~~Inspector showed hardcoded placeholder stats~~ **FIXED**: Shows real tracking status, permission status, AI availability, DB status
18. ~~Menu bar "Pause Tracking" posted notification nobody observed~~ **FIXED**: `AppState.init()` observes `trackingStateChanged` notification
19. ~~Export button discarded data~~ **FIXED**: Wired to `DataExporter.exportToJSON()` + `NSSavePanel`

### Broken — Extension install flow (NOW FIXED)
20. ~~Browser extension "Install" buttons were no-ops~~ **FIXED**: Chrome opens extension dir in Finder (or chrome://extensions); Safari opens extension settings

## Fixing Now

All items from the "Broken" list have been fixed in this pass.

## Remaining for MVP

- Extension installed state detection (WebSocket handshake confirmation updating BrowserRecord.extensionInstalled)
- Safari Web Extension native messaging handler (Swift SafariWebExtensionHandler class)
- App icon caching in database (currently loads live from NSWorkspace each time)
- TrendDayCell data: needs to load prior-day summaries to show real daily active times
- Screen Recording permission detection (currently always `.notDetermined`)
- Automation (AppleScript) permission detection
- Performance profiling on real workday data
- Idle detection edge cases (sleep/wake, lid close/open)
- Browser extension auto-reconnect resilience

## Notes / Risks

- AnthropicSwiftSDK may not compile in all environments — HTTP fallback is retained in AIAnalyst
- The `#if canImport(GRDB)` guards mean core functionality compiles away if GRDB isn't linked
- ViewModels now safely handle `store == nil` (no more force unwraps)
- Accessibility permission requires the built app to be signed or in /Applications — dev builds may need manual TCC grant
- Browser extensions require manual loading in dev (Chrome: load unpacked, Safari: enable in extension settings)
- `CaptureEngine` uses `Timer.scheduledTimer` for flush — may need `RunLoop.main.add` for reliable firing
- AI features require a valid `ANTHROPIC_API_KEY` env var or configured in Settings; without it, AI degrades honestly
