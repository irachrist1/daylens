// Day-level meeting resolution (DEV-189, closes issue #3).
//
// A day never denies a meeting when either source supports one. This module
// combines the two independent meeting signals a day can have:
//
//   scheduled — calendar events from the stored external_signals 'calendar'
//               day layer (the Google/Outlook connectors and the local
//               calendar probe all write it)
//   captured  — foreground time in meeting applications (Zoom / Meet / Teams:
//               the 'meetings' app category), read from the SAME corrected
//               activity facts every other surface totals from
//
// …into one honest report with three buckets:
//
//   matched       — scheduled AND captured: the calendar event has supporting
//                   device evidence, so "you met" is a claim the day can back
//   calendar_only — scheduled with NO supporting evidence: scheduled context,
//                   NEVER attended work (connectors.md §Google Calendar /
//                   timeline.md §Meetings — the #3/#21 rule)
//   captured_only — real meeting-app presence with no calendar event: the
//                   meeting exists because it was observed, title or not
//
// This supersedes the calendar-only resolveMeetings path for day-level
// reporting: the wrap, the agent tools, and the Timeline all read this one
// resolution, so a chaired multi-hour meeting captured from a meeting app
// alone can never again read as "no meeting signal".
//
// Corrections apply through the existing machinery, deterministically: the
// captured spans come from queryCorrectedActivityFactsForRange, so excluding
// a block, excluding a meeting app's evidence, or re-categorizing a block
// removes (or adds) the supporting evidence and the buckets re-resolve on the
// next read — a wrong match is corrected by correcting the evidence, and the
// correction survives restart and reprojection because it lives in the
// correction ledger, not here. Deletions and exclusions are respected by
// construction for the same reason.
//
// Deterministic and pure-read: same stored signal + same corrected facts ⇒
// same report. Nothing here collects, prompts, or throws.

import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AppSession, CalendarSignal, WorkContextBlock } from '@shared/types'
import { localDayBounds } from '../lib/localDate'
import { queryCorrectedActivityFactsForRange } from '../core/query/activityFactsQuery'
import { getExternalSignal } from './externalSignals'

export type MeetingAttendance = 'matched' | 'calendar_only' | 'captured_only'

/** An explicit person-made mark on a scheduled meeting (timeline.md
 *  §Meetings: "A person can mark a scheduled meeting as attended, skipped,
 *  moved, or unrelated"). 'attended' is explicit confirmation — the spec's
 *  third way a meeting becomes "you met". The other three all mean the
 *  overlapping captured evidence (if any) is NOT this meeting. */
export type MeetingAttendanceStatus = 'attended' | 'skipped' | 'moved' | 'unrelated'

export function isMeetingAttendanceStatus(value: unknown): value is MeetingAttendanceStatus {
  return value === 'attended' || value === 'skipped' || value === 'moved' || value === 'unrelated'
}

/** One scheduled calendar event, resolved to ms epochs on its local day. */
export interface ScheduledDayMeeting {
  title: string
  startMs: number
  endMs: number
  durationMinutes: number
  attendeeCount: number | null
  /** Day-local identity (minutes-into-day + normalized title) — the key the
   *  attendance-mark ledger and the participants lookup are addressed by. */
  key: string
}

/** One contiguous stretch of meeting-app foreground evidence. */
export interface CapturedMeetingSpan {
  appName: string
  startMs: number
  endMs: number
  activeSeconds: number
  /** Set when the span was derived from a Timeline meeting block. */
  blockId: string | null
}

export interface ResolvedDayMeeting {
  attendance: MeetingAttendance
  /** The person's explicit mark on this scheduled meeting, when one exists.
   *  'attended' forces the matched bucket (explicit confirmation); the other
   *  three force calendar_only — the evidence is not this meeting. */
  marked: MeetingAttendanceStatus | null
  /** Attendee display names from the calendar source, when it carries them
   *  (the connectors do; the local probe only counts). Never leaves the
   *  evidence surfaces — the wrap sees counts, not names. */
  participants: string[]
  /** The calendar title when scheduled; the meeting app's honest label
   *  ("Zoom") when the meeting is known from captured evidence alone. */
  title: string | null
  scheduledStartMs: number | null
  scheduledEndMs: number | null
  scheduledMinutes: number | null
  observedStartMs: number | null
  observedEndMs: number | null
  observedSeconds: number | null
  attendeeCount: number | null
  /** The Timeline block whose captured evidence supports this meeting, when
   *  the captured spans were derived from blocks. */
  matchedBlockId: string | null
  /** The meeting application the captured evidence came from. */
  appName: string | null
}

