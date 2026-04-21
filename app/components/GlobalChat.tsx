"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatMessage } from "@/app/lib/chat";
import { apiPath, appPath } from "@/app/lib/basePath";
import { formatRelativeTime } from "@/app/lib/format";
import { buildSurfaceHref, formatLongRangeLabel, type SurfaceRange } from "@/app/lib/range";
import { sanitizeRecapSummary, type SanitizedRecap } from "@/app/lib/presentation";
import type {
  ArtifactRollup,
  RecapSummaryLite,
  WorkspaceAIArtifact,
  WorkspaceAIThread,
} from "../../packages/remote-contract";

type RecapPeriod = "day" | "week" | "month";
type ExportKind = "report" | "csv" | "chart";
type ChatErrorCode =
  | "not_authenticated"
  | "empty_question"
  | "no_data"
  | "missing_key"
  | "billing_exhausted"
  | "rate_limited"
  | "service_updating"
  | "unknown";
type SurfaceErrorState = {
  code: ChatErrorCode | null;
  title: string;
  message: string;
};

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

function buildThreadHref(threadId: string, date?: string, range: SurfaceRange = "day") {
  const params = new URLSearchParams();
  params.set("thread", threadId);
  if (date) params.set("date", date);
  if (range !== "day") params.set("range", range);
  return appPath(`/chat?${params.toString()}`);
}

function friendlyError(fallback: string, error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `${fallback} ${error.message.trim()}`;
  }
  return fallback;
}

function buildSurfaceError(code: ChatErrorCode | null, message: string): SurfaceErrorState {
  switch (code) {
    case "billing_exhausted":
      return {
        code,
        title: "Provider credits exhausted",
        message,
      };
    case "rate_limited":
      return {
        code,
        title: "Provider temporarily busy",
        message,
      };
    case "missing_key":
      return {
        code,
        title: "AI setup needs attention",
        message,
      };
    case "no_data":
      return {
        code,
        title: "No synced evidence for this range",
        message,
      };
    case "service_updating":
      return {
        code,
        title: "AI service updating",
        message,
      };
    case "not_authenticated":
      return {
        code,
        title: "Session expired",
        message,
      };
    default:
      return {
        code,
        title: message || "AI reply unavailable",
        message: "",
      };
  }
}

function periodLabel(period: RecapPeriod): string {
  return period === "day" ? "Daily" : period === "week" ? "Weekly" : "Monthly";
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const user = message.role === "user";

  return (
    <div className={`flex ${user ? "justify-end" : "justify-start"}`}>
      <div className={`ai-message ${user ? "ai-message--user" : "ai-message--assistant"}`}>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
      </div>
    </div>
  );
}

