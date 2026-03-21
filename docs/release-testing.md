# Daylens Release Testing Checklist

**Last updated: 2026-03-21 (v1.0.4 macOS / v0.1.4-win Windows)**

---

## macOS — Homebrew Install

```sh
brew tap irachrist1/daylens
brew install --cask daylens
# or reinstall:
brew uninstall --cask daylens && brew update && brew install --cask daylens
```

- [ ] Installs without error
- [ ] No Gatekeeper dialog (quarantine stripped by postflight)
- [ ] App launches from Applications folder
- [ ] App icon appears in Dock (liquid glass blue gradient)
- [ ] App icon appears in Stage Manager (requires 1024px icns — fixed v1.0.4)
- [ ] Menu bar icon matches Dock icon (not a sun symbol — fixed v1.0.4)

## macOS — curl Install

```sh
curl -fsSL https://irachrist1.github.io/daylens/install.sh | sh
```

- [ ] Script completes without error
- [ ] App installed to /Applications/Daylens.app
- [ ] Quarantine stripped — opens without Gatekeeper warning

## macOS — Direct DMG

1. Download `Daylens-{version}.dmg` from GitHub Releases
2. Drag to Applications
3. System Settings → Privacy & Security → Open Anyway

- [ ] DMG mounts correctly
- [ ] Drag-to-Applications works
- [ ] One-time Open Anyway prompt clears Gatekeeper

---

## macOS — First Launch & Onboarding

- [ ] Onboarding flow runs on first launch
- [ ] Accessibility permission prompt appears
- [ ] Full Disk Access prompt appears
- [ ] App moves to menu bar after onboarding completes

## macOS — Tracking

- [ ] Today view shows active app in real time
- [ ] Apps tab updates live while an app is in use
- [ ] Browser history imports for at least one of: Chrome, Arc, Safari, Brave, Edge
- [ ] Website visits appear after 60+ seconds on a domain
- [ ] Session ends correctly when switching apps
- [ ] Idle detection pauses the session timer
- [ ] In-flight session (live frontmost app) visible in Today and Apps views before session ends

## macOS — AI & Data

- [ ] API key saves to Keychain and persists across relaunches
- [ ] AI summary generates for today
- [ ] AI chat responds to usage questions
- [ ] Category override saves and reflects in Today, Apps, and AI summary
- [ ] History view shows all tracked days
- [ ] Focus score reflects category overrides

## macOS — Data Integrity

- [ ] Backup written to `~/Library/Application Support/Daylens/Backups/` on launch
- [ ] Data persists across app restarts
- [ ] Delete All Data in Settings wipes everything
- [ ] Export JSON produces a valid file

## macOS — Edge Cases

- [ ] No internet: AI unavailable message shown, local fallback works
- [ ] Revoked Accessibility permission: graceful degradation
- [ ] Quit and relaunch mid-session: no duplicate sessions

---

## Windows — Install

Download `Daylens-{version}-x64-Setup.exe` or `Daylens-{version}-Portable.exe` from:
`https://github.com/irachrist1/daylens-windows/releases/latest`

- [ ] NSIS installer runs without error
- [ ] App appears in Start menu as "DaylensWindows"
- [ ] Portable exe launches without install
- [ ] App icon visible in taskbar and Start menu
- [ ] userData writes to `%APPDATA%\DaylensWindows` — NOT `%APPDATA%\Daylens`

## Windows — Tracking

- [ ] Active window tracking works (via @paymoapp/active-window)
- [ ] App usage appears in Today view in real time

## Windows — AI

- [ ] API key entry works
- [ ] AI summary generates

---

## Releasing a New macOS Version

1. Increment `MARKETING_VERSION` in `Daylens.xcodeproj` (patch only: `1.0.x`)
2. Add CHANGELOG entry
3. Commit and push to main
4. `git tag v1.0.x && git push origin v1.0.x`
5. Wait for Actions build to complete: `gh run list --repo irachrist1/daylens --limit 3`
6. Get SHA256: `curl -sL https://github.com/irachrist1/daylens/releases/download/v1.0.x/Daylens-1.0.x.dmg.sha256`
7. Update `homebrew-daylens/Casks/daylens.rb` version + sha256, push to master on that repo
8. Update `website/index.html` direct DMG link if hardcoded (prefer `/releases/latest/download/` to avoid this)

## Releasing a New Windows Version

1. Bump version in `daylens-windows/package.json`
2. Commit and push to main on `irachrist1/daylens-windows`
3. `git tag v0.x.y-win && git push origin v0.x.y-win`
4. Actions builds NSIS installer + portable exe — no cask update needed (site uses `/releases/latest`)
