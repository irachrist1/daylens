# Platform shipping (Windows & Linux)

Last updated: 2026-05-28

Single source of truth for shipping the current macOS-good codebase on **Windows** and **Linux**. This track is separate from V1 UX/performance work in [STATUS.md](./STATUS.md).

Daylens is **in active development**. Treat this doc as a living plan: read what is already proven, pick **one** open item from the queue, implement or validate it, then update this file before moving on. Do not assume earlier agent claims are true — verify in code and CI.

**Branch discipline:** See [README.md § Branch & repo](./README.md#branch--repo-required--read-before-every-session). Platform shipping CI must run on the same branch and remote (`v1` → `irachrist1/daylens-v1`) where your commits live. Record branch + SHA in [Validation state](#validation-state).

### Active branch (platform shipping)

| Field | Value |
|---|---|
| Remote | `v1` → `github.com/irachrist1/daylens-v1` |
| Branch | `main` |
| Last CI commit | `04f8b33c765e717b8ebf895324b95b35fa8229c2` |
| Last CI run | [Preview Builds 26581189022](https://github.com/irachrist1/daylens-v1/actions/runs/26581189022) and [Verify Linux Runtime 26581168639](https://github.com/irachrist1/daylens-v1/actions/runs/26581168639) — green on `main` |

---

## How to work (agents)

1. Read this file end-to-end, then skim [../AGENTS.md](../AGENTS.md) for product/build constraints.
2. Pick the **first unchecked item** in [Work queue](#work-queue). Only one item per session unless the user asks for more.
3. Investigate in the repo (config, workflows, platform code) before changing anything.
4. Make the smallest change that resolves the item. Prefer fixing code over adding docs-only claims.
5. Run `npm run typecheck` after code changes. Run relevant tests if they exist.
6. Update sections below: **Fix log**, **Work queue**, and **Validation state**. Mark claims as `code-proven`, `CI-proven`, `tested`, or `not validated`.
7. Do **not** mark platform shipping “done” from typecheck alone. Packaging and smoke tests count.

**Out of scope for this track:** Timeline/Apps/Settings/Insights UX fixes — see [STATUS.md](./STATUS.md).

---

## Work queue

Check off items here as they are completed. Re-order only if a dependency forces it.

| ID | Item | Status | Notes |
|---|---|---|---|
| SH-1 | Native module verify/repair covers all three unpacked natives | ✅ CI-proven | Fix 1 below. Preview Builds run 26581189022 passed `verify-packaged-natives.js` on macOS, Windows, and Linux. |
| SH-2 | Windows in-app updater uses electron-updater `quitAndInstall` | ✅ implemented | Fix 2 below. Pending packaged Windows proof. |
| SH-3 | `preview-builds.yml` green on mac/win/linux with updated native checks | ✅ CI-proven | `workflow_dispatch` run [26581189022](https://github.com/irachrist1/daylens-v1/actions/runs/26581189022) on `main` / `04f8b33`: mac, win, and linux all green. Includes `verify-packaged-natives.js` per platform. |
| SH-4 | `verify-linux-runtime.yml` green (AppImage + DEB + RPM smoke) | ✅ CI-proven | Run [26581168639](https://github.com/irachrist1/daylens-v1/actions/runs/26581168639) on `main` / `04f8b33`: AppImage + DEB + RPM smoke all green on hosted Ubuntu runner. |
| SH-5 | Confirm `latest.yml` / `latest-linux.yml` emitted in preview/release artifacts | ✅ CI-proven | Run [26581189022](https://github.com/irachrist1/daylens-v1/actions/runs/26581189022) "Verify preview update metadata" step asserts `dist-release/latest.yml` (win) and `dist-release/latest-linux.yml` (linux) exist; both are uploaded in `daylens-preview-windows` / `daylens-preview-linux` artifacts. |
| SH-6 | Windows smoke test in CI (launch packaged `.exe`, basic health) | ⬜ not started | Linux has smoke infra; Windows has none today. Design minimal headless or scripted launch check. |
| SH-7 | Manual Windows VM validation checklist | ⬜ not started | Install NSIS build, launch, tray, tracking, updater dry-run. Document SmartScreen bypass steps for testers. |
| SH-8 | Manual Linux desktop validation checklist | ⬜ not started | AppImage + DEB on real Ubuntu; tray/autostart/keyring spot-check. |
| SH-9 | Unsigned preview release (`v*-win`, `v*-linux` tags) | ⬜ in progress | Cutting `v1.0.36-preview.1` from `main`. |
| SH-10 | Windows Authenticode signing secrets | ⬜ not provisioned | Optional until external users; see signing blockers below. |

**Current next step:** **SH-9** — cut unsigned preview release tag.

---

## Validation state

| Check | Result | Date |
|---|---|---|
| `npm run typecheck` | ✅ passed | 2026-05-28 |
| `tests/updaterReleaseFeed.test.ts` | ✅ passed (7 tests) | 2026-05-28 |
| Native scripts syntax (`node -c`) | ✅ passed | 2026-05-28 |
| `preview-builds.yml` all platforms | ✅ mac+win+linux green on `main` / `04f8b33` ([run 26581189022](https://github.com/irachrist1/daylens-v1/actions/runs/26581189022)) | 2026-05-28 |
| `verify-linux-runtime.yml` | ✅ green on `main` / `04f8b33` ([run 26581168639](https://github.com/irachrist1/daylens-v1/actions/runs/26581168639)) | 2026-05-28 |
| Packaged app on real Windows | ⬜ not validated | — |
| Packaged app on real Linux desktop | ⬜ not validated | — |
| In-app update end-to-end (Win/Linux) | ⬜ not validated | — |

---

## Fix log

### Fix 1: Native module verification gap (2026-05-28) — SH-1

**Problem:** `asarUnpack` lists three native modules (`better-sqlite3`, `@paymoapp/active-window`, `keytar`), but `verify-packaged-natives.js` only checked SQLite and `afterPack-native-modules.js` only repaired SQLite + transitive deps. Missing tracking or keytar bindings → launch crash with no CI failure.

**Change:**

- `scripts/verify-packaged-natives.js` — verifies all three `.node` bindings and JS entry points
- `scripts/afterPack-native-modules.js` — copies `@paymoapp/active-window` and `keytar` alongside `better-sqlite3`

**Proven:** scripts parse; typecheck passes; layout matches local `node_modules`; macOS, Windows, and Linux CI packages passed `verify-packaged-natives.js` in Preview Builds run 26581189022.

**Not proven:** real-machine launch on macOS/Windows/Linux outside CI packaging.

---

### Fix 2: Windows in-app updater (2026-05-28) — SH-2

**Problem:** Windows had a custom PowerShell install path (`performWindowsInstall`, `scheduleWindowsInstaller`) that:

1. Required `_pendingRemoteUpdate`, which is only populated on macOS’s remote feed — Windows uses `electron-updater` (`usesRemoteUpdateFeed()` is `darwin` only).
2. Blocked install unless `status === 'available'`, but after download `electron-updater` sets `status === 'downloaded'`.

Result: Windows in-app updates could not complete.

**Change:**

- Removed PowerShell helpers and the `win32` branch in `'update:install'`
- Windows now falls through to `autoUpdater.quitAndInstall()` like the standard NSIS path

**Proven:** code-proven; typecheck passes; `updaterReleaseFeed.test.ts` passes.

**Not proven:** packaged Windows binary performing `quitAndInstall` on a real machine (needs SH-7).

---

### Validation attempt: Preview Builds (2026-05-28) — SH-3

**Action:** Pushed scoped CI branch `codex/platform-shipping-sh3` at `a03ee30` to `irachrist1/daylens-v1` and manually triggered `preview-builds.yml` via `workflow_dispatch` (run 26576220347).

**Proven:** Windows Preview job passed on CI, including dependency install, Electron native rebuild, typecheck, bundle build, NSIS packaging, `verify-packaged-natives.js`, and artifact upload.

**Not proven:** macOS and Linux Preview jobs remained queued on Blacksmith runners during this session. SH-3 is therefore not complete yet.

---

### Validation pass: 2026-05-28 — SH-3/4/5 closed

**Action:** Merged platform CI fixes onto `main` (commit `c8bd80a`: switch matrix to GitHub-hosted runners; commit `04f8b33`: add `latest*.yml` existence assertion). Triggered `preview-builds.yml` via `workflow_dispatch` (run [26581189022](https://github.com/irachrist1/daylens-v1/actions/runs/26581189022)) and used the push-triggered `verify-linux-runtime.yml` (run [26581168639](https://github.com/irachrist1/daylens-v1/actions/runs/26581168639)) against `main`.

**Proven (SH-3):** All three preview jobs green on `main` / `04f8b33`. Each ran dependency install, Electron native rebuild, typecheck, Vite build, electron-builder packaging, and `verify-packaged-natives.js`.

**Proven (SH-4):** `verify-linux-runtime.yml` run 26581168639 green on hosted Ubuntu runner — AppImage + DEB + RPM smoke complete.

**Proven (SH-5):** Run 26581189022 "Verify preview update metadata" step asserts the existence of `dist-release/latest.yml` (Windows) and `dist-release/latest-linux.yml` (Linux). The same run uploaded `daylens-preview-windows` and `daylens-preview-linux` artifacts containing those metadata files.

---

## What is code-proven

Verified by reading the source tree. Does **not** imply runtime or CI validation.

| Area | Evidence |
|---|---|
| Windows NSIS target (x64) | `electron-builder.config.js` — `target: 'nsis'`, artifact `Daylens-${version}-Setup.${ext}` |
| Linux targets (AppImage, deb, rpm, tar.gz) | `electron-builder.config.js` L34–67 |
| Icons | `build/icon.ico`, `build/icon.png` |
| GitHub publish provider | `electron-builder.config.js` — `provider: 'github'`, repo `irachrist1/daylens` |
| Windows signing env-conditional | `electron-builder.config.js` — `WIN_CERTIFICATE_*` secrets |
| Three natives in `asarUnpack` | `better-sqlite3`, `@paymoapp/active-window`, `keytar` |
| Native verify/repair scripts (all three) | `scripts/verify-packaged-natives.js`, `scripts/afterPack-native-modules.js` |
| Updater: macOS remote feed; Win/Linux electron-updater | `updater.ts` — `usesRemoteUpdateFeed()` → `darwin` only |
| Updater: Windows/Linux install via `quitAndInstall` | `updater.ts` — `'update:install'` handler (post Fix 2) |
| Linux package detection, autostart, diagnostics | `linuxDesktop.ts` |
| Linux smoke infra | `scripts/verify-linux-smoke.js`, main-process smoke report in `src/main/index.ts` |
| `@paymoapp/active-window` cross-platform dep | `package.json` |
| Non-macOS tracking permission auto-grant | `trackingPermissions.ts` |

---

## CI workflows

| Workflow | Purpose |
|---|---|
| `preview-builds.yml` | Package mac/win/linux; run `verify-packaged-natives.js`; verify Win/Linux update metadata |
| `verify-linux-runtime.yml` | Linux packages + AppImage/DEB/RPM smoke tests |
| `release-windows.yml` | NSIS release + optional signing + `latest.yml` |
| `release-linux.yml` | Linux artifacts + smoke + `latest-linux.yml` |
| `release-macos.yml` | DMG/ZIP + mac feed |
| `release-windows-store.yml` | AppX (Partner Center not provisioned) |

**Tag convention:** `v*-win`, `v*-mac`, `v*-linux` per platform; bare `v*` for shared release metadata.

**Observed tags:** `v1.0.35-mac`, `v1.0.35-linux` exist; no matching `v1.0.35-win` at time of audit.

---

## Real-machine validation still needed

### Windows

| Area | Risk |
|---|---|
| NSIS install + first launch | Medium |
| `@paymoapp/active-window` loads | High |
| Keytar / Credential Manager | Medium |
| Tray, launch-on-login | Low |
| `autoUpdater` finds `latest.yml` | Medium |
| `quitAndInstall` after download | Medium (SmartScreen if unsigned) |
| Browser evidence (Chrome/Edge/Firefox) | Medium — `browser.ts` `windowsBrowsers()` |

### Linux

| Area | Risk |
|---|---|
| AppImage / DEB / RPM install | Lower if SH-4 smoke passes |
| Tray on GNOME/KDE | Medium |
| Keytar / libsecret (gnome-keyring/kwallet) | Medium |
| AppImage in-app update | High — never validated E2E |
| DEB/RPM in-app update (pkexec/sudo) | High |

---

## Signing & distribution blockers

### Windows / SmartScreen

| Blocker | Status |
|---|---|
| Authenticode certificate | Not provisioned (`release-windows.yml` secrets empty) |
| Unsigned SmartScreen warning | Expected for preview builds |
| EV cert instant trust | Not available |
| Microsoft Store / AppX | Workflow exists; identity not provisioned |

**Recommendation:** Ship unsigned NSIS preview first; document “More info → Run anyway” for testers. Add OV signing before broad external distribution.

### Linux

| Blocker | Status |
|---|---|
| AppImage / deb / rpm packaging | CI-proven in run 26581168639 |
| Package-manager updates (deb/rpm) | Code-ready; needs pkexec; not validated E2E |
| GPG repo signing | Not implemented (optional for direct downloads) |

---

## Update-path risks

| Risk | Severity |
|---|---|
| `latest.yml` / `latest-linux.yml` must land on the same GitHub Release as installers | High |
| Do not change `appId` (`com.daylens.desktop`) | Critical |
| macOS remote feed vs Win/Linux electron-updater are independent | Medium |
| Unsigned → signed Windows transition may affect updater trust | Medium |
| No Windows smoke test in any workflow today | Medium — SH-6 |

---

## Key files

| File | Role |
|---|---|
| `electron-builder.config.js` | Targets, asarUnpack, signing, publish |
| `src/main/services/updater.ts` | Auto-update logic (Fix 2) |
| `src/main/services/linuxDesktop.ts` | Linux package + desktop integration |
| `scripts/verify-packaged-natives.js` | Post-pack native layout check (Fix 1) |
| `scripts/afterPack-native-modules.js` | afterPack repair (Fix 1) |
| `scripts/verify-linux-smoke.js` | Linux packaged smoke verifier |
| `.github/workflows/preview-builds.yml` | First CI gate (SH-3) |
| `.github/workflows/verify-linux-runtime.yml` | Linux smoke gate (SH-4) |
