# Microsoft Store build

> The Windows build ships through the Microsoft Store as a full-trust package. Microsoft signs it at submission. The only restricted capability is `runFullTrust`. The NSIS installer (`release-windows.yml`) still exists for builds signed with Authenticode.

## How the package is built

`release-windows-store.yml` runs `electron-builder --win appx` (electron-builder 26.17). It creates the manifest from `build/win/store/AppxManifest.xml` using `appx.customManifestPath` (added in 26.0.0, #8609). The capability list comes from `appx.capabilities: ['runFullTrust']` (added in 26.7.0, #9437). After packaging, the job opens the `.appx` and fails if the manifest declares any capability other than `rescap:runFullTrust`, or if the startup task below is missing. It uploads the manifest along with the package.

Partner Center's values are passed as workflow inputs: `identity_name`, `publisher`, `publisher_display_name` and `application_id`. The tile images in `build/appx/` were generated from `build/icon.png`.

The target is `.appx`, not `.msix`. Partner Center accepts both. electron-builder only adds a separate msix target in 27.x, which is still in alpha.

## What changes when `process.windowsStore` is true

| Area | Installer build | Store build |
| --- | --- | --- |
| Updates | electron-updater, after an Authenticode check | Off. The Store installs updates. No PowerShell signature probe runs. |
| AppUserModelID | `com.daylens.desktop` | Not set. Windows uses the package's `PackageFamilyName!App`. |
| Launch at login | `app.setLoginItemSettings` (HKCU Run key) | The manifest `StartupTask` (`DaylensStartup`). Run-key writes are skipped everywhere: at startup, in settings, and during uninstall cleanup. |
| userData | `%APPDATA%\Daylens` | `%USERPROFILE%\.daylens`. Chromium's `sessionData` stays in `%APPDATA%\Daylens`. |

There is no launch-at-login toggle in the renderer today, so nothing needed hiding.

### Why userData leaves AppData

On Windows 10 1903 and later, a packaged app's new files under `AppData` go to `%LOCALAPPDATA%\Packages\<PFN>\LocalCache\...`. Files that already exist are edited in place ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)).

This matters for someone who upgrades from the installer build. Their `daylens.sqlite` stays in the real `%APPDATA%\Daylens`, but the fresh `-wal` and `-shm` files land in the package's private copy. The standalone MCP server and the CLI would then open the database file without its WAL and shared-memory lock file.

Keeping the Store build's data outside `AppData` avoids the redirect. `packages/mcp-server/src/dbPath.ts` checks both `%APPDATA%\Daylens` and `%USERPROFILE%\.daylens` and picks whichever was written most recently (tests in `tests/mcpDbDiscovery.test.ts`).

Consequences:
- Uninstalling from the Store leaves `%USERPROFILE%\.daylens` in place. The in-app "Reset and uninstall" option with "Delete local data" removes it.
- Data from an earlier installer build is not migrated. A Store install starts empty.

### Login launch

The startup task passes `--hidden` through `uap10:Parameters`. When main sees that flag, onboarding is complete and the tray icon exists, it keeps the window hidden at login, and the post-paint services start on `ready-to-show` instead of the first `show`.

Windows registers the task the first time the person launches the app. If the person turns it off in Settings > Apps > Startup, the app can't turn it back on.

Mozilla saw `uap10:Parameters` arrive empty on some Windows 10 builds ([bug 2058020](https://bugzilla.mozilla.org/show_bug.cgi?id=2058020)). On those builds Daylens just opens its window at login, as the installer build does today. The reliable signal is `AppInstance.GetActivatedEventArgs().Kind == ActivationKind.StartupTask`. That call only works inside the process Windows activated, so using it would need a native addon or a launcher exe.

The installer build does not pass `--hidden` to its Run key, so it still shows the window at login.

## Browser extension transport (design, not built)

The extension on the `browser-extension` branch reaches Daylens over native messaging (`app.daylens.browser`). Native messaging needs an HKCU `NativeMessagingHosts` key. A packaged app's HKCU writes go into a private per-package copy, which the browser never reads. Making those writes real takes `unvirtualizedResources`, and Microsoft says that capability isn't meant for non-game apps (two rejections in Sept 2026). The Store build needs another way in.

### What Local Network Access does with extensions

Sources: Chrome's [LNA post](https://developer.chrome.com/blog/local-network-access), the [WICG explainer](https://github.com/WICG/local-network-access/blob/main/explainer.md), [extension network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [Edge LNA](https://learn.microsoft.com/en-us/deployedge/ms-edge-local-network-access), and Mozilla bugs [2032778](https://bugzilla.mozilla.org/show_bug.cgi?id=2032778) and [2023758](https://bugzilla.mozilla.org/show_bug.cgi?id=2023758). Short version:

- **Chrome:** extension pages and the service worker are exempt from Local Network Access (LNA). Chromium puts `chrome-extension://` in the loopback address space, and LNA only checks requests that move to a more private space. Google's adoption guide says there are no plans to apply LNA to extensions. A Chrome 142 bug that blocked some extensions was fixed for 144.
- **Content scripts are not exempt.** They act for the page's origin, so a content script calling 127.0.0.1 gets the `loopback-network` prompt (Chrome 145+). WebSockets are gated from Chrome 147. All traffic has to go through the service worker.
- **Edge:** on by default from Edge 143, with the same extension exemption and policy names. Edge's handling of the 145 permission split and the 147 WebSocket gating isn't confirmed yet.
- **Firefox:** on for all desktop users in 154, including WebSocket. Extension pages with a localhost host permission count as loopback and get no prompt. Content scripts follow the page.
- **Enterprise policies that could block it:** `LoopbackNetworkBlockedForUrls` (Chrome/Edge 146+) and Firefox's `LocalNetworkAccess` policy. Both are documented as managed-device limits.

### Proposed transport

- Daylens main listens on `127.0.0.1` only (never `0.0.0.0` or `::`) on a fixed port, with two fallback ports in case it's taken. The extension tries them in order. It can't read a port file.
- One WebSocket from the service worker, using the same newline-free JSON messages the native port carries now. Chrome 116+ keeps a service worker alive while a WebSocket is active, which matches what the open native port does today. The server sends a ping every 20 s to stay inside the 30 s idle limit.
- `host_permissions: ["http://127.0.0.1/*"]` in the extension manifest. WebSocket has no CORS, so the server enforces these checks itself:
  - `Origin` must be `chrome-extension://<published id>` or `moz-extension://<uuid>`. This stops web pages, because they can't forge `Origin`.
  - A per-install token from the first message must match. This stops other local processes, which can forge `Origin`.
  - The `Host` header must be `127.0.0.1:<port>`. This blocks DNS rebinding.
- **Token delivery (pairing):**
  1. The extension makes a random nonce and opens `daylens://pair?nonce=…` in a tab. That needs a `windows.protocol` entry in the manifest, which takes no capability.
  2. Daylens asks "Connect this browser?" and stores a token tied to the nonce.
  3. The extension's next connection sends the nonce and receives the token, which it keeps in `chrome.storage.local`.
  4. Revoking or re-pairing replaces the token.
- **Idle cost:** one listening socket and one idle WebSocket per browser. No polling.
- **Installer and macOS builds:** keep native messaging. The extension tries native messaging first and falls back to localhost when `connectNative` reports the host isn't found.

To confirm before building: whether Firefox for Android and Safari matter (they're out of scope today); that the Chrome Web Store reviewer is fine with a `127.0.0.1` host permission and a single purpose; and how Edge behaves after 147.

## Still to test on a real Windows 11 machine

CI can't run any of these: the package is unsigned until Partner Center signs it. To sideload a test build, make a self-signed certificate whose subject equals the `publisher` input. Trust it under Local Machine > Trusted People. Build with `WIN_CERTIFICATE_FILE_PATH`, `WIN_CERTIFICATE_PASSWORD` and `WIN_CERT_SUBJECT_NAME` set to that certificate, then install with `Add-AppxPackage`.

1. **StartupTask after first launch.** Install, launch once, sign out and back in.
   - Daylens should start into the tray with no window.
   - It should be listed in Settings > Apps > Startup.
   - Turning it off there should stop the next login launch.
   - Before the first launch, signing out and in should not start it.
   - Check whether `--hidden` reaches `process.argv` (the startup log line reads `kept hidden for login launch`).
2. **Reading `\\wsl$` from the package.** Check that enrichment can still read `\\wsl$\<distro>\home\<user>\.claude` and `.codex` while `process.windowsStore` is true, and that reading `%USERPROFILE%\.claude` and `.codex` still works.
3. **Named pipe.** Check that the capture helper's per-user pipe connects both ways between the packaged main process and the helper, and that nothing outside the package can open it.
4. **Helper spawn.** Check that `resources\build\windows-capture-helper.exe` starts from `C:\Program Files\WindowsApps\…`, that window and foreground capture work, and that the helper exits when Daylens quits. Check that the single-file self-extract works from the read-only install folder; it should extract to `%TEMP%`, which is a redirected AppData path.
5. **Extension connection.** Native messaging is expected to fail, because Chrome won't find the redirected HKCU key. Confirm that, so the localhost transport is known to be needed. Once it's built, test it with Chrome 147+, Edge and Firefox 154+.
6. **Data location.**
   - Check that `%USERPROFILE%\.daylens\daylens.sqlite`, `-wal` and `-shm` appear in the real profile, not under `Packages\<PFN>\LocalCache`.
   - With Daylens running, check that `node dist/mcp-server/index.cjs` started outside the package finds that database without `DAYLENS_DB_PATH`.
7. **Updater and identity.**
   - Settings > Updates should say the Store manages updates.
   - No `powershell.exe Get-AuthenticodeSignature` should run.
   - Toasts should show the Daylens name and icon.
   - Pinning to the taskbar should survive a relaunch.
8. **Reset and uninstall.**
   - "Delete local data" should remove `%USERPROFILE%\.daylens`. The cleanup script runs from `%TEMP%` as a child of the package.
   - Removing the app in Settings > Apps should leave nothing under `Packages\<PFN>` and keep `.daylens`.
9. **Windows App Certification Kit.** Run it against the sideloaded package before submitting.

## Known gaps

- **The MCP client config uses `process.execPath`** (`src/main/services/mcpServer.ts`). For a Store install that path is `C:\Program Files\WindowsApps\<full name>\app\Daylens.exe`. It includes the version, so it breaks on every Store update. An app execution alias would give a stable path, but whether `ELECTRON_RUN_AS_NODE` makes it through alias activation hasn't been tested.
- **Reset and uninstall** can't remove a Store package or disable the StartupTask. After a reset, Daylens would launch again at the next login and recreate its data. The dialog should send the person to Settings > Apps.
- **The installer build shows its window at login.** Passing `--hidden` to `setLoginItemSettings` would match the Store build, but it rewrites every existing user's Run key.
