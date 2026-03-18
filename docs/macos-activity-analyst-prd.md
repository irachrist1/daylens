# PRD: macOS Activity Analyst

## Document Metadata

- Product: macOS Activity Analyst
- Status: Draft
- Owner: Christian Tonny
- Platform: macOS first
- Companion surfaces: Chromium extension, Safari web extension, future Firefox support
- Primary audience: individual knowledge workers, creators, builders, and students who want high-quality personal activity insight

## 1. Problem

People who want to understand how they spend time on their laptop have to choose between products that are:

- useful but expensive
- technically capable but visually weak
- good at passive tracking but poor at insight
- decent at browser tracking in one ecosystem but weak across multiple browsers
- analytics-heavy but not meaningfully helpful

Today’s products often tell users that they spent X hours browsing or working without giving them a trustworthy, human, learnable explanation of what actually happened.

The problem is not just time capture.
The problem is turning messy laptop behavior into useful, beautiful, trustworthy personal intelligence.

## 2. Why Now

- AI can now summarize, categorize, and answer questions over usage history much more effectively than traditional reporting systems.
- macOS users increasingly work across many apps and browsers, making simplistic single-surface tracking inadequate.
- Existing products leave room for a premium personal product that is more beautiful, more local-first, and more insight-oriented.
- The best implementation opportunity is on macOS first, where native UI quality and system integration matter heavily.

## 3. Product Vision

Build a premium macOS app that understands where a user spends time across apps, browsers, and websites, then turns that into a calm, beautiful, trustworthy daily intelligence layer.

The product should answer:

- Where did my time go today?
- Which apps actually consumed my attention?
- Which websites kept me engaged?
- Was my day focused or fragmented?
- What patterns are repeating across weeks?
- How much time did I spend on YouTube today?

The experience should feel less like a surveillance dashboard and more like a thoughtful personal analyst.

## 4. Product Principles

- Local-first capture
- Trust through clear rules
- Narrative before noisy charts
- Native macOS quality
- Privacy as a product feature
- AI that explains, not just labels
- Low background overhead
- Beautiful enough to use every day

## 5. Competitive Landscape

### Rize

What it does well:

- strong passive tracking
- website and app categorization
- AI-assisted time-entry suggestions
- mature reporting and review workflows
- automatic background usage collection

Observed weaknesses:

- expensive for personal use
- heavily tilted toward billing / client / project workflows
- summaries are not ambitious enough as a personal intelligence layer
- still creates review overhead

Key source notes:

- official positioning: automatic time tracking across apps, websites, tasks, and calls
- AI auto-categorization happens after roughly 2 minutes of use
- pricing currently starts around $9.99/month billed annually

### StayFree

What it does well:

- website usage history
- app and site blocking
- strong extension-centric friction control
- multi-device positioning
- scheduled focus mode, limits, and feed-level intervention

Observed weaknesses:

- more about blocking/self-control than deep personal intelligence
- web-first emphasis rather than elegant macOS-native behavior
- analytics tend to be utilitarian rather than premium
- weaker as a passive "what actually happened on my laptop?" memory layer

### TimeTrack

What it does well:

- time logging
- project/task structures
- invoicing, attendance, reporting, and workflow controls
- operational visibility for business and project work

Observed weaknesses:

- generally oriented toward work management, timesheets, or team/business workflows
- not clearly optimized for a personal, delightful, cross-browser insight product
- often reads as operational software more than a premium personal companion
- too much manual project and timer overhead for passive personal analytics

### Typeless

Important clarification:

- current official Typeless material describes an AI dictation / voice-input product, not a direct Rize-style laptop activity tracker

Why it is still useful as a reference:

- polished permission onboarding
- strong privacy messaging
- system-level UX quality
- cross-app behavior design

## 6. Product Opportunity

The strongest opportunity is to combine:

- Rize-level passive capture
- better browser coverage
- a much better personal dashboard
- privacy-forward architecture
- a true AI analyst and chat surface

This product should explicitly avoid drifting into agency billing software unless that becomes a later expansion.

## 7. Target Users

### Primary user

An individual macOS user who:

- works across many apps
- uses multiple browsers
- wants clear daily insight
- values beautiful software
- wants trustworthy AI summaries and Q&A

### Secondary users

- students
- creators
- founders
- engineers
- researchers
- productivity-focused professionals

## 8. Jobs To Be Done

- Help me understand where my time went today without making me manually track it.
- Show me which apps and websites actually consumed my attention.
- Help me understand whether I was focused or fragmented.
- Let me ask questions about my usage history in plain language.
- Give me a dashboard I actually want to open every day.

## 9. Goals

- Deliver reliable passive tracking for apps, browsers, and websites on macOS.
- Make the dashboard beautiful, readable, and useful enough to become a daily habit.
- Generate AI summaries that are grounded in real captured behavior and improve over time.
- Support conversational questions over tracked history.
- Keep background overhead low enough that users do not feel punished for installing the app.

## 10. Non-Goals

- team billing
- invoicing
- agency project management
- employee surveillance
- keystroke logging
- full content recording of pages or apps
- mobile apps in v1
- cross-device sync in v1 unless it is essential to the core experience
- direct copying of Arc, OpenAI, Anthropic, or Apple proprietary assets

