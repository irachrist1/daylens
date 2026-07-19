let testDb = null

export function setTestDb(db) {
  testDb = db
}

export function clearTestDb() {
  testDb = null
}

export function getDb() {
  if (testDb) return testDb
  throw new Error('database-stub:getDb should not be called without a configured test database')
}

// Mirror of the real runWithDb: the deletion-journal replay routes the
// restored database through getDb() for the duration of fn.
export function runWithDb(db, fn) {
  const previous = testDb
  testDb = db
  try {
    return fn()
  } finally {
    testDb = previous
  }
}

export function initDb() {}

export function closeDb() {}

// Mirror the real helper. No cross-test caching here on purpose: tests swap the
// underlying db handle freely, so always read sqlite_master directly.
export function tableExists(db, tableName) {
  const row = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).get(tableName)
  return Boolean(row)
}
