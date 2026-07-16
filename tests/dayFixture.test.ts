import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDayFixture } from './support/dayFixture.ts'

function fixtureWithRole(correctedIntentRole: unknown): unknown {
  return {
    schemaVersion: 1,
    id: 'role-contract',
    name: 'Role contract',
    date: '2026-07-01',
    timezone: 'local',
    input: { kind: 'capture-events', settings: {}, foregroundSamples: [], focusEvents: [] },
    mutations: [{
      kind: 'correctBlock',
      matchLabelIncludes: ['block'],
      correctedIntentRole,
    }],
  }
}

test('day fixtures accept only production work-intent roles', () => {
  assert.doesNotThrow(() => normalizeDayFixture(fixtureWithRole('research')))
  assert.throws(
    () => normalizeDayFixture(fixtureWithRole('anything-at-all')),
    /correctedIntentRole must be one of/,
  )
})
