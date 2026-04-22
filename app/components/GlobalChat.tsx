"use client";

import { isValidElement, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

type ThreadGroupKey = "today" | "yesterday" | "older";

const MODEL_STORAGE = "daylens-web:anthropic-model";
const AUTO_SCROLL_THRESHOLD_PX = 96;
const MAX_COMPOSER_LINES = 6;

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

function threadGroupLabel(group: ThreadGroupKey) {
  if (group === "today") return "Today";
  if (group === "yesterday") return "Yesterday";
  return "Older";
}

function getThreadGroup(updatedAt: number): ThreadGroupKey {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  if (updatedAt >= startOfToday) return "today";
  if (updatedAt >= startOfYesterday) return "yesterday";
  return "older";
}

function groupThreads(threads: WorkspaceAIThread[]) {
  const buckets: Record<ThreadGroupKey, WorkspaceAIThread[]> = {
    today: [],
    yesterday: [],
    older: [],
  };

  for (const thread of threads) {
    buckets[getThreadGroup(thread.updatedAt)].push(thread);
  }

  return (["today", "yesterday", "older"] as ThreadGroupKey[])
    .map((group) => ({
      id: group,
      label: threadGroupLabel(group),
      threads: buckets[group],
    }))
    .filter((group) => group.threads.length > 0);
}

function messageKey(message: ChatMessage, index: number) {
  return `${message.role}-${message.timestamp ?? "untimed"}-${index}`;
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function CopyChip({
  value,
  idleLabel = "Copy",
  copiedLabel = "Copied",
  className,
}: {
  value: string;
  idleLabel?: string;
  copiedLabel?: string;
  className: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await copyText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? copiedLabel : idleLabel}
    </button>
  );
}

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      allowedElements={[
        "h1",
        "h2",
        "h3",
        "p",
        "ul",
        "ol",
        "li",
        "strong",
        "em",
        "code",
        "pre",
        "a",
        "blockquote",
        "hr",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
      ]}
      components={{
        pre({ children }) {
          const child = Array.isArray(children) ? children[0] : children;
          if (!isValidElement(child)) {
            return <pre className="ai-code-block__pre">{children}</pre>;
          }

          const childProps = child.props as { children?: unknown; className?: unknown };
          const rawChildren = childProps.children;
          const value = String(rawChildren).replace(/\n$/, "");
          const className =
            typeof childProps.className === "string" ? childProps.className : undefined;

          return (
            <div className="ai-code-block">
              <CopyChip value={value} className="ai-code-block__copy" />
              <pre className="ai-code-block__pre">
                <code className={className}>{value}</code>
              </pre>
            </div>
          );
        },
        code({ className, children }) {
          return <code className={className ? `ai-inline-code ${className}` : "ai-inline-code"}>{children}</code>;
        },
        a({ href, children }) {
          return (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
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

function AssistantMessage({
  content,
  isLastAssistant,
  onRegenerate,
}: {
  content: string;
  isLastAssistant: boolean;
  onRegenerate?: () => void;
}) {
  return (
    <div className="ai-turn ai-turn--assistant">
      <div className="ai-turn__avatar">D</div>
      <div className="ai-turn__body">
        <div className="ai-turn__controls">
          <CopyChip value={content} className="ai-message-action" />
          {isLastAssistant && onRegenerate ? (
            <button type="button" className="ai-message-action" onClick={onRegenerate}>
              Regenerate
            </button>
          ) : null}
        </div>
        <div className="ai-turn__text">
          <AssistantMarkdown content={content} />
        </div>
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
  const [archivingThreadId, setArchivingThreadId] = useState<string | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const groupedThreads = useMemo(() => groupThreads(threads), [threads]);

  const currentThread =
    threads.find((candidate) => candidate.workspaceThreadId === threadId) ?? null;
  const lastAssistantIndex = useMemo(
    () => messages.reduce((last, message, index) => (message.role === "assistant" ? index : last), -1),
    [messages],
  );
  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "user") ?? null,
    [messages],
  );

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
    const body = bodyRef.current;
    if (!body) return;

    const handleScroll = () => {
      const nearBottom =
        body.scrollHeight - body.scrollTop - body.clientHeight < AUTO_SCROLL_THRESHOLD_PX;
      setStickToBottom(nearBottom);
      if (nearBottom) {
        setShowJumpToLatest(false);
      }
    };

    handleScroll();
    body.addEventListener("scroll", handleScroll);
    return () => body.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    // Legacy: early builds stored the Anthropic key in localStorage. Purge any
    // leftover so the key never sits at rest in the browser after this fix.
    window.localStorage.removeItem("daylens-web:anthropic-api-key");
  }, []);

  useEffect(() => {
    setMessages(initialMessages);
    setThreadId(initialThreadId ?? null);
    setStickToBottom(true);
    setShowJumpToLatest(false);
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

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    input.style.height = "auto";
    const lineHeight = Number.parseFloat(window.getComputedStyle(input).lineHeight) || 22;
    const paddingTop = Number.parseFloat(window.getComputedStyle(input).paddingTop) || 0;
    const paddingBottom = Number.parseFloat(window.getComputedStyle(input).paddingBottom) || 0;
    const verticalPadding = paddingTop + paddingBottom;
    const minHeight = lineHeight + verticalPadding;
    const maxHeight = lineHeight * MAX_COMPOSER_LINES + verticalPadding;
    const nextHeight = Math.min(input.scrollHeight, maxHeight);
    input.style.height = `${Math.max(nextHeight, minHeight)}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    if (stickToBottom) {
      requestAnimationFrame(() => {
        body.scrollTo({ top: body.scrollHeight, behavior: messages.length > 0 ? "smooth" : "auto" });
      });
      return;
    }

    if (messages.length > 0 || loading || artifactLoading) {
      setShowJumpToLatest(true);
    }
  }, [artifactLoading, loading, messages, stickToBottom]);

  useEffect(() => {
    const handleHotkey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;

      const activeElement = document.activeElement as HTMLElement | null;
      if (
        activeElement?.tagName === "TEXTAREA" ||
        activeElement?.tagName === "INPUT" ||
        activeElement?.isContentEditable
      ) {
        return;
      }

      event.preventDefault();
      inputRef.current?.focus();
    };

    window.addEventListener("keydown", handleHotkey);
    return () => window.removeEventListener("keydown", handleHotkey);
  }, []);

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
    setStickToBottom(true);
    setShowJumpToLatest(false);

    try {
      const model =
        typeof window !== "undefined"
          ? window.localStorage.getItem(MODEL_STORAGE) || undefined
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

  async function archiveThread(target: WorkspaceAIThread) {
    if (archivingThreadId) return;

    setArchivingThreadId(target.workspaceThreadId);
    setSurfaceError(null);

    try {
      const response = await fetch(
        apiPath(`/api/ai-threads?threadId=${encodeURIComponent(target.workspaceThreadId)}`),
        { method: "DELETE" },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Couldn't archive that chat right now.",
        );
      }

      await refreshThreads();
      setThreadPickerOpen(false);

      if (target.workspaceThreadId === threadId) {
        setThreadId(null);
        setMessages([]);
        setSurfaceError(null);
        router.push(
          buildSurfaceHref(
            "/chat",
            date ?? new Date().toLocaleDateString("en-CA"),
            range,
          ),
        );
      }
    } catch (error) {
      setSurfaceError(
        buildSurfaceError(
          null,
          friendlyError("Daylens couldn't archive that chat right now.", error),
        ),
      );
    } finally {
      setArchivingThreadId(null);
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
                  {groupedThreads.map((group) => (
                    <div key={group.id} className="ai-thread-group">
                      <p className="ai-thread-group__label">{group.label}</p>
                      <div className="ai-thread-group__items">
                        {group.threads.map((thread) => (
                          <div
                            key={thread.workspaceThreadId}
                            className={`ai-thread-row ${
                              thread.workspaceThreadId === threadId ? "is-active" : ""
                            }`}
                          >
                            <button
                              type="button"
                              role="option"
                              aria-selected={thread.workspaceThreadId === threadId}
                              className="ai-thread-row__select"
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
                            <button
                              type="button"
                              className="ai-thread-row__archive"
                              disabled={archivingThreadId === thread.workspaceThreadId}
                              onClick={() => void archiveThread(thread)}
                              aria-label={`Archive ${thread.title}`}
                              title="Archive chat"
                            >
                              {archivingThreadId === thread.workspaceThreadId ? "…" : "Delete"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
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

      <div className="ai-shell__body" ref={bodyRef}>
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
                  key={messageKey(message, index)}
                  content={message.content}
                />
              ) : (
                <AssistantMessage
                  key={messageKey(message, index)}
                  content={message.content}
                  isLastAssistant={index === lastAssistantIndex}
                  onRegenerate={
                    index === lastAssistantIndex && lastUserMessage
                      ? () => void sendMessage(lastUserMessage.content)
                      : undefined
                  }
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

      {showJumpToLatest ? (
        <button
          type="button"
          className="ai-jump-pill"
          onClick={() => {
            const body = bodyRef.current;
            if (!body) return;
            body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
            setStickToBottom(true);
            setShowJumpToLatest(false);
          }}
        >
          Jump to latest
        </button>
      ) : null}

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
