# Architecture Decision Memo: macOS Activity Analyst

## 1. Architecture Options Comparison

### Option A: Native Swift-First Stack

**Stack:** Swift 5.9+, SwiftUI, selective AppKit interop, SQLite (via GRDB.swift), Anthropic Swift SDK

| Criterion | Rating | Notes |
|---|---|---|
| Native macOS UX quality | Excellent | Full access to SF Symbols, SF typography, native materials, vibrancy, sidebar styles, window management |
| macOS permissions / lifecycle | Excellent | Direct NSWorkspace, Accessibility API, CGEvent access. First-class citizen for Accessibility, Screen Recording, and Automation permissions |
| Power efficiency | Excellent | Event-driven via NotificationCenter, GCD, and Combine. No JS runtime overhead |
| Browser extension interop | Good | Native messaging via App Groups + XPC or local WebSocket/HTTP bridge |
| Reliability of tracking | Excellent | Direct access to NSWorkspace, CGWindowList, AX APIs |
| Maintainability | Good | Strong typing, SwiftUI declarative UI, well-defined module boundaries |
| Testability | Good | XCTest, protocol-oriented design, dependency injection. UI testing via XCUITest |
| Packaging / distribution | Excellent | Native .app bundle, notarization, App Store or direct distribution |
| Long-term extensibility | Excellent | Full platform access, widgets, menu bar extras, Shortcuts integration |

**Risks:** Steeper learning curve for complex custom layouts in SwiftUI; some SwiftUI limitations require AppKit fallbacks.

### Option B: Electron / Web-Tech Desktop Stack

**Stack:** Electron, TypeScript/React, SQLite (via better-sqlite3), Anthropic JS SDK

| Criterion | Rating | Notes |
|---|---|---|
| Native macOS UX quality | Poor | Chromium shell. Cannot match native materials, typography, or interaction patterns without heavy workarounds |
| macOS permissions / lifecycle | Fair | Requires native Node addons or helper binaries for Accessibility APIs, NSWorkspace |
| Power efficiency | Poor | Chromium renderer + Node.js process. High idle memory (200MB+), significant battery impact |
| Browser extension interop | Good | Shared JS ecosystem simplifies extension communication via native messaging or WebSocket |
| Reliability of tracking | Fair | Must shell out to native helpers for frontmost app, window title, idle detection |
| Maintainability | Good | Large ecosystem, fast iteration, familiar to web developers |
| Testability | Good | Jest, Playwright, extensive JS testing ecosystem |
| Packaging / distribution | Fair | Large bundle size (150MB+), auto-update complexity, no App Store without significant work |
| Long-term extensibility | Fair | Limited platform integration depth; each native feature requires a bridge |

**Risks:** Fails the "premium macOS-native" design bar. Battery/memory overhead contradicts performance requirements. Users who care about native quality will notice immediately.

### Option C: Tauri (Rust + WebView)

**Stack:** Tauri 2.0, Rust backend, TypeScript/React frontend, SQLite (via rusqlite), WebKit WebView

| Criterion | Rating | Notes |
|---|---|---|
| Native macOS UX quality | Fair | Uses native WebKit (not Chromium), but still a web view. Better than Electron but cannot match truly native UI |
| macOS permissions / lifecycle | Good | Rust can call macOS APIs via objc crate or Swift interop. More work than native Swift but viable |
| Power efficiency | Good | Much lighter than Electron. Native WebKit + Rust backend. Still carries web rendering overhead |
| Browser extension interop | Good | Rust/JS boundary works well for extension messaging |
| Reliability of tracking | Good | Rust backend can reliably access system APIs with appropriate bindings |
| Maintainability | Fair | Split brain: Rust for backend, TypeScript for frontend. Two ecosystems to maintain |
| Testability | Good | Rust testing for backend, JS testing for frontend |
| Packaging / distribution | Good | Small bundle, notarization support, but App Store distribution requires extra work |
| Long-term extensibility | Good | Rust backend is powerful, but UI is constrained to web capabilities |

**Risks:** Two-language complexity. Web view still cannot replicate native macOS sidebar, vibrancy, SF Symbols natively. Smaller ecosystem for macOS-specific patterns.

### Option D: Swift + AppKit Only (No SwiftUI)

**Stack:** Swift 5.9+, pure AppKit, SQLite (via GRDB.swift), Anthropic Swift SDK

