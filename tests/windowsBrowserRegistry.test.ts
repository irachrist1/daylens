import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyWindowsBrowserFamily,
  parseStartMenuInternetDump,
} from '../src/main/services/windowsBrowserRegistry.ts'

test('classifyWindowsBrowserFamily detects firefox forks', () => {
  assert.equal(classifyWindowsBrowserFamily('C:\\Program Files\\Zen\\zen.exe', 'Zen'), 'firefox')
  assert.equal(classifyWindowsBrowserFamily('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'Google Chrome'), 'chromium')
})

test('parseStartMenuInternetDump extracts browser applications', () => {
  const dump = `
HKEY_CURRENT_USER\\Software\\Clients\\StartMenuInternet\\ChromeHTML
    (default)    REG_SZ    Google Chrome
HKEY_CURRENT_USER\\Software\\Clients\\StartMenuInternet\\ChromeHTML\\shell\\open\\command
    (default)    REG_SZ    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" -- "%1"
HKEY_CURRENT_USER\\Software\\Clients\\StartMenuInternet\\ZenHTML
    (default)    REG_SZ    Zen
HKEY_CURRENT_USER\\Software\\Clients\\StartMenuInternet\\ZenHTML\\shell\\open\\command
    (default)    REG_SZ    "C:\\Program Files\\Zen\\zen.exe" -- "%1"
`

  const applications = parseStartMenuInternetDump(dump)
  assert.equal(applications.length, 2)
  assert.equal(applications[0]?.bundleId, 'chrome.exe')
  assert.equal(applications[0]?.family, 'chromium')
  assert.equal(applications[1]?.bundleId, 'zen.exe')
  assert.equal(applications[1]?.family, 'firefox')
})
