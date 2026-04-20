// electron-builder afterSign hook.
// Daylens does not have an Apple Developer ID certificate, so electron-builder
// falls back to a linker-signed stub whose CodeDirectory claims resources exist
// but emits no CodeResources file. Gatekeeper then reports the app as
// "damaged and can't be opened" on Finder double-click.
//
// This hook replaces that broken stub with a complete ad-hoc signature
// (`codesign --force --deep --sign -`) so the bundle carries a verifiable
// signature. End users still see the "unidentified developer" dialog on first
// launch (because we are not notarized), but they can Open Anyway — which is a
// far better UX than the dead-end "damaged" dialog and matches the behavior
// users of other OSS ad-hoc signed Electron apps already accept.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function deepAdhocResign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const { appOutDir, packager } = context
  const productFilename = packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${productFilename}.app`)
  console.log(`[afterSign] deep ad-hoc re-sign: ${appPath}`)
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  })
  execFileSync('/usr/bin/codesign', ['--verify', '--verbose=2', appPath], {
    stdio: 'inherit',
  })
}
