# DAYLENS FRONTEND / UI PLAN

**Version:** 1.1 — April 2026  
**Branch:** feat/daylens-timeline-nav-redesign  
**Status:** Pre-implementation design plan. Not a code change document — see implementation order in Section 10.  
**Revision notes:** v1.1 adds gap/idle rendering spec (3.6), block merging UX (3.7), calendar overlay forward-compatibility (3.8), month view note (4.6), resolved Focus button design (Section 2), keyboard navigation (Appendix C), drag-to-select deferral (Appendix C), interaction patterns (Appendix C), codebase glossary (Appendix D). Implementation phases renumbered and expanded from 33 → 43 steps across 8 phases.

---

## 1. What Is Wrong with the Current UI and Interaction Model

### 1.1 The navigation tells the wrong story

`App.tsx` routes: `/timeline`, `/focus`, `/history`, `/apps`, `/insights`, `/settings`  
`Sidebar.tsx` nav items: Timeline, Apps, AI, Settings

The routes are partially cleaned up. `Insights` maps to AI in the nav, `/today` redirects to `/timeline` — that is correct. But `/history` and `/focus` routes still exist and are lazy-loaded. **Focus as a route must be removed.** History is now redundant with Timeline and should be collapsed into it or removed.

The sidebar is 220px wide. That is acceptable but on the wide end for a three-item nav. The wordmark is 20px/700 weight and sits well. The bottom status strip is compact and appropriate. The Focus quick-start button inside the strip is the right call and should stay — but must not be the main entry point to a focus feature.

### 1.2 The week view is nearly empty and misleading

The current week view (`Timeline.tsx`, ~line 320–425) renders compact day columns. On any day with data, a colored bar appears with proportional height. This is the right concept but the execution has two critical failures:

- **Only one day has data in the live screenshots** — the result is one tall bar on Monday and six empty columns. Visually this communicates failure, not sparseness.
- **The summary card below the grid** shows "Heaviest day," "Best focus," and "Total tracked" as three text lines. This is fine as supporting detail but it is the only content below empty columns, making the screen feel unfinished.
- **No density visualization per day** — there is no way to see whether Monday was a 3-hour solid morning or scattered 20-minute sessions.
- **Week navigation arrows work** but clicking a day column does not navigate into that day's timeline. There is no click-through.

### 1.3 The apps list is a ranking table, not an intelligence surface

`Apps.tsx` renders a ranked list sorted by total time. Each row shows:
- App icon (small, generic black placeholder in screenshots — icon loading issues)
- App name
- `"48 sessions · avg 2m"` or `"AI suggests Development"` — these are exactly the wrong data points
- A faint time bar on the right
- Total duration

The "AI suggests" prefix is repeated on every app that has a category suggestion. It reads as a system annotation, not user-facing content. The session count and average session duration are not actionable to a user. A bar with no scale reference is meaningless.

### 1.4 The app detail is structurally underbuilt

`Apps.tsx` (app detail, inline expansion) shows:
- Role summary paragraph — this is actually good and should be preserved
- "TOP SITES" section — good data, but the subtitle copy ("Daylens — You have no idea where your day went. We do.") reads as a Toggl tagline rather than genuine app-specific insight
- Session count and avg session time as the header metrics — wrong hero information
- No artifacts: no documents, no repos, no project folders
- No workflow patterns: no "usually used alongside..." insight
- No time-of-day pattern

The `buildCharacterSummary()` function in `Apps.tsx` generates reasonable narrative text. This is good infrastructure that is not surfaced prominently enough.

### 1.5 The timeline day view is close but has layout and information hierarchy issues

The day view is the strongest screen. `Timeline.tsx` has:
- A proper proportional calendar grid at 2px/min (120px/hr)
- Block color via `dominantCategory`
- Block title via a prioritized `blockLabel()` function that tries AI label > rule-based label > sites > apps
- App icons within blocks
- A popover with narrative, apps, sites, key pages, and re-analyze

What is wrong:
- **App icons render as black squares** — `AppIcon.tsx` is failing for many apps in the demo screenshots
- **Block width** uses the full content column with 4px left padding — there is no left accent stripe pattern that visually ties blocks to their category. The color is only in the background fill, which is very faint.
- **Filter pills** (All, Focus Work, Meetings, Communication, Browsing) sit between the status strip and the grid. They are visually reasonable but categorically inconsistent — "Focus Work" is a derived state, not a category. These should be simplified.
- **The "live" block indicator** (orange line at current time) works but is styled as a full-width `border-top` line that visually competes with blocks.
- **Status strip** ("2h 27m tracked · 11% focused · 15 apps · 12 sites · Safari") — the live app name is appended as a dot-label at the end. The "11% focused" metric is weak signal (see MASTER_SPEC critique). The current app pill is a good idea but needs cleaner treatment.
- **Category filter pills are a secondary concern.** They should not be the dominant visual element immediately below the status strip.

### 1.6 The Focus route should be eliminated

`Focus.tsx` exists as a lazy-loaded route. It implements a Pomodoro timer with session stats and planned apps. Per product vision, Focus is not a destination — it is a quick action in the sidebar strip. The Focus quick-start button already exists in `Sidebar.tsx`. The full `/focus` route should be removed.

### 1.7 Settings has stale structure and inconsistent icons

`Settings.tsx` references sections that include "Focus Goal" — which contradicts the product direction. The icon set uses a gear for Settings in the sidebar, which is fine. Section labels use uppercase/spaced text (`SectionLabel` component with `letterSpacing: 0.2em`) which is heavy-handed. The structure otherwise is reasonable but needs pruning.

### 1.8 The "AI" nav slot points at the right idea but the screen is empty by default

