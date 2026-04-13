# DAYLENS REDESIGN MASTER SPEC

**Version:** 1.0 — April 2026  
**Status:** Handoff-ready. Written for implementation agents and designers working in the `daylens-windows` Electron codebase.

---

## 1. Executive Summary

**What Daylens is:**  
Daylens is a local-first productivity intelligence layer for knowledge workers. It passively tracks active windows and browser history, groups raw activity into meaningful work blocks, and applies AI to narrate what the user was actually doing — not just which apps were open.

**What the current product is doing wrong:**  
The current app collects sophisticated data — coherent work block segmentation, website visits, key pages, focus session labeling — and then surfaces almost none of it. The UI defaults to generic dashboard metrics: a focus score gauge, a time distribution bar broken out by app category, a flat list of raw app sessions. The headline insight on a given day is a phrase like "Slow start. 19m tracked with light focus." The Today view tells users almost nothing they couldn't infer themselves. The Apps view is a leaderboard. The AI workspace is gated behind a CLI tool installation prompt and starts empty. The Focus view is a Pomodoro timer.

**What the product should become:**  
Daylens should be a personal intelligence record — the trusted answer to "what did I actually do today?" It should reconstruct work, not report app totals. The Timeline should be the center of gravity: a readable, scannable account of the day broken into meaningful work blocks, each with context about what was happening inside it. The Apps view should reveal behavior, not rank apps by time. The AI layer should feel like a knowledgeable assistant who has read the whole day and can synthesize it, not an empty chat box. Settings and Focus remain secondary but should be clean and purposeful.

---

## 2. Cleaned Product Notes

These are reconstructed from the product transcript, cleaned for clarity and precision.

### Core product belief
Daylens is not a time tracker. It tracks activity, but its job is to reconstruct what the user was actually doing. That means working across apps, sites, windows, and inferred sessions to answer the question: "What was happening during this period?"

### The gap between raw data and meaning
Raw activity — 6 hours in Chrome, 2 hours in Cursor — is not useful. What is useful is: "You spent 3 hours this morning working on the API refactor across Cursor, terminal, and Chrome with documentation tabs. You then had a fragmented afternoon across Notion, Slack, and email before returning to focused coding at 4pm."

### App intelligence must go deeper
Looking at an app like Ghostty or Cursor and saying "Development: 2m" is wrong. These apps represent significant work modes. The product should know that Ghostty is a terminal, Cursor is a code editor, Dia is an AI assistant, Journal is a writing/reflection tool. It should understand the character of time spent in each app, not just the total duration.

### AI tools deserve first-class treatment
The AI assistant category (ChatGPT, Claude, Codex, Dia, Cursor with AI, etc.) should be recognized as a work mode of its own — not lumped into "uncategorized" or "browsing." Time spent with AI tools is productive time, usually tightly coupled to adjacent coding or writing work. It should be surfaced as part of a work block context, not as isolated app usage.

### The timeline is the product
The timeline is not a "History" page you visit occasionally. It is the primary truth record of what happened. Today view should essentially be a live, partial timeline. The day view in History should be the complete version. They should feel continuous.

### Focus sessions as overlay, not core
Focus sessions (Pomodoro-style timers) are a secondary feature, not the primary product. They should exist but should not dominate the sidebar or claim a top-level nav slot over more useful views. Focus mode is most useful as an overlay on the timeline, showing where intentional work happened versus passive drift.

### AI as active analyst, not passive chatbot
The AI layer should not be an empty chat panel waiting for user prompts. It should proactively offer context, summaries, and observations based on what it sees in the tracked data. The user's first interaction with the AI workspace should show them something meaningful about their day — not ask them to type a question.

### Browser history matters enormously
The websites visited reveal the actual context of work. A developer browsing Stack Overflow, MDN, and a GitHub issue is clearly debugging something. A user reading Notion docs and then switching to Linear is likely project planning. The product should use browser history to upgrade block labels and detail panels, not just show domain totals.

### The ideal product truth model
At its best, Daylens should be able to say:
- "Monday morning: you spent 2.5 hours on the billing system refactor, using Cursor, terminal, and Chrome (Stripe docs, GitHub). You hit a wall around 10:30 and browsed Reddit for 20 minutes, then returned to the task."
- "Tuesday afternoon: 4 back-to-back meetings in Zoom. No deep work."
- "Wednesday: your most focused day this week. 5 hours of development, 78% of time in focused apps, minimal context switching."

---

## 3. Current-State Audit

### Navigation structure
**Sidebar:** Daylens (wordmark) → Today, History, Focus, Apps, Insights → Settings (bottom) + Focus timer quick-action widget.

**Routes (from `App.tsx`):**  
`/today`, `/history`, `/focus`, `/apps`, `/insights`, `/settings`

The nav has six items. Focus is positioned as a peer of Today and History, which overstates its importance. Insights is a peer of Apps, which understates its importance.

### Screen inventory (from screenshots + code)

| Screen | Route | Current State |
|---|---|---|
| Today | `/today` | Greeting + hero statement + focus score gauge + time distribution bar + recent sessions feed |
| History (Timeline) | `/history` | Date nav + Timeline/Week toggle + filter pills + block list + block detail panel |
| History (Week) | `/history` (week mode) | Bar chart by day + Most Active/Best Focus/Quietest cards |
| Focus | `/focus` | Focus timer setup + stats panel (focused today, focus %, apps tracked, streak) + planned apps + recent sessions |
| Apps | `/apps` | Category filter pills + date range toggle (1/7/30d) + ranked app list |
| App Detail | `/apps` (inline expand) | Usage Profile (avg session, lowest, sessions count) + primary mode breakdown + session timeline |
| Insights (Overview) | `/insights` | Week in Review summary card + algorithmic insight cards (peak hours, streak, allocation) + actionable rules |
| Insights (AI Workspace) | `/insights` (tab) | Empty chat panel — gated behind Codex CLI installation |
| Settings | `/settings` | Time acquisition, App taxonomy overrides, Distraction alerts, Notifications, Dark Mode, AI Provider, CLI keys, Focus goal |
| Onboarding | (pre-route) | Exists as `Onboarding.tsx`, not visible post-setup |

### Current metrics and cards

**Today view:**
- Hero statement (derived in `heroStatement()`: e.g. "Slow start. 19m tracked with light focus.")
- Daily Focus Score gauge (0–100, with qualitative label: "Building", "Strong", etc.)
- Focus Trend bar chart (last 7 days)
- Time Distribution horizontal bar (category breakdown)
- Recent Sessions feed (grouped app sessions, reverse chronological)
- Sidebar: "Your Peak Focus window is your competitive edge." notification card

**History block detail panel (`TimelineDayView.tsx`):**
- Time range
- Category tag + confidence tag
- Block narrative (rule-based or AI-generated)
- Websites list with time
- Apps list with time
- Key pages and windows list
- Re-analyze button

**Insights cards (from `Insights.tsx` — `AlgorithmicInsight` interface):**
- Peak hours
- Streak
- Allocation (top category percentage)
- Context switching
- Website distraction detection
- Focus goal progress

### Current architecture (from codebase)

**Main process** (Electron main):
- `tracking.ts` — polls active window every 5s
- `workBlocks.ts` — groups raw sessions into `WorkContextBlock[]` using heuristic segmentation (coherence scoring, meeting detection, long-app streak detection, developer testing flow, gap-based splitting)
- `ai.ts` — orchestrates AI providers, block insight generation, conversation
- `browser.ts` — ingests local browser history files
- `focusScore.ts` — computes composite focus score from ratio, consistency, flow state, peak bonus
- `database.ts` + `schema.ts` + `queries.ts` — SQLite via better-sqlite3
- `insightsQueryRouter.ts` — routes AI queries to appropriate DB queries for context

