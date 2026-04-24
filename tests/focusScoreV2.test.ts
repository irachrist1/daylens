import test from 'node:test'
import assert from 'node:assert/strict'
import { computeFocusScoreV2 } from '../src/main/lib/focusScore.ts'

function session(startMin: number, durationMin: number, category = 'development') {
  const startTime = startMin * 60_000
  return {
    startTime,
    endTime: startTime + durationMin * 60_000,
    durationSeconds: durationMin * 60,
    category,
    isFocused: ['development', 'design', 'writing', 'research'].includes(category),
  }
}

test('computeFocusScoreV2 returns null when there is not enough active data', () => {
  const breakdown = computeFocusScoreV2({ sessions: [], totalActiveSeconds: 0 })

  assert.equal(breakdown.deepWorkPct, null)
  assert.equal(breakdown.longestStreakSeconds, 0)
  assert.equal(breakdown.switchCount, 0)
  assert.equal(breakdown.deepWorkSessionCount, 0)
})

test('computeFocusScoreV2 gives a single 25 minute focused session 100 percent', () => {
  const breakdown = computeFocusScoreV2({
    sessions: [session(0, 25, 'development')],
    totalActiveSeconds: 25 * 60,
  })

  assert.equal(breakdown.deepWorkPct, 100)
  assert.equal(breakdown.longestStreakSeconds, 25 * 60)
  assert.equal(breakdown.deepWorkSessionCount, 1)
})

test('computeFocusScoreV2 reports null score below 30 minutes without deep work', () => {
  const breakdown = computeFocusScoreV2({
    sessions: [session(0, 20, 'development')],
    totalActiveSeconds: 20 * 60,
  })

  assert.equal(breakdown.deepWorkPct, null)
  assert.equal(breakdown.longestStreakSeconds, 0)
})

test('computeFocusScoreV2 breaks a streak on interruption', () => {
  const breakdown = computeFocusScoreV2({
    sessions: [
      session(0, 20, 'development'),
      session(20, 5, 'communication'),
      session(25, 20, 'development'),
    ],
    totalActiveSeconds: 45 * 60,
  })

  assert.equal(breakdown.deepWorkPct, 0)
  assert.equal(breakdown.longestStreakSeconds, 0)
  assert.equal(breakdown.deepWorkSessionCount, 0)
  assert.equal(breakdown.switchCount, 2)
})

test('computeFocusScoreV2 breaks a streak on focused category change', () => {
  const breakdown = computeFocusScoreV2({
    sessions: [
      session(0, 20, 'development'),
      session(20, 20, 'design'),
    ],
    totalActiveSeconds: 40 * 60,
  })

  assert.equal(breakdown.deepWorkPct, 0)
  assert.equal(breakdown.longestStreakSeconds, 0)
  assert.equal(breakdown.switchCount, 1)
})

test('computeFocusScoreV2 merges continuous same-category sessions', () => {
  const breakdown = computeFocusScoreV2({
    sessions: [
      session(0, 15, 'development'),
      session(15, 15, 'development'),
      session(30, 30, 'communication'),
    ],
    totalActiveSeconds: 60 * 60,
  })

  assert.equal(breakdown.deepWorkPct, 50)
  assert.equal(breakdown.longestStreakSeconds, 30 * 60)
  assert.equal(breakdown.deepWorkSessionCount, 1)
  assert.equal(breakdown.switchCount, 1)
})
