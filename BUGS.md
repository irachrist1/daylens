# Daylens — Observed Bugs From 2026-05-13 Manual Test Pass

This is a list of things that look wrong, grounded in screenshots Tonny captured on 2026-05-13 around 5:25–5:31 PM after a session that touched the AI, Apps, Timeline, and Wrapped/Reports surfaces. Every observation below is something a fresh test session can reproduce by opening the same surface in dev or against the production DB on Tonny's machine.

**Read this as observations, not conclusions.** Each "Potential cause" / "Potential fix" line is a hypothesis from the previous agent — verify the symptom first, then trace through the code, then form your own diagnosis. The previous agent may have misread the cause; don't be afraid to throw the hypothesis out.

**Before you touch any AI code path, read in this order:**

1. `docs/AGENTS.md`
2. `docs/AI-PRODUCT-DIRECTION.md` (P0 directives, especially D1, D4, D5)
3. `docs/PRODUCT-SPEC.md`

If a "potential fix" below contradicts a P0 directive, the directive wins. Stop and ask Tonny.

**Working rules carried over from previous sessions:**
- One item per session. Don't batch fixes.
- Before writing code, state your intended approach in 3-5 sentences and confirm.
- Documented ≠ shipped. Prompt-tweaked ≠ data-fixed. Be explicit about which layer changed.
- The behavioural harness costs real money. Run scenarios one at a time with the filter, never the full suite without explicit authorization.
- No `--no-verify`, no force push, no destructive git ops.

---

## B1 — Raw window titles are being used as block labels

**Symptom.** Timeline (screenshot at ~17:26 on 2026-05-13) shows a block titled `W2_Reading | Introduction to Machine Learning` for the 8:55–9:09 AM span. The "Live now" banner at the top reads `Vecta Global Distributors | Home of Great Brands`. Both look like raw browser tab titles, not block-level activity labels.

The same Timeline view's right sidebar ("What mattered") *does* render a cleaner label: `Course | Perusall`. So a useful label exists somewhere — it's just not making it to the visible block row or the live banner.

**Why this matters.** Per `docs/AGENTS.md` Timeline Contract: "do not fall back to raw app names when better work context exists" and "visible labels should prefer user override, then useful AI labels, then stable evidence- or rule-based labels." Raw tab titles are not labels — they're evidence. This is also the F2 failure mode listed in `docs/AI-PRODUCT-DIRECTION.md`.

**Potential cause.** The renderer or the block-builder may be reading `block.label.current` from a path that still pulls window titles when the AI label hasn't landed yet. The sidebar's "Course | Perusall" suggests a fallback at the *summary* layer that the main block row doesn't share. Could also be that an earlier fix touched the AI path (per the previous agent's notes) but not the Wrapped / live-banner paths.

**Potential fix.** Audit every place that reads `block.label.current` directly and switch to `userVisibleLabelForBlock(block)` (already exported from `src/main/services/workBlocks.ts`). Specifically: the Timeline row, the "Live now" banner, Wrapped, and the weekly brief. The previous agent claimed F2 fixed the AI path — assume that claim might be wrong and re-check.

**Where to look.** `src/renderer/views/Timeline.tsx` (block row + live banner), `src/main/services/workBlocks.ts:userVisibleLabelForBlock`, anywhere `label.current` is consumed.

---

## B2 — AI bare-refused a question whose answer is visibly in the data

**Symptom.** Tonny asked "What was I doing around W2_Reading | Introduction to Machine Learning | Perusall?" The AI replied: "I can't see any evidence of a session with that window title or anything matching 'Perusall' or 'W2_Reading Introduction to Machine Learning' in your activity data."

But Perusall *is* in the data:
- The Apps view (5.27 PM) lists `app.perusall.com` as a visited site on the same day.
- The Timeline (5.26 PM) shows a block whose label literally contains `Perusall`.

On a retry ~5 minutes later (5.31 PM screenshot), the AI did surface the right context. So the second answer proves the data was there all along.

**Why this matters.** `docs/AI-PRODUCT-DIRECTION.md` D4 (Never refuse with "I don't know") bans this output shape: "If the user asks about something Daylens doesn't currently capture, name the closest captured signal and answer from that." The phrase "I can't see…" is explicitly banned.

**Potential cause.** The first turn may have hit the router's "before-tracking" or "no-match-for-entity" branch instead of falling through to the tool-use path. Or the tool the model called returned empty because the entity name was treated as a literal window title to match exactly rather than fuzzy-matching against page titles/URLs.