**Renderer** (React + Vite + Tailwind):
- Single-page with sidebar + main content area
- All data access via `ipc.ts` (thin wrapper over `window.daylens.*`)
- No global state manager — each view fetches its own data with local `useState`/`useEffect`
- Polling patterns: Today polls every ~3s for live session updates, sidebar polls every 10s

**Database tables:**
- `app_sessions` — raw window activity
- `focus_sessions` — intentional focus blocks with label, target, planned apps
- `website_visits` — browser history (domain, title, URL, visit time, duration)
- `ai_conversations` + `ai_messages` — chat history
- `work_context_observations` — stored AI insights for blocks (avoids redundant AI calls)
- `category_overrides` — user-defined app category corrections
- `distraction_events` — distraction alerts triggered during focus sessions

**IPC surface (`shared/types.ts` — `IPC` constant):**
- `DB.*` — session queries, history, app summaries, peak hours, weekly summary, app character
- `FOCUS.*` — session lifecycle, recent sessions, break recommendations
- `AI.*` — message sending, block insight generation, category suggestions, CLI detection
- `SETTINGS.*` — get/set, API key management
- `TRACKING.*` — live session, process metrics
- `SYNC.*` — web companion linking

### Mismatches between vision and implementation

| Vision | Current Implementation |
|---|---|
| Reconstruct what user was doing | Today view shows raw app session feed, not work blocks |
| Timeline as primary truth record | Today view and History are separate — no continuity |
| Browser context enriches blocks | Block detail shows websites, but Today feed doesn't |
| AI feels like an active analyst | AI workspace is empty until user types |
| App intelligence beyond time totals | App detail shows avg session time and primary mode only |
| Focus as overlay, not core feature | Focus has its own top-level nav slot + sidebar widget |
| Rich block context | Block segmentation logic is sophisticated, but the UI barely exposes it |

---

## 4. What Is Wrong Right Now

### Wrong metrics

**Focus Score gauge (23 / "Building"):** A composite score displayed as a circular gauge with a qualitative label is not informative. The user sees "23" and does not know what it means relative to a good day, what drove it, or what to do about it. The formula (`focusedSeconds/total * 100 + consistency bonus + flow bonus + peak bonus`) is reasonable but the output is uninterpretable in isolation.

**Daily Focus Percentage:** "24% Light Focus" on the History header is a shallow signal. What matters is not the percentage but *when* and *doing what.* A day with 24% focus during a 3-hour deep work block in the morning is very different from scattered 24% focus across the whole day.

**Streak counter:** "No streak yet today" / "0d streak" are demoralizing non-insights. Streak mechanics belong in a gamified fitness app, not a professional productivity tool.

**Uncategorized leading at 50%:** This is a data quality problem masquerading as an insight. If half the activity is uncategorized, the product should fix its categorization, not surface the failure as a metric.

**Time distribution by category:** Showing horizontal bar segments for "Uncategorized: 9m, Browsing: 4m, Development: 3m" is information that answers no meaningful question. What was I doing in those 3 minutes of "development"? What was I browsing?

### Generic dashboard behavior

The Today view is a dashboard. It has a greeting, a big number (Focus Score), a bar chart, a horizontal distribution bar, and a list. These are generic dashboard tropes. Nothing about the screen answers "what did I actually do today?"

The Insights view compounds this: it shows cards for "Peak Hours," "No streak yet today," and "Uncategorized is leading at 50%." These read like placeholder content.

### Shallow focus/streak framing

The Focus view presents itself as the product's center of gravity. It has a prominent timer, stat cards showing "APPS TRACKED: 0 / STREAK: 0d / FOCUSED TODAY: 0m." This is gym-app framing applied to knowledge work. Knowledge work does not follow clean streak patterns. The "STREAK: 0d" display is actively harmful — it suggests the user failed rather than that they were doing non-streak-countable work.

### Weak information hierarchy

The most valuable thing in the current product — the block detail panel in the History timeline — is buried in a secondary view behind a nav click and then a block click. The panel reveals apps, sites, key pages, a narrative summary, and a re-analyze button. That is excellent information. It should be primary, not tertiary.

The sidebar focus widget occupies roughly 40% of the sidebar height and is visible on every screen, including unrelated ones like Apps and Settings. It is persistent noise.

### Where UI is clean but not useful

- The week view bar chart is visually clean but extremely sparse. One tall bar for Monday with "Most Active: Mon · 11m" is not actionable.
- The App detail for Safari showing "Regular usage across 2 sessions today" and "100% Browsing" is meaningless. The product knows which URLs were visited; none of that appears.
- The block detail panel's "UNCATEGORIZED/AMBIGUOUS" confidence tag is a good piece of information, but it is styled identically to meaningful tags, so it reads as noise.

### What should be removed, merged, or reframed

**Remove:**
- Focus Score gauge. Replace with focus *character* description per day.
- Streak counter from primary surfaces.
- "UNCATEGORIZED is leading at 50%" as a top-level insight.
- "Daily Focus Score" as a branded metric concept.

**Merge:**
- Today and History should feel like one view, not two separate screens. Today is just History with the date locked to today and a live update cadence.

**Reframe:**
- Focus from a Pomodoro app into an intent declaration layer that annotates the timeline.
- Insights from a weekly stats screen into an AI analysis surface that starts populated with observations.
- Apps from a time leaderboard into a behavior explorer.

---

## 5. Target Product Architecture

Daylens should be organized around four primary views: **Timeline**, **Apps**, **AI**, and **Settings**. Focus becomes a secondary control, not a top-level view. Today becomes the default state of Timeline.

### Timeline (primary)

**Role:** The definitive record of what happened — today, yesterday, or any past day. This is the product's center of gravity.

**User questions it answers:**
- What did I actually do today?
- When was I focused vs. drifting?
- What was I working on during that 2-hour block this morning?
- Which sites/tools did I actually use in each work session?

**Data it should surface:**
- Work blocks with labels (AI-generated or rule-based), duration, dominant category
- Inside each block: top apps, visited sites, key page titles, focus quality signal
- Context switching indicators between blocks
- Focus session overlays (when a Pomodoro session was active)
- Browser context integrated at the block level
- A live "now" indicator on today

**What to remove:** Day-level aggregate metrics from the top of the view. Move them to a compact status strip.

**What replaces it:** A scannable, time-anchored block list where each block tells a story in 1–2 lines.

---

### Apps (secondary)

**Role:** Understand how specific apps are being used — their character, patterns, and contribution to larger work blocks.

**User questions it answers:**
- How am I actually using Ghostty / Cursor / Safari?
- When I'm in Safari, what am I doing?
- Which apps show focused use vs. distracted drift?
- How has my usage of this app changed over time?

**Data it should surface:**
- Per-app: usage character (deep focus, context switching, distraction, etc.)
- Per-app: top websites if browser, top sessions, time-of-day patterns
- Per-app: which work blocks this app appeared in
- Per-app: session length distribution
- What is missing: no more "rank by total time" leaderboard as the primary view

**What to remove:** Simple ranked list with total time as the only signal.

**What replaces it:** A behavior-oriented app browser where each app entry shows its character, not just its time.

---

### AI (tertiary but high-value)

