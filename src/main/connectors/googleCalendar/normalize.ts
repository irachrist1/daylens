// Normalization: one Google Calendar API event → one shared connector record
// envelope (DEV-188), the exact shape the DEV-186 ingestion path stores.
// Deliberately MINIMAL: identity, title, times, and attendees only. Meeting
// links, descriptions, and location fields are not ingested in this slice —
// they add little to memory and are where credential-shaped content
// (tokenized URLs, dial-in codes) lives.
//
// Returns null for events that must not become records:
//   - cancelled events (`status: "cancelled"`) — the ADAPTER turns these into
//     tombstones; normalize never partially ingests them
//   - events the person declined — a meeting you said no to is not scheduled
//     context for YOUR day (it also naturally tombstones on decline)
//   - structurally unusable events (no id / no parseable start)

import type { ConnectorRecordEnvelope } from '../contract'
import type { GoogleApiEvent, GoogleEventTime } from './api'

export const GOOGLE_CALENDAR_CONNECTOR_ID = 'google_calendar' as const
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

export interface NormalizeContext {
  retrievedAtMs: number
  accountLabel: string | null
  calendarId: string
}

interface ParsedTime {
  ms: number
  allDay: boolean
}

/** Google gives either an RFC3339 `dateTime` (always offset-qualified, so the
 *  epoch is unambiguous across timezones) or a `date` for all-day events,
 *  which is a LOCAL day — parsed as local midnight so it lands on the same
 *  calendar day the person sees. */
function parseEventTime(time: GoogleEventTime | undefined): ParsedTime | null {
  if (time?.dateTime) {
    const ms = Date.parse(time.dateTime)
    return Number.isFinite(ms) ? { ms, allDay: false } : null
  }
  if (time?.date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(time.date)
    if (!match) return null
    const ms = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
    return Number.isFinite(ms) ? { ms, allDay: true } : null
  }
  return null
}

function localDateOf(ms: number): string {
  const at = new Date(ms)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

function localClockOf(ms: number): string {
  const at = new Date(ms)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

export function isCancelledGoogleEvent(event: GoogleApiEvent): boolean {
  return event.status === 'cancelled'
}

export function isDeclinedBySelf(event: GoogleApiEvent): boolean {
  return (event.attendees ?? []).some((attendee) => attendee.self === true && attendee.responseStatus === 'declined')
}

/**
 * Attendees who are people other than the account owner: rooms/resources are
 * dropped, and the owner is excluded so every meeting does not mint the
 * person themself as a "connected person" entity. Identity is the attendee's
 * source-native email (spec: source-native identity outranks display-name
 * similarity); the display name falls back to the email when Google has none.
 */
function normalizeAttendees(event: GoogleApiEvent): Array<{ connectorId: string; displayName: string }> {
  const out: Array<{ connectorId: string; displayName: string }> = []
  for (const attendee of event.attendees ?? []) {
    if (!attendee.email || attendee.resource === true || attendee.self === true) continue
    out.push({
      connectorId: `${GOOGLE_CALENDAR_CONNECTOR_ID}:${attendee.email.toLowerCase()}`,
      displayName: attendee.displayName?.trim() || attendee.email,
    })
  }
  return out
}

export function normalizeGoogleEvent(
  event: GoogleApiEvent,
  context: NormalizeContext,
): ConnectorRecordEnvelope | null {
  if (!event.id || isCancelledGoogleEvent(event) || isDeclinedBySelf(event)) return null
  const start = parseEventTime(event.start)
  if (!start) return null
  const end = parseEventTime(event.end)

  const title = event.summary?.trim() || 'Untitled event'
  const attendees = normalizeAttendees(event)

  const envelope: ConnectorRecordEnvelope = {
    provenance: {
      connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
      accountLabel: context.accountLabel,
      workspace: context.calendarId,
      sourceRecordId: event.id,
      retrievedAtMs: context.retrievedAtMs,
      effectiveAtMs: start.ms,
      sensitivity: 'standard',
      permissionScope: GOOGLE_CALENDAR_SCOPE,
    },
    entity: {
      kind: 'calendar_event',
      sourceEventId: `gcal:${event.id}`,
      title,
      startMs: start.ms,
      endMs: end?.ms,
      attendees,
    },
  }

  // The day layer (external_signals 'calendar' → enrichment/wraps/timeline)
  // gets TIMED events only: an all-day "PTO" block is not a meeting slot.
  // All-day events still exist as entities for day-level recognition (#3).
  if (!start.allDay) {
    envelope.daySignal = {
      date: localDateOf(start.ms),
      title,
      startClock: localClockOf(start.ms),
      durationMinutes: end && !end.allDay && end.ms > start.ms
        ? Math.round((end.ms - start.ms) / 60_000)
        : 30,
      attendeeCount: attendees.length > 0 ? attendees.length : null,
    }
  }

  return envelope
}