`Insights.tsx` renders what is currently an empty AI chat. The nav renames it "AI" which is correct. The screen should not open empty — it should show proactive synthesis from the day's tracked data.

---

## 2. What Each Primary View Should Become

### Navigation: 4 destinations, always visible

```
Sidebar (190px wide)
──────────────────────
  Daylens            ← wordmark, 18px, tight tracking

  [icon] Timeline    ← primary
  [icon] Apps
  [icon] AI

  (spacer / flex-1)

  [icon] Settings
  ──────────────────
  [dot]  Live app name   ← status strip, stays slim
  [◎]  Focus             ← icon-only button, opens duration popover
```

Remove: History nav item (merged into Timeline), Focus nav item (replaced by quick action), Insights nav item (renamed AI).  
Routes to remove: `/focus`, `/history`  
Routes to keep: `/timeline`, `/apps`, `/insights` (now the AI screen), `/settings`

### Sidebar Focus button: resolved decision

The Focus quick-start button stays in the sidebar status strip. It becomes a **single icon button** (the existing `IconFocusSmall` target icon, 14px). No label text. Clicking it opens a **small anchored popover** (200px wide, anchored above the button) with:

- Duration selector: preset chips (25m, 50m, 90m) + custom input
- Optional label field (one line, placeholder: "What are you working on?")
- "Start" button

When a focus session is active, the icon button changes to a red-tinted stop icon. The sidebar strip shows a countdown timer next to the live app name: `Safari · 23:41 left`. No progress ring, no full timer display, no session stats.

This replaces the current implementation which has:
- A full-width "Focus" button with label text
- A timer countdown display
- A stop button expanding to full width
- A session label row

All of that is removed. The focus interaction is: click icon → popover → start → see countdown inline → click icon → stop. No route, no page, no dashboard.

### Sidebar width

Reduce from 220px to 190px. The current nav items fit. The status strip fits. This gives 30px more to the content area.

---

## 3. How the Timeline Day View Should Work

### 3.1 Header

```
[ ‹ ]  [Mon, April 13]  [ › ]  [Today]    ────────────   [Day]  [Week]
```

- Left: nav arrows + date label + Today button (hidden when on today)
- Right: Day / Week segmented control
- Date label: "Mon, April 13" — use `Intl.DateTimeFormat` with `weekday: 'short', month: 'long', day: 'numeric'`
- Today button: only visible when `selectedDate !== todayString()`

### 3.2 Status strip

A single-line strip below the header, above the grid.

```
2h 27m tracked  ·  4 blocks  ·  12 sites  ·  Safari (live)
```

Rules:
- "tracked" = total seconds of work blocks in the day
- "blocks" = count of `WorkContextBlock[]` for that day — more useful than "apps" count
- "sites" = distinct domains with >30s
- Live app: only show when tracking, shown as a colored dot + app name, rightmost slot
- Remove "11% focused" — this is not a useful default metric. Replace with block count.
- If no data: "Nothing tracked yet today" in muted text

Visual: one row, 13px, muted separators (` · `), no boxes or cards.

### 3.3 Category filter pills

Keep but demote visually. Current pills: All, Focus Work, Meetings, Communication, Browsing.

Replace with: **All · Development · Browsing · Communication · Writing · Meetings**

"Focus Work" is an inference, not a category — remove it from filters. Use actual `AppCategory` values that map to `CATEGORY_COLORS`. Pills should be 11px, subtle background, not the primary visual weight on the page.

### 3.4 Calendar grid

The grid itself is well-implemented:
- `PX_PER_MIN = 2.0` — 120px/hr — this is correct, keep it
- Hour labels at 48px width — keep
- Hour lines: keep current subtle styling

**What to change:**

1. **Block accent stripe**: Add a 3px left border strip using `dominantCategory` color at full opacity. The block background fill should be the same color at 8–12% opacity. Currently the fill uses the full color which looks bolder than needed.

   ```
   [3px solid #6a91ff] [background: rgba(106,145,255,0.09)]
                       [title 13px 600]
                       [apps row]
   ```

2. **Live time indicator**: Replace the full-width orange line with a hairline `::before` pseudo-element (or a positioned `<div>`) styled as:
   - 1px height, `var(--color-accent)` color
   - A 6px dot on the left edge of the content column
   - No overflow beyond the content area

3. **Nano blocks** (<32px / <16min): show title only, accent stripe only, no icons — current logic is correct

4. **Medium blocks** (32–100px): title + app icons row (max 3 icons, 14px each)

5. **Full blocks** (>100px): title + time range small text + app icons + optional single context line (e.g. "+ 3 sites")

6. **App icon fallback**: `AppIcon.tsx` must handle missing icons gracefully. Current screenshots show black squares — likely a path resolution issue on macOS with the electron icon loading. The icon component should render a colored initial-letter circle as fallback using `dominantCategory` accent color.

### 3.5 Block popover

The popover is a key surface. Current implementation has a `POPUP_W = 330` anchored panel. Keep the approach, improve the content:

**Structure:**
```
[App icons row] [Category pill]              [×]
Title
HH:MM – HH:MM  ·  Duration

[narrative paragraph]

USED IN
  [icon] AppName          HH:MM – HH:MM
  [icon] AppName 2

TOP SITES (if any)
  domain.com              1h 7m
  other.com               12m

KEY PAGES (if any)
  Page title truncated...

[Re-analyze]  [Open in…]
```

Rules:
- Narrative: use `blockNarrative()` output but style it as a paragraph, not a label
- Category pill: small, colored, based on `dominantCategory` — not "UNCATEGORIZED/AMBIGUOUS" badge
- If confidence is low, show a small faint "inferred" label, not a loud badge
- "Open in…" action: only show if any app in the block has a launchable bundle ID
- Popover should dismiss on Escape or outside click (already implemented)

