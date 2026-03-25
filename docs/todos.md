# Daylens macOS — Progress Tracker

**Last updated: 2026-03-25 · Current version: v1.0.19**
**Repo: `irachrist1/daylens` · Branch: `main`**

> Windows companion app is tracked separately in `irachrist1/daylens-windows`.

---

## Release Process

1. Increment `MARKETING_VERSION` in `project.yml` (patch only: `1.0.x` — never bump minor/major)
2. Run `xcodegen generate --spec project.yml` so `Daylens.xcodeproj` matches the source-of-truth version
3. Add CHANGELOG entry and update any release-facing docs/README copy
4. Commit and push to `main`
5. `git tag v1.0.x && git push origin v1.0.x` → triggers GitHub Actions build
6. Wait for build: `gh run list --repo irachrist1/daylens --limit 3`
7. Get SHA256: `curl -sL https://github.com/irachrist1/daylens/releases/download/v1.0.x/Daylens-1.0.x.dmg.sha256`
8. Update `homebrew-daylens/Casks/daylens.rb` version + sha256 → push to `master` on that repo

---

## Completed

### App Core
- [x] Native SwiftUI, macOS 14 Sonoma minimum
- [x] Three-column NavigationSplitView shell (Today, Apps, History, Insights, Settings)
- [x] GRDB SQLite — 3 additive migrations (v1 baseline, v2 focus_sessions, v3 category_overrides)
- [x] `combinedDayPayload` — single DB read per day, all queries in one pass
- [x] All DB calls on `Task.detached` — never blocking main actor
- [x] Automatic rolling backups on every launch (`~/Library/Application Support/Daylens/Backups/`)
- [x] Keychain API key storage with automatic UserDefaults migration on first launch
- [x] Keychain TOCTOU fix — `errSecDuplicateItem` retries `SecItemUpdate`

### Tracking
- [x] NSWorkspace app tracking → AppSession → `app_sessions` table
- [x] Idle detection via IOKit
- [x] Browser history import: Chrome, Arc, Brave, Edge, Safari, Firefox
- [x] Two-layer browser URL tracking: AX API primary → AppleScript fallback
- [x] In-flight session injection — frontmost app visible in Today/Apps before session ends
- [x] Category overrides — stored in DB, respected in every query path including AI context and focus score
- [x] Focus score — computed live in TodayViewModel and persisted in computedDailySummary, both with overrides applied
- [x] `DayBounds` range queries replacing fragile date-equality queries

### Views
- [x] Today dashboard: overview cards, bento layout, timeline, top apps, AI summary, focus score
- [x] Apps view: usage bars, category badges, app icons, detail sessions + websites
- [x] History view, Insights view (AI chat), Settings view
- [x] AI daily summaries and conversational chat (Anthropic API, streaming, local fallback)
- [x] `ai_conversations` persisted to DB, loaded on appear

### Icon & Menu Bar
- [x] Liquid glass blue gradient app icon
- [x] All 10 icon sizes (16px–1024px), correct DPI (1x=72, @2x=144), pre-built `AppIcon.icns`
- [x] Stage Manager icon — fixed v1.0.4 (was truncated to 4 sizes, wrong @2x DPI)
- [x] Menu bar icon matches Dock icon — fixed v1.0.4 (was generic sun SF Symbol)

### Distribution
- [x] GitHub Actions release workflow — triggers on `v*` tags, builds DMG, publishes release
- [x] Homebrew tap (`irachrist1/homebrew-daylens`) — `brew tap irachrist1/daylens && brew install --cask daylens`
- [x] curl installer — `curl -fsSL https://irachrist1.github.io/daylens/install.sh | sh`
- [x] GitHub Pages marketing site (irachrist1.github.io/daylens) — auto-deploys from `website/` on push to main
- [x] XcodeGen (`project.yml`) — no `.xcodeproj` in git

---

## Open / Backlog

### Known Issues
- [ ] Homebrew `postflight` quarantine strip doesn't reliably fire — direct DMG users still need Settings → Privacy & Security → Open Anyway
- [ ] No backup integrity check on launch — should run `PRAGMA integrity_check` on latest backup and warn if corrupt
- [ ] Website visit gaps possible for pre-v1 data (March 19 scaffold-era DB at `~/Library/Application Support/DayLens-Claude/daylens.db`)

### Polish
- [ ] Real app screenshots on marketing site and README (TODO placeholder still in README)
- [ ] Timeline rendering edge cases (overlapping/very short sessions)
- [ ] Dark mode full visual pass
- [ ] Performance profile — background tracking CPU/battery impact

### Future Features
- [ ] Browser extension for high-confidence tab/page attribution
- [ ] Weekly and monthly trend views
- [ ] Command bar / natural-language quick lookup
- [ ] CSV export (in addition to JSON)
- [ ] Configurable tracking thresholds (idle grace, min session duration)
- [ ] Private browsing detection and coarse-only tracking
- [ ] Cross-device sync (post-v1)

---

## Architecture Reference

| Component | Approach |
|-----------|----------|
| Min macOS | 14.0 Sonoma — required for @Observable, modern SwiftUI |
| Database | GRDB.swift — SQLite, additive migrations only |
| Browser tracking | Native SQLite + AX API + AppleScript — no extensions needed |
| AI | Direct Anthropic API via URLSession (streaming) — no backend |
| Project gen | XcodeGen + SPM — `project.yml` is source of truth |
| State | @Observable macro — property-level SwiftUI updates |
| API key | macOS Keychain only — never UserDefaults |
| Sandbox | Disabled — required for filesystem, AX API, AppleScript |
| Menu bar | NSStatusItem via AppDelegate |

### Browser URL Tracking Layers
1. **AX API** — real-time via AXUIElement (medium confidence)
2. **AppleScript** — real-time browser-specific scripts (high confidence)
3. **History DB** — polled every 60s from native SQLite files (high confidence)

Falls back automatically: AX API → AppleScript → History DB

---

## Critical Rules (never violate)
- `eraseDatabaseOnSchemaChange = true` is **permanently banned** — caused data loss 2026-03-20
- Never open `daylens.sqlite` with external tools while app is running (WAL corruption)
- All DB calls must use `Task.detached` — never on main actor
- Keychain: do NOT add `kSecUseDataProtectionKeychain: true` (ad-hoc signing, no entitlement)
- Never touch `AppState.swift`, `DaylensApp.swift`, or onboarding-related keys
- Version tags: `v1.0.x` patch only — never bump minor or major without discussion
