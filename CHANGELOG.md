# Changelog

All notable changes to Daylens are documented in this file.

## [1.0.16] - 2026-03-23

### Fixed
- Clicking Update now always downloads the latest available version, not the version shown in the banner — re-fetches release info before starting download

## [1.0.15] - 2026-03-23

### Fixed
- In-app update no longer shows "can't be opened" after install — the quarantine xattr from the DMG is now stripped before replacing the app bundle
- Old `.old` backup app bundles are cleaned up after successful update instead of accumulating in /Applications

## [1.0.14] - 2026-03-23

### Fixed
- In-app update download now works — replaced background URL sessions (which fail on ad-hoc signed builds) with standard URL sessions for both update checking and DMG downloading

### Added
- Debug builds show a red "DEV" badge on the app icon to distinguish from the installed release version

### Changed
- Removed `-forceUpdateBanner` launch argument from the scheme

## [1.0.13] - 2026-03-23

### Fixed
- Update banner now appears correctly when `-forceUpdateBanner` launch argument is passed — polling no longer overwrites the forced state
- Release builds now compile with full liquid glass support — upgraded CI from macOS 14 / Xcode 16.2 to macOS 26 / Xcode 26.2 (Swift 6.2)

### Added
- Visible version number at the bottom of Settings view

## [1.0.12] - 2026-03-23

### Changed
- Rolled back liquid glass from sidebar, filter pills, floating HUD, AI input bar, suggestion chips, and duration chips — glass is now limited to the floating date navigator and update banner only, fixing contrast issues and broken click targets

## [1.0.11] - 2026-03-23

### Added
- Native macOS Tahoe liquid glass on the floating date navigator and update banner — `.glassEffect` on macOS 26+ with graceful `ultraThinMaterial` fallback on older versions
- `GlassEffectContainer` wraps the top chrome so adjacent glass elements composite correctly

### Fixed
- Theme switcher now updates immediately — converted color scheme from a computed UserDefaults property to a stored `@Observable` property so SwiftUI detects changes
- Sidebar corners and transparent titlebar now appear correctly in release builds — replaced `NSColor(named:)` lookup (which always failed) with inline adaptive color matching `DS.surfaceContainer`
- Floating date control no longer overlaps traffic lights when sidebar is collapsed — moved from `.overlay(alignment: .topLeading)` to `safeAreaInset` which automatically clears window chrome
- Update banner and date header now stack naturally via `safeAreaInset` instead of fighting between a VStack and an overlay with manual offsets

## [1.0.10] - 2026-03-23

### Fixed
- Kept the in-app update banner fully inside the safe content area so new releases still surface the Update and What's New prompt reliably

## [1.0.9] - 2026-03-23

### Changed
- Replaced the fixed top date row with a floating liquid-glass date navigator that reclaims unused shell chrome
- Tightened the update banner spacing so it sits higher and leaves clearer separation above the floating date control

## [1.0.8] - 2026-03-23

### Fixed
- Restored the protected `DaylensApp.swift` scene configuration and moved title bar styling back into `AppDelegate`
- Resolved synced app icons on the main actor so snapshot exports no longer rely on AppKit calls from a background task

### Removed
- Deleted the unused `TimelineBand` view after the timeline removal shipped in 1.0.7

## [1.0.7] - 2026-03-22

### Added
- Focus sessions can now be labeled from the Focus tab, backed by the additive `v4_focus_session_label` migration

### Fixed
- Web companion snapshots now include embedded app icons and per-domain top pages for richer dashboard drilldowns
- Linked desktops now start sync automatically on launch, finalize the previous day at day change, and flush sync on quit
- Removed the misleading activity timeline from Today and History
- Intelligence Insight and Recent Sessions cards now stretch to a consistent height
- Top Websites now always expose a subtle See all control when more than three sites are present
- The native title bar is hidden so the custom shell header no longer sits under a dark chrome band
- App detail session rows now respect category overrides, matching the override-aware summaries
- Focus view now captures a label before starting a session and shows it in Previous Focus Sessions

## [1.0.6] - 2026-03-22

### Added
- In-app auto-update: checks GitHub Releases every 30 minutes, shows a banner when a new version is available, downloads and installs the DMG automatically
- API key now syncs to Convex when saved in Settings, enabling AI chat on the web companion

### Fixed
- QR code in Web Companion settings now encodes the correct `/link?token=` path instead of the root URL

## [1.0.5] - 2026-03-22

### Fixed
- Idle detection no longer fragments sessions during media playback — sessions are held open during provisional idle (2-5 min) and only end on true away (5 min) or screen lock/sleep
- Fullscreen app Space transitions no longer create session gaps — same-app deactivation/reactivation within 1.5 seconds is seamlessly bridged
- Website duration tracking no longer relies on broken Chromium visit_duration — uses navigation-gap estimation with 30-minute cap
- Browser history reader now copies WAL/SHM sidecars to capture newest rows
- Browser history pagination replaces fixed LIMIT 500 — processes up to 5,000 rows per poll
- Active tab polling now runs even without Accessibility permission (AppleScript fallback)
- URL extraction failures require 3 consecutive misses before closing a website visit
- Live in-flight website visits now appear in Today and Apps views before finalization
- Focus score unified across Today view, daily summary, snapshot export, and AI context — all use the same multiplicative formula with 15% max switch penalty and web domain credit
- Excel, Word, PowerPoint, OneNote, Pages, Numbers, Keynote, and Notion now correctly classified as Productivity (were Uncategorized)
- Removed dead productivityBundleIDs constant that was never consulted
- Historical daily summaries recomputed on first launch after update to reflect corrected tracking data

## [1.0.4] - 2026-03-21

### Fixed
- Stage Manager icon now displays correctly — rebuilt icon set with correct DPI metadata and pre-built .icns resource
- Menu bar icon now matches the Dock icon instead of showing a generic sun symbol

## [1.0.3] - 2026-03-21

### Fixed

- App icon now includes all required sizes (16px through 1024px) — fixes missing icon in Stage Manager and Dock
- Website: replaced all amber/yellow accent hues with blue to match app icon

## [1.0.2] - 2026-03-21

### Changed

- New app icon: liquid glass blue gradient window mark
- Website accent color updated to match icon blue (#68AEFF)

## [1.0.0] - 2026-03-21

### Added

- Native macOS 14 SwiftUI app for tracking active app usage throughout the day
- Multi-browser website import and attribution for Chrome, Arc, Safari, Brave, Edge, and Firefox
- AI-powered daily summaries and conversational usage analysis with local fallback
- Today, Apps, History, Insights, and Settings surfaces with a polished three-column shell
- Focus scoring, session normalization, live in-flight session injection, and category overrides
- Menu bar presence, onboarding, permission flows, JSON export, and delete-all-data controls
- Automatic rolling database backups on launch and additive migration safeguards
- Open source release packaging, GitHub Releases automation, and GitHub Pages marketing site for V1
