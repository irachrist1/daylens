// Supplied memory (memory-and-entities.md §Conversational memory, §Migration
// slices 1–2, DEV-185).
//
// The canonical store for facts the person explicitly confirmed or entered by
// hand — the ONLY memory that exists without evidence (spec §Memory record:
// "A memory cannot exist without evidence unless it is explicitly supplied and
// confirmed"). Nothing lands here silently: the chat agent PROPOSES a fact and
// this store is written only after the person confirms (or types) it; a
// declined proposal is recorded so it is not re-proposed without new evidence.
//
// Every active fact mirrors into memory_records under the SAME id
// (record_kind='supplied_fact', memory_type='supplied'), which is what makes a
// supplied fact retrievable through the shared query boundary — exact FTS,
// semantic embedding, entity-free packet assembly — with zero special-case
// query paths. The mirror is derived state: it is written in the same
// transaction as the fact, deleted with it, and reconcilable at any time from
// this table, so deletion reaches search and packets immediately and a day
// re-projection can never resurrect a forgotten fact.
//
// LOCAL-ONLY: supplied_memory_facts and memory_proposal_rejections have no
// sync-allowlist keys and can never serialize into a remote payload
// (tests/syncAllowlist.test.ts).
import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import type { SuppliedMemoryFactView, MemoryProposalRejectionView } from '@shared/types'
import { tableExists } from './database'
import { localDateString } from '../lib/localDate'

export const GENERAL_SUPPLIED_SCOPE = 'general'

export interface SuppliedMemoryFactRow {
  id: string
  statement: string
  scope: string
  source: 'chat' | 'hand' | 'migrated'
  context: string | null
  thread_id: number | null
  sensitivity: 'standard' | 'personal' | 'high'
  confirmed_at: number
  created_at: number
  updated_at: number
}

export function suppliedMemoryAvailable(db: Database.Database): boolean {
  return tableExists(db, 'supplied_memory_facts')
}

function memoryRecordsAvailable(db: Database.Database): boolean {
  return tableExists(db, 'memory_records')
}

function newFactId(): string {
  return `smf_${crypto.randomBytes(10).toString('hex')}`
}

function newRejectionId(): string {
  return `mpr_${crypto.randomBytes(10).toString('hex')}`
}

export function isSuppliedFactId(id: string): boolean {
  return id.startsWith('smf_')
}

/** Match key for duplicate/rejection lookups: case-, spacing-, and trailing
 *  punctuation-insensitive so "Fridays are focus days." re-proposed as
 *  "fridays are focus days" still hits the stored decision. */
export function normalizeStatementKey(statement: string): string {
  return statement
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?\s]+$/g, '')
    .trim()
}

// Secrets, credentials, health information, and financial account data are
// never proposed automatically (spec §Conversational memory). This guard is
// deliberately broad — a false positive only means the person adds the fact by
// hand in Settings → Memory, which stays possible.
const SENSITIVE_FACT_RE = new RegExp(
  [
    'password', 'passphrase', 'passcode', '\\bpin\\b', 'api[ _-]?key', 'secret',
    'credential', 'access token', 'auth token', 'private key', '2fa', 'one-time code',
    'credit card', 'debit card', 'card number', '\\bcvv\\b', 'bank account',
    'account number', 'routing number', '\\biban\\b', 'sort code', 'social security',
    '\\bssn\\b', 'tax id', 'passport number',
    'diagnos', 'medicat', 'prescription', 'therap', 'mental health', 'illness',
    'disease', 'disorder', '\\bhiv\\b', 'pregnan', 'blood type', 'allerg',
  ].join('|'),
  'i',
)

export function isSensitiveFactStatement(statement: string): boolean {
  return SENSITIVE_FACT_RE.test(statement)
}

// ─── The memory_records mirror ───────────────────────────────────────────────

function upsertSuppliedRecord(db: Database.Database, fact: SuppliedMemoryFactRow): void {
  if (!memoryRecordsAvailable(db)) return
  const date = localDateString(new Date(fact.confirmed_at))
  db.prepare(`
    INSERT INTO memory_records (
      id, record_kind, memory_type, statement, exact_text, semantic_text,
      date, start_ms, end_ms, app_bundle_id, app_name, title,
      primary_entity_id, source_refs_json, confidence, provenance,
      sensitivity, created_at
    ) VALUES (?, 'supplied_fact', 'supplied', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL,
      NULL, ?, 'confirmed', 'supplied', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      statement = excluded.statement,
      exact_text = excluded.exact_text,
      semantic_text = excluded.semantic_text,
      sensitivity = excluded.sensitivity,
      -- A changed statement invalidates the old embedding; clearing the stamp
      -- makes the record pending for the background embedder again.
      embedding_model = NULL,
      embedding_version = NULL,
      deleted_at = NULL
  `).run(
    fact.id,
    fact.statement,
    fact.statement,
    fact.statement,
    date,
    fact.confirmed_at,
    fact.confirmed_at,
    JSON.stringify([`supplied_fact:${fact.id}`]),
    fact.sensitivity,
    fact.created_at,
  )
  // Drop any stale vector bookkeeping so an edited statement stops matching by
  // meaning IMMEDIATELY (the vec0 join is the visibility filter), not after
  // the next re-embed. A fresh insert has no bookkeeping row — harmless no-op.
  if (tableExists(db, 'memory_record_vectors')) {
    db.prepare(`DELETE FROM memory_record_vectors WHERE record_id = ?`).run(fact.id)
  }
}

