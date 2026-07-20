// Entity corrections through the DEV-172 ledger (memory-and-entities.md
// §Corrections and deletion, DEV-177): preview-in-savepoint, apply-with-
// snapshot into correction_undo_log, undo through the SHARED undoCorrection,
// explicit corrections outranking later inference and surviving a rebuild
// (re-adoption) and a restart (fresh reads from the same database file).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { createProductionTestDatabase, bootstrapProductionTestDatabase } from './support/testDatabase.ts'
import {
  applyEntityCorrection,
  previewEntityCorrection,
} from '../src/main/services/entities/entityCorrections.ts'
import { undoCorrection } from '../src/main/services/correctionCommands.ts'
import {
  addEntityAlias,
  addEntityEvidenceRef,
  getEntityDetail,
  resolveEntityByLabel,
  upsertEntity,
} from '../src/main/services/entities/entityRepository.ts'
import { runEntityAdoptionBackfill } from '../src/main/services/entities/entityAdoption.ts'

function seedTwoRepos(db: Database.Database) {
  const left = upsertEntity(db, { type: 'repository', identityKey: 'local:daylens', name: 'daylens', origin: 'connected' })
  addEntityAlias(db, left.id, 'daylens')
  addEntityEvidenceRef(db, left.id, { sourceType: 'external_signal', sourceId: '2026-07-01:git' })
  const right = upsertEntity(db, { type: 'repository', identityKey: 'provider:github/acme/daylens', name: 'acme/daylens', origin: 'connected' })
  addEntityAlias(db, right.id, 'acme/daylens')
  addEntityEvidenceRef(db, right.id, { sourceType: 'connected_envelope', sourceId: 'repository_activity:1' })
  return { left, right }
}

