// Coverage for the resolver layer (ADR 0002, ai.md §4.1) — the deterministic
// "resolve" step of plan → resolve → phrase. These wrap the same data the
// Timeline and Apps views read, so the AI's numbers match theirs (invariant 6).
// The model-facing planning/phrasing calls are integration-level (they need a
// provider) and are exercised live; this file locks in the data layer.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { ensureSearchSchema } from '../src/main/db/migrations.ts'
import { runResolverQuery, serializeFact } from '../src/main/ai/resolvers.ts'
import type { GetAttributionResult } from '../src/main/ai/resolvers.ts'
import type {
  DaySummaryResult,
  GetAppUsageResult,
  SearchSessionsResult,
} from '../src/main/services/aiTools.ts'

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  ensureSearchSchema(db)
  return db
}

function localMs(date: Date, hour: number, minute = 0): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0).getTime()
}

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function seedCodingDay(db: Database.Database): Date {
  const today = new Date()
  const insert = db.prepare(`
    INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, canonical_app_id, app_instance_id,
      capture_source, capture_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', 1)
  `)
  insert.run('com.todesktop.230313mzl4w4u92', 'Cursor', localMs(today, 9, 0), localMs(today, 11, 30),
    Math.round((localMs(today, 11, 30) - localMs(today, 9, 0)) / 1000),
    'development', 1, 'daylens — ai.ts', 'Cursor', 'cursor', 'com.todesktop.230313mzl4w4u92')
  insert.run('com.todesktop.230313mzl4w4u92', 'Cursor', localMs(today, 13, 30), localMs(today, 16, 15),
    Math.round((localMs(today, 16, 15) - localMs(today, 13, 30)) / 1000),
    'development', 1, 'daylens — wrappedFacts.ts', 'Cursor', 'cursor', 'com.todesktop.230313mzl4w4u92')
  return today
}

test('getDay resolves grounded blocks + a non-zero total for a coding day', (t) => {
  const db = setupDb()
  t.after(() => db.close())
  const today = seedCodingDay(db)
  const fact = runResolverQuery({ resolver: 'getDay', date: dateStr(today) }, db)
  assert.equal(fact.isEmpty, false, 'a day with two coding sessions is not empty')
  const data = fact.data as DaySummaryResult
  assert.ok(data.totalTrackedSeconds > 0, 'total tracked seconds must be positive')
  assert.ok(data.blocks.length > 0, 'must surface at least one block')
  // serializeFact hands the phrase model grounded, citeable text.
  const text = serializeFact(fact)
  assert.match(text, /getDay/)
  assert.match(text, /\d{2}:\d{2}/, 'block time ranges are present for citation')
})

test('getApp resolves Cursor time and a per-day breakdown', (t) => {
  const db = setupDb()
  t.after(() => db.close())
  const today = seedCodingDay(db)
  // Bound the query to the seeded day. With no range, getApp defaults toMs to
  // the current clock, which (correctly) excludes sessions seeded later in the
  // same calendar day when the suite runs in the morning. Real captured
  // sessions are always in the past; the explicit range mirrors how getDay is
  // tested and keeps this deterministic regardless of time of day.
  const day = dateStr(today)
  const fact = runResolverQuery({ resolver: 'getApp', app: 'Cursor', from: day, to: day }, db)
  assert.equal(fact.isEmpty, false)
  const data = fact.data as GetAppUsageResult
  assert.ok(data.totalSeconds > 0, 'Cursor has tracked time')
  assert.ok(data.dailyBreakdown.length > 0, 'a per-day breakdown is returned')
})

test('getApp on an unknown app reports empty without throwing', (t) => {
  const db = setupDb()
  t.after(() => db.close())
  seedCodingDay(db)
  const fact = runResolverQuery({ resolver: 'getApp', app: 'NonexistentApp42' }, db)
  assert.equal(fact.isEmpty, true, 'no tracked time for an app that was never used')
})

test('recall finds a session by a window-title keyword', (t) => {
  const db = setupDb()
  t.after(() => db.close())
  seedCodingDay(db)
  const fact = runResolverQuery({ resolver: 'recall', query: 'wrappedFacts' }, db)
  assert.equal(fact.isEmpty, false, 'the wrappedFacts.ts window title is searchable')
  const data = fact.data as SearchSessionsResult
  assert.ok(data.hits.length > 0)
})

test('getAttribution with no clients returns an inferred breakdown and offers setup', (t) => {
  const db = setupDb()
  t.after(() => db.close())
  seedCodingDay(db)
  const fact = runResolverQuery({ resolver: 'getAttribution' }, db)
  const data = fact.data as GetAttributionResult
  assert.equal(data.hasClients, false, 'no clients are seeded')
  assert.equal(data.suggestSetup, true, 'the answer must offer to set up projects, not dead-end')
  assert.ok((data.inferred?.length ?? 0) > 0, 'an inferred breakdown is produced from the blocks')
  const text = serializeFact(fact)
  assert.match(text, /offer to set up named projects/i)
})
