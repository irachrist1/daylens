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
import { DEFAULT_MODEL_ID, isAllowedModel } from "../packages/ai-models/index";
import { requireSessionIdentity } from "./authHelpers";

type AskRange = "day" | "week" | "month";

type AskQuestionCode =
  | "no_data"
  | "missing_key"
  | "billing_exhausted"
  | "rate_limited"
  | "model_not_allowed";

type AskQuestionResult =
  | {
      ok: true;
      response: string;
      threadId: string;
      provider: "anthropic";
      model: string;
    }
  | { ok: false; code: AskQuestionCode; message: string };

const RATE_LIMIT_NAMESPACE = "ai:ask";
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

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

function classifyAnthropicError(error: unknown):
  | { code: "missing_key" | "billing_exhausted" | "rate_limited"; message: string }
  | null {
  if (!(error instanceof Anthropic.APIError)) return null;

  const status = error.status;
  const rawMessage = typeof error.message === "string" ? error.message : "";
  const lower = rawMessage.toLowerCase();

  if (status === 401) {
    return {
      code: "missing_key",
      message:
        "Your Anthropic API key was rejected. Open Settings → AI Provider and save a fresh key.",
    };
  }

  if (
    status === 400 &&
    (lower.includes("credit balance") ||
      lower.includes("insufficient credits") ||
      lower.includes("purchase credits"))
  ) {
    return {
      code: "billing_exhausted",
      message:
        "Your Anthropic account is out of credits. Top up that key or switch providers.",
    };
  }

  if (status === 429 || lower.includes("overloaded_error")) {
    return {
      code: "rate_limited",
      message:
        "The AI provider is rate-limiting this workspace right now. Try again in a few minutes.",
    };
  }

  return null;
}

export const askQuestion = action({
  args: {
    question: v.string(),
    date: v.string(),
    range: v.optional(v.union(v.literal("day"), v.literal("week"), v.literal("month"))),
    threadId: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AskQuestionResult> => {
    const identity = await requireSessionIdentity(ctx);

    // Per-workspace rate limit. Shared env key and BYO key both gated here.
    const rateLimit = (await ctx.runMutation(internal.httpRateLimits.checkAndIncrement, {
      namespace: RATE_LIMIT_NAMESPACE,
      key: identity.workspaceId,
      limit: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
    })) as { allowed: boolean; retryAfterMs: number };

    if (!rateLimit.allowed) {
      return {
        ok: false,
        code: "rate_limited",
        message:
          "You've hit the hourly question limit for this workspace. Try again in a few minutes.",
      };
    }

    const requestedModel = args.model?.trim();
    if (requestedModel && !isAllowedModel(requestedModel)) {
      return {
        ok: false,
        code: "model_not_allowed",
        message: "That model isn't available on Daylens yet. Pick another in Settings.",
      };
    }
    const model = requestedModel || DEFAULT_MODEL_ID;

    const range = args.range ?? "day";
    const { startDate, endDate } = getRangeBounds(args.date, range);
    const snapshotDocs =
      range === "day"
        ? [
            await ctx.runQuery(internal.remoteSync.getTimelineDayForWorkspace, {
              workspaceId: identity.workspaceId,
              localDate: args.date,
            }),
          ]
        : await ctx.runQuery(internal.remoteSync.getTimelineRangeForWorkspace, {
            workspaceId: identity.workspaceId,
            startDate,
            endDate,
          });

    const snapshots = snapshotDocs
      .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc?.snapshot))
      .map((doc) => doc.snapshot);

    if (snapshots.length === 0) {
      return {
        ok: false,
        code: "no_data",
        message: `No activity data was synced for ${args.date} yet. Open Daylens on your computer so it can sync that day.`,
      };
    }

    // Key resolution: workspace-encrypted first, then server env as fallback.
    let anthropicKey: string | undefined;
    try {
      const keyDocs = await ctx.runQuery(internal.encryptedKeys.getByWorkspace, {
        workspaceId: identity.workspaceId,
      });
      if (keyDocs) {
        anthropicKey = decrypt(
          keyDocs.encryptedAnthropicKey,
          identity.workspaceId,
        );
      }
    } catch {
      // Decryption failed (e.g. CONVEX_ENCRYPTION_SECRET rotated). Fall through
      // to the shared env key. Never echo the reason.
    }

    if (!anthropicKey) {
      anthropicKey = process.env.ANTHROPIC_API_KEY;
    }

    if (!anthropicKey) {
      return {
        ok: false,
        code: "missing_key",
        message:
          "No Anthropic key is configured. Open Settings → AI Provider and save one.",
      };
    }

    const activityContext =
      range === "day"
        ? buildDayContext(snapshots[0])
        : buildRangeContext(rangeLabel(args.date, range), snapshots);
    const userPrompt = questionPrompt(args.question, activityContext);

    const client = new Anthropic({ apiKey: anthropicKey });

    let responseText: string;
    try {
      const message = await client.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      });
      responseText =
        message.content[0].type === "text" ? message.content[0].text : "";
    } catch (error) {
      const classified = classifyAnthropicError(error);
      if (classified) {
        return { ok: false, ...classified };
      }
      throw error;
    }

    const thread: WorkspaceAIThread = await ctx.runMutation(
      internal.webAiThreads.ensureThread,
      {
        workspaceId: identity.workspaceId,
        workspaceThreadId: args.threadId,
        title: args.question,
        source: "web",
      },
    );

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
      ok: true,
      response: responseText,
      threadId: thread.workspaceThreadId,
      provider: "anthropic",
      model,
    };
  },
});
