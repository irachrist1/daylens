> ⚠️ **SUPERSEDED — council process artifact (Round 1/2). Do NOT use for implementation.**
> The canonical, assembled plan is [`../DAYLENS-V2-PLAN.md`](../DAYLENS-V2-PLAN.md). Kept for provenance only.

# Daylens v2 plan — Cursor agent (Round 1)

**Agent:** `cursor`  
**Evidence base:** All 35 screenshots in `docs/plans/screenshots/` (34 app UI + 1 IDE context). App launch confirmed (`npm start`, Electron processes running). **This agent cannot interact with the Electron GUI** — no live click-through beyond launch. Anything not visible in screenshots or founder-reported notes is marked `UNVERIFIED — needs live test`.

---

## Problem Statement

Daylens promises automatic work memory: a scrollable calendar of what you actually did, morning/evening briefs that help you pick up threads, and natural-language Q&A grounded in that record. The infrastructure is largely built — capture, timeline UI, AI chat, wraps, settings — but **the product fails the PMF bar because the record is not trustworthy and the brief surfaces do not deliver the vision**.

From the user's perspective today:

1. **The timeline lies.** A 37-minute Cursor block is tagged ENTERTAINMENT because 42 seconds of Netflix drove the label; list duration (37m) disagrees with detail panel (21m); duplicate "Development" blocks fragment one session; raw URLs and "Untitled block" appear where project names should be.
2. **Apps view amplifies the distrust.** Safari shows as "Development"; Dia's domain list includes Netflix/YouTube under "AI tools"; loginwindow accumulates 16–50 hours with no useful detail; session counts (5977 in 7 days) feel broken.
3. **AI cannot answer basic questions.** "What did I work on today?" fails with no tool results and asks the user to paste `getDaySummary`. Week summaries are prose walls with no projects, no tables, and inferred client names — not attributed work.
4. **Morning/evening PMF is missing.** Notifications are toggled on but brief content is unverified; the codebase still ships a multi-slide morning carousel with focus/peak heuristics instead of one carryover screen; evening is an 8-slide deck, not the 5-card honest recap defined in `wrappedNarrative.ts`.
5. **Settings do not govern behavior.** Claude Haiku is selected but timeline re-analyze may use a different provider (founder-reported; re-analyze button visible in screenshots). Clients/projects UI is empty — project questions cannot work. Work memory shows 19 patterns at identical 65% confidence with no visible improvement in labels.
6. **Trust is zero.** The user cannot stake "what did I ship on Daylens last Tuesday?" on timeline, Apps, AI, or wraps — they all draw from the same broken blocks.

Until Phase 1 (trust the record) is done, every downstream surface is cosmetic.

---

## Solution

Daylens v2 is the **same PMF vision**, reached by fixing what exists — not greenfield.

**North star:** Open yesterday's timeline and nod. Morning notification names a real open thread (or says cleanly that nothing is open). One tap to timeline shows matching evidence. Evening wrap is short, honest, and consistent with the timeline. `/ai` gives the same answer as the brief for the same question.

**Build order (from PMF + screenshot severity):**

```
Trust (blocks, labels, durations, noise)
  → Morning brief (1 screen, carryover-first)
    → Evening wrap (5 cards from WrappedFacts)
      → Timeline polish (proof panel, read-only default)
        → AI alignment (tools, projects, same spine as briefs)
          → Weekly/monthly wraps (after daily trust)
```

**Acceptance for v2:** Founder can answer "what did I do last Thursday?" from Daylens without correcting blocks first.

---

## Feature map (Should vs Now)

Every feature from `FEATURE-REGISTRY.md`, corrected/expanded. Status uses screenshot or founder evidence only.