## 11. Functional Requirements

### 11.1 App Tracking

Track:

- app launch
- app terminate
- frontmost app changes
- active usage duration
- session boundaries

The product must distinguish between:

- app installed/running
- app opened/launched
- app actively used

Dashboard time should be based primarily on active usage, not mere process existence.

### 11.2 Browser Tracking

Track:

- browser app usage time
- active browser identity
- active tab or page when technically available
- per-domain time
- meaningful page titles where privacy settings allow it

Support:

- Chromium-family browsers
- Safari
- later Firefox expansion

### 11.3 Website Tracking

Track:

- visited domain
- visited page title or URL slug when available
- duration on active site
- confidence level of attribution

The system must support:

- page-level capture with extension assistance
- degraded fallback when only browser/window heuristics are available

### 11.4 Session Normalization

The system must normalize messy real-world behavior.

Rules to implement:

- app usage counts only when the app is truly frontmost and not idle
- site usage counts only when the browser is frontmost and the tab is active
- visits shorter than a minimum threshold should be stored but hidden by default in top-level analytics
- rapid switches should be debounced and mergeable
- repeated bursts of the same app/site within a short interval may be merged into one logical session

### 11.5 Idle Detection

The system must stop counting active work when the user is idle.

It should:

- detect keyboard/mouse inactivity
- apply a grace window
- avoid inflating usage with passive foreground windows

### 11.6 Private Browsing Behavior

The app must clearly define private browsing behavior.

Recommended default:

- do not store detailed page-level data from private/incognito sessions
- optionally track only coarse browser usage time
- make this behavior explicit in settings

### 11.7 Dashboard

The dashboard must include:

- Today overview
- time spent by category
- top apps
- top browsers
- top websites/domains
- timeline of the day
- focus vs distraction view
- switching and fragmentation indicators
- AI summary card
- trend snapshots across recent days

### 11.8 AI Analyst

The AI layer must:

- summarize the day
- identify patterns over time
- answer natural-language questions
- cite underlying evidence from tracked events
- avoid unsupported claims

Examples:

- How much time did I spend on YouTube today?
- What was my most fragmented hour?
- Which browser did I use the most this week?
- Which sites correlate with long distraction chains?

## 12. UX Expectations

### Emotional bar

- calm
- premium
- confident
- trustworthy

### Visual bar

- native macOS feel
- restrained color system
- no cheap purple-blue gradients
- elegant typography
- clean information hierarchy
- neutral-first palette with one restrained accent color
- native materials used sparingly and mostly for chrome, not for dense data views

### Layout bar

- sidebar navigation inspired by the best parts of Arc
- spacious but not sparse
- narrative first, charts second
- timeline and list views should feel central
- recommended default shell is a three-column layout:
  - left sidebar for Today, Apps, Web, Browsers, Insights, History, Settings
  - central feed/timeline
  - right inspector for drill-downs, filters, and AI summaries

### Interaction bar

- keyboard shortcuts
- subtle motion
- excellent resizing behavior
- dark mode
- accessibility support
- command bar / quick launcher for fast lookup and natural-language pivots

### AI bar

- grounded in user data
- explanatory
- no generic productivity clichés

## 13. Design Direction

The app should be inspired by:

- Apple macOS HIG for native interaction patterns
- Arc for hierarchy, focus, and window/sidebar polish
- OpenAI for calm, legible utility
- Anthropic for restraint and confidence

Specific direction:

- build it as a native-feeling macOS productivity tool, not a web dashboard in a Mac window
- use San Francisco and SF Symbols for product chrome
- reserve app icons and favicons for content rows, lists, and inspectors
- favor horizontal ranked bars, a stacked daily timeline, and a density strip over noisy dashboard chart soup
- keep motion short and purposeful, guided by native spatial logic

The app should not look like:

- a crypto dashboard
- a template SaaS admin panel
- a gamified habit app

Use original icons and original visual assets.
Take structural inspiration, not brand duplication.

## 14. Recommended Technical Direction

### Recommended app stack

Default recommendation:

- Swift for the macOS app
- SwiftUI for the primary interface
- AppKit interop where SwiftUI is insufficient
- local SQLite-backed store

Why:

- best chance of truly premium macOS-native UI
- strongest system integration
- best path for low-overhead background behavior
- best fit for permissions, menu bar behavior, and system conventions

### Recommended collectors

- NSWorkspace notifications for app lifecycle and frontmost app changes
- Accessibility APIs for richer active-app/window context where permitted
- idle detection via appropriate native input/idle mechanisms
- browser companion extensions for high-confidence tab/domain data

### Browser architecture

- one Chromium-compatible extension for Chrome, Arc, Comet, and similar browsers
- Safari web extension for Safari
- future Firefox WebExtension later

### Backend / AI direction

Keep backend stack flexible, but require:

- secure ingestion
- efficient aggregation
- retrieval over historical activity
- strong prompt grounding
- support for daily summaries and conversational Q&A

Rationale:

