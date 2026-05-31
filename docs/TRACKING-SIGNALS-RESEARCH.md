# Daylens — Activity Tracking Signals: Research & Options

**Purpose.** Daylens today reconstructs your day mostly from **active-window titles**
(plus the foreground app and, on macOS, the browser tab URL/page title). The product
owner asked: what *other* ways can we capture activity to get a more accurate picture
of what you were actually doing — process/task-manager data, Apple Screen Time,
cross-device, Linux equivalents, even screen recording and "how big tech tracks
users"? This doc surveys every viable signal, what each adds, per-OS feasibility,
permission/privacy/storage cost, and a recommended layered architecture. It is
research for Daylens; nothing here is a commitment. Items marked **[SPIKE]** need a
short prototype to confirm.

> Companion docs: `docs/AI-TAB-V2-SPEC.md`, `docs/TIMELINE-INTENT-MODEL.md`,
> `docs/PRODUCT-SPEC.md`, `docs/CAPTURE-HELPER-SPEC.md`.

---

## 0. What Daylens captures today (baseline)

| Signal | How | Where |
|---|---|---|
| Foreground app + window title | NSWorkspace events / active-window lib | `src/native/capture-helper/main.swift`, `@paymoapp/active-window` |
| Browser tab URL + page title (mac) | Apple Events to the browser (`apple_events_tab`) | `focusCapture.ts`, `browserContext.ts` |
| App bundle id, pid, platform, confidence | per focus event | `focusCapture.ts` (`focus_events` table) |
| Process list (memory) | `wmic` poll — **Windows only, diagnostics only** | `processMonitor.ts` |
| "Idle" | **inferred from gaps** between focus events, not from real input monitoring | `attributionResolvers.ts` (`idle_ms`, `exclude_idle_over_ms`) |

**Gaps in the baseline:** no true input-activity (AFK) signal; no file/document
activity; no calendar/meeting context; no media "now playing"; no cross-device; no
screenshot/OCR tier; process data is Windows-only and unused for the activity
picture. The rest of this doc is about closing those gaps.

---

## 1. The signal taxonomy (every viable source)

For each: **what it adds**, **feasibility per OS**, **permission**, **accuracy
gain**, **privacy/cost**, **verdict**.

### 1.1 Input-activity / idle detection ("AFK watcher") — *highest value, lowest cost*
- **What it adds:** Real active-vs-idle time. Today idle is guessed from event gaps;
  a true "seconds since last input" signal makes active-time durations honest and
  fixes inflated focus/drift numbers.
- **How (no keylogging — just *time since last input*):**
  - macOS: `CGEventSourceSecondsSinceLastEventType` (public API).
  - Windows: `GetLastInputInfo`.
  - Linux X11: XScreenSaver `XScreenSaverQueryInfo` idle time; Wayland: per-compositor
    idle protocols (`ext-idle-notify-v1`) or libinput monitoring.
- **Permission:** none on Win/X11; macOS none for the CGEventSource counter (no
  Accessibility needed for *idle seconds*, unlike event taps).
- **Privacy/cost:** trivial. Store only "idle since T", never keystrokes. This is
  exactly how ActivityWatch's `aw-watcher-afk` works (3-min AFK threshold).
- **Verdict: DO FIRST.** Cheap, cross-platform, directly fixes a known data-quality
  problem (see focus-score concerns). **[SPIKE]** a 1-day prototype.

### 1.2 Process / task-manager enumeration — *modest value, noisy*
- **What it adds:** What's *running* (not just focused): background compiles/renders,
  long-running tools, resource use. Helps distinguish "Cursor open but idle" from
  "Cursor running a heavy build".
- **How:** macOS `proc_pidinfo`/`NSWorkspace.runningApplications`/`ps`; Windows
  `EnumProcesses`/WMI/ETW (today: `wmic`, deprecated — move to PowerShell
  `Get-Process` or Win32 API); Linux `/proc`. CPU% needs sampling deltas.
