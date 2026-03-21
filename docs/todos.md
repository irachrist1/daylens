# Daylens — Progress Tracker

## Current State
**Phase: Post-MVP Production Hardening**
Core product is running, tracking real data, and generating AI insights. Active development is focused on stability, data integrity, UI polish, and the Windows companion app.

---

## Completed

### Infrastructure & Data Layer
- [x] Project structure with XcodeGen (`project.yml`) + SPM (`Package.swift`)
- [x] GRDB database layer with full schema and migrations (v1, v2 focus_sessions, v3 category_overrides)
- [x] All data models (ActivityEvent, AppSession, BrowserSession, WebsiteVisit, DailySummary)
- [x] Additive-only migration policy — never `eraseDatabaseOnSchemaChange`
- [x] Automatic rolling backups on every app launch (`~/Library/Application Support/Daylens/Backups/`)
- [x] `combinedDayPayload` — single DB read for all Today view queries
- [x] Category overrides table + full query path integration (all summaries respect user overrides)
- [x] `DayBounds` range queries (correct) replacing `date` column equality (fragile)
- [x] Keychain-based API key storage with UserDefaults migration on first launch

### Tracking Pipeline
- [x] NSWorkspace-based app tracking (ActivityTracker)
- [x] Idle detection via IOKit (IdleDetector)
- [x] Native browser history reading — Chrome, Arc, Brave, Edge, Safari, Firefox
- [x] Accessibility API for window title and URL extraction
- [x] AppleScript URL extraction fallback for all major browsers
- [x] Two-layer browser URL tracking: AX API primary → AppleScript fallback
- [x] Session normalization and focus score computation
- [x] In-flight session injection — frontmost app visible in Today/Apps before session ends
- [x] Focus session tracking (`focus_sessions` table, v2 migration)
- [x] Permission management — accessibility, full disk access, login item

### Views & ViewModels
- [x] `@Observable` ViewModels with `Task.detached` for non-blocking DB reads
- [x] Three-column NavigationSplitView shell
- [x] Sidebar with section navigation and tracking status
- [x] Header bar with date navigation
- [x] Today dashboard: overview cards, bento layout, timeline, top apps, AI summary, focus score
- [x] Apps view with usage bars, category badges, app initials icons, detail sessions + websites
- [x] History view with daily summaries and weekly trend
- [x] Insights / AI chat with streaming, persistent conversation, local fallback
- [x] Settings with API key, tracking toggle, browser status, data retention, export, delete
- [x] Menu bar status item (AppDelegate with NSStatusItem)
- [x] Keyboard shortcuts (⌘[/⌘] navigate days, ⌘T today, ⇧⌘P toggle tracking)
- [x] Design system (spacing, colors, typography tokens, CategoryBadge, AppInitialsIcon)
- [x] Focus controls in menu bar / HUD (deduplicated)
- [x] This Week card with correct date math

### AI
- [x] Anthropic Claude API client with streaming (AIService)
- [x] Grounded prompt builder with category overrides passed correctly (AIPromptBuilder)
- [x] Multi-day context (primary day + 4 previous days)
- [x] Local analysis fallback when AI unavailable (LocalAnalyzer)
- [x] AI conversations persisted to `ai_conversations` table

### Windows Companion App
- [x] Electron/React Windows app scaffolded (`daylens-windows/`)
- [x] userData path collision fixed — Windows app writes to `DaylensWindows/`, never `Daylens/`
- [x] `productName: "DaylensWindows"` in package.json and forge.config.ts
- [x] `app.setPath('userData', …'DaylensWindows')` called before `app.whenReady()`

### Infrastructure Hardening (2026-03-20 incidents)
- [x] `eraseDatabaseOnSchemaChange = true` permanently removed and banned in CLAUDE.md + AGENTS.md
- [x] CLAUDE.md updated with prohibitions: no sqlite3 CLI on live DB, no shared support dir, no wrong-branch binary
- [x] AGENTS.md created — universal AI agent instruction file (auto-loaded by Cursor, Copilot, Windsurf, Gemini CLI, Codex, Zed, Warp, JetBrains, Aider, Continue.dev)
- [x] Both files added to .gitignore with explanatory comment
- [x] Safe database restore procedure documented
- [x] Historical data archive location documented (`DayLens-Claude/daylens.db`)

### Tests
- [x] Unit tests for session normalization, aggregation, data layer, onboarding, tracking pipeline
- [x] All tests use in-memory DBs (no live DB risk)

---

## Active / In Progress

### Windows Companion App
- [ ] Core Windows tracking pipeline
- [ ] Windows UI (Electron/React)
- [ ] Cross-platform feature parity assessment

---

## Backlog

### Data Integrity
- [ ] Fix backup system WAL gap: `takeBackup()` copies base file without `PRAGMA wal_checkpoint(TRUNCATE)` — in-flight WAL transactions are not captured. Needs checkpoint before copy, with guard for blocking writers.
- [ ] Website visit recovery: `website_visits` table is populated but `websiteSummaries` may show gaps for March 19 data due to import from old scaffold schema. Verify and backfill if needed.
- [ ] Add backup integrity check on launch: `PRAGMA integrity_check` on the most recent backup; alert if corrupt before it's the only copy.

### App Icon
- [ ] Add final app icon asset (replace placeholder)

### Polish
- [ ] Timeline rendering edge cases (overlapping sessions, very short sessions)
- [ ] Dark mode full visual pass
- [ ] Performance profile background tracking CPU/battery
- [ ] Private browsing detection and coarse-only tracking option

### Future Features
- [ ] Browser extension for high-confidence tab/page attribution (Chrome/Arc, Safari)
- [ ] Weekly and monthly trend views
- [ ] Command bar / quick launcher for fast lookup and natural-language pivots
- [ ] Data export polish (CSV in addition to JSON)
- [ ] Configurable tracking thresholds (idle grace, min session duration)
- [ ] Cross-device sync (post-v1)

---

## Architecture Reference
| Component | Approach | Why |
|-----------|----------|-----|
| Min macOS version | 14.0 (Sonoma) | Enables @Observable, modern SwiftUI |
| Database | GRDB.swift | Best Swift SQLite library, ValueObservation, migrations |
| Browser tracking | Native-first (SQLite + AX API + AppleScript) | No extensions required |
| AI | Direct Anthropic API (URLSession, streaming) | No backend server needed |
| Project generation | XcodeGen + SPM | Clean YAML config, no .xcodeproj in git |
| State management | @Observable macro | Modern SwiftUI, property-level updates |
| API key storage | macOS Keychain (Security framework) | Secure, native |
| App sandbox | Disabled | Required for file system access, AX API, AppleScript |
| Menu bar | NSStatusItem via AppDelegate | Native macOS integration |
| Windows companion | Electron + React | Cross-platform with isolated userData path |

## Browser URL Tracking Layers
1. **Accessibility API** (real-time, medium confidence) — reads URL bar via AXUIElement
2. **AppleScript/JXA** (real-time, high confidence) — browser-specific scripts for active tab
3. **Browser History DB** (periodic, high confidence) — reads SQLite history files every 60s
4. Falls back through layers automatically: AX API → AppleScript → History DB
