> ⚠️ **SUPERSEDED — council process artifact (Round 1/2). Do NOT use for implementation.**
> The canonical, assembled plan is [`../DAYLENS-V2-PLAN.md`](../DAYLENS-V2-PLAN.md). Kept for provenance only.

# Daylens v2 Plan — gemini

## Problem Statement
Daylens aims to be an automatic work memory for your laptop, providing a trusted calendar of actual work, daily/weekly recaps, and an AI that can answer questions about past work. However, the current app fails this vision because the foundation—the tracked timeline—is untrustworthy. It miscategorizes blocks (e.g., coding labeled as entertainment), fragments sessions, and associates incorrect app durations. Because the core data is broken, all upstream surfaces fail: the morning and evening briefs show irrelevant or incorrect slideshows instead of focused carryover tasks; the AI Q&A hallucinates or refuses to answer questions about past work; and the weekly wraps are plagued by missing data and UI bugs. The user cannot trust the app's output.

## Solution
Daylens v2 is the realization of the PMF vision: a scrollable, accurate calendar of what was actually done, paired with concise, honest morning and evening briefs, and an AI that accurately answers questions about past activity based on trusted timeline data. v2 is reached by fixing block segmentation and labeling, ripping out the verbose carousel wraps in favor of minimal, useful cards (1 screen for morning, max 5 for evening), and ensuring the AI, wraps, and Timeline all read from the same ground-truth facts.

## Feature map (Should vs Now)

