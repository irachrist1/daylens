# Daylens V1 Release Testing Checklist

## Install & First Launch

- [ ] DMG mounts correctly, drag-to-Applications works
- [ ] Right-click -> Open bypasses Gatekeeper successfully
- [ ] Onboarding flow runs on first launch
- [ ] Accessibility permission prompt appears and works
- [ ] Full Disk Access permission prompt appears and works
- [ ] App appears in menu bar after onboarding

## Tracking

- [ ] Today view shows active app in real time
- [ ] Apps tab updates live while an app is in use
- [ ] Browser history imports for Chrome, Arc, Safari, Brave, Edge
- [ ] Website visits appear after more than 60 seconds on a domain
- [ ] Session ends correctly when switching apps
- [ ] Idle detection stops the session timer

## AI & Data

- [ ] API key saves to Keychain and persists across relaunches
- [ ] AI summary generates for today
- [ ] AI chat responds to questions about usage
- [ ] Category override saves and reflects in Today, Apps, and AI summary
- [ ] History view shows all tracked days
- [ ] Focus score reflects user overrides

## Data Integrity

- [ ] Backup file created in `~/Library/Application Support/Daylens/Backups/` on launch
- [ ] Data persists across app restarts
- [ ] Delete All Data in Settings wipes everything
- [ ] Export to JSON produces a valid file

## Edge Cases

- [ ] App handles no internet connection gracefully (AI unavailable, local fallback shown)
- [ ] App handles revoked Accessibility permission gracefully
- [ ] Quitting and relaunching mid-session does not duplicate sessions
