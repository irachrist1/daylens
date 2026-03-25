# Daylens macOS — Release Testing Checklist

**Last updated: 2026-03-25 (v1.0.19)**

> Windows testing checklist is in `irachrist1/daylens-windows` repo.

---

## Install Methods

### Homebrew (recommended)
```sh
brew tap irachrist1/daylens
brew install --cask daylens
# reinstall:
brew uninstall --cask daylens && brew update && brew install --cask daylens
```
- [ ] Installs without error
- [ ] No Gatekeeper dialog (quarantine stripped automatically)
- [ ] App launches from Applications folder

### curl
```sh
curl -fsSL https://irachrist1.github.io/daylens/install.sh | sh
```
- [ ] Script completes without error
- [ ] App installed to `/Applications/Daylens.app`
- [ ] Opens without Gatekeeper warning

### Direct DMG
1. Download `Daylens-{version}.dmg` from GitHub Releases
2. Drag to Applications
3. System Settings → Privacy & Security → Open Anyway
- [ ] DMG mounts correctly
- [ ] One-time Open Anyway clears Gatekeeper

---

## First Launch & Onboarding

- [ ] Onboarding flow runs on first launch
- [ ] Accessibility permission prompt appears and works
- [ ] Full Disk Access prompt appears and works
- [ ] App appears in menu bar after onboarding

---

## Icon Checks

- [ ] Dock icon: liquid glass blue gradient (not a placeholder)
- [ ] Stage Manager: icon appears (not a blank square) — regression check for v1.0.4 fix
- [ ] Menu bar: matches Dock icon (not a sun symbol) — regression check for v1.0.4 fix

---

## Tracking

- [ ] Today view shows active app in real time
- [ ] Apps tab updates live while an app is in use
- [ ] Browser history imports for at least one browser (Chrome, Arc, Safari, Brave, Edge)
- [ ] Website visits appear after 60+ seconds on a domain
- [ ] Session ends correctly when switching apps
- [ ] Idle detection pauses the session timer
- [ ] In-flight session visible in Today and Apps before session ends
- [ ] Fullscreen video playback stays tracked in the owning app/browser instead of dropping the session during the Space transition
- [ ] Fullscreen browser playback keeps the active website/domain attributed after the address bar disappears

---

## AI & Data

- [ ] API key saves to Keychain and persists across relaunches
- [ ] AI summary generates for today
- [ ] AI chat responds to usage questions
- [ ] Category override saves and reflects in Today, Apps, and AI summary
- [ ] Focus score reflects category overrides
- [ ] History view shows all tracked days

---

## Data Integrity

- [ ] Backup written to `~/Library/Application Support/Daylens/Backups/` on launch
- [ ] Data persists across app restarts
- [ ] Delete All Data in Settings wipes everything
- [ ] Export JSON produces a valid file

---

## Edge Cases

- [ ] No internet: AI unavailable message shown, local fallback works
- [ ] Revoked Accessibility permission: graceful degradation
- [ ] Quit and relaunch mid-session: no duplicate sessions
- [ ] Update banner reveals the hover-only "What's new" control and the release-notes popover opens with the current changelog excerpt