| Feature | Should (v2) | Now (today) | Status | Evidence (screenshot / app) |
|---|---|---|---|---|
| **Capture & Tracking** | | | | |
| Activity → time blocks | Sensible boundaries; clear breaks; one work stretch = one block | Arbitrary splits; 50 blocks/day; huge untracked gaps (8h+); same session fragmented | broken | timeline-today-*, founder |
| Block boundaries | Know what to group vs separate (app focus, not 42s Netflix in Cursor block) | 42s Netflix drives ENTERTAINMENT label on Cursor coding block | broken | timeline-today-cursor-block-tagged-entertainment.png |
| Block naming | Title = what you were doing (project, app, meeting, doc) | "Development", "Untitled block", raw URLs, page titles ("iPhone 12 Wi", "https://x.com") | broken | timeline-*, apps-7d-safari-named-development.png, founder |
| Block categories (kind) | Category matches dominant activity | Claude Code block tagged BROWSING; UniFi split BROWSING vs DEVELOPMENT; ENTERTAINMENT on coding | broken | timeline-today-afternoon-duplicate-development-blocks.png |
| Merge down | Merge with clear visual confirmation | Works technically; **no UX feedback** unless you look closely | broken | timeline-today-merge-down-fix-episode-panel.png, founder |
| Rename block | Rename sticks and updates list + panel | Rename UI exists; names still often wrong after | untrusted | timeline-today-merge-down-fix-episode-panel.png |
| Hide block | Hide noise from timeline | Hide button exists | UNVERIFIED — needs live test | timeline-today-merge-down-fix-episode-panel.png |
| Duration accuracy | List duration = detail duration = sum of apps | 37m list vs 21m panel; block span vs "spent Xm" text disagree | broken | timeline-today-duration-mismatch-37m-vs-21m.png, timeline-today-afternoon-duplicate-development-blocks.png |
| Untracked gaps | Minimize; explain when capture paused | Large gaps shown as single line | broken | timeline-today-*, timeline-day-jun16-* |
| System noise capture | Skip loginwindow, UserNotificationCenter as meaningful "apps" | loginwindow 16h–50h tracked as activity | broken | apps-7d-loginwindow-empty-without-ai.png, settings-labels-* |
| Tracking exclusions | Exclude apps/sites user lists | UI exists; exclusions empty — still tracks everything | partial | settings-tracking-exclusions-privacy.png |
| Incognito skip | Private windows not recorded | Toggle on | UNVERIFIED — needs live test | settings-tracking-exclusions-privacy.png |
| Session counts | Reasonable session count per app | Safari 5977 sessions / 7d — feels inflated | untrusted | apps-7d-safari-named-development.png |
| Live block indicator | Show what is currently tracking | Missing | missing | founder |
| Delete domain / page | Delete unwanted data | Trash icon exists | UNVERIFIED — needs live test | apps-7d-safari-pages-visited-list.png |
| **Timeline / calendar** | | | | |
| Day timeline | Scrollable reality calendar with proof | Renders but labels/categories/durations untrusted | broken | timeline-day-jun16-reanalyze-shape-of-day.png, founder |
| Day stats bar | Accurate totals | Shows 7h38m / 50 blocks — built on bad blocks | untrusted | timeline-today-* |
| Episode detail panel | Apps used + artifacts match block story | Artifacts contradict title (Netflix vs Cursor) | broken | timeline-today-duration-mismatch-37m-vs-21m.png |
| Shape of the day | Honest focus/drift/mattered from trusted blocks | Exists but wrong inputs → wrong synthesis | broken | timeline-day-jun16-reanalyze-shape-of-day.png |
| Re-analyze with AI | Uses **Settings model**; refreshes day synthesis | Shows "Re-analyzing…"; founder: uses **Gemini** not Claude Haiku | broken | timeline-day-jun16-*, settings-ai-claude-haiku-connected.png, founder |
| Week view chart | Colored breakdown **with legend**; all days with data or clear why not | Colors, no legend; Thu–Sun "No data" | broken | timeline-week-jun15-21-no-data-checking-review.png |
| Week stats | Week total consistent everywhere | Review text 20h53m vs card 20h7m | broken | timeline-week-jun15-21-review-hours-mismatch.png |
| Week review generate | Recap you'd open | "No saved review" / "Checking…" / Generate; quality untrusted when exists | broken | timeline-week-jun8-14-no-saved-review.png, timeline-week-jun1-7-week-review-generated.png |
| Week day rows | Preview blocks + open day | Shows "Untitled block"; Open day works | partial | timeline-week-jun1-7-untitled-block-legend.png |
| Main mode stat | Reflects actual work mode | "Main mode: Entertainment" while user is founder/dev | untrusted | timeline-week-jun1-7-*, timeline-week-jun15-21-* |
| Day / Week / Today toggles | Consistent data across views | Week works somewhat; day-level issues worse | partial | founder, timeline-*, apps-* |
| **Apps view** | | | | |
| Period toggles | Same app correct across all periods | **7d/30d work; daily often empty/wrong** | broken | founder, apps-* |
| App list naming | Real app name prominent (Safari, Cursor, Dia) | Bold title "Development" or "Claude" for unrelated apps | broken | apps-7d-safari-named-development.png, apps-7d-dia-wrong-domain-attribution.png |
| App subtitle | Bundle/app name + time + sessions | Subtitle correct sometimes; title wrong | broken | apps-* |
| Detail without Generate | Time, domains, pages without AI | Loginwindow: nearly empty — "needs more context" | broken | apps-7d-loginwindow-empty-without-ai.png, founder |
| Generate summary | Accurate AI blurb for period | Text exists; duplicate "Netflix, Netflix"; long raw titles | broken | apps-7d-safari-named-development.png |
| Time by domain | Domains under correct app | Netflix/YouTube under Dia "Development" AI tool | broken | apps-7d-dia-wrong-domain-attribution.png |
| Pages visited | Clean list, deduped | Duplicates (netfilm.world); trash icon on every row | broken | apps-7d-safari-pages-visited-list.png, apps-30d-browsing-* |
| Often used with | Related apps co-occurrence | Section works on some views | partial | apps-7d-unifi-server-detail.png |
| Category filter pills | Filter list by category | Pills render | UNVERIFIED — needs live test | apps-7d-safari-named-development.png |
| Entertainment in work view | Separate or de-emphasize drift | YouTube/Netflix dominate Safari 119h | untrusted | apps-30d-safari-119h-domains.png |
| **AI tab / Q&A** | | | | |
| Ask about today | Answer from your history with times | Fails — no tool results; asks user to paste getDaySummary | broken | ai-todays-work-no-tool-results.png |
| Ask about week / projects | Project-attributed summary | No projects; inferred from block labels only | broken | ai-7-days-by-project-summary-no-projects.png |
| Detail on request | Deeper breakdown with structure | More prose/bullets, still no tables | broken | ai-7-days-detail-bullets-not-table.png, ai-7-days-detailed-day-breakdown.png |
| Tables for tabular data | Use tables when appropriate | Wall of text only | broken | ai-7-days-summary-prose-no-tables.png, founder |
| Turn into… transforms | Shorter, checklist, bullets, report work | Refuses or fails when base answer broken | broken | ai-todays-work-turn-into-bullets-fails.png |
| Response voice | Chief-of-staff who knows your day | Apologetic, meta, asks user to do app's job | broken | ai-todays-work-*, founder |
| Chat sidebar persistence | History survives tab switches | **Gone after Apps → AI**; empty mid-generation | broken | ai-new-chat-empty-sidebar.png, ai-chat-sidebar-with-history.png, founder |
| Switch chat during generation | Safe switch or clear loading state | Breaks: empty chat, no sidebar, input disabled | broken | founder |
| Input during generation | Usable or clearly blocked | Disabled / broken during generation | broken | founder |
| Model from Settings | All AI uses selected model | Header shows Claude; re-analyze uses Gemini | broken | settings-ai-claude-haiku-connected.png, founder |
| Thinking / loading state | Clear progress | "Thinking" with no cancel clarity | partial | ai-summarize-7-days-thinking-state.png |
| Suggested prompts | Quick starts that work | Shown on empty state | partial | ai-new-chat-empty-sidebar.png |
| Search chats ⌘K | Find past chats | UI present | UNVERIFIED — needs live test | ai-chat-sidebar-with-history.png |
| Export CSV prompt | Export sessions | Suggested prompt exists | UNVERIFIED — needs live test | ai-new-chat-empty-sidebar.png |
| **Settings & configuration** | | | | |
| AI provider + model | One provider; all surfaces honor model | Claude Haiku set; not used by re-analyze | broken | settings-ai-claude-haiku-connected.png, founder |
| Clients / projects | Named clients; AI attributes work | UI empty — no clients | missing | settings-labels-*, settings-notifications-* |
| Per-app labels | Override wrong auto-labels | Overrides exist (Dia→Browsing) but list still wrong in Apps/Timeline | broken | settings-labels-per-app-and-clients.png |
| Work memory / patterns | Patterns improve naming & attribution | 19 patterns; identical 65% confidence; blocks still Untitled | broken | settings-work-memory-learned-patterns.png, founder |
| Rebuild memory | Rebuild from history helps | Button exists; outcome not visible | UNVERIFIED — needs live test | settings-work-memory-learned-patterns.png |
| Consolidate end of day | Archives, promotes, decays | Toggle on; no visible product improvement | untrusted | settings-work-memory-learned-patterns.png |
| Morning / evening notifications | Briefs delivered | Toggles on; content not verified | UNVERIFIED — needs live test | settings-notifications-clients-appearance.png |
| MCP server | Optional external query of local data | Enabled with dev paths | partial | settings-mcp-server-enabled.png |
| Profile name | Used in AI persona | "tonny" set | UNVERIFIED — needs live test | settings-ai-claude-haiku-connected.png |
| Theme / appearance | Customization options | Not cataloged | UNVERIFIED — needs live test | — |
| App updates flow | Update app versions | Not cataloged | UNVERIFIED — needs live test | — |
| **Wraps & briefs** | | | | |
| Morning brief | Yesterday's open loops → today's pickup | Carousel instead of 1 screen | broken | daylens-PMF |
| Evening wrap | Honest end-of-day recap | 8-slide carousel instead of 5 cards max | broken | daylens-PMF |
| Daily wrap | Narrative in timeline side panel | Shape of day attempts; untrusted | untrusted | timeline-day-jun16-* |
| Weekly wrap | Week review worth opening | Generate exists; data/consistency issues | broken | timeline-week-* |
| Monthly wrap | Month patterns | Not in screenshots | UNVERIFIED — needs live test | daylens-PMF |
| Annual wrap | Year narrative | Not built; defer | UNVERIFIED — needs live test | daylens-PMF |
| Notifications delivery | Content of morning/evening brief | Not verified in app | UNVERIFIED — needs live test | daylens-PMF |
| Distraction alerts + threshold | Alert user of distraction | Unknown | UNVERIFIED — needs live test | daylens-PMF |
| **Onboarding & trust** | | | | |
| First-run / permissions | Clear capture + value prop | Not documented | UNVERIFIED — needs live test | — |
| Trust bar | Stake a client answer on timeline/AI | Cannot | broken | all sections |

