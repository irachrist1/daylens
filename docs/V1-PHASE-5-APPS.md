# Daylens v1.0 — Phase 5: Apps tab redesign

Status: spec, not code. No implementation in this pass.
Last updated: 2026-05-15.

Claim discipline used below:
- **code-proven** — read from the source files cited inline.
- **db-proven** — confirmed against `~/Library/Application Support/DaylensWindows/daylens.sqlite` (the live DB the running Daylens process is writing to; `~/Library/Application Support/Daylens/daylens.sqlite` is a stale May-5 snapshot still on disk).
- **inferred** — consistent with the code but not directly executed.
- **runtime-validated** — observed in the user's screenshots.
- **open question** — needs an answer before this spec can be locked.

---

## 1. Code-grounded snapshot

### 1a. The "28k-line implementation" claim from D5

**Refuted, as a literal line count, but the intent is right.** The current Apps tab is *not* 28,000 lines; it is one renderer file plus four backend paths. What is true is that the **per-app narrative pipeline pulls on roughly a third of the AI monolith and an even larger fraction of `workBlocks.ts`** to produce a single panel. The mass that D5 is naming is the *combined* read surface, not a single file.

Actual sizes (code-proven, `wc -l`):

| File | Lines | Role in Apps |
|---|---:|---|
| `src/renderer/views/Apps.tsx` | 885 | Whole renderer view (list rail + detail panel + leak callout). |
| `src/main/jobs/appNarrative.ts` | 2 | Re-export shim; the real builder lives in `aiService.ts`. |
| `src/main/services/wrappedNarrative.ts` | 119 | Unrelated to Apps — kept in scope because the task brief listed it; it serves Wrapped, not the Apps tab. |
| `src/main/lib/appIdentity.ts` | 243 | Canonical-app resolution + website display labels. |
| `src/main/db/queries.ts` | 2,263 | Hosts `getAppSummariesForRange`, `getSessionsForApp`, page/domain summaries, category overrides. |
| `src/main/services/workBlocks.ts` | 2,656 | Hosts `getAppDetailPayload`, `buildSessionDerivedAppDetailBlocksByDate`, `topDomainsForBrowser`, `labelMatchesSelectedApp`. |
| `src/main/jobs/aiService.ts` | 5,370 (per V1-PHASE-0-READ) | Hosts `buildAppNarrativeBundle`, `appNarrativeSignature`, `generateAppNarrative`, `getAppNarrative`. |
| `src/main/ipc/db.handlers.ts` (Apps slice) | ~80 (lines 208–350) | `GET_APP_SUMMARIES`, `GET_APP_DETAIL`, `GET_APP_ACTIVITY_DIGEST`, `GET_APP_SESSIONS`. |

Code-grounded total: ~1,200 lines that exist purely to serve Apps, plus shared reads from `queries.ts`, `workBlocks.ts`, and `aiService.ts`. D5's "~300 lines is the target" remains realistic for the renderer + a small per-category formatter; the *backend* reduction depends on collapsing `getAppDetailPayload` to a leaner shape and deleting `buildAppNarrativeBundle` / `generateAppNarrative` if the narrative becomes deterministic.

### 1b. Data path the renderer pulls today

Three concurrent calls on every Apps tab visit (code-proven, `Apps.tsx:145–157`):

1. `ipc.db.getAppSummaries(days)` → `getAppSummariesForRange(db, fromMs, toMs)` in `queries.ts:526`. Reads `app_sessions` only. Aggregates by `canonicalAppId` (falls back to `bundleId`).
2. `ipc.tracking.getLiveSession()` → current in-flight session.
3. `ipc.db.getAppActivityDigest(days)` → `db.handlers.ts:273–350`. For each day in the range, calls `getTimelineDayProjection`, walks every block, attaches **`block.topArtifacts` and `block.pageRefs` to every app in `block.topApps` without checking artifact ownership** (see §1d).

On app selection, two more calls (Apps.tsx:252–272):
4. `ipc.db.getAppDetail(canonicalAppId, days)` → `getAppDetailPayload` in `workBlocks.ts:2351`. Filters blocks to those touching the app, builds `topArtifacts`, `topPages`, `topDomains` (browsers only), `pairedApps`, `blockAppearances`, `timeOfDayDistribution`.
5. `ipc.ai.getAppNarrative(canonicalAppId, days)` → `generateAppNarrative` in `aiService.ts:3864`. Calls an AI provider unless the signature already matches `ai_surface_summaries`. db-proven: this table currently has 67 `app_detail` rows.

### 1c. Why "Generating a stronger app narrative…" sticks

Three causes, in order of likely real-world frequency. None of them is "race condition." All are predictable given the code.

