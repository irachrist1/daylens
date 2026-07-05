import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const checkAndIncrement = internalMutation({
  args: {
    namespace: v.string(),
    key: v.string(),
    limit: v.number(),
    windowMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const windowStart = Math.floor(now / args.windowMs) * args.windowMs;
    const bucketKey = `${args.namespace}:${args.key}:${windowStart}`;
    const bucket = await ctx.db
      .query("http_rate_limits")
      .withIndex("by_key", (q) => q.eq("key", bucketKey))
      .unique();
    const expiresAt = windowStart + args.windowMs;

    if (!bucket) {
      await ctx.db.insert("http_rate_limits", {
        key: bucketKey,
        count: 1,
        expiresAt,
      });

      return {
        allowed: true,
        remaining: Math.max(0, args.limit - 1),
        retryAfterMs: 0,
      };
    }

    if (bucket.count >= args.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, bucket.expiresAt - now),
      };
    }

    await ctx.db.patch(bucket._id, {
      count: bucket.count + 1,
    });

    return {
      allowed: true,
      remaining: Math.max(0, args.limit - (bucket.count + 1)),
      retryAfterMs: 0,
    };
  },
});
