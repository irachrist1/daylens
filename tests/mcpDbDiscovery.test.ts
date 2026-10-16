// The MCP server's DAYLENS_DB_PATH fallback must find the SAME database the
// app opens. The regression this pins: the fallback used to hardcode the
// legacy macOS dir (~/Library/Application Support/Daylens), so on a machine
// where the app had moved to "Daylens Desktop" an MCP client launched without
// DAYLENS_DB_PATH silently served the months-stale legacy database.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultAppDataPath, resolveDefaultDbPath } from '../packages/mcp-server/src/dbPath'

// Fake macOS homedir: discovery derives appData as <home>/Library/Application Support.
function makeMacHome(): { home: string; appData: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-mcp-discovery-'))
  const appData = path.join(home, 'Library', 'Application Support')
  fs.mkdirSync(appData, { recursive: true })
  return { home, appData }
}

// A directory only counts in discovery when it holds meaningful data — a
// non-empty database and/or a completed onboarding config.
function seedUserDataDir(appData: string, dirName: string): string {
  const dir = path.join(appData, dirName)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'daylens.sqlite'), 'not-empty')
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ onboardingComplete: true }))
  return dir
}

test('darwin: prefers Daylens Desktop over a stale legacy Daylens dir when both hold data', () => {
  const { home, appData } = makeMacHome()
  try {
    seedUserDataDir(appData, 'Daylens')
    const desktop = seedUserDataDir(appData, 'Daylens Desktop')
    assert.equal(resolveDefaultDbPath('darwin', {}, home), path.join(desktop, 'daylens.sqlite'))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('darwin: falls back to the legacy dir when it is the only one with data', () => {
  const { home, appData } = makeMacHome()
  try {
    const legacy = seedUserDataDir(appData, 'Daylens')
    assert.equal(resolveDefaultDbPath('darwin', {}, home), path.join(legacy, 'daylens.sqlite'))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('darwin: empty machine resolves to the preferred Daylens Desktop path', () => {
  const { home, appData } = makeMacHome()
  try {
    assert.equal(
      resolveDefaultDbPath('darwin', {}, home),
      path.join(appData, 'Daylens Desktop', 'daylens.sqlite'),
    )
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('appData base matches Electron conventions per platform', () => {
  assert.equal(
    defaultAppDataPath('darwin', {}, '/Users/someone'),
    path.join('/Users/someone', 'Library', 'Application Support'),
  )
  assert.equal(
    defaultAppDataPath('win32', { APPDATA: 'C:\\Users\\someone\\AppData\\Roaming' }, 'C:\\Users\\someone'),
    'C:\\Users\\someone\\AppData\\Roaming',
  )
  assert.equal(
    defaultAppDataPath('win32', {}, '/home/x'),
    path.join('/home/x', 'AppData', 'Roaming'),
  )
  assert.equal(
    defaultAppDataPath('linux', { XDG_CONFIG_HOME: '/home/x/.cfg' }, '/home/x'),
    '/home/x/.cfg',
  )
  assert.equal(defaultAppDataPath('linux', {}, '/home/x'), path.join('/home/x', '.config'))
})

// Fake Windows profile: discovery reads APPDATA for the installer build and
// <home>\.daylens for the Microsoft Store build.
function makeWindowsHome(): { home: string; appData: string; env: NodeJS.ProcessEnv } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-mcp-discovery-win-'))
  const appData = path.join(home, 'AppData', 'Roaming')
  fs.mkdirSync(appData, { recursive: true })
  return { home, appData, env: { APPDATA: appData } }
}

function setMtime(dir: string, ms: number): void {
  const when = new Date(ms)
  for (const file of ['daylens.sqlite', 'config.json']) fs.utimesSync(path.join(dir, file), when, when)
}

test('win32: finds a Microsoft Store install in the profile when APPDATA holds nothing', () => {
  const { home, env } = makeWindowsHome()
  try {
    const store = seedUserDataDir(home, '.daylens')
    assert.equal(resolveDefaultDbPath('win32', env, home), path.join(store, 'daylens.sqlite'))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('win32: the installer build stays found when there is no Store install', () => {
  const { home, appData, env } = makeWindowsHome()
  try {
    const installer = seedUserDataDir(appData, 'Daylens')
    assert.equal(resolveDefaultDbPath('win32', env, home), path.join(installer, 'daylens.sqlite'))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('win32: with both installs present the most recently written one wins', () => {
  const { home, appData, env } = makeWindowsHome()
  try {
    const installer = seedUserDataDir(appData, 'Daylens')
    const store = seedUserDataDir(home, '.daylens')
    const now = Date.now()

    setMtime(installer, now - 86_400_000)
    setMtime(store, now)
    assert.equal(resolveDefaultDbPath('win32', env, home), path.join(store, 'daylens.sqlite'))

    setMtime(installer, now)
    setMtime(store, now - 86_400_000)
    assert.equal(resolveDefaultDbPath('win32', env, home), path.join(installer, 'daylens.sqlite'))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('win32: empty machine still resolves to the installer path under APPDATA', () => {
  const { home, appData, env } = makeWindowsHome()
  try {
    assert.equal(resolveDefaultDbPath('win32', env, home), path.join(appData, 'Daylens', 'daylens.sqlite'))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