export interface DayMeetingReport {
  /** Every recognized meeting, chronological (scheduled start, else observed). */
  meetings: ResolvedDayMeeting[]
  matchedCount: number
  calendarOnlyCount: number
  capturedOnlyCount: number
}

// ─── Thresholds (deterministic, versioned by code) ──────────────────────────

/** A captured span still supports a scheduled event when it starts/ends this
 *  far outside the scheduled range (calls start early and run over). */
const MATCH_PAD_MS = 10 * 60 * 1000
/** Minimum overlap for "this captured evidence supports that event". */
const MIN_MATCH_OVERLAP_MS = 5 * 60 * 1000
/** Two meeting-app sessions this close coalesce into one captured span
 *  (reconnects, a glance at notes mid-call). */
const SPAN_COALESCE_GAP_MS = 10 * 60 * 1000
/** Captured evidence with no calendar event needs this much active time to
 *  stand alone as a meeting (a 30-second Zoom open is not a meeting). */
const CAPTURED_ONLY_MIN_SECONDS = 10 * 60

// ─── Scheduled side ──────────────────────────────────────────────────────────

/** Parse the day-layer startClock, which arrives in two dialects: the
 *  connectors write 24-hour "14:30"; the local calendar probe writes 12-hour
 *  "2:30pm" / "11am". Returns minutes into the day, or null. */
export function parseStartClockMinutes(clock: unknown): number | null {
  if (typeof clock !== 'string') return null
  const match = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(clock)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2] ?? '0')
  const meridiem = match[3]?.toLowerCase() ?? null
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    hour = hour % 12
    if (meridiem === 'pm') hour += 12
  } else if (hour > 23) {
    return null
  }
  return hour * 60 + minute
}

/** The day-local identity of one scheduled event: minutes-into-day plus the
 *  normalized title. Stable across re-syncs and across BOTH calendar sources'
 *  clock dialects, so an attendance mark keeps addressing the same event. */
export function scheduledEventKey(startMinutes: number, title: string): string {
  return `${startMinutes}|${title.trim().toLowerCase()}`
}

/** The stored calendar day signal as ms-resolved scheduled meetings. */
export function scheduledMeetingsFromSignal(
  date: string,
  calendar: CalendarSignal | null | undefined,
): ScheduledDayMeeting[] {
  if (!calendar || !Array.isArray(calendar.events)) return []
  const [dayStartMs] = localDayBounds(date)
  const out: ScheduledDayMeeting[] = []
  for (const event of calendar.events) {
    if (!event || typeof event.title !== 'string') continue
    const minutes = parseStartClockMinutes(event.startClock)
    if (minutes == null) continue
    const durationMinutes = typeof event.durationMinutes === 'number' && event.durationMinutes > 0
      ? Math.round(event.durationMinutes)
      : 30
    const startMs = dayStartMs + minutes * 60_000
    out.push({
      title: event.title,
      startMs,
      endMs: startMs + durationMinutes * 60_000,
      durationMinutes,
      attendeeCount: typeof event.attendeeCount === 'number' ? event.attendeeCount : null,
      key: scheduledEventKey(minutes, event.title),
    })
  }
  return out.sort((a, b) => a.startMs - b.startMs)
}

// ─── Attendance marks (the correction ledger) ────────────────────────────────

/** Every attendance mark for the date, keyed by scheduled-event identity. */
export function getMeetingAttendanceMarks(
  db: Database.Database,
  date: string,
): Map<string, MeetingAttendanceStatus> {
  const rows = db.prepare(
    `SELECT event_key, status FROM meeting_attendance_marks WHERE date = ?`,
  ).all(date) as Array<{ event_key: string; status: string }>
  const marks = new Map<string, MeetingAttendanceStatus>()
  for (const row of rows) {
    if (isMeetingAttendanceStatus(row.status)) marks.set(row.event_key, row.status)
  }
  return marks
}

export function upsertMeetingAttendanceMark(
  db: Database.Database,
  input: { date: string; eventKey: string; status: MeetingAttendanceStatus; nowMs?: number },
): void {
  const nowMs = input.nowMs ?? Date.now()
  db.prepare(`
    INSERT INTO meeting_attendance_marks (id, date, event_key, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, event_key) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
  `).run(`mam_${randomUUID().replace(/-/g, '').slice(0, 18)}`, input.date, input.eventKey, input.status, nowMs, nowMs)
}