**Role:** Active analysis surface. Not a chatbot waiting for a prompt. The AI reads the tracked data and surfaces observations, summaries, and answers to questions.

**User questions it answers:**
- Give me a summary of my week.
- Why was Wednesday my worst focus day?
- What was I working on Monday morning?
- Reconstruct my work on the billing project over the last 3 days.
- Am I spending too much time in communication tools?

**Data it should surface:**
- Pre-populated daily/weekly narrative summary (generated or cached from `work_context_observations`)
- Proactive insight cards generated from tracked data
- Open-ended question answering grounded in `insightsQueryRouter`

**What to remove:** The empty "Ask about your day / Codex CLI needs to be installed" empty state as the *default* state.

**What replaces it:** A pre-populated summary view that loads analysis from the day's data, with a chat input for follow-up questions.

---

### Settings

**Role:** Configuration only. AI provider, tracking toggles, app taxonomy overrides, notifications. No insights or stats live here.

**Current state:** Already reasonable. Needs minor cleanup around the "Elite Member" membership badge (confusing for a local app) and the layout of the two-panel view.

---

## 6. Screen-by-Screen Redesign Spec

### Sidebar / Navigation

**Remove:**
- Focus from the main nav (demote to an action, not a destination)
- The large Focus timer widget at the bottom of the sidebar
- "Insights" label — rename to "AI"

**Revised nav items:**
1. Timeline (was: Today + History — merge them)
2. Apps
3. AI (was: Insights)
4. Settings (remains at bottom)

**Sidebar bottom area:**
Replace the Focus timer widget with a slim status strip that shows:
- Current tracking status (active app name + category dot)
- Quick "Start Focus" pill (opens a lightweight focus intent overlay, does not navigate away)
- If a focus session is active: session label + elapsed time + stop button

The sidebar should be 220px wide (down from 256px), compact, and unobtrusive.

**Typography:** Keep the "Daylens" wordmark at the top. Keep Inter Variable. Reduce the nav item padding slightly for a denser feel.

---

### Timeline View (was: Today + History combined)

**Default state:** Opens to today. Shows a live partial timeline that updates as activity happens.

**Header:**
- Left: `← Monday, April 13 →` date navigation (today disables forward arrow)
- Right: `Today` button (when not on today) + `Day / Week` toggle

**Day mode layout:**

```
[Status strip]
14% focus · 7 apps · 3 sites · 2h 14m tracked

[Work blocks — vertical timeline]

11:52 AM ────────────────────── 12:15 PM  [23m]
ChatGPT + Claude Code
AI-assisted work · Development + AI Tools
Sites: claude.ai, chatgpt.com   Apps: Ghostty, Journal

2:00 PM ─────────────────────── 3:30 PM  [1h 30m]
Billing Refactor
Deep coding session · Development
Sites: stripe.com/docs, github.com   Apps: Cursor, terminal

[Selected block expands inline — see Block Detail Panel]
```

**Block row design:**
- Left: time range (e.g., "11:52 AM – 12:15 PM")
- Center: block label (bold), work mode tag (subtle pill), supporting context line (top apps + sites in one line)
- Right: duration + category color stripe
- On hover: subtle highlight
- On click: expand the block inline (not a separate panel) with full detail

**Status strip (compact, always visible at top):**
- Total tracked time for the day
- Focus percentage
- App count
- If today: "Tracking now" + current app name

**No focus score gauge. No streak counter. No pie charts.**

---

### Week View

**Header:** Same date nav but shows "This Week" label.

**Layout:**
- 7-column mini grid (Mon–Sun), each column shows:
  - Date label
  - A vertical bar representing total tracked time (proportional height)
  - A colored indicator for the dominant category
  - Focus percentage as a subtle annotation
- Clicking a day column navigates to that day's timeline

**Below the grid:**
- 3 contextual facts (not gamified cards):
  - Best focus window across the week
  - Most active day (hours + dominant work type)
  - Pattern observation (e.g., "Your mornings are consistently more focused than afternoons")

**Remove:** "Most Active / Best Focus / Quietest" cards with the current generic styling.

---

### Apps List

**Header:** "Apps" + time range selector (`Today / 7d / 30d`) + category filter pills

**App row design (replace current leaderboard):**
Each app row shows:
- App icon + name
- Character label (e.g., "Deep focus", "Short sessions", "Context switching")
- Usage bar (time) + session count
- Category dot

Character labels come from the existing `AppCharacter` type in `shared/types.ts` (already computed via `db:get-app-character`).

**Clicking an app row** navigates to the App Detail page.

**Group header** (optional toggle): Group by category — Development, AI Tools, Browsing, Communication, etc.

---

### App Detail Page

**Header:**
- Back to Apps link
- App icon, name, category pill
- Time range selector (Today / 7d / 30d)

**Section 1 — Character summary (top):**
One or two lines that describe how the user actually uses this app:
- "You use Ghostty in long sustained blocks averaging 35 minutes. It appears most during development work sessions."
- "Safari sessions are short (avg 3m) and spread across 8+ daily visits. Primarily used for research and browsing during dev blocks."

This is generated from session data — avg duration, session count, time of day distribution, which work blocks it co-appears in.

**Section 2 — If browser app: Top sites**
For Safari, Chrome, Arc, etc.:
- List of top domains visited in the selected period
- Domain + visit count + total time
- Click domain to see page titles (from `website_visits`)
- This replaces the current "100% Browsing / Primary Mode" display which is vacuous for browser apps

**Section 3 — Session history**
Scrollable list of individual sessions, grouped by day:
- Start time, duration, context label (which work block it belonged to if known)
- Click to jump to that block in the Timeline

**Section 4 — Focus quality pattern**
For focused-category apps (development, writing, AI tools, etc.):
- Distribution of session lengths (short/medium/long)
- Time-of-day heatmap (simple: morning/midday/afternoon/evening buckets)
- Average context switch rate during sessions involving this app

**Remove:**
- "Usage Profile: AVG SESSION 2m / LOWEST 2m / SESSIONS 2" displayed as three isolated stat boxes — these are not insights, they're raw numbers

---

### AI Workspace

**Default state (NOT empty):**
When the user opens the AI view, they should immediately see a pre-generated summary of their recent activity. Do not gate this behind a question.

Layout:
```
[Today / This week toggle]

[Generated summary block — auto-populated]
"Today (so far): You've had two meaningful work blocks — an hour of AI-assisted development work this morning, and a 20-minute research block this afternoon. Most of your time is unaccounted for: 38 minutes of uncategorized activity may represent work that wasn't captured. Your focus windows align with yesterday's pattern."

[Insight cards — algorithmically derived]
• Peak window: 11am–1pm was your strongest block today
• Context: ChatGPT appears in 2 of your 3 blocks — it's closely coupled to your dev work

[Ask a follow-up]
[text input] What was I working on this morning? →
```

**Conversation behavior:**
- Context is automatically injected from today's blocks when the user sends a message
- Previous messages persist in `ai_conversations`
- "New Chat" button clears context
- Responses cite specific block data (time, apps, sites) where relevant

**When AI is not configured:**
Show the summary as a rule-based text summary (using `fallbackNarrativeForBlock` already in `workBlocks.ts`) rather than an empty state. The AI-enhanced version becomes available once a provider is set up in Settings.

---

### Settings

**No major structural changes needed.** Minor refinements:

- Remove the "ELITE MEMBER" badge (or relabel as "Local Build" / "Active" in a subtle way)
- Rename "Cognitive Augmentation" to "AI Provider" (clearer)
- Move "Web Companion" link section to the bottom of the right column (less prominent)
- Add a "Data" section: total sessions tracked, database size, export option

