import type Database from 'better-sqlite3'
import type { CaptureEventsDayFixture } from './dayFixture.ts'
import { __setSettings, getSettings } from './settings-stub.mjs'
import { __pollForTest, __setTrackingFsmTestHarness } from '../../src/main/services/tracking.ts'
import {
  ActiveBrowserContextTracker,
  __setActiveBrowserContextTrackerForTest,
} from '../../src/main/services/browserContext.ts'
import { trackingControlsStateFromSettings } from '../../src/shared/trackingControls.ts'
import { shouldCaptureFocusEvent } from '../../src/main/services/focusCapture.ts'
import { insertFocusEvents } from '../../src/main/db/focusEventRepository.ts'
import type { FocusEvent } from '../../src/main/core/evidence/focusEvent.ts'

export function fixtureClockMs(fixture: { date: string }, clock: string): number {
  const [year, month, day] = fixture.date.split('-').map(Number)
  const [hour, minute] = clock.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

/**
 * Drives a capture-events fixture through the production source boundary:
 * settings, browser-context tracker, the tracking FSM polled on a synthetic
 * clock, and the focus-event capture filter. Everything downstream of the
 * boundary (storage, projection, privacy) is production code.
 *
 * The caller owns the database stub and settings lifecycle; this helper
 * resets only the harnesses it installs.
 */
export async function driveCaptureDay(
  db: Database.Database,
  fixture: CaptureEventsDayFixture,
): Promise<{ rejectedFocusEvents: number }> {
  const clock = { now: fixtureClockMs(fixture, fixture.input.foregroundSamples[0].at) }
  let foreground = fixture.input.foregroundSamples[0]
  let rejectedFocusEvents = 0

  try {
    __setSettings(fixture.input.settings)
    __setActiveBrowserContextTrackerForTest(
      new ActiveBrowserContextTracker(
        () => foreground.tab ?? null,
        (snapshot) => /chrome/i.test(snapshot.appName),
      ),
    )
    __setTrackingFsmTestHarness({
      now: () => clock.now,
      idleSeconds: () => 0,
      activeWindow: () => ({
        title: foreground.title,
        application: foreground.application,
        path: foreground.path,
        pid: 42,
        icon: '',
      }),
    })
    for (let index = 0; index < fixture.input.foregroundSamples.length; index += 1) {
      const next = fixture.input.foregroundSamples[index]
      const nextMs = fixtureClockMs(fixture, next.at)
      while (clock.now + 30_000 < nextMs) {
        clock.now += 30_000
        await __pollForTest()
      }
      foreground = next
      clock.now = nextMs
      await __pollForTest()
    }

    const controls = trackingControlsStateFromSettings(getSettings())
    const accepted: FocusEvent[] = []
    for (const [index, raw] of fixture.input.focusEvents.entries()) {
      const event: FocusEvent = {
        ts_ms: fixtureClockMs(fixture, raw.at),
        mono_ns: index + 1,
        event_type: raw.eventType,
        app_bundle_id: raw.appBundleId,
        app_name: raw.appName,
        pid: raw.appName ? 100 + index : null,
        window_title: raw.windowTitle,
        url: null,
        page_title: null,
        source: 'nsworkspace_event',
        confidence: 'observed',
        platform: 'darwin',
        schema_ver: 1,
      }
      if (shouldCaptureFocusEvent(event, controls)) accepted.push(event)
      else rejectedFocusEvents += 1
    }
    insertFocusEvents(db, accepted)
  } finally {
    __setTrackingFsmTestHarness(null)
    __setActiveBrowserContextTrackerForTest(null)
  }

  return { rejectedFocusEvents }
}