---

## How each feature should work

### 1. Capture & Tracking
* **Should**: Group continuous work on the same task into a single block (e.g., 2 hours in Cursor coding). Do not fracture blocks because of quick, brief context switches. A 42-second excursion to Netflix or Slack must be counted as "drift" but *never* change the main block category to ENTERTAINMENT or fragment the coding session.
  * *Example*: User codes in Cursor from 09:00 to 11:00 with brief 30s Slack replies. The timeline records one continuous 2-hour "Coding" block with a "96% focus" detail.
* **Now**: 42s of Netflix changes the category of a Cursor coding block to ENTERTAINMENT. Sessions are fragmented into dozens of small blocks per day with unexplained gaps.
  * *Screenshot*: `timeline-today-cursor-block-tagged-entertainment.png`, `timeline-today-afternoon-duplicate-development-blocks.png`
* **Gap**: The timeline foundation is broken and untrusted. Upstream summaries are filled with wrong kinds and categories.
* **Fix**: Re-implement block aggregation in `workBlocks.ts`. Introduce a higher context-switch duration threshold (e.g., minimum 5 minutes of continuous alternative activity) before triggering a category shift or block split.

### 2. System Noise Capture
* **Should**: Silently drop system background processes (`loginwindow`, `UserNotificationCenter`, `Finder`, screensavers) from the timeline and app list aggregates.
  * *Example*: User locks their screen overnight. The app registers idle time or drops the activity, but never surfaces a 16-hour `loginwindow` entry in the "Apps" view.