export function deleteMeetingAttendanceMark(
  db: Database.Database,
  input: { date: string; eventKey: string },
): void {
  db.prepare(`DELETE FROM meeting_attendance_marks WHERE date = ? AND event_key = ?`)
    .run(input.date, input.eventKey)
}

// ─── Participants (calendar-source attendee names) ───────────────────────────

/** Attendee display names per scheduled event, read from the calendar
 *  connectors' record ledger (the local probe carries counts only, so a day
 *  without connector records simply resolves to empty lists). Capped. */
const MAX_PARTICIPANTS = 8

export function scheduledParticipantsForDay(
  db: Database.Database,
  date: string,
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let rows: Array<{ envelope_json: string }> = []
  try {
    rows = db.prepare(`
      SELECT envelope_json FROM connector_records
      WHERE date = ? AND tombstoned_at IS NULL
        AND connector_id IN ('google_calendar', 'outlook_calendar')
    `).all(date) as Array<{ envelope_json: string }>
  } catch {
    return out
  }
  for (const row of rows) {
    try {
      const envelope = JSON.parse(row.envelope_json) as {
        daySignal?: { startClock?: unknown; title?: unknown }
        entity?: { kind?: string; attendees?: Array<{ displayName?: unknown }> }
      }
      const clock = envelope.daySignal?.startClock
      const title = envelope.daySignal?.title
      if (typeof title !== 'string' || envelope.entity?.kind !== 'calendar_event') continue
      const minutes = parseStartClockMinutes(clock)
      if (minutes == null) continue
      const names = (envelope.entity.attendees ?? [])
        .map((attendee) => (typeof attendee.displayName === 'string' ? attendee.displayName.trim() : ''))
        .filter(Boolean)
        .slice(0, MAX_PARTICIPANTS)
      if (names.length > 0) out.set(scheduledEventKey(minutes, title), names)
    } catch { /* one unreadable envelope never hides the rest */ }
  }
  return out
}

// ─── Captured side ───────────────────────────────────────────────────────────

/** Coalesce meeting-category sessions into contiguous captured spans. The
 *  sessions must already be CORRECTED facts — exclusions, deletions, and
 *  category corrections applied — so every correction reaches this report. */
export function capturedMeetingSpansFromSessions(sessions: readonly AppSession[]): CapturedMeetingSpan[] {
  const meetings = sessions
    .filter((session) => session.category === 'meetings' && session.durationSeconds > 0)
    .sort((a, b) => a.startTime - b.startTime)
  const spans: CapturedMeetingSpan[] = []
  let current: (CapturedMeetingSpan & { appSeconds: Map<string, number> }) | null = null
  for (const session of meetings) {
    const endMs = session.endTime ?? session.startTime + session.durationSeconds * 1000
    if (current && session.startTime - current.endMs <= SPAN_COALESCE_GAP_MS) {
      current.endMs = Math.max(current.endMs, endMs)
      current.activeSeconds += session.durationSeconds
      current.appSeconds.set(session.appName, (current.appSeconds.get(session.appName) ?? 0) + session.durationSeconds)
    } else {
      if (current) spans.push(finishSpan(current))
      current = {
        appName: session.appName,
        startMs: session.startTime,
        endMs,
        activeSeconds: session.durationSeconds,
        blockId: null,
        appSeconds: new Map([[session.appName, session.durationSeconds]]),
      }
    }
  }
  if (current) spans.push(finishSpan(current))
  return spans
}

function finishSpan(span: CapturedMeetingSpan & { appSeconds: Map<string, number> }): CapturedMeetingSpan {
  let bestApp = span.appName
  let bestSeconds = -1
  for (const [app, seconds] of span.appSeconds) {
    if (seconds > bestSeconds) { bestApp = app; bestSeconds = seconds }
  }
  return { appName: bestApp, startMs: span.startMs, endMs: span.endMs, activeSeconds: span.activeSeconds, blockId: span.blockId }
}

/** Captured spans from already-built Timeline blocks — the day payload path,
 *  so the Timeline's meeting context matches its own blocks exactly. */