- SwiftUI plus targeted AppKit is the strongest fit for a premium macOS-first experience
- Electron or a web shell may move faster initially but is much more likely to miss the delight, power-efficiency, and platform-integration bar this product needs

## 15. Data Model

Minimum entities:

- User
- Device
- Browser
- App
- Website / Domain
- ActivityEvent
- Session
- DailySummary
- Insight
- AIConversation

Key metadata:

- timestamps
- source
- confidence
- duration
- privacy mode
- category
- evidence references

## 16. Tracking Rules

Recommended defaults for v1:

- app "used" if frontmost for >= 5 seconds
- app session merges across interruptions shorter than 8 seconds if resumed quickly
- website "visited" if active tab in frontmost browser for >= 5 seconds
- sub-5-second events are stored but excluded from top-level dashboard summaries by default
- cumulative micro-visits can roll up to domain-level insight if they exceed meaningful total time
- idle time stops session accrual after a short grace period

These thresholds should be configurable later, but not over-customized in the first release.

## 17. Privacy And Security Requirements

- local-first capture
- explicit permission onboarding
- clear explanation of each permission
- no keystroke logging
- no hidden full-screen recording
- minimal collection principle
- secure local storage
- secure transport for backend data
- clear retention settings
- delete/export support
- redaction-aware AI pipeline

## 18. Performance Requirements

- very low idle CPU use
- battery-friendly background behavior
- event-driven capture where possible
- avoid expensive polling loops
- dashboard should feel fast even with long usage history
- AI analysis should not block the UI

## 19. Success Metrics

- daily active usage of the dashboard
- reliable capture coverage across apps and supported browsers
- user trust in reported time breakdowns
- AI answer correctness for common daily questions
- low complaint rate around battery and performance

## 20. Milestones

### M0: Research And Architecture

- final PRD
- architecture memo
- permissions strategy
- data model
- design system direction

### M1: Core Capture

- app usage capture
- browser usage capture
- idle handling
- session normalization

### M2: Website Intelligence

- browser extension integration
- domain/page attribution
- confidence model
- fallback heuristics

### M3: Dashboard

- Today page
- timeline
- apps / browsers / websites views
- beautiful visual system

### M4: AI Analyst

- daily summary
- trend insights
- conversational queries
- evidence-backed answers

### M5: Hardening

- privacy polish
- export/delete
- performance tuning
- onboarding polish
- release readiness

## 21. Acceptance Criteria

Examples:

- Given a user switches rapidly between two apps five times within one minute, the system merges bursts into stable logical sessions without overcounting background time.
- Given a user spends 12 minutes on YouTube in the frontmost browser, the Today dashboard shows YouTube as a top site with correct duration.
- Given the user is idle past the configured grace threshold, active usage time stops increasing.
- Given the user asks "How much time did I spend on YouTube today?", the AI answer returns the correct duration and cites the relevant tracked evidence.
- Given a user runs the app for a full workday, background resource usage remains low enough to feel invisible.

## 22. Risks

- multi-browser website attribution is technically uneven
- permissions may create onboarding friction
- privacy expectations are high because behavioral data is sensitive
- overly aggressive session rules can damage trust
- AI summaries can feel generic or hallucinated if not tightly grounded
- native notifications or extension behaviors can vary across browsers

## 23. Open Questions

- What exact minimum duration should count as a meaningful website visit in v1?
- Should private browsing track only coarse browser time or nothing at all by default?
- How much raw page detail should be allowed to leave the device?
- Should the first release include email digests, or should all insight stay inside the app?
- What should the initial category taxonomy be?

## 24. Source Notes

- Apple: Designing for macOS — https://developer.apple.com/design/human-interface-guidelines/designing-for-macos
- Apple: Safari web extensions — https://developer.apple.com/documentation/safariservices/safari-web-extensions
- Chrome tabs API — https://developer.chrome.com/docs/extensions/reference/api/tabs
- MDN tabs.query — https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/query
- OpenAI desktop design cues:
  - https://openai.com/chatgpt/desktop/
  - https://openai.com/index/introducing-the-codex-app/
- OpenAI app/system integration cue:
  - https://help.openai.com/en/articles/10119604
- Anthropic desktop install surface:
  - https://support.anthropic.com/en/articles/10065433-installing-claude-desktop
- Rize:
  - https://rize.io/
  - https://rize.io/pricing
  - https://rize.io/changelog/full-ai-powered-auto-categorization
  - https://rize.io/changelog/ai-powered-tagging-for-clients-projects-and-tasks
  - https://rize.io/changelog/new-feature-time-entry-suggestion-quick-actions-improvements
  - https://rize.io/changelog/new-dashboard-layout
- StayFree:
  - https://chromewebstore.google.com/detail/stayfree-website-blocker/elfaihghhjjoknimpccccmkioofjjfkf
- TimeTrack references:
  - https://timetrack.tech/
  - https://www.timetrackapp.com/en/time-tracking-app/
  - https://dylangeorge.miami/timetrack/index.html
- Typeless:
  - https://www.typeless.com/
  - https://www.typeless.com/help/faqs
  - https://www.typeless.com/pricing
