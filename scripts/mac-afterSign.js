// electron-builder afterSign hook.
//
// Ad-hoc builds (no Apple Developer ID certificate): electron-builder falls
// back to a linker-signed stub whose CodeDirectory claims resources exist but
// emits no CodeResources file. Gatekeeper then reports the app as "damaged and
// can't be opened" on Finder double-click. This hook replaces that broken stub
// with a complete ad-hoc signature (`codesign --force --deep --sign -`) so the
// bundle carries a verifiable signature. End users still see the "unidentified
// developer" dialog on first launch (because we are not notarized), but they
// can Open Anyway — a far better UX than the dead-end "damaged" dialog.
//
// Developer-ID builds: electron-builder has already signed the bundle with the
// real certificate — and notarized it — by the time this hook runs. Re-signing
// ad-hoc here would strip the Developer ID signature and invalidate the
// notarization ticket, so the hook detects a Team-ID-anchored signature and
// leaves the bundle untouched (verify only).
const { execFileSync, spawnSync } = require('node:child_process')
const path = require('node:path')

function hasDeveloperIdSignature(appPath) {
  // codesign -dv prints signature details to stderr and exits non-zero for
  // unsigned bundles, so read both streams via spawnSync instead of throwing.
  const result = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', appPath], { encoding: 'utf8' })
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.status !== 0) return false
  if (/Signature=adhoc/i.test(combined)) return false
  if (/TeamIdentifier=not set/i.test(combined)) return false
  return /TeamIdentifier=/.test(combined)
}

exports.default = async function deepAdhocResign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const { appOutDir, packager } = context
  const productFilename = packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${productFilename}.app`)

  if (hasDeveloperIdSignature(appPath)) {
    console.log(`[afterSign] Developer ID signature detected on ${appPath}; leaving signature and notarization intact`)
    execFileSync('/usr/bin/codesign', ['--verify', '--verbose=2', appPath], {
      stdio: 'inherit',
    })
    return
  }

  console.log(`[afterSign] deep ad-hoc re-sign: ${appPath}`)
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  })
  execFileSync('/usr/bin/codesign', ['--verify', '--verbose=2', appPath], {
    stdio: 'inherit',
  })
}
