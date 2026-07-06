import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { clearTestDb, setTestDb } from './support/database-stub.mjs'
import {
  ActiveBrowserContextTracker,
  __setActiveBrowserContextTrackerForTest,
  type ActiveBrowserWindowSnapshot,
} from '../src/main/services/browserContext.ts'
import {
  __setTrackingFsmTestHarness,
  __pollForTest,
  getCurrentSession,
} from '../src/main/services/tracking.ts'

// Founder rule (2026-07-06): a private/incognito window is never tracked — no
// website visit AND no app session — regardless of the Tracking Controls
// master switch. The old gate was a window-title regex inside the opt-in
// module, which Dia (the founder's main browser) never matched; the structured
// signal is Chromium's AppleScript window mode, surfaced by the tab reader as
// `isPrivate` and consumed by the poll BEFORE any session is created.

function snapshot(overrides: Partial<ActiveBrowserWindowSnapshot> = {}): ActiveBrowserWindowSnapshot {
  return {
    bundleId: 'company.thebrowser.dia',
    appName: 'Dia',
    windowTitle: 'Some page',
    capturedAt: 1_800_000_000_000,
    ...overrides,
  }
}

test('a structured private signal records no website visit and flushes the open context', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  try {
    let priv = false
    const tracker = new ActiveBrowserContextTracker(
      () => (priv ? { url: '', title: null, isPrivate: true } : { url: 'https://canva.com/design/1', title: 'Design' }),
      () => true,
    )

    // Regular context accrues 20s, then a private window takes focus.
    assert.deepEqual(tracker.sample(db, snapshot()), { isPrivate: false })
    tracker.sample(db, snapshot({ capturedAt: 1_800_000_020_000 }))
    priv = true
    const result = tracker.sample(db, snapshot({ capturedAt: 1_800_000_040_000, windowTitle: 'Something' }))
    assert.deepEqual(result, { isPrivate: true })

    // The regular visit was flushed (ending when the private window arrived);
    // nothing about the private window was recorded.
    const rows = db.prepare('SELECT domain, duration_sec FROM website_visits').all() as
      Array<{ domain: string; duration_sec: number }>
    assert.equal(rows.length, 1)
    assert.equal(rows[0].domain, 'canva.com')

    // Steady private browsing keeps recording nothing.
    tracker.sample(db, snapshot({ capturedAt: 1_800_000_100_000 }))
    assert.equal(tracker.flush(db, 1_800_000_200_000), false, 'no private context may survive to flush')
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM website_visits').get() as { n: number }).n, 1)
  } finally {
    db.close()
  }
})

test('the private-window title fallback drops the sample even with Tracking Controls off', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  try {
    const tracker = new ActiveBrowserContextTracker(
      () => ({ url: 'https://example.com/', title: 'Example' }),
      () => true,
    )
    const result = tracker.sample(db, snapshot({ windowTitle: 'Example — Private Browsing' }))
    assert.deepEqual(result, { isPrivate: true })
    tracker.flush(db)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM website_visits').get() as { n: number }).n, 0)
  } finally {
    db.close()
  }
})

test('poll: a private window creates no app session and cuts the one before it', async () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  setTestDb(db)
  const BASE = new Date(2026, 6, 3, 10, 0, 0, 0).getTime()
  try {
    let priv = false
    // Everything is "a browser" to this tracker, and the reader scripts the
    // private flag — so the poll-level wiring is exercised without osascript.
    __setActiveBrowserContextTrackerForTest(new ActiveBrowserContextTracker(
      () => (priv ? { url: '', title: null, isPrivate: true } : { url: 'https://canva.com/x', title: 'X' }),
      () => true,
    ))
    const clock = { now: BASE, lastInput: BASE }
    __setTrackingFsmTestHarness({
      now: () => clock.now,
      idleSeconds: () => Math.max(0, (clock.now - clock.lastInput) / 1_000),
      // The window title changes when the private window takes focus (as it
      // does for a real private window), so the tracker's same-title tab-read
      // cache can't mask the switch.
      activeWindow: () => ({ title: priv ? 'Private page' : 'Some page', application: 'Dia', path: '/Applications/Dia.app', pid: 77, icon: '' }),
    })
    const poll = async (nowMs: number) => {
      clock.now = nowMs
      clock.lastInput = nowMs
      await __pollForTest()
    }

    await poll(BASE) // regular session starts
    await poll(BASE + 30_000)
    assert.ok(getCurrentSession(), 'regular browsing session is live')

    priv = true
    await poll(BASE + 60_000) // private window takes focus

    assert.equal(getCurrentSession(), null, 'no session may be live while a private window is frontmost')
    const sessions = db.prepare('SELECT app_name, start_time, end_time, ended_reason FROM app_sessions').all() as
      Array<{ app_name: string; start_time: number; end_time: number; ended_reason: string | null }>
    assert.equal(sessions.length, 1, 'only the pre-private session persists')
    assert.equal(sessions[0].ended_reason, 'incognito')
    assert.equal(sessions[0].end_time, BASE + 60_000)

    // Still private on later polls: still no session.
    await poll(BASE + 90_000)
    assert.equal(getCurrentSession(), null)
  } finally {
    __setTrackingFsmTestHarness(null)
    __setActiveBrowserContextTrackerForTest(null)
    clearTestDb()
    db.close()
  }
})
