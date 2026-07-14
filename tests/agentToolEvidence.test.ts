// Data-layer guard for the two screenshot-failure prompts, resolved through
// the agent tool loop:
//   1. "What did I do today at 4 p.m., exactly?"
//   2. "Who are my clients?"
//
// A true end-to-end test would boot the whole chat agent loop (provider,
// settings store, IPC stream, thread schema, etc). That's out of scope here —
// the agent's tools (src/main/agent/daylensTools.ts) call straight into
// getMomentEvidence and executeTool, so this file locks in that those two
// data paths return the right, evidence-backed answer for a seeded fixture.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { executeTool } from '../src/main/services/aiTools.ts'
import { getMomentEvidence } from '../src/main/lib/momentEvidence.ts'

function setupDb(): Database.Database {
  return createProductionTestDatabase()
}

function localMs(date: Date, hour: number, minute = 0): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0).getTime()
}

function dateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function seedCodingDay(db: Database.Database): Date {
  // Use today as the anchor so the moment lookup targets the same day the
  // agent would in production.
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

test('get_moment tool evidence: names the covering work at 4pm on a coding day', () => {
  const db = setupDb()
  const today = seedCodingDay(db)
  const evidence = getMomentEvidence(db, dateStr(today), '16:00')

  assert.equal(evidence.found, true, 'expected evidence for a moment inside a tracked session')
  assert.ok(evidence.coveringBlock, 'expected a covering timeline block at 4pm')
  assert.ok(
    evidence.coveringBlock!.topApps.some((app) => app.appName === 'Cursor'),
    `expected Cursor in the covering block's top apps, got: ${evidence.coveringBlock!.topApps.map((a) => a.appName).join(', ')}`,
  )
  db.close()
})

test('getBlockAtTime tool returns the covering Cursor block for 4pm on a coding day', () => {
  const db = setupDb()
  seedCodingDay(db)
  const today = new Date()
  const dateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const result = executeTool('getBlockAtTime', { date: dateString, time: '16:00' }, db) as {
    found: boolean
    block: { topAppNames: string[]; durationSeconds: number } | null
  }
  assert.equal(result.found, true)
  assert.ok(result.block)
  assert.ok(result.block!.topAppNames.includes('Cursor'), `expected Cursor in topAppNames, got: ${result.block!.topAppNames.join(', ')}`)
  db.close()
})

// ─── Screenshot failure #2 — "who are my clients?" ─────────────────────────

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
