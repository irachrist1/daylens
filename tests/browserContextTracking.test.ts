import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { ActiveBrowserContextTracker, type ActiveBrowserWindowSnapshot } from '../src/main/services/browserContext.ts'

function createDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE website_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      page_title TEXT,
      url TEXT,
      visit_time INTEGER NOT NULL,
      visit_time_us INTEGER NOT NULL DEFAULT 0,
      duration_sec INTEGER NOT NULL DEFAULT 0,
      browser_bundle_id TEXT,
      canonical_browser_id TEXT,
      browser_profile_id TEXT,
      normalized_url TEXT,
      page_key TEXT,
      source TEXT NOT NULL DEFAULT 'history',
      UNIQUE (browser_bundle_id, visit_time_us, url)
    );
  `)
  return db
}

function snapshot(overrides: Partial<ActiveBrowserWindowSnapshot> = {}): ActiveBrowserWindowSnapshot {
  return {
    bundleId: '/System/Applications/Safari.app/Contents/MacOS/Safari',
    appName: 'Safari',
    windowTitle: null,
    capturedAt: 1_800_000_000_000,
    ...overrides,
  }
}

test('frontmost Safari tab context is persisted as website evidence', () => {
  const db = createDb()
  const tracker = new ActiveBrowserContextTracker(() => ({
    url: 'https://www.youtube.com/watch?v=kJC1l4__UhE&t=2825s',
    title: "Are These Apple's Next Products? - YouTube",
  }))

  tracker.sample(db, snapshot())
  tracker.sample(db, snapshot({ capturedAt: 1_800_000_010_000 }))
  assert.equal(tracker.flush(db, 1_800_000_015_000), true)

  const row = db.prepare(`
    SELECT domain, page_title, url, duration_sec, browser_bundle_id, canonical_browser_id, browser_profile_id, source
    FROM website_visits
  `).get() as {
    domain: string
    page_title: string
    url: string
    duration_sec: number
    browser_bundle_id: string
    canonical_browser_id: string
    browser_profile_id: string
    source: string
  }

  assert.equal(row.domain, 'youtube.com')
  assert.equal(row.page_title, "Are These Apple's Next Products? - YouTube")
  assert.equal(row.url, 'https://www.youtube.com/watch?v=kJC1l4__UhE&t=2825s')
  assert.equal(row.duration_sec, 15)
  assert.equal(row.browser_bundle_id, '/System/Applications/Safari.app/Contents/MacOS/Safari')
  assert.equal(row.canonical_browser_id, 'safari')
  assert.equal(row.browser_profile_id, 'default')
  assert.equal(row.source, 'active_browser_context')
})

test('browser tab switches flush separate page visits', () => {
  const db = createDb()
  let current = {
    url: 'https://chatgpt.com/c/first',
    title: 'Planning browser tracking',
  }
  const tracker = new ActiveBrowserContextTracker(() => current)

  tracker.sample(db, snapshot({ appName: 'Google Chrome', bundleId: 'chrome.exe', capturedAt: 1_800_000_000_000 }))
  current = {
    url: 'https://github.com/irachrist1/daylens',
    title: 'irachrist1/daylens',
  }
  tracker.sample(db, snapshot({ appName: 'Google Chrome', bundleId: 'chrome.exe', capturedAt: 1_800_000_012_000 }))
  tracker.sample(db, snapshot({ appName: 'Google Chrome', bundleId: 'chrome.exe', capturedAt: 1_800_000_020_000 }))
  tracker.flush(db, 1_800_000_025_000)

  const rows = db.prepare(`
    SELECT domain, page_title, duration_sec
    FROM website_visits
    ORDER BY visit_time ASC
  `).all() as { domain: string; page_title: string; duration_sec: number }[]

  assert.deepEqual(rows, [
    { domain: 'chatgpt.com', page_title: 'Planning browser tracking', duration_sec: 12 },
    { domain: 'github.com', page_title: 'irachrist1/daylens', duration_sec: 13 },
  ])
})

