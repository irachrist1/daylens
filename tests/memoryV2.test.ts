// DEV-107: memory grows through conversation. The detector flags
// remember/forget/correct instructions (and not recall questions); the
// extract→update parser maps the model's ops onto durable writes; and the
// service applies them with audit + the correction rule (origin='user',
// tombstones survive rebuild).
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import {
  getWorkMemoryProfile,
  addWorkMemoryFact,
  applyMemoryWriteOps,
  getMemoryAudit,
  rebuildWorkMemory,
} from '../src/main/services/workMemoryProfile.ts'
import {
  looksLikeMemoryInstruction,
  parseMemoryOps,
} from '../src/main/ai/memoryWrite.ts'

test('looksLikeMemoryInstruction flags remember/forget/correct but not recall questions', () => {
  assert.equal(looksLikeMemoryInstruction('remember that Acme is my biggest client'), true)
  assert.equal(looksLikeMemoryInstruction('note that I work in Digital Operations'), true)
  assert.equal(looksLikeMemoryInstruction("forget that I use Notion"), true)
  assert.equal(looksLikeMemoryInstruction("actually I work in Digital Operations, not engineering"), true)
  assert.equal(looksLikeMemoryInstruction('stop remembering that'), true)

  assert.equal(looksLikeMemoryInstruction('do you remember what I did yesterday?'), false)
  assert.equal(looksLikeMemoryInstruction('what do you remember about me?'), false)
  assert.equal(looksLikeMemoryInstruction('what did I do today?'), false)
  assert.equal(looksLikeMemoryInstruction('how was my day?'), false)
  assert.equal(looksLikeMemoryInstruction('hi'), false)
})

test('parseMemoryOps maps add/update/delete/noop onto durable ops', () => {
  const currentFacts = [
    { id: 'f1', text: 'You use Notion for notes.' },
    { id: 'f2', text: 'You work in engineering.' },
  ]
  const ops = parseMemoryOps(
    '{"ops":[{"action":"add","text":"You work in Digital Operations at Andersen."},{"action":"update","target":2,"text":"You work in Digital Operations."},{"action":"delete","target":1},{"action":"noop"}]}',
    currentFacts,
  )
  assert.equal(ops.length, 3)
  assert.deepEqual(ops[0], { action: 'add', text: 'You work in Digital Operations at Andersen.' })
  assert.deepEqual(ops[1], { action: 'update', targetId: 'f2', text: 'You work in Digital Operations.' })
  assert.deepEqual(ops[2], { action: 'delete', targetId: 'f1' })
})

test('parseMemoryOps downgrades an update with no matching target to an add', () => {
  const ops = parseMemoryOps('{"ops":[{"action":"update","target":99,"text":"You like dark mode."}]}', [])
  assert.equal(ops.length, 1)
  assert.equal(ops[0].action, 'add')
  assert.equal(ops[0].text, 'You like dark mode.')
})

test('parseMemoryOps drops a delete with no matching target', () => {
  const ops = parseMemoryOps('{"ops":[{"action":"delete","target":99}]}', [])
  assert.equal(ops.length, 0)
})

test('parseMemoryOps returns nothing for malformed JSON', () => {
  assert.deepEqual(parseMemoryOps('not json', []), [])
  assert.deepEqual(parseMemoryOps('{}', []), [])
})

test('applyMemoryWriteOps adds a chat-remembered fact with source=chat and records the audit', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  try {
    const result = applyMemoryWriteOps(db, [{ action: 'add', text: 'Acme is your biggest client.' }], 'chat')
    assert.equal(result.facts.length, 1)
    assert.equal(result.facts[0].text, 'Acme is your biggest client.')
    assert.equal(result.facts[0].origin, 'user')
    assert.equal(result.facts[0].source, 'chat')
    assert.match(result.summary, /remember that/)

    const audit = getMemoryAudit(db)
    assert.equal(audit.length, 1)
    assert.equal(audit[0].action, 'remembered')
    assert.equal(audit[0].source, 'chat')
  } finally {
    db.close()
  }
})

test('applyMemoryWriteOps update flips an existing fact to a user correction', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  try {
    const added = addWorkMemoryFact(db, 'You work in engineering.')
    const id = getWorkMemoryProfile(db).facts[0].id
    assert.equal(added.facts.length, 1)

    const result = applyMemoryWriteOps(
      db,
      [{ action: 'update', targetId: id, text: 'You work in Digital Operations.' }],
      'chat',
    )
    assert.equal(result.facts.length, 1)
    assert.equal(result.facts[0].text, 'You work in Digital Operations.')
    assert.equal(result.facts[0].origin, 'user')
    assert.equal(result.facts[0].source, 'chat')

    const audit = getMemoryAudit(db)
    const updatedEntry = audit.find((entry) => entry.action === 'updated')
    assert.ok(updatedEntry, 'expected an updated audit entry')
  } finally {
    db.close()
  }
})

test('applyMemoryWriteOps delete tombstones a drafted fact so rebuild never resurrects it', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  try {
    // Seed evidence + rebuild so there is a drafted fact with a topic_key.
    const BASE = Date.now() - 5 * 86_400_000
    const insert = db.prepare(`
      INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec, category)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (let i = 0; i < 5; i++) {
      insert.run('com.cursor.app', 'Cursor', BASE + i * 1000, BASE + i * 1000 + 3600_000, 3600, 'development')
    }
    const rebuilt = rebuildWorkMemory(db)
    assert.ok(rebuilt.facts.length > 0)
    const draftedId = rebuilt.facts[0].id

    applyMemoryWriteOps(db, [{ action: 'delete', targetId: draftedId }], 'chat')
    assert.equal(getWorkMemoryProfile(db).facts.length, 0)

    // Rebuild must not drag the forgotten drafted fact back.
    const reRebuilt = rebuildWorkMemory(db)
    assert.equal(reRebuilt.added.length, 0)
    assert.equal(reRebuilt.facts.length, 0)

    const audit = getMemoryAudit(db)
    const forgotEntry = audit.find((entry) => entry.action === 'forgot')
    assert.ok(forgotEntry, 'expected a forgot audit entry')
  } finally {
    db.close()
  }
})

test('applyMemoryWriteOps with no ops returns an empty summary', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  try {
    const result = applyMemoryWriteOps(db, [], 'chat')
    assert.equal(result.applied.length, 0)
    assert.equal(result.summary, '')
  } finally {
    db.close()
  }
})
