# DayLens — macOS Activity Analyst

A premium, native macOS app that turns laptop behavior into calm, trustworthy personal intelligence.

## What It Does

DayLens passively tracks which apps, browsers, and websites you use on your Mac, normalizes the messy real-world data (idle periods, rapid switching, Stage Manager bursts), and presents it through a beautiful three-column dashboard with AI-powered daily summaries and conversational Q&A.

## Architecture

```
Swift + SwiftUI (macOS 14+)
├── Capture Layer     — NSWorkspace, CGEventSource, Accessibility API
├── Data Layer        — SQLite via GRDB.swift
├── AI Layer          — Anthropic SDK (claude-sonnet-4-6 default)
├── Dashboard         — NavigationSplitView 3-column layout
└── Browser Exts      — Chromium MV3 + Safari Web Extension
```

## Project Structure

```
DayLens/
├── Package.swift
├── Sources/DayLens/
│   ├── App/                    # DayLensApp, AppDelegate, AppEnvironment
│   ├── Capture/                # AppMonitor, IdleDetector, SessionNormalizer
│   │                           # BrowserExtensionReceiver, WindowTitleHeuristics
│   ├── Data/
│   │   ├── Models/             # ActivityEvent, AppSession, BrowserSession,
│   │   │                       # WebsiteVisit, DailySummary, AIConversation,
│   │   │                       # UserSettings
│   │   ├── Repositories/       # ActivityRepository, InsightRepository
│   │   └── Aggregation/        # DailyAggregator (SQL rollups)
│   ├── AI/                     # AnthropicClient, DailySummaryGenerator,
│   │                           # ConversationalAnalyst, PromptTemplates
│   ├── Dashboard/
│   │   ├── Sidebar/            # SidebarView
│   │   ├── Today/              # TodayView, AISummaryCard, FocusBreakdownView
│   │   ├── Timeline/           # TimelineView, TimelineSegmentView
│   │   ├── Apps/               # AppsView
│   │   ├── Browsers/           # BrowsersView
│   │   ├── Websites/           # WebsitesView
│   │   ├── Insights/           # InsightsView, ChatView
│   │   ├── Inspector/          # InspectorView (right panel drill-downs)
│   │   └── Settings/           # SettingsView, PermissionsOnboardingView
│   └── Shared/
│       ├── DesignSystem/       # DLColors, DLTypography, RankedBarView,
│       │                       # DensityStripView
│       └── Utilities/          # DateHelpers
├── Tests/DayLensTests/
│   ├── CaptureTests/           # SessionNormalizerTests
│   ├── DataTests/              # DatabaseTests, DailyAggregatorTests
│   └── AITests/                # PromptGroundingTests
└── Extensions/
    ├── Chromium/               # MV3 extension (Chrome, Arc, Brave, Edge)
    └── Safari/                 # Safari Web Extension
```

## Tracking Rules (trust-critical)

| Rule | Value |
|---|---|
| App "used" threshold | ≥ 5 seconds frontmost |
| Idle grace period | 120 seconds of no input |
| Rapid switch merge | Same app resumes within 8 seconds → merged |
| Stage Manager debounce | 500ms before committing activation |
| Private browsing | No domain/page stored (time-only or nothing, configurable) |
| Sub-threshold events | Stored in DB but excluded from dashboard summaries |

## Browser Extension IPC

Extensions POST to `http://127.0.0.1:27182/visit`:
```json
{
  "domain": "youtube.com",
  "title": "SwiftUI Tutorial",
  "browser": "chrome",
  "is_private": false,
  "timestamp": 1705312800.0
}
```

High-confidence path (extension): `confidence = 1.0`
Fallback path (window title heuristics): `confidence = 0.5`

## AI Analyst

- **Model**: `claude-sonnet-4-6` (default), switchable to `claude-opus-4-6` or `claude-haiku-4-5`
- **Grounding**: All prompts inject real structured data; hallucination is explicitly prohibited
- **Daily summaries**: Generated automatically at day boundary or on-demand
- **Chat**: Streaming conversational Q&A with data context injected per query

## Privacy

- Local-first: all data stays on your Mac
- No keystrokes, no screen recording, no content capture
- Private browsing: configurable — track nothing, or browser time only
- Full export (JSON) and delete-all support
- Accessibility API used only for window title reading (disabled gracefully if not granted)

## Setup

1. Open `DayLens/Package.swift` in Xcode 15+
2. Add your Anthropic API key in Settings → AI
3. Optionally grant Accessibility access for better website attribution
4. Install the browser extension from `Extensions/Chromium/` or `Extensions/Safari/`

## Milestones

- **M0** ✅ Scaffold, data model, permissions
- **M1** ✅ Core capture (AppMonitor, IdleDetector, SessionNormalizer)
- **M2** ✅ Website/browser extension integration
- **M3** ✅ Dashboard (Today, Timeline, Apps, Browsers, Websites, Insights)
- **M4** ✅ AI analyst (summaries, conversational Q&A)
- **M5** ✅ Settings, privacy controls, export/delete
