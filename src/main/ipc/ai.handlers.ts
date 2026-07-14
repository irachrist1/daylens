import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type { AIAgentQuestionEvent } from '@shared/types'
import { cancelAIRequest } from '../lib/aiCancellation'
import { getThreadMessagesPage, updateAIMessageFeedback, writeAIBlockLabel } from '../db/queries'
import { getDb } from '../services/database'
import { uploadRatedAIMessageFeedback } from '../services/aiFeedbackUpload'
import {
  detectCLITools,
  getAppNarrative,
  generateDaySummary,
  generateWorkBlockInsight,
  getStarterSuggestions,
  getWeekReview,
  sendMessage,
  suggestAppCategory,
  testCLITool,
} from '../services/ai'
import { getWrappedNarrative } from '../services/wrappedNarrative'
import { getWrappedPeriodWrap } from '../services/wrappedPeriodNarrative'
import { askWrappedQuestion } from '../services/wrappedQuestion'
import { getWrapProviderState } from '../services/aiOrchestration'
import { getWrapPreflight } from '../services/wrapPreflight'
import { markRecapGenerated } from '../services/dailySummaryNotifier'
import { getTimelineDayPayload, getBlockDetailPayload } from '../services/workBlocks'
import { commitAction, undoAction } from '../ai/actions'
import { getCurrentSession } from '../services/tracking'
import { materializeTimelineDayProjection } from '../core/query/projections'
import { localDateString } from '../lib/localDate'
import {
  archiveThread,
  deleteThread,
  getThread,
  getThreadSettings,
  listThreadsLite,
  openArtifact,
  renameThread,
  setThreadSettings,
} from '../services/artifacts'
import { IPC, type AIActionCommitResult, type AIActionUndo, type AIActionWidget, type AIChatSendRequest, type AIStarterSuggestionResult, type AIThreadDetail, type AIThreadPageRequest, type AIThreadSettings, type AIThreadSummary, type WorkContextBlock, type WrappedAskRequest, type WrappedPeriod } from '@shared/types'

// Opening a conversation loads only this many of its newest messages; the
// renderer pages older ones in with "Load earlier messages".
const DEFAULT_THREAD_PAGE_SIZE = 60

function toThreadSummary(row: ReturnType<typeof listThreadsLite>[number]): AIThreadSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessageAt: row.lastMessageAt,
    archived: row.archived,
    messageCount: row.messageCount,
    lastSnippet: row.lastSnippet,
  }
}

// The agent's clarifying questions: the ask_user tool pauses the
// loop on a promise; the renderer shows the question card and answers over
// AGENT_ANSWER, which resolves it. A timeout resolves with a no-answer note so
// an unanswered question can never hang a turn forever.
const pendingAgentQuestions = new Map<string, (answer: string) => void>()
const AGENT_QUESTION_TIMEOUT_MS = 5 * 60 * 1000

