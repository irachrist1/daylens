// Representative capture-events days run end to end from the source boundary:
// capture, exclusion, projection, mutations (corrections, block deletion,
// history purges), Timeline, Apps, search, and the AI day-overview tool. The
// expectations are data — each fixture carries its own expected episodes, Apps
// facts, search results, and privacy rules.
//
// reference-workday keeps its own deeper test in syntheticDay.test.ts (focus
// rejection counts, connectors, memory, sync boundary); this file runs every
// other capture-events fixture.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isCaptureEventsDayFixture,
  loadDayFixtures,
  type CaptureEventsDayFixture,
} from './support/dayFixture.ts'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { setTestDb, clearTestDb } from './support/database-stub.mjs'
import { __resetSettings } from './support/settings-stub.mjs'
import { driveCaptureDay, fixtureClockMs } from './support/captureDay.ts'
import { projectDay } from '../src/main/core/projections/chunk2.ts'
import { materializeTimelineDayProjection } from '../src/main/core/query/projections.ts'
import {
  invalidateTimelineDayBlocks,
  userVisibleLabelForBlock,
  writeTimelineBlockReview,
} from '../src/main/services/workBlocks.ts'
import {
  deleteHistoryForApp,
  deleteHistoryForSite,
} from '../src/main/services/trackingHistory.ts'
import { getCorrectedAppSummariesForRange } from '../src/main/services/activityFacts.ts'
import { putExternalSignal } from '../src/main/services/externalSignals.ts'
import { addWorkMemoryFact } from '../src/main/services/workMemoryProfile.ts'
import { searchAll } from '../src/main/db/queries.ts'
import { buildDaylensTools } from '../src/main/agent/daylensTools.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = loadDayFixtures(path.join(HERE, 'timeline-eval', 'fixtures'))
  .filter(isCaptureEventsDayFixture)
  .filter((fixture) => fixture.id !== 'reference-workday')

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function includesTerm(haystack: string, term: string): boolean {
  return normalize(haystack).includes(normalize(term))
}

