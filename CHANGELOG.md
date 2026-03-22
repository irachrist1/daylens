# Changelog

All notable changes to Daylens are documented in this file.

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
