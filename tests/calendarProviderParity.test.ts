// Cross-provider parity (DEV-190 acceptance): THE SAME FIXTURE DAY, driven
// once by Google Calendar events and once by Outlook events through each
// adapter's real connect+sync+ingest path, produces IDENTICAL meeting
// behavior — the same day-layer calendar signal, the same three-bucket
// day-level meeting resolution (matched / calendar-only / captured-only,
// issue #3), and the same Timeline scheduled-meeting context. A calendar is a
// calendar; which vendor synced it must never change what the day says.
import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { OPEN_GATE } from './support/connectorContractSuite.ts'
import {
  createFakeGoogleCalendarApi,
  createFakeSecretStore as createGoogleSecretStore,
  FAKE_GOOGLE_ENDPOINTS,
} from './support/fakeGoogleCalendarApi.ts'
import {
  createFakeMicrosoftGraphApi,
  createFakeSecretStore as createMsSecretStore,
  FAKE_GRAPH_ENDPOINTS,
} from './support/fakeMicrosoftGraphApi.ts'
import { createGoogleCalendarAdapter } from '../src/main/connectors/googleCalendar/adapter.ts'
import { createOutlookCalendarAdapter } from '../src/main/connectors/outlookCalendar/adapter.ts'
import { connectConnector } from '../src/main/connectors/service.ts'
import { getExternalSignal } from '../src/main/services/externalSignals.ts'
import { getTimelineDayPayload } from '../src/main/services/workBlocks.ts'
import { resolveDayMeetingReport } from '../src/main/services/meetingResolution.ts'
import type { ConnectorAdapter } from '../src/main/connectors/contract.ts'
import type { CalendarSignal, ConnectorId } from '../src/shared/types.ts'

// ─── The one fixture day: yesterday, local wall clock ────────────────────────

const FIXTURE = new Date(Date.now() - 24 * 60 * 60 * 1000)
const FIXTURE_DATE = `${FIXTURE.getFullYear()}-${String(FIXTURE.getMonth() + 1).padStart(2, '0')}-${String(FIXTURE.getDate()).padStart(2, '0')}`

function fixtureMs(hour: number, minute = 0): number {
  const at = new Date(FIXTURE)
  at.setHours(hour, minute, 0, 0)
  return at.getTime()
}

function isoAt(hour: number, minute = 0): string {
  return new Date(fixtureMs(hour, minute)).toISOString()
}

function graphIsoAt(hour: number, minute = 0): string {
  // Graph renders UTC times WITHOUT an offset under Prefer: outlook.timezone="UTC".
  return new Date(fixtureMs(hour, minute)).toISOString().replace(/\.\d{3}Z$/, '.0000000')
}

// The day: a design review the person actually sat through in Zoom (matched),
// a 1:1 that never happened (calendar-only), and an ad-hoc Zoom call no
// calendar knows about (captured-only).
const EVENTS = [
  { title: 'Design review', startHour: 14, startMinute: 0, endHour: 15, endMinute: 0, attendees: [
    { email: 'ana@example.com', name: 'Ana Silva' },
    { email: 'ben@example.com', name: 'Ben Okafor' },
  ] },
  { title: 'Skipped 1:1', startHour: 16, startMinute: 0, endHour: 16, endMinute: 30, attendees: [
    { email: 'ana@example.com', name: 'Ana Silva' },
  ] },
]

function insertCapturedDay(db: Database.Database): void {
  const insert = (appName: string, bundleId: string, startMs: number, minutes: number, category: string, title: string) => {
    db.prepare(`
      INSERT INTO app_sessions (
        bundle_id, app_name, start_time, end_time, duration_sec,
        category, is_focused, window_title, raw_app_name, canonical_app_id, capture_source, capture_version
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'test', 1)
    `).run(bundleId, appName, startMs, startMs + minutes * 60_000, minutes * 60, category, title, appName, bundleId)
  }
  insert('Zoom', 'us.zoom.xos', fixtureMs(13, 58), 66, 'meetings', 'Zoom Meeting')   // the design review
  insert('Zoom', 'us.zoom.xos', fixtureMs(12, 0), 45, 'meetings', 'Zoom Meeting')    // the ad-hoc call
  insert('Ghostty', 'com.mitchellh.ghostty', fixtureMs(9, 0), 90, 'development', 'Editing')
}

function googleFixture() {
  const fake = createFakeGoogleCalendarApi(EVENTS.map((event, index) => ({
    id: `gev-${index}`,
    status: 'confirmed',
    summary: event.title,
    start: { dateTime: isoAt(event.startHour, event.startMinute) },
    end: { dateTime: isoAt(event.endHour, event.endMinute) },
    attendees: [
      { email: 'owner@example.com', self: true, responseStatus: 'accepted' },
      ...event.attendees.map((attendee) => ({ email: attendee.email, displayName: attendee.name })),
    ],
  })))
  const adapter = createGoogleCalendarAdapter({
    fetchImpl: fake.fetchImpl,
    openExternal: (url) => fake.browse(url),
    secretStore: createGoogleSecretStore(),
    endpoints: FAKE_GOOGLE_ENDPOINTS,
    env: {},
    authTimeoutMs: 10_000,
  })
  return { adapter, connectorId: 'google_calendar' as ConnectorId, config: { clientId: 'client.apps.googleusercontent.com' } }
}

