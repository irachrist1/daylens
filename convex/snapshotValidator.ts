import { v } from "convex/values";

export const categoryValidator = v.union(
  v.literal("development"),
  v.literal("communication"),
  v.literal("research"),
  v.literal("writing"),
  v.literal("aiTools"),
  v.literal("design"),
  v.literal("browsing"),
  v.literal("meetings"),
  v.literal("entertainment"),
  v.literal("email"),
  v.literal("productivity"),
  v.literal("social"),
  v.literal("system"),
  v.literal("uncategorized")
);

export const platformValidator = v.union(
  v.literal("macos"),
  v.literal("windows"),
  v.literal("linux")
);

export const topPageValidator = v.object({
  domain: v.string(),
  label: v.optional(v.union(v.string(), v.null())),
  seconds: v.number(),
});

export const focusSessionValidator = v.object({
  sourceId: v.string(),
  startAt: v.string(),
  endAt: v.string(),
  actualDurationSec: v.number(),
  targetMinutes: v.number(),
  status: v.union(
    v.literal("completed"),
    v.literal("cancelled"),
    v.literal("active")
  ),
});

export const legacyFocusSessionValidator = v.object({
  appKey: v.string(),
  startAt: v.string(),
  endAt: v.string(),
  durationSeconds: v.number(),
});

export const appSummaryValidator = v.object({
  appKey: v.string(),
  bundleID: v.optional(v.string()),
  displayName: v.string(),
  category: categoryValidator,
  totalSeconds: v.number(),
  sessionCount: v.number(),
  iconBase64: v.optional(v.string()),
});

export const categoryTotalValidator = v.object({
  category: categoryValidator,
  totalSeconds: v.number(),
});

export const timelineEntryValidator = v.object({
  appKey: v.string(),
  startAt: v.string(),
  endAt: v.string(),
});

export const topDomainValidator = v.object({
  domain: v.string(),
  seconds: v.number(),
  category: categoryValidator,
  topPages: v.optional(v.array(topPageValidator)),
});

export const recapChapterIdValidator = v.union(
  v.literal("headline"),
  v.literal("focus"),
  v.literal("artifacts"),
  v.literal("rhythm"),
  v.literal("change")
);

export const recapSummaryLiteValidator = v.object({
  headline: v.string(),
  chapters: v.array(
    v.object({
      id: recapChapterIdValidator,
      eyebrow: v.string(),
      title: v.string(),
      body: v.string(),
    })
  ),
  metrics: v.array(
    v.object({
      label: v.string(),
      value: v.string(),
      detail: v.string(),
    })
  ),
  changeSummary: v.string(),
  promptChips: v.array(v.string()),
  hasData: v.boolean(),
});

export const workBlockSummaryValidator = v.object({
  id: v.string(),
  startAt: v.string(),
  endAt: v.string(),
  label: v.string(),
  labelSource: v.union(v.literal("user"), v.literal("ai"), v.literal("rule")),
  dominantCategory: categoryValidator,
  focusSeconds: v.number(),
  switchCount: v.number(),
  confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  topApps: v.array(
    v.object({
      appKey: v.string(),
      seconds: v.number(),
    })
  ),
  topPages: v.array(
    v.object({
      domain: v.string(),
      label: v.union(v.string(), v.null()),
      seconds: v.number(),
    })
  ),
  artifactIds: v.array(v.string()),
});

export const focusScoreV2Validator = v.object({
  score: v.number(),
  coherence: v.number(),
  deepWorkDensity: v.number(),
  artifactProgress: v.number(),
  switchPenalty: v.number(),
});

export const recapCoverageValidator = v.object({
  attributedPct: v.number(),
  untitledPct: v.number(),
  activeDayCount: v.number(),
  quietDayCount: v.number(),
  hasComparison: v.boolean(),
  coverageNote: v.union(v.string(), v.null()),
});

export const workstreamRollupValidator = v.object({
  label: v.string(),
  seconds: v.number(),
  blockCount: v.number(),
  isUntitled: v.boolean(),
});

export const artifactKindValidator = v.union(
  v.literal("markdown"),
  v.literal("csv"),
  v.literal("json_table"),
  v.literal("html_chart"),
  v.literal("report")
);

export const artifactRollupValidator = v.object({
  id: v.string(),
  kind: artifactKindValidator,
  title: v.string(),
  byteSize: v.number(),
  generatedAt: v.string(),
  threadId: v.union(v.string(), v.null()),
});

export const entityRollupValidator = v.object({
  id: v.string(),
  label: v.string(),
  kind: v.union(
    v.literal("client"),
    v.literal("project"),
    v.literal("repo"),
    v.literal("topic")
  ),
  secondsToday: v.number(),
  blockCount: v.number(),
});

