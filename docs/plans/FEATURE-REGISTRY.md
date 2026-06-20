## Screenshot index (35 files)


| Screenshot                                                  | What it shows                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `meta-ide-handoff-context.png`                              | Cursor IDE — not app UI                                                                                 |
| `ai-todays-work-no-tool-results.png`                        | AI: "What did I work on today?" → no tool results, asks user to paste getDaySummary                     |
| `ai-todays-work-turn-into-menu.png`                         | AI: Turn into… menu (shorter, checklist, bullets, report)                                               |
| `ai-todays-work-turn-into-bullets-fails.png`                | AI: refuses to turn into bullets — says it's a data request not a summary                               |
| `ai-summarize-7-days-thinking-state.png`                    | AI: "Summarize 7 days" stuck on Thinking                                                                |
| `ai-7-days-by-project-summary-no-projects.png`              | AI: 7-day summary, no attributed projects, prose only                                                   |
| `ai-new-chat-empty-sidebar.png`                             | AI: New chat, sidebar "No chats yet"                                                                    |
| `ai-7-days-summary-prose-no-tables.png`                     | AI: 7-day summary as wall of text                                                                       |
| `ai-7-days-detail-bullets-not-table.png`                    | AI: "i need detail" → bullets still not a table                                                         |
| `ai-7-days-detailed-day-breakdown.png`                      | AI: detailed per-day breakdown with HH:MM ranges (week path **works** for ranges)                       |
| `ai-chat-sidebar-with-history.png`                          | AI: sidebar with chat history (Today / Previous 7 / 30 days); "Last 7 days by project" listed **twice** |
| `settings-ai-claude-haiku-connected.png`                    | Settings: Claude connected, Haiku 4.5 selected                                                          |
| `settings-work-memory-learned-patterns.png`                 | Settings: work memory — 19 patterns, identical confidence stats                                         |
| `settings-labels-per-app-and-clients.png`                   | Settings: per-app labels (Safari 120h, loginwindow tracked) + empty clients                             |
| `settings-notifications-clients-appearance.png`             | Settings: morning/evening toggles on, no clients, theme controls                                        |
| `settings-mcp-server-enabled.png`                           | Settings: MCP server on, dev paths in config                                                            |
| `settings-tracking-exclusions-privacy.png`                  | Settings: pause tracking, excluded apps/sites (empty), incognito skip, analytics toggle                 |
| `apps-7d-safari-named-development.png`                      | Apps 7d: Safari listed as "Development" (category-as-title); Generate summary                           |
| `apps-7d-safari-pages-visited-list.png`                     | Apps 7d: Safari pages visited (Netflix, YouTube, X…), delete icon per row                               |
| `apps-7d-loginwindow-empty-without-ai.png`                  | Apps 7d: Loginwindow — empty without AI ("needs more context")                                          |
| `apps-7d-unifi-server-detail.png`                           | Apps 7d: UniFi server detail, Often used with (incl. system apps)                                       |
| `apps-7d-dia-wrong-domain-attribution.png`                  | Apps 7d: Dia "Development" — Netflix/YouTube under AI tool                                              |
| `apps-30d-dia-coursework-domains.png`                       | Apps 30d: Dia coursework — colab, x.com, youtube domains                                                |
| `apps-30d-safari-119h-domains.png`                          | Apps 30d: Safari 119h — content-title-as-title ("…full documentary"), domain breakdown                  |
| `apps-30d-browsing-github-x-youtube.png`                    | Apps 30d: Browsing detail — github, X, YouTube pages                                                    |
| `timeline-today-cursor-block-tagged-entertainment.png`      | Timeline today: Cursor block tagged ENTERTAINMENT / Netflix                                             |
| `timeline-today-duration-mismatch-37m-vs-21m.png`           | Timeline today: 37m in list vs 21m in detail panel                                                      |
| `timeline-today-merge-down-fix-episode-panel.png`           | Timeline today: Fix episode — Rename, Merge down, Hide                                                  |
| `timeline-today-afternoon-duplicate-development-blocks.png` | Timeline today: duplicate Development blocks, duration gaps, **LIVE tag** present                       |
| `timeline-week-jun15-21-no-data-checking-review.png`        | Timeline week Jun 15–21: Thu–Sun "No data" (**future days** on Jun 17), review checking                 |
| `timeline-week-jun8-14-no-saved-review.png`                 | Timeline week Jun 8–14: "No saved review", Generate                                                     |
| `timeline-week-jun1-7-untitled-block-legend.png`            | Timeline week Jun 1–7: Untitled block, category legend (day-row only)                                   |
| `timeline-week-jun1-7-week-review-generated.png`            | Timeline week Jun 1–7: generated week review text                                                       |
| `timeline-week-jun15-21-review-hours-mismatch.png`          | Timeline week: review says 20h53m, stats say 20h7m                                                      |
| `timeline-day-jun16-reanalyze-shape-of-day.png`             | Timeline Jun 16: Re-analyzing…, shape of day, score/drift                                               |


