# macOS code signing and notarization

Production macOS builds must be Developer-ID-signed and notarized. Without both, Gatekeeper warns (or blocks) on first launch, and the in-app updater falls back to the ad-hoc swap path instead of the verified Squirrel.Mac install. The `Release macOS` workflow does everything automatically once the credentials below exist as GitHub Actions secrets — if they are partially configured, the workflow fails early and prints exactly which secrets are missing.

## CI secrets

Signing (both required):

| Secret                     | Purpose                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `MAC_CERTIFICATE_FILE`     | Base64-encoded Developer ID Application certificate (`.p12`)   |
| `MAC_CERTIFICATE_PASSWORD` | Password chosen when exporting the `.p12`                      |

Notarization (add ONE full set — the API key is preferred because it does not expire with your Apple ID password):

| Secret              | Purpose                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `APPLE_API_KEY`     | Contents of the App Store Connect `AuthKey_XXXXXXXXXX.p8` (raw PEM or base64) |
| `APPLE_API_KEY_ID`  | The key's 10-character ID (the `XXXXXXXXXX` in the filename)        |
| `APPLE_API_ISSUER`  | Issuer ID (UUID) from the App Store Connect Keys page               |

or:

| Secret                        | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `APPLE_ID`                    | Apple developer account email                        |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password created at appleid.apple.com   |
| `APPLE_TEAM_ID`               | 10-character team ID (Membership page)               |

Optional repository **variable** (not secret): set `DAYLENS_REQUIRE_MAC_SIGNING` to `1` to make every macOS release fail unless it can be signed and notarized. Without it, a run with no signing secrets at all still produces an ad-hoc build (with a loud warning).

## One-time setup

1. **Join the Apple Developer Program** ($99/year) with the Apple ID that will own the certificate.
2. **Create the Developer ID Application certificate** — on any Mac: Xcode → Settings → Accounts → Manage Certificates → `+` → "Developer ID Application" (or via developer.apple.com → Certificates). Then in Keychain Access, export the certificate **and its private key** as a `.p12` with a password.
3. **Encode and store the certificate:**

   ```bash
   base64 -i DeveloperIDApplication.p12 | pbcopy
   # paste into the MAC_CERTIFICATE_FILE secret
   # store the export password as MAC_CERTIFICATE_PASSWORD
   ```

4. **Create an App Store Connect API key** — appstoreconnect.apple.com → Users and Access → Integrations → Keys → generate a key with the Developer role. Download the `AuthKey_XXXXXXXXXX.p8` (one chance only). Store its contents as `APPLE_API_KEY`, the key ID as `APPLE_API_KEY_ID`, and the issuer UUID shown on the same page as `APPLE_API_ISSUER`.
5. Tag a release (`vX.Y.Z-mac`) or dispatch the `Release macOS` workflow. The workflow signs, notarizes, staples, verifies with `codesign`/`stapler`/`spctl`, and publishes the DMG, ZIP, and `latest-mac.yml`.

## What signed builds change for updates

- **Ad-hoc builds** (today's installs): Squirrel.Mac can never verify them, so Daylens checks the public update feed and swaps the app bundle with its own helper. This path stays as-is so existing installs can still move forward.
- **Developer-ID builds**: Daylens uses electron-updater against the release's `latest-mac.yml`. Updates download in the background and Squirrel.Mac verifies the new bundle's signature before installing on "Restart to update" (or on quit). The `afterSign` hook detects the real signature and never ad-hoc re-signs it.

The first signed release is still a manual download for existing ad-hoc installs (the ad-hoc swap path can update them to it, since the signed ZIP is published on the same feed); every release after that auto-updates through Squirrel.

## Verification

The workflow verifies before publishing; to check a produced app locally:

```bash
codesign --verify --deep --strict --verbose=2 Daylens.app
xcrun stapler validate Daylens.app
spctl --assess --type execute --verbose=2 Daylens.app
```

Do not publish a Developer-ID build that fails any of these — users would download an app macOS refuses to open.