### 3.6 Gap and idle time rendering

The product vision requires deliberate treatment of gaps between blocks. Without this, a day with 2 hours of morning work and 2 hours of afternoon work looks like either 4 continuous hours (misleading) or a massive stretch of blank grid (wasteful).

**Rules by gap length:**

| Gap duration | Treatment |
|---|---|
| < 5 minutes | No visual treatment. Grid space passes through normally. |
| 5–15 minutes | Subtle: a single 1px dashed line across the content column at the midpoint of the gap, no label. |
| 15–60 minutes | A thin neutral band (8px tall, `var(--color-surface-low)` background) with centered label: "25m idle" in 10px muted text. The band replaces the proportional gap space — a 45-minute gap renders as 8px, not 90px. |
| 1–3 hours | A compressed idle region (16px tall) with label: "2h 15m away" in 11px muted. Background: faint striped pattern using `repeating-linear-gradient` at 45deg with `var(--color-border-ghost)`. Clicking the region expands it to proportional height (for context). |
| > 3 hours / machine off | Same as 1–3h but labeled "machine off" or "no activity" depending on whether tracking data exists for the period. These must **never** be folded into adjacent work blocks. |

**Implementation impact on the calendar grid:**

The current grid uses `PX_PER_MIN = 2.0` uniformly. With gap compression, the grid becomes a **variable-density** layout. The simplest approach:

1. Compute block positions as a flat array of `{ type: 'block' | 'gap', startMs, endMs, compressedHeightPx }`
2. Blocks use `PX_PER_MIN = 2.0` for their height (proportional)
3. Gaps over 15 minutes use fixed heights (8px or 16px) regardless of actual duration
4. Sum these to get total grid height and render them in sequence with `position: relative` stacking instead of `position: absolute` with `top: (startTime - rangeStartMs) / 60_000 * PX_PER_MIN`

This is the most significant architectural change in the day view. It means the current absolute-positioning model for `CalendarBlock` must change to a sequential layout model. **This should be tackled in Phase 2, step 7.5** (inserted between accent stripe and live time indicator).

**Hour labels with gap compression:**

When gaps are compressed, the hour labels on the left rail no longer align to pixel-perfect positions. Two options:
- **Option A (recommended):** Show hour labels only at the top of each block cluster and at the bottom. Between clusters, the compressed gap region carries the time context via its label ("2h 15m away"). This is simpler and avoids fighting the variable layout.
- **Option B:** Interpolate hour labels into the compressed space. This is complex and visually confusing — avoid it.

### 3.7 Block merging and grouping UX

The backend (`workBlocks.ts`) already performs heuristic grouping — coherence scoring, gap-based splitting, meeting detection, long-app streak detection. The frontend should not duplicate this logic. However, the UI needs to handle two edge cases:

**Adjacent blocks with the same inferred label:**

When two consecutive blocks have the same `blockLabel()` output (e.g., both resolve to "Prompt Improvement via ChatGPT"), they should be **visually connected** — render them as a single block with a subtle internal divider (1px dashed line at the boundary time) rather than two separate blocks with a visible gap.

Implementation: in the block layout pass, detect adjacent blocks where `blockLabel(block[i]) === blockLabel(block[i+1])` and the gap between them is < 5 minutes. Merge their vertical extent into one rendered block but preserve the internal time boundary. The popover for a merged block should show both sub-blocks' details in sequence.

**User-initiated merge (future, not in current phases):**

Eventually, users should be able to select two adjacent blocks and merge them. This is a backend operation (`workBlocks.ts` would need a merge API) and is out of scope for the frontend plan. However, the popover should include a "Merge with previous" action button if the previous block ended within 5 minutes. This button can be disabled/hidden until the backend supports it — but reserving the UI slot now prevents layout changes later.

**Blocks that are too small to render:**

The current `MIN_BLOCK_HEIGHT = 24` at `PX_PER_MIN = 2.0` means any block under 12 minutes gets clamped to 24px. This is correct. Blocks under 3 minutes should be absorbed into the nearest adjacent block rather than rendered as their own nano-block. This is a backend concern but the frontend should filter out blocks where `(endTime - startTime) < 180_000` and the block has no AI label (i.e., there is no meaningful content to show).

### 3.8 Forward-compatibility for calendar event overlay

The product vision requires that the timeline "leave room for future calendar integration without needing a redesign." This means the grid layout must accommodate a second lane of content — external calendar events.

**Target layout (future state, not built now):**

```
TIME   CALENDAR EVENTS        TRACKED ACTIVITY
8am    ┌──────────────┐
       │ Team standup │       ┌─────────────────────────────┐
       │ 8:00–8:30    │       │ Debugging Electron nav state │
       └──────────────┘       │ Ghostty + Cursor             │
9am                           │                              │
                              └─────────────────────────────┘
10am   ┌──────────────┐
       │ 1:1 with PM  │
       └──────────────┘
```

**What this means for the current layout:**

The content column to the right of the time rail currently spans `calc(100% - TIME_RAIL_W)`. To accommodate a future calendar lane:

1. The content column should be a **flex row** with two children: `calendar-lane` (0px width now, expandable later) and `activity-lane` (100% width now)
2. When calendar integration is enabled, `calendar-lane` gets a fixed width (e.g., 160px) and `activity-lane` shrinks to fill the remaining space
3. The current block rendering logic only touches `activity-lane` — no changes needed when the calendar lane is added

