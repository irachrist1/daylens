# Windows code signing

Production Windows installers must be Authenticode-signed. Unsigned builds are acceptable only for local or internal smoke testing.

## CI secrets

The Windows release workflow expects:

| Secret                     | Purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `WIN_CERTIFICATE_FILE`     | Base64-encoded PFX certificate                         |
| `WIN_CERTIFICATE_PASSWORD` | PFX password                                           |
| `WIN_CERT_SUBJECT_NAME`    | Exact Authenticode signer subject from the certificate |

The workflow decodes the certificate for `electron-builder`, requires signing during release packaging, checks every produced EXE, and verifies that updater metadata uses the same publisher subject.

## Local signing

```powershell
$env:WIN_CERTIFICATE_FILE_PATH = 'C:\path\to\daylens.pfx'
$env:WIN_CERTIFICATE_PASSWORD = '***'
$env:WIN_CERT_SUBJECT_NAME = 'CN=Publisher, O=Publisher, C=US'
npm run dist:win
```

## Verification

Use `Get-AuthenticodeSignature` on every produced EXE and confirm that the signer subject matches `WIN_CERT_SUBJECT_NAME`. Confirm that `app-update.yml` pins the same publisher.

Do not publish unsigned updater metadata. Built-in updates must remain disabled when signing requirements are not satisfied.
