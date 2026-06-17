# Daylens v2 — final plan (Round 3, council assembly)

> **How this was built.** This is the Round-3 assembly. Four agents (`claude`,
> `codex`, `cursor`, `gemini`) each wrote a plan (Round 1) and scored all four
> (Round 2). For every surface, this plan pulls the Should/Now/Gap/Fix from the
> plan the council rated highest, merges in the specific additions the council
> named, applies every drop the council agreed on, and adds — as open work — every
> gap the council flagged that no plan covered. The per-surface provenance is noted
> inline as *(council: winner + merges)*. This is mechanical: it follows the
> council, it does not out-think it.
>
> **Truth rule (from the handoff).** The code can only explain *why* something
> fails. A feature is "works" **only** with screenshot or live-app proof. Green
> `npm test` / `timeline:eval` is **not** product truth. Every "Now" below is
> backed by a screenshot, a founder report, or marked `UNVERIFIED — needs live
> test`. Nothing is labeled **works** on code-reading alone.
>
> **Evidence caveat — codex live-app facts.** One agent (`codex`) reported a live
> Electron audit (`npm start`, `localhost:5173`) and observed facts no other agent
> could reproduce: a **Gemini quota** error on re-analyze while Settings = Claude
> Haiku 4.5; **Safari 39 sessions / 59m today** (vs 5,977 / 7d in screenshots);
> an **8h3m + 7h12m** gap pair on Jun 16; chat history gone after Apps → AI.
> Two of three other agents could not drive the GUI, so these are credited but
> labeled **"verify before relying"** — not promoted to ground truth.

---

## Problem Statement

*(council: claude — six enumerated, screenshot-anchored failures; opened with codex's chain-reaction frame)*

Daylens is supposed to be **automatic work memory for your laptop**: a trustworthy
calendar of what you actually did, with briefs and Q&A you'd open without
prompting. Most surfaces are built. **The product failure is not missing UI — it
is that every downstream surface depends on an untrusted reality layer.** Capture
produces fragmented or misclassified blocks; timeline, Apps, AI, memory, briefs,
and reviews all inherit those bad labels in a chain reaction. The user cannot
trust a single number on the screen, and trust is the entire product.

Concretely, from the user's seat:

1. **The record contradicts itself.** A block titled "Cursor: AI coding agent" is
   tagged **ENTERTAINMENT** and described as "Spent 21m watching Netflix"
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
   30d (`apps-30d-safari-119h-domains.png`) — two different wrong schemes. Blocks
   are "Untitled block", "Development", or a raw page title ("iPhone 12 Wi"). The
   humanizer exists; the surface doesn't use it consistently.

4. **The AI can't answer the one question the app is for.** "What did I work on
   today?" returns an apology — *"I don't have the tool results… could you share
   the getDaySummary output again?"* (`ai-todays-work-no-tool-results.png`) — then
   refuses to reformat its own non-answer
   (`ai-todays-work-turn-into-bullets-fails.png`). It asks the user to do the
   app's job. *(Note: the **week** path actually returns a detailed per-day HH:MM
   breakdown — `ai-7-days-detailed-day-breakdown.png` — so the data layer works
   for ranges; the **today** tool result and tables/attribution are what fail.)*

5. **The briefs aren't the PMF briefs.** Per `daylens-PMF.md`, morning is still a
   3–4 slide carousel and evening an 8-slide deck, while the 5-card calm model
   already defined in `wrappedNarrative.ts` is never rendered. *(Code/founder
   described; `UNVERIFIED — needs live test`.)*

6. **Capture over-collects and under-segments.** `loginwindow` is tracked as a
   16h–50h "app" (`apps-7d-loginwindow-empty-without-ai.png`); Safari shows 5,977
   sessions in 7 days; one work stretch fragments into duplicate consecutive
   "Development" blocks (`timeline-today-afternoon-duplicate-development-blocks.png`)
   while a 42-second Netflix tab flips a whole coding block to leisure.

Net: **the product works in fixtures and fails on a real day.** A founder,
consultant, or eng lead cannot stake a client update or weekly reflection on this
record yet. v2 is not new features — it's making the existing surfaces tell the
truth so the user nods instead of correcting.

---

## Solution

*(council: claude's spine + codex's trust-state framing)*

Daylens v2 is the PMF vision **made boringly dependable on the founder's own
machine**:

- One **block model** with sensible boundaries and a single source of truth for
  duration, kind (work/leisure/personal/idle), category, and title — so every
  surface (timeline, apps, shape-of-day, briefs, AI) reads the *same* numbers.
- **`kind` drives the surface**, not just the backend: leisure is visually
  separated, never counted as focus, never in "mattered"/"carryover".
- **One humanizer on every title**, everywhere, with the real app name always
  legible.
- A **morning brief = one screen** ("what you left open → pick it up") and an
  **evening wrap = ≤5 calm cards**, both rendered from the same facts spine.
- **AI Q&A grounded in that same spine** — resolver-first answers to
  today/week/project/time-at-moment/forgotten-link questions, with times and
  tables, never asking the user to paste data, with chat history that survives
  navigation.
- **One provider/model** from Settings honored by *every* AI surface (chat,
  re-analyze, summaries, briefs, Apps Generate).
- **Capture that excludes system noise** and segments by work focus, so the blocks
  underneath all of the above are believable.
- **Trust is a product surface**: the user can always tell what is inferred,
  low-confidence, corrected-by-you, hidden, excluded, paused, future, or
  provider-unavailable — and a correction the user makes is never silently
  overwritten by re-analysis.

The build strategy starts with **trust, not novelty**: make one real week of
timeline data trustworthy, then attach corrections, morning, evening, Apps, AI,
and wraps to that same fact spine. The bar is the PMF "How you know" list: open
yesterday's timeline and nod; the morning brief names a real open thread; the
evening wrap matches the timeline; `/ai` agrees with both; next Tuesday you can
answer what you did last Thursday — from Daylens, not memory.

---

## Feature map (Should vs Now)

