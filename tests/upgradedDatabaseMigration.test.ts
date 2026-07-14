// The upgraded-representative-database migration fixture: a database frozen at
// schema_version 25 (v1.0.36, the open-source baseline) is seeded with a
// representative two-client day plus the legacy user data an upgrade must
// preserve, then every later production migration runs against it. The day
// must survive the ladder: episodes, Apps totals, search, legacy AI threads,
// and post-upgrade corrections all work on the upgraded database.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { setTestDb, clearTestDb } from './support/database-stub.mjs'
import {
  isNormalizedEvidenceDayFixture,
  loadDayFixture,
  type NormalizedEvidenceDayFixture,
} from './support/dayFixture.ts'
import {
  LATEST_SCHEMA_VERSION,
  ensureSearchSchema,
  runMigrations,
} from '../src/main/db/migrations.ts'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { ensureAIThreadSchema } from '../src/main/db/aiThreadSchema.ts'
import { syncDerivedStateMetadata } from '../src/main/core/projections/metadata.ts'
import {
  getTimelineDayPayload,
  userVisibleLabelForBlock,
  writeTimelineBlockReview,
  invalidateTimelineDayBlocks,
} from '../src/main/services/workBlocks.ts'
import { getCorrectedAppSummariesForRange } from '../src/main/services/activityFacts.ts'
import { searchAll } from '../src/main/db/queries.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BASELINE_SCHEMA_PATH = path.join(HERE, 'fixtures', 'upgraded-database', 'schema-v25.sql')
const BASELINE_SCHEMA_VERSION = 25
const REPRESENTATIVE_FIXTURE = path.join(HERE, 'timeline-eval', 'fixtures', 'two-client-day.json')

function msForClock(dateStr: string, clock: string): number {
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hour, minute] = clock.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function seedRepresentativeDay(
  db: Database.Database,
  fixture: NormalizedEvidenceDayFixture,
): void {
  const insertSession = db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec, category,
      is_focused, window_title, raw_app_name, canonical_app_id,
      app_instance_id, capture_source, ended_reason, capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'upgrade_fixture', NULL, 2)
  `)
  for (const session of fixture.input.sessions) {
    const startTime = msForClock(fixture.date, session.start)
    const endTime = msForClock(fixture.date, session.end)
    insertSession.run(
      session.bundleId,
      session.appName,
      startTime,
      endTime,
      Math.max(1, Math.round((endTime - startTime) / 1000)),
      session.category,
      session.title ?? null,
      session.appName,
      session.bundleId,
      session.bundleId,
    )
  }

  const insertVisit = db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, visit_time, visit_time_us, duration_sec,
      browser_bundle_id, canonical_browser_id, normalized_url, page_key, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upgrade_fixture')
  `)
  for (const [index, visit] of (fixture.input.browserEvidence ?? []).entries()) {
    const visitTime = msForClock(fixture.date, visit.at)
    insertVisit.run(
      visit.domain,
      visit.title ?? null,
      visit.url,
      visitTime,
      visitTime * 1000 + index,
      Math.round((visit.durationMinutes ?? 1) * 60),
      visit.browserBundleId ?? null,
      visit.browserBundleId ?? null,
      visit.url,
      visit.url,
    )
  }

  // Legacy user data the upgrade must carry forward untouched.
  const now = msForClock(fixture.date, '18:00')
  db.prepare('INSERT INTO ai_conversations (id, messages, created_at) VALUES (1, ?, ?)').run(
    '[]',
    now,
  )
  db.prepare(
    `INSERT INTO ai_threads (id, title, created_at, updated_at, last_message_at)
     VALUES (1, 'Acme launch questions', ?, ?, ?)`,
  ).run(now, now, now)
  db.prepare(
    `INSERT INTO ai_messages (conversation_id, role, content, created_at, thread_id)
     VALUES (1, 'user', 'What did I do for Acme today?', ?, 1)`,
  ).run(now)
  db.prepare(
    `INSERT INTO category_overrides (bundle_id, category, updated_at)
     VALUES ('com.figma.Desktop', 'design', ?)`,
  ).run(now)
}

