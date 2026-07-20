// DEV-180: semantic "found by meaning" retrieval over the memory index.
//
// Proves the batch's load-bearing behaviors end to end on a production
// database with the REAL engine store (sqlite-vec vec0 k-NN) and a
// deterministic fixture embedder standing in for the model pipeline (the
// pinned MiniLM artifact is a downloaded asset, not a committed one — the
// embedder seam is the only stubbed piece):
//   1. pending memory records embed in bounded batches and are stamped with
//      the engine identity; a vague query with NO word overlap finds the
//      moment by meaning, clearly labeled, while exact search misses it;
//   2. corrections and deletions propagate — a day re-projection kills the
//      embeddings through the bookkeeping cascade in the same transaction,
//      orphaned vec0 rows never surface and are swept; undo re-embeds;
//   3. query-time guardrails match the exact readers — date bounds and
//      late-landing evidence exclusions filter by-meaning hits too;
//   4. no model → honest absence: by-meaning returns nothing, status says
//      why, exact search is untouched;
//   5. an embedding-version bump re-embeds in place;
//   6. the agent's search gains semanticHits with the same guardrails.
import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { searchSessions } from '../src/main/db/queries.ts'
import { indexMemoryForDay, ensureDayMemoryIndexed } from '../src/main/services/memoryIndex.ts'
import {
  countSemanticEmbedded,
  countSemanticPending,
  ensureVectorStore,
  getSemanticSearchStatus,
  reconcileLostVectors,
  searchByMeaning,
  semanticIndexStep,
  semanticIndexingPausedNow,
  setSemanticPowerStateProviderForTests,
  startSemanticIndexBackfill,
  stopSemanticIndexBackfill,
  sweepOrphanedVectors,
} from '../src/main/services/semanticIndex.ts'
import {
  setSemanticEmbedderFactoryForTests,
  SEMANTIC_EMBEDDING_DIMS,
  type SemanticEmbedder,
} from '../src/main/services/semanticEmbedder.ts'
import { execSearchSessionsWithMeaning } from '../src/main/services/aiTools.ts'

const DATE = '2026-04-22'

function localMs(hour: number, minute = 0): number {
  return new Date(2026, 3, 22, hour, minute, 0, 0).getTime()
}

