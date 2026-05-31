import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ANALYTICS_EVENT, classifyAIOutputIntent } from '@shared/analytics'
import type {
  AIChatTurnResult,
  AIMessageAction,
  AIThreadSummary,
  AppSettings,
  FocusSession,
} from '@shared/types'
import { useProjectionResource } from '../../hooks/useProjectionResource'
import { track } from '../../lib/analytics'
import { ipc } from '../../lib/ipc'
import { getSelectedModel } from '../../lib/aiProvider'
import { sanitizeIpcError } from '../../lib/ipcError'
import { sanitizeForRender } from '../../../shared/aiSanitize'
import { clearStreamingSnapshot, setStreamingSnapshot } from './streamingStore'
import {
  actionFeedbackKey,
  messageActionKey,
  threadMessagesFromHistory,
  type ActionFeedbackEntry,
  type MessageAction,
  type MessageActionStateEntry,
  type ThreadMessage,
} from './types'

type SendOptions = {
  contextOverride?: ThreadMessage['contextSnapshot']
  trigger?: 'freeform' | 'suggested' | 'retry'
  // R4: bounds the rate-limit auto-retry so it fires at most once per turn.
  autoRetryCount?: number
}

// R3: a turn that never resolves must still leave "Thinking" — convert a stuck
// pending row into a retryable error after this ceiling.
const SEND_TIMEOUT_MS = 90_000

function isCliProvider(provider: string | undefined | null): boolean {
  return provider === 'claude-cli' || provider === 'codex-cli'
}

