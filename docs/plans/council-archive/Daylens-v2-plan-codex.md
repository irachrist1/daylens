> ⚠️ **SUPERSEDED — council process artifact (Round 1/2). Do NOT use for implementation.**
> The canonical, assembled plan is [`../DAYLENS-V2-PLAN.md`](../DAYLENS-V2-PLAN.md). Kept for provenance only.

## Problem Statement

Daylens is supposed to be automatic work memory: the trustworthy record of what actually happened on the laptop, with daily proof, useful briefs, and natural-language recall. The current app has most surfaces present, but the user cannot trust them. The same day can show mismatched durations, duplicate blocks, huge unexplained gaps, wrong category labels, leisure inside "what mattered," and AI answers that either ask the user to paste Daylens data back into Daylens or summarize from weak labels instead of evidence.

The product failure is not that Daylens lacks UI. The failure is that every downstream surface depends on an untrusted reality layer. Timeline, Apps, AI, memory, briefs, and reviews all appear implemented, but the screenshots and live app show a chain reaction: capture produces fragmented or misclassified blocks; summaries inherit those bad labels; AI cannot reliably retrieve or format the facts; settings controls do not consistently affect the surfaces they promise to control. A founder, consultant, or engineering lead cannot stake a client update or weekly reflection on this record yet.

Evidence base for this plan:
- Screenshot audit: every file in `docs/plans/screenshots/` was inspected.
- Live app audit: Electron launched through `npm start`; I inspected Timeline for Tuesday, June 16, Apps today, AI after Apps navigation, and Settings. Live evidence matched the screenshot failures: Gemini quota failure despite Claude Haiku selected, Netflix/X in "What mattered," chat history disappearing after navigation, high session counts, and weak app summaries.
- Code was used only to identify likely implementation areas and existing concepts. It was not treated as proof that behavior works.

## Solution

Daylens v2 is the PMF vision made boringly dependable:

1. A scrollable calendar of what actually happened, where each block has sensible boundaries, accurate durations, human labels, correct work/leisure kind, and proof.
2. Morning and evening briefs that reuse the same trusted facts: morning names yesterday's open loop or says there is none; evening gives a short honest close-out.
3. Daily, weekly, monthly, and annual wraps that are worth opening because they agree with the timeline and never pretend leisure was work.
4. Natural-language Q&A that retrieves local history automatically, cites the same fact spine as the timeline and briefs, and formats answers appropriately as prose, tables, checklists, or CSV.
5. Settings and memory that visibly change outcomes: model selection is honored everywhere, client/project labels improve attribution, exclusions remove data from capture and AI, and learned patterns are explainable.

The build strategy should start with trust, not novelty. First make one real week of timeline data trustworthy. Then attach morning brief, evening wrap, Apps, and AI to that same fact spine. Only after daily truth works should weekly/monthly/annual polish matter.

## Feature map (Should vs Now)

