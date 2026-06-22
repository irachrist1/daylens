import test from 'node:test'
import assert from 'node:assert/strict'
import { localDayBounds, shiftLocalDateString } from '../src/main/lib/localDate.ts'
import { dayBounds, shiftDateString } from '../src/renderer/lib/format.ts'

test('shiftLocalDateString uses calendar dates across DST boundaries', () => {
  assert.equal(shiftLocalDateString('2026-03-09', -1), '2026-03-08')
  assert.equal(shiftLocalDateString('2026-11-02', -1), '2026-11-01')
  assert.equal(shiftDateString('2026-03-09', -1), '2026-03-08')
  assert.equal(shiftDateString('2026-11-02', -1), '2026-11-01')
})

test('localDayBounds follows the next local midnight', () => {
  const [from, to] = localDayBounds('2026-05-12')
  const nextMidnight = new Date(2026, 4, 13).getTime()

  assert.equal(from, new Date(2026, 4, 12).getTime())
  assert.equal(to, nextMidnight)
})

test('main and renderer day bounds preserve DST-short and DST-long days', () => {
  if (process.env.TZ !== 'America/New_York') return

  for (const [date, expectedHours] of [['2026-03-08', 23], ['2026-11-01', 25]] as const) {
    const mainBounds = localDayBounds(date)
    const rendererBounds = dayBounds(date)

    assert.equal((mainBounds[1] - mainBounds[0]) / 3_600_000, expectedHours)
    assert.deepEqual(rendererBounds, mainBounds)
  }
})
