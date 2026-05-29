import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import {
  clearCategoryOverride,
  getCategoryOverrides,
  setCategoryOverride,
} from '../src/main/db/queries.ts'

test('category override cache reflects set and clear writes', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)

  try {
    assert.deepEqual(getCategoryOverrides(db), {})

    setCategoryOverride(db, 'com.example.editor', 'development')
    assert.equal(getCategoryOverrides(db)['com.example.editor'], 'development')

    clearCategoryOverride(db, 'com.example.editor')
    assert.deepEqual(getCategoryOverrides(db), {})
  } finally {
    db.close()
  }
})
