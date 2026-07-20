// The reference .ics calendar connector (DEV-186): the parser handles real
// RFC 5545 shapes (folded lines, escapes, UTC/floating/all-day values,
// recurrence overrides, cancellations); the adapter passes the SAME contract
// suite every future provider will run; and the end-to-end path — pick a
// file, meetings and attendees appear as entities plus day signals; edit the
// file, the diff syncs; remove an event, its derived data goes — works
// against a real temp file with no OAuth and no network.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { assertConnectorContract, OPEN_GATE } from './support/connectorContractSuite.ts'
import {
  createIcsCalendarAdapter,
  parseIcs,
  parseIcsDateValue,
} from '../src/main/connectors/icsCalendar.ts'
import { connectConnector, syncConnector } from '../src/main/connectors/service.ts'
import { getConnectorConnection, listConnectorRecords } from '../src/main/connectors/store.ts'
import { listEntities } from '../src/main/services/entities/entityRepository.ts'
import { getExternalSignal } from '../src/main/services/externalSignals.ts'
import type { CalendarSignal } from '../src/shared/types.ts'

function icsFixture(events: Array<{
  uid: string
  title: string
  start: string
  end?: string
  attendees?: Array<{ cn: string; email: string }>
  cancelled?: boolean
}>): string {
  const blocks = events.map((event) => [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `SUMMARY:${event.title}`,
    `DTSTART:${event.start}`,
    ...(event.end ? [`DTEND:${event.end}`] : []),
    ...(event.cancelled ? ['STATUS:CANCELLED'] : []),
    ...(event.attendees ?? []).map((attendee) => `ATTENDEE;CN=${attendee.cn}:mailto:${attendee.email}`),
    'END:VEVENT',
  ].join('\r\n'))
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...blocks, 'END:VCALENDAR'].join('\r\n')
}

/** Local-time DTSTART near "now" so events land inside the sync window. */
function localStamp(offsetDays: number, hour: number, minute = 0): { stamp: string; date: string; clock: string } {
  const now = new Date()
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays, hour, minute, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    stamp: `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}T${pad(at.getHours())}${pad(at.getMinutes())}00`,
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    clock: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  }
}

function tempIcsPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-ics-'))
  return path.join(dir, 'work.ics')
}

// ─── Parser ──────────────────────────────────────────────────────────────────

test('parseIcs handles folded lines, escaped text, attendees, recurrence overrides, and cancellations', () => {
  const text = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:uid-folded',
    'SUMMARY:Quarterly planning with a very long',
    '  title that was folded across lines',
    'DTSTART:20260714T140000Z',
    'DTEND:20260714T150000Z',
    'ATTENDEE;CN=Ana Silva;ROLE=REQ-PARTICIPANT:mailto:Ana@Example.com',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:uid-escaped',
    'SUMMARY:Lunch\\, then 1:1\\; notes\\nfollow',
    'DTSTART:20260714T120000',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:uid-recurring',
    'RECURRENCE-ID:20260715T090000Z',
    'SUMMARY:Standup (moved)',
    'DTSTART:20260715T093000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:uid-cancelled',
    'SUMMARY:Cancelled thing',
    'DTSTART:20260716T090000Z',
    'STATUS:CANCELLED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  const events = parseIcs(text)
  assert.equal(events.length, 4)

  const folded = events.find((event) => event.uid === 'uid-folded')!
  assert.equal(folded.title, 'Quarterly planning with a very long title that was folded across lines')
  assert.equal(folded.startMs, Date.UTC(2026, 6, 14, 14, 0, 0))
  assert.equal(folded.endMs, Date.UTC(2026, 6, 14, 15, 0, 0))
  assert.deepEqual(folded.attendees, [{ email: 'ana@example.com', displayName: 'Ana Silva' }])

  const escaped = events.find((event) => event.uid === 'uid-escaped')!
  assert.equal(escaped.title, 'Lunch, then 1:1; notes follow')
  // Floating time → local interpretation.
  assert.equal(escaped.startMs, new Date(2026, 6, 14, 12, 0, 0).getTime())

  const recurring = events.find((event) => event.uid === 'uid-recurring')!
  assert.equal(recurring.recurrenceId, '20260715T090000Z')

  assert.equal(events.find((event) => event.uid === 'uid-cancelled')!.cancelled, true)
})

test('parseIcsDateValue: UTC, floating local, and all-day DATE values', () => {
  assert.equal(parseIcsDateValue('20260714T140000Z').ms, Date.UTC(2026, 6, 14, 14, 0, 0))
  assert.equal(parseIcsDateValue('20260714T140000').ms, new Date(2026, 6, 14, 14, 0, 0).getTime())
  const allDay = parseIcsDateValue('20260714')
  assert.equal(allDay.allDay, true)
  assert.equal(allDay.ms, new Date(2026, 6, 14).getTime())
  assert.equal(parseIcsDateValue('garbage').ms, null)
})

