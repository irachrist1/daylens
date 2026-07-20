// Persistence for the connector foundation (DEV-186): connection rows and the
// normalized-record ledger. Pure better-sqlite3 — no Electron — so the whole
// lifecycle is exercisable by the hermetic test suite.
//
// Two invariants live here:
//   1. config_json is credential-free by contract (tokens go through
//      ./credentials.ts into the OS secure store). A config value that looks
//      like a credential is rejected at write time, belt-and-suspenders.
//   2. sync_cursor only advances inside the same transaction that stored the
//      page's evidence — callers use `ingestConnectorPage` (./ingest.ts),
//      never a bare cursor write after the fact.

import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ConnectorAuthState, ConnectorId } from '@shared/types'
import { containsCredential } from '@shared/credentialPatterns'
import type { ConnectorRecordEnvelope } from './contract'

export interface ConnectorConnectionRow {
  connector_id: ConnectorId
  status: ConnectorAuthState
  account_label: string | null
  config_json: string
  sync_cursor: string | null
  connected_at: number
  last_sync_at: number | null
  last_sync_error: string | null
  consecutive_failures: number
  next_retry_at: number | null
  items_ingested: number
  updated_at: number
}

export interface ConnectorRecordRow {
  id: string
  connector_id: ConnectorId
  source_record_id: string
  kind: string
  entity_id: string | null
  date: string | null
  effective_at: number | null
  retrieved_at: number
  sensitivity: 'standard' | 'personal' | 'high'
  permission_scope: string
  envelope_json: string
  tombstoned_at: number | null
  created_at: number
  updated_at: number
}

// An absolute filesystem path is legitimate connector config (the .ics file
// the person picked) and may legitimately contain long high-entropy segments
// (UUID-named folders), so path-shaped values are exempt from the credential
// scan. Everything else — account ids, labels, workspace names — is scanned.
function isPathShaped(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
}

function assertCredentialFreeConfig(config: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && !isPathShaped(value) && containsCredential(value)) {
      throw new Error(
        `Connector config field "${key}" looks like a credential. Tokens are stored in the OS secure store, never in the database.`,
      )
    }
  }
}

// ─── Connections ─────────────────────────────────────────────────────────────

export function getConnectorConnection(
  db: Database.Database,
  connectorId: ConnectorId,
): ConnectorConnectionRow | null {
  const row = db.prepare(`SELECT * FROM connector_connections WHERE connector_id = ?`)
    .get(connectorId) as ConnectorConnectionRow | undefined
  return row ?? null
}

export function listConnectorConnections(db: Database.Database): ConnectorConnectionRow[] {
  return db.prepare(`SELECT * FROM connector_connections`).all() as ConnectorConnectionRow[]
}

export function saveConnectorConnection(
  db: Database.Database,
  input: {
    connectorId: ConnectorId
    accountLabel: string | null
    config: Record<string, unknown>
    nowMs?: number
  },
): ConnectorConnectionRow {
  assertCredentialFreeConfig(input.config)
  const now = input.nowMs ?? Date.now()
  db.prepare(`
    INSERT INTO connector_connections (
      connector_id, status, account_label, config_json, sync_cursor,
      connected_at, last_sync_at, last_sync_error, consecutive_failures,
      next_retry_at, items_ingested, updated_at
    ) VALUES (?, 'connected', ?, ?, NULL, ?, NULL, NULL, 0, NULL, 0, ?)
    ON CONFLICT(connector_id) DO UPDATE SET
      status = 'connected',
      account_label = excluded.account_label,
      config_json = excluded.config_json,
      sync_cursor = NULL,
      connected_at = excluded.connected_at,
      last_sync_at = NULL,
      last_sync_error = NULL,
      consecutive_failures = 0,
      next_retry_at = NULL,
      items_ingested = 0,
      updated_at = excluded.updated_at
  `).run(input.connectorId, input.accountLabel, JSON.stringify(input.config), now, now)
  return getConnectorConnection(db, input.connectorId)!
}

export function markConnectorDisconnected(
  db: Database.Database,
  connectorId: ConnectorId,
  nowMs = Date.now(),
): void {
  db.prepare(`
    UPDATE connector_connections
    SET status = 'disconnected', sync_cursor = NULL, last_sync_error = NULL,
        consecutive_failures = 0, next_retry_at = NULL, updated_at = ?
    WHERE connector_id = ?
  `).run(nowMs, connectorId)
}

/** A successful sync: cursor + bookkeeping. Called INSIDE the ingest
 *  transaction so evidence and cursor commit or roll back together. */
