import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ANALYTICS_EVENT } from '@shared/analytics'
import type { AIThreadSettings } from '@shared/types'
import { track } from '../../lib/analytics'
import { ipc } from '../../lib/ipc'
import { AI_PROVIDER_META } from '../../lib/aiProvider'
import ConnectAI from '../../components/ConnectAI'
import type { DaylensSearchResult } from '../../../preload/index'
import { AICompose, type AIComposeHandle } from './AICompose'
import { ChatActionPalette, type ChatPaletteAction } from './ChatActionPalette'
import { ConversationSidebar } from './ConversationSidebar'
import { HistorySearch } from './HistorySearch'
import { MessageList } from './MessageList'
import { ThreadSettingsPanel } from './ThreadSettingsPanel'
import { IconGear, IconNewChat, IconSidebar, IconSparkle } from './icons'
import { useAIChat } from './useAIChat'
import { ANSWER_TRANSFORMS, type ThreadMessage } from './types'

const SIDEBAR_COLLAPSED_KEY = 'daylens.ai.sidebarCollapsed'

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
    threadLoading,
    threads,
    activeThreadId,
    activeThreadLabel,
    activeModel,
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
    handleErrorRetry,
    handleCopy,
    handleRate,
    handleMessageAction,
    handleNewChat,
    selectThread,
    deleteThread,
    archiveThread,
    handlePromptChipClick,
    switchProviderAndRetry,
    alternateProviders,
    transformAnswer,
    providerAvailability,
    analyticsContext,
  } = chat

  const bottomRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<AIComposeHandle>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1' } catch { return false }
  })

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])

  // D4: per-thread settings (model override + instructions).
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [threadSettings, setThreadSettings] = useState<AIThreadSettings>({ provider: null, model: null, instructions: null })

  // Load the active thread's overrides so the header subline + the panel reflect
  // them. A brand-new (unsent) chat has no thread row yet, so settings stay empty.
  useEffect(() => {
    if (activeThreadId == null) {
      setThreadSettings({ provider: null, model: null, instructions: null })
      return
    }
    let cancelled = false
    void ipc.ai.getThreadSettings(activeThreadId)
      .then((settings) => { if (!cancelled) setThreadSettings(settings) })
      .catch(() => { /* best-effort */ })
    return () => { cancelled = true }
  }, [activeThreadId])

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const onNewChat = useCallback(() => {
    handleNewChat()
    composerRef.current?.focus()
  }, [handleNewChat])

  // U3: ⌘N / Ctrl+N starts a new chat while the AI tab is open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        onNewChat()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onNewChat])

  // ── D3: ⌘K action palette + direct accelerators on the focused message ──────
  const [paletteOpen, setPaletteOpen] = useState(false)
  const isMac = useMemo(() => navigator.platform.toLowerCase().includes('mac'), [])
  const accel = useCallback(
    (key: string, shift = false) => (isMac ? `${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`),
    [isMac],
  )

  const copyChat = useCallback(async () => {
    const text = messages
      .filter((m) => m.state !== 'pending')
      .map((m) => `${m.role === 'user' ? 'You' : 'Daylens'}: ${m.content}`)
      .join('\n\n')
    if (!text.trim()) return
    try { await navigator.clipboard.writeText(text) } catch { /* clipboard unsupported */ }
  }, [messages])

  // The "focused message" the palette acts on is the latest completed answer.
  const latestAssistant = useMemo(() => {
    const index = messages.findIndex((m) => m.id === latestCompletedAssistantId)
    return index >= 0 ? { message: messages[index], index } : null
  }, [messages, latestCompletedAssistantId])

  const paletteActions = useMemo<ChatPaletteAction[]>(() => {
    const list: ChatPaletteAction[] = []
    const target = latestAssistant
    if (target) {
      list.push({ id: 'copy-response', label: 'Copy Response', accelerator: accel('C', true), perform: () => handleCopy(target.message.id, target.message.content, target.message.answerKind) })
    }
    list.push({ id: 'copy-chat', label: 'Copy Chat', hint: 'Copy the whole conversation', perform: () => copyChat() })
    if (target) {
      list.push({ id: 'regenerate', label: 'Regenerate', accelerator: accel('R'), perform: () => handleRetry(target.index, target.message) })
      // "Regenerate with Model" (⇧⌘R) — one entry per other configured provider
      // (reuses R2's switch-provider path; useful for the rate-limit story).
      alternateProviders.forEach((alt, i) => {
        list.push({
          id: `regen-${alt.provider}`,
          label: `Regenerate with ${alt.label}`,
          hint: 'Switch provider and rerun',
          accelerator: i === 0 ? accel('R', true) : undefined,
          perform: () => switchProviderAndRetry(target.message, alt.provider),
        })
      })
      list.push({ id: 'good', label: 'Good Response', accelerator: accel('=', true), perform: () => handleRate(target.message, target.message.rating === 'up' ? null : 'up') })
      list.push({ id: 'bad', label: 'Bad Response', accelerator: accel('-', true), perform: () => handleRate(target.message, target.message.rating === 'down' ? null : 'down') })
      // D6: transforms in the palette as well as the inline "Turn into…" menu.
      for (const transform of ANSWER_TRANSFORMS) {
        list.push({ id: `transform-${transform.kind}`, label: transform.label, hint: 'Transform the answer', perform: () => transformAnswer(transform.kind) })
      }
    }
    return list
  }, [latestAssistant, alternateProviders, accel, handleCopy, handleRetry, handleRate, switchProviderAndRetry, copyChat, transformAnswer])

  // Read the latest action context from a ref so the global key listener binds
  // once instead of rebinding every render.
  const accelStateRef = useRef({ hasApiKey, paletteOpen, latestAssistant, alternateProviders, handleCopy, handleRetry, handleRate, switchProviderAndRetry })
  accelStateRef.current = { hasApiKey, paletteOpen, latestAssistant, alternateProviders, handleCopy, handleRetry, handleRate, switchProviderAndRetry }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = accelStateRef.current
      if (!state.hasApiKey) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (!event.shiftKey && key === 'k') { event.preventDefault(); setPaletteOpen((open) => !open); return }
      if (state.paletteOpen) return // the palette owns its keys while open
      const target = state.latestAssistant
      // preventDefault only when we actually act, so an empty chat still allows
      // the platform default (e.g. ⌘R reload during development).
      if (!event.shiftKey && key === 'r') { if (target) { event.preventDefault(); void state.handleRetry(target.index, target.message) } return }
      if (event.shiftKey && key === 'r') {
        if (target) {
          event.preventDefault()
          const alt = state.alternateProviders[0]
          if (alt) void state.switchProviderAndRetry(target.message, alt.provider)
          else void state.handleRetry(target.index, target.message)
        }
        return
      }
      if (event.shiftKey && key === 'c') { if (target) { event.preventDefault(); void state.handleCopy(target.message.id, target.message.content, target.message.answerKind) } return }
      if (event.shiftKey && (event.code === 'Equal' || key === '=' || key === '+')) { if (target) { event.preventDefault(); void state.handleRate(target.message, target.message.rating === 'up' ? null : 'up') } return }
      if (event.shiftKey && (event.code === 'Minus' || key === '-' || key === '_')) { if (target) { event.preventDefault(); void state.handleRate(target.message, target.message.rating === 'down' ? null : 'down') } return }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const onSelectThread = useCallback((threadId: number) => {
    selectThread(threadId)
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
  // D2/U2: the friendly model label shown under the thread title — always the
  // real resolved model (R2), so it never disagrees with what actually ran.
  const modelLabel = providerMeta.models.find((m) => m.id === activeModel)?.label ?? activeModel ?? providerMeta.shortLabel
  // D4: when this thread overrides the model, the subline shows THAT model — it
  // is what will actually run for this thread's next turn.
  const overrideActive = Boolean(threadSettings.provider && threadSettings.model)
  const displayProviderMeta = AI_PROVIDER_META[overrideActive ? threadSettings.provider! : activeChatProvider]
  const displayModelId = overrideActive ? threadSettings.model! : activeModel
  const displayModelLabel = displayProviderMeta.models.find((m) => m.id === displayModelId)?.label ?? displayModelId ?? displayProviderMeta.shortLabel
  const isCliProvider = activeChatProvider === 'claude-cli' || activeChatProvider === 'codex-cli'
  const cliMissing = activeChatProvider === 'claude-cli'
    ? !cliTools?.claude
    : activeChatProvider === 'codex-cli'
      ? !cliTools?.codex
      : false
  const hasMessages = messages.length > 0

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ── D1: time-grouped, searchable conversation list with Archive. ── */}
      {hasApiKey && !sidebarCollapsed && (
        <ConversationSidebar
          threads={threads}
          activeThreadId={activeThreadId}
          onSelect={onSelectThread}
          onNewChat={onNewChat}
          onDelete={deleteThread}
          onArchive={archiveThread}
          onCollapse={toggleSidebar}
        />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
      {/* ── Top bar: sidebar toggle + thread title + model subline (U2/D2),
            search + new chat. No centered floating label. ── */}
      <header style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px', borderBottom: '1px solid var(--color-border-ghost)' }}>
        {hasApiKey && (
          <button
            type="button"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Show chat list' : 'Hide chat list'}
            aria-label={sidebarCollapsed ? 'Show chat list' : 'Hide chat list'}
            aria-pressed={!sidebarCollapsed}
            style={{ width: 34, height: 34, padding: 0, borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: sidebarCollapsed ? 'var(--color-surface)' : 'var(--color-surface-high)', color: 'var(--color-text-secondary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <IconSidebar />
          </button>
        )}
        <div style={{ minWidth: 0, flexShrink: 1, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 680, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeThreadLabel ?? 'New chat'}
          </div>
          {hasApiKey && (
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayProviderMeta.shortLabel} · {displayModelLabel}{overrideActive ? ' · custom' : ''}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 8 }} />
        <HistorySearch onResultClick={handleSearchResultClick} />
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          title="Chat actions"
          aria-label="Chat actions"
          style={{ height: 34, padding: '0 10px', borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', color: 'var(--color-text-tertiary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', fontSize: 11.5, fontWeight: 700, flexShrink: 0, letterSpacing: '0.02em' }}
        >
          {isMac ? '⌘K' : 'Ctrl K'}
        </button>
        {activeThreadId != null && (
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title={overrideActive ? 'Chat settings (custom model)' : 'Chat settings'}
            aria-label="Chat settings"
            style={{ width: 34, height: 34, padding: 0, borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: overrideActive ? 'var(--color-accent-dim)' : 'var(--color-surface)', color: 'var(--color-text-secondary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <IconGear />
          </button>
        )}
        <button
          type="button"
          onClick={onNewChat}
          title="New chat (⌘N)"
          aria-label="New chat"
          style={{ width: 34, height: 34, padding: 0, borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >
          <IconNewChat />
        </button>
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
                onErrorRetry={handleErrorRetry}
                onSwitchProvider={switchProviderAndRetry}
                onTransform={transformAnswer}
                onMessageAction={handleMessageAction}
                onFollowUpClick={onFollowUpClick}
                scrollToBottom={scrollToBottom}
              />
              <div ref={bottomRef} />
            </>
          ) : threadLoading ? (
            <div style={{ margin: 'auto 0', textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>Loading conversation…</p>
            </div>
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
      <ChatActionPalette isOpen={paletteOpen} actions={paletteActions} onClose={() => setPaletteOpen(false)} />
      {settingsOpen && activeThreadId != null && (
        <ThreadSettingsPanel
          threadId={activeThreadId}
          initial={threadSettings}
          providerAvailability={providerAvailability}
          globalLabel={`${providerMeta.shortLabel} · ${modelLabel}`}
          onClose={() => setSettingsOpen(false)}
          onSaved={(next) => setThreadSettings(next)}
        />
      )}
    </div>
  )
}
