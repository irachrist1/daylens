import test from 'node:test'
import assert from 'node:assert/strict'
import { inferEventType } from '../src/main/services/eventTypeInference.ts'
import type { CalendarEventSignal } from '../src/shared/types.ts'

// inferEventType: pure, deterministic classifier over signals Daylens already
// captures on CalendarEventSignal (title, attendeeCount, durationMinutes).
// No DB, no network, no AI — same input always yields the same output.

const CONFIDENCE_FLOOR = 0.5

function event(over: Partial<CalendarEventSignal>): CalendarEventSignal {
  return {
    title: 'Untitled event',
    startClock: '10am',
    durationMinutes: 30,
    attendeeCount: null,
    ...over,
  }
}

test('a course-code titled event resolves to class at high confidence', () => {
  const result = inferEventType(event({
    title: 'Machine Learning Pipeline - C1',
    durationMinutes: 75,
    attendeeCount: 40,
  }))
  assert.equal(result.type, 'class')
  assert.ok(result.confidence >= CONFIDENCE_FLOOR, `confidence ${result.confidence} should clear the floor`)
})

test('a 1:1 titled event resolves to one_on_one at high confidence', () => {
  const result = inferEventType(event({
    title: '1:1 with Sarah',
    durationMinutes: 30,
    attendeeCount: 1,
  }))
  assert.equal(result.type, 'one_on_one')
  assert.ok(result.confidence >= CONFIDENCE_FLOOR)
})

test('a proposal titled event resolves to presentation', () => {
  const result = inferEventType(event({
    title: 'SPCS cafeteria redesign proposal',
    durationMinutes: 45,
    attendeeCount: 6,
  }))
  assert.equal(result.type, 'presentation')
  assert.ok(result.confidence >= CONFIDENCE_FLOOR)
})

test('a weekly training titled event resolves to team_meeting', () => {
  const result = inferEventType(event({
    title: 'Andersen Weekly AI Training',
    durationMinutes: 60,
    attendeeCount: 12,
  }))
  assert.equal(result.type, 'team_meeting')
  assert.ok(result.confidence >= CONFIDENCE_FLOOR)
})

test('a HIIT titled event resolves to workout', () => {
  const result = inferEventType(event({
    title: 'HIIT & Prep',
    durationMinutes: 45,
    attendeeCount: null,
  }))
  assert.equal(result.type, 'workout')
  assert.ok(result.confidence >= CONFIDENCE_FLOOR)
})

test('an interview titled event resolves to interview', () => {
  const result = inferEventType(event({
    title: 'Interview: Senior Engineer candidate',
    durationMinutes: 45,
    attendeeCount: 3,
  }))
  assert.equal(result.type, 'interview')
  assert.ok(result.confidence >= CONFIDENCE_FLOOR)
})

test('a vague title with weak evidence resolves to generic, never a forced label', () => {
  const result = inferEventType(event({
    title: 'Catch up',
    durationMinutes: 30,
    attendeeCount: null,
  }))
  assert.equal(result.type, 'generic')
  assert.ok(result.confidence < CONFIDENCE_FLOOR, `confidence ${result.confidence} should stay below the floor`)
})

test('a blank title with no attendee signal resolves to generic at zero confidence', () => {
  const result = inferEventType(event({ title: '', durationMinutes: 30, attendeeCount: null }))
  assert.equal(result.type, 'generic')
  assert.equal(result.confidence, 0)
})

test('a solo block with a long duration leans toward deep_work, still moderate confidence', () => {
  const result = inferEventType(event({
    title: 'Focus block',
    durationMinutes: 90,
    attendeeCount: 0,
  }))
  assert.equal(result.type, 'deep_work')
})

test('a short solo block with no keyword stays generic (too little evidence for deep_work)', () => {
  const result = inferEventType(event({
    title: 'Hold',
    durationMinutes: 10,
    attendeeCount: 0,
  }))
  assert.equal(result.type, 'generic')
  assert.ok(result.confidence < CONFIDENCE_FLOOR)
})

test('a large attendee count alone is weak evidence and does not force a class/meeting label', () => {
  const result = inferEventType(event({
    title: 'Company kickoff',
    durationMinutes: 30,
    attendeeCount: 50,
  }))
  assert.equal(result.type, 'generic')
  assert.ok(result.confidence < CONFIDENCE_FLOOR)
})

test('a recurring standing sync gets a small confidence boost from the recurrence hint', () => {
  const withoutHint = inferEventType(event({ title: 'Design sync', durationMinutes: 30, attendeeCount: 4 }))
  const withHint = inferEventType(event({ title: 'Design sync', durationMinutes: 30, attendeeCount: 4 }), { isRecurring: true })
  assert.equal(withoutHint.type, 'team_meeting')
  assert.equal(withHint.type, 'team_meeting')
  assert.ok(withHint.confidence >= withoutHint.confidence)
})

test('is a pure function: identical input always yields identical output', () => {
  const input = event({ title: 'Interview with the design team', durationMinutes: 60, attendeeCount: 4 })
  const a = inferEventType(input)
  const b = inferEventType(input)
  assert.deepEqual(a, b)
})

test('never throws on a malformed event and returns generic', () => {
  const malformed = { title: undefined, durationMinutes: 'nope', attendeeCount: 'lots' } as unknown as CalendarEventSignal
  const result = inferEventType(malformed)
  assert.equal(result.type, 'generic')
  assert.equal(result.confidence, 0)
})