---

### Onboarding

**Current state:** Exists as `Onboarding.tsx`, not audited in screenshots.

**Principles for redesign:**
- Start tracking immediately; do not require AI setup to get value
- Show a "live preview" of the first tracked session as soon as the user clicks through
- AI provider setup is optional and clearly framed as "enhances AI summaries"
- Do not ask about goals or preferences upfront — infer them from behavior

---

### Empty States / No-Data States

Each view needs a purposeful empty state:

**Timeline (no data for date):**
> "Nothing tracked yet for this day. Daylens will record your activity as you work."
> If today: show "Tracking started [time]" with a live indicator.

**Apps (no sessions):**
> "No app activity yet. Open some apps and come back."

**AI workspace (AI not configured):**
> Show rule-based summary block first. Below it: "Add an AI provider in Settings to get richer analysis and conversation." — a subtle, non-blocking prompt.

**App Detail (not enough data):**
> "Only a few sessions recorded for [App Name]. Check back after a few more sessions for a complete picture."

---

## 7. Timeline Redesign Spec

### Time block structure

Each `WorkContextBlock` in the timeline should render as a row with:

**Collapsed state (default):**
```
[time] ──────────────────── [time]  [duration]
[Label]
[work mode pill] [category dot]   [app icons ×3] [+N more]
```

- `[time]` — start time formatted as HH:MM AM/PM
- `[Label]` — from `userVisibleLabelForBlock()` in `workBlocks.ts` (already correct)
- `[work mode pill]` — derived from `dominantCategory` + `confidence`: e.g., "Deep Focus · High" or "Mixed · Exploratory"
- `[app icons]` — top 3 non-browser apps from `block.topApps`, using existing `AppIcon` component
- Duration right-aligned

**Expanded state (on click, inline):**
```
[Collapsed row — highlighted]

  TIMELINE DETAILS
  ┌──────────────────────────────────────────────┐
  │ [Block narrative — AI or fallback]           │
  │                                              │
  │ APPS                         SITES           │
  │ Ghostty    Development  30s  chatgpt.com 9s  │
  │ Journal    Writing      30s  claude.ai   5s  │
  │                                              │
  │ KEY PAGES                                    │
  │ • ACAL — Start Page                         │
  │ • Claude Code session                        │
  │ • ChatGPT — Prompt Improvement               │
  │                                              │
  │ [Re-analyze]  [Mark as Focus]  [Edit label]  │
  └──────────────────────────────────────────────┘
```

The current detail panel (`TimelineDayView.tsx`) already surfaces this data. The redesign should collapse it inline rather than using a floating side panel.

### Context switching between blocks

When two adjacent blocks have significantly different dominant categories, show a visual transition marker:
```
────── Context switch ──────
```
This is a subtle horizontal divider with a label, not a formal block. No interaction needed.

### Focus session overlays

When a focus session (`focus_sessions` row) overlaps with one or more work blocks, render a vertical accent bar on the left edge of those blocks:
- Solid blue-tinted left border for blocks during a focus session
- Tooltip on hover: "During 'API work' focus session (50m)"

### Grouping

- **Day mode:** Show all blocks for the day in chronological order. No sub-grouping needed.
- **Gaps > 30 minutes:** Show a "── 45m gap ──" separator between blocks (idle time not tracked)
- **Gaps > 2 hours:** Show a "── 2h 15m gap ──" separator with more visual weight (possible away-from-desk)

### AI summaries

Each block should display its AI label (`block.aiLabel`) if available, or fall back to `userVisibleLabelForBlock()`. The block narrative (expanded state) should use `block.aiLabel` as the narrative title, and `fallbackNarrativeForBlock()` as the body if no AI narrative is stored in `work_context_observations`.

AI labels should be fetched lazily — do not block render while waiting for AI. Show rule-based label immediately; upgrade to AI label when the async response resolves.

### Day vs. Week mode differences

**Day mode:**
- Full block list, inline expand, high information density
- Live "now" indicator on today
- Filter pills visible

**Week mode:**
- Compressed per-day columns, not blocks
- Click a day to enter day mode for that date
- No block detail available in week mode

### What makes a block useful vs. noisy

**Useful block:** Has a meaningful label (not "Mixed Work" or "Uncategorized"), duration > 10 minutes, at least one identifiable app or website, and a confidence of medium or high.

**Noisy block:** Duration < 5 minutes, confidence = low, category = "system" or "uncategorized". These should be hidden by default with a "Show minor activity" toggle that reveals them.

The existing `isPresentationNoise()` function in `Today.tsx` handles this for the feed; apply consistent logic in the timeline renderer.

---

## 8. Apps and App Detail Redesign Spec

### Apps list principles

The ranked list sorted by total time must die. Total time is not a character signal.

Instead, sort apps by **recency** (most recently active) by default, with a toggle to sort by **time** or **sessions**. The primary display should convey character, not rank.

**Character labels (from `AppCharacter.character` in `shared/types.ts`):**
- `deep_focus` → "Sustained focus" (e.g., Cursor with 45m avg sessions)
- `flow_compatible` → "Flow compatible" (e.g., Journal with long, quiet sessions)
- `context_switching` → "High context switching" (e.g., Slack with 2m avg)
- `distraction` → "Distraction pattern" (e.g., YouTube with short repeated visits)
- `communication` → "Communication" (e.g., Reminders, Mail)
- `neutral` → show category label instead

**For apps where `AppCharacter` has low confidence** (< 3 sessions): show no character label; just show session count.

### App detail: what matters per app

**For terminal emulators (Ghostty, iTerm, Windows Terminal):**
- Average session length, peak usage time
- Which work blocks it appeared in (e.g., "Present in 4 of 5 development blocks today")
- Commands executed: not available without deeper instrumentation, so note as future instrumentation opportunity

**For code editors (Cursor, VS Code, Xcode, IntelliJ):**
- Session length distribution
- Which development work blocks it anchored
- Co-occurring apps (e.g., "Usually appears with terminal and Chrome")
- Key pages/windows from browser visits during the same blocks

**For AI tools (ChatGPT, Claude, Dia, Cursor AI):**
- Session character (exploratory, task-driven, iterative)
- Time-of-day patterns (are they being used as research tools in the morning vs. implementation assistants in the afternoon?)
- What work blocks they co-appeared in
- Total time and session count, but framed as "used in 3 work sessions today"

**For browsers (Safari, Chrome, Arc, Firefox, Edge):**
- Top sites visited in the selected period
- What the browsing was for (categorize domains: productivity, research, entertainment, social)
- Which work blocks the browser appeared in, and what those blocks were labeled
- Specific page titles (from `website_visits.page_title`) grouped by domain

**For communication apps (Slack, Mail, Reminders):**
- Session length pattern (long meetings vs. quick checks)
- Frequency distribution (how many times per day, at what times)
- Whether use correlates with fragmented vs. focused periods

**For productivity apps (TickTick, Notion, Obsidian, Journal):**
- Session character (is this used for daily review, task management, long writing?)
- Time-of-day usage pattern
- Focus quality during sessions

### Session pattern visualization

Replace the current "AVG SESSION / LOWEST / SESSIONS" three-box stat layout with a simple session-length histogram. Five buckets: <1m, 1–5m, 5–15m, 15–45m, 45m+. Show count per bucket as horizontal bars. This immediately communicates whether an app is used in quick checks or sustained blocks.