* **Now**: `loginwindow` registers 16h to 50h of activity, cluttering the app list and summaries.
  * *Screenshot*: `apps-7d-loginwindow-empty-without-ai.png`
* **Gap**: Flaws metrics and wastes AI context slots.
* **Fix**: Hardcode a process/bundle filter in `tracking.ts` or `workBlocks.ts` that immediately drops system noise apps from timeline block ingestion.

### 3. Duration Accuracy
* **Should**: Ensure all numbers display consistently across all UI panes. The duration of the block in the left sidebar list, the duration in the detail panel, and the sum of app sessions in the evidence breakdown must agree.
  * *Example*: A block showing "37m" in the sidebar list shows "37m" in the detail panel and the inner app times sum to exactly 37m.
* **Now**: Disagreements like 37m list vs 21m panel or blocks that span 1h but report only 15m active time with no clear reason.
  * *Screenshot*: `timeline-today-duration-mismatch-37m-vs-21m.png`
* **Gap**: Direct mathematical contradictions destroy the user's trust.
* **Fix**: Force all UI components to derive block durations from a single source-of-truth function (`blockActiveSeconds` or sum of session durations) rather than separate frontend/backend calculations.

### 4. Timeline (Day & Week Views)
* **Should**: Scrollable timeline representing the actual day. The week view must include a color legend matching categories, and all stats cards (total tracked hours, main mode) must be mathematically consistent with day details. Re-analysis of the day must respect the selected AI model from settings.
  * *Example*: Tapping "Re-analyze" calls Claude Haiku (if connected) and updates the daily shape of the day narrative. The weekly view shows a clear legend with "Development", "Entertainment", "Meetings".
* **Now**: No legend on week chart; days Thu-Sun display "No data" even when data exists; weekly totals mismatch (20h53m review text vs 20h7m card); re-analyze forces Gemini.
  * *Screenshot*: `timeline-week-jun15-21-no-data-checking-review.png`, `timeline-day-jun16-reanalyze-shape-of-day.png`, `timeline-week-jun15-21-review-hours-mismatch.png`