function RecapPanel({
  activeRecap,
  activePeriod,
  onSelectPeriod,
  coverageNote,
  promptChips,
  onPromptClick,
  groundedLabel,
}: {
  activeRecap: SanitizedRecap | null;
  activePeriod: RecapPeriod;
  onSelectPeriod: (period: RecapPeriod) => void;
  coverageNote: string | null;
  promptChips: string[];
  onPromptClick: (prompt: string) => void;
  groundedLabel: string;
}) {
  return (
    <section className="ai-hero glass-card">
      <div className="ai-hero__header">
        <div>
          <p className="timeline-kicker">AI</p>
          <h1>{groundedLabel}</h1>
          <p className="ai-hero__summary">
            {activeRecap?.headline ?? `No ${activePeriod} recap ready yet — but you can still ask questions below.`}
          </p>
        </div>
        <div className="ai-hero__switches">
          {(["day", "week", "month"] as RecapPeriod[]).map((period) => (
            <button
              key={period}
              type="button"
              onClick={() => onSelectPeriod(period)}
              className={`ai-toggle ${activePeriod === period ? "ai-toggle--active" : ""}`}
            >
              {periodLabel(period)}
            </button>
          ))}
        </div>
      </div>

      {coverageNote ? <p className="ai-coverage-note">{coverageNote}</p> : null}

      {activeRecap ? (
        <>
          {activeRecap.metrics.length > 0 ? (
            <div className="ai-metric-grid">
              {activeRecap.metrics.slice(0, 3).map((metric) => (
                <div key={metric.label} className="ai-metric-card">
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <p>{metric.detail}</p>
                </div>
              ))}
            </div>
          ) : null}

          {activeRecap.chapters.length > 0 ? (
            <div className="ai-chapter-grid">
              {activeRecap.chapters.slice(0, 2).map((chapter) => (
                <article key={chapter.id} className="ai-chapter-card">
                  <span>{chapter.eyebrow}</span>
                  <h2>{chapter.title}</h2>
                  <p>{chapter.body}</p>
                </article>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {promptChips.length > 0 ? (
        <div className="ai-prompt-row">
          {promptChips.slice(0, 5).map((chip) => (
            <button key={chip} type="button" className="timeline-chip" onClick={() => onPromptClick(chip)}>
              {chip}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function GlobalChat({
  initialMessages,
  initialThreadId,
  date,
  range = "day",
  initialPrompt,
}: {
  initialMessages: ChatMessage[];
  initialThreadId?: string | null;
  date?: string;
  range?: SurfaceRange;
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
  const [surfaceError, setSurfaceError] = useState<SurfaceErrorState | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const currentThread =
    threads.find((candidate) => candidate.workspaceThreadId === threadId) ?? null;
  const recapByPeriod = useMemo(
    () => ({
      day: sanitizeRecapSummary(snapshotRecap?.recap?.day ?? null),
      week: sanitizeRecapSummary(snapshotRecap?.recap?.week ?? null),
      month: sanitizeRecapSummary(snapshotRecap?.recap?.month ?? null),
    }),
    [snapshotRecap],
  );
  const activeRecap = recapByPeriod[activeRecapPeriod];
  const promptChips = recapByPeriod.day?.promptChips ?? [];

  useEffect(() => {
    setActiveRecapPeriod(range);
  }, [range]);

  async function refreshThreads() {
    const response = await fetch(apiPath("/api/ai-threads"));
    if (!response.ok) throw new Error("Failed to load threads.");
    const data = await response.json();
    setThreads(Array.isArray(data.threads) ? data.threads : []);
  }

  async function refreshArtifacts(nextThreadId: string | null) {
    const query = nextThreadId ? `?threadId=${encodeURIComponent(nextThreadId)}` : "";
    const response = await fetch(apiPath(`/api/ai-artifacts${query}`));
    if (!response.ok) throw new Error("Failed to load artifacts.");
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
    if (initialPrompt?.trim()) {
      setInput(initialPrompt);
    }
  }, [initialPrompt]);

  useEffect(() => {
    let cancelled = false;
    void refreshThreads().catch(() => {
      if (!cancelled) setThreads([]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshArtifacts(threadId).catch(() => {
      if (!cancelled) setArtifacts([]);
    });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    if (!date) {
      setSnapshotRecap(null);
      return;
    }

    let cancelled = false;
    void fetch(apiPath(`/api/snapshots?date=${date}`))
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (cancelled) return;
        const snapshot = json?.snapshot?.snapshot;
        setSnapshotRecap(
          snapshot
            ? {
                recap: snapshot.recap ?? null,
                coverageNote: snapshot.coverage?.coverageNote ?? null,
                standoutArtifacts: Array.isArray(snapshot.standoutArtifacts) ? snapshot.standoutArtifacts : [],
              }
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setSnapshotRecap(null);
      });

    return () => {
      cancelled = true;
    };
  }, [date]);

  async function sendMessage(content: string) {
    if (!content.trim() || loading) return;

    const trimmed = content.trim();
    const userMessage: ChatMessage = {
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setSurfaceError(null);

    try {
      const response = await fetch(apiPath("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, date, range, threadId }),
      });
      const data = await response.json();

      if (!response.ok || typeof data.response !== "string") {
        setSurfaceError(
          buildSurfaceError(
            typeof data.code === "string" ? (data.code as ChatErrorCode) : null,
            typeof data.error === "string"
              ? data.error
              : "The provider did not return a usable response.",
          ),
        );
        setLoading(false);
        return;
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
            ? data.toolsUsed.filter((tool: unknown): tool is string => typeof tool === "string")
            : undefined,
        },
      ]);

      await refreshThreads();
      await refreshArtifacts(nextThreadId ?? null);
    } catch (error) {
      setSurfaceError(
        buildSurfaceError(
          null,
          friendlyError(
            "Daylens couldn't get an AI response right now. The thread is still intact, so you can retry once the provider settles.",
            error,
          ),
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  async function generateArtifact(kind: ExportKind) {
    if (artifactLoading || loading) return;

    setArtifactLoading(kind);
    setSurfaceError(null);

    try {
      const response = await fetch(apiPath("/api/ai-artifacts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, threadId, outputs: [kind] }),
      });
      const data = await response.json();

      if (!response.ok || typeof data.assistantContent !== "string") {
        throw new Error(data.error || "Artifact generation did not complete.");
      }

      const nextThreadId =
        typeof data.threadId === "string" && data.threadId.trim()
          ? data.threadId
          : threadId;

      if (nextThreadId) setThreadId(nextThreadId);

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
      setSurfaceError(
        buildSurfaceError(
          null,
          friendlyError(
            "Daylens couldn't generate that artifact right now. Your thread and existing artifacts are still available.",
            error,
          ),
        ),
      );
    } finally {
      setArtifactLoading(null);
    }
  }

  const groundedLabel = date
    ? `Grounded on ${formatLongRangeLabel(date, range)}`
    : "Grounded on your latest synced day";

  return (
    <div className="ai-layout">
      <div className="ai-main">
        <RecapPanel
          activeRecap={activeRecap}
          activePeriod={activeRecapPeriod}
          onSelectPeriod={setActiveRecapPeriod}
          coverageNote={snapshotRecap?.coverageNote ?? null}
          promptChips={promptChips}
          onPromptClick={(prompt) => {
            setInput(prompt);
            inputRef.current?.focus();
          }}
          groundedLabel={groundedLabel}
        />

        <section className="ai-chat glass-card">
          <div className="ai-chat__header">
            <div>
              <p className="timeline-kicker">Current thread</p>
              <h2>{currentThread?.title ?? "New chat"}</h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setThreadId(null);
                setMessages([]);
                setInput("");
                setSurfaceError(null);
                inputRef.current?.focus();
                router.push(buildSurfaceHref("/chat", date ?? new Date().toLocaleDateString("en-CA"), range));
              }}
              className="daylens-secondary-button"
            >
              New thread
            </button>
          </div>

          {surfaceError ? (
            <div className="ai-chat__notice">
              <div className="ai-chat__notice-copy">
                <strong>{surfaceError.title}</strong>
                <p>{surfaceError.message}</p>
              </div>
            </div>
          ) : null}

          <div className="ai-chat__messages">
            {messages.length === 0 ? (
              <div className="ai-empty-state">
                <p>Ask about the proof, one block, or a report.</p>
                {promptChips.length > 0 ? (
                  <div className="ai-prompt-row">
                    {promptChips.map((chip) => (
                      <button key={chip} type="button" className="timeline-chip" onClick={() => setInput(chip)}>
                        {chip}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="ai-message-stack">
                {messages.map((message, index) => (
                  <MessageBubble key={`${message.role}-${message.timestamp ?? index}-${index}`} message={message} />
                ))}
              </div>
            )}

            {loading || artifactLoading ? (
              <div className="ai-loading-row">
                <div className="ai-loading-dot" />
                <div className="ai-loading-dot" />
                <div className="ai-loading-dot" />
              </div>
            ) : null}

            <div ref={endRef} />
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage(input);
            }}
            className="ai-composer"
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
              placeholder={range === "day" ? "Ask about this day or make a report..." : `Ask about this ${range} or make a report...`}
              className="ai-composer__input"
              disabled={loading || artifactLoading !== null}
              rows={1}
            />
            <button
              type="submit"
              disabled={loading || artifactLoading !== null || !input.trim()}
              className="ai-composer__send"
            >
              Send
            </button>
          </form>
        </section>
      </div>

      <aside className="ai-side glass-card">
        <section className="ai-side__section">
          <div className="ai-side__header">
            <div>
              <p className="timeline-kicker">Exports</p>
              <h3>Reports and files</h3>
            </div>
          </div>
          <div className="ai-side__actions">
            {(["report", "csv", "chart"] as ExportKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => void generateArtifact(kind)}
                disabled={artifactLoading !== null || loading}
                className="ai-side__action"
              >
                <span>{exportLabel(kind)}</span>
                <strong>{artifactLoading === kind ? "Working..." : "Create"}</strong>
              </button>
            ))}
          </div>
        </section>

        <section className="ai-side__section">
          <div className="ai-side__header">
            <div>
              <p className="timeline-kicker">Artifacts</p>
              <h3>{threadId ? "Generated in this thread" : "Recent artifacts"}</h3>
            </div>
            <span>{artifacts.length}</span>
          </div>
          {artifacts.length === 0 ? (
            <p className="ai-side__empty">Create a report, CSV export, or chart to keep it here.</p>
          ) : (
            <div className="ai-side__list">
              {artifacts.map((artifact) => (
                <div key={artifact.workspaceArtifactId} className="ai-side__card">
                  <p>{artifact.title}</p>
                  <span>{artifactKindLabel(artifact.kind)} · {formatRelativeTime(artifact.createdAt)}</span>
                  <div className="ai-side__links">
                    <a href={apiPath(`/api/ai-artifacts/${artifact.workspaceArtifactId}`)} target="_blank" rel="noreferrer">
                      Open
                    </a>
                    <a href={apiPath(`/api/ai-artifacts/${artifact.workspaceArtifactId}?download=1`)}>
                      Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="ai-side__section">
          <div className="ai-side__header">
            <div>
              <p className="timeline-kicker">Threads</p>
              <h3>Saved chats</h3>
            </div>
            <span>{threads.length}</span>
          </div>
          {threads.length === 0 ? (
            <p className="ai-side__empty">No saved threads yet.</p>
          ) : (
            <div className="ai-side__list">
              {threads.map((thread) => {
                const active = thread.workspaceThreadId === threadId;
                return (
                  <button
                    key={thread.workspaceThreadId}
                    type="button"
                    onClick={() => router.push(buildThreadHref(thread.workspaceThreadId, date, range))}
                    className={`ai-thread-card ${active ? "ai-thread-card--active" : ""}`}
                  >
                    <p>{thread.title}</p>
                    <span>{thread.source} · {formatRelativeTime(thread.updatedAt)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
