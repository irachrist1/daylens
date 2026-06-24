// DEV-108: clients are memory with a scope (memory.md §2.2). General memory is
// always in the prompt; a client is a named scope (`client:<id>`) pulled in only
// when the question is about that client. Scoped facts never leak into general
// memory, and editing/forgetting works by id like general memory.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import {
  getWorkMemoryProfile,
  getClientMemory,
  addClientMemoryFact,
  getScopedMemoryProfile,
  forgetWorkMemoryFact,
  clientMemoryPromptBlock,
  scopedMemoryPromptBlock,
  chatMemoryPromptBlock,
  addWorkMemoryFact,
} from '../src/main/services/workMemoryProfile.ts'
import { createClient } from '../src/main/core/query/attributionResolvers.ts'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  return db
}

test('client memory is scoped — it does not leak into general memory', () => {
  const db = freshDb()
  try {
    const acme = createClient({ name: 'Acme' }, db)
    addWorkMemoryFact(db, 'You prefer dark mode.')
    addClientMemoryFact(db, acme.id, 'Acme’s repo is at github.com/acme.')

    const general = getWorkMemoryProfile(db).facts
    assert.equal(general.length, 1, 'general memory holds only the general fact')
    assert.equal(general[0].text, 'You prefer dark mode.')

    const clientFacts = getClientMemory(db, acme.id)
    assert.equal(clientFacts.length, 1)
    assert.match(clientFacts[0].text, /github\.com\/acme/)
  } finally {
    db.close()
  }
})

test('getScopedMemoryProfile returns general plus each client group', () => {
  const db = freshDb()
  try {
    const acme = createClient({ name: 'Acme' }, db)
    createClient({ name: 'Globex' }, db)
    addWorkMemoryFact(db, 'You work in Digital Operations.')
    addClientMemoryFact(db, acme.id, 'Acme’s deadline is the 30th.')

    const profile = getScopedMemoryProfile(db)
    assert.equal(profile.general.length, 1)
    assert.equal(profile.clients.length, 2)
    const acmeGroup = profile.clients.find((c) => c.clientName === 'Acme')
    assert.ok(acmeGroup)
    assert.equal(acmeGroup!.facts.length, 1)
    const globexGroup = profile.clients.find((c) => c.clientName === 'Globex')
    assert.equal(globexGroup!.facts.length, 0)
  } finally {
    db.close()
  }
})

test('scopedMemoryPromptBlock pulls a client only when the question names it', () => {
  const db = freshDb()
  try {
    const acme = createClient({ name: 'Acme' }, db)
    addClientMemoryFact(db, acme.id, 'Acme’s repo is at github.com/acme.')

    const mentioned = scopedMemoryPromptBlock(db, 'how is the Acme work going this week?')
    assert.match(mentioned, /Acme/)
    assert.match(mentioned, /github\.com\/acme/)

    const notMentioned = scopedMemoryPromptBlock(db, 'what did I do today?')
    assert.equal(notMentioned, '')
  } finally {
    db.close()
  }
})

test('chatMemoryPromptBlock = general always + scoped when the client is named', () => {
  const db = freshDb()
  try {
    const acme = createClient({ name: 'Acme' }, db)
    addWorkMemoryFact(db, 'You prefer concise answers.')
    addClientMemoryFact(db, acme.id, 'Acme is your biggest client.')

    const aboutAcme = chatMemoryPromptBlock(db, 'how much time on Acme this week?')
    assert.match(aboutAcme, /concise answers/, 'general memory is always present')
    assert.match(aboutAcme, /biggest client/, 'scoped memory present when Acme is named')

    const generic = chatMemoryPromptBlock(db, 'what did I do yesterday?')
    assert.match(generic, /concise answers/)
    assert.doesNotMatch(generic, /biggest client/, 'scoped memory stays out when Acme is not named')
  } finally {
    db.close()
  }
})

test('a client fact edits/forgets by id, leaving general memory untouched', () => {
  const db = freshDb()
  try {
    const acme = createClient({ name: 'Acme' }, db)
    addWorkMemoryFact(db, 'You live in Kigali.')
    addClientMemoryFact(db, acme.id, 'Acme uses Notion.')
    const factId = getClientMemory(db, acme.id)[0].id

    forgetWorkMemoryFact(db, factId)
    assert.equal(getClientMemory(db, acme.id).length, 0, 'client fact is gone')
    assert.equal(getWorkMemoryProfile(db).facts.length, 1, 'general memory is untouched')
  } finally {
    db.close()
  }
})

test('clientMemoryPromptBlock names the client and is empty when it has no memory', () => {
  const db = freshDb()
  try {
    const acme = createClient({ name: 'Acme' }, db)
    assert.equal(clientMemoryPromptBlock(db, acme.id, 'Acme'), '')
    addClientMemoryFact(db, acme.id, 'Acme’s lead is Jordan.')
    const block = clientMemoryPromptBlock(db, acme.id, 'Acme')
    assert.match(block, /What Daylens knows about Acme/)
    assert.match(block, /Jordan/)
  } finally {
    db.close()
  }
})
