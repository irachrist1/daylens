// The agent turn state machine and its checkpoint ledger (DEV-200).
//
// ONE visible machine for everything that can hold a long-running agent turn:
// the agent-initiated waits (the clarification / file-permission / memory /
// correction cards, which all ride the askUser channel) and the user-initiated
// pause are phases of the same lifecycle, not separate mechanisms.
//
//   running ⇄ awaiting_user          (a card is up; answering resumes)
//   running | awaiting_user → paused (user hit Pause, or a restart interrupted
//                                     the turn and recovery degraded it)
//   paused → running                 (resume adopts the checkpoint)
//   any live phase → completed | cancelled | failed   (terminal; row deleted)
//
// The checkpoint row is deliberately NOT in-flight provider session state.
// Per agent-runtime-and-context.md §Sessions and interruption, provider
// session state is an execution detail that can be rebuilt from the Daylens
// thread plus a fresh context packet — so a checkpoint stores exactly what an
// honest resume needs: the question verbatim, the thread, and why the turn is
// held. Resume re-runs the question with fresh facts; it never replays a
// stale packet. Restart recovery marks interrupted turns paused(restart)
// rather than assuming they finished.

import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  AgentTurnCheckpointView,
  AgentTurnPauseKind,
  AgentTurnPhase,
  AgentTurnWaitKind,
} from '@shared/types'

// ─── The pure machine ─────────────────────────────────────────────────────────

type LivePhase = 'running' | 'awaiting_user' | 'paused'

const LIVE_TRANSITIONS: Record<LivePhase, AgentTurnPhase[]> = {
  running: ['awaiting_user', 'paused', 'completed', 'cancelled', 'failed'],
  awaiting_user: ['running', 'paused', 'completed', 'cancelled', 'failed'],
  // A paused turn only leaves through an explicit resume (→ running) or an
  // explicit discard (→ cancelled). It never completes or fails on its own.
  paused: ['running', 'cancelled'],
}

export function canTransitionTurnPhase(from: AgentTurnPhase, to: AgentTurnPhase): boolean {
  if (from === to) return false
  if (from === 'completed' || from === 'cancelled' || from === 'failed') return false
  return LIVE_TRANSITIONS[from].includes(to)
}

// ─── Checkpoint persistence ───────────────────────────────────────────────────

interface CheckpointRow {
  id: string
  thread_id: number | null
  client_request_id: string | null
  question: string
  phase: LivePhase
  pause_kind: AgentTurnPauseKind | null
  wait_kind: AgentTurnWaitKind | null
  last_status: string | null
  created_at: number
  updated_at: number
}

