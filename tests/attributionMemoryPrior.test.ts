// memory.md §4 + invariant 5: stored per-client memory is CONTEXT that can tip
// an AMBIGUOUS, already-evidenced attribution toward the client it recognizes —
// but it never invents an attribution the evidence doesn't support.
//
// Setup: one stretch of work whose title both Acme and Beta have a (weak) rule
// for, so it's ambiguous and the evidence slightly favors Beta. Acme's scoped
// memory recognizes a distinctive token in the title ("ubiquiti"). Gamma has the
// same token in its memory but NO rule — no evidence — so it must never win.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { runAttributionForRange } from '../src/main/services/attribution.ts'

function localMs(y: number, m: number, d: number, h: number, min = 0): number {
  return new Date(y, m - 1, d, h, min, 0, 0).getTime()
}

function seedBase(db: Database.Database): [number, number] {
  const now = Date.now()
  const client = db.prepare(`INSERT INTO clients (id, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)`)
  client.run('client_a', 'Acme', now, now)
  client.run('client_b', 'Beta', now, now)
  client.run('client_c', 'Gamma', now, now)

  // Both A and B have a weak title rule for this work; B's weight is higher, so
  // on pure evidence Beta leads. Neither clears the 0.75 attribute bar alone.
  const rule = db.prepare(`
    INSERT INTO attribution_rules (id, client_id, project_id, signal_type, operator, pattern, weight, source, status, created_at, updated_at)
    VALUES (?, ?, NULL, 'title_contains', 'contains', 'portal', ?, 'derived', 'active', ?, ?)
  `)
  rule.run('rule_a', 'client_a', 3.1, now, now)
  rule.run('rule_b', 'client_b', 4.0, now, now)

  const start = localMs(2026, 5, 4, 10, 0)
  const end = localMs(2026, 5, 4, 10, 50)
  db.prepare(`
    INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, canonical_app_id, app_instance_id,
      capture_source, capture_version)
    VALUES ('com.todesktop.230313mzl4w4u92', 'Cursor', ?, ?, ?, 'development', 1,
      'Acme Portal Ubiquiti config', 'Cursor', 'cursor', 'com.todesktop.230313mzl4w4u92', 'test', 2)
  `).run(start, end, Math.round((end - start) / 1000))

  return [localMs(2026, 5, 4, 0, 0), localMs(2026, 5, 4, 0, 0) + 86_400_000]
}

function addMemory(db: Database.Database, scope: string, text: string, id: string): void {
  const now = Date.now()
  db.prepare(`
    INSERT INTO work_memory_facts (id, fact_text, origin, status, source, scope, created_at, updated_at)
    VALUES (?, ?, 'user', 'active', 'hand', ?, ?, ?)
  `).run(id, text, scope, now, now)
}

function topCandidate(db: Database.Database): { client_id: string | null; decision_source: string } {
  return db.prepare(`SELECT client_id, decision_source FROM segment_attributions ORDER BY rank ASC LIMIT 1`)
    .get() as { client_id: string | null; decision_source: string }
}

test('memory tips an ambiguous attribution toward the client it recognizes', (t) => {
  const db = createProductionTestDatabase()
  t.after(() => db.close())
  const [from, to] = seedBase(db)
  // Acme's scoped memory recognizes "ubiquiti", which is in the work's title.
  addMemory(db, 'client:client_a', 'Ubiquiti network gear is part of the Acme infrastructure', 'mem_a')
  // Gamma's memory mentions ubiquiti too, but Gamma has NO rule — no evidence.
  addMemory(db, 'client:client_c', 'Ubiquiti sometimes comes up for Gamma', 'mem_c')

  runAttributionForRange(from, to, {}, db)

  const top = topCandidate(db)
  assert.equal(top.client_id, 'client_a', 'memory tipped the ambiguous stretch to Acme')
  assert.equal(top.decision_source, 'memory_assisted', 'and it is transparently tagged as memory-assisted')

  // Invariant 5: memory never invents. Gamma had the matching token but no
  // evidence, so it is never a candidate.
  const gamma = db.prepare(`SELECT COUNT(*) AS n FROM segment_attributions WHERE client_id = 'client_c'`).get() as { n: number }
  assert.equal(gamma.n, 0, 'a client with memory but no evidence is never attributed')

  const session = db.prepare(`SELECT client_id, attribution_status FROM work_sessions ORDER BY started_at LIMIT 1`)
    .get() as { client_id: string | null; attribution_status: string }
  assert.equal(session.client_id, 'client_a', 'the work session lands on Acme')
})

test('without that memory, the same stretch follows the evidence (Beta), not memory', (t) => {
  const db = createProductionTestDatabase()
  t.after(() => db.close())
  const [from, to] = seedBase(db)
  // No memory for either candidate (only a non-candidate's, which can't apply).
  addMemory(db, 'client:client_c', 'Ubiquiti sometimes comes up for Gamma', 'mem_c')

  runAttributionForRange(from, to, {}, db)

  const top = topCandidate(db)
  assert.equal(top.client_id, 'client_b', 'evidence alone favors Beta')
  assert.notEqual(top.decision_source, 'memory_assisted', 'nothing was memory-assisted')
})
