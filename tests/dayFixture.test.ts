import test from 'node:test'
import assert from 'node:assert/strict'
import { isKnownIssueDefect, normalizeDayFixture } from './support/dayFixture.ts'

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

test('known-issue deferrals match only the exact tracked defect', () => {
  const deferrals = [{ issue: 'DEV-214', defectSignatures: ['privacy: exact leak'] }]

  assert.equal(isKnownIssueDefect(deferrals, 'privacy: exact leak'), true)
  assert.equal(isKnownIssueDefect(deferrals, 'privacy: exact leak in another table'), false)
  assert.equal(isKnownIssueDefect(deferrals, 'privacy: different leak'), false)
})