**Concrete change now:** Wrap the block rendering area in a `<div className="activity-lane" style={{ flex: 1 }}>` inside a flex container. This is a zero-visual-change refactor that makes the future calendar lane a matter of adding a sibling div. Do this in Phase 2 as part of the grid work.

### 3.9 Empty state

When the day has no blocks:
```
Nothing tracked yet on this day.

Daylens tracks your active windows automatically.
Activity will appear here as you work.
```

Centered, 13px, muted. No illustration.

---

## 4. How the Timeline Week View Should Work

### 4.1 The problem to solve

Current week view: one tall bar for any active day, empty columns for inactive days. The visual reads as broken when most days are empty.

### 4.2 Target layout

Each day = a vertical mini-strip inside a 7-column grid. Each strip shows:

```
MON          TUE          WED
13           14           15
┌─────┐      ┌─────┐      ┌─────┐
│     │      │░░░░░│      │     │
│ ██  │      │░░░░░│      │     │
│████ │      │░░░░░│      │     │
│     │      │░░░░░│      │     │
└─────┘      └─────┘      └─────┘
2h 19m       —            —
```

- Each strip is ~120px tall
- Bars are proportional to total tracked time, relative to the week's busiest day
- Color: blend of top 2 categories (development blue, browsing orange, etc.) rather than a single color
- Empty days: very faint dashed border, no fill, "—" below
- **Today indicator**: subtle blue dot or underline on the date number
- **Hover state**: shows tooltip or inline panel with: top block title, total time, focus character

### 4.3 Click-through behavior

Clicking any day column navigates to `/timeline` with that `dateStr` loaded in the day view. This already exists partially — the `setSelectedDate` function and the `view === 'day'` state need to be connected.

State required: `selectedDate` (dateStr) and `view: 'day' | 'week'` must be **URL query params**, not local state, so navigation from week → day → back works correctly. Currently they are `useState` in `Timeline.tsx` — this is why clicking Back from a day does not return to the week with the same week selected.

**Change:** Move `view` and `selectedDate` into URL search params: `/timeline?view=week&week=2026-04-07` and `/timeline?view=day&date=2026-04-13`. Use `useSearchParams` from `react-router-dom`.

### 4.4 Week summary panel

Below the 7-column grid, a 2–3 line summary. Current implementation shows this correctly — keep it. Make the language slightly more informative:

```
Heaviest day: Monday — 2h 19m, mostly browsing
Best focus: Monday — 12% focused time
Total: 2h 19m across 1 day
```

For weeks with 3+ active days, add a "Main activity this week:" line derived from the most-represented category across all days.

### 4.5 Week navigation

Left/right arrows navigate back/forward one week. "Today" shortcut only shows when not in the current week. This already works in the code — preserve it.

### 4.6 Month view forward-compatibility

The product vision describes a future month view: "should emphasize the dominant project, top app, or strongest recurring activity for each day while still letting users drill into detail."

**Not built now, but the week view must not block it.**

A month view is a 7-column x 4–5 row grid where each cell is a compressed version of the day strip. The `WeekStrip.tsx` component should therefore be designed with a `size` prop:

- `size: 'week'` — current spec: ~120px tall strips, full day label, total time, hover tooltip
- `size: 'month'` (future) — ~40px tall cells, date number only, single category color dot, click-through to day

The day/week/month segmented control would extend from `[Day] [Week]` to `[Day] [Week] [Month]`. The URL param pattern already supports this: `/timeline?view=month&month=2026-04`.

**Concrete requirement now:** The per-day rendering logic in `WeekStrip.tsx` should be a `DayCell` sub-component that accepts a `compact: boolean` prop. At `compact: false` it renders the full 120px strip. At `compact: true` it renders a 40px mini-cell. This costs nothing extra during Phase 3 and prevents a rewrite when month view is added.

---

## 5. How Apps List Should Work

### 5.1 Information hierarchy for each row

**Target row structure:**

```
[AppIcon 32px]  App Name                              1h 45m
                Research-heavy browser activity
                safari · chatgpt.com · anthropic.com
```

- Line 1: App name, 14px 600, + total time right-aligned
- Line 2: Character summary, 12px muted — use `buildCharacterSummary()` output condensed to ~8 words max
- Line 3: Associated apps or top domains, 11px tertiary, dot-separated

**Remove entirely:**
- "48 sessions · avg 2m" as the secondary label — this is what the user sees and it is the wrong framing
- "AI suggests Development" prefix — just show the category cleanly as a small pill or label
- The faint time bar on the right — replace with the actual duration in clear text

### 5.2 Category grouping (optional, phase 2)

When the user has more than ~8 apps, group them by inferred role:

```
DEVELOPMENT
  Ghostty    Terminal sessions in development workflows    16m
  Cursor     Code editing and AI-assisted development      7m

AI TOOLS
  Codex      AI pair programming in editor context         7m

BROWSERS
  Safari     Research-heavy browser activity              1h 45m
```

Group headers use the existing `CATEGORY_COLORS` system. Groups are collapsed by default if they contain only 1 app. Group labels are the same uppercase/spaced style as settings section headers.

### 5.3 Category filter pills

Keep the current filter pills but use cleaned category labels. Remove the "AI suggests" qualifier from the pill content. The current pill implementation is fine architecturally.

### 5.4 Date range selector

Keep Today / 7d / 30d. The current implementation already does this via `DAYS_OPTIONS`. No change needed architecturally.

### 5.5 Empty/loading state

"No apps tracked in this period." — simple, no illustration.

---

## 6. How App Detail Should Work

### 6.1 Header

```
← Apps     [AppIcon 40px]  Safari                          [Today] [7d] [30d]
                            BROWSING  ← small category pill
```