- **Permission:** generally none for your own session's processes.
- **Privacy/cost:** noisy; process names ≠ activity semantics; can balloon storage.
- **Verdict: SECONDARY.** Use as a *supporting* signal (e.g., "active build
  detected"), not a primary timeline source. Extend `processMonitor.ts` cross-platform
  and feed it as evidence, sampled, not stored raw at high frequency.

### 1.3 Accessibility APIs (AX / UI Automation / AT-SPI) — *high semantic value*
- **What it adds:** The *content* of the foreground UI without a per-app integration:
  the focused document path/title, the active browser tab URL (without a browser
  extension), selected text, the field you're typing in, even which file is open in
  an editor. This is how serious trackers get "what you were doing", not just "which
  app".
- **How:** macOS Accessibility API (`AXUIElement` — read `AXURL`, `AXDocument`,
  `AXSelectedText`, `AXFocusedUIElement`); Windows UI Automation (UIA); Linux AT-SPI
  (D-Bus). Daylens already uses Apple Events for browser URL — AX would generalize
  this to editors, PDF viewers, docs, etc.
- **Permission:** macOS **Accessibility** permission (TCC prompt) — a real ask;
  Windows UIA none; Linux AT-SPI usually available.
- **Privacy/cost:** powerful = sensitive. Reading selected text / document content is
  close to reading your screen. Must be opt-in, redacted (Daylens already redacts
  emails/paths in `aiOrchestration.ts`), and scoped.
- **Verdict: TIER 2 (opt-in).** Biggest semantic accuracy jump short of screenshots.
  **[SPIKE]** read `AXURL`/`AXDocument` for the frontmost window on macOS.

### 1.4 File-system / document activity — *high value, cheap, concrete*
- **What it adds:** *What you actually edited/opened* — the strongest "real work"
  signal. "You edited 7 files in repo X" beats "Cursor was focused 2h".
- **How:** macOS FSEvents (watch project dirs), Spotlight metadata (`mdls`
  `kMDItemLastUsedDate`, `mdfind`), recent-documents (`NSDocumentController`, the
  `com.apple.recentitems` / shared file lists). Windows USN journal / recent items /
  `ReadDirectoryChangesW`. Linux inotify + recently-used.xbel.
- **Permission:** macOS Full Disk Access for broad watching; scoped folders avoid it.
- **Privacy/cost:** filenames/paths are sensitive (redactable). Watch only
  user-chosen project roots, not the whole disk.
- **Verdict: TIER 2.** Pairs beautifully with editor/terminal context. **[SPIKE]**
  FSEvents on a chosen folder → "files touched per block".

### 1.5 Browser deepening — *already partly done*
- **What it adds:** Reliable URL + page title across browsers, time-per-domain,
  scroll/active-tab audibility, incognito exclusion.
- **How:** (a) WebExtension + native messaging (most reliable; ActivityWatch's
  `aw-watcher-web` reads title/URL/audible/incognito); (b) AX for the active tab
  URL (no extension); (c) read browser history SQLite (Chrome/Safari) for backfill.
  Daylens uses Apple Events today (mac-only, brittle on permission changes).
- **Verdict: TIER 1–2.** Consider an optional browser extension for accuracy + to
  cover Windows/Linux where Apple Events don't exist. Respect incognito/private.

### 1.6 Calendar / meeting / comms context — *cheap labeling win*
- **What it adds:** Turns ambiguous blocks into named ones ("Standup", "Client call").
  Detect calls (Zoom/Meet/Teams running + mic active) and label meeting time.
- **How:** Calendar via the user's connected Google/Apple calendar (Daylens already
  has MCP/Google integrations); mic-in-use via OS APIs.
- **Verdict: TIER 2.** High signal-to-noise for the timeline narrative.

### 1.7 Media "now playing" — *nice context*
- **What it adds:** What you were watching/listening to (YouTube video title, Spotify
  track) even when the tab title is generic.
- **How:** macOS MediaRemote / "Now Playing"; Linux MPRIS over D-Bus; Windows
  `GlobalSystemMediaTransportControls`.
- **Verdict: TIER 2/3.** Improves entertainment-vs-work classification.

### 1.8 Screenshot + OCR + embeddings — *the "big tech" tier (Rewind/Recall)*
- **What it adds:** Near-total recall. Periodic screenshots → on-device OCR →
  searchable text + embeddings = "what was on my screen at 2:14pm" and full-text
  search of everything seen. Highest possible accuracy.
