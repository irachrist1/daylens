import { useCallback } from 'react'
import { AI_PROVIDER_META } from '../../lib/aiProvider'
import ConnectAI from '../../components/ConnectAI'
import { LocalHistorySearch } from './LocalHistorySearch'
import { AICompose } from './AICompose'
import { AIThreadBar } from './AIThreadBar'
import { MessageList } from './MessageList'
import { useAIChat } from './useAIChat'
import './ai-workspace.css'

export default function AIWorkspace() {
  const chat = useAIChat()
  const {
    messages,
    loading,
    settings,
    cliTools,
    hasApiKey,
    threads,
    activeThreadId,
    threadPickerOpen,
    setThreadPickerOpen,
    threadDeleteConfirm,
    setThreadDeleteConfirm,
    threadPickerFocusIdx,
    setThreadPickerFocusIdx,
    hoveredThreadId,
    setHoveredThreadId,
    threadPickerRef,
    bottomRef,
    reducedMotion,
    actionFeedback,
    messageActionState,
    activeFocusSession,
    insightsResource,
    latestCompletedAssistantId,
    analyticsContext,
    submitMessage,
    scrollToBottom,
    handleSend,
    handleRetry,
    handleCopy,
    handleRate,
    handleMessageAction,
    handleNewChat,
    loadThread,
    handleDeleteThreadConfirmed,
    handleSearchResultClick,
    recentThreadPrompts,
    triggerActionFeedback,
  } = chat

  const onSuggestedSend = useCallback((text: string) => {
    void handleSend(text, { trigger: 'suggested' })
  }, [handleSend])

  if (!settings || hasApiKey === null) {
    if (insightsResource.error && !insightsResource.loading) {
      return (
        <div className="ai-workspace__error">
          <p>Couldn&apos;t load AI settings. {insightsResource.error}</p>
          <button type="button" onClick={() => { void insightsResource.refresh() }}>Retry</button>
        </div>
      )
    }
    return <div className="ai-workspace__loading">Loading AI…</div>
  }

  const providerMeta = AI_PROVIDER_META[settings.aiProvider]
  const isCliProvider = settings.aiProvider === 'claude-cli' || settings.aiProvider === 'codex-cli'
  const cliMissing = settings.aiProvider === 'claude-cli'
    ? !cliTools?.claude
    : settings.aiProvider === 'codex-cli'
      ? !cliTools?.codex
      : false

  const showEmptyHero = messages.length === 0

  return (
    <div className="ai-workspace">
      <div className="ai-workspace__scroll">
        <div className="ai-workspace__inner">
          <LocalHistorySearch onResultClick={handleSearchResultClick} />

          <AIThreadBar
            threads={threads}
            activeThreadId={activeThreadId}
            threadPickerOpen={threadPickerOpen}
            threadPickerFocusIdx={threadPickerFocusIdx}
            threadDeleteConfirm={threadDeleteConfirm}
            hoveredThreadId={hoveredThreadId}
            threadPickerRef={threadPickerRef}
            onTogglePicker={() => {
              setThreadPickerOpen((open) => !open)
              setThreadDeleteConfirm(null)
              setThreadPickerFocusIdx(0)
            }}
            onNewChat={handleNewChat}
            onFocusIdxChange={setThreadPickerFocusIdx}
            onHoverThread={setHoveredThreadId}
            onLoadThread={(id) => { void loadThread(id) }}
            onDeleteConfirm={setThreadDeleteConfirm}
            onDeleteConfirmed={(thread) => { void handleDeleteThreadConfirmed(thread) }}
            onDismissPicker={() => {
              setThreadPickerOpen(false)
              setThreadDeleteConfirm(null)
            }}
          />

          {!hasApiKey && (
            <div>
              <ConnectAI
                variant="hero"
                initialProvider={settings.aiProvider}
                hasSavedAccess={false}
                onConnected={() => { void insightsResource.refresh() }}
              />
              {isCliProvider && cliMissing && (
                <p style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.6, color: 'var(--color-text-tertiary)' }}>
                  {providerMeta.label} is selected, but it is not installed on this machine yet.
                </p>
              )}
            </div>
          )}

          {showEmptyHero && hasApiKey && (
            <section className="ai-workspace__hero">
              <h1>What should we explore in your work history?</h1>
              <p>Search above, or ask about your day, reports, charts, and exports.</p>
              {recentThreadPrompts.length > 0 && (
                <div className="ai-workspace__recent">
                  {recentThreadPrompts.map((thread) => (
                    <button
                      key={thread.id}
                      type="button"
                      className="ai-workspace__recent-item"
                      onClick={() => { void loadThread(thread.id) }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                        <path d="M3.5 4.5h9M3.5 8h6M3.5 11.5h7.5" strokeLinecap="round" />
                      </svg>
                      {thread.title}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {messages.length > 0 && (
            <div className="ai-workspace__messages">
              <MessageList
                messages={messages}
                messageActionState={messageActionState}
                actionFeedback={actionFeedback}
                latestCompletedAssistantId={latestCompletedAssistantId}
                reducedMotion={reducedMotion}
                activeFocusSession={activeFocusSession}
                scrollToBottom={scrollToBottom}
                analyticsContext={analyticsContext}
                onRetry={(index, message) => { void handleRetry(index, message) }}
                onCopy={(id, content, kind) => { void handleCopy(id, content, kind) }}
                onRate={(message, rating) => { void handleRate(message, rating) }}
                onMessageAction={(id, action, options) => { void handleMessageAction(id, action, options) }}
                onSend={onSuggestedSend}
                triggerActionFeedback={triggerActionFeedback}
              />
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>

      {hasApiKey && (
        <div className="ai-workspace__dock">
          <div className="ai-workspace__dock-inner">
            <AICompose
              onSubmit={submitMessage}
              loading={loading}
              provider={settings.aiProvider}
              onNewChat={handleNewChat}
            />
          </div>
        </div>
      )}
    </div>
  )
}
