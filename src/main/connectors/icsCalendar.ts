// The reference connector (connectors.md §Implementation starting point,
// DEV-186): a local calendar-file (.ics) import. The simplest honest provider
// — no OAuth, no network, no broker — that still exercises the ENTIRE
// connector pipeline for real: manifest, connect, incremental cursor, typed
// envelopes with source-native identity (the ICS UID), attendee people keyed
// by their mailto address, per-day signal projection, provider-deletion
// tombstones (an event removed from the file disappears locally), and
// disconnect cleanup. Google Calendar (DEV-188) replaces the file read with
// API pages and inherits everything else.
//
// Parsing is deliberately minimal and honest: UTC ("...Z"), floating, and
// TZID-labelled local times (TZID is treated as local time — a bounded
// limitation for a local reference source), all-day DATE values, folded
// lines, escaped text, and RECURRENCE-ID overrides as distinct records.
// Unbounded recurrence expansion is NOT attempted: a recurring VEVENT yields
// its master occurrence only. STATUS:CANCELLED events are excluded, which the
// tombstone pass then treats as provider deletions.

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type {
  ConnectorAdapter,
  ConnectorConnectInput,
  ConnectorConnectResult,
  ConnectorManifest,
  ConnectorRecordEnvelope,
  ConnectorSyncPage,
  ConnectorSyncRequest,
} from './contract'

export const ICS_CALENDAR_MANIFEST: ConnectorManifest = {
  id: 'ics_calendar',
  displayName: 'Calendar file (.ics)',
  providerKind: 'calendar',
  integration: 'local',
  authKind: 'local_file',
  readOnly: true,
  scopes: [
    { scope: 'file:read', grants: 'Reads only the one calendar file you pick. Nothing else on disk, nothing on the network.' },
  ],
  whatItBrings:
    'Meetings and events from a calendar export — titles, times, and attendees — so your days can name the meetings that shaped them. Works with any calendar that can export or subscribe as .ics.',
  sensitivity: 'standard',
  syncCadenceMs: 6 * 60 * 60 * 1000,
  lookbackDays: 90,
  rateLimit: { maxRequestsPerMinute: 6, backoffBaseMs: 30_000, backoffMaxMs: 6 * 60 * 60 * 1000 },
  available: true,
}

const LOOKAHEAD_DAYS = 60

// ─── ICS parsing ─────────────────────────────────────────────────────────────

export interface IcsEvent {
  uid: string
  /** RECURRENCE-ID raw value when this VEVENT overrides one occurrence. */
  recurrenceId: string | null
  title: string
  startMs: number | null
  endMs: number | null
  allDay: boolean
  cancelled: boolean
  attendees: Array<{ email: string; displayName: string }>
}

/** RFC 5545 line unfolding: a CRLF (or LF) followed by a space/tab continues
 *  the previous content line. */
function unfoldIcsLines(text: string): string[] {
  const lines: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1)
    } else {
      lines.push(raw)
    }
  }
  return lines
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/** DATE-TIME / DATE value → epoch ms. "...Z" is UTC; a bare or TZID-labelled
 *  local time is interpreted in this machine's zone; DATE is local midnight. */
export function parseIcsDateValue(value: string): { ms: number | null; allDay: boolean } {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
  if (dateOnly) {
    const [, year, month, day] = dateOnly
    return { ms: new Date(Number(year), Number(month) - 1, Number(day)).getTime(), allDay: true }
  }
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value)
  if (!dateTime) return { ms: null, allDay: false }
  const [, year, month, day, hour, minute, second, utc] = dateTime
  if (utc === 'Z') {
    return {
      ms: Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)),
      allDay: false,
    }
  }
  return {
    ms: new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).getTime(),
    allDay: false,
  }
}

interface IcsProperty {
  name: string
  params: Record<string, string>
  value: string
}

function parseIcsProperty(line: string): IcsProperty | null {
  const colon = line.indexOf(':')
  if (colon < 0) return null
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const [name, ...paramParts] = head.split(';')
  const params: Record<string, string> = {}
  for (const part of paramParts) {
    const eq = part.indexOf('=')
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: name.toUpperCase(), params, value }
}

export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = []
  let current: Partial<IcsEvent> & { attendees: IcsEvent['attendees'] } | null = null

  for (const line of unfoldIcsLines(text)) {
    if (/^BEGIN:VEVENT$/i.test(line.trim())) {
      current = { attendees: [], recurrenceId: null, cancelled: false, allDay: false, startMs: null, endMs: null }
      continue
    }
    if (/^END:VEVENT$/i.test(line.trim())) {
      if (current?.uid && current.title) {
        events.push({
          uid: current.uid,
          recurrenceId: current.recurrenceId ?? null,
          title: current.title,
          startMs: current.startMs ?? null,
          endMs: current.endMs ?? null,
          allDay: current.allDay ?? false,
          cancelled: current.cancelled ?? false,
          attendees: current.attendees,
        })
      }
      current = null
      continue
    }
    if (!current) continue
    const property = parseIcsProperty(line)
    if (!property) continue
    switch (property.name) {
      case 'UID':
        current.uid = property.value.trim()
        break
      case 'SUMMARY':
        current.title = unescapeIcsText(property.value).trim()
        break
      case 'DTSTART': {
        const parsed = parseIcsDateValue(property.value.trim())
        current.startMs = parsed.ms
        current.allDay = parsed.allDay
        break
      }
      case 'DTEND':
        current.endMs = parseIcsDateValue(property.value.trim()).ms
        break
      case 'RECURRENCE-ID':
        current.recurrenceId = property.value.trim()
        break
      case 'STATUS':
        current.cancelled = property.value.trim().toUpperCase() === 'CANCELLED'
        break
      case 'ATTENDEE': {
        const email = /^mailto:(.+)$/i.exec(property.value.trim())?.[1]?.trim().toLowerCase()
        if (email) {
          current.attendees.push({ email, displayName: (property.params.CN ?? email).trim() })
        }
        break
      }
    }
  }
  return events
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export function icsSourceRecordId(event: IcsEvent): string {
  return event.recurrenceId ? `${event.uid}#${event.recurrenceId}` : event.uid
}

