// Normalization fixtures for the Google Calendar connector (DEV-188):
// recurring-event instances, declined and cancelled events, all-day events,
// timezone edges, attendee identity, and the credential gate on provider
// content. Pure functions — no database, no network.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GOOGLE_CALENDAR_SCOPE,
  isCancelledGoogleEvent,
  isDeclinedBySelf,
  normalizeGoogleEvent,
} from '../src/main/connectors/googleCalendar/normalize.ts'
import type { GoogleApiEvent } from '../src/main/connectors/googleCalendar/api.ts'
import { validateRecordEnvelope, toConnectedEvidenceEnvelope } from '../src/main/connectors/contract.ts'

const CONTEXT = { retrievedAtMs: 1_800_000_000_000, accountLabel: 'owner@example.com', calendarId: 'primary' }

function timedEvent(overrides: Partial<GoogleApiEvent> = {}): GoogleApiEvent {
  return {
    id: 'evt1',
    status: 'confirmed',
    summary: 'Planning',
    start: { dateTime: '2026-03-10T09:30:00+02:00' },
    end: { dateTime: '2026-03-10T10:30:00+02:00' },
    ...overrides,
  }
}

test('a timed event with a UTC-offset start parses to the exact epoch, regardless of machine timezone', () => {
  const record = normalizeGoogleEvent(timedEvent(), CONTEXT)!
  assert.equal(record.entity.kind, 'calendar_event')
  const expectedStart = Date.UTC(2026, 2, 10, 7, 30) // 09:30+02:00
  assert.equal(record.provenance.effectiveAtMs, expectedStart)
  if (record.entity.kind === 'calendar_event') {
    assert.equal(record.entity.startMs, expectedStart)
    assert.equal(record.entity.endMs, expectedStart + 60 * 60_000)
  }
  // The day signal renders in THIS machine's local day/clock — the same frame
  // the rest of the person's day is recorded in.
  const local = new Date(expectedStart)
  assert.equal(record.daySignal!.date,
    `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`)
  assert.equal(record.daySignal!.startClock,
    `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`)
  assert.equal(record.daySignal!.durationMinutes, 60)
  assert.deepEqual(validateRecordEnvelope(record), [])
})

test('provenance carries the full connectors.md retention set', () => {
  const record = normalizeGoogleEvent(timedEvent(), CONTEXT)!
  assert.equal(record.provenance.connectorId, 'google_calendar')
  assert.equal(record.provenance.accountLabel, 'owner@example.com')
  assert.equal(record.provenance.workspace, 'primary')
  assert.equal(record.provenance.sourceRecordId, 'evt1')
  assert.equal(record.provenance.retrievedAtMs, CONTEXT.retrievedAtMs)
  assert.equal(record.provenance.sensitivity, 'standard')
  assert.equal(record.provenance.permissionScope, GOOGLE_CALENDAR_SCOPE)
  // The evidence projection is deterministic from source identity.
  const evidence = toConnectedEvidenceEnvelope(record, 'device-1')
  assert.equal(evidence.evidenceId, 'cne:google_calendar:evt1')
})

test('recurring events arrive as instances: each keeps its own stable identity', () => {
  const first = normalizeGoogleEvent(timedEvent({
    id: '4occ2m1kfmthhwoe7c9j2d_20260310T073000Z',
    recurringEventId: '4occ2m1kfmthhwoe7c9j2d',
  }), CONTEXT)!
  const second = normalizeGoogleEvent(timedEvent({
    id: '4occ2m1kfmthhwoe7c9j2d_20260317T073000Z',
    recurringEventId: '4occ2m1kfmthhwoe7c9j2d',
    start: { dateTime: '2026-03-17T09:30:00+02:00' },
    end: { dateTime: '2026-03-17T10:30:00+02:00' },
  }), CONTEXT)!
  assert.notEqual(first.provenance.sourceRecordId, second.provenance.sourceRecordId)
  assert.notEqual(
    toConnectedEvidenceEnvelope(first, 'd').evidenceId,
    toConnectedEvidenceEnvelope(second, 'd').evidenceId,
  )
  // Google's long instance ids are opaque identity — never quarantined as
  // credential-shaped content.
  assert.deepEqual(validateRecordEnvelope(first), [])
  assert.deepEqual(validateRecordEnvelope(second), [])
})