const baseSnapshotShape = {
  deviceId: v.string(),
  platform: platformValidator,
  date: v.string(),
  generatedAt: v.string(),
  isPartialDay: v.boolean(),
  focusScore: v.number(),
  focusSeconds: v.number(),
  appSummaries: v.array(appSummaryValidator),
  categoryTotals: v.array(categoryTotalValidator),
  timeline: v.array(timelineEntryValidator),
  topDomains: v.array(topDomainValidator),
  categoryOverrides: v.record(v.string(), categoryValidator),
  aiSummary: v.optional(v.union(v.string(), v.null())),
  focusSessions: v.optional(v.array(v.union(focusSessionValidator, legacyFocusSessionValidator))),
} as const;

export const daySnapshotV1Validator = v.object({
  schemaVersion: v.literal(1),
  ...baseSnapshotShape,
});

export const daySnapshotV2Validator = v.object({
  schemaVersion: v.literal(2),
  ...baseSnapshotShape,
  focusScoreV2: focusScoreV2Validator,
  workBlocks: v.array(workBlockSummaryValidator),
  recap: v.object({
    day: recapSummaryLiteValidator,
    week: v.union(recapSummaryLiteValidator, v.null()),
    month: v.union(recapSummaryLiteValidator, v.null()),
  }),
  coverage: recapCoverageValidator,
  topWorkstreams: v.array(workstreamRollupValidator),
  standoutArtifacts: v.array(artifactRollupValidator),
  entities: v.array(entityRollupValidator),
  privacyFiltered: v.boolean(),
});

export const daySnapshotValidator = v.union(
  daySnapshotV1Validator,
  daySnapshotV2Validator
);

export const workspacePresenceStateValidator = v.union(
  v.literal("active"),
  v.literal("idle"),
  v.literal("meeting"),
  v.literal("sleeping"),
  v.literal("offline"),
  v.literal("stale")
);

export const workspaceLivePresenceValidator = v.object({
  contractVersion: v.string(),
  deviceId: v.string(),
  localDate: v.string(),
  state: workspacePresenceStateValidator,
  heartbeatAt: v.number(),
  capturedAt: v.number(),
  lastMeaningfulCaptureAt: v.number(),
  currentBlockLabel: v.union(v.string(), v.null()),
  currentCategory: v.union(categoryValidator, v.null()),
  currentAppKey: v.union(v.string(), v.null()),
  currentFocusSeconds: v.union(v.number(), v.null()),
});

export const syncedDaySummaryValidator = v.object({
  contractVersion: v.string(),
  deviceId: v.string(),
  localDate: v.string(),
  generatedAt: v.string(),
  isPartialDay: v.boolean(),
  focusScore: v.number(),
  focusSeconds: v.number(),
  focusScoreV2: v.union(focusScoreV2Validator, v.null()),
  recap: v.object({
    day: recapSummaryLiteValidator,
    week: v.union(recapSummaryLiteValidator, v.null()),
    month: v.union(recapSummaryLiteValidator, v.null()),
  }),
  coverage: recapCoverageValidator,
  topWorkstreams: v.array(workstreamRollupValidator),
  latestWorkBlockId: v.union(v.string(), v.null()),
  workBlockCount: v.number(),
  entityCount: v.number(),
  artifactCount: v.number(),
  privacyFiltered: v.boolean(),
});

export const remoteSyncPayloadValidator = v.object({
  contractVersion: v.string(),
  deviceId: v.string(),
  localDate: v.string(),
  generatedAt: v.string(),
  daySummary: syncedDaySummaryValidator,
  workBlocks: v.array(workBlockSummaryValidator),
  entities: v.array(entityRollupValidator),
  artifacts: v.array(artifactRollupValidator),
});

export const syncRunSummaryValidator = v.object({
  contractVersion: v.string(),
  deviceId: v.string(),
  localDate: v.string(),
  startedAt: v.number(),
  finishedAt: v.number(),
  status: v.union(v.literal("success"), v.literal("failed")),
  workBlockCount: v.number(),
  entityCount: v.number(),
  artifactCount: v.number(),
  message: v.union(v.string(), v.null()),
});

export const syncFailureSummaryValidator = v.object({
  contractVersion: v.string(),
  deviceId: v.string(),
  localDate: v.union(v.string(), v.null()),
  failedAt: v.number(),
  reason: v.string(),
  detail: v.union(v.string(), v.null()),
});

export const workspaceThreadSourceValidator = v.union(
  v.literal("desktop"),
  v.literal("web")
);

export const workspaceAiThreadValidator = v.object({
  workspaceThreadId: v.string(),
  title: v.string(),
  source: workspaceThreadSourceValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  archived: v.boolean(),
});

export const workspaceAiMessageValidator = v.object({
  workspaceMessageId: v.string(),
  workspaceThreadId: v.string(),
  role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
  content: v.string(),
  createdAt: v.number(),
  provider: v.union(v.string(), v.null()),
  model: v.union(v.string(), v.null()),
  failureReason: v.union(v.string(), v.null()),
});

export const workspaceAiArtifactValidator = v.object({
  workspaceArtifactId: v.string(),
  workspaceThreadId: v.string(),
  workspaceMessageId: v.union(v.string(), v.null()),
  title: v.string(),
  kind: artifactKindValidator,
  createdAt: v.number(),
  storageId: v.union(v.string(), v.null()),
  textContent: v.union(v.string(), v.null()),
});