function localDateOf(ms: number): string {
  const at = new Date(ms)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

function clockOf(ms: number): string {
  const at = new Date(ms)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

export function normalizeIcsEvent(
  event: IcsEvent,
  options: { accountLabel: string; retrievedAtMs: number },
): ConnectorRecordEnvelope {
  const sourceRecordId = icsSourceRecordId(event)
  const durationMinutes = event.startMs != null && event.endMs != null && event.endMs > event.startMs
    ? Math.round((event.endMs - event.startMs) / 60_000)
    : 0
  return {
    provenance: {
      connectorId: 'ics_calendar',
      accountLabel: options.accountLabel,
      workspace: null,
      sourceRecordId,
      retrievedAtMs: options.retrievedAtMs,
      effectiveAtMs: event.startMs,
      sensitivity: 'standard',
      permissionScope: 'file:read',
    },
    entity: {
      kind: 'calendar_event',
      sourceEventId: `ics:${sourceRecordId}`,
      title: event.title,
      startMs: event.startMs ?? undefined,
      endMs: event.endMs ?? undefined,
      // A mailto address is a real connector identifier, so attendees resolve
      // to person entities by the spec's identity rule (connector id first).
      attendees: event.attendees.map((attendee) => ({
        connectorId: `email:${attendee.email}`,
        displayName: attendee.displayName,
      })),
    },
    daySignal: event.startMs != null && !event.allDay
      ? {
        date: localDateOf(event.startMs),
        title: event.title,
        startClock: clockOf(event.startMs),
        durationMinutes,
        attendeeCount: event.attendees.length > 0 ? event.attendees.length : null,
      }
      : undefined,
  }
}

function windowBounds(nowMs: number): { fromMs: number; toMs: number } {
  const dayMs = 24 * 60 * 60 * 1000
  return {
    fromMs: nowMs - ICS_CALENDAR_MANIFEST.lookbackDays * dayMs,
    toMs: nowMs + LOOKAHEAD_DAYS * dayMs,
  }
}

export function createIcsCalendarAdapter(): ConnectorAdapter {
  return {
    manifest: ICS_CALENDAR_MANIFEST,

    async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
      const filePath = typeof input.config.filePath === 'string' ? input.config.filePath : ''
      if (!filePath || !path.isAbsolute(filePath)) {
        throw new Error('Pick a calendar file to import (an absolute path to a .ics file).')
      }
      if (path.extname(filePath).toLowerCase() !== '.ics') {
        throw new Error('That file is not a .ics calendar file.')
      }
      let stat: fs.Stats
      try {
        stat = fs.statSync(filePath)
      } catch {
        throw new Error('The calendar file could not be read. Check that it exists and is readable.')
      }
      if (!stat.isFile()) throw new Error('The calendar path is not a file.')
      return { accountLabel: path.basename(filePath), config: { filePath } }
    },

    async sync(request: ConnectorSyncRequest): Promise<ConnectorSyncPage> {
      const filePath = String(request.connection.config.filePath ?? '')
      const stat = fs.statSync(filePath)
      const content = fs.readFileSync(filePath, 'utf8')
      const digest = createHash('sha256').update(content).digest('hex').slice(0, 16)
      const nextCursor = `${Math.round(stat.mtimeMs)}:${digest}`
      if (request.cursor === nextCursor) {
        return { records: [], nextCursor, unchanged: true }
      }

      const { fromMs, toMs } = windowBounds(request.nowMs)
      const retrievedAtMs = request.nowMs
      const accountLabel = request.connection.accountLabel ?? path.basename(filePath)
      const parsed = parseIcs(content)
      const live = parsed.filter((event) => !event.cancelled)
      const windowed = live.filter((event) =>
        event.startMs != null && event.startMs >= fromMs && event.startMs <= toMs)
      const records = windowed.map((event) => normalizeIcsEvent(event, { accountLabel, retrievedAtMs }))
      return {
        records,
        nextCursor,
        // The file IS the whole source, so every live event id is attested —
        // including ones outside the ingest window (they are present, merely
        // not re-read). Only an event REMOVED from the file (or cancelled)
        // becomes a provider deletion → local tombstone.
        presentSourceRecordIds: live.map((event) => icsSourceRecordId(event)),
      }
    },

    async disconnect(): Promise<void> {
      // Local file source: nothing to revoke provider-side.
    },
  }
}
