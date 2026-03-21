# Daylens

[![License: MIT](https://img.shields.io/badge/License-MIT-111111.svg?style=flat-square)](LICENSE)
[![macOS 14+](https://img.shields.io/badge/macOS-14%2B-111111.svg?style=flat-square)](https://support.apple.com/macos)
[![Download](https://img.shields.io/badge/Download-GitHub%20Releases-111111?style=for-the-badge)](https://github.com/irachrist1/daylens/releases)

Your personal activity analyst for macOS.

<!-- TODO: Add a real screenshot here. Recommended: take a screenshot of the Today view at 1440×900, save as website/assets/screenshot-today.png and replace this line with: ![Daylens Today dashboard](website/assets/screenshot-today.png) -->

Daylens is a native macOS app that watches the apps, browsers, and websites you use throughout the day, then turns that activity into grounded AI insight. It is local-first, privacy-forward, and designed to feel like a calm product companion rather than a dashboard full of noise.

## Why Daylens

- Local-first tracking for apps, windows, and website activity
- AI-powered daily summaries and chat grounded in your actual usage history
- Native SwiftUI interface built for macOS 14 Sonoma and later
- Multi-browser support for Chrome, Arc, Safari, Brave, Edge, and Firefox
- Focus scoring, history review, category overrides, and JSON export

## Download

Download the latest DMG from [GitHub Releases](https://github.com/irachrist1/daylens/releases), then:

1. Open `Daylens-1.0.0.dmg`
2. Drag `Daylens.app` into `Applications`
3. Open Daylens from `Applications`
4. On first launch, use `right-click -> Open` to bypass Gatekeeper for the ad-hoc signed build

Daylens is currently distributed without a paid Apple Developer certificate, so macOS will block the first double-click launch. After the first `Open`, future launches work normally.

## System Requirements

- macOS 14 Sonoma or later
- Accessibility permission for active app and window tracking
- Full Disk Access for browser history import from local browser databases
- Internet connection only when you want cloud AI summaries or chat

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

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for local build steps, branch naming, PR expectations, and the Greptile review workflow.

## License

Daylens is open source under the [MIT License](LICENSE).
