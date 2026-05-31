import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decideAppCapture,
  decideSiteCapture,
  detectIncognitoFromTitle,
  isAppExcluded,
  isSiteExcluded,
  trackingControlsStateFromSettings,
  type TrackingControlsState,
} from '../src/shared/trackingControls.ts'

const base: TrackingControlsState = {
  enabled: false,
  paused: false,
  excludedApps: [],
  excludedSites: [],
  skipIncognito: true,
}

// ── Invariant: OFF + unpaused is a strict passthrough (acceptance #1) ──────────

test('disabled and unpaused captures everything (byte-for-byte unchanged)', () => {
  const s = { ...base, enabled: false, excludedApps: ['com.foo'], excludedSites: ['x.com'] }
  assert.deepEqual(decideAppCapture(s, { bundleId: 'com.foo', appName: 'Foo' }), { capture: true, reason: null })
  assert.deepEqual(decideSiteCapture(s, { domain: 'x.com' }), { capture: true, reason: null })
  // Even an incognito title is captured when the feature is off.
  assert.equal(decideAppCapture(s, { windowTitle: 'Secret (Incognito)' }).capture, true)
})

// ── Pause works regardless of the master switch (acceptance #5) ────────────────

test('pause blocks capture even when the feature is disabled', () => {
  const s = { ...base, enabled: false, paused: true }
  assert.deepEqual(decideAppCapture(s, { bundleId: 'com.foo' }), { capture: false, reason: 'paused' })
  assert.deepEqual(decideSiteCapture(s, { domain: 'x.com' }), { capture: false, reason: 'paused' })
})

// ── App exclusion (acceptance #3) ──────────────────────────────────────────────

test('app exclusion matches bundle id or app name, case-insensitively, only when enabled', () => {
  const s = { ...base, enabled: true, excludedApps: ['com.tinyspeck.slackmacgap', 'Messages'] }
  assert.equal(isAppExcluded(s, { bundleId: 'com.tinyspeck.slackmacgap' }), true)
  assert.equal(isAppExcluded(s, { appName: 'messages' }), true)
  assert.equal(isAppExcluded(s, { bundleId: 'com.apple.Safari', appName: 'Safari' }), false)
  assert.equal(decideAppCapture(s, { bundleId: 'com.tinyspeck.slackmacgap' }).reason, 'excluded_app')
  // Same lists, feature disabled → not excluded.
  assert.equal(isAppExcluded({ ...s, enabled: false }, { bundleId: 'com.tinyspeck.slackmacgap' }), false)
})

// ── Site exclusion incl. subdomains + www (acceptance #3) ──────────────────────

test('site exclusion matches the host and its subdomains, ignoring www', () => {
  const s = { ...base, enabled: true, excludedSites: ['youtube.com'] }
  assert.equal(isSiteExcluded(s, { domain: 'youtube.com' }), true)
  assert.equal(isSiteExcluded(s, { domain: 'www.youtube.com' }), true)
  assert.equal(isSiteExcluded(s, { domain: 'm.youtube.com' }), true)
  assert.equal(isSiteExcluded(s, { domain: 'notyoutube.com' }), false)
  assert.equal(isSiteExcluded(s, { domain: 'github.com' }), false)
  assert.equal(decideSiteCapture(s, { domain: 'm.youtube.com' }).reason, 'excluded_site')
})

// ── Incognito (acceptance #4) ──────────────────────────────────────────────────

test('detectIncognitoFromTitle catches common browser private markers', () => {
  assert.equal(detectIncognitoFromTitle('YouTube - Google Chrome (Incognito)'), true)
  assert.equal(detectIncognitoFromTitle('Bank - Microsoft Edge [InPrivate]'), true)
  assert.equal(detectIncognitoFromTitle('Search - Mozilla Firefox (Private Browsing)'), true)
  assert.equal(detectIncognitoFromTitle('Reddit - Google Chrome'), false)
  assert.equal(detectIncognitoFromTitle(null), false)
})

test('skipIncognito blocks private windows only when on', () => {
  const on = { ...base, enabled: true, skipIncognito: true }
  assert.equal(decideAppCapture(on, { windowTitle: 'x (Incognito)' }).reason, 'incognito')
  const off = { ...base, enabled: true, skipIncognito: false }
  assert.equal(decideAppCapture(off, { windowTitle: 'x (Incognito)' }).capture, true)
})

// ── Settings adapter defaults ──────────────────────────────────────────────────

test('trackingControlsStateFromSettings defaults to opt-in-off with incognito-skip on', () => {
  const s = trackingControlsStateFromSettings({})
  assert.deepEqual(s, { enabled: false, paused: false, excludedApps: [], excludedSites: [], skipIncognito: true })
})