async function runFixture(fixture: CaptureEventsDayFixture): Promise<void> {
  const db = createProductionTestDatabase()
  setTestDb(db)
  try {
    await driveCaptureDay(db, fixture)

    const projection = projectDay(db, fixture.date, {
      finalize: true,
      now: new Date(fixtureClockMs(fixture, '23:59')),
    })
    assert.equal(projection.skipped, false, `${fixture.id}: projection skipped`)

    if (fixture.context?.calendar) {
      putExternalSignal(db, fixture.date, 'calendar', fixture.context.calendar)
    }
    for (const fact of fixture.context?.memoryFacts ?? []) addWorkMemoryFact(db, fact)

    let timeline = materializeTimelineDayProjection(db, fixture.date, null)
    for (const mutation of fixture.mutations ?? []) {
      if (mutation.kind === 'excludeAndPurgeApp') {
        const purged = deleteHistoryForApp({
          appName: mutation.appName ?? null,
          bundleId: mutation.bundleId ?? null,
        })
        assert.ok(
          purged.deletedRows > 0,
          `${fixture.id}: purge of ${mutation.appName ?? mutation.bundleId} deleted nothing`,
        )
      } else if (mutation.kind === 'excludeAndPurgeSite') {
        const purged = deleteHistoryForSite({ domain: mutation.domain })
        assert.ok(
          purged.deletedRows > 0,
          `${fixture.id}: purge of ${mutation.domain} deleted nothing`,
        )
      } else {
        const block = timeline.blocks.find((candidate) =>
          mutation.matchLabelIncludes.some((term) =>
            includesTerm(userVisibleLabelForBlock(candidate), term),
          ),
        )
        assert.ok(
          block,
          `${fixture.id}: no block matches ${mutation.matchLabelIncludes.join(', ')}`,
        )
        writeTimelineBlockReview(
          db,
          fixture.date,
          block,
          mutation.kind === 'ignoreBlock'
            ? { state: 'ignored' }
            : {
                state: mutation.state ?? 'corrected',
                correctedLabel: mutation.correctedLabel,
                correctedIntentRole: mutation.correctedIntentRole,
                correctedIntentSubject: mutation.correctedIntentSubject,
                correctedCategory: mutation.correctedCategory,
              },
        )
      }
    }
    if ((fixture.mutations ?? []).length > 0) {
      invalidateTimelineDayBlocks(db, fixture.date)
      timeline = materializeTimelineDayProjection(db, fixture.date, null)
    }

    const dayStartMs = fixtureClockMs(fixture, '00:00')
    const dayEndMs = dayStartMs + 86_400_000

    for (const expected of fixture.expected?.episodes ?? []) {
      const startMs = fixtureClockMs(fixture, expected.start)
      const endMs = fixtureClockMs(fixture, expected.end)
      const overlapping = timeline.blocks.filter(
        (block) => Math.min(block.endTime, endMs) - Math.max(block.startTime, startMs) > 0,
      )
      assert.ok(
        overlapping.length > 0,
        `${fixture.id}: no block overlaps episode ${expected.id} (${expected.start}-${expected.end})`,
      )
      const labelTerms = expected.labelIncludes ?? [expected.label]
      assert.ok(
        overlapping.some((block) =>
          labelTerms.some((term) => includesTerm(userVisibleLabelForBlock(block), term)),
        ),
        `${fixture.id}: episode ${expected.id} labels [${overlapping
          .map((block) => userVisibleLabelForBlock(block))
          .join(' | ')}] match none of [${labelTerms.join(', ')}]`,
      )
    }

    const appSummaries = getCorrectedAppSummariesForRange(db, dayStartMs, dayEndMs)
    for (const expectedApp of fixture.expected?.apps ?? []) {
      const summary = appSummaries.find(
        (candidate) => normalize(candidate.appName) === normalize(expectedApp.appName),
      )
      assert.ok(
        summary,
        `${fixture.id}: Apps missing "${expectedApp.appName}" (got ${appSummaries.map((s) => s.appName).join(', ')})`,
      )
      if (expectedApp.durationMinutes != null) {
        const tolerance = expectedApp.durationToleranceMinutes ?? 5
        const actualMinutes = summary.totalSeconds / 60
        assert.ok(
          Math.abs(actualMinutes - expectedApp.durationMinutes) <= tolerance,
          `${fixture.id}: Apps "${expectedApp.appName}" ${Math.round(actualMinutes)}m, expected ${expectedApp.durationMinutes}m ±${tolerance}m`,
        )
      }
    }

    for (const expectedSearch of fixture.expected?.search ?? []) {
      const rows = searchAll(db, expectedSearch.query, {
        startDate: fixture.date,
        endDate: fixture.date,
        limit: 50,
      })
      const haystack = JSON.stringify(rows)
      for (const fact of expectedSearch.requiredFacts ?? []) {
        assert.ok(
          includesTerm(haystack, fact),
          `${fixture.id}: search "${expectedSearch.query}" missing "${fact}"`,
        )
      }
      for (const fact of expectedSearch.prohibitedFacts ?? []) {
        assert.ok(
          !includesTerm(haystack, fact),
          `${fixture.id}: search "${expectedSearch.query}" must not return "${fact}"`,
        )
      }
    }

    const prohibitedTerms = fixture.expected?.privacy?.prohibitedTerms ?? []
    if (prohibitedTerms.length > 0) {
      const rawTables = [
        ['app_sessions', 'app_name', 'window_title'],
        ['focus_events', 'app_name', 'window_title'],
        ['derived_sessions', 'app_name', 'window_title'],
        ['website_visits', 'domain', 'page_title'],
        ['website_visits_pending', 'domain', 'page_title'],
      ] as const
      for (const term of prohibitedTerms) {
        const like = `%${term}%`
        for (const [table, first, second] of rawTables) {
          const row = db
            .prepare(
              `SELECT COUNT(*) AS n FROM ${table} WHERE ${first} LIKE ? OR ${second} LIKE ?`,
            )
            .get(like, like) as { n: number }
          assert.equal(
            row.n,
            0,
            `${fixture.id}: "${term}" still present in ${table} (${row.n} rows)`,
          )
        }

        const timelineHaystack = JSON.stringify(
          timeline.blocks.map((block) => [
            userVisibleLabelForBlock(block),
            block.label.current,
            block.topApps.map((app) => app.appName),
            block.websites.map((site) => [site.domain, site.title]),
            block.pageRefs.map((page) => page.displayTitle),
          ]),
        )
        assert.ok(
          !includesTerm(timelineHaystack, term),
          `${fixture.id}: "${term}" leaked into Timeline`,
        )
        assert.ok(
          !appSummaries.some((summary) => includesTerm(summary.appName, term)),
          `${fixture.id}: "${term}" leaked into Apps`,
        )
        const rows = searchAll(db, term, {
          startDate: fixture.date,
          endDate: fixture.date,
          limit: 20,
        })
        assert.equal(rows.length, 0, `${fixture.id}: search for "${term}" returns results`)
      }

      const tools = buildDaylensTools(db)
      const overview = await (
        tools.get_day_overview as {
          execute: (input: unknown, options: unknown) => Promise<unknown>
        }
      ).execute({ date: fixture.date }, {})
      const overviewText = JSON.stringify(overview)
      for (const term of prohibitedTerms) {
        assert.ok(
          !includesTerm(overviewText, term),
          `${fixture.id}: "${term}" leaked into the AI day overview`,
        )
      }
    }
  } finally {
    __resetSettings()
    clearTestDb()
    db.close()
  }
}

assert.ok(FIXTURES.length > 0, 'no representative capture-events fixtures found')

for (const fixture of FIXTURES) {
  test(`representative day "${fixture.id}" holds from capture through every fact surface`, async () => {
    await runFixture(fixture)
  })
}
