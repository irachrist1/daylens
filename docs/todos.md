# Daylens MVP — Progress Tracker

## Current State
**Phase: Feature-Complete Implementation**
All source files created with real logic. Includes native browser tracking, AI integration, data export, menu bar status item, and keyboard shortcuts.

## What Works (Code Complete)
- [x] Project structure with XcodeGen (`project.yml`) + SPM (`Package.swift`)
- [x] GRDB database layer with full schema and migrations
- [x] All data models (ActivityEvent, AppSession, BrowserSession, WebsiteVisit, DailySummary)
- [x] NSWorkspace-based app tracking (ActivityTracker)
- [x] Idle detection via IOKit (IdleDetector)
- [x] Native browser history reading — Chrome, Arc, Brave, Edge, Safari, Firefox (BrowserHistoryReader)
- [x] Accessibility API for window title and URL extraction (AccessibilityService)
- [x] AppleScript URL extraction fallback for all major browsers (AppleScriptURLProvider)
- [x] Two-layer browser URL tracking: AX API primary → AppleScript fallback
- [x] Session normalization and focus score computation (SessionNormalizer)
- [x] Tracking coordinator orchestrating all services (TrackingCoordinator)
- [x] Permission management — accessibility, full disk access, login item (PermissionManager)
- [x] Anthropic Claude API client with streaming (AIService)
- [x] Grounded prompt builder for AI (AIPromptBuilder)
- [x] Local analysis fallback when AI unavailable (LocalAnalyzer)
- [x] Keychain-based API key storage (with `import Security`)
- [x] Multi-step onboarding flow (Welcome → Permissions → Browser Access → Completion)
- [x] Three-column NavigationSplitView shell
- [x] Sidebar with section navigation and tracking status
- [x] Header bar with date navigation and search
- [x] Today dashboard (overview cards, timeline, top apps, AI summary)
- [x] Apps view with real app icons and usage bars
- [x] Browsers view with native tracking data
- [x] Websites view with domain tracking and confidence indicators
- [x] History view with daily summaries
- [x] Insights/AI chat with streaming and local fallback
- [x] Settings with API key, tracking toggle, browser status, data retention, export, delete
- [x] Data export to JSON via NSSavePanel
- [x] Menu bar status item (AppDelegate with NSStatusItem)
- [x] Keyboard shortcuts (⌘[/⌘] navigate days, ⌘T today, ⇧⌘P toggle tracking)
- [x] Design system (spacing, colors, typography tokens)
- [x] Unit tests for session normalization, browser history parsing, aggregation

## Remaining for MVP
- [ ] Build and fix compilation issues in Xcode (run `xcodegen generate` then `xcodebuild`)
- [ ] Runtime test full tracking pipeline
- [ ] Test onboarding flow end-to-end
- [ ] Verify browser history reading works with real databases
- [ ] Add app icon asset (replace placeholder)
- [ ] Polish timeline rendering for edge cases
- [ ] Test AI streaming response quality
- [ ] Performance profile background tracking
- [ ] Dark mode visual verification

## Architecture Highlights
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

## Browser URL Tracking Layers
1. **Accessibility API** (real-time, medium confidence) — reads URL bar via AXUIElement
2. **AppleScript/JXA** (real-time, high confidence) — browser-specific scripts for active tab
3. **Browser History DB** (periodic, high confidence) — reads SQLite history files every 60s
4. Falls back through layers automatically: AX API → AppleScript → History DB
