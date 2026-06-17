> ⚠️ **SUPERSEDED — council process artifact (Round 1/2). Do NOT use for implementation.**
> The canonical, assembled plan is [`../DAYLENS-V2-PLAN.md`](../DAYLENS-V2-PLAN.md). Kept for provenance only.

# Daylens v2 — plan (claude)

> Round 1 plan by the agent named **claude**. Written from: every screenshot in
> `docs/plans/screenshots/` (primary evidence), `docs/daylens-PMF.md` (vision),
> `docs/plans/FEATURE-REGISTRY.md` (seed), founder-reported issues, and the
> codebase **only to explain *why* something fails** — never as proof it works.
>
> **Live-app honesty.** I could not drive the running macOS Electron app and
> visually confirm behavior in this environment. So every "Now" below is backed
> by a screenshot, a founder report, or is explicitly marked
> `UNVERIFIED — needs live test`. Nothing is marked **works** on code-reading
> alone. The morning brief, evening wrap, notification *delivery*, monthly/annual
> wraps, and onboarding are the big unverified surfaces — see the list at the end.

---

## Problem Statement

Daylens promises to be *automatic work memory for your laptop*: a trustworthy
calendar of what you actually did, with briefs and Q&A you'd open without
prompting. The infrastructure exists, but **the user cannot trust a single
number on the screen**, and trust is the entire product. Concretely, from the
user's seat:

1. **The record contradicts itself.** A block titled "Cursor: AI coding agent"
   is tagged **ENTERTAINMENT** and described as "Spent 21m watching Netflix"
   (`timeline-today-cursor-block-tagged-entertainment.png`). The same block reads
   **37m** in the list and **21m** in the detail panel
   (`timeline-today-duration-mismatch-37m-vs-21m.png`). A week shows **20h7m** on
   the stat card and **20h53m** in its own review text
   (`timeline-week-jun15-21-review-hours-mismatch.png`). When two numbers on one
   screen disagree, the user stops believing all of them.

2. **Leisure is treated as work.** Netflix and X (Twitter) appear in
   "What mattered" (`timeline-day-jun16-reanalyze-shape-of-day.png`). "Main mode"
   for multiple weeks is **Entertainment** (`timeline-week-jun1-7-*`,
   `timeline-week-jun8-14-*`) for a founder/engineer. The PMF rule "leisure never
   in mattered/carryover" is violated on the surface even though a `kind` axis
   exists in the backend.

3. **Names are machine output, not human language.** The Apps list shows
   "**Development**" as the bold title with "Safari · 29h 26m" as the subtitle in
   7d (`apps-7d-safari-named-development.png`), but a raw documentary title
   ("Divided States of America Part 1 (full documentary)") as the bold title in
   30d (`apps-30d-safari-119h-domains.png`). Blocks are "Untitled block",
   "Development", or a raw page title ("iPhone 12 Wi"). The humanizer exists; the
   surface doesn't use it consistently.

4. **The AI can't answer the one question the app is for.** "What did I work on
   today?" returns an apology — *"I don't have the tool results… could you share
   the getDaySummary output again?"* (`ai-todays-work-no-tool-results.png`) — and
   then refuses to reformat its own non-answer
   (`ai-todays-work-turn-into-bullets-fails.png`). It asks the user to do the
   app's job.

5. **The briefs aren't the PMF briefs.** Per `daylens-PMF.md`, morning is still a
   3–4 slide carousel and evening an 8-slide deck, while the 5-card calm model
   already defined in `wrappedNarrative.ts` is never rendered. *(Code/founder
   described; `UNVERIFIED — needs live test`.)*

6. **Capture over-collects and under-segments.** `loginwindow` is tracked as a
   16h24m "app" (`apps-7d-loginwindow-empty-without-ai.png`); Safari shows 5,977
   sessions in 7 days; one work stretch fragments into duplicate consecutive
   "Development" blocks (`timeline-today-afternoon-duplicate-development-blocks.png`)
   while a 42-second Netflix tab flips a whole coding block to leisure.

Net: **the product works in fixtures and fails on a real day.** v2 is not new
features — it's making the existing surfaces tell the truth so the user nods
instead of correcting.

---

## Solution

Daylens v2 is the same vision, **trustworthy on the founder's own machine**:

- One **block model** with sensible boundaries and a single source of truth for
  duration, kind (work/leisure/personal), category, and title — so every surface
  (timeline, apps, shape-of-day, briefs, AI) reads the *same* numbers.
- **`kind` drives the surface**, not just the backend: leisure is visually
  separated, never counted as focus, never in "mattered"/"carryover".
- **One humanizer on every title**, everywhere, with the real app name always
  legible.
- A **morning brief = one screen** ("what you left open → pick it up") and an
  **evening wrap = ≤5 calm cards**, both rendered from the same facts spine.
- **AI Q&A grounded in that same spine** — answers today/week/project questions
  with times and tables, never asks the user to paste data, and keeps chat
  history across navigation.
- **One provider/model** from Settings honored by *every* AI surface
  (chat, re-analyze, summaries, briefs).
- **Capture that excludes system noise** and segments by work focus, so the
  blocks underneath all of the above are believable.

The bar is the PMF "How you know" list: open yesterday's timeline and nod; the
morning brief names a real open thread; evening wrap matches the timeline; `/ai`
agrees with both; next Tuesday you can answer what you did last Thursday.

---

## Feature map (Should vs Now)

> Corrections to `FEATURE-REGISTRY.md` are folded in here (registry is read-only
> until Round 3). Rows marked **[CORRECTED]** revise a registry "Now"; **[NEW]**
> adds a row the registry missed.

### Capture & tracking

