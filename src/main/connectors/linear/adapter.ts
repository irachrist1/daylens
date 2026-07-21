// The Linear connector (DEV-192) — the issues provider on the connector
// foundation. It implements the same ConnectorAdapter contract every other
// provider proves, and passes the same conformance suite:
//
//   connect     → a personal API key (Linear's standard individual
//                 authorization; created read-only at linear.app/settings/api).
//                 The key goes straight into the OS secure store; the
//                 persisted connection config carries only the credential-free
//                 viewer id and workspace label
//   sync        → an updatedAt watermark on the contract's cursor: a bounded
//                 full lookback window first (attested complete), then
//                 incremental reads of issues updated past the watermark.
//                 Archived and trashed issues arrive as explicit deletions;
//                 the watermark only advances when data arrived, and a thrown
//                 page never advances the cursor (the ingest transaction owns
//                 that)
//   inspect     → credential-free health from the stored-key state
//   disconnect  → clears the vault entry; the person revokes the key itself
//                 at linear.app/settings/api (the Settings card says so)
//
// Everything with a network shape is injectable, so the entire adapter is
// provable against an in-memory Linear.

import { registerConnectorAdapter } from '../registry'
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
} from '../contract'
import {
  clearConnectorSecret,
  getConnectorSecret,
  setConnectorSecret,
  type ConnectorSecretStore,
} from '../credentials'
import { getViewer, listMyIssues, type LinearIssueNode } from './api'
import {
  LINEAR_CONNECTOR_ID,
  isRemovedLinearIssue,
  normalizeLinearIssue,
  type LinearNormalizeContext,
} from './normalize'

const HOUR = 60 * 60 * 1000

// Matches the registry's manifest-only entry word for word — the consistency
// test (tests/linearConnector.test.ts) keeps the two from drifting — with
// `available` flipped: a working adapter ships in this build.
export const LINEAR_MANIFEST: ConnectorManifest = {
  id: LINEAR_CONNECTOR_ID,
  displayName: 'Linear',
  providerKind: 'issues',
  integration: 'direct',
  authKind: 'token',
  readOnly: true,
  scopes: [
    { scope: 'read', grants: 'Reads workspaces, teams, projects, cycles, and the issues you created or are assigned — titles, states, and times. Read-only: Daylens never creates, edits, or comments.' },
  ],
  whatItBrings:
    'The issues and projects your work maps to — status changes, cycles, and relationships — so time spent connects to the tickets it moved.',
  sensitivity: 'standard',
  syncCadenceMs: 2 * HOUR,
  lookbackDays: 90,
  rateLimit: { maxRequestsPerMinute: 30, backoffBaseMs: 10_000, backoffMaxMs: HOUR },
  available: true,
}

/** Bounds per sync. Hitting one means the window is read partially SHORT of
 *  history, never past it — nothing extra tombstones. */
const MAX_ISSUE_PAGES = 10
const PAGE_SIZE = 50

interface LinearCursor {
  v: 1
  /** RFC3339 lower bound the next read uses. Advances only when data arrived. */
  updatedSince: string
}

function parseCursor(cursor: string): LinearCursor | null {
  try {
    const parsed = JSON.parse(cursor) as LinearCursor
    return parsed?.v === 1 && typeof parsed.updatedSince === 'string' ? parsed : null
  } catch {
    return null
  }
}

export interface LinearAdapterDeps {
  /** Network entry point — a test injects an in-memory Linear here. */
  fetchImpl?: typeof fetch
  /** Credential vault override for hermetic tests. */
  secretStore?: ConnectorSecretStore | null
  /** GraphQL endpoint override for hermetic tests. */
  endpoint?: string
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function createLinearAdapter(deps: LinearAdapterDeps = {}): ConnectorAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch
  const secretStore = deps.secretStore ?? null
  const endpoint = deps.endpoint

  function asReauthorizationError(error: Error): Error {
    Object.assign(error, { needsAttention: true })
    return error
  }

  async function storedApiKey(): Promise<string> {
    const key = await getConnectorSecret(LINEAR_CONNECTOR_ID, secretStore)
    if (!key) {
      throw asReauthorizationError(new Error('The Linear API key is missing from the secure store. Reconnect to resume syncing.'))
    }
    return key
  }

  function viewerIdOf(connection: ConnectorConnection): string {
    const viewerId = trimmed(connection.config.viewerId)
    if (!viewerId) {
      throw asReauthorizationError(new Error('The Linear connection is missing its account identity. Reconnect to resume syncing.'))
    }
    return viewerId
  }

  function normalizeContext(connection: ConnectorConnection, nowMs: number): LinearNormalizeContext {
    return {
      retrievedAtMs: nowMs,
      viewerId: viewerIdOf(connection),
      accountLabel: trimmed(connection.accountLabel),
      workspace: trimmed(connection.config.workspace),
    }
  }

