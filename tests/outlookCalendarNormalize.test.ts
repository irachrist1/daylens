// Outlook normalization (DEV-190): one Graph event → the shared connector
// record envelope, mirroring the Google normalizer's guarantees — UTC time
// handling, all-day events as entities without a timed day signal, declined
// and cancelled events refused whole, owner/resource attendee exclusion, and
// envelope-gate validity for everything produced.
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRecordEnvelope } from '../src/main/connectors/contract.ts'
import {
  isCancelledOutlookEvent,
  isDeclinedBySelf,
  normalizeOutlookEvent,
  OUTLOOK_CALENDAR_SCOPE,
  type OutlookNormalizeContext,
} from '../src/main/connectors/outlookCalendar/normalize.ts'
import type { OutlookApiEvent } from '../src/main/connectors/outlookCalendar/api.ts'

const CONTEXT: OutlookNormalizeContext = {
  retrievedAtMs: Date.parse('2026-07-18T20:00:00Z'),
  accountLabel: 'owner@example.com',
  calendarId: 'default',
  ownerEmail: 'owner@example.com',
}

function timedEvent(overrides: Partial<OutlookApiEvent> = {}): OutlookApiEvent {
  return {
    id: 'AAMkAGI1-a-very-long-graph-identifier-0123456789abcdef0123456789abcdef',
    subject: 'Design review',
    start: { dateTime: '2026-07-17T14:00:00.0000000', timeZone: 'UTC' },
    end: { dateTime: '2026-07-17T15:00:00.0000000', timeZone: 'UTC' },
    responseStatus: { response: 'accepted' },
    attendees: [
      { emailAddress: { address: 'owner@example.com', name: 'Owner Example' }, type: 'required' },
      { emailAddress: { address: 'Ana@Example.com', name: 'Ana Silva' }, type: 'required' },
      { emailAddress: { address: 'room-4a@example.com', name: 'Room 4A' }, type: 'resource' },
      { emailAddress: { address: 'ben@example.com' }, type: 'optional' },
    ],
    ...overrides,
  }
}

test('a timed UTC event normalizes to an epoch-unambiguous envelope with a timed day signal', () => {
  const record = normalizeOutlookEvent(timedEvent(), CONTEXT)!
  assert.ok(record)
  assert.deepEqual(validateRecordEnvelope(record), [], 'the envelope passes the ingest gate')
  assert.equal(record.provenance.connectorId, 'outlook_calendar')
  assert.equal(record.provenance.permissionScope, OUTLOOK_CALENDAR_SCOPE)
  assert.equal(record.provenance.effectiveAtMs, Date.parse('2026-07-17T14:00:00Z'))
  assert.equal(record.entity.kind, 'calendar_event')
  if (record.entity.kind !== 'calendar_event') return
  assert.equal(record.entity.title, 'Design review')
  assert.equal(record.entity.startMs, Date.parse('2026-07-17T14:00:00Z'))
  assert.equal(record.entity.endMs, Date.parse('2026-07-17T15:00:00Z'))

  const day = record.daySignal!
  assert.ok(day, 'a timed event projects into the day layer')
  assert.equal(day.durationMinutes, 60)
  assert.equal(day.title, 'Design review')
  // The local date/clock of 14:00 UTC on THIS machine — derived, not assumed.
  const local = new Date(Date.parse('2026-07-17T14:00:00Z'))
  assert.equal(day.date, `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`)
  assert.equal(day.startClock, `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`)
})

test('attendees: the owner and rooms are excluded; identity is the lowercased source email', () => {
  const record = normalizeOutlookEvent(timedEvent(), CONTEXT)!
  assert.equal(record.entity.kind, 'calendar_event')
  if (record.entity.kind !== 'calendar_event') return
  assert.deepEqual(record.entity.attendees, [
    { connectorId: 'outlook_calendar:ana@example.com', displayName: 'Ana Silva' },
    { connectorId: 'outlook_calendar:ben@example.com', displayName: 'ben@example.com' },
  ])
  assert.equal(record.daySignal!.attendeeCount, 2, 'the day layer sees a COUNT, never names')
})

test('an all-day event becomes an entity for day-level recognition but never a timed day signal', () => {
  const record = normalizeOutlookEvent(timedEvent({
    isAllDay: true,
    subject: 'PTO',
    start: { dateTime: '2026-07-17T00:00:00.0000000', timeZone: 'UTC' },
    end: { dateTime: '2026-07-18T00:00:00.0000000', timeZone: 'UTC' },
    attendees: [],
  }), CONTEXT)!
  assert.ok(record, 'the all-day event still exists as an entity')
  assert.equal(record.daySignal, undefined, 'an all-day block is not a meeting slot')
  // Local midnight of the LOCAL day the person sees.
  assert.equal(record.provenance.effectiveAtMs, new Date(2026, 6, 17).getTime())
})

test('declined and cancelled events never normalize; delta "@removed" stubs read as cancelled', () => {
  assert.equal(normalizeOutlookEvent(timedEvent({ responseStatus: { response: 'declined' } }), CONTEXT), null)
  assert.equal(normalizeOutlookEvent(timedEvent({ isCancelled: true }), CONTEXT), null)
  assert.equal(normalizeOutlookEvent({ id: 'gone', '@removed': { reason: 'deleted' } }, CONTEXT), null)
  assert.equal(isDeclinedBySelf(timedEvent({ responseStatus: { response: 'Declined' } })), true)
  assert.equal(isCancelledOutlookEvent({ id: 'gone', '@removed': { reason: 'deleted' } }), true)
  assert.equal(isCancelledOutlookEvent(timedEvent()), false)
})

test('structurally unusable events are refused whole, never partially normalized', () => {
  assert.equal(normalizeOutlookEvent(timedEvent({ id: undefined }), CONTEXT), null)
  assert.equal(normalizeOutlookEvent(timedEvent({ start: undefined }), CONTEXT), null)
  assert.equal(normalizeOutlookEvent(timedEvent({ start: { dateTime: 'not-a-time', timeZone: 'UTC' } }), CONTEXT), null)
})

test('a non-UTC zone on a timed event fails validation instead of silently changing meaning', () => {
  // The adapter requests Prefer: outlook.timezone="UTC"; a different zone
  // means the shape changed under us (connectors.md §Failure behavior).
  assert.equal(
    normalizeOutlookEvent(timedEvent({ start: { dateTime: '2026-07-17T14:00:00.0000000', timeZone: 'Pacific Standard Time' } }), CONTEXT),
    null,
  )
})

test('an offset-qualified time parses as-is; a missing end falls back to a 30-minute slot', () => {
  const record = normalizeOutlookEvent(timedEvent({
    start: { dateTime: '2026-07-17T14:00:00+02:00', timeZone: 'UTC' },
    end: undefined,
  }), CONTEXT)!
  assert.equal(record.provenance.effectiveAtMs, Date.parse('2026-07-17T14:00:00+02:00'))
  assert.equal(record.daySignal!.durationMinutes, 30)
})

test('a blank subject becomes "Untitled event" — never an empty entity name', () => {
  const record = normalizeOutlookEvent(timedEvent({ subject: '   ' }), CONTEXT)!
  assert.equal(record.entity.kind, 'calendar_event')
  if (record.entity.kind !== 'calendar_event') return
  assert.equal(record.entity.title, 'Untitled event')
})
