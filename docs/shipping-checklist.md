# Daylens shipping checklist (2026-07-07)

A start-to-finish guide for building, opening, and updating Daylens on macOS and
Windows — written so a non-engineer can follow it. Every command below was actually
run against this repo on 2026-07-07 unless a step says otherwise.

## Read this first: two contradictions with the original plan

1. **The build-blocking bugs are fixed, except the version number.** The two things
   that broke every platform's build (the `recharts` reference and a broken
   `postinstall`) are already fixed, and the auto-updater security hole is already
   patched. But **the app version is still `1.0.0`**, down from the last real release
   `1.0.44`. This is not cosmetic: `electron-updater` decides whether to offer an
   update by comparing version numbers, and `1.0.0` looks *older* than what's already
   on users' machines. **Do not ship a build until this is bumped** (see Step 0).
2. **Windows cannot ship unsigned — the plan to bypass this with a SmartScreen
   warning does not match what the code now does.** `docs/WINDOWS_SIGNING.md` and
   `.github/workflows/release-windows.yml` already encode a hard rule: an unsigned
   Windows build cannot auto-update, and the *official* Windows release workflow
   refuses to even finish packaging without a real Authenticode certificate
   (`WIN_CERTIFICATE_FILE`, `WIN_CERTIFICATE_PASSWORD`, `WIN_CERT_SUBJECT_NAME`
   secrets). "Ship it unsigned, tell users to click through SmartScreen" is a real
   option for a handful of internal testers building locally with `npm run
   dist:win`, but it is **not** a path the official CI release process supports
   today, and the code explicitly warns not to ship unsigned Windows builds to real
   users because they can never receive an update. Budget the ~$300/year
   certificate before a real Windows release (see the Windows section below).

---

## Step 0 — Fix the version number (do this before anything else)

```bash
npm version 1.0.45 --no-git-tag-version
git diff package.json package-lock.json
```

**What success looks like:** `package.json` now says `"version": "1.0.45"` (or
higher — pick whatever is next after `1.0.44`). Commit this before building anything
you intend to actually distribute.

---

## macOS — building, opening, and updating

### Why the app isn't notarized

Daylens does not have an Apple Developer ID today, and **Apple does not allow
notarization without a paid Apple Developer Program membership ($99/year)** — a free
Apple ID can sign apps for your own machine, but not for distributing to other
people. This was verified directly against Apple's own documentation and developer
forums, not assumed:

- [Notarizing macOS software before distribution — Apple Developer Documentation](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Is macOS notarization possible with a free account? — Apple Developer Forums](https://developer.apple.com/forums/thread/121113)
- [Do I need a paid membership to notarize? — Apple Developer Forums](https://developer.apple.com/forums/thread/127467)

There is also no path to Mac App Store distribution without a Developer ID. Given
that, Daylens ships the DMG **ad-hoc signed** — good enough to run, not enough to
satisfy Gatekeeper's "identified developer" check.

### Build the DMG

```bash
npm run dist:mac
```

This runs `build:all` (main/preload/renderer/MCP bundles + the Swift capture helper)
then `electron-builder --mac zip dmg`. Actually run on this Mac on 2026-07-07, it
produced (before the Step 0 version bump was applied, hence `1.0.0` in the
filenames — yours should say `1.0.45`+):

```
dist-release/Daylens-1.0.0-arm64.dmg   (123 MB)
dist-release/Daylens-1.0.0-arm64.zip   (58 MB)
dist-release/mac-arm64/Daylens.app
```

The build finished clean — no real errors, only benign "use client" directive
warnings from `react-router`/`lucide-react` that Vite always emits and can be
ignored.

**What success looks like:** the command exits 0 and `dist-release/` contains a
`.dmg` file matching the version you set in Step 0.

> **One nuance found while verifying this locally:** this machine has a leftover
> "Apple Development" certificate in its keychain (`security find-identity -v -p
> codesigning`), and `electron-builder` auto-discovers and uses it unless told not
> to. **This is not what a real release build does.** `release-macos.yml` explicitly
> sets `CSC_IDENTITY_AUTO_DISCOVERY=false` when no real Developer ID secret is
> configured, producing the same ad-hoc-signed output every user actually gets. If
> you build locally on a machine with any codesigning identity in its keychain, set
> `CSC_IDENTITY_AUTO_DISCOVERY=false` first so your local build matches what ships:
> ```bash
> CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac
> ```

### How to open Daylens on a Mac (no Developer ID)

Because the app isn't notarized, the first launch will be blocked by Gatekeeper with
"Daylens.app is damaged and can't be opened" or "cannot be opened because the
developer cannot be verified." This is expected and not a bug. To open it:

1. Open **Finder → Applications** (or wherever you dragged Daylens from the DMG).
2. **Right-click (or Control-click) on Daylens** → choose **Open**.
3. A dialog appears asking to confirm — click **Open** again.
4. Daylens launches normally from then on; you only need to do this once.

**Put this on the download page, with a screenshot of the right-click → Open menu.**
The exact copy above is ready to paste in; capturing the actual screenshot needs a
person at a keyboard (no browser-automation tool is available in this environment),
so that part is a founder follow-up, not something done in this session.

### Future: remove this friction entirely

A $99/year Apple Developer ID lets Daylens be notarized, which removes the
right-click step, lets `hardenedRuntime`/`gatekeeperAssess` be configured properly,
and — per the audit — lets the ad-hoc-signing Squirrel-bypass in the updater be
deleted outright (tracked as Linear ticket **DEV-137**). Budget this for the next
release.

---

## Windows — building, opening, and updating

### The real constraint: signing is not optional for a real release

`docs/WINDOWS_SIGNING.md` (in this repo) says directly: *"Unsigned packaged builds
disable built-in updates at runtime... do not ship them to users: they cannot use
Daylens built-in updates."* And `.github/workflows/release-windows.yml` enforces
this in code — it sets `DAYLENS_REQUIRE_WIN_SIGNING=1` and fails the job before
packaging if `WIN_CERTIFICATE_FILE` / `WIN_CERTIFICATE_PASSWORD` /
`WIN_CERT_SUBJECT_NAME` secrets aren't configured. There is currently no configured
Windows certificate (confirmed: these are GitHub Actions secrets, not present
locally, and not something this session can check remotely).

**What this means practically:** you cannot get a real Windows release out of the
existing CI pipeline today. Two honest paths:

- **Buy a Windows code-signing certificate now** (~$300/year for an EV certificate,
  cheaper OV certs exist but trigger SmartScreen reputation-building delays) and
  configure the three GitHub secrets per `docs/WINDOWS_SIGNING.md`. This is the only
  path to a real, auto-updating Windows release.
- **Local unsigned builds for internal testing only** (see below) — never send these
  to real users, per the project's own documentation.

### This Mac cannot build the Windows installer

Verified, not assumed: `docs/windows-shipping-2026-07-07.md` already recorded that
"this Mac does not have `dotnet`, so the Windows helper project was not compiled
locally," and native modules (`better-sqlite3`, `@paymoapp/active-window`,
`keytar`) need a real Windows rebuild step. Attempting `npm run dist:win` here would
either fail outright or silently produce a broken/untested artifact. **Do not trust
a Windows build produced on this machine.**

The real Windows build must run on either:

- **The `release-windows.yml` GitHub Actions workflow** (`windows-latest` runner) —
  the correct path once signing secrets are configured, triggered by pushing a
  `v*-win` tag or running it manually via `workflow_dispatch`.
- **An actual Windows machine**, for local/internal unsigned smoke-testing only,
  following `docs/WINDOWS_SIGNING.md`'s "Local signing" section (or without the
  signing env vars at all, for an unsigned test build):
  ```powershell
  npm run dist:win
  ```

