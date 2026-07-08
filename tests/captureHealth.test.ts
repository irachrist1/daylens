// Tests for the capture-gap honesty detector. The load-bearing case is the
// real Jul 7 incident: a long wall gap where the monotonic clock (which pauses
// during macOS sleep) shows the machine was awake-but-unrecorded for hours —
// a tracker blind spot the wrap must own, not a peaceful night's sleep.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assessCaptureHealth, type CaptureHealthInput } from '../src/main/lib/captureHealth'

// Jul 7 2026 local anchors (ms). Gap runs 00:29:05 -> 11:15:02.
const GAP_START_MS = new Date(2026, 6, 7, 0, 29, 5).getTime()
const GAP_END_MS = new Date(2026, 6, 7, 11, 15, 2).getTime()

// Monotonic seconds observed at the two edges of the real gap.
const MONO_BEFORE_S = 88_619.98
const MONO_AFTER_S = 106_578.14

function ns(seconds: number): number {
  return Math.round(seconds * 1e9)
}

test('Jul 7 blind morning: long gap with ~5h of awake time is verdicted blind', () => {
  // Dense events after the gap (mono tracking wall) so the only gap is the
  // morning one; the range ends right after capture resumes.
  const input: CaptureHealthInput = {
    edgeEvents: [
      { tsMs: GAP_START_MS, monoNs: ns(MONO_BEFORE_S) },
      { tsMs: GAP_END_MS, monoNs: ns(MONO_AFTER_S) },
      { tsMs: GAP_END_MS + 60_000, monoNs: ns(MONO_AFTER_S + 60) },
      { tsMs: GAP_END_MS + 120_000, monoNs: ns(MONO_AFTER_S + 120) },
    ],
    stateEvents: [],
    rangeStartMs: GAP_START_MS,
    rangeEndMs: GAP_END_MS + 120_000,
  }
  const report = assessCaptureHealth(input)
  assert.equal(report.coverage, 'partial')
  assert.equal(report.gaps.length, 1)
  const blind = report.gaps.find((g) => g.verdict === 'blind')
  assert.ok(blind, 'expected a blind gap')
  // awake ≈ mono delta = 17958.16s, clamped under the ~10.8h wall gap
  assert.ok(Math.abs(blind!.awakeSeconds - (MONO_AFTER_S - MONO_BEFORE_S)) < 1)
  assert.ok(report.blindSeconds > 17_000 && report.blindSeconds < 18_500)
})

test('overnight sleep: 8h wall, 5m mono advance is verdicted asleep', () => {
  const start = new Date(2026, 6, 7, 23, 0, 0).getTime()
  const end = new Date(2026, 6, 8, 7, 0, 0).getTime() // 8h later
  const input: CaptureHealthInput = {
    edgeEvents: [
      { tsMs: start, monoNs: ns(1000) },
      { tsMs: end, monoNs: ns(1000 + 5 * 60) }, // mono advanced only 5 min
    ],
    stateEvents: [],
    rangeStartMs: start,
    rangeEndMs: end,
  }
  const report = assessCaptureHealth(input)
  const gap = report.gaps[0]
  assert.equal(gap.verdict, 'asleep')
  assert.equal(report.blindSeconds, 0)
})

test('dense day with no gaps: full coverage, no blind time', () => {
  const base = new Date(2026, 6, 7, 9, 0, 0).getTime()
  const edgeEvents = []
  for (let i = 0; i <= 20; i++) {
    // one event every 10 minutes, mono tracking wall exactly
    edgeEvents.push({ tsMs: base + i * 600_000, monoNs: ns(i * 600) })
  }
  const report = assessCaptureHealth({
    edgeEvents,
    stateEvents: [],
    rangeStartMs: base,
    rangeEndMs: base + 20 * 600_000,
  })
  assert.equal(report.coverage, 'full')
  assert.equal(report.gaps.length, 0)
  assert.equal(report.blindSeconds, 0)
})

test('leading gap: a sleep state event inside means asleep', () => {
  const rangeStart = new Date(2026, 6, 7, 6, 0, 0).getTime()
  const firstEvent = new Date(2026, 6, 7, 9, 0, 0).getTime() // 3h leading gap
  const report = assessCaptureHealth({
    edgeEvents: [
      { tsMs: firstEvent, monoNs: ns(10_000) },
      { tsMs: firstEvent + 600_000, monoNs: ns(10_600) },
    ],
    stateEvents: [{ tsMs: rangeStart + 60_000, eventType: 'sleep' }],
    rangeStartMs: rangeStart,
    rangeEndMs: firstEvent + 600_000,
  })
  const leading = report.gaps.find((g) => g.startMs === rangeStart)
  assert.ok(leading)
  assert.equal(leading!.verdict, 'asleep')
})

test('leading gap: no state events means unknown', () => {
  const rangeStart = new Date(2026, 6, 7, 6, 0, 0).getTime()
  const firstEvent = new Date(2026, 6, 7, 9, 0, 0).getTime()
  const report = assessCaptureHealth({
    edgeEvents: [
      { tsMs: firstEvent, monoNs: ns(10_000) },
      { tsMs: firstEvent + 600_000, monoNs: ns(10_600) },
    ],
    stateEvents: [],
    rangeStartMs: rangeStart,
    rangeEndMs: firstEvent + 600_000,
  })
  const leading = report.gaps.find((g) => g.startMs === rangeStart)
  assert.ok(leading)
  assert.equal(leading!.verdict, 'unknown')
})

test('no events in range: coverage none', () => {
  const report = assessCaptureHealth({
    edgeEvents: [],
    stateEvents: [],
    rangeStartMs: 0,
    rangeEndMs: 10_000_000,
  })
  assert.equal(report.coverage, 'none')
  assert.equal(report.gaps.length, 0)
})

test('gap under the 45m threshold is not reported', () => {
  const base = new Date(2026, 6, 7, 9, 0, 0).getTime()
  const report = assessCaptureHealth({
    edgeEvents: [
      { tsMs: base, monoNs: ns(0) },
      { tsMs: base + 44 * 60_000, monoNs: ns(44 * 60) }, // 44 min
    ],
    stateEvents: [],
    rangeStartMs: base,
    rangeEndMs: base + 44 * 60_000,
  })
  assert.equal(report.coverage, 'full')
  assert.equal(report.gaps.length, 0)
})
