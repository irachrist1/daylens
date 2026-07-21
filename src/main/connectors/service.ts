// Connector lifecycle orchestration (DEV-186): connect, sync, disconnect, and
// the Settings listing. This module composes the pieces — registry (which
// adapters exist), store (persisted connections + records), ingest (the gated
// write path), purge (deletion), credentials (OS secure store) — and is the
// only thing IPC handlers and the background schedule call.
//
// Nothing here ever returns a credential, cursor, config path, or raw provider
// error to a caller: `listConnectorListings` is the single renderer-facing
// projection and carries only the fields in shared ConnectorListing.

import type Database from 'better-sqlite3'
import type { ConnectorId, ConnectorListing, ConnectorSyncSummary } from '@shared/types'
import { getDb } from '../services/database'
import {
  appendDeletionJournalEntry,
} from '../services/deletionJournal'
import { computeBackoffMs, type ConnectorAdapter, type ConnectorConnection } from './contract'
import { getConnectorAdapter, getConnectorManifest, listConnectorManifests } from './registry'
import {
  getConnectorConnection,
  listConnectorConnections,
  recordConnectorSyncFailure,
  saveConnectorConnection,
  markConnectorDisconnected,
  type ConnectorConnectionRow,
} from './store'
import {
  connectorGateState,
  defaultConnectorGate,
  ingestConnectorPage,
  type ConnectorIngestGate,
} from './ingest'
import { purgeConnectorDerivedData } from './purge'
import { clearConnectorSecret, type ConnectorSecretStore } from './credentials'

function toContractConnection(row: ConnectorConnectionRow): ConnectorConnection {
  let config: Record<string, unknown> = {}
  try { config = JSON.parse(row.config_json) as Record<string, unknown> } catch { /* empty config */ }
  return {
    connectorId: row.connector_id,
    status: row.status,
    accountLabel: row.account_label,
    config,
    cursor: row.sync_cursor,
  }
}

// ─── Listing (the ONLY renderer-facing projection) ───────────────────────────

export function listConnectorListings(db: Database.Database): ConnectorListing[] {
  const connections = new Map(listConnectorConnections(db).map((row) => [row.connector_id, row]))
  return listConnectorManifests().map((manifest) => {
    const connection = connections.get(manifest.id)
    const connected = connection != null && connection.status !== 'disconnected'
    return {
      id: manifest.id,
      displayName: manifest.displayName,
      providerKind: manifest.providerKind,
      integration: manifest.integration,
      authKind: manifest.authKind,
      whatItBrings: manifest.whatItBrings,
      scopes: manifest.scopes.map((scope) => ({ ...scope })),
      lookbackDays: manifest.lookbackDays,
      available: manifest.available,
      authState: connected ? connection.status : 'disconnected',
      accountLabel: connected ? connection.account_label : null,
      connectedAt: connected ? connection.connected_at : null,
      lastSyncAt: connected ? connection.last_sync_at : null,
      lastSyncError: connected ? connection.last_sync_error : null,
      nextRetryAt: connected ? connection.next_retry_at : null,
      itemsIngested: connected ? connection.items_ingested : 0,
    }
  })
}

// ─── Connect ─────────────────────────────────────────────────────────────────

export type { ConnectorSyncSummary }

/** Phases a connect reports while it runs, so Settings can show honest
 *  progress: the authorization hand-off, then the bounded initial import. */
export type ConnectorConnectPhase = 'authorizing' | 'syncing'

export async function connectConnector(
  db: Database.Database,
  connectorId: ConnectorId,
  config: Record<string, unknown>,
  options: {
    adapter?: ConnectorAdapter
    gate?: ConnectorIngestGate
    nowMs?: number
    /** Called as the connect advances phases (never with any credential).
     *  `notice` carries plain-language authorization guidance from the
     *  adapter — a device flow's "enter this code" prompt — when it has one. */
    onProgress?: (phase: ConnectorConnectPhase, notice?: string) => void
  } = {},
): Promise<ConnectorSyncSummary> {
  const gate = options.gate ?? defaultConnectorGate()
  const gateState = connectorGateState(gate)
  if (gateState !== 'open') {
    throw new Error(gateState === 'blocked_consent'
      ? 'Connected sources need current capture consent before anything syncs.'
      : 'Connected sources are turned off in Settings → Connections.')
  }
  const adapter = options.adapter ?? getConnectorAdapter(connectorId)
  if (!adapter) {
    const manifest = getConnectorManifest(connectorId)
    throw new Error(manifest
      ? `${manifest.displayName} is not available to connect yet.`
      : `Unknown connector: ${connectorId}`)
  }
  options.onProgress?.('authorizing')
  const result = await adapter.connect({
    config,
    onNotice: (notice) => options.onProgress?.('authorizing', notice),
  })
  saveConnectorConnection(db, {
    connectorId,
    accountLabel: result.accountLabel,
    config: result.config,
    nowMs: options.nowMs,
  })
  // First sync immediately — connecting should visibly bring data or say why
  // not. The bounded initial lookback runs here, so the phase is reported.
  options.onProgress?.('syncing')
  return syncConnector(db, connectorId, options)
}

// ─── Sync ────────────────────────────────────────────────────────────────────

