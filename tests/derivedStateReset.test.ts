// Regression guard for F21: a reset-triggering derived-state version bump must
// no longer wipe derived tables synchronously inside syncDerivedStateMetadata.
// Instead it records the new versions, flags the reset-components
// rebuild_required=1, and the actual destructive wipe happens later via
// runPendingDerivedStateReset (off the startup critical path).
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema'
import { syncDerivedStateMetadata, runPendingDerivedStateReset } from '../src/main/core/projections/metadata'
import { DERIVED_STATE_COMPONENT_VERSIONS } from '../src/main/core/domain/versioning'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  return db
}

function seedBlock(db: Database.Database): void {
  db.prepare(`
    INSERT INTO timeline_blocks (
      id, date, start_time, end_time, block_kind, dominant_category,
      category_distribution_json, switch_count, label_current, label_source,
      label_confidence, narrative_current, evidence_summary_json, is_live,
      heuristic_version, computed_at, invalidated_at
    ) VALUES ('b1', '2026-05-01', 1, 2, 'work', 'development', '{}', 0,
      'Old block', 'rule', 0.8, NULL, '{}', 0, 'test', 1, NULL)
  `).run()
}

function seedStoredVersions(db: Database.Database, overrides: Record<string, string>): void {
  const stmt = db.prepare(`
    INSERT INTO derived_state_versions (component, version, rebuild_required, notes, updated_at)
    VALUES (?, ?, 0, NULL, ?)
  `)
  for (const [component, version] of Object.entries(DERIVED_STATE_COMPONENT_VERSIONS)) {
    stmt.run(component, overrides[component] ?? version, Date.now())
  }
}

function blockCount(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM timeline_blocks`).get() as { c: number }).c
}

function rebuildRequired(db: Database.Database, component: string): number {
  const row = db.prepare(`SELECT rebuild_required FROM derived_state_versions WHERE component = ?`).get(component) as { rebuild_required: number } | undefined
  return row?.rebuild_required ?? -1
}

test('a reset-component version bump defers the wipe instead of running it synchronously', () => {
  const db = freshDb()
  seedBlock(db)
  // app_normalization is a reset-component; pin it to an old version.
  seedStoredVersions(db, { app_normalization: 'app-normalization.v0' })

  syncDerivedStateMetadata(db)

  assert.equal(blockCount(db), 1, 'derived rows must survive the synchronous sync call')
  assert.equal(rebuildRequired(db, 'app_normalization'), 1, 'reset-component must be flagged pending')

  const didReset = runPendingDerivedStateReset(db)
  assert.equal(didReset, true)
  assert.equal(blockCount(db), 0, 'deferred reset must wipe derived rows')
  assert.equal(rebuildRequired(db, 'app_normalization'), 0, 'pending flag clears after reset')

  // Idempotent: a second call finds nothing pending.
  assert.equal(runPendingDerivedStateReset(db), false)
  db.close()
})

test('an unchanged registry neither wipes nor flags anything', () => {
  const db = freshDb()
  seedBlock(db)
  seedStoredVersions(db, {}) // all current

  syncDerivedStateMetadata(db)
  assert.equal(blockCount(db), 1)
  assert.equal(runPendingDerivedStateReset(db), false, 'nothing pending when versions match')
  assert.equal(blockCount(db), 1)
  db.close()
})

test('a fresh install (empty registry) populates versions without resetting', () => {
  const db = freshDb()
  seedBlock(db)
  // derived_state_versions intentionally empty.

  syncDerivedStateMetadata(db)
  assert.equal(blockCount(db), 1, 'fresh install must not nuke derived state')
  assert.equal(runPendingDerivedStateReset(db), false)
  db.close()
})
