import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildPosixDataCleanupScript,
  buildWindowsDataCleanupScript,
  collectLocalDataTargets,
  performUninstallCleanup,
  planUninstallCleanup,
  removalCommandForPackageType,
  resolveUninstallChoice,
  windowsUninstallerPath,
} from '../src/main/services/uninstallCleanup'
import { listUserDataCandidatePaths } from '../src/main/services/userData'
// Resolved by the test loader to tests/support/settings-stub.mjs — the same
// module instance performUninstallCleanup clears API keys through.
import { getApiKey, setApiKey } from '../src/main/services/settings'

function makeTempAppData(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-uninstall-test-'))
}

test('candidate user-data paths cover the preferred and legacy directories per platform', () => {
  const mac = listUserDataCandidatePaths('/appdata', 'darwin')
  assert.deepEqual(mac, [
    path.join('/appdata', 'Daylens Desktop'),
    path.join('/appdata', 'Daylens'),
    path.join('/appdata', 'DaylensWindows'),
  ])

  const win = listUserDataCandidatePaths('/appdata', 'win32')
  assert.deepEqual(win, [
    path.join('/appdata', 'Daylens'),
    path.join('/appdata', 'DaylensWindows'),
  ])

  const linux = listUserDataCandidatePaths('/appdata', 'linux')
  assert.deepEqual(linux, [
    path.join('/appdata', 'Daylens'),
    path.join('/appdata', 'DaylensWindows'),
  ])
})

test('uninstall choice dialog maps keep, delete, and cancel responses correctly', async () => {
  let confirmCalls = 0
  const confirmDelete = (response: number) => async () => {
    confirmCalls += 1
    return response
  }

  // Keep (button 1): proceed without deleting, and never show the delete confirm.
  confirmCalls = 0
  assert.deepEqual(
    await resolveUninstallChoice(1, confirmDelete(0)),
    { proceed: true, deleteLocalData: false },
  )
  assert.equal(confirmCalls, 0, 'keep must not open the delete confirmation')

  // Cancel (button 2, also the cancelId for Esc/close): nothing happens.
  confirmCalls = 0
  assert.deepEqual(
    await resolveUninstallChoice(2, confirmDelete(0)),
    { proceed: false, deleteLocalData: false },
  )
  assert.equal(confirmCalls, 0, 'cancel must not open the delete confirmation')

  // Delete (button 0) requires the second confirmation: 0 confirms...
  confirmCalls = 0
  assert.deepEqual(
    await resolveUninstallChoice(0, confirmDelete(0)),
    { proceed: true, deleteLocalData: true },
  )
  assert.equal(confirmCalls, 1)

  // ...anything else backs out entirely.
  assert.deepEqual(
    await resolveUninstallChoice(0, confirmDelete(1)),
    { proceed: false, deleteLocalData: false },
  )
})

test('keep plan removes the login item but collects no data targets and keeps API keys', () => {
  const appData = makeTempAppData()
  try {
    const userData = path.join(appData, 'Daylens Desktop')
    fs.mkdirSync(userData, { recursive: true })

    for (const platform of ['darwin', 'win32'] as const) {
      const plan = planUninstallCleanup({
        deleteLocalData: false,
        platform,
        isPackaged: true,
        appDataPath: appData,
        userDataPath: userData,
      })
      assert.equal(plan.disableLoginItem, true, `${platform}: login item must still be removed on keep`)
      assert.equal(plan.clearStoredApiKeys, false, `${platform}: keep must not clear stored API keys`)
      assert.deepEqual(plan.dataTargets, [], `${platform}: keep must not target any data directory`)
    }
  } finally {
    fs.rmSync(appData, { recursive: true, force: true })
  }
})

test('delete plan clears API keys and targets the existing data directories', () => {
  const appData = makeTempAppData()
  try {
    const userData = path.join(appData, 'Daylens Desktop')
    const legacy = path.join(appData, 'DaylensWindows')
    fs.mkdirSync(userData, { recursive: true })
    fs.mkdirSync(legacy, { recursive: true })

    const plan = planUninstallCleanup({
      deleteLocalData: true,
      platform: 'darwin',
      isPackaged: true,
      appDataPath: appData,
      userDataPath: userData,
    })
    assert.equal(plan.disableLoginItem, true)
    assert.equal(plan.clearStoredApiKeys, true)
    assert.deepEqual(plan.dataTargets.sort(), [userData, legacy].sort())
  } finally {
    fs.rmSync(appData, { recursive: true, force: true })
  }
})

