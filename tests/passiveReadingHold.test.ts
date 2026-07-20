// The reading hold (issue #21, cause 2): a long course or reading page with
// no keyboard/mouse input is presence, not absence. The session survives the
// 5-minute away flush, is bounded by READING_HOLD_MAX_SEC, and when the cap
// trips the session ends back at the last real input — the unproven stretch
// is never counted.
import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { clearTestDb, setTestDb } from './support/database-stub.mjs'
import {
  __setTrackingFsmTestHarness,
  __pollForTest,
  getCurrentSession,
} from '../src/main/services/tracking.ts'
import {
  ActiveBrowserContextTracker,
  __setActiveBrowserContextTrackerForTest,
} from '../src/main/services/browserContext.ts'
import { passivePresenceHoldKind, READING_HOLD_MAX_SEC } from '../src/main/lib/passivePresence.ts'

interface FlushInfo {
  startTime: number
  endTime: number
  durationSeconds: number
  endedReason: string | null
  persisted: boolean
}

const DIA_WIN = {
  title: 'Supervised Machine Learning | Coursera',
  application: 'Dia',
  path: '/Applications/Dia.app',
  pid: 7331,
  icon: '',
}

const BASE = new Date(2026, 6, 3, 10, 0, 0, 0).getTime()

interface Rig {
  db: Database.Database
  flushes: FlushInfo[]
  poll: (nowMs: number, opts?: { input?: boolean }) => Promise<void>
  teardown: () => void
}

function makeRig(): Rig {
  const db = createProductionTestDatabase()
  setTestDb(db)
  const flushes: FlushInfo[] = []
  const clock = { now: BASE, lastInput: BASE }
  __setTrackingFsmTestHarness({
    platform: 'darwin',
    now: () => clock.now,
    idleSeconds: () => Math.max(0, (clock.now - clock.lastInput) / 1_000),
    activeWindow: () => DIA_WIN,
    recordFlush: (info) => flushes.push(info),
  })
  __setActiveBrowserContextTrackerForTest(new ActiveBrowserContextTracker(
    () => ({ url: 'https://www.coursera.org/learn/machine-learning', title: DIA_WIN.title, modeKnown: true }),
    () => true,
  ))
  return {
    db,
    flushes,
    poll: (nowMs, opts) => {
      clock.now = nowMs
      if (opts?.input) clock.lastInput = nowMs
      return __pollForTest()
    },
    teardown: () => {
      __setTrackingFsmTestHarness(null)
      __setActiveBrowserContextTrackerForTest(null)
      clearTestDb()
      db.close()
    },
  }
}

// Steps must stay under the sleep-gap threshold (60s) — production polls every
// 5s, and a sparser drive would read as the machine having slept.
async function pollThrough(rig: Rig, fromMs: number, toMs: number, opts: { input?: boolean } = {}): Promise<void> {
  const stepMs = 30_000
  for (let now = fromMs + stepMs; now <= toMs; now += stepMs) {
    await rig.poll(now, opts)
  }
}

test('an education domain earns a reading hold, entertainment stays media', () => {
  assert.equal(passivePresenceHoldKind({
    category: 'browsing', bundleId: 'dia', appName: 'Dia', rawAppName: 'Dia',
    windowTitle: null, passiveHold: 'reading',
  }), 'reading')
  assert.equal(passivePresenceHoldKind({
    category: 'entertainment', bundleId: 'x', appName: 'Netflix', rawAppName: 'Netflix', windowTitle: null,
  }), 'media')
  assert.equal(passivePresenceHoldKind({
    category: 'browsing', bundleId: 'dia', appName: 'Dia', rawAppName: 'Dia',
    windowTitle: 'Supervised Machine Learning | Coursera',
  }), 'reading')
  assert.equal(passivePresenceHoldKind({
    category: 'development', bundleId: 'terminal', appName: 'Terminal', rawAppName: 'Terminal',
    windowTitle: 'daylens — build',
  }), null)
})

test('a Coursera page in Dia survives well past the five-minute away flush with zero input', async () => {
  const rig = makeRig()
  try {
    await rig.poll(BASE, { input: true })
    // 20 minutes with no input — four times the away threshold.
    await pollThrough(rig, BASE, BASE + 20 * 60_000)

    const live = getCurrentSession()
    assert.ok(live, 'the study session must still be live after 20 minutes without input')
    assert.equal(live.appName, 'Dia')
    assert.equal(rig.flushes.length, 0, 'nothing may be flushed while the reading hold is active')
  } finally {
    rig.teardown()
  }
})

test('the reading hold is capped: past READING_HOLD_MAX_SEC the session ends at the last input', async () => {
  const rig = makeRig()
  try {
    await rig.poll(BASE, { input: true })
    // 10 minutes of real studying with input, then total silence.
    const lastInput = BASE + 10 * 60_000
    await pollThrough(rig, BASE, lastInput, { input: true })
    await pollThrough(rig, lastInput, lastInput + (READING_HOLD_MAX_SEC + 120) * 1_000)

    assert.equal(getCurrentSession(), null, 'the capped hold must flush as away')
    assert.equal(rig.flushes.length, 1)
    const flush = rig.flushes[0]
    assert.equal(flush.endedReason, 'away')
    assert.equal(flush.endTime, lastInput, 'the held-but-unproven stretch ends back at the last real input')
    assert.equal(flush.durationSeconds, 600)
    assert.ok(flush.persisted)
  } finally {
    rig.teardown()
  }
})
