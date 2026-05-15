// C6 — migration ladder round-trip.
//
// Verifies the production install + upgrade paths:
//
//   1. Fresh install: SCHEMA_SQL boots into a working DB, then `runMigrations()`
//      advances `schema_version` to the latest version without throwing.
//   2. Idempotency: a second `runMigrations()` call on the same DB is a no-op.
//   3. Core tables exist after the round-trip (catches a regression where a
//      migration accidentally drops or renames a base table).
//
// Does not assert specific column counts — that would create maintenance noise
// every time a migration adds a column. Asserts the structural invariants only.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { setTestDb, clearTestDb } from './support/database-stub.mjs'
import { runMigrations } from '../src/main/db/migrations.ts'

const REQUIRED_TABLES = [
  'app_sessions',
  'live_app_session_snapshot',
  'focus_sessions',
  'ai_conversations',
  'ai_messages',
  'ai_threads',
  'website_visits',
  'schema_version',
]

function tableNames(db: Database.Database): Set<string> {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all() as { name: string }[]
  return new Set(rows.map((r) => r.name))
}

function currentSchemaVersion(db: Database.Database): number {
  const row = db
    .prepare('SELECT MAX(version) AS v FROM schema_version')
    .get() as { v: number | null } | undefined
  return row?.v ?? 0
}

test('fresh install: SCHEMA_SQL boots + runMigrations advances schema_version', () => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)

  setTestDb(db)
  try {
    assert.doesNotThrow(() => runMigrations())

    const version = currentSchemaVersion(db)
    assert.ok(version >= 22, `expected schema_version >= 22, got ${version}`)

    const tables = tableNames(db)
    for (const required of REQUIRED_TABLES) {
      assert.ok(tables.has(required), `missing required table: ${required}`)
    }
  } finally {
    clearTestDb()
    db.close()
  }
})

test('runMigrations is idempotent on an up-to-date database', () => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)

  setTestDb(db)
  try {
    runMigrations()
    const firstVersion = currentSchemaVersion(db)

    assert.doesNotThrow(() => runMigrations())

    const secondVersion = currentSchemaVersion(db)
    assert.equal(secondVersion, firstVersion, 'second runMigrations() should not advance the version')
  } finally {
    clearTestDb()
    db.close()
  }
})

test('migration ladder does not drop any required base table', () => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)

  setTestDb(db)
  try {
    runMigrations()
    const tables = tableNames(db)
    for (const required of REQUIRED_TABLES) {
      assert.ok(tables.has(required), `migration dropped required table: ${required}`)
    }
  } finally {
    clearTestDb()
    db.close()
  }
})

test('migration ladder leaves the database queryable', () => {
  // Sanity: after migrations, a few representative queries should run without
  // syntax errors. Catches the case where a migration adds an index against
  // a non-existent column.
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)

  setTestDb(db)
  try {
    runMigrations()

    assert.doesNotThrow(() => db.prepare('SELECT COUNT(*) FROM app_sessions').get())
    assert.doesNotThrow(() => db.prepare('SELECT COUNT(*) FROM website_visits').get())
    assert.doesNotThrow(() => db.prepare('SELECT COUNT(*) FROM ai_threads').get())
    assert.doesNotThrow(() => db.prepare('SELECT COUNT(*) FROM schema_version').get())
  } finally {
    clearTestDb()
    db.close()
  }
})
