// DEV-185: confirmed memory facts (memory-and-entities.md §Conversational
// memory, §Migration slices 1–2).
//
// Proves the load-bearing behaviors end to end on a production database:
//   1. a confirmed fact persists as `supplied` memory — canonical row plus its
//      retrieval mirror in memory_records — and exact search finds it with
//      source type `supplied`;
//   2. edit propagates: the corrected text is findable, the old wording is
//      not, and any stale embedding bookkeeping is dropped in the same write;
//   3. delete propagates immediately: the fact leaves the store, the mirror,
//      exact search, and freshly assembled context packets, and a day
//      re-projection can never resurrect it;
//   4. context packets carry supplied facts with sourceType 'supplied' (and
//      drafted profile facts as 'inferred'), deterministically;
//   5. deleting an AI thread keeps separately confirmed memory but purges the
//      text of declined proposals whose evidence was that thread;
//   6. migration slice 1 moves user-origin legacy rows into supplied memory
//      keeping content and creation times, while drafted rows stay behind as
//      proposals that a rebuild cannot silently promote.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { setTestDb, clearTestDb } from './support/database-stub.mjs'
import {
  confirmSuppliedFact,
  deleteSuppliedFact,
  updateSuppliedFact,
  listSuppliedFacts,
  getSuppliedFact,
  deleteAllSuppliedFacts,
  migrateLegacyUserFactsToSupplied,
  reconcileSuppliedMemoryRecords,
  recordMemoryProposalRejection,
  findMemoryProposalRejection,
  listMemoryProposalRejections,
  deleteMemoryProposalRejection,
  purgeRejectionTextForThread,
  detachSuppliedFactsFromThread,
  isSensitiveFactStatement,
} from '../src/main/services/suppliedMemory.ts'
import {
  getWorkMemoryProfile,
  addWorkMemoryFact,
  applyMemoryWriteOps,
  confirmDraftedWorkMemoryFact,
  rebuildWorkMemory,
} from '../src/main/services/workMemoryProfile.ts'
import { searchExact } from '../src/main/services/exactSearch.ts'
import { indexMemoryForDay } from '../src/main/services/memoryIndex.ts'
import { buildContextPacket } from '../src/main/services/contextPacket.ts'
import { localDateString } from '../src/main/lib/localDate.ts'
import { deleteThread } from '../src/main/services/artifacts.ts'

function sessionSearchHits(db: ReturnType<typeof createProductionTestDatabase>, query: string) {
  return searchExact(db, query).filter((result) => result.type === 'session')
}

test('a confirmed fact persists as supplied memory and exact search finds it with source type supplied', () => {
  const db = createProductionTestDatabase()
  try {
    const fact = confirmSuppliedFact(db, {
      statement: 'You lead the Zephyr pricing project.',
      source: 'chat',
      context: 'Confirmed in chat',
      threadId: 7,
    })
    assert.ok(fact)

    const stored = getSuppliedFact(db, fact.id)
    assert.equal(stored?.statement, 'You lead the Zephyr pricing project.')
    assert.equal(stored?.thread_id, 7)

    const mirror = db.prepare(`SELECT * FROM memory_records WHERE id = ?`).get(fact.id) as {
      record_kind: string
      memory_type: string
      exact_text: string
      semantic_text: string
      provenance: string
    } | undefined
    assert.ok(mirror, 'expected a retrieval mirror in memory_records')
    assert.equal(mirror.record_kind, 'supplied_fact')
    assert.equal(mirror.memory_type, 'supplied')
    assert.equal(mirror.provenance, 'supplied')
    assert.equal(mirror.exact_text, fact.statement)
    assert.equal(mirror.semantic_text, fact.statement)

    const hits = sessionSearchHits(db, 'zephyr pricing')
    assert.equal(hits.length, 1)
    assert.equal(hits[0].sourceType, 'supplied')
    assert.equal(hits[0].appName, 'You told Daylens')
    // The excerpt is the FTS snippet with highlight marks around the terms.
    assert.match(hits[0].excerpt, /Zephyr[\s\S]*pricing/)
  } finally {
    db.close()
  }
})

