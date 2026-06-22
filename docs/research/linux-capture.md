# Linux capture — research and chosen approach

**Status:** Researched · **Date:** 2026-06-22 · **Issue:** DEV-96

Companion to [`docs/findings.md`](../findings.md), [`docs/research/prior-art.md`](prior-art.md) §1,
and the Windows parallel [`windows-capture.md`](windows-capture.md). Mac capture is proven via
`@paymoapp/active-window` + the Swift helper. This doc records what Linux gives us, what we chose,
and what comes later.

---

## 1. Baseline (code audit, pre-fix)

| Signal | Linux today | Gap |
|--------|-------------|-----|
| Foreground app + window title | `@paymoapp/active-window` + hyprctl/swaymsg/xdotool/xprop fallbacks | GNOME/KDE native Wayland apps often missed |
| App identity | Strong — `linuxDesktop.ts` + `/proc` in `tracking.ts` | Already better than Windows for “which app” |
| Browser history | `getBrowserEntries()` returned `[]` | No `website_visits` from browsers |
| Live tab URL | `readActiveBrowserTab` returned `null` on Linux | Web work invisible to blocks/Apps/AI |
| Browser discovery | Mac/Win only in `browserRegistry.ts` | Unknown browsers (Zen, Floorp) never discovered |
| Capture health | Linux auto-`granted`; `linuxTracking` not surfaced in Settings | Misleading when Wayland blocks titles |
| Background builds | `/proc` for identity only; `processMonitor` win32-only | Long builds/renders missed |
| Packaging / CI | `verify-linux-runtime.yml` + smoke tests | CI uses Xvfb (X11-ish), not real Wayland |

Foreground capture and compositor fallbacks already work on many setups. The gaps are browser
history, OS-level browser discovery, platform-aware health, tab context, and background-process
evidence.

---

## 2. Browser discovery — Freedesktop `.desktop` entries

**Chosen:** Mirror Mac Launch Services / Windows StartMenuInternet by scanning `.desktop` files:

1. Dirs: `~/.local/share/applications`, `/usr/share/applications`, Flatpak/Snap export paths (same
   as `linuxDesktop.ts`).
2. Treat as browser when `MimeType` includes `text/html` or `x-scheme-handler/http` / `https`, or
   `Categories` includes `WebBrowser`.
3. Resolve `Exec=` to a real binary (unwrap `flatpak run`, `snap`, `env`).
4. Classify Chromium vs Firefox family (Zen/Floorp → Firefox).

Implementation: `src/main/services/linuxBrowserRegistry.ts` — one cache feeds history polling and
foreground browser tagging, same pattern as Mac/Windows registries.

---

## 3. Browser history — reuse existing readers

**Chosen:** Point the existing Chromium/Firefox history readers in `browser.ts` at Linux profile
roots:

| Install style | Chromium `History` | Firefox `places.sqlite` |
|---------------|-------------------|-------------------------|
| Native deb/rpm | `~/.config/google-chrome`, `chromium`, `BraveSoftware/...`, etc. | `~/.mozilla/firefox` via `profiles.ini` |
| Flatpak | `~/.var/app/com.google.Chrome/...` | `~/.var/app/org.mozilla.firefox/...` |
| Snap | `~/snap/chromium/common/...` | `~/snap/firefox/common/...` |

Zen and other Firefox forks: `~/.zen`, `~/.var/app/...zen...` when present.

---

## 4. Live tab URL — history inference first

| Approach | X11 / XWayland | Native Wayland | Verdict |
|----------|----------------|----------------|---------|
| History inference (title match) | Works | Works (laggy) | **v1 — ship first** |
| AT-SPI2 address-bar read | Possible for Chromium | Unreliable / gated | **v1.5 spike** only if needed |
| Compositor APIs (hyprctl/sway) | N/A | Title only, no URL | Already used for titles |
| xdg-desktop-portal | No arbitrary window read | No | Document as limitation |
| Browser extension | Best | Best | **Phase 2** — `prior-art.md` §1 |

**Rule:** never guess a URL (invariant 10). Record `confidence: unknown` when live read fails.

Firefox family (including Zen) has no reliable live URL via OS APIs — same as Mac/Windows.

---

## 5. Wayland honesty matrix

| Session | Foreground backend | Title quality | URL quality |
|---------|-------------------|---------------|-------------|
| X11 | active-window + xdotool/xprop | Good | History inference |
| Hyprland | hyprctl | Good | History inference |
| Sway | swaymsg | Good | History inference |
| GNOME Wayland + XWayland | active-window for XWayland apps | Partial | History inference |
| GNOME/KDE native Wayland | Best-effort gdbus probes; often limited | Partial / missing | History inference |
| Wayland, no DISPLAY | Compositor-specific only | Often missing | History inference |

Capture health must report `supportLevel` (`ready` / `limited` / `unsupported`) and name the
missing helper — never fake “granted” like macOS Accessibility.

---

## 6. Background process evidence — `/proc`

**Chosen for v1:** Poll `/proc/<pid>/stat` and `/proc/<pid>/status` for process name, RSS, and CPU
ticks. Track deltas between 30s polls to estimate sustained work.

**Guardrails:**

- Filter Linux noise (`systemd`, `kworker`, `pipewire`, `xdg-`, …) — same spirit as Windows
  `svchost` rules.
- Never surface raw CPU/memory in UI — fold notable long-running tools into block evidence as
  intent (“a local build was running”).
- Cap at top N processes per hour.

Mac/Windows parity: all three platforms feed the same `backgroundProcessEvidence` module.

---

## 7. CI and verification

- **PR gate:** existing `verify-linux-runtime.yml` — package AppImage/deb/rpm, smoke with Xvfb.
- **Browser discovery:** optional `chromium-browser` install in CI + fixture profile for registry
  smoke.
- **Wayland / real browsing:** Manual on physical hardware — see `docs/linux-surface-qa-checklist.md`.
  CI cannot drive GNOME Shell tabs reliably.

---

## 8. Implementation packets (ship order)

1. Research doc (this file) + Linear plan
2. Linux browser registry + history polling
3. Foreground capture hardening (compositor traces → health)
4. Platform-aware capture health + onboarding honesty
5. Live tab context (history-first)
6. `/proc` background process evidence
7. CI + smoke extensions
8. Surface QA on real X11 + Wayland hardware

Parent issue DEV-96 closes when all packets land and the surface matrix is screenshot-verified on
a real Linux day.

---

## 9. Phase 2 (documented, not v1)

- Browser extension for exact, incognito-aware tab data (ActivityWatch pattern).
- AT-SPI2 native helper for Chromium live URL on X11 if history lag is unacceptable.
- GNOME Shell extension or KDE scriptable API integration for native Wayland titles.
