import type { RemoteSyncPayload, WorkspaceLivePresence } from '@daylens/remote-contract'
import { ZodError } from 'zod'
import {
  ARTIFACT_ROLLUP_KEYS,
  ENTITY_ROLLUP_KEYS,
  FOCUS_SCORE_V2_KEYS,
  RECAP_CHAPTER_KEYS,
  RECAP_COVERAGE_KEYS,
  RECAP_METRIC_KEYS,
  RECAP_SUMMARY_LITE_KEYS,
  REMOTE_SYNC_PAYLOAD_KEYS,
  SYNCED_DAY_SUMMARY_KEYS,
  SYNCED_RECAP_KEYS,
  WORK_BLOCK_SUMMARY_KEYS,
  WORK_BLOCK_TOP_APP_KEYS,
  WORK_BLOCK_TOP_PAGE_KEYS,
  WORKSPACE_LIVE_PRESENCE_KEYS,
  WORKSTREAM_ROLLUP_KEYS,
  OPAQUE_SOURCE_REFERENCE_KEYS,
} from './keys'
import { opaqueSourceReferenceSchema, type OpaqueSourceReference } from './opaqueSource'
import {
  artifactRollupSchema,
  entityRollupSchema,
  focusScoreV2Schema,
  recapChapterSchema,
  recapCoverageSchema,
  recapMetricSchema,
  recapSummaryLiteSchema,
  remoteSyncPayloadSchema,
  syncedDaySummarySchema,
  syncedRecapSchema,
  workBlockSummarySchema,
  workBlockTopAppSchema,
  workBlockTopPageSchema,
  workspaceLivePresenceSchema,
  workstreamRollupSchema,
} from './schemas'
import {
  collectForbiddenKeys,
  collectPresenceValueViolations,
  collectRemoteSyncValueViolations,
  type SyncAllowlistViolationDetail,
} from './valueGuards'

export type { ExactKeys } from './keys'
export {
  ARTIFACT_ROLLUP_KEYS,
  ENTITY_ROLLUP_KEYS,
  FOCUS_SCORE_V2_KEYS,
  OPAQUE_SOURCE_REFERENCE_KEYS,
  RECAP_CHAPTER_KEYS,
  RECAP_COVERAGE_KEYS,
  RECAP_METRIC_KEYS,
  RECAP_SUMMARY_LITE_KEYS,
  REMOTE_SYNC_PAYLOAD_KEYS,
  SYNCED_DAY_SUMMARY_KEYS,
  SYNCED_RECAP_KEYS,
  WORK_BLOCK_SUMMARY_KEYS,
  WORK_BLOCK_TOP_APP_KEYS,
  WORK_BLOCK_TOP_PAGE_KEYS,
  WORKSPACE_LIVE_PRESENCE_KEYS,
  WORKSTREAM_ROLLUP_KEYS,
} from './keys'
export { opaqueSourceReferenceSchema, type OpaqueSourceReference } from './opaqueSource'
export {
  artifactRollupSchema,
  entityRollupSchema,
  focusScoreV2Schema,
  recapChapterSchema,
  recapCoverageSchema,
  recapMetricSchema,
  recapSummaryLiteSchema,
  remoteSyncPayloadSchema,
  syncedDaySummarySchema,
  syncedRecapSchema,
  workBlockSummarySchema,
  workBlockTopAppSchema,
  workBlockTopPageSchema,
  workspaceLivePresenceSchema,
  workstreamRollupSchema,
} from './schemas'
export type { SyncAllowlistViolationClass, SyncAllowlistViolationDetail } from './valueGuards'

export class SyncAllowlistViolation extends Error {
  readonly violations: SyncAllowlistViolationDetail[]

  constructor(violations: SyncAllowlistViolationDetail[]) {
    const summary = violations
      .slice(0, 5)
      .map((item) => `${item.class}@${item.path}`)
      .join('; ')
    super(
      violations.length === 1
        ? `Sync allowlist violation: ${summary}`
        : `Sync allowlist violations (${violations.length}): ${summary}`,
    )
    this.name = 'SyncAllowlistViolation'
    this.violations = violations
  }
}

function zodToViolations(error: ZodError): SyncAllowlistViolationDetail[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
    if (issue.code === 'unrecognized_keys') {
      return {
        class: 'extra_field' as const,
        path,
        detail: issue.message,
      }
    }
    return {
      class: 'schema' as const,
      path,
      detail: issue.message,
    }
  })
}

