import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { requireSessionIdentity } from "./authHelpers";
import type { Id } from "./_generated/dataModel";
import {
  createWorkspaceMessageId,
  createWorkspaceThreadId,
  type WorkspaceAIMessage,
  type WorkspaceAIThread,
} from "@daylens/remote-contract";

function normalizeThreadTitle(title?: string | null) {
  const trimmed = title?.trim();
  if (!trimmed) return "New chat";
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

function titleFromPrompt(prompt: string) {
  return normalizeThreadTitle(
    prompt
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[?.!]+$/, "")
      .slice(0, 80)
  );
}

async function loadThreadDoc(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  workspaceThreadId: string,
) {
  return ctx.db
    .query("web_ai_threads")
    .withIndex("by_workspace_thread", (q) =>
      q.eq("workspaceId", workspaceId).eq("workspaceThreadId", workspaceThreadId)
    )
    .unique();
}

export const ensureThread = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    workspaceThreadId: v.optional(v.string()),
    title: v.optional(v.union(v.string(), v.null())),
    source: v.union(v.literal("desktop"), v.literal("web")),
  },
  handler: async (ctx, args): Promise<WorkspaceAIThread> => {
    const now = Date.now();
    const workspaceThreadId = args.workspaceThreadId ?? createWorkspaceThreadId();
    const title = normalizeThreadTitle(args.title);
    const existing = await loadThreadDoc(ctx, args.workspaceId, workspaceThreadId);

    if (existing) {
      const nextTitle = existing.title === "New chat" && title !== "New chat"
        ? title
        : existing.title;
      await ctx.db.patch(existing._id, {
        title: nextTitle,
        updatedAt: now,
        archived: false,
        thread: {
          ...existing.thread,
          title: nextTitle,
          updatedAt: now,
          archived: false,
        },
      });
      return {
        ...existing.thread,
        title: nextTitle,
        updatedAt: now,
        archived: false,
      };
    }

    const thread: WorkspaceAIThread = {
      workspaceThreadId,
      title,
      source: args.source,
      createdAt: now,
      updatedAt: now,
      archived: false,
    };

    await ctx.db.insert("web_ai_threads", {
      workspaceId: args.workspaceId,
      workspaceThreadId,
      title: thread.title,
      source: thread.source,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      archived: thread.archived,
      thread,
    });

    return thread;
  },
});

export const appendTurn = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    workspaceThreadId: v.string(),
    userContent: v.string(),
    assistantContent: v.string(),
    provider: v.union(v.string(), v.null()),
    model: v.union(v.string(), v.null()),
    failureReason: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const threadDoc = await loadThreadDoc(ctx, args.workspaceId, args.workspaceThreadId);
    if (!threadDoc) {
      throw new Error("Unknown AI thread");
    }

    const now = Date.now();
    const userMessage: WorkspaceAIMessage = {
      workspaceMessageId: createWorkspaceMessageId(),
      workspaceThreadId: args.workspaceThreadId,
      role: "user",
      content: args.userContent,
      createdAt: now,
      provider: null,
      model: null,
      failureReason: null,
    };
    const assistantMessage: WorkspaceAIMessage = {
      workspaceMessageId: createWorkspaceMessageId(),
      workspaceThreadId: args.workspaceThreadId,
      role: "assistant",
      content: args.assistantContent,
      createdAt: now + 1,
      provider: args.provider,
      model: args.model,
      failureReason: args.failureReason,
    };

    await ctx.db.insert("web_ai_messages", {
      workspaceId: args.workspaceId,
      threadId: args.workspaceThreadId,
      workspaceMessageId: userMessage.workspaceMessageId,
      createdAt: userMessage.createdAt,
      message: userMessage,
    });
    await ctx.db.insert("web_ai_messages", {
      workspaceId: args.workspaceId,
      threadId: args.workspaceThreadId,
      workspaceMessageId: assistantMessage.workspaceMessageId,
      createdAt: assistantMessage.createdAt,
      message: assistantMessage,
    });

    const nextTitle = threadDoc.title === "New chat"
      ? titleFromPrompt(args.userContent)
      : threadDoc.title;

    await ctx.db.patch(threadDoc._id, {
      title: nextTitle,
      updatedAt: assistantMessage.createdAt,
      archived: false,
      thread: {
        ...threadDoc.thread,
        title: nextTitle,
        updatedAt: assistantMessage.createdAt,
        archived: false,
      },
    });

    return {
      thread: {
        ...threadDoc.thread,
        title: nextTitle,
        updatedAt: assistantMessage.createdAt,
        archived: false,
      },
      messages: [userMessage, assistantMessage],
    };
  },
});

export const listThreads = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireSessionIdentity(ctx);
    const docs = await ctx.db
      .query("web_ai_threads")
      .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", identity.workspaceId))
      .order("desc")
      .take(20);

    return docs
      .filter((doc) => !doc.archived)
      .map((doc) => doc.thread);
  },
});

export const archiveThread = mutation({
  args: {
    workspaceThreadId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireSessionIdentity(ctx);
    const threadDoc = await ctx.db
      .query("web_ai_threads")
      .withIndex("by_workspace_thread", (q) =>
        q.eq("workspaceId", identity.workspaceId).eq("workspaceThreadId", args.workspaceThreadId)
      )
      .unique();

    if (!threadDoc) {
      return { ok: false };
    }

    const updatedAt = Date.now();
    await ctx.db.patch(threadDoc._id, {
      updatedAt,
      archived: true,
      thread: {
        ...threadDoc.thread,
        updatedAt,
        archived: true,
      },
    });

    return { ok: true };
  },
});

export const getLatestThread = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireSessionIdentity(ctx);
    const threadDoc = (await ctx.db
      .query("web_ai_threads")
      .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", identity.workspaceId))
      .order("desc")
      .take(20))
      .find((doc) => !doc.archived);

    if (!threadDoc) {
      return { thread: null, messages: [] as WorkspaceAIMessage[] };
    }

    const messageDocs = await ctx.db
      .query("web_ai_messages")
      .withIndex("by_workspace_thread", (q) =>
        q.eq("workspaceId", identity.workspaceId).eq("threadId", threadDoc.workspaceThreadId)
      )
      .take(200);

    return {
      thread: threadDoc.thread,
      messages: messageDocs
        .map((doc) => doc.message)
        .sort((left, right) => left.createdAt - right.createdAt),
    };
  },
});

export const getThread = query({
  args: {
    workspaceThreadId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireSessionIdentity(ctx);
    const threadDoc = await ctx.db
      .query("web_ai_threads")
      .withIndex("by_workspace_thread", (q) =>
        q.eq("workspaceId", identity.workspaceId).eq("workspaceThreadId", args.workspaceThreadId)
      )
      .unique();

    if (!threadDoc) {
      return { thread: null, messages: [] as WorkspaceAIMessage[] };
    }

    const messageDocs = await ctx.db
      .query("web_ai_messages")
      .withIndex("by_workspace_thread", (q) =>
        q.eq("workspaceId", identity.workspaceId).eq("threadId", args.workspaceThreadId)
      )
      .take(200);

    return {
      thread: threadDoc.thread,
      messages: messageDocs
        .map((doc) => doc.message)
        .sort((left, right) => left.createdAt - right.createdAt),
    };
  },
});