### How the app contributed to larger work blocks

New field in the App Detail panel: **"Appears in work blocks"** — a mini list of the top 3 blocks from the selected period that this app participated in, with block label and duration. This links app usage back to the Timeline, giving users a path to see the full context.

---

## 9. AI Experience Redesign Spec

### The core problem

The current AI workspace is empty by default. It shows a sparkle icon, the text "Ask about your day," and a button that says "Open Settings →" because Codex CLI isn't installed. This is a dead end. The product has significant activity data — work blocks, websites, session patterns, narratives — that could be surfaced immediately without AI.

### Principle: show something before asking for something

The AI view should never open to an empty state. It should always display a pre-computed or rule-based summary of recent activity as the first thing the user sees.

**Loading flow:**
1. AI view opens
2. Immediately: show rule-based summary from `fallbackNarrativeForBlock()` calls for today's blocks
3. In background: if AI provider is configured, generate an enhanced summary and replace/augment the rule-based one
4. Below summary: show 2–3 proactive insight observations
5. Below that: open chat input for follow-up

### Summary block content

**For "today" context:**
- Total tracked time
- Top 2–3 work blocks with their labels
- Observation about focus quality
- One notable pattern (e.g., "Your focus improved after 11am" or "You switched between 3 tools in the first hour")

**For "this week" context:**
- Best and worst focus days
- Most-used apps and their character
- Pattern observation (e.g., "Tuesdays and Thursdays are your most fragmented days")
- Work type distribution

### Proactive insight cards (below summary)

These should be generated from the existing algorithmic insight infrastructure in `Insights.tsx` (`AlgorithmicInsight` interface), but presented in a more conversational tone:

**Current:** "PEAK HOURS — 10 AM–12 PM is your peak window — 3h of focused work in this 2-hour window."  
**Target:** "Your best focus happens between 10am and noon. This morning's AI-assisted development block aligns with that — worth protecting."

**Current:** "STREAK — No streak yet today"  
**Target:** [Do not show this. Remove streak as a concept from AI observations.]

**Current:** "ALLOCATION — Uncategorized is leading at 50%"  
**Target:** "About half of today's activity didn't resolve to a clear work type. This may mean some apps need category overrides, or that the sessions were too short to classify."

### Chat behavior

- **Context injection:** Each user message automatically gets today's block data attached as context (via `insightsQueryRouter.ts`). The system prompt should include the day's blocks as structured context.
- **Citation:** AI responses should cite specific block times and labels: "In the 11:52 AM block, you were working in ChatGPT and Ghostty..."
- **No streaming indicator while AI is unconfigured:** Show rule-based answers instead.
- **Conversation persistence:** Use existing `ai_conversations` + `ai_messages` tables. Each day can start a new conversation or continue the existing one.

### Questions the AI should handle well

The `insightsQueryRouter.ts` already handles query routing. Target questions to handle:
- "What did I work on this morning?"
- "How focused was I today compared to yesterday?"
- "When did I drift off task?"
- "What was I looking at in Safari?"
- "Summarize my week."
- "Did I make progress on [project]?" (requires user-defined project labels — future feature)

### When AI provider is not configured

- Show full rule-based summary (already available via existing code)
- Show a single, non-blocking "Add an AI provider in Settings for richer analysis" note at the bottom
- Chat input is disabled (grayed out, with tooltip "AI provider needed for chat")
- Do not prevent access to the summary

---

## 10. Metrics and Data Model Rethink

### Metrics to retire

| Metric | Why |
|---|---|
| Focus Score (0–100 gauge) | Opaque composite; no actionable interpretation |
| Focus Streak (days) | Gamification trope; demoralizing for normal work patterns |
| "Uncategorized is leading at X%" | Data quality issue framed as insight |
| Time Distribution (category bar) | Category totals without context of what work happened |
| "Daily Focus Score: 23 / Building" | Branded confusion; label "Building" is arbitrary |

### Metrics to keep (with UI improvements)

| Metric | Keep if... |
|---|---|
| Focus % for the day | Show as supporting stat, not headline |
| Peak hours detection | Useful if framed as observation, not gamification |
| App character (deep focus, context switching) | Already computed; needs better UI surface |
| Block confidence (high/medium/low) | Useful for filtering noisy blocks |
| Session count per app | Keep, but show as part of app character |

### New signals to surface

| Signal | Source |
|---|---|
| Work block narrative | Already generated via `fallbackNarrativeForBlock()` + AI labels |
| Browser context per block | Already in `block.websites` and `block.keyPages` |
| Focus session alignment | Compare `focus_sessions` time ranges with `WorkContextBlock` — did the user's intent match behavior? |
| App co-occurrence | Which apps appear together in the same block → reveals work modes |
| Session length distribution per app | From `app_sessions`, grouped by bundle_id |
| Time-of-day patterns | From `app_sessions` start times |
| Distraction detection | `distraction_events` table (already exists but barely surfaced) |

### Entities the system needs (current vs. target)

**Currently exists:**
- `AppSession` — raw window activity ✓
- `WorkContextBlock` — derived grouping ✓
- `FocusSession` — intentional Pomodoro ✓
- `WebsiteSummary` — aggregated browser activity ✓
- `AppCharacter` — per-app behavioral profile ✓
- `WeeklySummary` — weekly aggregation ✓
- `PeakHoursResult` — peak activity window ✓
- `work_context_observations` — cached AI narratives ✓

**Needs improvement:**
- `WorkContextBlock.aiLabel` is a single string — should support a richer object: `{ label, narrative, confidence, generatedAt }`
- `AppCharacter` computed on demand via IPC — should be cached in DB for faster App Detail loading
- No concept of "project" or "task" as a derived entity — future feature but worth modeling

**Better product truth model:**
The product should maintain a derived representation of each day as a sequence of work sessions, not raw app sessions. The `WorkContextBlock[]` array already approximates this. What's missing is persistence (blocks are recomputed every load), caching (expensive for long history), and user annotation (ability to label or correct a block).

**Recommended additions:**
1. Persist computed `WorkContextBlock` results to SQLite to avoid recomputation on every History load
2. Add a `user_block_labels` table for user corrections to block labels
3. Add a `project_sessions` table (future) to link blocks to user-defined projects

---

## 11. Codebase-Aware Implementation Map

### Reusable as-is

| File | Reusable component | Notes |
|---|---|---|
| `src/renderer/components/AppIcon.tsx` | App icon rendering | Good, reuse everywhere |
| `src/renderer/lib/category.ts` | `catColor`, `formatCategory` | Clean utility, no changes |
| `src/renderer/lib/format.ts` | `formatDuration`, `formatTime`, `formatFullDate` | Clean, reuse |
| `src/renderer/lib/apps.ts` | `formatDisplayAppName`, `buildAppBundleLookup` | Clean, reuse |
| `src/renderer/lib/ipc.ts` | IPC wrapper | Clean surface, extend as needed |
| `src/main/services/workBlocks.ts` | `getHistoryDayPayload`, `userVisibleLabelForBlock`, `fallbackNarrativeForBlock` | Excellent logic — expose more of it |
| `src/main/lib/focusScore.ts` | Score computation | Keep, but demote from primary metric |
| `src/main/lib/workEvidence.ts` | Evidence summary | Used in `fallbackNarrativeForBlock` |
| `src/main/lib/insightsQueryRouter.ts` | AI context routing | Extend for new AI view |
| `src/main/services/browser.ts` | Browser history ingestion | Keep as-is |
| `src/main/services/tracking.ts` | Window activity polling | Keep as-is |
| `src/shared/types.ts` | All types | Clean; extend, don't replace |