export function capturedMeetingSpansFromBlocks(blocks: readonly WorkContextBlock[]): CapturedMeetingSpan[] {
  const spans: CapturedMeetingSpan[] = []
  for (const block of blocks) {
    if (block.dominantCategory !== 'meetings') continue
    const activeSeconds = block.sessions.reduce((sum, session) => sum + Math.max(0, session.durationSeconds), 0)
    spans.push({
      appName: block.topApps[0]?.appName ?? block.sessions[0]?.appName ?? 'Meeting app',
      startMs: block.startTime,
      endMs: block.endTime,
      activeSeconds: activeSeconds > 0 ? activeSeconds : Math.round((block.endTime - block.startTime) / 1000),
      blockId: block.id,
    })
  }
  return spans.sort((a, b) => a.startMs - b.startMs)
}

/** The meeting entity a scheduled event minted, for propagating an explicit
 *  attendance confirmation into the memory index (search says "Meeting:"
 *  instead of "Scheduled:"). Source-native identity first (the connector
 *  ledger row that carried the event), display-name match as the fallback
 *  for locally-probed calendars. Null when no entity exists — the mark still
 *  works everywhere else. */
export function meetingEntityIdForScheduledEvent(
  db: Database.Database,
  date: string,
  eventKey: string,
): string | null {
  try {
    const rows = db.prepare(`
      SELECT entity_id, envelope_json FROM connector_records
      WHERE date = ? AND tombstoned_at IS NULL
        AND connector_id IN ('google_calendar', 'outlook_calendar')
    `).all(date) as Array<{ entity_id: string | null; envelope_json: string }>
    for (const row of rows) {
      if (!row.entity_id) continue
      try {
        const envelope = JSON.parse(row.envelope_json) as {
          daySignal?: { startClock?: unknown; title?: unknown }
        }
        const minutes = parseStartClockMinutes(envelope.daySignal?.startClock)
        const title = envelope.daySignal?.title
        if (minutes == null || typeof title !== 'string') continue
        if (scheduledEventKey(minutes, title) === eventKey) return row.entity_id
      } catch { /* next row */ }
    }
  } catch { /* no connector ledger */ }
  const title = eventKey.split('|').slice(1).join('|')
  if (!title) return null
  try {
    const row = db.prepare(`
      SELECT id FROM entities WHERE entity_type = 'meeting' AND LOWER(canonical_name) = ? LIMIT 1
    `).get(title) as { id: string } | undefined
    return row?.id ?? null
  } catch {
    return null
  }
}

// ─── Matching ────────────────────────────────────────────────────────────────

function overlapMs(aStartMs: number, aEndMs: number, bStartMs: number, bEndMs: number): number {
  return Math.max(0, Math.min(aEndMs, bEndMs) - Math.max(aStartMs, bStartMs))
}

/**
 * The pure three-bucket resolution. Deterministic for the same inputs:
 * - each scheduled event takes the captured span with the LARGEST overlap
 *   against its padded window, when that overlap clears the floor
 * - several back-to-back events may share one captured span (one long Zoom
 *   sitting); observed time is reported per meeting, never summed here, so
 *   overlapping calendar events cannot create additive time
 * - captured spans no event claimed become captured-only meetings when they
 *   carry enough active time to stand alone
 */