- Back arrow navigates back to apps list — currently navigates via `setSelectedApp(null)`. This is fine as a local state toggle, but the back arrow must be explicit and styled as navigation, not a close button.
- App icon at 40px with category pill below name
- Range selector stays in the same app context (already implemented)

### 6.2 Section: Role summary

Current `buildCharacterSummary()` output already produces good copy. Example:

> You use Safari mostly for AI tools, documentation, and research — often inside longer prompt-writing and development workflows. In the evenings it shifts more toward video and lighter browsing.

**Render this as the hero paragraph,** not inside a bordered card with a "1h 45m total · 44 sessions · avg 2m" stat line above it. The stat line is wrong as a hero metric. Replace it with:

```
[1h 45m]  this week  ·  research-heavy  ·  usually paired with Ghostty
```

One compact line of metadata, then the narrative paragraph.

### 6.3 Section: Key artifacts (most important section)

For browsers — top sites and pages:

```
TOP SITES
  ChatGPT                  1h 7m  ·  35 visits
    Prompt improvement and AI workflow support
  Anthropic                  2m  ·  1 visit
  Toggl                      1m  ·  8 visits
```

- Domain name bold, time right-aligned
- If a useful page title exists under the domain (from `website_visits`), show it in muted 12px
- Make domain names **clickable** — opening the URL is the right action
- Hover state should show an underline + cursor pointer

For IDE/development apps (future, when data available):
- Show top repo names or project paths from window titles
- Group by inferred project

For document apps (Word, Excel, PowerPoint):
- Show file names extracted from window titles
- Group by inferred project or client if possible

### 6.4 Section: Patterns over time

Show 2–3 lines maximum. Use `todHeatmap()` output from Apps.tsx to derive:

```
Most active: afternoons and evenings
Usually paired with: Ghostty, Cursor
Session character: frequent, short visits (avg 2m)
```

Do not render a session timeline ledger. Do not show individual sessions by default.

### 6.5 Section: Appears in work blocks

A compact list of the 3–5 work blocks this app contributed to, linking back to the timeline:

```
APPEARS IN
  Mon Apr 13 · 12:00–2:30pm  Prompt Improvement via ChatGPT      1h 7m
  Mon Apr 13 · 2:30–3:00pm   Daylens Site Review & AI Prompt Work  30m
```

Clicking a row should navigate to `/timeline?date=2026-04-13` and ideally highlight that block (can be handled via a `#blockId` hash or query param in a later phase).

### 6.6 What to remove from app detail

- "44 sessions · avg 2m" as hero metrics
- Large banner badges ("HIGH CONTEXT SWITCHING")
- "Distraction pattern" label visible in screenshots for Spotify — this is a judgment the product should not make loudly. If the data supports it, show the pattern neutrally (e.g. "short-burst visits, usually between other tasks")
- The raw session table as primary content
- "EXPLORE ON WEB APP ↗" link — web companion is secondary, not a CTA inside app detail

---

## 7. How AI Should Fit into the Architecture

The AI screen (`/insights` route, "AI" nav label) should not open to a blank chat box.

### 7.1 Target layout

```
Today  /  This week                                [range selector]
──────────────────────────────────────────────────────────────────
[Generated summary]

Monday April 13, 2026

You spent about 2.5 hours on AI and research workflows —
mostly prompt improvement work in ChatGPT, with some review
of the Daylens site copy. The day was light on development
but the blocks were coherent and purposeful.

──────────────────────────────────────────────────────────────────
OBSERVATIONS

  › How many hours on client X this week?
  › What repeated most today?
  › When did focus break down?

──────────────────────────────────────────────────────────────────
[Type a question about your day or week…]
```

### 7.2 Screen states

**State 1 — no AI key configured:** Show a brief setup prompt. "To enable AI summaries, add an API key in Settings → AI." One action link, no blank screen.

**State 2 — AI key configured, no data yet:** Show "Not enough data tracked yet. Check back after a full day of activity."

**State 3 — data present, no summary generated yet:** Show a "Summarize my day" button. On click, trigger `ipc.ai.*` to generate the block insight summary.

**State 4 — summary generated:** Show the full layout above.

### 7.3 What the AI can use

The existing `insightsQueryRouter.ts` already routes queries to DB. The AI already has access to:
- `work_context_observations` (stored block insights)
- `app_sessions`
- `website_visits`
- `ai_conversations` + `ai_messages`

The frontend's job is to ensure:
1. The screen does not open empty
2. Proactive observations are surfaced as clickable follow-up starters, not just as static text
3. The conversational input stays at the bottom of the layout

### 7.4 Architecture note (no backend changes required now)

The AI screen does not require backend changes for Phase 1. The synthesis layer can be assembled from existing IPC calls: load `WorkContextBlock[]` for the day/week, call `ipc.ai.generateBlockInsight()` for each block, then compose a paragraph-level summary in the renderer. This avoids a new IPC endpoint for now and exercises the existing AI plumbing.

---

## 8. How Settings Should Be Cleaned Up

### 8.1 Remove Focus goal from Settings

Any settings rows referencing "Focus Goal" or "Focus streak" should be removed. They belong to the old product architecture.

### 8.2 Target settings structure

```
General
  Theme (Light / Dark / System)
  Launch at login
  Analytics opt-out

Calendar & Timeline
  Activity recording toggle
  Grouping mode (Dynamic / Fixed)
  Idle detection threshold
  Calendar integration

Idle
  Idle timeout
  Idle handling behavior

Reminders
  Daily review reminders
  Weekly summary reminders

Autotracker
  Category overrides (app by app)
  Distraction rules

Shortcuts
  (keyboard shortcuts if any)

Account
  Web companion sync
  Data export
  Reset onboarding

AI
  Provider selection
  API key input
  Model selection
```

