"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatMessage } from "@/app/lib/chat";
import { apiPath, withBasePath } from "@/app/lib/basePath";
import { formatRelativeTime } from "@/app/lib/format";
import type {
  ArtifactRollup,
  RecapSummaryLite,
  WorkspaceAIArtifact,
  WorkspaceAIThread,
} from "../../packages/remote-contract";

type RecapPeriod = "day" | "week" | "month";
type ExportKind = "report" | "csv" | "chart";

type SnapshotRecapPayload = {
  recap: {
    day: RecapSummaryLite;
    week: RecapSummaryLite | null;
    month: RecapSummaryLite | null;
  } | null;
  coverageNote: string | null;
  standoutArtifacts: ArtifactRollup[];
};

function exportLabel(kind: ExportKind) {
  switch (kind) {
    case "csv":
      return "CSV export";
    case "chart":
      return "HTML chart";
    default:
      return "Shareable report";
  }
}

function artifactKindLabel(kind: WorkspaceAIArtifact["kind"]) {
  switch (kind) {
    case "csv":
      return "CSV";
    case "html_chart":
      return "HTML";
    case "json_table":
      return "JSON";
    case "report":
      return "Report";
    default:
      return "Markdown";
  }
}

function buildThreadHref(threadId: string, date?: string) {
  const params = new URLSearchParams();
  params.set("thread", threadId);
  if (date) params.set("date", date);
  return withBasePath(`/chat?${params.toString()}`);
}