| Feature | Should (v2) | Now (today) | Status | Evidence |
|---------|-------------|-------------|--------|----------|
| **Capture & tracking** |
| Activity → time blocks | One work stretch = one block; breaks separate; minimal gaps | 50 blocks/day; 8h+ untracked gaps; same session split | broken | timeline-today-* |
| Block boundaries | Group by dominant focus; brief drift doesn't flip category | 42s Netflix → ENTERTAINMENT on Cursor block | broken | timeline-today-cursor-block-tagged-entertainment.png |
| Block naming | Human title: project, repo, doc, meeting | "Development", "Untitled block", raw URLs, page titles | broken | timeline-*, apps-7d-safari-named-development.png |
| Block categories (kind) | Category matches dominant activity | Claude Code → BROWSING; UniFi split BROWSING/DEVELOPMENT | broken | timeline-today-afternoon-duplicate-development-blocks.png |
| Merge down | Merge adjacent blocks with clear confirmation | UI exists; no visible feedback | broken | timeline-today-merge-down-fix-episode-panel.png, founder |
| Rename block | Rename persists in list + panel + briefs | Rename UI exists; underlying labels often still wrong | untrusted | timeline-today-merge-down-fix-episode-panel.png |
| Hide block | Hide noise; stays hidden | Hide button exists | UNVERIFIED — needs live test | timeline-today-merge-down-fix-episode-panel.png |
| Duration accuracy | List = panel = sum of apps/artifacts | 37m list vs 21m panel; "Spent 21m" vs 37m block span | broken | timeline-today-duration-mismatch-37m-vs-21m.png |
| Untracked gaps | Minimize; explain when paused | Large unexplained gaps | broken | timeline-today-*, timeline-day-jun16-* |
| System noise capture | Skip loginwindow, UserNotificationCenter | loginwindow 16h–50h as activity | broken | apps-7d-loginwindow-empty-without-ai.png, settings-labels-* |
| Tracking exclusions | Excluded apps/sites honored | UI on; lists empty; loginwindow still tracked | partial | settings-tracking-exclusions-privacy.png |
| Incognito skip | Private windows not recorded | Toggle on | UNVERIFIED — needs live test | settings-tracking-exclusions-privacy.png |
| Pause tracking | Pause stops all capture until resumed | Toggle exists, off | UNVERIFIED — needs live test | settings-mcp-server-enabled.png |
| Session counts | Reasonable per app | Safari 5977 sessions / 7d | untrusted | apps-7d-safari-named-development.png |
| Live block indicator | Current activity block marked clearly | LIVE tag on afternoon block | partial | timeline-today-afternoon-duplicate-development-blocks.png |
| **Timeline / calendar** |
| Day timeline | Scrollable reality calendar with proof | Renders; labels/categories/durations untrusted | broken | timeline-day-jun16-reanalyze-shape-of-day.png |
| Day stats bar | Accurate totals: tracked · work · leisure | 7h38m / 50 blocks — built on bad blocks | untrusted | timeline-today-* |
| Episode detail panel | Apps + artifacts match block story | Netflix artifacts under Cursor coding title | broken | timeline-today-duration-mismatch-37m-vs-21m.png |
| Shape of the day | Honest synthesis from trusted blocks | Score/focus/drift from wrong inputs | broken | timeline-day-jun16-reanalyze-shape-of-day.png |
| Re-analyze with AI | Uses Settings model; refreshes synthesis | "Re-analyzing…" shown; founder: wrong provider (Gemini vs Haiku) | broken | timeline-day-jun16-*, settings-ai-claude-haiku-connected.png, founder |
| Week view chart | Colored breakdown + legend; all days explained | Bars without chart legend; Thu–Sun "No data" (future days OK) | partial | timeline-week-jun15-21-no-data-checking-review.png, timeline-week-jun1-7-untitled-block-legend.png |
| Week stats | Consistent totals everywhere | Review 20h53m vs card 20h7m | broken | timeline-week-jun15-21-review-hours-mismatch.png |
| Week review generate | Recap worth opening | "No saved review" / "Checking…"; generated text quality mixed | broken | timeline-week-jun8-14-*, timeline-week-jun1-7-week-review-generated.png |
| Week day rows | Preview blocks + open day | "Untitled block" previews; Open day works | partial | timeline-week-jun1-7-untitled-block-legend.png |
| Main mode stat | Reflects actual dominant work | "Entertainment" for founder/dev week | untrusted | timeline-week-jun8-14-no-saved-review.png |
| Day / Week / Today toggles | Consistent data across views | Week somewhat usable; day-level worse | partial | timeline-*, apps-* |
| Block corrections UX | Read-only default; "Not right?" for fixes | "Not right?" + Fix episode panel exist | partial | timeline-today-merge-down-fix-episode-panel.png |
| **Apps view** |
| Period toggles | Same app correct across Today/Day/7d/30d | 7d/30d populate; daily often empty/wrong (founder) | broken | founder, apps-* |
| App list naming | App name prominent (Safari, Cursor, Dia) | Bold "Development" or "Claude" for unrelated apps | broken | apps-7d-safari-named-development.png |
| App subtitle | Bundle name + time + sessions | Subtitle sometimes correct; title wrong | broken | apps-* |
| Detail without Generate | Time, domains, pages without AI | Loginwindow nearly empty | broken | apps-7d-loginwindow-empty-without-ai.png |
| Generate summary | Accurate AI blurb | Duplicates ("Netflix, Netflix"); raw titles | broken | apps-7d-safari-named-development.png |
| Time by domain | Domains under correct app | Netflix/YouTube under Dia AI tool | broken | apps-7d-dia-wrong-domain-attribution.png |
| Pages visited | Clean, deduped list | Duplicates; trash on every row | broken | apps-7d-safari-pages-visited-list.png |
| Delete domain/page | Remove mistaken attribution | Trash icons present | UNVERIFIED — needs live test | apps-7d-safari-pages-visited-list.png |
| Often used with | Related apps co-occurrence | Works on UniFi detail | partial | apps-7d-unifi-server-detail.png |
| Category filter pills | Filter list by category | Pills render | UNVERIFIED — needs live test | apps-7d-safari-named-development.png |
| 30d descriptive titles | Meaningful activity names | Better on 30d (coursework, documentary titles) | partial | apps-30d-* |
| **AI tab / Q&A** |
| Ask about today | Answer from history with times | Fails — no tool results; asks user to paste getDaySummary | broken | ai-todays-work-no-tool-results.png |
| Ask about week / projects | Project-attributed summary | No projects; inferred from labels | broken | ai-7-days-by-project-summary-no-projects.png |
| Detail on request | Structured deeper breakdown | Bullets/prose; no tables | broken | ai-7-days-detail-bullets-not-table.png |
| Tables for tabular data | Tables when appropriate | Wall of prose | broken | ai-7-days-summary-prose-no-tables.png |
| Turn into… transforms | Shorter, checklist, bullets, report | Refuses when base answer broken | broken | ai-todays-work-turn-into-bullets-fails.png |
| Response voice | Chief-of-staff who knows your day | Apologetic, meta, offloads work to user | broken | ai-todays-work-* |
| Chat sidebar persistence | History survives tab switches | Gone after Apps → AI (founder); empty mid-gen | broken | ai-chat-sidebar-with-history.png, founder |
| Switch chat during generation | Safe switch or clear loading | Empty chat, no sidebar, input disabled | broken | founder |
| Input during generation | Usable or clearly blocked | Disabled/broken during generation | broken | founder |
| Model from Settings | All AI uses selected model | Header Claude; re-analyze wrong provider | broken | settings-ai-*, founder |
| Thinking / loading state | Clear progress | "Thinking" with no cancel | partial | ai-summarize-7-days-thinking-state.png |
| Suggested prompts | Quick starts that work | Shown on empty state | partial | ai-new-chat-empty-sidebar.png |
| Search chats ⌘K | Find past chats | UI present | UNVERIFIED — needs live test | ai-chat-sidebar-with-history.png |
| Export CSV | Export sessions from prompt | Suggested prompt exists | UNVERIFIED — needs live test | ai-new-chat-empty-sidebar.png |
| Chat history grouping | Today / 7 / 30 day sections | Works when sidebar populated | partial | ai-chat-sidebar-with-history.png |
| **Settings & configuration** |
| AI provider + model | One provider; all surfaces honor it | Claude Haiku set; re-analyze diverges | broken | settings-ai-claude-haiku-connected.png, founder |
| Clients / projects | Named clients; AI attributes work | UI empty | missing | settings-labels-*, settings-notifications-* |
| Per-app labels | Override wrong auto-labels | Overrides exist; Apps/Timeline still wrong | broken | settings-labels-per-app-and-clients.png |
| Work memory / patterns | Patterns improve naming | 19 patterns, identical 65%; Untitled persists | broken | settings-work-memory-learned-patterns.png |
| Rebuild memory | Rebuild helps labels | Button exists | UNVERIFIED — needs live test | settings-work-memory-learned-patterns.png |
| Consolidate end of day | Archives, promotes, decays | Toggle on; no visible improvement | untrusted | settings-work-memory-learned-patterns.png |
| Morning / evening notifications | Briefs delivered with carryover/recap | Toggles on; content not verified | UNVERIFIED — needs live test | settings-notifications-clients-appearance.png |
| Distraction alerts | Warn on focus drift | Toggle off; threshold 10m | UNVERIFIED — needs live test | settings-notifications-clients-appearance.png |
| MCP server | External query of local data | Enabled with dev paths | partial | settings-mcp-server-enabled.png |
| Profile name | Used in AI persona | "tonny" set | partial | settings-ai-claude-haiku-connected.png |
| Theme / appearance | System/light/dark | Light selected | partial | settings-notifications-clients-appearance.png |
| App updates | Check for updates | v1.0.44; packaged-only auto-update note | partial | settings-mcp-server-enabled.png |
| Analytics toggle | Anonymous telemetry opt-in/out | On; local-only badge | UNVERIFIED — needs live test | settings-tracking-exclusions-privacy.png |
| **Wraps & briefs (PMF)** |
| Morning brief | One screen: greeting + carryover + link to yesterday | Multi-slide carousel; focus/peak heuristics in fallback | broken | daylens-PMF.md, DayWrapped code (carousel); notification UNVERIFIED |
| Evening wrap | 5-card honest recap from WrappedFacts | 8-slide deck; guilt slides disabled but deck remains | broken | daylens-PMF.md; UNVERIFIED in UI |
| Daily wrap (timeline panel) | Shape from trusted blocks | Score/drift from bad blocks | broken | timeline-day-jun16-reanalyze-shape-of-day.png |
| Weekly wrap | Week review worth opening | Hours mismatch; thin attribution | broken | timeline-week-* |
| Monthly wrap | Month patterns | Not in screenshots | missing | daylens-PMF |
| Annual wrap | Year narrative | Not built | missing | daylens-PMF |
| **Onboarding & trust** |
| First-run / permissions | Clear capture + value prop | Not documented | UNVERIFIED — needs live test | — |
| Trust bar | Stake client answer on timeline/AI | Cannot | broken | all sections |

