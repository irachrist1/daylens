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

## Broken

### Critical — Pipeline completely disconnected
1. `AppState.setupServices()` is never called — `captureEngine` stays nil, so all start/stop/pause calls are no-ops
2. `CaptureEngine.onEventsReady` is never assigned — events captured by monitors are silently dropped
3. No event processing pipeline exists: capture → debounce → normalize → persist → summarize
4. UUID mismatch: `AppMonitor` emits deterministic UUIDs, but `ActivityStore.findOrCreateApp` creates random UUIDs — foreign key violations
5. `DailySummaryBuilder` is never invoked — no daily rollups exist in the database
6. Auto-start tracking for returning users is missing

### Critical — AI completely disconnected
7. `AIAnalyst` and `ConversationManager` are never instantiated or injected
8. `AIConversationViewModel.sendMessage()` returns hardcoded placeholder string
9. `DashboardViewModel.generateAISummary()` writes a placeholder, never calls AI
10. No API key management — user has no way to configure their Anthropic key

### Critical — Permissions disconnected
11. `PermissionManager` exists and works but is never used by UI
12. Onboarding accessibility step doesn't check if permission is actually granted
13. `SettingsViewModel.loadPermissions()` hardcodes `.notDetermined` for all permissions
14. `SettingsViewModel.requestPermission()` does nothing useful

### Broken — UI displays fake data
15. Today page shows `0s, 0%, 0, 0` despite "Tracking active"
16. `SessionRow` hardcodes `appName: "App"` instead of resolving from store
17. `TrendDayCell` receives no real data — purely decorative
18. Inspector shows hardcoded placeholder stats
19. Menu bar "Pause Tracking" posts notification nobody observes
20. Export button discards exported data — no save dialog

### Broken — Extension install flow
21. Browser extension "Install" buttons are no-ops (empty closures)
22. No detection of whether extensions are actually connected

## Fixing Now

- Wire `ServiceContainer` → `AppState` → `CaptureEngine` at app launch
- Build full event pipeline: capture → debounce → normalize → persist → summarize
- Fix UUID alignment between capture and storage layers
- Wire `PermissionManager` into onboarding and settings
- Add real permission detection and polling on onboarding
- Wire `AIAnalyst` + `ConversationManager` into ViewModels
- Add API key configuration in Settings
- Fix extension install buttons to open real install targets
- Fix all hardcoded/placeholder UI values
- Auto-start tracking for returning users

## Remaining for MVP

- Extension installed state detection (WebSocket handshake confirmation)
- Safari Web Extension native messaging handler (Swift handler class)
- App icon caching in database (currently loads live each time)
- Full history view with date picker
- Trend data in TrendDayCell (requires multi-day summaries)
- Screen Recording permission detection
- Automation (AppleScript) permission detection
- Performance profiling on real workday data

## Notes / Risks

- AnthropicSwiftSDK may not build in all environments — HTTP fallback is retained
- The `#if canImport(GRDB)` guards mean core functionality compiles away if GRDB isn't linked
- Force-unwrap `store!` in all ViewModels will crash if database init fails — adding guards
- Accessibility permission requires the built app to be in /Applications or signed — dev builds may need manual TCC grant
- Browser extensions require manual loading in dev (Chrome: load unpacked, Safari: enable in extension settings)