export function GlobalChat({
  initialMessages,
  initialThreadId,
  date,
  initialPrompt,
}: {
  initialMessages: ChatMessage[];
  initialThreadId?: string | null;
  date?: string;
  initialPrompt?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId ?? null);
  const [threads, setThreads] = useState<WorkspaceAIThread[]>([]);
  const [artifacts, setArtifacts] = useState<WorkspaceAIArtifact[]>([]);
  const [snapshotRecap, setSnapshotRecap] = useState<SnapshotRecapPayload | null>(null);
  const [activeRecapPeriod, setActiveRecapPeriod] = useState<RecapPeriod>("day");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [artifactLoading, setArtifactLoading] = useState<ExportKind | null>(null);
  const [promptChips, setPromptChips] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const currentThread =
    threads.find((candidate) => candidate.workspaceThreadId === threadId) ?? null;
  const activeRecap =
    activeRecapPeriod === "day"
      ? snapshotRecap?.recap?.day ?? null
      : activeRecapPeriod === "week"
        ? snapshotRecap?.recap?.week ?? null
        : snapshotRecap?.recap?.month ?? null;

  async function refreshThreads() {
    const response = await fetch(apiPath("/api/ai-threads"));
    if (!response.ok) {
      throw new Error("Failed to load threads.");
    }
    const data = await response.json();
    setThreads(Array.isArray(data.threads) ? data.threads : []);
  }

  async function refreshArtifacts(nextThreadId: string | null) {
    const query = nextThreadId ? `?threadId=${encodeURIComponent(nextThreadId)}` : "";
    const response = await fetch(apiPath(`/api/ai-artifacts${query}`));
    if (!response.ok) {
      throw new Error("Failed to load artifacts.");
    }
    const data = await response.json();
    setArtifacts(Array.isArray(data.artifacts) ? data.artifacts : []);
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setMessages(initialMessages);
    setThreadId(initialThreadId ?? null);
  }, [initialMessages, initialThreadId]);

  useEffect(() => {
    if (!initialPrompt?.trim()) {
      return;
    }
    setInput(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    let cancelled = false;

    void refreshThreads().catch(() => {
      if (cancelled) return;
      setThreads([]);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshArtifacts(threadId).catch(() => {
      if (cancelled) return;
      setArtifacts([]);
    });

    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    if (!date) {
      setPromptChips([]);
      setSnapshotRecap(null);
      return;
    }

    let cancelled = false;
    void fetch(apiPath(`/api/snapshots?date=${date}`))
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        const snapshot = json?.snapshot?.snapshot;
        const chips = snapshot?.recap?.day?.promptChips;
        setPromptChips(Array.isArray(chips) ? chips : []);
        setSnapshotRecap(
          snapshot
            ? {
                recap: snapshot.recap ?? null,
                coverageNote: snapshot.coverage?.coverageNote ?? null,
                standoutArtifacts: Array.isArray(snapshot.standoutArtifacts)
                  ? snapshot.standoutArtifacts
                  : [],
              }
            : null
        );
      })
      .catch(() => {
        if (cancelled) return;
        setPromptChips([]);
        setSnapshotRecap(null);
      });

    return () => {
      cancelled = true;
    };
  }, [date]);

  async function sendMessage(content: string) {
    if (!content.trim() || loading) {
      return;
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: content.trim(),
      timestamp: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch(apiPath("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, date, threadId }),
      });
      const data = await response.json();

      if (!response.ok || typeof data.response !== "string") {
        throw new Error(data.error || "Something went wrong.");
      }

      const nextThreadId =
        typeof data.threadId === "string" && data.threadId.trim()
          ? data.threadId
          : threadId;
      if (nextThreadId) {
        setThreadId(nextThreadId);
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.response,
          timestamp: new Date().toISOString(),
          toolsUsed: Array.isArray(data.toolsUsed)
            ? data.toolsUsed.filter(
                (tool: unknown): tool is string => typeof tool === "string"
              )
            : undefined,
        },
      ]);
      await refreshThreads();
      await refreshArtifacts(nextThreadId ?? null);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "Something went wrong. Please try again.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function generateArtifact(kind: ExportKind) {
    if (artifactLoading || loading) {
      return;
    }

    setArtifactLoading(kind);
    try {
      const response = await fetch(apiPath("/api/ai-artifacts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          threadId,
          outputs: [kind],
        }),
      });
      const data = await response.json();

      if (!response.ok || typeof data.assistantContent !== "string") {
        throw new Error(data.error || "Couldn't generate the artifact.");
      }

      const nextThreadId =
        typeof data.threadId === "string" && data.threadId.trim()
          ? data.threadId
          : threadId;

      if (nextThreadId) {
        setThreadId(nextThreadId);
      }

      setMessages((current) => [
        ...current,
        {
          role: "user",
          content:
            typeof data.userContent === "string"
              ? data.userContent
              : `Create a ${exportLabel(kind).toLowerCase()}.`,
          timestamp: new Date().toISOString(),
        },
        {
          role: "assistant",
          content: data.assistantContent,
          timestamp: new Date().toISOString(),
        },
      ]);

      await refreshThreads();
      await refreshArtifacts(nextThreadId ?? null);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "Couldn't generate the artifact. Please try again.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setArtifactLoading(null);
    }
  }

  return (
    <div
      className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)] lg:grid-cols-[20rem_minmax(0,1fr)]"
      style={{ height: "calc(100dvh - 8rem)" }}
    >
      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        <section className="rounded-2xl glass-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-on-surface-variant">
                AI Workspace
              </p>
              <p className="mt-1 text-sm text-on-surface">
                {date ? `Grounded on ${date}` : "Grounded on your latest synced day"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setThreadId(null);
                setMessages([]);
                setInput("");
                inputRef.current?.focus();
                router.push(withBasePath(date ? `/chat?date=${date}` : "/chat"));
              }}
              className="rounded-full border border-outline-variant/20 px-3 py-1.5 text-xs text-on-surface hover:bg-surface-low"
            >
              New thread
            </button>
          </div>

          <div className="grid gap-2">
            {(["report", "csv", "chart"] as ExportKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => void generateArtifact(kind)}
                disabled={artifactLoading !== null || loading}
                className="flex items-center justify-between rounded-xl bg-surface-low px-3 py-2.5 text-left text-sm text-on-surface transition hover:bg-surface-high disabled:opacity-50"
              >
                <span>{exportLabel(kind)}</span>
                <span className="text-xs text-on-surface-variant">
                  {artifactLoading === kind ? "Generating..." : "Create"}
                </span>
              </button>
            ))}
          </div>
        </section>

        {activeRecap?.hasData ? (
          <section className="rounded-2xl glass-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-on-surface-variant">
                  Recap
                </p>
                <p className="mt-1 text-sm font-medium text-on-surface">
                  {activeRecapPeriod === "day"
                    ? "Daily"
                    : activeRecapPeriod === "week"
                      ? "Weekly"
                      : "Monthly"}{" "}
                  recap
                </p>
              </div>
              <div className="flex rounded-full bg-surface-low p-1">
                {(["day", "week", "month"] as RecapPeriod[]).map((period) => {
                  const available =
                    period === "day"
                      ? snapshotRecap?.recap?.day
                      : period === "week"
                        ? snapshotRecap?.recap?.week
                        : snapshotRecap?.recap?.month;
                  return (
                    <button
                      key={period}
                      type="button"
                      onClick={() => setActiveRecapPeriod(period)}
                      disabled={!available}
                      className={`rounded-full px-2.5 py-1 text-xs transition ${
                        activeRecapPeriod === period
                          ? "bg-primary text-on-primary"
                          : "text-on-surface-variant"
                      } disabled:opacity-30`}
                    >
                      {period}
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="break-words text-sm leading-relaxed text-on-surface/90">
              {activeRecap.headline}
            </p>

            {snapshotRecap?.coverageNote ? (
              <div className="rounded-xl bg-warning/10 px-3 py-2 text-sm text-on-surface/85">
                {snapshotRecap.coverageNote}
              </div>
            ) : null}

            {activeRecap.metrics.length > 0 ? (
              <div className="grid gap-2">
                {activeRecap.metrics.slice(0, 2).map((metric) => (
                  <div key={metric.label} className="rounded-xl bg-surface-low px-3 py-2.5">
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-on-surface-variant">
                      {metric.label}
                    </p>
                  <p className="mt-1 break-words text-sm font-semibold text-on-surface">
                    {metric.value}
                  </p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {metric.detail}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="space-y-2">
              {activeRecap.chapters.slice(0, 2).map((chapter) => (
                <div key={chapter.id} className="rounded-xl bg-surface-low px-3 py-2.5">
                  <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-on-surface-variant">
                    {chapter.eyebrow}
                  </p>
                  <p className="mt-1 break-words text-sm font-semibold text-on-surface">
                    {chapter.title}
                  </p>
                  <p className="mt-1 break-words text-xs leading-relaxed text-on-surface/85">
                    {chapter.body}
                  </p>
                </div>
              ))}
            </div>

            {snapshotRecap?.standoutArtifacts.length ? (
              <div className="space-y-2">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-on-surface-variant">
                  Synced evidence
                </p>
                <div className="space-y-2">
                  {snapshotRecap.standoutArtifacts.slice(0, 3).map((artifact) => (
                    <div key={artifact.id} className="rounded-xl bg-surface-low px-3 py-2.5">
                      <p className="line-clamp-2 break-words text-sm font-medium text-on-surface">
                        {artifact.title}
                      </p>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        {artifact.kind}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {promptChips.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {promptChips.slice(0, 4).map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => {
                      setInput(chip);
                      inputRef.current?.focus();
                    }}
                    className="rounded-full bg-surface-low px-3 py-1.5 text-xs text-on-surface hover:bg-surface-high"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : (
          <section className="rounded-2xl glass-card p-4 space-y-2">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-on-surface-variant">
              Recap
            </p>
            <p className="text-sm text-on-surface">
              No clean synced recap is available for this day yet.
            </p>
            <p className="text-xs leading-relaxed text-on-surface-variant">
              Daylens will show recap beats here once the synced day contains enough privacy-safe evidence.
            </p>
          </section>
        )}

        <section className="rounded-2xl glass-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-on-surface-variant">
                Artifacts
              </p>
              <p className="mt-1 text-sm text-on-surface">
                {threadId ? "Generated in this thread" : "Recent AI artifacts"}
              </p>
            </div>
            <span className="text-xs text-on-surface-variant">
              {artifacts.length}
            </span>
          </div>

          {artifacts.length === 0 ? (
            <p className="text-sm text-on-surface-variant">
              Create a report, CSV export, or chart to persist it here.
            </p>
          ) : (
            <div className="space-y-2">
              {artifacts.map((artifact) => (
                <div key={artifact.workspaceArtifactId} className="rounded-xl bg-surface-low px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="line-clamp-2 break-words text-sm font-medium text-on-surface">
                        {artifact.title}
                      </p>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        {artifactKindLabel(artifact.kind)} · {formatRelativeTime(artifact.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-xs">
                    <a
                      href={apiPath(`/api/ai-artifacts/${artifact.workspaceArtifactId}`)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      Open
                    </a>
                    <a
                      href={apiPath(`/api/ai-artifacts/${artifact.workspaceArtifactId}?download=1`)}
                      className="text-primary hover:underline"
                    >
                      Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl glass-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-on-surface-variant">
                Threads
              </p>
              <p className="mt-1 text-sm text-on-surface">
                Row-based workspace memory
              </p>
            </div>
            <span className="text-xs text-on-surface-variant">
              {threads.length}
            </span>
          </div>

          {threads.length === 0 ? (
            <p className="text-sm text-on-surface-variant">
              No saved threads yet.
            </p>
          ) : (
            <div className="space-y-2">
              {threads.map((thread) => {
                const active = thread.workspaceThreadId === threadId;
                return (
                  <button
                    key={thread.workspaceThreadId}
                    type="button"
                    onClick={() => router.push(buildThreadHref(thread.workspaceThreadId, date))}
                    className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                      active
                        ? "bg-primary/10 text-on-surface"
                        : "bg-surface-low text-on-surface hover:bg-surface-high"
                    }`}
                  >
                    <p className="line-clamp-2 break-words text-sm font-medium">{thread.title}</p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {thread.source} · {formatRelativeTime(thread.updatedAt)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col rounded-2xl glass-card px-4 py-4 sm:px-5">
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-surface-low px-3 py-2.5 text-sm text-on-surface">
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-on-surface-variant">
              Current thread
            </p>
            <p className="truncate font-medium">
              {currentThread?.title ?? "New chat"}
            </p>
          </div>
          {threadId ? (
            <span className="shrink-0 text-xs text-on-surface-variant">
              {threadId.slice(0, 12)}...
            </span>
          ) : null}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pb-2">
          {promptChips.length > 0 && messages.length === 0 ? (
            <div className="flex flex-wrap gap-2">
              {promptChips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    setInput(chip);
                    inputRef.current?.focus();
                  }}
                  className="rounded-full bg-surface-low px-3 py-1.5 text-sm text-on-surface hover:bg-surface-high"
                >
                  {chip}
                </button>
              ))}
            </div>
          ) : null}

          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-on-surface-variant/50">
                Ask about your workday, recap it, or create a report.
              </p>
            </div>
          ) : null}

          {messages.map((message, index) => (
            <div
              key={`${message.role}-${message.timestamp ?? index}-${index}`}
              className={`flex ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                  message.role === "user"
                    ? "bg-primary text-on-primary"
                    : "glass-card text-on-surface"
                }`}
              >
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {message.content}
                </p>
              </div>
            </div>
          ))}

          {loading || artifactLoading ? (
            <div className="flex justify-start">
              <div className="rounded-2xl glass-card px-4 py-2.5">
                <div className="flex gap-1">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:0.15s]" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:0.3s]" />
                </div>
              </div>
            </div>
          ) : null}

          <div ref={endRef} />
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage(input);
          }}
          className="shrink-0 flex items-end gap-2 border-t border-outline-variant/10 pt-3 pb-1"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage(input);
              }
            }}
            placeholder="Ask about your day, request a recap, or generate a report..."
            className="min-h-[2.75rem] flex-1 resize-none rounded-xl bg-surface-low px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
            disabled={loading || artifactLoading !== null}
            rows={1}
          />
          <button
            type="submit"
            disabled={loading || artifactLoading !== null || !input.trim()}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-on-primary transition-opacity disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
