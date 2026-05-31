import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { tableExists } from '../packages/mcp-server/stubs/database.mjs'

test('MCP database stub exposes tableExists for dev loader imports', () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY)')

  assert.equal(tableExists(db, 'sample'), true)
  assert.equal(tableExists(db, 'missing'), false)

  db.close()
})