**Potential fix.** Trace the trace JSON for this exact prompt (look in `.ai-behaviour/traces-*` if one was captured, or rerun with `DAYLENS_AI_TRACE_DIR` set). Find which tool was called, what it returned, and why the model concluded "no evidence." Likely fix is in the search tool's fuzzy matching or in the system-prompt guidance forbidding bare refusals.

**Where to look.** `src/main/services/aiTools.ts`, `src/main/ai/voiceContract.ts` (the bare-refusal ban is in there but the model isn't obeying), the router's empty-result branches in `src/main/lib/insightsQueryRouter.ts`.

---

## B3 — Mathematically impossible Apps narrative

**Symptom.** Apps view "Today" → Kiro panel (5.27 PM): "1h 37m across 33 sessions, concentrated in the 9:00–9:46am window."

33 sessions and 1h 37m of foreground time cannot fit inside a 46-minute window. Pick any two: 33 sessions in 46 minutes (averaging ~1.4 min each), 1h 37m total in 46 minutes (impossible), or 33 sessions of 1h 37m total (each ~3 min, but then the window is wrong).

**Why this matters.** This is a credibility floor. If the user spot-checks one paragraph and the arithmetic doesn't add up, no other narrative can be trusted.

**Potential cause.** The narrative generator may be receiving inputs from different time windows (one for "total time", one for "session count", one for "concentrated window"). Or `getAppDetailPayload` returns a window range derived from a different filter than the session counter.

**Potential fix.** Find which structured input the narrator is fed for the Kiro app panel, log it, compare against the narrative output. If the structured data is consistent, the prompt is the problem. If the structured data itself is inconsistent, the aggregator is.

**Where to look.** `src/main/services/workBlocks.ts:getAppDetailPayload`, the narrative builder (probably in `src/main/jobs/aiService.ts` near `buildAppNarrativeBundle`), and whatever produces the "concentrated in the X–Y window" prose.

---

## B4 — Same metric, three different values across surfaces

**Symptom.** For Kiro, today:
- Apps left rail (5.27 PM): "1h 38m · 36 sessions"
- Apps right-panel narrative (5.27 PM): "1h 37m across 33 sessions"
- AI chat day-summary answer (5.28 PM): "Kiro open for ~1h 38m across 35 sessions"

Same app, same day, three different session counts (33, 35, 36) and two different totals (1h 37m, 1h 38m).

**Why this matters.** Cross-surface inconsistency erodes trust faster than a single wrong number does. The user starts to suspect that *none* of the numbers are right.

**Potential cause.** Different surfaces probably hit different aggregators:
- Apps rail likely hits `getAppSummaries`
- Apps narrative likely hits `getAppDetailPayload`
- AI chat likely hits a tool that recomputes from `app_sessions` directly
Each may apply slightly different filters (live-session merge on/off, minimum-duration cutoff, canonical-app collapsing).

**Potential fix.** Pick one source of truth (probably `getAppSummariesForRange` since it's the database-shaped one), normalise the narrative builder + the AI tools to read from it, document the canonical query. Test that all three surfaces show the same number for the same range.

**Where to look.** `src/main/db/queries.ts:getAppSummariesForRange`, `src/main/services/workBlocks.ts:getAppDetailPayload`, the AI tool implementations in `src/main/services/aiTools.ts` or `src/main/services/ai.ts`.

---

## B5 — Apps view does not lead with activity (architectural shift not visible)

**Symptom.** Every visible Apps row in the screenshots (5.27.20, 5.27.27, 5.27.38, 5.27.45, 5.28.02 PM) shows the app name as primary text and `1h 38m · 36 sessions` as the subtitle. The previous agent claimed to have shipped a change in `src/renderer/views/Apps.tsx` that makes the primary text be the top block label and demotes the minutes line, but the running build does not show that shape.

**Why this matters.** Per `docs/AI-PRODUCT-DIRECTION.md` D5: "primary text in each app row is what was accomplished in it today, not the app name + minute total."

**Potential cause.** Three candidates worth checking in order:
1. The build the user is running predates the change — they may need a fresh `npm run build:all` or a dev reload.
2. The new `getAppActivityDigest` IPC is returning zero entries (e.g., `block.topApps` is empty for the rendered date range, or the bundleId keying mismatches against `summary.canonicalAppId`).
3. The renderer only swaps the row shape when `topBlockLabel || topArtifactTitle` is non-null. If the digest is returning rows with both null, the row stays in the old shape — silently.

**Potential fix.** First reproduce. Open Apps with the latest code, log what `digestByApp` contains, and verify whether the conditional in the row renderer is hitting the new branch. If the digest is genuinely empty, debug `IPC.DB.GET_APP_ACTIVITY_DIGEST` in `src/main/ipc/db.handlers.ts` — walk through the day-payload loop and check whether `block.topApps[].bundleId` actually matches the apps in the rail.

**Where to look.** `src/main/ipc/db.handlers.ts` (the `GET_APP_ACTIVITY_DIGEST` handler), `src/renderer/views/Apps.tsx` (the `digestByApp` map and the row renderer using `activityHeadline`).

---

## B6 — "from undefined to undefined" in the weekly report fallback

**Symptom.** Week review report at `~/Library/Application Support/DaylensWindows/generated-reports/2026-05-13T15-29-36-Week-review…` (5.29 PM screenshot) renders: "Daylens tracked activity from undefined to undefined."

Literal "undefined" appearing in user-facing output. Two of them.

**Why this matters.** Visible bug, ships in a file the user could share with their manager.

**Potential cause.** A template like `${range.start} to ${range.end}` where `start`/`end` weren't set. Most likely candidate: the deterministic fallback path constructs a range object from a query that returned no rows, then doesn't guard against the empty case.

**Potential fix.** Grep for the literal phrase "tracked activity from" and find the template. Add a default ("the past week", "since tracking started") when the range can't be computed, OR fix the query that should be returning a range.

**Where to look.** `src/main/lib/dayReportFallback.ts`, `src/main/lib/weeklyBrief.ts`, or wherever the "Week review" markdown gets generated.

---

## B7 — Weekly report fell back to the deterministic skeleton instead of producing the AI narrative

**Symptom.** Tonny asked "can you generate a report of my weekly summary so far this week" (5.28 PM). The chat showed "Thinking…" with no output (5.29 PM). The final artifact (5.29 PM) was the deterministic fallback that literally tells the user it's the fallback: "This report is deterministic, not AI-written. It uses the available local facts and avoids calling the day a fixed identity when the evidence is mixed."

Meanwhile, the same user, in the same session, got a perfectly coherent AI narrative for "What did I actually get done today?" (5.28 PM). The chat AI works; the weekly-report AI didn't.

**Why this matters.** Generative questions are Section 05 of the question taxonomy in `docs/PRODUCT-SPEC.md`. The bar is "drafts, status updates, recaps." Falling back to a skeleton that announces its own fallback is the worst-of-both: the user sees a non-answer *and* sees that the system gave up.

**Potential cause.** The weekly-report tool-call cap (or budget) may have been exceeded — previous agent's notes mention "Tool call cap reached" as a failure mode. Or the report generator timed out, or its prompt couldn't fit enough context. The "Thinking…" never-resolving suggests the model never finished, not that it produced bad output.

**Potential fix.** Trace the report-generation request end to end. Check whether it bailed on a tool-call cap, a token budget, or a timeout. Compare the cap and budget against what the chat day-summary uses (which worked). The cap for generative jobs probably needs to be higher than for chat answers.

**Where to look.** `src/main/services/aiOrchestration.ts`, `src/main/jobs/aiService.ts` (search for "weekly report" / `generateWeeklyReport` / report generation entrypoint), the tool-call cap config.

---

## B8 — Narrative claims paired apps that aren't visible in the rail

**Symptom.** Warp detail (5.28 PM): "Over 30 days, Warp accumulated 21h 21m across 712 sessions, primarily paired with Dia (28h 25m) and Codex (6h 25m)."

Codex is not in the left rail at all on that screenshot. The rail under Development shows Warp, Ghostty, Kiro, VS Code, Xcode — no Codex.

**Why this matters.** Either the narrative is fabricating Codex (D1/D4 violation — fabricated app name) or the rail is missing it (aggregation gap). Either way the user can't reconcile what they see with what they're told.

**Potential cause.**
- Codex CLI may track under a bundleId that the rail filter drops (low-signal threshold, or canonical-app collapsing folds it into another row).
- Or the narrative pulled "paired with Codex" from a wider time-range query than the rail uses.

**Potential fix.** Query the DB for any `app_sessions` rows with a Codex-shaped bundle_id or app_name in the last 30 days. If they exist, the rail is wrongly hiding them. If they don't, the narrative is fabricating.

**Where to look.** `src/main/db/queries.ts:getAppSummariesForRange` (the rail), the narrative-builder bundle that produces "primarily paired with X" prose, and the canonical app identity registry.

---

## B9 — "What you did there" lists raw session names, not activities

**Symptom.** Warp app detail (5.28 PM), section header "WHAT YOU DID THERE", lists entries like:
- `tonny — Apr 17, 2:19 PM – 2:25 PM`
- `Obsidian Vault — Apr 17, 11:09 AM – 11:10 AM`
- `tonny — Apr 17, 10:48 AM – 11:04 AM`

"tonny" is the user's shell session name (the macOS terminal prompt user). "Obsidian Vault" is a window title. Neither is an activity description.

**Why this matters.** D5 again — Apps detail should narrate what was done, not list window titles.

**Potential cause.** The list under "What you did there" is probably pulling `window_title` from the raw session join, rather than block labels or artifact titles. For a terminal app, `window_title` is whatever the shell sets — frequently the user's name, the cwd, or the active program.

**Potential fix.** When the source is a terminal app (Warp, Ghostty, Kiro terminal, iTerm, etc.), prefer block label over window title for the row title. Or scrub a denylist of useless terminal-titles (`tonny`, single-word strings that match the home username, etc.) before display.

**Where to look.** `src/main/services/workBlocks.ts:getAppDetailPayload` (the per-app session list assembly), and the renderer in `src/renderer/views/Apps.tsx` that displays "What you did there."

---

## B10 — Mechanical pipe-separator in block labels

**Symptom.** Sidebar "What mattered" label is `Course | Perusall` (5.26 PM Timeline). Multiple other blocks visible in the screenshots use the same `Word | Word` shape with literal pipe characters.

**Why this matters.** Cosmetic but corrosive. A pipe character in user-facing text reveals the join logic — a colleague would say "Perusall course reading," not "Course | Perusall." Per `docs/PRODUCT-SPEC.md` Design Principle 03 (Voice, not voiceover): "writes the way the user writes."

**Potential cause.** The label generator concatenates `[category, primary domain]` or similar with `' | '` as separator. This was probably fine when labels were debug-shaped; it's wrong now.

**Potential fix.** Change the join to natural-language ("category on domain", "category in app", etc.) or replace with a real composed label. May overlap with B1 — the same place may be producing both raw-title labels AND pipe-joined fallbacks.

**Where to look.** `src/main/services/workBlocks.ts` — search for the literal `' | '` separator in label-construction code paths.

---

## B11 — Off-by-one on block duration display

**Symptom.** A Timeline block shown as 8:55 AM → 9:09 AM displays a duration of "13m." Wall-clock that span is 14 minutes.

**Why this matters.** Minor on its own. Combined with B3 and B4 it's part of the broader "the numbers don't add up" trust problem.

**Potential cause.** Previous agent shipped a `blockActiveSeconds` helper that returns `min(session-sum, wall-clock-span)` clamped down. If the underlying session.durationSeconds sum is 13.x minutes (rounded down), the display loses the rounded-up wall-clock minute.

**Potential fix.** Decide which the user wants — wall-clock span ("8:55 to 9:09 = 14m") or active-time sum ("13m of active foreground"). Both are defensible; only one is right per the product. Pick one, document it, propagate it everywhere. The display should match the clock-time range it shows next to it — so if the row shows "8:55 – 9:09", the duration should be 14m, not 13m.

**Where to look.** `src/shared/blockDuration.ts` (the new helper), and every consumer that now uses it (multiple files in renderer and main per previous agent's changes).

---

## B12 — Apps narratives still feature minutes prominently in the headline

**Symptom.** Apps right-panel header (5.27 PM Dia, 5.28 PM Warp, 5.27 PM Kiro) reads `Dia · Browsing • 96h 38m in the last 30 days` and similar. The narrative paragraph below opens with the duration too.

**Why this matters.** D5: "minute totals are secondary metadata. The detail panel leads with a 2-3 sentence narrative." Leading the header with `96h 38m` violates that — the duration should be footer-shaped metadata, not subtitle-shaped headline.

**Potential cause.** The detail panel header template includes `formatDuration(totals)` in the subtitle. The narrative paragraph may have its own opening line that the previous agent didn't audit.

**Potential fix.** Demote the duration to a smaller secondary line. Lead with a 2-3 sentence narrative the previous agent left untouched. Audit every detail panel header and narrative opener for "Nh Nm" patterns near the top.

**Where to look.** `src/renderer/views/Apps.tsx` (right-panel header layout), the narrative templates in `src/main/jobs/aiService.ts:buildAppNarrativeBundle`.

---

## What is *not* broken (worth knowing)

So you don't waste time re-checking things that look OK in the screenshots:

- The Settings → Clients UI added in the previous session renders correctly (not visible in these screenshots — Tonny was testing AI/Apps/Timeline this round).
- The future-moment time-awareness branch in the router was in place from earlier work; the screenshots don't include a test of it.
- The day-summary chat answer (5.28 PM, "What did I actually get done today?") is a *good* response in voice and shape — it names activities, cites apps as evidence, and reads like a colleague. Use that response as a tone reference for fixing B7 and B6.

---

## How to triage

If you can only fix two things this session, the two with the highest blast radius are:

- **B1** — raw window titles as block labels. This is upstream of B2, B9, B10, and several Wrapped/AI failure modes. A clean fix here will improve a dozen other surfaces silently.
- **B4** — same metric, three different values. This is the credibility floor. Until it's fixed, no other AI improvement is going to land for the user because they'll keep spot-checking and finding inconsistencies.

Anything else is a follow-up to those two.

If you find that one of the "potential causes" above is wrong, or that the symptom traces somewhere unexpected, **write it up in this file** before you fix anything else. The next agent (and Tonny) will benefit from your corrected diagnosis more than from a quick fix.

---

# Status update — 2026-05-13 after the second screenshot review

Tonny took a fresh set of screenshots at ~19:58–19:59 PM after the previous agent claimed B1, B4, B6, B11 fixed and then claimed B2, B3, B5, B7, B8, B9, B10, B12 also fixed. The screenshots prove most of those claims were wrong. Status below is what is visibly broken in the running app, not what is hypothetically fixed in source.

**Working rule reset**: every fix must be verified against either (a) a rebuilt app run cold and a fresh screenshot, or (b) the behavioural harness with a scenario added that pins the failure. "Code edited" is not "shipped." Verify the diff lands on the user's screen.

## Confirmed broken in the visible build (2026-05-13 19:59)

### B1 — STILL BROKEN. Raw window titles surface as block labels.

Timeline view (screenshot 5–7) shows multiple blocks with raw browser tab titles as their primary label:
- `W2_Reading | Introduction to Machine Learning | Perusall` — as block subtitle and detail row
- `Vecta Global Distributors | Home of Great Brands` — as block subtitle, four+ times
- `Sign in - Claude` — as development block label
- `I Tried the Top 10 Tourist Attractions ...` — YouTube video title as browsing block label
- `Stop letting your agents write Markd...` — YouTube video title as block label

**Root cause the previous agent missed**: the fix only naturalizes labels at WRITE time inside `usefulDerivedLabel`. The existing `timeline_blocks.label_current` rows already contain the pipe-soup strings. Without a migration / relabel pass, every persisted block keeps its old label forever. The fix landed in source, not in data.

**Required**: a one-shot migration (or background relabel pass) that rewrites pipe-joined `label_current` values using `naturalizeLabel`, and bumps the heuristic version so the cleanup-relabel path re-fires for stale labels.

### B2 — STILL BROKEN. AI bare-refuses with the exact D4-banned phrase.

Screenshot 1: question `What was I doing around "W2_Reading | Introduction to Machine Learning | Perusall"`. Answer:
> "I can't find any sessions matching that window title — 'W2_Reading | Introduction to Machine Learning | Perusall' doesn't appear in your tracked activity. Perusall (the social annotation platform) doesn't show up in your session history at all."

Both `I can't find` and `doesn't appear in your tracked activity` are explicitly banned by D4 (Never refuse with "I don't know"). Screenshot 2 produces another identical refusal for Todoist.

The retry in screenshot 3 (`i said today`) eventually surfaced Perusall hits — proving the data is in the DB. So the first turn either did not call `searchSessions`, or called it without broadening, or got the broadened result and refused anyway.

**Required**: trace one turn end-to-end with `DAYLENS_AI_TRACE_DIR` set. Confirm which tool ran and what `matchKind` came back. If `searchSessions` was not called, the router is the bug. If it was called and returned `broadened` results that the model still refused on, the system prompt update did not reach the run.

### B4 — STILL BROKEN. Apps panel header vs narrative numbers diverge inside the same panel.

Screenshot 8 (Safari, Today):
- Header: `2h 19m · 64 sessions`
- Narrative one line below: `2 hours 18 minutes... 59 sessions`

Screenshot 9 (Safari, 7d):
- Header: `13h 5m · 221 sessions`
- Narrative: `13 hours 2 minutes across 205 sessions`

The previous agent claimed B4 was fixed by routing `getAppDetailPayload` totals through `getAppSummariesForRange`. The screenshots prove the narrative builder is reading a different source than the header. The header and the narrative both render inside the same React component — they MUST agree.

**Required**: pin the narrative input to the exact numbers the header reads. The narrative scaffold has `totalTracked: formatDuration(detail.totalSeconds)` and `sessionCount: detail.sessionCount` — verify those match `selectedSummary.totalSeconds` / `selectedSummary.sessionCount` in `Apps.tsx`. If they don't, fix the source-of-truth split.

### B5 — STILL BROKEN. Apps rail rows still show name + minutes shape.

Every row in screenshots 8/9 reads `AppName · duration · N sessions`. The D5 "what was accomplished, not how long" row shape is nowhere visible.

**Why my B5 fix didn't help**: even with a more robust digest handler, the handler reads `block.label.current` via `userVisibleBlockLabel`, which correctly REJECTS pipe-soup labels (the B1 contract). With every persisted block still pipe-soup-labelled (see B1), the digest's `topBlockLabel` is empty for every app, so `activityHeadline = digest?.topBlockLabel || digest?.topArtifactTitle` is null, so the renderer falls back to the old shape.

**Required**: B5 cannot ship until B1 (the data migration) ships. After the relabel pass, retest B5.

### B11 — STILL BROKEN. 8:55 → 9:09 block displays "13m" instead of 14m.

Screenshot 5 shows the 8:55 AM → 9:09 AM block with "13m" subtitle. Previous agent claimed `blockDisplayedSpanSeconds` helper used wherever duration sits next to a clock range. That helper is either not applied to this row, or applied but reading `blockActiveSeconds` instead of wall-clock span.

**Required**: find the renderer reading the duration for the timeline block row in `Timeline.tsx`, confirm it uses `blockDisplayedSpanSeconds(block)`, not `blockActiveSeconds(block)`.

### Apps narrative self-contradiction (new)

Screenshot 8 Safari narrative:
> "You used Safari across 59 sessions totaling 2 hours 18 minutes, with heaviest activity in the evening between 6 PM and 7 PM (44 minutes) and sustained use from 1 PM through 7 PM. The fragmented session pattern suggests frequent context switching between browser tabs or windows rather than continuous focused work. **No specific artifacts, paired applications, or work blocks were captured**, so the browsing context remains unclear."

The "no specific artifacts... or work blocks were captured" sentence contradicts the rest of the app: the timeline shows Safari involved in many blocks today, and the rail clearly has Safari among the top apps with structured pairing visible. The narrative scaffold is either feeding an empty `pairedApps` and `blockAppearances` for today's range (despite the data existing), or the model wrote a generic disclaimer regardless of evidence.

**Required**: log the assistantScaffold sent to the narrative builder for a today-range request. If `pairedApps`/`blockAppearances` are populated and the model still wrote the disclaimer, tighten the prompt. If they're empty, fix the data path.

## Held over (not visible in this round, but unverified)

- **B7** — code fix landed but no weekly-report regeneration was visible in this round.
- **B8** — narrative names "Dia / Kiro / Ghostty" as paired Safari apps; those are real, so no obvious fabrication. Still unverified across other apps.
- **B9** — no Warp/terminal app detail panel in this round.

## Visibly fixed in this round

- **B12** — Apps detail panel subtitle reads `Browsing · today` / `Browsing · last 7 days` with no duration; totals appear as a small footer line below the narrative. ✓

## The structural lesson

Two failure modes recurred this session:
1. **Code-level fixes shipped without rebuilding the app or running the harness.** Verified clean typecheck and unit tests; never opened the running app to confirm the diff hit the screen.
2. **Source-of-truth fixes shipped without a data migration**, leaving persisted state in the pre-fix shape. This is what killed B1, B5, and B10.

The fix going forward: any change that touches a label-writing path must include a backfill plan for existing rows. Any change that touches an AI surface must include a behavioural-harness scenario that would have caught the regression.
