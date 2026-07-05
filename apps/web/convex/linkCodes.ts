import { action, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

const LINK_CODE_TTL_MS = 5 * 60 * 1000;
const LOCK_AFTER_THREE_ATTEMPTS_MS = 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_AFTER_FIVE_ATTEMPTS_MS = 10 * 60 * 1000;
const MAX_ACTIVE_CODES_PER_WORKSPACE = 3;

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getDisplayCode(token: string): string {
  return normalizeToken(token).slice(0, 8).toUpperCase();
}

function isExpired(linkCode: Doc<"link_codes">): boolean {
  return linkCode.expiresAt <= Date.now();
}

function isLocked(linkCode: Doc<"link_codes">): boolean {
  return typeof linkCode.lockedUntil === "number" && linkCode.lockedUntil > Date.now();
}

function nextLockUntil(failedAttempts: number, now: number): number | undefined {
  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    return now + LOCK_AFTER_FIVE_ATTEMPTS_MS;
  }

  if (failedAttempts >= 3) {
    return now + LOCK_AFTER_THREE_ATTEMPTS_MS;
  }

  return undefined;
}

function lockErrorMessage(lockedUntil: number): string {
  const remainingMs = Math.max(0, lockedUntil - Date.now());
  const remainingMinutes = Math.ceil(remainingMs / 60_000);

  return remainingMinutes >= 10
    ? "Too many attempts. Try again in 10 minutes."
    : "Too many attempts. Try again in 1 minute.";
}

export const create = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    tokenHash: v.string(),
    displayCode: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("link_codes")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(20);

    const now = Date.now();
    const activeCodes = existing.filter((linkCode) => !isExpired(linkCode));

    for (const linkCode of existing.filter((linkCode) => isExpired(linkCode))) {
      await ctx.db.delete(linkCode._id);
    }

    const surplus = activeCodes.length - (MAX_ACTIVE_CODES_PER_WORKSPACE - 1);
    if (surplus > 0) {
      for (const linkCode of activeCodes.slice(0, surplus)) {
        await ctx.db.delete(linkCode._id);
      }
    }

    const expiresAt = now + LINK_CODE_TTL_MS;
    await ctx.db.insert("link_codes", {
      workspaceId: args.workspaceId,
      tokenHash: args.tokenHash,
      displayCode: args.displayCode,
      expiresAt,
      failedAttempts: 0,
      lockedUntil: undefined,
    });

    return { displayCode: args.displayCode, expiresAt };
  },
});

export const redeem = internalMutation({
  args: {
    token: v.string(),
    deviceId: v.string(),
    platform: v.literal("web"),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedToken = normalizeToken(args.token);
    if (!/^[0-9a-f]{32}$/.test(normalizedToken)) {
      return { success: false as const, error: "Invalid code" };
    }

    const displayCode = getDisplayCode(normalizedToken);
    const tokenHash = await hashToken(normalizedToken);
    const candidates = await ctx.db
      .query("link_codes")
      .withIndex("by_display_code", (q) => q.eq("displayCode", displayCode))
      .take(10);

    const activeCandidates = candidates.filter((candidate) => !isExpired(candidate));
    for (const expired of candidates.filter((candidate) => isExpired(candidate))) {
      await ctx.db.delete(expired._id);
    }

    const lockedCandidate = activeCandidates.find(isLocked);
    if (lockedCandidate?.lockedUntil) {
      return {
        success: false as const,
        error: lockErrorMessage(lockedCandidate.lockedUntil),
      };
    }

    const match = activeCandidates.find((candidate) => candidate.tokenHash === tokenHash);
    if (!match) {
      const target = activeCandidates[0];
      if (target) {
        const now = Date.now();
        const failedAttempts = target.failedAttempts + 1;
        await ctx.db.patch(target._id, {
          failedAttempts,
          lockedUntil: nextLockUntil(failedAttempts, now),
        });
      }
      return { success: false as const, error: "Invalid or expired code" };
    }

    await ctx.runMutation(internal.devices.upsertForWorkspace, {
      workspaceId: match.workspaceId,
      deviceId: args.deviceId,
      platform: args.platform,
      displayName: args.displayName,
    });

    await ctx.db.delete(match._id);

    return {
      success: true as const,
      workspaceId: match.workspaceId,
      deviceId: args.deviceId,
    };
  },
});

export const redeemAndIssueSession = action({
  args: {
    token: v.string(),
    deviceId: v.string(),
    displayName: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    | { success: true; token: string; expiresAt: number }
    | { success: false; error: string }
  > => {
    const redeemed: {
      success: boolean;
      error?: string;
      workspaceId?: Doc<"link_codes">["workspaceId"];
      deviceId?: string;
    } = await ctx.runMutation(internal.linkCodes.redeem, {
      token: args.token,
      deviceId: args.deviceId,
      platform: "web",
      displayName: args.displayName,
    });

    if (!redeemed.success || !redeemed.workspaceId || !redeemed.deviceId) {
      return { success: false as const, error: redeemed.error ?? "Invalid code" };
    }

    const session: { token: string; expiresAt: number } = await ctx.runAction(
      internal.sessionTokens.issue,
      {
      workspaceId: redeemed.workspaceId,
      deviceId: redeemed.deviceId,
      sessionKind: "web",
      }
    );

    return {
      success: true as const,
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }
});
