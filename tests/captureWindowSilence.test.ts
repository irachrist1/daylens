import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { clearTestDb, setTestDb } from './support/database-stub.mjs'
import {
  FOREGROUND_WINDOW_SILENCE_MS,
  __pollForTest,
  __setTrackingFsmTestHarness,
  trackingStatus,
} from '../src/main/services/tracking.ts'

const BASE = new Date(2026, 8, 9, 10, 0, 0, 0).getTime()
const LIVE_TICK_MS = 30_000

const WIN = {
  title: 'daylens',
  application: 'Ghostty',
  path: '/Applications/Ghostty.app',
  pid: 4242,
  icon: '',
}

async function pollLiveEmptyTicks(clock: { now: number }, fromMs: number, untilOffsetMs: number): Promise<void> {
  for (let offset = LIVE_TICK_MS; offset <= untilOffsetMs; offset += LIVE_TICK_MS) {
    clock.now = fromMs + offset
    await __pollForTest()
  }
}

test('15 minutes of empty foreground polls records capture_failed', async () => {
  const db = createProductionTestDatabase()
  setTestDb(db)
  const clock = { now: BASE }
  trackingStatus.pollError = null
  __setTrackingFsmTestHarness({
    platform: 'darwin',
    now: () => clock.now,
    idleSeconds: () => 0,
    activeWindow: () => clock.now === BASE ? WIN : null,
  })

  try {
    await __pollForTest()
    assert.equal(trackingStatus.pollError, null, 'the first successful window is healthy')

    await pollLiveEmptyTicks(clock, BASE, FOREGROUND_WINDOW_SILENCE_MS - LIVE_TICK_MS)
    assert.equal(trackingStatus.pollError, null, 'empty polls inside the 15-minute window stay quiet')

    clock.now = BASE + FOREGROUND_WINDOW_SILENCE_MS + LIVE_TICK_MS
    await __pollForTest()
    assert.equal(trackingStatus.pollError, 'no foreground window for 15 minutes')

    const failed = db.prepare(
      `SELECT COUNT(*) AS c FROM focus_events WHERE event_type = 'capture_failed'`,
    ).get() as { c: number }
    assert.ok(failed.c >= 1, 'the silence must be written as capture_failed, not a healthy empty day')
  } finally {
    __setTrackingFsmTestHarness(null)
    clearTestDb()
    db.close()
  }
})

test('an overnight poll gap does not immediately count as a dead capture', async () => {
  const db = createProductionTestDatabase()
  setTestDb(db)
  const clock = { now: BASE }
  trackingStatus.pollError = null
  __setTrackingFsmTestHarness({
    platform: 'darwin',
    now: () => clock.now,
    idleSeconds: () => 0,
    activeWindow: () => clock.now === BASE ? WIN : null,
  })

  try {
    await __pollForTest()
    assert.equal(trackingStatus.pollError, null)

    // Lid-close sleep: the next tick lands hours later with no window.
    const wakeMs = BASE + 8 * 60 * 60_000
    clock.now = wakeMs
    await __pollForTest()
    assert.equal(trackingStatus.pollError, null, 'waking from sleep is not a 15-minute helper death')

    await pollLiveEmptyTicks(clock, wakeMs, FOREGROUND_WINDOW_SILENCE_MS - LIVE_TICK_MS)
    assert.equal(trackingStatus.pollError, null, 'the 15-minute clock starts at wake, not last night')

    clock.now = wakeMs + FOREGROUND_WINDOW_SILENCE_MS + LIVE_TICK_MS
    await __pollForTest()
    assert.equal(trackingStatus.pollError, 'no foreground window for 15 minutes')
  } finally {
    __setTrackingFsmTestHarness(null)
    clearTestDb()
    db.close()
  }
})