* **Gap**: Broken reporting makes long-term tracking and billing verification impossible.
* **Fix**: Add a legend component to `Timeline.tsx`. Ensure week summaries query the SQLite DB using consolidated aggregation helpers. Pass the selected settings model parameter during day re-analysis IPC calls.

### 5. Apps View
* **Should**: Group activities by their actual application display names (e.g. "Safari", "Cursor", "Dia") rather than loose category labels like "Development". Nest visited domain URLs correctly under the parent browser. Deduplicate identical page paths and provide a trash icon next to entries to delete sensitive browsing data.
  * *Example*: Tapping "Safari" expands to show domains (e.g. `github.com` - 2h, `youtube.com` - 30m) with clean, deduped URL structures. Tapping a trash icon permanently deletes that URL's session history.
* **Now**: Safari is named "Development"; Netflix and YouTube domains are attributed to Dia (an unrelated tool); duplicates of URLs clutter the list.
  * *Screenshot*: `apps-7d-safari-named-development.png`, `apps-7d-dia-wrong-domain-attribution.png`, `apps-7d-safari-pages-visited-list.png`
* **Gap**: Renders the application list useless for audit purposes.
* **Fix**: Rewrite the app grouping logic in `Apps.tsx` and backend resolvers. Query domain URLs exclusively from browser session schemas mapped to their browser app bundle IDs. Dedup page titles during database queries.

### 6. AI Tab / Q&A
* **Should**: Execute Q&A queries locally using the configured Settings model. The AI must execute db tool calls automatically to answer "what did I work on today?" and format tables when requested (tabular data). The chief-of-staff voice must be direct and helpful.
  * *Example*: User asks "What did I do yesterday at 3pm?" AI runs a query, fetches the block, and responds: "You were working on the Malaria ResNet50 notebook in Ghostty."
* **Now**: AI fails to run tools and asks the user to paste their own timeline summary; chat history is wiped out when tabs are switched; text is presented as long walls of prose without formatting.
  * *Screenshot*: `ai-todays-work-no-tool-results.png`, `ai-7-days-summary-prose-no-tables.png`, `ai-new-chat-empty-sidebar.png`
* **Gap**: Chat is broken and fails to serve as a conversational memory query tool.
* **Fix**: Rewrite `insightsQueryRouter.ts` tool call bindings. Force the AI prompt to mandate Markdown tables for lists. Move chat state to a global React Context or Zustand store that persists when the AI tab is unmounted.

### 7. Memory (Work Memory & Patterns)
* **Should**: Dynamically learn work pattern rules (e.g., mapping file path matches to client projects) with individual confidence scores that guide the automatic block labeler. A manual rebuild on-demand must run the aggregator over history.
  * *Example*: Rebuilding memory updates confidence metrics (e.g. Ghostty/daylens -> 95% confidence).
* **Now**: 19 patterns exist but all carry an identical 65% confidence stat, and timeline blocks still show up as "Untitled block".
  * *Screenshot*: `settings-work-memory-learned-patterns.png`
* **Gap**: Automatic categorization fails to improve over time.
* **Fix**: Repair the work memory aggregation queries in `workMemory.ts` to calculate actual match percentages and feed them into `workBlocks.ts`.

### 8. Morning Brief
* **Should**: Present a single-page view immediately upon launch or notification tap. It must include a personal greeting, a single carryover line showing yesterday's unfinished work derived from `facts.carryover[0]`, and one direct link to "See yesterday" timeline.
  * *Example*: "Good morning, Tonny. The malaria notebook was still open at 17:34 yesterday — pick it up? [See yesterday]"
* **Now**: Morning brief displays a multi-slide carousel containing category identity slides, video backgrounds, and legacy focus percentage metrics that ignore carryover.
  * *Screenshot*: `daylens-PMF`, `settings-notifications-clients-appearance.png`
