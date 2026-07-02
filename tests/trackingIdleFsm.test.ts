import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { clearTestDb, setTestDb } from './support/database-stub.mjs'
import {
  __setTrackingFsmTestHarness,
  __pollForTest,
} from '../src/main/services/tracking.ts'

// These tests drive the idle/session finite-state machine in tracking.ts through
// a scripted clock + idle timer + canned active window (the __setTrackingFsmTestHarness
// seam). They reproduce the "brief post-away sitting writes no app_sessions row"
// defect: a session's start is stamped from poll wall-clock while its away/idle
// end is derived from the true last-input time, so the end could predate the start
// and the session was silently discarded. See tracking.ts flushCurrent + the
// return-from-idle start restamp.

interface FlushInfo {
  startTime: number
  endTime: number
  durationSeconds: number
  endedReason: string | null
  persisted: boolean
}

// A neutral, non-browser, non-passive, non-excluded app so the FSM captures it
// like any ordinary foreground session.
const WIN = {
  title: 'Draft notes',
  application: 'TextEdit',
  path: '/Applications/TextEdit.app',
  pid: 4321,
  icon: '',
}

// All timestamps live inside one local calendar day so no midnight split fires.
const BASE = new Date(2026, 6, 3, 10, 0, 0, 0).getTime()

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  setTestDb(db)
  return db
}

interface Rig {
  db: Database.Database
  flushes: FlushInfo[]
  /** Drive one poll at wall-clock `nowMs`. `input` marks real user input at this instant. */
  poll: (nowMs: number, opts?: { input?: boolean }) => Promise<void>
  /** Register real user input at `nowMs` without polling (input between polls). */
  input: (nowMs: number) => void
  teardown: () => void
}

function makeRig(): Rig {
  const db = setupDb()
  const flushes: FlushInfo[] = []
  const clock = { now: BASE, lastInput: BASE }
  __setTrackingFsmTestHarness({
    now: () => clock.now,
    // Idle seconds = wall-clock time since the last real input, exactly like the
    // OS idle timer the FSM reads in production.
    idleSeconds: () => Math.max(0, (clock.now - clock.lastInput) / 1_000),
    activeWindow: () => WIN,
    recordFlush: (info) => flushes.push(info),
  })
  return {
    db,
    flushes,
    poll: (nowMs, opts) => {
      clock.now = nowMs
      if (opts?.input) clock.lastInput = nowMs
      return __pollForTest()
    },
    input: (nowMs) => {
      clock.lastInput = nowMs
    },
    teardown: () => {
      __setTrackingFsmTestHarness(null)
      clearTestDb()
      db.close()
    },
  }
}

// Drive an ordinary session (S0) to a genuine "away" flush so that idleState is
// 'away' and lastFlushEndMs is set, matching the real precondition for the
// return-from-away path. Returns the wall-clock instant of S0's flushed end.
async function driveToAway(rig: Rig): Promise<number> {
  await rig.poll(BASE, { input: true }) // S0 starts, active
  await rig.poll(BASE + 60_000, { input: true }) // still active, 60s of real work
  await rig.poll(BASE + 185_000) // idle 125s → provisional_idle (held open)
  await rig.poll(BASE + 365_000) // idle 305s → away → S0 flushed
  return BASE + 60_000 // S0's input-derived end (last real input)
}

