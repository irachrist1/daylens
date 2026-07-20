// Durable entity repository (memory-and-entities.md §Identity rules, DEV-177):
// per-type identity, alias-aware label resolution, merge-group behavior, and
// the synthetic connected-source envelopes that stand in for Wave-3 connectors.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import {
  addEntityAlias,
  addEntityEvidenceRef,
  listEntities,
  listSuggestedEntityMerges,
  resolveEntityByLabel,
  resolveMeetingEntity,
  resolvePersonEntity,
  resolveRepositoryEntity,
  upsertEntity,
} from '../src/main/services/entities/entityRepository.ts'
import { adoptConnectedEnvelope } from '../src/main/services/entities/entityAdoption.ts'

test('people resolve by connector id first — a bare name mints no person entity', () => {
  const db = createProductionTestDatabase()
  try {
    const withoutId = resolvePersonEntity(db, { connectorId: null, displayName: 'Jamie' })
    assert.equal(withoutId, null, 'no connector id → no person entity')
    assert.equal(listEntities(db, { type: 'person' }).length, 0)

    const first = resolvePersonEntity(db, { connectorId: 'google:jamie@acme.test', displayName: 'Jamie Rivera' })
    assert.ok(first)
    const again = resolvePersonEntity(db, { connectorId: 'google:jamie@acme.test', displayName: 'Jamie R.' })
    assert.equal(again!.id, first!.id, 'same connector id resolves to the same entity')
    // The differing display name became an alias on the same entity, not a
    // second person — both labels resolve to it.
    const people = listEntities(db, { type: 'person' })
    assert.equal(people.length, 1)
    const labels = new Set([people[0].name, ...people[0].aliases])
    assert.ok(labels.has('Jamie Rivera') && labels.has('Jamie R.'))
  } finally {
    db.close()
  }
})

test('meetings resolve by source event id — similar title and time never silently merge', () => {
  const db = createProductionTestDatabase()
  try {
    const startMs = new Date(2026, 6, 10, 14, 0).getTime()
    const first = resolveMeetingEntity(db, {
      sourceEventId: 'gcal:evt-111', title: 'Weekly sync', startMs, endMs: startMs + 30 * 60_000,
    })
    const second = resolveMeetingEntity(db, {
      sourceEventId: 'gcal:evt-222', title: 'Weekly sync', startMs, endMs: startMs + 30 * 60_000,
    })
    assert.notEqual(first.id, second.id, 'identical titles+times with different source ids stay distinct')

    const same = resolveMeetingEntity(db, {
      sourceEventId: 'gcal:evt-111', title: 'Weekly sync (renamed upstream)', startMs,
    })
    assert.equal(same.id, first.id, 'the same source event id resolves to the same meeting')
  } finally {
    db.close()
  }
})

test('repositories resolve by provider identity, never folder name alone', () => {
  const db = createProductionTestDatabase()
  try {
    const provider = resolveRepositoryEntity(db, { provider: 'github', owner: 'acme', repo: 'daylens' })
    const local = resolveRepositoryEntity(db, { localName: 'daylens' })
    assert.ok(provider && local)
    assert.notEqual(provider!.id, local!.id, 'a local folder named like a provider repo is NOT the same identity')
    assert.equal(
      JSON.parse(local!.metadata_json).provisionalLocalIdentity, true,
      'a folder-only repo identity is explicitly provisional',
    )
    const providerAgain = resolveRepositoryEntity(db, { provider: 'GitHub', owner: 'ACME', repo: 'Daylens' })
    assert.equal(providerAgain!.id, provider!.id, 'provider identity is case-normalized')
  } finally {
    db.close()
  }
})

