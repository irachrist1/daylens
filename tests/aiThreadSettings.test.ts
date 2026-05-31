import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { getThreadSettings, setThreadSettings } from '../src/main/services/artifacts.ts'

// D4: per-thread settings persist in ai_threads.metadata_json.settings (no
// migration). These exercise the merge/normalise logic against an in-memory DB.

function makeDb(): { db: Database.Database; id: number } {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE ai_threads (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      title           TEXT    NOT NULL,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      last_message_at INTEGER NOT NULL,
      archived        INTEGER NOT NULL DEFAULT 0,
      metadata_json   TEXT    NOT NULL DEFAULT '{}'
    );
  `)
  const info = db
    .prepare(`INSERT INTO ai_threads (title, created_at, updated_at, last_message_at, archived, metadata_json) VALUES ('t', 1, 1, 1, 0, ?)`)
    .run(JSON.stringify({ workspaceThreadId: 'ws-1' }))
  return { db, id: info.lastInsertRowid as number }
}

test('thread settings default to null when unset', () => {
  const { db, id } = makeDb()
  assert.deepEqual(getThreadSettings(id, db), { provider: null, model: null, instructions: null })
  db.close()
})

test('set/get round-trips provider + model + instructions and trims', () => {
  const { db, id } = makeDb()
  setThreadSettings(id, { provider: 'google', model: 'gemini-x', instructions: '  be terse  ' }, db)
  assert.deepEqual(getThreadSettings(id, db), { provider: 'google', model: 'gemini-x', instructions: 'be terse' })
  db.close()
})

test('setThreadSettings preserves other metadata keys (workspaceThreadId)', () => {
  const { db, id } = makeDb()
  setThreadSettings(id, { provider: 'anthropic', model: 'claude-x', instructions: null }, db)
  const meta = JSON.parse((db.prepare('SELECT metadata_json FROM ai_threads WHERE id = ?').get(id) as { metadata_json: string }).metadata_json)
  assert.equal(meta.workspaceThreadId, 'ws-1')
  assert.equal(meta.settings.provider, 'anthropic')
  db.close()
})

test('empty strings clear an override back to null (= use the global setting)', () => {
  const { db, id } = makeDb()
  setThreadSettings(id, { provider: 'google', model: 'gemini-x', instructions: 'x' }, db)
  setThreadSettings(id, { provider: null, model: null, instructions: '   ' }, db)
  assert.deepEqual(getThreadSettings(id, db), { provider: null, model: null, instructions: null })
  db.close()
})

test('a partial patch (instructions only) keeps the existing model override', () => {
  const { db, id } = makeDb()
  setThreadSettings(id, { provider: 'openai', model: 'gpt-x', instructions: null }, db)
  setThreadSettings(id, { instructions: 'focus on work hours' }, db)
  assert.deepEqual(getThreadSettings(id, db), { provider: 'openai', model: 'gpt-x', instructions: 'focus on work hours' })
  db.close()
})
