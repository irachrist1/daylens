# Windows code signing

Production Windows installers must be **Authenticode-signed**. Unsigned packaged builds
disable built-in updates at runtime, and `release-windows.yml` fails before packaging when
the signing secrets are missing.

## CI secrets

Configure these GitHub Actions secrets for `release-windows.yml`:

| Secret | Purpose |
|--------|---------|
| `WIN_CERTIFICATE_FILE` | Base64-encoded `.pfx` used by the release workflow |
| `WIN_CERTIFICATE_PASSWORD` | PFX password |
| `WIN_CERT_SUBJECT_NAME` | Exact Authenticode signer subject DN from the PFX |

The workflow decodes `WIN_CERTIFICATE_FILE` into `WIN_CERTIFICATE_FILE_PATH`, which
`electron-builder.config.js` reads at pack time. Release packaging also sets
`DAYLENS_REQUIRE_WIN_SIGNING=1`, so a missing certificate fails the build instead of
publishing unsigned updater metadata. `WIN_CERT_SUBJECT_NAME` must exactly match
`Get-AuthenticodeSignature(...).SignerCertificate.Subject`; the workflow checks the
PFX, packaged updater metadata, and every produced `.exe` against that value.

## Local signing

```powershell
$env:WIN_CERTIFICATE_FILE_PATH = 'C:\path\to\daylens.pfx'
$env:WIN_CERTIFICATE_PASSWORD = '***'
$env:WIN_CERT_SUBJECT_NAME = 'CN=Your Publisher Name, O=Your Publisher Name, C=US'
npm run dist:win
```

## Verification

`release-windows.yml` runs `Get-AuthenticodeSignature` on every produced `.exe`, checks
that the signer subject matches `WIN_CERT_SUBJECT_NAME`, and checks that
`app-update.yml` pins the same publisher subject.

Unsigned builds are fine for local/internal smoke tests only. Do not ship them to users:
they cannot use Daylens built-in updates.