---

## How each feature should work

### Capture & tracking

**Should:** While you work in Cursor on Daylens for 90 minutes with a 30-second Slack check, Daylens produces one "Daylens — Cursor" block (~90m, DEVELOPMENT). Slack appears in evidence, not as the block title. Netflix during a coding block appears as a drift artifact, not the category.

**Now:** 37m block titled "Cursor: AI coding agent" tagged ENTERTAINMENT; description says "Spent 21m watching Netflix." (`timeline-today-cursor-block-tagged-entertainment.png`, `timeline-today-duration-mismatch-37m-vs-21m.png`)

**Gap:** Segmentation and kind classification treat brief entertainment as dominant; durations computed differently in list vs panel. User cannot trust any downstream brief.

**Fix:** Rewrite block assembly in `workBlocks.ts` — dominant-app/dominant-kind for category and title; cap drift influence; unify duration via single `blockActiveSeconds` path. Filter loginwindow/UserNotificationCenter at capture. **Re-implement** noise filter, **modify** merge/split heuristics.

---

### Block naming & humanize

**Should:** Blocks read "Daylens repo", "Malaria notebook — Colab", "Teams — ML Pipeline". Apps list shows "Safari" bold, not "Development."

**Now:** Generic "Development" everywhere; 30d sometimes better ("Neural networks coursework") but 7d list still wrong. (`apps-7d-safari-named-development.png`, `apps-30d-dia-coursework-domains.png`)

