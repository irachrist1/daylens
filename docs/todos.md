# Daylens MVP — Progress Tracker

## Current State
**Phase: Initial Implementation Complete (Code Written)**
All source files created. Project needs `xcodegen generate` on macOS to produce the Xcode project, then build and test.

## What Works (Code Complete)
- [x] Project structure with XcodeGen (`project.yml`)
- [x] GRDB database layer with full schema and migrations
- [x] All data models (ActivityEvent, AppSession, BrowserSession, WebsiteVisit, DailySummary)
- [x] NSWorkspace-based app tracking (ActivityTracker)
- [x] Idle detection via IOKit (IdleDetector)
- [x] Native browser history reading — Chrome, Arc, Brave, Edge, Safari, Firefox (BrowserHistoryReader)
- [x] Accessibility API for window title and URL extraction (AccessibilityService)
- [x] Session normalization and focus score computation (SessionNormalizer)
- [x] Tracking coordinator orchestrating all services (TrackingCoordinator)
- [x] Permission management — accessibility, full disk access, login item (PermissionManager)
- [x] Anthropic Claude API client with streaming (AIService)
- [x] Grounded prompt builder for AI (AIPromptBuilder)
- [x] Local analysis fallback when AI unavailable (LocalAnalyzer)
- [x] Keychain-based API key storage
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
- [x] Settings with API key, tracking toggle, browser status, data retention, delete
- [x] Design system (spacing, colors, typography tokens)
- [x] Unit tests for session normalization, browser history parsing, aggregation

## Broken / Incomplete
- [ ] Not yet compiled or runtime-tested (created on Linux)
- [ ] No app icon asset (placeholder only)
- [ ] XcodeGen needs to be run on macOS to generate .xcodeproj
- [ ] Accessibility API may need runtime testing for browser URL extraction
- [ ] Browser history reader needs testing with actual browser databases
- [ ] Safari requires Full Disk Access — onboarding explains this but can't auto-grant

## Fixing In This Pass
- Created all ~50 Swift source files from scratch
- Implemented native-first browser tracking (reading SQLite files directly, not extension-dependent)
- Built complete AI integration with Anthropic API + local fallback
- Every UI control is wired to real logic (no fake buttons)
- Every screen has meaningful empty states

## Remaining for MVP
- [ ] Build and fix compilation issues in Xcode
- [ ] Runtime test full tracking pipeline
- [ ] Test onboarding flow end-to-end
- [ ] Verify browser history reading works with real databases
- [ ] Add app icon asset
- [ ] Polish timeline rendering for edge cases
- [ ] Test AI streaming response quality
- [ ] Performance profile background tracking
- [ ] Dark mode visual verification

## Risks / Technical Debt
1. **Chrome database locking**: Copying the file for reading should work but needs validation
2. **Safari Full Disk Access**: Significant permission ask; well-explained in onboarding
3. **Accessibility API depth**: URL bar extraction depends on browser AX tree structure
4. **No runtime validation**: All code was written without compilation; expect some fixes needed
5. **GRDB version**: Using 6.24.0; should be compatible with macOS 14

## Decisions
| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Min macOS version | 14.0 (Sonoma) | Enables @Observable, modern SwiftUI |
| Database | GRDB.swift | Best Swift SQLite library, migration support |
| Browser tracking | Native-first (SQLite + AX API) | No extensions required for MVP |
| AI | Direct Anthropic API (URLSession) | No backend server needed |
| Project generation | XcodeGen | Clean YAML config, generates .xcodeproj |
| State management | @Observable macro | Modern SwiftUI, less boilerplate |
| API key storage | macOS Keychain | Secure, native |
| App sandbox | Disabled | Required for file system access (browser history, etc.) |
