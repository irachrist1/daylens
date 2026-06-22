import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  __resetLinuxBrowserRegistryForTests,
  __setLinuxDesktopApplicationsDirsForTests,
  classifyLinuxBrowserFamily,
  discoverLinuxBrowserHistoryLocations,
  readLinuxDesktopBrowsers,
} from '../src/main/services/linuxBrowserRegistry.ts'

const FIXTURE_ROOT = path.join(os.tmpdir(), `daylens-linux-browser-${process.pid}`)

function writeDesktopEntry(dir: string, name: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${name}.desktop`), body, 'utf8')
}

test('classifyLinuxBrowserFamily detects firefox forks', () => {
  assert.equal(classifyLinuxBrowserFamily('/usr/bin/zen', 'Zen'), 'firefox')
  assert.equal(classifyLinuxBrowserFamily('/usr/bin/google-chrome', 'Google Chrome'), 'chromium')
})

test('readLinuxDesktopBrowsers discovers http handlers from desktop entries', () => {
  const appsDir = path.join(FIXTURE_ROOT, 'applications')
  writeDesktopEntry(appsDir, 'google-chrome', [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Google Chrome',
    'Exec=/usr/bin/google-chrome-stable %U',
    'MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;',
    '',
  ].join('\n'))
  writeDesktopEntry(appsDir, 'zen', [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Zen',
    'Exec=/usr/bin/zen %u',
    'Categories=Network;WebBrowser;',
    '',
  ].join('\n'))
  writeDesktopEntry(appsDir, 'calculator', [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Calculator',
    'Exec=/usr/bin/gnome-calculator',
    'Categories=Utility;Calculator;',
    '',
  ].join('\n'))

  __setLinuxDesktopApplicationsDirsForTests([appsDir])
  try {
    const applications = readLinuxDesktopBrowsers([appsDir])
    assert.equal(applications.length, 2)
    assert.equal(applications[0]?.bundleId, 'google-chrome-stable')
    assert.equal(applications[0]?.family, 'chromium')
    assert.equal(applications[1]?.bundleId, 'zen')
    assert.equal(applications[1]?.family, 'firefox')
  } finally {
    __resetLinuxBrowserRegistryForTests()
    fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  }
})

test('discoverLinuxBrowserHistoryLocations finds chromium and firefox profiles', () => {
  const home = path.join(FIXTURE_ROOT, 'home')
  const chromeHistory = path.join(home, '.config', 'google-chrome', 'Default', 'History')
  const firefoxProfile = path.join(home, '.mozilla', 'firefox', 'abc.default-release')
  fs.mkdirSync(path.dirname(chromeHistory), { recursive: true })
  fs.writeFileSync(chromeHistory, '', 'utf8')
  fs.mkdirSync(firefoxProfile, { recursive: true })
  fs.writeFileSync(path.join(firefoxProfile, 'places.sqlite'), '', 'utf8')

  const applications = [
    {
      name: 'Google Chrome',
      bundleId: 'google-chrome-stable',
      appPath: '/usr/bin/google-chrome-stable',
      family: 'chromium' as const,
      source: 'launch_services' as const,
    },
    {
      name: 'Firefox',
      bundleId: 'firefox',
      appPath: '/usr/bin/firefox',
      family: 'firefox' as const,
      source: 'launch_services' as const,
    },
  ]

  const locations = discoverLinuxBrowserHistoryLocations(applications, home)
  assert.equal(locations.length, 2)
  assert.ok(locations.some((location) => location.historyPath === chromeHistory))
  assert.ok(locations.some((location) => location.historyPath.endsWith('places.sqlite')))
})
