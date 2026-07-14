// DEV-108: clients are memory with a scope (memory.md §2.2). General memory is
// always in the prompt; a client is a named scope (`client:<id>`) pulled in only
// when the question is about that client. Scoped facts never leak into general
// memory, and editing/forgetting works by id like general memory.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
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
  applyMemoryWriteOps,
  findClientScopeForWrite,
  clientScope,
} from '../src/main/services/workMemoryProfile.ts'
import { buildMemoryProposal, commitAction, undoAction } from '../src/main/ai/actions.ts'
import { createClient } from '../src/main/core/query/attributionResolvers.ts'
import { deriveClientAliasTokens } from '../src/main/lib/clientAliases.ts'

function freshDb(): Database.Database {
  return createProductionTestDatabase()
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

// DEV-108 deferred piece (now shipped): telling Daylens about a client in chat
// writes to that client's scope, not general memory.

test('findClientScopeForWrite resolves a single named client and stays general otherwise', () => {
  const db = freshDb()
  try {
    const acme = createClient({ name: 'Acme' }, db)
    createClient({ name: 'Globex' }, db)

    const one = findClientScopeForWrite(db, "remember Acme's deadline is the 30th")
    assert.ok(one)
    assert.equal(one!.clientId, acme.id)
    assert.equal(one!.clientName, 'Acme')

    // No client named → general.
    assert.equal(findClientScopeForWrite(db, 'remember I prefer dark mode'), null)
    // Two clients named → ambiguous, stay general rather than guess.
    assert.equal(findClientScopeForWrite(db, 'remember Acme and Globex are both behind'), null)
  } finally {
    db.close()
  }
})

test('applyMemoryWriteOps writes an add into the client scope, not general', () => {
  const db = freshDb()
  try {
    const acme = createClient({ name: 'Acme' }, db)
    applyMemoryWriteOps(db, [{ action: 'add', text: 'Acme’s repo is at github.com/acme.' }], 'chat', clientScope(acme.id))

    assert.equal(getWorkMemoryProfile(db).facts.length, 0, 'general memory stays empty')
    const clientFacts = getClientMemory(db, acme.id)
    assert.equal(clientFacts.length, 1)
    assert.match(clientFacts[0].text, /github\.com\/acme/)
    assert.equal(clientFacts[0].source, 'chat')
  } finally {
    db.close()
  }
})

test('deriveClientAliasTokens makes a multi-word client answer to its short name', () => {
  assert.deepEqual(deriveClientAliasTokens('Andersen in Rwanda').sort(), ['andersen', 'rwanda'])
  assert.deepEqual(deriveClientAliasTokens('Acme Corp'), ['acme'])           // corp suffix dropped
  assert.deepEqual(deriveClientAliasTokens('Acme'), [])                       // single word — full alias covers it
  assert.deepEqual(deriveClientAliasTokens('The Globex Group'), ['globex'])  // stopwords dropped
})

test('a bare short name resolves a multi-word client for both read and write', () => {
  const db = freshDb()
  try {
    const acme = createClient({ name: 'Andersen in Rwanda' }, db)
    addClientMemoryFact(db, acme.id, 'Andersen in Rwanda’s deadline is the 30th.')

    // Write: "remember Andersen's …" resolves the scope without the full name.
    const match = findClientScopeForWrite(db, "remember Andersen's lead is Jordan")
    assert.ok(match, 'bare "Andersen" should resolve the client for a write')
    assert.equal(match!.clientId, acme.id)

    // Read: a question naming just "Andersen" pulls the scoped memory.
    const block = scopedMemoryPromptBlock(db, 'how is the Andersen work going?')
    assert.match(block, /deadline is the 30th/)
  } finally {
    db.close()
  }
})

test('chat memory action commits a client-scoped fact and undo removes it from that scope', () => {
  const db = freshDb()
  try {
    const acme = createClient({ name: 'Acme' }, db)
    // Mirrors maybeHandleMemoryInstruction: detect scope, build the scoped proposal.
    const match = findClientScopeForWrite(db, "remember Acme's deadline is the 30th")
    assert.ok(match)
    const proposal = buildMemoryProposal(
      [{ action: 'add', text: 'Acme’s deadline is the 30th.' }],
      getClientMemory(db, match!.clientId).map((f) => ({ id: f.id, text: f.text })),
      { scopeId: clientScope(match!.clientId), scopeName: match!.clientName },
    )
    assert.ok(proposal)
    assert.equal(proposal!.scopeId, clientScope(acme.id))
    assert.equal(proposal!.ops[0].scope, 'Acme', 'preview card labels the scope with the client name')

    // Nothing written until commit (preview-first).
    assert.equal(getClientMemory(db, acme.id).length, 0)

    const result = commitAction(db, proposal!)
    assert.equal(result.ok, true)
    assert.equal(getClientMemory(db, acme.id).length, 1, 'fact landed in Acme scope')
    assert.equal(getWorkMemoryProfile(db).facts.length, 0, 'general memory untouched')

    assert.ok(result.undo, 'a single scoped add offers undo')
    undoAction(db, result.undo!)
    assert.equal(getClientMemory(db, acme.id).length, 0, 'undo removed the scoped fact')
  } finally {
    db.close()
  }
})