function outlookFixture() {
  const fake = createFakeMicrosoftGraphApi(EVENTS.map((event, index) => ({
    id: `oev-${index}`,
    subject: event.title,
    start: { dateTime: graphIsoAt(event.startHour, event.startMinute), timeZone: 'UTC' },
    end: { dateTime: graphIsoAt(event.endHour, event.endMinute), timeZone: 'UTC' },
    responseStatus: { response: 'accepted' },
    attendees: [
      { emailAddress: { address: 'owner@example.com', name: 'Owner Example' }, type: 'required' },
      ...event.attendees.map((attendee) => ({ emailAddress: { address: attendee.email, name: attendee.name }, type: 'required' })),
    ],
  })))
  const adapter = createOutlookCalendarAdapter({
    fetchImpl: fake.fetchImpl,
    openExternal: () => fake.approveDevice(),
    secretStore: createMsSecretStore(),
    endpoints: FAKE_GRAPH_ENDPOINTS,
    env: {},
    authTimeoutMs: 10_000,
  })
  return { adapter, connectorId: 'outlook_calendar' as ConnectorId, config: { clientId: '11111111-2222-3333-4444-555555555555' } }
}

interface ProviderOutcome {
  daySignal: Array<{ title: string; startClock: string; durationMinutes: number; attendeeCount: number | null }>
  report: Array<Record<string, unknown>>
  scheduled: Array<Record<string, unknown>>
}

async function driveFixtureDay(provider: {
  adapter: ConnectorAdapter
  connectorId: ConnectorId
  config: Record<string, unknown>
}): Promise<ProviderOutcome> {
  const db = createProductionTestDatabase()
  try {
    insertCapturedDay(db)
    const summary = await connectConnector(db, provider.connectorId, provider.config, {
      adapter: provider.adapter,
      gate: OPEN_GATE,
    })
    assert.equal(summary.status, 'ok')
    assert.equal(summary.ingested, EVENTS.length)

    const daySignal = (getExternalSignal<CalendarSignal>(db, FIXTURE_DATE, 'calendar')?.payload.events ?? [])
      .map((event) => ({
        title: event.title,
        startClock: event.startClock,
        durationMinutes: event.durationMinutes,
        attendeeCount: event.attendeeCount,
      }))
      .sort((a, b) => a.startClock.localeCompare(b.startClock))

    const report = (resolveDayMeetingReport(db, FIXTURE_DATE)?.meetings ?? []).map((meeting) => ({
      attendance: meeting.attendance,
      title: meeting.title,
      scheduledStartMs: meeting.scheduledStartMs,
      scheduledEndMs: meeting.scheduledEndMs,
      scheduledMinutes: meeting.scheduledMinutes,
      observedStartMs: meeting.observedStartMs,
      observedEndMs: meeting.observedEndMs,
      observedSeconds: meeting.observedSeconds,
      attendeeCount: meeting.attendeeCount,
      participants: meeting.participants,
      appName: meeting.appName,
      marked: meeting.marked,
    }))

    const payload = getTimelineDayPayload(db, FIXTURE_DATE, null, { materialize: true })
    const scheduled = (payload.scheduledMeetings ?? []).map((meeting) => ({
      title: meeting.title,
      startMs: meeting.startMs,
      endMs: meeting.endMs,
      attendeeCount: meeting.attendeeCount,
      participants: meeting.participants,
      attendance: meeting.attendance,
      marked: meeting.marked,
      hasBlock: meeting.matchedBlockId != null, // block ids differ per build; presence must not
    }))

    return { daySignal, report, scheduled }
  } finally {
    db.close()
  }
}

test('the same fixture day through Google and through Outlook produces identical meeting behavior', async () => {
  const viaGoogle = await driveFixtureDay(googleFixture())
  const viaOutlook = await driveFixtureDay(outlookFixture())

  assert.deepEqual(viaOutlook.daySignal, viaGoogle.daySignal, 'the day-layer calendar signal is provider-agnostic')
  assert.deepEqual(viaOutlook.report, viaGoogle.report, 'the three-bucket day resolution is provider-agnostic')
  assert.deepEqual(viaOutlook.scheduled, viaGoogle.scheduled, 'the Timeline scheduled context is provider-agnostic')

  // And the fixture actually exercises all three buckets.
  const attendances = viaGoogle.report.map((meeting) => meeting.attendance).sort()
  assert.deepEqual(attendances, ['calendar_only', 'captured_only', 'matched'])
  const matched = viaGoogle.report.find((meeting) => meeting.attendance === 'matched')!
  assert.equal(matched.title, 'Design review')
  assert.equal(matched.observedSeconds, 66 * 60)
  assert.deepEqual(matched.participants, ['Ana Silva', 'Ben Okafor'])
})
