// Agent turn pause/resume (DEV-200): the ONE state machine and its persisted
// checkpoint ledger. Exercised against the real migrated schema (migration
// v65) so the table the tests prove is the table production writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { clearTestDb, setTestDb } from './support/database-stub.mjs'
import { deleteThread } from '../src/main/services/artifacts.ts'
import {
  adoptTurnCheckpointForResume,
  agentTurnCheckpointsAvailable,
  canTransitionTurnPhase,
  closeTurnCheckpoint,
  getTurnCheckpoint,
  listPausedTurns,
  lookupActiveTurnCheckpoint,
  markTurnPaused,
  markTurnRunning,
  markTurnWaiting,
  openTurnCheckpoint,
  recordTurnStatus,
  recoverInterruptedTurns,
  registerActiveTurnCheckpoint,
  unregisterActiveTurnCheckpoint,
} from '../src/main/services/agentTurnState.ts'

// ─── The pure machine ─────────────────────────────────────────────────────────

test('legal transitions: waits and pause are phases of one machine', () => {
  assert.ok(canTransitionTurnPhase('running', 'awaiting_user'))
  assert.ok(canTransitionTurnPhase('awaiting_user', 'running'))
  assert.ok(canTransitionTurnPhase('running', 'paused'))
  assert.ok(canTransitionTurnPhase('awaiting_user', 'paused'))
  assert.ok(canTransitionTurnPhase('paused', 'running'))
  assert.ok(canTransitionTurnPhase('paused', 'cancelled'))
  for (const from of ['running', 'awaiting_user'] as const) {
    for (const terminal of ['completed', 'cancelled', 'failed'] as const) {
      assert.ok(canTransitionTurnPhase(from, terminal), `${from} → ${terminal}`)
    }
  }
})

test('illegal transitions are rejected: paused never completes or fails on its own', () => {
  assert.equal(canTransitionTurnPhase('paused', 'completed'), false)
  assert.equal(canTransitionTurnPhase('paused', 'failed'), false)
  assert.equal(canTransitionTurnPhase('paused', 'awaiting_user'), false)
  for (const terminal of ['completed', 'cancelled', 'failed'] as const) {
    assert.equal(canTransitionTurnPhase(terminal, 'running'), false, `${terminal} is terminal`)
  }
  assert.equal(canTransitionTurnPhase('running', 'running'), false)
})

// ─── Persistence ──────────────────────────────────────────────────────────────

test('migration v65 creates the checkpoint table', () => {
  const db = createProductionTestDatabase()
  try {
    assert.ok(agentTurnCheckpointsAvailable(db))
  } finally {
    db.close()
  }
})

test('pause persists a resumable checkpoint; cancel-style close deletes it', () => {
  const db = createProductionTestDatabase()
  try {
    const opened = openTurnCheckpoint(db, { threadId: 7, clientRequestId: 'req-1', question: 'How did my day go?' })
    assert.equal(opened.phase, 'running')

    recordTurnStatus(db, opened.id, 'Searching your timeline')
    const paused = markTurnPaused(db, opened.id, 'user')
    assert.ok(paused)
    assert.equal(paused!.phase, 'paused')
    assert.equal(paused!.pauseKind, 'user')
    assert.equal(paused!.lastStatus, 'Searching your timeline')
    assert.equal(paused!.question, 'How did my day go?')

    const listed = listPausedTurns(db, 7)
    assert.equal(listed.length, 1)
    assert.equal(listed[0].id, opened.id)

    // Discard (→ cancelled, terminal): the row leaves the ledger entirely.
    assert.ok(closeTurnCheckpoint(db, opened.id))
    assert.equal(getTurnCheckpoint(db, opened.id), null)
    assert.equal(listPausedTurns(db, 7).length, 0)
  } finally {
    db.close()
  }
})

