# Changelog

Released versions only. Each entry is one line, factually verifiable, no aspiration.
Prior entries that overclaimed shipped behavior were removed during the May 2026
focus reset.

## Unreleased — 2026-07-07 pre-shipping audit

### Security
- macOS ad-hoc updater verifies SHA-256 of the downloaded ZIP against the GitHub release digest before staging. Fail-closed: no digest → manual download only. Bundle identity check (CFBundleIdentifier) before the swap script runs. Temp files cleaned up on failure.

### Performance
- Browser history reads (60s poll) moved from sync `copyFileSync` to async `fsp.copyFile` with `COPYFILE_FICLONE` (O(1) APFS clone). Reentrancy guard prevents overlapping polls.
- Active-tab fallback (5s poll) uses clone-first with a 64 MB size guard; larger History DBs skip the sync read and let the 60s poll backfill.

### Reconciliation
- `getDistractionByMonth/Hour/Domain` now bucket reconciled per-domain credits instead of raw `SUM(duration_sec)`, so distraction cost agrees with foreground time.
- AI `aggregateSiteUsage` uses `getReconciledDomainIntervals` for site time; visit count stays raw.
- `workMemoryProfile` background-site ranking uses reconciled credits.

### Sweep fixes
- `attribution.ts` `loadIdlePeriods`: event-type matching fixed to match `lock_screen`, `suspend`, `away_start`, `unlock_screen`, `away_end` (was matching `'lock'`, `'sleep'`, `'unlock'`, `'wake'` which never matched the real event types).
- `chunk2.ts` gap threshold: 5 min → 15 min (matches the founder decision from 2026-07-02 and the main engine).

## Unreleased — 2026-07-06/07 tracking engine fixes (commits fad6cc0, 6df04fa, 93f5ffb)

### Sleep and idle
- Poll-gap detection (>60s hole between ticks) ends the open session at the last evidence of activity, flushes browser context, and backdates an `away_start` event. `suspend`/`lock_screen`/`resume`/`unlock_screen` also cut a still-open session (belt-and-braces).
- `recoverPersistedLiveSnapshot` splits a cross-midnight recovered session into one slice per calendar day.
- `IDLE_GAP_THRESHOLD_MS` set to 15 min (founder decision, supersedes the 45-min sitting). Block span ceilings rose to 3h/5h/6h.

### Incognito
- Private/incognito windows are never tracked — no website visit, no app session — regardless of the Tracking Controls master switch (founder rule). Structured Chromium `mode of front window` signal where supported; title fallback applied unconditionally. Dia's AppleScript exposes no window mode (known limitation).

### Browser detection
- Browser detection uses the app catalog + OS registry instead of a hardcoded name regex. Zen, Dia, Comet, and future browsers work without a code change.
- Safari history capture tracks Full Disk Access status (ok/denied/unknown) from the copy outcome and surfaces it in Settings' capture health with a Privacy_AllFiles deeplink.

### Categories and colors
- Block category distribution is site-weighted: each browser session's seconds split across the categories of the sites reconciled inside the block. Dia recataloged `browsing`; heuristic bumped to `timeline-v10`.
- Block colors always use `activityColorForCategory(block.dominantCategory)` — no provisional grey override. Live blocks color correctly as evidence accumulates.
- Entertainment/social artifacts may refine a non-focused base but never override a focused base unless strictly majority. Notion/Google Docs/Linear pages carry `productivity` weight.

### Reconciliation
- Site time reconciles against browser foreground time: visits clip to when the hosting browser was frontmost, partition the browser's time (one active tab at a time), and are zeroed behind other apps or during absence signals. `getWebsiteSummariesForRange`, `getTopPagesForDomains`, `getBrowserActivityBreakdown`, and the App Detail view all read from the same reconciled ledger.
- Background-tab history accrual (Netflix "playing" through idle, a Meet tab "earning" 33m while Warp was focused) is eliminated.
- Sites render nested under their browser in the inspector and edit modal, never as additive siblings.

### Auto-analyze
- The AI regroup that merges same-intent neighbours runs on day rollover + startup-finalize, not just the manual Analyze click. Gated by `persistedDayWasProcessed` so tokens are spent at most once per day. Falls back to heuristic blocks on provider outage.

### Background AI budget
- A hard daily budget breaker (`BACKGROUND_AI_DAILY_CALL_CAP = 250`) caps background AI calls at the execution choke point. The dead passive cleanup loop that caused $110/week of runaway labeling is deleted.

### Evidence and naming
- `looksLikeRawArtifactLabel` rejects SCREAMING / SCREAMING-KEBAB stems from block names (e.g. `AGENT`, `AGENT-EXECUTION-PLAN.md`).
- Evidence title selection prefers specific page titles over generic hub/index titles.
- `workBlockPrompt` names the site ("in Notion") over the browser ("in Dia").

### Corrections survival
- Corrections store `span_start_ms`/`span_end_ms` (migration 41); the boundary scorer erases proposed boundaries inside user-fused spans regardless of session id namespace.
- Label/category reviews and merge corrections survive across the `app_sessions` ↔ `derived_sessions` id flip.