function insertSession(
  db: Database.Database,
  title: string,
  startHour: number,
  startMinute: number,
  durationMinutes: number,
): void {
  const startTime = localMs(startHour, startMinute)
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, capture_source, capture_version
    ) VALUES ('com.mitchellh.ghostty', 'Ghostty', ?, ?, ?, 'development', 1, ?, 'Ghostty', 'test', 1)
  `).run(startTime, startTime + durationMinutes * 60_000, durationMinutes * 60, title)
}

// ─── Fixture embedder ────────────────────────────────────────────────────────
// Deterministic concept-axis embeddings: synonyms land on the same axis, so
// "cheap television offers" is CLOSE to "Best OLED TV discounts" (no shared
// words) and FAR from "Marathon training plan". Unrelated tokens spread over
// hashed axes; a constant bias axis keeps vectors non-zero. Real cosine
// geometry through the real vec0 index — only the model is substituted.

const CONCEPTS: string[][] = [
  ['tv', 'television', 'oled', 'screen'],
  ['price', 'pricing', 'discount', 'deal', 'cost', 'cheap', 'markdown', 'offer'],
  ['doc', 'document', 'note', 'plan', 'agenda'],
  ['marathon', 'training', 'run'],
  ['offsite', 'retreat', 'team'],
]

function tokenAxis(token: string): number {
  let hash = 0
  for (const char of token) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return CONCEPTS.length + 1 + (hash % (SEMANTIC_EMBEDDING_DIMS - CONCEPTS.length - 1))
}

function fixtureVector(text: string): Float32Array {
  const vector = new Float32Array(SEMANTIC_EMBEDDING_DIMS)
  vector[CONCEPTS.length] = 1 // bias axis
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    .map((token) => token.replace(/s$/, ''))
  for (const token of tokens) {
    const conceptIndex = CONCEPTS.findIndex((concept) => concept.includes(token))
    if (conceptIndex >= 0) vector[conceptIndex] += 4
    else vector[tokenAxis(token)] += 1
  }
  let norm = 0
  for (const value of vector) norm += value * value
  norm = Math.sqrt(norm)
  for (let index = 0; index < vector.length; index += 1) vector[index] /= norm
  return vector
}

function fixtureEmbedder(overrides: Partial<Pick<SemanticEmbedder, 'model' | 'version'>> = {}): SemanticEmbedder {
  return {
    model: overrides.model ?? 'fixture-embedder',
    version: overrides.version ?? 1,
    dims: SEMANTIC_EMBEDDING_DIMS,
    embed: (texts) => Promise.resolve(texts.map((text) => fixtureVector(text))),
  }
}

function useFixtureEmbedder(embedder: SemanticEmbedder = fixtureEmbedder()): void {
  setSemanticEmbedderFactoryForTests(() => ({ ok: true, embedder }))
}

test.afterEach(() => {
  setSemanticEmbedderFactoryForTests(null)
  setSemanticPowerStateProviderForTests(null)
  stopSemanticIndexBackfill()
})

async function seedAndEmbed(db: Database.Database, embedder = fixtureEmbedder()): Promise<void> {
  insertSession(db, 'Best OLED TV discounts', 9, 0, 45)
  insertSession(db, 'Marathon training plan', 14, 0, 30)
  indexMemoryForDay(db, DATE)
  const progress = await semanticIndexStep(db, embedder)
  assert.ok(progress.embedded >= 2, `expected at least 2 embedded, got ${progress.embedded}`)
  assert.equal(progress.done, true)
}

test('pending records embed in bounded batches and are stamped with the engine identity', async () => {
  const db = createProductionTestDatabase()
  insertSession(db, 'Best OLED TV discounts', 9, 0, 45)
  insertSession(db, 'Marathon training plan', 14, 0, 30)
  indexMemoryForDay(db, DATE)

  const embedder = fixtureEmbedder()
  assert.equal(countSemanticPending(db, embedder), 2, 'freshly projected records are pending')

  // Bounded batch: one per step, newest first.
  const first = await semanticIndexStep(db, embedder, { batchSize: 1 })
  assert.equal(first.embedded, 1)
  assert.equal(first.done, false)
  const second = await semanticIndexStep(db, embedder, { batchSize: 1 })
  assert.equal(second.embedded, 1)
  assert.equal(second.done, true)

  const stamped = db.prepare(`
    SELECT COUNT(*) AS c FROM memory_records
    WHERE embedding_model = 'fixture-embedder' AND embedding_version = 1
  `).get() as { c: number }
  assert.equal(stamped.c, 2, 'records carry the embedding model + version')
  assert.equal(countSemanticEmbedded(db), 2)
  const vecRows = db.prepare(`SELECT COUNT(*) AS c FROM memory_semantic_vec`).get() as { c: number }
  assert.equal(vecRows.c, 2, 'the vec0 index holds one vector per record')

  // Idempotent: nothing left to do.
  const third = await semanticIndexStep(db, embedder)
  assert.equal(third.embedded, 0)
  assert.equal(third.done, true)
})

test('a vague query finds the moment by meaning where exact search misses; hits carry the honest label', async () => {
  const db = createProductionTestDatabase()
  useFixtureEmbedder()
  await seedAndEmbed(db)

  // No word overlap: "cheap television offers" vs "Best OLED TV discounts".
  assert.equal(
    searchSessions(db, 'cheap television offers', { limit: 10 }).length,
    0,
    'exact search cannot answer — the words never appeared',
  )

  const hits = await searchByMeaning(db, 'cheap television offers', { limit: 10 })
  assert.ok(hits.length >= 1, 'the by-meaning path answers')
  assert.equal(hits[0].windowTitle, 'Best OLED TV discounts')
  assert.equal(hits[0].foundBy, 'meaning', 'hits are labeled as found by meaning')
  assert.ok((hits[0].similarity ?? 0) > 0.3, 'similarity is reported')
  assert.ok(
    !hits.some((hit) => hit.windowTitle === 'Marathon training plan'),
    'an unrelated moment stays out (distance ceiling)',
  )
})

test('a correction kills embeddings through the cascade; orphaned vectors never surface and are swept; undo re-embeds', async () => {
  const db = createProductionTestDatabase()
  useFixtureEmbedder()
  await seedAndEmbed(db)
  assert.equal((await searchByMeaning(db, 'cheap television offers')).length, 1)

  // The user deletes the morning block. Re-projection removes the record —
  // the bookkeeping row dies in the SAME transaction (ON DELETE CASCADE).
  db.prepare(`
    INSERT INTO timeline_block_reviews (id, block_id, date, evidence_key, review_state, original_block_json, correction_json, created_at, updated_at)
    VALUES ('rev-ignore', 'blk-morning', ?, 'ek', 'ignored', ?, '{}', ?, ?)
  `).run(DATE, JSON.stringify({ startTime: localMs(9), endTime: localMs(10) }), Date.now(), Date.now())
  indexMemoryForDay(db, DATE)

  assert.equal(
    (await searchByMeaning(db, 'cheap television offers')).length,
    0,
    'the deleted stretch is gone from by-meaning search immediately — no embedding step needed',
  )
  // The vec0 rows are orphans now (invisible via the bookkeeping join); the
  // next step sweeps them.
  const orphansBefore = (db.prepare(`SELECT COUNT(*) AS c FROM memory_semantic_vec`).get() as { c: number }).c
  assert.ok(orphansBefore >= 2, 'old vec0 rows linger as invisible orphans until swept')
  const swept = sweepOrphanedVectors(db)
  assert.ok(swept >= 2, 'the sweep reclaims orphaned vectors')

  // Undo: the day re-projects, records come back pending, the background
  // step re-embeds — "undoing an exclusion restores them, including
  // re-embedding" (spec §Corrections and deletion).
  db.prepare(`DELETE FROM timeline_block_reviews WHERE id = 'rev-ignore'`).run()
  indexMemoryForDay(db, DATE)
  assert.equal((await searchByMeaning(db, 'cheap television offers')).length, 0, 'not yet re-embedded')
  const embedder = fixtureEmbedder()
  assert.ok(countSemanticPending(db, embedder) >= 2, 'restored records are pending again')
  await semanticIndexStep(db, embedder)
  const restored = await searchByMeaning(db, 'cheap television offers')
  assert.equal(restored.length, 1, 'undo restores the by-meaning result after re-embedding')
})

test('purged raw evidence never resurrects through the semantic index', async () => {
  const db = createProductionTestDatabase()
  useFixtureEmbedder()
  await seedAndEmbed(db)

  db.prepare(`DELETE FROM app_sessions`).run()
  assert.equal(ensureDayMemoryIndexed(db, DATE), true, 'the purge changes the fingerprint')
  assert.equal((await searchByMeaning(db, 'cheap television offers')).length, 0, 'nothing resurrects')
  assert.equal(countSemanticEmbedded(db), 0, 'the bookkeeping cascaded to zero')
})

test('by-meaning hits respect date bounds and query-time correction filters', async () => {
  const db = createProductionTestDatabase()
  useFixtureEmbedder()
  await seedAndEmbed(db)

  assert.equal(
    (await searchByMeaning(db, 'cheap television offers', { startDate: '2026-04-23' })).length,
    0,
    'a date filter before the moment excludes it',
  )

  // A late-landing exclusion is honored at query time even before the day
  // re-projects or re-embeds — same belt-and-braces as the exact readers.
  db.prepare(`
    INSERT INTO evidence_exclusions (id, date, kind, bundle_id, app_name, domain, span_start_ms, span_end_ms, created_at)
    VALUES ('excl-1', ?, 'app', 'com.mitchellh.ghostty', 'Ghostty', NULL, ?, ?, ?)
  `).run(DATE, localMs(9), localMs(10), Date.now())
  assert.equal(
    (await searchByMeaning(db, 'cheap television offers')).length,
    0,
    'excluded evidence never surfaces, even from stale embeddings',
  )
})

test('no model → honest absence: by-meaning is empty, status says why, exact search untouched', async () => {
  const db = createProductionTestDatabase()
  insertSession(db, 'Best OLED TV discounts', 9, 0, 45)
  indexMemoryForDay(db, DATE)

  setSemanticEmbedderFactoryForTests(() => ({
    ok: false,
    reason: 'model-missing',
    detail: 'fixture: artifact absent',
  }))

  assert.deepEqual(await searchByMeaning(db, 'cheap television offers'), [], 'no fake results')
  const status = await getSemanticSearchStatus(db)
  assert.equal(status.available, false)
  assert.equal(status.reason, 'model-missing')
  assert.equal(status.engine, 'sqlite-vec')
  assert.equal(
    searchSessions(db, 'OLED discounts', { limit: 10 }).length,
    1,
    'exact search answers exactly as before',
  )
})

test('an embedding-version bump re-embeds records in place', async () => {
  const db = createProductionTestDatabase()
  useFixtureEmbedder()
  await seedAndEmbed(db)

  const upgraded = fixtureEmbedder({ version: 2 })
  assert.equal(countSemanticPending(db, upgraded), 2, 'a version bump makes every record pending')
  const progress = await semanticIndexStep(db, upgraded)
  assert.equal(progress.embedded, 2)
  assert.equal(progress.done, true)
  const versions = db.prepare(`SELECT DISTINCT model_version FROM memory_record_vectors`).all() as Array<{ model_version: number }>
  assert.deepEqual(versions.map((row) => row.model_version), [2], 'old vectors are replaced, not accumulated')

  useFixtureEmbedder(upgraded)
  assert.equal((await searchByMeaning(db, 'cheap television offers')).length, 1, 'search works after the swap')
})

test("the agent's search gains semanticHits with the same guardrails, deduped from exact hits", async () => {
  const db = createProductionTestDatabase()
  useFixtureEmbedder()
  await seedAndEmbed(db)

  // Vague query: exact misses, the semantic lead arrives separately.
  const vague = await execSearchSessionsWithMeaning({ query: 'cheap television offers' }, db)
  assert.ok(vague.semanticHits && vague.semanticHits.length >= 1, 'semanticHits are present')
  assert.equal(vague.semanticHits?.[0].windowTitle, 'Best OLED TV discounts')
  assert.equal(vague.semanticHits?.[0].foundBy, 'meaning')
  assert.match(vague._instruction ?? '', /similar meaning/i, 'the model is told these matched by meaning')

  // Exact query: the same moment is a strict hit, so the semantic twin is
  // deduped away rather than double-counted.
  const exact = await execSearchSessionsWithMeaning({ query: 'OLED discounts' }, db)
  assert.equal(exact.matchKind, 'strict')
  const strictKeys = new Set(exact.hits.map((hit) => `${hit.id}:${hit.startTime}`))
  for (const hit of exact.semanticHits ?? []) {
    assert.ok(!strictKeys.has(`${hit.id}:${hit.startTime}`), 'semanticHits never duplicate exact hits')
  }

  // An ignored block filters semantic leads exactly like exact hits.
  db.prepare(`
    INSERT INTO timeline_block_reviews (id, block_id, date, evidence_key, review_state, original_block_json, correction_json, created_at, updated_at)
    VALUES ('rev-agent', 'blk-agent', ?, 'ek', 'ignored', ?, '{}', ?, ?)
  `).run(DATE, JSON.stringify({ startTime: localMs(9), endTime: localMs(10) }), Date.now(), Date.now())
  const afterCorrection = await execSearchSessionsWithMeaning({ query: 'cheap television offers' }, db)
  assert.ok(
    !(afterCorrection.semanticHits ?? []).some((hit) => hit.windowTitle === 'Best OLED TV discounts'),
    'a deleted stretch never reaches the agent through the semantic path',
  )

  // No model → the result is exactly the exact-search result.
  setSemanticEmbedderFactoryForTests(() => ({ ok: false, reason: 'model-missing', detail: 'fixture' }))
  const withoutModel = await execSearchSessionsWithMeaning({ query: 'cheap television offers' }, db)
  assert.equal(withoutModel.semanticHits, undefined, 'no semanticHits key when the model is absent')
})

test('vague-memory fixtures retrieve the accepted result through local semantic search', async () => {
  const db = createProductionTestDatabase()
  useFixtureEmbedder()
  // Ticket-shaped fixtures: the probe shares little or no wording with the
  // accepted result; meaning has to carry it past the distractors.
  insertSession(db, 'Best OLED TV markdowns', 9, 0, 30)
  insertSession(db, 'Team offsite agenda notes', 11, 0, 30)
  insertSession(db, 'Marathon training schedule', 14, 0, 30)
  indexMemoryForDay(db, DATE)
  await semanticIndexStep(db, fixtureEmbedder())

  const fixtures = [
    { probe: 'the TV page with the best discount', accepted: 'Best OLED TV markdowns' },
    { probe: 'the doc where we planned the team retreat', accepted: 'Team offsite agenda notes' },
  ]
  for (const fixture of fixtures) {
    const hits = await searchByMeaning(db, fixture.probe, { limit: 10 })
    assert.equal(
      hits[0]?.windowTitle,
      fixture.accepted,
      `"${fixture.probe}" must retrieve "${fixture.accepted}" first, got ${JSON.stringify(hits.map((hit) => hit.windowTitle))}`,
    )
  }
})

test('high-sensitivity memory never enters the semantic index and never surfaces if marked late', async () => {
  const db = createProductionTestDatabase()
  useFixtureEmbedder()
  insertSession(db, 'Best OLED TV discounts', 9, 0, 45)
  insertSession(db, 'Confidential television settlement terms', 11, 0, 30)
  indexMemoryForDay(db, DATE)

  // The records layer marks the late-morning moment high-sensitivity.
  db.prepare(`
    UPDATE memory_records SET sensitivity = 'high' WHERE title = 'Confidential television settlement terms'
  `).run()

  const embedder = fixtureEmbedder()
  assert.equal(countSemanticPending(db, embedder), 1, 'the high-sensitivity record is not pending')
  await semanticIndexStep(db, embedder)
  assert.equal(countSemanticEmbedded(db), 1, 'only the standard record was embedded')
  assert.equal(
    (db.prepare(`SELECT embedding_model FROM memory_records WHERE sensitivity = 'high'`).get() as { embedding_model: string | null }).embedding_model,
    null,
    'the high-sensitivity record is never stamped',
  )
  const hits = await searchByMeaning(db, 'cheap television offers', { limit: 10 })
  assert.ok(hits.length >= 1)
  assert.ok(
    !hits.some((hit) => hit.windowTitle === 'Confidential television settlement terms'),
    'high-sensitivity content is absent from by-meaning results',
  )

  // Marked high AFTER being embedded: the query-time filter hides it
  // immediately, before any re-projection or re-embed cleans up.
  db.prepare(`UPDATE memory_records SET sensitivity = 'high' WHERE title = 'Best OLED TV discounts'`).run()
  assert.equal(
    (await searchByMeaning(db, 'cheap television offers', { limit: 10 })).length,
    0,
    'a record marked high after embedding stops surfacing at query time',
  )
  // …and the next background step scrubs the stored vector itself.
  await semanticIndexStep(db, embedder)
  assert.equal(countSemanticEmbedded(db), 0, 'the stale vector is dropped, not just hidden')
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS c FROM memory_records WHERE embedding_model IS NOT NULL`).get() as { c: number }).c,
    0,
    'the engine stamp is cleared so a lowered sensitivity re-embeds naturally',
  )
})