- **How (proven patterns):**
  - **Rewind.ai (mac):** ScreenCaptureKit at 5–10 fps + audio, OCR via Apple **Vision**
    framework (Live Text pipeline), H.264 compression (~3,750×), pixels→embeddings
    then discard frames, SQLite FTS, fully local, ~1–15 GB/yr, excludes private
    browser windows + a user exclusion list.
  - **Microsoft Recall (Win, Copilot+):** snapshots every few seconds, **local NPU**
    OCR, encrypted SQLite, **opt-in**, gated behind BitLocker + Windows Hello,
    excludes private browsing + password fields. Shipped with major privacy backlash;
    sensitive-data filter leaked in testing.
- **Permission:** macOS **Screen Recording** permission; Windows screen capture.
- **Privacy/cost:** the heaviest by far — storage, compute, and *trust*. Recall's
  backlash is the cautionary tale: must be opt-in, encrypted at rest, locked behind
  auth, with robust exclusions (private windows, password fields, app blocklist), and
  ideally never leaves the device.
- **Verdict: TIER 3 (opt-in power feature), only with first-class privacy.** This is
  the single biggest accuracy lever and the single biggest risk. Treat as a separate
  product track. **[SPIKE]** measure OCR cost + storage for 1 hour at 1 frame / few
  seconds with Vision + H.264.

### 1.9 Audio / meeting transcription — *deep context, sensitive*
- **What it adds:** What was *said* in meetings (Granola-style).
- **Verdict: TIER 3 / separate track.** Consent-heavy. Out of scope unless a clear
  meeting-notes product is wanted.

### 1.10 Network / DNS — *avoid as primary*
- Domains contacted reveal activity but are very privacy-invasive and noisy. **Verdict:
  not recommended** beyond what the browser already gives.

---

## 2. Apple Screen Time — the specific ask

Two distinct paths; they are very different.

### Path A — Read the local Screen Time database (research/backfill)
- **Where:** `~/Library/Application Support/Knowledge/knowledgeC.db` (and, since
  macOS 13 / iOS 16, much of it moved to the **Biome** store). Table `ZOBJECT` has
  `ZSTARTDATE`/`ZENDDATE`/`ZVALUESTRING` (bundle id)/`ZSTREAMNAME` (e.g. `/app/usage`);
  Apple timestamps use a 2001-01-01 epoch (add `978307200` for Unix time).
- **Access:** requires **Full Disk Access**; the DB is read-only, **undocumented**,
  SIP/TCC-protected, and its schema **changes across macOS versions** (and is moving
  to Biome). People do build personal trackers off it.
- **Verdict:** viable **only** as an optional, mac-only, one-time/periodic **historical
  backfill** import — clearly labeled as best-effort and version-fragile. Not a
  dependable live source. **[SPIKE]** read app-usage rows under FDA on the current
  macOS.

### Path B — The official Screen Time API (FamilyControls / DeviceActivity / ManagedSettings)
- Requires the **privileged `com.apple.developer.family-controls` entitlement**
  (Apple approval). Critically, it is **privacy-walled**: the `DeviceActivityReport`
  extension is designed so the host app **cannot read the underlying data**. As one
  developer guide puts it, the API "knows you used Safari for 10 mins at 11am but has
  no idea what you did in Safari" — and even that is rendered inside a sandboxed
  report extension the app can't exfiltrate.
- **Verdict: dead end for Daylens.** The official API is built for parental-control
  blocking, not for exporting usable activity data.

### Cross-device Screen Time (iCloud)
- Apple syncs Screen Time across your devices via iCloud, but there is **no supported
  way** to query that cross-device data locally. → Cross-device must come from
  **companion agents**, not from Apple's cloud (see §3).

---

## 3. Cross-device tracking (laptop + phone + other devices)

There is no shortcut through a vendor cloud. The realistic model is **a small
companion agent per device reporting into Daylens' existing sync** (`syncUploader.ts`,
`workspaceLinker.ts`).

- **Other Macs / Windows / Linux laptops:** run the Daylens agent; merge by user.
- **iOS/iPadOS:** heavily sandboxed. Only `DeviceActivity` (privacy-walled, §2B) is
  available — you can show on-device aggregates but **cannot export per-app raw data**.
  Practical iOS signal is coarse (categories/time), not detailed.
