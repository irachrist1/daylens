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
  | "model_not_allowed"
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

function friendlyError(fallback: string, error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `${fallback} ${error.message.trim()}`;
  }
  return fallback;
}

function buildSurfaceError(code: ChatErrorCode | null, message: string): SurfaceErrorState {
  switch (code) {
    case "billing_exhausted":
      return { code, title: "Provider credits exhausted", message };
    case "rate_limited":
      return { code, title: "Provider temporarily busy", message };
    case "missing_key":
      return { code, title: "AI setup needs attention", message };
    case "no_data":
      return { code, title: "No synced evidence for this range", message };
    case "model_not_allowed":
      return { code, title: "Model unavailable", message };
    case "service_updating":
      return { code, title: "AI service updating", message };
    case "not_authenticated":
      return { code, title: "Session expired", message };
    default:
      return { code, title: message || "AI reply unavailable", message: "" };
  }
}

function periodLabel(period: RecapPeriod): string {
  return period === "day" ? "Daily" : period === "week" ? "Weekly" : "Monthly";
}

function formatFullDateLabel(dateStr?: string): string {
  const base = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(base);
}

function RecapPanel({
  activeRecap,
  activeRawRecap,
  activePeriod,
  onSelectPeriod,
  coverageNote,
  onPromptClick,
  groundedTitle,
  groundedSubtitle,
}: {
  activeRecap: SanitizedRecap | null;
  activeRawRecap: RecapSummaryLite | null;
  activePeriod: RecapPeriod;
  onSelectPeriod: (period: RecapPeriod) => void;
  coverageNote: string | null;
  onPromptClick: (prompt: string) => void;
  groundedTitle: string;
  groundedSubtitle: string;
}) {
  const chapters = activeRecap?.chapters ?? [];
  const metrics = activeRecap?.metrics ?? [];
  const promptChips = activeRecap?.promptChips ?? [];
  const hasData = Boolean(activeRawRecap?.hasData);

  return (
    <section className="ai-recap">
      <header className="ai-recap__header">
        <div className="ai-recap__heading">
          <p className="ai-recap__kicker">Work recap</p>
          <h2 className="ai-recap__title">{groundedTitle}</h2>
          <p className="ai-recap__subtitle">{groundedSubtitle}</p>
        </div>
        <div className="ai-recap__toggle">
          {(["day", "week", "month"] as RecapPeriod[]).map((period) => (
            <button
              key={period}
              type="button"
              onClick={() => onSelectPeriod(period)}
              className={activePeriod === period ? "is-active" : ""}
            >
              {periodLabel(period)}
            </button>
          ))}
        </div>
      </header>

      {activeRecap?.headline ? (
        <p className="ai-recap__headline">{activeRecap.headline}</p>
      ) : null}

      {coverageNote ? <p className="ai-coverage-note">{coverageNote}</p> : null}

      {hasData && chapters.length > 0 ? (
        <div className="ai-recap__chapters">
          {chapters.map((chapter, index) => (
            <div key={chapter.id} className="ai-recap-chapter">
              <div className="ai-recap-chapter__index">
                <span>{String(index + 1).padStart(2, "0")}</span>
                {index < chapters.length - 1 ? <div className="ai-recap-chapter__line" /> : null}
              </div>
              <div className="ai-recap-chapter__body">
                <p className="ai-recap-chapter__eyebrow">{chapter.eyebrow}</p>
                <h3 className="ai-recap-chapter__title">{chapter.title}</h3>
                <p className="ai-recap-chapter__copy">{chapter.body}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {metrics.length > 0 ? (
        <div className="ai-recap__metrics">
          {metrics.map((metric) => (
            <div key={metric.label} className="ai-recap-metric">
              <span className="ai-recap-metric__label">{metric.label}</span>
              <strong className="ai-recap-metric__value">{metric.value}</strong>
              <p className="ai-recap-metric__detail">{metric.detail}</p>
            </div>
          ))}
        </div>
      ) : null}

      {promptChips.length > 0 ? (
        <div className="ai-recap__prompts">
          <p className="ai-recap__kicker">Ask Daylens from here</p>
          <div className="ai-recap__chip-row">
            {promptChips.slice(0, 6).map((chip) => (
              <button
                key={chip}
                type="button"
                className="ai-recap-chip"
                onClick={() => onPromptClick(chip)}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function AssistantMessage({ content }: { content: string }) {
  return (
    <div className="ai-turn ai-turn--assistant">
      <div className="ai-turn__avatar">D</div>
      <div className="ai-turn__body">
        <p className="ai-turn__text">{content}</p>
      </div>
    </div>
  );
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="ai-turn ai-turn--user">
      <div className="ai-user-bubble">{content}</div>
    </div>
  );
}

function IconSend() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 13 13 3" />
      <path d="M5.5 3H13v7.5" />
    </svg>
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
  const [, setArtifacts] = useState<WorkspaceAIArtifact[]>([]);
  const [snapshotRecap, setSnapshotRecap] = useState<SnapshotRecapPayload | null>(null);
  const [activeRecapPeriod, setActiveRecapPeriod] = useState<RecapPeriod>("day");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [artifactLoading, setArtifactLoading] = useState<ExportKind | null>(null);
  const [surfaceError, setSurfaceError] = useState<SurfaceErrorState | null>(null);
  const [threadPickerOpen, setThreadPickerOpen] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const currentThread =
    threads.find((candidate) => candidate.workspaceThreadId === threadId) ?? null;

  const rawRecapByPeriod = useMemo(
    () => ({
      day: snapshotRecap?.recap?.day ?? null,
      week: snapshotRecap?.recap?.week ?? null,
      month: snapshotRecap?.recap?.month ?? null,
    }),
    [snapshotRecap],
  );
  const recapByPeriod = useMemo(
    () => ({
      day: sanitizeRecapSummary(rawRecapByPeriod.day),
      week: sanitizeRecapSummary(rawRecapByPeriod.week),
      month: sanitizeRecapSummary(rawRecapByPeriod.month),
    }),
    [rawRecapByPeriod],
  );
  const activeRecap = recapByPeriod[activeRecapPeriod];
  const activeRawRecap = rawRecapByPeriod[activeRecapPeriod];

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
    // Legacy: early builds stored the Anthropic key in localStorage. Purge any
    // leftover so the key never sits at rest in the browser after this fix.
    window.localStorage.removeItem("daylens-web:anthropic-api-key");
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
      const model =
        typeof window !== "undefined"
          ? window.localStorage.getItem("daylens-web:anthropic-model") || undefined
          : undefined;
      const response = await fetch(apiPath("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          date,
          range,
          threadId,
          model,
        }),
      });
      const data = await response.json();

      if (!response.ok || typeof data.response !== "string") {
        const code = typeof data.code === "string" ? (data.code as ChatErrorCode) : null;
        const message =
          typeof data.error === "string"
            ? data.error
            : "The provider did not return a usable response.";
        setSurfaceError(buildSurfaceError(code, message));
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

  const groundedTitle = activeRecap?.headline ? "Daily recap" : "Ask about your day";
  const dateLabel = formatFullDateLabel(date);
  const groundedSubtitle = date ? formatLongRangeLabel(date, range) : dateLabel;
  const activeThreadLabel =
    currentThread && currentThread.title.trim() && currentThread.title !== "New chat"
      ? currentThread.title
      : null;
  const headerDateLabel = dateLabel;

  return (
    <div className="ai-shell">
      <header className="ai-shell__header">
        <div className="ai-shell__heading">
          <h1>AI</h1>
          <p>{headerDateLabel}</p>
          {activeThreadLabel ? (
            <p className="ai-shell__thread">In <span>{activeThreadLabel}</span></p>
          ) : null}
        </div>
        <div className="ai-shell__actions">
          {threads.length > 0 ? (
            <div className="ai-shell__chats">
              <button
                type="button"
                className="ai-header-button"
                onClick={() => setThreadPickerOpen((value) => !value)}
                aria-haspopup="listbox"
                aria-expanded={threadPickerOpen}
              >
                Chats
              </button>
              {threadPickerOpen ? (
                <div className="ai-shell__chats-menu" role="listbox">
                  {threads.map((thread) => (
                    <button
                      key={thread.workspaceThreadId}
                      type="button"
                      role="option"
                      aria-selected={thread.workspaceThreadId === threadId}
                      className={thread.workspaceThreadId === threadId ? "is-active" : ""}
                      onClick={() => {
                        setThreadPickerOpen(false);
                        router.push(
                          appPath(`/chat?thread=${encodeURIComponent(thread.workspaceThreadId)}`),
                        );
                      }}
                    >
                      <strong>{thread.title}</strong>
                      <span>{formatRelativeTime(thread.updatedAt)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            className="ai-header-button"
            onClick={() => {
              setThreadId(null);
              setMessages([]);
              setInput("");
              setSurfaceError(null);
              inputRef.current?.focus();
              router.push(
                buildSurfaceHref(
                  "/chat",
                  date ?? new Date().toLocaleDateString("en-CA"),
                  range,
                ),
              );
            }}
          >
            New chat
          </button>
        </div>
      </header>

      <div className="ai-shell__body">
        {messages.length === 0 ? (
          <RecapPanel
            activeRecap={activeRecap}
            activeRawRecap={activeRawRecap}
            activePeriod={activeRecapPeriod}
            onSelectPeriod={setActiveRecapPeriod}
            coverageNote={snapshotRecap?.coverageNote ?? null}
            onPromptClick={(prompt) => {
              setInput(prompt);
              inputRef.current?.focus();
            }}
            groundedTitle={groundedTitle}
            groundedSubtitle={groundedSubtitle}
          />
        ) : null}

        {surfaceError ? (
          <div className="ai-shell__notice">
            <strong>{surfaceError.title}</strong>
            {surfaceError.message ? <p>{surfaceError.message}</p> : null}
          </div>
        ) : null}

        {messages.length > 0 ? (
          <div className="ai-thread-feed">
            {messages.map((message, index) =>
              message.role === "user" ? (
                <UserMessage
                  key={`user-${message.timestamp ?? index}-${index}`}
                  content={message.content}
                />
              ) : (
                <AssistantMessage
                  key={`assistant-${message.timestamp ?? index}-${index}`}
                  content={message.content}
                />
              ),
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
        ) : null}

        {messages.length === 0 ? (
          <section className="ai-generate-card">
            <p>
              Generate a grounded briefing when you want a quick read on today,
              or jump straight into one of the questions below.
            </p>
            <button
              type="button"
              className="ai-generate-card__cta"
              disabled={artifactLoading !== null || loading}
              onClick={() => void generateArtifact("report")}
            >
              {artifactLoading === "report" ? "Working…" : "Generate summary"}
            </button>
          </section>
        ) : null}

        {messages.length === 0 ? (
          <div className="ai-suggestions">
            <p className="ai-recap__kicker">Ask Daylens</p>
            <div className="ai-recap__chip-row">
              {(activeRecap?.promptChips?.length
                ? activeRecap.promptChips
                : [
                    "What did I actually get done today?",
                    "Which files, docs, or pages did I touch today?",
                    "Where did my focus break down today?",
                    "Summarize today as a short report I could share",
                    "Compare today with yesterday",
                    "Start a 45 minute focus session for what I am doing now",
                  ]
              ).map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="ai-recap-chip"
                  onClick={() => {
                    setInput(chip);
                    inputRef.current?.focus();
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage(input);
        }}
        className="ai-composer-bar"
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
          placeholder="Ask about your day, or ask for a report, chart, table, or export…"
          className="ai-composer-bar__input"
          disabled={loading || artifactLoading !== null}
          rows={1}
        />
        <button
          type="submit"
          disabled={loading || artifactLoading !== null || !input.trim()}
          className="ai-composer-bar__send"
          aria-label="Send"
        >
          <IconSend />
        </button>
      </form>
    </div>
  );
}
