# Installation and releases

## Run from source

Daylens requires Node.js 20 or newer and native build tools for `better-sqlite3`, active-window capture, and keychain access.

- macOS: Xcode Command Line Tools
- Windows: Visual Studio Build Tools with the Desktop development with C++ workload
- Linux: `build-essential` and `libsecret-1-dev`

From the repository root:

```bash
npm install
npm start
```

The postinstall script rebuilds native modules for the bundled Electron runtime.

## Install a release

On Apple Silicon macOS:

```bash
brew tap irachrist1/daylens
brew install --cask daylens
```

The cask definition lives at `Casks/daylens.rb`.

Packaged builds are also available from [GitHub Releases](https://github.com/irachrist1/daylens/releases/latest).

### macOS

Open the downloaded ZIP or DMG, move Daylens to Applications, and grant the requested Accessibility permission. Grant additional permissions only when the corresponding capture feature explains why it needs them.

### Windows

Run the per-user `Daylens-<version>-Setup.exe`. Preview builds without a configured certificate may trigger SmartScreen. Production releases must be signed according to [Windows signing](windows-signing.md).

Local data and settings live under `%APPDATA%\Daylens\`.

### Linux

Use the AppImage, DEB, or RPM produced by the release workflow. Linux capture parity must be described according to what has been verified on a real machine.

## Build packages locally

```bash
npm run build:all
npm run dist:mac
npm run dist:win
npm run dist:linux
```

Use the command for the current platform and required artifact. Local packaging does not prove signing, updater, or release-workflow behavior.

## Updates

Packaged builds use the updater when the platform and release are configured for it. Development builds do not update themselves; pull the repository and restart instead.

On macOS the update path depends on how the running build is signed: Developer-ID-signed builds use electron-updater (Squirrel.Mac verifies the downloaded bundle before installing), while ad-hoc builds use the public update feed with a checksum-verified bundle swap. Signing and notarization setup for releases is documented in [macos-signing.md](macos-signing.md); Windows signing in [windows-signing.md](windows-signing.md).

Release claims should describe only artifacts that were built, signed where required, published, and verified on the target platform.