- **Android:** `UsageStatsManager` is far more open — per-app foreground time is
  readable with user permission. A companion Android app is feasible.
- **Verdict:** desktop-to-desktop is straightforward via agents + sync; **phones are
  the hard part** (iOS especially). Set expectations: rich on laptops, coarse on iOS.

---

## 4. How big tech / commercial products do it (what to borrow)

| Product | Method | Borrow |
|---|---|---|
| **ActivityWatch** (OSS, local-first) | window watcher + **AFK idle watcher** + browser extension; modular local server | The clean signal model: window + idle + browser. Best reference architecture. |
| **RescueTime** | per-OS agent, active window + URL, server categorization, cross-device accounts | Categorization + cross-device account model |
| **Rewind.ai** | continuous screen capture + Vision OCR + embeddings + H.264, all local | The Tier-3 recall pattern + extreme local compression |
| **Microsoft Recall** | periodic snapshots + local NPU OCR + encrypted store, opt-in, auth-gated | What good privacy guardrails look like (and what backlash to avoid) |
| **Toggl / Timely** | local "memory" activity capture + AI drafts timesheets | AI turning raw signals into human blocks (Daylens already does this) |
| **Employee monitors** (Teramind/Hubstaff) | screenshots + keystroke counts + URLs | What **not** to do for a consumer trust product |

---

## 5. Per-OS capability matrix

| Signal | macOS | Windows | Linux |
|---|---|---|---|
| Active window + title | ✅ NSWorkspace / lib (have) | ✅ Win32 (have) | ⚠️ X11 easy; **Wayland fragmented** — `wlr-foreign-toplevel` (sway/Hyprland), `ext-foreign-toplevel-list-v1`, GNOME/KDE via D-Bus |
| Idle / last-input | ✅ CGEventSource | ✅ GetLastInputInfo | ✅ XScreenSaver / `ext-idle-notify-v1` |
| Browser URL/title | ✅ Apple Events (have) / AX / extension | ⚠️ extension or UIA | ⚠️ extension or AT-SPI |
| Process list + CPU | ✅ proc_pidinfo | ✅ WMI/ETW (have: wmic) | ✅ /proc |
| Accessibility content (URL/doc/selection) | ✅ AX (perm) | ✅ UIA | ✅ AT-SPI |
| File activity | ✅ FSEvents/Spotlight | ✅ USN/inotify-equiv | ✅ inotify |
| Now playing | ✅ MediaRemote | ✅ GSMTC | ✅ MPRIS |
| Screenshot+OCR | ✅ ScreenCaptureKit + Vision | ✅ (Recall-style) | ✅ (grim/Pipewire + Tesseract) |
| Screen Time DB import | ✅ knowledgeC/Biome (FDA, fragile) | n/a | n/a |

**Linux note:** Wayland is the real wrinkle — there is no single active-window API.
Support the common compositors via their protocols/D-Bus and degrade gracefully.

---

## 6. Privacy & trust principles (non-negotiable, given the Recall backlash)

1. **Local-first, opt-in tiers.** Default tier is low-risk; semantic/screen tiers are
   explicit opt-in with plain-language consent.
2. **Encrypted at rest** for any rich capture (OCR text, screenshots, AX content).
3. **Exclusions by default:** private/incognito browser windows, password fields,
   user app/site blocklist, optional pause/incognito toggle in the menu bar.
4. **Redaction** (Daylens already redacts emails/paths) extended to OCR/AX text.
5. **Never silently raise capture scope** with an update; new tiers require re-consent.
6. **No raw exfiltration** — keep rich signals on-device; sync only what the user
   approves.

---

## 7. Recommended layered architecture for Daylens

Build signals in **tiers**, each independently shippable and independently
consent-gated:

- **Tier 1 — Default (low-risk, do now):** window+title (have) **+ AFK idle (§1.1)**
  **+ media now-playing (§1.7)**. Fixes active-time accuracy immediately.
- **Tier 2 — Semantic (opt-in):** Accessibility URL/document/selected-text (§1.3) +
  file activity (§1.4) + calendar/meeting context (§1.6) + cross-platform browser
  (§1.5). This is where "exactly what you were doing" comes from without screenshots.
