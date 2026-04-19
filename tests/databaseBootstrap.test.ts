import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { ensureAIThreadSchema } from '../src/main/db/aiThreadSchema.ts'

test('legacy ai_messages tables can boot through schema + repair without thread_id', () => {
  const db = new Database(':memory:')

  db.exec(`
    CREATE TABLE ai_conversations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      messages   TEXT    NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE ai_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id),
      role            TEXT    NOT NULL CHECK(role IN ('user', 'assistant')),
      content         TEXT    NOT NULL,
      created_at      INTEGER NOT NULL,
      metadata_json   TEXT    NOT NULL DEFAULT '{}'
    );

    INSERT INTO ai_conversations (id, messages, created_at) VALUES (1, '[]', 1000);
    INSERT INTO ai_messages (conversation_id, role, content, created_at, metadata_json)
    VALUES
      (1, 'user', 'What did I do?', 1100, '{}'),
      (1, 'assistant', 'You worked on Daylens.', 1200, '{}');
  `)

  assert.doesNotThrow(() => db.exec(SCHEMA_SQL))
  assert.doesNotThrow(() => ensureAIThreadSchema(db))

  const columns = db.prepare(`PRAGMA table_info(ai_messages)`).all() as { name: string }[]
  assert.ok(columns.some((column) => column.name === 'thread_id'))

  const indexes = db.prepare(`PRAGMA index_list(ai_messages)`).all() as { name: string }[]
  assert.ok(indexes.some((index) => index.name === 'idx_ai_messages_thread'))

  const threadCount = db.prepare(`SELECT COUNT(*) AS count FROM ai_threads`).get() as { count: number }
  assert.equal(threadCount.count, 1)

  db.close()
})