| Feature | Should (v2) | Now (today) | Status | Evidence (screenshot / app) |
|---|---|---|---|---|
| Activity capture to time blocks | One real activity stretch becomes one coherent block; breaks and app switches create understandable boundaries. | Blocks are fragmented, duplicated, and interrupted by huge unexplained gaps. | broken | `timeline-today-afternoon-duplicate-development-blocks.png`, live Timeline Jun 16 |
| Block boundaries | A 42-second tab or side app cannot relabel a coding block; dominant intent controls the block. | Cursor/coding can be tagged entertainment; support apps distort labels. | broken | `timeline-today-cursor-block-tagged-entertainment.png` |
| Block naming | Labels say what the user was doing: project, doc, meeting, page, or app. | Generic "Development," "Untitled block," raw/social/page fragments like "iPhone 12 Wi." | broken | `timeline-day-jun16-reanalyze-shape-of-day.png`, live Timeline |
| Work/leisure/personal kind | Kind matches dominant human activity and powers all summaries. | Netflix and X appear in "What mattered"; development and browsing categories are mixed. | broken | live Timeline Jun 16, `timeline-day-jun16-reanalyze-shape-of-day.png` |
| Duration accounting | Block card, detail panel, day total, week chart, and review text agree. | 37m list vs 21m detail; week review says 20h53m while stats say 20h7m. | broken | `timeline-today-duration-mismatch-37m-vs-21m.png`, `timeline-week-jun15-21-review-hours-mismatch.png` |
| Untracked gaps | Gaps are minimized; unavoidable gaps explain idle, pause, permissions, or sleep. | 8h+ and 7h+ gaps appear as unexplained lines. | broken | live Timeline Jun 16, `timeline-day-jun16-reanalyze-shape-of-day.png` |
| System noise filtering | System apps are hidden unless explicitly meaningful. | `loginwindow` is tracked for 50h/30d and appears in Apps. | broken | `apps-7d-loginwindow-empty-without-ai.png`, live Settings |
| Session counts | Counts represent meaningful sessions, not polling churn. | Safari 5,977 sessions/7d in screenshots; live Safari 39 sessions for 59m today. | untrusted | `apps-7d-safari-named-development.png`, live Apps |
| Merge down | User can merge adjacent blocks and receive visible confirmation; totals and detail update immediately. | Control exists, but feedback and persistence are untrusted. | broken | `timeline-today-merge-down-fix-episode-panel.png` |
| Rename block | Rename sticks across list, detail, day review, Apps, and AI. | UI exists, but wrong labels persist throughout screenshots. | untrusted | `timeline-today-merge-down-fix-episode-panel.png` |
| Hide block | User can hide noise from timeline and all summaries, with undo. | Control exists; outcome not verified. | UNVERIFIED — needs live test | `timeline-today-merge-down-fix-episode-panel.png` |
| Day timeline | Calendar-like day view shows a reliable record with proof. | Renders, but data is not trustworthy. | broken | all timeline day screenshots, live Timeline |
| Day stats | Shows accurate tracked/work/leisure/personal totals and block count. | Built from bad blocks; totals can disagree with detail. | broken | `timeline-today-duration-mismatch-37m-vs-21m.png` |
| Episode detail panel | Shows apps, sites, artifacts, and grouping reasons that support the block title. | Evidence can contradict title; Netflix appears inside coding evidence. | broken | `timeline-today-duration-mismatch-37m-vs-21m.png` |
| Shape of day | Honest synthesis from trusted facts; leisure stated plainly, not moralized. | Uses wrong inputs and includes drift/leisure in mattered. | broken | live Timeline, `timeline-day-jun16-reanalyze-shape-of-day.png` |
| Re-analyze with AI | Uses selected Settings provider/model and refreshes the same facts. | Live app reports Gemini quota while Settings is Claude Haiku 4.5. | broken | live Timeline + live Settings |
| Week view chart | Shows accurate daily bars with a clear legend and no false "no data." | Colors need context; multiple days show "No data"; review states can hang. | broken | `timeline-week-jun15-21-no-data-checking-review.png`, `timeline-week-jun1-7-untitled-block-legend.png` |
| Week stats/review | Review total, chart total, day rows, and mode agree. | Totals mismatch; reviews can be missing, checking, or generated from bad labels. | broken | `timeline-week-jun15-21-review-hours-mismatch.png`, `timeline-week-jun8-14-no-saved-review.png` |
| Week day rows | Useful previews that open day proof. | Works structurally, but rows include "Untitled block." | partial | `timeline-week-jun1-7-untitled-block-legend.png` |
| Main mode | Reflects actual dominant mode without treating rest as failure. | "Entertainment" can dominate founder/dev week because inputs are poor. | untrusted | week screenshots |
| Apps period toggles | Today/day/7d/30d use the same correct app identity and evidence. | Today live names apps better; 7d/30d screenshots misname and misattribute. | broken | live Apps, all Apps screenshots |
| App list naming | Primary title is the app name or user-defined project, never an inferred generic category. | Safari/Dia can be titled "Development"; live today has app names. | broken | `apps-7d-safari-named-development.png`, live Apps |
| App detail summary | Detail works before AI generation: time, domains, pages, related apps, and clear context. | "Daylens needs more context" on live Safari; loginwindow detail nearly empty. | broken | live Apps, `apps-7d-loginwindow-empty-without-ai.png` |
| Generate app summary | AI summary is deduped, accurate, and anchored in app/domain/page evidence. | Duplicates, raw titles, and wrong app/domain ownership. | broken | `apps-7d-safari-named-development.png`, `apps-7d-dia-wrong-domain-attribution.png` |
| Time by domain | Domains attach to the browser/app that actually visited them. | Netflix/YouTube appear under Dia "Development" / AI tool contexts. | broken | `apps-7d-dia-wrong-domain-attribution.png`, `apps-30d-dia-coursework-domains.png` |
| Pages visited | Clean, deduped, grouped pages with safe actions. | Duplicates and trash/delete controls on every row; action safety is unclear. | broken | `apps-7d-safari-pages-visited-list.png`, live Apps |
| Often used with | Shows useful co-occurrence, excluding noise and system apps. | Some detail views show it; accuracy untrusted. | partial | `apps-7d-unifi-server-detail.png` |
| Category filter pills | Filter apps by corrected categories. | Pills render; behavior not fully verified. | UNVERIFIED — needs live test | Apps screenshots, live Apps |
| Ask about today | Automatically retrieves history and answers with times/evidence. | Says it lacks tool results and asks user to paste `getDaySummary`. | broken | `ai-todays-work-no-tool-results.png` |
| Ask about week/project | Attributes work by project/client and says when attribution is missing. | No projects; summary inferred from labels only. | broken | `ai-7-days-by-project-summary-no-projects.png` |
| Detail follow-up | Turns summary into a structured deeper breakdown. | Adds bullets/prose but does not use better structure or tables. | broken | `ai-7-days-detail-bullets-not-table.png`, `ai-7-days-detailed-day-breakdown.png` |
| Tables and CSV | Uses tables/CSV for tabular work-session data. | Wall of text; export suggested but not verified. | broken / UNVERIFIED CSV | `ai-7-days-summary-prose-no-tables.png`, AI empty state |
| Turn into transforms | Shorter/checklist/bullets/report transform the previous answer. | Refuses because it treats the source as a data request. | broken | `ai-todays-work-turn-into-bullets-fails.png`, `ai-todays-work-turn-into-menu.png` |
| AI voice | Chief-of-staff voice: grounded, concise, never asks user to do Daylens' job. | Apologetic meta-answer and bad data confidence. | broken | `ai-todays-work-no-tool-results.png` |
| AI chat persistence | Chats survive tab switches, generation, and app navigation. | Live Apps → AI showed "No chats yet"; screenshots show history existed. | broken | live AI, `ai-chat-sidebar-with-history.png`, `ai-new-chat-empty-sidebar.png` |
| Switching mid-generation | Safe switch, cancel, or background generation without corrupting UI. | Founder reports empty chat/sidebar/input disabled. | broken | founder-reported in registry |
| Loading state | Progress is clear, cancellable, and recoverable. | "Thinking" can hang without useful progress/cancel clarity. | partial | `ai-summarize-7-days-thinking-state.png` |
| Suggested prompts | Empty-state prompts work and are grounded. | Prompts render; at least today/7d prompts currently lead to broken answers. | broken | AI screenshots, live AI |
| Model selection | Every AI call honors Settings provider/model. | Timeline re-analysis uses Gemini while Settings shows Claude Haiku. | broken | live Timeline + Settings |
| Provider errors | Provider quota/key errors explain exact surface and next action without corrupting product state. | Gemini quota appears inside Timeline despite Claude selection. | broken | live Timeline |
| Work memory patterns | Learned patterns improve labels, carryover, and attribution; confidence is meaningful. | 19 patterns with identical 65% confidence; bad labels remain. | broken | `settings-work-memory-learned-patterns.png`, live Settings |
| Rebuild/forget memory | Rebuild has visible outcome; forget removes bad patterns from future summaries. | Controls exist; outcome not verified. | UNVERIFIED — needs live test | Settings screenshots |
| Clients/projects | Users can define clients/projects and Daylens attributes sessions to them. | UI empty; project summaries have no attribution. | missing / broken | live Settings, `ai-7-days-by-project-summary-no-projects.png` |
| Per-app labels | Overrides immediately change capture summaries, Apps, Timeline, and AI. | Safari/Dia overrides exist, but screenshots still show wrong aggregate labels. | broken | live Settings, Apps screenshots |
| Tracking exclusions | Excluded apps/sites and private windows are omitted from capture and AI. | UI exists; no excluded items; incognito skip is on but unverified. | partial / UNVERIFIED | `settings-tracking-exclusions-privacy.png`, live Settings |
| Pause tracking | Clearly pauses capture and marks timeline gap as paused. | Toggle exists, off. | UNVERIFIED — needs live test | Settings screenshots |
| Notifications toggles | Morning/evening notifications deliver PMF briefs and deep-link to proof. | Toggles on; actual delivery/content not verified. | UNVERIFIED — needs live test | `settings-notifications-clients-appearance.png`, live Settings |
| Distraction alerts | Warn only when user-defined or inferred work session drifts, with low false positives. | Toggle exists, off; threshold exists; no product proof. | UNVERIFIED — needs live test | Settings screenshots |
| Morning brief | One-screen pickup: yesterday's open thread or clean start, with link to proof. | Toggle exists; PMF doc says existing morning UI is carousel/focus-style; no screenshot proof. | unknown / likely broken | PMF doc, Settings screenshots |
| Evening wrap | Short honest end-of-day recap, max 5 cards, matching timeline. | Toggle exists; PMF doc says legacy 8-slide deck; no screenshot proof. | unknown / likely broken | PMF doc, Settings screenshots |
| Daily wrap | Day panel/notification narrative agrees with timeline. | Shape of day exists but inherits bad facts. | broken | live Timeline |
| Weekly wrap | Weekly recap worth opening and internally consistent. | Missing/checking/generated states; totals and labels unreliable. | broken | week screenshots |
| Monthly wrap | Monthly patterns and project/client recap from trusted daily facts. | Not shown. | UNVERIFIED — needs live test | no screenshot |
| Annual wrap | Year narrative from trusted monthly/daily facts. | Not shown; likely absent or unproven. | missing / UNVERIFIED | PMF doc |
| Onboarding | First run explains value, permissions, privacy, and shows first proof quickly. | Not shown in screenshots. | UNVERIFIED — needs live test | no screenshot |
| Trust affordances | User can tell what is inferred, corrected, hidden, deleted, or low-confidence. | Corrections exist but confidence/provenance are unclear; data can be deleted from rows with no visible undo in screenshots. | broken | timeline/app/settings screenshots |
| MCP server | Optional local query surface with production-safe config. | Enabled with dev Electron paths in live Settings. | partial | live Settings, `settings-mcp-server-enabled.png` |
| App updates | Packaged builds update; dev builds explain limitations. | UI says automatic updates only in packaged builds. | partial | live Settings |
| Theme/appearance | Theme setting applies predictably. | Control exists; behavior not verified. | UNVERIFIED — needs live test | `settings-notifications-clients-appearance.png` |
| Profile name/persona | Display name personalizes AI without leaking into facts. | `tonny` set; impact unverified. | partial / UNVERIFIED | live Settings |

