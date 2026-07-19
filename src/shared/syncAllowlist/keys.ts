import type {
  ArtifactRollup,
  EntityRollup,
  FocusScoreV2Snapshot,
  RecapCoverage,
  RecapSummaryLite,
  RemoteSyncPayload,
  SyncedDaySummary,
  WorkBlockSummary,
  WorkspaceLivePresence,
  WorkstreamRollup,
} from '@daylens/remote-contract'

// Bidirectional exactness: fails typecheck if the map has extras OR the
// mirrored type gains a field that is not listed.
export type ExactKeys<T, M extends Record<keyof T, true>> =
  Exclude<keyof M, keyof T> extends never
    ? Exclude<keyof T, keyof M> extends never
      ? M
      : never
    : never

type RecapChapter = RecapSummaryLite['chapters'][number]
type RecapMetric = RecapSummaryLite['metrics'][number]
type WorkBlockTopApp = WorkBlockSummary['topApps'][number]
type WorkBlockTopPage = WorkBlockSummary['topPages'][number]
type SyncedRecap = SyncedDaySummary['recap']

export const REMOTE_SYNC_PAYLOAD_KEYS = {
  contractVersion: true,
  deviceId: true,
  localDate: true,
  generatedAt: true,
  daySummary: true,
  workBlocks: true,
  entities: true,
  artifacts: true,
} as const satisfies Record<keyof RemoteSyncPayload, true>
const _exactRemoteSyncPayloadKeys: ExactKeys<RemoteSyncPayload, typeof REMOTE_SYNC_PAYLOAD_KEYS> =
  REMOTE_SYNC_PAYLOAD_KEYS
void _exactRemoteSyncPayloadKeys

export const SYNCED_DAY_SUMMARY_KEYS = {
  contractVersion: true,
  deviceId: true,
  localDate: true,
  generatedAt: true,
  isPartialDay: true,
  focusScore: true,
  focusSeconds: true,
  focusScoreV2: true,
  recap: true,
  coverage: true,
  topWorkstreams: true,
  latestWorkBlockId: true,
  workBlockCount: true,
  entityCount: true,
  artifactCount: true,
  privacyFiltered: true,
} as const satisfies Record<keyof SyncedDaySummary, true>
const _exactSyncedDaySummaryKeys: ExactKeys<SyncedDaySummary, typeof SYNCED_DAY_SUMMARY_KEYS> =
  SYNCED_DAY_SUMMARY_KEYS
void _exactSyncedDaySummaryKeys

export const FOCUS_SCORE_V2_KEYS = {
  deepWorkPct: true,
  longestStreakSeconds: true,
  switchCount: true,
  deepWorkSessionCount: true,
} as const satisfies Record<keyof FocusScoreV2Snapshot, true>
const _exactFocusScoreV2Keys: ExactKeys<FocusScoreV2Snapshot, typeof FOCUS_SCORE_V2_KEYS> =
  FOCUS_SCORE_V2_KEYS
void _exactFocusScoreV2Keys

export const SYNCED_RECAP_KEYS = {
  day: true,
  week: true,
  month: true,
} as const satisfies Record<keyof SyncedRecap, true>
const _exactSyncedRecapKeys: ExactKeys<SyncedRecap, typeof SYNCED_RECAP_KEYS> = SYNCED_RECAP_KEYS
void _exactSyncedRecapKeys

export const RECAP_SUMMARY_LITE_KEYS = {
  headline: true,
  chapters: true,
  metrics: true,
  changeSummary: true,
  promptChips: true,
  hasData: true,
} as const satisfies Record<keyof RecapSummaryLite, true>
const _exactRecapSummaryLiteKeys: ExactKeys<RecapSummaryLite, typeof RECAP_SUMMARY_LITE_KEYS> =
  RECAP_SUMMARY_LITE_KEYS
void _exactRecapSummaryLiteKeys

export const RECAP_CHAPTER_KEYS = {
  id: true,
  eyebrow: true,
  title: true,
  body: true,
} as const satisfies Record<keyof RecapChapter, true>
const _exactRecapChapterKeys: ExactKeys<RecapChapter, typeof RECAP_CHAPTER_KEYS> = RECAP_CHAPTER_KEYS
void _exactRecapChapterKeys

export const RECAP_METRIC_KEYS = {
  label: true,
  value: true,
  detail: true,
} as const satisfies Record<keyof RecapMetric, true>
const _exactRecapMetricKeys: ExactKeys<RecapMetric, typeof RECAP_METRIC_KEYS> = RECAP_METRIC_KEYS
void _exactRecapMetricKeys

