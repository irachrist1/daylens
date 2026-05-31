import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { ANALYTICS_EVENT } from '@shared/analytics'
import { track } from '../../lib/analytics'
import { ipc } from '../../lib/ipc'
import { AI_PROVIDER_META } from '../../lib/aiProvider'
import ConnectAI from '../../components/ConnectAI'
import type { DaylensSearchResult } from '../../../preload/index'
import { AICompose, type AIComposeHandle } from './AICompose'
import { HistorySearch } from './HistorySearch'
import { MessageList } from './MessageList'
import { IconChevronDown, IconCompose, IconSparkle, relativeTime } from './icons'
import { useAIChat } from './useAIChat'
import type { ThreadMessage } from './types'

const STARTER_PROMPTS = [
  'What did I work on today?',
  'Summarize my last 7 days by project.',
  'When was I most focused this week?',
  "Export today's work sessions as CSV.",
]

export default function AIWorkspace() {
  const chat = useAIChat()
  const {
    messages,
    loading,
    threads,
    activeThreadId,
    activeThreadLabel,
    settings,
    cliTools,
    hasApiKey,
    activeFocusSession,
    actionFeedback,
    messageActionState,
    reducedMotion,
    latestCompletedAssistantId,
    initialLoading,
    loadError,
    refreshProvider,
    submitMessage,
    handleSend,
    handleRetry,
    handleCopy,
    handleRate,
    handleMessageAction,
    handleNewChat,
    selectThread,
    deleteThread,
    handlePromptChipClick,
    analyticsContext,
  } = chat

  const bottomRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<AIComposeHandle>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [hoveredThreadId, setHoveredThreadId] = useState<number | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const onNewChat = useCallback(() => {
    handleNewChat()
    setHistoryOpen(false)
    setDeleteConfirmId(null)
    composerRef.current?.focus()
  }, [handleNewChat])

  const onSelectThread = useCallback((threadId: number) => {
    selectThread(threadId)
    setHistoryOpen(false)
    setDeleteConfirmId(null)
    composerRef.current?.focus()
  }, [selectThread])

  const onFollowUpClick = useCallback((message: ThreadMessage, text: string, source: string) => {
    track(ANALYTICS_EVENT.AI_SUGGESTED_QUESTION_CLICKED, analyticsContext({
      answer_kind: message.answerKind ?? null,
      source,
      trigger: 'suggested',
    }))
    void handleSend(text, { trigger: 'suggested' })
  }, [analyticsContext, handleSend])

  const handleSearchResultClick = useCallback((result: DaylensSearchResult) => {
    if (result.type === 'artifact') { void ipc.ai.openArtifact(result.id); return }
    if (result.type === 'browser' && result.url) { ipc.shell.openExternal(result.url); return }
    window.location.hash = `/timeline?view=day&date=${encodeURIComponent(result.date)}`
  }, [])

  // ── Load gate ──────────────────────────────────────────────────────────────
  if (settings == null || hasApiKey == null) {
    if (loadError && !initialLoading) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, height: '100%', padding: 24 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'center', maxWidth: 360 }}>
            Couldn't load AI settings. {loadError}
          </p>
          <button type="button" onClick={() => { void refreshProvider() }} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>Loading AI…</p>
      </div>
    )
  }

  const activeChatProvider = settings.aiChatProvider ?? settings.aiProvider
  const providerMeta = AI_PROVIDER_META[activeChatProvider]
  const isCliProvider = activeChatProvider === 'claude-cli' || activeChatProvider === 'codex-cli'
  const cliMissing = activeChatProvider === 'claude-cli'
    ? !cliTools?.claude
    : activeChatProvider === 'codex-cli'
      ? !cliTools?.codex
      : false
  const hasMessages = messages.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ── Top bar: local-history search (left) + thread controls (right) ── */}
      <header style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderBottom: '1px solid var(--color-border-ghost)' }}>
        <HistorySearch onResultClick={handleSearchResultClick} />
        <div style={{ flex: 1, minWidth: 0, textAlign: 'center', overflow: 'hidden' }}>
          <span style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: '100%' }}>
            {activeThreadLabel ?? 'Ask Daylens'}
          </span>
        </div>
        <div style={{ position: 'relative', display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {threads.length > 0 && (
            <button
              type="button"
              onClick={() => { setHistoryOpen((v) => !v); setDeleteConfirmId(null) }}
              aria-haspopup="listbox"
              aria-expanded={historyOpen}
              title="Recent chats"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 34, padding: '0 10px', borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: historyOpen ? 'var(--color-surface-high)' : 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              History
              <IconChevronDown />
            </button>
          )}
          <button
            type="button"
            onClick={onNewChat}
            title="New chat"
            aria-label="New chat"
            style={{ width: 34, height: 34, padding: 0, borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <IconCompose />
          </button>

          {historyOpen && threads.length > 0 && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 19 }} onClick={() => { setHistoryOpen(false); setDeleteConfirmId(null) }} />
              <div role="listbox" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 20, width: 320, maxHeight: 380, overflowY: 'auto', background: 'var(--color-surface)', border: '1px solid var(--color-border-ghost)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', padding: 6 }}>
                {threads.map((thread) => (
                  <div
                    key={thread.id}
                    role="option"
                    aria-selected={thread.id === activeThreadId}
                    onMouseEnter={() => setHoveredThreadId(thread.id)}
                    onMouseLeave={() => setHoveredThreadId(null)}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, borderRadius: 6, background: thread.id === activeThreadId ? 'var(--color-surface-muted)' : 'transparent', marginBottom: 2 }}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectThread(thread.id)}
                      style={{ display: 'block', flex: 1, minWidth: 0, textAlign: 'left', padding: '9px 10px', border: 'none', background: 'transparent', color: 'var(--color-text-primary)', fontSize: 12.5, cursor: 'pointer' }}
                    >
                      <div style={{ fontWeight: 680, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{thread.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{relativeTime(thread.lastMessageAt)}</div>
                    </button>
                    {deleteConfirmId === thread.id ? (
                      <button
                        type="button"
                        onClick={() => { void deleteThread(thread); setDeleteConfirmId(null) }}
                        style={{ flexShrink: 0, padding: '4px 8px', marginRight: 4, border: 'none', borderRadius: 4, background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Delete?
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(thread.id)}
                        aria-label={`Delete ${thread.title}`}
                        style={{ width: 28, flexShrink: 0, marginRight: 4, border: 'none', borderRadius: 5, background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 4, opacity: hoveredThreadId === thread.id ? 1 : 0, transition: 'opacity 100ms ease' }}
                      >
                        <Trash2 size={13} strokeWidth={1.9} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </header>

      {/* ── Conversation ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', width: '100%', padding: '28px 24px 24px', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
          {!hasApiKey ? (
            <div style={{ margin: 'auto 0' }}>
              <ConnectAI
                variant="hero"
                initialProvider={settings.aiProvider}
                hasSavedAccess={false}
                onConnected={() => { void refreshProvider() }}
              />
              {isCliProvider && cliMissing && (
                <div style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.6, color: 'var(--color-text-tertiary)' }}>
                  {providerMeta.label} is selected right now, but it is not installed on this machine yet.
                </div>
              )}
            </div>
          ) : hasMessages ? (
            <>
              <MessageList
                messages={messages}
                latestCompletedAssistantId={latestCompletedAssistantId}
                actionFeedback={actionFeedback}
                messageActionState={messageActionState}
                reducedMotion={reducedMotion}
                activeFocusSession={activeFocusSession}
                onCopy={handleCopy}
                onRate={handleRate}
                onRetry={handleRetry}
                onMessageAction={handleMessageAction}
                onFollowUpClick={onFollowUpClick}
                scrollToBottom={scrollToBottom}
              />
              <div ref={bottomRef} />
            </>
          ) : (
            <div style={{ margin: 'auto 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--gradient-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary-contrast)' }}>
                <IconSparkle size={20} />
              </div>
              <div>
                <h1 style={{ fontSize: 18, fontWeight: 720, letterSpacing: '-0.01em', margin: 0, color: 'var(--color-text-primary)' }}>
                  Ask Daylens about your work
                </h1>
                <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: '6px 0 0', lineHeight: 1.5 }}>
                  Grounded in your local history. Ask a question, or request a report, table, or export.
                </p>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 540 }}>
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => handlePromptChipClick(prompt, 'starter')}
                    style={{ padding: '8px 14px', borderRadius: 999, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 12.5 }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Docked composer ───────────────────────────────────────────────── */}
      {hasApiKey && (
        <div style={{ flexShrink: 0, padding: '12px 24px 20px' }}>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <AICompose ref={composerRef} onSubmit={submitMessage} loading={loading} />
          </div>
        </div>
      )}
    </div>
  )
}
