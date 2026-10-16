import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { isWindowsStoreBuild } from '../src/main/lib/windowsStore'
import { windowsStoreUserDataPath } from '../src/main/services/userData'

test('only a packaged Windows process counts as a Store build', () => {
  assert.equal(isWindowsStoreBuild('win32', true), true)
  assert.equal(isWindowsStoreBuild('win32', false), false)
  assert.equal(isWindowsStoreBuild('win32', undefined), false)
  assert.equal(isWindowsStoreBuild('darwin', true), false)
})

test('Store userData lives in the profile, outside AppData', () => {
  const home = path.join('C:', 'Users', 'someone')
  const dir = windowsStoreUserDataPath(home)
  assert.equal(dir, path.join(home, '.daylens'))
  assert.ok(!dir.toLowerCase().includes('appdata'))
})
