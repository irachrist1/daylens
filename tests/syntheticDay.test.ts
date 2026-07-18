import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCaptureEventsDayFixture, loadDayFixture } from './support/dayFixture.ts'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { setTestDb, clearTestDb } from './support/database-stub.mjs'
import { __resetSettings, __setSettings, getSettings } from './support/settings-stub.mjs'
import { __pollForTest, __setTrackingFsmTestHarness } from '../src/main/services/tracking.ts'
import {
  ActiveBrowserContextTracker,
  __setActiveBrowserContextTrackerForTest,
} from '../src/main/services/browserContext.ts'
import { trackingControlsStateFromSettings } from '../src/shared/trackingControls.ts'
import { shouldCaptureFocusEvent } from '../src/main/services/focusCapture.ts'
import { insertFocusEvents } from '../src/main/db/focusEventRepository.ts'
import { projectDay } from '../src/main/core/projections/chunk2.ts'
import { writeTimelineBlockReview } from '../src/main/services/workBlocks.ts'
import { materializeTimelineDayProjection } from '../src/main/core/query/projections.ts'
import { getAppSummariesForRange, searchAll } from '../src/main/db/queries.ts'
import { addWorkMemoryFact, chatMemoryPromptBlock } from '../src/main/services/workMemoryProfile.ts'
import { buildDaylensTools } from '../src/main/agent/daylensTools.ts'
import { collectExternalSignals, getExternalSignal } from '../src/main/services/externalSignals.ts'
import { syncNowForQuit } from '../src/main/services/syncUploader.ts'
import type { FocusEvent } from '../src/main/core/evidence/focusEvent.ts'
import type { CalendarSignal } from '../src/shared/types.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const fixture = loadDayFixture(
  path.join(HERE, 'timeline-eval', 'fixtures', 'reference-workday.json'),
)
if (!isCaptureEventsDayFixture(fixture)) {
  throw new Error('reference-workday must use capture-events input')
}
const calendar = fixture.context?.calendar
if (!calendar) throw new Error('reference-workday must include calendar context')

