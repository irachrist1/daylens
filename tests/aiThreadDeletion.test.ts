import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { createThread, deleteThread } from '../src/main/services/artifacts.ts'
import { clearTestDb, setTestDb } from './support/database-stub.mjs'

test('deleteThread removes the thread, its messages, and attached artifacts', async () => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daylens-thread-delete-'))
  const targetArtifactPath = path.join(tempDir, 'target.md')
  const survivorArtifactPath = path.join(tempDir, 'survivor.md')

  await fs.writeFile(targetArtifactPath, 'target artifact', 'utf8')
  await fs.writeFile(survivorArtifactPath, 'survivor artifact', 'utf8')

  const now = Date.now()
  db.prepare(`
    INSERT INTO ai_conversations (id, messages, created_at)
    VALUES (?, ?, ?)
  `).run(1, '[]', now - 2_100)
  db.prepare(`
    INSERT INTO ai_conversations (id, messages, created_at)
    VALUES (?, ?, ?)
  `).run(2, '[]', now - 1_100)
  db.prepare(`
    INSERT INTO ai_threads (id, title, created_at, updated_at, last_message_at, archived, metadata_json)
    VALUES (?, ?, ?, ?, ?, 0, '{}')
  `).run(1, 'Target chat', now - 2_000, now - 1_000, now - 1_000)
  db.prepare(`
    INSERT INTO ai_threads (id, title, created_at, updated_at, last_message_at, archived, metadata_json)
    VALUES (?, ?, ?, ?, ?, 0, '{}')
  `).run(2, 'Survivor chat', now - 1_000, now - 500, now - 500)

  db.prepare(`
    INSERT INTO ai_messages (id, conversation_id, thread_id, role, content, created_at, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(1, 1, 1, 'user', 'Delete me', now - 900, '{}')
  db.prepare(`
    INSERT INTO ai_messages (id, conversation_id, thread_id, role, content, created_at, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(2, 2, 2, 'user', 'Keep me', now - 400, '{}')

  db.prepare(`
    INSERT INTO ai_artifacts (id, thread_id, message_id, kind, title, summary, file_path, inline_content, mime_type, byte_size, meta_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(1, 1, 1, 'markdown', 'Target artifact', null, targetArtifactPath, null, 'text/markdown', 15, '{}', now - 800)
  db.prepare(`
    INSERT INTO ai_artifacts (id, thread_id, message_id, kind, title, summary, file_path, inline_content, mime_type, byte_size, meta_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(2, 2, 2, 'markdown', 'Survivor artifact', null, survivorArtifactPath, null, 'text/markdown', 17, '{}', now - 300)

  setTestDb(db)

  try {
    await deleteThread(1)

    const threadCount = db.prepare(`SELECT COUNT(*) AS count FROM ai_threads WHERE id = 1`).get() as { count: number }
    const messageCount = db.prepare(`SELECT COUNT(*) AS count FROM ai_messages WHERE thread_id = 1`).get() as { count: number }
    const artifactCount = db.prepare(`SELECT COUNT(*) AS count FROM ai_artifacts WHERE thread_id = 1`).get() as { count: number }
    const survivorThreadCount = db.prepare(`SELECT COUNT(*) AS count FROM ai_threads WHERE id = 2`).get() as { count: number }
    const survivorMessageCount = db.prepare(`SELECT COUNT(*) AS count FROM ai_messages WHERE thread_id = 2`).get() as { count: number }
    const survivorArtifactCount = db.prepare(`SELECT COUNT(*) AS count FROM ai_artifacts WHERE thread_id = 2`).get() as { count: number }

    assert.equal(threadCount.count, 0)
    assert.equal(messageCount.count, 0)
    assert.equal(artifactCount.count, 0)
    assert.equal(survivorThreadCount.count, 1)
    assert.equal(survivorMessageCount.count, 1)
    assert.equal(survivorArtifactCount.count, 1)
    await assert.rejects(fs.access(targetArtifactPath))
    await assert.doesNotReject(fs.access(survivorArtifactPath))
  } finally {
    clearTestDb()
    db.close()
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('createThread(null) reuses an unused draft instead of creating duplicates', () => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)

  const now = Date.now()
  db.prepare(`
    INSERT INTO ai_conversations (id, messages, created_at)
    VALUES (?, ?, ?)
  `).run(1, '[]', now - 2_000)
  db.prepare(`
    INSERT INTO ai_conversations (id, messages, created_at)
    VALUES (?, ?, ?)
  `).run(2, '[]', now - 1_000)
  db.prepare(`
    INSERT INTO ai_threads (id, title, created_at, updated_at, last_message_at, archived, metadata_json)
    VALUES (?, ?, ?, ?, ?, 0, '{}')
  `).run(1, 'New chat', now - 2_000, now - 2_000, now - 2_000)
  db.prepare(`
    INSERT INTO ai_threads (id, title, created_at, updated_at, last_message_at, archived, metadata_json)
    VALUES (?, ?, ?, ?, ?, 0, '{}')
  `).run(2, 'Active chat', now - 1_000, now - 1_000, now - 1_000)
  db.prepare(`
    INSERT INTO ai_messages (id, conversation_id, thread_id, role, content, created_at, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(1, 2, 2, 'user', 'Already used', now - 900, '{}')

  setTestDb(db)

  try {
    const draft = createThread(null)
    const threadCount = db.prepare(`SELECT COUNT(*) AS count FROM ai_threads`).get() as { count: number }

    assert.equal(draft.id, 1)
    assert.equal(draft.title, 'New chat')
    assert.equal(threadCount.count, 2)
  } finally {
    clearTestDb()
    db.close()
  }
})
