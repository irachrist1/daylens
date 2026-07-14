// Rename persistence + the empty-draft reuse that stops duplicate
// sidebar threads at the source. A failed first send leaves an EMPTY thread
// row behind (the turn is persisted only at the end); the next draft send must
// reuse that row (createThread(null)) instead of minting another identically
// titled one — that mint is where "This Week Focus" x2 came from.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { createThread, getThread, renameThread } from '../src/main/services/artifacts.ts'
import { deriveTitleFromMessage, isWeakThreadTitle } from '../src/main/lib/threadTitles.ts'
import { clearTestDb, setTestDb } from './support/database-stub.mjs'

function freshDb(): Database.Database {
  return createProductionTestDatabase()
}

test('renameThread persists the new title and normalizes an empty one', () => {
  const db = freshDb()
  setTestDb(db)
  try {
    const thread = createThread('Focus Session')
    renameThread(thread.id, '  Deep work planning  ')
    assert.equal(getThread(thread.id)?.title, 'Deep work planning')

    renameThread(thread.id, '   ')
    assert.equal(getThread(thread.id)?.title, 'Untitled chat')
  } finally {
    clearTestDb()
    db.close()
  }
})

test('a manual rename is not weak, so the auto title-upgrade path leaves it alone', () => {
  // maybeRenameWeakThread only fires when isWeakThreadTitle(current) is true —
  // pin that a user-chosen title never qualifies.
  assert.equal(isWeakThreadTitle('Deep work planning'), false)
  assert.equal(isWeakThreadTitle('New chat'), true)
  assert.equal(isWeakThreadTitle('today'), true)
})

test('createThread(null) reuses the newest EMPTY draft instead of minting a duplicate row', () => {
  const db = freshDb()
  setTestDb(db)
  try {
    // A failed first send left this titled-but-empty thread behind.
    const abandoned = createThread(deriveTitleFromMessage('When was I most focused this week?'))
    assert.equal(abandoned.title, 'This Week Focus')

    // The retry (renderer sends threadId=null again from the draft) must
    // adopt the same row, not create "This Week Focus" #2.
    const reused = createThread(null)
    assert.equal(reused.id, abandoned.id)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM ai_threads').get() as { n: number }).n, 1)
  } finally {
    clearTestDb()
    db.close()
  }
})

test('a thread with messages is never treated as a reusable draft', () => {
  const db = freshDb()
  setTestDb(db)
  try {
    const now = Date.now()
    db.prepare(`INSERT INTO ai_conversations (id, messages, created_at) VALUES (1, '[]', ?)`).run(now)
    const settled = createThread('Time on youtube')
    db.prepare(`
      INSERT INTO ai_messages (conversation_id, thread_id, role, content, created_at, metadata_json)
      VALUES (1, ?, 'user', 'how long was I on youtube?', ?, '{}')
    `).run(settled.id, now)

    const next = createThread(null)
    assert.notEqual(next.id, settled.id)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM ai_threads').get() as { n: number }).n, 2)
  } finally {
    clearTestDb()
    db.close()
  }
})
