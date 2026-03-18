# Activity Analyst

A premium macOS-first desktop app that understands where you spend time across apps, browsers, and websites, then turns that into calm, beautiful, trustworthy daily intelligence powered by AI.

## Overview

Activity Analyst is a personal activity intelligence product — not a simple timer app. It passively tracks your app usage, browser activity, and website visits, then uses AI (via Anthropic Claude) to generate useful daily insights and answer natural-language questions about your usage patterns.

### Key Features

- **Passive app tracking** — monitors frontmost app changes, launches, and terminations via NSWorkspace
- **Browser coverage** — tracks which browsers you use and, with companion extensions, which websites you visit
- **Session normalization** — handles messy real-world multitasking: rapid app switching, Stage Manager, short interruptions
- **Beautiful dashboard** — three-column native macOS layout with timeline, ranked bars, density strips, and narrative summaries
- **AI analyst** — daily summaries, trend analysis, and conversational Q&A grounded in your actual tracked data
- **Privacy-first** — all data stored locally in SQLite. No keystroke logging. No screen recording. Private browsing excluded by default.

## Architecture

**Stack:** Swift 5.9+ / SwiftUI + AppKit interop / GRDB.swift + SQLite / Anthropic SDK

See [architecture/Architecture.md](architecture/Architecture.md) for the full architecture decision memo including stack comparison, system design, data model, and implementation phases. See [architecture/PerformanceAndPrivacyNotes.md](architecture/PerformanceAndPrivacyNotes.md) for detailed performance budgets and privacy design.

### Project Structure

```
ActivityAnalyst/
├── App/                    # App entry point, AppDelegate, AppState
├── Models/                 # Data models (ActivityEvent, Session, AppRecord, etc.)
├── Services/
│   ├── Capture/            # System monitors (AppMonitor, WindowMonitor, IdleDetector, ExtensionBridge)
│   ├── Processing/         # Session normalization, debouncing, classification
│   ├── Storage/            # SQLite database, migrations, ActivityStore
│   ├── AI/                 # Anthropic SDK integration, PromptBuilder, ConversationManager
│   └── Privacy/            # Permission management, privacy filtering, data export
├── Views/
│   ├── MainWindow/         # Root ContentView with three-column layout
│   ├── Sidebar/            # Navigation sidebar
│   ├── Dashboard/          # TodayView, TimelineView, AISummaryCard
│   ├── Apps/               # App usage view
│   ├── Browsers/           # Browser usage view
│   ├── Websites/           # Website usage view
│   ├── Insights/           # AI insights and conversation
│   ├── AI/                 # AI conversation view
│   ├── Inspector/          # Right-side inspector panel
│   ├── Settings/           # Settings and preferences
│   ├── Onboarding/         # First-launch onboarding flow
│   ├── Components/         # Reusable UI components
│   └── Styles/             # Theme, typography, colors
├── ViewModels/             # Observable ViewModels
├── Utilities/              # Date formatters, duration formatter, constants
└── Resources/              # Info.plist, entitlements, assets

Extensions/
├── Chrome/                 # Chrome/Chromium extension (Manifest V3)
└── Safari/                 # Safari Web Extension

Tests/
└── ActivityAnalystTests/   # Unit tests with fixtures
```

## Prerequisites

- macOS 14.0 (Sonoma) or later
- Xcode 15.0 or later
- Swift 5.9+
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) (for project generation)

## Setup

### 1. Generate the Xcode project

```bash
brew install xcodegen
xcodegen generate
```

This uses `project.yml` to create `ActivityAnalyst.xcodeproj`.

### 2. Open in Xcode

```bash
open ActivityAnalyst.xcodeproj
```

### 3. Configure signing

- Select the ActivityAnalyst target
- Under Signing & Capabilities, select your development team
- The app runs outside the sandbox (required for Accessibility API access)

### 4. Build and run

```bash
# Via Xcode: ⌘R
# Or via command line:
xcodebuild -project ActivityAnalyst.xcodeproj -scheme ActivityAnalyst -configuration Debug build
```

### 5. Grant permissions

On first launch, the app will guide you through:

1. **Accessibility** — required for detecting the frontmost window
2. **Browser Extensions** — optional, for high-accuracy website tracking
3. **Screen Recording** — optional, for enhanced window title capture

### 6. API key for AI features

Set your Anthropic API key in the app's Settings or as an environment variable:

```bash
export ANTHROPIC_API_KEY="your-key-here"
```

The AI analyst uses Claude Sonnet 4.6 by default, with options for Opus 4.6 and Haiku 4.5.

## Browser Extensions

### Chrome / Chromium Browsers

1. Open `chrome://extensions/` in Chrome, Arc, Brave, or Edge
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `Extensions/Chrome/` directory
4. The extension icon will appear in your toolbar

### Safari

The Safari extension is bundled as a Safari Web Extension within the app. Enable it in Safari > Settings > Extensions.

## Tracking Rules

Default v1 thresholds (configurable in Settings):

| Rule | Default |
|------|---------|
| App "used" threshold | 5 seconds frontmost |
| Website "visited" threshold | 5 seconds active tab |
| Session merge window | 8 seconds |
| Idle grace period | 120 seconds |
| Data retention | 90 days |

Sub-5-second events are stored but excluded from top-level dashboard summaries by default.

## Testing

```bash
# Run all tests
xcodebuild test -project ActivityAnalyst.xcodeproj -scheme ActivityAnalyst -destination 'platform=macOS'

# Or via Swift Package Manager (core library tests only)
swift test
```

Test coverage includes:
- Session normalization (merging, thresholds, idle subtraction)
- Event debouncing
- Tracking rule defaults and overrides
- Privacy filtering (URL redaction, private browsing, window title redaction)
- Duration formatting
- AI prompt construction and safety constraints
- Daily summary aggregation

## Design

The app follows a restrained, native-first visual system:

- **Typography**: San Francisco (SF Pro) via system fonts
- **Icons**: SF Symbols throughout
- **Color**: Neutral-first palette with one calm teal-blue accent
- **Layout**: Three-column (sidebar, content, inspector) inspired by Arc and macOS HIG
- **Motion**: Short, purposeful transitions using native spatial logic

The app explicitly avoids: cheap gradients, generic SaaS dashboard aesthetics, chart-heavy "BI dashboard" layouts, and gamified habit app patterns.

## Privacy

- All raw activity data stored locally in SQLite
- No keystroke logging
- No screen recording or screenshots
- Private/incognito browsing excluded by default (configurable)
- URLs are redacted (query params stripped) before AI analysis
- Full data export and deletion available in Settings
- Configurable retention period (default 90 days)

## License

Copyright 2026 Activity Analyst. All rights reserved.
