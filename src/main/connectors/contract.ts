// The connector contract (connectors.md §Connector contract, DEV-186).
//
// Every external source — Google Calendar, Outlook, GitHub, Linear, Granola,
// and the local reference connectors — implements this one interface, and
// every implementation must pass the shared conformance suite in
// tests/support/connectorContractSuite.ts before it ships. The contract is
// deliberately free of Electron, SQLite, and network imports: an adapter's
// job ends at producing normalized, typed record envelopes; consent gating,
// entity writes, evidence storage, and deletion are owned by the ingestion
// path (./ingest.ts) so no adapter can bypass them.
//
// V2 connectors are READ-ONLY by construction: the interface has no write
// operation to implement, and the manifest's `readOnly: true` literal is
// checked by validateConnectorManifest.

import type { ConnectorAuthState, ConnectorId } from '@shared/types'
import { containsCredential, findCredentialPattern } from '@shared/credentialPatterns'
import { CAPTURE_POLICY_VERSION } from '@shared/captureConsent'
import type { ConnectedEnvelope } from '../services/entities/entityAdoption'
import type {
  ConnectedSourceEvidenceKind,
  EvidenceEnvelope,
} from '../core/evidence/envelope'

// ─── Manifest ────────────────────────────────────────────────────────────────

export interface ConnectorScope {
  /** The exact scope string requested from the provider (or the local
   *  permission it stands for, e.g. "file:read"). */
  scope: string
  /** Plain-language meaning shown BEFORE authorization begins. */
  grants: string
}

export interface ConnectorRateLimitPolicy {
  /** Upper bound the sync loop may issue against the provider. */
  maxRequestsPerMinute: number
  /** Bounded exponential backoff for failures and rate limits. */
  backoffBaseMs: number
  backoffMaxMs: number
}

export interface ConnectorManifest {
  id: ConnectorId
  displayName: string
  providerKind: 'calendar' | 'code' | 'issues' | 'meetings'
  /** direct = Daylens-owned adapter; brokered = via an identified
   *  intermediary; local = reads a local file/store, no account. */
  integration: 'direct' | 'brokered' | 'local'
  authKind: 'oauth' | 'token' | 'local_file'
  /** V2 invariant — the type only admits `true`. */
  readOnly: true
  /** Exact requested scopes; empty is invalid (a connector must say what it reads). */
  scopes: ConnectorScope[]
  /** "What information this connection adds", shown before connecting. */
  whatItBrings: string
  /** Default sensitivity of the records this source produces. */
  sensitivity: 'standard' | 'personal' | 'high'
  /** How often a connected source re-syncs in the background. */
  syncCadenceMs: number
  /** Bounded initial-sync lookback (connectors.md §Synchronization). */
  lookbackDays: number
  rateLimit: ConnectorRateLimitPolicy
  /** True when a working adapter ships in this build. Manifest-only entries
   *  (the upcoming wave) are listed in Settings but cannot connect. */
  available: boolean
}

// ─── Connection & sync ───────────────────────────────────────────────────────

/** The persisted connection state an adapter receives on every call. Config is
 *  adapter-specific but must never contain credentials — tokens live in the OS
 *  secure store only (./credentials.ts). */
export interface ConnectorConnection {
  connectorId: ConnectorId
  status: ConnectorAuthState
  accountLabel: string | null
  config: Record<string, unknown>
  cursor: string | null
}

export interface ConnectorSyncRequest {
  connection: ConnectorConnection
  /** null on initial sync; otherwise the last committed cursor. */
  cursor: string | null
  nowMs: number
}

/** Provenance carried by every normalized record (connectors.md: "Every
 *  normalized record retains provider, account, workspace, source record
 *  identifier, retrieved time, effective time, sensitivity, and permission
 *  scope"). */
export interface ConnectorProvenance {
  connectorId: ConnectorId
  accountLabel: string | null
  workspace: string | null
  /** Opaque source-native record identity — idempotency key. */
  sourceRecordId: string
  retrievedAtMs: number
  /** When the record is ABOUT (event start, commit time); null when unknown. */
  effectiveAtMs: number | null
  sensitivity: 'standard' | 'personal' | 'high'
  permissionScope: string
}

/** Optional per-day calendar projection so a record also lands in the
 *  external_signals day layer that briefs/wraps/enrichment already read. */
export interface ConnectorDaySignalEvent {
  date: string
  title: string
  startClock: string
  durationMinutes: number
  attendeeCount: number | null
}

/** Optional per-day git projection so repository activity also lands in the
 *  external_signals 'git' day layer that briefs/wraps/enrichment already read.
 *  A record carries at most ONE contribution: a commit line or a PR entry. */
export interface ConnectorGitDaySignal {
  date: string
  /** Repository short name — never a path or a URL. */
  repo: string
  /** Commit subject line + local clock, merged into the repo's day entry. */
  commit?: { message: string; clock: string }
  /** Pull-request entry, merged by (title, repo). */
  pr?: { title: string; state: string }
}