- **Tier 3 — Total recall (opt-in power feature, separate track):** screenshot + local
  OCR + embeddings (§1.8), with all of §6's guardrails. Highest accuracy, highest
  trust cost.
- **Cross-device:** companion agents → existing sync (§3). Rich on desktops, coarse
  on iOS.
- **Backfill:** optional mac-only Screen Time/knowledgeC import (§2A), clearly
  best-effort.

Feed every signal into the existing timeline/work-memory pipeline as **evidence** so
the AI composes blocks from many weak signals rather than one (titles).

---

## 8. Suggested research spikes (next steps)

1. **AFK idle watcher** [SPIKE, ~1 day] — cross-platform last-input; wire into
   `attributionResolvers` to replace gap-inferred idle. Highest ROI.
2. **macOS AX reader** [SPIKE] — read `AXURL`/`AXDocument`/`AXSelectedText` for the
   frontmost window; measure coverage across editors/browsers/PDF.
3. **File-activity watcher** [SPIKE] — FSEvents on a chosen folder → "files touched".
4. **Screen Time DB read** [SPIKE] — query `knowledgeC.db`/Biome under FDA on current
   macOS; assess schema stability for a backfill importer.
5. **Screenshot+OCR cost** [SPIKE] — ScreenCaptureKit + Vision OCR + H.264 for 1 hour;
   measure storage, CPU, and search quality before committing to Tier 3.
6. **Wayland window watcher** [SPIKE] — `ext-foreign-toplevel-list-v1` + idle-notify on
   GNOME/KDE/sway/Hyprland.

Each spike should answer: does it work, what permission does it need, how much does it
improve the picture, what does it cost (storage/CPU/trust)?

---

## Sources
- [Notes on accessing/exporting Apple Screen Time data (knowledgeC)](https://gist.github.com/0xdevalias/38cfc92278f85ae89a46f0c156208fd5)
- [Retrieve Screen Time data on macOS via the command line](https://medium.com/@carmenliu0208/how-to-retrieve-screen-time-data-on-macos-via-the-command-line-66e269278ba5)
- [Personal Screen Time tracker for Mac/iPhone (2026)](https://boazsobrado.com/blog/2026/02/03/how-i-built-a-personal-screen-time-tracker-for-mac-and-iphone-using-claude/)
- [KnowledgeC Database Forensics guide](https://belkasoft.com/knowledgec-database-forensics-with-belkasoft)
- [A Developer's Guide to Apple's Screen Time APIs](https://medium.com/@juliusbrussee/a-developers-guide-to-apple-s-screen-time-apis-familycontrols-managedsettings-deviceactivity-e660147367d7)
- [Apple Screen Time Technology Frameworks (docs)](https://developer.apple.com/documentation/screentimeapidocumentation)
- [Monitoring App Usage using the Screen Time API](https://crunchybagel.com/monitoring-app-usage-using-the-screen-time-api/)
- [ActivityWatch — Watchers (window / AFK)](https://docs.activitywatch.net/en/latest/watchers.html)
- [ActivityWatch — aw-watcher-web (browser)](https://github.com/ActivityWatch/aw-watcher-web)
- [ActivityWatch — Wayland window/AFK watcher](https://github.com/ActivityWatch/aw-watcher-window-wayland)
- [Microsoft Recall — security/privacy testing (DoublePulsar)](https://doublepulsar.com/microsoft-recall-on-copilot-pc-testing-the-security-and-privacy-implications-ddb296093b6c)
- [Manage Recall for Windows clients (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/client-management/manage-recall)
- [Rewind.ai app teardown (Kevin Chen)](https://kevinchen.co/blog/rewind-ai-app-teardown/)
- [Rewind AI specs/privacy (2026)](https://ucstrategies.com/news/rewind-ai-mac-memory-search-tool-specs-privacy-pricing-2026/)
- [wlr foreign toplevel management protocol](https://wayland.app/protocols/wlr-foreign-toplevel-management-unstable-v1)
- [ext-foreign-toplevel-list-v1 protocol](https://wayland.app/protocols/ext-foreign-toplevel-list-v1)
