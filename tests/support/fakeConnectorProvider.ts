// The fake provider (connectors.md §Implementation starting point): a fully
// in-memory connector that implements the adapter contract for real — cursor
// as a source version counter, complete-window pages with attested present
// ids, attendee people keyed by connector identifiers, per-day signal
// projection, health inspection, failure injection, and provider-side
// disconnect — with no network, no OAuth, no filesystem. This is the source
// the contract suite drives end to end; a real provider replaces the record
// map with API pages and inherits everything else.

import type { ConnectorId } from '../../src/shared/types.ts'
import type {
  ConnectorAdapter,
  ConnectorConnectInput,
  ConnectorConnectResult,
  ConnectorConnection,
  ConnectorHealth,
  ConnectorManifest,
  ConnectorRecordEnvelope,
  ConnectorSyncPage,
  ConnectorSyncRequest,
} from '../../src/main/connectors/contract.ts'

// The fake provider is test-only, so its id intentionally sits outside the
// shipped ConnectorId union — the double assertion is the fixture's honest
// admission that no product surface lists it.
export const FAKE_CONNECTOR_ID = 'fake_provider' as unknown as ConnectorId

export const FAKE_CONNECTOR_MANIFEST: ConnectorManifest = {
  id: FAKE_CONNECTOR_ID,
  displayName: 'Fake provider (contract suite)',
  providerKind: 'calendar',
  integration: 'direct',
  authKind: 'token',
  readOnly: true,
  scopes: [
    { scope: 'records:read', grants: 'Reads the in-memory source records. Nothing else exists to read.' },
  ],
  whatItBrings: 'Synthetic meetings and attendees that exercise every path of the connector contract.',
  sensitivity: 'standard',
  syncCadenceMs: 60 * 60 * 1000,
  lookbackDays: 90,
  rateLimit: { maxRequestsPerMinute: 60, backoffBaseMs: 1_000, backoffMaxMs: 60_000 },
  available: true,
}

export interface FakeSourceRecord {
  id: string
  title: string
  startMs: number
  endMs?: number
  attendees?: Array<{ connectorId: string; displayName: string }>
}

function localDateOf(ms: number): string {
  const at = new Date(ms)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

function clockOf(ms: number): string {
  const at = new Date(ms)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

export function normalizeFakeRecord(
  record: FakeSourceRecord,
  options: { retrievedAtMs: number; accountLabel?: string },
): ConnectorRecordEnvelope {
  return {
    provenance: {
      connectorId: FAKE_CONNECTOR_ID,
      accountLabel: options.accountLabel ?? 'fake-account',
      workspace: null,
      sourceRecordId: record.id,
      retrievedAtMs: options.retrievedAtMs,
      effectiveAtMs: record.startMs,
      sensitivity: 'standard',
      permissionScope: 'records:read',
    },
    entity: {
      kind: 'calendar_event',
      sourceEventId: `fake:${record.id}`,
      title: record.title,
      startMs: record.startMs,
      endMs: record.endMs,
      attendees: record.attendees ?? [],
    },
    daySignal: {
      date: localDateOf(record.startMs),
      title: record.title,
      startClock: clockOf(record.startMs),
      durationMinutes: record.endMs != null ? Math.round((record.endMs - record.startMs) / 60_000) : 30,
      attendeeCount: record.attendees?.length || null,
    },
  }
}

export interface FakeConnectorProvider extends ConnectorAdapter {
  /** Mutate the source: add or replace a record. Bumps the source version. */
  putRecord(record: FakeSourceRecord): void
  /** Mutate the source: a provider-side deletion. Bumps the source version. */
  deleteRecord(id: string): void
  /** The NEXT sync call throws this error, once. */
  failNextSync(error: Error): void
  /** Flip provider-side health (what inspect() reports). */
  setUnhealthy(summary: string | null): void
  /** True once disconnect() ran — provider-side cleanup happened. */
  readonly revoked: boolean
  /** How many sync calls have been made (rate accounting in tests). */
  readonly syncCalls: number
}

export function createFakeConnectorProvider(
  initialRecords: FakeSourceRecord[] = [],
): FakeConnectorProvider {
  const records = new Map<string, FakeSourceRecord>(initialRecords.map((record) => [record.id, record]))
  let sourceVersion = 1
  let pendingFailure: Error | null = null
  let unhealthy: string | null = null
  let revoked = false
  let syncCalls = 0

  return {
    manifest: FAKE_CONNECTOR_MANIFEST,

    async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
      const label = typeof input.config.accountLabel === 'string' && input.config.accountLabel.trim()
        ? input.config.accountLabel.trim()
        : 'fake-account'
      return { accountLabel: label, config: { accountLabel: label } }
    },

    async inspect(_connection: ConnectorConnection): Promise<ConnectorHealth> {
      return unhealthy
        ? { state: 'needs_attention', summary: unhealthy }
        : { state: 'ok', summary: 'The source is reachable.' }
    },

    async sync(request: ConnectorSyncRequest): Promise<ConnectorSyncPage> {
      syncCalls += 1
      if (pendingFailure) {
        const failure = pendingFailure
        pendingFailure = null
        throw failure
      }
      const nextCursor = `v${sourceVersion}`
      if (request.cursor === nextCursor) {
        return { records: [], nextCursor, unchanged: true }
      }
      const live = [...records.values()]
      return {
        records: live.map((record) => normalizeFakeRecord(record, {
          retrievedAtMs: request.nowMs,
          accountLabel: request.connection.accountLabel ?? undefined,
        })),
        nextCursor,
        // The map IS the whole source, so every live id is attested — a known
        // record missing from it is a provider deletion.
        presentSourceRecordIds: live.map((record) => record.id),
      }
    },

    async disconnect(): Promise<void> {
      revoked = true
    },

    putRecord(record: FakeSourceRecord): void {
      records.set(record.id, record)
      sourceVersion += 1
    },
    deleteRecord(id: string): void {
      if (records.delete(id)) sourceVersion += 1
    },
    failNextSync(error: Error): void {
      pendingFailure = error
    },
    setUnhealthy(summary: string | null): void {
      unhealthy = summary
    },
    get revoked() { return revoked },
    get syncCalls() { return syncCalls },
  }
}