**User-reported (not all captured in screenshots):** switch chat mid-generation → empty chat, sidebar chats gone, input disabled; navigate Apps → AI → chats disappear; new chat shows history until tab switch; all AI responses sound wrong; memory saves wrong patterns.

**codex live-app audit (verify before relying):** Gemini quota error on re-analyze while Settings = Claude Haiku; Safari 39 sessions / 59m today; Jun 16 had an 8h3m + 7h12m gap pair; Apps → AI showed "No chats yet". Credited but not independently reproduced by other agents.

---

## Capture & tracking


| Feature                              | Should (v2)                                                                        | Now                                                                                                                                                         | Status     | Evidence                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| Activity → time blocks               | Sensible boundaries — one work stretch = one block; clear breaks                   | Arbitrary splits; 50 blocks/day; huge untracked gaps (8h+); same session fragmented                                                                         | broken     | timeline-today-*, user                                                                                     |
| Block boundaries                     | Group by dominant focus; brief drift (42s Netflix) doesn't flip the block          | 42s Netflix drives ENTERTAINMENT label on Cursor coding block                                                                                               | broken     | timeline-today-cursor-block-tagged-entertainment.png                                                       |
| Block naming                         | Title = what you were doing (project, app, meeting, doc)                           | "Development", "Untitled block", raw URLs, page titles ("iPhone 12 Wi", "[https://x.com](https://x.com)")                                                   | broken     | timeline-*, apps-7d-safari-named-development.png, user                                                     |
| Block categories (kind)              | Category matches dominant activity                                                 | Claude Code block tagged BROWSING; UniFi split BROWSING vs DEVELOPMENT; ENTERTAINMENT on coding                                                             | broken     | timeline-today-afternoon-duplicate-development-blocks.png                                                  |
| Merge down                           | Merge with clear visual confirmation                                               | Works technically; **no UX feedback** unless you look closely                                                                                               | broken     | timeline-today-merge-down-fix-episode-panel.png, user                                                      |
| Rename block                         | Rename sticks, updates list + panel, and is immune to re-analysis                  | Rename UI exists; names still often wrong after                                                                                                             | untrusted  | timeline-today-merge-down-fix-episode-panel.png                                                            |
| Hide block                           | Hide noise from timeline + all summaries, with undo                                | Hide button exists                                                                                                                                          | UNVERIFIED | timeline-today-merge-down-fix-episode-panel.png                                                            |
| Duration accuracy                    | List duration = detail duration = sum of apps                                      | 37m list vs 21m panel; block span vs "spent Xm" text disagree                                                                                               | broken     | timeline-today-duration-mismatch-37m-vs-21m.png, timeline-today-afternoon-duplicate-development-blocks.png |
| Untracked gaps                       | Minimize; explain reason (idle / paused / permission / asleep)                     | Large gaps shown as a single bare line                                                                                                                      | broken     | timeline-today-*, timeline-day-jun16-*                                                                     |
| System noise capture                 | Skip loginwindow, UserNotificationCenter, Finder, screensaver as meaningful "apps" | loginwindow 16h–50h tracked as activity; in "Often used with"                                                                                               | broken     | apps-7d-loginwindow-empty-without-ai.png, apps-7d-unifi-server-detail.png                                  |
| Tracking exclusions **[CORRECTED]**  | Toggle ON + lists → excluded from capture and AI; OFF → all tracked                | Toggle ON but excluded lists **empty** = no user config yet, **not** proof the engine fails. Real defect = system noise still tracked + behavior unverified | partial    | settings-tracking-exclusions-privacy.png                                                                   |
| Incognito skip                       | Private windows not recorded                                                       | Toggle on; behavior unconfirmed                                                                                                                             | UNVERIFIED | settings-tracking-exclusions-privacy.png                                                                   |
| Pause tracking **[NEW]**             | Pause stops capture; timeline gap marked "paused"                                  | Toggle exists, off                                                                                                                                          | UNVERIFIED | settings-tracking-exclusions-privacy.png                                                                   |
| Session counts **[CORRECTED]**       | Plausible counts via a defined micro-session merge threshold                       | Safari 5977 sessions / 7d; Dia 5893 — inflated by micro-sessions; codex live: Safari 39 sessions / 59m today (verify)                                       | untrusted  | apps-7d-safari-named-development.png, live                                                                 |
| Live block indicator **[CORRECTED]** | Current activity block clearly marked                                              | **LIVE** tag present on afternoon block — present, not missing                                                                                              | partial    | timeline-today-afternoon-duplicate-development-blocks.png                                                  |