| Feature | Should (v2) | Now (today) | Status | Evidence |
|---|---|---|---|---|
| Activity → blocks | One work stretch = one block; breaks split blocks; minimal fragmentation | Consecutive identical "Development" blocks; 50 blocks/day; 8h+ gaps | broken | `timeline-today-afternoon-duplicate-development-blocks.png` |
| Block boundaries by focus | A 42s leisure tab inside coding does **not** flip the block | 21m Netflix inside an 8:11–8:48 Cursor stretch flips it to ENTERTAINMENT | broken | `timeline-today-cursor-block-tagged-entertainment.png` |
| Duration accuracy | List span = detail "spent" = sum of apps, one definition | 37m span vs 21m "spent" vs ~19m app sum, all on one block | broken | `timeline-today-duration-mismatch-37m-vs-21m.png` |
| System-noise exclusion | `loginwindow`, `UserNotificationCenter`, `Finder` never surface as meaningful apps | `loginwindow` = 16h24m / 13 sessions; in "Often used with" lists | broken | `apps-7d-loginwindow-empty-without-ai.png`, `apps-7d-unifi-server-detail.png` |
| Tracking exclusions actually apply **[CORRECTED]** | "Limit what's tracked" ON + lists → those apps/sites excluded | Toggle is **ON** but Excluded apps/sites are **empty**, so everything is still tracked | broken | `settings-tracking-exclusions-privacy.png` |
| Session counts | Plausible session counts | Safari 5,977 sessions / 7d; Dia 5,893 — inflated by micro-sessions | untrusted | `apps-7d-safari-named-development.png`, `apps-7d-dia-wrong-domain-attribution.png` |
| Untracked gaps | Minimized; labeled (asleep / computer off) | "Untracked gap 8h11m", "6h6m" shown as bare lines | broken | `timeline-today-*` |

### Timeline / calendar

| Feature | Should (v2) | Now | Status | Evidence |
|---|---|---|---|---|
| Day block tag = kind-aware category | Tag reflects dominant **kind**; coding stays DEVELOPMENT despite a leisure blip | "Cursor" block → ENTERTAINMENT; "Claude Code" → BROWSING | broken | `timeline-today-cursor-*`, `timeline-today-afternoon-*` |
| Block titles | Human title = what you did | "Untitled block", "Development", "iPhone 12 Wi", "https://x.com" | broken | `timeline-day-jun16-*`, `timeline-today-*` |
| "What mattered" excludes leisure | Only work threads; leisure never appears | Netflix and X (Twitter) listed in "What mattered" | broken | `timeline-day-jun16-reanalyze-shape-of-day.png` |
| Shape-of-day inputs | Focus/drift from trusted, kind-correct blocks; no score up front | Score 71 / Focused 4h / Drift 3h37m built on mis-tagged blocks | broken | `timeline-today-cursor-*`, `timeline-day-jun16-*` |
| Re-analyze uses Settings model **[CORRECTED]** | Re-analyze runs the single Settings-selected provider | Founder: re-analyze uses **Gemini** while Settings = Claude Haiku; shows "Re-analyzing…" | broken | `timeline-day-jun16-*`, `settings-ai-claude-haiku-connected.png`, founder |
| Week chart legend | Stacked bars carry a color legend | Top week bars have **no legend**; only the day-row has one | broken | `timeline-week-jun15-21-no-data-checking-review.png` vs `timeline-week-jun1-7-untitled-block-legend.png` |
| Week totals consistent | One week total everywhere | Card 20h7m vs review 20h53m; Wed 7h38m vs 7h39m | broken | `timeline-week-jun15-21-review-hours-mismatch.png` |
| Week "Main mode" | Reflects work mode for a working user | "Entertainment 20h46m" / "15h17m" as the headline mode | untrusted | `timeline-week-jun1-7-*`, `timeline-week-jun8-14-*` |
| Empty days | "No data" only when truly none; explain weekends | Thu–Sun "No data" with no explanation | partial | `timeline-week-jun15-21-no-data-checking-review.png` |
| Merge / rename / hide | Edits stick + give visible confirmation | UI exists; no confirmation feedback; names still wrong after | untrusted | `timeline-today-merge-down-fix-episode-panel.png` |

### Apps view

| Feature | Should (v2) | Now | Status | Evidence |
|---|---|---|---|---|
| App title = app name **[CORRECTED]** | Real app name is the bold title (Safari, Dia, Cursor); category/summary is secondary | 7d: bold title is the **category** ("Development", "Claude"); 30d: bold title is a **content/artifact title** ("Divided States of America Part 1…") — inconsistent and both wrong | broken | `apps-7d-safari-named-development.png`, `apps-30d-safari-119h-domains.png` |
| Period consistency | Same app reads consistently across Today/Day/7d/30d | Title scheme differs between 7d and 30d; daily often empty | broken | founder, `apps-7d-*`, `apps-30d-*` |
| Detail without AI | Time, domains, pages render without "Generate" | `loginwindow`: "Daylens needs more context to describe this tool" — near-empty | broken | `apps-7d-loginwindow-empty-without-ai.png` |
| Domains under correct app | Netflix/YouTube attributed to the browser that hosted them | Netflix/YouTube/X listed under **Dia** ("AI tools") and Safari | broken | `apps-7d-dia-wrong-domain-attribution.png` |
| Pages visited deduped | Clean, deduplicated list | Duplicate "Netflix" rows; repeated `netfilm.world` | broken | `apps-7d-safari-pages-visited-list.png` |
| Category of app | Category matches dominant use | Safari (mostly YouTube/Netflix) = "Browsing"; Dia (mixed) = "AI tools"/"Browsing" | untrusted | `apps-7d-*`, `apps-30d-*` |
| Generate summary quality | Accurate period blurb | Duplicate artifacts ("Netflix, Netflix"); long raw titles | broken | `apps-7d-safari-named-development.png` |
| Often used with | Real co-occurring apps | Includes `UserNotificationCenter`, Siri as "apps" | broken | `apps-7d-unifi-server-detail.png` |

### AI tab / Q&A

