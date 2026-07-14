import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../../src/main/db/schema.ts'
import { runMigrations } from '../../src/main/db/migrations.ts'
import { ensureAIThreadSchema } from '../../src/main/db/aiThreadSchema.ts'
import { syncDerivedStateMetadata } from '../../src/main/core/projections/metadata.ts'
import { clearTestDb, setTestDb } from './database-stub.mjs'

export function bootstrapProductionTestDatabase(db: Database.Database): Database.Database {
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)

  setTestDb(db)
  const log = console.log
  console.log = () => {}
  try {
    runMigrations()
  } finally {
    console.log = log
    clearTestDb()
  }

  ensureAIThreadSchema(db)
  syncDerivedStateMetadata(db)
  return db
}

export function createProductionTestDatabase(filename: string = ':memory:'): Database.Database {
  return bootstrapProductionTestDatabase(new Database(filename))
}
