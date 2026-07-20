// Day-level meeting resolution (DEV-189, closes issue #3). The acceptance
// criteria under test, quoted from the ticket:
//
//   "A day with a chaired meeting is recognized as containing that meeting
//    from captured meeting-application evidence alone, from calendar signal
//    alone, and from both together; the reconstruction never reports 'no
//    meeting signal' when either source supports one."
//
//   "Calendar-only, captured-only, and matched meetings are reported
//    separately; no calendar event becomes claimed work without supporting
//    evidence."
//
// Plus the DEV-189 legs: the Timeline day payload carries the scheduled
// context (matched events annotate their block; calendar-only events are an
// outline, never time), the wrap enrichment consumes the same resolution, and
// corrections (exclude block / exclude evidence) re-resolve the buckets
// deterministically through the existing corrections machinery.
import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import type { AppCategory, CalendarSignal } from '../src/shared/types.ts'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import {
  capturedMeetingSpansFromSessions,
  matchDayMeetings,
  parseStartClockMinutes,
  resolveDayMeetingReport,
  scheduledMeetingsFromSignal,
} from '../src/main/services/meetingResolution.ts'
import { resolveDayEnrichment } from '../src/main/services/enrichmentResolve.ts'
import { getTimelineDayPayload } from '../src/main/services/workBlocks.ts'
import { getCalendarEvents } from '../src/main/services/wrappedTools.ts'
import { applyCorrection, previewCorrection, undoCorrection } from '../src/main/services/correctionCommands.ts'
import { putExternalSignal } from '../src/main/services/externalSignals.ts'
import { indexMemoryForDay } from '../src/main/services/memoryIndex.ts'

const TEST_DATE = '2026-04-22'

function localMs(hour: number, minute = 0): number {
  return new Date(2026, 3, 22, hour, minute, 0, 0).getTime()
}

