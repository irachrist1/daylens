// Entity adoption backfill (memory-and-entities.md migration slice 3,
// DEV-177): clients, projects, app identities, artifacts, and external
// signals become durable entities KEEPING their identifiers; re-runs are
// idempotent; meetings from stored calendar payloads never merge on similar
// title+time; incremental writes flow through the same path a connector will.
import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import {
  adoptExternalSignalEntities,
  runEntityAdoptionBackfill,
} from '../src/main/services/entities/entityAdoption.ts'
import { listEntities, resolveEntityByLabel } from '../src/main/services/entities/entityRepository.ts'

function seedLegacyWorld(db: Database.Database): void {
  const now = Date.now()
  db.prepare(`INSERT INTO clients (id, name, status, created_at, updated_at) VALUES ('client-acme', 'ACME Corporation', 'active', ?, ?)`).run(now, now)
  db.prepare(`
    INSERT INTO client_aliases (id, client_id, alias, alias_normalized, source, created_at)
    VALUES ('ca-1', 'client-acme', 'acme', 'acme', 'user', ?)
  `).run(now)
  db.prepare(`
    INSERT INTO projects (id, client_id, name, status, created_at, updated_at)
    VALUES ('project-portal', 'client-acme', 'Portal rebuild', 'active', ?, ?)
  `).run(now, now)
  db.prepare(`
    INSERT INTO app_identities (app_instance_id, bundle_id, raw_app_name, canonical_app_id, display_name, first_seen_at, last_seen_at)
    VALUES ('app-cursor', 'com.cursor.Cursor', 'Cursor Nightly', 'cursor', 'Cursor', ?, ?)
  `).run(now - 86_400_000, now)
  db.prepare(`
    INSERT INTO artifacts (id, artifact_type, canonical_key, display_title, first_seen_at, last_seen_at)
    VALUES ('art-page', 'page', 'page:example.com/docs', 'Example Docs', ?, ?)
  `).run(now - 3_600_000, now)
  db.prepare(`
    INSERT INTO artifacts (id, artifact_type, canonical_key, display_title, first_seen_at, last_seen_at)
    VALUES ('art-doc', 'document', 'doc:/notes/plan.md', 'plan.md', ?, ?)
  `).run(now - 3_600_000, now)
  db.prepare(`
    INSERT INTO external_signals (date, source, payload_json, captured_at)
    VALUES ('2026-07-10', 'calendar', ?, ?)
  `).run(JSON.stringify({
    events: [
      { title: 'ACME weekly sync', startClock: '14:00', durationMinutes: 30, attendeeCount: 4 },
      { title: 'ACME weekly sync prep', startClock: '13:30', durationMinutes: 15, attendeeCount: null },
    ],
  }), now)
  db.prepare(`
    INSERT INTO external_signals (date, source, payload_json, captured_at)
    VALUES ('2026-07-10', 'git', ?, ?)
  `).run(JSON.stringify({
    repos: [{ repo: 'daylens', commitCount: 5, messages: ['Fix'], firstCommitClock: '09:10', lastCommitClock: '16:40' }],
    totalCommits: 5,
    prs: [],
  }), now)
}

test('backfill adopts every source type keeping existing identifiers, idempotently', () => {
  const db = createProductionTestDatabase()
  try {
    seedLegacyWorld(db)
    runEntityAdoptionBackfill(db)

    // Ids are KEPT — existing attributions and references stay valid.
    const client = db.prepare(`SELECT * FROM entities WHERE id = 'client-acme'`).get() as { entity_type: string; origin: string } | undefined
    assert.equal(client?.entity_type, 'client')
    assert.equal(client?.origin, 'supplied')
    assert.equal((db.prepare(`SELECT entity_type FROM entities WHERE id = 'project-portal'`).get() as { entity_type: string }).entity_type, 'project')
    assert.equal((db.prepare(`SELECT entity_type FROM entities WHERE id = 'app-cursor'`).get() as { entity_type: string }).entity_type, 'application')
    assert.equal((db.prepare(`SELECT entity_type FROM entities WHERE id = 'art-page'`).get() as { entity_type: string }).entity_type, 'page')
    assert.equal((db.prepare(`SELECT entity_type FROM entities WHERE id = 'art-doc'`).get() as { entity_type: string }).entity_type, 'file')

    // The client alias came along and resolves.
    assert.equal(resolveEntityByLabel(db, 'client', 'acme').entity?.id, 'client-acme')
    // Project → client relationship recorded.
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM entity_relationships WHERE entity_id = 'project-portal' AND related_entity_id = 'client-acme' AND kind = 'belongs_to'`).get() as { c: number }).c,
      1,
    )

    // Two calendar events with similar titles and adjacent times → two meetings.
    assert.equal(listEntities(db, { type: 'meeting' }).length, 2)
    // Git signal → a provisional local repository entity.
    const repos = listEntities(db, { type: 'repository' })
    assert.equal(repos.length, 1)
    assert.equal(repos[0].name, 'daylens')
    assert.equal(repos[0].origin, 'connected')

    // Idempotent: a second full run changes no counts.
    const countBefore = (db.prepare(`SELECT COUNT(*) AS c FROM entities`).get() as { c: number }).c
    runEntityAdoptionBackfill(db)
    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM entities`).get() as { c: number }).c, countBefore)
    assert.equal(listEntities(db, { type: 'meeting' }).length, 2)
  } finally {
    db.close()
  }
})

test('a refreshed calendar day updates the same meeting entities instead of minting new ones', () => {
  const db = createProductionTestDatabase()
  try {
    const payload = { events: [{ title: 'Design review', startClock: '10:00', durationMinutes: 60, attendeeCount: 3 }] }
    adoptExternalSignalEntities(db, '2026-07-11', 'calendar', payload)
    adoptExternalSignalEntities(db, '2026-07-11', 'calendar', payload)
    assert.equal(listEntities(db, { type: 'meeting' }).length, 1, 'the daily refresh re-resolves, never duplicates')

    // The same title on ANOTHER day is a different source event → distinct.
    adoptExternalSignalEntities(db, '2026-07-12', 'calendar', payload)
    assert.equal(listEntities(db, { type: 'meeting' }).length, 2)
  } finally {
    db.close()
  }
})

test('meeting-notes payloads become meeting entities but first names never mint people', () => {
  const db = createProductionTestDatabase()
  try {
    adoptExternalSignalEntities(db, '2026-07-11', 'notes', {
      app: 'Granola',
      notes: [{ title: 'Portal kickoff', participants: ['Jamie', 'Sam'], actionItems: ['Send deck'], scheduledClock: '15:00' }],
    })
    assert.equal(listEntities(db, { type: 'meeting' }).length, 1)
    assert.equal(listEntities(db, { type: 'person' }).length, 0, 'first names are not connector ids — no person entities')
  } finally {
    db.close()
  }
})