function toView(row: CheckpointRow): AgentTurnCheckpointView {
  return {
    id: row.id,
    threadId: row.thread_id,
    question: row.question,
    phase: row.phase,
    pauseKind: row.pause_kind,
    waitKind: row.wait_kind,
    lastStatus: row.last_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function agentTurnCheckpointsAvailable(db: Database.Database): boolean {
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_turn_checkpoints'")
      .get()
    return Boolean(row)
  } catch {
    return false
  }
}

function getRow(db: Database.Database, id: string): CheckpointRow | null {
  return (db.prepare('SELECT * FROM agent_turn_checkpoints WHERE id = ?').get(id) as CheckpointRow | undefined) ?? null
}

/** Open a checkpoint for a turn that is starting to run. */
export function openTurnCheckpoint(
  db: Database.Database,
  params: { threadId: number | null; clientRequestId: string | null; question: string; now?: number },
): AgentTurnCheckpointView {
  const now = params.now ?? Date.now()
  const id = `atc_${randomUUID()}`
  db.prepare(`
    INSERT INTO agent_turn_checkpoints (id, thread_id, client_request_id, question, phase, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'running', ?, ?)
  `).run(id, params.threadId, params.clientRequestId, params.question, now, now)
  return toView(getRow(db, id)!)
}

/**
 * Adopt a paused checkpoint for a resuming turn: paused → running under the
 * new request id. Returns null when the checkpoint is gone or not resumable —
 * the caller then runs the turn as a fresh send instead of failing it.
 */
export function adoptTurnCheckpointForResume(
  db: Database.Database,
  checkpointId: string,
  params: { clientRequestId: string | null; now?: number },
): AgentTurnCheckpointView | null {
  const row = getRow(db, checkpointId)
  if (!row || !canTransitionTurnPhase(row.phase, 'running')) return null
  db.prepare(`
    UPDATE agent_turn_checkpoints
    SET phase = 'running', pause_kind = NULL, wait_kind = NULL, client_request_id = ?, updated_at = ?
    WHERE id = ?
  `).run(params.clientRequestId, params.now ?? Date.now(), checkpointId)
  return toView(getRow(db, checkpointId)!)
}

/** running → awaiting_user: an agent-initiated card is holding the turn. */
export function markTurnWaiting(
  db: Database.Database,
  id: string,
  waitKind: AgentTurnWaitKind,
  now = Date.now(),
): boolean {
  const row = getRow(db, id)
  if (!row || !canTransitionTurnPhase(row.phase, 'awaiting_user')) return false
  db.prepare("UPDATE agent_turn_checkpoints SET phase = 'awaiting_user', wait_kind = ?, updated_at = ? WHERE id = ?")
    .run(waitKind, now, id)
  return true
}

/** awaiting_user → running: the card was answered. */
export function markTurnRunning(db: Database.Database, id: string, now = Date.now()): boolean {
  const row = getRow(db, id)
  if (!row || !canTransitionTurnPhase(row.phase, 'running')) return false
  db.prepare("UPDATE agent_turn_checkpoints SET phase = 'running', wait_kind = NULL, updated_at = ? WHERE id = ?")
    .run(now, id)
  return true
}

/** running | awaiting_user → paused. The wait kind is kept for honest display
 *  ("paused while waiting for a file permission"). */
export function markTurnPaused(
  db: Database.Database,
  id: string,
  pauseKind: AgentTurnPauseKind,
  now = Date.now(),
): AgentTurnCheckpointView | null {
  const row = getRow(db, id)
  if (!row || !canTransitionTurnPhase(row.phase, 'paused')) return null
  db.prepare("UPDATE agent_turn_checkpoints SET phase = 'paused', pause_kind = ?, client_request_id = NULL, updated_at = ? WHERE id = ?")
    .run(pauseKind, now, id)
  return toView(getRow(db, id)!)
}

/** Record the last human-readable tool status line, for honest paused display. */
export function recordTurnStatus(db: Database.Database, id: string, status: string, now = Date.now()): void {
  db.prepare('UPDATE agent_turn_checkpoints SET last_status = ?, updated_at = ? WHERE id = ?')
    .run(status.slice(0, 200), now, id)
}

/** Terminal settle (completed / cancelled / failed): the checkpoint is deleted
 *  — the transcript owns finished turns, the ledger only holds outstanding
 *  work. Discarding a paused turn goes through here too (→ cancelled). */
export function closeTurnCheckpoint(db: Database.Database, id: string): boolean {
  return db.prepare('DELETE FROM agent_turn_checkpoints WHERE id = ?').run(id).changes > 0
}

export function getTurnCheckpoint(db: Database.Database, id: string): AgentTurnCheckpointView | null {
  const row = getRow(db, id)
  return row ? toView(row) : null
}

/** Paused turns, newest first — for a thread, or across all threads. */
export function listPausedTurns(db: Database.Database, threadId?: number | null): AgentTurnCheckpointView[] {
  if (!agentTurnCheckpointsAvailable(db)) return []
  const rows = threadId != null
    ? db.prepare("SELECT * FROM agent_turn_checkpoints WHERE phase = 'paused' AND thread_id = ? ORDER BY created_at ASC").all(threadId)
    : db.prepare("SELECT * FROM agent_turn_checkpoints WHERE phase = 'paused' ORDER BY created_at ASC").all()
  return (rows as CheckpointRow[]).map(toView)
}

/**
 * Restart recovery: any checkpoint still marked running/awaiting_user belongs
 * to a process that no longer exists. Its in-flight promise is gone, so the
 * honest state is paused(restart) — a clean resumable checkpoint, never an
 * assumed success. Returns how many rows were recovered.
 */
export function recoverInterruptedTurns(db: Database.Database, now = Date.now()): number {
  if (!agentTurnCheckpointsAvailable(db)) return 0
  return db.prepare(`
    UPDATE agent_turn_checkpoints
    SET phase = 'paused', pause_kind = 'restart', client_request_id = NULL, updated_at = ?
    WHERE phase IN ('running', 'awaiting_user')
  `).run(now).changes
}

// ─── Active-turn registry ─────────────────────────────────────────────────────
// Maps a live clientRequestId to its checkpoint id so the pause path (which
// only knows the request id) can settle the right row.

const activeTurnCheckpoints = new Map<string, string>()

export function registerActiveTurnCheckpoint(clientRequestId: string, checkpointId: string): void {
  activeTurnCheckpoints.set(clientRequestId, checkpointId)
}

export function lookupActiveTurnCheckpoint(clientRequestId: string | null): string | null {
  if (!clientRequestId) return null
  return activeTurnCheckpoints.get(clientRequestId) ?? null
}

export function unregisterActiveTurnCheckpoint(clientRequestId: string | null): void {
  if (clientRequestId) activeTurnCheckpoints.delete(clientRequestId)
}
