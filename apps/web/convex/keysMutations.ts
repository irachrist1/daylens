import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const upsertEncryptedKey = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    encryptedAnthropicKey: v.string(),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("encrypted_keys")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", args.workspaceId)
      )
      .first();

    const updatedAt = args.updatedAt ?? Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        encryptedAnthropicKey: args.encryptedAnthropicKey,
        updatedAt,
      });
    } else {
      await ctx.db.insert("encrypted_keys", {
        workspaceId: args.workspaceId,
        encryptedAnthropicKey: args.encryptedAnthropicKey,
        updatedAt,
      });
    }
  },
});
