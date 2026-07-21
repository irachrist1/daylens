// The Granola connector (DEV-193) — the meetings provider on the connector
// foundation. Granola keeps meeting notes locally on the Mac and offers no
// public per-account API, so this is a LOCAL connector: it reads Granola's
// own cache file and nothing else. No network, no OAuth, no credential —
// nothing this connector touches ever leaves the machine. It implements the
// same ConnectorAdapter contract every network provider proves, and passes
// the same conformance suite:
//
//   connect     → resolves and validates the cache file (the standard
//                 location by default; an explicit path wins). The persisted
//                 config is { cachePath } — a path, never a secret
//   sync        → reads the whole cache each time (it is one local file):
//                 quiet when nothing changed (an updatedAt watermark plus a
//                 content fingerprint on the cursor), otherwise a COMPLETE
//                 attested view — so a note deleted inside Granola tombstones
//                 locally, with its day-layer notes and unsupported entities
//                 removed
//   inspect     → is the cache still present and readable?
//   disconnect  → nothing to revoke; there is no credential
//
// The filesystem is injectable, so the entire adapter is provable against
// fixture cache files.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
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
import { parseGranolaCache, type GranolaCacheContent } from './cache'
import { GRANOLA_CONNECTOR_ID, normalizeGranolaNote } from './normalize'

const HOUR = 60 * 60 * 1000

// Matches the registry's manifest-only entry word for word — the consistency
// test (tests/granolaConnector.test.ts) keeps the two from drifting — with
// `available` flipped: a working adapter ships in this build.
export const GRANOLA_MANIFEST: ConnectorManifest = {
  id: GRANOLA_CONNECTOR_ID,
  displayName: 'Granola',
  providerKind: 'meetings',
  integration: 'local',
  authKind: 'local_file',
  readOnly: true,
  scopes: [
    { scope: 'file:read', grants: 'Reads Granola\'s local notes cache on this Mac — meeting identity, participants, and your own note lines, minimized. Never transcripts, never audio, and nothing leaves this machine.' },
  ],
  whatItBrings:
    'What happened IN your meetings — participants, notes, and action items from Granola — attached to the meetings your calendar and day already know about.',
  sensitivity: 'personal',
  syncCadenceMs: 2 * HOUR,
  lookbackDays: 90,
  rateLimit: { maxRequestsPerMinute: 30, backoffBaseMs: 10_000, backoffMaxMs: HOUR },
  available: true,
}

export const GRANOLA_DEFAULT_CACHE_RELATIVE = path.join('Library', 'Application Support', 'Granola', 'cache-v3.json')

interface GranolaCursor {
  v: 1
  /** Newest note update the last committed page saw. */
  updatedSince: number
  /** Fingerprint of the live note ids, so a DELETION inside Granola (which
   *  moves no updatedAt forward) still reads as a change. */
  idsHash: string
}

function parseCursor(cursor: string): GranolaCursor | null {
  try {
    const parsed = JSON.parse(cursor) as GranolaCursor
    return parsed?.v === 1 && typeof parsed.updatedSince === 'number' && typeof parsed.idsHash === 'string'
      ? parsed
      : null
  } catch {
    return null
  }
}

function idsHashOf(content: GranolaCacheContent): string {
  const hash = createHash('sha256')
  for (const id of content.docs.map((doc) => doc.id).sort()) hash.update(`${id}\n`)
  return hash.digest('hex').slice(0, 16)
}

function maxUpdatedOf(content: GranolaCacheContent): number {
  let max = 0
  for (const doc of content.docs) {
    if (doc.updatedAtMs > max) max = doc.updatedAtMs
  }
  return max
}

export interface GranolaAdapterDeps {
  /** Filesystem entry point — a test injects fixture files here. */
  readFileImpl?: (filePath: string) => Promise<string>
  homeDir?: string
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function createGranolaAdapter(deps: GranolaAdapterDeps = {}): ConnectorAdapter {
  const readFileImpl = deps.readFileImpl ?? (async (filePath: string) => readFile(filePath, 'utf8'))
  const home = deps.homeDir ?? homedir()

  function defaultCachePath(): string {
    return path.join(home, GRANOLA_DEFAULT_CACHE_RELATIVE)
  }

  function cachePathOf(connection: ConnectorConnection): string {
    return trimmed(connection.config.cachePath) ?? defaultCachePath()
  }

  async function readCache(cachePath: string): Promise<GranolaCacheContent> {
    let raw: string
    try {
      raw = await readFileImpl(cachePath)
    } catch {
      throw new Error(
        'Granola\'s local cache was not found or could not be read. Is Granola installed and signed in on this Mac?',
      )
    }
    return parseGranolaCache(raw)
  }

  return {
    manifest: GRANOLA_MANIFEST,

    async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
      const cachePath = trimmed(input.config.cachePath) ?? defaultCachePath()
      const content = await readCache(cachePath)
      return {
        accountLabel: content.accountLabel ?? 'Granola on this Mac',
        config: { cachePath },
      }
    },

    async sync(request: ConnectorSyncRequest): Promise<ConnectorSyncPage> {
      const cachePath = cachePathOf(request.connection)
      const content = await readCache(cachePath)
      const cursor = request.cursor ? parseCursor(request.cursor) : null

      const idsHash = idsHashOf(content)
      const maxUpdated = maxUpdatedOf(content)
      if (cursor && maxUpdated <= cursor.updatedSince && idsHash === cursor.idsHash) {
        // Nothing new and nothing removed: a quiet page. presentSourceRecordIds
        // is deliberately OMITTED — an empty attested view would tombstone
        // everything.
        return { records: [], nextCursor: request.cursor, unchanged: true }
      }

      const windowFloorMs = request.nowMs - GRANOLA_MANIFEST.lookbackDays * 24 * HOUR
      const context = { retrievedAtMs: request.nowMs, accountLabel: trimmed(request.connection.accountLabel) }
      const records: ConnectorRecordEnvelope[] = []
      const presentSourceRecordIds: string[] = []
      for (const doc of content.docs) {
        // EVERY live note id is attested present — including notes older than
        // the ingest window — so aging out of the window never reads as a
        // provider deletion. Only ids missing from the cache tombstone.
        presentSourceRecordIds.push(`note:${doc.id}`)
        const effectiveAtMs = doc.startMs ?? doc.createdAtMs ?? doc.updatedAtMs
        if (effectiveAtMs < windowFloorMs) continue
        const record = normalizeGranolaNote(doc, context)
        if (record) records.push(record)
      }

      const nextCursor: GranolaCursor = {
        v: 1,
        updatedSince: Math.max(maxUpdated, cursor?.updatedSince ?? 0),
        idsHash,
      }
      return {
        records,
        nextCursor: JSON.stringify(nextCursor),
        presentSourceRecordIds,
      }
    },

    async inspect(connection: ConnectorConnection): Promise<ConnectorHealth> {
      try {
        await readCache(cachePathOf(connection))
        return { state: 'ok', summary: 'Granola\'s local cache is readable. Notes sync on the regular schedule.' }
      } catch {
        return {
          state: 'needs_attention',
          summary: 'Granola\'s local cache is missing or unreadable. Is Granola still installed and signed in on this Mac?',
        }
      }
    },

    async disconnect(_connection: ConnectorConnection): Promise<void> {
      // A local file read has nothing to revoke and stores no credential.
    },
  }
}

/** Startup wiring: register the working adapter so Settings → Connections
 *  gains the connect/sync/disconnect lifecycle for Granola. */
export function registerGranolaConnector(): void {
  registerConnectorAdapter(createGranolaAdapter())
}