function atMs(clock: string): number {
  const [year, month, day] = fixture.date.split('-').map(Number)
  const [hour, minute] = clock.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

test('synthetic day agrees from source boundaries through every local fact surface', async () => {
  const db = createProductionTestDatabase()
  const clock = { now: atMs(fixture.input.foregroundSamples[0].at) }
  let foreground = fixture.input.foregroundSamples[0]
  let rejectedFocusEvents = 0

  setTestDb(db)
  __setSettings(fixture.input.settings)
  __setActiveBrowserContextTrackerForTest(
    new ActiveBrowserContextTracker(
      () => foreground.tab ?? null,
      (snapshot) => /chrome/i.test(snapshot.appName),
    ),
  )
  __setTrackingFsmTestHarness({
    platform: 'darwin',
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

  try {
    for (let index = 0; index < fixture.input.foregroundSamples.length; index += 1) {
      const next = fixture.input.foregroundSamples[index]
      const nextMs = atMs(next.at)
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
        ts_ms: atMs(raw.at),
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

    const projection = projectDay(db, fixture.date, {
      finalize: true,
      now: new Date(atMs('23:59')),
    })
    assert.equal(projection.skipped, false)
    assert.ok(
      projection.sessions >= 3,
      `expected at least 3 canonical sessions, got ${projection.sessions}`,
    )
    assert.equal(
      rejectedFocusEvents,
      2,
      'excluded and incognito helper events must be rejected before storage',
    )

    const external = await collectExternalSignals(fixture.date, {
      force: true,
      deps: {
        db,
        collectGit: async () => null,
        collectCalendar: async () => calendar,
        collectFocus: async () => null,
        enrichmentSources: {},
      },
    })
    assert.deepEqual(external, ['calendar'])
    assert.deepEqual(
      getExternalSignal<CalendarSignal>(db, fixture.date, 'calendar')?.payload,
      calendar,
    )

    for (const fact of fixture.context?.memoryFacts ?? []) addWorkMemoryFact(db, fact)
    assert.match(chatMemoryPromptBlock(db, 'What should I know about Acme?'), /Atlas project/)

    const fromMs = atMs('00:00')
    const toMs = fromMs + 86_400_000
    const timeline = materializeTimelineDayProjection(db, fixture.date, null)
    const apps = getAppSummariesForRange(db, fromMs, toMs)
    const appNames = apps.map((app) => app.appName)
    assert.ok(appNames.includes('Code'), `missing captured editor in ${appNames.join(', ')}`)
    assert.ok(appNames.includes('Google Chrome'), `missing Google Chrome in ${appNames.join(', ')}`)
    assert.ok(
      apps.some((app) => app.category === 'meetings'),
      `missing captured meeting app in ${appNames.join(', ')}`,
    )
    assert.ok(
      !appNames.some((name) => /SecretApp/i.test(name)),
      `excluded app leaked into Apps: ${appNames.join(', ')}`,
    )
    assert.ok(
      !timeline.blocks.some((block) =>
        /Private customer|Excluded customer/i.test(block.label.current),
      ),
      'private or excluded label leaked into Timeline',
    )

    const forbiddenCounts = {
      sessions: (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM app_sessions WHERE app_name = 'SecretApp' OR window_title LIKE '%Private customer%'",
          )
          .get() as { n: number }
      ).n,
      visits: (
        db
          .prepare("SELECT COUNT(*) AS n FROM website_visits WHERE domain = 'excluded.example'")
          .get() as { n: number }
      ).n,
      focus: (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM focus_events WHERE app_name = 'SecretApp' OR window_title LIKE '%Incognito%'",
          )
          .get() as { n: number }
      ).n,
      derived: (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM derived_sessions WHERE app_name = 'SecretApp' OR window_title LIKE '%Incognito%'",
          )
          .get() as { n: number }
      ).n,
    }
    assert.deepEqual(forbiddenCounts, { sessions: 0, visits: 0, focus: 0, derived: 0 })

    const search = searchAll(db, 'Acme', {
      startDate: fixture.date,
      endDate: fixture.date,
      limit: 20,
    })
    assert.ok(
      search.some((row) => row.type === 'session'),
      `Acme session missing from search: ${JSON.stringify(search)}`,
    )
    assert.equal(
      searchAll(db, 'Private customer', {
        startDate: fixture.date,
        endDate: fixture.date,
        limit: 20,
      }).length,
      0,
    )

    const tools = buildDaylensTools(db)
    const overview = await (
      tools.get_day_overview as { execute: (input: unknown, options: unknown) => Promise<unknown> }
    ).execute({ date: fixture.date }, {})
    assert.match(JSON.stringify(overview), /Acme/)
    assert.doesNotMatch(JSON.stringify(overview), /SecretApp|Private customer|excluded\.example/i)

    const firstBlock = timeline.blocks[0]
    assert.ok(firstBlock, 'synthetic Timeline produced no blocks')
    writeTimelineBlockReview(db, fixture.date, firstBlock, {
      state: 'corrected',
      correctedLabel: 'Acme launch planning',
      correctedIntentRole: 'execution',
      correctedIntentSubject: 'Acme launch',
    })
    const corrected = materializeTimelineDayProjection(db, fixture.date, null)
    assert.ok(
      corrected.blocks.some((block) => block.label.current === 'Acme launch planning'),
      'corrected label did not survive Timeline rebuild',
    )

    const beforeOfflineSync = db.totalChanges
    await syncNowForQuit()
    assert.equal(
      db.totalChanges,
      beforeOfflineSync,
      'the accepted offline sync boundary must not mutate or upload local facts',
    )
  } finally {
    __setTrackingFsmTestHarness(null)
    __setActiveBrowserContextTrackerForTest(null)
    __resetSettings()
    clearTestDb()
    db.close()
  }
})