export function matchDayMeetings(
  scheduled: readonly ScheduledDayMeeting[],
  captured: readonly CapturedMeetingSpan[],
  options: {
    /** Explicit person-made marks by scheduled-event key. 'attended' forces
     *  matched (explicit confirmation); skipped/moved/unrelated force
     *  calendar_only and release the evidence for other interpretations. */
    marks?: ReadonlyMap<string, MeetingAttendanceStatus>
    /** Attendee display names by scheduled-event key (calendar source). */
    participants?: ReadonlyMap<string, string[]>
  } = {},
): DayMeetingReport {
  const meetings: ResolvedDayMeeting[] = []
  const claimedSpans = new Set<CapturedMeetingSpan>()
  const marks = options.marks
  const participantsOf = (event: ScheduledDayMeeting): string[] =>
    options.participants?.get(event.key) ?? []

  for (const event of scheduled) {
    const marked = marks?.get(event.key) ?? null
    // skipped / moved / unrelated: the person says this meeting did not
    // happen here — never match, and leave any overlapping evidence free to
    // be its own captured-only meeting or support another event.
    const mayMatch = marked == null || marked === 'attended'
    let best: CapturedMeetingSpan | null = null
    let bestOverlap = 0
    if (mayMatch) {
      for (const span of captured) {
        const overlap = overlapMs(
          event.startMs - MATCH_PAD_MS,
          event.endMs + MATCH_PAD_MS,
          span.startMs,
          span.endMs,
        )
        if (overlap > bestOverlap) { best = span; bestOverlap = overlap }
      }
    }
    const evidenceSupports = best != null
      && bestOverlap >= Math.min(MIN_MATCH_OVERLAP_MS, event.durationMinutes * 60_000)
    // "Device activity, call presence, … or explicit confirmation can
    // support 'you met'" (timeline.md §Meetings): an 'attended' mark is the
    // explicit-confirmation leg and matches even without captured overlap.
    if (evidenceSupports || marked === 'attended') {
      if (evidenceSupports) claimedSpans.add(best!)
      meetings.push({
        attendance: 'matched',
        marked,
        participants: participantsOf(event),
        title: event.title,
        scheduledStartMs: event.startMs,
        scheduledEndMs: event.endMs,
        scheduledMinutes: event.durationMinutes,
        observedStartMs: evidenceSupports ? best!.startMs : null,
        observedEndMs: evidenceSupports ? best!.endMs : null,
        observedSeconds: evidenceSupports ? best!.activeSeconds : null,
        attendeeCount: event.attendeeCount,
        matchedBlockId: evidenceSupports ? best!.blockId : null,
        appName: evidenceSupports ? best!.appName : null,
      })
    } else {
      meetings.push({
        attendance: 'calendar_only',
        marked,
        participants: participantsOf(event),
        title: event.title,
        scheduledStartMs: event.startMs,
        scheduledEndMs: event.endMs,
        scheduledMinutes: event.durationMinutes,
        observedStartMs: null,
        observedEndMs: null,
        observedSeconds: null,
        attendeeCount: event.attendeeCount,
        matchedBlockId: null,
        appName: null,
      })
    }
  }

  for (const span of captured) {
    if (claimedSpans.has(span)) continue
    if (span.activeSeconds < CAPTURED_ONLY_MIN_SECONDS) continue
    meetings.push({
      attendance: 'captured_only',
      marked: null,
      participants: [],
      title: span.appName || null,
      scheduledStartMs: null,
      scheduledEndMs: null,
      scheduledMinutes: null,
      observedStartMs: span.startMs,
      observedEndMs: span.endMs,
      observedSeconds: span.activeSeconds,
      attendeeCount: null,
      matchedBlockId: span.blockId,
      appName: span.appName,
    })
  }

  meetings.sort((a, b) =>
    (a.scheduledStartMs ?? a.observedStartMs ?? 0) - (b.scheduledStartMs ?? b.observedStartMs ?? 0))

  return {
    meetings,
    matchedCount: meetings.filter((meeting) => meeting.attendance === 'matched').length,
    calendarOnlyCount: meetings.filter((meeting) => meeting.attendance === 'calendar_only').length,
    capturedOnlyCount: meetings.filter((meeting) => meeting.attendance === 'captured_only').length,
  }
}

// ─── The day-level read ──────────────────────────────────────────────────────

/**
 * The day's resolved meeting report, or null when NEITHER source has a
 * signal (no calendar events stored and no meeting-app evidence captured).
 * Never null when either source supports a meeting — the issue-#3 invariant.
 *
 * Reads stored signals and corrected facts only; never collects, never
 * throws (a malformed stored row resolves to the other source alone).
 */
export function resolveDayMeetingReport(
  db: Database.Database,
  date: string,
  options: { capturedSpans?: CapturedMeetingSpan[] } = {},
): DayMeetingReport | null {
  let scheduled: ScheduledDayMeeting[] = []
  try {
    scheduled = scheduledMeetingsFromSignal(
      date,
      getExternalSignal<CalendarSignal>(db, date, 'calendar')?.payload ?? null,
    )
  } catch { /* a malformed calendar row never hides captured evidence */ }

  let captured: CapturedMeetingSpan[] = options.capturedSpans ?? []
  if (!options.capturedSpans) {
    try {
      const [fromMs, toMs] = localDayBounds(date)
      const facts = queryCorrectedActivityFactsForRange(db, fromMs, toMs)
      captured = capturedMeetingSpansFromSessions(facts.sessions)
    } catch { /* missing capture never hides the calendar signal */ }
  }

  if (scheduled.length === 0 && captured.length === 0) return null
  let marks: Map<string, MeetingAttendanceStatus> | undefined
  let participants: Map<string, string[]> | undefined
  try { marks = getMeetingAttendanceMarks(db, date) } catch { /* pre-migration DB */ }
  try { participants = scheduledParticipantsForDay(db, date) } catch { /* no ledger */ }
  const report = matchDayMeetings(scheduled, captured, { marks, participants })
  return report.meetings.length > 0 ? report : null
}