export function commitConnectorSync(
  db: Database.Database,
  connectorId: ConnectorId,
  input: { cursor: string | null; ingested: number; nowMs?: number },
): void {
  const now = input.nowMs ?? Date.now()
  db.prepare(`
    UPDATE connector_connections
    SET sync_cursor = ?, last_sync_at = ?, last_sync_error = NULL,
        consecutive_failures = 0, next_retry_at = NULL,
        items_ingested = items_ingested + ?, updated_at = ?,
        status = CASE WHEN status = 'needs_attention' THEN 'connected' ELSE status END
    WHERE connector_id = ?
  `).run(input.cursor, now, input.ingested, now, connectorId)
}

/** A failed sync: record a SANITIZED summary (never a provider body that could
 *  carry secrets), bump the failure count, and schedule the bounded retry. The
 *  cursor is untouched — a failed page never advances it. */
export function recordConnectorSyncFailure(
  db: Database.Database,
  connectorId: ConnectorId,
  input: { errorSummary: string; nextRetryAt: number | null; needsAttention?: boolean; nowMs?: number },
): void {
  const now = input.nowMs ?? Date.now()
  const summary = containsCredential(input.errorSummary)
    ? 'Sync failed (details withheld: the provider error contained credential-shaped content).'
    : input.errorSummary.slice(0, 300)
  db.prepare(`
    UPDATE connector_connections
    SET last_sync_error = ?, consecutive_failures = consecutive_failures + 1,
        next_retry_at = ?, updated_at = ?,
        status = CASE WHEN ? THEN 'needs_attention' ELSE status END
    WHERE connector_id = ?
  `).run(summary, input.nextRetryAt, now, input.needsAttention ? 1 : 0, connectorId)
}

// ─── Records ─────────────────────────────────────────────────────────────────

export function getConnectorRecord(
  db: Database.Database,
  connectorId: ConnectorId,
  sourceRecordId: string,
): ConnectorRecordRow | null {
  const row = db.prepare(`
    SELECT * FROM connector_records WHERE connector_id = ? AND source_record_id = ?
  `).get(connectorId, sourceRecordId) as ConnectorRecordRow | undefined
  return row ?? null
}

export function listConnectorRecords(
  db: Database.Database,
  connectorId: ConnectorId,
  options: { includeTombstoned?: boolean } = {},
): ConnectorRecordRow[] {
  return db.prepare(`
    SELECT * FROM connector_records
    WHERE connector_id = ? ${options.includeTombstoned ? '' : 'AND tombstoned_at IS NULL'}
    ORDER BY created_at ASC
  `).all(connectorId) as ConnectorRecordRow[]
}

/** Insert-or-refresh by (connector, source record id) — duplicate source
 *  records are idempotent; a re-ingested tombstoned record revives. */
export function upsertConnectorRecord(
  db: Database.Database,
  record: ConnectorRecordEnvelope,
  entityId: string | null,
  date: string | null,
  nowMs = Date.now(),
): ConnectorRecordRow {
  const { provenance } = record
  db.prepare(`
    INSERT INTO connector_records (
      id, connector_id, source_record_id, kind, entity_id, date, effective_at,
      retrieved_at, sensitivity, permission_scope, envelope_json, tombstoned_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(connector_id, source_record_id) DO UPDATE SET
      kind = excluded.kind,
      entity_id = excluded.entity_id,
      date = excluded.date,
      effective_at = excluded.effective_at,
      retrieved_at = excluded.retrieved_at,
      sensitivity = excluded.sensitivity,
      permission_scope = excluded.permission_scope,
      envelope_json = excluded.envelope_json,
      tombstoned_at = NULL,
      updated_at = excluded.updated_at
  `).run(
    `cnr_${randomUUID().replace(/-/g, '').slice(0, 18)}`,
    provenance.connectorId,
    provenance.sourceRecordId,
    record.entity.kind,
    entityId,
    date,
    provenance.effectiveAtMs,
    provenance.retrievedAtMs,
    provenance.sensitivity,
    provenance.permissionScope,
    JSON.stringify(record),
    nowMs,
    nowMs,
  )
  return getConnectorRecord(db, provenance.connectorId, provenance.sourceRecordId)!
}

export function tombstoneConnectorRecord(
  db: Database.Database,
  connectorId: ConnectorId,
  sourceRecordId: string,
  nowMs = Date.now(),
): void {
  db.prepare(`
    UPDATE connector_records SET tombstoned_at = ?, updated_at = ?
    WHERE connector_id = ? AND source_record_id = ? AND tombstoned_at IS NULL
  `).run(nowMs, nowMs, connectorId, sourceRecordId)
}

export function deleteConnectorRecords(db: Database.Database, connectorId: ConnectorId): number {
  return db.prepare(`DELETE FROM connector_records WHERE connector_id = ?`).run(connectorId).changes
}
