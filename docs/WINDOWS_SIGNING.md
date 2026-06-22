# Windows code signing

Production Windows installers should be **Authenticode-signed** so SmartScreen does not block first-time installs.

## CI secrets

Configure these GitHub Actions secrets for `release-windows.yml`:

| Secret | Purpose |
|--------|---------|
| `WIN_CERTIFICATE_FILE_PATH` | Path to the `.pfx` on the runner (or use a secure file mount step) |
| `WIN_CERTIFICATE_PASSWORD` | PFX password |
| `WIN_CERT_SUBJECT_NAME` | Certificate subject name for `electron-builder` |

`electron-builder.config.js` reads the same environment variables at pack time.

## Local signing

```powershell
$env:WIN_CERTIFICATE_FILE_PATH = 'C:\path\to\daylens.pfx'
$env:WIN_CERTIFICATE_PASSWORD = '***'
$env:WIN_CERT_SUBJECT_NAME = 'Your Publisher Name'
npm run dist:win
```

## Verification

`release-windows.yml` runs `Get-AuthenticodeSignature` on the produced `Setup.exe` when secrets are present.

Unsigned builds are fine for internal smoke tests; do not ship them to users without the SmartScreen warning called out in `docs/INSTALL.md`.