  /** Every page of "my issues updated after `sinceIso`", bounded. */
  async function collectIssues(
    apiKey: string,
    viewerId: string,
    sinceIso: string,
  ): Promise<LinearIssueNode[]> {
    const nodes: LinearIssueNode[] = []
    let after: string | null = null
    for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
      const result = await listMyIssues(fetchImpl, {
        apiKey,
        viewerId,
        updatedAfterIso: sinceIso,
        first: PAGE_SIZE,
        after,
        endpoint,
      })
      nodes.push(...result.nodes)
      if (!result.pageInfo.hasNextPage || !result.pageInfo.endCursor) break
      after = result.pageInfo.endCursor
    }
    return nodes
  }

  function maxUpdatedMs(nodes: LinearIssueNode[]): number | null {
    let max: number | null = null
    for (const node of nodes) {
      if (!node.updatedAt) continue
      const ms = Date.parse(node.updatedAt)
      if (Number.isFinite(ms) && (max == null || ms > max)) max = ms
    }
    return max
  }

  /** Advance the watermark past the newest update seen, or keep it. */
  function advancedSince(previous: string, seenMaxMs: number | null): string {
    if (seenMaxMs == null) return previous
    const next = new Date(seenMaxMs + 1000)
    return Date.parse(previous) >= next.getTime() ? previous : next.toISOString()
  }

  return {
    manifest: LINEAR_MANIFEST,

    async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
      const apiKey = trimmed(input.config.apiKey)
      if (!apiKey) {
        throw new Error(
          'Linear needs a personal API key. Create one at linear.app/settings/api with read access only, then paste it here.',
        )
      }
      // Validate the key BEFORE storing anything: a bad key fails the connect
      // with a plain message instead of a connection that can never sync.
      const viewer = await getViewer(fetchImpl, { apiKey, endpoint })
      const viewerId = trimmed(viewer.id)
      if (!viewerId) throw new Error('Linear did not identify the connected account.')
      const viewerName = trimmed(viewer.displayName) ?? trimmed(viewer.name) ?? trimmed(viewer.email) ?? 'Linear account'
      const workspace = trimmed(viewer.organization?.urlKey) ?? trimmed(viewer.organization?.name)

      await setConnectorSecret(LINEAR_CONNECTOR_ID, apiKey, secretStore)

      // The persisted config is credential-free BY CONSTRUCTION: the key
      // lives only in the vault; config carries account identity and labels.
      return {
        accountLabel: workspace ? `${viewerName} · ${workspace}` : viewerName,
        config: { viewerId, workspace },
      }
    },

    async sync(request: ConnectorSyncRequest): Promise<ConnectorSyncPage> {
      const apiKey = await storedApiKey()
      const viewerId = viewerIdOf(request.connection)
      const context = normalizeContext(request.connection, request.nowMs)
      const cursor = request.cursor ? parseCursor(request.cursor) : null

      const windowFloorIso = new Date(request.nowMs - LINEAR_MANIFEST.lookbackDays * 24 * HOUR).toISOString()
      const sinceIso = cursor?.updatedSince ?? windowFloorIso
      const nodes = await collectIssues(apiKey, viewerId, sinceIso)

      const records: ConnectorRecordEnvelope[] = []
      const deletedSourceRecordIds: string[] = []
      for (const node of nodes) {
        if (!node.id) continue
        if (isRemovedLinearIssue(node)) {
          deletedSourceRecordIds.push(`issue:${node.id}`)
          continue
        }
        const record = normalizeLinearIssue(node, context)
        if (record) records.push(record)
      }

      const nextCursor: LinearCursor = { v: 1, updatedSince: advancedSince(sinceIso, maxUpdatedMs(nodes)) }

      if (!cursor) {
        // The initial window is a complete view of what this connection
        // scopes to (the person's issues updated over the bounded lookback):
        // every kept record id is attested, so a known record missing from a
        // later full window tombstones.
        return {
          records,
          nextCursor: JSON.stringify(nextCursor),
          presentSourceRecordIds: records.map((record) => record.provenance.sourceRecordId),
        }
      }
      return {
        records,
        nextCursor: JSON.stringify(nextCursor),
        deletedSourceRecordIds: deletedSourceRecordIds.length > 0 ? deletedSourceRecordIds : undefined,
        unchanged: records.length === 0 && deletedSourceRecordIds.length === 0 ? true : undefined,
      }
    },

    async inspect(_connection: ConnectorConnection): Promise<ConnectorHealth> {
      const key = await getConnectorSecret(LINEAR_CONNECTOR_ID, secretStore)
      if (!key) {
        return {
          state: 'needs_attention',
          summary: 'No Linear API key is stored on this machine. Reconnect to resume syncing.',
        }
      }
      return { state: 'ok', summary: 'Authorized. Issue activity syncs on the regular schedule.' }
    },

    async disconnect(_connection: ConnectorConnection): Promise<void> {
      // A personal API key has no remote revocation endpoint; the person
      // deletes the key itself at linear.app/settings/api. Locally the
      // credential is deleted — no further sync can ever run.
      await clearConnectorSecret(LINEAR_CONNECTOR_ID, secretStore)
    },
  }
}

/** Startup wiring: register the working adapter so Settings → Connections
 *  gains the connect/sync/disconnect lifecycle for Linear. */
export function registerLinearConnector(): void {
  registerConnectorAdapter(createLinearAdapter())
}