test('background embedding pauses on battery or load and resumes when the condition clears', async () => {
  const db = createProductionTestDatabase()
  const embedder = fixtureEmbedder()
  useFixtureEmbedder(embedder)
  insertSession(db, 'Best OLED TV discounts', 9, 0, 45)
  indexMemoryForDay(db, DATE)
  assert.equal(countSemanticPending(db, embedder), 1)

  // The decision itself, per signal.
  setSemanticPowerStateProviderForTests(() => ({ onBattery: true, overloaded: false }))
  assert.deepEqual(semanticIndexingPausedNow(), { paused: true, reason: 'on-battery' })
  setSemanticPowerStateProviderForTests(() => ({ onBattery: false, overloaded: true }))
  assert.deepEqual(semanticIndexingPausedNow(), { paused: true, reason: 'system-load' })
  setSemanticPowerStateProviderForTests(() => ({ onBattery: false, overloaded: false }))
  assert.deepEqual(semanticIndexingPausedNow(), { paused: false, reason: null })

  // The loop honors it: on battery nothing embeds; back on mains it resumes.
  setSemanticPowerStateProviderForTests(() => ({ onBattery: true, overloaded: false }))
  startSemanticIndexBackfill(() => db, { stepDelayMs: 5, idleDelayMs: 10 })
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(countSemanticEmbedded(db), 0, 'paused: no embedding work while on battery')

  setSemanticPowerStateProviderForTests(() => ({ onBattery: false, overloaded: false }))
  const deadline = Date.now() + 3_000
  while (countSemanticEmbedded(db) === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  stopSemanticIndexBackfill()
  assert.equal(countSemanticEmbedded(db), 1, 'resumed: the pending record embedded once power returned')
})

test('a wiped vector index rebuilds itself from the permitted memory records', async () => {
  const db = createProductionTestDatabase()
  useFixtureEmbedder()
  await seedAndEmbed(db)
  assert.equal((await searchByMeaning(db, 'cheap television offers')).length, 1)

  // Simulate a corrupt/lost vec0 index: the vectors vanish, bookkeeping and
  // record stamps still claim they exist.
  db.prepare(`DELETE FROM memory_semantic_vec`).run()
  assert.equal((await searchByMeaning(db, 'cheap television offers')).length, 0)

  // Reconcile resets the affected records to pending; the next step re-embeds.
  const reset = reconcileLostVectors(db)
  assert.equal(reset, 2, 'both records reset to pending')
  const progress = await semanticIndexStep(db, fixtureEmbedder())
  assert.equal(progress.embedded, 2)
  assert.equal(
    (await searchByMeaning(db, 'cheap television offers')).length,
    1,
    'the index rebuilt from the permitted records without manual recovery',
  )
})

test('the vector store loads the real sqlite-vec extension once per connection', () => {
  const db = createProductionTestDatabase()
  const first = ensureVectorStore(db)
  assert.equal(first.ok, true, `sqlite-vec must load: ${first.ok ? '' : first.detail}`)
  const again = ensureVectorStore(db)
  assert.equal(again, first, 'the outcome is remembered per connection')
})