export function useAIChat() {
  const location = useLocation()
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [threadLoading, setThreadLoading] = useState(false)
  const [threads, setThreads] = useState<AIThreadSummary[]>([])
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null)
  const [actionFeedback, setActionFeedback] = useState<Record<string, ActionFeedbackEntry>>({})
  const [messageActionState, setMessageActionState] = useState<Record<string, MessageActionStateEntry>>({})
  const [reducedMotion, setReducedMotion] = useState(false)

  const loadingRef = useRef(false)
  loadingRef.current = loading
  // U1: track the most recently requested thread so a slow getThread response
  // for a thread the user already navigated away from never clobbers the view.
  const latestRequestedThreadRef = useRef<number | null>(null)
  // R4: pending rate-limit auto-retry timers, cleared on unmount / new sends.
  const autoRetryTimeoutsRef = useRef<Record<string, number>>({})
  const actionFeedbackTimeoutsRef = useRef<Record<string, number>>({})
  const suggestionImpressionsRef = useRef<Record<string, boolean>>({})
  const aiScreenTrackedRef = useRef(false)
  const routedReportKeyRef = useRef<string | null>(null)
  const threadsHydratedRef = useRef(false)

  // Provider + environment load. Deliberately NOT keyed on activeThreadId and
  // deliberately free of the today-timeline rebuild + recap range the old tab
  // pulled on mount — those are the expensive projections the perf map flags.
  // CLI detection (which spawns child processes) only runs when a CLI provider
  // is actually selected.
  const providerResource = useProjectionResource<{
    settings: AppSettings
    cliTools: { claude: string | null; codex: string | null }
    hasProviderAccess: boolean
    activeFocusSession: FocusSession | null
  }>({
    scope: 'insights',
    load: async () => {
      const currentSettings = await ipc.settings.get()
      const chatProvider = currentSettings.aiChatProvider ?? currentSettings.aiProvider
      const providersToCheck = Array.from(new Set([
        chatProvider,
        ...(currentSettings.aiFallbackOrder ?? []),
      ]))
      const needsCliDetection = providersToCheck.some(isCliProvider)

      const [cliToolsResult, apiProviderAccessChecks, activeFocusSession] = await Promise.all([
        needsCliDetection
          ? ipc.ai.detectCliTools().catch(() => ({ claude: null, codex: null }))
          : Promise.resolve({ claude: null, codex: null }),
        Promise.all(providersToCheck
          .filter((provider) => !isCliProvider(provider))
          .map((provider) => ipc.settings.hasApiKey(provider).catch(() => false))),
        ipc.focus.getActive().catch(() => null),
      ])

      const providerAccess = providersToCheck.some((provider) => (
        provider === 'claude-cli'
          ? !!cliToolsResult.claude
          : provider === 'codex-cli'
            ? !!cliToolsResult.codex
            : apiProviderAccessChecks.shift() ?? false
      ))

      return {
        settings: currentSettings,
        cliTools: cliToolsResult as { claude: string | null; codex: string | null },
        hasProviderAccess: providerAccess,
        activeFocusSession: activeFocusSession as FocusSession | null,
      }
    },
    dependencies: [],
  })

  const settings = providerResource.data?.settings ?? null
  const cliTools = providerResource.data?.cliTools ?? null
  const hasApiKey = providerResource.data ? providerResource.data.hasProviderAccess : null
  const activeFocusSession = providerResource.data?.activeFocusSession ?? null
  // `refresh` is stable across renders (useProjectionResource memoizes it), so
  // handlers can depend on it without churning their own identity each render.
  const refreshProvider = providerResource.refresh

  const activeProvider = settings ? (settings.aiChatProvider ?? settings.aiProvider) : null
  const activeModel = settings && activeProvider
    ? getSelectedModel({
        aiProvider: activeProvider,
        anthropicModel: settings.anthropicModel,
        openaiModel: settings.openaiModel,
        googleModel: settings.googleModel,
        openrouterModel: settings.openrouterModel,
      })
    : null

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  )
  const activeThreadLabel = activeThread && activeThread.title.trim() && activeThread.title !== 'New chat'
    ? activeThread.title
    : null

  const analyticsContext = useCallback((extra: Record<string, unknown> = {}) => ({
    has_ai_provider: Boolean(hasApiKey),
    ...(activeModel ? { model: activeModel } : {}),
    ...(activeProvider ? { provider: activeProvider } : {}),
    surface: 'ai',
    ...extra,
  }), [hasApiKey, activeModel, activeProvider])

  // ── Streaming: snapshots flow into a per-message store; only <StreamingMessage>
  // re-renders on a chunk, never this hook's consumers or the composer.
  useEffect(() => {
    return ipc.ai.onStream((event) => {
      const { text: safeSnapshot, report } = sanitizeForRender(event.snapshot ?? '')
      if (report.redactionCount > 0) {
        track(ANALYTICS_EVENT.AI_OUTPUT_REDACTED, {
          surface: 'ai_chat',
          request_id: event.requestId,
          redaction_count: report.redactionCount,
          patterns_hit: report.patternsHit,
        })
      }
      setStreamingSnapshot(`assistant:${event.requestId}`, safeSnapshot)
    })
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => () => {
    for (const timeout of Object.values(actionFeedbackTimeoutsRef.current)) {
      window.clearTimeout(timeout)
    }
    for (const timeout of Object.values(autoRetryTimeoutsRef.current)) {
      window.clearTimeout(timeout)
    }
  }, [])

  const loadThread = useCallback(async (threadId: number) => {
    // U1: selecting a thread must load ITS messages, not just update the header.
    // The old guard dropped the fetched messages whenever a send was in flight,
    // which is exactly the "header changes, body stays empty" bug. Instead we
    // stale-guard by thread id: only the latest requested thread may write.
    setActiveThreadId(threadId)
    latestRequestedThreadRef.current = threadId
    setThreadLoading(true)
    try {
      const detail = await ipc.ai.getThread(threadId)
      if (latestRequestedThreadRef.current !== threadId) return
      setMessages(threadMessagesFromHistory(detail.messages))
    } catch (error) {
      // Surface the failure as an inline error rather than silently keeping a
      // mismatched view (R4 — no raw IPC text).
      if (latestRequestedThreadRef.current !== threadId) return
      const { message } = sanitizeIpcError(error, "Couldn't load this conversation. Try again.")
      setMessages([{ id: `thread-error:${threadId}`, role: 'assistant', content: message, createdAt: Date.now(), state: 'error' }])
    } finally {
      if (latestRequestedThreadRef.current === threadId) setThreadLoading(false)
    }
  }, [])

  // Hydrate the thread list once and adopt the most recent thread — unless the
  // tab was opened via a deep link (/ai?threadId=…), in which case the deep-link
  // effect below owns which thread loads and we must not race it.
  useEffect(() => {
    if (threadsHydratedRef.current) return
    threadsHydratedRef.current = true
    const deepLinkThreadId = Number(new URLSearchParams(location.search).get('threadId'))
    const hasDeepLink = Number.isFinite(deepLinkThreadId) && deepLinkThreadId > 0
    let cancelled = false
    ipc.ai.listThreads({ includeArchived: false }).then((rows) => {
      if (cancelled) return
      setThreads(rows)
      const first = rows[0]
      if (first && !hasDeepLink) void loadThread(first.id)
    }).catch(() => { /* best-effort */ })
    return () => { cancelled = true }
  }, [loadThread, location.search])

  // Screen-open analytics once provider state is known.
  useEffect(() => {
    if (!settings || hasApiKey === null || aiScreenTrackedRef.current) return
    aiScreenTrackedRef.current = true
    track(ANALYTICS_EVENT.AI_SCREEN_OPENED, analyticsContext({ trigger: 'navigation', view: 'ai' }))
  }, [hasApiKey, settings, analyticsContext])

  const latestCompletedAssistantId = useMemo(() => (
    [...messages].reverse().find((m) => m.role === 'assistant' && m.state === 'complete')?.id
  ), [messages])

  // Suggested-question impression analytics.
  useEffect(() => {
    const latest = [...messages].reverse().find((message) => (
      message.role === 'assistant'
      && message.state === 'complete'
      && message.id === latestCompletedAssistantId
      && (message.suggestedFollowUps?.length ?? 0) >= 2
    ))
    if (!latest) return
    const key = String(latest.id)
    if (suggestionImpressionsRef.current[key]) return
    suggestionImpressionsRef.current[key] = true
    track(ANALYTICS_EVENT.AI_SUGGESTED_QUESTION_IMPRESSION, analyticsContext({
      answer_kind: latest.answerKind ?? null,
      suggestion_count: latest.suggestedFollowUps?.length ?? 0,
      source: 'followup',
    }))
  }, [latestCompletedAssistantId, messages, analyticsContext])

  const triggerActionFeedback = useCallback((
    messageId: string | number,
    action: MessageAction,
    options?: { successMs?: number },
  ) => {
    const key = actionFeedbackKey(messageId, action)
    const success = Boolean(options?.successMs)
    if (actionFeedbackTimeoutsRef.current[key]) {
      window.clearTimeout(actionFeedbackTimeoutsRef.current[key])
      delete actionFeedbackTimeoutsRef.current[key]
    }
    setActionFeedback((current) => ({
      ...current,
      [key]: { pulseNonce: (current[key]?.pulseNonce ?? 0) + 1, success },
    }))
    if (options?.successMs) {
      actionFeedbackTimeoutsRef.current[key] = window.setTimeout(() => {
        setActionFeedback((current) => {
          const entry = current[key]
          if (!entry) return current
          return { ...current, [key]: { ...entry, success: false } }
        })
        delete actionFeedbackTimeoutsRef.current[key]
      }, options.successMs)
    }
  }, [])

  const refreshThreadsAfterTurn = useCallback(async () => {
    // sendMessage auto-creates a thread server-side when none is passed. Adopt
    // the newest row so follow-up turns (and retries) stay linked to it.
    try {
      const refreshed = await ipc.ai.listThreads({ includeArchived: false })
      setThreads(refreshed)
      setActiveThreadId((current) => current ?? refreshed[0]?.id ?? null)
    } catch { /* best-effort */ }
  }, [])

  const handleSend = useCallback(async (text?: string, options?: SendOptions) => {
    const prompt = (text ?? '').trim()
    if (!prompt || loadingRef.current || !hasApiKey) return
    const trigger = options?.trigger ?? 'freeform'
    const autoRetryCount = options?.autoRetryCount ?? 0
    const queryKind = classifyAIOutputIntent(prompt)

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const createdAt = Date.now()
    const userId = `user:${requestId}`
    const assistantId = `assistant:${requestId}`

    track(ANALYTICS_EVENT.AI_QUERY_SENT, analyticsContext({ query_kind: queryKind, trigger }))
    if (queryKind !== 'question') {
      track(ANALYTICS_EVENT.AI_OUTPUT_REQUESTED, analyticsContext({ export_type: queryKind, trigger }))
    }

    // A fresh send supersedes any scheduled rate-limit auto-retry.
    for (const handle of Object.values(autoRetryTimeoutsRef.current)) window.clearTimeout(handle)
    autoRetryTimeoutsRef.current = {}

    setLoading(true)
    setMessages((current) => [
      ...current,
      { id: userId, role: 'user', content: prompt, createdAt, state: 'complete' },
      { id: assistantId, role: 'assistant', content: '', createdAt, state: 'pending' },
    ])

    // R3: race the turn against a hard timeout so a stuck request always
    // resolves the pending row to a retryable error — never an eternal spinner.
    let timedOut = false
    let timeoutHandle: number | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = window.setTimeout(() => { timedOut = true; reject(new Error('timeout')) }, SEND_TIMEOUT_MS)
    })

    try {
      const response = await Promise.race([
        ipc.ai.sendMessage({
          message: prompt,
          contextOverride: options?.contextOverride ?? null,
          clientRequestId: requestId,
          threadId: activeThreadId,
        }),
        timeoutPromise,
      ]) as AIChatTurnResult

      // R3: flip the pending row to the final answer FIRST. The visible
      // completion must not be gated on the thread-list refresh that follows —
      // that ordering was why answers only appeared after navigating away.
      setMessages((current) => current.map((message) => (
        message.id === assistantId
          ? { ...response.assistantMessage, state: 'complete' as const }
          : message
      )))
      track(ANALYTICS_EVENT.AI_QUERY_ANSWERED, analyticsContext({
        answer_kind: response.assistantMessage.answerKind ?? null,
        query_kind: queryKind,
        trigger,
        provider_calls: response.providerCallCount ?? null,
      }))
      void refreshThreadsAfterTurn()
    } catch (error) {
      const sanitized = sanitizeIpcError(
        error,
        timedOut ? 'That took longer than expected. Tap retry to run it again.' : undefined,
      )
      // R4: ride out a rate limit automatically, once, after a short backoff.
      // The backend already retried transient 429s; this waits for the
      // per-minute window before giving up to a manual Retry.
      const willAutoRetry = sanitized.isRateLimit && autoRetryCount < 1
      setMessages((current) => current.map((entry) => (
        entry.id === assistantId
          ? {
            ...entry,
            content: sanitized.message,
            state: 'error' as const,
            errorInfo: {
              isRateLimit: sanitized.isRateLimit,
              retryAfterSeconds: sanitized.retryAfterSeconds,
              autoRetryScheduled: willAutoRetry,
            },
          }
          : entry
      )))
      // Keep the (server-created) thread linked so a retry continues it rather
      // than spawning a duplicate.
      void refreshThreadsAfterTurn()
      if (willAutoRetry) {
        const waitMs = Math.min(45, Math.max(8, sanitized.retryAfterSeconds ?? 20)) * 1000
        autoRetryTimeoutsRef.current[assistantId] = window.setTimeout(() => {
          delete autoRetryTimeoutsRef.current[assistantId]
          // Replace the errored turn in place rather than appending a duplicate.
          setMessages((current) => current.filter((m) => m.id !== assistantId && m.id !== userId))
          void handleSendRef.current(prompt, {
            contextOverride: options?.contextOverride ?? null,
            trigger: 'retry',
            autoRetryCount: autoRetryCount + 1,
          })
        }, waitMs)
      }
    } finally {
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle)
      setLoading(false)
      clearStreamingSnapshot(assistantId)
    }
  }, [activeThreadId, hasApiKey, analyticsContext, refreshThreadsAfterTurn])

  // Stable submit reference for the memoized composer: its only re-render
  // trigger should be `loading`, not a fresh callback identity each render.
  const handleSendRef = useRef(handleSend)
  handleSendRef.current = handleSend
  const submitMessage = useCallback((text: string) => { void handleSendRef.current(text) }, [])

  const handleRetry = useCallback(async (index: number, message: ThreadMessage) => {
    if (message.id !== latestCompletedAssistantId) return
    triggerActionFeedback(message.id, 'retry')
    track(ANALYTICS_EVENT.AI_ANSWER_RETRIED, analyticsContext({ answer_kind: message.answerKind ?? null, trigger: 'retry' }))
    const historyUpToMessage = messages.slice(0, index)
    const previousUser = [...historyUpToMessage].reverse().find((m) => m.role === 'user')
    if (!previousUser) return
    await handleSend(previousUser.content, { contextOverride: message.contextSnapshot ?? null, trigger: 'retry' })
  }, [latestCompletedAssistantId, messages, triggerActionFeedback, analyticsContext, handleSend])

  // R4: retry a turn that ended in an error card. Cancels any pending
  // auto-retry for that row, then re-sends the user message that preceded it.
  const handleErrorRetry = useCallback(async (message: ThreadMessage) => {
    if (loadingRef.current) return
    const key = String(message.id)
    if (autoRetryTimeoutsRef.current[key]) {
      window.clearTimeout(autoRetryTimeoutsRef.current[key])
      delete autoRetryTimeoutsRef.current[key]
    }
    const index = messages.findIndex((m) => m.id === message.id)
    if (index < 0) return
    const previousUser = [...messages.slice(0, index)].reverse().find((m) => m.role === 'user')
    if (!previousUser) return
    track(ANALYTICS_EVENT.AI_ANSWER_RETRIED, analyticsContext({ answer_kind: message.answerKind ?? null, trigger: 'retry' }))
    // Replace the errored turn in place rather than appending a duplicate.
    setMessages((current) => current.filter((m) => m.id !== message.id && m.id !== previousUser.id))
    await handleSend(previousUser.content, { contextOverride: message.contextSnapshot ?? null, trigger: 'retry' })
  }, [messages, analyticsContext, handleSend])

  const handleCopy = useCallback(async (messageId: string | number, content: string, answerKind: ThreadMessage['answerKind']) => {
    try {
      await navigator.clipboard.writeText(content)
      triggerActionFeedback(messageId, 'copy', { successMs: 900 })
      track(ANALYTICS_EVENT.AI_ANSWER_COPIED, analyticsContext({ answer_kind: answerKind ?? null, trigger: 'copy' }))
    } catch { /* clipboard unsupported */ }
  }, [triggerActionFeedback, analyticsContext])

  const handleRate = useCallback(async (message: ThreadMessage, rating: 'up' | 'down' | null) => {
    if (typeof message.id !== 'number') return
    const previousRating = message.rating ?? null
    const previousRatingUpdatedAt = message.ratingUpdatedAt ?? null
    setMessages((current) => current.map((entry) => (
      entry.id === message.id ? { ...entry, rating, ratingUpdatedAt: rating ? Date.now() : null } : entry
    )))
    // Pulse the button that was actually clicked. When toggling a rating off,
    // `rating` is null, so fall back to the rating being cleared (message.rating).
    triggerActionFeedback(message.id, (rating ?? previousRating) === 'down' ? 'down' : 'up')
    track(ANALYTICS_EVENT.AI_ANSWER_RATED, analyticsContext({
      answer_kind: message.answerKind ?? null,
      rating: rating ?? 'cleared',
      trigger: 'manual',
    }))
    try {
      const persisted = await ipc.ai.setMessageFeedback({ messageId: message.id, rating })
      if (persisted) {
        setMessages((current) => current.map((entry) => (
          entry.id === message.id ? { ...entry, ...persisted, state: entry.state } : entry
        )))
      }
    } catch {
      setMessages((current) => current.map((entry) => (
        entry.id === message.id ? { ...entry, rating: previousRating, ratingUpdatedAt: previousRatingUpdatedAt } : entry
      )))
    }
  }, [triggerActionFeedback, analyticsContext])

  const handleMessageAction = useCallback(async (
    messageId: string | number,
    action: AIMessageAction,
    options?: { reviewNote?: string },
  ) => {
    const key = messageActionKey(messageId, action)
    setMessageActionState((current) => ({ ...current, [key]: { busy: true, error: null, successLabel: null } }))
    try {
      if (action.kind === 'start_focus_session') {
        await ipc.focus.start(action.payload)
        setMessageActionState((current) => ({ ...current, [key]: { busy: false, error: null, successLabel: 'Focus session started.' } }))
      } else if (action.kind === 'stop_focus_session') {
        await ipc.focus.stop(action.sessionId)
        setMessageActionState((current) => ({ ...current, [key]: { busy: false, error: null, successLabel: 'Focus session stopped.' } }))
      } else {
        const draft = (options?.reviewNote ?? action.suggestedNote ?? '').trim()
        if (!draft) {
          setMessageActionState((current) => ({ ...current, [key]: { busy: false, error: 'Add a short review before saving it.', successLabel: null } }))
          return
        }
        await ipc.focus.saveReflection({ sessionId: action.sessionId, note: draft })
        setMessageActionState((current) => ({ ...current, [key]: { busy: false, error: null, successLabel: 'Focus review saved.' } }))
      }
      await refreshProvider()
    } catch (error) {
      setMessageActionState((current) => ({
        ...current,
        [key]: { busy: false, error: error instanceof Error ? error.message : String(error), successLabel: null },
      }))
    }
  }, [refreshProvider])

  const clearFeedback = useCallback(() => {
    setActionFeedback({})
    setMessageActionState({})
    suggestionImpressionsRef.current = {}
  }, [])

  const resetComposerState = useCallback(() => {
    setMessages([])
    clearFeedback()
  }, [clearFeedback])

  // Instant new chat: reset to an empty draft synchronously. No createThread
  // round-trip — the server auto-creates the thread on the first send.
  const handleNewChat = useCallback(() => {
    if (loadingRef.current) return
    if (messages.length === 0 && activeThreadId == null) return
    // Cancel a scheduled auto-retry and invalidate any in-flight thread load so
    // neither writes into the fresh chat.
    for (const handle of Object.values(autoRetryTimeoutsRef.current)) window.clearTimeout(handle)
    autoRetryTimeoutsRef.current = {}
    latestRequestedThreadRef.current = null
    setThreadLoading(false)
    setActiveThreadId(null)
    resetComposerState()
  }, [messages.length, activeThreadId, resetComposerState])

  const selectThread = useCallback((threadId: number) => {
    if (threadId === activeThreadId) return
    // Clear per-message UI state but keep the current messages on screen until
    // the new thread's history arrives — switching shouldn't flash an empty view.
    clearFeedback()
    void loadThread(threadId)
  }, [activeThreadId, clearFeedback, loadThread])

  const deleteThread = useCallback(async (thread: AIThreadSummary) => {
    try {
      await ipc.ai.deleteThread(thread.id)
      const refreshed = await ipc.ai.listThreads({ includeArchived: false })
      setThreads(refreshed)
      if (thread.id === activeThreadId) {
        const next = refreshed[0]
        if (next) {
          resetComposerState()
          void loadThread(next.id)
        } else {
          setActiveThreadId(null)
          resetComposerState()
        }
      }
    } catch (error) {
      console.error('[ai] failed to delete thread', error)
    }
  }, [activeThreadId, resetComposerState, loadThread])

  // Deep link from Day Wrapped / notifications: /ai?threadId=…&artifactId=…
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const threadId = Number(params.get('threadId'))
    const artifactId = Number(params.get('artifactId'))
    if (!Number.isFinite(threadId) || threadId <= 0) return
    const routeKey = `${threadId}:${Number.isFinite(artifactId) && artifactId > 0 ? artifactId : 'none'}`
    if (routedReportKeyRef.current === routeKey) return
    routedReportKeyRef.current = routeKey

    void (async () => {
      const refreshed = await ipc.ai.listThreads({ includeArchived: false }).catch(() => null)
      if (refreshed) setThreads(refreshed)
      resetComposerState()
      await loadThread(threadId)
      if (Number.isFinite(artifactId) && artifactId > 0) {
        void ipc.ai.openArtifact(artifactId).catch(() => { /* best-effort */ })
      }
    })()
  }, [location.search, loadThread, resetComposerState])

  const handlePromptChipClick = useCallback((prompt: string, source: string) => {
    if (!hasApiKey) return
    track(ANALYTICS_EVENT.AI_SUGGESTED_QUESTION_CLICKED, analyticsContext({ source, trigger: 'suggested' }))
    void handleSend(prompt, { trigger: 'suggested' })
  }, [hasApiKey, analyticsContext, handleSend])

  return {
    // state
    messages,
    loading,
    threadLoading,
    threads,
    activeThreadId,
    activeThreadLabel,
    activeModel,
    activeProvider,
    settings,
    cliTools,
    hasApiKey,
    activeFocusSession,
    actionFeedback,
    messageActionState,
    reducedMotion,
    latestCompletedAssistantId,
    // resource status (for the load gate + ConnectAI refresh)
    initialLoading: providerResource.loading && !providerResource.data,
    loadError: providerResource.error,
    refreshProvider,
    // actions
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
    triggerActionFeedback,
    handlePromptChipClick,
    analyticsContext,
  }
}

export type UseAIChat = ReturnType<typeof useAIChat>
