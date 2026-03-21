# Daylens — Progress Tracker

**Last updated: 2026-03-21**
**Current phase: Shipped v1 (macOS + Windows). Iterating on polish.**

---

## Current Versions

| Platform | Version | Distribution |
|----------|---------|--------------|
| macOS | v1.0.4 | Homebrew cask (`irachrist1/daylens`) + direct DMG |
| Windows | v0.1.4-win | GitHub Releases (`irachrist1/daylens-windows`) |

Release process: push a git tag → GitHub Actions builds → publishes GitHub Release.
- macOS tags: `v1.0.x` (patch bumps only, never minor/major)
- Windows tags: `v0.x.y-win`
- After each macOS release, update SHA256 in `homebrew-daylens/Casks/daylens.rb` and push to master on that repo.

---

## Completed

### macOS App
- [x] Native SwiftUI app, macOS 14 Sonoma minimum
- [x] Three-column NavigationSplitView shell (Today, Apps, History, Insights, Settings)
- [x] GRDB SQLite database with 3 additive migrations (v1 baseline, v2 focus_sessions, v3 category_overrides)
- [x] Automatic rolling backups on every launch (`~/Library/Application Support/Daylens/Backups/`)
- [x] `combinedDayPayload` — single DB read per day view, all queries in one pass
- [x] NSWorkspace app tracking → AppSession → `app_sessions` table
- [x] Idle detection via IOKit
- [x] Browser history import: Chrome, Arc, Brave, Edge, Safari, Firefox (reads native SQLite DBs)
- [x] Two-layer browser URL tracking: AX API primary → AppleScript fallback
- [x] In-flight session injection — live frontmost app appears in Today/Apps before session finalises
- [x] Category overrides — stored in DB, respected in every query path including AI context and focus score
- [x] Focus score — computed live in TodayViewModel and persisted in computedDailySummary, both with overrides applied
- [x] AI daily summaries and conversational chat (Anthropic API, streaming, local fallback)
- [x] `ai_conversations` persisted to DB, loaded on appear
- [x] Keychain API key storage with automatic UserDefaults migration on first launch
- [x] Keychain TOCTOU fix — `errSecDuplicateItem` retries `SecItemUpdate` instead of throwing
- [x] All DB calls on `Task.detached` — never blocking main actor
- [x] `DayBounds` range queries replacing fragile date-equality queries
- [x] History view, Insights view, Settings view (delete-all-data, export JSON, permission flows)
- [x] Menu bar presence via `NSStatusItem` (AppDelegate)
- [x] Menu bar icon = app icon (matches Dock) — fixed in v1.0.4
- [x] App icon: all 10 sizes (16px–1024px), correct DPI (1x=72, @2x=144), pre-built `AppIcon.icns` resource
- [x] Stage Manager icon — fixed in v1.0.4 (was truncated to 4 sizes due to wrong DPI on @2x PNGs)
- [x] XcodeGen (`project.yml`) — no `.xcodeproj` in git
- [x] Liquid glass blue gradient app icon

### Distribution & Infrastructure
- [x] GitHub Actions release workflow — triggers on `v*` tags, builds DMG, publishes GitHub Release
- [x] Homebrew tap (`irachrist1/homebrew-daylens`) — `brew tap irachrist1/daylens && brew install --cask daylens`
- [x] Quarantine stripping in Homebrew postflight (`xattr -dr com.apple.quarantine`)
- [x] curl installer — `curl -fsSL https://irachrist1.github.io/daylens/install.sh | sh`
- [x] GitHub Pages marketing site (irachrist1.github.io/daylens) — auto-deploys from `website/` on push to main
- [x] Website: professional landing page with animations, feature grid, download section
- [x] Website: all colors match app icon blue (#68AEFF), no amber/yellow

### Windows App
- [x] Electron + React companion app at `irachrist1/daylens-windows`
- [x] GitHub Actions release workflow — triggers on `v*-win` tags, builds NSIS installer + portable exe
- [x] Active window tracking via `@paymoapp/active-window` (replaced `active-win` v8 which dropped Windows)
- [x] Isolated userData path (`DaylensWindows`) — never conflicts with macOS app data
- [x] Released as v0.1.4-win (4 CI iterations to fix Vite entry points, node: builtins, ARM64 native deps)

---

## Open / Backlog

### macOS — Known Issues
- [ ] `postflight` quarantine strip in Homebrew cask doesn't reliably fire — users on direct DMG still need `xattr` manually or Settings → Privacy & Security → Open Anyway
- [ ] Website visit recovery: `website_visits` populated but may have gaps for pre-v1 data (March 19 scaffold-era DB at `~/Library/Application Support/DayLens-Claude/daylens.db`)
- [ ] No backup integrity check on launch — should run `PRAGMA integrity_check` on the latest backup and warn if corrupt

### macOS — Polish
- [ ] Real app screenshots on marketing site and README (TODO placeholder still in README)
- [ ] Timeline rendering edge cases (overlapping sessions, very short sessions)
- [ ] Dark mode full visual pass
- [ ] Performance profile — background tracking CPU/battery impact

### Windows — In Progress
- [ ] App icon in taskbar/Start menu — needs verification on a real Windows machine
- [ ] Active window tracking — verify `@paymoapp/active-window` works correctly end-to-end
- [ ] Browser history import — not yet implemented on Windows (macOS-only feature today)
- [ ] AI chat — needs testing with a real API key on Windows

### Future Features
- [ ] Browser extension for high-confidence tab/page attribution
- [ ] Weekly and monthly trend views
- [ ] Command bar / natural-language quick lookup
- [ ] CSV export (in addition to JSON)
- [ ] Configurable tracking thresholds (idle grace, min session duration)
- [ ] Cross-device sync (post-v1)
- [ ] Private browsing detection and coarse-only tracking option

---

## Architecture Reference

| Component | Approach |
|-----------|----------|
| macOS min version | 14.0 (Sonoma) — required for @Observable, modern SwiftUI |
| Database | GRDB.swift — SQLite, ValueObservation, additive migrations only |
| Browser tracking | Native SQLite + AX API + AppleScript — no extensions required |
| AI | Direct Anthropic API via URLSession (streaming) — no backend |
| Project generation | XcodeGen + SPM — `project.yml` is source of truth |
| State management | @Observable macro — property-level SwiftUI updates |
| API key storage | macOS Keychain only — never UserDefaults |
| App sandbox | Disabled — required for filesystem, AX API, AppleScript |
| Menu bar | NSStatusItem via AppDelegate |
| Windows app | Electron + React, userData = `DaylensWindows` (never `Daylens`) |

## Browser URL Tracking Layers (macOS)
1. **AX API** — real-time reads URL bar via AXUIElement (medium confidence)
2. **AppleScript** — real-time browser-specific scripts for active tab (high confidence)
3. **Browser History DB** — polled every 60s from native SQLite files (high confidence)
Falls back automatically: AX API → AppleScript → History DB

## Critical Rules (never violate)
- `eraseDatabaseOnSchemaChange = true` is permanently banned — caused data loss 2026-03-20
- Never open `daylens.sqlite` with external tools while app is running (WAL corruption)
- Windows Electron app userData must stay `DaylensWindows` — never `Daylens`
- All DB calls must use `Task.detached` — never on main actor
- Keychain: do NOT add `kSecUseDataProtectionKeychain: true` (ad-hoc signing has no entitlement)
- macOS version tags: `1.0.x` patch only. Windows: `0.x.y-win`. Never bump minor/major without discussion.
