"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireSessionIdentity } from "./authHelpers";

const ANTHROPIC_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

type SaveKeyResult =
  | { ok: true; updatedAt: number }
  | { ok: false; code: "invalid_format" };

export const saveAnthropicKey = action({
  args: {
    anthropicKey: v.string(),
  },
  handler: async (ctx, args): Promise<SaveKeyResult> => {
    const identity = await requireSessionIdentity(ctx);
    const trimmed = args.anthropicKey.trim();

    if (!ANTHROPIC_KEY_PATTERN.test(trimmed)) {
      return { ok: false, code: "invalid_format" };
    }

    const updatedAt = Date.now();
    await ctx.runAction(internal.keys.store, {
      workspaceId: identity.workspaceId,
      anthropicKey: trimmed,
      updatedAt,
    });

    return { ok: true, updatedAt };
  },
});
