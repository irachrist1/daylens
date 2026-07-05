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
import type { WorkspaceAIThread } from "@daylens/remote-contract";
import { DEFAULT_MODEL_ID, isAllowedModel } from "../packages/ai-models/index";
import { requireSessionIdentity } from "./authHelpers";

type AskRange = "day" | "week" | "month";

type AskQuestionCode =
  | "no_data"
  | "missing_key"
  | "billing_exhausted"
  | "rate_limited"
  | "model_not_allowed"
  | "service_updating";

type ModelChatMessage = {
  role: "user" | "assistant";
  content: string;
};

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
const MAX_MODEL_MESSAGE_CHARS = 4_000;

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
  | { code: "missing_key" | "billing_exhausted" | "rate_limited" | "service_updating"; message: string }
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

  if (status === 403 || status >= 500) {
    return {
      code: "service_updating",
      message:
        "The AI service is temporarily unavailable. Please try again in a minute.",
    };
  }

  return null;
}

function boundedModelMessages(messages: ModelChatMessage[] | undefined, question: string): ModelChatMessage[] {
  const trimmed = (messages ?? [])
    .filter((message) => message.content.trim().length > 0)
    .slice(-20)
    .map((message) => ({
      ...message,
      content: message.content.length > MAX_MODEL_MESSAGE_CHARS
        ? `${message.content.slice(0, MAX_MODEL_MESSAGE_CHARS - 32)}\n[message truncated]`
        : message.content,
    }));
  if (trimmed.at(-1)?.role === "user" && trimmed.at(-1)?.content.trim() === question.trim()) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

export const askQuestion = action({
  args: {
    question: v.string(),
    date: v.string(),
    range: v.optional(v.union(v.literal("day"), v.literal("week"), v.literal("month"))),
    threadId: v.optional(v.string()),
    model: v.optional(v.string()),
    messages: v.optional(v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
    }))),
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
    const modelMessages = boundedModelMessages(args.messages, args.question);

    const client = new Anthropic({ apiKey: anthropicKey });

    let responseText: string;
    try {
      const message = await client.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [...modelMessages, { role: "user", content: userPrompt }],
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

const SURFACE_RATE_LIMIT_NAMESPACE = "ai:surface";
const SURFACE_MAX_OUTPUT_TOKENS = 32000;

type SurfaceSummaryResult =
  | { ok: true; text: string; provider: "anthropic"; model: string }
  | { ok: false; code: AskQuestionCode; message: string };

// R6: server-side generation for the desktop's AI surfaces (app narrative,
// week review, day summary). The desktop builds the full prompt locally and
// sends it here so a user without a local Anthropic key can still generate via
// the workspace key. No snapshot or thread dependency — the prompt is
// self-contained — which is what separates this from askQuestion.
export const generateSurfaceSummary = action({
  args: {
    system: v.string(),
    userContent: v.string(),
    maxTokens: v.optional(v.number()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SurfaceSummaryResult> => {
    const identity = await requireSessionIdentity(ctx);

    const rateLimit = (await ctx.runMutation(internal.httpRateLimits.checkAndIncrement, {
      namespace: SURFACE_RATE_LIMIT_NAMESPACE,
      key: identity.workspaceId,
      limit: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
    })) as { allowed: boolean; retryAfterMs: number };

    if (!rateLimit.allowed) {
      return {
        ok: false,
        code: "rate_limited",
        message:
          "You've hit the hourly AI limit for this workspace. Try again in a few minutes.",
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

    const userContent = args.userContent.trim();
    if (!userContent) {
      return { ok: false, code: "no_data", message: "No evidence was provided to summarize." };
    }

    // Key resolution mirrors askQuestion: workspace-encrypted first, server env
    // fallback. Never echo the decryption reason.
    let anthropicKey: string | undefined;
    try {
      const keyDocs = await ctx.runQuery(internal.encryptedKeys.getByWorkspace, {
        workspaceId: identity.workspaceId,
      });
      if (keyDocs) {
        anthropicKey = decrypt(keyDocs.encryptedAnthropicKey, identity.workspaceId);
      }
    } catch {
      // Fall through to the shared env key.
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

    const maxTokens = Math.max(
      256,
      Math.min(args.maxTokens ?? SURFACE_MAX_OUTPUT_TOKENS, SURFACE_MAX_OUTPUT_TOKENS),
    );
    const client = new Anthropic({ apiKey: anthropicKey });

    try {
      const message = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: args.system,
        messages: [{ role: "user", content: userContent }],
      });
      const text = message.content[0]?.type === "text" ? message.content[0].text : "";
      return { ok: true, text, provider: "anthropic", model };
    } catch (error) {
      const classified = classifyAnthropicError(error);
      if (classified) {
        return { ok: false, ...classified };
      }
      throw error;
    }
  },
});
