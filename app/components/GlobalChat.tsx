"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/app/lib/chat";
import { apiPath } from "@/app/lib/basePath";

export function GlobalChat({
  initialMessages,
  date,
  initialPrompt,
}: {
  initialMessages: ChatMessage[];
  date?: string;
  initialPrompt?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [promptChips, setPromptChips] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const didHydrateRef = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  // Auto-focus the input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!date) {
      setPromptChips([]);
      return;
    }

    let cancelled = false;
    void fetch(apiPath(`/api/snapshots?date=${date}`))
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        const chips = json?.snapshot?.snapshot?.recap?.day?.promptChips;
        setPromptChips(Array.isArray(chips) ? chips : []);
      })
      .catch(() => {
        if (cancelled) return;
        setPromptChips([]);
      });

    return () => {
      cancelled = true;
    };
  }, [date]);

  useEffect(() => {
    if (!initialPrompt?.trim()) {
      return;
    }
    setInput(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    if (!didHydrateRef.current) {
      didHydrateRef.current = true;
      return;
    }

    const timeout = window.setTimeout(() => {
      void fetch(apiPath("/api/chat/save"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [messages]);

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
        body: JSON.stringify({ messages: nextMessages, date }),
      });
      const data = await response.json();

      if (!response.ok || typeof data.response !== "string") {
        throw new Error(data.error || "Something went wrong.");
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

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 8rem)" }}>
      {/* Messages area — takes remaining space */}
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
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-on-surface-variant/50">
              Ask anything about your activity
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
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {message.content}
              </p>
            </div>
          </div>
        ))}

        {loading ? (
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

      {/* Input — always pinned at bottom */}
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
          placeholder="Ask about your day..."
          className="min-h-[2.75rem] flex-1 resize-none rounded-xl bg-surface-low px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
          disabled={loading}
          rows={1}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-on-primary transition-opacity disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
