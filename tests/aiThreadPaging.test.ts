// getThread is a single-row lookup (it used to list up to 1000 threads and
// scan), and opening a conversation loads only the newest page of messages via
// getThreadMessagesPage — these tests pin both behaviors.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { getThread } from '../src/main/services/artifacts.ts'
import { getThreadMessagesPage } from '../src/main/db/queries.ts'
import { clearTestDb, setTestDb } from './support/database-stub.mjs'

function seedDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  const now = 1_700_000_000_000
  db.prepare(`INSERT INTO ai_conversations (id, messages, created_at) VALUES (1, '[]', ?)`).run(now)
  db.prepare(`
    INSERT INTO ai_threads (id, title, created_at, updated_at, last_message_at, archived, metadata_json)
    VALUES (1, 'Long chat', ?, ?, ?, 0, '{}')
  `).run(now, now, now)
  const insert = db.prepare(`
    INSERT INTO ai_messages (id, conversation_id, thread_id, role, content, created_at, metadata_json)
    VALUES (?, 1, 1, ?, ?, ?, '{}')
  `)
  for (let i = 1; i <= 10; i += 1) {
    insert.run(i, i % 2 === 1 ? 'user' : 'assistant', `message ${i}`, now + i * 1_000)
  }
  return db
}

test('getThread returns the row by id and null for a missing id', () => {
  const db = seedDb()
  setTestDb(db)
  try {
    const thread = getThread(1)
    assert.equal(thread?.id, 1)
    assert.equal(thread?.title, 'Long chat')
    assert.equal(thread?.messageCount, 10)
    assert.equal(getThread(999), null)
  } finally {
    clearTestDb()
    db.close()
  }
})

test('getThreadMessagesPage returns the newest page, ascending, and flags earlier messages', () => {
  const db = seedDb()
  try {
    const first = getThreadMessagesPage(db, 1, { limit: 4 })
    assert.deepEqual(first.messages.map((m) => m.content), ['message 7', 'message 8', 'message 9', 'message 10'])
    assert.equal(first.hasEarlier, true)

    const oldest = first.messages[0]
    const second = getThreadMessagesPage(db, 1, {
      limit: 4,
      before: { createdAt: oldest.createdAt, id: oldest.id as number },
    })
    assert.deepEqual(second.messages.map((m) => m.content), ['message 3', 'message 4', 'message 5', 'message 6'])
    assert.equal(second.hasEarlier, true)

    const third = getThreadMessagesPage(db, 1, {
      limit: 4,
      before: { createdAt: second.messages[0].createdAt, id: second.messages[0].id as number },
    })
    assert.deepEqual(third.messages.map((m) => m.content), ['message 1', 'message 2'])
    assert.equal(third.hasEarlier, false)
  } finally {
    db.close()
  }
})

test('getThreadMessagesPage pages correctly across identical created_at timestamps', () => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  const now = 1_700_000_000_000
  db.prepare(`INSERT INTO ai_conversations (id, messages, created_at) VALUES (1, '[]', ?)`).run(now)
  db.prepare(`
    INSERT INTO ai_threads (id, title, created_at, updated_at, last_message_at, archived, metadata_json)
    VALUES (1, 'Tied timestamps', ?, ?, ?, 0, '{}')
  `).run(now, now, now)
  const insert = db.prepare(`
    INSERT INTO ai_messages (id, conversation_id, thread_id, role, content, created_at, metadata_json)
    VALUES (?, 1, 1, 'user', ?, ?, '{}')
  `)
  for (let i = 1; i <= 6; i += 1) insert.run(i, `message ${i}`, now) // all same created_at
  try {
    const first = getThreadMessagesPage(db, 1, { limit: 3 })
    assert.deepEqual(first.messages.map((m) => m.content), ['message 4', 'message 5', 'message 6'])
    const second = getThreadMessagesPage(db, 1, {
      limit: 3,
      before: { createdAt: first.messages[0].createdAt, id: first.messages[0].id as number },
    })
    assert.deepEqual(second.messages.map((m) => m.content), ['message 1', 'message 2', 'message 3'])
    assert.equal(second.hasEarlier, false)
  } finally {
    db.close()
  }
})
