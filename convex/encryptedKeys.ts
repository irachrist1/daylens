import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireSessionIdentity } from "./authHelpers";

export const getByWorkspace = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("encrypted_keys")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", args.workspaceId)
      )
      .first();
  },
});

export const getKeyStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireSessionIdentity(ctx);
    const existing = await ctx.db
      .query("encrypted_keys")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", identity.workspaceId)
      )
      .first();

    if (!existing) {
      return { hasKey: false, updatedAt: null as number | null };
    }

    return {
      hasKey: true,
      updatedAt: existing.updatedAt ?? null,
    };
  },
});

export const deleteAnthropicKey = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireSessionIdentity(ctx);
    const existing = await ctx.db
      .query("encrypted_keys")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", identity.workspaceId)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    return { ok: true as const };
  },
});
