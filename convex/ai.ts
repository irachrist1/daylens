"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { decrypt } from "./keys";
import {
  SYSTEM_PROMPT,
  buildRangeContext,
  buildDayContext,
  questionPrompt,
} from "../packages/prompt-builder/index";
import type { WorkspaceAIThread } from "../packages/remote-contract/index";
import { requireSessionIdentity } from "./authHelpers";

type AskQuestionResult = {
  response: string;
  threadId?: string;
  provider?: string;
  model?: string;
};

type AskRange = "day" | "week" | "month";

function toDateKey(date: Date) {
  return date.toLocaleDateString("en-CA");
}

function getRangeBounds(localDate: string, range: AskRange) {
  const next = new Date(`${localDate}T12:00:00`);
  if (range === "week") {
    const day = next.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    next.setDate(next.getDate() + diff);
    const startDate = toDateKey(next);
    next.setDate(next.getDate() + 6);
    return { startDate, endDate: toDateKey(next) };
  }

  if (range === "month") {
    next.setDate(1);
    const startDate = toDateKey(next);
    next.setMonth(next.getMonth() + 1, 0);
    return { startDate, endDate: toDateKey(next) };
  }

  return { startDate: localDate, endDate: localDate };
}

function rangeLabel(localDate: string, range: AskRange) {
  const date = new Date(`${localDate}T12:00:00`);
  if (range === "week") {
    const { startDate, endDate } = getRangeBounds(localDate, range);
    return `the week of ${startDate} through ${endDate}`;
  }
  if (range === "month") {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export const askQuestion = action({
  args: {
    question: v.string(),
    date: v.string(),
    range: v.optional(v.union(v.literal("day"), v.literal("week"), v.literal("month"))),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AskQuestionResult> => {
    const identity = await requireSessionIdentity(ctx);
    const range = args.range ?? "day";
    const { startDate, endDate } = getRangeBounds(args.date, range);
    const snapshotDocs = range === "day"
      ? [await ctx.runQuery(internal.remoteSync.getTimelineDayForWorkspace, {
          workspaceId: identity.workspaceId,
          localDate: args.date,
        })]
      : await ctx.runQuery(internal.remoteSync.getTimelineRangeForWorkspace, {
          workspaceId: identity.workspaceId,
          startDate,
          endDate,
        });

    const snapshots = snapshotDocs
      .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc?.snapshot))
      .map((doc) => doc.snapshot);

    if (snapshots.length === 0) {
      throw new Error("No activity data found for this date.");
    }

    // Load API key: try user's encrypted key first, fall back to server key
    let anthropicKey: string | undefined;

    try {
      const keyDocs = await ctx.runQuery(internal.encryptedKeys.getByWorkspace, {
        workspaceId: identity.workspaceId,
      });

      if (keyDocs) {
        anthropicKey = decrypt(
          keyDocs.encryptedAnthropicKey,
          identity.workspaceId
        );
      }
    } catch {
      // Decryption failed — fall through to server key
    }

    if (!anthropicKey) {
      anthropicKey = process.env.ANTHROPIC_API_KEY;
    }

    if (!anthropicKey) {
      throw new Error("API key missing for Anthropic.");
    }

    // Build prompt using the shared prompt builder
    const activityContext = range === "day"
      ? buildDayContext(snapshots[0])
      : buildRangeContext(rangeLabel(args.date, range), snapshots);
    const userPrompt = questionPrompt(args.question, activityContext);

    // Call Anthropic API
    const client = new Anthropic({ apiKey: anthropicKey });
    const model = "claude-sonnet-4-5";
    const message = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";

    const thread: WorkspaceAIThread = await ctx.runMutation(internal.webAiThreads.ensureThread, {
      workspaceId: identity.workspaceId,
      workspaceThreadId: args.threadId,
      title: args.question,
      source: "web",
    });

    await ctx.runMutation(internal.webAiThreads.appendTurn, {
      workspaceId: identity.workspaceId,
      workspaceThreadId: thread.workspaceThreadId,
      userContent: args.question,
      assistantContent: responseText,
      provider: "anthropic",
      model,
      failureReason: null,
    });

    return {
      response: responseText,
      threadId: thread.workspaceThreadId,
      provider: "anthropic",
      model,
    };
  },
});