**Gap:** `humanize.ts` not applied consistently on Apps list titles; work memory patterns don't promote to block titles.

**Fix:** Single `userVisibleBlockLabel` used on timeline, Apps, AI citations. Populate `intent.subject` from repo paths, notebook names, doc titles via `workIntent.ts`. Per-app label overrides must propagate to all surfaces after save.

---

### Timeline — day view

**Should:** Pick Jun 17, scroll blocks chronologically. Header: `7h 38m tracked · 4h 12m work · 3h 26m leisure`. Tap block → evidence matches title. Default read-only; "Not right?" opens rename/merge/hide.

**Now:** 50 blocks, score 71, focus/drift prominent, contradictory block at 8:11 AM. (`timeline-today-*`, `timeline-day-jun16-reanalyze-shape-of-day.png`)

**Gap:** Trust-breaking labels and stats; shape-of-day panel leads with score not mattered/carryover.

**Fix:** **Modify** `Timeline.tsx` header to work/leisure totals; demote score. Episode panel must use same duration source as list. Re-analyze must call configured provider/model from Settings.

---

### Timeline — week view

**Should:** Week chart with legend; stats match review text; future days grayed, not "No data" alarm. Generated review cites real projects.

**Now:** 20h7m on card vs 20h53m in review; no chart legend; "Main mode: Entertainment." (`timeline-week-jun15-21-review-hours-mismatch.png`, `timeline-week-jun8-14-no-saved-review.png`)

**Gap:** Single source of truth for week totals missing; review generation not tied to trusted blocks.

**Fix:** One aggregation function for week stats + review prompt input. Defer polish until daily trust; fix hours mismatch immediately (likely different rounding/filter sets).

---

### Apps view

**Should:** Select Safari → 29h browsing, domains grouped under Safari only. Dia shows AI/coursework domains, not Netflix under wrong header. Loginwindow excluded or labeled system idle.

**Now:** Wrong titles; Dia AI tool header with Netflix/YouTube domains; loginwindow 16h with "needs more context." (`apps-7d-*`, `apps-30d-*`)

**Gap:** Apps list uses block category label as row title instead of app identity; cross-app domain leakage in AI-tool rollup.

**Fix:** **Rewrite** Apps list row model: primary = app display name, secondary = top activity or category. Domain attribution scoped to browser app that recorded the URL. Hard-exclude or cap loginwindow at capture + Apps filter.

---

### AI chat & Q&A

**Should:** "What did I work on today?" → bullet list with HH:MM ranges from today's blocks, cite Daylens/Cursor sessions. "Summarize 7 days by project" → table: Project | Hours | Key days, using client attribution when set.

