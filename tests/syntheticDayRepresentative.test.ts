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
import { findDatabaseTextMatches } from './support/dayFixturePrivacy.ts'
import { effectiveBlockKind } from '../src/shared/workKind.ts'
import { inferWorkIntent } from '../src/shared/workIntent.ts'

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
      const block = overlapping.find((candidate) =>
        labelTerms.some((term) => includesTerm(userVisibleLabelForBlock(candidate), term)),
      )
      assert.ok(
        block,
        `${fixture.id}: episode ${expected.id} labels [${overlapping
          .map((block) => userVisibleLabelForBlock(block))
          .join(' | ')}] match none of [${labelTerms.join(', ')}]`,
      )
      if (expected.startToleranceMinutes != null) {
        assert.ok(
          Math.abs(block.startTime - startMs) <= expected.startToleranceMinutes * 60_000,
          `${fixture.id}: ${expected.id} start boundary drifted`,
        )
      }
      if (expected.endToleranceMinutes != null) {
        assert.ok(
          Math.abs(block.endTime - endMs) <= expected.endToleranceMinutes * 60_000,
          `${fixture.id}: ${expected.id} end boundary drifted`,
        )
      }
      if (expected.category) assert.equal(block.dominantCategory, expected.category)
      if (expected.kind) assert.equal(effectiveBlockKind(block), expected.kind)
      if (expected.intentRole) {
        assert.equal(block.review?.correctedIntentRole ?? inferWorkIntent(block).role, expected.intentRole)
      }
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
      const deferrals = fixture.expected?.knownIssues ?? []
      const matchedDeferrals = new Set<string>()
      const observedPrivacyIssues: string[] = []
      const checkDatabaseMatches = (term: string, tables?: ReadonlySet<string>) => {
        for (const match of findDatabaseTextMatches(db, term, tables)) {
          observedPrivacyIssues.push(
            `privacy: "${term}" remains in ${match.table}.${match.column}`,
          )
        }
      }
      const surfaces = new Set(fixture.expected?.privacy?.prohibitedSurfaces ?? [
        'sessions',
        'pending evidence',
        'canonical evidence',
        'Timeline',
        'Apps',
        'search',
        'AI context',
      ])
      const timelineHaystack = JSON.stringify(timeline.blocks)
      const appsHaystack = JSON.stringify(appSummaries)
      const tools = surfaces.has('AI context') ? buildDaylensTools(db) : null
      const overview = tools
        ? await (tools.get_day_overview as {
            execute: (input: unknown, options: unknown) => Promise<unknown>
          }).execute({ date: fixture.date }, {})
        : null
      for (const term of prohibitedTerms) {
        if (surfaces.has('sessions')) {
          checkDatabaseMatches(term, new Set(['app_sessions']))
        }
        if (surfaces.has('pending evidence')) {
          checkDatabaseMatches(term, new Set(['website_visits_pending']))
        }
        if (surfaces.has('canonical evidence')) {
          checkDatabaseMatches(term)
        }
        if (surfaces.has('Timeline') && includesTerm(timelineHaystack, term)) {
          observedPrivacyIssues.push(`privacy: "${term}" leaked into Timeline`)
        }
        if (surfaces.has('Apps') && includesTerm(appsHaystack, term)) {
          observedPrivacyIssues.push(`privacy: "${term}" leaked into Apps`)
        }
        if (surfaces.has('search')) {
          const rows = searchAll(db, term, {
            startDate: fixture.date,
            endDate: fixture.date,
            limit: 20,
          })
          if (rows.length > 0) {
            observedPrivacyIssues.push(`privacy: search for "${term}" returns results`)
          }
        }
        if (surfaces.has('AI context') && includesTerm(JSON.stringify(overview), term)) {
          observedPrivacyIssues.push(`privacy: "${term}" leaked into AI context`)
        }
      }
      const unexpectedPrivacyIssues: string[] = []
      for (const signature of new Set(observedPrivacyIssues)) {
        const deferral = deferrals.find((candidate) => candidate.defectSignatures.includes(signature))
        if (deferral) matchedDeferrals.add(`${deferral.issue}\0${signature}`)
        else unexpectedPrivacyIssues.push(signature)
      }
      const staleDeferrals = deferrals.flatMap((deferral) =>
        deferral.defectSignatures
          .filter((signature) => !matchedDeferrals.has(`${deferral.issue}\0${signature}`))
          .map((signature) => `${deferral.issue}: stale deferral did not occur: ${signature}`),
      )
      const privacyDefects = [...new Set([...unexpectedPrivacyIssues, ...staleDeferrals])]
      assert.equal(
        privacyDefects.length,
        0,
        `${fixture.id}: privacy defects must match one exact tracked deferral:\n${privacyDefects.join('\n')}`,
      )
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