| Feature | Should (v2) | Now | Status | Evidence |
|---|---|---|---|---|
| Ask about **today** | Grounded answer with HH:MM, no apology | Apology: "I don't have the tool results… share getDaySummary output again" | broken | `ai-todays-work-no-tool-results.png` |
| Ask about **week** **[CORRECTED]** | Same grounded quality as today | Actually **returns** a detailed week answer incl. per-day HH:MM breakdowns — so the data path works for week ranges | partial | `ai-7-days-detailed-day-breakdown.png`, `ai-7-days-detail-bullets-not-table.png` |
| Tables for tabular data | Uses Markdown tables for per-day / per-project breakdowns | Always prose or bullets, never a table | broken | `ai-7-days-summary-prose-no-tables.png`, `ai-7-days-detail-bullets-not-table.png` |
| Project attribution | Attributes work to named clients/projects | "No projects attributed in Daylens yet"; inferred from block labels only | broken | `ai-7-days-by-project-summary-no-projects.png` |
| "Turn into…" transforms | Reformat a real answer (shorter/checklist/bullets/report) | Refuses: "that's a request for data, not a summary of captured work" | broken | `ai-todays-work-turn-into-bullets-fails.png`, `ai-todays-work-turn-into-menu.png` |
| Response voice | Chief-of-staff who knows your day | Apologetic, meta, asks user to paste data | broken | `ai-todays-work-no-tool-results.png` |
| Chat history persistence | Survives tab switches & navigation | Sidebar "No chats yet" after navigation; gone mid-generation; history reappears only sometimes | broken | `ai-new-chat-empty-sidebar.png`, `ai-chat-sidebar-with-history.png`, founder |
| Switch chat mid-generation | Safe switch or clear lock | Breaks: empty chat, sidebar gone, input disabled | broken | founder |
| Stuck "Thinking" | Bounded, cancelable | "Summarize 7 days" sits on "Thinking" indefinitely | broken | `ai-summarize-7-days-thinking-state.png` |
| Model from Settings | All AI honors selected model | Header shows Claude Haiku; re-analyze uses Gemini | broken | `settings-ai-claude-haiku-connected.png`, founder |
| Suggested prompts | Quick starts that all work | 4 chips shown; "What did I work on today?" leads to the apology | partial | `ai-new-chat-empty-sidebar.png` |

### Settings & configuration

| Feature | Should (v2) | Now | Status | Evidence |
|---|---|---|---|---|
| Provider + model | One provider; every surface honors it | Claude Haiku set & "CONNECTED"; not used by re-analyze | broken | `settings-ai-claude-haiku-connected.png`, founder |
| Work memory patterns **[CORRECTED]** | Patterns improve naming/category with varied, earned confidence | **All 19 patterns tagged "browsing" at identical 65% confidence** — incl. Microsoft Teams, Claude, "malaria_group3_report_draft", Apple Developer Documentation | broken | `settings-work-memory-learned-patterns.png` |
| Per-app labels | Override sticks across Apps/Timeline | Dia override → "Browsing" set, but Apps still mis-titles Dia | broken | `settings-labels-per-app-and-clients.png` |
| Clients / projects | Named clients; AI attributes to them | "No clients yet"; AI says no projects registered | missing | `settings-notifications-clients-appearance.png`, `ai-7-days-by-project-summary-no-projects.png` |
| Notifications toggles | Morning/evening deliver the new briefs | Evening + Morning ON; Distraction OFF; threshold 10m. Delivery/content unverified | unknown | `settings-notifications-clients-appearance.png` |
| MCP server | Optional external query | Enabled; dev paths in config | partial | `settings-mcp-server-enabled.png` |
| Rebuild memory / consolidate | Visible improvement | Buttons exist; outcome not visible | unknown | `settings-work-memory-learned-patterns.png` |
| Theme **[NEW]** | System/Light/Dark | Present (Light selected) | unknown | `settings-notifications-clients-appearance.png` |
| App updates **[NEW]** | Check/apply in packaged builds | "Check for updates"; v1.0.44; auto-update packaged-only | unknown | `settings-notifications-clients-appearance.png`, `settings-mcp-server-enabled.png` |

### Wraps & briefs

| Feature | Should (v2) | Now | Status | Evidence |
|---|---|---|---|---|
| Morning brief | One screen: greeting + carryover line + "See yesterday" | PMF/founder: still a 3–4 slide carousel; uses focus%/peak heuristics in fallback | broken (unverified in-app) | `daylens-PMF.md`, `UNVERIFIED — needs live test` |
| Evening wrap | ≤5 calm cards from facts spine; 2 cards on a leisure day | PMF/founder: 8-slide deck; 5-card model in `wrappedNarrative.ts` unused | broken (unverified in-app) | `daylens-PMF.md`, `UNVERIFIED — needs live test` |
| Daily wrap (side panel) | Honest shape from trusted blocks | "Shape of the day" exists; wrong inputs → leisure in "mattered" | broken | `timeline-day-jun16-*` |
| Weekly wrap | Consistent, openable review | Generate works; totals disagree; "checking…"/"no saved review" states | broken | `timeline-week-*` |
| Monthly wrap | Month patterns | Not seen | unknown | `UNVERIFIED — needs live test` |
| Annual wrap | Year narrative | Not built | missing | `daylens-PMF.md` |

### Onboarding & trust

| Feature | Should (v2) | Now | Status | Evidence |
|---|---|---|---|---|
| First-run / permissions | Clear capture + value prop + permission grant | Not observed | unknown | `UNVERIFIED — needs live test` |
| Trust bar | Can stake a client answer on timeline/AI | Cannot — contradictions everywhere | broken | all sections |

---

## How each feature should work

> Should = exact target behavior + a concrete "working right" example. Now = what
> the user sees today. Gap = why it breaks the vision. Fix = product-level move
> (patch / rewrite / replace), no file paths.

### A. Capture & tracking (foundation — everything downstream inherits this)

**A1. Block segmentation by work focus**
- **Should.** A continuous stretch of related activity is one block; a real
  context switch (different project, or work→leisure) starts a new one. Brief
  incidental activity (a 42s tab, a 30s Finder window) is absorbed into the
  surrounding block, not promoted to its own. *Example:* 2:47–5:53pm coding in
  Cursor with Ghostty + a 1-min UniFi check = **one** "Cursor — Daylens" block,
  not three "Development" blocks plus a "UniFi Site Manager" block.
- **Now.** Two consecutive "Development" blocks (2:47–4:43, 4:43–5:53) that are
  the same work; separate 1-min "UniFi Site Manager" blocks interrupt coding
  (`timeline-today-afternoon-duplicate-development-blocks.png`). 50 blocks/day.
- **Gap.** Over-segmentation makes the timeline noise, not a calendar; the user
  must mentally re-merge before reading it.
- **Fix.** **Rewrite the segmentation policy.** Merge adjacent blocks that share
  dominant app + kind + intent subject and abut within a short gap; require a
  minimum block duration and a minimum "dwell" for a context switch before
  cutting. Keep the `kind` hard-cut (work↔leisure) — but only on sustained
  leisure, using the neutral/`dual-use` rule already in `workKind.ts` so a short
  in-work tab stays work.