### 8.3 Remove

- "Focus Goal" section
- "Snap initial location" / "Snap duration" settings (these reference drag-to-create behavior which does not exist in Windows per memory note)
- "EXPLORE ON WEB APP ↗" call-to-action from the main settings page
- The "External calendars" row that says "only available through the web app" — if it's unavailable, hide it rather than showing a disabled row

### 8.4 Visual cleanup for Settings

- `SectionLabel` component: reduce letter-spacing from 0.2em to 0.12em. The current value is very heavy.
- Use 11px rather than 10px for section label font size — it is slightly more readable
- `SettingsRow`: reduce padding to 12px top/bottom (currently 14px based on typical usage) — this makes the page less list-heavy
- Icons next to section labels should be consistent. Currently there are no icons on sections — this is fine. Don't add icons just to have them unless all sections have a meaningful one.
- Remove the "Debug / Diagnostics" section from the visible settings surface. This should be a hidden panel accessible via a keyboard shortcut or dev mode flag, not a standard settings section.

---

## 9. Files and Components That Need to Change

### 9.1 Files to modify

| File | Change |
|---|---|
| `src/renderer/App.tsx` | Remove `/focus` and `/history` routes. Add `/ai` alias or keep `/insights` for AI route. |
| `src/renderer/components/Sidebar.tsx` | Reduce width to 190px. Replace Focus button+timer with icon-only trigger + duration popover. Remove timer countdown, session label row, and full-width stop button. |
| `src/renderer/views/Timeline.tsx` | Migrate `view` and `selectedDate` to URL search params. Rewrite WeekView columns to proportional mini-strips. Fix status strip copy. Add click-through from week day to day view. Fix block accent stripe. Fix live time indicator. |
| `src/renderer/views/Apps.tsx` | Rewrite app list row layout. Remove "AI suggests" prefix. Replace session count/avg with character summary. Fix app detail header metrics. Add artifacts section. Add "appears in work blocks" section. |
| `src/renderer/views/Settings.tsx` | Remove Focus Goal section. Remove snap settings. Fix section label sizing. |
| `src/renderer/views/Insights.tsx` → rename to `AI.tsx` | Rewrite to show proactive summary. Remove empty chat first-state. Add day/week toggle at top. |
| `src/renderer/components/AppIcon.tsx` | Add colored initial-letter circle fallback when icon load fails. |

### 9.2 Files to remove

| File | Reason |
|---|---|
| `src/renderer/views/Focus.tsx` | Focus is not a destination. Route removed. |
| `src/renderer/views/History.tsx` | Merged into Timeline. |
| `src/renderer/views/Today.tsx` | Merged into Timeline. |
| `src/renderer/components/history/TimelineDayView.tsx` | If the day view logic is already in `Timeline.tsx`, this file may be orphaned. Audit first — if it is still imported anywhere, migrate its logic to Timeline.tsx and delete. |

### 9.3 New components to create

| Component | Purpose |
|---|---|
| `src/renderer/components/timeline/WeekStrip.tsx` | The 7-column week layout with `DayCell` sub-component (accepts `compact` prop for future month view) |
| `src/renderer/components/timeline/BlockPopover.tsx` | Extract the existing inline popover into its own component — it is currently inline in `Timeline.tsx` and hard to maintain |
| `src/renderer/components/timeline/GapRegion.tsx` | Compressed gap/idle region rendering (8px or 16px band with duration label) |
| `src/renderer/components/apps/AppRow.tsx` | The list row for a single app in the apps list — extract from Apps.tsx |
| `src/renderer/components/apps/AppArtifacts.tsx` | The "Key artifacts" section for app detail |
| `src/renderer/components/apps/AppWorkBlocks.tsx` | The "Appears in work blocks" section for app detail |
| `src/renderer/components/sidebar/FocusPopover.tsx` | Duration selection popover triggered by the icon-only Focus button in the sidebar |
| `src/renderer/hooks/useKeyboardNav.ts` | Shared keyboard navigation hook — registers arrow key, Escape, Enter handlers, disabled when input focused |

### 9.4 State management note

The current pattern — each view uses local `useState` / `useEffect` + IPC polling — is adequate for this product's scope. Do not introduce a global state manager (Zustand, Redux, etc.) for this phase. The one exception is `selectedDate` and `view` in Timeline, which must be in the URL so navigation works correctly.

---

## 10. Recommended Implementation Order

### Phase 1 — Foundation and Navigation (do first)

**Goal:** Fix broken navigation state, eliminate dead routes, establish clean sidebar.

1. **Remove dead routes** from `App.tsx`: delete `/focus`, `/history`. Redirect `/history` → `/timeline`. Keep `/focus` redirect to `/timeline` for notification taps.
2. **Remove `Focus.tsx`, `History.tsx`, `Today.tsx`** — audit imports first, then delete.
3. **Audit `TimelineDayView.tsx`** — if it is unused, delete it. If it still provides logic, absorb into Timeline.tsx.
4. **Migrate Timeline state to URL params**: change `view` and `selectedDate` from `useState` to `useSearchParams`. This fixes the back-navigation bug where clicking into a day from the week view loses the week context.
5. **Sidebar width**: change 220 → 190px. No other sidebar changes needed yet.

### Phase 2 — Timeline Day View Polish

**Goal:** Make the day view look and feel like the core product.

