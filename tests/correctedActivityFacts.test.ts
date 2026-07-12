import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import type { AppCategory } from '../src/shared/types.ts'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { materializeTimelineDayProjection } from '../src/main/core/query/projections.ts'
import { writeTimelineBlockReview } from '../src/main/services/workBlocks.ts'
import { getAppDetailPayload } from '../src/main/services/appDetail.ts'
import { getAppSummariesForRange } from '../src/main/db/queries.ts'
import {
  getCorrectedAppSummariesForRange,
  getCorrectedSessionsForRange,
  getIgnoredBlockSpansForRange,
} from '../src/main/services/activityFacts.ts'
import { localDayBounds } from '../src/main/lib/localDate.ts'

// One truth, three views (invariant 7; apps.md invariant 13; v2-ship-plan
// W1-A outcome 2). Before the corrected read model, the Apps view summed raw
// sessions directly: an ignored June 30 block still owned ~16 minutes of Dia
// in the Apps totals while the Timeline honestly showed nothing. These tests
// prove the two cross-view behaviors end to end:
//   1. Deleting a Timeline block changes Apps (and AI) totals immediately,
//      while the raw capture stays safely stored underneath.
//   2. A category override on a block reaches Timeline and Apps consistently.

const TEST_DATE = '2026-04-22'

function localMs(hour: number, minute = 0): number {
  return new Date(2026, 3, 22, hour, minute, 0, 0).getTime()
}

function createDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  return db
}

function insertSession(
  db: Database.Database,
  title: string,
  startHour: number,
  startMinute: number,
  durationMinutes: number,
  category: AppCategory = 'development',
): void {
  const startTime = localMs(startHour, startMinute)
  const endTime = startTime + durationMinutes * 60_000
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, canonical_app_id, capture_source, capture_version
    ) VALUES ('com.mitchellh.ghostty', 'Ghostty', ?, ?, ?, ?, 1, ?, 'Ghostty', 'ghostty', 'test', 1)
  `).run(startTime, endTime, durationMinutes * 60, category, title)
}

// Two clearly separated blocks: a morning hour and an afternoon ~53 minutes.
// Distinct window titles so the two blocks earn distinct labels (the app
// detail merges appearances that share a label).
function seedTwoBlockDay(db: Database.Database): void {
  insertSession(db, 'Refactoring the tracker guard - Ghostty', 9, 0, 30)
  insertSession(db, 'Refactoring the tracker guard - Ghostty', 9, 30, 30)
  insertSession(db, 'Writing the apps read model - Ghostty', 14, 0, 28)
  insertSession(db, 'Writing the apps read model - Ghostty', 14, 28, 25)
}

test('deleting a Timeline block removes its minutes from Apps and AI totals immediately — raw capture stays', () => {
  const db = createDb()
  seedTwoBlockDay(db)
  const [fromMs, toMs] = localDayBounds(TEST_DATE)

  const payload = materializeTimelineDayProjection(db, TEST_DATE, null)
  const blocks = payload.blocks.filter((block) => !block.isLive)
  assert.equal(blocks.length, 2, 'the seed must form two separate blocks')
  const morning = blocks[0]
  const morningSeconds = 60 * 60
  const afternoonSeconds = 53 * 60

  // Before the correction every surface counts the full 113 minutes.
  const before = getCorrectedAppSummariesForRange(db, fromMs, toMs)
  assert.equal(before[0]?.totalSeconds, morningSeconds + afternoonSeconds)

  // The user deletes the morning block (DELETE_TIMELINE_BLOCK writes exactly
  // this review; corrections win and survive rebuilds — invariant 8).
  writeTimelineBlockReview(db, TEST_DATE, morning, { state: 'ignored' })

  // The corrected span is visible to the read model…
  const spans = getIgnoredBlockSpansForRange(db, fromMs, toMs)
  assert.equal(spans.length, 1)

  // …Apps totals drop immediately (the Apps list reads this exact function).
  const corrected = getCorrectedAppSummariesForRange(db, fromMs, toMs)
  assert.equal(corrected[0]?.totalSeconds, afternoonSeconds, 'Apps totals must drop to the surviving block')

  // The AI's session facts agree (aiTools/insights read this function).
  const correctedSessions = getCorrectedSessionsForRange(db, fromMs, toMs)
  assert.equal(
    correctedSessions.reduce((sum, s) => sum + s.durationSeconds, 0),
    afternoonSeconds,
  )

  // The app detail panel agrees.
  const detail = getAppDetailPayload(db, 'ghostty', TEST_DATE, null)
  assert.equal(detail.totalSeconds, afternoonSeconds, 'app detail total must match the corrected truth')

  // The Timeline shows the same surviving block total — three views, one truth.
  const timelineAfter = materializeTimelineDayProjection(db, TEST_DATE, null)
  assert.equal(timelineAfter.totalSeconds, afternoonSeconds)
  assert.equal(timelineAfter.blocks.filter((block) => !block.isLive).length, 1)

  // And the RAW capture is untouched: the raw summary query still sees all
  // 113 minutes — deletion is a read-time correction, never data loss.
  const raw = getAppSummariesForRange(db, fromMs, toMs)
  assert.equal(raw[0]?.totalSeconds, morningSeconds + afternoonSeconds, 'raw capture must stay stored')

  db.close()
})

test('a category override on a block reaches Timeline and Apps consistently', () => {
  const db = createDb()
  seedTwoBlockDay(db)

  const payload = materializeTimelineDayProjection(db, TEST_DATE, null)
  const blocks = payload.blocks.filter((block) => !block.isLive)
  assert.equal(blocks.length, 2)
  const morning = blocks[0]
  assert.notEqual(morning.dominantCategory, 'design', 'seed must not already be design')

  // The user recategorizes the morning block (SET_BLOCK_REVIEW writes this).
  writeTimelineBlockReview(db, TEST_DATE, morning, {
    state: 'corrected',
    correctedCategory: 'design',
  })

  // Timeline (which the AI day facts also read) shows the corrected category.
  const timeline = materializeTimelineDayProjection(db, TEST_DATE, null)
  const correctedBlock = timeline.blocks.find((block) => block.id === morning.id)
  assert.equal(correctedBlock?.dominantCategory, 'design')

  // Apps block appearances read the same corrected block facts.
  const detail = getAppDetailPayload(db, 'ghostty', TEST_DATE, null)
  const appearance = detail.blockAppearances.find((entry) => entry.blockId === morning.id)
  assert.ok(appearance, 'the corrected block must appear in the app detail')
  assert.equal(appearance.dominantCategory, 'design', 'Apps must show the corrected category')

  db.close()
})

test('a rename correction on a block is what Apps shows', () => {
  const db = createDb()
  seedTwoBlockDay(db)

  const payload = materializeTimelineDayProjection(db, TEST_DATE, null)
  const morning = payload.blocks.filter((block) => !block.isLive)[0]
  writeTimelineBlockReview(db, TEST_DATE, morning, {
    state: 'corrected',
    correctedLabel: 'Building the absence guard',
  })

  const detail = getAppDetailPayload(db, 'ghostty', TEST_DATE, null)
  const appearance = detail.blockAppearances.find((entry) => entry.blockId === morning.id)
  assert.ok(appearance, 'the renamed block must appear in the app detail')
  assert.equal(appearance.label, 'Building the absence guard')

  db.close()
})
