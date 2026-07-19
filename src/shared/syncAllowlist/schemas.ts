import { z } from 'zod'

const categorySchema = z.enum([
  'development',
  'communication',
  'research',
  'writing',
  'aiTools',
  'design',
  'browsing',
  'meetings',
  'entertainment',
  'email',
  'productivity',
  'social',
  'system',
  'uncategorized',
])

const recapChapterIdSchema = z.enum(['headline', 'focus', 'artifacts', 'rhythm', 'change'])

const workspacePresenceStateSchema = z.enum([
  'active',
  'idle',
  'meeting',
  'sleeping',
  'offline',
  'stale',
])

export const focusScoreV2Schema = z
  .object({
    deepWorkPct: z.number().nullable(),
    longestStreakSeconds: z.number(),
    switchCount: z.number(),
    deepWorkSessionCount: z.number(),
  })
  .strict()

export const recapChapterSchema = z
  .object({
    id: recapChapterIdSchema,
    eyebrow: z.string(),
    title: z.string(),
    body: z.string(),
  })
  .strict()

export const recapMetricSchema = z
  .object({
    label: z.string(),
    value: z.string(),
    detail: z.string(),
  })
  .strict()

export const recapSummaryLiteSchema = z
  .object({
    headline: z.string(),
    chapters: z.array(recapChapterSchema),
    metrics: z.array(recapMetricSchema),
    changeSummary: z.string(),
    promptChips: z.array(z.string()),
    hasData: z.boolean(),
  })
  .strict()

export const syncedRecapSchema = z
  .object({
    day: recapSummaryLiteSchema,
    week: recapSummaryLiteSchema.nullable(),
    month: recapSummaryLiteSchema.nullable(),
  })
  .strict()

export const recapCoverageSchema = z
  .object({
    attributedPct: z.number(),
    untitledPct: z.number(),
    activeDayCount: z.number(),
    quietDayCount: z.number(),
    hasComparison: z.boolean(),
    coverageNote: z.string().nullable(),
  })
  .strict()

export const workstreamRollupSchema = z
  .object({
    label: z.string(),
    seconds: z.number(),
    blockCount: z.number(),
    isUntitled: z.boolean(),
  })
  .strict()

export const workBlockTopAppSchema = z
  .object({
    appKey: z.string(),
    seconds: z.number(),
  })
  .strict()

export const workBlockTopPageSchema = z
  .object({
    domain: z.string(),
    label: z.string().nullable(),
    seconds: z.number(),
  })
  .strict()

export const workBlockSummarySchema = z
  .object({
    id: z.string(),
    startAt: z.string(),
    endAt: z.string(),
    label: z.string(),
    labelSource: z.enum(['user', 'ai', 'rule']),
    dominantCategory: categorySchema,
    focusSeconds: z.number(),
    switchCount: z.number(),
    confidence: z.enum(['high', 'medium', 'low']),
    topApps: z.array(workBlockTopAppSchema),
    topPages: z.array(workBlockTopPageSchema),
    artifactIds: z.array(z.string()),
  })
  .strict()

export const entityRollupSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    kind: z.enum(['client', 'project', 'repo', 'topic']),
    secondsToday: z.number(),
    blockCount: z.number(),
  })
  .strict()

export const artifactRollupSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['markdown', 'csv', 'json_table', 'html_chart', 'report']),
    title: z.string(),
    byteSize: z.number(),
    generatedAt: z.string(),
    threadId: z.string().nullable(),
  })
  .strict()

export const syncedDaySummarySchema = z
  .object({
    contractVersion: z.string(),
    deviceId: z.string(),
    localDate: z.string(),
    generatedAt: z.string(),
    isPartialDay: z.boolean(),
    focusScore: z.number(),
    focusSeconds: z.number(),
    focusScoreV2: focusScoreV2Schema.nullable(),
    recap: syncedRecapSchema,
    coverage: recapCoverageSchema,
    topWorkstreams: z.array(workstreamRollupSchema),
    latestWorkBlockId: z.string().nullable(),
    workBlockCount: z.number(),
    entityCount: z.number(),
    artifactCount: z.number(),
    privacyFiltered: z.boolean(),
  })
  .strict()

export const remoteSyncPayloadSchema = z
  .object({
    contractVersion: z.string(),
    deviceId: z.string(),
    localDate: z.string(),
    generatedAt: z.string(),
    daySummary: syncedDaySummarySchema,
    workBlocks: z.array(workBlockSummarySchema),
    entities: z.array(entityRollupSchema),
    artifacts: z.array(artifactRollupSchema),
  })
  .strict()

export const workspaceLivePresenceSchema = z
  .object({
    contractVersion: z.string(),
    deviceId: z.string(),
    localDate: z.string(),
    state: workspacePresenceStateSchema,
    heartbeatAt: z.number(),
    capturedAt: z.number(),
    lastMeaningfulCaptureAt: z.number(),
    currentBlockLabel: z.string().nullable(),
    currentCategory: categorySchema.nullable(),
    currentAppKey: z.string().nullable(),
    currentFocusSeconds: z.number().nullable(),
  })
  .strict()
