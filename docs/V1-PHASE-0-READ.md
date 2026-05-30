# Daylens v1.0 — Phase 0 read + layered audit

Working doc for the v1.0 prep effort. Updated as each layer's audit lands. Source of truth lives in the code and DB; this doc is a stable index of decisions and findings.

## Approach

Foundation-up rebuild. We do not polish a layer until the layer beneath it is sound, because polish on dirty inputs is wasted work.

1. **Capture** — what we sense from the OS, browsers, and external sources.
2. **Clean** — denoise the event stream (rapid switches, idle, machine off, dedup).
3. **Structure** — one canonical set of tables/views every reader uses.
4. **Timeline UI** — built on layers 1–3.
5. **Apps UI** — built on layers 1–3.
6. **AI UI** — tools that read layer 3; plus its own UX work (latency, formatting, follow-ups, model switcher, empty-key state, output sanitization).

AI-tab perf bugs (typing flicker, formatting, follow-up quality) are independent of the data layer and may be patched opportunistically when the relevant files are open.

## Phase 0 — reality check (done)

### UX (from 15 screenshots, 2026-05-15)

**Timeline:**
- Block names oscillate between three modes with no rule: decent (`Diagramming and note-taking`), literal page-title fragment (`Microsoft Intune admin center`, `Active users — Microsoft 365 admin c…` truncated), and lazy fallback (`Untitled block`, `Safari browsing session`, `Live now: Untitled block`).
- Block summaries are template padding: enumerates apps + sites; doesn't say what was done.
- "Shape of the day" right rail promotes search-query strings to top-line takeaways ("captured around ibm quantum chips for 59m").
- Category badges (BROWSING / DEVELOPMENT / UNCATEGORIZED) add noise without informing.
- "Attribute to client" lives in the per-block detail rail. Wrong placement for personas without clients.

**Apps:**
- Mixes apps and sites at the same level. `Perplexity` listed twice as a "Browsing app" (in Safari, in Dia). `Microsoft Intune admin center` (a site) listed as a "Development app" (in VS Code).
- Right rail has a persistent stuck state: "Generating a stronger app narrative…" on multiple apps.
- Fallback copy "Daylens needs more context to describe this tool" fires for apps Daylens has plenty of data on.
- The genuinely useful artifact (Time by domain for Safari) is buried.

**AI:**
- Answers are shallow regardless of how structured they look.
- Typing input is slow / flickers / doesn't respond live (renderer perf bug).
- No response formatting.
- Follow-up suggestions are redundant.
- No in-tab model selector; provider switch lives in Settings.
- **Hard blocker: OAuth token leak.** "Which pages opened in Google Meet?" rendered a raw URL containing `code=1.ARMB…` token + multi-line base64 blob. Output must be sanitized before render, independent of model.
- No verified empty-key state (must test path on landing without API key).

**Settings:**
- Labels list (per-app category overrides) scrolls to 30+ entries — a database in a settings panel.
- MCP config block is a wall of JSON dropped in plain Settings; belongs behind Advanced.
- `Workspace status: FAILED` badge surfaces a non-critical sync failure as alarming UI.

### Code mass

| File | Lines | Note |
|---|---|---|
| `src/main/jobs/aiService.ts` | 5,370 | Monolith. Center of AI duct tape. |
| `src/main/lib/insightsQueryRouter.ts` | 2,699 | Monolith. Big switch over question shapes. |
| `src/renderer/views/Timeline.tsx` | 1,748 | Single file owning the whole Timeline view. |
| `src/renderer/views/Settings.tsx` | 1,670 | Single file owning all of Settings. |
| `src/main/services/tracking.ts` | 1,769 | Big but justified — most is Linux compositor fallbacks. |
| `src/main/services/ai.ts` | 6 | Empty shim. Code was extracted into per-job files. |

Healthy migration in progress: `chatAnswer.ts`, `daySummary.ts`, `blockInsight.ts`, `appNarrative.ts`, `focusIntent.ts`, `weeklyBrief.ts` exist as new per-job files. `aiService.ts` (5,370) is the next monolith to break up.