## How each feature should work

### Capture/tracking

- **Should** — Daylens should sample activity, normalize apps/sites, exclude system/private/noise, and produce blocks a user recognizes. A real example: 8:03-10:07 coding in Ghostty/Safari becomes one "Daylens planning/debugging" work block; a 42-second Netflix tab during that window is either ignored as support noise or represented as a tiny drift note, not the title or kind.
- **Now** — Screenshots and live Timeline show generic development blocks, an uncategorized block, social and entertainment interruptions, unexplained 8h and 7h gaps, and session inflation. System apps such as `loginwindow` reach 50h/30d.
- **Gap** — If capture is wrong, every PMF surface lies politely. Morning, evening, Apps, AI, and weekly reviews cannot be trusted until this layer is fixed.
- **Fix** — Treat block creation as a product contract. Rework segmentation around dominant activity, minimum meaningful duration, idle/sleep/pause reasons, and support-app evidence. Add a system-noise denylist. Store one canonical active duration per block and derive all cards/details from it. Promote work/leisure/personal kind to a first-class field with confidence and reason. Corrections must update or invalidate all derived summaries.

### Timeline

- **Should** — Timeline is the proof surface. The day header shows tracked, work, leisure, personal, idle/pause totals. Blocks show title, time, duration, kind, and concise evidence. Detail explains why sessions were grouped. Week view summarizes the same facts, with consistent totals and a legend.
- **Now** — Live Jun 16 shows `6h 1m tracked`, `13 blocks`, an 8h gap, a Gemini re-analysis error, and "What mattered" listing Development, Netflix, X, Productivity. Screenshots show duplicate development blocks, duration mismatches, no-data days, and weekly review total mismatches.
- **Gap** — Timeline cannot serve as the calendar of reality because it contradicts itself.
- **Fix** — Rebuild timeline rendering around a single day payload contract: block span, active duration, kind breakdown, evidence, correction status, and gap reason. Detail panel, day stats, shape of day, and week review must consume that contract, not recompute. Corrections should show optimistic and persisted states. Keep editing controls behind a "Not right?" affordance after the read-only proof is clear.

