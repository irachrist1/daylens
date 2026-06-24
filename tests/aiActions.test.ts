// DEV-109: AI action widgets. The chat can ACT — but only ever proposes a
// change first (preview), and commits through the same manual-edit pipeline on
// confirm. These tests cover the proposal mapping and the commit/undo round-trip
// for memory (the block path is exercised by the running-app verification).
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { buildMemoryProposal, commitAction, undoAction, looksLikeMergeBlocksInstruction } from '../src/main/ai/actions.ts'
import { looksLikeRenameBlockInstruction } from '../src/main/ai/actions.ts'
import { getWorkMemoryProfile } from '../src/main/services/workMemoryProfile.ts'

test('buildMemoryProposal maps an add op to a non-destructive save preview', () => {
  const proposal = buildMemoryProposal([{ action: 'add', text: 'Acme is your biggest client.' }], [])
  assert.ok(proposal)
  assert.equal(proposal.kind, 'memory_write')
  assert.equal(proposal.surface, 'card')
  assert.equal(proposal.destructive ?? false, false)
  assert.equal(proposal.confirmLabel, 'Save to memory')
  assert.equal(proposal.ops.length, 1)
  assert.deepEqual(
    { op: proposal.ops[0].op, text: proposal.ops[0].text, previousText: proposal.ops[0].previousText },
    { op: 'add', text: 'Acme is your biggest client.', previousText: null },
  )
})

test('buildMemoryProposal maps an update op with the prior text for the diff', () => {
  const proposal = buildMemoryProposal(
    [{ action: 'update', targetId: 'a', text: 'You work in Digital Operations.' }],
    [{ id: 'a', text: 'You work in engineering.' }],
  )
  assert.ok(proposal)
  assert.equal(proposal.ops[0].op, 'update')
  assert.equal(proposal.ops[0].previousText, 'You work in engineering.')
  assert.equal(proposal.ops[0].text, 'You work in Digital Operations.')
})

test('buildMemoryProposal marks a delete as destructive and shows the affected fact', () => {
  const proposal = buildMemoryProposal(
    [{ action: 'delete', targetId: 'a' }],
    [{ id: 'a', text: 'You use Notion daily.' }],
  )
  assert.ok(proposal)
  assert.equal(proposal.destructive, true)
  assert.equal(proposal.confirmLabel, 'Update memory')
  assert.equal(proposal.ops[0].op, 'delete')
  assert.equal(proposal.ops[0].text, 'You use Notion daily.')
})

test('buildMemoryProposal returns null when there is nothing durable to change', () => {
  assert.equal(buildMemoryProposal([], []), null)
})

test('rename detector flags "rename … to …" shapes, not unrelated questions', () => {
  assert.equal(looksLikeRenameBlockInstruction('rename my afternoon block to networking'), true)
  assert.equal(looksLikeRenameBlockInstruction('relabel this as deep work'), true)
  // Permissive on purpose — the builder gates on a resolvable target/label, so a
  // false positive here just falls through to the normal answer path.
  assert.equal(looksLikeRenameBlockInstruction('how was my afternoon?'), false)
  assert.equal(looksLikeRenameBlockInstruction('how much time on Cursor'), false)
})

test('merge detector flags merge instructions, not arbitrary text', () => {
  assert.equal(looksLikeMergeBlocksInstruction('merge my last two blocks'), true)
  assert.equal(looksLikeMergeBlocksInstruction('merge this block with the previous one'), true)
  assert.equal(looksLikeMergeBlocksInstruction('merge the 2pm and 3pm blocks'), true)
  assert.equal(looksLikeMergeBlocksInstruction('what did I merge yesterday'), false)
  assert.equal(looksLikeMergeBlocksInstruction('how much time on Cursor'), false)
})

test('committing a memory proposal writes the fact and offers an undo that removes it', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  try {
    const proposal = buildMemoryProposal([{ action: 'add', text: 'Acme is your biggest client.' }], [])
    assert.ok(proposal)

    // Nothing is written until commit.
    assert.equal(getWorkMemoryProfile(db).facts.length, 0)

    const result = commitAction(db, proposal)
    assert.equal(result.ok, true)
    assert.match(result.summary, /remember/i)
    const facts = getWorkMemoryProfile(db).facts
    assert.equal(facts.length, 1)
    assert.equal(facts[0].text, 'Acme is your biggest client.')
    assert.equal(facts[0].source, 'chat')

    // The undo token removes exactly that fact.
    assert.ok(result.undo)
    const undone = undoAction(db, result.undo)
    assert.equal(undone.ok, true)
    assert.equal(getWorkMemoryProfile(db).facts.length, 0)
  } finally {
    db.close()
  }
})