// ─── Contract conformance (the suite every provider runs) ────────────────────

test('the .ics adapter passes the shared connector contract suite', async () => {
  const filePath = tempIcsPath()
  const a = localStamp(-1, 10)
  const b = localStamp(0, 15)
  fs.writeFileSync(filePath, icsFixture([
    { uid: 'uid-a', title: 'Kickoff', start: a.stamp, attendees: [{ cn: 'Ana Silva', email: 'ana@example.com' }] },
    { uid: 'uid-b', title: 'Retro', start: b.stamp },
  ]))
  await assertConnectorContract({
    adapter: createIcsCalendarAdapter(),
    connectInput: { config: { filePath } },
    minRecords: 2,
  })
})

// ─── End to end ──────────────────────────────────────────────────────────────

test('end to end: connect a calendar file → meetings + attendees + day signals; edits and deletions follow', async () => {
  const db = createProductionTestDatabase()
  const adapter = createIcsCalendarAdapter()
  const filePath = tempIcsPath()
  const first = localStamp(0, 9, 30)
  const second = localStamp(0, 14, 0)
  try {
    fs.writeFileSync(filePath, icsFixture([
      {
        uid: 'uid-standup', title: 'Team standup', start: first.stamp,
        attendees: [{ cn: 'Ana Silva', email: 'ana@example.com' }, { cn: 'Ben Okafor', email: 'ben@example.com' }],
      },
      { uid: 'uid-review', title: 'Design review', start: second.stamp },
    ]))

    // Connect = validate + first sync, in one user-visible step.
    const summary = await connectConnector(db, 'ics_calendar', { filePath }, { adapter, gate: OPEN_GATE })
    assert.equal(summary.status, 'ok')
    assert.equal(summary.ingested, 2)

    const connection = getConnectorConnection(db, 'ics_calendar')!
    assert.equal(connection.status, 'connected')
    assert.equal(connection.account_label, 'work.ics')
    assert.ok(connection.sync_cursor)

    // Meetings exist by SOURCE identity; attendees are people by connector id.
    const meetings = listEntities(db, { type: 'meeting' }).map((entity) => entity.name).sort()
    assert.deepEqual(meetings, ['Design review', 'Team standup'])
    const people = listEntities(db, { type: 'person' }).map((entity) => entity.name).sort()
    assert.deepEqual(people, ['Ana Silva', 'Ben Okafor'])

    // Day signal for today includes both events with clock + attendee count.
    const signal = getExternalSignal<CalendarSignal>(db, first.date, 'calendar')!
    const standup = signal.payload.events.find((event) => event.title === 'Team standup')!
    assert.equal(standup.startClock, first.clock)
    assert.equal(standup.attendeeCount, 2)

    // An unchanged file re-syncs quietly (cursor short-circuit).
    const unchanged = await syncConnector(db, 'ics_calendar', { adapter, gate: OPEN_GATE })
    assert.equal(unchanged.status, 'ok')
    assert.equal(unchanged.ingested, 0)

    // Edit: retitle one event, delete the other. Ensure mtime moves.
    await new Promise((resolve) => setTimeout(resolve, 20))
    fs.writeFileSync(filePath, icsFixture([
      {
        uid: 'uid-standup', title: 'Team standup (moved)', start: second.stamp,
        attendees: [{ cn: 'Ana Silva', email: 'ana@example.com' }],
      },
    ]))
    const resync = await syncConnector(db, 'ics_calendar', { adapter, gate: OPEN_GATE })
    assert.equal(resync.status, 'ok')
    assert.equal(resync.ingested, 1)
    assert.equal(resync.tombstoned, 1)

    const after = listEntities(db, { type: 'meeting' }).map((entity) => entity.name).sort()
    // Same UID → same entity, renamed; deleted UID → entity gone.
    assert.deepEqual(after, ['Team standup (moved)'])

    // The day layer moved with it: old clock slot gone, new one present.
    const daySignal = getExternalSignal<CalendarSignal>(db, second.date, 'calendar')!
    assert.deepEqual(
      daySignal.payload.events.map((event) => [event.title, event.startClock]),
      [['Team standup (moved)', second.clock]],
    )

    // Ledger: two live states — one active record, one tombstone.
    const rows = listConnectorRecords(db, 'ics_calendar', { includeTombstoned: true })
    assert.equal(rows.filter((row) => row.tombstoned_at == null).length, 1)
    assert.equal(rows.filter((row) => row.tombstoned_at != null).length, 1)
  } finally {
    db.close()
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true })
  }
})

test('connect refuses a missing or non-.ics file with a plain-language error', async () => {
  const adapter = createIcsCalendarAdapter()
  await assert.rejects(adapter.connect({ config: { filePath: '/nope/missing.ics' } }), /could not be read/)
  await assert.rejects(adapter.connect({ config: { filePath: '/etc/hosts' } }), /not a \.ics/)
  await assert.rejects(adapter.connect({ config: {} }), /Pick a calendar file/)
})
