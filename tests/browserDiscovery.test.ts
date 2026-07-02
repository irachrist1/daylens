import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveCanonicalBrowser } from '../src/main/lib/appIdentity.ts'
import { getBrowserEntries, getBrowserStatus } from '../src/main/services/browser.ts'
import {
  discoverMacBrowserHistoryLocations,
  parseLaunchServicesBrowserDump,
  type BrowserApplication,
} from '../src/main/services/browserRegistry.ts'

function tempHomeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-browser-home-'))
}

function touch(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, '')
}

async function withWindowsHome<T>(homeDir: string, run: () => Promise<T> | T): Promise<T> {
  const originalHome = process.env.HOME
  const originalUserProfile = process.env.USERPROFILE
  const originalPlatform = process.platform

  process.env.HOME = homeDir
  process.env.USERPROFILE = homeDir
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value:        'win32',
  })

  try {
    return await run()
  } finally {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome

    if (originalUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = originalUserProfile

    Object.defineProperty(process, 'platform', {
      configurable: true,
      value:        originalPlatform,
    })
  }
}

test('windows browser discovery finds Arc, Dia, and Comet Chromium profiles', async () => {
  const homeDir = tempHomeDir()
  const local = path.join(homeDir, 'AppData', 'Local')

  const arcHistoryPath = path.join(local, 'The Browser Company', 'Arc', 'User Data', 'Default', 'History')
  const diaHistoryPath = path.join(local, 'Dia', 'User Data', 'Profile 1', 'History')
  const cometHistoryPath = path.join(local, 'Comet', 'Default', 'History')

  touch(arcHistoryPath)
  touch(diaHistoryPath)
  touch(cometHistoryPath)

  const entries = await withWindowsHome(homeDir, () => getBrowserEntries())

  const arc = entries.find((entry) => entry.bundleId === 'arc.exe')
  assert.equal(arc?.name, 'Arc')
  assert.equal(arc?.historyPath, arcHistoryPath)
  assert.equal(resolveCanonicalBrowser(arc?.bundleId).canonicalBrowserId, 'arc')

  const dia = entries.find((entry) => entry.bundleId === 'dia.exe:Profile 1')
  assert.equal(dia?.name, 'Dia (Profile 1)')
  assert.equal(dia?.historyPath, diaHistoryPath)
  assert.equal(resolveCanonicalBrowser(dia?.bundleId).canonicalBrowserId, 'dia')

  const comet = entries.find((entry) => entry.bundleId === 'comet.exe')
  assert.equal(comet?.name, 'Comet')
  assert.equal(comet?.historyPath, cometHistoryPath)
  assert.equal(resolveCanonicalBrowser(comet?.bundleId).canonicalBrowserId, 'comet')
})

test('browser diagnostics always expose a discoveredBrowsers array', async () => {
  const homeDir = tempHomeDir()
  const local = path.join(homeDir, 'AppData', 'Local')
  const arcHistoryPath = path.join(local, 'The Browser Company', 'Arc', 'User Data', 'Default', 'History')

  touch(arcHistoryPath)

  await withWindowsHome(homeDir, () => {
    const status = getBrowserStatus()
    assert.ok(Array.isArray(status.discoveredBrowsers))
    const arc = status.discoveredBrowsers.find((entry) => entry.bundleId === 'arc.exe')
    assert.equal(arc?.historyPath, arcHistoryPath)
    assert.equal(arc?.historyExists, true)
  })
})

test('browser diagnostics expose safariHistoryAccess, defaulting to unknown until a WebKit poll runs', async () => {
  const homeDir = tempHomeDir()
  await withWindowsHome(homeDir, () => {
    const status = getBrowserStatus()
    // Nothing in this test suite drives an actual WebKit poll (that requires a
    // live Electron-backed DB — see the gap noted in the PR this test shipped
    // with), so the status should still read 'unknown' rather than having
    // latched into 'ok'/'denied' from unrelated state.
    assert.equal(status.safariHistoryAccess, 'unknown')
  })
})

test('LaunchServices http/https handlers discover Zen without a browser-name list', () => {
  const dump = `
--------------------------------------------------------------------------------
bundle id:                  Zen (0x20e4)
path:                       /Applications/Zen Test.app (0x3cf0)
name:                       Zen
identifier:                 app.zen-browser.zen
more flags:                 web-browser
claimed schemes:            file:, http:, https:
--------------------------------------------------------------------------------
bundle id:                  VLC (0x20e5)
path:                       /Applications/VLC.app (0x3cf1)
name:                       VLC
identifier:                 org.videolan.vlc
claimed schemes:            http:, https:
--------------------------------------------------------------------------------
`

  const applications = parseLaunchServicesBrowserDump(dump)
  assert.deepEqual(applications.map((application) => ({
    name: application.name,
    bundleId: application.bundleId,
    family: application.family,
  })), [{
    name: 'Zen',
    bundleId: 'app.zen-browser.zen',
    family: 'webkit',
  }])
})

test('mac browser history discovery maps a newly discovered Gecko browser to places.sqlite', () => {
  const homeDir = tempHomeDir()
  const placesPath = path.join(
    homeDir,
    'Library',
    'Application Support',
    'Zen',
    'Profiles',
    'abc.default',
    'places.sqlite',
  )
  touch(placesPath)
  const applications: BrowserApplication[] = [{
    name: 'Zen',
    bundleId: 'app.zen-browser.zen',
    appPath: '/Applications/Zen.app',
    family: 'firefox',
    source: 'launch_services',
  }]

  const locations = discoverMacBrowserHistoryLocations(applications, homeDir)
  assert.equal(locations.length, 1)
  assert.equal(locations[0].historyPath, placesPath)
  assert.equal(locations[0].family, 'firefox')
  assert.equal(locations[0].bundleId, 'app.zen-browser.zen')
})
