# Daylens macOS — Release Testing Checklist

**Last updated: 2026-03-27 (v1.0.22)**

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
- [ ] Settings → Usage Totals lets you switch between `Active Use` and `All Activity`
- [ ] Today, History, Apps, and the menu bar all update totals consistently after changing the usage-counting preference
- [ ] Website totals remain cumulative by domain when switching tabs/pages and Browser Groups matches the same totals per browser
- [ ] Launching a second Daylens instance shows a tracking warning instead of silently writing duplicate sessions

## Focus Planning & Reports

- [ ] Focus tab shows the saved intent bar and starts a focus session with the selected duration
- [ ] Dragging across future hours creates a planned focus slot with the expected snapped duration
- [ ] Planned focus slots can be edited and deleted inline without breaking the rest of the day view
- [ ] Reports view can generate both today's report and this week's report
- [ ] Selecting a report shows the detail panel and AI enhancement still works

## Notifications & Profile

- [ ] Daily Digest toggle requests permission, schedules the 6 PM notification, and removes it when toggled off
- [ ] Focus Nudge can be enabled without immediately firing noisy alerts
- [ ] Send Test Notification delivers a local notification
- [ ] Profile setup/editing supports multi-select roles, up to 3 goals, distraction presets, and ideal-day suggestions
- [ ] Reset Profile clears profile/memory data but preserves activity history

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
