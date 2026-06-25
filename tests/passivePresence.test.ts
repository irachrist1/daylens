import test from 'node:test'
import assert from 'node:assert/strict'
import type { AppCategory } from '../src/shared/types.ts'
import { looksLikePassivePresenceSession } from '../src/main/lib/passivePresence.ts'

function s(opts: {
  category?: AppCategory
  bundleId?: string
  appName?: string
  rawAppName?: string
  windowTitle?: string | null
}) {
  return {
    category: opts.category ?? 'browsing',
    bundleId: opts.bundleId ?? 'com.example.app',
    appName: opts.appName ?? 'App',
    rawAppName: opts.rawAppName ?? opts.appName ?? 'App',
    windowTitle: opts.windowTitle ?? null,
  }
}

test('a browser Google Meet class is present, not away (the lost-class bug)', () => {
  // The real captured title from a 2h ML class that got flushed at 5 min idle.
  assert.equal(looksLikePassivePresenceSession(s({ category: 'browsing', appName: 'Dia', windowTitle: 'Meet – Machine Learning' })), true)
})

test('native meeting apps are present', () => {
  assert.equal(looksLikePassivePresenceSession(s({ category: 'meetings', bundleId: 'us.zoom.xos', appName: 'zoom.us', windowTitle: 'Zoom Meeting' })), true)
})

test('watched media stays present', () => {
  assert.equal(looksLikePassivePresenceSession(s({ category: 'entertainment', appName: 'Safari', windowTitle: 'long lecture · YouTube' })), true)
})

test('a Zoom web call is present', () => {
  assert.equal(looksLikePassivePresenceSession(s({ category: 'browsing', appName: 'Chrome', windowTitle: 'Zoom' })), true)
})

test('coding work is NOT passive presence (still flushes when truly idle)', () => {
  assert.equal(looksLikePassivePresenceSession(s({ category: 'development', appName: 'Terminal', windowTitle: 'daylens — onboarding-ux-redesign' })), false)
})

test('the word "meet" in ordinary work titles is not a false positive', () => {
  assert.equal(looksLikePassivePresenceSession(s({ category: 'writing', appName: 'Obsidian', windowTitle: 'team meeting notes.md' })), false)
  assert.equal(looksLikePassivePresenceSession(s({ category: 'productivity', appName: 'Notes', windowTitle: "let's meet up about the launch" })), false)
})