### Apps view

- **Should** — Apps answers "where did my time go?" by app, category, domain, page, and related context. App identity is stable across Today/Day/7d/30d. Browser domains belong to the browser that visited them, not to a generic category or AI tool label. Delete/hide actions are safe, confirmed, and reversible where possible.
- **Now** — Live Today names Safari/Dia/Ghostty correctly but says Safari needs more context and shows 39 sessions for 59m. Screenshots show Safari/Dia titled "Development," Netflix/YouTube under Dia, system apps as top rows, and duplicated pages.
- **Gap** — The Apps view amplifies identity and aggregation errors from capture; it also presents potentially destructive row actions too casually.
- **Fix** — Separate app identity from inferred activity label. The app list title should be canonical app name; project/activity labels belong in subtitles or summaries. Domain/page rollups must be keyed by actual browser session ownership. Deduplicate pages by normalized URL/title windows. Hide system/noise by default. Move delete actions behind a menu/confirmation and show what will be removed from Timeline and AI.

### AI chat & Q&A

- **Should** — AI should behave like a local work-memory analyst. It retrieves relevant Daylens data automatically, states time ranges, uses project/client attribution when available, admits attribution gaps, and formats output to match the user request. Follow-up transforms operate on the existing answer without pretending it is a new data request. Chat history is durable.
- **Now** — AI tells the user to paste `getDaySummary`, produces prose when tables are appropriate, cannot transform its answer into bullets, can hang on Thinking, loses history after Apps → AI in live audit, and can summarize by project without projects.
- **Gap** — The AI surface is the most direct PMF promise, but it currently breaks both retrieval trust and conversation state trust.
- **Fix** — Route common questions through deterministic local resolvers first: today/yesterday, week, project/client, open loops, focus windows, app/site breakdown, CSV export, "what was I doing at time." Each resolver returns structured data, evidence, and display intent. The LLM may narrate, but cannot invent missing tool results. Build transforms as answer-level operations over stored assistant messages. Persist thread/sidebar state independently of route tab state and keep generation cancellable.

### Memory

- **Should** — Memory should learn stable facts that improve the record: "malaria_group3_report_draft is coursework," "Pioneer AI by Fastino Labs is a project," "Dia is browsing unless a domain/page says otherwise." Learned patterns should have explainable evidence, confidence, last used, and visible impact.
- **Now** — Settings shows 19 promoted patterns, 109 occurrences, and repeated 65% confidence. Bad labels remain in timeline, Apps, and AI.
- **Gap** — Memory appears decorative or actively misleading.
- **Fix** — Make memory a reviewable attribution layer, not a generic pattern list. Promote patterns only when repeated evidence changes labeling or attribution. Show "used in N recent blocks" and let users accept/forget. Rebuild memory should report what changed. Bad memory must never override stronger live evidence.

### Morning brief

- **Should** — Morning is one calm pickup screen: "The malaria report draft was still open yesterday afternoon. Pick it up?" or "Nothing left open — clean start." It deep-links to yesterday's timeline evidence.
- **Now** — Notification toggle exists, but actual delivery/content is unverified. PMF doc says the existing morning experience is a carousel with focus/identity slides and fallback copy that ignores carryover.
- **Gap** — The wedge surface is not yet the wedge; it is likely a recap carousel instead of a pickup loop.
- **Fix** — Drive morning only from the trusted facts spine: carryover first, then clean-start fallback. No focus score, no category identity, no slideshow. Notification body and opened view must say the same thing.

### Evening wrap

- **Should** — Evening is a short, honest close-out: shape of day, what work moved, where time went, open thread if any, close. Leisure-heavy day gets a short plain recap, not a lecture.
- **Now** — Toggle exists, but actual delivery/content is unverified. PMF doc says an 8-slide legacy deck still exists while a calmer backend model is present.
- **Gap** — End-of-day value depends on trust and restraint; a bloated or contradictory wrap will be ignored.
- **Fix** — Render max five cards from the same facts as Timeline. Never include leisure in "what mattered." Use the same work/leisure totals as day header. Hide cards with no evidence.