function removeSuppliedRecord(db: Database.Database, factId: string): void {
  if (!memoryRecordsAvailable(db)) return
  // FTS triggers and the entity/vector cascades clean up with the row.
  db.prepare(`DELETE FROM memory_records WHERE id = ?`).run(factId)
}

/** Ensure every active supplied fact has its retrieval mirror. Idempotent —
 *  used after migration and safe to run any time memory_records was rebuilt. */
export function reconcileSuppliedMemoryRecords(db: Database.Database): number {
  if (!suppliedMemoryAvailable(db) || !memoryRecordsAvailable(db)) return 0
  const rows = db.prepare(`
    SELECT * FROM supplied_memory_facts
    WHERE id NOT IN (SELECT id FROM memory_records WHERE record_kind = 'supplied_fact')
  `).all() as SuppliedMemoryFactRow[]
  for (const row of rows) upsertSuppliedRecord(db, row)
  return rows.length
}

// ─── The store ───────────────────────────────────────────────────────────────

export function listSuppliedFacts(
  db: Database.Database,
  options: { scope?: string } = {},
): SuppliedMemoryFactRow[] {
  if (!suppliedMemoryAvailable(db)) return []
  const scopeClause = options.scope != null ? `WHERE scope = ?` : ''
  const params = options.scope != null ? [options.scope] : []
  return db.prepare(`
    SELECT * FROM supplied_memory_facts ${scopeClause}
    ORDER BY confirmed_at DESC, id ASC
  `).all(...params) as SuppliedMemoryFactRow[]
}

export function getSuppliedFact(db: Database.Database, id: string): SuppliedMemoryFactRow | null {
  if (!suppliedMemoryAvailable(db)) return null
  return (db.prepare(`SELECT * FROM supplied_memory_facts WHERE id = ?`)
    .get(id) as SuppliedMemoryFactRow | undefined) ?? null
}

export interface ConfirmSuppliedFactInput {
  statement: string
  scope?: string
  source?: 'chat' | 'hand' | 'migrated'
  context?: string | null
  threadId?: number | null
  sensitivity?: 'standard' | 'personal' | 'high'
  /** Preserved original creation time for migrated legacy facts. */
  confirmedAt?: number
}

/** Persist one explicitly confirmed fact and its retrieval mirror, atomically.
 *  Returns null for an empty statement — never throws on user text. */
export function confirmSuppliedFact(
  db: Database.Database,
  input: ConfirmSuppliedFactInput,
): SuppliedMemoryFactRow | null {
  if (!suppliedMemoryAvailable(db)) return null
  const statement = input.statement.trim().replace(/\s+/g, ' ').slice(0, 280)
  if (!statement) return null
  const now = Date.now()
  const fact: SuppliedMemoryFactRow = {
    id: newFactId(),
    statement,
    scope: input.scope ?? GENERAL_SUPPLIED_SCOPE,
    source: input.source ?? 'chat',
    context: input.context ?? null,
    thread_id: input.threadId ?? null,
    sensitivity: input.sensitivity ?? 'standard',
    confirmed_at: input.confirmedAt ?? now,
    created_at: input.confirmedAt ?? now,
    updated_at: now,
  }
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO supplied_memory_facts (
        id, statement, scope, source, context, thread_id, sensitivity,
        confirmed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fact.id, fact.statement, fact.scope, fact.source, fact.context,
      fact.thread_id, fact.sensitivity, fact.confirmed_at, fact.created_at,
      fact.updated_at,
    )
    upsertSuppliedRecord(db, fact)
  })
  tx()
  return fact
}

export function updateSuppliedFact(
  db: Database.Database,
  id: string,
  statement: string,
  /** Where the correction came from; kept so provenance follows the last
   *  explicit confirmation (a chat correction reads "from chat"). */
  source?: 'chat' | 'hand',
): SuppliedMemoryFactRow | null {
  const existing = getSuppliedFact(db, id)
  if (!existing) return null
  const trimmed = statement.trim().replace(/\s+/g, ' ').slice(0, 280)
  if (!trimmed) return existing
  const now = Date.now()
  const nextSource = source ?? (existing.source === 'migrated' ? 'hand' : existing.source)
  const next: SuppliedMemoryFactRow = { ...existing, statement: trimmed, source: nextSource, updated_at: now }
  const tx = db.transaction(() => {
    db.prepare(`UPDATE supplied_memory_facts SET statement = ?, source = ?, updated_at = ? WHERE id = ?`)
      .run(trimmed, nextSource, now, id)
    upsertSuppliedRecord(db, next)
  })
  tx()
  return next
}