### Needs modification

| File | What to change |
|---|---|
| `src/renderer/App.tsx` | Update routes: merge Today+History → `/timeline`, rename `/insights` → `/ai` |
| `src/renderer/components/Sidebar.tsx` | Update nav items (Timeline, Apps, AI, Settings); replace focus widget with compact status strip |
| `src/renderer/views/Today.tsx` | Either deprecate or transform into a redirect to `/timeline?date=today` |
| `src/renderer/views/History.tsx` | Becomes the core `Timeline.tsx` view; significant redesign |
| `src/renderer/components/history/TimelineDayView.tsx` | Rework block expansion from side panel to inline; add gap indicators; add focus session overlay markers |
| `src/renderer/views/Apps.tsx` | Replace ranked list with character-oriented app browser |
| `src/renderer/views/Insights.tsx` | Becomes `AI.tsx`; restructure to show summary-first, algorithmic cards, then chat |
| `src/renderer/views/Focus.tsx` | Reduce scope; turn into a lightweight intent declaration modal/overlay rather than a full page |

### Needs rewriting

| File | Why |
|---|---|
| `src/renderer/views/Today.tsx` | The dashboard metaphor is wrong. Either eliminate by merging into Timeline, or completely rethink the screen as a live timeline day view. |
| `src/renderer/views/Insights.tsx` | Currently a cards dashboard + empty AI chat. Should become a summary-first AI analysis view. Significant structural rewrite. |

### Where information architecture is encoded

- **Route structure:** `App.tsx` → lazy-loaded views via React Router (`HashRouter`)
- **Nav items:** `Sidebar.tsx` → `MAIN_NAV` array (easy to modify)
- **Data types:** `src/shared/types.ts` → single source of truth for renderer + main
- **IPC channels:** `src/shared/types.ts` → `IPC` const object (add new channels here)
- **Block segmentation:** `src/main/services/workBlocks.ts` → entire heuristic algorithm
- **AI orchestration:** `src/main/services/ai.ts` + `src/main/ipc/ai.handlers.ts`
- **Category definitions:** `src/shared/types.ts` → `AppCategory` union type + `FOCUSED_CATEGORIES`

### Where state/data models need to change

1. **Block persistence:** `WorkContextBlock[]` is recomputed from `app_sessions` on every History load. For long historical ranges this is expensive and produces inconsistent labels (if AI labels change). Add a `computed_blocks` table or cache in `work_context_observations` (which already exists for AI narratives).

2. **App Character:** `db:get-app-character` IPC call computes `AppCharacter` on demand. This should be pre-computed and cached daily for all apps.

3. **AI summary caching:** The `generated_reports` table exists but its structure isn't visible in the audited code. Ensure daily/weekly summaries are cached and served without regeneration on every view open.

4. **Focus overlay:** No current data structure links `focus_sessions` to `WorkContextBlock[]` by time range overlap. This join needs to happen in the history day payload or be computed in the renderer.

### Technical constraints from codebase

- **No ORM:** Schema is raw SQL (`schema.ts`). Adding tables requires migration in `migrations.ts`.
- **No global renderer state:** Each view fetches its own data. If Timeline and AI workspace need the same block data, they'll both fetch it independently unless a shared context is introduced (React Context or lightweight Zustand/Jotai store).
- **SQLite blocking:** `better-sqlite3` is synchronous; all DB calls happen in the main process over IPC. Heavy queries (recomputing all blocks for a week) will block the main process. Persist block results to avoid this.
- **Windows-first:** App detection uses exe names (not bundle IDs). `AppIcon` component handles this. Category inference must work without macOS-style bundle IDs.
- **AI provider optional:** The entire AI layer must degrade gracefully when no provider is configured. The `fallbackNarrativeForBlock` function already provides a non-AI path.

---

## 12. Master Task List

### Product framing
- [ ] Write internal product brief: "What Daylens is and is not"
- [ ] Define the three user questions the product must answer better than any other tool
- [ ] Decide on the "Timeline is the product" narrative and communicate to all workstreams

### Navigation restructuring
- [ ] Merge Today + History routes into a unified `/timeline` route
- [ ] Rename `/insights` → `/ai`
- [ ] Remove Focus from top-level nav; demote to an action
- [ ] Update `Sidebar.tsx` nav items and remove the Focus widget
- [ ] Add compact status strip to sidebar bottom (current app + quick focus action)
- [ ] Update `App.tsx` routing and lazy imports

### Timeline rebuild
- [ ] Design and implement new `Timeline.tsx` view (was `History.tsx`)
- [ ] Redesign block row component (collapsed + expanded inline)
- [ ] Add gap/idle indicators between blocks
- [ ] Add focus session overlay markers
- [ ] Add context switch dividers between significantly different blocks
- [ ] Implement "hide minor activity" toggle (using `isPresentationNoise`)
- [ ] Add live "now" indicator for today's view
- [ ] Move filter pills to be above the block list, not part of the header
- [ ] Deprecate/remove `Today.tsx` or redirect it

### Week view rebuild
- [ ] Redesign week view as a 7-column mini-grid (not just a bar chart)
- [ ] Add dominant category coloring per day column
- [ ] Replace "Most Active / Best Focus / Quietest" cards with 3 contextual observations
- [ ] Make day columns clickable → navigate to that day's timeline

### Apps list rebuild
- [ ] Replace leaderboard sorted by time with character-oriented app browser
- [ ] Add app character labels to each row (from existing `AppCharacter` API)
- [ ] Add sort options: by recency, by time, by sessions
- [ ] Add group-by-category toggle
- [ ] Style overhaul: remove current chip-based category tags, make character the primary label

### App detail rebuild
- [ ] Build new App Detail page as a proper route (`/apps/:bundleId`)
- [ ] Add character summary paragraph (generated from session data)
- [ ] Add session length histogram (5 buckets) — replace three-box stat layout
- [ ] Add browser-specific site list (for Safari, Chrome, Arc, etc.) with domain + time + page titles
- [ ] Add "appears in work blocks" section (link app sessions to `WorkContextBlock`)
- [ ] Add time-of-day usage pattern display

### AI integration
- [ ] Build new `AI.tsx` view (replaces `Insights.tsx`)
- [ ] Implement pre-populated summary block (rule-based from `fallbackNarrativeForBlock`)
- [ ] Integrate AI-enhanced summary when provider is configured
- [ ] Convert `AlgorithmicInsight` cards to conversational tone
- [ ] Remove streak card from AI insights
- [ ] Fix "Uncategorized leading at 50%" insight to frame as data quality note
- [ ] Redesign chat input area (below summary, not the only thing on screen)
- [ ] Implement graceful no-provider state (summary still shows, chat is disabled)
- [ ] Add "Today / This Week" toggle to AI summary

### Focus cleanup
- [ ] Demote Focus from top-level nav to an overlay/modal
- [ ] Design lightweight focus intent overlay (label + duration, triggered from sidebar quick-action)
- [ ] Remove "STREAK: 0d" stat from Focus view
- [ ] If Focus page remains, simplify to: session timer + recent sessions only
- [ ] Add focus session overlap visualization to Timeline blocks

### Settings cleanup
- [ ] Remove or relabel "ELITE MEMBER" badge
- [ ] Rename "Cognitive Augmentation" section to "AI Provider"
- [ ] Move Web Companion to bottom of right column
- [ ] Add Data section: sessions count, DB size, export