### Daily/weekly/monthly/annual wraps

- **Should** — Daily wraps summarize the exact day; weekly/monthly/annual wraps aggregate trusted daily facts. Reviews are consistent with charts and useful for "what did I do last Thursday/last week/last month?"
- **Now** — Daily shape exists but is wrong when facts are wrong. Weekly review can be absent, stuck checking, generated with mismatched totals, or built from poor labels. Monthly/annual are not shown.
- **Gap** — Wraps are only valuable after the underlying calendar is reliable.
- **Fix** — Defer monthly/annual polish until day/week trust is fixed. Weekly review should be regenerated from canonical daily fact snapshots and fail closed when data is incomplete.

### Notifications

- **Should** — Notifications are small trustworthy entry points: morning pickup, evening close, optional distraction alert. Each click opens the relevant proof surface. Notification text never references untrusted or unavailable providers.
- **Now** — Toggles exist; actual delivery is unverified. Re-analysis errors can expose wrong provider state in Timeline.
- **Gap** — Notifications can easily erode trust because they interrupt the user.
- **Fix** — Add manual "send test notification" paths for development and acceptance. Notification payloads should include route/date/context and use already-computed facts. Distraction alerts remain off by default until false-positive rate is measured.

### Settings

- **Should** — Settings is where the user controls how Daylens thinks: AI provider/model, privacy/exclusions, clients/projects, labels, memory, notifications, theme, updates, MCP. Every setting should have visible product consequences.
- **Now** — Settings is broad but not authoritative. Model selection is contradicted by Gemini re-analysis. App labels exist but aggregate views still mislabel. Clients are empty. MCP is enabled with dev paths. Exclusions are empty and unverified.
- **Gap** — Controls without effects feel like props.
- **Fix** — Make Settings the source of truth for all AI calls and classification overrides. Add post-change invalidation/recompute. Show the last applied time and affected surfaces for labels, clients, exclusions, and memory. Keep MCP off by default in production and display environment-aware config.

### Onboarding

- **Should** — First run should explain automatic work memory, ask for required permissions, set privacy expectations, offer AI setup, and show first proof as soon as capture has enough data.
- **Now** — Not in screenshots or live-tested in this pass.
- **Gap** — Unknown. A broken first-run flow can prevent all PMF surfaces from ever receiving data.
- **Fix** — Treat onboarding as a required acceptance path after timeline trust. It should verify permissions, capture health, private-window behavior, and first-day empty states.

### Trust

- **Should** — Trust is a product surface. Users should know what is captured, inferred, corrected, hidden, deleted, low-confidence, or unavailable. Daylens should never pretend certainty.
- **Now** — UI often presents confident summaries from bad inputs; some controls exist but their outcomes are not visible; AI asks the user for data it should retrieve.
- **Gap** — The app looks done while behaving untrustworthily.
- **Fix** — Add confidence/reason metadata where it matters, but keep the primary UI human. Use explicit states: "No data because tracking paused," "Low-confidence label," "Edited by you," "Hidden from summaries," "Provider error: selected model unavailable." Product truth requires live screenshots or app testing, not green unit tests.

## User Stories

1. As a founder, I want yesterday's timeline to match what I remember within about 15 minutes, so that I can trust Daylens before reading any summary.
2. As a founder, I want Daylens to separate coding, meetings, browsing, and Netflix into distinct blocks, so that my work record is not polluted by side activity.
3. As an engineering lead, I want a coding block to stay work even if a browser tab briefly opens, so that support context does not hijack the block.
4. As a consultant, I want block durations to match across cards, details, and weekly reviews, so that I can bill or report time without manual reconciliation.
5. As a first-time user, I want unexplained gaps to say whether tracking was paused, idle, asleep, or permission-limited, so that I know whether the app failed.
6. As a privacy-conscious user, I want system apps and private windows excluded from meaningful summaries, so that Daylens captures work rather than OS noise.
7. As a founder, I want "What mattered" to include only substantive work/personal items, not Netflix or X, so that summaries read like memory instead of judgment.
8. As a founder, I want morning brief to name the open thread from yesterday, so that I can start the day quickly.
9. As a founder, I want morning brief to say "clean start" when no real open loop exists, so that it does not manufacture obligations.
10. As a founder, I want evening wrap to be short and honest, so that I actually open it before closing the laptop.
11. As a user on a rest day, I want leisure stated plainly without focus guilt, so that Daylens remains a record rather than a scold.
12. As a consultant, I want client/project attribution to be explicit and confidence-scored, so that I know what can be reported.
13. As a consultant, I want to add a client once and have future relevant sessions attribute correctly, so that I do not manually tag every block.
14. As an engineering lead, I want to ask "what did I ship on Daylens last week?" and receive a structured answer with evidence, so that I can write updates.
15. As a founder, I want to ask "what was I doing Thursday at 4pm?" and get the block, apps, pages, and confidence, so that Daylens replaces memory.
16. As a user, I want AI to use tables when I ask for detail by day/project, so that I can scan rather than read a wall of prose.
17. As a user, I want "turn into bullets/checklist/report" to transform the existing answer, so that the chat feels like an assistant.
18. As a user, I want chat history to survive switching tabs and generation, so that I do not lose work.
19. As a user, I want a stuck AI generation to be cancellable, so that the input never becomes permanently disabled.
20. As a user, I want Settings model selection to be honored by timeline re-analysis, wraps, and chat, so that provider errors make sense.
21. As a user, I want app category overrides to immediately change Apps/Timeline/AI after recompute, so that fixing labels pays off.
22. As a privacy-conscious user, I want excluded sites/apps to disappear from future capture and AI answers, so that controls have teeth.
23. As a user, I want delete/hide activity actions to explain their blast radius and offer undo where possible, so that cleanup is safe.
24. As a founder, I want weekly reviews to agree with charts and day rows, so that the week recap is usable.
25. As a long-term user, I want monthly and annual wraps built from trusted daily facts, so that they feel earned rather than generated.
26. As a new user, I want onboarding to prove capture is working after permissions, so that I know Daylens is alive.
27. As a user, I want MCP server config to be correct for my environment and off unless I opt in, so that local data exposure is intentional.
28. As a user, I want learned memory patterns to show evidence and impact, so that I can keep useful ones and delete wrong ones.
29. As a user, I want distraction alerts only when I have clearly drifted from work, so that notifications do not become noise.
30. As a builder, I want acceptance criteria based on live app screenshots and seeded real-week data, so that I cannot ship a feature that only passes unit tests.