/** Forget one supplied fact: the fact and its retrieval mirror die in one
 *  transaction, so it leaves exact search, semantic search, and future context
 *  packets immediately (spec §Corrections and deletion: "Forgetting
 *  conversational memory removes the saved fact and its retrieval entries"). */
export function deleteSuppliedFact(db: Database.Database, id: string): SuppliedMemoryFactRow | null {
  const existing = getSuppliedFact(db, id)
  if (!existing) return null
  const tx = db.transaction(() => {
    removeSuppliedRecord(db, id)
    db.prepare(`DELETE FROM supplied_memory_facts WHERE id = ?`).run(id)
  })
  tx()
  return existing
}

/** Forget everything supplied (the Settings "forget everything" path). */
export function deleteAllSuppliedFacts(db: Database.Database): number {
  if (!suppliedMemoryAvailable(db)) return 0
  const tx = db.transaction(() => {
    if (memoryRecordsAvailable(db)) {
      db.prepare(`DELETE FROM memory_records WHERE record_kind = 'supplied_fact'`).run()
    }
    const result = db.prepare(`DELETE FROM supplied_memory_facts`).run()
    if (tableExists(db, 'memory_proposal_rejections')) {
      db.prepare(`DELETE FROM memory_proposal_rejections`).run()
    }
    return result.changes
  })
  return tx()
}

/** Deleting an AI thread keeps separately confirmed memory (spec
 *  §Conversational memory); only the thread reference clears — source and
 *  confirmed_at remain the record of why the fact is still here. */
export function detachSuppliedFactsFromThread(db: Database.Database, threadId: number): void {
  if (!suppliedMemoryAvailable(db)) return
  db.prepare(`UPDATE supplied_memory_facts SET thread_id = NULL, updated_at = ? WHERE thread_id = ?`)
    .run(Date.now(), threadId)
}

// ─── Rejections ──────────────────────────────────────────────────────────────

export interface MemoryProposalRejectionRow {
  id: string
  statement: string
  statement_key: string
  sensitivity: 'standard' | 'personal' | 'high'
  thread_id: number | null
  rejected_at: number
}

function rejectionsAvailable(db: Database.Database): boolean {
  return tableExists(db, 'memory_proposal_rejections')
}

