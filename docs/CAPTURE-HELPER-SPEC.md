# Capture Helper Spec

Status: **design — not implemented.** This spec is the target architecture for the capture layer rewrite. Nothing here is shipped until the verification tests at the bottom pass against the running app.

Replaces: `@paymoapp/active-window` 5s polling + `browserContext.ts` AppleScript + `browser.ts` history reader (for live dwell; `browser.ts` stays for retroactive backfill).

## 1. Architecture

A standalone **Swift helper binary** spawned by the Electron main process as a child. It runs the macOS event loop, captures focus events, and streams them to Node over stdout (newline-delimited JSON). Node appends them to the `focus_events` table.

```
┌─────────────────────────┐         stdout (ndjson)        ┌──────────────────┐
│  Swift capture helper   │ ────────────────────────────▶  │  Electron main   │
│  (own process)          │                                │  (Node)          │
│                         │         stdin (commands)       │                  │
│  • NSWorkspace events   │ ◀──────────────────────────── │  • appends to    │
│  • AX focused window    │   (pause/resume/shutdown)      │    focus_events  │
│  • Apple Events tabs    │                                │  • projections   │
│  • permission checks    │                                │  • AI / UI       │
└─────────────────────────┘                                └──────────────────┘
```

Why a separate process:
- A crash or permission stall in capture cannot take down the app.
- The macOS run loop (NSWorkspace notifications, timers) runs natively without bridging.
- Restartable independently.
- Keeps fragile platform code out of the Electron main thread entirely.

The binary ships inside the Electron app's `resources/` folder alongside `better-sqlite3.node` and the existing `@paymoapp/active-window` native module.

## 2. Event Schema

```sql
CREATE TABLE focus_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_ms         INTEGER NOT NULL,  -- wall-clock milliseconds (for the row's timestamp)
  mono_ns       INTEGER NOT NULL,  -- monotonic nanoseconds (for duration math)
  event_type    TEXT    NOT NULL,   -- see enum below
  app_bundle_id TEXT,
  app_name      TEXT,
  pid           INTEGER,
  window_title  TEXT,               -- from AX; NULL when unavailable (full-screen)
  url           TEXT,               -- from Apple Events tab read; NULL for non-browsers
  page_title    TEXT,               -- from Apple Events; NULL when unavailable
  source        TEXT    NOT NULL,   -- how the data was obtained
  confidence    TEXT    NOT NULL,   -- observed | inferred | unknown
  platform      TEXT    NOT NULL DEFAULT 'darwin',
  schema_ver    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_focus_events_ts ON focus_events(ts_ms);
CREATE INDEX idx_focus_events_type ON focus_events(event_type);
```

### event_type values

| Value | Fires when |
|---|---|
| `app_activated` | NSWorkspace.didActivateApplicationNotification |
| `app_deactivated` | NSWorkspace.didDeactivateApplicationNotification |
| `space_changed` | NSWorkspace.activeSpaceDidChangeNotification |
| `tab_changed` | AppleScript poll detects a different active tab |
| `tab_sampled` | AppleScript poll confirms same tab (periodic heartbeat, every ~10s) |
| `idle_start` | System idle exceeds threshold |
| `idle_end` | User input resumes |
| `lock` | Screen locked |
| `unlock` | Screen unlocked |
| `sleep` | System suspending |
| `wake` | System resumed |

### source values

| Value | Meaning |
|---|---|
| `nsworkspace_event` | NSWorkspace notification (event-driven, reliable) |
| `ax_focused_window` | AX API focused-window title |
| `apple_events_tab` | AppleScript / compiled Apple Events tab read |
| `history_backfill` | Browser history SQLite (retroactive, not live) |
| `unknown` | Source could not be determined |

### confidence values

| Value | Rule |
|---|---|
| `observed` | The data came from a direct API read that succeeded |
| `inferred` | Derived from adjacent observations (e.g., dwell end estimated from next event) |
| `unknown` | Read failed; the row records the failure, not the content |

**Core invariant:** capture NEVER writes a guessed URL or title with `confidence=observed`. If the read failed, confidence is `unknown` and the content fields are NULL. No exceptions.

## 3. Foreground Tracking

**Proven by probe (2026-05-27, macOS 26.5).**