---

## Timeline / calendar


| Feature                                        | Should (v2)                                                                                   | Now                                                                                                            | Status    | Evidence                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------- |
| Day timeline                                   | Scrollable reality calendar with proof; one day-payload feeds all sub-views                   | Renders but labels/categories/durations untrusted; each view recomputes                                        | broken    | timeline-day-jun16-reanalyze-shape-of-day.png, user                                       |
| Day stats bar                                  | Accurate tracked · work · leisure totals                                                      | Shows 7h38m / 50 blocks — built on bad blocks                                                                  | untrusted | timeline-today-*                                                                          |
| Episode detail panel                           | Apps used + artifacts match block story                                                       | Artifacts contradict title (Netflix vs Cursor)                                                                 | broken    | timeline-today-duration-mismatch-37m-vs-21m.png                                           |
| Shape of the day                               | Honest focus/drift/mattered from trusted blocks; score demoted                                | Exists but wrong inputs → wrong synthesis; leads with Score 71                                                 | broken    | timeline-day-jun16-reanalyze-shape-of-day.png                                             |
| Re-analyze with AI **[CORRECTED]**             | Uses **Settings model**; refreshes synthesis; recovers on failure                             | User + codex live: uses **Gemini** (quota error) while Settings = Claude Haiku; stuck "Re-analyzing…" (verify) | broken    | timeline-day-jun16-*, settings-ai-claude-haiku-connected.png, live                        |
| Week view chart                                | Colored breakdown **with legend**; days with data, future, or reason                          | Bars have no legend (day-row only); Thu–Sun "No data"                                                          | broken    | timeline-week-jun15-21-no-data-checking-review.png                                        |
| Week stats                                     | Week total consistent everywhere                                                              | Review text 20h53m vs card 20h7m                                                                               | broken    | timeline-week-jun15-21-review-hours-mismatch.png                                          |
| Week review generate                           | Recap you'd open, from frozen daily snapshots, fail-closed                                    | "No saved review" / "Checking…" / Generate; quality untrusted                                                  | broken    | timeline-week-jun8-14-no-saved-review.png, timeline-week-jun1-7-week-review-generated.png |
| Week day rows                                  | Preview blocks + open day                                                                     | Shows "Untitled block"; Open day works                                                                         | partial   | timeline-week-jun1-7-untitled-block-legend.png                                            |
| Main mode stat                                 | Reflects actual **work** mode (separate leisure readout)                                      | "Main mode: Entertainment" for user/dev                                                                        | untrusted | timeline-week-jun1-7-*, timeline-week-jun15-21-*                                          |
| Empty days = future vs missing **[CORRECTED]** | Future days render as future; past missing days give a reason; "No data" only when truly none | Thu–Sun "No data" on Jun 15–21 — those are **future** days on Jun 17, mislabeled as a capture bug              | partial   | timeline-week-jun15-21-no-data-checking-review.png                                        |
| Day / Week / Today toggles                     | Consistent data across views                                                                  | Week works somewhat; day-level issues worse                                                                    | partial   | user, timeline-*, apps-*                                                                  |
| Block corrections UX **[NEW]**                 | Read-only default; "Not right?" reveals rename/merge/hide                                     | "Not right?" + Fix episode panel exist                                                                         | partial   | timeline-today-merge-down-fix-episode-panel.png                                           |


---

## Apps view