export const RECAP_COVERAGE_KEYS = {
  attributedPct: true,
  untitledPct: true,
  activeDayCount: true,
  quietDayCount: true,
  hasComparison: true,
  coverageNote: true,
} as const satisfies Record<keyof RecapCoverage, true>
const _exactRecapCoverageKeys: ExactKeys<RecapCoverage, typeof RECAP_COVERAGE_KEYS> =
  RECAP_COVERAGE_KEYS
void _exactRecapCoverageKeys

export const WORKSTREAM_ROLLUP_KEYS = {
  label: true,
  seconds: true,
  blockCount: true,
  isUntitled: true,
} as const satisfies Record<keyof WorkstreamRollup, true>
const _exactWorkstreamRollupKeys: ExactKeys<WorkstreamRollup, typeof WORKSTREAM_ROLLUP_KEYS> =
  WORKSTREAM_ROLLUP_KEYS
void _exactWorkstreamRollupKeys

export const WORK_BLOCK_SUMMARY_KEYS = {
  id: true,
  startAt: true,
  endAt: true,
  label: true,
  labelSource: true,
  dominantCategory: true,
  focusSeconds: true,
  switchCount: true,
  confidence: true,
  topApps: true,
  topPages: true,
  artifactIds: true,
} as const satisfies Record<keyof WorkBlockSummary, true>
const _exactWorkBlockSummaryKeys: ExactKeys<WorkBlockSummary, typeof WORK_BLOCK_SUMMARY_KEYS> =
  WORK_BLOCK_SUMMARY_KEYS
void _exactWorkBlockSummaryKeys

export const WORK_BLOCK_TOP_APP_KEYS = {
  appKey: true,
  seconds: true,
} as const satisfies Record<keyof WorkBlockTopApp, true>
const _exactWorkBlockTopAppKeys: ExactKeys<WorkBlockTopApp, typeof WORK_BLOCK_TOP_APP_KEYS> =
  WORK_BLOCK_TOP_APP_KEYS
void _exactWorkBlockTopAppKeys

export const WORK_BLOCK_TOP_PAGE_KEYS = {
  domain: true,
  label: true,
  seconds: true,
} as const satisfies Record<keyof WorkBlockTopPage, true>
const _exactWorkBlockTopPageKeys: ExactKeys<WorkBlockTopPage, typeof WORK_BLOCK_TOP_PAGE_KEYS> =
  WORK_BLOCK_TOP_PAGE_KEYS
void _exactWorkBlockTopPageKeys

export const ENTITY_ROLLUP_KEYS = {
  id: true,
  label: true,
  kind: true,
  secondsToday: true,
  blockCount: true,
} as const satisfies Record<keyof EntityRollup, true>
const _exactEntityRollupKeys: ExactKeys<EntityRollup, typeof ENTITY_ROLLUP_KEYS> = ENTITY_ROLLUP_KEYS
void _exactEntityRollupKeys

export const ARTIFACT_ROLLUP_KEYS = {
  id: true,
  kind: true,
  title: true,
  byteSize: true,
  generatedAt: true,
  threadId: true,
} as const satisfies Record<keyof ArtifactRollup, true>
const _exactArtifactRollupKeys: ExactKeys<ArtifactRollup, typeof ARTIFACT_ROLLUP_KEYS> =
  ARTIFACT_ROLLUP_KEYS
void _exactArtifactRollupKeys

export const WORKSPACE_LIVE_PRESENCE_KEYS = {
  contractVersion: true,
  deviceId: true,
  localDate: true,
  state: true,
  heartbeatAt: true,
  capturedAt: true,
  lastMeaningfulCaptureAt: true,
  currentBlockLabel: true,
  currentCategory: true,
  currentAppKey: true,
  currentFocusSeconds: true,
} as const satisfies Record<keyof WorkspaceLivePresence, true>
const _exactWorkspaceLivePresenceKeys: ExactKeys<
  WorkspaceLivePresence,
  typeof WORKSPACE_LIVE_PRESENCE_KEYS
> = WORKSPACE_LIVE_PRESENCE_KEYS
void _exactWorkspaceLivePresenceKeys

export const OPAQUE_SOURCE_REFERENCE_KEYS = {
  evidenceId: true,
  evidenceKind: true,
  originatingDevice: true,
} as const
