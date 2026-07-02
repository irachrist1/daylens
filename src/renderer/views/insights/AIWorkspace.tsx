import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Copy, RefreshCw, SlidersHorizontal, ThumbsDown, ThumbsUp, Wand2 } from 'lucide-react'
import { ANALYTICS_EVENT } from '@shared/analytics'
import type { AIProviderMode, AIThreadSettings } from '@shared/types'
import { track } from '../../lib/analytics'
import { ipc } from '../../lib/ipc'
import { AI_PROVIDER_META } from '../../lib/aiProvider'
import {
  clearCommandSurfaceActions,
  openCommandPalette,
  setCommandSurfaceActions,
  type CommandSurfaceAction,
} from '../../lib/commandSurface'
import ConnectAI from '../../components/ConnectAI'
import { AICompose, type AIComposeHandle } from './AICompose'
import { ConversationSidebar } from './ConversationSidebar'
import { MessageList } from './MessageList'
import { ModelSelector } from './ModelSelector'
import { ThreadSettingsPanel } from './ThreadSettingsPanel'
import { IconChevronDown, IconNewChat, IconSidebar, IconSparkle } from './icons'
import { useAIChat } from './useAIChat'
import { ANSWER_TRANSFORMS, type ThreadMessage } from './types'

const SIDEBAR_COLLAPSED_KEY = 'daylens.ai.sidebarCollapsed'

// Map a chat provider to the settings key holding its chosen model, so picking a
// model for a brand-new (thread-less) chat updates the right global default.
const PROVIDER_MODEL_KEY: Record<AIProviderMode, 'anthropicModel' | 'openaiModel' | 'googleModel' | 'openrouterModel'> = {
  anthropic: 'anthropicModel',
  'claude-cli': 'anthropicModel',
  openai: 'openaiModel',
  'codex-cli': 'openaiModel',
  google: 'googleModel',
  openrouter: 'openrouterModel',
}