| Feature                           | Should (v2)                                                                                    | Now                                                                                                                                                      | Status     | Evidence                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| Period toggles (Today/Day/7d/30d) | Same app correct + same title scheme across all periods                                        | 7d/30d populate; daily often empty/wrong; codex live: Today names better (verify)                                                                        | broken     | user, apps-*, live                                                     |
| App list naming **[CORRECTED]**   | Real app name is the bold title every period; category is a quiet badge                        | **7d uses the category** as title ("Development" over Safari); **30d uses a content/artifact title** ("…full documentary") — two different wrong schemes | broken     | apps-7d-safari-named-development.png, apps-30d-safari-119h-domains.png |
| App subtitle                      | Bundle/app name + time + sessions                                                              | Subtitle correct sometimes; title wrong                                                                                                                  | broken     | apps-*                                                                 |
| Detail without Generate           | Time, domains, deduped pages without AI                                                        | Loginwindow nearly empty — "needs more context"; codex live: Safari "needs more context" (verify)                                                        | broken     | apps-7d-loginwindow-empty-without-ai.png, live                         |
| Generate summary                  | Accurate AI blurb; no duplicate artifacts; humanized; honors Settings model                    | Text exists; duplicate "Netflix, Netflix"; long raw titles                                                                                               | broken     | apps-7d-safari-named-development.png                                   |
| Time by domain                    | Domains under the browser that hosted them; non-browser apps get none                          | Netflix/YouTube under Dia "Development" AI tool                                                                                                          | broken     | apps-7d-dia-wrong-domain-attribution.png                               |
| Pages visited                     | Clean list, deduped                                                                            | Duplicates (netfilm.world); trash icon on every row                                                                                                      | broken     | apps-7d-safari-pages-visited-list.png, apps-30d-browsing-*             |
| Delete domain / page **[NEW]**    | Behind menu + confirmation; states blast radius + downstream invalidation; undo where possible | Trash icon on every row; safety/irreversibility unclear                                                                                                  | broken     | apps-7d-safari-pages-visited-list.png                                  |
| Often used with                   | Real co-occurring apps, no system noise                                                        | Includes UserNotificationCenter, Siri                                                                                                                    | broken     | apps-7d-unifi-server-detail.png                                        |
| Category filter pills             | Filter list by corrected category                                                              | Pills render                                                                                                                                             | UNVERIFIED | apps-7d-safari-named-development.png                                   |
| Entertainment in work view        | Separate or de-emphasize drift                                                                 | YouTube/Netflix dominate Safari 119h                                                                                                                     | untrusted  | apps-30d-safari-119h-domains.png                                       |