6. **Fix AppIcon fallback**: add initial-letter circle fallback in `AppIcon.tsx` using category color.
7. **Block accent stripe**: add 3px left border in category color, set background fill to 8% opacity.
8. **Gap compression**: implement variable-density grid layout (Section 3.6). Convert absolute-positioned blocks to sequential layout with compressed gap regions. This is the hardest change in Phase 2 — do it before the visual polish steps so the layout model is settled.
9. **Activity lane wrapper**: wrap block rendering area in a flex container with an `activity-lane` div (Section 3.8). Zero visual change now, enables future calendar overlay.
10. **Block merging**: detect adjacent blocks with identical labels and <5min gaps. Render as single block with internal time divider (Section 3.7).
11. **Live time indicator**: replace full-width orange line with a hairline + dot.
12. **Status strip copy**: change "11% focused" to block count. Improve live-app display.
13. **Filter pills**: simplify to actual categories. Remove "Focus Work" pill.
14. **Extract `BlockPopover.tsx`**: move the popover to its own component and clean up the content structure (narrative as paragraph, confidence as subtle label).
15. **Empty state**: add the "Nothing tracked yet on this day" state.
16. **Keyboard navigation (day view)**: add `useKeyboardNav` hook — Escape to close popover, left/right arrows for day navigation, up/down arrows for block selection, Enter/Space to open popover (see Appendix C).

### Phase 3 — Timeline Week View Rebuild

**Goal:** Make the week view useful and navigable.

17. **Create `WeekStrip.tsx`** with `DayCell` sub-component: render 7 columns with proportional bars, color from top category, day label, date number, total time below each column. `DayCell` accepts `compact: boolean` prop for future month view reuse (Section 4.6).
18. **Click-through**: clicking a day column sets `view=day&date=YYYY-MM-DD` in URL params.
19. **Today indicator**: blue dot under today's date number.
20. **Hover tooltip**: show top block title + total time on day hover.
21. **Week summary panel**: clean up "Heaviest day / Best focus / Total" to include "Main activity" line.
22. **Keyboard navigation (week view)**: left/right arrows for week navigation, up/down to select day column, Enter to drill into selected day.

### Phase 4 — Apps List Redesign

**Goal:** Make apps informative at a glance.

23. **Rewrite `AppRow.tsx`**: app name + character summary line + top domains line. Remove "AI suggests" prefix. Remove session count/avg.
24. **Fix time display**: show total duration in clear text, not a thin bar.
25. **Category grouping**: add optional group headers (Development, AI Tools, Browsers, etc.) when app count > 8.
26. **Keyboard navigation (apps)**: up/down to move between rows, Enter to open detail, Escape to return to list.

### Phase 5 — App Detail Redesign

**Goal:** Make app detail answer "what do I actually do in this app?"

27. **Header redesign**: replace session count hero with one-line metadata + narrative paragraph hero.
28. **Key artifacts section**: top sites with visit context, clickable domains, useful page titles.
29. **Patterns section**: 2–3 lines from `todHeatmap()` and character data.
30. **Appears in work blocks**: link to timeline blocks via `/timeline?date=YYYY-MM-DD&block=blockId`.
31. **Remove noise**: large stat badges, session table as hero, "Distraction pattern" label.

### Phase 6 — AI Screen Rebuild

**Goal:** Make AI feel like an active analyst, not an empty chatbox.

32. **Rewrite `Insights.tsx` (AI screen)**: add day/week toggle, generated summary on load, proactive observation chips, conversational input at bottom.
33. **Handle key-not-configured state**: brief setup prompt, not blank screen.
34. **Handle no-data state**: purposeful message.

### Phase 7 — Settings Cleanup

**Goal:** Remove stale settings and improve visual density.

35. **Remove Focus Goal section**.
36. **Remove snap settings** (snap initial location, snap duration).
37. **Remove unavailable external calendars row**.
38. **Fix `SectionLabel` typography**: 0.12em spacing, 11px.
39. **Move debug panel** to hidden dev mode.

### Phase 8 — Sidebar Focus Redesign

**Goal:** Replace the current Focus button/timer with the icon-only popover pattern.

40. **Replace Focus button** in `Sidebar.tsx`: icon-only `IconFocusSmall` button (14px), no label text.
41. **Build Focus duration popover**: 200px anchored popover with preset chips (25m, 50m, 90m), optional label input, Start button.
42. **Active session display**: red-tinted stop icon, inline countdown next to live app name ("Safari · 23:41 left"), no progress ring or stats.
43. **Remove** full-width Focus button, timer countdown display, session label row, and stop button expansion from the current sidebar strip.

---

## Appendix A: Visual Language Constraints

These apply across all screens:

- **Color**: category colors are established in `CATEGORY_COLORS` / `CAT_COLORS` maps. Use them consistently. Do not introduce new accent colors outside this system.
- **Typography**: 13px is the body default. Use 12px for secondary/muted. Use 11px only for tertiary labels. Do not use 10px for any user-facing content.
- **Block fills**: 8–12% opacity on colored backgrounds. 3–4px solid accent border on left edge.
- **Cards/panels**: use `var(--color-surface-container)` with `var(--color-border-ghost)` borders. Do not introduce new border styles.
- **Density**: 8–12px vertical padding inside rows. 3–4px gap between nav items (already correct in Sidebar).
- **No streak mechanics, no score gauges, no "KEEP GOING" CTAs** anywhere in the redesigned UI.
- **No emoji in UI** — the product should feel professional and calm, not casual. The existing codebase uses no emoji in UI and that should be preserved.

---

## Appendix B: IPC Calls Per View (Renderer Architecture Reference)

