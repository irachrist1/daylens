import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  daySnapshotValidator,
  syncedDaySummaryValidator,
  workBlockSummaryValidator,
  entityRollupValidator,
  artifactRollupValidator,
  workspaceLivePresenceValidator,
  workspaceAiThreadValidator,
  workspaceAiMessageValidator,
  workspaceAiArtifactValidator,
} from "./snapshotValidator";

export default defineSchema({
  workspaces: defineTable({
    createdAt: v.number(),
    recoveryKeyHash: v.string(),
  }).index("by_recovery_key_hash", ["recoveryKeyHash"]),
  devices: defineTable({
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    platform: v.union(
      v.literal("macos"),
      v.literal("windows"),
      v.literal("linux"),
      v.literal("web")
    ),
    displayName: v.string(),
    lastSyncAt: v.number(),
    orgId: v.optional(v.string()),
    userId: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_and_device", ["workspaceId", "deviceId"]),
  link_codes: defineTable({
    workspaceId: v.id("workspaces"),
    tokenHash: v.string(),
    displayCode: v.string(),
    expiresAt: v.number(),
    failedAttempts: v.number(),
    lockedUntil: v.optional(v.number()),
  })
    .index("by_display_code", ["displayCode"])
    .index("by_workspace", ["workspaceId"]),
  day_snapshots: defineTable({
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    localDate: v.string(),
    snapshot: daySnapshotValidator,
    syncedAt: v.number(),
    orgId: v.optional(v.string()),
  })
    .index("by_workspace_date", ["workspaceId", "localDate"])
    .index("by_workspace_device_date", ["workspaceId", "deviceId", "localDate"]),
  encrypted_keys: defineTable({
    workspaceId: v.id("workspaces"),
    encryptedAnthropicKey: v.string(),
    updatedAt: v.optional(v.number()),
  }).index("by_workspace", ["workspaceId"]),
  workspace_live_presence: defineTable({
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    presence: workspaceLivePresenceValidator,
    heartbeatAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_device", ["workspaceId", "deviceId"])
    .index("by_workspace_heartbeat", ["workspaceId", "heartbeatAt"]),
  sync_runs: defineTable({
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    localDate: v.string(),
    contractVersion: v.string(),
    startedAt: v.number(),
    finishedAt: v.number(),
    status: v.union(v.literal("success"), v.literal("failed")),
    workBlockCount: v.number(),
    entityCount: v.number(),
    artifactCount: v.number(),
    message: v.union(v.string(), v.null()),
  })
    .index("by_workspace_finished", ["workspaceId", "finishedAt"])
    .index("by_workspace_date", ["workspaceId", "localDate"]),
  sync_failures: defineTable({
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    localDate: v.union(v.string(), v.null()),
    contractVersion: v.string(),
    failedAt: v.number(),
    reason: v.string(),
    detail: v.union(v.string(), v.null()),
  })
    .index("by_workspace_failed_at", ["workspaceId", "failedAt"])
    .index("by_workspace_date", ["workspaceId", "localDate"]),
  synced_day_summaries: defineTable({
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    localDate: v.string(),
    summary: syncedDaySummaryValidator,
    syncedAt: v.number(),
  })
    .index("by_workspace_date", ["workspaceId", "localDate"])
    .index("by_workspace_device_date", ["workspaceId", "deviceId", "localDate"]),
  synced_work_blocks: defineTable({
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    localDate: v.string(),
    blockId: v.string(),
    block: workBlockSummaryValidator,
    syncedAt: v.number(),
  })
    .index("by_workspace_date", ["workspaceId", "localDate"])
    .index("by_workspace_device_date", ["workspaceId", "deviceId", "localDate"])
    .index("by_workspace_block", ["workspaceId", "blockId"]),
  synced_entities: defineTable({
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    localDate: v.string(),
    entityKey: v.string(),
    entity: entityRollupValidator,
    syncedAt: v.number(),
  })
    .index("by_workspace_date", ["workspaceId", "localDate"])
    .index("by_workspace_entity", ["workspaceId", "entityKey"])
    .index("by_workspace_device_date", ["workspaceId", "deviceId", "localDate"]),
  synced_artifacts: defineTable({
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    localDate: v.string(),
    artifactId: v.string(),
    artifact: artifactRollupValidator,
    syncedAt: v.number(),
  })
    .index("by_workspace_date", ["workspaceId", "localDate"])
    .index("by_workspace_artifact", ["workspaceId", "artifactId"])
    .index("by_workspace_device_date", ["workspaceId", "deviceId", "localDate"]),
  http_rate_limits: defineTable({
    key: v.string(),
    count: v.number(),
    expiresAt: v.number(),
  }).index("by_key", ["key"]),
  web_ai_threads: defineTable({
    workspaceId: v.id("workspaces"),
    workspaceThreadId: v.string(),
    title: v.string(),
    source: v.union(v.literal("desktop"), v.literal("web")),
    createdAt: v.number(),
    updatedAt: v.number(),
    archived: v.boolean(),
    thread: workspaceAiThreadValidator,
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_updated", ["workspaceId", "updatedAt"])
    .index("by_workspace_thread", ["workspaceId", "workspaceThreadId"]),
  web_ai_messages: defineTable({
    workspaceId: v.id("workspaces"),
    threadId: v.string(),
    workspaceMessageId: v.string(),
    createdAt: v.number(),
    message: workspaceAiMessageValidator,
  })
    .index("by_workspace_thread", ["workspaceId", "threadId"])
    .index("by_workspace_message", ["workspaceId", "workspaceMessageId"]),
  web_ai_artifacts: defineTable({
    workspaceId: v.id("workspaces"),
    threadId: v.string(),
    artifactId: v.string(),
    createdAt: v.number(),
    artifact: workspaceAiArtifactValidator,
  })
    .index("by_workspace_thread", ["workspaceId", "threadId"])
    .index("by_workspace_thread_created", ["workspaceId", "threadId", "createdAt"])
    .index("by_workspace_created", ["workspaceId", "createdAt"])
    .index("by_workspace_artifact", ["workspaceId", "artifactId"]),
  ai_feedback_examples: defineTable({
    eventType: v.literal("rated"),
    feedbackKey: v.string(),
    clientId: v.string(),
    appVersion: v.string(),
    platform: v.string(),
    rating: v.union(v.literal("up"), v.literal("down")),
    ratingUpdatedAt: v.number(),
    answerKind: v.union(v.string(), v.null()),
    provider: v.union(v.string(), v.null()),
    model: v.union(v.string(), v.null()),
    conversationId: v.number(),
    threadId: v.union(v.number(), v.null()),
    userMessageId: v.union(v.number(), v.null()),
    assistantMessageId: v.number(),
    userPromptExcerpt: v.union(v.string(), v.null()),
    assistantAnswerExcerpt: v.string(),
    userPromptTruncated: v.boolean(),
    assistantAnswerTruncated: v.boolean(),
    redacted: v.boolean(),
    createdAt: v.number(),
    receivedAt: v.number(),
  })
    .index("by_feedback_key", ["feedbackKey"])
    .index("by_rating", ["rating", "createdAt"])
    .index("by_created", ["createdAt"])
    .index("by_app_version", ["appVersion", "createdAt"])
    .index("by_client", ["clientId", "createdAt"]),
  workspace_preferences: defineTable({
    workspaceId: v.id("workspaces"),
    hiddenApps: v.array(v.string()),
    hiddenDomains: v.array(v.string()),
    privacyPinHash: v.optional(v.string()),
  }).index("by_workspace", ["workspaceId"]),
});