### Data repairs
- July 6 night window (00:00–03:06) rebuilt from `focus_events` after the broken build's never-flushed Dia blob was discovered. 112 sessions / 2.77h inserted with `capture_source='recovery_backfill'`.
- July 6 afternoon (12:52–18:11) rebuilt from `focus_events` after the sleep-gap phantom was discarded. 136 sessions / 5.36h inserted.
- Both windows' `active_browser_context` visits clamped to rebuilt browser foreground (46,062s → 5,231s night; 19,003s → 10,086s afternoon).
- Post-repair reconciliation vs Screen Time: every app within minutes.

## v1.0.43 - 2026-06-01 — AI Tab Polish

- One command palette: ⌘K now holds every chat and message action plus history search, so there is a single place to find things instead of a separate search box and action menu.
- "Turn into" actions are real: shortening, a checklist, bullets, or a report now faithfully rewrite the specific answer you ran them on instead of regenerating a generic day summary.
- Follow-up suggestions are grounded in the answer you just got, not templated from app names, so they read like real next questions.
- New Raycast-style model picker in the composer, with each model's capabilities shown inline.
- Compose with mentions: typing `@` inserts an app, project, or day as an inline chip with its icon, and chat titles no longer collapse to a bare word like "today".

## v1.0.42 - 2026-06-01 — Gemini Fix + AI Tab Upgrades

- Gemini works again. The default Gemini model was pointing at a version Google retired, so Gemini chats stopped responding. Daylens now uses the current Gemini model and quietly moves anyone who was stranded on the old one.
- The AI tab is more capable and more reliable: chats survive rate limits with automatic retries and clearer errors, the conversation history has a searchable, time-grouped sidebar with archive, and a ⌘K command palette puts common actions a keystroke away.
- New ways to work with answers: turn any response into a shorter version, a checklist, bullets, or a report, and set a per-chat model and custom instructions.
- Faster composing: type `@` to reference your apps and projects or `/` for quick commands, and search your history in plain language instead of exact keywords.
- New optional tracking controls, off by default so nothing changes unless you turn them on: exclude specific apps or websites, automatically skip private/incognito windows, and pause tracking from Settings or the tray.

## v1.0.41 - 2026-05-31 — Timeline Coherence + AI Tab Rewrite

- The AI tab is rebuilt as a faster, minimal chat: the composer auto-grows with no per-keystroke layout work, new chat is instant, and the message list, composer, and history search render in isolation so typing, streaming, and searching no longer re-render each other.
- Local-history search is preserved at the top of the AI tab; the recap panel, hero day-summary, and separate files browser were removed in favor of inline artifact cards.
- Timeline and insights refreshes from foreground app switches are throttled to reduce repeated full-day rebuilds.
- AI block relabel writes now use one persistence path, and per-block Regenerate tells the model which label was rejected.
- Titleless, artifactless browser slivers between work stretches are absorbed without loosening distinct-topic or real-gap guards.
- AI provider settings support the branch's BYOK/OpenRouter cleanup.

## v1.0.40 - 2026-05-29 — Updater Recovery

- macOS in-app updates validate the downloaded ZIP size and stage the replacement before closing Daylens services.
- Update downloads show a progress bar as well as percentage text when the release feed provides byte sizes.
- The install button no longer opens the extra cleanup confirmation sheet before downloading, and update failures now use plain-language recovery copy instead of internal error text.

## v1.0.38 - 2026-05-29 — Daylens 1.0 (First Stable)

- Work memory system learns workstream patterns from desktop activity and backfills across full history.
- Block coalescing merges fragmented timeline entries into 60–120 min work sessions.
- Active-time durations and proportional block sizing finalized in timeline view.
- AI evidence packing expanded to ~28k tokens with 32k output cap.
- AI surfaces route through linked workspace keys for project-aware context.
- Cross-platform release pipeline fixed (GitHub Actions token, GitHub-hosted runners for macOS/Linux).

### Fixed
- **Windows downloads work again.** New Windows installers are publishing to the download page after a stretch where the build pipeline was blocked. Until a code-signing certificate is in place, first launch on Windows still shows a SmartScreen "Windows protected your PC" prompt — click **More info** then **Run anyway** to continue. Setup details are tracked in [INSTALL.md](docs/INSTALL.md).

## v1.0.36 - 2026-05-04

- Command palette and global shortcut (`Cmd+Alt+D` / `Ctrl+Alt+D`).
- Browser pages from supported browsers feed into the timeline on macOS and Windows.

## v1.0.35 - 2026-04-30

- Timeline block splitting respects sustained context changes and caps long blocks.
- Apps detail focuses on what you used a tool for, not session counts.

## v1.0.34 - 2026-04-29

- Day Wrapped and Morning Brief notifications open a slide-based recap.
- Onboarding flow simplified.

## v1.0.33 - 2026-04-28

- Follow-up chip filtering hardened against grammar-word and stop-word leaks.
- Files tab refreshes after every completed turn.

## Earlier

Earlier versions (v1.0.27 through v1.0.32) shipped tracking, persistence, and the
initial AI surface. Their changelog notes were removed in the 2026-05-12 cleanup
because several claimed cross-platform parity or runtime validation that had not
actually happened.