| View | Key IPC calls used |
|---|---|
| Timeline (day) | `ipc.db.getHistoryDay(dateStr)` → `HistoryDayPayload` (blocks + sessions + sites) |
| Timeline (week) | `ipc.db.getWeeklySummary(weekStart)` — returns per-day summaries |
| Apps list | `ipc.db.getAppSummaries(days)` + `ipc.tracking.getLiveSession()` |
| App detail | `ipc.db.getAppSessions(bundleId, days)` + `ipc.db.getAppCharacter(bundleId, days)` + `ipc.db.getWebsiteSummaries(days, bundleId)` |
| AI screen | `ipc.db.getHistoryDay(today)` + `ipc.ai.generateBlockInsight(blockId)` + `ipc.ai.sendMessage(msg)` |
| Settings | `ipc.settings.get()` / `ipc.settings.set(partial)` |

No new IPC endpoints are required for Phases 1–5. Phase 6 (AI) may benefit from a new `ipc.ai.generateDaySummary(dateStr)` endpoint but can be assembled from existing endpoints in the renderer as a first pass.

---

## Appendix C: Interaction Patterns

### Transitions and animations

Global policy: **150–200ms ease-out for all state transitions.** No spring physics, no staggered animations, no bounce effects. The app should feel responsive and precise, not playful.

| Interaction | Duration | Easing | Notes |
|---|---|---|---|
| Day ↔ Week toggle | 180ms | ease-out | Cross-fade content, no slide |
| Block popover open | 150ms | ease-out | Fade-in + slight scale from 0.97 → 1.0 |
| Block popover close | 120ms | ease-in | Faster close than open — standard for dismissals |
| App list → app detail | 180ms | ease-out | Content swap, back arrow appears |
| Sidebar nav item hover | 180ms | ease-out | Already correct in current `Sidebar.tsx` (`transition: 'all 180ms'`) |
| Week day column hover | 120ms | ease-out | Tooltip fade-in |
| Focus popover open/close | 150ms | ease-out | Same as block popover |
| Filter pill selection | 100ms | ease-out | Background color change, fast |

Do not animate:
- Route transitions (timeline → apps → AI) — instant swap
- Scroll position — native scroll only
- Data loading states — show content immediately when available, no skeleton shimmer

### Keyboard navigation

This is a desktop Electron app. Keyboard support is expected.

**Phase 2 additions (timeline):**

| Key | Context | Action |
|---|---|---|
| `Escape` | Popover open | Close popover |
| `Escape` | Focus popover open | Close focus popover |
| `←` / `→` | No popover open, day view | Navigate to previous/next day |
| `←` / `→` | No popover open, week view | Navigate to previous/next week |
| `↑` / `↓` | No popover open, day view | Move selection to previous/next block (highlight border) |
| `Enter` / `Space` | Block highlighted | Open popover for highlighted block |
| `T` | Timeline view | Jump to today |

**Phase 4 additions (apps):**

| Key | Context | Action |
|---|---|---|
| `Escape` | App detail open | Return to apps list |
| `↑` / `↓` | Apps list | Move highlight between app rows |
| `Enter` | App row highlighted | Open app detail |

**Implementation:** Use a `useKeyboardNav` hook that registers event listeners on the view container. The hook should be disabled when an input field is focused (e.g., AI chat input, search field). Use `event.key` checks, not `keyCode`.

### Drag-to-select on timeline

**Status: Deferred. Not in any current phase.**

The product vision says "it should support drag-to-select areas if needed, but that should not be the main behavior." Per the existing memory note, drag-to-create does not exist on Windows and the snap settings are being removed.

Drag-to-select (selecting a time range to ask "what happened here?") is a different interaction from drag-to-create (creating a new block). The select variant is useful and aligns with the product vision, but it requires:

1. A mouse-down → drag → mouse-up gesture handler on the grid
2. A visual selection overlay (blue tinted band across the selected time range)
3. A contextual action: either "Summarize this range" (triggers AI) or "Create block from selection" (requires backend merge API)
4. Conflict resolution when dragging across existing blocks

This is meaningful work and should not be mixed into the core layout phases. **Target: Phase 8 or later**, after the AI screen is functional and can receive time-range queries.

---

## Appendix D: Glossary of Key Codebase Symbols

For implementation reference — these are the key types, functions, and constants that the frontend plan references:

| Symbol | File | Purpose |
|---|---|---|
| `WorkContextBlock` | `shared/types.ts` | The primary block type: startTime, endTime, dominantCategory, topApps, websites, keyPages, aiLabel, ruleBasedLabel |
| `WorkContextInsight` | `shared/types.ts` | AI-generated insight for a block: label, narrative, confidence |
| `HistoryDayPayload` | `shared/types.ts` | Return type of `getHistoryDay()`: blocks + sessions + sites for one day |
| `AppUsageSummary` | `shared/types.ts` | Per-app summary: bundleId, appName, category, totalSeconds, sessionCount |
| `AppCharacter` | `shared/types.ts` | App usage character: deep_focus, flow_compatible, context_switching, distraction, communication |
| `CATEGORY_COLORS` | `Timeline.tsx` | Hex color map for all 14 `AppCategory` values |
| `blockLabel()` | `Timeline.tsx` | Prioritized label resolution: AI label → rule-based → sites → apps → category |
| `blockNarrative()` | `Timeline.tsx` | Generates a one-line narrative: duration + tools + key page |
| `buildCharacterSummary()` | `Apps.tsx` | Generates a narrative paragraph about how the user uses a specific app |
| `PX_PER_MIN` | `Timeline.tsx` | Currently `2.0` — controls proportional block height (120px/hr) |
| `MIN_BLOCK_HEIGHT` | `Timeline.tsx` | Currently `24` — minimum rendered height for any block |
| `FOCUSED_CATEGORIES` | `shared/types.ts` | Categories that count as "focused": used for focus percentage calculation |