test('label resolution goes canonical → alias → fuzzy and surfaces candidates on ambiguity', () => {
  const db = createProductionTestDatabase()
  try {
    const acme = upsertEntity(db, { type: 'client', identityKey: 'supplied:c1', name: 'ACME Corporation', origin: 'supplied' })
    addEntityAlias(db, acme.id, 'acme', { source: 'user' })
    const other = upsertEntity(db, { type: 'client', identityKey: 'supplied:c2', name: 'Acmenta Labs', origin: 'supplied' })

    const byAlias = resolveEntityByLabel(db, 'client', 'ACME')
    assert.equal(byAlias.entity?.id, acme.id)
    assert.equal(byAlias.matchedBy, 'alias')

    // Ambiguity produces candidates, never a silent pick of one.
    addEntityAlias(db, other.id, 'acme', { source: 'inferred' })
    const ambiguous = resolveEntityByLabel(db, 'client', 'acme')
    assert.equal(ambiguous.entity, null)
    assert.equal(ambiguous.candidates.length, 2)
  } finally {
    db.close()
  }
})

test('an explicit rename outranks later inference: upsert never overwrites a user name', () => {
  const db = createProductionTestDatabase()
  try {
    const entity = upsertEntity(db, { type: 'application', identityKey: 'app:cursor', name: 'cursor-nightly', origin: 'observed' })
    db.prepare(`UPDATE entities SET canonical_name = 'Cursor', name_source = 'user' WHERE id = ?`).run(entity.id)

    const after = upsertEntity(db, { type: 'application', identityKey: 'app:cursor', name: 'cursor-nightly-2', origin: 'observed', observedAt: Date.now() })
    assert.equal(after.canonical_name, 'Cursor', 'inference must not overwrite a user-corrected name')
    assert.equal(after.name_source, 'user')
  } finally {
    db.close()
  }
})

test('synthetic connected-source envelopes produce meeting, person, repository, and document entities', () => {
  const db = createProductionTestDatabase()
  try {
    const startMs = new Date(2026, 6, 10, 10, 0).getTime()
    const meeting = adoptConnectedEnvelope(db, {
      kind: 'calendar_event',
      sourceEventId: 'gcal:sync-1',
      title: 'ACME weekly sync',
      startMs,
      endMs: startMs + 45 * 60_000,
      attendees: [{ connectorId: 'google:jamie@acme.test', displayName: 'Jamie Rivera' }],
    })
    assert.ok(meeting)
    assert.equal(listEntities(db, { type: 'meeting' }).length, 1)
    const people = listEntities(db, { type: 'person' })
    assert.equal(people.length, 1)
    assert.equal(people[0].name, 'Jamie Rivera')

    const repo = adoptConnectedEnvelope(db, {
      kind: 'repository_activity', provider: 'github', owner: 'acme', repo: 'portal',
    })
    assert.ok(repo)
    assert.equal(listEntities(db, { type: 'repository' })[0].name, 'portal')

    const doc = adoptConnectedEnvelope(db, {
      kind: 'document_reference', sourceDocumentId: 'gdrive:doc-9', title: 'Launch plan',
    })
    assert.ok(doc)
    assert.equal(listEntities(db, { type: 'file' })[0].name, 'Launch plan')

    // Re-adopting the same envelopes is idempotent.
    adoptConnectedEnvelope(db, {
      kind: 'calendar_event', sourceEventId: 'gcal:sync-1', title: 'ACME weekly sync', startMs,
    })
    assert.equal(listEntities(db, { type: 'meeting' }).length, 1)
  } finally {
    db.close()
  }
})

test('suggested merges surface same-name entities but never meetings', () => {
  const db = createProductionTestDatabase()
  try {
    const a = upsertEntity(db, { type: 'repository', identityKey: 'local:daylens', name: 'daylens', origin: 'connected' })
    addEntityAlias(db, a.id, 'daylens')
    const b = upsertEntity(db, { type: 'repository', identityKey: 'provider:github/acme/daylens', name: 'daylens', origin: 'connected' })
    addEntityAlias(db, b.id, 'daylens')
    addEntityEvidenceRef(db, b.id, { sourceType: 'connected_envelope', sourceId: 'x' })

    resolveMeetingEntity(db, { sourceEventId: 'e1', title: 'Standup' })
    resolveMeetingEntity(db, { sourceEventId: 'e2', title: 'Standup' })

    const suggestions = listSuggestedEntityMerges(db)
    assert.ok(suggestions.some((item) => item.type === 'repository'), 'same-name repos are suggested')
    assert.ok(!suggestions.some((item) => item.type === 'meeting'), 'meetings never merge by title similarity')
  } finally {
    db.close()
  }
})
