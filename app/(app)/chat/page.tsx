import { redirect } from "next/navigation";
import { GlobalChat } from "@/app/components/GlobalChat";
import { getConvexClient } from "@/app/lib/convex";
import { getSession } from "@/app/lib/session";
import { api } from "../../../convex/_generated/api";
import type { ChatMessage } from "@/app/lib/chat";
import type { WorkspaceAIMessage } from "../../../packages/remote-contract";
import { appPath } from "@/app/lib/basePath";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[]; prompt?: string | string[]; thread?: string | string[]; range?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect(appPath("/"));
  }

  const client = getConvexClient(session.token);
  const resolvedSearchParams = await searchParams;
  const dateParam = resolvedSearchParams?.date;
  const promptParam = resolvedSearchParams?.prompt;
  const threadParam = resolvedSearchParams?.thread;
  const rangeParam = resolvedSearchParams?.range;
  const date =
    typeof dateParam === "string"
      ? dateParam
      : Array.isArray(dateParam)
        ? dateParam[0]
        : undefined;
  const prompt =
    typeof promptParam === "string"
      ? promptParam
      : Array.isArray(promptParam)
        ? promptParam[0]
        : undefined;
  const selectedThreadId =
    typeof threadParam === "string"
      ? threadParam
      : Array.isArray(threadParam)
        ? threadParam[0]
        : undefined;
  const range =
    typeof rangeParam === "string"
      ? rangeParam
      : Array.isArray(rangeParam)
        ? rangeParam[0]
        : undefined;

  const threadPayload = selectedThreadId
    ? await client.query(api.webAiThreads.getThread, {
        workspaceThreadId: selectedThreadId,
      })
    : await client.query(api.webAiThreads.getLatestThread, {});

  const initialMessages: ChatMessage[] = (threadPayload.messages as WorkspaceAIMessage[]).map((message) => ({
    role: message.role === "system" ? "assistant" : message.role,
    content: message.content,
    timestamp: new Date(message.createdAt).toISOString(),
  }));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-4 sm:px-6 sm:py-6">
      <GlobalChat
        initialMessages={initialMessages}
        initialThreadId={threadPayload.thread?.workspaceThreadId ?? null}
        date={date}
        range={range === "week" || range === "month" ? range : "day"}
        initialPrompt={prompt}
      />
    </div>
  );
}
