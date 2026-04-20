"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { decrypt } from "./keys";
import {
  SYSTEM_PROMPT,
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

export const askQuestion = action({
  args: {
    question: v.string(),
    date: v.string(),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AskQuestionResult> => {
    const identity = await requireSessionIdentity(ctx);
    const snapshotDoc = await ctx.runQuery(internal.remoteSync.getTimelineDayForWorkspace, {
      workspaceId: identity.workspaceId,
      localDate: args.date,
    });

    if (!snapshotDoc?.snapshot) {
      return { response: "No activity data found for this date." };
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
      return {
        response:
          "No API key configured. Add your Anthropic API key in Daylens settings in your desktop app.",
      };
    }

    // Build prompt using the shared prompt builder
    const activityContext = buildDayContext(snapshotDoc.snapshot);
    const userPrompt = questionPrompt(args.question, activityContext);

    // Call Anthropic API
    const client = new Anthropic({ apiKey: anthropicKey });
    const model = "claude-sonnet-4-20250514";
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
