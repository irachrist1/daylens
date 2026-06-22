# Linux surface QA checklist

Manual verification for [DEV-96](https://linear.app/irachrist1/issue/DEV-96). Run on **real hardware** with a packaged build (AppImage or deb). CI smoke proves packaging only — this checklist proves the product.

Capture research: [`docs/research/linux-capture.md`](research/linux-capture.md).

---

## Environments

Run the full matrix on at least:

1. **X11** — e.g. Xfce, i3, or Ubuntu/Xorg session
2. **Wayland** — GNOME or KDE Plasma (default on Fedora/Ubuntu 24.04+)

Optional bonus: **Hyprland** or **Sway** (compositor-specific backends).

For each environment, install **Chrome or Chromium** and **Firefox** (or Zen). Browse for 5+ minutes before checking Apps.

---

## Checklist

| # | Surface | What to verify | X11 | Wayland | Notes |
|---|---------|----------------|-----|---------|-------|
| 1 | **Launch** | AppImage/deb starts; tray icon; no crash on open | ☐ | ☐ | |
| 2 | **Capture health** | Settings → Capture health shows Linux session row, window-title samples, browsers discovered | ☐ | ☐ | Wayland may show Limited — must be honest |
| 3 | **Foreground** | Switch apps; Timeline/live block shows app name + window title | ☐ | ☐ | |
| 4 | **Browser history** | Browse 3+ sites; Apps shows domains under correct browser | ☐ | ☐ | |
| 5 | **Timeline** | ~8 believable blocks after Analyze; proportional heights | ☐ | ☐ | |
| 6 | **Apps** | Real app names; per-browser domains; deduped pages | ☐ | ☐ | |
| 7 | **AI** | “What did I work on today?” grounded in captured day | ☐ | ☐ | Needs provider connected |
| 8 | **Settings** | Relabel app → propagates; exclusion hides from AI | ☐ | ☐ | |
| 9 | **Onboarding** | Proof step shows real activity or honest Linux limitation | ☐ | ☐ | |
| 10 | **Background work** | Long build/render while in another app → block evidence mentions it (not CPU UI) | ☐ | ☐ | Optional |
| 11 | **Briefs/wraps** | Morning brief / weekly wrap | ☐ | ☐ | Blocked until DEV-91 |

---

## Evidence to attach (Linear DEV-96)

For each environment:

- Screenshot: Capture health panel
- Screenshot: Timeline with named blocks
- Screenshot: Apps view with browser domains
- Screenshot: AI answer (if provider connected)
- One sentence: session type (`echo $XDG_SESSION_TYPE`), desktop (`echo $XDG_CURRENT_DESKTOP`)

---

## Known limitations (v1)

- **Native Wayland** (GNOME/KDE without XWayland): focused-window capture may be partial; capture health must say so.
- **Live tab URL**: history inference first; Firefox/Zen never get live URL via OS APIs.
- **Phase 2**: browser extension for exact tab data across all browsers.