> **Drop applied:** "30d descriptive titles partially work" is **not** a positive
> signal — a documentary/coursework title as the bold **app-row** title is still
> wrong (it's activity evidence, not app identity).

---

## AI tab / Q&A


| Feature                                    | Should (v2)                                                            | Now                                                                                                 | Status                  | Evidence                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------- |
| Ask about today                            | Answer from history with times (resolver-first)                        | Fails — no tool results; asks user to paste getDaySummary                                           | broken                  | ai-todays-work-no-tool-results.png                                    |
| Ask about week **[CORRECTED]**             | Same grounded quality as today                                         | **Returns** a detailed per-day HH:MM breakdown — the range data path **works**; only tables missing | partial                 | ai-7-days-detailed-day-breakdown.png                                  |
| Project attribution                        | Attribute to named clients; offer setup + inferred breakdown when none | "No projects attributed in Daylens yet"                                                             | broken                  | ai-7-days-by-project-summary-no-projects.png                          |
| Detail on request                          | Deeper breakdown with structure (tables)                               | More prose/bullets, still no tables                                                                 | broken                  | ai-7-days-detail-bullets-not-table.png                                |
| Tables / CSV for tabular data              | Tables when appropriate; valid CSV export                              | Wall of text; CSV prompt exists, unverified                                                         | broken / UNVERIFIED CSV | ai-7-days-summary-prose-no-tables.png, ai-new-chat-empty-sidebar.png  |
| Forgotten-link / artifact recall **[NEW]** | "that link you saw but forgot" resolved from local history             | No URL/page/artifact recall resolver exists                                                         | missing                 | daylens-PMF                                                           |
| Turn into… transforms                      | Reformat the previous grounded answer                                  | Refuses or fails when base answer broken                                                            | broken                  | ai-todays-work-turn-into-bullets-fails.png                            |
| Response voice                             | Chief-of-staff who knows your day                                      | Apologetic, meta, asks user to do app's job                                                         | broken                  | ai-todays-work-*, user                                                |
| Chat sidebar persistence                   | History survives tab switches + navigation                             | **Gone after Apps → AI** (codex live, verify); empty mid-generation                                 | broken                  | ai-new-chat-empty-sidebar.png, ai-chat-sidebar-with-history.png, user |
| Duplicate sidebar entries **[NEW]**        | Each thread listed once                                                | "Last 7 days by project" listed **twice** under TODAY                                               | broken                  | ai-chat-sidebar-with-history.png                                      |
| Switch chat during generation              | Safe switch / cancel / background                                      | Breaks: empty chat, no sidebar, input disabled                                                      | broken                  | user                                                                  |
| Input during generation                    | Usable or clearly blocked + recoverable                                | Disabled / broken during generation                                                                 | broken                  | user                                                                  |
| Model from Settings                        | All AI uses selected model                                             | Header shows Claude; re-analyze uses Gemini                                                         | broken                  | settings-ai-claude-haiku-connected.png, user                          |
| Thinking / loading state                   | Clear, cancelable, recoverable progress                                | "Thinking" with no cancel clarity                                                                   | partial                 | ai-summarize-7-days-thinking-state.png                                |
| Suggested prompts                          | Quick starts that all work                                             | Shown on empty state; today/7d lead to broken answers                                               | partial                 | ai-new-chat-empty-sidebar.png                                         |
| Search chats ⌘K                            | Find past chats                                                        | UI present                                                                                          | UNVERIFIED              | ai-chat-sidebar-with-history.png                                      |


---

## Settings & configuration


| Feature                                | Should (v2)                                                                                | Now                                                                                                         | Status     | Evidence                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------- |
| AI provider + model                    | One provider; every surface honors it; errors name the selected provider                   | Claude Haiku set; not used by re-analyze (Gemini quota)                                                     | broken     | settings-ai-claude-haiku-connected.png, user    |
| Clients / projects                     | Named clients; AI attributes work                                                          | UI empty — no clients                                                                                       | missing    | settings-labels-*, settings-notifications-*     |
| Per-app labels                         | Override propagates to Apps/Timeline/AI after recompute                                    | Overrides exist (Dia→Browsing) but list still wrong in Apps/Timeline                                        | broken     | settings-labels-per-app-and-clients.png         |
| Work memory / patterns **[CORRECTED]** | Patterns improve naming/attribution with varied, earned confidence + shown evidence/impact | **All 19 patterns tagged "browsing" @ identical 65%** — incl. Teams, Claude, malaria report, Apple Dev Docs | broken     | settings-work-memory-learned-patterns.png, user |
| Rebuild memory                         | Rebuild reports what changed; forget removes a pattern                                     | Button exists; outcome not visible                                                                          | UNVERIFIED | settings-work-memory-learned-patterns.png       |
| Consolidate end of day                 | Archives, promotes, decays                                                                 | Toggle on; no visible product improvement                                                                   | untrusted  | settings-work-memory-learned-patterns.png       |
| Morning / evening notifications        | Briefs delivered + deep-link to proof                                                      | Toggles on; content not verified                                                                            | UNVERIFIED | settings-notifications-clients-appearance.png   |
| Distraction alerts **[NEW]**           | Warn only on clear drift; low false positives                                              | Toggle off; threshold 10m; no proof                                                                         | UNVERIFIED | settings-notifications-clients-appearance.png   |
| MCP server                             | Optional external query; off-by-default in packaged prod; env-aware                        | Enabled with **dev** paths                                                                                  | partial    | settings-mcp-server-enabled.png                 |
| Profile name                           | Used in AI persona; doesn't leak into facts                                                | "tonny" set; impact unverified                                                                              | partial    | settings-ai-claude-haiku-connected.png          |
| Theme / appearance **[NEW]**           | System/Light/Dark applies predictably                                                      | Present (Light); behavior unverified                                                                        | UNVERIFIED | settings-notifications-clients-appearance.png   |
| App updates **[NEW]**                  | Packaged builds update; dev builds explain the limit                                       | "Check for updates"; v1.0.44; packaged-only auto-update                                                     | partial    | settings-mcp-server-enabled.png                 |
| Analytics toggle **[NEW]**             | Anonymous telemetry opt-in/out; local-only honored                                         | On; "local-only" badge; behavior unverified                                                                 | UNVERIFIED | settings-tracking-exclusions-privacy.png        |


---

## Wraps & briefs


| Feature                     | Should (v2)                                                      | Now                                                                           | Status                   | Evidence                              |
| --------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------ | ------------------------------------- |
| Morning brief               | One screen: yesterday's open loop → today's pickup               | Toggle on; PMF/code-described carousel w/ focus heuristics; **no live proof** | broken (live-unverified) | settings-notifications-*, daylens-PMF |
| Evening wrap                | ≤5 honest cards; 2 on a leisure day; totals == day header        | Toggle on; PMF/code-described 8-slide deck; **no live proof**                 | broken (live-unverified) | settings-notifications-*, daylens-PMF |
| Daily wrap                  | Narrative in timeline side panel from trusted blocks             | Shape of day attempts; untrusted                                              | untrusted                | timeline-day-jun16-*                  |
| Weekly wrap                 | Week review worth opening; frozen daily snapshots; fail-closed   | Generate exists; data/consistency issues                                      | broken                   | timeline-week-*                       |
| Monthly wrap                | Month patterns from trusted daily facts (in v2, sequenced later) | Not in screenshots                                                            | UNVERIFIED               | daylens-PMF                           |
| Annual wrap **[CORRECTED]** | Year narrative from trusted facts (in v2, sequenced last)        | Not evidenced in screenshots — **not** proven absent                          | UNVERIFIED               | daylens-PMF                           |


---

## Onboarding & trust


| Feature                                 | Should (v2)                                                                                                                       | Now                                                     | Status     | Evidence                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------- | ----------------------------------------------------- |
| First-run / permissions                 | Clear capture + value prop + permission grant; first proof fast; not a feature tour                                               | Not documented                                          | UNVERIFIED | —                                                     |
| Capture health diagnostics **[NEW]**    | Surface permission / URL-capture / idle / private-window / helper-process health                                                  | Not surfaced                                            | missing    | —                                                     |
| Trust affordances **[NEW]**             | Show inferred / low-confidence / corrected-by-you / hidden / deleted / excluded / stale / provider-unavailable / future-vs-paused | Confident summaries from bad inputs; provenance unclear | broken     | all sections                                          |
| Locked / protected user edits **[NEW]** | Manual edits authoritative until explicit reset; re-analysis/rebuild never overwrite                                              | AI re-analysis can overwrite manual edits               | broken     | user, timeline-today-merge-down-fix-episode-panel.png |
| Trust bar                               | Stake a client answer on timeline/AI                                                                                              | Cannot                                                  | broken     | all sections                                          |


---

## Open work — cross-cutting gaps

Tracked in `[DAYLENS-V2-PLAN.md](DAYLENS-V2-PLAN.md)` "Open work"; listed here so the
registry stays complete:

- Correction → downstream cache invalidation/staleness (generated AI/wrap text)
- Day-boundary / timezone definition (local midnight, DST, late-night cross-midnight)
- Historical data migration / backfill (re-derive existing blocks vs new-only)
- Performance at scale (5,977 sessions, 119h/30d; re-segmentation cost)
- Concrete "session" definition + sanity thresholds (anti-inflation benchmark)
- AI privacy boundary (what local history is sent to providers; exclusions pre-call)
- Browser distinction (Chrome vs Safari vs Arc, concurrent browsers)
- Offline / local-AI fallback (Ollama/MCP when offline)
- Accessibility & keyboard flows (chat, correction panel, settings, notifications)
- Packaging vs dev behavior (MCP paths, updates)
- Correction audit trail (distinguish user edits from AI inference; undo/inspect)

---

## How agents use this

1. Read `[PRODUCT.md](../../PRODUCT.md)` (vision), then `[DAYLENS-V2-PLAN.md](DAYLENS-V2-PLAN.md)` (plan).
2. Use these rows as the feature checklist; each **Now** is screenshot/user
  evidence or marked `UNVERIFIED`.
3. **Re-screenshot before trusting any "Now"** — screenshots are dated mid-June
  2026 on app v1.0.44. Confirm `UNVERIFIED` rows by driving the app.
4. Green `npm test` is **not** product truth — open the app and check what you see.