| Criterion | Rating | Notes |
|---|---|---|
| Native macOS UX quality | Excellent | Full AppKit power, maximum control over every pixel |
| macOS permissions / lifecycle | Excellent | Same as Option A |
| Power efficiency | Excellent | Same as Option A |
| Browser extension interop | Good | Same as Option A |
| Reliability of tracking | Excellent | Same as Option A |
| Maintainability | Fair | AppKit is verbose. Much more boilerplate than SwiftUI for equivalent UI |
| Testability | Fair | UI testing more complex. Less declarative, harder to unit test views |
| Packaging / distribution | Excellent | Same as Option A |
| Long-term extensibility | Good | Full platform access but Apple is investing in SwiftUI as the future |

**Risks:** Much slower UI development. Apple's investment is clearly in SwiftUI. AppKit expertise is harder to hire for. Missing out on SwiftUI's declarative composition benefits.

## 2. Recommended Stack and Why

**Recommendation: Option A — Native Swift-First (SwiftUI + selective AppKit)**

The product vision demands a "premium macOS app that feels native, calm, and trustworthy." This is fundamentally a platform-quality argument. The product must:

1. **Feel invisible while collecting data** — only native code achieves the power efficiency bar
2. **Look and feel like a first-class macOS citizen** — SF typography, native materials, sidebar styles, vibrancy
3. **Deeply integrate with macOS** — Accessibility APIs, NSWorkspace, permissions, menu bar
4. **Be beautiful enough to use daily** — web shells cannot match native rendering quality

SwiftUI provides the fastest path to a declarative, testable, beautiful macOS UI while AppKit interop fills the gaps (NSTableView for performance-critical lists, custom window chrome, Accessibility API wrappers).

The only scenario where Electron/Tauri would win is if rapid cross-platform shipping mattered more than macOS quality. The PRD explicitly rejects this tradeoff.

### Final Stack

| Layer | Technology | Rationale |
|---|---|---|
| Language | Swift 5.9+ | Native, type-safe, modern concurrency |
| UI Framework | SwiftUI + AppKit interop | Declarative UI with native fallbacks |
| Data Layer | GRDB.swift + SQLite | Local-first, fast, proven on macOS |
| AI Backend | Anthropic Swift SDK (Claude sonnet-4.6) | Per build prompt requirement |
| Concurrency | Swift Concurrency (async/await, actors) | Safe, efficient background work |
| Browser Bridge | App Groups + local WebSocket server | Extension ↔ app communication |
| Testing | XCTest + Swift Testing | Unit, integration, UI tests |
| Build System | Xcode + Swift Package Manager | Standard macOS toolchain |
| Distribution | Direct (.dmg) + future App Store | Notarized, signed |