test('editing a supplied fact propagates to search: new wording found, old wording gone', () => {
  const db = createProductionTestDatabase()
  try {
    const fact = confirmSuppliedFact(db, { statement: 'Fridays are focus days.', source: 'chat' })
    assert.ok(fact)
    // Simulate a stale embedding: bookkeeping row + engine stamp.
    db.prepare(`
      INSERT INTO memory_record_vectors (record_id, date, model, model_version, dims, created_at)
      VALUES (?, ?, 'test-model', 1, 4, ?)
    `).run(fact.id, localDateString(), Date.now())
    db.prepare(`UPDATE memory_records SET embedding_model = 'test-model', embedding_version = 1 WHERE id = ?`)
      .run(fact.id)

    const updated = updateSuppliedFact(db, fact.id, 'Thursdays are focus days.', 'hand')
    assert.equal(updated?.statement, 'Thursdays are focus days.')

    assert.equal(sessionSearchHits(db, 'thursdays focus').length, 1)
    assert.equal(sessionSearchHits(db, 'fridays').length, 0)

    // The stale vector bookkeeping died with the edit, and the engine stamp
    // cleared so the record is pending re-embedding.
    const vector = db.prepare(`SELECT 1 FROM memory_record_vectors WHERE record_id = ?`).get(fact.id)
    assert.equal(vector, undefined)
    const stamp = db.prepare(`SELECT embedding_model FROM memory_records WHERE id = ?`).get(fact.id) as { embedding_model: string | null }
    assert.equal(stamp.embedding_model, null)
  } finally {
    db.close()
  }
})

test('deleting a supplied fact removes it from search and packets immediately, and reindexing cannot resurrect it', async () => {
  const db = createProductionTestDatabase()
  try {
    const fact = confirmSuppliedFact(db, { statement: 'Acme is your biggest client this quarter.', source: 'chat' })
    assert.ok(fact)
    assert.equal(sessionSearchHits(db, 'biggest client quarter').length, 1)

    deleteSuppliedFact(db, fact.id)

    assert.equal(getSuppliedFact(db, fact.id), null)
    assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM memory_records WHERE id = ?`).get(fact.id) != null
      && (db.prepare(`SELECT COUNT(*) AS c FROM memory_records WHERE id = ?`).get(fact.id) as { c: number }).c, 0)
    assert.equal(sessionSearchHits(db, 'biggest client quarter').length, 0)

    // Re-projecting the confirmation day must not bring the mirror back.
    indexMemoryForDay(db, localDateString(new Date(fact.confirmed_at)))
    assert.equal(sessionSearchHits(db, 'biggest client quarter').length, 0)

    const packet = await buildContextPacket(db, {
      purpose: 'answer',
      question: 'Who is my biggest client?',
      destination: 'test:model',
    })
    assert.ok(!packet.items.some((item) => item.statement.includes('biggest client this quarter')))
  } finally {
    db.close()
  }
})

test('a day re-projection preserves active supplied facts', () => {
  const db = createProductionTestDatabase()
  try {
    const fact = confirmSuppliedFact(db, { statement: 'You mentor two junior engineers.', source: 'hand' })
    assert.ok(fact)
    indexMemoryForDay(db, localDateString(new Date(fact.confirmed_at)))
    assert.equal(sessionSearchHits(db, 'mentor junior engineers').length, 1)
  } finally {
    db.close()
  }
})

test('context packets carry supplied facts as sourceType supplied and drafted profile facts as inferred, deterministically', async () => {
  const db = createProductionTestDatabase()
  try {
    addWorkMemoryFact(db, 'You lead the pricing project at Acme.')
    // A drafted (evidence-inferred, unconfirmed) profile fact.
    const BASE = Date.now() - 5 * 86_400_000
    const insert = db.prepare(`
      INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec, category)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (let i = 0; i < 5; i++) {
      insert.run('com.cursor.app', 'Cursor', BASE + i * 1000, BASE + i * 1000 + 3600_000, 3600, 'development')
    }
    rebuildWorkMemory(db)

    const build = () => buildContextPacket(db, {
      purpose: 'answer',
      question: 'What do you know about my work?',
      destination: 'test:model',
      now: new Date('2026-07-10T12:00:00'),
    })
    const packet = await build()
    const facts = packet.items.filter((item) => item.kind === 'corrected_fact')
    const supplied = facts.find((item) => item.statement.includes('pricing project'))
    assert.ok(supplied, 'expected the supplied fact in the packet')
    assert.equal(supplied.sourceType, 'supplied')
    const drafted = facts.find((item) => item.statement.includes('Cursor'))
    assert.ok(drafted, 'expected the drafted fact in the packet')
    assert.equal(drafted.sourceType, 'inferred')

    const again = await build()
    assert.equal(again.contentFingerprint, packet.contentFingerprint)
  } finally {
    db.close()
  }
})