* **Gap**: High friction; slideshow format hides the core "wedge" action (resuming carryover).
* **Fix**: Rewrite the morning branch of `DayWrapped.tsx` to render a single static screen. Retrieve the carryover target directly from the `WrappedFacts` payload. Delete slides 1–3 and legacy copy heuristics.

### 9. Evening Wrap
* **Should**: Present a concise, calm slideshow of at most 5 cards: (1) Day shape, (2) Work done (only if work >= 15m), (3) Time breakdown, (4) Open loop carryover (if exists), (5) Quiet sign-off. Leisure days must be condensed to 2 cards (shape + close). No distraction lectures or guilt slide metrics.
  * *Example*: A leisure day shows only: (Card 1) "A rest day — 6h of watching and browsing." (Card 2) "That's the day."
* **Now**: Evening wrap is a verbose 8-slide carousel with focus lectures and distraction graphs, even on rest days.
  * *Screenshot*: `daylens-PMF`, `settings-notifications-clients-appearance.png`
* **Gap**: Intrusive, guilt-inducing, and lacks data consistency with the daily timeline.
* **Fix**: Rewrite the evening branch of `DayWrapped.tsx` to bind strictly to `buildFallbackSlides()` and `getWrappedNarrative()` cards. Set `hasDistractionData = false` to suppress guilt slides.

### 10. Daily / Weekly / Monthly / Annual Wraps
* **Should**: Daily wrap is the side-panel text on the timeline. Weekly wrap compiles accurate aggregated statistics. Monthly/Annual wraps are deferred to v3 and remain out of scope for the current PMF wedge.
* **Now**: Weekly recaps are broken by mismatching hours, missing legends, and empty data slots.
  * *Screenshot*: `timeline-week-*`
* **Gap**: Rollups are incorrect and untrusted.
* **Fix**: Standardize week summary queries in `weeklyBrief.ts` and ensure the client receives unified counts.

### 11. Notifications
* **Should**: Deliver local notifications at configured morning/evening times. The notification body must use carryover-aware copy (e.g. nudge text) rather than generic focus percentages.
  * *Example*: "The malaria notebook is still open — pick it up?"
* **Now**: Notifications use generic focus % copy or hardcoded heuristics.
* **Gap**: Fails to drive engagement.
* **Fix**: Modify `dailySummaryNotifier.ts` to call `getWrappedNarrative()` and use `narrative.nudge` (carryover) as the primary body string.

### 12. Trust (User Edits & Integrity)
* **Should**: Allow the user to rename, split, merge, or exclude blocks. Manually modified blocks must set a `locked` flag in the DB. Automated background re-analysis and AI updates must never overwrite locked blocks.
  * *Example*: User renames "Development" block to "Daylens Planning". Re-running AI analysis leaves this block name untouched.
* **Now**: AI re-analysis can overwrite manual label modifications.
* **Gap**: Loss of edits frustrates users and breaks the billing trust bar.
* **Fix**: Add a `locked` boolean column to the `timeline_blocks` table. Skip locked records in all AI re-label and automatic grouping operations.

---

