import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANSWER_TRANSFORM_KINDS,
  TRANSFORM_INSTRUCTIONS,
  TRANSFORM_LABELS,
  transformInstruction,
  transformKindFromLabel,
  transformLabel,
} from '../src/shared/answerTransforms.ts'

// FB7: transforms must really generate. The label↔kind mapping must round-trip so
// a retried transform re-runs as the same faithful transform, and each kind must
// carry a distinct, faithful (no re-analysis) instruction.

test('every transform kind has a label and an instruction', () => {
  for (const kind of ANSWER_TRANSFORM_KINDS) {
    assert.ok(TRANSFORM_LABELS[kind], `${kind} has a label`)
    assert.ok(TRANSFORM_INSTRUCTIONS[kind], `${kind} has an instruction`)
  }
})

test('label ↔ kind round-trips for every kind (so retries re-identify a transform)', () => {
  for (const kind of ANSWER_TRANSFORM_KINDS) {
    assert.equal(transformKindFromLabel(transformLabel(kind)), kind)
  }
})

test('transformKindFromLabel ignores ordinary messages', () => {
  assert.equal(transformKindFromLabel('What did I work on today?'), null)
  assert.equal(transformKindFromLabel('turn into a spaceship'), null)
})

test('instructions are faithful — they forbid inventing data', () => {
  for (const kind of ANSWER_TRANSFORM_KINDS) {
    assert.match(transformInstruction(kind), /never (add|invent)|only|no invented/i, `${kind} instruction is faithful`)
  }
})

test('the report transform produces a titled markdown report, not a blurb', () => {
  const report = transformInstruction('report')
  assert.match(report, /markdown/i)
  assert.match(report, /#/, 'asks for a heading')
  assert.match(report, /section/i)
})

test('instructions are distinct per kind', () => {
  const values = ANSWER_TRANSFORM_KINDS.map(transformInstruction)
  assert.equal(new Set(values).size, values.length)
})
