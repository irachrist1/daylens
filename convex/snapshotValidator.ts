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

const platformValidator = v.union(
  v.literal("macos"),
  v.literal("windows"),
  v.literal("linux")
);

export const topPageValidator = v.object({
  url: v.string(),
  title: v.optional(v.union(v.string(), v.null())),
  seconds: v.number(),
});

const focusSessionValidator = v.object({
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

const legacyFocusSessionValidator = v.object({
  appKey: v.string(),
  startAt: v.string(),
  endAt: v.string(),
  durationSeconds: v.number(),
});

const appSummaryValidator = v.object({
  appKey: v.string(),
  bundleID: v.optional(v.string()),
  displayName: v.string(),
  category: categoryValidator,
  totalSeconds: v.number(),
  sessionCount: v.number(),
  iconBase64: v.optional(v.string()),
});

const categoryTotalValidator = v.object({
  category: categoryValidator,
  totalSeconds: v.number(),
});

const timelineEntryValidator = v.object({
  appKey: v.string(),
  startAt: v.string(),
  endAt: v.string(),
});

const topDomainValidator = v.object({
  domain: v.string(),
  seconds: v.number(),
  category: categoryValidator,
  topPages: v.optional(v.array(topPageValidator)),
});

const recapChapterIdValidator = v.union(
  v.literal("headline"),
  v.literal("focus"),
  v.literal("artifacts"),
  v.literal("rhythm"),
  v.literal("change")
);

const recapSummaryLiteValidator = v.object({
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

const workBlockSummaryValidator = v.object({
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
      title: v.union(v.string(), v.null()),
      seconds: v.number(),
    })
  ),
  artifactIds: v.array(v.string()),
});

const focusScoreV2Validator = v.object({
  score: v.number(),
  coherence: v.number(),
  deepWorkDensity: v.number(),
  artifactProgress: v.number(),
  switchPenalty: v.number(),
});

const recapCoverageValidator = v.object({
  attributedPct: v.number(),
  untitledPct: v.number(),
  activeDayCount: v.number(),
  quietDayCount: v.number(),
  hasComparison: v.boolean(),
  coverageNote: v.union(v.string(), v.null()),
});

const workstreamRollupValidator = v.object({
  label: v.string(),
  seconds: v.number(),
  blockCount: v.number(),
  isUntitled: v.boolean(),
});

const artifactRollupValidator = v.object({
  id: v.string(),
  kind: v.union(
    v.literal("markdown"),
    v.literal("csv"),
    v.literal("json_table"),
    v.literal("html_chart"),
    v.literal("report")
  ),
  title: v.string(),
  byteSize: v.number(),
  generatedAt: v.string(),
  threadId: v.union(v.string(), v.null()),
});

const entityRollupValidator = v.object({
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
  hiddenByPreferences: v.boolean(),
});

export const daySnapshotValidator = v.union(
  daySnapshotV1Validator,
  daySnapshotV2Validator
);