export function registerAIHandlers(): void {
  ipcMain.handle(IPC.AI.SEND_MESSAGE, async (event, payload: AIChatSendRequest) => {
    return sendMessage(payload, {
      onStreamEvent: (streamEvent) => {
        event.sender.send(IPC.AI.STREAM_EVENT, streamEvent)
      },
      onAgentQuestion: (question) => new Promise<string>((resolve) => {
        const questionId = randomUUID()
        const timeout = setTimeout(() => {
          pendingAgentQuestions.delete(questionId)
          resolve('(No answer arrived — pick the most defensible reading, answer it, and say in one clause what you assumed.)')
        }, AGENT_QUESTION_TIMEOUT_MS)
        pendingAgentQuestions.set(questionId, (answer) => {
          clearTimeout(timeout)
          pendingAgentQuestions.delete(questionId)
          resolve(answer)
        })
        const questionEvent: AIAgentQuestionEvent = {
          questionId,
          requestId: payload.clientRequestId ?? null,
          question: question.question,
          options: question.options,
          allowFreeText: question.allowFreeText,
        }
        event.sender.send(IPC.AI.AGENT_QUESTION, questionEvent)
      }),
    })
  })

  ipcMain.handle(IPC.AI.AGENT_ANSWER, (_e, payload: { questionId: string; answer: string }): boolean => {
    const resolver = pendingAgentQuestions.get(payload.questionId)
    if (!resolver) return false
    resolver(payload.answer)
    return true
  })

  // Aborts the in-flight provider request for this turn.
  // Returns whether a matching turn was still running.
  ipcMain.handle(IPC.AI.CANCEL_MESSAGE, (_e, payload: { clientRequestId: string }): boolean => {
    return cancelAIRequest(payload.clientRequestId)
  })

  ipcMain.handle(IPC.AI.GET_STARTER_SUGGESTIONS, async (): Promise<AIStarterSuggestionResult> => {
    return getStarterSuggestions()
  })

  // DEV-109: commit an AI action proposal — the user confirmed the preview
  // widget, so now run the real change through the manual-edit pipeline. The
  // proposal carries everything needed; nothing was written before this call.
  ipcMain.handle(IPC.AI.COMMIT_ACTION, (_e, action: AIActionWidget): AIActionCommitResult => {
    return commitAction(getDb(), action)
  })

  ipcMain.handle(IPC.AI.UNDO_ACTION, (_e, undo: AIActionUndo): AIActionCommitResult => {
    return undoAction(getDb(), undo)
  })

  ipcMain.handle(IPC.AI.SET_MESSAGE_FEEDBACK, (_e, payload: { messageId: number; rating: 'up' | 'down' | null }) => {
    const db = getDb()
    const updated = updateAIMessageFeedback(db, payload.messageId, payload.rating)
    if (updated && payload.rating) {
      void uploadRatedAIMessageFeedback(db, payload.messageId, payload.rating)
    }
    return updated
  })

  ipcMain.handle(IPC.AI.GENERATE_DAY_SUMMARY, async (_e, date: string) => {
    const result = await generateDaySummary(date)
    // Record that the user generated a recap for this day: suppresses the next
    // morning's "yesterday's recap" notification (§4.1) and freezes the day's
    // snapshot so wraps sum a finalized day (invariant 4).
    markRecapGenerated(date)
    return result
  })

  ipcMain.handle(IPC.AI.GET_WEEK_REVIEW, async (_e, payload: { weekStart: string; force?: boolean }) => {
    return getWeekReview(payload.weekStart, payload.force ?? false)
  })

  ipcMain.handle(IPC.AI.GET_APP_NARRATIVE, async (
    _e,
    payload: { canonicalAppId: string; daysOrDate?: number | string; days?: number; force?: boolean },
  ) => {
    // `days` remains a compatibility fallback for callers from older renderer
    // bundles during development hot reloads.
    return getAppNarrative(
      payload.canonicalAppId,
      payload.daysOrDate ?? payload.days ?? 7,
      payload.force ?? false,
    )
  })

  ipcMain.handle(IPC.AI.GET_WRAPPED_NARRATIVE, async (_e, payload: { date: string; force?: boolean }) => {
    const today = (() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })()
    const liveSession = payload.date === today ? getCurrentSession() : null
    const dayPayload = getTimelineDayPayload(getDb(), payload.date, liveSession)
    return getWrappedNarrative(dayPayload, { triggerSource: 'user', force: payload.force === true })
  })

  ipcMain.handle(IPC.AI.GET_WRAPPED_PERIOD_NARRATIVE, async (_e, payload: { period: WrappedPeriod; anchorDate: string; force?: boolean }) => {
    return getWrappedPeriodWrap(payload.period, payload.anchorDate, { triggerSource: 'user', force: payload.force === true })
  })

  ipcMain.handle(IPC.AI.GET_WRAP_PROVIDER_STATE, async () => {
    return getWrapProviderState()
  })

  // Pre-flight data quality check: honest, specific
  // warnings before the first generation. Never blocks; the renderer offers a
  // one-tap "Generate anyway".
  ipcMain.handle(IPC.AI.GET_WRAP_PREFLIGHT, async (_e, payload: { date: string }) => {
    return getWrapPreflight(getDb(), payload.date)
  })

  // Ask-anything on a wrap slide (and answering the wrap's own question). One
  // short user-triggered call; no thread is created and nothing is persisted.
  ipcMain.handle(IPC.AI.ASK_WRAPPED, async (_e, payload: WrappedAskRequest) => {
    return askWrappedQuestion(payload)
  })

  ipcMain.handle(IPC.AI.GENERATE_BLOCK_INSIGHT, async (_e, block: WorkContextBlock) => {
    return generateWorkBlockInsight(block, { triggerSource: 'user' })
  })

  ipcMain.handle(IPC.AI.REGENERATE_BLOCK_LABEL, async (_e, blockId: string) => {
    // Load the block on the main side from its id instead of shipping the whole
    // WorkContextBlock (nested sessions, artifacts, websites) across IPC (F44).
    const db = getDb()
    const block = getBlockDetailPayload(db, blockId, getCurrentSession())
    if (!block) throw new Error('Block not found.')

    // Per-block "Regenerate" is the explicit "this label is wrong, fix it"
    // action. Tell the model which label was rejected so it doesn't hand back
    // the same one, then write with force so the redo overrides the existing
    // label.
    const rejectedLabel = block.label.override?.trim() || block.label.current?.trim() || block.aiLabel?.trim()
    const insight = await generateWorkBlockInsight(
      { ...block, label: { ...block.label, override: null } },
      { jobType: 'block_label_finalize', triggerSource: 'user', throwOnError: true, rejectedLabel },
    )
    const label = insight.label?.trim()
    if (!label) throw new Error('AI did not return a label.')

    const blockDate = localDateString(new Date(block.startTime))
    materializeTimelineDayProjection(db, blockDate, blockDate === localDateString() ? getCurrentSession() : null)
    const wrote = writeAIBlockLabel(db, {
      blockId: block.id,
      label,
      narrative: insight.narrative ?? null,
      force: true,
    })
    if (!wrote) {
      throw new Error('AI label could not be persisted. Reopen the timeline and try again.')
    }

    return insight
  })

  ipcMain.handle(IPC.AI.SUGGEST_APP_CATEGORY, async (_e, bundleId: string, appName: string) => {
    return suggestAppCategory(bundleId, appName)
  })

  ipcMain.handle(IPC.AI.DETECT_CLI_TOOLS, async () => {
    return detectCLITools()
  })

  ipcMain.handle(IPC.AI.TEST_CLI_TOOL, async (_e, payload: { tool: 'claude' | 'chatgpt' | 'gemini' | 'codex' }) => {
    return testCLITool(payload.tool)
  })

  // ─── Threads ──────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.AI.LIST_THREADS, (_e, payload?: { includeArchived?: boolean }): AIThreadSummary[] => {
    return listThreadsLite({ includeArchived: payload?.includeArchived ?? false }).map(toThreadSummary)
  })

  ipcMain.handle(IPC.AI.GET_THREAD, (_e, payload: AIThreadPageRequest): AIThreadDetail => {
    const row = getThread(payload.threadId)
    if (!row) return { thread: null, messages: [], hasEarlier: false }
    const page = getThreadMessagesPage(getDb(), payload.threadId, {
      limit: payload.limit ?? DEFAULT_THREAD_PAGE_SIZE,
      before: payload.before ?? null,
    })
    return { thread: toThreadSummary(row), messages: page.messages, hasEarlier: page.hasEarlier }
  })

  ipcMain.handle(IPC.AI.ARCHIVE_THREAD, (_e, payload: { threadId: number; archived: boolean }) => {
    archiveThread(payload.threadId, payload.archived)
  })

  ipcMain.handle(IPC.AI.RENAME_THREAD, (_e, payload: { threadId: number; title: string }) => {
    renameThread(payload.threadId, payload.title)
  })

  ipcMain.handle(IPC.AI.DELETE_THREAD, (_e, payload: { threadId: number }) => {
    return deleteThread(payload.threadId)
  })

  // D4: per-thread model/provider override + additional instructions.
  ipcMain.handle(IPC.AI.GET_THREAD_SETTINGS, (_e, payload: { threadId: number }): AIThreadSettings => {
    return getThreadSettings(payload.threadId)
  })

  ipcMain.handle(IPC.AI.SET_THREAD_SETTINGS, (_e, payload: { threadId: number; settings: AIThreadSettings }): AIThreadSettings => {
    return setThreadSettings(payload.threadId, payload.settings)
  })

  // ─── Artifacts ────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.AI.OPEN_ARTIFACT, async (_e, payload: { artifactId: number }) => {
    return openArtifact(payload.artifactId)
  })
}