## Implementation Decisions

### Reality layer

The capture-to-block pipeline should be treated as the root product primitive. Modify, do not replace wholesale, because the app already records sessions and builds timeline payloads. The target contract is:

```ts
type DayFactBlock = {
  id: string
  startMs: number
  endMs: number
  activeMs: number
  title: string
  kind: 'work' | 'leisure' | 'personal' | 'idle'
  category: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
  apps: EvidenceApp[]
  sites: EvidenceSite[]
  artifacts: EvidenceArtifact[]
  correction?: { label?: string; kind?: string; hidden?: boolean }
}
```

Every surface should consume this or a direct aggregate of it. Do not let day stats, detail panel, weekly reviews, Apps, and AI each invent their own duration math.

### Classification and naming

Modify the existing kind/category/intent approach, but impose precedence:

1. User corrections and exclusions.
2. System/noise/private denylist.
3. Dominant duration and active app.
4. Strong domain/document/project signals.
5. Support apps/sites only as evidence, not title/kind.
6. Low-confidence fallback labels that visibly invite correction.

Do not title app rows with category names. App identity and activity identity are separate concepts.

### Corrections

Rename, merge, hide, delete, label override, and client attribution must share one correction/invalidation system. A correction should update current UI immediately, persist, recompute derived summaries, and mark downstream cached AI/wrap text stale. Replace isolated one-off correction handlers if they cannot meet that contract.

### AI and providers

Use one provider selection service for chat, timeline re-analysis, app summary generation, wraps, and any "Generate" button. A surface cannot pick Gemini when Settings says Claude unless the user explicitly chose fallback behavior. Provider errors should return structured surface-safe states.

AI Q&A should be resolver-first. The LLM should not decide whether data exists; local resolvers should fetch facts, and the LLM should format/narrate only after facts are available.

### Conversation state

Replace route-local chat/sidebar state with durable thread state. Generation belongs to a thread id and can continue, cancel, or fail without blanking the sidebar. The input may be disabled during submission, but the state must be recoverable and visible.

### Briefs and wraps

Reuse the daily fact spine. Morning is carryover-only plus clean-start fallback. Evening is max five cards. Weekly/monthly/annual are aggregates of frozen daily fact snapshots, not fresh freeform summaries over raw sessions.

### Settings

Modify Settings to become operational, not merely declarative. Every setting that changes data interpretation should trigger a recompute or show "will apply to future activity only." Sensitive operations such as delete activity, forget memory, archive client, and MCP enablement should have clear confirmations and impact text.

### Onboarding

Keep onboarding focused: permissions, privacy, AI optionality, and first proof. Do not make onboarding a tour of all features. The first success state is "Daylens captured X minutes and can show evidence."

## Testing Decisions

External behavior tests should prove the Should behavior and catch the screenshot failures:

1. **Dogfood real-week fixture** — Export a founder week into deterministic fixtures. Acceptance requires screenshot-level comparisons for day, week, Apps, and AI. This would have caught June 16 labels, gaps, and Gemini mismatch.
2. **Segmentation scenario tests** — Given app/session streams with coding plus brief Netflix/X, assert one work block plus small drift or separate leisure block; never entertainment-coded Cursor work.
3. **Duration consistency test** — For each fixture block, assert list duration, detail duration, day total, app totals, and week review totals derive from the same activeMs.
4. **Gap reason test** — Simulate idle, sleep, pause, permission denial, and no samples. Assert UI shows distinct reasons.
5. **System-noise exclusion test** — Feed `loginwindow`, notification center, Finder micro-sessions, and capture helper processes. Assert they are hidden from top apps and summaries unless explicitly requested.
6. **Apps aggregation test** — Browser domains belong to the actual browser sessions; Dia/Safari/Chrome rows keep app names across Today/7d/30d; pages dedupe.
7. **Correction propagation test** — Rename/merge/hide/delete/label override updates Timeline, Apps, day facts, weekly review, and AI resolver payloads.
8. **Provider routing test** — Set Claude in Settings; trigger chat, app generate, timeline re-analysis, morning/evening generation. Assert all use Claude or produce selected-provider errors.
9. **AI resolver tests** — "What did I work on today?", "Summarize 7 days by project", "What was I doing Tuesday at 10:30?", "Export today's work sessions as CSV" must return structured local data before LLM narration.
10. **Transform tests** — After a base answer, "turn into bullets/checklist/report" transforms the previous assistant message and never asks for raw data again.
11. **Chat persistence test** — Create history, navigate AI → Apps → AI, switch chat mid-generation, cancel generation. Assert sidebar/history/input remain coherent.
12. **Morning/evening notification tests** — Manual fire routes open the right date and render carryover/close-out from facts; notification body matches screen.
13. **Weekly review consistency test** — Generated review total equals chart/card total; no "No data" for days with captured sessions; no review from incomplete data without a caveat.
14. **Memory impact test** — Promote a pattern, show affected blocks, rebuild, forget, and assert labels/attribution change or explicitly report no change.
15. **Privacy/exclusion test** — Excluded app/site and private-window sessions are absent from future capture and AI; old data handling is explicit.
16. **Onboarding smoke test** — Fresh profile reaches permission request, capture health, and first proof without requiring AI setup.

Manual acceptance must include live screenshots after every phase. Unit tests are necessary but never sufficient for product truth.

## Build sequence (for autonomous execution)

### Phase 1 — Establish the trusted day contract

Acceptance:
- Launch the app on a seeded founder day and a live current day.
- Day header, block cards, detail panel, and shape-of-day all use one duration source.
- Coding, meetings, browsing, social, and Netflix are separate or clearly annotated.
- No `loginwindow` or system noise in meaningful top apps/summaries.
- Screenshot proof replaces the current Jun 16 failures: no duplicate adjacent development blocks, no duration mismatch, no Netflix/X in "What mattered."

### Phase 2 — Corrections and invalidation

Acceptance:
- Rename, merge, hide, delete, app-label override, and client attribution update visible Timeline and Apps immediately.
- Reload app; corrections persist.
- Ask AI about the corrected day; answer reflects corrections.
- Derived day/week summaries are marked stale or regenerated.

### Phase 3 — Apps view truth

Acceptance:
- Today/Day/7d/30d keep canonical app names.
- Browser domains/pages are under correct app; duplicates are collapsed.
- Generate summary uses selected provider and evidence.
- System/noise apps are hidden by default with a way to inspect them.
- Destructive actions require explicit confirmation and describe impact.

### Phase 4 — AI Q&A reliability

Acceptance:
- Empty-state prompts all work from local history without asking user to paste data.
- Today/week/project/time-at-moment answers include times and evidence.
- Detail requests produce tables where appropriate.
- CSV export creates valid CSV from sessions.
- "Turn into..." transforms the prior answer.
- Navigation and mid-generation switching do not erase chat history or disable input permanently.

### Phase 5 — Settings and model authority

Acceptance:
- Claude selected in Settings means timeline re-analysis, app summary, AI chat, and wraps use Claude.
- Provider quota/key errors mention the selected provider and surface recovery actions.
- Label/client/memory/exclusion changes show affected surfaces and trigger recompute or future-only messaging.
- MCP config is environment-aware and off by default in packaged production.

### Phase 6 — Morning brief wedge

Acceptance:
- Manual test notification opens a one-screen morning brief for yesterday.
- If carryover exists, notification and screen name the same open thread and link to timeline evidence.
- If no carryover exists, it says clean start.
- No carousel, score, focus percent, or generic category identity appears.

### Phase 7 — Evening wrap

Acceptance:
- Manual evening notification opens max five cards: shape, worked-on, where time went, open thread, close.
- Leisure-heavy day renders a short honest leisure recap and close.
- Wrap totals and labels match Timeline exactly.
- No guilt/drift framing unless it is explicit user-selected distraction context.

### Phase 8 — Weekly/monthly/annual wraps

Acceptance:
- Weekly review total equals chart total and daily rows.
- "No data" appears only when the day truly has no tracked data or tracking was unavailable, with reason.
- Monthly and annual surfaces either exist with trusted aggregate facts or are explicitly deferred/hidden.
- User can answer "what did I do last Thursday/last week/last month?" from Daylens alone.

### Phase 9 — Onboarding and trust polish

Acceptance:
- Fresh profile path verifies permissions, capture health, privacy defaults, AI optional setup, and first proof.
- All low-confidence labels have correction affordances.
- All hidden/deleted/corrected data is represented consistently in Timeline, Apps, AI, and wraps.

## Out of Scope

- Greenfield rewrite of the app.
- Calendar/email integrations beyond local laptop-memory PMF.
- Team/admin/cloud sync features as a prerequisite for v2.
- New social/sharing features.
- Complex productivity scoring. Scores should be removed or de-emphasized until the record is trusted.
- Monthly/annual visual spectacle before daily/weekly truth is stable.

## Further Notes

### Screenshot audit ledger