## 3. System Design

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    macOS Activity Analyst                  │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │  SwiftUI    │  │  Inspector  │  │  Command Bar    │  │
│  │  Dashboard  │  │  Panel      │  │  / Quick Launch │  │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘  │
│         │                │                    │           │
│  ┌──────┴────────────────┴────────────────────┴───────┐  │
│  │              ViewModels (ObservableObject)          │  │
│  │    DashboardVM · AppsVM · BrowsersVM · AIVM        │  │
│  └──────────────────────┬─────────────────────────────┘  │
│                         │                                 │
│  ┌──────────────────────┴─────────────────────────────┐  │
│  │              Service Layer (actors)                 │  │
│  │                                                     │  │
│  │  ┌───────────┐ ┌──────────┐ ┌───────────────────┐ │  │
│  │  │ Capture   │ │Processing│ │   AI Analyst      │ │  │
│  │  │ Engine    │ │ Pipeline │ │   (Anthropic SDK) │ │  │
│  │  │           │ │          │ │                    │ │  │
│  │  │ AppMon    │ │ Session  │ │ PromptBuilder     │ │  │
│  │  │ WindowMon │ │ Normal.  │ │ ConversationMgr   │ │  │
│  │  │ IdleDet.  │ │ Debounce │ │ EvidenceCollector │ │  │
│  │  │ ExtBridge │ │ Classify │ │                    │ │  │
│  │  └─────┬─────┘ └────┬─────┘ └─────────┬─────────┘ │  │
│  └────────┼─────────────┼─────────────────┼───────────┘  │
│           │             │                 │               │
│  ┌────────┴─────────────┴─────────────────┴───────────┐  │
│  │              Storage Layer (GRDB + SQLite)          │  │
│  │    ActivityStore · SessionStore · InsightStore      │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
├──────────────────────────────────────────────────────────┤
│  macOS System APIs                                        │
│  NSWorkspace · Accessibility · CGEvent · IOKit            │
├──────────────────────────────────────────────────────────┤
│  Browser Extensions                                       │
│  Chrome/Chromium Extension ←→ Native Messaging / WS       │
│  Safari Web Extension ←→ App Groups                       │
└──────────────────────────────────────────────────────────┘
```

### Component Responsibilities

**Capture Engine** — event-driven collectors that observe system state changes:
- `AppMonitor`: Listens to NSWorkspace notifications for app activation, deactivation, launch, terminate
- `WindowMonitor`: Observes frontmost window changes via Accessibility APIs for richer context (window title, etc.)
- `IdleDetector`: Uses CGEventSource or IOKit HID idle time to detect user inactivity
- `ExtensionBridge`: Receives tab/URL data from browser extensions via local WebSocket server

**Processing Pipeline** — normalizes raw events into meaningful sessions:
- `SessionNormalizer`: Merges rapid switches, applies minimum duration thresholds, creates logical sessions
- `EventDebouncer`: Coalesces rapid-fire events within configurable windows
- `CategoryClassifier`: Assigns categories (productivity, communication, entertainment, etc.) to apps and domains

**AI Analyst** — generates insights from stored activity data:
- `PromptBuilder`: Constructs grounded prompts from real activity data with evidence citations
- `ConversationManager`: Manages multi-turn conversations with context from tracked history
- `EvidenceCollector`: Gathers relevant activity data to support AI responses

**Storage Layer** — SQLite-backed local persistence:
- `Database`: GRDB database setup, migrations, connection management
- `ActivityStore`: CRUD for raw activity events
- `SessionStore`: Aggregated session data
- `InsightStore`: AI-generated summaries and insights

**Privacy Layer** — enforces privacy rules:
- `PermissionManager`: Handles macOS permission requests and status tracking
- `PrivacyFilter`: Filters private browsing data, applies redaction rules
- `DataExporter`: Export and deletion support

### Data Flow

1. **Capture**: System events arrive via NSWorkspace notifications, AX observer callbacks, or extension messages
2. **Buffer**: Raw events are buffered in-memory with a short flush interval (1-2 seconds)
3. **Process**: The processing pipeline normalizes, debounces, and classifies events
4. **Store**: Processed events and sessions are written to SQLite
5. **Present**: ViewModels observe the store and update the UI
6. **Analyze**: AI analyst queries the store, builds grounded prompts, and returns insights

## 4. Data Model

### Entity Relationship

```
User (1) ──── (N) Device
Device (1) ──── (N) ActivityEvent
ActivityEvent (N) ──── (1) App
ActivityEvent (N) ──── (1) Browser (nullable)
ActivityEvent (N) ──── (1) Website (nullable)
ActivityEvent (N) ──── (1) Session
Session (N) ──── (1) DailySummary
DailySummary (1) ──── (N) Insight
AIConversation (1) ──── (N) AIMessage
```

### Core Entities

**App**
- `id`: UUID
- `bundleIdentifier`: String
- `name`: String
- `category`: Category
- `isBlocked`: Bool (excluded from tracking)
- `firstSeen`: Date
- `iconData`: Data? (cached app icon)

**Browser**
- `id`: UUID
- `bundleIdentifier`: String
- `name`: String (Chrome, Safari, Arc, etc.)
- `extensionInstalled`: Bool
- `firstSeen`: Date

**Website**
- `id`: UUID
- `domain`: String
- `category`: Category
- `isBlocked`: Bool
- `firstSeen`: Date

**ActivityEvent**
- `id`: UUID
- `timestamp`: Date
- `eventType`: EventType (appActivated, appDeactivated, tabChanged, idleStart, idleEnd, etc.)
- `appId`: UUID
- `browserId`: UUID?
- `websiteId`: UUID?
- `windowTitle`: String?
- `url`: String?
- `pageTitle`: String?
- `source`: CaptureSource (native, extension, heuristic)
- `confidence`: Double (0.0–1.0)
- `isPrivateBrowsing`: Bool
- `metadata`: JSON?

**Session**
- `id`: UUID
- `appId`: UUID
- `browserId`: UUID?
- `websiteId`: UUID?
- `startTime`: Date
- `endTime`: Date
- `duration`: TimeInterval (active time, excludes idle)
- `idleDuration`: TimeInterval
- `eventCount`: Int
- `source`: CaptureSource
- `confidence`: Double
- `category`: Category
- `isSignificant`: Bool (duration >= minimum threshold)

**DailySummary**
- `id`: UUID
- `date`: Date (calendar day)
- `totalActiveTime`: TimeInterval
- `totalIdleTime`: TimeInterval
- `topApps`: JSON (ranked list with durations)
- `topBrowsers`: JSON
- `topWebsites`: JSON
- `focusScore`: Double (0.0–1.0)
- `fragmentationScore`: Double (0.0–1.0)
- `sessionCount`: Int
- `switchCount`: Int
- `aiSummary`: String?
- `generatedAt`: Date?

**Insight**
- `id`: UUID
- `dailySummaryId`: UUID
- `type`: InsightType (pattern, anomaly, recommendation, trend)
- `title`: String
- `body`: String
- `evidence`: JSON (references to sessions/events)
- `createdAt`: Date

**AIConversation**
- `id`: UUID
- `createdAt`: Date
- `title`: String?

**AIMessage**
- `id`: UUID
- `conversationId`: UUID
- `role`: MessageRole (user, assistant)
- `content`: String
- `evidence`: JSON?
- `createdAt`: Date

### Enums

**EventType**: appActivated, appDeactivated, appLaunched, appTerminated, tabChanged, urlChanged, idleStart, idleEnd, sessionStart, sessionEnd

**CaptureSource**: native, extension, heuristic, manual

**Category**: productivity, communication, entertainment, social, reference, development, design, writing, finance, shopping, news, health, education, utilities, uncategorized

**InsightType**: pattern, anomaly, recommendation, trend, comparison

## 5. Permissions and Privacy Model

### Required macOS Permissions

| Permission | Purpose | When Requested |
|---|---|---|
| Accessibility | Read frontmost window titles for browser tab inference (fallback) | Onboarding, if extension not installed |
| Screen Recording | Optional: window title capture for non-AX-accessible apps | Onboarding (optional) |
| Automation (AppleScript) | Optional: query browser tab URLs when extension unavailable | On first use of fallback |

### Permission Onboarding Flow

1. **Welcome** — explain what the app does and why permissions are needed
2. **Accessibility** — explain: "We need this to see which window is in front so we can accurately track your active app usage." One-click open to System Preferences
3. **Browser Extensions** — explain: "Install our browser extension for accurate website tracking. Without it, we can still track which browser you use, but not which sites."
4. **Optional permissions** — Screen Recording, Automation — explain clearly, allow skip
5. **Privacy promise** — "All data stays on your Mac. We never log keystrokes or record your screen."

### Privacy Rules

1. **Local-first**: All raw activity data stored only in local SQLite database
2. **No keystroke logging**: Never capture keyboard input content
3. **No screen recording**: Never capture screenshots or screen content
4. **Private browsing**: By default, do not store page-level data from incognito/private windows. Only track coarse browser usage time. Configurable in settings.
5. **Minimal collection**: Only capture what's needed — app name, window title (when permitted), URL/domain, timestamps
6. **Secure transport**: Any data sent to AI backend is transmitted over HTTPS with TLS 1.3
7. **Redaction**: Strip sensitive URL parameters, query strings, and authentication tokens before AI analysis
8. **Retention**: Configurable retention period (default: 90 days). Automatic pruning of old data.
9. **Export**: Full data export in JSON format
10. **Deletion**: Complete data deletion with confirmation
11. **Transparency**: Settings page shows exactly what is being tracked and what permissions are active

### Data Flow to AI Backend

Only aggregated, redacted data is sent:
- App names and durations (not window titles by default)
- Domain names and durations (not full URLs by default)
- Session patterns and timing
- User's explicit question

Raw page titles, URLs with query params, and window titles are stripped unless the user explicitly opts in.

## 6. Implementation Phases

### M0: Architecture & Foundation
- Architecture memo (this document)
- Project scaffold (Xcode project, SPM packages, directory structure)
- Data model definitions
- Database schema and migrations
- Basic app shell with three-column layout
- Design system (Theme, Typography, Colors)

### M1: Core Capture
- AppMonitor via NSWorkspace notifications
- WindowMonitor via Accessibility APIs
- IdleDetector via IOKit/CGEventSource
- Raw event storage pipeline
- Basic event viewer for debugging

### M2: Website Intelligence
- Chrome/Chromium browser extension
- Safari web extension
- ExtensionBridge (WebSocket server for native messaging)
- Domain/page attribution logic
- Confidence model for attribution sources
- Fallback heuristics (window title parsing for browser URLs)

### M3: Session Processing
- SessionNormalizer with configurable rules
- EventDebouncer for rapid switch coalescing
- Minimum duration thresholds (5-second rule)
- Session merging across short interruptions (8-second rule)
- CategoryClassifier with initial taxonomy
- DailySummary generation

### M4: Beautiful Dashboard
- TodayView with narrative layout
- Timeline (stacked daily timeline)
- Top Apps / Top Browsers / Top Websites ranked bars
- Focus vs. Distraction breakdown
- Fragmentation indicators
- AI Summary card (placeholder until M5)
- Density strip visualization
- Command bar / quick launcher
- Dark mode support

### M5: AI Analyst
- Anthropic SDK integration (sonnet-4.6 default, opus-4.6 / haiku-4.5 options)
- PromptBuilder with evidence grounding
- Daily summary generation
- ConversationManager for Q&A
- EvidenceCollector for citation support
- Safeguards against hallucination

### M6: Hardening
- Permission onboarding flow polish
- Privacy settings (retention, export, delete)
- Performance optimization (lazy loading, pagination)
- Accessibility support (VoiceOver, keyboard navigation)
- Error handling and recovery
- Production logging (privacy-safe)

## 7. Testing Strategy

### Unit Tests
- **Session normalization**: rapid switching, merging, minimum thresholds, idle gaps
- **Event debouncing**: coalescing rapid events, configurable windows
- **Tracking rules**: 5-second minimum, 8-second merge window, idle detection
- **Category classification**: known apps/domains, unknown handling
- **Duration calculations**: active time vs idle time, overlap handling
- **AI prompt construction**: evidence grounding, redaction, context building
- **Privacy filtering**: private browsing exclusion, URL redaction, sensitive data stripping
- **Data aggregation**: daily summaries, top-N calculations, focus scores

### Integration Tests
- **Capture → Store pipeline**: events flow from monitor to database correctly
- **Extension → Bridge → Store**: browser extension messages are received and stored
- **Store → ViewModel → View**: data changes propagate to UI
- **AI query → response cycle**: question → evidence collection → prompt → API → display

### Fixtures and Replay
- Create realistic sample timelines (a full workday of events) as JSON fixtures
- Build a replay mechanism that feeds fixture events into the processing pipeline
- Use these for deterministic testing of normalization, aggregation, and AI prompts

### Performance Tests
- Measure idle CPU usage with capture running
- Measure memory footprint with 30 days of data
- Measure dashboard load time with 10,000+ sessions
- Measure event processing throughput

### UI Tests (XCUITest)
- Navigation between sidebar items
- Dashboard renders with sample data
- Command bar opens and responds to input
- Settings changes persist

## 8. Open Questions

1. **Minimum visit duration**: The PRD suggests 5 seconds. Should we also track "micro-visits" (< 5s) for domain-level rollup but hide them from top-level views? **Decision: Yes, store all events but filter sub-5s from dashboard summaries by default.**

2. **Private browsing default**: Track coarse browser time only (no page/domain data) in private mode? **Decision: Yes, this is the recommended default. Configurable to "track nothing" or "track everything" in settings.**

3. **AI data boundary**: How much raw detail leaves the device for AI analysis? **Decision: Only aggregated durations and domain names by default. Full page titles opt-in. Never send URLs with query parameters.**

4. **Category taxonomy**: What initial categories? **Decision: Start with ~15 categories (productivity, communication, entertainment, social, reference, development, design, writing, finance, shopping, news, health, education, utilities, uncategorized). Allow user override.**

5. **Extension installation UX**: How to handle the gap between "app installed" and "extension installed"? **Decision: App provides immediate value with native heuristics. Extension prompt is shown in-context when browser usage is detected. Confidence badges indicate data quality.**

6. **Retention default**: 90 days? 1 year? Forever? **Decision: 90 days default, configurable up to "forever". Daily summaries are retained longer than raw events.**
