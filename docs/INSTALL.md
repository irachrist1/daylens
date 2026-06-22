# Installing Daylens

Daylens ships installable builds for macOS, Windows, and Linux.

## Windows

1. Download `Daylens-<version>-Setup.exe` from the [GitHub Releases](https://github.com/irachrist1/daylens/releases) page or the in-app updater.
2. Run the installer. Daylens installs per-user and adds a Start Menu shortcut.
3. Launch **Daylens** from the Start Menu.

### SmartScreen warning

Unsigned preview builds may show a Windows SmartScreen warning. Choose **More info → Run anyway** for local testing, or install a signed release build when signing secrets are configured in CI.

### Data location

Your local database and settings live under:

`%APPDATA%\Daylens\`

Nothing leaves your machine unless you connect an AI provider and ask Daylens to use it.

## macOS

Download the `.zip` or `.dmg` from Releases, open the app, and grant **Accessibility** (and **Screen Recording** when prompted) so Daylens can read window titles.

## Linux

Use the AppImage, `.deb`, or `.rpm` from Releases. See `CONTRIBUTING.md` for distro dependencies.

## Updating

Packaged builds check for updates on launch when `electron-updater` is enabled. Dev builds (`npm start`) do not auto-update — pull from git instead.
