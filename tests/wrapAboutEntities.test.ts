// The wrap's "what the day was about" scene: the durable entities the day's
// evidence supports naming. Deterministic end to end — entities earn time only
// through overlap with the day's SURVIVING blocks (deleted evidence lends
// nothing), high-sensitivity entities never surface, raw-artifact names are
// dropped, and the scene is simply absent when the ledger has nothing to say.
import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { entitiesForDayWrap } from '../src/main/services/entities/dayEntities.ts'
import { addEntityEvidenceRef, upsertEntity, type EntityType } from '../src/main/services/entities/entityRepository.ts'
import { getTimelineDayPayload, writeIgnoredBlockReviewBackstop } from '../src/main/services/workBlocks.ts'
import { buildDayWrapFacts, type DayWrapFacts } from '../src/renderer/lib/dayWrapScenes.ts'
import { planDayWrapSlides } from '../src/renderer/lib/wrapDeck.ts'
import { computeFactsHash } from '../src/main/lib/wrappedNarrative.ts'
import { buildDayFactTable } from '../src/main/lib/wrapFactTable.ts'
import { randomUUID } from 'node:crypto'
import type { DayWrapEntity } from '../src/shared/types.ts'

const TEST_DATE = '2026-04-22'

function localMs(hour: number, minute = 0): number {
  return new Date(2026, 3, 22, hour, minute, 0, 0).getTime()
}

function seedEntityWithSpan(
  db: Database.Database,
  opts: {
    type: EntityType
    name: string
    spanStart: number
    spanEnd: number
    sensitivity?: 'standard' | 'personal' | 'high'
  },
): string {
  const entity = upsertEntity(db, {
    type: opts.type,
    identityKey: `test:${opts.name.toLowerCase()}`,
    name: opts.name,
    origin: 'observed',
    sensitivity: opts.sensitivity ?? 'standard',
    observedAt: opts.spanStart,
  })
  addEntityEvidenceRef(db, entity.id, {
    sourceType: 'test_span',
    sourceId: `span:${opts.name}:${opts.spanStart}`,
    spanStartMs: opts.spanStart,
    spanEndMs: opts.spanEnd,
  })
  return entity.id
}

const DAY_BLOCKS = [
  { startTime: localMs(9), endTime: localMs(12) },
  { startTime: localMs(14), endTime: localMs(16) },
]

test('entities earn time only where their evidence overlaps surviving blocks', () => {
  const db = createProductionTestDatabase()
  // Two hours of evidence, but only one hour inside a block.
  seedEntityWithSpan(db, { type: 'project', name: 'The billing rework', spanStart: localMs(11), spanEnd: localMs(13) })
  // Evidence entirely outside every block: contributes nothing.
  seedEntityWithSpan(db, { type: 'client', name: 'Andersen', spanStart: localMs(19), spanEnd: localMs(21) })

  const entities = entitiesForDayWrap(db, TEST_DATE, DAY_BLOCKS)
  assert.equal(entities.length, 1)
  assert.equal(entities[0].name, 'The billing rework')
  assert.equal(entities[0].seconds, 3600, 'only the in-block hour counts')
  db.close()
})

test('high-sensitivity entities, raw-artifact names, and non-wrap types never surface', () => {
  const db = createProductionTestDatabase()
  seedEntityWithSpan(db, { type: 'person', name: 'Sam', spanStart: localMs(9), spanEnd: localMs(10) })
  seedEntityWithSpan(db, { type: 'person', name: 'Dr. Chen', spanStart: localMs(9), spanEnd: localMs(10), sensitivity: 'high' })
  seedEntityWithSpan(db, { type: 'project', name: 'feat/billing_rework', spanStart: localMs(9), spanEnd: localMs(10) })
  seedEntityWithSpan(db, { type: 'application', name: 'Cursor', spanStart: localMs(9), spanEnd: localMs(10) })

  const names = entitiesForDayWrap(db, TEST_DATE, DAY_BLOCKS).map((e) => e.name)
  assert.deepEqual(names, ['Sam'])
  db.close()
})

test('a passing mention below the threshold is not what the day was about', () => {
  const db = createProductionTestDatabase()
  seedEntityWithSpan(db, { type: 'meeting', name: 'Design review', spanStart: localMs(9), spanEnd: localMs(9, 5) })
  assert.deepEqual(entitiesForDayWrap(db, TEST_DATE, DAY_BLOCKS), [])
  db.close()
})

// ─── Through the payload: deletion is honored by construction ────────────────

