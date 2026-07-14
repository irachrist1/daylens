import test from 'node:test'
import assert from 'node:assert/strict'
import { validateIncrementRanges } from './moment-bench/guards.ts'

test('increment guard accepts continuous exact rows and disclosed identical merges', () => {
  const answer = [
    '| 09:00–09:30 | Work |',
    '| 09:30–11:00 | Same page (1.5h, same page) |',
    '| 11:00–11:30 | No activity |',
  ].join('\n')
  assert.deepEqual(validateIncrementRanges(answer, 30), [])
})

test('increment guard rejects oversized rows and missing intervals', () => {
  const answer = [
    '| 09:00–10:00 | Work |',
    '| 10:30–11:00 | Work |',
  ].join('\n')
  const failures = validateIncrementRanges(answer, 30)
  assert.ok(failures.some((failure) => failure.includes('60 minutes')))
  assert.ok(failures.some((failure) => failure.includes('gap or overlap')))
})