export function recordMemoryProposalRejection(
  db: Database.Database,
  input: { statement: string; threadId?: number | null; sensitivity?: 'standard' | 'personal' | 'high' },
): void {
  if (!rejectionsAvailable(db)) return
  const statement = input.statement.trim().replace(/\s+/g, ' ').slice(0, 280)
  if (!statement || findMemoryProposalRejection(db, statement)) return
  db.prepare(`
    INSERT INTO memory_proposal_rejections (id, statement, statement_key, sensitivity, thread_id, rejected_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    newRejectionId(),
    statement,
    normalizeStatementKey(statement),
    input.sensitivity ?? 'standard',
    input.threadId ?? null,
    Date.now(),
  )
}

export function findMemoryProposalRejection(
  db: Database.Database,
  statement: string,
): MemoryProposalRejectionRow | null {
  if (!rejectionsAvailable(db)) return null
  const key = normalizeStatementKey(statement)
  if (!key) return null
  return (db.prepare(`SELECT * FROM memory_proposal_rejections WHERE statement_key = ? LIMIT 1`)
    .get(key) as MemoryProposalRejectionRow | undefined) ?? null
}

export function listMemoryProposalRejections(db: Database.Database): MemoryProposalRejectionRow[] {
  if (!rejectionsAvailable(db)) return []
  return db.prepare(`
    SELECT * FROM memory_proposal_rejections
    WHERE statement != ''
    ORDER BY rejected_at DESC
  `).all() as MemoryProposalRejectionRow[]
}

/** A rejection record can be deleted like any memory (spec §Conversational
 *  memory) — after which the fact may be proposed again. */
export function deleteMemoryProposalRejection(db: Database.Database, id: string): boolean {
  if (!rejectionsAvailable(db)) return false
  return db.prepare(`DELETE FROM memory_proposal_rejections WHERE id = ?`).run(id).changes > 0
}

/** The rejection's supporting evidence is the conversation it came from;
 *  deleting that thread purges the stored text (spec: "Its text is purged when
 *  the proposal's supporting evidence is deleted"). The emptied row no longer
 *  suppresses re-proposal — with the evidence gone there is nothing to match. */
export function purgeRejectionTextForThread(db: Database.Database, threadId: number): void {
  if (!rejectionsAvailable(db)) return
  db.prepare(`
    UPDATE memory_proposal_rejections
    SET statement = '', statement_key = '', thread_id = NULL
    WHERE thread_id = ?
  `).run(threadId)
}

// ─── Audit (shared memory_audit trail, memory.md §3) ─────────────────────────

export function recordSuppliedMemoryAudit(
  db: Database.Database,
  action: 'remembered' | 'updated' | 'forgot',
  text: string,
  source: 'chat' | 'hand',
  scope: string = GENERAL_SUPPLIED_SCOPE,
): void {
  if (!tableExists(db, 'memory_audit')) return
  db.prepare(`
    INSERT INTO memory_audit (id, action, fact_text, source, scope, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`mau_${crypto.randomBytes(8).toString('hex')}`, action, text.slice(0, 280), source, scope, Date.now())
}

// ─── Migration slice 1 (spec §Migration) ─────────────────────────────────────

// Machine bookkeeping row written by the memory backfill job — not a
// user-created fact, so it never migrates.
const USER_MEMORY_BOOKKEEPING_KEYS = new Set(['memory_backfilled_at'])

/**
 * Spec migration slice 1: user-created or hand-edited work_memory_facts and
 * user_memory_facts rows BECOME supplied memory, keeping their original
 * content and creation times. Evidence-drafted rows that were never confirmed
 * stay behind as inferred proposals (slice 2) — they are re-presented for
 * confirmation and never silently promoted.
 *
 * Moved work_memory_facts rows with a topic_key keep a tombstone
 * (status='deleted') so a profile rebuild cannot re-draft a topic the person
 * already turned into a supplied fact; rows without one are removed outright.
 */
export function migrateLegacyUserFactsToSupplied(db: Database.Database): number {
  if (!suppliedMemoryAvailable(db)) return 0
  let migrated = 0
  const tx = db.transaction(() => {
    if (tableExists(db, 'work_memory_facts')) {
      const columns = (db.prepare(`PRAGMA table_info(work_memory_facts)`).all() as Array<{ name: string }>)
        .map((row) => row.name)
      const sourceCol = columns.includes('source') ? 'source' : `NULL AS source`
      const scopeCol = columns.includes('scope') ? 'scope' : `'general' AS scope`
      const rows = db.prepare(`
        SELECT id, fact_text, ${sourceCol}, ${scopeCol}, topic_key, created_at
        FROM work_memory_facts
        WHERE origin = 'user' AND status = 'active'
      `).all() as Array<{
        id: string
        fact_text: string
        source: string | null
        scope: string
        topic_key: string | null
        created_at: number
      }>
      for (const row of rows) {
        const fact = confirmSuppliedFact(db, {
          statement: row.fact_text,
          scope: row.scope || GENERAL_SUPPLIED_SCOPE,
          source: row.source === 'chat' ? 'chat' : 'hand',
          context: 'Moved from your memory profile',
          confirmedAt: row.created_at,
        })
        if (!fact) continue
        migrated += 1
        if (row.topic_key) {
          db.prepare(`UPDATE work_memory_facts SET status = 'deleted', updated_at = ? WHERE id = ?`)
            .run(Date.now(), row.id)
        } else {
          db.prepare(`DELETE FROM work_memory_facts WHERE id = ?`).run(row.id)
        }
      }
    }
    if (tableExists(db, 'user_memory_facts')) {
      const rows = db.prepare(`
        SELECT id, fact_key, subject, created_at FROM user_memory_facts
      `).all() as Array<{ id: string; fact_key: string; subject: string; created_at: number }>
      for (const row of rows) {
        if (USER_MEMORY_BOOKKEEPING_KEYS.has(row.fact_key)) continue
        const statement = row.subject?.trim()
        if (!statement) continue
        const fact = confirmSuppliedFact(db, {
          statement,
          source: 'migrated',
          context: 'Moved from your memory profile',
          confirmedAt: row.created_at,
        })
        if (!fact) continue
        migrated += 1
        db.prepare(`DELETE FROM user_memory_facts WHERE id = ?`).run(row.id)
      }
    }
  })
  tx()
  return migrated
}

// ─── Views for the renderer ──────────────────────────────────────────────────

export function toSuppliedFactView(row: SuppliedMemoryFactRow): SuppliedMemoryFactView {
  return {
    id: row.id,
    statement: row.statement,
    scope: row.scope,
    source: row.source,
    context: row.context,
    threadId: row.thread_id,
    confirmedAt: row.confirmed_at,
    updatedAt: row.updated_at,
  }
}

export function toRejectionView(row: MemoryProposalRejectionRow): MemoryProposalRejectionView {
  return { id: row.id, statement: row.statement, rejectedAt: row.rejected_at }
}