// End-to-end keep path through performUninstallCleanup under the hermetic
// stubs: stored API keys must survive. Skipped on Linux, where the login-item
// sync inside the cleanup would touch the machine's real autostart files.
test(
  'performUninstallCleanup with keep leaves stored API keys intact',
  { skip: process.platform === 'linux' },
  async () => {
    await setApiKey('anthropic', 'sk-test-keep')
    await setApiKey('openai', 'sk-test-keep-2')

    await performUninstallCleanup({ deleteLocalData: false })

    assert.equal(await getApiKey('anthropic'), 'sk-test-keep')
    assert.equal(await getApiKey('openai'), 'sk-test-keep-2')
  },
)

test('collectLocalDataTargets returns only directories that exist, deduplicated', () => {
  const appData = makeTempAppData()
  try {
    const preferred = path.join(appData, 'Daylens Desktop')
    const legacy = path.join(appData, 'DaylensWindows')
    fs.mkdirSync(preferred, { recursive: true })
    fs.mkdirSync(legacy, { recursive: true })
    // A stray FILE with a candidate name must not become a deletion target.
    fs.writeFileSync(path.join(appData, 'Daylens'), 'not a directory')

    const targets = collectLocalDataTargets(appData, preferred, 'darwin')
    assert.deepEqual(targets.sort(), [preferred, legacy].sort())
  } finally {
    fs.rmSync(appData, { recursive: true, force: true })
  }
})

test('collectLocalDataTargets includes an out-of-tree userData path (dev override) once', () => {
  const appData = makeTempAppData()
  const devUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-dev-userdata-'))
  try {
    const targets = collectLocalDataTargets(appData, devUserData, 'linux')
    assert.deepEqual(targets, [devUserData])
  } finally {
    fs.rmSync(appData, { recursive: true, force: true })
    fs.rmSync(devUserData, { recursive: true, force: true })
  }
})

test('posix cleanup script waits for the parent, removes every target, and self-deletes', () => {
  const script = buildPosixDataCleanupScript(4242, ["/tmp/Daylens Desktop", "/tmp/it's-legacy"], '/tmp/cleanup.log')
  assert.match(script, /^#!\/bin\/sh\n/)
  assert.match(script, /kill -0 4242/)
  assert.ok(script.includes("rm -rf '/tmp/Daylens Desktop' '/tmp/it'\\''s-legacy'"), 'targets must be single-quoted with escaped quotes')
  assert.match(script, /rm -- "\$0"/)
  // The wait loop must be bounded so a stuck parent cannot leave the helper running forever.
  assert.match(script, /-ge 200/)
})

test('windows cleanup script polls the parent pid with a bounded loop and removes each target', () => {
  const script = buildWindowsDataCleanupScript(555, ['C:\\Users\\me\\AppData\\Roaming\\Daylens'])
  assert.match(script, /PID eq 555/)
  assert.match(script, /if %tries% gtr 120 goto clean/)
  // Delayed expansion would corrupt paths containing "!".
  assert.ok(!script.includes('enabledelayedexpansion'))
  assert.ok(script.includes('rd /s /q "C:\\Users\\me\\AppData\\Roaming\\Daylens"'))
  assert.ok(script.includes('del "%~f0"'))
})

test('linux removal command matches the package manager that owns the install', () => {
  assert.equal(removalCommandForPackageType('deb', 'daylens'), 'sudo apt remove daylens')
  assert.equal(removalCommandForPackageType('rpm', 'daylens'), 'sudo dnf remove daylens')
  assert.equal(removalCommandForPackageType('pacman', 'daylens'), 'sudo pacman -R daylens')
  // Unowned installs (AppImage, tar.gz, unknown) are finished by deleting the
  // file, not by a package manager command.
  assert.equal(removalCommandForPackageType('appimage', null), null)
  assert.equal(removalCommandForPackageType('unknown', null), null)
  assert.equal(removalCommandForPackageType(null, null), null)
  // A missing owner falls back to the published package name.
  assert.equal(removalCommandForPackageType('deb', null), 'sudo apt remove daylens')
})

test('windows uninstaller path sits next to the executable with the product name', () => {
  const execPath = path.join(os.tmpdir(), 'Programs', 'Daylens', 'Daylens.exe')
  assert.equal(
    windowsUninstallerPath(execPath),
    path.join(os.tmpdir(), 'Programs', 'Daylens', 'Uninstall Daylens.exe'),
  )
})