**A2. Kind-aware block tag & duration as one truth**
- **Should.** The colored tag on a block reflects its dominant **kind/category**
  computed from time-weighted activity; the same number for duration appears in
  the list, the detail header, and the sum of the app rows. *Example:* a block
  that is 19m coding + 2m Netflix shows DEVELOPMENT, "21m", and app rows that sum
  to 21m.
- **Now.** "Cursor: AI coding agent" tagged ENTERTAINMENT from 42s of Netflix;
  list says 37m, detail says 21m, apps sum to ~19m
  (`timeline-today-cursor-*`, `timeline-today-duration-mismatch-37m-vs-21m.png`).
- **Gap.** Self-contradiction destroys trust in every number; leisure leaks into
  work framing.
- **Fix.** **One duration definition** (active foreground seconds within block
  bounds) computed once and reused by every renderer; remove the secondary
  "spent Xm" derivation. **Drive the tag from `dominantKind`/category**, not from
  whichever artifact has the catchiest title. Title and tag must agree with the
  app breakdown.

**A3. System-noise exclusion**
- **Should.** `loginwindow`, `UserNotificationCenter`, screensaver, and similar
  OS chrome are never presented as meaningful apps, never in "Often used with",
  never counted toward tracked time. *Example:* locking the laptop for lunch does
  not create a 16-hour "loginwindow" app.
- **Now.** `loginwindow` = 16h24m / 13 sessions, appears in lists and detail
  (`apps-7d-loginwindow-empty-without-ai.png`); `UserNotificationCenter` in
  "Often used with" (`apps-7d-unifi-server-detail.png`).
- **Gap.** Inflates totals and pollutes every aggregate (apps, week "Main mode",
  shape-of-day).
- **Fix.** **Replace** the capture filter with a system-process denylist applied
  at ingest (so it never enters aggregates) plus treating `loginwindow` time as
  *untracked/idle* (the machine was locked), which also shrinks the bogus gaps.

**A4. Tracking exclusions that actually apply**
- **Should.** With "Limit what's tracked" on, apps/sites the user lists are
  excluded from capture and all surfaces; with it off, everything is tracked.
- **Now.** Toggle is **on** but the excluded lists are empty, so nothing is
  excluded and `loginwindow`/entertainment still dominate
  (`settings-tracking-exclusions-privacy.png`).
- **Gap.** The privacy/cleanup control the user reaches for does nothing
  observable.
- **Fix.** **Verify and wire** the exclusion lists end-to-end (ingest filter +
  retroactive hide in aggregates). Ship sensible **defaults** (system processes
  pre-excluded) so the toggle has visible effect immediately.

### B. Timeline / calendar

**B1. Trustworthy day timeline (Phase-1 gate)**
- **Should.** Scroll a day like a calendar; each block's title, tag, time, and
  evidence agree; leisure is visually distinct and out of the work tallies. Day
  header reads `5h 24m tracked · 52m work · 3h 51m leisure` — no score/focus% up
  front.
- **Now.** Header shows "7h38m tracked · 50 blocks · 15 apps · 20 sites"; blocks
  mis-tagged; "Untitled block"; shape panel leads with Score 71
  (`timeline-today-*`, `timeline-day-jun16-*`).
- **Gap.** This is the wedge surface; if it's wrong, briefs and Q&A built on it
  inherit the lie.
- **Fix.** **Re-derive the day view from the corrected block model (A1–A3).**
  Replace the header stat line with tracked/work/leisure split. Move score/drift
  out of the primary position (keep it lower in the shape panel for the curious).

**B2. "What mattered" excludes leisure**
- **Should.** Only sustained **work** threads appear, titled humanly. *Example:*
  "Daylens timeline rework · 1h52m", not "Netflix" or "Uncategorized".
- **Now.** Netflix and X (Twitter) in "What mattered" (Jun16); "Uncategorized"
  and "UOS Server"/"Starlink" surfaced (Jun17)
  (`timeline-day-jun16-*`, `timeline-today-cursor-*`).
- **Gap.** Direct PMF violation ("leisure never in mattered").
- **Fix.** **Patch** the "mattered" selection to filter to `kind === work` and
  drop system/uncategorized; pull titles through the humanizer + intent subject.

**B3. Re-analyze honors the Settings model**
- **Should.** "Re-analyze with AI" runs the single provider/model chosen in
  Settings and refreshes the day synthesis from corrected blocks.
- **Now.** Founder: it runs **Gemini** while Settings shows Claude Haiku; UI
  stuck on "Re-analyzing…" (`timeline-day-jun16-*`). *(Mechanism founder-reported;
  exact wiring `UNVERIFIED — needs live test`.)*
- **Gap.** The user's provider choice is a lie; output voice/quality is
  unpredictable; cost/privacy expectations broken.
- **Fix.** **Centralize provider resolution** so every AI entry point (chat,
  re-analyze, apps "Generate", week review, briefs) reads one resolved config.
  Remove any hardcoded provider in the synthesis path.

**B4. Week view: legend + consistent totals + honest "Main mode"**
- **Should.** Stacked week bars carry a category legend; the week total on the
  card equals the total in the review text; "Main mode" reflects the dominant
  **work** mode (or honestly says the week was mostly leisure if it truly was).
  Empty weekdays say why (weekend / laptop off) when known.
- **Now.** Top bars have no legend (legend only on the day-row); card 20h7m vs
  review 20h53m; "Main mode: Entertainment" for a founder
  (`timeline-week-jun15-21-*`, `timeline-week-jun1-7-*`, `timeline-week-jun8-14-*`).
- **Gap.** Inconsistent totals + entertainment-as-headline kill the weekly recap
  as something you'd open.
- **Fix.** **Single week-aggregate** feeding card, bars, and review (compute
  once, pass down). Add the legend to the bar chart. Compute "Main mode" over
  **work** kind, with a separate "leisure" readout, so the headline is your work
  mode.

**B5. Edits with confirmation**
- **Should.** Rename/merge/hide apply instantly with a visible confirmation
  (toast or inline state change) and persist across reload.
- **Now.** Controls exist; "no UX feedback unless you look closely"; names still
  wrong after rename (`timeline-today-merge-down-fix-episode-panel.png`).
  `UNVERIFIED — needs live test` for persistence.
- **Gap.** User can't tell if a correction took, so they stop correcting.
- **Fix.** **Patch** edit handlers to emit confirmation + optimistic update;
  verify the corrected label/kind sticks in the block review state and overrides
  re-analysis.