/** One normalized record: provenance + the connected-source entity envelope
 *  the entity repository already accepts (the shape batch 7's fixtures use). */
export interface ConnectorRecordEnvelope {
  provenance: ConnectorProvenance
  entity: ConnectedEnvelope
  daySignal?: ConnectorDaySignalEvent
  gitSignal?: ConnectorGitDaySignal
}

export interface ConnectorSyncPage {
  records: ConnectorRecordEnvelope[]
  /** Committed together with the page's evidence, in one transaction. */
  nextCursor: string | null
  /** True when the source is fully read and nothing changed since `cursor`. */
  unchanged?: boolean
  /** When the page is a COMPLETE view of the source window, every
   *  source_record_id currently present. Ingest tombstones known records that
   *  are missing from it (provider deletions → local tombstones). Omit for
   *  partial/incremental pages — omission never tombstones. */
  presentSourceRecordIds?: string[]
  /** Explicit provider deletions on an INCREMENTAL page (e.g. Google
   *  Calendar's `status: "cancelled"` items under syncToken semantics).
   *  Ingest tombstones each id it knows; unknown ids are ignored. */
  deletedSourceRecordIds?: string[]
}

// ─── Adapter interface ───────────────────────────────────────────────────────

export interface ConnectorConnectInput {
  /** Adapter-specific, credential-free connect configuration
   *  (e.g. { filePath } for the .ics connector). OAuth flows exchange and
   *  store their token via ./credentials.ts and keep config clean. */
  config: Record<string, unknown>
  /** Plain-language, credential-free authorization guidance for the person
   *  ("Enter code ABCD-1234 at github.com/login/device"). Device-style flows
   *  MUST surface their user code through this — it is the only channel that
   *  reaches Settings while connect() is still running. */
  onNotice?: (notice: string) => void
}

export interface ConnectorConnectResult {
  accountLabel: string
  config: Record<string, unknown>
}

/** Connection health as an adapter can cheaply observe it (connectors.md:
 *  `inspectConnection`). Plain-language summary only — never a provider body
 *  that could carry secrets. */
export interface ConnectorHealth {
  state: 'ok' | 'needs_attention'
  summary: string
}

export interface ConnectorAdapter {
  manifest: ConnectorManifest
  /** Validate the connect input and produce the persisted connection state.
   *  Must throw a plain-language Error when the input cannot work. */
  connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult>
  /** Cheap health probe: is the source still reachable/authorized? Optional —
   *  connections without it report health from sync bookkeeping alone. */
  inspect?(connection: ConnectorConnection): Promise<ConnectorHealth>
  /** Read one page of records since `cursor`. Never writes anything. */
  sync(request: ConnectorSyncRequest): Promise<ConnectorSyncPage>
  /** Provider-side cleanup on disconnect (revoke token, close broker
   *  connection). Local data removal is owned by the ingestion layer. */
  disconnect(connection: ConnectorConnection): Promise<void>
}

// ─── Validation ──────────────────────────────────────────────────────────────

export function validateConnectorManifest(manifest: ConnectorManifest): string[] {
  const problems: string[] = []
  if (!manifest.id) problems.push('manifest.id is required')
  if (!manifest.displayName?.trim()) problems.push('manifest.displayName is required')
  if (manifest.readOnly !== true) problems.push('V2 connectors must be read-only')
  if (!Array.isArray(manifest.scopes) || manifest.scopes.length === 0) {
    problems.push('manifest.scopes must name at least one exact read scope')
  } else {
    for (const scope of manifest.scopes) {
      if (!scope.scope?.trim()) problems.push('every scope needs its exact scope string')
      if (!scope.grants?.trim()) problems.push(`scope "${scope.scope}" needs plain-language copy`)
      if (/write|delete|admin/i.test(scope.scope)) {
        problems.push(`scope "${scope.scope}" is not read-only`)
      }
    }
  }
  if (!manifest.whatItBrings?.trim()) problems.push('manifest.whatItBrings copy is required')
  if (!(manifest.syncCadenceMs > 0)) problems.push('syncCadenceMs must be positive')
  if (!(manifest.lookbackDays > 0)) problems.push('lookbackDays must be positive and bounded')
  if (manifest.lookbackDays > 730) problems.push('lookbackDays must stay bounded (≤ 730)')
  const rate = manifest.rateLimit ?? { maxRequestsPerMinute: 0, backoffBaseMs: 0, backoffMaxMs: 0 }
  if (!(rate.maxRequestsPerMinute > 0)) problems.push('rateLimit.maxRequestsPerMinute must be positive')
  if (!(rate.backoffBaseMs > 0)) problems.push('rateLimit.backoffBaseMs must be positive')
  if (!(rate.backoffMaxMs >= rate.backoffBaseMs)) problems.push('rateLimit.backoffMaxMs must be ≥ backoffBaseMs')
  return problems
}