| Screenshot | Audited observation |
|---|---|
| `meta-ide-handoff-context.png` | IDE context only; not product UI evidence. |
| `ai-todays-work-no-tool-results.png` | AI cannot retrieve today's work and asks the user to paste tool output. |
| `ai-todays-work-turn-into-menu.png` | Transform menu exists with shorter/checklist/bullets/report actions. |
| `ai-todays-work-turn-into-bullets-fails.png` | Transform fails because AI treats prior answer as a data request. |
| `ai-summarize-7-days-thinking-state.png` | Thinking/loading state can sit without useful progress or cancel clarity. |
| `ai-7-days-by-project-summary-no-projects.png` | Weekly project answer has no projects/clients and weak attribution. |
| `ai-new-chat-empty-sidebar.png` | Empty sidebar state appears despite founder-reported/history screenshot. |
| `ai-7-days-summary-prose-no-tables.png` | Summary is wall-of-text prose for inherently tabular data. |
| `ai-7-days-detail-bullets-not-table.png` | Detail follow-up remains bullets, not a scannable table. |
| `ai-7-days-detailed-day-breakdown.png` | Per-day detail exists but still relies on labels and lacks project attribution. |
| `ai-chat-sidebar-with-history.png` | Sidebar history exists in some state; live navigation later showed it disappearing. |
| `settings-ai-claude-haiku-connected.png` | Claude Haiku selected and connected. |
| `settings-work-memory-learned-patterns.png` | Memory patterns show repeated identical confidence and unclear impact. |
| `settings-labels-per-app-and-clients.png` | App label overrides exist; clients empty; loginwindow visible. |
| `settings-notifications-clients-appearance.png` | Morning/evening toggles exist; clients empty; theme controls exist. |
| `settings-mcp-server-enabled.png` | MCP config visible with dev Electron paths; enabled state needs production review. |
| `settings-tracking-exclusions-privacy.png` | Privacy/exclusion controls exist; no exclusions; incognito skip unverified. |
| `apps-7d-safari-named-development.png` | Safari aggregate is framed as Development; summary has raw/duplicated context. |
| `apps-7d-safari-pages-visited-list.png` | Page list includes entertainment/social pages and row delete icons. |
| `apps-7d-loginwindow-empty-without-ai.png` | System app appears as tracked meaningful activity with empty context. |
| `apps-7d-unifi-server-detail.png` | Detail and "often used with" structure exists; accuracy untrusted. |
| `apps-7d-dia-wrong-domain-attribution.png` | Netflix/YouTube domains appear under Dia/Development-like context. |
| `apps-30d-dia-coursework-domains.png` | 30d Dia includes mixed coursework, social, AI, YouTube domains. |
| `apps-30d-safari-119h-domains.png` | Safari has huge 30d time and mixed entertainment/social domains. |
| `apps-30d-browsing-github-x-youtube.png` | Browsing detail mixes GitHub/X/YouTube; category-level title hides app identity. |
| `timeline-today-cursor-block-tagged-entertainment.png` | Coding block is tagged entertainment because of Netflix evidence. |
| `timeline-today-duration-mismatch-37m-vs-21m.png` | List/detail duration mismatch and contradictory evidence. |
| `timeline-today-merge-down-fix-episode-panel.png` | Correction controls exist but feedback/persistence are unproven. |
| `timeline-today-afternoon-duplicate-development-blocks.png` | Adjacent duplicate development blocks and duration/gap oddities. |
| `timeline-week-jun15-21-no-data-checking-review.png` | Week view shows days with no data and checking review state. |
| `timeline-week-jun8-14-no-saved-review.png` | Week review missing; Generate present. |
| `timeline-week-jun1-7-untitled-block-legend.png` | Week rows include Untitled block; legend/readability issue. |
| `timeline-week-jun1-7-week-review-generated.png` | Generated weekly review exists but depends on dubious labels. |
| `timeline-week-jun15-21-review-hours-mismatch.png` | Review total disagrees with week stats. |
| `timeline-day-jun16-reanalyze-shape-of-day.png` | Re-analyze/shape panel exists; labels/gaps/score are untrusted. |

### Live-app observations from this pass

- `npm start` launched Electron and loaded Daylens at `localhost:5173`.
- Timeline for Tuesday, June 16 showed `6h 1m tracked`, `13 blocks`, an `8h 3m` opening gap, a `7h 12m` ending gap, "What mattered" including Netflix and X, and `AI re-analysis failed` because of a Google Gemini request limit while Settings selected Claude Haiku 4.5.
- Apps Today showed better canonical app names than some screenshots, but Safari still said "Daylens needs more context," had `59m` across `39 sessions`, and exposed per-domain delete buttons.
- AI after Apps navigation showed `No chats yet` even though screenshot evidence shows prior chat history. This reproduces the founder-reported chat/sidebar persistence issue.
- Settings showed Claude connected, Claude Haiku 4.5 selected, memory patterns, empty clients, notification toggles, MCP enabled with dev paths, tracking exclusions enabled but empty, and incognito skip on.

### Unverified items requiring live tests in implementation

- Actual morning notification content and opened morning screen.
- Actual evening wrap content and opened evening screen.
- Hide block persistence and downstream summary effects.
- Rename/merge persistence across reload and AI.
- Category filter pill behavior in Apps.
- CSV export prompt/action.
- Private/incognito skip behavior.
- Pause tracking behavior and gap reason.
- Distraction alert false positives.
- Theme switching.
- Fresh onboarding flow.
- Monthly and annual wrap surfaces.