### C. Apps view

**C1. App name is the title**
- **Should.** The bold title is always the real app (Safari, Dia, Cursor,
  Comet); the category is a quiet badge; an AI summary/artifact is body text, not
  the title. *Example:* "**Safari** · Browsing · 29h 26m" — never "**Development**
  · Safari".
- **Now.** 7d uses the **category** as title ("Development" over Safari); 30d
  uses a **raw content title** ("Divided States of America Part 1 (full
  documentary)" over Safari) — two different wrong schemes
  (`apps-7d-safari-named-development.png`, `apps-30d-safari-119h-domains.png`).
- **Gap.** The list isn't scannable as "apps"; the same app looks like two
  different things depending on the period.
- **Fix.** **Rewrite the list item** to a fixed hierarchy: app name (humanized) →
  category badge → time/sessions. Period changes only the numbers, never the
  title scheme.

**C2. Correct domain → app attribution**
- **Should.** Each domain's time is attributed to the browser that actually
  hosted it; an AI-tool app (Dia) doesn't absorb Netflix/YouTube.
- **Now.** Netflix/YouTube/X listed under Dia ("AI tools") and the same domains
  also under Safari (`apps-7d-dia-wrong-domain-attribution.png`).
- **Gap.** Domain time is double-counted / mis-homed, so per-app totals and
  categories are wrong.
- **Fix.** **Fix attribution at aggregation**: a website session belongs to the
  foreground browser at that time; non-browser apps get no domain rows. Feeds C3.

**C3. App category from real usage**
- **Should.** Safari that is 80% YouTube/Netflix is not headlined "Browsing" as
  if neutral — it reflects leisure-dominant use; Dia categorized from what it
  actually hosted.
- **Now.** Safari = "Browsing" though dominated by entertainment; Dia = "AI
  tools"/"Browsing" though mixed (`apps-7d-*`, `apps-30d-*`).
- **Gap.** Category is decorative, not informative; contributes to leisure being
  invisible.
- **Fix.** **Derive the displayed category** from time-weighted `kind`/domain
  policy (reuse `workKind.ts`), and show a small work/leisure split on the app
  detail.

**C4. Detail renders without AI; pages deduped**
- **Should.** Time, domains, and a deduplicated pages-visited list render with no
  "Generate"; "Generate" only adds an optional blurb. *Example:* `loginwindow`
  either doesn't appear (A3) or shows "System process — not tracked", never
  "needs more context".
- **Now.** `loginwindow` detail near-empty with "needs more context"
  (`apps-7d-loginwindow-empty-without-ai.png`); duplicate "Netflix" / repeated
  `netfilm.world` rows (`apps-7d-safari-pages-visited-list.png`).
- **Gap.** The view looks broken/empty and repeats itself.
- **Fix.** **Patch** detail to always render structured data; **dedupe** pages by
  normalized URL/title with summed time and visit counts; **humanize** page
  titles.

**C5. "Generate summary" quality**
- **Should.** Accurate period blurb, no duplicate artifacts, humanized titles,
  honoring the Settings model.
- **Now.** "Netflix, Netflix" duplicates; long raw titles
  (`apps-7d-safari-named-development.png`).
- **Gap.** Reads as low-quality AI slop.
- **Fix.** **Patch** the summary input to use deduped, humanized artifacts and
  the centralized provider (B3).

### D. AI tab / Q&A

**D1. Grounded "today" answer (parity with week)**
- **Should.** "What did I work on today?" returns a chief-of-staff answer with
  HH:MM ranges drawn from today's blocks — never an apology, never a request to
  paste data. *Example:* "Today (5h 24m tracked): **Daylens timeline rework**
  09:12–11:40 (Cursor, Ghostty); **standup** 11:45–12:05 (Meet); afternoon was
  mostly YouTube. Want it as a checklist?"
- **Now.** Apology: "I don't have the tool results… share the getDaySummary
  output again" (`ai-todays-work-no-tool-results.png`) — *while the week path
  returns a full per-day breakdown* (`ai-7-days-detailed-day-breakdown.png`),
  proving the data layer works for ranges but the **today** tool result isn't
  reaching the model.
- **Gap.** The single most-important question fails.
- **Fix.** **Fix the today tool-result plumbing** so the day payload is injected
  into context the same way the week path is; **forbid the "ask the user to paste
  data" response** in the system prompt; ensure the existing timeline fallback
  actually fires instead of apologizing.

**D2. Tables for tabular data**
- **Should.** Per-day and per-project breakdowns render as Markdown tables when
  the data is tabular. *Example:* a `Day | Tracked | Focus | Top work` table for a
  week summary.
- **Now.** Always prose or bullets, even on explicit "i need detail"
  (`ai-7-days-summary-prose-no-tables.png`, `ai-7-days-detail-bullets-not-table.png`).
- **Gap.** Dense data is unreadable; "report"/"detail" requests underdeliver.
- **Fix.** **Patch** the system prompt + renderer to use tables for structured
  breakdowns, and confirm the chat Markdown renderer supports tables.

**D3. "Turn into…" operates on the prior answer**
- **Should.** Each transform reformats the **previous grounded answer** without
  re-querying or refusing. *Example:* "Turn into bullets" on a today summary
  yields a bulleted version.
- **Now.** Refuses: "that's a request for data, not a summary of captured work"
  (`ai-todays-work-turn-into-bullets-fails.png`) — because D1 produced a non-answer
  to transform.
- **Gap.** A headline feature is dead whenever the base answer is broken.
- **Fix.** Mostly **falls out of D1** (transform a real answer). Additionally,
  **patch** the transform to operate purely on prior assistant text and never
  re-litigate whether it's "data".

**D4. Project/client attribution**
- **Should.** When clients exist, work is attributed to them; when none exist,
  the answer offers to set them up but still gives a useful inferred breakdown.
- **Now.** "No projects attributed in Daylens yet" (`ai-7-days-by-project-...`).
- **Gap.** "by project" questions can't be answered.
- **Fix.** **Build the clients feature** (E2) + an attribution resolver mapping
  blocks → client by app/domain/intent; until set up, infer from intent subjects
  rather than declaring nothing.

**D5. Chat persistence & generation safety**
- **Should.** Chat history is durable across tab switches and navigation; the
  sidebar always reflects stored chats; switching chats mid-generation cancels or
  detaches the in-flight request cleanly; input is enabled or clearly locked with
  a cancel.