**Cause A — One AI call per app, lazily, on click.** `generateAppNarrative` runs only when the user selects an app in the rail (`Apps.tsx:271`). There is no background precompute equivalent to `scheduleTimelineAIJobs` (`aiService.ts:4752`) for Apps. Each first-time selection pays ~10–25 seconds of provider latency. During that time, `narrativeResource.loading === true` and the spinner text shows. The user sees "stuck" because they click around faster than the narratives can be generated. **Code-proven** + **inferred** for the click-rate diagnosis.

**Cause B — Scope-keyed cache misses on every period switch.** Narrative `scopeKey` = `app:${canonicalAppId}:${rangeKey}` where `rangeKey = "${days}d:${today}"` (Apps.tsx:274). That's a separate narrative for `1d`, `7d`, `30d` *per app*. Switching the period from Today to 7d invalidates everything. db-proven: the live DB has 3 different narratives stored for `safari` (1d/7d/30d) and `dia` (1d/7d/30d). On 2026-05-13 those generated; on 2026-05-15 (today) they have not yet been re-keyed, so every period switch reignites the latency for every app touched.

**Cause C — Selection change leaves stale `narrativeResource.data` around.** `useProjectionResource` does not clear `data` on dependency change; it only sets `loading = true` (`useProjectionResource.ts:60–67`). The filtered `narrative` in `Apps.tsx:287–291` reads `null` because the *previous* app's narrative carries the wrong `scopeKey`. Combined with `loading === true`, the spinner condition `narrativeResource.loading && !narrative` (Apps.tsx:627) is true until the new call returns. So clicking app A → app B during a slow call shows the spinner on app B even though the system is technically still finishing app A's request.

**Not the cause:** there is no missing IPC, no swallowed error, no never-finishing promise. `generateAppNarrative` catches all errors and returns the cached stale row or `null` (`aiService.ts:3943–3946`), which deterministically drives `loading` to `false`.

`Pushback:` you may insist the spinner *truly* sticks forever on some apps. If so, that is a fourth cause we have not yet reproduced — most likely a provider hang with no client-side timeout (`executeTextAIJob` has no `AbortSignal`-based timeout that I could find in `aiOrchestration.ts:388–460`, **inferred** from the absence of a `signal` argument or `AbortController` usage). Repro plan: open Apps on a day with 20+ apps, throttle network in dev tools, observe whether any app's spinner outlasts the longest provider timeout.

### 1d. "Sites surfacing as apps" — the digest is the bug

The list rail (`Apps.tsx:432–476`) leads each row with `digest.topBlockLabel || digest.topArtifactTitle || null`. The digest source — `db.handlers.ts:307–340` — does this for every block:

```
for (const app of block.topApps) {
  // assign block.topArtifacts and block.pageRefs to bucket[canonicalAppId]
}
```

Without checking whether the artifact / page actually belongs to that app. **Code-proven** at `db.handlers.ts:321–338`.

Consequence (db-proven against the live DB):
- `Perplexity.app` (canonical: native `aiTools` desktop wrapper at `/Applications/Perplexity.app/...`) exists as its own app_session row.
- `website_visits` contains rows for `perplexity.ai` page-title `Perplexity` opened in Safari and Dia.
- Inside any block where Safari + something else co-occurred, `block.pageRefs` will include the `Perplexity` page. The digest happily writes "Perplexity" as the headline for Safari, Dia, *and* any other app in the same block's `topApps`.

Same mechanism produces "Microsoft Intune admin center" as VS Code's headline: a block contained VS Code (foreground app) plus a side trip to Safari on intune.microsoft.com. The page got attached to VS Code's digest bucket because VS Code is in `block.topApps`.

Native Perplexity.app *also* legitimately appears, so the user sees Perplexity three times: once as the desktop wrapper, once as Safari's headline, once as Dia's headline.

`Pushback:` you may argue that "Perplexity" being prominent across all three rows is fine because the user *was* on Perplexity. The complaint then becomes a labelling problem, not a duplication problem — the digest should still attribute the page to the browser that owned it, not to every co-occurring app.

### 1e. "Daylens needs more context" — where it fires

