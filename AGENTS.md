# AGENTS.md

## Overview

Activity Analyst is a **macOS-native Swift/SwiftUI desktop app** for personal activity intelligence. See `README.md` for full architecture, setup, and usage docs.

## Cursor Cloud specific instructions

### Platform constraints

This is a macOS-native app (Swift 5.9+ / SwiftUI / AppKit / GRDB.swift / SQLite). The full app **cannot be built or run on Linux** — it requires macOS 14+ and Xcode 15+. However, the **core library** (`ActivityAnalystCore` SPM target) and its **unit tests** compile and run on Linux.

### Building and testing on Linux

Swift 6.0.3 is installed at `/opt/swift/usr/bin`. It is already on `PATH` via `~/.bashrc`.

SQLite with `SQLITE_ENABLE_SNAPSHOT` is installed at `/usr/local` (required by GRDB.swift). You must pass linker/compiler flags when building or testing:

```bash
swift build -Xlinker -L/usr/local/lib -Xlinker -rpath -Xlinker /usr/local/lib -Xcc -I/usr/local/include
swift test  -Xlinker -L/usr/local/lib -Xlinker -rpath -Xlinker /usr/local/lib -Xcc -I/usr/local/include
```

### Package.swift Linux adaptations

The SPM `ActivityAnalystCore` target excludes macOS-only code (`Services/Capture`, `Services/Privacy/PermissionManager.swift`, `Services/Privacy/DataExporter.swift`, and `ViewModels/`) since those depend on Combine/SwiftUI/AppKit. `AIAnalyst.swift` conditionally imports `FoundationNetworking` for Linux URL networking support.

### Linting

`swift-format` ships with the installed Swift toolchain:

```bash
swift-format lint --recursive ActivityAnalyst/ Tests/
```

Warnings are expected — the codebase uses 2-space indentation while `swift-format` defaults to 4-space.

### Browser extensions

Chrome and Safari extensions are plain JS with no build step. Validate syntax with:

```bash
node --check Extensions/Chrome/background.js
node --check Extensions/Chrome/popup.js
```

### What tests cover

75 unit tests covering: SessionNormalizer, EventDebouncer, TrackingRules, PrivacyFilter, DurationFormatter, AI prompt construction, and DailySummaryBuilder. UI, capture services, and database integration are not testable on Linux.