- **Now.** Sidebar "No chats yet" after navigation; switching mid-generation
  empties the chat, hides the sidebar, disables input; "Thinking" can hang
  (`ai-new-chat-empty-sidebar.png`, `ai-chat-sidebar-with-history.png`,
  `ai-summarize-7-days-thinking-state.png`, founder).
- **Gap.** The chat surface feels broken and loses the user's work.
- **Fix.** **Rewrite chat state management**: persist chats to local store as
  source of truth; load sidebar from store independent of the active view;
  per-chat request lifecycle with cancel-on-switch; bounded generation with a
  visible cancel and timeout.

**D6. Voice**
- **Should.** Calm chief-of-staff who knows your day; never apologetic, never
  meta, never asks the user to do the app's job.
- **Now.** Apologetic/meta (`ai-todays-work-no-tool-results.png`).
- **Fix.** **Rewrite the system prompt/voice contract**; pair with D1 so it has
  real data to be confident about.

### E. Settings & configuration

**E1. One provider/model, honored everywhere** — see B3. **Done when** switching
the Settings model demonstrably changes chat, re-analyze, apps Generate, week
review, and briefs.

**E2. Clients / projects**
- **Should.** Add named clients with colors; map apps/domains/intent subjects to
  a client; AI and wraps attribute work to them. *Example:* add "Acme"; "how much
  did I work on Acme this week?" answers from mapped blocks.
- **Now.** "No clients yet"; AI reports no projects.
- **Fix.** **Build** client CRUD + a resolver + attribution surfaced in AI/wraps.

**E3. Work memory that actually learns**
- **Should.** Patterns improve naming/category with varied, earned confidence;
  not everything is "browsing".
- **Now.** **All 19 patterns are tagged "browsing" at an identical 65%
  confidence** — including Microsoft Teams, Claude, a Google-Docs report, and
  Apple Developer Documentation (`settings-work-memory-learned-patterns.png`).
- **Gap.** Memory is actively wrong; it can only push labels toward "browsing",
  which matches the timeline's mis-categorization.
- **Fix.** **Rewrite pattern classification** to assign category from the same
  `kind`/domain/app logic and to compute real confidence from occurrence/recall;
  add a one-time **rebuild** that re-derives existing patterns. Treat memory as a
  refinement on top of correct base categorization, never the source of the
  "browsing" default.

**E4. Per-app label overrides take effect** — overrides must propagate to Apps +
Timeline aggregates retroactively (Dia override currently doesn't fix the Apps
title). **Fix:** apply overrides at the same aggregation layer as A2/C1.

### F. Morning brief (the wedge) — `UNVERIFIED — needs live test`

- **Should.** One screen: greeting; one **carryover line** from
  `facts.carryover[0]` ("The malaria notebook was still open — pick it up?") or
  "Nothing left open — clean start."; one link "See yesterday" → timeline. The
  notification body leads with carryover, not shape-of-day. No carousel.
- **Now.** PMF/founder: a 3–4 slide carousel with category-identity/video-bg
  slides; fallback copy uses focus%/peak heuristics that ignore `facts.carryover`.
- **Gap.** It's a slideshow, not a "pick up where you left off" glance; the wedge
  doesn't land.
- **Fix.** **Rewrite the morning view** to the one-screen model; **delete**
  slides 1–3; render from `getWrappedNarrative()` facts only; **remove**
  `morningLead`/`morningNudge` heuristics; switch the notification body to
  `narrative.nudge` (carryover). Requires A–B trust so the carryover thread is
  real.

### G. Evening wrap — `UNVERIFIED — needs live test`

- **Should.** ≤5 calm cards from `WrappedFacts`/`aiSlides`: (1) shape, (2) what
  you worked on (only if work ≥~15m), (3) where time went, (4) open thread (only
  if carryover), (5) quiet close. A leisure day collapses to 2 cards (shape +
  close). No guilt/distraction slides.
- **Now.** PMF/founder: 8-slide deck (Scale → Focus → Peak → TopApp → …); the
  5-card model in `wrappedNarrative.ts` is unused.
- **Gap.** Too long, includes focus lectures, can contradict a rest day.
- **Fix.** **Rewrite the evening branch** to render the existing 5-card fallback /
  AI slides; keep `hasDistractionData = false`; conditionally drop cards.

### H. Daily / weekly / monthly / annual wraps

- **Daily (side panel):** = B1/B2 corrected shape-of-day.
- **Weekly:** = B4. **Should:** a review you'd open, totals consistent with the
  card, leisure separated.
- **Monthly:** `UNVERIFIED`. **Should:** month patterns (busiest days, top
  projects, work/leisure ratio). **Fix:** build on the corrected aggregates after
  daily/weekly trust; defer until Phase 6.
- **Annual:** not built; **defer** (out of scope for the wedge).

### I. Notifications

- **Should.** Morning fires with the carryover line; evening fires after a
  threshold of tracked work with the calm wrap; distraction alerts optional
  (default off). Tapping opens the right surface.
- **Now.** Toggles present; delivery/content `UNVERIFIED — needs live test`.
- **Fix.** After F/G, **verify** delivery on a real day and that bodies match the
  new briefs.

### J. Onboarding & trust — `UNVERIFIED — needs live test`

- **Should.** First run explains the value, requests macOS permissions
  (screen-recording/accessibility as needed), starts capture, and shows a "your
  first day will fill in" state. **Trust bar:** the user can stake a client answer
  on the timeline/AI.
- **Now.** Not observed; trust bar fails today by every section above.
- **Fix.** **Audit onboarding live** (open item); trust is earned by A–G, not a
  separate feature.

---

## User Stories

1. As a founder, I want one work stretch to be one block, so my day reads like a
   calendar instead of 50 fragments. *(A1)*
2. As a founder, I want a coding block to stay "Development" when I glance at
   Netflix for 40 seconds, so the record matches reality. *(A2, B1)*
3. As any user, I want the duration in the list, the detail panel, and the app
   rows to be the same number, so I trust what I read. *(A2)*
4. As a user, I never want "loginwindow" counted as 16 hours of activity, so my
   totals mean something. *(A3)*
5. As a privacy-conscious user, when I turn on "Limit what's tracked" and add an
   app, I want it actually excluded. *(A4)*
