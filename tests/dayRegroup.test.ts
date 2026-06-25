import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDayRegroupGroups } from '../src/main/ai/dayRegroup.ts'

// The regroup parser is the safety net for AI-driven Analyze (timeline.md §3.3):
// it must extract only safe adjacent-merge groups and never scramble the day.

test('extracts consecutive merge-groups, ignores singletons', () => {
  const out = parseDayRegroupGroups('{"groups": [[0],[1],[2],[3],[4,5],[6,7,8],[9],[10]]}', 11)
  assert.deepEqual(out, [[4, 5], [6, 7, 8]])
})

test('a day with no merges yields an empty list (not null)', () => {
  assert.deepEqual(parseDayRegroupGroups('{"groups": [[0],[1],[2]]}', 3), [])
})

test('reads JSON wrapped in a markdown fence', () => {
  const out = parseDayRegroupGroups('```json\n{"groups": [[0,1]]}\n```', 2)
  assert.deepEqual(out, [[0, 1]])
})

test('reads a JSON object embedded in prose', () => {
  const out = parseDayRegroupGroups('Here you go: {"groups": [[1,2]]} — done', 3)
  assert.deepEqual(out, [[1, 2]])
})

test('drops non-consecutive groups, keeps the valid ones', () => {
  // [0,2] is not consecutive → ignored; [3,4] is a real adjacent merge → kept.
  const out = parseDayRegroupGroups('{"groups": [[0,2],[3,4]]}', 5)
  assert.deepEqual(out, [[3, 4]])
})

test('drops out-of-range indices rather than scrambling', () => {
  // 9 is out of range for a 3-block day; the pair collapses to a singleton → ignored.
  assert.deepEqual(parseDayRegroupGroups('{"groups": [[0,9]]}', 3), [])
})

test('never lets two groups overlap an index (first claim wins)', () => {
  const out = parseDayRegroupGroups('{"groups": [[0,1,2],[2,3]]}', 4)
  assert.deepEqual(out, [[0, 1, 2]])
})

test('normalizes unsorted / duplicated / stringified indices', () => {
  const out = parseDayRegroupGroups('{"groups": [["2","1",2]]}', 5)
  assert.deepEqual(out, [[1, 2]])
})

test('returns null only when there is no parseable JSON (AI unavailable)', () => {
  assert.equal(parseDayRegroupGroups('the model said nothing useful', 5), null)
})

test('malformed groups field is treated as no-merge, not a crash', () => {
  assert.equal(parseDayRegroupGroups('{"groups": "nope"}', 5), null)
  assert.deepEqual(parseDayRegroupGroups('{"groups": [42, {"a":1}, [3,4]]}', 6), [[3, 4]])
})