## User Stories
1. **As a founder**, I want my timeline blocks to group long programming sessions into cohesive blocks, so that my calendar shows clean work segments instead of dozens of micro-blocks.
2. **As a founder**, I want system background apps like `loginwindow` completely omitted from my tracked time, so that my active work hours aren't artificially inflated.
3. **As a consultant**, I want my block durations to match exactly between the timeline list, the detail panel, and the app sessions sum, so that I can copy them for client invoicing without doubt.
4. **As an eng lead**, I want manually edited block names to remain locked and unaffected by AI re-analysis, so that my custom categorization is never lost.
5. **As a first-time user**, I want a clear explanation during onboarding of what files and sites are tracked and the ability to verify my exclusions, so that I feel secure using the app.
6. **As a founder**, I want my morning brief to be a single screen showing exactly what open loop I left running yesterday, so that I can resume coding in one click.
7. **As a consultant**, I want my evening wrap to be a simple, 5-card calm summary of what got done, so that I can close my laptop and sign off without stress.
8. **As a founder**, I want my leisure days to show only a 2-card wrap (shape and quiet close) with zero focus scores or guilt-inducing distraction alerts, so that I can disconnect.
9. **As a consultant**, I want to ask the AI Q&A "what did I work on yesterday?" and get a clean, formatted Markdown table showing tasks and durations, so that I can update my timesheet.
10. **As an eng lead**, I want my chat sidebar history to persist when I switch to the Apps view and back, so that I don't lose the context of my current query.
11. **As a founder**, I want the week view chart to display a clear color-coded legend, so that I can see my category breakdown at a glance.
12. **As a consultant**, I want the weekly stats cards to show the same total tracked hours as the weekly review narrative text, so that my data is consistent.
13. **As a founder**, I want the re-analyze button on my timeline to use the custom Claude model I configured in settings instead of defaulting to Gemini, so that the voice matches my preference.
14. **As an eng lead**, I want my per-app label overrides (e.g. mapping Ghostty to Development) to immediately update both the Apps list and my Timeline categories, so that the tracking matches reality.
15. **As a founder**, I want morning notifications to nudge me with the specific file or thread I left open (e.g. "The malaria notebook is still open") rather than generic stats, so that it acts as a helpful reminder.

---

## Implementation Decisions

### 1. Database Schema Extensions
* **Timeline Block Locking**: Add a `locked` integer (boolean) column to the `timeline_blocks` table in `src/main/db/schema.ts` and create a migration.
  ```sql
  ALTER TABLE timeline_blocks ADD COLUMN locked INTEGER DEFAULT 0;
  ```
* Ensure `insertTimelineBlock` and `updateTimelineBlock` queries in `src/main/db/queries.ts` preserve or update this column.
* Update `workBlocks.ts` block builder to query this flag and skip re-segmentation or renaming of locked blocks.

### 2. Block Grouping & Noise Exclusion Heuristics
* **Noise Filter**: In `tracking.ts` (inside active window capture) and `workBlocks.ts` (ingestion phase), add a hardcoded denylist for system processes:
  ```typescript
  const SYSTEM_NOISE_APPS = new Set([
    'loginwindow',
    'usernotificationcenter',
    'com.apple.usernotificationcenter',
    'finder',
    'screensaverengine'
  ]);
  ```
* **Distraction Thresholds**: In `workBlocks.ts`, raise the category-shift splitting criteria. If a user is working on a block of category `development` and shifts to `leisure` (e.g., Netflix), only split or category-shift the block if the leisure session is continuous for `>= 300 seconds` (5 minutes). Short context detours must be rolled into the primary block as a `drift` attribute and not segment the block.

### 3. Front-End State Persistence (AI Chat)
* **Global Chat Context**: Create a React Context (`AIStoreContext.tsx`) or use a global store to house `conversations`, `currentConversationId`, and `streamingMessages`. Mount this provider at the root of `src/renderer/App.tsx` so that when the user switches tabs (Timeline -> Apps -> AI), the chat history is not unmounted and lost.

### 4. Wraps UI Reconstruction
* **Morning View Override**: In `DayWrapped.tsx`, conditionally render a single-page view if `isMorning` is true:
  ```tsx
  if (isMorning) {
    return (
      <div className="morning-brief-single-page">
        <h1>Good morning{userName ? `, ${userName}` : ''}.</h1>
        <p className="carryover-nudge">{facts.carryover[0] ? `${facts.carryover[0].label} was left open — resume today?` : 'Clean start today.'}</p>
        <button onClick={onOpenReport}>See yesterday's timeline</button>
      </div>
    );
  }
  ```
* **Evening View Card Limit**: For the evening view, limit slide indices strictly to the 5 calm card variants derived from `getWrappedNarrative()`. Omit focus details if `facts.kindBreakdown.isLeisureDay` is true.

---

## Testing Decisions

### 1. Timeline Evaluation Harness (`timeline:eval`)
* **Dogfood Fixture**: Export a real founder-tracking day log with mixed coding, Netflix, and meeting sessions into a new fixture: `tests/timeline-eval/fixtures/founder-week-day.json`.
* **Exclusion Assertions**: Update `tests/timeline-eval/run.ts` to assert that:
  - System noise apps like `loginwindow` do not appear in the resulting blocks.
  - Short 42s distractions do not cause block segmentation.
  - Active block duration is equal to the sum of app active sessions, matching exactly within 1 minute.

