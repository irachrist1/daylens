# Daylens

[![License: MIT](https://img.shields.io/badge/License-MIT-111111.svg?style=flat-square)](LICENSE)
[![macOS 14+](https://img.shields.io/badge/macOS-14%2B-111111.svg?style=flat-square)](https://support.apple.com/macos)
[![Windows 10+](https://img.shields.io/badge/Windows-10%2B-111111.svg?style=flat-square)](https://github.com/irachrist1/daylens-windows/releases)
[![Download](https://img.shields.io/badge/Download-GitHub%20Releases-111111?style=for-the-badge)](https://github.com/irachrist1/daylens/releases)

Your personal activity analyst for macOS and Windows.

<!-- TODO: Add a real screenshot here. Recommended: take a screenshot of the Today view at 1440×900, save as website/assets/screenshot-today.png and replace this line with: ![Daylens Today dashboard](website/assets/screenshot-today.png) -->

Daylens watches the apps, browsers, and websites you use throughout the day, then turns that activity into grounded AI insight. It is local-first, privacy-forward, and designed to feel like a calm product companion rather than a dashboard full of noise.

- **macOS**: Native SwiftUI app (macOS 14 Sonoma+)
- **Windows**: Electron + React app (Windows 10+)

## Why Daylens

- Local-first tracking for apps, windows, and website activity
- AI-powered daily and weekly reports plus chat grounded in your actual usage history
- Multi-browser support for Chrome, Arc, Safari, Brave, Edge, and Firefox
- Focus scoring, planned focus blocks, notification nudges, category overrides, and JSON export

## Install

### macOS — Homebrew (recommended)

```sh
brew tap irachrist1/daylens
brew install --cask daylens
```

Then open Daylens from your Applications folder or Launchpad.

### macOS — Direct download

1. Open the latest [GitHub Release](https://github.com/irachrist1/daylens/releases/latest) and download the current `Daylens-*.dmg`.
2. Drag `Daylens.app` into `Applications`.
3. On first launch, go to **System Settings → Privacy & Security → Open Anyway**.

> **Note:** The direct download requires a one-time approval step because the app is distributed without a paid Apple Developer certificate. Homebrew handles this automatically.

### Windows — Installer

1. Download the latest `Daylens-*-Setup.exe` from [Windows Releases](https://github.com/irachrist1/daylens-windows/releases/latest).
2. Run the installer and follow the prompts.
3. Launch Daylens from the Start menu.

A portable `.exe` (no install required) is also available on the releases page.

## System Requirements

### macOS
- macOS 14 Sonoma or later
- Accessibility permission for active app and window tracking
- Full Disk Access for browser history import from local browser databases

### Windows
- Windows 10 or later (64-bit)
- Internet connection only when you want AI summaries or chat (Claude API key)

## Permissions

### Accessibility

Daylens uses Accessibility to understand which app is frontmost, detect window changes, and improve browser URL/page-title attribution when macOS allows it.

### Full Disk Access

Daylens reads browser history databases stored on your Mac to recover website visits across supported browsers. This data stays local unless you explicitly ask the AI features to analyze it with your configured provider.

## Keyboard Shortcuts

- `Cmd` + `[` moves to the previous day
- `Cmd` + `]` moves to the next day
- `Cmd` + `T` jumps back to today
- `Shift` + `Cmd` + `P` toggles tracking

## What’s New in 1.0.21

- Rebuilt Focus tab with drag-to-plan focus blocks, inline editing, and a persistent “what are you working on?” intent bar
- Weekly report generation with optional AI enhancement and a split-detail Reports view
- Notification controls for daily digests, context-switch nudges, and test notifications
- Richer profile setup/editing with multi-select roles, more goal presets, and a reset option that preserves tracked activity

## FAQ

### Is Daylens private?

Yes. Daylens is local-first by design. It does not include telemetry, analytics, or cloud sync.

### Where is my data stored?

All tracking data is stored on your Mac in `~/Library/Application Support/Daylens/`.

### Where is my API key stored?

In the macOS Keychain only. Daylens does not store API keys in `UserDefaults`.

### Why do I need to right-click -> Open the first time?

The release is ad-hoc signed so anyone can install it without a paid Apple Developer account. Gatekeeper requires a manual `Open` once before it will trust the app on that Mac.

### Can I delete my data?

Yes. Daylens includes a delete-all-data flow in Settings and also writes rolling backups on launch.

## Website

The marketing site is live at [irachrist1.github.io/daylens](https://irachrist1.github.io/daylens). It deploys automatically from the `website/` directory on push to `main` via GitHub Pages (Actions source). To enable it for the first time, go to **repo Settings → Pages → Source: GitHub Actions → Save**.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for local build steps, branch naming, PR expectations, and the Greptile review workflow.

## License

Daylens is open source under the [MIT License](LICENSE).