export async function syncConnector(
  db: Database.Database,
  connectorId: ConnectorId,
  options: { adapter?: ConnectorAdapter; gate?: ConnectorIngestGate; nowMs?: number } = {},
): Promise<ConnectorSyncSummary> {
  const gate = options.gate ?? defaultConnectorGate()
  const gateState = connectorGateState(gate)
  if (gateState !== 'open') {
    return { status: gateState, ingested: 0, quarantined: 0, tombstoned: 0 }
  }
  const row = getConnectorConnection(db, connectorId)
  if (!row || row.status === 'disconnected') {
    return { status: 'not_connected', ingested: 0, quarantined: 0, tombstoned: 0 }
  }
  const adapter = options.adapter ?? getConnectorAdapter(connectorId)
  if (!adapter) return { status: 'not_connected', ingested: 0, quarantined: 0, tombstoned: 0 }
  const nowMs = options.nowMs ?? Date.now()

  try {
    const page = await adapter.sync({
      connection: toContractConnection(row),
      cursor: row.sync_cursor,
      nowMs,
    })
    const result = ingestConnectorPage(db, connectorId, page, { gate, nowMs })
    return {
      status: result.status,
      ingested: result.ingested,
      quarantined: result.quarantined,
      tombstoned: result.tombstoned,
    }
  } catch (error) {
    const failures = row.consecutive_failures + 1
    // "Rate limits … respect provider reset information": an adapter attaches
    // the provider's retry-after hint to the thrown error and the bounded
    // backoff honors it (computeBackoffMs still caps it at backoffMaxMs).
    const providerResetMs = typeof (error as { retryAfterMs?: unknown } | null)?.retryAfterMs === 'number'
      ? (error as { retryAfterMs: number }).retryAfterMs
      : null
    const retryDelay = computeBackoffMs(adapter.manifest.rateLimit, failures, providerResetMs)
    const summary = error instanceof Error ? error.message : 'Sync failed.'
    // An authorization-shaped failure (expired/revoked/missing token) flags
    // needs_attention IMMEDIATELY — retrying cannot fix it, only the
    // reauthorize affordance in Settings can.
    const needsAttention = failures >= 3
      || (error as { needsAttention?: unknown } | null)?.needsAttention === true
    recordConnectorSyncFailure(db, connectorId, {
      errorSummary: summary,
      nextRetryAt: nowMs + retryDelay,
      needsAttention,
      nowMs,
    })
    return { status: 'failed', ingested: 0, quarantined: 0, tombstoned: 0, error: summary }
  }
}

// ─── Disconnect ──────────────────────────────────────────────────────────────

export interface DisconnectOptions {
  /** true = also delete every locally derived record/entity/day-signal this
   *  connector produced (journaled so a backup restore replays the purge);
   *  false = keep imported evidence, stop syncing, forget credentials. */
  deleteData: boolean
  /** For the deletion journal; omitted in tests without a userData dir. */
  userDataPath?: string | null
  secretStore?: ConnectorSecretStore | null
  adapter?: ConnectorAdapter
  nowMs?: number
}

export async function disconnectConnector(
  db: Database.Database,
  connectorId: ConnectorId,
  options: DisconnectOptions,
): Promise<void> {
  const nowMs = options.nowMs ?? Date.now()
  const row = getConnectorConnection(db, connectorId)
  const adapter = options.adapter ?? getConnectorAdapter(connectorId)

  // 1. Provider-side cleanup — best-effort, never blocks the local disconnect.
  if (row && adapter) {
    try { await adapter.disconnect(toContractConnection(row)) } catch { /* local disconnect proceeds */ }
  }
  // 2. Credentials go first: no new sync can start once the token is gone.
  await clearConnectorSecret(connectorId, options.secretStore ?? null)
  // 3. Local data: the person's explicit keep-or-delete choice.
  if (options.deleteData) {
    purgeConnectorDerivedData(db, connectorId, nowMs)
    if (options.userDataPath) {
      appendDeletionJournalEntry(options.userDataPath, {
        kind: 'connector-purge',
        params: { connectorId },
      }, nowMs)
    }
  } else {
    markConnectorDisconnected(db, connectorId, nowMs)
  }
}

// ─── Background cadence ──────────────────────────────────────────────────────

let scheduled: ReturnType<typeof setInterval> | null = null

const SCHEDULE_TICK_MS = 15 * 60 * 1000

export async function runDueConnectorSyncs(
  db: Database.Database,
  options: { gate?: ConnectorIngestGate; nowMs?: number } = {},
): Promise<ConnectorId[]> {
  const gate = options.gate ?? defaultConnectorGate()
  if (connectorGateState(gate) !== 'open') return []
  const nowMs = options.nowMs ?? Date.now()
  const synced: ConnectorId[] = []
  for (const row of listConnectorConnections(db)) {
    if (row.status === 'disconnected') continue
    const manifest = getConnectorManifest(row.connector_id)
    if (!manifest?.available) continue
    if (row.next_retry_at != null && nowMs < row.next_retry_at) continue
    if (row.last_sync_at != null && nowMs - row.last_sync_at < manifest.syncCadenceMs) continue
    const result = await syncConnector(db, row.connector_id, { gate, nowMs })
    if (result.status === 'ok') synced.push(row.connector_id)
  }
  return synced
}

export function startConnectorSyncSchedule(): void {
  if (scheduled) return
  scheduled = setInterval(() => {
    void runDueConnectorSyncs(getDb()).catch(() => { /* best-effort background sync */ })
  }, SCHEDULE_TICK_MS)
}

export function stopConnectorSyncSchedule(): void {
  if (scheduled) { clearInterval(scheduled); scheduled = null }
}
