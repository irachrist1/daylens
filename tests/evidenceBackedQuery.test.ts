// Regression guard for F60: resolveEvidenceBackedQuery switched from a
// LEFT JOIN + DISTINCT over work_session_evidence to an EXISTS subquery. The
// match set must be identical — a session matches when the term hits its title
// OR any of its evidence values, and a session with several matching evidence
// rows must appear exactly once.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema'
import { resolveEvidenceBackedQuery } from '../src/main/core/query/attributionResolvers'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  return db
}

function insertWorkSession(db: Database.Database, args: { id: string; startedAt: number; title: string | null }): void {
  db.prepare(`
    INSERT INTO work_sessions (
      id, device_id, started_at, ended_at, duration_ms, active_ms, idle_ms,
      client_id, project_id, attribution_status, attribution_confidence, title,
      primary_bundle_id, app_bundle_ids_json, created_at, updated_at
    ) VALUES (?, 'dev', ?, ?, ?, ?, 0, NULL, NULL, 'attributed', 0.9, ?, NULL, '[]', ?, ?)
  `).run(args.id, args.startedAt, args.startedAt + 600_000, 600_000, 600_000, args.title, args.startedAt, args.startedAt)
}

function insertEvidence(db: Database.Database, args: { id: string; sessionId: string; value: string }): void {
  db.prepare(`
    INSERT INTO work_session_evidence (id, work_session_id, evidence_type, evidence_value, weight, created_at)
    VALUES (?, ?, 'window_title', ?, 1.0, 0)
  `).run(args.id, args.sessionId, args.value)
}

const FROM = new Date(2026, 4, 1, 0, 0, 0).getTime()
const TO = new Date(2026, 4, 2, 0, 0, 0).getTime()
const T = new Date(2026, 4, 1, 9, 0, 0).getTime()

test('matches on session title', () => {
  const db = freshDb()
  insertWorkSession(db, { id: 'ws1', startedAt: T, title: 'Acme invoice draft' })
  const payload = resolveEvidenceBackedQuery('acme', FROM, TO, 'q', db)
  assert.ok(payload, 'expected a match on title')
  assert.equal(payload.sessions.length, 1)
  assert.equal(payload.sessions[0].work_session_id, 'ws1')
  db.close()
})

test('matches on evidence value when title does not match', () => {
  const db = freshDb()
  insertWorkSession(db, { id: 'ws2', startedAt: T, title: 'Untitled block' })
  insertEvidence(db, { id: 'e1', sessionId: 'ws2', value: 'github.com/acme/repo' })
  const payload = resolveEvidenceBackedQuery('acme', FROM, TO, 'q', db)
  assert.ok(payload, 'expected a match on evidence value')
  assert.equal(payload.sessions.length, 1)
  assert.equal(payload.sessions[0].work_session_id, 'ws2')
  db.close()
})

test('a session with multiple matching evidence rows appears exactly once', () => {
  const db = freshDb()
  insertWorkSession(db, { id: 'ws3', startedAt: T, title: 'acme planning' })
  insertEvidence(db, { id: 'e2', sessionId: 'ws3', value: 'acme spec' })
  insertEvidence(db, { id: 'e3', sessionId: 'ws3', value: 'acme notes' })
  const payload = resolveEvidenceBackedQuery('acme', FROM, TO, 'q', db)
  assert.ok(payload)
  assert.equal(payload.sessions.length, 1, 'no DISTINCT fan-out duplicates')
  db.close()
})

test('returns null when nothing matches', () => {
  const db = freshDb()
  insertWorkSession(db, { id: 'ws4', startedAt: T, title: 'unrelated work' })
  insertEvidence(db, { id: 'e4', sessionId: 'ws4', value: 'something else' })
  assert.equal(resolveEvidenceBackedQuery('acme', FROM, TO, 'q', db), null)
  db.close()
})