// Opaque source-identity fields are exempt from the credential scan: provider
// record ids are legitimately long and high-entropy (Outlook UIDs are 100+ hex
// chars) and are never model- or sync-visible content. Everything else —
// titles, names, labels — is scanned.
const IDENTITY_KEYS = new Set([
  'sourceEventId', 'sourceRecordId', 'sourceDocumentId', 'sourceMessageId', 'connectorId',
])

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 6 || value == null) return
  if (typeof value === 'string') { out.push(value); return }
  if (Array.isArray(value)) { for (const item of value) collectStrings(item, out, depth + 1); return }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (IDENTITY_KEYS.has(key)) continue
      collectStrings(item, out, depth + 1)
    }
  }
}

/**
 * Structural + hygiene gate every record passes BEFORE it may be normalized
 * into evidence. A failure quarantines the record by its opaque source
 * identity — it is never partially ingested (connectors.md §Failure behavior),
 * and a token-shaped string anywhere in the envelope is a hard reject: source
 * content that smells like a credential never becomes local evidence.
 */
export function validateRecordEnvelope(record: ConnectorRecordEnvelope): string[] {
  const problems: string[] = []
  const provenance: Partial<ConnectorProvenance> = record?.provenance ?? {}
  if (!provenance.connectorId) problems.push('provenance.connectorId is required')
  if (!provenance.sourceRecordId?.trim()) problems.push('provenance.sourceRecordId is required')
  if (!((provenance.retrievedAtMs ?? 0) > 0)) problems.push('provenance.retrievedAtMs is required')
  if (!provenance.permissionScope?.trim()) problems.push('provenance.permissionScope is required')
  if (!['standard', 'personal', 'high'].includes(provenance.sensitivity ?? '')) {
    problems.push('provenance.sensitivity must be standard | personal | high')
  }
  if (!record?.entity?.kind) problems.push('entity envelope kind is required')

  const strings: string[] = []
  collectStrings(record?.entity, strings)
  if (record?.daySignal) collectStrings(record.daySignal, strings)
  if (record?.gitSignal) collectStrings(record.gitSignal, strings)
  for (const text of strings) {
    if (containsCredential(text)) {
      problems.push(`credential-shaped content (${findCredentialPattern(text)}) — record quarantined`)
      break
    }
  }
  return problems
}

// ─── Canonical evidence projection ───────────────────────────────────────────

const CONNECTED_ENVELOPE_TO_EVIDENCE_KIND: Record<ConnectedEnvelope['kind'], ConnectedSourceEvidenceKind> = {
  calendar_event: 'calendar_event',
  meeting_record: 'meeting_record',
  repository_activity: 'repository_activity',
  document_reference: 'document_reference',
  message_reference: 'message_reference',
}

/**
 * Project a normalized connector record onto the canonical evidence contract
 * (src/main/core/evidence/envelope.ts) — the application-wide shape every
 * adapter's observations satisfy. The evidence id is DETERMINISTIC from the
 * source-native identity, so re-syncing the same record yields the same
 * evidence identity: idempotency is visible in the projection itself.
 */
export function toConnectedEvidenceEnvelope(
  record: ConnectorRecordEnvelope,
  deviceId: string,
): EvidenceEnvelope {
  const { provenance, entity } = record
  const startMs = 'startMs' in entity ? entity.startMs ?? null : null
  const endMs = 'endMs' in entity ? entity.endMs ?? null : null
  return {
    evidenceId: `cne:${provenance.connectorId}:${provenance.sourceRecordId}`,
    kind: CONNECTED_ENVELOPE_TO_EVIDENCE_KIND[entity.kind],
    source: {
      adapter: `connector:${provenance.connectorId}`,
      deviceId,
      sourceRecordId: provenance.sourceRecordId,
    },
    observedAtMs: provenance.effectiveAtMs ?? provenance.retrievedAtMs,
    monotonicNs: null,
    interval: startMs != null ? { startMs, endMs } : null,
    subjects: {},
    sensitivity: provenance.sensitivity,
    confidence: 'observed',
    provenance: {
      method: 'connector_sync',
      permissionScope: provenance.permissionScope,
      policyVersion: CAPTURE_POLICY_VERSION,
    },
    schemaVersion: 1,
    payload: entity,
  }
}

// ─── Backoff ─────────────────────────────────────────────────────────────────

/**
 * Bounded exponential backoff (connectors.md: "Rate limits use bounded backoff
 * and respect provider reset information"). `providerResetMs` — a provider's
 * explicit "retry after" — wins when it is later than the computed delay.
 */
export function computeBackoffMs(
  policy: ConnectorRateLimitPolicy,
  consecutiveFailures: number,
  providerResetMs: number | null = null,
): number {
  const exponent = Math.max(0, Math.min(consecutiveFailures - 1, 16))
  const computed = Math.min(policy.backoffBaseMs * 2 ** exponent, policy.backoffMaxMs)
  if (providerResetMs != null && providerResetMs > computed) {
    return Math.min(providerResetMs, policy.backoffMaxMs)
  }
  return computed
}
