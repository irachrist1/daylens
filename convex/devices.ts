import {
  internalQuery,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { requireSessionIdentity } from "./authHelpers";

export const listByWorkspace = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireSessionIdentity(ctx);
    return await ctx.db
      .query("devices")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", identity.workspaceId)
      )
      .take(50);
  },
});

export const remove = mutation({
  args: {
    deviceId: v.id("devices"),
  },
  handler: async (ctx, args) => {
    const identity = await requireSessionIdentity(ctx);
    const device = await ctx.db.get(args.deviceId);

    if (!device || device.workspaceId !== identity.workspaceId) {
      throw new Error("Unauthorized");
    }

    await ctx.db.delete(args.deviceId);
  },
});

export const upsertForWorkspace = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    platform: v.union(
      v.literal("macos"),
      v.literal("windows"),
      v.literal("linux"),
      v.literal("web")
    ),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("devices")
      .withIndex("by_workspace_and_device", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("deviceId", args.deviceId)
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        platform: args.platform,
        displayName: args.displayName,
        lastSyncAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("devices", {
      workspaceId: args.workspaceId,
      deviceId: args.deviceId,
      platform: args.platform,
      displayName: args.displayName,
      lastSyncAt: Date.now(),
    });
  },
});

export const listForWorkspace = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("devices")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(100);
  },
});

export const getByWorkspaceAndDeviceId = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("devices")
      .withIndex("by_workspace_and_device", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("deviceId", args.deviceId)
      )
      .unique();
  },
});
