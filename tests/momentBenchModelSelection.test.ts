import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveBenchModel } from './moment-bench/modelSelection.ts'

test('terminal bench model aliases resolve to Settings model ids', () => {
  assert.equal(resolveBenchModel('haiku')?.model, 'claude-haiku-4-5')
  assert.equal(resolveBenchModel('sonnet')?.model, 'claude-sonnet-5')
  assert.equal(resolveBenchModel('opus')?.model, 'claude-opus-4-8')
  assert.equal(resolveBenchModel('current'), null)
})

test('terminal bench rejects ambiguous model names', () => {
  assert.throws(() => resolveBenchModel('fastest'), /Unknown bench model/)
})
