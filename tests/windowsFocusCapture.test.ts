import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWindowsHelperEvent } from '../src/main/services/windowsFocusCapture.ts'

test('normalizeWindowsHelperEvent accepts observed chromium tab samples', () => {
  const event = normalizeWindowsHelperEvent({
    ts_ms: Date.now(),
    mono_ns: 123,
    event_type: 'tab_sampled',
    app_bundle_id: 'msedge.exe',
    app_name: 'msedge',
    pid: 42,
    window_title: 'GitHub',
    url: 'https://github.com/',
    page_title: 'GitHub',
    source: 'uia_tab',
    confidence: 'observed',
    platform: 'win32',
    schema_ver: 1,
  })

  assert.ok(event)
  assert.equal(event?.source, 'uia_tab')
  assert.equal(event?.url, 'https://github.com/')
})

test('normalizeWindowsHelperEvent rejects unknown tab events that carry a url', () => {
  const event = normalizeWindowsHelperEvent({
    ts_ms: Date.now(),
    mono_ns: 123,
    event_type: 'tab_sampled',
    app_bundle_id: 'zen.exe',
    app_name: 'zen',
    pid: 42,
    window_title: 'Example',
    url: 'https://example.com/',
    page_title: 'Example',
    source: 'uia_tab',
    confidence: 'unknown',
    platform: 'win32',
    schema_ver: 1,
  })

  assert.equal(event, null)
})

test('normalizeWindowsHelperEvent accepts foreground window changes without urls', () => {
  const event = normalizeWindowsHelperEvent({
    ts_ms: Date.now(),
    mono_ns: 123,
    event_type: 'window_changed',
    app_bundle_id: 'Code.exe',
    app_name: 'Code',
    pid: 7,
    window_title: 'settings.ts — daylens',
    source: 'uia_foreground',
    confidence: 'observed',
    platform: 'win32',
    schema_ver: 1,
  })

  assert.ok(event)
  assert.equal(event?.source, 'uia_foreground')
  assert.equal(event?.url, null)
})
