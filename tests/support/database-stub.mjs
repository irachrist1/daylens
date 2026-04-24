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

export function initDb() {}

export function closeDb() {}
