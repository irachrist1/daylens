// Static checks that the per-platform uninstall hooks stay wired: the NSIS
// customUnInstall include and the Linux maintainer script's autostart cleanup.
// These files only run inside installers, so regressions here are invisible to
// every runtime test.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const NSIS_INCLUDE = path.join(ROOT, 'build/win/uninstall.nsh')

test('electron-builder wires the NSIS uninstall include', () => {
  const config = fs.readFileSync(path.join(ROOT, 'electron-builder.config.js'), 'utf8')
  assert.match(config, /include: 'build\/win\/uninstall\.nsh'/)
  assert.ok(fs.existsSync(NSIS_INCLUDE))
})

test('NSIS uninstall hook removes every login-item registry value on real uninstalls', () => {
  const source = fs.readFileSync(NSIS_INCLUDE, 'utf8')
  assert.match(source, /!macro customUnInstall/)
  // Guarded so auto-updates (which run the uninstaller too) never touch the login item.
  assert.match(source, /\$\{ifNot\} \$\{isUpdated\}/)
  for (const hive of [
    'Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
  ]) {
    for (const valueName of ['com.daylens.desktop', 'dev.christiantonny.daylens', 'Daylens']) {
      assert.ok(
        source.includes(`DeleteRegValue HKCU "${hive}" "${valueName}"`),
        `expected DeleteRegValue for ${hive} \\ ${valueName}`,
      )
    }
  }
})

test('NSIS uninstall hook only deletes data on an explicit choice, never silently', () => {
  const source = fs.readFileSync(NSIS_INCLUDE, 'utf8')
  // Interactive uninstalls must ASK; the /SD default keeps data.
  assert.match(source, /MessageBox MB_YESNO[^\n]*\/SD IDNO/)
  assert.match(source, /\$\{GetOptions\} \$R0 "\/S" \$R1/)
  assert.match(source, /SetSilent normal/)
  // The in-app flow's --delete-app-data path also clears the legacy directory.
  assert.match(source, /\$\{GetOptions\} \$R0 "--delete-app-data" \$R1/)
  assert.ok(source.includes('RMDir /r "$APPDATA\\DaylensWindows"'))
})

test('linux after-remove drops per-user autostart entries but never user data', () => {
  const source = fs.readFileSync(path.join(ROOT, 'build/linux/after-remove.sh'), 'utf8')
  assert.ok(
    source.includes('rm -f /home/*/.config/autostart/daylens.desktop /root/.config/autostart/daylens.desktop'),
    'after-remove must delete the XDG autostart entry for local users',
  )
  assert.ok(source.includes('${XDG_CONFIG_HOME}/autostart/daylens.desktop'))
  assert.match(source, /find \/home \/root -type f -path '\*\/autostart\/daylens\.desktop' -delete/)
  assert.ok(!/\.config\/Daylens/.test(source), 'after-remove must not delete user data directories')
})