test('merge preview reports the combined entity without persisting anything', () => {
  const db = createProductionTestDatabase()
  try {
    const { left, right } = seedTwoRepos(db)
    const preview = previewEntityCorrection(db, { kind: 'entity-merge', targetId: right.id, sourceId: left.id })
    assert.match(preview.description, /Merge "daylens" into "acme\/daylens"/)
    assert.equal(preview.entity?.evidenceCount, 2, 'preview shows the combined evidence count')
    // Nothing persisted: both entities still active, undo log untouched.
    assert.equal((db.prepare(`SELECT status FROM entities WHERE id = ?`).get(left.id) as { status: string }).status, 'active')
    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM correction_undo_log`).get() as { c: number }).c, 0)
  } finally {
    db.close()
  }
})

test('merge applies through the correction ledger, resolves both labels, and undoes exactly', () => {
  const db = createProductionTestDatabase()
  try {
    const { left, right } = seedTwoRepos(db)
    const applied = applyEntityCorrection(db, { kind: 'entity-merge', targetId: right.id, sourceId: left.id })
    assert.ok(applied.correctionId.startsWith('corr_'))
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM correction_undo_log WHERE kind = 'entity-merge'`).get() as { c: number }).c,
      1,
      'the merge is recorded in the EXISTING correction ledger',
    )

    // Both labels resolve to the survivor; evidence combines.
    assert.equal(resolveEntityByLabel(db, 'repository', 'daylens').entity?.id, right.id)
    assert.equal(getEntityDetail(db, right.id)?.evidenceCount, 2)
    // Aliases and refs were NOT rewritten — the merged entity keeps its rows.
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM entity_evidence_refs WHERE entity_id = ?`).get(left.id) as { c: number }).c,
      1,
    )

    // Undo through the SHARED undo verb restores the pre-merge world.
    const undone = undoCorrection(db, applied.correctionId)
    assert.equal(undone.undone, true)
    assert.equal((db.prepare(`SELECT status, merged_into_id FROM entities WHERE id = ?`).get(left.id) as { status: string; merged_into_id: string | null }).status, 'active')
    assert.equal(resolveEntityByLabel(db, 'repository', 'daylens').entity?.id, left.id)
  } finally {
    db.close()
  }
})

test('split reverses a merge as a first-class correction', () => {
  const db = createProductionTestDatabase()
  try {
    const { left, right } = seedTwoRepos(db)
    applyEntityCorrection(db, { kind: 'entity-merge', targetId: right.id, sourceId: left.id })
    const split = applyEntityCorrection(db, { kind: 'entity-split', entityId: left.id })
    assert.match(split.description, /Split "daylens" back out of "acme\/daylens"/)
    assert.equal(
      (db.prepare(`SELECT status FROM entities WHERE id = ?`).get(left.id) as { status: string }).status,
      'active',
    )
    assert.equal(getEntityDetail(db, right.id)?.evidenceCount, 1, 'evidence separates again')
  } finally {
    db.close()
  }
})

test('an explicit rename outranks later inference and survives rebuild + restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-entity-restart-'))
  const file = path.join(dir, 'entities.db')
  const db = createProductionTestDatabase(file)
  try {
    // A client the product supplied, adopted into the entity store.
    const now = Date.now()
    db.prepare(`INSERT INTO clients (id, name, status, created_at, updated_at) VALUES ('cl-1', 'ACME Corporation', 'active', ?, ?)`).run(now, now)
    runEntityAdoptionBackfill(db)

    applyEntityCorrection(db, { kind: 'entity-rename', entityId: 'cl-1', name: 'ACME (my favorite client)' })
    assert.equal(
      (db.prepare(`SELECT canonical_name, name_source FROM entities WHERE id = 'cl-1'`).get() as { canonical_name: string; name_source: string }).canonical_name,
      'ACME (my favorite client)',
    )

    // Rebuild: re-running the whole adoption over the same evidence must NOT
    // overwrite the explicit correction.
    runEntityAdoptionBackfill(db)
    assert.equal(
      (db.prepare(`SELECT canonical_name FROM entities WHERE id = 'cl-1'`).get() as { canonical_name: string }).canonical_name,
      'ACME (my favorite client)',
      'a re-run of adoption (rebuild) never overwrites an explicit rename',
    )
  } finally {
    db.close()
  }

  // Restart: a brand-new process opening the same database file still sees the
  // correction, and another rebuild still respects it.
  const reopened = bootstrapProductionTestDatabase(new Database(file))
  try {
    runEntityAdoptionBackfill(reopened)
    assert.equal(
      (reopened.prepare(`SELECT canonical_name FROM entities WHERE id = 'cl-1'`).get() as { canonical_name: string }).canonical_name,
      'ACME (my favorite client)',
      'the rename survives restart',
    )
    // And the old name still resolves as an alias.
    assert.equal(resolveEntityByLabel(reopened, 'client', 'ACME Corporation').entity?.id, 'cl-1')
  } finally {
    reopened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('alias add/remove are corrections with undo', () => {
  const db = createProductionTestDatabase()
  try {
    const entity = upsertEntity(db, { type: 'project', identityKey: 'supplied:p1', name: 'Portal rebuild', origin: 'supplied' })
    const added = applyEntityCorrection(db, { kind: 'entity-add-alias', entityId: entity.id, alias: 'the portal thing' })
    assert.equal(resolveEntityByLabel(db, 'project', 'the portal thing').entity?.id, entity.id)

    undoCorrection(db, added.correctionId)
    assert.equal(resolveEntityByLabel(db, 'project', 'the portal thing').entity, null, 'undo removes the alias')
  } finally {
    db.close()
  }
})

test('merging entities of different types is refused', () => {
  const db = createProductionTestDatabase()
  try {
    const client = upsertEntity(db, { type: 'client', identityKey: 'supplied:c9', name: 'ACME', origin: 'supplied' })
    const repo = upsertEntity(db, { type: 'repository', identityKey: 'local:acme', name: 'acme', origin: 'connected' })
    assert.throws(
      () => applyEntityCorrection(db, { kind: 'entity-merge', targetId: client.id, sourceId: repo.id }),
      /same type/,
    )
  } finally {
    db.close()
  }
})
