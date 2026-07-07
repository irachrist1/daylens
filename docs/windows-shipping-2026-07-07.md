# Windows Shipping Audit — 2026-07-07

## What Was Broken

- Windows relied on power events plus the shared poll loop, but had no Windows-specific regression test proving a frozen interval timer cannot stretch a foreground session across sleep.
- Windows private/incognito detection only had the generic title gate. The UIA helper did not emit a structured private signal, so private browser windows could still produce app sessions or tab evidence.
- The Windows 5s foreground poll could fall back to browser History DB reads through `browserContext`, putting synchronous SQLite copies on the hot path.
- Windows browser discovery preferred registry results and skipped static known paths whenever the registry returned anything, so partial registry discovery could hide Chrome, Edge, Brave, Firefox, or Zen profiles.
- UWP windows could be stored as `ApplicationFrameHost.exe` instead of the real package family, which made classification and app identity noisy.
- Windows updater support only checked `process.platform === 'win32'`; unsigned packaged Windows builds could still expose built-in updates.
- The Windows release workflow allowed unsigned packaging when signing secrets were missing, and did not verify that the signer subject matched the updater publisher metadata.

## What Was Fixed

- Added Windows parity coverage for:
  - poll-gap sleep flushes ending at the last completed tick,
  - private-window helper signals producing no app session,
  - UWP package-family identity,
  - Windows browser history rows under `msedge.exe` reconciling to foreground Edge time.
- Added a structured Windows private signal from the native UIA helper. Private windows emit no URL/title payload, are kept only in memory, and are consumed by `tracking.ts` before any app session or site visit is created.
- Broadened helper private detection to every browser family the Windows helper already recognizes, including Firefox forks such as Waterfox, LibreWolf, Pale Moon, and Floorp.
- Removed the Windows `browserContext` foreground-poll fallback to recent History DB reads. History polling stays on the 60s browser-history service.
- Fixed explicit browser-context cutoffs so sleep/idle/away boundaries shorten `website_visits.duration_sec` instead of preserving a later cached `lastSeenAt`.
- Merged registry-discovered Windows browser history locations with static known paths and added Zen Firefox-profile discovery.
- Made UWP foreground sessions store the package family as `bundle_id`, with a cleaner display fallback when the host process is `ApplicationFrameHost`.
- Windows packaged auto-updates now require the running executable to have a valid Authenticode signature.
- Windows release packaging now requires signing secrets, decodes the PFX to `RUNNER_TEMP`, verifies the PFX subject, verifies every produced `.exe` signer, and checks packaged `app-update.yml` pins the same publisher subject.

## Raw SQLite Check

The local database available here is `~/Library/Application Support/DaylensWindows/daylens.sqlite`, but it is not Windows capture data:

- `focus_events.platform`: `darwin` only (`186936` rows).
- Latest app-session day checked: `2026-07-06`.
- Top raw app totals that day were Dia `10863s`, Claude `3709s`, Warp `2795s`, Raycast Beta `1606s`, Figma `1048s`.

Because this machine has no live Windows capture rows, Windows reconciliation was verified with the Windows-specific fixture in `tests/windowsTrackingParity.test.ts`: one minute of foreground Edge plus a five-minute `msedge.exe` history row reconciles to exactly `60s` of site time.

## Still Untested

- Real Windows `WM_POWERBROADCAST` / Electron `powerMonitor` behavior after actual sleep, hibernate, lock, and lid-close. The shared poll-gap guard is now the primary correctness net.
- Native helper private detection against installed Chrome, Edge, Brave, Firefox, Zen, and Firefox forks on a real Windows desktop.
- Authenticode signing and updater install on a real signed Windows build. This Mac does not have `dotnet`, so the Windows helper project was not compiled locally.
- Microsoft Store/UWP identities beyond the Windows Terminal fixture, especially apps whose package family is present but whose display name should come from the manifest.

## Manual Windows Verification

- Build on Windows with `npm run build:capture-helper`, then run the app and confirm `windows-capture-helper.exe` starts.
- Open normal and private/InPrivate windows in Chrome, Edge, Brave, Firefox, and Zen. Private windows must leave zero rows in `app_sessions`, `focus_events`, and `website_visits`.
- Sleep or hibernate for at least two minutes while a browser is foreground. After resume, the pre-sleep session must end at the last pre-sleep tick and the sleep hole must not count as app or site time.
- On a Windows test day, compare foreground browser seconds with reconciled site seconds. Site seconds must never exceed browser session seconds.
- Focus a UWP app such as Windows Terminal, Calculator, Photos, or Store. `app_sessions.bundle_id` should be the package family, not `ApplicationFrameHost.exe`.
- Run the Windows release workflow with a real PFX. Confirm unsigned builds fail, signed builds pass signer-subject checks, and the installed app reports updater support.