### Stub cleanup (done)
- Removed: `.ai-behaviour/results-*.json` (20 files) + all `traces-*/` dirs + `tests/ai-bench/.last-results.json`.
- `.gitignore` updated to keep `.ai-behaviour/` out of future diffs.
- Test harness dirs `tests/ai-bench/`, `tests/ai-behaviour/`, `tests/tracking-eval/` are flagged for joint decision (likely repurpose as v1 benchmark seed if the corpus is still valid).

## Layer 1 — Capture audit

### What we sense today

**Foreground window (single primary signal):**
- `@paymoapp/active-window` native module, polled every **5 seconds**.
- Returns `{ title, application, path, pid, icon, [uwpPackage] }`.
- Platforms: macOS (Screen Recording permission required), Windows, Linux (active-window + per-compositor fallbacks: X11 via `xdotool`/`xprop`, Hyprland via `hyprctl`, Sway via `swaymsg`; Wayland: limited or unsupported per compositor).

**Browser tab context (secondary signal, separate path):**
- When foreground app matches a known browser bundle ID (Arc/Brave/Chrome/Chromium/Comet/Dia/Edge/Firefox/Opera/Safari/Vivaldi).
- macOS path: `osascript` AppleScript to fetch URL + title of front tab. One `osascript` subprocess fork per poll while in a browser.
- macOS fallback / Windows path: copy browser's own history SQLite (`History` for Chromium-family, `places.sqlite` for Firefox) to /tmp, query last 2 minutes of visits, match against window-title tokens. Full DB file copy per call.
- Min recorded duration: **5 seconds** (different from app session's 10s).
- Storage: `website_visits` table with `confidence` and `source` columns. Today, source is either `active_browser_context` (live osascript) or history-derived.

**iMessage capture (opt-in, macOS-only):**
- Reads `~/Library/Messages/chat.db` via SQLite read-only.
- Requires **Full Disk Access** (Privacy & Security pane).
- Poll: every 5 minutes; immediate-first-sync on start.
- Off by default. Toggle in Settings.
- Mirrors to `imessage_events`: `chat_guid, chat_label, handle_id, text, sent_at`.

**Power / idle:**
- `powerMonitor` listeners on `lock-screen` / `unlock-screen` / `suspend` / `resume` — all flush the in-flight session.
- `powerMonitor.getSystemIdleTime()` polled every tick.
- **2 min idle → `provisional_idle`**: session stays open. Idle time is attributed to the session — explicit choice to avoid fragmenting media playback.
- **5 min idle → `away`**: session flushed.
- Returns from idle/away log `idle_end` / `away_end` to `activity_events`.

**Crash recovery:**
- Live session snapshot persisted every 15s to a singleton table (`live_app_session_snapshot`).
- On `startTracking`, `recoverPersistedLiveSnapshot()` re-inserts the lost session with `endedReason: 'recovered_after_restart'`.

### Storage layout

| Table | Rows (today) | Shape |
|---|---|---|
| `activity_events` | 25,727 | Per-event log: timestamp, eventType, bundleID, appName, windowTitle, domain, pageTitle, duration, isIdle, confidence, source. **Rich.** |
| `app_sessions` | 18,109 | Per-foreground-app stretch: bundleID, appName, startTime, endTime, duration, category, isBrowser, **single `windowTitle`** column. |
| `browser_sessions` | 6,208 | Per-browser-app stretch: browserBundleID, browserName, start/end/duration. No URLs. |
| `website_visits` | 58,940 | Per-domain visit: domain, fullURL, pageTitle, browserBundleID, start/end/duration, confidence, source. **Richest browser signal.** |

### What we drop on purpose

- **Sessions under 10 seconds.** `MIN_SESSION_SEC = 10`. Sub-10s app focus is discarded entirely. Browser context has its own `MIN_CONTEXT_SEC = 5`.
- **OS noise.** Hardcoded `OS_NOISE_BUNDLE_IDS` and `OS_NOISE_APP_NAMES` sets, plus self-exclusion for anything matching `daylens`, `cmux`, `node.js`. Substring match — brittle on edge cases (e.g. window title containing "node.js").
- **Sub-poll-interval events.** Tab switches shorter than 5 seconds are invisible; a 7-second visit may or may not register depending on poll phase.

### What we can't see today (the gaps)

These are real holes, not policy filters:

1. **Window-title temporality within a session.** `app_sessions` stores **one** `windowTitle` — the last one observed at flush time. If a user navigated 50 files/tabs/docs inside VS Code over a 30-minute session, we keep one filename. The raw per-event detail exists in `activity_events`, but session readers (Timeline blocks, Apps view) consume `app_sessions`. **This is the single largest data-fidelity issue.**
2. **Browser SPA in-page navigation.** Gmail, X, Notion, Linear, Slack — navigating between threads/issues/docs in a single-page app doesn't always generate a new browser history entry. The osascript path catches the current URL, but if the URL doesn't change on SPA route changes, we record one URL for the whole session.
3. **Browser-history fallback assumptions.** When osascript fails (or on Windows), we use last-2-minutes browser history matched against window title. Assumes the active tab is the most recent visit — common but not always true (background tab opens, etc.).
4. **Content past the window title.** No accessibility-API extraction. We see "Slack | #channel | Workspace" but not which message you sent. We see "VS Code — file.ts" but not the function. iMessage is the only content-extraction source.
5. **Off-Mac context.** Phone calls (Continuity), iPad Sidecar, Apple Watch, AirPlay receiver activity — invisible.
6. **Fullscreen state.** *Open question.* `getActiveWindow()` returns the foreground app regardless of fullscreen, so tracking-presence is intact. What may differ is **title fidelity** when fullscreen wipes the standard window title (Keynote presenting, some games, video players). Needs to be reproduced before treating as a fix. **Action: identify the concrete scenario you experienced as "not tracking fullscreen".**
7. **Distinguishing video playback from foreground activity.** Netflix fullscreen for 2 hours and Zoom fullscreen for 2 hours both look like "app open · 2h". The 2-min provisional-idle window helps (media stays attributed during input gaps), but no signal differentiates passive consumption from active engagement.

### What's already working well (keep)

- Crash recovery via live-snapshot is solid. Few trackers do this.
- Explicit `provisional_idle` vs `away` distinction with documented reasoning is a thoughtful choice.
- iMessage opt-in with Full Disk Access — clean privacy model.
- Schema separates raw events from rolled-up sessions cleanly.
- Linux fallback chain is genuinely impressive — multiple compositor backends with diagnostic surfacing.

### Performance hotspots (Raycast-lens read)

- **`osascript` fork per 5s poll while in a browser.** That's a process fork + AppleScript JIT every tick. Likely a measurable perceived-lag contributor.
- **Browser history SQLite copy per call.** Full file `copyFileSync` + WAL + SHM into /tmp for every history-fallback read. I/O-heavy.
- **Linux per-poll `/proc` reads.** `readlink('/proc/${pid}/exe')` + `read('/proc/${pid}/comm')` + `read('/proc/${pid}/status')` + `read('/proc/${pid}/cmdline')` per resolution, cached 30s.
- **Sync `getActiveWindow()` on main thread.** Native module call is synchronous; blocks the Electron main event loop during the call. Not catastrophic at 5s cadence but adds up.
- **Projection invalidation cascades.** Every flush invalidates `timeline`/`apps`/`insights` scopes, which likely triggers re-renders + recompute downstream.
- **Attribution refresh debounce: 3s.** Tight enough that rapid app switches can chain re-runs.

### Risks / known-brittleness to file

- Single `windowTitle` per session loses navigation richness. (Item 1 above — top priority for Layer 3 to address.)
- OS-noise substring matches are brittle (`isOsNoise` substring on `daylens` / `cmux` / `node.js`).
- Browser context source field (`active_browser_context` vs history-derived) is captured but not visibly used downstream — no UI distinguishes confidence-low visits from confidence-high.
- `app-normalization.v1.json` lookup is one of several candidate resolutions; precedence chain isn't documented in one place.

### Open questions for Tonny

1. **Fullscreen scenario.** You said we don't track fullscreen — can you name one concrete example (which app, what state) where you noticed missing data? Needed to repro before deciding the fix.
2. **iMessage capture.** Is it currently enabled in your install? If yes, is it actually populating `imessage_events` (we can verify)?
3. **Test harness dirs.** `tests/ai-bench/` corpus + `tests/ai-behaviour/` scenarios — keep and rebuild as v1 benchmark, or retire?

---

*Next: Layer 2 — Clean audit. Read the segmentation / dedup / idle rules end-to-end and propose what the canonical clean event stream looks like.*
