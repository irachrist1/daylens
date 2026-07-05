import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

export const aiFeedbackExampleValidator = v.object({
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
});

export const storeExample = internalMutation({
  args: {
    payload: aiFeedbackExampleValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ai_feedback_examples")
      .withIndex("by_feedback_key", (q) => q.eq("feedbackKey", args.payload.feedbackKey))
      .unique();

    const record = {
      ...args.payload,
      receivedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, record);
      return { id: existing._id, updated: true };
    }

    const id = await ctx.db.insert("ai_feedback_examples", record);
    return { id, updated: false };
  },
});

export const adminList = query({
  args: {
    adminToken: v.string(),
    rating: v.optional(v.union(v.literal("up"), v.literal("down"))),
    answerKind: v.optional(v.string()),
    model: v.optional(v.string()),
    fromCreatedAt: v.optional(v.number()),
    toCreatedAt: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const configuredToken = process.env.DAYLENS_ADMIN_TOKEN;
    if (!configuredToken || args.adminToken !== configuredToken) {
      throw new Error("Unauthorized");
    }

    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const docs = args.rating
      ? await ctx.db
        .query("ai_feedback_examples")
        .withIndex("by_rating", (q) => q.eq("rating", args.rating!))
        .order("desc")
        .take(limit * 3)
      : await ctx.db
        .query("ai_feedback_examples")
        .withIndex("by_created")
        .order("desc")
        .take(limit * 3);

    return docs
      .filter((doc) => args.fromCreatedAt === undefined || doc.createdAt >= args.fromCreatedAt!)
      .filter((doc) => args.toCreatedAt === undefined || doc.createdAt <= args.toCreatedAt!)
      .filter((doc) => args.answerKind === undefined || doc.answerKind === args.answerKind)
      .filter((doc) => args.model === undefined || doc.model === args.model)
      .slice(0, limit);
  },
});
