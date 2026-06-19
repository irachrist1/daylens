import { ipcMain } from 'electron'
import { updateAIMessageFeedback, writeAIBlockCategory, writeAIBlockLabel } from '../db/queries'
import { getDb } from '../services/database'
import { uploadRatedAIMessageFeedback } from '../services/aiFeedbackUpload'
import {
  clearAIHistory,
  detectCLITools,
  getAppNarrative,
  generateDaySummary,
  prepareDailyReport,
  generateWorkBlockInsight,
  getAIHistory,
  getThreadHistory,
  getWeekReview,
  sendMessage,
  suggestAppCategory,
  testCLITool,
} from '../services/ai'
import { getWrappedNarrative } from '../services/wrappedNarrative'
import { getWrappedPeriodNarrative } from '../services/wrappedPeriodNarrative'
import { getTimelineDayPayload, getBlockDetailPayload } from '../services/workBlocks'
import { getCurrentSession } from '../services/tracking'
import { materializeTimelineDayProjection } from '../core/query/projections'
import { localDateString } from '../lib/localDate'
import {
  archiveThread,
  createThread,
  deleteThread,
  exportArtifact,
  getThread,
  getThreadSettings,
  listArtifactsByThread,
  listThreadsLite,
  openArtifact,
  readArtifactPreview,
  renameThread,
  setThreadSettings,
} from '../services/artifacts'
import { IPC, type AIChatSendRequest, type AIThreadSettings, type AIThreadSummary, type WorkContextBlock, type WrappedPeriodFacts } from '@shared/types'

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

export function registerAIHandlers(): void {
  ipcMain.handle(IPC.AI.SEND_MESSAGE, async (event, payload: AIChatSendRequest) => {
    return sendMessage(payload, {
      onStreamEvent: (streamEvent) => {
        event.sender.send(IPC.AI.STREAM_EVENT, streamEvent)
      },
    })
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
    return generateDaySummary(date)
  })

  ipcMain.handle(IPC.AI.GET_WEEK_REVIEW, async (_e, payload: { weekStart: string; force?: boolean }) => {
    return getWeekReview(payload.weekStart, payload.force ?? false)
  })

  ipcMain.handle(IPC.AI.GET_APP_NARRATIVE, async (_e, payload: { canonicalAppId: string; days?: number; force?: boolean }) => {
    return getAppNarrative(payload.canonicalAppId, payload.days ?? 7, payload.force ?? false)
  })

  ipcMain.handle(IPC.AI.PREPARE_DAILY_REPORT, async (_e, payload?: { date?: string | null }) => {
    return prepareDailyReport(payload?.date ?? undefined)
  })

  ipcMain.handle(IPC.AI.GET_WRAPPED_NARRATIVE, async (_e, payload: { date: string }) => {
    const today = (() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })()
    const liveSession = payload.date === today ? getCurrentSession() : null
    const dayPayload = getTimelineDayPayload(getDb(), payload.date, liveSession)
    return getWrappedNarrative(dayPayload)
  })

  ipcMain.handle(IPC.AI.GET_WRAPPED_PERIOD_NARRATIVE, async (_e, payload: { facts: WrappedPeriodFacts }) => {
    return getWrappedPeriodNarrative(payload.facts)
  })

  ipcMain.handle(IPC.AI.GET_HISTORY, (_e, payload?: { threadId?: number | null }) => {
    return getAIHistory(payload?.threadId ?? null)
  })

  ipcMain.handle(IPC.AI.CLEAR_HISTORY, () => {
    clearAIHistory()
  })

  ipcMain.handle(IPC.AI.GENERATE_BLOCK_INSIGHT, async (_e, block: WorkContextBlock) => {
    return generateWorkBlockInsight(block)
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
      { jobType: 'block_label_finalize', triggerSource: 'system', throwOnError: true, rejectedLabel },
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
    if (insight.category) {
      writeAIBlockCategory(db, block.id, insight.category)
    }

    return insight
  })

  ipcMain.handle(IPC.AI.SUGGEST_APP_CATEGORY, async (_e, bundleId: string, appName: string) => {
    return suggestAppCategory(bundleId, appName)
  })

  ipcMain.handle(IPC.AI.DETECT_CLI_TOOLS, async () => {
    return detectCLITools()
  })

  ipcMain.handle(IPC.AI.TEST_CLI_TOOL, async (_e, payload: { tool: 'claude' | 'codex' }) => {
    return testCLITool(payload.tool)
  })

  // ─── Threads ──────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.AI.LIST_THREADS, (_e, payload?: { includeArchived?: boolean }): AIThreadSummary[] => {
    return listThreadsLite({ includeArchived: payload?.includeArchived ?? false }).map(toThreadSummary)
  })

  ipcMain.handle(IPC.AI.GET_THREAD, (_e, payload: { threadId: number }): { thread: AIThreadSummary | null; messages: ReturnType<typeof getThreadHistory> } => {
    const row = getThread(payload.threadId)
    const thread = row ? toThreadSummary(row) : null
    const messages = row ? getThreadHistory(payload.threadId) : []
    return { thread, messages }
  })

  ipcMain.handle(IPC.AI.CREATE_THREAD, (_e, payload?: { title?: string | null }): AIThreadSummary => {
    return toThreadSummary(createThread(payload?.title ?? null))
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
  ipcMain.handle(IPC.AI.LIST_ARTIFACTS, (_e, payload: { threadId: number }) => {
    return listArtifactsByThread(payload.threadId)
  })

  ipcMain.handle(IPC.AI.GET_ARTIFACT, async (_e, payload: { artifactId: number }) => {
    // Preview-only read: caps content to the first N KB so a large artifact is
    // not cloned in full over IPC. Open/export read the complete artifact.
    return readArtifactPreview(payload.artifactId)
  })

  ipcMain.handle(IPC.AI.OPEN_ARTIFACT, async (_e, payload: { artifactId: number }) => {
    return openArtifact(payload.artifactId)
  })

  ipcMain.handle(IPC.AI.EXPORT_ARTIFACT, async (_e, payload: { artifactId: number }) => {
    return exportArtifact(payload.artifactId)
  })
}