*(council: codex backbone — broadest coverage — with claude's [CORRECTED] rows, cursor's added rows, and gemini's locked-edit row folded in. Drops applied: AI-week = partial not broken; Thu–Sun = future-day not broken; exclusions = partial not "engine broken"; 30d titles still wrong; annual = UNVERIFIED not "not built"; live-block indicator = partial not missing.)*

Status: **works** · **broken** · **untrusted** · **partial** · **missing** · **UNVERIFIED**

### Capture & tracking

| Feature | Should (v2) | Now (today) | Status | Evidence |
|---|---|---|---|---|
| Activity → blocks | One work stretch = one block; real breaks split; minimal fragmentation | Duplicate consecutive "Development" blocks; 50 blocks/day; 8h+ gaps | broken | `timeline-today-afternoon-duplicate-development-blocks.png`, founder |
| Block boundaries by focus | A 42s leisure tab inside coding does **not** flip the block; dominant intent controls | 21m/42s Netflix inside a Cursor stretch flips it to ENTERTAINMENT | broken | `timeline-today-cursor-block-tagged-entertainment.png` |
| Duration accuracy | List span = detail "spent" = Σ app activeSeconds, one definition | 37m span vs 21m "spent" vs ~19m app sum on one block | broken | `timeline-today-duration-mismatch-37m-vs-21m.png` |
| System-noise exclusion | `loginwindow`, `UserNotificationCenter`, `Finder`, screensaver never surface as apps or count as time | `loginwindow` = 16h–50h; in "Often used with" | broken | `apps-7d-loginwindow-empty-without-ai.png`, `apps-7d-unifi-server-detail.png` |
| Tracking exclusions actually apply **[CORRECTED]** | Toggle ON + lists → those apps/sites excluded everywhere; OFF → all tracked | Toggle is **ON** but the excluded lists are **empty** — i.e. no user config yet, *not* proof the engine fails. System noise still dominates | partial | `settings-tracking-exclusions-privacy.png` |
| Session counts | Plausible counts; a defined micro-session merge threshold | Safari 5,977 / 7d; Dia 5,893 — inflated; codex live: Safari 39 sessions / 59m today *(verify)* | untrusted | `apps-7d-safari-named-development.png`, live Apps |
| Untracked gaps | Minimized; labeled idle / asleep / paused / permission-limited | "Untracked gap 8h11m" / "6h6m" as bare lines | broken | `timeline-today-*`, `timeline-day-jun16-*` |
| Incognito skip | Private windows not recorded | Toggle on; behavior unconfirmed | UNVERIFIED | `settings-tracking-exclusions-privacy.png` |
| Pause tracking | Clearly pauses capture; timeline gap marked "paused" | Toggle exists, off | UNVERIFIED | `settings-tracking-exclusions-privacy.png` |
| Live block indicator **[CORRECTED]** | Current activity block clearly marked | A **LIVE** tag is shown on the afternoon block — present, not missing | partial | `timeline-today-afternoon-duplicate-development-blocks.png` |

### Timeline / calendar

| Feature | Should (v2) | Now | Status | Evidence |
|---|---|---|---|---|
| Day block tag = kind-aware category | Tag reflects dominant **kind**; coding stays DEVELOPMENT despite a leisure blip | "Cursor" → ENTERTAINMENT; "Claude Code" → BROWSING | broken | `timeline-today-cursor-*`, `timeline-today-afternoon-*` |
| Block titles | Human title = what you did | "Untitled block", "Development", "iPhone 12 Wi", "https://x.com" | broken | `timeline-day-jun16-*`, `timeline-today-*` |
| "What mattered" excludes leisure | Only sustained work threads; leisure never appears | Netflix and X listed in "What mattered" | broken | `timeline-day-jun16-reanalyze-shape-of-day.png` |
| Shape-of-day inputs | Focus/drift from trusted, kind-correct blocks; no score up front | Score 71 / Focused 4h / Drift 3h37m built on mis-tagged blocks | broken | `timeline-today-cursor-*`, `timeline-day-jun16-*` |
| Re-analyze uses Settings model **[CORRECTED]** | Runs the single Settings-selected provider; recovers on failure | Founder + codex live: uses **Gemini** (quota error) while Settings = Claude Haiku; stuck "Re-analyzing…" *(verify)* | broken | `timeline-day-jun16-*`, `settings-ai-claude-haiku-connected.png`, live |
| Week chart legend | Stacked bars carry a category legend | Top week bars have **no legend** (legend only on the day-row) | broken | `timeline-week-jun15-21-*` vs `timeline-week-jun1-7-untitled-block-legend.png` |
| Week totals consistent | One week total everywhere | Card 20h7m vs review 20h53m | broken | `timeline-week-jun15-21-review-hours-mismatch.png` |
| Week "Main mode" | Reflects dominant **work** mode for a working user | "Entertainment" as headline mode | untrusted | `timeline-week-jun1-7-*`, `timeline-week-jun8-14-*` |
| Empty days = future vs missing **[CORRECTED]** | Future days render as future/empty intentionally; past missing days give a reason | Jun 15–21: Thu–Sun show "No data" — but on **Jun 17, 2026** those are **future** days, not a capture bug | partial | `timeline-week-jun15-21-no-data-checking-review.png` |
| Merge / rename / hide | Edits apply with visible confirmation, persist, and are immune to re-analysis | UI exists; no confirmation feedback; names still wrong after | untrusted | `timeline-today-merge-down-fix-episode-panel.png` |

### Apps view

| Feature | Should (v2) | Now | Status | Evidence |
|---|---|---|---|---|
| App title = app name **[CORRECTED]** | Real app name is the bold title (Safari, Dia, Cursor); category is a quiet badge | 7d: bold title is the **category** ("Development"); 30d: bold title is a **content/artifact title** ("Divided States of America Part 1…") — two different wrong schemes | broken | `apps-7d-safari-named-development.png`, `apps-30d-safari-119h-domains.png` |
| Period consistency | Same app reads consistently across Today/Day/7d/30d | Title scheme differs 7d vs 30d; daily often empty; codex live: Today names better *(verify)* | broken | founder, `apps-7d-*`, `apps-30d-*`, live |
| Detail without AI | Time, domains, deduped pages render without "Generate" | `loginwindow` near-empty "needs more context"; codex live: Safari "needs more context" *(verify)* | broken | `apps-7d-loginwindow-empty-without-ai.png`, live |
| Domains under correct app | A domain's time belongs to the browser that hosted it; non-browser apps get no domain rows | Netflix/YouTube/X under **Dia** ("AI tools") and Safari | broken | `apps-7d-dia-wrong-domain-attribution.png` |
| Pages visited deduped | Clean, deduplicated list, safe actions | Duplicate "Netflix"; repeated `netfilm.world`; delete icon on every row | broken | `apps-7d-safari-pages-visited-list.png` |
| Category of app | Reflects time-weighted use; entertainment-heavy Safari not neutral "Browsing" | Safari (mostly YouTube/Netflix) = "Browsing"; Dia mixed | untrusted | `apps-7d-*`, `apps-30d-*` |
| Generate summary quality | Accurate period blurb, no duplicate artifacts, humanized titles | "Netflix, Netflix" duplicates; long raw titles | broken | `apps-7d-safari-named-development.png` |
| Often used with | Real co-occurring apps, no system noise | Includes `UserNotificationCenter`, Siri | broken | `apps-7d-unifi-server-detail.png` |
| Delete domain / page (safety) **[NEW]** | Delete behind menu/confirmation; states blast radius + downstream invalidation; undo where possible | Trash icon on every row; safety/irreversibility unclear | broken | `apps-7d-safari-pages-visited-list.png` |
| Category filter pills | Filter by corrected category | Pills render | UNVERIFIED | `apps-7d-safari-named-development.png` |

### AI tab / Q&A

| Feature | Should (v2) | Now | Status | Evidence |
|---|---|---|---|---|
| Ask about **today** | Grounded answer with HH:MM, no apology | Apology: "I don't have the tool results… share getDaySummary output again" | broken | `ai-todays-work-no-tool-results.png` |
| Ask about **week** **[CORRECTED]** | Same grounded quality as today | **Returns** a detailed week answer incl. per-day HH:MM — the range data path works; only tables/projects/attribution are missing | partial | `ai-7-days-detailed-day-breakdown.png`, `ai-7-days-detail-bullets-not-table.png` |
| Tables / CSV for tabular data | Markdown tables for per-day/per-project; valid CSV export | Always prose/bullets; CSV prompt exists, unverified | broken / UNVERIFIED CSV | `ai-7-days-summary-prose-no-tables.png`, `ai-new-chat-empty-sidebar.png` |
| Forgotten-link / artifact recall **[NEW]** | "that link you saw but forgot" resolved from local history | No URL/page/artifact recall resolver exists | missing | `daylens-PMF.md` |
| Project attribution | Attribute to named clients; offer setup + inferred breakdown when none | "No projects attributed in Daylens yet" | broken | `ai-7-days-by-project-summary-no-projects.png` |
| "Turn into…" transforms | Reformat the previous grounded answer | Refuses: "that's a request for data, not a summary" | broken | `ai-todays-work-turn-into-bullets-fails.png`, `ai-todays-work-turn-into-menu.png` |
| Response voice | Calm chief-of-staff who knows your day | Apologetic, meta, asks user to paste data | broken | `ai-todays-work-no-tool-results.png` |
| Chat history persistence | Survives tab switches & navigation | Sidebar "No chats yet" after Apps → AI *(codex live, verify)*; gone mid-generation | broken | `ai-new-chat-empty-sidebar.png`, `ai-chat-sidebar-with-history.png`, live, founder |
| Switch chat mid-generation | Safe switch / cancel / background; UI never corrupted | Empty chat, sidebar gone, input disabled | broken | founder |
| Stuck "Thinking" | Bounded, cancelable, recoverable | "Summarize 7 days" sits on "Thinking" | partial | `ai-summarize-7-days-thinking-state.png` |
| Duplicate sidebar entries **[NEW]** | Each thread listed once | "Last 7 days by project" listed **twice** under TODAY | broken | `ai-chat-sidebar-with-history.png` |
| Model from Settings | All AI honors selected model | Header Claude Haiku; re-analyze uses Gemini | broken | `settings-ai-claude-haiku-connected.png`, founder |
| Suggested prompts | Quick starts that all work | Chips shown; "What did I work on today?" → apology | partial | `ai-new-chat-empty-sidebar.png` |
| Search chats ⌘K | Find past chats | UI present | UNVERIFIED | `ai-chat-sidebar-with-history.png` |

### Settings & configuration

| Feature | Should (v2) | Now | Status | Evidence |
|---|---|---|---|---|
| Provider + model | One provider; every surface honors it; provider errors name the selected provider + next action | Claude Haiku set & "CONNECTED"; not used by re-analyze (Gemini quota) | broken | `settings-ai-claude-haiku-connected.png`, live |
| Work memory patterns **[CORRECTED]** | Patterns improve naming/category with varied, earned confidence; show evidence + impact | **All 19 patterns tagged "browsing" at identical 65%** — incl. Teams, Claude, "malaria_group3_report_draft", Apple Developer Documentation | broken | `settings-work-memory-learned-patterns.png` |
| Per-app labels | Override sticks across Apps/Timeline/AI after recompute | Dia → "Browsing" override set, but Apps still mis-titles Dia | broken | `settings-labels-per-app-and-clients.png` |
| Clients / projects | Named clients; AI attributes work to them | "No clients yet"; AI says no projects | missing | `settings-notifications-clients-appearance.png`, `ai-7-days-by-project-summary-no-projects.png` |
| Notifications toggles | Morning/evening deliver the new briefs; deep-link to proof | Morning/Evening ON; Distraction OFF (10m). Delivery/content unverified | UNVERIFIED | `settings-notifications-clients-appearance.png` |
| Distraction alerts | Warn only on a clearly drifted work session; low false positives | Toggle off; threshold exists; no product proof | UNVERIFIED | `settings-notifications-clients-appearance.png` |
| Rebuild / consolidate memory | Visible outcome; reports what changed; forget removes a pattern | Buttons exist; outcome not visible | UNVERIFIED | `settings-work-memory-learned-patterns.png` |
| MCP server | Optional local query; off-by-default in packaged prod; env-aware paths | Enabled with **dev** Electron paths | partial | `settings-mcp-server-enabled.png` |
| Theme / appearance **[NEW]** | System/Light/Dark applies predictably | Present (Light); behavior unverified | UNVERIFIED | `settings-notifications-clients-appearance.png` |
| App updates **[NEW]** | Packaged builds update; dev builds explain the limit | "Check for updates"; v1.0.44; packaged-only auto-update | partial | `settings-mcp-server-enabled.png` |
| Analytics toggle **[NEW]** | Anonymous telemetry opt-in/out; local-only honored | On; "local-only" badge; behavior unverified | UNVERIFIED | `settings-tracking-exclusions-privacy.png` |
| Profile name / persona | Personalizes AI without leaking into facts | "tonny" set; impact unverified | partial | `settings-ai-claude-haiku-connected.png` |

### Wraps & briefs

| Feature | Should (v2) | Now | Status | Evidence |
|---|---|---|---|---|
| Morning brief | One screen: greeting + carryover line + "See yesterday" | PMF/founder/code-described: 3–4 slide carousel; fallback uses focus%/peak heuristics. **No live proof** | broken (PMF/code-described, live-unverified) | `daylens-PMF.md`, `UNVERIFIED — needs live test` |
| Evening wrap | ≤5 calm cards from facts spine; 2 cards on a leisure day; totals == day header | PMF/founder/code-described: 8-slide deck; 5-card model in `wrappedNarrative.ts` unused. **No live proof** | broken (PMF/code-described, live-unverified) | `daylens-PMF.md`, `UNVERIFIED — needs live test` |
| Daily wrap (side panel) | Honest shape from trusted blocks | "Shape of the day" exists; wrong inputs → leisure in "mattered" | broken | `timeline-day-jun16-*` |
| Weekly wrap | Consistent, openable review from frozen daily snapshots; fail-closed on incomplete data | Generate works; totals disagree; "checking…"/"no saved review" | broken | `timeline-week-*` |
| Monthly wrap | Month patterns from trusted daily facts | Not seen | UNVERIFIED | `daylens-PMF.md` |
| Annual wrap **[CORRECTED]** | Year narrative from trusted monthly/daily facts | Not evidenced in screenshots — **not** proven absent | UNVERIFIED | `daylens-PMF.md` |

### Onboarding & trust

| Feature | Should (v2) | Now | Status | Evidence |
|---|---|---|---|---|
| First-run / permissions | Explains value, requests permissions, sets privacy expectation, shows first proof | Not observed | UNVERIFIED | `UNVERIFIED — needs live test` |
| Capture health diagnostics **[NEW]** | Settings/onboarding show permission, URL-capture, idle-detection, private-window, helper-process health | Not surfaced | missing | — |
| Trust affordances **[NEW]** | User can tell inferred / low-confidence / corrected-by-you / hidden / deleted / excluded / stale / provider-unavailable / future-vs-paused | Confident summaries from bad inputs; provenance unclear | broken | all sections |
| Locked / protected user edits **[NEW]** | A manual rename/merge/split/exclude is authoritative; re-analysis & memory rebuild never overwrite it without explicit reset | AI re-analysis can overwrite manual edits | broken | founder, `timeline-today-merge-down-fix-episode-panel.png` |

---

## How each feature should work

> Should = exact target behavior + a concrete "working right" example. Now = what
> the user sees today. Gap = why it breaks the vision. Fix = product-level move
> (patch / rewrite / replace), no file paths unless a contract is encoded.

### A. Capture & tracking (foundation — everything downstream inherits this)
*(council: claude A1–A4 primary; merge codex classification precedence ladder + gap reasons; merge gemini's 300s dwell threshold **as a hypothesis to validate** + SYSTEM_NOISE denylist)*

**A1. Block segmentation by work focus**
- **Should.** A continuous stretch of related activity is one block; a real
  context switch (different project, or work→leisure) starts a new one. Brief
  incidental activity (a 42s tab, a 30s Finder window) is absorbed into the
  surrounding block as *drift*, not promoted to its own block. *Example:*
  2:47–5:53pm coding in Cursor with Ghostty + a 1-min UniFi check = **one**
  "Cursor — Daylens" block, not three "Development" blocks plus a "UniFi" block.
- **Now.** Two consecutive "Development" blocks (2:47–4:43, 4:43–5:53) that are
  the same work; 1-min "UniFi" blocks interrupt coding; 50 blocks/day
  (`timeline-today-afternoon-duplicate-development-blocks.png`).
- **Gap.** Over-segmentation makes the timeline noise, not a calendar; the user
  must mentally re-merge before reading it.
- **Fix.** **Rewrite the segmentation policy.** Merge adjacent blocks that share
  dominant app + kind + intent subject and abut within a short gap; require a
  minimum block duration and a minimum **dwell** for a context switch before
  cutting. Keep the `kind` hard-cut (work↔leisure) but only on *sustained*
  leisure, using the neutral/`dual-use` rule already in `workKind.ts`.
  **Validate, don't assume, the dwell number:** gemini proposes a hard **300s
  (5-minute)** continuous-leisure threshold before a category shift; treat 300s
  as a hypothesis to tune against the dogfood fixtures across coding, meetings,
  browser research, and leisure — not a universal constant baked in on day one.

**A2. Kind-aware block tag & duration as one truth**
- **Should.** The colored tag reflects dominant **kind/category** from
  time-weighted activity; the *same* duration appears in the list, the detail
  header, and the sum of the app rows. *Example:* 19m coding + 2m Netflix → tag
  DEVELOPMENT, "21m", app rows summing to 21m.
- **Now.** "Cursor" tagged ENTERTAINMENT from 42s Netflix; list 37m, detail 21m,
  apps ~19m (`timeline-today-duration-mismatch-37m-vs-21m.png`).
- **Gap.** Self-contradiction destroys trust in every number; leisure leaks into
  work framing.
- **Fix.** **One duration definition** (active foreground seconds within block
  bounds) computed once and reused by every renderer; remove the secondary "spent
  Xm" derivation. **Drive the tag from `dominantKind`/category**, not from the
  catchiest artifact title. Apply the **classification precedence ladder**
  (codex): (1) user corrections & exclusions, (2) system/noise/private denylist,
  (3) dominant duration & active app, (4) strong domain/document/project signals,
  (5) support apps/sites as *evidence only* — never title/kind, (6) low-confidence
  fallback labels that visibly invite correction.

**A3. System-noise exclusion**
- **Should.** `loginwindow`, `UserNotificationCenter`, `Finder`, screensaver and
  similar OS chrome never appear as apps, never in "Often used with", never count
  as time. *Example:* locking the laptop for lunch does not create a 16-hour
  "loginwindow" app.
- **Now.** `loginwindow` = 16h–50h; `UserNotificationCenter` in "Often used with"
  (`apps-7d-loginwindow-empty-without-ai.png`, `apps-7d-unifi-server-detail.png`).
- **Gap.** Inflates totals and pollutes every aggregate.
- **Fix.** A system-process **denylist applied at ingest** (so noise never enters
  aggregates), e.g. `SYSTEM_NOISE_APPS = {loginwindow, usernotificationcenter,
  finder, screensaverengine, …}` (gemini), plus treating `loginwindow` time as
  *idle/untracked* (machine locked), which also shrinks the bogus gaps.

**A4. Tracking exclusions that actually apply**
- **Should.** With "Limit what's tracked" on, listed apps/sites are excluded from
  capture and all surfaces; with it off, everything is tracked.
- **Now.** Toggle on but the lists are **empty** — so nothing is configured yet.
  This is configuration state, **not** proof the exclusion engine is broken; the
  *real* defect is system noise still dominating.
- **Gap.** The privacy/cleanup control has no visible effect until verified.
- **Fix.** **Verify and wire** exclusions end-to-end (ingest filter + retroactive
  hide in aggregates) and prove a configured exclusion removes data from capture
  *and* AI; ship sensible **defaults** (system processes pre-excluded) so the
  toggle has immediate effect. Gaps must carry a **reason** (idle / paused /
  permission-limited / asleep).

### B. Timeline / calendar
*(council: claude B1–B5 primary; merge codex single day-payload contract + live Jun 16 observations (verify); add future-day semantics)*

**B1. Trustworthy day timeline (Phase-1 gate)**
- **Should.** Scroll a day like a calendar; each block's title, tag, time, and
  evidence agree; leisure is visually distinct and out of work tallies. Day header
  reads `5h 24m tracked · 52m work · 3h 51m leisure` — no score/focus% up front.
- **Now.** Header "7h38m tracked · 50 blocks · 15 apps · 20 sites"; blocks
  mis-tagged; "Untitled block"; shape panel leads with Score 71. codex live Jun
  16: `6h 1m tracked`, `13 blocks`, an 8h3m + 7h12m gap pair *(verify)*.
- **Gap.** This is the wedge surface; if it's wrong, briefs and Q&A inherit the lie.
- **Fix.** **Re-derive the day view from the corrected block model (A1–A3).** Build
  rendering on a **single day-payload contract** (block span, active duration,
  kind breakdown, evidence, correction status, gap reason) consumed by the detail
  panel, day stats, shape-of-day, and week review — none recompute their own math.
  Replace the header stat line with tracked/work/leisure. Move score/drift out of
  the primary position. Keep editing behind a "Not right?" affordance after the
  read-only proof is clear.

**B2. "What mattered" excludes leisure**
- **Should.** Only sustained **work** threads, titled humanly. *Example:* "Daylens
  timeline rework · 1h52m", not "Netflix" or "Uncategorized".
- **Now.** Netflix and X in "What mattered" (Jun16); "Uncategorized"/"UOS Server"
  surfaced.
- **Gap.** Direct PMF violation ("leisure never in mattered").
- **Fix.** **Patch** the "mattered" selection to filter to `kind === work` and
  drop system/uncategorized; pull titles through the humanizer + intent subject.

**B3. Re-analyze honors the Settings model** *(see E1 — centralized provider)*
- **Should.** "Re-analyze with AI" runs the single Settings provider/model,
  refreshes the day synthesis from corrected blocks, and **recovers visibly on
  failure/timeout** instead of hanging.
- **Now.** Founder + codex live: runs **Gemini** (quota error) while Settings =
  Claude Haiku; stuck "Re-analyzing…" with no recovery *(mechanism verify)*.
- **Gap.** The user's provider choice is a lie; voice/cost/privacy unpredictable;
  the stuck state has no exit.
- **Fix.** **Centralize provider resolution** (E1); remove any hardcoded provider
  in the synthesis path; add a bounded, cancelable re-analyze state with an error
  that names the selected provider and a retry.

**B4. Week view: legend + consistent totals + honest "Main mode"**
- **Should.** Stacked week bars carry a legend; the week card total equals the
  review-text total; "Main mode" reflects dominant **work** mode (with a separate
  leisure readout). Empty weekdays say why.
- **Now.** No bar legend; card 20h7m vs review 20h53m; "Main mode: Entertainment".
- **Gap.** Inconsistent totals + entertainment headline kill the weekly recap.
- **Fix.** **Single week-aggregate** feeding card, bars, and review (compute once,
  pass down). Add the legend. Compute "Main mode" over **work** kind.

**B5. Empty days, edits, and confirmation**
- **Should (future-day semantics).** A future day renders as future/empty
  intentionally ("hasn't happened yet"); a past day with no capture shows a
  **reason** (laptop off / tracking paused / permission-limited); only truly-empty
  past days say "No data". Rename/merge/hide apply instantly with visible
  confirmation, persist across reload, and are **immune to re-analysis** (see L).
- **Now.** Jun 15–21 shows Thu–Sun "No data" — but on Jun 17 those are *future*
  days, mislabeled as a capture failure. Edit controls give "no UX feedback unless
  you look closely"; names still wrong after rename.
- **Gap.** Future-vs-missing ambiguity reads as a bug; silent edits make the user
  stop correcting.
- **Fix.** Add explicit **future / missing-past / paused / idle** day states.
  **Patch** edit handlers to emit confirmation + optimistic update; verify the
  corrected label/kind sticks and overrides re-analysis.

### C. Apps view
*(council: codex primary; merge claude C1–C5 app-title hierarchy + domain scoping)*

**C1. App identity is separate from inferred label**
- **Should.** The bold title is always the real app (Safari, Dia, Cursor); the
  category is a quiet badge; an AI summary/artifact is body text, never the title.
  *Example:* "**Safari** · Browsing · 29h 26m" — never "**Development** · Safari"
  and never a documentary title as the row title. Period changes only the numbers,
  never the title scheme.
- **Now.** 7d uses the **category** as title; 30d uses a **raw content title** —
  two wrong schemes (`apps-7d-safari-named-development.png`,
  `apps-30d-safari-119h-domains.png`). (A documentary title as the app-row title
  is still wrong even though it "looks descriptive" — it is activity evidence, not
  app identity.)
- **Gap.** The list isn't scannable as "apps"; the same app looks like two things.
- **Fix.** **Rewrite the list item** to a fixed hierarchy: app name (humanized) →
  category badge → time/sessions; project/activity labels go in subtitle/summary.

**C2. Correct domain → app attribution**
- **Should.** Each domain's time is attributed to the browser that actually hosted
  it; non-browser apps (Dia as an AI tool) get no domain rows.
- **Now.** Netflix/YouTube/X under Dia ("AI tools") *and* under Safari.
- **Gap.** Domain time is double-counted / mis-homed.
- **Fix.** **Fix attribution at aggregation**: a website session belongs to the
  foreground browser at that time, keyed by browser session ownership. Browser
  distinction (Safari vs Chrome vs Arc, including concurrent browsers) must be
  explicit — see open work.

**C3. App category from real usage**
- **Should.** Safari that is 80% YouTube/Netflix reflects leisure-dominant use, not
  a neutral "Browsing"; show a small work/leisure split on the app detail.
- **Now.** Safari = "Browsing" though entertainment-dominated; Dia mixed.
- **Fix.** **Derive the displayed category** from time-weighted `kind`/domain
  policy (reuse `workKind.ts`).

**C4. Detail renders without AI; pages deduped; deletes are safe**
- **Should.** Time, domains, and a deduplicated pages list render with no
  "Generate"; "Generate" only adds an optional blurb. `loginwindow` either doesn't
  appear (A3) or shows "System process — not tracked". **Destructive row actions
  (delete page/domain) sit behind a menu + confirmation, state what is removed
  from Timeline/AI, and offer undo or an irreversibility warning.**
- **Now.** `loginwindow` near-empty "needs more context"; duplicate Netflix /
  repeated `netfilm.world`; a trash icon on every row with unclear safety.
- **Gap.** The view looks broken/empty, repeats itself, and exposes casual
  destructive actions.
- **Fix.** **Patch** detail to always render structured data; **dedupe** by
  normalized URL/title with summed time + visit counts; **humanize** titles; move
  delete behind confirmation with blast-radius text + downstream invalidation.

**C5. "Generate summary" quality** — accurate period blurb, no duplicate artifacts
("Netflix, Netflix"), humanized titles, honoring the Settings model (E1).

### D. AI tab / Q&A
*(council: codex resolver-first primary; merge claude D1 today-vs-week nuance; tables/CSV; add forgotten-link resolver)*

**D0. Resolver-first architecture (the spine).** Route common questions through
**deterministic local resolvers first**: today/yesterday, week, project/client,
open loops, focus windows, app/site breakdown, **forgotten-link/artifact recall**,
CSV export, and "what was I doing at <time>?". Each resolver returns structured
data + evidence + display intent. The **LLM may narrate but cannot decide whether
data exists or invent missing tool results** — it formats facts the resolver
already fetched. This is the single fix that makes today/week/transform/voice all
trustworthy together.

**D1. Grounded "today" answer (parity with week)**
- **Should.** "What did I work on today?" returns a chief-of-staff answer with
  HH:MM ranges from today's blocks — never an apology, never "paste data".
  *Example:* "Today (5h 24m tracked): **Daylens timeline rework** 09:12–11:40
  (Cursor, Ghostty); **standup** 11:45–12:05 (Meet); afternoon mostly YouTube.
  Want it as a checklist?"
- **Now.** Apology asking for getDaySummary — *while the week path returns a full
  per-day breakdown* (`ai-7-days-detailed-day-breakdown.png`), proving the data
  layer works for ranges but the **today** tool result isn't reaching the model.
  The week path is therefore **partial** (works for ranges; missing
  tables/projects/attribution), **not** fully broken.
- **Gap.** The single most-important question fails.
- **Fix.** Route "today" through the same resolver path the week uses; **forbid
  the "ask the user to paste data" response** in the system prompt.

**D2. Tables / CSV for tabular data** — per-day and per-project breakdowns render
as Markdown tables; "export sessions as CSV" produces valid CSV from a resolver.
Patch the prompt + renderer and confirm the chat Markdown renderer supports tables.

**D3. "Turn into…" operates on the prior answer** — each transform reformats the
**previous grounded answer** (a stored assistant message) without re-querying or
re-litigating whether it's "data". Mostly falls out of D0/D1.

**D4. Project/client attribution** — when clients exist, attribute work to them;
when none exist, offer setup *and* give a useful inferred breakdown from intent
subjects rather than declaring nothing. Depends on E2.

**D5. Chat persistence & generation safety** — persist threads to a durable store
that is the **source of truth**, mounted independent of the active route/tab so
the sidebar survives Apps → AI and never blanks mid-generation. Generation belongs
to a thread id and can continue / cancel / fail without corrupting the UI; input
may be disabled during submit but must stay recoverable. Collapse the **duplicate
sidebar entry** bug ("Last 7 days by project" twice). Bound "Thinking" with a
visible cancel + timeout.

**D6. Voice** — calm chief-of-staff; never apologetic/meta; never asks the user to
do the app's job. Pair with D0/D1 so it has real data to be confident about.

### E. Settings & configuration
*(council: codex primary; merge claude provider centralization + memory rewrite)*

**E0. Settings is the source of truth, and every change has a visible
consequence.** Each setting that changes data interpretation either triggers a
**recompute/invalidation** of downstream surfaces or says **"will apply to future
activity only"**, and shows **"last applied + affected surfaces"** for labels,
clients, exclusions, and memory.

**E1. One provider/model, honored everywhere** — a single provider-resolution
service used by chat, timeline re-analyze, Apps "Generate", week review, and
morning/evening generation. A surface cannot silently pick Gemini when Settings
says Claude. Provider quota/key errors return structured, surface-safe states that
name the selected provider. **Done when** switching the Settings model demonstrably
changes every AI surface.

**E2. Clients / projects** — add named clients with colors; map apps/domains/intent
subjects to a client; AI and wraps attribute work to them. *Example:* add "Acme";
"how much did I work on Acme this week?" answers from mapped blocks. **Build** CRUD
+ resolver + attribution surfaced in AI/wraps.

**E3. Work memory that actually learns**
- **Should.** Memory is a **reviewable attribution layer**, not a generic pattern
  list. Patterns are promoted only when repeated evidence changes a label/attribution;
  each shows evidence, **"used in N recent blocks"**, last impact, and an
  accept/forget control. Confidence is earned and varied. *Example:*
  "malaria_group3_report_draft → coursework", "Pioneer AI → project",
  "Dia → browsing unless a domain/page says otherwise".
- **Now.** **All 19 patterns tagged "browsing" at an identical 65%** — incl. Teams,
  Claude, a Google-Docs report, Apple Developer Documentation. Bad labels persist.
- **Gap.** Memory is decorative or actively wrong; it only pushes labels toward
  "browsing", matching the timeline's mis-categorization.
- **Fix.** **Rewrite pattern classification** to assign category from the same
  `kind`/domain/app logic and compute real confidence from occurrence/recall;
  add a **rebuild** that re-derives existing patterns and **reports what changed**.
  Treat memory as a refinement on top of correct base categorization, never the
  source of the "browsing" default — and **bad memory must never override stronger
  live evidence** (codex).

**E4. Per-app label overrides take effect** — overrides propagate to Apps +
Timeline + AI aggregates retroactively (after recompute), at the same aggregation
layer as A2/C1.

**E5. MCP & environment** — MCP off by default in packaged production; env-aware
config; dev vs packaged paths handled explicitly (see open work on packaging).

### F. Morning brief (the wedge) — `UNVERIFIED — needs live test`
*(council: claude F primary; merge cursor Phase-2 acceptance + codex test-notification. Now marked code/PMF-described, not code-as-proof.)*
- **Should.** One screen: greeting; one **carryover line** from `facts.carryover[0]`
  ("The malaria notebook was still open — pick it up?") or "Nothing left open —
  clean start."; one link "See yesterday" → timeline. The notification body leads
  with carryover (`narrative.nudge`), not shape-of-day, and **says the same thing
  as the opened screen**. No carousel, no focus score, no category identity.
- **Now.** PMF/founder/code-described: a 3–4 slide carousel with
  category-identity/video-bg slides; fallback copy (`morningLead`/`morningNudge`)
  uses focus%/peak heuristics that ignore `facts.carryover`. **No live screenshot
  proof** — the shipped UI must be confirmed by driving the app.
- **Gap.** It's a slideshow, not a "pick up where you left off" glance; the wedge
  doesn't land.
- **Fix.** **Rewrite the morning view** to the one-screen model; **delete** slides
  1–3; render from `getWrappedNarrative()` facts only; **remove** the legacy
  heuristics; switch the notification body to `narrative.nudge`. Requires A–B trust
  so the carryover thread is real.

### G. Evening wrap — `UNVERIFIED — needs live test`
*(council: claude G primary; merge codex "wrap totals == day header" invariant)*
- **Should.** ≤5 calm cards from `WrappedFacts`/`aiSlides`: (1) shape, (2) what you
  worked on (only if work ≥ ~15m), (3) where time went, (4) open thread (only if
  carryover), (5) quiet close. A leisure day collapses to 2 cards (shape + close).
  **The wrap's totals and labels match the timeline/day-header exactly.** No
  guilt/distraction slides (`hasDistractionData = false`).
- **Now.** PMF/founder/code-described: 8-slide deck (Scale → Focus → Peak → TopApp
  → …); the 5-card model in `wrappedNarrative.ts` is unused. **No live proof.**
- **Gap.** Too long, includes focus lectures, can contradict a rest day.
- **Fix.** **Rewrite the evening branch** to render the existing 5-card fallback /
  AI slides; conditionally drop cards; enforce totals == day header.

### H. Daily / weekly / monthly / annual wraps
*(council: codex primary — frozen daily snapshots, fail-closed; merge claude week aggregate + legend)*
- **Should.** Each tier aggregates the *same* trusted daily facts and reconciles
  with the timeline:
  - *Daily (side panel):* = B1/B2 corrected shape-of-day.
  - *Weekly:* regenerated from **frozen canonical daily fact snapshots**, not fresh
    freeform summaries over raw sessions; **fail closed** when data is incomplete
    (say so, don't fabricate). Card total == review total == Σ day totals == chart;
    legend present; leisure separated. "No data" only when a day truly has none
    *(never for future days)*, with a reason otherwise.
  - *Monthly:* month patterns (busiest days, top projects, work/leisure ratio) from
    trusted daily snapshots. **In v2 scope, sequenced after daily/weekly trust** —
    not deferred out.
  - *Annual:* year narrative from trusted monthly/daily facts; sequenced last.
- **Now.** Daily "shape of the day" exists but inherits bad inputs (leisure in
  "what mattered"). Weekly review is absent / "checking…" / generated with
  mismatched totals (card 20h7m vs review 20h53m) built on poor labels. Monthly and
  annual are **not evidenced in screenshots** — `UNVERIFIED`, *not* proven absent.
- **Gap.** Wraps are only valuable once the underlying calendar is reliable; an
  inconsistent or contradictory recap is one the user won't open, and a monthly/annual
  "spectacle" before daily/weekly truth would just amplify the lie.
- **Fix.** **Rewrite weekly** to regenerate from frozen daily snapshots, fail closed
  on incomplete data, and enforce card == review == Σ-day == chart with a legend
  (= B4). Daily is fixed by B1/B2. **Sequence** monthly after daily/weekly trust and
  annual last; do not erase them from v2. *(See the "Wraps & briefs" feature-map rows
  for per-tier Now/Status.)*

### I. Notifications
*(council: codex primary — test-notification path; merge claude carryover-first body)*
- **Should.** Notifications are small trustworthy entry points: morning pickup,
  evening close, optional distraction alert. Each payload carries **route + date +
  context** and is built from already-computed facts; the body **matches the opened
  screen** and **never references an unavailable/unselected provider**. A manual
  **"send test notification"** path exists for dev/acceptance.
- **Now.** Toggles present; delivery/content `UNVERIFIED`. Re-analysis errors can
  expose wrong provider state.
- **Gap.** Notifications interrupt the user, so they erode trust faster than any
  in-app surface: a body that contradicts the opened screen or names an
  unavailable/unselected provider re-teaches exactly the distrust v2 exists to fix.
- **Fix.** Add the manual test-fire path; wire morning body to `narrative.nudge`
  (carryover-first) and evening to the close-out; keep distraction alerts **off by
  default until the false-positive rate is measured**.

### J. Settings-driven trust → see E. Onboarding & K. Trust below.

### K. Onboarding — `UNVERIFIED — needs live test`
*(council: codex primary — first-success definition; merge cursor local-only expectation)*
- **Should.** First run explains automatic work memory, requests required macOS
  permissions, sets **privacy expectations (local-only storage; reality calendar,
  not a planner)**, offers optional AI setup, verifies **capture health**
  (permissions, browser URL capture, idle detection, private-window filtering,
  helper processes), and shows **first proof** as soon as capture has data. It is
  **not a feature tour**. The **first success state = "Daylens captured X minutes
  and can show evidence."**
- **Now.** Not observed in screenshots or live audit.
- **Gap.** A broken first-run flow can starve every PMF surface of data.
- **Fix.** **Audit onboarding live** (open task); treat it as a required acceptance
  path after timeline trust.

### L. Trust (cross-cutting) — incl. protected user edits
*(council: codex trust-as-surface primary; merge gemini locked-edit authority as a product requirement; merge claude BlockView contract)*
- **Should.** Trust is a product surface. The user can always tell what is captured
  vs **inferred**, **low-confidence**, **corrected by you**, **hidden**, **deleted**,
  **excluded**, **stale summary**, **provider unavailable**, or **no data because
  future/paused/idle/permission**. The primary UI stays human; confidence/reason
  metadata appears where it matters. **A manual correction is authoritative:**
  rename/merge/split/exclude is never silently overwritten by automatic
  re-analysis, memory rebuild, app-label override, or weekly regeneration —
  changing it requires an explicit reset.
- **Now.** Confident summaries from bad inputs; provenance unclear; AI asks for
  data it should retrieve; re-analysis can overwrite manual edits.
- **Gap.** The app looks done while behaving untrustworthily, and loses user edits.
- **Fix.** Add explicit trust **states** (above). Make **user corrections
  authoritative until explicitly reset** — implement as a lock flag, correction
  record, or review state, **after verifying the existing review/correction schema**
  (do **not** blindly `ALTER TABLE … ADD COLUMN locked` before confirming the
  current architecture; the requirement is authority, not a specific column).

---

## User Stories

*(council: cursor primary — concrete, screenshot-tied; merge codex privacy/safety stories + gemini locked-edit story)*

1. As a founder, I want yesterday's open coding thread named in my morning
   notification, so I know what to resume without opening a slideshow. *(F)*
2. As a founder, I want one tap from the morning brief to yesterday's timeline with
   matching evidence, so I trust the nudge. *(F, B1)*
3. As a founder, I want a 90-minute Cursor session to appear as one block, so my day
   doesn't look like 50 fragments. *(A1)*
4. As a founder, I want a 42-second Netflix glance during coding to stay in
   evidence — not become the block title/kind. *(A1, A2)*
5. As a consultant, I want list duration, detail panel, and app-session sum to be
   the same number, so I can bill without reconciling. *(A2)*
6. As a user, I never want "loginwindow" counted as 16 hours, so my totals mean
   something. *(A3)*
7. As a privacy-conscious user, when I turn on "Limit what's tracked" and add an
   app/site, I want it actually excluded from capture **and** AI. *(A4)*
8. As a first-time user, I want unexplained gaps to say whether tracking was paused,
   idle, asleep, or permission-limited. *(A4, B5)*
9. As a founder, I want leisure kept out of "What mattered" and out of focus
   tallies, so the headline is my work. *(B2, C3)*
10. As a user, I want "Re-analyze" to use the model I picked in Settings, and to
    recover (not hang) if the provider errors. *(B3, E1)*
11. As a user, I want the week chart to have a legend and the week total to match
    its own review text and day rows. *(B4, H)*
12. As a founder, I want "Main mode" to reflect my work, not "Entertainment". *(B4)*
13. As a user, I want future days shown as future — not alarming "No data". *(B5)*
14. As a user, I want a rename/merge to visibly confirm, persist, and survive
    re-analysis. *(B5, L)*
15. As a user, I want the Apps list to show the real app name as the title in every
    period. *(C1)*
16. As a user, I want Netflix attributed to my browser, not my AI tool. *(C2)*
17. As a user, I want app detail (time, domains, deduped pages) without pressing
    Generate. *(C4)*
18. As a user, I want delete/hide actions to explain their blast radius and offer
    undo where possible. *(C4, trust)*
19. As an eng lead, I want "What did I work on today?" answered with real times,
    never an apology asking me to paste data. *(D1, D6)*
20. As a user, I want per-day/per-project breakdowns as tables, and a CSV export I
    can share with a client. *(D2)*
21. As a founder, I want to ask "what was that link I saw Thursday?" and get it back
    from my history. *(D0 forgotten-link)*
22. As a user, I want "Turn into bullets/checklist/report" to reformat the answer I
    just got. *(D3)*
23. As a consultant, I want to define clients once and ask "how much did I work on
    Acme this week?", attributed and confidence-scored. *(D4, E2)*
24. As a user, I want chat history to survive switching to Apps and back, and
    switching chats mid-generation not to wipe everything. *(D5)*
25. As a user, I want "Summarize 7 days" to finish or let me cancel, not hang. *(D5)*
26. As a user, I want work memory to learn varied categories with shown evidence and
    impact — not tag everything "browsing" at 65%. *(E3)*
27. As a user, I want app/category overrides to immediately change Apps/Timeline/AI
    after recompute, so fixing labels pays off. *(E4)*
28. As a returning user, I want the morning notification to name what I left open
    and open it in one tap. *(F)*
29. As a user closing the laptop, I want a short honest evening wrap that matches my
    timeline, with no focus lecture on a rest day. *(G)*
30. As a consultant, I want weekly reviews to agree with charts and day rows. *(H)*
31. As a long-term user, I want monthly/annual wraps built from trusted daily facts,
    so they feel earned. *(H)*
32. As a new user, I want onboarding that proves capture is working after
    permissions, and explains local-only storage. *(K)*
33. As a privacy-conscious user, I want to understand what local history is sent to
    external AI providers and to have exclusions apply before any provider call.
    *(open work: AI privacy boundary)*
34. As a user, I want MCP off unless I opt in, with correct config for my
    environment. *(E5)*
35. As a user, I want distraction alerts only when I've clearly drifted, so
    notifications don't become noise. *(I)*
36. As an eng lead, I want my manually edited block names locked against AI
    re-analysis, so my categorization is never lost. *(L, gemini)*
37. As any user, I want the morning brief, evening wrap, and `/ai` to give the same
    answer to the same question. *(D, F, G parity)*
38. As a founder, next Tuesday I want to answer what I did last Thursday from
    Daylens, not memory. *(all)*

---

## Implementation Decisions

*(council: claude implementation table + BlockView prototype primary; merge codex DayFactBlock fact contract + correction/invalidation contract + classification precedence; validate gemini lock concept against existing schema)*

| Area | Exists | What's wrong | Target | Verdict |
|---|---|---|---|---|
| Segmentation (`workBlocks.ts`) | Yes (large) | Over-splits; short leisure flips kind; multiple duration derivations | One block per focused stretch; one duration; kind hard-cut only on sustained leisure (dwell tuned vs fixtures) | **Rewrite** policy; reuse file |
| `kind` axis (`workKind.ts`) | Yes, sound | Computed but not driving the UI tag/"mattered"/category | Source of displayed tag, "mattered" filter, focus tally, Apps category | **Modify** consumers |
| Humanizer (`humanize.ts`) | Yes, good | Not applied on every surface | One pass on every user-facing title | **Wire in** everywhere |
| Capture ingest | Yes | No system-process denylist; exclusions unwired | Denylist + working exclusions + gap reasons at ingest | **Modify/replace** filter |
| Day aggregation | Yes | Inconsistent totals across renderers | One day-payload aggregate feeding header/blocks/shape/week | **Rewrite** aggregation seam |
| Week aggregation (`recap.ts`) | Yes | Card vs review mismatch; no legend; entertainment headline | One week aggregate from frozen daily snapshots; legend; work-based main mode | **Rewrite** aggregation; modify UI |
| Provider resolution | Yes (multi-provider) | Re-analyze/others bypass Settings model | One resolver every AI path reads; surface-safe errors | **Refactor** to centralize |
| AI Q&A (`aiService.ts`, `insightsQueryRouter.ts`) | Yes; week works | Resolver-last; "today" tool result not reaching model; apologetic voice; no tables | Resolver-first; LLM narrates fetched facts only; tables/CSV; forbid "paste data" | **Rewrite** routing; patch prompt |
| Chat state (`useAIChat.ts`/store) | Yes | History tied to view; unsafe mid-gen switch; hangs; duplicate sidebar rows | Durable store as source of truth; per-thread lifecycle; cancel/timeout | **Rewrite** state layer (verify existing hydration guards first) |
| Clients/projects | UI stub only | Empty; no resolver | CRUD + attribution resolver | **Build** |
| Work memory patterns | Yes | All "browsing" @65% | Category from kind logic; real confidence; evidence/impact; rebuild reports changes; never overrides live evidence | **Rewrite** classification |
| Corrections | Isolated handlers | No shared propagation/invalidation; re-analysis overwrites edits | One correction/invalidation system: update UI now, persist, recompute, mark downstream AI/wrap text stale, protect user edits | **Rewrite/replace** correction seam |
| Morning brief (`DayWrapped.tsx`) | Carousel | Slideshow, ignores carryover | One screen from facts | **Rewrite** branch |
| Evening wrap (`DayWrapped.tsx`) | 8-slide | Unused 5-card model | ≤5 cards from facts; totals == header | **Rewrite** branch |
| Notifications (`dailySummaryNotifier.ts`) | Yes | Body uses shape, not carryover; no test path | Carryover-first body; route/date/context payload; test-fire path | **Patch** |
| Trust/edit authority | Review/correction state exists | Re-analysis can overwrite manual edits | User corrections authoritative until explicit reset | **Verify schema, then implement** (lock flag / correction record / review state — not a blind column add) |

**Prototype — the render aggregate every surface reads** *(claude `BlockView`)*:

```ts
// One computed truth per block; renderers format, never re-derive.
interface BlockView {
  id: string
  startMs: number
  endMs: number
  activeSeconds: number          // THE duration. list = detail = Σ apps
  kind: 'work' | 'leisure' | 'personal' | 'idle'   // drives the tag
  category: AppCategory          // shown as a quiet badge; must agree with kind
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

**Prototype — the stored fact contract** *(codex `DayFactBlock`)*, which the
render aggregate above is derived from, carrying confidence, reason, and the
correction record:

```ts
type DayFactBlock = {
  id: string
  startMs: number; endMs: number; activeMs: number
  title: string
  kind: 'work' | 'leisure' | 'personal' | 'idle'
  category: string
  confidence: 'high' | 'medium' | 'low'
  reason: string                 // gap reason / classification reason
  apps: EvidenceApp[]; sites: EvidenceSite[]; artifacts: EvidenceArtifact[]
  correction?: { label?: string; kind?: string; hidden?: boolean }  // user-authoritative
}
// Every surface consumes this (or a direct aggregate of it). Day stats, detail
// panel, weekly reviews, Apps, and AI must NOT each invent their own duration math.
```

**Classification precedence** (apply in order): user corrections & exclusions →
system/noise/private denylist → dominant duration & active app → strong
domain/document/project signals → support apps/sites as *evidence only* →
low-confidence fallback that invites correction.

**Correction & invalidation contract.** Rename, merge, hide, delete, label
override, and client attribution **share one system**. A correction: (1) updates
the current UI immediately (optimistic), (2) persists, (3) recomputes derived
day/week summaries, (4) **marks downstream cached AI/wrap text stale**, and (5) is
**protected** from automatic re-analysis. Replace one-off handlers that can't meet
this contract.

---

## Testing Decisions

*(council: codex's 16 external-behavior tests primary, rendered in cursor's "test → would catch [screenshot]" traceability format; merge claude's invariants. Drop: green `npm test`/`timeline:eval` = ship — every phase needs live screenshot proof.)*

| # | Test (external behavior) | Would catch (screenshot/report) |
|---|---|---|
| 1 | **Dogfood real-week fixture** — export a founder day + week; assert no block mixes sustained coding + Netflix; leisure absent from mattered/carryover; every title passes the humanizer | Jun 16 labels/gaps/Gemini; whole-suite anchor |
| 2 | **Segmentation scenario** — coding + brief Netflix/X → one work block + small drift; never entertainment-coded Cursor | `timeline-today-cursor-block-tagged-entertainment.png` |
| 3 | **Duration invariant** — list == detail == Σ app activeSeconds == day total derive from one `activeMs` | `timeline-today-duration-mismatch-37m-vs-21m.png` |
| 4 | **Kind/tag invariant** — displayed tag == `dominantKind` (95% dev + 5% leisure → DEVELOPMENT) | ENTERTAINMENT-on-Cursor |
| 5 | **Gap-reason** — simulate idle/sleep/pause/permission-denied/no-samples → distinct reasons; future days not "No data" | `timeline-week-jun15-21-no-data-*`, `timeline-day-jun16-*` |
| 6 | **System-noise exclusion** — feed `loginwindow`/notification-center/Finder/helper micro-sessions → hidden from top apps & summaries | `apps-7d-loginwindow-empty-without-ai.png` |
| 7 | **Apps aggregation** — browser domains belong to the actual browser; app names stable across Today/7d/30d; pages dedupe | `apps-7d-safari-named-development.png`, `apps-7d-dia-wrong-domain-attribution.png` |
| 8 | **Week consistency** — card total == review-text total == Σ day totals == chart | `timeline-week-jun15-21-review-hours-mismatch.png` |
| 9 | **Provider routing** — Settings=Claude → chat, Apps Generate, re-analyze, brief generation all use Claude or a selected-provider error | founder/codex Gemini mismatch |
| 10 | **AI resolver suite** — "today", "7 days by project", "what was I doing Tue 10:30?", "that link I saw", "export CSV" return structured local data **before** LLM narration; today contains HH:MM and **no** apology/"paste data" | `ai-todays-work-no-tool-results.png` |
| 11 | **Tables/CSV** — a week/detail request renders a Markdown table; CSV export is valid | `ai-7-days-summary-prose-no-tables.png`, `ai-7-days-detail-bullets-not-table.png` |
| 12 | **Transforms** — after a base answer, "turn into bullets/checklist/report" transforms the prior assistant message, never re-asks for data | `ai-todays-work-turn-into-bullets-fails.png` |
| 13 | **Chat persistence** — create history → navigate AI→Apps→AI → switch mid-generation → cancel: sidebar/history/input stay coherent; no duplicate rows | `ai-new-chat-empty-sidebar.png`, founder |
| 14 | **Correction propagation** — rename/merge/hide/delete/label-override/client-attr updates Timeline, Apps, day facts, weekly review, AI payloads; locked edits survive re-analysis | `timeline-today-merge-down-fix-episode-panel.png` |
| 15 | **Memory impact** — promote a pattern, show affected blocks, rebuild, forget; assert labels change or "no change" is reported; not all "browsing" | `settings-work-memory-learned-patterns.png` |
| 16 | **Privacy/exclusion** — excluded app/site + private-window sessions absent from future capture **and** AI answers | `settings-tracking-exclusions-privacy.png` |
| 17 | **Morning/evening notification** — manual fire routes to the right date; body matches the opened screen; renders carryover/close-out from facts | PMF morning/evening |
| 18 | **Weekly review consistency** — generated review total == chart/card; fail-closed (caveat) on incomplete data; no review from missing data silently | `timeline-week-jun8-14-no-saved-review.png` |
| 19 | **Onboarding smoke** — fresh profile reaches permission request, capture health, and first proof without requiring AI setup | onboarding (UNVERIFIED) |
| 20 | **WrappedFacts parity** — same payload → morning carryover answer === AI "what did I leave open yesterday?" answer | cross-surface trust |

**Live-app acceptance (per phase, run the app — unit tests are never sufficient):**
open yesterday and every block's tag/title/duration is believable, header shows
tracked/work/leisure, no correction needed before reading; morning notification
names a real open thread (or honestly none) and one tap opens it; evening wrap ≤5
cards matches the timeline with no rest-day lecture; switching the Settings model
changes re-analyze output voice; `/ai` "today / last week" matches the timeline and
the wraps. **Take a screenshot after every phase** and compare against the named
`docs/plans/screenshots/` failures.

---

## Build sequence (for autonomous execution)

*(council: cursor's sequence primary — Phase 0 dogfood that must fail on main, PMF wedge order, checkbox + screenshot-retake acceptance; merge claude's phase content; graft codex's "Corrections & invalidation" phase after trust; fold gemini's locked-edit work into Phase 1. Explicitly NOT codex's morning-as-Phase-6 ordering. Acceptance is run-the-app + screenshot retake — never `timeline:eval` green alone.)*

> **Wedge spine = Phases 0 → 1 → 2 → 3** (dogfood → trust → corrections → morning).
> Phase 3 (morning brief) is the week's product goal; everything after inherits the
> trusted spine.

### Phase 0 — Dogfood harness & truth baseline
Export a real founder **day + week** into `tests/timeline-eval/fixtures/`; stand up
tests 1–8 (initially red). **Accept when:** the fixture **fails on current main**
(proving the tests catch real bugs), the agent can launch the app and open a
specific past day, and the founder confirms the fixture matches memory ±15m.

### Phase 1 — Trust the record (capture + block model) — *PMF gate*
A1 segmentation, A2 one-duration/kind-driven tag (precedence ladder), A3
system-noise denylist, A4 exclusions wired + gap reasons; the `BlockView` /
`DayFactBlock` contract; humanizer on every title; B1 day header; B2 leisure out of
"mattered"; **gemini's locked-edit protection (L) built in from the start.**
**Accept when (run app, retake screenshots):**
- [ ] Cursor coding block: DEVELOPMENT title, Netflix only in artifacts
- [ ] List duration == panel duration == Σ apps for every block today
- [ ] No `loginwindow`/system noise in top apps or "Often used with"
- [ ] No new "Untitled block" on days with named artifacts; titles humanized
- [ ] "What mattered" has no leisure; header shows tracked/work/leisure (no score first)
- [ ] A manually renamed block is unchanged after re-analysis
- [ ] Tests 1–6 green **and** `timeline-today-*` screenshot retakes match

### Phase 2 — Corrections & invalidation *(grafted from codex)*
One shared correction system: rename/merge/hide/delete/label-override/client-attr.
**Accept when:**
- [ ] Each correction updates Timeline + Apps immediately and persists across reload
- [ ] Asking AI about the corrected day reflects the correction
- [ ] Derived day/week summaries are marked stale or regenerated
- [ ] Locked user edits are never overwritten by automatic re-analysis

### Phase 3 — Morning brief (the wedge)
F one-screen brief + carryover-first notification (I); depends on Phase 1 trust.
**Accept when:**
- [ ] Morning notification text names a real carryover thread OR "Nothing left open"
- [ ] One screen only: greeting + carryover + "See yesterday" (no carousel/score)
- [ ] One tap → timeline block evidence matches the notification
- [ ] Live test: trigger the morning notification on the founder machine

### Phase 4 — Evening wrap
G 5-card model. **Accept when:**
- [ ] ≤5 cards on a work day; exactly 2 cards on a leisure fixture day
- [ ] Card content + totals match the timeline/day-header for that date
- [ ] No distraction/guilt slide; evening teaser matches the first card

### Phase 5 — Timeline as proof + week consistency
B3 re-analyze provider + recovery, B4 legend/totals/main-mode, B5 future-day
semantics, read-only default with "Not right?". **Accept when:**
- [ ] Day header shows tracked/work/leisure, score demoted
- [ ] Re-analyze shows the active Settings model and recovers on error
- [ ] Week card total == review text total (±1m); bars have a legend
- [ ] Future days render as future, not "No data"; `timeline-week-*` retakes match

### Phase 6 — Apps view truth
C1–C5 + E4 label propagation. **Accept when:**
- [ ] Safari titled "Safari" at 7d and 30d; same scheme every period
- [ ] Domains under the correct browser; Dia shows no Safari-only Netflix
- [ ] Pages deduped; Generate summary has no duplicate artifacts
- [ ] Destructive row actions require confirmation + state blast radius
- [ ] Tests 7 green; `apps-7d-*`/`apps-30d-*` retakes match

### Phase 7 — AI Q&A alignment
D0 resolver-first, E1 provider centralization, D1 today, D2 tables/CSV, D0
forgotten-link resolver, D3 transforms, D4 attribution, D5 persistence + duplicate
fix, D6 voice. **Accept when:**
- [ ] "What did I work on today?" answers with times, no apology/paste-data
- [ ] "Summarize 7 days by project" → a table; CSV export valid; finishes or cancels
- [ ] "What was that link I saw Thursday?" returns it from history
- [ ] Apps → AI → sidebar threads persist; no duplicate rows; mid-gen switch safe
- [ ] Switching the Settings model changes every AI surface; tests 9–13 green
- [ ] `ai-todays-work-*` / `ai-7-days-*` retakes match

### Phase 8 — Settings, model authority, memory & clients
E0 invalidation/affected-surfaces, E2 clients CRUD + attribution, E3 memory rewrite
+ rebuild/forget, E5 MCP off-by-default. **Accept when:**
- [ ] Label/client/memory/exclusion changes show affected surfaces + recompute or "future only"
- [ ] Rebuilt memory isn't all "browsing"; patterns show evidence + impact
- [ ] A defined client answers "how much did I work on X this week?"
- [ ] MCP off by default in packaged prod; env-aware config; tests 14–16 green

### Phase 9 — Weekly / monthly / annual wraps
H frozen-snapshot weekly (fail-closed), then monthly, then annual — each on trusted
aggregates. **Accept when:**
- [ ] Weekly total == chart == day rows; "No data" only for truly-empty past days, with reason
- [ ] Monthly exists from trusted daily snapshots (or is explicitly sequenced)
- [ ] User can answer "what did I do last Thursday / last week / last month?" from Daylens alone

### Phase 10 — Onboarding & trust polish + capture health
K onboarding + L trust affordances + capture-health diagnostics. **Accept when:**
- [ ] Fresh profile verifies permissions, capture health, privacy defaults, optional AI, first proof
- [ ] Every low-confidence label has a correction affordance
- [ ] Hidden/deleted/corrected/excluded data is represented consistently across Timeline, Apps, AI, wraps
- [ ] Morning brief, evening wrap, and `/ai` agree on the same question (parity)

---

## Out of Scope

*(council-merged; drops applied)*

- **Greenfield rewrite** of the app or the capture engine (e.g. a custom
  Swift/C++ active-window listener). v2 fixes the existing app.
- **Annual wrap polish** before daily/weekly trust — *sequenced last, not removed
  from v2.* (Monthly + annual are **in** v2 scope per PMF; do not delete them.)
- **Calendar / email integrations** (Google Calendar, Outlook) — a different
  product layer; not needed for laptop-memory PMF.
- **Team / admin / cloud-sync** features as a v2 prerequisite.
- **New social / sharing** features.
- **New capture sources** (mobile, browser-extension telemetry) — capture isn't
  the gap.
- **Complex productivity scoring** — remove or de-emphasize scores until the record
  is trusted; guilt/distraction framing is explicitly out (distraction alerts stay
  behind the existing toggle, default off, until the false-positive rate is
  measured).
- **MCP feature expansion** — leave as-is except for the small, in-scope settings
  fix (off-by-default in packaged prod + env-aware paths).
- **Re-skinning / visual redesign** beyond what truth requires (legend, header,
  card counts, trust states).

---

## Further Notes

### Open work — gaps the council flagged that no plan fully covered

Add these as first-class work items; several are now folded into the phases above
and are repeated here so none is lost:

1. **Correction → downstream cache invalidation/staleness** — generated AI/wrap
   text must be marked stale when a block is corrected *(now Phase 2)*.
2. **Day-boundary / timezone definition** — when does "a day" start (local
   midnight?), how is late-night work crossing midnight bucketed, DST. Directly
   affects "today/yesterday" correctness and the big sleep "gaps".
3. **Historical data migration / backfill** — changing segmentation + kind alters
   *existing* blocks. State whether history is re-derived or only new data is — the
   dogfood bar is "open *yesterday* and nod", which needs past data fixed.
4. **Performance at scale** — Safari 5,977 sessions, 119h/30d. Re-segmentation and
   aggregation cost over large local history is unaddressed.
5. **Concrete "session" definition + sanity thresholds** — micro-session
   debounce/merge threshold, plus a benchmark/alert so 5,977-session inflation
   can't regress. (Distinct from the 300s *kind*-shift dwell in A1.)
6. **Locked / protected user edits** — generalized: re-analysis, memory rebuild,
   app-label override, and weekly regeneration must not overwrite user corrections
   without an explicit reset *(now Phase 1/L)*.
7. **Forgotten-link / URL / artifact retrieval** — PMF promises "that link you saw
   but forgot"; first-class AI resolver + test *(now D0)*.
8. **AI privacy boundary** — what local history is sent to Claude/OpenAI/Gemini,
   how exclusions apply *before* a provider call, and how the user sees that
   boundary.
9. **Capture health diagnostics** — permission, browser-URL-capture, idle-detection,
   private-window, helper-process health surfaced in Settings/onboarding *(now Phase 10)*.
10. **Future-day semantics** — explicit model for future days vs no-data past days
    vs tracking-paused vs idle/off-computer *(now B5)*.
11. **Correction audit trail** — distinguish user edits from AI inference; allow
    undo/inspect.
12. **Destructive data action safety** — delete app/site/page/block: confirmation,
    blast radius, undo or irreversible warning, downstream invalidation *(now C4)*.
13. **Packaging vs dev behavior** — MCP paths and updates differ in dev vs packaged
    builds; Settings copy and acceptance must cover both (screenshots show dev
    Electron paths).
14. **Accessibility & keyboard flows** — AI chat, correction panel, settings forms,
    notifications are productivity surfaces; test keyboard nav + accessible names.
15. **Duplicate chat sidebar entries** — "Last 7 days by project" listed twice under
    TODAY *(now D5)*.
16. **Re-analyze stuck UI** — "Re-analyzing…" with no recovery on failure/timeout
    *(now B3)*.
17. **Score/focus UX after trust** — decide demote vs remove Score 71 from the shape
    panel *(now B1/B5: demoted)*.
18. **Browser distinction** — how domain attribution handles Chrome vs Safari vs Arc,
    especially concurrent browsers *(now C2)*.
19. **Offline / local-AI fallback** — local LLM (Ollama/MCP) when offline, for an
    "always-on" local memory.
20. **Distraction-alert false-positive bar** — define the bar before enabling.

### Evidence & truth caveats (carry into implementation)

- **codex's live-only facts** (Gemini *quota* specifically, 39-sessions-today,
  `localhost:5173`, exact 8h3m/7h12m gap minutes) are credited but **"verify before
  relying"** — two of three other agents couldn't reproduce live behavior.
- Screenshots are dated **mid-June 2026 on app v1.0.44**; if the building agent's
  app differs, **re-screenshot before trusting any "Now" cell.**
- **Green tests are not product truth.** The dogfood day, not the fixture suite, is
  the bar for "works". Run the app and screenshot after every phase.
- **The backend is more right than the surface.** `workKind.ts`, `humanize.ts`, and
  the 5-card model in `wrappedNarrative.ts` are sound; much of v2 is *wiring the
  good backend to the surface and deleting the legacy heuristics that shadow it* —
  consistent with "fix the existing app, not greenfield".
- **Single biggest leverage:** the one block-fact contract (`BlockView` /
  `DayFactBlock`). Almost every screenshot defect is a *consumer* reading a
  different derivation than its neighbor. Fix the seam once and timeline, apps,
  shape-of-day, week, briefs, and AI stop contradicting each other.

### Surfaces still UNVERIFIED — confirm by driving the app

Morning carousel vs one-screen; evening 8-slide vs 5-card; notification delivery &
bodies; the exact re-analyze→Gemini wiring; onboarding/permissions; monthly &
annual wraps; rename/merge/hide persistence; incognito-skip; pause-tracking; theme;
analytics toggle; CSV export; category filter pills; ⌘K chat search. All are marked
inline and should be confirmed in Phases 0–1 before being relied on.