test('the profile paths write and read the supplied store: chat add, hand add, forget-all', () => {
  const db = createProductionTestDatabase()
  try {
    applyMemoryWriteOps(db, [{ action: 'add', text: 'You prefer async standups.' }], 'chat')
    addWorkMemoryFact(db, 'You run before work most days.')

    const facts = getWorkMemoryProfile(db).facts
    assert.equal(facts.length, 2)
    assert.ok(facts.every((fact) => fact.supplied === true && fact.origin === 'user'))
    assert.equal(listSuppliedFacts(db).length, 2)
    assert.equal(sessionSearchHits(db, 'async standups').length, 1)

    recordMemoryProposalRejection(db, { statement: 'You hate mornings.' })
    deleteAllSuppliedFacts(db)
    assert.equal(listSuppliedFacts(db).length, 0)
    assert.equal(sessionSearchHits(db, 'async standups').length, 0)
    assert.equal(listMemoryProposalRejections(db).length, 0)
  } finally {
    db.close()
  }
})

test('confirming a drafted fact promotes it to supplied memory and a rebuild does not re-draft it', () => {
  const db = createProductionTestDatabase()
  try {
    const BASE = Date.now() - 5 * 86_400_000
    const insert = db.prepare(`
      INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec, category)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (let i = 0; i < 5; i++) {
      insert.run('com.cursor.app', 'Cursor', BASE + i * 1000, BASE + i * 1000 + 3600_000, 3600, 'development')
    }
    rebuildWorkMemory(db)
    const drafted = getWorkMemoryProfile(db).facts.find((fact) => fact.origin === 'drafted')
    assert.ok(drafted, 'expected a drafted fact')

    confirmDraftedWorkMemoryFact(db, drafted.id)
    const supplied = listSuppliedFacts(db)
    assert.equal(supplied.length, 1)
    assert.equal(supplied[0].statement, drafted.text)

    // Never silently promoted twice, never re-drafted: the topic is tombstoned
    // and the supplied duplicate check catches the same wording.
    const rebuilt = rebuildWorkMemory(db)
    assert.equal(rebuilt.added.length, 0)
    assert.equal(listSuppliedFacts(db).length, 1)
    assert.equal(getWorkMemoryProfile(db).facts.filter((fact) => fact.origin === 'drafted').length, 0)
  } finally {
    db.close()
  }
})

test('declined proposals are recorded, deletable, and their text purges with the supporting thread', () => {
  const db = createProductionTestDatabase()
  try {
    recordMemoryProposalRejection(db, { statement: 'You dislike meetings.', threadId: 42 })
    assert.ok(findMemoryProposalRejection(db, 'you dislike meetings'))

    // Deleting the rejection clears the block.
    const [rejection] = listMemoryProposalRejections(db)
    deleteMemoryProposalRejection(db, rejection.id)
    assert.equal(findMemoryProposalRejection(db, 'You dislike meetings.'), null)

    // Re-record, then purge via the thread: text and match key are blanked.
    recordMemoryProposalRejection(db, { statement: 'You dislike meetings.', threadId: 42 })
    purgeRejectionTextForThread(db, 42)
    assert.equal(findMemoryProposalRejection(db, 'You dislike meetings.'), null)
    assert.equal(listMemoryProposalRejections(db).length, 0)
  } finally {
    db.close()
  }
})

test('deleting an AI thread keeps separately confirmed memory and purges that thread\'s rejection text', async () => {
  const db = createProductionTestDatabase()
  setTestDb(db)
  try {
    const now = Date.now()
    db.prepare(`INSERT INTO ai_conversations (id, messages, created_at) VALUES (1, '[]', ?)`).run(now)
    db.prepare(`
      INSERT INTO ai_threads (id, title, created_at, updated_at, last_message_at, archived, metadata_json)
      VALUES (1, 'Chat', ?, ?, ?, 0, '{}')
    `).run(now, now, now)

    const fact = confirmSuppliedFact(db, {
      statement: 'You lead the pricing project.',
      source: 'chat',
      threadId: 1,
    })
    assert.ok(fact)
    recordMemoryProposalRejection(db, { statement: 'You nap at noon.', threadId: 1 })

    await deleteThread(1)

    const kept = getSuppliedFact(db, fact.id)
    assert.ok(kept, 'confirmed memory must survive thread deletion')
    assert.equal(kept.thread_id, null)
    assert.equal(kept.source, 'chat')
    assert.equal(sessionSearchHits(db, 'pricing project').length, 1)
    assert.equal(findMemoryProposalRejection(db, 'You nap at noon.'), null)
  } finally {
    clearTestDb()
    db.close()
  }
})

test('migration slice 1: user-origin legacy rows become supplied memory with content and creation times; drafted rows stay proposals', () => {
  const db = createProductionTestDatabase()
  try {
    const createdAt = Date.now() - 90 * 86_400_000
    const insert = db.prepare(`
      INSERT INTO work_memory_facts (id, fact_text, origin, status, topic_key, source, scope, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
    `)
    insert.run('wmf_hand1', 'Acme is your biggest client.', 'user', null, 'hand', 'general', 1, createdAt, createdAt)
    insert.run('wmf_edit1', 'You edited this drafted fact.', 'user', 'top-apps', 'chat', 'general', 2, createdAt, createdAt)
    insert.run('wmf_draft', 'You spend most of your day in Cursor.', 'drafted', 'background', 'evidence', 'general', 3, createdAt, createdAt)
    db.prepare(`
      INSERT INTO user_memory_facts (id, fact_type, fact_key, subject, fact_value_json, created_at, updated_at)
      VALUES ('fact_book', 'preference', 'memory_backfilled_at', 'Work memory backfill', '{}', ?, ?)
    `).run(createdAt, createdAt)

    const migrated = migrateLegacyUserFactsToSupplied(db)
    reconcileSuppliedMemoryRecords(db)
    assert.equal(migrated, 2)

    const supplied = listSuppliedFacts(db)
    assert.equal(supplied.length, 2)
    const hand = supplied.find((fact) => fact.statement === 'Acme is your biggest client.')
    assert.ok(hand)
    assert.equal(hand.source, 'hand')
    assert.equal(hand.confirmed_at, createdAt)
    assert.ok(sessionSearchHits(db, 'acme biggest client').length >= 1)

    // The edited drafted row moved and left a tombstone so a rebuild cannot
    // re-draft the topic; the untouched drafted row stayed a proposal.
    const tombstone = db.prepare(`SELECT status FROM work_memory_facts WHERE id = 'wmf_edit1'`).get() as { status: string }
    assert.equal(tombstone.status, 'deleted')
    const drafted = db.prepare(`SELECT origin, status FROM work_memory_facts WHERE id = 'wmf_draft'`).get() as { origin: string; status: string }
    assert.equal(drafted.origin, 'drafted')
    assert.equal(drafted.status, 'active')
    // Machine bookkeeping never migrates.
    assert.ok(!supplied.some((fact) => fact.statement === 'Work memory backfill'))
  } finally {
    db.close()
  }
})

test('a journaled supplied-fact deletion replays against a restored database (backup restore cannot resurrect it)', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { appendDeletionJournalEntry, replayDeletionJournal } = await import('../src/main/services/deletionJournal.ts')

  // The "backup": a database that still holds the fact the user later deleted.
  const db = createProductionTestDatabase()
  setTestDb(db)
  try {
    const fact = confirmSuppliedFact(db, { statement: 'You lead the pricing project.', source: 'chat' })
    assert.ok(fact)

    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-supplied-journal-'))
    appendDeletionJournalEntry(userData, { kind: 'supplied-fact', params: { factId: fact.id } })

    const result = replayDeletionJournal(db, userData)
    assert.equal(result.failed, 0)
    assert.equal(getSuppliedFact(db, fact.id), null)
    assert.equal(sessionSearchHits(db, 'pricing project').length, 0)
  } finally {
    clearTestDb()
    db.close()
  }
})

test('confirmed memory improves the specific fixture answer it was saved for', async () => {
  const { chatMemoryPromptBlock } = await import('../src/main/services/workMemoryProfile.ts')
  const db = createProductionTestDatabase()
  try {
    const question = 'Who leads the pricing project?'
    // BEFORE the confirmation: the agent has nothing to answer from — no
    // memory context, no search hit, nothing in the packet.
    assert.equal(chatMemoryPromptBlock(db, question), '')
    assert.equal(sessionSearchHits(db, 'pricing project').length, 0)
    const before = await buildContextPacket(db, {
      purpose: 'answer',
      question,
      destination: 'test:model',
      now: new Date('2026-07-10T12:00:00'),
    })
    assert.ok(!before.items.some((item) => item.statement.includes('pricing project')))

    const fact = confirmSuppliedFact(db, { statement: 'You lead the pricing project.', source: 'chat' })
    assert.ok(fact)

    // AFTER: the exact fact the user confirmed reaches every path the agent
    // answers this question from — the memory prompt block, exact search,
    // and the context packet, labeled `supplied`.
    assert.match(chatMemoryPromptBlock(db, question), /You lead the pricing project\./)
    const hits = sessionSearchHits(db, 'pricing project')
    assert.equal(hits.length, 1)
    assert.equal(hits[0].sourceType, 'supplied')
    const after = await buildContextPacket(db, {
      purpose: 'answer',
      question,
      destination: 'test:model',
      now: new Date('2026-07-10T12:00:00'),
    })
    const packetFact = after.items.find((item) => item.statement === 'You lead the pricing project.')
    assert.ok(packetFact, 'the confirmed fact must reach the packet for its fixture question')
    assert.equal(packetFact.sourceType, 'supplied')
  } finally {
    db.close()
  }
})

test('the sensitive-fact guard refuses secrets, credentials, health, and financial details', () => {
  assert.equal(isSensitiveFactStatement('Your GitHub password is hunter2.'), true)
  assert.equal(isSensitiveFactStatement('Your API key lives in 1Password.'), true)
  assert.equal(isSensitiveFactStatement('You take medication for migraines.'), true)
  assert.equal(isSensitiveFactStatement('Your bank account is with Chase.'), true)
  assert.equal(isSensitiveFactStatement('You lead the pricing project.'), false)
  assert.equal(isSensitiveFactStatement('Fridays are focus days.'), false)
})