### 2. End-to-End Persistence Tests
* **AI Tab Persistence**: Add a mock test in `tests/followUpChat.test.ts` to verify that mounting, unmounting, and re-mounting the `AIWorkspace` view retains active messages and keeps the input enabled.
* **Locking Test**: Write a unit test in `tests/blockLabelWrite.test.ts` that creates a block, locks it, calls the re-labeling aggregator, and asserts that the block name remains unchanged.

---

## Build sequence (for autonomous execution)

### Phase 1: Trust the Record (Foundation)
* **Goal**: Build a trustworthy timeline block aggregator.
* **Tasks**:
  - Implement the `SYSTEM_NOISE_APPS` filter in `tracking.ts` and `workBlocks.ts`.
  - Update splitting heuristics in `workBlocks.ts` to use the 5-minute threshold for category shifts.
  - Harmonize duration metrics across renderer views.
  - Add the `locked` column database migration and write-lock preservation logic.
* **Acceptance Criteria**: Running `npm run timeline:eval` passes all segmentations, shows zero `loginwindow` entries, and matches block duration sums exactly. Manually renamed blocks do not change on re-analysis.

### Phase 2: Morning Brief (The Wedge)
* **Goal**: Replace the morning carousel with a high-conversion 1-screen resume view.
* **Tasks**:
  - Rewrite the morning layout branch in `DayWrapped.tsx` to a single-page greeting and carryover nudge.
  - Delete legacy morning slide sub-components.
  - Modify `dailySummaryNotifier.ts` to use `narrative.nudge` (carryover) as the primary notification text.
* **Acceptance Criteria**: Launching the app on a date with yesterday's carryover displays a single greeting screen with the carryover button and no slide navigation buttons.

### Phase 3: Evening Wrap (Calm Recaps)
* **Goal**: Reduce evening slides to a 5-card calm recap model.
* **Tasks**:
  - Rewrite evening slide rendering in `DayWrapped.tsx` to align strictly with `buildFallbackSlides()` structure.
  - Set `hasDistractionData = false` to hide guilt slides.
  - Condense leisure-day outputs to 2 cards (shape + close).
* **Acceptance Criteria**: Triggering an evening wrap on a leisure day shows exactly 2 slides. Work days show at most 5 slides, matching the timeline stats.

### Phase 4: AI Q&A State & Tool Correction
* **Goal**: Fix AI chat Q&A context fetching, table outputs, and UI tab-switching persistence.
* **Tasks**:
  - Create the global React state provider for AI chats.
  - Fix tool binding in `insightsQueryRouter.ts` to retrieve `WrappedFacts` payloads automatically.
  - Update system instructions to mandate Markdown table styling for tabular outputs.
* **Acceptance Criteria**: Asking "what did I do today" returns tool-backed logs in a Markdown table. Chat session persists when user clicks Timeline -> AI.

### Phase 5: Week View & Apps Polish
* **Goal**: Ensure data consistency in week rollups and clean app domain listings.
* **Tasks**:
  - Add a category legend to the week chart in `Timeline.tsx`.
  - Resolve domain URLs under their respective parent browser bundle IDs in `Apps.tsx`.
  - Implement deduping and page delete (trash icon) action.
* **Acceptance Criteria**: Chart shows category legend. Domain summaries display under browser titles only. Page deletion removes the row.

---

## Out of Scope
* Greenfield time-tracking engines (e.g. replacing the active-window node module with a custom Swift/C++ listener).
* Monthly and annual summary wraps.
* Integration with external calendar APIs (Google Calendar, Outlook) or email servers.
* Custom category configurations beyond per-app override settings.

---

## Further Notes
* **Calm Design**: The core philosophy of Daylens v2 is calmness. The app must feel like a trusted assistant that helps you reflect and resume work, not a micromanager that rates your productivity or lectures you on distractions.
