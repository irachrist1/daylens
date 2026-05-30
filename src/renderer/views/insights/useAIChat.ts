import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ANALYTICS_EVENT, blockCountBucket, classifyAIOutputIntent, trackedTimeBucket } from '@shared/analytics'
import type {
  AIChatTurnResult,
  AIMessageAction,
  AIThreadMessage,
  AIThreadSummary,
  AppSettings,
  DayTimelinePayload,
  FocusSession,
} from '@shared/types'
import { useProjectionResource } from '../../hooks/useProjectionResource'
import { track } from '../../lib/analytics'
import { ipc } from '../../lib/ipc'
import { todayString } from '../../lib/format'
import { getSelectedModel } from '../../lib/aiProvider'
import { sanitizeForRender } from '../../../shared/aiSanitize'
import type { DaylensSearchResult } from '../../../preload/index'
import { clearStreamingSnapshot, setStreamingSnapshot } from './streamingStore'
import { threadMessagesFromHistory } from './messageUtils'
import type { ActionFeedbackEntry, MessageAction, MessageActionStateEntry, ThreadMessage } from './types'
import { actionFeedbackKey } from './types'
import { messageActionKey } from './messageUtils'

export function useAIChat() {
  const location = useLocation()
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<Record<string, ActionFeedbackEntry>>({})
  const [messageActionState, setMessageActionState] = useState<Record<string, MessageActionStateEntry>>({})
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [cliTools, setCliTools] = useState<{ claude: string | null; codex: string | null } | null>(null)
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const [threads, setThreads] = useState<AIThreadSummary[]>([])
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null)
  const [threadPickerOpen, setThreadPickerOpen] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [hoveredThreadId, setHoveredThreadId] = useState<number | null>(null)
  const [threadDeleteConfirm, setThreadDeleteConfirm] = useState<number | null>(null)
  const [threadPickerFocusIdx, setThreadPickerFocusIdx] = useState(0)
  const [analyticsToday, setAnalyticsToday] = useState<DayTimelinePayload | null>(null)
  const threadPickerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const routedReportKeyRef = useRef<string | null>(null)
  const loadingRef = useRef(false)
  const historyHydratedThreadRef = useRef<number | null | undefined>(undefined)
  const actionFeedbackTimeoutsRef = useRef<Record<string, number>>({})
  const suggestionImpressionsRef = useRef<Record<string, boolean>>({})
  const aiScreenTrackedRef = useRef(false)
  loadingRef.current = loading

  const insightsResource = useProjectionResource<{
    historyThreadId: number | null
    history: AIThreadMessage[]
    settings: AppSettings
    cliTools: { claude: string | null; codex: string | null }
    hasProviderAccess: boolean
    activeFocusSession: FocusSession | null
  }>({
    scope: 'insights',
    load: async () => {
      const currentSettings = await ipc.settings.get()
      const providersToCheck = [currentSettings.aiProvider]

      const [history, cliToolsResult, apiProviderAccessChecks, activeFocusSession] = await Promise.all([
        activeThreadId == null
          ? Promise.resolve([])
          : ipc.ai.getHistory({ threadId: activeThreadId }).catch(() => []),
        ipc.ai.detectCliTools().catch(() => ({ claude: null, codex: null })),
        Promise.all(providersToCheck
          .filter((provider) => provider !== 'claude-cli' && provider !== 'codex-cli')
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
        historyThreadId: activeThreadId,
        history: history as AIThreadMessage[],
        settings: currentSettings,
        cliTools: cliToolsResult as { claude: string | null; codex: string | null },
        hasProviderAccess: providerAccess,
        activeFocusSession: activeFocusSession as FocusSession | null,
      }
    },
    dependencies: [activeThreadId],
  })

  useEffect(() => {
    let cancelled = false
    void ipc.db.getTimelineDay(todayString()).then((payload) => {
      if (!cancelled) setAnalyticsToday(payload)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!insightsResource.data) return
    setSettings(insightsResource.data.settings)
    setCliTools(insightsResource.data.cliTools)
    setHasApiKey(insightsResource.data.hasProviderAccess)
    if (insightsResource.data.historyThreadId !== activeThreadId) return
    if (historyHydratedThreadRef.current !== insightsResource.data.historyThreadId && !loadingRef.current) {
      setMessages(threadMessagesFromHistory(insightsResource.data.history))
      historyHydratedThreadRef.current = insightsResource.data.historyThreadId
    }
  }, [activeThreadId, insightsResource.data])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: messages.length > 0 ? 'smooth' : 'auto' })
  }, [messages.length, loading])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    let cancelled = false
    ipc.ai.listThreads({ includeArchived: false }).then((rows) => {
      if (cancelled) return
      setThreads(rows)
      setActiveThreadId((current) => current ?? rows[0]?.id ?? null)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

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
    return () => {
      for (const timeout of Object.values(actionFeedbackTimeoutsRef.current)) {
        window.clearTimeout(timeout)
      }
    }
  }, [])

  const activeFocusSession = insightsResource.data?.activeFocusSession ?? null
  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  )
  const activeProvider = settings?.aiProvider ?? null
  const activeModel = settings && activeProvider
    ? getSelectedModel({
        aiProvider: activeProvider,
        anthropicModel: settings.anthropicModel,
        openaiModel: settings.openaiModel,
        googleModel: settings.googleModel,
      })
    : null

  const analyticsContext = useCallback((extra: Record<string, unknown> = {}) => ({
    block_count_bucket: blockCountBucket(analyticsToday?.blocks.length ?? 0),
    has_ai_provider: Boolean(hasApiKey),
    ...(activeModel ? { model: activeModel } : {}),
    ...(activeProvider ? { provider: activeProvider } : {}),
    surface: 'ai',
    tracked_time_bucket: trackedTimeBucket(analyticsToday?.totalSeconds ?? 0),
    ...extra,
  }), [activeModel, activeProvider, analyticsToday, hasApiKey])

  const latestCompletedAssistantId = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.state === 'complete')?.id

  useEffect(() => {
    if (!settings || hasApiKey === null || aiScreenTrackedRef.current) return
    aiScreenTrackedRef.current = true
    track(ANALYTICS_EVENT.AI_SCREEN_OPENED, analyticsContext({
      trigger: 'navigation',
      view: 'ai',
    }))
  }, [analyticsContext, hasApiKey, settings])

  useEffect(() => {
    const latestAssistant = [...messages]
      .reverse()
      .find((message) => (
        message.role === 'assistant'
        && message.state === 'complete'
        && message.id === latestCompletedAssistantId
        && (message.suggestedFollowUps?.length ?? 0) >= 2
      ))

    if (!latestAssistant) return
    const key = String(latestAssistant.id)
    if (suggestionImpressionsRef.current[key]) return
    suggestionImpressionsRef.current[key] = true
    track(ANALYTICS_EVENT.AI_SUGGESTED_QUESTION_IMPRESSION, analyticsContext({
      answer_kind: latestAssistant.answerKind ?? null,
      suggestion_count: latestAssistant.suggestedFollowUps?.length ?? 0,
      source: 'followup',
    }))
  }, [analyticsContext, latestCompletedAssistantId, messages])

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
      [key]: {
        pulseNonce: (current[key]?.pulseNonce ?? 0) + 1,
        success,
      },
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

  const handleSend = useCallback(async (
    text?: string,
    options?: {
      contextOverride?: ThreadMessage['contextSnapshot']
      trigger?: 'freeform' | 'suggested' | 'retry'
    },
  ) => {
    const prompt = (text ?? '').trim()
    if (!prompt || loading || !hasApiKey) return
    const trigger = options?.trigger ?? 'freeform'
    const queryKind = classifyAIOutputIntent(prompt)

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const createdAt = Date.now()
    const userId = `user:${requestId}`
    const assistantId = `assistant:${requestId}`

    track(ANALYTICS_EVENT.AI_QUERY_SENT, analyticsContext({ query_kind: queryKind, trigger }))
    if (queryKind !== 'question') {
      track(ANALYTICS_EVENT.AI_OUTPUT_REQUESTED, analyticsContext({ export_type: queryKind, trigger }))
    }

    setLoading(true)
    setMessages((current) => [
      ...current,
      { id: userId, role: 'user', content: prompt, createdAt, state: 'complete' },
      { id: assistantId, role: 'assistant', content: '', createdAt, state: 'pending' },
    ])

    try {
      const response = await ipc.ai.sendMessage({
        message: prompt,
        contextOverride: options?.contextOverride ?? null,
        clientRequestId: requestId,
        threadId: activeThreadId,
      }) as AIChatTurnResult

      try {
        const refreshed = await ipc.ai.listThreads({ includeArchived: false })
        setThreads(refreshed)
        if (activeThreadId == null) {
          const newest = refreshed[0]
          if (newest) {
            setActiveThreadId(newest.id)
            historyHydratedThreadRef.current = newest.id
          }
        }
      } catch { /* best-effort */ }

      setMessages((current) => current.map((message) => {
        if (message.id !== assistantId) return message
        return { ...response.assistantMessage, state: 'complete' } as ThreadMessage
      }))

      track(ANALYTICS_EVENT.AI_QUERY_ANSWERED, analyticsContext({
        answer_kind: response.assistantMessage.answerKind ?? null,
        query_kind: queryKind,
        trigger,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setMessages((current) => current.map((entry) => (
        entry.id === assistantId
          ? { ...entry, content: message, state: 'error' }
          : entry
      )))
    } finally {
      setLoading(false)
      clearStreamingSnapshot(assistantId)
    }
  }, [activeThreadId, analyticsContext, hasApiKey, loading])

  const submitMessage = useCallback((text: string) => {
    void handleSend(text)
  }, [handleSend])

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [])

  const handleRetry = useCallback(async (index: number, message: ThreadMessage) => {
    if (message.id !== latestCompletedAssistantId) return
    triggerActionFeedback(message.id, 'retry')
    track(ANALYTICS_EVENT.AI_ANSWER_RETRIED, analyticsContext({
      answer_kind: message.answerKind ?? null,
      trigger: 'retry',
    }))
    const historyUpToMessage = messages.slice(0, index)
    const previousUser = [...historyUpToMessage].reverse().find((entry) => entry.role === 'user')
    if (!previousUser) return
    await handleSend(previousUser.content, {
      contextOverride: message.contextSnapshot ?? null,
      trigger: 'retry',
    })
  }, [analyticsContext, handleSend, latestCompletedAssistantId, messages, triggerActionFeedback])

  const handleCopy = useCallback(async (messageId: string | number, content: string, answerKind: ThreadMessage['answerKind']) => {
    try {
      await navigator.clipboard.writeText(content)
      triggerActionFeedback(messageId, 'copy', { successMs: 900 })
      track(ANALYTICS_EVENT.AI_ANSWER_COPIED, analyticsContext({
        answer_kind: answerKind ?? null,
        trigger: 'copy',
      }))
    } catch { /* clipboard unsupported */ }
  }, [analyticsContext, triggerActionFeedback])

  const handleRate = useCallback(async (message: ThreadMessage, rating: 'up' | 'down' | null) => {
    if (typeof message.id !== 'number') return

    const previousRating = message.rating ?? null
    const previousRatingUpdatedAt = message.ratingUpdatedAt ?? null

    setMessages((current) => current.map((entry) => (
      entry.id === message.id
        ? { ...entry, rating, ratingUpdatedAt: rating ? Date.now() : null }
        : entry
    )))

    try {
      const persisted = await ipc.ai.setMessageFeedback({ messageId: message.id, rating })
      if (persisted) {
        setMessages((current) => current.map((entry) => (
          entry.id === message.id
            ? { ...entry, ...persisted, state: entry.state }
            : entry
        )))
      }
    } catch {
      setMessages((current) => current.map((entry) => (
        entry.id === message.id
          ? { ...entry, rating: previousRating, ratingUpdatedAt: previousRatingUpdatedAt }
          : entry
      )))
    }
  }, [])

  const handleMessageAction = useCallback(async (
    messageId: string | number,
    action: AIMessageAction,
    options?: { reviewNote?: string },
  ) => {
    const key = messageActionKey(messageId, action)
    setMessageActionState((current) => ({
      ...current,
      [key]: { busy: true, error: null, successLabel: null },
    }))

    try {
      if (action.kind === 'start_focus_session') {
        await ipc.focus.start(action.payload)
        setMessageActionState((current) => ({
          ...current,
          [key]: { busy: false, error: null, successLabel: 'Focus session started.' },
        }))
      } else if (action.kind === 'stop_focus_session') {
        await ipc.focus.stop(action.sessionId)
        setMessageActionState((current) => ({
          ...current,
          [key]: { busy: false, error: null, successLabel: 'Focus session stopped.' },
        }))
      } else {
        const draft = (options?.reviewNote ?? action.suggestedNote ?? '').trim()
        if (!draft) {
          setMessageActionState((current) => ({
            ...current,
            [key]: { busy: false, error: 'Add a short review before saving it.', successLabel: null },
          }))
          return
        }
        await ipc.focus.saveReflection({ sessionId: action.sessionId, note: draft })
        setMessageActionState((current) => ({
          ...current,
          [key]: { busy: false, error: null, successLabel: 'Focus review saved.' },
        }))
      }
      await insightsResource.refresh()
    } catch (error) {
      setMessageActionState((current) => ({
        ...current,
        [key]: {
          busy: false,
          error: error instanceof Error ? error.message : String(error),
          successLabel: null,
        },
      }))
    }
  }, [insightsResource])

  const resetThreadComposerState = useCallback((threadId: number | null) => {
    setMessages([])
    setActionFeedback({})
    setMessageActionState({})
    suggestionImpressionsRef.current = {}
    historyHydratedThreadRef.current = threadId
  }, [])

  const loadThread = useCallback(async (threadId: number, options?: { keepPickerOpen?: boolean }) => {
    if (!options?.keepPickerOpen) setThreadPickerOpen(false)
    setActiveThreadId(threadId)
    try {
      const detail = await ipc.ai.getThread(threadId)
      setMessages(threadMessagesFromHistory(detail.messages))
      historyHydratedThreadRef.current = threadId
    } catch { /* keep current UI */ }
  }, [])

  const restoreThreadPickerAfterUpdate = useCallback((shouldRestore: boolean) => {
    if (!shouldRestore) return
    window.requestAnimationFrame(() => setThreadPickerOpen(true))
  }, [])

  const handleDeleteThreadConfirmed = useCallback(async (thread: AIThreadSummary) => {
    const pickerWasOpen = threadPickerOpen
    setThreadDeleteConfirm(null)
    try {
      await ipc.ai.deleteThread(thread.id)
      const refreshed = await ipc.ai.listThreads({ includeArchived: false })
      setThreads(refreshed)
      restoreThreadPickerAfterUpdate(pickerWasOpen && refreshed.length > 0)
      const nextActiveId = thread.id === activeThreadId
        ? refreshed[0]?.id ?? null
        : activeThreadId !== null && !refreshed.some((entry) => entry.id === activeThreadId)
          ? refreshed[0]?.id ?? null
          : activeThreadId
      if (nextActiveId == null) {
        setActiveThreadId(null)
        resetThreadComposerState(null)
        setThreadPickerOpen(false)
        return
      }
      if (nextActiveId !== activeThreadId || thread.id === activeThreadId) {
        await loadThread(nextActiveId, { keepPickerOpen: pickerWasOpen })
        restoreThreadPickerAfterUpdate(pickerWasOpen && refreshed.length > 0)
      }
    } catch (error) {
      console.error('[ai] failed to delete thread', error)
    }
  }, [activeThreadId, loadThread, resetThreadComposerState, restoreThreadPickerAfterUpdate, threadPickerOpen])

  const handleNewChat = useCallback(() => {
    const activeThreadIsDraft = Boolean(activeThread && activeThread.messageCount === 0)
    if (activeThreadIsDraft) {
      setThreadPickerOpen(false)
      return
    }

    const reusableDraft = threads.find((thread) => thread.messageCount === 0)
    if (reusableDraft) {
      resetThreadComposerState(reusableDraft.id)
      setActiveThreadId(reusableDraft.id)
      setThreadPickerOpen(false)
      void loadThread(reusableDraft.id)
      return
    }

    resetThreadComposerState(null)
    setActiveThreadId(null)
    setThreadPickerOpen(false)

    void ipc.ai.createThread(null).then((thread) => {
      setActiveThreadId(thread.id)
      setThreads((prev) => [thread, ...prev.filter((entry) => entry.id !== thread.id)])
      historyHydratedThreadRef.current = thread.id
    }).catch((error) => {
      console.error('[ai] failed to create thread', error)
    })
  }, [activeThread, loadThread, resetThreadComposerState, threads])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const threadId = Number(params.get('threadId'))
    if (!Number.isFinite(threadId) || threadId <= 0) return

    const routeKey = String(threadId)
    if (routedReportKeyRef.current === routeKey) return
    routedReportKeyRef.current = routeKey

    void (async () => {
      const refreshed = await ipc.ai.listThreads({ includeArchived: false }).catch(() => null)
      if (refreshed) setThreads(refreshed)
      await loadThread(threadId)
    })()
  }, [loadThread, location.search])

  const handleSearchResultClick = useCallback((result: DaylensSearchResult) => {
    if (result.type === 'artifact') {
      void ipc.ai.openArtifact(result.id)
      return
    }
    if (result.type === 'browser' && result.url) {
      ipc.shell.openExternal(result.url)
      return
    }
    window.location.hash = `/timeline?view=day&date=${encodeURIComponent(result.date)}`
  }, [])

  const recentThreadPrompts = useMemo(
    () => threads
      .filter((thread) => thread.messageCount > 0 && thread.title.trim() && thread.title !== 'New chat')
      .slice(0, 6),
    [threads],
  )

  return {
    messages,
    loading,
    settings,
    cliTools,
    hasApiKey,
    threads,
    activeThreadId,
    activeThread,
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
  }
}
