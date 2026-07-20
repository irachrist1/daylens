// Normalization: one Microsoft Graph calendar event → one shared connector
// record envelope (DEV-190), the exact shape the DEV-186 ingestion path
// stores — mirroring the Google Calendar normalizer field for field.
// Deliberately MINIMAL: identity, title, times, and attendees only. Meeting
// links, bodies, and location fields are not ingested in this slice — they
// add little to memory and are where credential-shaped content (tokenized
// join URLs, dial-in codes) lives.
//
// Returns null for events that must not become records:
//   - cancelled events (`isCancelled: true`) and delta "@removed" stubs — the
//     ADAPTER turns these into tombstones; normalize never partially ingests
//   - events the person declined — a meeting you said no to is not scheduled
//     context for YOUR day (it also naturally tombstones on decline)
//   - structurally unusable events (no id / no parseable start)

import type { ConnectorRecordEnvelope } from '../contract'
import type { OutlookApiEvent, OutlookDateTime } from './api'

export const OUTLOOK_CALENDAR_CONNECTOR_ID = 'outlook_calendar' as const

/** The Graph permission the records ride under (provenance.permissionScope). */
export const OUTLOOK_CALENDAR_SCOPE = 'Calendars.Read'
/** The account-label permission (GET /me). */
export const OUTLOOK_ACCOUNT_SCOPE = 'User.Read'

/** The full scope string the device flow requests: the two read-only Graph
 *  permissions plus offline_access so the background sync can refresh. */
export const OUTLOOK_REQUESTED_SCOPES =
  'https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/User.Read offline_access'

export interface OutlookNormalizeContext {
  retrievedAtMs: number
  accountLabel: string | null
  calendarId: string
  /** The connected account's own email, so the owner is never minted as an
   *  attendee of their own meetings. Lowercased comparison. */
  ownerEmail: string | null
}

interface ParsedTime {
  ms: number
  allDay: boolean
}

const OFFSET_QUALIFIED = /(?:Z|[+-]\d{2}:?\d{2})$/i

/** The adapter requests `Prefer: outlook.timezone="UTC"`, so a timed event's
 *  dateTime is a UTC wall clock WITHOUT an offset suffix ("2026-07-20T14:00:00").
 *  Qualify it before parsing so the epoch is unambiguous on every machine.
 *  All-day events carry midnight in that same rendering, but they are a LOCAL
 *  day — parsed as local midnight so they land on the calendar day the person
 *  sees (mirroring how Google's `date` is handled). */
function parseGraphTime(time: OutlookDateTime | undefined, allDay: boolean): ParsedTime | null {
  const raw = time?.dateTime
  if (typeof raw !== 'string' || !raw.trim()) return null
  if (allDay) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
    if (!match) return null
    const ms = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
    return Number.isFinite(ms) ? { ms, allDay: true } : null
  }
  const zone = time?.timeZone?.trim().toUpperCase()
  if (zone && zone !== 'UTC') {
    // A non-UTC zone means the Prefer header was ignored or the shape changed:
    // fail validation rather than silently changing what the time means.
    return null
  }
  const qualified = OFFSET_QUALIFIED.test(raw) ? raw : `${raw}Z`
  const ms = Date.parse(qualified)
  return Number.isFinite(ms) ? { ms, allDay: false } : null
}

function localDateOf(ms: number): string {
  const at = new Date(ms)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

function localClockOf(ms: number): string {
  const at = new Date(ms)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

export function isCancelledOutlookEvent(event: OutlookApiEvent): boolean {
  return event.isCancelled === true || event['@removed'] != null
}

export function isDeclinedBySelf(event: OutlookApiEvent): boolean {
  // Graph's top-level responseStatus IS the calendar owner's own response.
  return event.responseStatus?.response?.toLowerCase() === 'declined'
}

/**
 * Attendees who are people other than the account owner: rooms/equipment
 * (`type: "resource"`) are dropped, and the owner is excluded so every
 * meeting does not mint the person themself as a "connected person" entity.
 * Identity is the attendee's source-native email (spec: source-native
 * identity outranks display-name similarity); the display name falls back to
 * the email when Graph has none.
 */
function normalizeAttendees(
  event: OutlookApiEvent,
  ownerEmail: string | null,
): Array<{ connectorId: string; displayName: string }> {
  const owner = ownerEmail?.trim().toLowerCase() ?? null
  const out: Array<{ connectorId: string; displayName: string }> = []
  for (const attendee of event.attendees ?? []) {
    const email = attendee.emailAddress?.address?.trim().toLowerCase()
    if (!email) continue
    if (attendee.type?.toLowerCase() === 'resource') continue
    if (owner && email === owner) continue
    out.push({
      connectorId: `${OUTLOOK_CALENDAR_CONNECTOR_ID}:${email}`,
      displayName: attendee.emailAddress?.name?.trim() || email,
    })
  }
  return out
}

export function normalizeOutlookEvent(
  event: OutlookApiEvent,
  context: OutlookNormalizeContext,
): ConnectorRecordEnvelope | null {
  if (!event.id || isCancelledOutlookEvent(event) || isDeclinedBySelf(event)) return null
  const allDay = event.isAllDay === true
  const start = parseGraphTime(event.start, allDay)
  if (!start) return null
  const end = parseGraphTime(event.end, allDay)

  const title = event.subject?.trim() || 'Untitled event'
  const attendees = normalizeAttendees(event, context.ownerEmail)

  const envelope: ConnectorRecordEnvelope = {
    provenance: {
      connectorId: OUTLOOK_CALENDAR_CONNECTOR_ID,
      accountLabel: context.accountLabel,
      workspace: context.calendarId,
      sourceRecordId: event.id,
      retrievedAtMs: context.retrievedAtMs,
      effectiveAtMs: start.ms,
      sensitivity: 'standard',
      permissionScope: OUTLOOK_CALENDAR_SCOPE,
    },
    entity: {
      kind: 'calendar_event',
      sourceEventId: `outlook:${event.id}`,
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