**Now:** Tool failure loop; prose walls; "No projects attributed"; turn-into refuses because no base answer. (`ai-todays-work-*`, `ai-7-days-*`)

**Gap:** Tool results not in model context; router doesn't use same WrappedFacts spine as briefs; no client entities.

**Fix:** **Fix** tool-use pipeline so getDaySummary results persist in thread context. Route yesterday/today questions through `buildWrappedFactsFromPayload` + carryover. Add clients in Settings before project summaries. Render tables for week/project responses. **Rewrite** chat state persistence so thread list survives route changes (founder: Apps → AI wipes sidebar).

---

### Memory (work patterns)

**Should:** After a week of "malariagroup3report_draft" in Docs, blocks and AI cite "Malaria report" with rising confidence; patterns differ in confidence.

**Now:** 19 patterns all 65%; Untitled blocks remain. (`settings-work-memory-learned-patterns.png`, timeline-week-jun1-7-untitled-block-legend.png`)

**Gap:** Memory promotes to Settings UI but not block naming pipeline.

**Fix:** Wire promoted patterns into label resolver ahead of generic "Development." Rebuild memory must trigger visible relabel pass on recent blocks.

---

### Morning brief

**Should:** 7:30 AM notification: "The malaria notebook was still open — pick it up?" Tap → one screen: greeting, carryover line, "See yesterday" → timeline with evidence.

**Now:** Toggles on (`settings-notifications-clients-appearance.png`); UI still carousel with `morningLead`/`morningNudge` focus heuristics when AI absent (code). Notification body uses `narrative.lead` not carryover first (code in `dailySummaryNotifier.ts`).

**Gap:** Wrong product shape (slideshow vs one screen); wrong fallback copy; notification content unverified live.

**Fix:** **Replace** morning branch in `DayWrapped.tsx` with single screen from `facts.carryover[0]`. Notification: `narrative.nudge` (carryover) first. Delete slides 1–3 and legacy heuristics.

---

### Evening wrap

**Should:** End of day: 5 cards max — shape, what you worked on, where time went, open thread (if any), quiet close. Leisure day = 2 cards. Matches timeline.

**Now:** 8-slide carousel (code); shape-of-day on timeline contradicts blocks. (`daylens-PMF.md`)

**Gap:** Backend 5-card model exists in `wrappedNarrative.ts`; UI never uses it.

**Fix:** **Replace** evening carousel with 5-card layout driven by `WrappedFacts` / `aiSlides`. Keep distraction/guilt slides dead.

---

### Daily / weekly / monthly / annual wraps

**Should (weekly, later):** After daily trust, week review opens like a letter you'd forward — consistent hours, named threads.

**Now:** Generated text sometimes plausible (`timeline-week-jun1-7-week-review-generated.png`) but built on untrusted blocks and wrong totals.

**Fix:** **Defer** weekly/monthly/annual polish to Phase 6; fix hours consistency now as cheap win.

---

### Notifications

**Should:** Morning + evening fire with accurate one-line teaser; distraction alert only when enabled and threshold exceeded.

**Now:** Toggles on; distraction off; delivery/content UNVERIFIED.

**Fix:** After brief rewrite, wire notification copy to carryover/recap spine. Live-test delivery on founder machine.

---

### Settings (model, clients, re-analyze)

**Should:** Pick Claude Haiku → timeline re-analyze, AI chat, wraps, Apps Generate all use Claude Haiku.

**Now:** Settings show Claude connected; founder reports re-analyze uses Gemini. (`settings-ai-claude-haiku-connected.png`, founder)

**Gap:** Multiple code paths resolve provider independently.

**Fix:** **Single** `resolveActiveProvider()` used by chat, re-analyze IPC, wraps, Apps Generate. Show active model in re-analyze status.

---

### Onboarding

**Should:** First launch explains automatic calendar + permissions; first morning brief within 48h of real tracking.

**Now:** UNVERIFIED — needs live test.

**Fix:** **Modify** onboarding to set expectations ("reality calendar, not planner"); verify permission flow on clean install.

---

### Trust (cross-cutting)

**Should:** Same question → same answer on timeline, brief, AI. User corrects block once → propagates everywhere.

**Now:** Contradictions at every layer.

**Fix:** Shared facts spine (`WrappedFacts` + trusted block filter from `timelineReview.ts`); dogfood fixture from founder's real week in `timeline:eval`.

---

## User Stories

1. As a founder, I want yesterday's open coding thread named in my morning notification, so that I know what to resume without opening a slideshow.
2. As a founder, I want one tap from morning brief to yesterday's timeline with matching evidence, so that I trust the nudge.
3. As a founder, I want a 90-minute Cursor session to appear as one block, so that my day doesn't look like 50 fragments.
4. As a founder, I want Netflix checked for 42 seconds during coding to stay in evidence—not become the block title, so that categories reflect real work.
5. As a founder, I want list duration to match the detail panel, so that I don't wonder which number is true.
6. As a consultant, I want "Vanessa Semugaza" and "Vecta-Holdings" attributed to clients I define, so that week summaries group by client not inferred labels.
7. As an eng lead, I want `/ai` "what did I work on today?" to return timed blocks without asking me to paste tool output, so that the assistant does its job.
8. As a first-time user, I want suggested prompts that actually work, so that I discover value in the first session.
9. As a founder, I want "Turn into bullets" to reformat a real answer, so that I can paste into Slack.
10. As a founder, I want week summaries as tables when I ask for detail, so that I can scan hours by day/project.
11. As a founder, I want chat history to persist when I visit Apps and return to AI, so that I don't lose context.
12. As a founder, I want to switch chats during generation without a blank broken UI, so that the app feels stable.
13. As a founder, I want re-analyze to use the model I chose in Settings, so that behavior is predictable.
14. As a founder, I want Safari listed as Safari in Apps—not "Development", so that I can find browser time.
15. As a founder, I want loginwindow excluded from my 7-day app list, so that idle/lock time doesn't dominate.
16. As a founder, I want Dia domain breakdowns to show only Dia-attributed pages, so that Netflix isn't under my AI tool.
17. As a founder, I want merge-down to show clear confirmation, so that I know a fix worked.
18. As a founder, I want rename to stick in timeline, brief, and AI answers, so that corrections propagate.
19. As a founder, I want evening wrap in five cards max, so that I actually read it before closing the laptop.
20. As a founder, I want leisure days to get a short honest wrap without focus lectures, so that rest days aren't guilt trips.
21. As a founder, I want timeline header to show work vs leisure time—not a focus score, so that the calendar feels like reality not grading.
22. As a founder, I want week review hours to match the week total card, so that I trust weekly recaps.
23. As a founder, I want work memory patterns to improve block titles after a week, so that "Untitled block" disappears.
24. As a founder, I want per-app label overrides to fix Dia/Safari everywhere immediately, so that Settings changes matter.
25. As a consultant, I want to add clients in Settings and ask "how much on QT Holding this week?", so that project Q&A works.
26. As a founder, I want morning fallback copy to use carryover facts—not focus percentage, so that offline mornings still help.
27. As a founder, I want shape-of-day to list what mattered from trusted blocks only, so that leisure doesn't appear in mattered.
28. As a founder, I want AI answers for "what did I leave open yesterday?" to match the morning brief, so that surfaces agree.
29. As a founder, I want duplicate Development blocks merged automatically when same app sequence, so that afternoon coding isn't split.
30. As a founder, I want untracked gaps explained (paused tracking vs no activity), so that 8h gaps aren't mysterious.
31. As a founder, I want pages visited deduped in Apps detail, so that Netflix doesn't appear twice.
32. As a founder, I want to delete a mistaken domain from Apps, so that bad attribution doesn't persist.
33. As a founder, I want CSV export of today's sessions from AI, so that I can share with a client.
34. As a founder, I want MCP queries to see the same data as in-app AI, so that Cursor/Claude Desktop match Daylens.
35. As a first-time user, I want onboarding to explain local-only storage, so that I grant permissions confidently.

---

## Implementation Decisions

### Block pipeline (`workBlocks.ts`, `workKind.ts`, `humanize.ts`, `workIntent.ts`)

**Exists:** Segmentation, kind axis, humanize helpers, eval fixtures (7 passing — not product truth).  
**Wrong:** Brief drift wins category; duplicate blocks; duration mismatch; loginwindow captured.  
**Target:** Dominant-activity labeling; leisure never in mattered/carryover; unified durations.  
**Action:** **Modify** segmentation + kind; **add** system-app denylist at capture; **add** founder real-day fixture to eval.

### Timeline UI (`Timeline.tsx`, `timelineReview.ts`)

**Exists:** Day/week views, episode panel, re-analyze, merge/rename/hide.  
**Wrong:** Score-first header; inconsistent durations; re-analyze provider drift.  
**Target:** Read-only calendar with proof; work/leisure header; Settings-honoring re-analyze.  
**Action:** **Modify** presentation; **fix** IPC re-analyze provider resolution.

### Apps (`Apps.tsx`)

**Exists:** Period toggles, domain/pages, Generate, filters.  
**Wrong:** Row title = block category; cross-app domain rollup; loginwindow rows.  
**Target:** App-centric list with scoped domains.  
**Action:** **Rewrite** list row model and domain scoping.

### Wrapped narrative (`wrappedNarrative.ts`, `DayWrapped.tsx`, `dailySummaryNotifier.ts`)

**Exists:** WrappedFacts, carryover, 5-card fallback in backend; 8-slide + morning carousel in UI.  
**Wrong:** UI ignores backend calm model; morning heuristics ignore carryover; notification uses lead not nudge.  
**Target:** PMF brief surfaces.  
**Action:** **Replace** DayWrapped morning/evening UI; **modify** notifier copy order.

### AI (`aiService.ts`, insights router, `useAIChat.ts`, tool pipeline)

**Exists:** Chat, tools, transforms, thread DB.  
**Wrong:** Tool results dropped from context; threads lost on navigation; project-less summaries; prose-only formatting.  
**Target:** Reliable tool loop; persistent threads; WrappedFacts routing; tables for structured asks.  
**Action:** **Fix** thread persistence bug; **modify** router to shared facts spine; **fix** tool result attachment.

### Settings & clients (`Settings.tsx`, settings service)

**Exists:** Provider, model, labels, memory, clients UI shell, notifications, MCP.  
**Wrong:** Clients empty; labels don't propagate; provider not global.  
**Target:** Clients enable attribution; one provider everywhere.  
**Action:** **Modify** settings propagation; **implement** client CRUD → attribution resolver.

### Weekly recap (`recap.ts`)

**Exists:** Generate + refresh on week view.  
**Wrong:** Hours mismatch vs stats card.  
**Target:** Single week aggregate.  
**Action:** **Modify** aggregation source (after daily trust).

---

## Testing Decisions

Tests prove **Should** behavior; green unit tests alone are insufficient.

| Feature | External-behavior test | Would catch |
|---------|------------------------|-------------|
| Block boundaries | Fixture: Cursor 90m + 42s Netflix → one DEVELOPMENT block, Netflix in artifacts only | entertainment-tagged-cursor screenshot |
| Duration consistency | Assert list duration === panel duration === sum(apps) per fixture block | 37m vs 21m screenshot |
| loginwindow | Capture simulation excludes loginwindow from app rollups | loginwindow 16h screenshot |
| Apps row title | Render Apps with Safari sessions → bold "Safari", not "Development" | apps-7d-safari screenshot |
| Domain scoping | Dia detail does not list domains only seen in Safari | dia-wrong-domain screenshot |
| Morning brief | Render morning wrap → single carryover line, no carousel slide count > 1 | PMF spec |
| Morning fallback | Empty AI → copy from facts.carryover, not focusPct | morningLead heuristic bug |
| Evening wrap | ≤5 cards; leisure fixture → 2 cards | 8-slide deck |
| AI today | Mock tool success → answer contains block times, no "paste getDaySummary" | ai-todays-work screenshot |
| Turn into bullets | Valid assistant message → bullet transform succeeds | turn-into-bullets-fails screenshot |
| Week totals | Same function output for card + review prompt | 20h7m vs 20h53m screenshot |
| Provider | Re-analyze IPC uses Settings provider/model | founder Gemini mismatch |
| Thread persistence | Navigate AI → Apps → AI → thread list length unchanged | founder report |
| WrappedFacts alignment | Same payload → morning carryover === AI "left open yesterday" answer | cross-surface trust |

**Run for each phase:** `npm run timeline:eval` (after adding founder fixture) + new screenshot regression checklist documented per phase. **Do not** treat eval green as ship criteria without dogfood screenshot.

---

## Build sequence (for autonomous execution)

### Phase 0 — Dogfood harness (1–2 days)

**Work:** Export founder real day + week into `tests/timeline-eval/fixtures/`; document screenshot checklist script.  
**Acceptance:** Fixture fails on current main (proves test catches real bugs); founder confirms fixture matches memory ±15m.

### Phase 1 — Trust the record (foundation)

**Work:** Block segmentation, kind dominance, duration unification, loginwindow filter, humanize on all block labels, merge feedback UX.  
**Acceptance (run app, compare to Jun 17 scenarios):**
- [ ] Cursor coding block: DEVELOPMENT title, Netflix only in artifacts
- [ ] List duration = panel duration for every block on today
- [ ] loginwindow absent from Apps 7d top list
- [ ] No new "Untitled block" on days with named artifacts
- [ ] `npm run timeline:eval` includes founder fixture green
- [ ] Screenshot retake of `timeline-today-*` matches acceptance

### Phase 2 — Morning brief (wedge)

**Work:** Single-screen morning UI; carryover-first notification; remove morningLead/morningNudge.  
**Acceptance:**
- [ ] Morning notification text names carryover thread OR "Nothing left open"
- [ ] One screen only: greeting + carryover + "See yesterday"
- [ ] Tap through → timeline block evidence matches notification
- [ ] Live test: trigger morning notification on founder machine

### Phase 3 — Evening wrap

**Work:** 5-card evening UI from WrappedFacts; leisure = 2 cards.  
**Acceptance:**
- [ ] ≤5 cards; no focus lecture on leisure fixture day
- [ ] Card content matches timeline for same date
- [ ] Evening notification teaser matches first card shape sentence

### Phase 4 — Timeline as proof

**Work:** work/leisure header; demote score; re-analyze uses Settings model; week hours single source.  
**Acceptance:**
- [ ] Day header shows tracked/work/leisure, not score first
- [ ] Re-analyze label shows active model from Settings
- [ ] Week card total === week review text total (±1m)
- [ ] Screenshot retake of week mismatch resolved

### Phase 5 — Apps view truth

**Work:** App-centric rows; domain scoping; dedupe pages; optional delete domain.  
**Acceptance:**
- [ ] Safari row titled Safari at 7d and 30d
- [ ] Dia domains exclude Safari-only Netflix
- [ ] Generate summary without duplicate artifact names
- [ ] Screenshot retake of apps-7d-* issues resolved

### Phase 6 — AI alignment

**Work:** Tool context fix; thread persistence; WrappedFacts routing; clients CRUD + attribution; tables; turn-into on valid answers.  
**Acceptance:**
- [ ] "What did I work on today?" succeeds without user paste
- [ ] Apps → AI → sidebar threads persist
- [ ] "Summarize 7 days by project" with client set → table with client rows
- [ ] Same carryover answer in morning brief and AI for yesterday open threads
- [ ] Screenshot retake of ai-todays-work-* resolved

### Phase 7 — Memory & settings propagation

**Work:** Patterns → label resolver; label override refresh; rebuild memory visible effect.  
**Acceptance:**
- [ ] Repeated artifact promotes to block title within 7 days of fixture
- [ ] Changing Dia label in Settings updates Apps + Timeline within one navigation

### Phase 8 — Weekly wraps (post-daily trust)

**Work:** Week review quality, legend on chart, defer monthly/annual.  
**Acceptance:**
- [ ] Generated week review opens without hours contradiction
- [ ] Founder would forward review to themselves (subjective live test)

---

## Out of Scope

- Annual wrap (not built; defer)
- Calendar/email integrations (different product layer)
- Greenfield rewrite of capture engine
- New features not in PMF (social, sharing, team workspaces)
- Fixing tests for test sake without screenshot-linked acceptance
- MCP server path hardening for production (dev paths in screenshot OK for now)
- Distraction alerts implementation before daily trust (toggle exists; behavior unverified)

---

## Further Notes

### Screenshot audit summary (35 files)

| Area | Count | Key finding |
|------|-------|-------------|
| Timeline day | 5 | Category/duration/title failures dominate |
| Timeline week | 5 | Hours mismatch; Entertainment main mode; review state flaky |
| Apps 7d | 5 | Wrong titles; loginwindow; domain misattribution |
| Apps 30d | 4 | Better AI titles at 30d but Safari still 119h entertainment-heavy |
| AI chat | 10 | Tool failure; prose not tables; turn-into broken; thinking state |
| Settings | 7 | Model set but not honored everywhere; empty clients; memory flat |
| Meta | 1 | IDE context only — not app UI |

### Registry corrections vs FEATURE-REGISTRY.md

- **Hide block:** unknown → UNVERIFIED (button visible, behavior not confirmed)
- **Incognito skip:** works? → UNVERIFIED (toggle on only)
- **Category filter pills:** unknown → UNVERIFIED (render confirmed)
- **Week legend:** "no legend" → partial (day-row legend exists; chart lacks legend)
- **Chat sidebar empty screenshot** (`ai-new-chat-empty-sidebar.png`) vs **with history** — both valid states; founder reports empty after tab switch is the bug
- **30d Apps naming** partially works — registry underplayed this

### Live verification limits (Cursor agent)

- App **launches** successfully in dev (`userData`: DaylensWindows).
- Agent **cannot** click Electron UI, trigger notifications, or capture new screenshots.
- **UNVERIFIED** items listed above require founder or Round 2 agent with GUI access.

### Missing registry rows added in this plan

Notifications delivery content, distraction alerts, CSV export, live block indicator, delete domain/page, theme/appearance, app updates, pause tracking, analytics toggle, MCP server, onboarding, block corrections UX (read-only default).

### Code as diagnosis only (not proof of works)

- Morning carousel + `morningLead`/`morningNudge` heuristics confirm PMF gap for morning (`DayWrapped.tsx`).
- `wrappedNarrative.ts` carryover/mattered model exists but timeline shape-of-day still shows score/drift from bad blocks.
- `useAIChat.ts` has thread hydration guards but founder reports persistence failure on route change — needs live repro.

---

*Round 1 complete. File: `docs/plans/Daylens-v2-plan-cursor.md`. No other plan files read or edited.*