| API | What it gives | Full-screen? | Use |
|---|---|---|---|
| `NSWorkspace.didActivateApplicationNotification` | App activated (event-driven) | Yes | Primary app-switch signal |
| `NSWorkspace.activeSpaceDidChangeNotification` | Full-screen enter/exit | Yes | Marks title-gap periods |
| `NSWorkspace.shared.frontmostApplication` | Current app name + bundle + pid | Yes | Polled 1/s as heartbeat |
| AX `kAXFocusedWindowAttribute` → `kAXTitleAttribute` | Window title | **NO — returns empty** | Title when available; accept NULL in full-screen |
| `CGWindowListCopyWindowInfo` | Window exists + name | **Intermittently empty** | Demoted; only for "window exists?" check |

### Full-screen behavior (measured)

When a browser enters native full-screen:
- `activeSpaceDidChange` fires. `frontmostApplication` keeps working (app + time preserved).
- AX window title goes **empty** (status ok, value ""). CGWindow name also empty. `onscreen` drops to ~6.
- AppleScript tab URL **keeps working** (browsers only).
- On exit: `activeSpaceDidChange` fires, title restores within ~1s.

Decision: in full-screen, record `window_title=NULL` with `confidence=observed` (the read succeeded; the value is genuinely empty). For browsers, the tab URL covers the gap.

## 4. Browser Tab Tracking

**Decided via probe data + blind 4-model ensemble (2026-05-27).**

### Primary: Apple Events polling (hardened)

| Parameter | Value | Rationale |
|---|---|---|
| Poll interval | **1s** while a browser is frontmost | Probe proved osascript ~150ms; 1s catches most fast switches |
| Adaptive backoff | 3s after 5 identical samples | Reduce CPU when user is parked on one tab |
| Suspend | When frontmost app is NOT a browser | ~95% of sessions are non-browser |
| Thread | **Dedicated serial DispatchQueue** (.utility) | Never blocks the NSWorkspace event loop |
| Script | Compiled `NSAppleScript` per browser, retained | Drops latency from ~150ms (fork osascript) to ~50-80ms |
| Timeout | 500ms per call | Probe showed authorized reads complete in 120-210ms; 500ms is generous |

### Permission handling

Before ANY tab read against a browser bundle:

```swift
let status = AEDeterminePermissionToAutomateTarget(desc, wildClass, wildID, false)
// false = never prompt from the background
```

| Status | Action |
|---|---|
| `noErr` (0) | Authorized. Read the tab. |
| `-1744` (notDetermined) | **Do not read.** Emit event with `confidence=unknown`. Surface in the UI: "Grant access to [browser] for tab tracking." |
| `-1743` (denied) | **Do not read.** Cache denial for 60s. Emit `confidence=unknown`. |
| `-600` (not running) | Skip. |

Cache permission per bundle. Re-check on `app_activated` for that bundle.

**The 2.45s blocking prompt (probe-confirmed on Comet) never happens because we never call with askUserIfNeeded:true from the helper.** The first prompt is triggered from a user-foregrounded onboarding UI moment in the Electron renderer.

### Three-state dwell machine

```
idle ──(valid tab)──▶ observing(tab, since)
                          │
                   (same tab) → stay, advance lastSeen
                   (diff tab) → COMMIT dwell, start new
                   (failure)  → uncertain(tab, failCount=1)
                          │
              ┌───────────┘
              ▼
     uncertain(tab, n)
              │
       (same tab recovers) → resume observing (no time lost)
       (diff tab)          → COMMIT dwell at last-observed ts, start new
       (n ≥ 3 or >10s)    → DISCARD uncertain period, → idle
```

**Commit rule:** dwell `{bundle, url, start, end}` emitted ONLY between two consecutive `observed` samples for the same `(bundle, url)`. Non-observed periods are never attributed. This is the "never guess" invariant.

### Edge cases

| Case | Handling |
|---|---|
| `missing value` from AppleScript | Treat as failure → enter `uncertain` |
| `chrome://`, `chrome-untrusted://`, `about:`, `safari-resource://` | Classify as `internal_scheme`. Continue dwell against a stable key (`__browser_internal__`), don't flush. |
| Firefox | `unsupported_browser` status. Emit event with `confidence=unknown`. No fake history guess. |
| Dia / Comet | Expected to work (Chromium scripting dictionary). Probe on first encounter; mark `unscriptable` if missing. |
| App switch (browser loses focus) | `app_deactivated` event → commit dwell → state goes `idle` |
| Screen lock / sleep | Commit all open dwells → `idle` |

### History DB role (demoted)