function insertFocusEvent(
  db: Database.Database,
  tsMs: number,
  eventType: string,
  bundleId: string,
  appName: string,
): void {
  db.prepare(`
    INSERT INTO focus_events (
      ts_ms, mono_ns, event_type, app_bundle_id, app_name, pid,
      window_title, url, page_title, source, confidence, platform, schema_ver
    ) VALUES (?, ?, ?, ?, ?, 4242, 'Work', NULL, NULL, 'foreground_poll', 'observed', 'darwin', 2)
  `).run(tsMs, tsMs * 1_000_000, eventType, bundleId, appName)
}

test('the payload names day entities, and deleting the underlying stretch removes them', () => {
  const db = createProductionTestDatabase()
  insertFocusEvent(db, localMs(9), 'app_activated', 'com.mitchellh.ghostty', 'Ghostty')
  insertFocusEvent(db, localMs(10, 45), 'app_deactivated', 'com.mitchellh.ghostty', 'Ghostty')
  seedEntityWithSpan(db, { type: 'project', name: 'The billing rework', spanStart: localMs(9), spanEnd: localMs(10, 45) })

  const before = getTimelineDayPayload(db, TEST_DATE, null, { materialize: false })
  assert.deepEqual((before.dayEntities ?? []).map((e) => e.name), ['The billing rework'])

  // Delete the whole stretch the evidence sat inside.
  writeIgnoredBlockReviewBackstop(db, {
    date: TEST_DATE,
    blockId: `ignored_${randomUUID().slice(0, 8)}`,
    evidenceKey: `ignored_${randomUUID().slice(0, 8)}`,
    originalBlockJson: JSON.stringify({ startTime: localMs(9), endTime: localMs(10, 45) }),
  })

  const after = getTimelineDayPayload(db, TEST_DATE, null, { materialize: false })
  assert.deepEqual(after.dayEntities ?? [], [], 'no surviving block, no named entity')
  db.close()
})

// ─── The scene itself ─────────────────────────────────────────────────────────

function factsWith(entities: DayWrapEntity[]): DayWrapFacts {
  return {
    date: '2026-04-22', weekday: 'WEDNESDAY', dateLabel: 'APR 22',
    workSeconds: 4 * 3600, leisureSeconds: 3600, personalSeconds: 0, meetingsSeconds: 0,
    activeSeconds: 5 * 3600,
    workActivities: [{ name: 'Daylens', seconds: 4 * 3600, category: 'development', kind: 'work' }],
    ribbon: [], ribbonStartClock: '9:12am', ribbonEndClock: '6:04pm',
    standout: null, topLeisure: [], isLeisureDay: false, quality: 'full',
    seed: 7, appSites: [], candidateHooks: [], wildcardHook: null,
    dayStory: [], mainStartClock: '9:12am', titleContext: [],
    entities,
  } as unknown as DayWrapFacts
}

const TWO_ENTITIES: DayWrapEntity[] = [
  { id: 'ent_a', type: 'project', name: 'The billing rework', seconds: 2 * 3600 },
  { id: 'ent_b', type: 'client', name: 'Andersen', seconds: 45 * 60 },
]

test('the about scene is pinned after coverage, names the entities, and is absent without them', () => {
  const slides = planDayWrapSlides(factsWith(TWO_ENTITIES))
  assert.equal(slides[3].id, 'about')
  assert.equal(slides[3].kind, 'bars')
  assert.deepEqual(slides[3].bars?.map((b) => b.name), ['The billing rework', 'Andersen'])
  assert.match(slides[3].fallbackLine, /The billing rework/)
  assert.match(slides[3].ask, /never invent a project, client, person, or meeting/i)

  const without = planDayWrapSlides(factsWith([]))
  assert.ok(!without.some((s) => s.id === 'about'), 'no entities, no scene, no padding')
})

test('entities move the facts hash and land in the fact table', () => {
  const withEntities = factsWith(TWO_ENTITIES)
  const withoutEntities = factsWith([])
  assert.notEqual(
    computeFactsHash(withEntities, null),
    computeFactsHash(withoutEntities, null),
    'renaming or removing an entity reflows the wrap',
  )

  const table = buildDayFactTable(withEntities, [], withEntities.date, null)
  assert.equal(table.facts['about.the-billing-rework.label']?.value, 'The billing rework')
  assert.ok(table.facts['about.the-billing-rework.duration'], 'entity time is a groundable fact')
  assert.equal(table.facts['about.andersen.label']?.value, 'Andersen')
})