test('an event the person declined normalizes to nothing — a meeting you said no to is not your day', () => {
  const declined = timedEvent({
    attendees: [
      { email: 'owner@example.com', self: true, responseStatus: 'declined' },
      { email: 'ana@example.com', responseStatus: 'accepted' },
    ],
  })
  assert.equal(isDeclinedBySelf(declined), true)
  assert.equal(normalizeGoogleEvent(declined, CONTEXT), null)
  // Someone ELSE declining does not remove the event from YOUR day.
  const otherDeclined = timedEvent({
    attendees: [
      { email: 'owner@example.com', self: true, responseStatus: 'accepted' },
      { email: 'ana@example.com', responseStatus: 'declined' },
    ],
  })
  assert.equal(isDeclinedBySelf(otherDeclined), false)
  assert.ok(normalizeGoogleEvent(otherDeclined, CONTEXT))
})

test('cancelled and structurally unusable events never partially normalize', () => {
  assert.equal(isCancelledGoogleEvent({ id: 'evt1', status: 'cancelled' }), true)
  assert.equal(normalizeGoogleEvent({ id: 'evt1', status: 'cancelled' }, CONTEXT), null)
  assert.equal(normalizeGoogleEvent(timedEvent({ id: undefined }), CONTEXT), null)
  assert.equal(normalizeGoogleEvent(timedEvent({ start: undefined }), CONTEXT), null)
  assert.equal(normalizeGoogleEvent(timedEvent({ start: { dateTime: 'not a date' } }), CONTEXT), null)
})

test('an all-day event is an entity on its local day but never a timed meeting slot', () => {
  const record = normalizeGoogleEvent(timedEvent({
    summary: 'Company offsite',
    start: { date: '2026-03-10' },
    end: { date: '2026-03-11' },
  }), CONTEXT)!
  // Local midnight of the LOCAL day the person sees, not a UTC re-reading.
  assert.equal(record.provenance.effectiveAtMs, new Date(2026, 2, 10).getTime())
  assert.equal(record.daySignal, undefined, 'all-day events stay out of the timed day layer')
  assert.deepEqual(validateRecordEnvelope(record), [])
})

test('attendees keep source-native identity; rooms and the account owner are excluded', () => {
  const record = normalizeGoogleEvent(timedEvent({
    attendees: [
      { email: 'Owner@Example.com', self: true, responseStatus: 'accepted' },
      { email: 'Ana.Silva@Example.com', displayName: 'Ana Silva' },
      { email: 'ben@example.com' },
      { email: 'room-4a@resource.calendar.google.com', resource: true, displayName: 'Room 4A' },
      { displayName: 'No Email' },
    ],
  }), CONTEXT)!
  assert.equal(record.entity.kind, 'calendar_event')
  if (record.entity.kind !== 'calendar_event') return
  assert.deepEqual(record.entity.attendees, [
    { connectorId: 'google_calendar:ana.silva@example.com', displayName: 'Ana Silva' },
    { connectorId: 'google_calendar:ben@example.com', displayName: 'ben@example.com' },
  ])
  assert.equal(record.daySignal!.attendeeCount, 2)
})

test('titles default honestly and an end-less event gets the conservative default duration', () => {
  const record = normalizeGoogleEvent(timedEvent({ summary: '   ', end: undefined }), CONTEXT)!
  if (record.entity.kind === 'calendar_event') assert.equal(record.entity.title, 'Untitled event')
  assert.equal(record.daySignal!.durationMinutes, 30)
})

test('credential-shaped provider content is quarantined by the shared record gate', () => {
  const record = normalizeGoogleEvent(timedEvent({
    summary: 'Sync about deploy key ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  }), CONTEXT)!
  const problems = validateRecordEnvelope(record)
  assert.ok(problems.some((problem) => problem.includes('credential-shaped')),
    'a token in provider content must quarantine the record')
})