test('a representative v25 database upgrades through every migration and keeps its day', () => {
  const fixture = loadDayFixture(REPRESENTATIVE_FIXTURE)
  assert.ok(isNormalizedEvidenceDayFixture(fixture), 'representative fixture must be normalized evidence')

  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(fs.readFileSync(BASELINE_SCHEMA_PATH, 'utf8'))
  // A real v25 install also carried the search schema (its definition has not
  // changed since), created by the migration that introduced it.
  ensureSearchSchema(db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)
  db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
    BASELINE_SCHEMA_VERSION,
    0,
  )
  seedRepresentativeDay(db, fixture)

  setTestDb(db)
  const log = console.log
  console.log = () => {}
  try {
    // Production startup order for an existing database: current SCHEMA_SQL
    // (all IF NOT EXISTS), then the versioned ladder, then schema repair.
    assert.doesNotThrow(() => db.exec(SCHEMA_SQL))
    assert.doesNotThrow(() => runMigrations())
    console.log = log

    const version = (
      db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number }
    ).v
    assert.equal(version, LATEST_SCHEMA_VERSION, 'ladder must reach the latest schema version')

    ensureAIThreadSchema(db)
    syncDerivedStateMetadata(db)

    // The representative day still projects: every expected episode has an
    // overlapping block whose label matches.
    const payload = getTimelineDayPayload(db, fixture.date, null, { materialize: false })
    assert.ok(payload.blocks.length > 0, 'upgraded day produced no timeline blocks')
    for (const expected of fixture.expected.episodes) {
      const startMs = msForClock(fixture.date, expected.start)
      const endMs = msForClock(fixture.date, expected.end)
      const overlapping = payload.blocks.filter(
        (block) => Math.min(block.endTime, endMs) - Math.max(block.startTime, startMs) > 0,
      )
      assert.ok(overlapping.length > 0, `no block overlaps episode ${expected.id} after upgrade`)
      const labelTerms = expected.labelIncludes ?? [expected.label]
      assert.ok(
        overlapping.some((block) =>
          labelTerms.some((term) =>
            normalize(userVisibleLabelForBlock(block)).includes(normalize(term)),
          ),
        ),
        `episode ${expected.id} lost its label after upgrade (got ${overlapping
          .map((block) => userVisibleLabelForBlock(block))
          .join(' | ')})`,
      )
    }

    // Apps totals and search read the migrated evidence.
    const dayStartMs = msForClock(fixture.date, '00:00')
    const summaries = getCorrectedAppSummariesForRange(db, dayStartMs, dayStartMs + 86_400_000)
    for (const expectedApp of fixture.expected.apps ?? []) {
      assert.ok(
        summaries.some(
          (summary) => normalize(summary.appName) === normalize(expectedApp.appName),
        ),
        `Apps lost "${expectedApp.appName}" after upgrade (got ${summaries
          .map((summary) => summary.appName)
          .join(', ')})`,
      )
    }
    const acme = searchAll(db, 'acme', {
      startDate: fixture.date,
      endDate: fixture.date,
      limit: 20,
    })
    assert.ok(acme.length > 0, 'search finds nothing on the upgraded database')

    // Legacy AI thread data survived the ladder.
    const thread = db
      .prepare('SELECT title FROM ai_threads WHERE id = 1')
      .get() as { title: string } | undefined
    assert.equal(thread?.title, 'Acme launch questions')
    const message = db
      .prepare('SELECT content FROM ai_messages WHERE thread_id = 1')
      .get() as { content: string } | undefined
    assert.match(message?.content ?? '', /Acme/)

    // Corrections work on the upgraded database and survive a rebuild.
    const firstBlock = payload.blocks[0]
    writeTimelineBlockReview(db, fixture.date, firstBlock, {
      state: 'corrected',
      correctedLabel: 'Acme portal checkout sprint',
    })
    invalidateTimelineDayBlocks(db, fixture.date)
    const corrected = getTimelineDayPayload(db, fixture.date, null, { materialize: false })
    assert.ok(
      corrected.blocks.some(
        (block) => userVisibleLabelForBlock(block) === 'Acme portal checkout sprint',
      ),
      'post-upgrade correction did not survive a timeline rebuild',
    )
  } finally {
    console.log = log
    clearTestDb()
    db.close()
  }
})