test('mechanism: no session is ever flushed with endTime < startTime (return → idle → away)', async () => {
  const rig = makeRig()
  try {
    await driveToAway(rig)

    // Single wake-touch landing *between* polls, then no further input — the shape
    // that triggered the bug. The return poll fires 1s later and observes idle≈1s,
    // so pre-fix the new session's start was stamped at the poll wall-clock
    // (touch+1000) while the away flush end was the earlier true-input time
    // (touch): end < start, and the session was silently discarded.
    const touch = BASE + 399_000
    rig.input(touch) // wake-touch between polls
    await rig.poll(touch + 1_000) // return poll, idle≈1s → new session S1 starts
    await rig.poll(touch + 126_000) // idle 126s → provisional_idle, provisionalIdleStart = touch
    await rig.poll(touch + 306_000) // idle 306s → away → S1 flushed

    // The invariant the fix guarantees: every flush has end ≥ start. Pre-fix, the
    // away flush of S1 computed end = idleStart(touch) < start(poll wall-clock),
    // so this assertion would fail.
    for (const f of rig.flushes) {
      assert.ok(
        f.endTime >= f.startTime,
        `flush end ${f.endTime} < start ${f.startTime} (reason ${f.endedReason})`,
      )
      assert.ok(f.durationSeconds >= 0, `negative duration ${f.durationSeconds}`)
    }

    // We actually exercised the collapse: the return-born S1 flushed to zero length.
    const collapsed = rig.flushes.find((f) => f.durationSeconds === 0 && !f.persisted)
    assert.ok(collapsed, 'expected the single-touch return session to collapse to 0s')
    assert.equal(collapsed?.endedReason, 'away')

    // Sessions never overlap: each flush start ≥ the previous flush end.
    for (let i = 1; i < rig.flushes.length; i++) {
      assert.ok(
        rig.flushes[i].startTime >= rig.flushes[i - 1].endTime,
        'sessions must not overlap backwards',
      )
    }
  } finally {
    rig.teardown()
  }
})

test('positive control: return + second input ~34s later writes a real short away session with input-derived bounds', async () => {
  const rig = makeRig()
  try {
    await driveToAway(rig)

    const returnTouch = BASE + 399_000
    const secondTouch = returnTouch + 34_000 // ~34s of real activity after the return
    await rig.poll(returnTouch, { input: true }) // S1 starts, input-derived start = returnTouch
    await rig.poll(secondTouch, { input: true }) // still active (idle resets), session continues
    await rig.poll(secondTouch + 125_000) // idle 125s → provisional_idle, provisionalIdleStart = secondTouch
    await rig.poll(secondTouch + 305_000) // idle 305s → away → S1 flushed

    // A real short session lands with input-derived bounds and the away reason.
    const s1 = rig.db
      .prepare(
        `SELECT start_time, end_time, duration_sec, ended_reason
         FROM app_sessions
         WHERE start_time = ?`,
      )
      .get(returnTouch) as
      | { start_time: number; end_time: number; duration_sec: number; ended_reason: string | null }
      | undefined

    assert.ok(s1, 'expected a persisted session starting at the return-input time')
    assert.equal(s1?.start_time, returnTouch, 'start is the true return-input time, not poll wall-clock')
    assert.equal(s1?.end_time, secondTouch, 'end is the input-derived idle-start (second touch)')
    assert.equal(s1?.duration_sec, 34, 'duration spans exactly the ~34s of activity')
    assert.equal(s1?.ended_reason, 'away')
  } finally {
    rig.teardown()
  }
})

test('single-touch reproduction (17:51 sitting): one wake-touch then grace then away writes NO row', async () => {
  const rig = makeRig()
  try {
    await driveToAway(rig)

    const touch = BASE + 399_000
    rig.input(touch) // lone wake-touch between polls
    await rig.poll(touch + 1_000) // return poll, idle≈1s → S1 starts
    await rig.poll(touch + 126_000) // idle 126s → provisional_idle
    await rig.poll(touch + 306_000) // idle 306s → away → S1 collapses to 0s and dies at MIN_SESSION_SEC

    // FOUNDER-PENDING POLICY DECISION: a bare wake-touch with no follow-up input
    // is intentionally NOT credited. Making these visible would mean crediting the
    // idle-grace window on away-escalation for a session with zero real activity,
    // which was rejected for now. If that policy flips, this expectation changes.
    const rows = rig.db
      .prepare(`SELECT COUNT(*) AS n FROM app_sessions WHERE start_time >= ?`)
      .get(touch) as { n: number }
    assert.equal(rows.n, 0, 'the single-touch return sitting must not write an app_sessions row')
  } finally {
    rig.teardown()
  }
})
