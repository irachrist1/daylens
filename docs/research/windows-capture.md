# Windows capture — research and chosen approach

**Status:** Researched · **Date:** 2026-06-22 · **Issue:** DEV-95

Companion to [`docs/findings.md`](../findings.md) and [`docs/research/prior-art.md`](prior-art.md) §1.
Mac capture is proven via `@paymoapp/active-window` + the Swift helper. This doc records what
Windows gives us, what we chose, and what comes later.

---

## 1. Baseline (code audit, pre-fix)

| Signal | Windows today | Gap |
|--------|---------------|-----|
| Foreground app + window title | `@paymoapp/active-window` every 5s | Works; no high-frequency title stream |
| Live browser tab URL/title | History inference only (`browserContext.ts`) | No live URL; lag + title-matching errors |
| Browser discovery | Hardcoded exe list + `windowsBrowsers()` paths | Zen/unknown forks miss unless hardcoded |
| Capture health | Queries Mac-only `focus_events` sources | Always shows "waiting" on Windows |
| Permissions UI | Auto-"granted" | Misleading; no helper-running signal |
| Background builds | WMIC snapshot in diagnostics only | Not in block evidence |

Foreground capture and Chromium/Firefox **history polling** already work. The gaps are live tab
reads, OS-level browser discovery, platform-aware health, and background-process evidence.

---

## 2. Live tab URL — UI Automation first

**Chosen:** A small **C# native helper** using **UI Automation (UIA)** for Chromium-family
browsers. Same NDJSON event stream as the Mac Swift helper → `focus_events` with
`platform='win32'`.

**Why UIA first (not extension):**

- No install step for the user — Daylens ships as one installer.
- Chromium, Edge, Brave, Arc, Dia, Comet expose the address bar as a UIA `Edit` control in
  most configurations.
- Matches the Mac pattern: native helper beside Electron, never guess on failure.

**Firefox / Zen:** Same as Mac — no live URL via OS APIs. Read `places.sqlite` on a poll
interval; helper emits `confidence: unknown` for tab reads (never invent a URL).

**Phase 2 (documented, not v1):** Browser extension per ActivityWatch / RescueTime — gold
standard for incognito-aware, exact tab data across every browser. See `prior-art.md` §1.

**UIA risks:** Address-bar automation IDs change between browser versions. Mitigation:
family-specific selectors + history fallback; capture-health shows when live reads fail.

---

## 3. Browser discovery — StartMenuInternet + URL handlers

**Chosen:** Mirror Mac Launch Services by reading Windows URL-handler registration:

1. **`HKCU\Software\Clients\StartMenuInternet`** — installed browsers (Chrome, Firefox, Edge, …).
2. **`HKCR\<ProgId>\shell\open\command`** — resolve ProgId → executable path.
3. **AppData scan** — for each discovered exe, locate `User Data/.../History` (Chromium) or
   `profiles.ini` → `places.sqlite` (Firefox family, including Zen at `%APPDATA%\zen\Profiles`).

Static paths in `windowsBrowsers()` remain as fallback when registry read fails (corporate
images, portable browsers).

One registry cache (`REGISTRY_CACHE_MS`) feeds both foreground browser tagging and history
polling — same single source of truth as Mac `browserRegistry.ts`.

---

## 4. Background process evidence — CIM now, ETW later

**Chosen for v1:** Replace deprecated **WMIC** with **PowerShell `Get-CimInstance Win32_Process`**
for process name, PID, working set. Track deltas between polls to estimate sustained CPU.

**Later:** ETW provider `Microsoft-Windows-Kernel-Process` for accurate CPU% over time without
polling every process.

**Guardrails:**

- Filter system noise (`svchost`, `System`, `Registry`, `dwm`, …) — same spirit as Mac
  `loginwindow` rules.
- Never surface raw CPU/memory in UI — only fold notable long-running tools into block
  evidence as intent ("a local build was running").
- Cap at top N processes per hour.

Mac has no equivalent API today; Windows leads here. A Mac counterpart is a future stub only.

---

## 5. CI and verification

- **PR gate:** `windows-latest` typecheck + native rebuild + hermetic tests.
- **Runtime gate:** `verify-windows-runtime.yml` — package NSIS, `verify-packaged-natives.js`,
  launch with `DAYLENS_SMOKE_TEST=1`.
- **UIA / real browsing:** Manual on a physical Windows machine (CI cannot drive Edge tabs
  reliably). Surface QA checklist: `docs/windows-surface-qa-checklist.md`.

---

## 6. Implementation packets (ship order)

1. Windows browser registry
2. UIA capture helper + `windowsFocusCapture.ts`
3. Platform-aware capture health + Settings panel
4. Background process evidence (CIM)
5. Windows CI + smoke mode
6. Surface QA on real hardware
7. `INSTALL.md` + `WINDOWS_SIGNING.md`

Parent issue DEV-95 closes when all packets land and the surface matrix is screenshot-verified
on a real Windows day.
