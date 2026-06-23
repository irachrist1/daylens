import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldPreferMacFocusEventWindow } from '../src/main/services/tracking.ts'

test('mac focus helper wins when active-window reports a stale app', () => {
  assert.equal(shouldPreferMacFocusEventWindow(
    {
      title: '',
      application: 'Warp',
      path: '/Applications/Warp.app/Contents/MacOS/stable',
      pid: 7021,
    },
    {
      title: 'Example Domain',
      application: 'Safari',
      path: 'com.apple.Safari',
      pid: 6455,
      observedAt: Date.now(),
    },
  ), true)
})

test('mac active-window stays authoritative when the helper reports the same app', () => {
  assert.equal(shouldPreferMacFocusEventWindow(
    {
      title: 'Example Domain',
      application: 'Safari',
      path: '/System/Applications/Safari.app/Contents/MacOS/Safari',
      pid: 6455,
    },
    {
      title: 'Example Domain',
      application: 'Safari',
      path: 'com.apple.Safari',
      pid: 6455,
      observedAt: Date.now(),
    },
  ), false)
})