### Data model updates
- [ ] Add block persistence: store computed `WorkContextBlock` results in SQLite to avoid recomputation
- [ ] Cache `AppCharacter` per app per day in DB
- [ ] Add `user_block_labels` table for block label corrections
- [ ] Ensure `work_context_observations` is consistently written for all AI-generated narratives
- [ ] Add focus session ↔ block overlap join to `getHistoryDayPayload`

### UX polish
- [ ] Remove Focus Score gauge; replace Today headline with block-based narrative
- [ ] Remove streak counter from all primary surfaces
- [ ] Replace time distribution bar with meaningful block-level context
- [ ] Add category color stripe to block rows
- [ ] Improve block detail expand/collapse animation
- [ ] Design "── gap ──" separators for Timeline

### Visual refinement
- [ ] Audit and tighten spacing in sidebar (reduce padding, shrink width to 220px)
- [ ] Ensure dark/light theme parity across all new components
- [ ] Define a consistent category color palette (currently split between `catColor()` in `category.ts` and `CAT_COLORS` in `Apps.tsx`)
- [ ] Replace pie/gauge charts with text-based equivalents wherever possible
- [ ] Design character label badge style for Apps list

### Empty states
- [ ] Timeline — no data for date
- [ ] Timeline — today, first launch, no sessions yet
- [ ] AI view — no provider configured
- [ ] AI view — no data for today
- [ ] Apps — no sessions in selected period
- [ ] App Detail — insufficient data

### Instrumentation / telemetry needs
- [ ] Track `timeline_block_expanded` (which block types users drill into)
- [ ] Track `ai_summary_viewed` vs. `ai_question_asked` (are users reading or asking?)
- [ ] Track `app_detail_opened` per category (which app types attract the most exploration)
- [ ] Track `focus_session_started` source (quick start vs. intent modal)

### Technical debt / architecture gaps
- [ ] Eliminate duplicate `isPresentationNoise()` function (appears in both `Today.tsx` and `Apps.tsx`)
- [ ] Introduce shared block data context (React Context) to avoid duplicate IPC fetches between Timeline and AI view
- [ ] Consolidate category color definitions into a single source (`category.ts`)
- [ ] Add DB migration for new tables (`user_block_labels`, cached block storage)
- [ ] Consider lightweight global state (Jotai or Zustand) for live session + today's blocks — currently re-fetched in sidebar, Today, and History independently

---

## 13. Agent Handoff Section

### Workstream A: Timeline Rebuild

**Objective:** Redesign and implement the unified Timeline view that replaces both Today and History.

**Why it matters:** The timeline is the product's primary truth surface. Everything else derives from it. Getting this right first provides the foundation for all other workstreams.

**Desired outcome:**
- A single `/timeline` route that defaults to today's date
- Day mode: scannable block list with inline expansion, gap indicators, focus overlays
- Week mode: 7-column day grid with per-day character signals
- No dashboard metrics in the header — only a compact status strip

**Dependencies:**
- Relies on existing `getHistoryDayPayload` IPC and `WorkContextBlock` type — no backend changes needed initially
- Focus overlay requires new join between `focus_sessions` and blocks — can be phased in
- AI labels are already available on blocks — use them immediately

**Files affected:**
- `src/renderer/views/History.tsx` → transform into `Timeline.tsx`
- `src/renderer/components/history/TimelineDayView.tsx` → major rework
- `src/renderer/App.tsx` → update routes
- `src/renderer/components/Sidebar.tsx` → update nav
- `src/renderer/views/Today.tsx` → redirect or deprecate

**Agent notes:** The block segmentation logic in `workBlocks.ts` is sophisticated and correct — do not change it. The redesign is purely in how the renderer presents the output of `getHistoryDayPayload`. The `userVisibleLabelForBlock` function in `workBlocks.ts` is the right label source. The `fallbackNarrativeForBlock` function should be used for the block narrative in the detail panel.

---

### Workstream B: Apps + App Detail Rebuild

**Objective:** Transform the Apps view from a time-ranked leaderboard into a behavior-oriented app browser with a rich App Detail page.

**Why it matters:** The Apps view is currently the weakest view in the product. Users who click into Safari and see "100% Browsing" get nothing. The data exists (website visits, session patterns, app character) — it just isn't surfaced.

**Desired outcome:**
- Apps list shows character label per app (from `AppCharacter`)
- Apps list sorts by recency by default
- App Detail shows: character summary, session histogram, browser site list (if applicable), work block appearances
- App Detail for Safari/Chrome shows top visited domains and page titles

**Dependencies:**
- `db:get-app-character` IPC already exists and returns `AppCharacter` type
- `db:get-website-summaries` IPC already returns domain + title data
- App Detail needs a new route (`/apps/:bundleId`) — add to `App.tsx`
- Linking app sessions to work blocks requires either passing block data or new IPC call

**Files affected:**
- `src/renderer/views/Apps.tsx` → major rework
- `src/renderer/App.tsx` → add `/apps/:bundleId` route
- `src/main/ipc/db.handlers.ts` → may need new `db:get-app-block-appearances` handler
- `src/shared/types.ts` → may need `AppDetailPayload` type

**Agent notes:** The `AppCharacter` type already has `avgSessionMinutes`, `sessionCount`, and `character` field — use these to generate the character summary paragraph deterministically. For browser apps, check `session.category === 'browsing'` or `isBrowserSession()` from `workBlocks.ts` to decide whether to show the site list. The session histogram (5 duration buckets) is purely a renderer-side computation from session data.

---

### Workstream C: AI View Rebuild

**Objective:** Build the new AI view with a pre-populated summary as the default state, followed by proactive insight cards and a chat interface.

**Why it matters:** The current AI workspace is gated, empty, and positioned as a secondary chat tool. It should be the synthesis layer that makes the product feel intelligent even without the user asking questions.

**Desired outcome:**
- AI view always shows a summary of recent activity (rule-based fallback or AI-enhanced)
- Summary is computed from today's blocks using `fallbackNarrativeForBlock` as baseline
- 2–3 proactive insight cards shown below summary
- Chat input at the bottom for follow-up questions
- Works without AI provider (rule-based only); enhances with provider configured

**Dependencies:**
- `fallbackNarrativeForBlock` in `workBlocks.ts` — exposed via `db:get-history-day` → blocks
- `insightsQueryRouter.ts` — already handles AI query routing; extend for summary generation
- `ai:send-message` IPC — already exists
- Algorithmic insights already computed in `Insights.tsx` — port the data, change the presentation

**Files affected:**
- `src/renderer/views/Insights.tsx` → rewrite as `AI.tsx`
- `src/renderer/App.tsx` → rename `/insights` → `/ai`
- `src/renderer/components/Sidebar.tsx` → update nav label
- `src/main/services/ai.ts` → may need new summary generation function
- `src/main/lib/insightsQueryRouter.ts` → extend for daily summary query type

**Agent notes:** The `AlgorithmicInsight` interface in `Insights.tsx` generates good data — keep the computation, change the presentation. The streak insight should be removed entirely. The allocation insight should be reframed as a data quality note when "uncategorized" leads. The AI chat should inject today's blocks as structured context on every message — use the existing context injection pattern in `insightsQueryRouter.ts`.

---

### Workstream D: Sidebar + Navigation Restructure

**Objective:** Restructure the sidebar to reflect the new nav hierarchy and replace the Focus widget with a compact status strip.

**Why it matters:** The sidebar is the first thing users see on every screen. The current layout buries the compact status information and dominates with a Focus timer that isn't always relevant. Every nav click is an expression of the product's information architecture.