6. As a founder, I want leisure (Netflix, X) kept out of "What mattered" and out
   of focus tallies, so the day's headline is my work. *(B2, C3)*
7. As a user, I want "Re-analyze" to use the model I picked in Settings, so the
   voice and cost are what I chose. *(B3, E1)*
8. As a user, I want the week chart to have a legend and the week total to match
   its own review text. *(B4)*
9. As a founder, I want "Main mode" to reflect my work, not "Entertainment". *(B4)*
10. As a user, I want a rename/merge to visibly confirm and stick. *(B5)*
11. As a user, I want the Apps list to show the real app name as the title in
    every period. *(C1)*
12. As a user, I want Netflix attributed to my browser, not to my AI tool. *(C2)*
13. As a user, I want app detail (time, domains, deduped pages) without pressing
    Generate. *(C4)*
14. As a founder, I want "What did I work on today?" answered with real times,
    never an apology asking me to paste data. *(D1, D6)*
15. As a user, I want per-day/per-project breakdowns as tables, not walls of
    text. *(D2)*
16. As a user, I want "Turn into bullets/checklist/report" to reformat the
    answer I just got. *(D3)*
17. As a consultant, I want to define clients and ask "how much did I work on
    Acme this week?". *(D4, E2)*
18. As a user, I want my chat history to survive switching to Apps and back, and
    switching chats mid-generation not to wipe everything. *(D5)*
19. As a user, I want "Summarize 7 days" to finish or let me cancel, not hang on
    "Thinking". *(D5)*
20. As a user, I want work memory to learn varied categories, not tag everything
    "browsing" at 65%. *(E3)*
21. As a returning user, I want the morning notification to name what I left open
    yesterday and open it in one tap. *(F)*
22. As a user closing the laptop, I want a short honest evening wrap that matches
    my timeline, with no focus lecture on a rest day. *(G)*
23. As a first-time user, I want onboarding that explains capture and grants
    permissions. *(J)*
24. As any user, I want morning brief, evening wrap, and `/ai` to give the same
    answer to the same question. *(D1, F, G)*
25. As a founder, next Tuesday I want to answer what I did last Thursday from
    Daylens, not memory. *(all)*

---

## Implementation Decisions

| Area | Exists | What's wrong | Target | Verdict |
|---|---|---|---|---|
| Segmentation (`workBlocks.ts`) | Yes (large) | Over-splits; lets short leisure flip kind; multiple duration derivations | One block per focused stretch; one duration definition; kind hard-cut only on sustained leisure | **Rewrite** the policy; reuse the file |
| `kind` axis (`workKind.ts`) | Yes, sound | Computed but not driving the UI tag or "mattered" | Make it the source of the displayed tag, "mattered" filter, focus tally, Apps category | **Modify** consumers, not the module |
| Humanizer (`humanize.ts`) | Yes, good | Not applied on every surface (Apps titles, pages, mattered) | One pass on every user-facing title | **Wire in** at all render points |
| Capture ingest | Yes | No system-process denylist; exclusions unwired | Denylist + working exclusion lists at ingest | **Modify/replace** filter |
| Day aggregation | Yes | Inconsistent totals across renderers | One aggregate object feeding header/blocks/shape | **Rewrite** aggregation seam |
| Week aggregation (`recap.ts`) | Yes | Card vs review mismatch; no legend; entertainment headline | One week aggregate; legend; work-based main mode | **Rewrite** aggregation; modify UI |
| Provider resolution | Yes (multi-provider) | Re-analyze/others bypass Settings model | One resolver every AI path reads | **Refactor** to centralize |
| AI tool plumbing (`aiService.ts`) | Yes; week works | "today" tool result not reaching model; voice apologetic | Inject day payload like week; forbid "paste data"; tables | **Patch** today path + prompt |
| Chat state (`useAIChat.ts`/store) | Yes | History tied to view; unsafe mid-gen switch; hangs | Persisted store as source of truth; per-chat lifecycle; cancel/timeout | **Rewrite** state layer |
| Clients/projects | UI stub only | Empty; no resolver | CRUD + attribution resolver | **Build** |
| Work memory patterns | Yes | All "browsing" @65% | Category from kind logic; real confidence; rebuild | **Rewrite** classification |
| Morning brief (`DayWrapped.tsx`) | Carousel | Slideshow, ignores carryover | One screen from facts | **Rewrite** branch |
| Evening wrap (`DayWrapped.tsx`) | 8-slide | Unused 5-card model | ≤5 cards from facts | **Rewrite** branch |
| Notifications (`dailySummaryNotifier.ts`) | Yes | Body uses shape, not carryover | Carryover-first body | **Patch** |

**Prototype — the one block aggregate every surface reads** (encodes A2/B1/B4):

```ts
// One computed truth per block; renderers format, never re-derive.
interface BlockView {
  id: string
  startMs: number
  endMs: number
  activeSeconds: number          // THE duration. list = detail = Σ apps
  kind: 'work' | 'leisure' | 'personal' | 'idle'   // drives the tag
  category: AppCategory          // shown as a quiet badge, must agree with kind
  title: string                  // already humanized; never a raw URL/filename
  intentSubject: string | null   // populated for work → carryover & "mattered"
  apps: Array<{ name: string; category: AppCategory; activeSeconds: number }>
  domains: Array<{ host: string; friendly: string; activeSeconds: number }>
  isSystemNoise: boolean         // loginwindow etc. → excluded from aggregates
}
// "What mattered" = blocks where kind==='work', by activeSeconds, titled by
// intentSubject||title. Focus tally sums kind==='work' only. Leisure split shown
// separately. Day/week totals are Σ of the SAME activeSeconds.
```

---

## Testing Decisions

External-behavior tests that prove **Should** and would have caught the
screenshots. Per PMF, fixture eval ≠ product truth, so each phase also has a
**live-app acceptance check** the building agent performs.

**Automated (regression guards on real-shaped fixtures):**
1. **Dogfood fixtures.** Export ≥1 real founder day and a founder week into
   `tests/timeline-eval/fixtures/`; assert: no block mixes sustained coding +
   sustained Netflix; leisure absent from "mattered"/carryover; every title
   passes the humanizer (no raw filename/URL/`loginwindow`).
2. **Duration invariant.** For every block: `list duration == detail duration ==
   Σ app activeSeconds` (would catch 37m≠21m).