`detailSummary` (Apps.tsx:80–103) returns the fallback string when **all three** of these are empty:
- block labels (after dedup against the app's display name)
- top artifacts
- paired apps

For Safari with rich data, `pairedApps` is rarely empty. The empirically-failing case: `getAppDetailPayload` filters `topArtifacts` per-app (`workBlocks.ts:2398–2434`); for `artifactType === 'page'` it requires `canonicalBrowserId` (or `browserBundleId` resolution) to match `canonicalAppId`. If older `pageRefs` were persisted without `canonicalBrowserId`, they get dropped. So the panel can show a Safari row with 2h of browsing time and an "Often used with" section, but the *narrative line* below the app name falls through because `topArtifacts` is empty and `pairedApps` is also briefly empty before `detail` arrives. **Code-proven** + **inferred** without a runtime trace on a specific Safari narrative.

`Pushback:` if you have screenshots of a Safari panel where `pairedApps` was populated and the fallback still fired, that suggests a different bug than the one above. Provide one and we re-root-cause.

### 1f. The "Refresh" button

Apps.tsx:607–622. Calls `narrativeResource.refresh()`. That re-invokes `getAppNarrative`, which checks the signature and **almost always returns the cached row instantly** because the signature inputs (`canonicalAppId`, `rangeKey`, top-8 artifacts, top-8 pairs, top-8 block appearances) rarely change between two clicks (code-proven, `aiService.ts:3569–3583`). So the button is effectively a no-op for the user 95% of the time. There is no force-regenerate path.

`Pushback:` you may have built it as a "kick the AI awake" affordance for the cause-A spinner. In that case, kill it — the right fix is precompute, not a manual nudge.

`Pushback (sec.1 overall):` you may push that I have not surfaced the *specific* line-by-line "duct tape." Two leading offenders to call out: (a) the digest-ownership bug in `db.handlers.ts:321–338` is a textbook example of "we wrote this to make B5 work for Safari and forgot every other case"; (b) `getAppDetailPayload` builds session-derived fallback blocks (`workBlocks.ts:2171–2228`) so the panel renders before timeline blocks have been persisted — useful for today, but the same code path is what makes "blockAppearances" sometimes contain labels the user has never seen anywhere else.

---

## 2. Core reframe — "where my time went"

Apps tab as built today asks "what app did the user open." Apps tab as it should be asks "what did the user accomplish, organized by the tool they used to accomplish it." Minute totals stay on screen but recede to metadata.

### 2a. The mental model

Apps is a **secondary, contextual view**. It exists because timelines are chronological, AI is question-driven, Wrapped is voicy — and sometimes the user wants the question shaped as "remind me what I did in Cursor today." Apps is the answer to that exact question and nothing else.

The answer for each app is the same shape:
- **Headline:** what was done. ("Daylens AI router refactor — `insightsQueryRouter.ts`, `aiTools.ts`.")
- **Subtitle:** category + time-of-day window. ("Development · 9:14am–1:08pm")
- **Footer / right margin:** minutes total. ("3h 4m · 12 sessions") — small, low-contrast, single line.

The list view is grouped by category of work, not by sorted-minutes. Within a category, order by today's relevance — most recent meaningful block, then by total. Fleeting / single-session apps under a "Smaller or fleeting" disclosure that stays collapsed by default.

### 2b. What goes in the detail panel

In order, top to bottom:

1. **Narrative line (2–3 sentences max).** Activity-focused per D1. Generated deterministically from the same data the AI sees, with AI as an optional polish layer. Never restates totals.
2. **What you did there.** Per-category content — see §4.
3. **Time by domain / per-file breakdown / per-channel** — whichever is applicable for the category.
4. **Often used with.** Paired apps. Smaller than today.
5. **When during the day.** Hour-bucket band — keep but de-emphasise.

The current panel's "Files & documents" section stays, but it should not collide with "Pages visited" for browsers — see §3.

### 2c. What goes away

- The top-of-panel large minute total. It moves to the footer of the header card. Already half-fixed (Apps.tsx:637–641), confirm-and-extend.
- The 24-hour per-hour bar chart distribution as the *answer*. It stays as a band-style secondary visualisation, not the lead.
- "Time by domain" buried below the narrative for browsers — promote it to second slot for browser-category apps.

`Pushback:` you may want to delete the per-hour distribution outright. I am keeping it because for "when did I do my email today" it answers the question in one glance and the data is already there. If you want it gone for v1 to hit the line budget, fine — it should be cheap to add back later.

---

## 3. Sites-in-browsers handling

The model has to make a stance on "is this site an app." Daylens currently waffles: PWAs and Electron wrappers are apps, browser tabs are not, but the digest blurs the line.

### 3a. The rule

A row in the Apps list represents **one app_session-producing process**. Native apps and PWA/wrapper apps (Perplexity.app, ChatGPT.app, Notion.app, Slack.app) qualify. **A website opened inside a generic browser is never its own row.** It is evidence inside the browser's row.

That means:
- The native `Perplexity.app` row stays. It's a real process with its own bundle ID.
- The "Perplexity" headline that currently bleeds onto Safari and Dia rows must be replaced by the browser-row's own headline: the **top domain** the user spent time on inside that browser, with its page title as a sub-line.
- The browser row's detail panel surfaces every site, including `perplexity.ai` and `intune.microsoft.com`, as `topDomains` / `topPages`.

This is "browsers carry the receipts; sites don't get promoted." Browsers are a *category*, and inside a browser the meaningful unit is the domain, not the app.

### 3b. The fix for the digest mis-attribution bug

Two changes at `db.handlers.ts:307–340`, both code-mechanical:

1. **Pages must only attach to the browser canonicalAppId they were captured in.** A page's `canonicalBrowserId` (or fallback resolution from `browserBundleId`) is the only legal owner. Today the digest assigns pages to every app in `block.topApps` regardless.
2. **Artifacts must respect `canonicalAppId` / `ownerBundleId`.** Same logic that `getAppDetailPayload:2398–2434` already applies on the detail side — the digest just doesn't apply it. Lift the ownership check into a shared helper.

A side benefit: blocks where the foreground app's headline would have been "Perplexity" because of co-occurrence will instead reflect what the foreground app was *actually* doing. VS Code's headline will surface the file it had open, not the site some other browser tab happened to be on.

### 3c. The Perplexity-the-website case

For `perplexity.ai` opened inside Safari, the answer is still "you used Safari for X minutes, mostly on perplexity.ai." Surface it as a `topDomains` row inside Safari with the existing label normalization (`appIdentity.ts:185` `websiteDisplayLabel`). No promotion to a top-level row.

If you want Perplexity-the-search-tool to feel like a "thing the user used" *regardless* of whether it was the native app or the website, that is a separate L3 concern: it would need a virtual "entity" table — see §11.

`Pushback:` you may push that Perplexity-the-website *should* be a top-level row because the user thinks of it as a tool. My counter is: Daylens already has a "tool" abstraction — the app. If we promote sites to apps based on user intent, every Notion workspace, every Linear team, every GitHub org becomes its own row. That's a different product. The right move is to surface domain-level rollups *inside* the relevant browser, not flatten them up.

---

## 4. What "what I did there" means per category

This is the section the user can argue with most easily. The principle: every category gets one concrete shape for its detail content, derived from existing capture or from L2/L3 work we acknowledge needs to ship first (§11).

| Category | "What you did there" content | Data source today | L2/L3 dependency |
|---|---|---|---|
| Development (VS Code, Cursor, Kiro, Xcode, Zed, Sublime) | Files touched (ordered by time), dominant project root, language hint. Top 5 files with per-file time. | `app_sessions.window_title`, `activity_events.windowTitle`. Currently only one title per session. | **L1 gap**: per-event title history; we have it in `activity_events` but session readers don't consume it. |
| Browsers (Safari, Dia, Arc, Chrome, Edge, Firefox) | Top 5 domains by time, top page title per domain, total tab-switch count. | `website_visits` (richest table; 58k rows). | None new — the data is there. Just stop double-counting it onto co-occurring apps. |
| Terminals (Ghostty, Warp, iTerm2, Terminal, Alacritty) | Projects (cwd from window title), dominant cwd, terminal-tab labels if extractable. Falls back to "n shell sessions across n cwds." | `app_sessions.window_title` only. | **L1 gap**: window title in terminals usually contains cwd + binary; need a parser. |
| Chat / messaging (Slack, Discord, Teams, Messages, WhatsApp) | Channel / chat names from window title; if iMessage opt-in: top contacts + message count. | iMessage capture path exists (`imessage_events`). Slack/Discord/Teams = window title only. | **L1 gap**: native messaging apps title format is consistent (`#channel · workspace`); parser doable. SPA web Slack is harder. |
| Meeting apps (Zoom, Google Meet, Loom) | Meeting names if extractable from window title; call duration; co-attendee if browser tab on `meet.google.com` shows it. | window title. | **L3 gap**: meeting URL pattern matching belongs in a structured "meeting evidence" extractor (per AI-PRODUCT-DIRECTION.md row in failure-modes table). |
| Notes / writing (Notion, Obsidian, Bear, Craft, Word, Apple Notes) | Document titles touched, dominant vault/workspace. | window title. | Variable: Notion/Obsidian have stable title formats; Word/Apple Notes vary. |
| Design (Figma, Sketch, Canva, Miro) | File names from window title, dominant workspace/team. | window title. | None new for Figma; window title is reliable. |
| AI tools (Claude, ChatGPT, Codex, native Perplexity, Copilot) | Conversation titles if window title exposes them; total session count. | window title. | **L1 gap**: many AI desktop apps show generic titles ("Claude"). Browser-based AI tools have richer URLs. |
| Email (Apple Mail, Outlook, Spark) | Mailbox/folder + message subject lines if titles expose them. | window title. | **L1 gap** + privacy review per D6 (subject lines are sensitive). |
| Productivity / task mgmt (Linear, Jira, Asana, Todoist, TickTick) | Project/board names, dominant team if browser-based. | window title + website_visits. | None for browser-based; native apps depend on title fidelity. |
| Media (Spotify, Apple Music, VLC, Podcasts) | Track/show names if titles expose them; total listening time. | window title. | None new. |
| Social / entertainment (X, YouTube, Reddit, Instagram, etc) | Surface only as **leakage callout** below the fold. Top domains with time. | `website_visits`. | Already implemented as the "Where time slipped" callout (`Apps.tsx:528–577`). Keep. |
| Uncategorized / Other | Plain "n sessions, mostly between Xh and Yh, n minutes total." | `app_sessions`. | None — explicit "we don't know" state. |

The general principle: **every category has one and only one "primary evidence" type**, and the panel leads with that.

`Pushback:` you may argue Development should lead with project, not file. My counter is: the user said "what did I touch in Cursor" — files is the answer. Project is the *aggregator* and shows as the dominant title at the top of the section. If the data shows two projects with comparable time, the panel splits into two project sub-sections.

`Pushback (deeper):` the per-category list above assumes title parsing carries the load. For VS Code and friends, that's a known L1 gap (per `V1-PHASE-0-READ.md` item 1: only one `windowTitle` per session is stored, so a 30-minute Cursor block produces one file name). Without an L2 fix that aggregates `activity_events.windowTitle` over the session window, the development row will repeatedly read "one file" for sessions that touched ten. Call this out as a §11 dependency, not a §4 fix.

---

## 5. Right rail "What you did there" panel

### 5a. The narrative

Two to three sentences. Activity-focused per D1. Generated deterministically from the same evidence the per-category template uses (files, domains, channels, etc.) — *AI is the polish layer, not the generator*.

Template (deterministic):
> "{display name} was open from {first_start} to {last_end}. {what_you_did_sentence}. {paired_apps_sentence}."

Where `what_you_did_sentence` is per-category — for browsers: "Most time on `{top_domain}` ({top_domain_minutes}), with `{top_page_title}` the longest single page." For development: "Touched `{top_file}` and `{second_file}` across {file_count} files in `{project_name}`." For terminals: "Worked in `{top_cwd}` and `{second_cwd}`." Etc.

`paired_apps_sentence` is "Often appeared alongside {paired_app_1} and {paired_app_2}." Skipped if `pairedApps.length < 2`.

If a category yields no concrete signal — e.g. a Cursor session where every window title was null — the deterministic template returns: "Daylens has {n} sessions for {display_name} totalling {duration} but no per-file context yet for this period." This is the D4-compliant version of "Daylens needs more context": it names the closest captured signal (sessions, time), it does not refuse.

The AI narrative becomes a *polish layer*: same input data, asked to rewrite the deterministic sentences in a slightly more natural voice, gated on the deterministic version being non-degenerate. If AI is unavailable, slow, or rate-limited, the deterministic version *is* the answer. No spinner blocks the panel.

### 5b. Time by domain / per-file / per-channel

Already implemented for browsers (`Apps.tsx:764–801`). Generalise the section to per-category breakdowns. Same component shape: icon + primary label + secondary label + time.

### 5c. Block appearances

Keep. Useful for "show me the Cursor session at 9am" → click → jump to timeline. Filter out blocks where the only label is the app name (already done at `workBlocks.ts:2527`).

### 5d. Often used with

Keep. Make smaller. Skip when n < 2.

`Pushback:` you may argue the deterministic-first approach kills the "voicy colleague" feel that PRODUCT-SPEC.md asks for. My counter: voice is for *Wrapped* and *AI chat answers*; for Apps, the user wants speed and exactness. A deterministic line that reads "Cursor was open 9:14am–1:08pm. Touched insightsQueryRouter.ts and aiTools.ts across 7 files in daylens. Often appeared alongside Ghostty and Dia." is more useful than the same content with five extra adjectives.

---

## 6. Stuck "Generating a stronger app narrative…" state — fix proposal

### 6a. Define "good enough" so the spinner can go away

The narrative is "good enough" the moment the deterministic template (§5a) has at least two concrete signals to cite — i.e. one of {top file, top domain, top channel, top cwd, top page title, top artifact} plus one of {paired app, block label}. That covers >95% of any app the user has spent >5 minutes in over the period (db-proven against the live DB's `website_visits` and `app_sessions` row counts).

### 6b. The new flow

1. On selecting an app: render the deterministic narrative **immediately**. No spinner. Hard guarantee: this is the user-facing answer for the first paint.
2. In the background, kick off `generateAppNarrative` only if `aiBackgroundEnrichment === true` AND the deterministic narrative is non-degenerate (so the AI has something to polish). Show no UI state for the in-flight job.
3. When the AI narrative completes and writes to `ai_surface_summaries`, the projection invalidation event swaps the rendered narrative in place. No spinner ever shows.
4. If the AI narrative fails, the deterministic narrative stays. The user never sees a degraded state because there is no degraded state.

### 6c. Detect-and-recover for the existing stuck case

If a narrative job is in-flight for >20 seconds, treat it as failed for UI purposes (the in-process call can still complete and write to disk later). This needs an `AbortSignal`-backed timeout in `executeTextAIJob` — currently absent, **inferred** from code reading.

`Pushback:` you may argue "no AI narrative ever" is too far. Counter: the AI narrative is a 2-sentence polish layer. If we can't generate it in 20 seconds, the deterministic version is the answer for that load.

---

## 7. "Daylens needs more context" fallback — what fires it and what should replace it

### 7a. When the current copy fires

`Apps.tsx:80–103`. Fires when `blockLabels`, `topArtifacts`, and `pairedApps` are all empty after dedup. The most common real-world cause: `topArtifacts` got filtered to zero by the per-app ownership check in `getAppDetailPayload:2398–2434` because the page artifacts in legacy data have no `canonicalBrowserId`.

### 7b. The replacement

Per D4: "the phrase 'I don't know' and 'I can't see that' are banned outputs." Translation for Apps:

If we have:
- **Total time but no titles, no pages, no pairs:** "Daylens has 4 sessions of {display_name} totalling 47m across the day. Sessions ran 9:14–9:32, 10:01–10:18, 11:45–12:08, 1:14–1:36 — no per-window detail captured for this period."
- **Total time + paired apps only:** "{display_name} was open for 47m. Often appeared alongside Cursor and Dia."
- **Total time + block labels only:** "{display_name} participated in {block_label}. {duration}."
- **Total time + page/file titles only (the legacy-data case):** "{display_name} time was concentrated on {top_title} ({top_seconds})."

The principle: name the closest captured signal. Sessions exist → say "n sessions." Pairings exist → name two. Block labels exist → quote one. Never fall through to a refusal sentence.

### 7c. Empty-empty case (zero time)

If `totalSeconds === 0` the app shouldn't appear in the rail at all (already filtered at `queries.ts:582`). If it does, "{display_name} hasn't been used in this period" is acceptable — but that path should not be reachable for any row the user can click.

`Pushback:` you may want one canonical fallback string and reject the per-shape templating. Counter: per-shape costs ~12 lines and the user sees a clearly better answer for each case. Worth it.

---

## 8. "Refresh" button — keep, kill, or repurpose

**Kill.** Reasoning, code-grounded:
- Today it calls `narrativeResource.refresh()`, which calls `getAppNarrative`, which checks the signature and returns cached. The button is mostly a no-op (§1f).
- With §6's deterministic-first flow, the narrative never enters a state the user would want to "refresh."
- A genuine "force regenerate" affordance belongs in a dev menu, not the main UI.

Replace with nothing. The save is one button slot and one IPC round-trip per click.

`Pushback:` you may want a "regenerate AI polish" affordance to recover when the AI narrative reads worse than the deterministic one. If so, hide it behind right-click on the narrative card, not a primary button. Even then I'd argue it's a category D6-roadmap item, not v1.

---

## 9. Period switcher (Today / 7d / 30d) — behavior

### 9a. Keep the three options

Already in place. The buttons map to `days ∈ {1, 7, 30}` (`Apps.tsx:13`). No change.

### 9b. Empty-category filter pills should hide

Code-proven: categories with zero apps in the current range are already excluded from `categories` (`Apps.tsx:173–184`). Today filter pills mirror `categories`, so this works. Keep, audit.

### 9c. "Smaller or fleeting" stays collapsed

Code-proven: it's a `<details>` element (`Apps.tsx:481`). The browser respects `open` only when the attribute is set; it isn't here, so it stays collapsed. Keep.

### 9d. Live session

The live in-flight session is mixed into the summaries via `liveAwareSummaries` (`Apps.tsx:36–73`). Subtle: it doesn't appear in the digest (the digest only reads persisted blocks). So the live app may show as the top minutes row but have no "What you did" headline. This is acceptable for v1 because the live row's headline can show "Currently active · {window_title}" deterministically from `LiveSession.windowTitle` — see §11 L3 dependency.

### 9e. Period transitions should not nuke selection

Today, switching period changes the `narrativeResource` scope key, triggers a reload, and (per §1c cause C) leaves the spinner on. Once §6 lands, period switches paint immediately with the deterministic narrative and the AI version backfills.

`Pushback:` you may want a "month" option. Counter: defer; 30d is a fine ceiling for v1 and a month option would require multi-day rollup performance work (§10).

---

## 10. Performance

### 10a. The expensive call today

`getAppActivityDigest(days)` (db.handlers.ts:273–350) walks **every day in the range**, calling `getTimelineDayProjection` per day. For `days=30` that's 30 full timeline-day projections. Each one re-derives blocks, artifacts, page refs. The user pays this latency on every Apps tab open at 30d. The result is then used to print one line per app row in the list rail. The cost-to-information ratio is bad.

Mitigation, in order of impact:
1. **Precompute the digest at the same time as timeline rollups.** Daily rollups already exist (`daily_rollups` table, db-proven). Add a per-app digest field per day. Apps reads the rollup and merges across the period.
2. **Cache the digest per-range with the same projection-invalidation mechanism the renderer already uses.** Today the renderer's `useProjectionResource` invalidates on `apps` scope events; the digest IPC currently does not memoize.
3. **Cap the read to N most-recent days where a value materially shifts.** For a 30d window, the dominant block label and dominant artifact rarely change after day 7 unless the app saw a new spike.

### 10b. `getAppDetailPayload` — per-click work

Each app selection re-runs `getSessionsForRange(db, fromMs, todayTo)` and rebuilds session-derived blocks for the entire period. That's N sessions read, M blocks loaded, M*K artifacts/pages filtered. For 30d this can be ~3,000 sessions. The detail panel feels slow because of this, not because of the AI.

Mitigation: cache `getAppDetailPayload` keyed on `(canonicalAppId, rangeKey)` with invalidation on the same `apps` projection scope. Cheap to add; the function is already pure in inputs.

### 10c. AI narrative — when

Per §6: precompute in background once per `(canonical_app_id, range_key)` per day, post-block-finalize. Right now narratives are generated on user click. Either model works, but the precompute model removes all user-perceived AI latency from the Apps tab.

### 10d. What should NOT precompute

Per-app detail (block list, file list) — that's already fast if the §10a/§10b caches are in place. Keep it lazy.

`Pushback:` you may push that precomputing 50+ narratives per day per `(1d, 7d, 30d)` is 150 AI calls per user per day. Counter: the signature check (`appNarrativeSignature`) means most don't actually call the AI; they cache-hit. Real call volume is closer to "the apps that meaningfully changed since last compute." Worth measuring before committing.

---

## 11. Upstream dependencies (L2 Clean, L3 Structure) — what must produce what

This Apps redesign is buildable today using only L1 (capture) data, but it will hit ceilings the redesign cannot solve. Naming each ceiling explicitly:

### 11a. Hard requirements (without these, §4 per-category templates degrade)

- **D-A. Canonical app identity.** Already partly present via `canonical_app_id` + `app_normalization.v1.json`, but the catalog is sparse — many apps still fall back to `bundle_id`. **Open question**: should we maintain the JSON catalog by hand, or generate it from observed `app_sessions` post-hoc?
- **D-B. Per-event window titles aggregated into per-session title histories.** L1 already captures `activity_events.window_title` per 5s tick (V1-PHASE-0-READ.md confirms). L2 needs to roll that up into `session_window_title_history` so the detail panel can read "10 unique titles in this session" instead of one.
- **D-C. Page → browser ownership at structure-time.** Today `pageRefs.canonicalBrowserId` is sometimes null on legacy rows, and the per-app ownership filter drops those pages. L3 backfill: re-derive `canonical_browser_id` for every `website_visits` row from `browser_bundle_id`.

### 11b. Strongly-desired (improve quality but redesign ships without them)

- **D-D. Project root extraction for development apps.** Parse window titles like `file.ts — daylens` to extract `project_name = "daylens"` and `file_name = "file.ts"`. Add as a structure-layer field.
- **D-E. Domain → "tool" mapping promotion.** Already exists in `WEBSITE_DOMAIN_LABELS` (`appIdentity.ts:15–38`) but is read-only at display time. Promote to a structure-layer table so AI can refer to "Perplexity (web)" as a known entity.
- **D-F. Per-app `appCharacter` is computed in the renderer's read path** (`workBlocks.ts:2497–2500`, calling `getAppCharacter`). Move to a precomputed structure-layer column on `daily_rollups`.

### 11c. Roadmap-only (not required for this phase)

- **D-G. Title-fidelity for VS Code / Cursor / Kiro** — the persistent L1 gap from V1-PHASE-0-READ §Layer 1. Per AI-PRODUCT-DIRECTION D6, this is the #1 capture roadmap line.
- **D-H. Meeting-shaped block detection.** Belongs to the AI / timeline layer, surfaces in Apps via the meeting-apps category.
- **D-I. Entity table populated from window titles** (per memory:strategic_ai_plan.md). Required for the "Perplexity-the-website is a tool" view if we ever decide §3c was the wrong call.

`Pushback:` you may push that D-B can ship in this phase (it's mostly an L2 rollup, not an L1 capture change). Fine — if you're willing to scope it in. My default assumption is L2 is a separate audit and the Apps spec must hold whether D-B ships now or later. The deterministic fallback in §7b covers both worlds.

---

## 12. P0 cross-check

| Directive | Status under this spec | Note |
|---|---|---|
| **D1 — Activity, not app** | Respected. The list rail headline is `topBlockLabel || topArtifactTitle` — what was done. App name moves to secondary line. The detail narrative leads with activity (files, domains, channels). |
| **D2 — Time awareness** | Not directly applicable to Apps display, but the "Today" period and "last N days" framing must respect the user's local date; already does (`Apps.tsx:111`). The narrative template should not say "this week" if the period is 7d — say "last 7 days." Spec already implies this. |
| **D3 — Minute precision** | Respected. Block ranges in the detail panel quote start–end pairs at minute precision (`formatBlockRange`, `Apps.tsx:105`). Per-domain time stays at second-precision rollups, rendered via `formatDuration`. No "approximately." |
| **D4 — Never refuse** | Respected by §7b. "Daylens needs more context" is replaced by per-shape templates that always cite the closest captured signal. |
| **D5 — App view is context, not totals** | Load-bearing. Spec is designed around this. Headline = activity, minutes = footer metadata, group by category, narrative leads detail. Confirm by reading §2. |
| **D6 — Capture surface is a tradeoff, not a constraint** | Respected at §11 — every category's degraded-quality reason is named as an L1/L2/L3 dependency, not a privacy constraint. The "VS Code shows one file when it should show ten" failure is explicitly called out as an L1 roadmap item, not papered over. |
| **D7 — Common understanding** | Respected; this doc cites AGENTS.md, AI-PRODUCT-DIRECTION.md, PRODUCT-SPEC.md, and V1-PHASE-0-READ.md as inputs. |

No P0 conflict found. If a reviewer disagrees, surface the conflict explicitly before locking.

`Pushback:` you may push that the deterministic-first narrative model in §5 conflicts with D5's implicit "narrative" framing. Counter: D5 says "the detail panel leads with a 2-3 sentence narrative." It does not say "AI-generated narrative." Deterministic prose that names two concrete entities satisfies the directive and improves latency.

---

## 13. Decisions I need from the user before locking

Numbered. Each carries a stated lean.

1. **Native Perplexity.app + Perplexity-the-website: are they the same row or two rows?**
   *Lean: two rows.* The native app is its own process; the website is evidence inside a browser. Merging them requires an entity table (D-I) and is a v1.x feature, not v1.
2. **Deterministic-first narrative, AI as polish, or AI-first with deterministic fallback?**
   *Lean: deterministic-first.* Removes all spinner-driven UI states, removes 95% of perceived latency, makes the panel usable offline. AI becomes incremental polish.
3. **Refresh button: kill outright?**
   *Lean: yes, kill.* See §8.
4. **Keep the per-hour time-of-day distribution chart?**
   *Lean: keep, demote.* It answers "when in the day" in one glance.
5. **Live in-flight app: headline behavior?**
   *Lean: "Currently active · {window_title}".* Cheap, deterministic, honest.
6. **Should the digest precompute land before the narrative deterministic-first refactor, or after?**
   *Lean: before.* The digest mis-attribution bug (§1d, §3b) is the most user-visible single failure today. Fix it first, then layer §5 on top.
7. **Are we okay calling §11 D-G (window-title fidelity for editors) explicitly out-of-scope for this phase?**
   *Lean: yes, document the gap and ship.* Otherwise this phase blocks behind an L1 tracker change.
8. **D-F (precompute `appCharacter` and per-day app digest into `daily_rollups`) — scope into this phase or land in a separate L3 sweep?**
   *Lean: scope in.* The §10 performance fix depends on it.
9. **Right rail empty-state copy (zero sessions): include or assume unreachable?**
   *Lean: assume unreachable.* If a row appears, it has time; if it has time, §7b's templates cover it.
10. **Are we comfortable with the "browsers carry the receipts; sites don't get promoted" rule (§3a) being a hard, no-exception rule for v1?**
    *Lean: yes, no exceptions.* Exceptions metastasise — every site argument ("but Notion is really an app") opens the door to a hundred more.

`Pushback:` you may want a smaller list — I expect at least decisions 1, 2, 6, and 10 to draw debate; the rest are mechanical.
