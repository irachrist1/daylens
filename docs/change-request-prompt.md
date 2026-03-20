# Daylens — Change Request Boilerplate

Copy and paste the block below at the top of every change request you send to any AI agent working on this codebase.

---

```
Before touching any code, read CLAUDE.md (or AGENTS.md if you are not Claude Code) in full.
These files contain permanent prohibitions derived from real data loss events. They are not optional.

The absolute prohibitions are:
1. Never add or suggest `eraseDatabaseOnSchemaChange = true` — anywhere, ever, including #if DEBUG.
2. Never run `sqlite3` CLI against the live database while the app is running.
3. The macOS app and the Electron Windows app must NEVER share a support directory.
   The Electron app uses productName "DaylensWindows" and writes to ~/Library/Application Support/DaylensWindows/.
   Never change productName back to "Daylens" and never revert the app.setPath() call.
4. Never launch a Daylens binary from the wrong DerivedData or wrong branch.
   Always build and run through Xcode on the correct branch.
   Current development branch: codex/functional-pass-chromatic-sanctuary
5. Never touch onboarding persistence: AppState.swift, Constants.DefaultsKey onboarding keys, DaylensApp.swift.
6. Never add kSecUseDataProtectionKeychain: true to KeychainService.swift.

Architecture reminders:
- All schema changes must be additive migrations in AppDatabase.migrator — never modify existing migrations.
- All DB queries must pass category overrides: appUsageSummaries(…overrides:) and meaningfulAppSessions(…overrides:).
- All DB calls must use Task.detached(priority:) — never call dbQueue.read/write on the main actor.
- AI context (aiContextPayload) must pass category overrides so AI sees user-corrected categories.
- In-flight session is exposed via ActivityTracker.currentSessionInfo — inject via injectLiveSession in TodayViewModel and AppsViewModel.

Now here is my change request:
```

---

## What to put after the boilerplate

Describe your change clearly after the last line. Include:
- What you want to add, fix, or change (be specific about which view/file/feature)
- What the current behavior is (if a bug)
- What the expected behavior should be
- Any constraints or things you do NOT want changed

## Example

```
[paste boilerplate above]

Now here is my change request:

In the Today view, the Focus Score card is showing "—" even when there is data.
The issue is that focusScoreText returns "—" when pct == 0 but the actual ratio
is 0.42 (42%). Fix the threshold so "—" only shows when there is truly no data
(total == 0), not when the computed ratio rounds to 0%.

Do not change any other cards or the focusScoreRatio computation.
```