test('agent-initiated waits ride the same checkpoint (running ⇄ awaiting_user)', () => {
  const db = createProductionTestDatabase()
  try {
    const opened = openTurnCheckpoint(db, { threadId: null, clientRequestId: 'req-2', question: 'Open that report?' })
    assert.ok(markTurnWaiting(db, opened.id, 'file_permission'))
    let current = getTurnCheckpoint(db, opened.id)!
    assert.equal(current.phase, 'awaiting_user')
    assert.equal(current.waitKind, 'file_permission')

    // Pausing WHILE a card is up keeps the wait kind for honest display.
    const paused = markTurnPaused(db, opened.id, 'user')
    assert.equal(paused!.waitKind, 'file_permission')

    // Back through resume: the wait clears.
    const resumed = adoptTurnCheckpointForResume(db, opened.id, { clientRequestId: 'req-3' })
    assert.ok(resumed)
    assert.equal(resumed!.phase, 'running')
    assert.equal(resumed!.waitKind, null)
    assert.equal(resumed!.pauseKind, null)

    assert.ok(markTurnWaiting(db, opened.id, 'memory_confirmation'))
    assert.ok(markTurnRunning(db, opened.id))
    current = getTurnCheckpoint(db, opened.id)!
    assert.equal(current.phase, 'running')
    assert.equal(current.waitKind, null)
  } finally {
    db.close()
  }
})

test('a running checkpoint cannot be adopted for resume; a missing one returns null', () => {
  const db = createProductionTestDatabase()
  try {
    const opened = openTurnCheckpoint(db, { threadId: 1, clientRequestId: 'req-4', question: 'q' })
    assert.equal(adoptTurnCheckpointForResume(db, opened.id, { clientRequestId: 'req-5' }), null)
    assert.equal(adoptTurnCheckpointForResume(db, 'atc_missing', { clientRequestId: 'req-5' }), null)
  } finally {
    db.close()
  }
})

// ─── Restart recovery ─────────────────────────────────────────────────────────

test('restart recovery degrades interrupted turns to paused(restart), never assumes success', () => {
  const db = createProductionTestDatabase()
  try {
    const running = openTurnCheckpoint(db, { threadId: 1, clientRequestId: 'req-a', question: 'a' })
    const waiting = openTurnCheckpoint(db, { threadId: 1, clientRequestId: 'req-b', question: 'b' })
    markTurnWaiting(db, waiting.id, 'clarification')
    const alreadyPaused = openTurnCheckpoint(db, { threadId: 2, clientRequestId: 'req-c', question: 'c' })
    markTurnPaused(db, alreadyPaused.id, 'user')

    assert.equal(recoverInterruptedTurns(db), 2)

    const recoveredRunning = getTurnCheckpoint(db, running.id)!
    assert.equal(recoveredRunning.phase, 'paused')
    assert.equal(recoveredRunning.pauseKind, 'restart')
    const recoveredWaiting = getTurnCheckpoint(db, waiting.id)!
    assert.equal(recoveredWaiting.phase, 'paused')
    assert.equal(recoveredWaiting.pauseKind, 'restart')
    // A turn the user paused keeps its own pause kind.
    assert.equal(getTurnCheckpoint(db, alreadyPaused.id)!.pauseKind, 'user')

    // All three are now offered for resume.
    assert.equal(listPausedTurns(db).length, 3)
  } finally {
    db.close()
  }
})

test('deleting a thread deletes its paused checkpoints — the question text goes with the conversation', async () => {
  const db = createProductionTestDatabase()
  setTestDb(db)
  try {
    const now = Date.now()
    db.prepare(`
      INSERT INTO ai_threads (id, title, created_at, updated_at, last_message_at, archived, metadata_json)
      VALUES (1, 'Doomed chat', ?, ?, ?, 0, '{}')
    `).run(now, now, now)
    const doomed = openTurnCheckpoint(db, { threadId: 1, clientRequestId: 'req-d', question: 'secret question' })
    markTurnPaused(db, doomed.id, 'user')
    const survivor = openTurnCheckpoint(db, { threadId: 2, clientRequestId: 'req-s', question: 'other thread' })
    markTurnPaused(db, survivor.id, 'user')

    await deleteThread(1)

    assert.equal(getTurnCheckpoint(db, doomed.id), null)
    assert.ok(getTurnCheckpoint(db, survivor.id))
  } finally {
    clearTestDb()
    db.close()
  }
})

// ─── Active-turn registry ─────────────────────────────────────────────────────

test('the request→checkpoint registry maps and clears exactly', () => {
  registerActiveTurnCheckpoint('req-x', 'atc-1')
  try {
    assert.equal(lookupActiveTurnCheckpoint('req-x'), 'atc-1')
    assert.equal(lookupActiveTurnCheckpoint('req-unknown'), null)
    assert.equal(lookupActiveTurnCheckpoint(null), null)
  } finally {
    unregisterActiveTurnCheckpoint('req-x')
  }
  assert.equal(lookupActiveTurnCheckpoint('req-x'), null)
})