`browser.ts` continues running on its 60s timer for **retroactive enrichment only**: backfilling page titles for URLs that lack them, reconciling visit counts. It is never used for live dwell estimation. The `recentHistoryTab` fallback path in `readActiveBrowserTab` is removed.

## 5. Duration Math

**Use monotonic clock for durations, wall-clock for timestamps.**

The `mono_ns` column stores `clock_gettime(CLOCK_UPTIME_RAW)` (or `mach_absolute_time` converted). Dwell duration = `(end.mono_ns - start.mono_ns)`. This is immune to DST transitions, NTP slews, and the clock jumps that feed B4/B11 inconsistencies.

`ts_ms` stores `Date.now()` equivalent for human-readable timestamps and date-range queries.

## 6. Platform Abstraction

The event schema is platform-agnostic. Only the helper binary is platform-specific.

| Platform | Foreground | Tab | Idle | Status |
|---|---|---|---|---|
| macOS | NSWorkspace + AX (Swift helper) | Apple Events, extension later | TBD (future probe) | **This spec** |
| Windows | `SetWinEventHook` + `GetForegroundWindow` | Extension or UI Automation | `GetLastInputInfo` | Design only |
| Linux | xdotool / hyprctl / sway (existing in tracking.ts) | Extension | X11 idle / ext-idle | Existing, unverified |

All platforms emit the same `focus_events` schema. Everything above Layer 0 (sessionization, blocks, retrieval, AI) is written once.

The extension (when built) becomes another reader into the same schema. It doesn't replace the Apple Events path; it augments it. When extension data is available for a browser, the helper suspends Apple Events polling for that bundle and prefers extension events. When the extension disconnects (disabled, updated, crashed), polling resumes automatically.

## 7. Verification Tests

Each test is **observable in the running app or a frozen event log**, not "typecheck passes."

### V1 — Foreground tracking

| Action | Expected in focus_events |
|---|---|
| Switch between two windowed apps | `app_activated` / `app_deactivated` pairs with correct bundle + AX title |
| Go full-screen in an app | `space_changed` event. Subsequent rows have `window_title=NULL`, `confidence=observed`. `app_name` still correct. |
| Exit full-screen | `space_changed`. Title restores within 1-2 rows. |

### V2 — Tab tracking

| Action | Expected |
|---|---|
| Switch among 3 tabs in an authorized browser, ~3s each | `tab_changed` events with correct URLs. Dwell durations ±1s of wall clock. |
| Sub-1s tab flick | Either captured as a short dwell or cleanly absent. Never mis-credited to a neighbor tab. |
| Tab on `chrome://settings` | Event with `url=chrome://settings`, classified as internal. No flush / gap in dwell continuity. |
| `missing value` tab (Dia artifact page) | `tab_changed` with `confidence=unknown`, `url=NULL`. Previous tab's dwell committed at last-observed timestamp. |
| Full-screen browser + tab switches | `tab_changed` events still fire (Apple Events survive full-screen). `window_title=NULL` but `url` populated. |

### V3 — Permissions

| Action | Expected |
|---|---|
| First encounter with an unauthorized browser | `confidence=unknown` event, NO 2.5s block, NO history guess. UI surfaces "grant access" prompt. |
| Deny Automation for a browser | `confidence=unknown` rows for that browser. No tab URLs written. Other browsers unaffected. |
| Grant Automation after denial | Next `app_activated` for that browser re-checks. Tab reads resume. |

### V4 — Regression corpus

Record one 30-minute session of real use (the event log). Annotate ground truth manually ("I was on YouTube 18:03-18:04, then ccunpacked.dev 18:04-18:05"). Store as `tests/capture-corpus/`. Any future change to the capture helper or the sessionization projection is graded against this corpus. The corpus says yes or no. The AI doesn't get to decide.

## 8. Migration from Current Code

The helper runs **alongside** the existing tracking.ts path during transition:

1. Ship the helper. Have it write to `focus_events` while `tracking.ts` continues writing to `app_sessions` and `website_visits` as today.
2. Build the sessionization projection over `focus_events`. Compare its output against `app_sessions` for the same day. Surface differences.
3. Once the projection matches or exceeds `app_sessions` quality (verified by the regression corpus), switch the Timeline / Apps / AI surfaces to read from the new projections.
4. Remove `@paymoapp/active-window` dependency and the old polling path from `tracking.ts`.

This means zero downtime and a rollback path at every step.
