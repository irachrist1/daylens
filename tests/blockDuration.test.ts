import test from 'node:test'
import assert from 'node:assert/strict'
import { blockDisplayedSpanSeconds } from '../src/shared/blockDuration.ts'

// Synthesize timestamps at known second offsets within a fixed minute.
function minuteMs(hour: number, minute: number, second = 0): number {
  // 2026-05-13 in a fixed UTC offset so the math is deterministic.
  const base = Date.UTC(2026, 4, 13, hour, minute, second)
  return base
}

test('displayed span matches the truncated clock range — 8:55:23 → 9:09:48 reads as 14m', () => {
  const block = { startTime: minuteMs(8, 55, 23), endTime: minuteMs(9, 9, 48) }
  // Clock displays "8:55" and "9:09"; user math: 14 minutes.
  assert.equal(blockDisplayedSpanSeconds(block), 14 * 60)
})

test('displayed span on whole-minute boundaries — 9:00:00 → 9:30:00 reads as 30m', () => {
  const block = { startTime: minuteMs(9, 0, 0), endTime: minuteMs(9, 30, 0) }
  assert.equal(blockDisplayedSpanSeconds(block), 30 * 60)
})

test('displayed span ignores sub-second drift — 9:00:00.500 → 9:01:00.500 reads as 1m', () => {
  const block = {
    startTime: minuteMs(9, 0, 0) + 500,
    endTime: minuteMs(9, 1, 0) + 500,
  }
  assert.equal(blockDisplayedSpanSeconds(block), 60)
})

test('displayed span floors to 1 second when start and end share a minute', () => {
  const block = { startTime: minuteMs(9, 0, 10), endTime: minuteMs(9, 0, 50) }
  // Both round to "9:00" on the clock; avoid emitting "0m" next to the range.
  assert.equal(blockDisplayedSpanSeconds(block), 1)
})