### How to open Daylens on Windows (unsigned test build only)

SmartScreen will show "Windows protected your PC" on first run of an unsigned
installer. To proceed:

1. Click **More info** on the SmartScreen dialog.
2. Click **Run anyway**.
3. The installer proceeds normally.

**Put this on the download page, with a screenshot of the SmartScreen "More info"
dialog** — again, ready-to-paste copy, screenshot is a founder follow-up.

This is annoying but not blocking **only for test builds you personally vouch for**.
Per the project's own signing doc, do not distribute an unsigned installer to real
users — they will never receive an update.

---

## Testing the update flow

The auto-updater security fix (checksum + bundle-id verification, fail-closed) is
already in (`8c6f438`, verified against `src/main/services/updater.ts` today) — this
must be true before testing updates, and it is.

1. Install an older build (e.g. the current `1.0.44` DMG/installer, or whatever the
   last real release was).
2. Build and publish a newer version (bump the version per Step 0, produce the DMG
   or Windows installer, and make it available at whatever URL the update feed
   points to — `apps/web/app/api/update-feed/route.ts`).
3. Launch the old build. Within roughly 10 seconds it should check the feed, find
   the newer version, download it, verify its SHA-256 against the digest the feed
   published, and offer to relaunch.
4. Confirm the relaunch lands on the new version (check Settings → About, or the
   Wrap/timeline screens for the new UI).

**What success looks like:** the old build detects, downloads, verifies, and
relaunches into the new version without any manual download. If the digest doesn't
match, `canAutoInstall` should be `false` and the UI should fall back to "manual
download only" — that's also a pass, since it proves the fail-closed path works.

**This step requires a human at a keyboard on both platforms.** No
browser/GUI-automation tool exists in this environment, so this was not run this
session — see the founder handoff below.

---

## What was actually verified this session (headless, on this Mac)

- ✅ `npm run dist:mac` — ran for real, produced a signed (ad-hoc-equivalent once
  `CSC_IDENTITY_AUTO_DISCOVERY=false` is set) `.dmg` and `.app` in `dist-release/`.
- ✅ `recharts` reference confirmed gone from `vite.renderer.config.ts`; `npm run
  build:all` and `typecheck` green.
- ✅ Updater checksum/bundle-id verification confirmed present in
  `src/main/services/updater.ts`.
- ✅ macOS notarization-without-Developer-ID researched and confirmed impossible
  (cited above).
- ❌ Windows NSIS build **not** run locally — this Mac lacks `dotnet` and the native
  Windows toolchain; use `release-windows.yml` on a `windows-latest` runner, or a
  real Windows box, instead of trusting anything built here.
- ❌ Version bump (Step 0) **written into this checklist as required, not yet
  applied to `package.json`** — do this before the next real build.

## Founder handoff — what only you can verify

Nothing in this checklist substitutes for opening the actual installers. Please:

1. **macOS:** download/build the DMG, right-click → Open, confirm Daylens launches
   normally, confirm the "damaged" Gatekeeper dialog behaves as described above.
2. **Windows:** once a signed build exists (or using a local unsigned test build),
   run the installer, click through SmartScreen as described, confirm the app
   launches and tracking works.
3. **Update flow, both platforms:** install an old build, publish a newer one,
   confirm the in-app update downloads, verifies, and relaunches successfully.

Only you marking these three checks done makes the shipping path verified — green
builds and passing tests are not the same claim as "a real user can download and
open this."