**Desired outcome:**
- 4-item nav: Timeline, Apps, AI, Settings
- Compact status strip at sidebar bottom: current app indicator + quick Focus action
- No full Focus timer widget on every screen

**Dependencies:**
- Depends on Workstream A (Timeline route) and C (AI route) for correct `to=` values
- Focus overlay/modal must exist before the sidebar quick-action can trigger it

**Files affected:**
- `src/renderer/components/Sidebar.tsx` → significant rework
- `src/renderer/App.tsx` → route updates

**Agent notes:** Keep the `quickStartSession` and `stopSession` logic from the current `Sidebar.tsx` — just move it into a more compact UI. The polling logic for `focus.getActive()`, `db.getToday()`, and `tracking.getLiveSession()` is correct and should be preserved. Reduce polling interval from 10s to maintain responsiveness without excessive IPC traffic.

---

### Workstream E: Data Model + Backend Improvements

**Objective:** Add block persistence, `AppCharacter` caching, and focus↔block overlap join to support faster rendering and richer data.

**Why it matters:** Without persisted block data, the History view recomputes `WorkContextBlock[]` from raw sessions every time. This is expensive for long histories and produces inconsistent AI labels across reloads. Caching is essential for quality.

**Desired outcome:**
- Computed blocks cached in SQLite (new `computed_day_blocks` table or similar)
- `AppCharacter` computed nightly and cached per app
- `getHistoryDayPayload` includes `focusSessions: FocusSession[]` with time ranges for timeline overlay

**Dependencies:**
- Requires new DB migrations in `migrations.ts`
- Backend-only; renderer benefits without code changes (just faster IPC responses)

**Files affected:**
- `src/main/db/schema.ts` → add new tables
- `src/main/db/migrations.ts` → add migration version
- `src/main/services/workBlocks.ts` → add cache read/write logic
- `src/main/ipc/db.handlers.ts` → extend `getHistoryDay` to include focus sessions
- `src/shared/types.ts` → extend `HistoryDayPayload` with `focusSessions`

**Agent notes:** The existing `work_context_observations` table already caches AI narratives by time range — the pattern is correct. The new `computed_day_blocks` table should store serialized block data keyed by `(date, sessions_hash)` so it invalidates when sessions change. Cache invalidation is the hard part — a simple approach is to invalidate any cached blocks for a date when new `app_sessions` rows are inserted for that date.

---

## 14. Design Direction

### Quality bar

Daylens should feel like a **professional analytical tool**, not a productivity dashboard. The visual reference point is closer to a well-designed data journalism interface or a premium developer tool than to a consumer wellness app.

### Intended qualities

**Subtle:** Nothing should scream for attention. Category colors are present but muted. Iconography is minimal and consistent.

**Calm:** The user is looking at their work history. They should not feel judged, gamified, or anxious. No red alerts, no streak guilt, no scores that imply failure.

**Premium:** Typography should be tight and editorial. Spacing should be intentional. Nothing should look like a Figma template or a Tailwind starter kit.

**High-trust:** The product holds sensitive behavioral data. It should feel like a private journal, not a surveillance dashboard. No sharing prompts, no social features, no external metrics.

**Local-first:** Data stays on the machine. The UI should reinforce this: no cloud syncing spinners in the primary flow, no "your data is being analyzed by our servers" language.

**Intelligently minimal:** Remove everything that doesn't earn its space. If a metric can't be explained in one sentence that changes the user's understanding of their day, it shouldn't be a top-level element.

**Professionally designed:** The difference between a well-designed and poorly-designed screen often comes down to: (1) hierarchy — the most important information is visually dominant; (2) restraint — colors, decorations, and animations are used sparingly; (3) density — the screen feels full without feeling cluttered.

### What to avoid

- **Shallow cards:** A card with a title, an icon, a number, and a "See all" link is dashboard filler. Replace with prose or structured data.
- **Meaningless charts:** A donut chart showing app category percentages adds color but not insight. Remove it.
- **Dashboard filler:** "Most Active / Best Focus / Quietest" three-column cards on the week view. These look designed but contain almost no information.
- **Generic productivity tropes:** Streak counters, focus score gauges, "Today's Goal" progress bars. These belong in a different product.
- **Fake AI UI patterns:** An AI icon + "Ask about your day" text + empty chat box. This is not AI; it's the shape of AI. The actual intelligence should be visible before the user interacts.
- **Status green/red without meaning:** Using red for low focus score or green for high creates unnecessary anxiety around normal work patterns.

### Typography

- **Font:** Inter Variable (already in use) — keep it
- **Scale:** Use tighter type scale than default Tailwind. Most body text should be 12–13px. Labels and nav items at 12–13px, bold. Prose at 13–14px.
- **Letter spacing:** Use tight negative letter-spacing for headings (-0.03em). Use small positive tracking for uppercase labels (0.05–0.1em).

### Color

- **Category colors:** Consolidate the two color maps (`catColor()` in `category.ts` and `CAT_COLORS` in `Apps.tsx`) into one canonical source. Colors should be muted/desaturated — not candy-colored.
- **Block confidence:** Use opacity or stroke weight to indicate low confidence, not warning colors.
- **Dark mode:** Fully supported (already in `globals.css`). New components must support both.
- **Accent:** One accent color (the existing blue gradient) is enough. Do not add more accent colors for new features.

---

## 15. Final Recommendation

### First: Fix the timeline (Workstream A)

The most impactful single change is transforming the History view into a properly designed Timeline that is the product's primary surface. This does not require backend changes — the data is already there. It requires a redesign of `TimelineDayView.tsx`, a merge of Today and History into one route, and a sidebar nav update.

A working Timeline with meaningful block display, inline expansion, and gap indicators changes how users perceive the entire product. It makes the existing block segmentation work visible and valuable.

**Target timeline for Workstream A:** Complete before starting any other workstream. This is the foundation.

---

### Second: AI view that starts populated (Workstream C)

Once the timeline exists, the AI view is the highest-leverage improvement. The rule-based summary (using `fallbackNarrativeForBlock`) can be implemented immediately without AI provider changes. This transforms the empty chatbot into a summary-first analysis surface.

The algorithmic insight refactoring (removing streak, reframing uncategorized) is straightforward and can happen in parallel with the summary implementation.

**Target: implement rule-based summary first, then layer in AI-enhanced version.**

---

### Third: App Detail overhaul (Workstream B)

The Apps view rework is high-value for users who want to understand their behavior at an app level, but it does not affect the core "what did I do today" question. It should follow the timeline and AI workstreams.

The browser site list in App Detail is the highest-priority piece of Workstream B — it's the most concrete missing information from the current product.

---

### Fourth: Backend data model improvements (Workstream E)

Block persistence and caching are technical debt that becomes important as users accumulate weeks of history. These should happen before the product is promoted to a wider audience, but they don't block the UI workstreams above.

---

### What should wait

- **Focus modal redesign:** The Focus view is functional enough. Demoting it from the nav is a one-line change. The full modal redesign can wait.
- **Project/task labeling:** User-defined projects are a significant feature. Don't design for it yet; let the block label correction (`user_block_labels`) be the first step.
- **Settings cleanup:** Minor. Do it opportunistically when touching related files.
- **Instrumentation:** Important but not blocking. Add telemetry events when shipping each workstream, not as a separate workstream.

---

*End of DAYLENS REDESIGN MASTER SPEC — v1.0, April 2026*