function throwIfAny(violations: SyncAllowlistViolationDetail[]): void {
  if (violations.length > 0) throw new SyncAllowlistViolation(violations)
}

/** Structural + value-class gate for organized-fact day sync payloads. */
export function assertSyncPayloadAllowed(payload: unknown): RemoteSyncPayload {
  const parsed = remoteSyncPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new SyncAllowlistViolation(zodToViolations(parsed.error))
  }

  const violations = [
    ...collectForbiddenKeys(parsed.data),
    ...collectRemoteSyncValueViolations(parsed.data),
  ]
  throwIfAny(violations)
  return parsed.data
}

/** Structural + value-class gate for workspace heartbeat presence. */
export function assertWorkspaceLivePresenceAllowed(payload: unknown): WorkspaceLivePresence {
  const parsed = workspaceLivePresenceSchema.safeParse(payload)
  if (!parsed.success) {
    throw new SyncAllowlistViolation(zodToViolations(parsed.error))
  }

  const violations = [
    ...collectForbiddenKeys(parsed.data),
    ...collectPresenceValueViolations(parsed.data),
  ]
  throwIfAny(violations)
  return parsed.data
}

/** Spec opaque source reference: exactly three fields, no titles/URLs/excerpts. */
export function assertOpaqueSourceAllowed(payload: unknown): OpaqueSourceReference {
  const parsed = opaqueSourceReferenceSchema.safeParse(payload)
  if (!parsed.success) {
    const violations = zodToViolations(parsed.error).map((item) =>
      item.class === 'extra_field'
        ? { ...item, class: 'opaque_source_shape' as const }
        : item.class === 'schema'
          ? { ...item, class: 'opaque_source_shape' as const }
          : item,
    )
    throw new SyncAllowlistViolation(violations)
  }
  return parsed.data
}

/** Key-map ↔ zod-shape parity for structural “new field fails” coverage. */
export const SYNC_ALLOWLIST_KEY_SCHEMA_PAIRS: Array<{
  name: string
  keys: Record<string, true>
  shape: Record<string, unknown>
}> = [
  { name: 'RemoteSyncPayload', keys: REMOTE_SYNC_PAYLOAD_KEYS, shape: remoteSyncPayloadSchema.shape },
  { name: 'SyncedDaySummary', keys: SYNCED_DAY_SUMMARY_KEYS, shape: syncedDaySummarySchema.shape },
  { name: 'FocusScoreV2Snapshot', keys: FOCUS_SCORE_V2_KEYS, shape: focusScoreV2Schema.shape },
  { name: 'SyncedRecap', keys: SYNCED_RECAP_KEYS, shape: syncedRecapSchema.shape },
  { name: 'RecapSummaryLite', keys: RECAP_SUMMARY_LITE_KEYS, shape: recapSummaryLiteSchema.shape },
  { name: 'RecapChapter', keys: RECAP_CHAPTER_KEYS, shape: recapChapterSchema.shape },
  { name: 'RecapMetric', keys: RECAP_METRIC_KEYS, shape: recapMetricSchema.shape },
  { name: 'RecapCoverage', keys: RECAP_COVERAGE_KEYS, shape: recapCoverageSchema.shape },
  { name: 'WorkstreamRollup', keys: WORKSTREAM_ROLLUP_KEYS, shape: workstreamRollupSchema.shape },
  { name: 'WorkBlockSummary', keys: WORK_BLOCK_SUMMARY_KEYS, shape: workBlockSummarySchema.shape },
  { name: 'WorkBlockTopApp', keys: WORK_BLOCK_TOP_APP_KEYS, shape: workBlockTopAppSchema.shape },
  { name: 'WorkBlockTopPage', keys: WORK_BLOCK_TOP_PAGE_KEYS, shape: workBlockTopPageSchema.shape },
  { name: 'EntityRollup', keys: ENTITY_ROLLUP_KEYS, shape: entityRollupSchema.shape },
  { name: 'ArtifactRollup', keys: ARTIFACT_ROLLUP_KEYS, shape: artifactRollupSchema.shape },
  {
    name: 'WorkspaceLivePresence',
    keys: WORKSPACE_LIVE_PRESENCE_KEYS,
    shape: workspaceLivePresenceSchema.shape,
  },
  {
    name: 'OpaqueSourceReference',
    keys: OPAQUE_SOURCE_REFERENCE_KEYS,
    shape: opaqueSourceReferenceSchema.shape,
  },
]