3. **Kind/tag invariant.** Displayed tag == `dominantKind`-derived category;
   a block with 95% dev + 5% leisure tags DEVELOPMENT (would catch ENTERTAINMENT
   on Cursor).
4. **System-noise.** `loginwindow`/`UserNotificationCenter` never appear in app
   aggregates or "Often used with".
5. **Week consistency.** Week card total == review-text total == Σ day totals
   (would catch 20h7m vs 20h53m).
6. **Apps title invariant.** List title == humanized app name across Today/7d/30d
   (would catch "Development"/documentary-title-as-title).
7. **Domain attribution.** A leisure domain's seconds attribute to the foreground
   browser, never to a non-browser app (would catch Netflix-under-Dia).
8. **Provider routing.** With Settings=ProviderX, every AI entry point's resolved
   config == ProviderX (would catch Gemini re-analyze).
9. **AI today path.** Given a fixture day, "what did I work on today?" yields an
   answer containing HH:MM ranges and **no** apology/"paste data" string.
10. **Tables.** A week-summary request renders a Markdown table for the per-day
    breakdown.
11. **Memory classification.** Rebuilt patterns are not all "browsing"; a Teams
    pattern is communication, a Claude pattern is aiTools (would catch the 65%
    monoculture).
12. **Chat persistence.** Create chat → navigate away → return: chat still
    listed; switch chat mid-generation: no crash, prior chat intact.

**Live-app acceptance (per phase, run the app):**
- Open yesterday: every block's tag/title/duration believable; header shows
  tracked/work/leisure; no correction needed before reading.
- Morning notification names a real open thread (or honestly says none); one tap
  opens it.
- Evening wrap ≤5 cards, matches the timeline, no focus lecture on a rest day.
- Switch Settings model → re-analyze a day → output voice changes accordingly.
- `/ai` "what did I work on today/last week?" matches the timeline and the wraps.

---

## Build sequence (for autonomous execution)

Each phase has acceptance criteria the building agent confirms **by running the
app** before moving on.

**Phase 0 — Dogfood harness & truth baseline.**
Export a real founder day + week to fixtures; stand up tests 1–7 above (initially
failing). *Accept when:* fixtures load and the invariant tests run (red is fine);
the agent can launch the app and open a specific past day.

**Phase 1 — Trust the record (capture + block model).** *(PMF Phase 1; the gate.)*
A1 segmentation, A2 one-duration/kind-driven tag, A3 system-noise exclusion, A4
exclusions wired; the `BlockView` aggregate; humanizer on every title; B1 day
header; B2 leisure out of "mattered". *Accept when:* on the founder's real
yesterday — coding and Netflix are separate blocks; no block's tag contradicts
its content; list/detail/app durations agree; no `loginwindow`; "mattered" has no
leisure; titles are human. Tests 1–4 green.

**Phase 2 — Morning brief (the wedge).** F + carryover-first notification (I).
Depends on Phase 1 (carryover must be real). *Accept when:* the morning
notification names a real open thread from yesterday (or "clean start"), and one
tap shows it on the timeline — no carousel.

**Phase 3 — Evening wrap.** G (5-card model). *Accept when:* opening the evening
wrap after a work day shows ≤5 cards that match the timeline; a leisure day shows
2 cards; no distraction/guilt slide.

**Phase 4 — Apps view + week consistency.** C1–C5, B4, E4. *Accept when:* the
same app shows the same title across periods; Netflix isn't under Dia; pages
deduped; week card total == review total; week bars have a legend; "Main mode"
reflects work. Tests 5–7 green.

**Phase 5 — AI Q&A alignment.** Provider centralization (B3/E1), D1 today path,
D2 tables, D3 transforms, D5 chat persistence, D6 voice; E3 memory rebuild.
*Accept when:* "what did I work on today?" answers with times (no apology);
"summarize last 7 days" returns a table and finishes/cancels; "turn into bullets"
works; chat survives navigation; switching the Settings model changes every AI
surface; rebuilt memory isn't all "browsing". Tests 8–12 green.

**Phase 6 — Clients + parity + later wraps.** E2 clients + D4 attribution; verify
morning/evening/`/ai` agree (test parity); monthly wrap on corrected aggregates.
*Accept when:* a defined client answers "how much did I work on X this week?";
the three surfaces agree on the same question.

> Sequencing rationale: Phases 1→2→3 are the PMF spine (trust → morning →
> evening). Apps/AI/clients are valuable but inherit Phase-1 trust, so they come
> after. This matches `daylens-PMF.md` ("This week: Phase 1 + Phase 2").

---

## Out of Scope

- **Annual wrap** — not built; defer past the wedge.
- **Calendar / email integrations** — different product layer; not needed for
  laptop-memory PMF.
- **New capture sources** (mobile, browser-extension telemetry) — capture isn't
  the gap.
- **Distraction alerts** beyond keeping the existing toggle (default off) — guilt
  framing is explicitly out per PMF.
- **MCP server expansion** — leave as-is (partial) unless it blocks a phase.
- **Re-skinning / visual redesign** beyond what truth requires (legend, header,
  card counts).

---

## Further Notes

- **Single biggest leverage:** the `BlockView` aggregate (one duration, one kind,
  one humanized title). Almost every screenshot defect is a *consumer* reading a
  different derivation than its neighbor. Fix the seam once and timeline, apps,
  shape-of-day, week, briefs, and AI all stop contradicting each other.
- **The backend is more right than the surface.** `workKind.ts` and `humanize.ts`
  are sound; `wrappedNarrative.ts` already has the 5-card model. v2 is largely
  *wiring the good backend to the surface and deleting the legacy heuristics that
  shadow it* — consistent with "fix the existing app, not greenfield".
- **Things I could not verify (open, need live test):** morning carousel vs
  one-screen; evening 8-slide vs 5-card; notification delivery & bodies; the exact
  re-analyze→Gemini wiring; onboarding/permissions flow; monthly wrap; whether
  rename/merge persist; incognito-skip behavior. All are marked inline and should
  be confirmed by driving the app in Phase 0–1.
- **Evidence caveat:** screenshots are dated mid-June 2026 on app v1.0.44; if the
  building agent's app differs, re-screenshot before trusting these "Now" cells.
- **Don't trust green tests as product truth** (PMF rule). The dogfood day, not
  the fixture suite, is the bar for "works".
```