function insertSession(
  db: Database.Database,
  options: {
    appName: string
    bundleId: string
    startHour: number
    startMinute: number
    durationMinutes: number
    category: AppCategory
    title?: string
  },
): void {
  const startTime = localMs(options.startHour, options.startMinute)
  const endTime = startTime + options.durationMinutes * 60_000
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, canonical_app_id, capture_source, capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'test', 1)
  `).run(
    options.bundleId, options.appName, startTime, endTime, options.durationMinutes * 60,
    options.category, options.title ?? `${options.appName} window`, options.appName, options.bundleId,
  )
}

function insertZoom(db: Database.Database, startHour: number, startMinute: number, durationMinutes: number): void {
  insertSession(db, {
    appName: 'Zoom', bundleId: 'us.zoom.xos', startHour, startMinute, durationMinutes,
    category: 'meetings', title: 'Zoom Meeting',
  })
}

function storeCalendar(db: Database.Database, events: CalendarSignal['events']): void {
  db.prepare(`
    INSERT INTO external_signals (date, source, payload_json, captured_at)
    VALUES (?, 'calendar', ?, ?)
    ON CONFLICT(date, source) DO UPDATE SET payload_json = excluded.payload_json
  `).run(TEST_DATE, JSON.stringify({ events } satisfies CalendarSignal), Date.now())
}

// ─── Clock parsing: both stored dialects ─────────────────────────────────────

test('parseStartClockMinutes reads the connector 24-hour dialect and the local-probe 12-hour dialect', () => {
  assert.equal(parseStartClockMinutes('14:30'), 14 * 60 + 30)
  assert.equal(parseStartClockMinutes('09:05'), 9 * 60 + 5)
  assert.equal(parseStartClockMinutes('2:30pm'), 14 * 60 + 30)
  assert.equal(parseStartClockMinutes('11:15am'), 11 * 60 + 15)
  assert.equal(parseStartClockMinutes('12pm'), 12 * 60)
  assert.equal(parseStartClockMinutes('12am'), 0)
  assert.equal(parseStartClockMinutes('11am'), 11 * 60)
  assert.equal(parseStartClockMinutes('25:00'), null)
  assert.equal(parseStartClockMinutes('13pm'), null)
  assert.equal(parseStartClockMinutes('noon'), null)
  assert.equal(parseStartClockMinutes(undefined), null)
})

// ─── Issue #3: never "no meeting signal" when either source supports one ─────

test('a chaired meeting is recognized from captured meeting-app evidence ALONE (the 2026-07-16 failure case)', () => {
  const db = createProductionTestDatabase()
  try {
    // A multi-hour chaired meeting in a dedicated meeting app — no calendar
    // source connected at all.
    insertZoom(db, 13, 0, 75)
    insertZoom(db, 14, 20, 70) // reconnect after a 5-minute break: same meeting sitting

    const report = resolveDayMeetingReport(db, TEST_DATE)
    assert.ok(report, 'the day never reports "no meeting signal" when captured evidence supports one')
    assert.equal(report!.capturedOnlyCount, 1)
    assert.equal(report!.matchedCount, 0)
    assert.equal(report!.calendarOnlyCount, 0)
    const meeting = report!.meetings[0]
    assert.equal(meeting.attendance, 'captured_only')
    assert.equal(meeting.appName, 'Zoom')
    assert.equal(meeting.observedSeconds, (75 + 70) * 60, 'the two sittings coalesced into one meeting')
    assert.equal(meeting.observedStartMs, localMs(13, 0))
    assert.equal(meeting.scheduledStartMs, null, 'nothing scheduled is invented for it')
  } finally {
    db.close()
  }
})

test('a meeting is recognized from calendar signal ALONE — as scheduled context, never as attended work', () => {
  const db = createProductionTestDatabase()
  try {
    storeCalendar(db, [{ title: 'Quarterly planning', startClock: '10:00', durationMinutes: 60, attendeeCount: 4 }])

    const report = resolveDayMeetingReport(db, TEST_DATE)
    assert.ok(report, 'calendar signal alone still yields a meeting report')
    assert.equal(report!.calendarOnlyCount, 1)
    assert.equal(report!.matchedCount, 0)
    assert.equal(report!.capturedOnlyCount, 0)
    const meeting = report!.meetings[0]
    assert.equal(meeting.attendance, 'calendar_only')
    assert.equal(meeting.title, 'Quarterly planning')
    assert.equal(meeting.observedSeconds, null, 'no observed time is claimed without evidence')
  } finally {
    db.close()
  }
})

test('scheduled + captured evidence together match into an attended meeting', () => {
  const db = createProductionTestDatabase()
  try {
    storeCalendar(db, [{ title: 'Design review', startClock: '14:00', durationMinutes: 60, attendeeCount: 3 }])
    insertZoom(db, 13, 58, 66) // joined two minutes early, ran four over

    const report = resolveDayMeetingReport(db, TEST_DATE)!
    assert.equal(report.matchedCount, 1)
    assert.equal(report.calendarOnlyCount, 0)
    assert.equal(report.capturedOnlyCount, 0)
    const meeting = report.meetings[0]
    assert.equal(meeting.attendance, 'matched')
    assert.equal(meeting.title, 'Design review')
    assert.equal(meeting.scheduledMinutes, 60)
    assert.equal(meeting.observedSeconds, 66 * 60, 'observed time is the captured truth, not the scheduled plan')
    assert.equal(meeting.appName, 'Zoom')
  } finally {
    db.close()
  }
})

test('the three buckets are reported separately on one day', () => {
  const db = createProductionTestDatabase()
  try {
    storeCalendar(db, [
      { title: 'Standup', startClock: '09:30', durationMinutes: 15, attendeeCount: 5 },       // will match
      { title: 'Skipped 1:1', startClock: '16:00', durationMinutes: 30, attendeeCount: 1 },   // no evidence
    ])
    insertZoom(db, 9, 28, 18)  // supports the standup
    insertZoom(db, 12, 0, 45)  // an ad-hoc call no calendar knows about

    const report = resolveDayMeetingReport(db, TEST_DATE)!
    assert.equal(report.matchedCount, 1)
    assert.equal(report.calendarOnlyCount, 1)
    assert.equal(report.capturedOnlyCount, 1)
    const byAttendance = new Map(report.meetings.map((meeting) => [meeting.attendance, meeting]))
    assert.equal(byAttendance.get('matched')!.title, 'Standup')
    assert.equal(byAttendance.get('calendar_only')!.title, 'Skipped 1:1')
    assert.equal(byAttendance.get('captured_only')!.appName, 'Zoom')
  } finally {
    db.close()
  }
})

test('a day with neither source resolves to null — an honest nothing, not an invented meeting', () => {
  const db = createProductionTestDatabase()
  try {
    insertSession(db, {
      appName: 'Ghostty', bundleId: 'com.mitchellh.ghostty',
      startHour: 9, startMinute: 0, durationMinutes: 120, category: 'development',
    })
    assert.equal(resolveDayMeetingReport(db, TEST_DATE), null)
  } finally {
    db.close()
  }
})

// ─── Matching rules ──────────────────────────────────────────────────────────

test('a stray minute of meeting app never becomes a standalone meeting, but still supports a scheduled event', () => {
  // 6 minutes of Zoom inside a scheduled window: enough to support "you met"
  // (call presence), but the same 6 minutes with no event stays out of the
  // report — a quick Zoom open is not a meeting on its own.
  const scheduled = scheduledMeetingsFromSignal(TEST_DATE, {
    events: [{ title: 'Checkin', startClock: '11:00', durationMinutes: 30, attendeeCount: 2 }],
  })
  const supported = matchDayMeetings(scheduled, [{
    appName: 'Zoom', startMs: localMs(11, 2), endMs: localMs(11, 8), activeSeconds: 6 * 60, blockId: null,
  }])
  assert.equal(supported.matchedCount, 1)

  const alone = matchDayMeetings([], [{
    appName: 'Zoom', startMs: localMs(11, 2), endMs: localMs(11, 8), activeSeconds: 6 * 60, blockId: null,
  }])
  assert.equal(alone.meetings.length, 0, 'six unscheduled minutes do not stand alone as a meeting')
})

test('overlapping calendar events share one captured sitting without creating additive time', () => {
  const scheduled = scheduledMeetingsFromSignal(TEST_DATE, {
    events: [
      { title: 'Sync A', startClock: '14:00', durationMinutes: 30, attendeeCount: 2 },
      { title: 'Sync B', startClock: '14:30', durationMinutes: 30, attendeeCount: 2 },
    ],
  })
  const span = { appName: 'Google Meet', startMs: localMs(14, 0), endMs: localMs(15, 0), activeSeconds: 3600, blockId: 'block-1' }
  const report = matchDayMeetings(scheduled, [span])
  assert.equal(report.matchedCount, 2, 'back-to-back events both match the one long sitting')
  assert.equal(report.capturedOnlyCount, 0, 'the shared span is claimed, not double-reported')
  assert.ok(report.meetings.every((meeting) => meeting.matchedBlockId === 'block-1'))
})

test('meeting-app sessions far apart stay separate captured meetings', () => {
  const spans = capturedMeetingSpansFromSessions([
    { id: 1, bundleId: 'us.zoom.xos', appName: 'Zoom', startTime: localMs(9, 0), endTime: localMs(9, 30), durationSeconds: 1800, category: 'meetings', isFocused: true },
    { id: 2, bundleId: 'us.zoom.xos', appName: 'Zoom', startTime: localMs(15, 0), endTime: localMs(15, 30), durationSeconds: 1800, category: 'meetings', isFocused: true },
  ])
  assert.equal(spans.length, 2)
})

// ─── Corrections through the existing machinery ──────────────────────────────

test('excluding the supporting block flips a matched meeting back to calendar-only (correction respected)', () => {
  const db = createProductionTestDatabase()
  try {
    storeCalendar(db, [{ title: 'Design review', startClock: '14:00', durationMinutes: 60, attendeeCount: 3 }])
    insertZoom(db, 14, 0, 60)
    assert.equal(resolveDayMeetingReport(db, TEST_DATE)!.matchedCount, 1)

    // The person deletes the block (exclude-block writes an 'ignored' review
    // over the block's span — the same ledger every corrected surface reads).
    db.prepare(`
      INSERT INTO timeline_block_reviews (id, block_id, date, evidence_key, review_state, original_block_json, correction_json, created_at, updated_at)
      VALUES ('rev-1', 'block-x', ?, 'k', 'ignored', ?, '{}', ?, ?)
    `).run(TEST_DATE, JSON.stringify({ startTime: localMs(14, 0), endTime: localMs(15, 0) }), Date.now(), Date.now())

    const corrected = resolveDayMeetingReport(db, TEST_DATE)!
    assert.equal(corrected.matchedCount, 0, 'the excluded evidence no longer supports attendance')
    assert.equal(corrected.calendarOnlyCount, 1, 'the event honestly falls back to scheduled context')
    assert.equal(corrected.capturedOnlyCount, 0)
  } finally {
    db.close()
  }
})

test('excluding the meeting app evidence removes a captured-only meeting (exclusion respected)', () => {
  const db = createProductionTestDatabase()
  try {
    insertZoom(db, 12, 0, 45)
    assert.equal(resolveDayMeetingReport(db, TEST_DATE)!.capturedOnlyCount, 1)

    db.prepare(`
      INSERT INTO evidence_exclusions (id, date, kind, bundle_id, app_name, domain, span_start_ms, span_end_ms, created_at)
      VALUES ('excl-1', ?, 'app', 'us.zoom.xos', 'Zoom', NULL, ?, ?, ?)
    `).run(TEST_DATE, localMs(11, 0), localMs(13, 0), Date.now())

    assert.equal(resolveDayMeetingReport(db, TEST_DATE), null, 'excluded evidence is gone from the report entirely')
  } finally {
    db.close()
  }
})

// ─── Attendance marks: attended / skipped / moved / unrelated ────────────────
// timeline.md §Meetings: "A person can mark a scheduled meeting as attended,
// skipped, moved, or unrelated." The mark is a real correction command —
// previewed, durable, undoable — and propagates to the day report, the wrap
// enrichment, search, and the agent.

test('marking a calendar-only meeting attended is explicit confirmation: matched everywhere, and undo restores it', () => {
  const db = createProductionTestDatabase()
  try {
    // putExternalSignal (not a raw INSERT) so the meeting entity is minted —
    // the same path the local calendar probe uses.
    putExternalSignal(db, TEST_DATE, 'calendar', {
      events: [{ title: 'Quarterly planning', startClock: '10:00', durationMinutes: 60, attendeeCount: 4 }],
    } satisfies CalendarSignal)
    indexMemoryForDay(db, TEST_DATE)
    assert.equal(resolveDayMeetingReport(db, TEST_DATE)!.calendarOnlyCount, 1)
    const scheduledStatement = (db.prepare(`SELECT statement FROM memory_records WHERE record_kind = 'meeting'`)
      .get() as { statement: string }).statement
    assert.match(scheduledStatement, /^Scheduled: /, 'before the mark, search says scheduled context')

    const command = {
      kind: 'mark-meeting' as const,
      date: TEST_DATE,
      meeting: { title: 'Quarterly planning', startMs: localMs(10, 0) },
      status: 'attended' as const,
    }
    const preview = previewCorrection(db, command, null)
    assert.match(preview.description, /Mark "Quarterly planning" as attended/)
    assert.ok(preview.surfaces.some((note) => /No minutes are invented/.test(note)))
    const applied = applyCorrection(db, command, null)

    // The day report — and through it the wrap and the agent — flips to matched.
    const marked = resolveDayMeetingReport(db, TEST_DATE)!
    assert.equal(marked.matchedCount, 1)
    assert.equal(marked.calendarOnlyCount, 0)
    assert.equal(marked.meetings[0].marked, 'attended')
    assert.equal(marked.meetings[0].observedSeconds, null, 'a mark never invents observed minutes')
    const enrichment = resolveDayEnrichment(db, TEST_DATE, { focusEnabled: () => false, notesEnabled: false })!
    assert.equal(enrichment.meetings!.matched, 1)

    // Search propagation: explicit confirmation upgrades the memory record.
    const upgraded = (db.prepare(`SELECT statement FROM memory_records WHERE record_kind = 'meeting'`)
      .get() as { statement: string }).statement
    assert.match(upgraded, /^Meeting: /, 'the confirmation reaches exact search')

    // Undo restores the ledger AND the search statement.
    const undone = undoCorrection(db, applied.correctionId)
    assert.equal(undone.undone, true)
    assert.equal(resolveDayMeetingReport(db, TEST_DATE)!.calendarOnlyCount, 1)
    const restored = (db.prepare(`SELECT statement FROM memory_records WHERE record_kind = 'meeting'`)
      .get() as { statement: string }).statement
    assert.match(restored, /^Scheduled: /, 'undo removes the confirmation everywhere')
  } finally {
    db.close()
  }
})

test('marking a matched meeting unrelated releases its evidence: calendar-only again, the call stands on its own', () => {
  const db = createProductionTestDatabase()
  try {
    putExternalSignal(db, TEST_DATE, 'calendar', {
      events: [{ title: 'Design review', startClock: '14:00', durationMinutes: 60, attendeeCount: 3 }],
    } satisfies CalendarSignal)
    insertZoom(db, 14, 0, 60)
    assert.equal(resolveDayMeetingReport(db, TEST_DATE)!.matchedCount, 1)

    applyCorrection(db, {
      kind: 'mark-meeting',
      date: TEST_DATE,
      meeting: { title: 'Design review', startMs: localMs(14, 0) },
      status: 'unrelated',
    }, null)

    const corrected = resolveDayMeetingReport(db, TEST_DATE)!
    assert.equal(corrected.matchedCount, 0, 'the person says the Zoom time was not this meeting')
    assert.equal(corrected.calendarOnlyCount, 1)
    assert.equal(corrected.capturedOnlyCount, 1, 'the real call still exists, on its own')
    assert.equal(corrected.meetings.find((m) => m.attendance === 'calendar_only')!.marked, 'unrelated')

    // The Timeline payload carries the mark and drops the block annotation.
    const payload = getTimelineDayPayload(db, TEST_DATE, null, { materialize: true })
    const scheduled = payload.scheduledMeetings!.find((m) => m.title === 'Design review')!
    assert.equal(scheduled.attendance, 'calendar_only')
    assert.equal(scheduled.marked, 'unrelated')
    assert.equal(scheduled.matchedBlockId, null)
  } finally {
    db.close()
  }
})

test('a mark survives a calendar re-sync (reprojection cannot overwrite a correction)', () => {
  const db = createProductionTestDatabase()
  try {
    putExternalSignal(db, TEST_DATE, 'calendar', {
      events: [{ title: 'Standup', startClock: '09:30', durationMinutes: 15, attendeeCount: 5 }],
    } satisfies CalendarSignal)
    applyCorrection(db, {
      kind: 'mark-meeting',
      date: TEST_DATE,
      meeting: { title: 'Standup', startMs: localMs(9, 30) },
      status: 'skipped',
    }, null)
    // The connector re-syncs and rewrites the day signal (same event identity).
    putExternalSignal(db, TEST_DATE, 'calendar', {
      events: [{ title: 'Standup', startClock: '09:30', durationMinutes: 15, attendeeCount: 5 }],
    } satisfies CalendarSignal)
    const report = resolveDayMeetingReport(db, TEST_DATE)!
    assert.equal(report.meetings[0].marked, 'skipped')
    assert.equal(report.matchedCount, 0)
  } finally {
    db.close()
  }
})

test('marking a meeting that is no longer on the day fails whole, with plain guidance', () => {
  const db = createProductionTestDatabase()
  try {
    storeCalendar(db, [{ title: 'Standup', startClock: '09:30', durationMinutes: 15, attendeeCount: 5 }])
    assert.throws(
      () => applyCorrection(db, {
        kind: 'mark-meeting',
        date: TEST_DATE,
        meeting: { title: 'Vanished', startMs: localMs(9, 30) },
        status: 'attended',
      }, null),
      /not on this day anymore/,
    )
  } finally {
    db.close()
  }
})

// ─── The consuming surfaces ──────────────────────────────────────────────────

test('the wrap enrichment carries the three buckets — a captured-only day is no longer meetings:null', () => {
  const db = createProductionTestDatabase()
  try {
    // The failure case: a chaired meeting with meeting apps among the day's
    // largest totals, and NO calendar. The old calendar-only resolveMeetings
    // returned null here.
    insertZoom(db, 13, 0, 150)
    const enrichment = resolveDayEnrichment(db, TEST_DATE, { focusEnabled: () => false, notesEnabled: false })
    assert.ok(enrichment?.meetings, 'the wrap writer sees the meeting')
    assert.equal(enrichment!.meetings!.count, 1)
    assert.equal(enrichment!.meetings!.capturedOnly, 1)
    assert.equal(enrichment!.meetings!.matched, 0)
    assert.equal(enrichment!.meetings!.calendarOnly, 0)
    const item = enrichment!.meetings!.items[0]
    assert.equal(item.attendance, 'captured_only')
    assert.equal(item.scheduled, null, 'no scheduled length is invented')
    assert.equal(item.observed, '2h 30m')
  } finally {
    db.close()
  }
})

test('the wrap enrichment separates matched from calendar-only and keeps titles sanitized', () => {
  const db = createProductionTestDatabase()
  try {
    storeCalendar(db, [
      { title: 'Design review at 2pm', startClock: '14:00', durationMinutes: 60, attendeeCount: 3 },
      { title: 'Skipped 1:1', startClock: '16:30', durationMinutes: 30, attendeeCount: 1 },
    ])
    insertZoom(db, 14, 0, 55)
    const enrichment = resolveDayEnrichment(db, TEST_DATE, { focusEnabled: () => false, notesEnabled: false })!
    const meetings = enrichment.meetings!
    assert.equal(meetings.count, 2)
    assert.equal(meetings.matched, 1)
    assert.equal(meetings.calendarOnly, 1)
    const matched = meetings.items.find((item) => item.attendance === 'matched')!
    assert.equal(matched.title, 'Design review at', 'the embedded clock time is stripped, as ever')
    assert.equal(matched.scheduled, '1h')
    assert.equal(matched.observed, '55m')
    const calendarOnly = meetings.items.find((item) => item.attendance === 'calendar_only')!
    assert.equal(calendarOnly.observed, null)
  } finally {
    db.close()
  }
})

test('the Timeline day payload: matched events annotate their meeting block; calendar-only events are context, never time', () => {
  const db = createProductionTestDatabase()
  try {
    storeCalendar(db, [
      { title: 'Design review', startClock: '14:00', durationMinutes: 60, attendeeCount: 3 },
      { title: 'Never attended', startClock: '18:00', durationMinutes: 30, attendeeCount: 2 },
    ])
    insertZoom(db, 14, 0, 60)
    insertSession(db, {
      appName: 'Ghostty', bundleId: 'com.mitchellh.ghostty',
      startHour: 9, startMinute: 0, durationMinutes: 90, category: 'development',
    })

    const payload = getTimelineDayPayload(db, TEST_DATE, null, { materialize: true })
    const scheduled = payload.scheduledMeetings ?? []
    assert.equal(scheduled.length, 2)

    const matched = scheduled.find((meeting) => meeting.title === 'Design review')!
    assert.equal(matched.attendance, 'matched')
    assert.ok(matched.matchedBlockId, 'the matched event names its supporting block')
    const block = payload.blocks.find((candidate) => candidate.id === matched.matchedBlockId)
    assert.ok(block, 'and that block exists in the same payload')
    assert.equal(block!.dominantCategory, 'meetings')

    const ghost = scheduled.find((meeting) => meeting.title === 'Never attended')!
    assert.equal(ghost.attendance, 'calendar_only')
    assert.equal(ghost.matchedBlockId, null)
    assert.ok(
      !payload.blocks.some((candidate) => candidate.startTime >= localMs(18, 0) && candidate.endTime <= localMs(18, 30)),
      'the calendar-only event created no block',
    )
    // The #3/#21 rule as arithmetic: totals are captured activity only.
    const sessionSeconds = payload.sessions.reduce((sum, session) => sum + session.durationSeconds, 0)
    assert.ok(payload.totalSeconds <= sessionSeconds, 'scheduled context adds no seconds to the day')
  } finally {
    db.close()
  }
})

test('the agent tool reports the buckets and never answers "no meeting signal" on a captured-only day', async () => {
  const db = createProductionTestDatabase()
  try {
    insertZoom(db, 13, 0, 90)
    const result = await getCalendarEvents({ date: TEST_DATE }, db, { allowCollect: false })
    assert.ok(result, 'captured evidence alone is a meeting signal for the agent')
    assert.deepEqual(result!.events, [], 'no calendar events are invented')
    assert.equal(result!.meetingReport!.capturedOnlyCount, 1)
  } finally {
    db.close()
  }
})
