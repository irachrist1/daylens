// End-to-end-ish guard for the two screenshot-failure prompts:
//   1. "What did I do today at 4 p.m., exactly?"
//   2. "Who are my clients?"
//
// A true end-to-end test would boot the whole aiService.sendMessage pipeline
// (database singleton, settings store, IPC stream, thread schema, analytics
// stubs, etc). That's out of scope for this workstream — the router-plus-gate
// path is the seam the two failures were lost at, and that's what we lock in
// here.
//
// Each assertion exercises the same code path `sendMessage` walks at
// src/main/jobs/aiService.ts:4475 — `shouldUseRouter(...) → routeInsightsQuestion(...)`
// — against a live in-memory DB seeded with timeline_blocks, app_sessions,
// work_sessions, and clients rows. When the router returns a non-null
// result, `sendMessage` sets sourceKind='deterministic' (see call site
// around aiService.ts:4553). That's the invariant under test here.
//
// For the LLM tool-use path (when the router misses), see
// tests/aiToolUse.test.ts — this file does not re-exercise that surface.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { ensureSearchSchema } from '../src/main/db/migrations.ts'
import { shouldUseRouter, routeInsightsQuestion } from '../src/main/lib/insightsQueryRouter.ts'
import { executeTool } from '../src/main/services/aiTools.ts'

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  ensureSearchSchema(db)
  return db
}

function localMs(date: Date, hour: number, minute = 0): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0).getTime()
}

function seedCodingDay(db: Database.Database): Date {
  // Use today as the anchor so `routeInsightsQuestion(..., new Date(), ...)`
  // targets the same day the router does in production.
  const today = new Date()
  db.prepare(`
    INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, canonical_app_id, app_instance_id,
      capture_source, capture_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', 1)
  `).run(
    'com.todesktop.230313mzl4w4u92',
    'Cursor',
    localMs(today, 9, 0),
    localMs(today, 11, 30),
    Math.round((localMs(today, 11, 30) - localMs(today, 9, 0)) / 1000),
    'development',
    1,
    'daylens — ai.ts',
    'Cursor',
    'cursor',
    'com.todesktop.230313mzl4w4u92',
  )
  db.prepare(`
    INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, canonical_app_id, app_instance_id,
      capture_source, capture_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', 1)
  `).run(
    'com.todesktop.230313mzl4w4u92',
    'Cursor',
    localMs(today, 13, 30),
    localMs(today, 16, 15),
    Math.round((localMs(today, 16, 15) - localMs(today, 13, 30)) / 1000),
    'development',
    1,
    'daylens — wrappedFacts.ts',
    'Cursor',
    'cursor',
    'com.todesktop.230313mzl4w4u92',
  )
  return today
}

function seedClients(db: Database.Database): void {
  const now = Date.now()
  db.prepare(`
    INSERT INTO clients (id, name, status, created_at, updated_at)
    VALUES ('asyv', 'ASYV', 'active', ?, ?), ('andersen', 'Andersen', 'active', ?, ?)
  `).run(now, now, now, now)
  db.prepare(`
    INSERT INTO projects (id, client_id, name, status, created_at, updated_at)
    VALUES ('asyv-fin', 'asyv', 'Financial Report', 'active', ?, ?)
  `).run(now, now)
}

// ─── Screenshot failure #1 — "what did I do today at 4 p.m., exactly?" ─────

test('sendMessage gate: "what did I do today at 4 p.m., exactly?" takes the deterministic router path', async () => {
  assert.equal(
    shouldUseRouter('What did I do today at 4 p.m., exactly?'),
    true,
    'shouldUseRouter must gate this prompt to the deterministic path',
  )

  const db = setupDb()
  const today = seedCodingDay(db)
  const routed = await routeInsightsQuestion(
    'What did I do today at 4 p.m., exactly?',
    today,
    null,
    db,
  )
  assert.ok(routed, 'router must return a result (so sendMessage sees sourceKind=deterministic)')
  assert.equal(routed.kind, 'answer')
  if (routed.kind !== 'answer') throw new Error('unreachable')
  const answer = routed.answer.toLowerCase()
  assert.ok(answer.includes('cursor'), `expected the answer to name Cursor, got: ${routed.answer}`)
  assert.ok(
    /4:00 pm|4:0?0 ?pm|16:00/.test(answer) || answer.includes('cursor'),
    'expected the answer to reference the moment or the covering app',
  )
  db.close()
})

test('getBlockAtTime tool returns the covering Cursor block for 4pm on a coding day', () => {
  const db = setupDb()
  seedCodingDay(db)
  const today = new Date()
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const result = executeTool('getBlockAtTime', { date: dateStr, time: '16:00' }, db) as {
    found: boolean
    block: { topAppNames: string[]; durationSeconds: number } | null
  }
  assert.equal(result.found, true)
  assert.ok(result.block)
  assert.ok(result.block!.topAppNames.includes('Cursor'), `expected Cursor in topAppNames, got: ${result.block!.topAppNames.join(', ')}`)
  db.close()
})

// ─── Screenshot failure #2 — "who are my clients?" ─────────────────────────

test('sendMessage gate: "who are my clients?" takes the deterministic router path', async () => {
  assert.equal(
    shouldUseRouter('Who are my clients?'),
    true,
    'shouldUseRouter must gate this prompt to the deterministic path',
  )

  const db = setupDb()
  seedClients(db)
  const routed = await routeInsightsQuestion('Who are my clients?', new Date(), null, db)
  assert.ok(routed, 'router must return a result (so sendMessage sees sourceKind=deterministic)')
  assert.equal(routed.kind, 'answer')
  if (routed.kind !== 'answer') throw new Error('unreachable')
  const answer = routed.answer.toLowerCase()
  assert.ok(answer.includes('asyv'), `expected ASYV in the roster, got: ${routed.answer}`)
  assert.ok(answer.includes('andersen'), `expected Andersen in the roster, got: ${routed.answer}`)
  db.close()
})

test('sendMessage gate: "list my clients this month" also takes the deterministic path', async () => {
  assert.equal(shouldUseRouter('List my clients this month.'), true)

  const db = setupDb()
  seedClients(db)
  const routed = await routeInsightsQuestion('List my clients this month.', new Date(), null, db)
  assert.ok(routed, 'router must return a result')
  assert.equal(routed.kind, 'answer')
})

test('listClients tool returns the seeded roster', () => {
  const db = setupDb()
  seedClients(db)
  const result = executeTool('listClients', {}, db) as {
    clientRoster: Array<{ clientName: string; projectCount: number }>
  }
  assert.equal(result.clientRoster.length, 2)
  const names = result.clientRoster.map((entry) => entry.clientName).sort()
  assert.deepEqual(names, ['ASYV', 'Andersen'])
  const asyv = result.clientRoster.find((entry) => entry.clientName === 'ASYV')
  assert.equal(asyv?.projectCount, 1, 'ASYV has one seeded active project')
  db.close()
})

// ─── Router-gate regressions for the exact shapes in tests/shouldUseRouter ──

test('router gates the 10:30am variant', () => {
  assert.equal(shouldUseRouter('What was I doing at 10:30am?'), true)
})

test('router gates "list my clients this month" (drops the "all" token)', () => {
  assert.equal(shouldUseRouter('List my clients this month.'), true)
})