export default function AIWorkspace() {
  const chat = useAIChat()
  const {
    messages,
    loading,
    threadLoading,
    threadsHydrated,
    threads,
    activeThreadId,
    activeThreadLabel,
    activeModel,
    settings,
    cliTools,
    hasApiKey,
    billingAccess,
    activeFocusSession,
    actionFeedback,
    messageActionState,
    actionWidgetState,
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
    commitActionWidget,
    undoActionWidget,
    dismissActionWidget,
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
    // FB4: hidden by default — only an explicit "open" choice persists as '0'.
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) !== '0' } catch { return true }
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
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
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
      .then((next) => { if (!cancelled) setThreadSettings(next) })
      .catch(() => { /* best-effort */ })
    return () => { cancelled = true }
  }, [activeThreadId])

  // Empty-database awareness: a brand-new user has no tracked history yet, so the
  // data-dependent starter prompts ("What did I work on today?") would all
  // dead-end. Detect that once and swap to onboarding-focused prompts until real
  // activity exists. Fail open (assume history) so a query hiccup never hides the
  // normal prompts.
  const [hasHistory, setHasHistory] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    void ipc.db.getAppSummaries(365)
      .then((rows) => { if (!cancelled) setHasHistory((rows?.length ?? 0) > 0) })
      .catch(() => { if (!cancelled) setHasHistory(true) })
    return () => { cancelled = true }
  }, [])

  const [starterPrompts, setStarterPrompts] = useState<string[]>([])
  useEffect(() => {
    const isSettledEmptyChat = threadsHydrated
      && !threadLoading
      && activeThreadId == null
      && messages.length === 0
    if (!hasApiKey || hasHistory !== true || !isSettledEmptyChat) {
      setStarterPrompts([])
      return
    }
    let cancelled = false
    void ipc.ai.getStarterSuggestions()
      .then((suggestions) => { if (!cancelled) setStarterPrompts(suggestions) })
      .catch(() => { if (!cancelled) setStarterPrompts([]) })
    return () => { cancelled = true }
  }, [activeThreadId, hasApiKey, hasHistory, messages.length, threadLoading, threadsHydrated])

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

  const isMac = useMemo(() => navigator.platform.toLowerCase().includes('mac'), [])
  const accel = useCallback(
    (key: string, shift = false) => (isMac ? `${shift ? '⇧ ' : ''}⌘ ${key}` : `Ctrl ${shift ? 'Shift ' : ''}${key}`),
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

  // FB1: publish this view's contextual actions into the ONE global palette
  // (message actions when a message is focused, plus chat actions). The palette
  // renders them under "Actions for this message" and "Chat".
  useEffect(() => {
    if (!hasApiKey) { clearCommandSurfaceActions(); return }
    const list: CommandSurfaceAction[] = []
    const target = latestAssistant
    const small = (node: ReactNode) => node
    if (target) {
      list.push({ id: 'msg-copy', group: 'message', label: 'Copy response', accelerator: accel('C', true), icon: small(<Copy size={15} strokeWidth={1.8} />), perform: () => handleCopy(target.message.id, target.message.content, target.message.answerKind) })
      list.push({ id: 'msg-regenerate', group: 'message', label: 'Regenerate', accelerator: accel('R'), icon: small(<RefreshCw size={15} strokeWidth={1.8} />), perform: () => handleRetry(target.index, target.message) })
      alternateProviders.forEach((alt, i) => {
        list.push({ id: `msg-regen-${alt.provider}`, group: 'message', label: `Regenerate with ${alt.label}`, hint: 'Switch provider and rerun', accelerator: i === 0 ? accel('R', true) : undefined, icon: small(<RefreshCw size={15} strokeWidth={1.8} />), perform: () => switchProviderAndRetry(target.message, alt.provider) })
      })
      list.push({ id: 'msg-good', group: 'message', label: 'Good response', accelerator: accel('=', true), icon: small(<ThumbsUp size={15} strokeWidth={1.8} />), perform: () => handleRate(target.message, target.message.rating === 'up' ? null : 'up') })
      list.push({ id: 'msg-bad', group: 'message', label: 'Bad response', accelerator: accel('-', true), icon: small(<ThumbsDown size={15} strokeWidth={1.8} />), perform: () => handleRate(target.message, target.message.rating === 'down' ? null : 'down') })
      for (const transform of ANSWER_TRANSFORMS) {
        list.push({ id: `msg-transform-${transform.kind}`, group: 'message', label: transform.label, hint: 'Transform the answer', icon: small(<Wand2 size={15} strokeWidth={1.8} />), perform: () => transformAnswer(transform.kind) })
      }
    }
    list.push({ id: 'chat-new', group: 'chat', label: 'New chat', accelerator: accel('N'), icon: small(<IconNewChat />), perform: onNewChat })
    list.push({ id: 'chat-model', group: 'chat', label: 'Change model…', hint: 'Pick the model for this chat', icon: small(<SlidersHorizontal size={15} strokeWidth={1.8} />), perform: () => setModelSelectorOpen(true) })
    if (messages.length > 0) {
      list.push({ id: 'chat-copy-all', group: 'chat', label: 'Copy chat', hint: 'Copy the whole conversation', icon: small(<Copy size={15} strokeWidth={1.8} />), perform: () => copyChat() })
    }
    if (activeThreadId != null) {
      list.push({ id: 'chat-settings', group: 'chat', label: 'Chat settings…', icon: small(<SlidersHorizontal size={15} strokeWidth={1.8} />), perform: () => setSettingsOpen(true) })
    }
    setCommandSurfaceActions(list)
  }, [hasApiKey, latestAssistant, alternateProviders, accel, handleCopy, handleRetry, handleRate, switchProviderAndRetry, transformAnswer, onNewChat, copyChat, activeThreadId, messages.length])

  // Drop our actions when the AI view unmounts so the palette doesn't show stale
  // chat actions from another tab.
  useEffect(() => () => clearCommandSurfaceActions(), [])

  // Direct accelerators on the focused message (⌘R, ⇧⌘C, etc.). ⌘K is owned by
  // the app shell (App.tsx) — it always opens the one palette, never a chat.
  const accelStateRef = useRef({ hasApiKey, latestAssistant, alternateProviders, handleCopy, handleRetry, handleRate, switchProviderAndRetry })
  accelStateRef.current = { hasApiKey, latestAssistant, alternateProviders, handleCopy, handleRetry, handleRate, switchProviderAndRetry }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = accelStateRef.current
      if (!state.hasApiKey) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const target = state.latestAssistant
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

  // FB8: apply a model choice. For an existing thread → per-chat override (D4).
  // For a brand-new (thread-less) chat → set the global chat model so the first
  // turn uses it. Clearing the override only applies to a thread.
  const onApplyModel = useCallback(async (provider: AIProviderMode | null, model: string | null) => {
    if (activeThreadId != null) {
      try {
        const next = await ipc.ai.setThreadSettings(activeThreadId, {
          provider,
          model,
          instructions: threadSettings.instructions ?? null,
        })
        setThreadSettings(next)
      } catch { /* leave settings as-is on failure */ }
      return
    }
    if (provider && model) {
      try {
        await ipc.settings.set({ aiChatProvider: provider, [PROVIDER_MODEL_KEY[provider]]: model })
        await refreshProvider()
      } catch { /* best-effort */ }
    }
  }, [activeThreadId, threadSettings.instructions, refreshProvider])

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
  const modelLabel = providerMeta.models.find((m) => m.id === activeModel)?.label ?? activeModel ?? providerMeta.shortLabel
  // D4: when this thread overrides the model, the subline shows THAT model.
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
  const managedAccess = Boolean(billingAccess?.managed)

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ── D1: time-grouped, searchable conversation list with Archive.
            FB4: always mounted, width-animated so open/close slides smoothly. ── */}
      {hasApiKey && (
        <div
          style={{
            flexShrink: 0,
            width: sidebarCollapsed ? 0 : 248,
            overflow: 'hidden',
            transition: 'width 200ms cubic-bezier(0.22, 0.61, 0.36, 1)',
          }}
          aria-hidden={sidebarCollapsed}
        >
          <ConversationSidebar
            threads={threads}
            activeThreadId={activeThreadId}
            onSelect={onSelectThread}
            onDelete={deleteThread}
            onArchive={archiveThread}
          />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
      {/* ── Top bar: sidebar toggle + thread title + model subline (U2/D2/FB8),
            ⌘K (opens the one palette), chat settings, new chat. ── */}
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
            <button
              type="button"
              onClick={() => { if (!managedAccess) setModelSelectorOpen(true) }}
              title={managedAccess ? 'Daylens chooses and manages the model for this plan' : 'Change the model for this chat'}
              className="ai-model-subline"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 1, padding: '1px 5px', marginLeft: -5, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--color-text-tertiary)', fontSize: 11, cursor: managedAccess ? 'default' : 'pointer', maxWidth: '100%', overflow: 'hidden' }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {managedAccess ? 'Daylens managed AI' : `${displayProviderMeta.shortLabel} · ${displayModelLabel}${overrideActive ? ' · custom' : ''}`}
              </span>
              {!managedAccess && <span style={{ display: 'inline-flex', flexShrink: 0, opacity: 0.8 }}><IconChevronDown /></span>}
            </button>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 8 }} />
        <button
          type="button"
          onClick={() => openCommandPalette()}
          title="Search and commands"
          aria-label="Open command palette"
          style={{ height: 34, padding: '0 11px', borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', color: 'var(--color-text-tertiary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, flexShrink: 0 }}
        >
          <span style={{ display: 'inline-flex', color: 'var(--color-text-tertiary)' }}><IconSparkleSearch /></span>
          <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.02em' }}>{isMac ? '⌘K' : 'Ctrl K'}</span>
        </button>
        {activeThreadId != null && !managedAccess && (
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title={overrideActive ? 'Chat settings (custom model)' : 'Chat settings'}
            aria-label="Chat settings"
            style={{ width: 34, height: 34, padding: 0, borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: overrideActive ? 'var(--color-accent-dim)' : 'var(--color-surface)', color: 'var(--color-text-secondary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <SlidersHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
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
                actionWidgetState={actionWidgetState}
                reducedMotion={reducedMotion}
                activeFocusSession={activeFocusSession}
                onCopy={handleCopy}
                onRate={handleRate}
                onRetry={handleRetry}
                onErrorRetry={handleErrorRetry}
                onSwitchProvider={switchProviderAndRetry}
                onTransform={transformAnswer}
                onMessageAction={handleMessageAction}
                onCommitActionWidget={commitActionWidget}
                onUndoActionWidget={undoActionWidget}
                onDismissActionWidget={dismissActionWidget}
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
                  {hasHistory === false
                    ? 'Daylens is still learning your day. Ask how it works while your timeline fills in.'
                    : 'Grounded in your local history. Ask a question, or request a report, table, or export.'}
                </p>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 540 }}>
                {starterPrompts.map((prompt) => (
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
      {modelSelectorOpen && !managedAccess && (
        <ModelSelector
          providerAvailability={providerAvailability}
          currentProvider={displayProviderMeta.id}
          currentModel={displayModelId}
          isOverride={overrideActive}
          defaultLabel={`${providerMeta.shortLabel} · ${modelLabel}`}
          onApply={onApplyModel}
          onClose={() => setModelSelectorOpen(false)}
        />
      )}
      {settingsOpen && activeThreadId != null && !managedAccess && (
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

// A search-glyph for the header ⌘K affordance (search now lives in the palette).
function IconSparkleSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  )
}
