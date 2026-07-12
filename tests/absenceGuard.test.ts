import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REAL_ABSENCE_MIN_MS,
  absenceSpannedBy,
  findRealAbsences,
  isRealAbsenceGap,
  partitionAtRealAbsences,
} from '../src/main/lib/absenceGuard.ts'

// The one deterministic absence guard (v2-ship-plan W1-A): a real absence of
// 15+ minutes with no captured activity is a boundary NO merge decision may
// cross — heuristic, AI regroup, cleanup, stored correction, or manual merge.
// These tests pin the arithmetic every merge path relies on.

const MIN = 60_000

function session(startMin: number, durationMin: number) {
  return {
    startTime: startMin * MIN,
    endTime: (startMin + durationMin) * MIN,
    durationSeconds: durationMin * 60,
  }
}

test('the 15-minute rule: 15:00 is a real absence, 14:59 is not', () => {
  assert.equal(isRealAbsenceGap(REAL_ABSENCE_MIN_MS), true)
  assert.equal(isRealAbsenceGap(REAL_ABSENCE_MIN_MS - 1), false)
  assert.equal(REAL_ABSENCE_MIN_MS, 15 * MIN)
})

test('finds every real absence between consecutive activity', () => {
  const gaps = findRealAbsences([
    session(0, 30), // 0:00–0:30
    session(45, 10), // 15-min gap 0:30–0:45 → absence (>= threshold)
    session(60, 20), // 5-min gap → not an absence
    session(180, 15), // 100-min gap 1:20–3:00 → absence
  ])
  assert.deepEqual(gaps, [
    { startMs: 30 * MIN, endMs: 45 * MIN },
    { startMs: 80 * MIN, endMs: 180 * MIN },
  ])
})

test('a sub-15-minute lull is never an absence', () => {
  assert.deepEqual(findRealAbsences([session(0, 30), session(44, 10)]), [])
  assert.equal(absenceSpannedBy([session(0, 30), session(44, 10)]), null)
})

test('unsorted and overlapping sessions cannot fake a gap', () => {
  // A long session that starts early covers the whole span even when a short
  // one ends earlier and sits later in the array.
  const gaps = findRealAbsences([
    session(50, 10), // arrives first but happens last
    { startTime: 0, endTime: 60 * MIN, durationSeconds: 3600 }, // covers everything
    session(5, 2),
  ])
  assert.deepEqual(gaps, [])
})

test('sessions with no endTime fall back to duration for coverage', () => {
  const gaps = findRealAbsences([
    { startTime: 0, endTime: null, durationSeconds: 10 * 60 }, // covers 0:00–0:10
    session(26, 5), // 16-minute hole 0:10–0:26
  ])
  assert.deepEqual(gaps, [{ startMs: 10 * MIN, endMs: 26 * MIN }])
})

test('an inflated wall-clock end cannot hide a real absence after captured activity stopped', () => {
  // Real row 1399: Dia claimed 13:07:44–13:43:24, but contained only 236s of
  // captured activity. The next session started at the stored end, so trusting
  // endTime erased a 31m44s absence from the guard.
  const start = new Date('2026-03-19T13:07:44').getTime()
  const nextStart = new Date('2026-03-19T13:43:24').getTime()
  assert.deepEqual(findRealAbsences([
    { startTime: start, endTime: nextStart, durationSeconds: 236 },
    { startTime: nextStart, endTime: nextStart + 5 * MIN, durationSeconds: 5 * 60 },
  ]), [{ startMs: start + 236_000, endMs: nextStart }])
})

test('absenceSpannedBy is the merge veto: union of blocks across a gap reports it', () => {
  const blockA = [session(0, 20), session(21, 30)]
  const blockB = [session(148, 30)] // 97-minute absence, the July 10 shape
  assert.equal(absenceSpannedBy(blockA), null)
  assert.equal(absenceSpannedBy(blockB), null)
  const spanned = absenceSpannedBy([...blockA, ...blockB])
  assert.deepEqual(spanned, { startMs: 51 * MIN, endMs: 148 * MIN })
})

test('partitionAtRealAbsences keeps contiguous runs and cuts only at the gap', () => {
  const blocks = [
    { name: 'a', sessions: [session(0, 20)] },
    { name: 'b', sessions: [session(22, 25)] },
    { name: 'c', sessions: [session(148, 20)] }, // across the absence
    { name: 'd', sessions: [session(170, 15)] },
  ]
  const runs = partitionAtRealAbsences(blocks, (block) => block.sessions)
  assert.deepEqual(runs.map((run) => run.map((block) => block.name)), [['a', 'b'], ['c', 'd']])
})

test('partition of a fully contiguous group is one run (no needless split)', () => {
  const blocks = [
    { name: 'a', sessions: [session(0, 20)] },
    { name: 'b', sessions: [session(25, 25)] },
    { name: 'c', sessions: [session(55, 20)] },
  ]
  const runs = partitionAtRealAbsences(blocks, (block) => block.sessions)
  assert.deepEqual(runs.map((run) => run.map((block) => block.name)), [['a', 'b', 'c']])
})
