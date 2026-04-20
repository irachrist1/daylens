import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { daySnapshotValidator } from "./snapshotValidator";

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
  }).index("by_workspace", ["workspaceId"]),
  http_rate_limits: defineTable({
    key: v.string(),
    count: v.number(),
    expiresAt: v.number(),
  }).index("by_key", ["key"]),
  web_chats: defineTable({
    workspaceId: v.id("workspaces"),
    messages: v.any(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),
  workspace_preferences: defineTable({
    workspaceId: v.id("workspaces"),
    hiddenApps: v.array(v.string()),
    hiddenDomains: v.array(v.string()),
    privacyPinHash: v.optional(v.string()),
  }).index("by_workspace", ["workspaceId"]),
});
