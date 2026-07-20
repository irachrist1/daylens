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
import { indexMemoryForDay } from '../src/main/services/memoryIndex.ts'

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

  // Attribution-era rows the v50 entity adoption must carry into the entity
  // store KEEPING their identifiers, and the projects rebuild must preserve.
  db.prepare(`
    INSERT INTO clients (id, name, status, created_at, updated_at)
    VALUES ('legacy-client-acme', 'Acme Corp', 'active', ?, ?)
  `).run(now, now)
  db.prepare(`
    INSERT INTO client_aliases (id, client_id, alias, alias_normalized, source, created_at)
    VALUES ('legacy-ca-1', 'legacy-client-acme', 'acme', 'acme', 'user', ?)
  `).run(now)
  db.prepare(`
    INSERT INTO projects (id, client_id, name, status, created_at, updated_at)
    VALUES ('legacy-project-portal', 'legacy-client-acme', 'Portal checkout', 'active', ?, ?)
  `).run(now, now)
  db.prepare(`
    INSERT INTO project_aliases (id, project_id, alias, alias_normalized, source, created_at)
    VALUES ('legacy-pa-1', 'legacy-project-portal', 'portal', 'portal', 'user', ?)
  `).run(now)
  db.prepare(`
    INSERT INTO artifacts (id, artifact_type, canonical_key, display_title, first_seen_at, last_seen_at)
    VALUES ('legacy-art-doc', 'document', 'doc:/notes/checkout-plan.md', 'checkout-plan.md', ?, ?)
  `).run(now - 3_600_000, now)
  db.prepare(`
    INSERT INTO app_identities (app_instance_id, bundle_id, raw_app_name, canonical_app_id, display_name, first_seen_at, last_seen_at)
    VALUES ('legacy-app-figma', 'com.figma.Desktop', 'Figma', 'figma', 'Figma', ?, ?)
  `).run(now - 86_400_000, now)
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
  // changed since), created by the migration that introduced it. Tables that
  // migrations <= 25 created outside SCHEMA_SQL are absent here; if a future
  // migration alters one of those, this fixture must gain its v25 shape too.
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
    db.exec(SCHEMA_SQL)
    runMigrations()
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
      const summary = summaries.find(
        (candidate) => normalize(candidate.appName) === normalize(expectedApp.appName),
      )
      assert.ok(
        summary,
        `Apps lost "${expectedApp.appName}" after upgrade (got ${summaries
          .map((summary) => summary.appName)
          .join(', ')})`,
      )
      if (summary && expectedApp.durationMinutes != null) {
        const tolerance = expectedApp.durationToleranceMinutes ?? 5
        assert.ok(
          Math.abs(summary.totalSeconds / 60 - expectedApp.durationMinutes) <= tolerance,
          `Apps changed "${expectedApp.appName}" duration after upgrade`,
        )
      }
    }
    for (const expectedSearch of fixture.expected.search ?? []) {
      const rows = searchAll(db, expectedSearch.query, {
        startDate: fixture.date,
        endDate: fixture.date,
        limit: 50,
      })
      const resultText = normalize(JSON.stringify(rows))
      for (const fact of expectedSearch.requiredFacts ?? []) {
        assert.ok(resultText.includes(normalize(fact)), `search lost "${fact}" after upgrade`)
      }
      for (const fact of expectedSearch.prohibitedFacts ?? []) {
        assert.ok(!resultText.includes(normalize(fact)), `search leaked "${fact}" after upgrade`)
      }
    }

    // v52 exact retrieval: the memory tables exist, the day projects into
    // records, and every search fact that held on the legacy path still holds
    // once the day is served by the memory index (DEV-178 legacy parity).
    for (const table of ['memory_records', 'memory_record_entities', 'memory_index_days']) {
      assert.ok(
        db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table),
        `v52 must create ${table}`,
      )
    }
    const indexed = indexMemoryForDay(db, fixture.date)
    assert.ok(indexed.records > 0, 'the upgraded day projected into memory records')
    for (const expectedSearch of fixture.expected.search ?? []) {
      const rows = searchAll(db, expectedSearch.query, {
        startDate: fixture.date,
        endDate: fixture.date,
        limit: 50,
      })
      const resultText = normalize(JSON.stringify(rows))
      for (const fact of expectedSearch.requiredFacts ?? []) {
        assert.ok(resultText.includes(normalize(fact)), `memory-indexed search lost "${fact}"`)
      }
      for (const fact of expectedSearch.prohibitedFacts ?? []) {
        assert.ok(!resultText.includes(normalize(fact)), `memory-indexed search leaked "${fact}"`)
      }
    }

    // Legacy AI thread data survived the ladder.
    const thread = db
      .prepare('SELECT title FROM ai_threads WHERE id = 1')
      .get() as { title: string } | undefined
    assert.equal(thread?.title, 'Acme launch questions')
    const message = db
      .prepare('SELECT content FROM ai_messages WHERE thread_id = 1')
      .get() as { content: string } | undefined
    assert.match(message?.content ?? '', /Acme/)

    // v50 durable entities: adoption kept the legacy identifiers, the alias
    // came along, and the app identity + artifact became entities too.
    const clientEntity = db
      .prepare(`SELECT entity_type, origin, canonical_name FROM entities WHERE id = 'legacy-client-acme'`)
      .get() as { entity_type: string; origin: string; canonical_name: string } | undefined
    assert.equal(clientEntity?.entity_type, 'client', 'the legacy client became a client entity with the SAME id')
    assert.equal(clientEntity?.origin, 'supplied')
    assert.equal(
      (db.prepare(`SELECT entity_type FROM entities WHERE id = 'legacy-project-portal'`).get() as { entity_type: string } | undefined)?.entity_type,
      'project',
    )
    assert.equal(
      (db.prepare(`SELECT entity_type FROM entities WHERE id = 'legacy-art-doc'`).get() as { entity_type: string } | undefined)?.entity_type,
      'file',
    )
    assert.equal(
      (db.prepare(`SELECT entity_type FROM entities WHERE id = 'legacy-app-figma'`).get() as { entity_type: string } | undefined)?.entity_type,
      'application',
    )
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM entity_aliases WHERE entity_id = 'legacy-client-acme' AND alias_normalized = 'acme'`).get() as { c: number }).c,
      1,
      'the client alias was adopted',
    )

    // v50 projects rebuild: client_id relaxed to nullable with FKs enforced —
    // a client-less project inserts cleanly, existing rows and aliases intact.
    const projectsSql = (db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'projects'`)
      .get() as { sql: string }).sql
    assert.ok(!/client_id\s+TEXT\s+NOT\s+NULL/i.test(projectsSql), 'projects.client_id lost its NOT NULL')
    db.prepare(`
      INSERT INTO projects (id, client_id, name, status, created_at, updated_at)
      VALUES ('clientless-project', NULL, 'Side quest', 'active', ?, ?)
    `).run(Date.now(), Date.now())
    assert.equal(
      (db.prepare(`SELECT client_id FROM projects WHERE id = 'clientless-project'`).get() as { client_id: string | null }).client_id,
      null,
    )
    assert.equal(
      (db.prepare(`SELECT name FROM projects WHERE id = 'legacy-project-portal'`).get() as { name: string }).name,
      'Portal checkout',
      'existing projects survived the table rebuild',
    )
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM project_aliases WHERE project_id = 'legacy-project-portal'`).get() as { c: number }).c,
      1,
      'project aliases survived the rebuild backup dance',
    )
    // The FK still enforces valid clients for projects that HAVE one.
    assert.throws(() => {
      db.prepare(`
        INSERT INTO projects (id, client_id, name, status, created_at, updated_at)
        VALUES ('bad-project', 'no-such-client', 'Broken', 'active', ?, ?)
      `).run(Date.now(), Date.now())
    }, /FOREIGN KEY/)

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
