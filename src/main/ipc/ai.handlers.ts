import { ipcMain } from 'electron'
import { updateAIMessageFeedback } from '../db/queries'
import { getDb } from '../services/database'
import {
  clearAIHistory,
  detectCLITools,
  getAppNarrative,
  generateDaySummary,
  generateWorkBlockInsight,
  getAIHistory,
  getThreadHistory,
  getWeekReview,
  sendMessage,
  suggestAppCategory,
  testCLITool,
} from '../services/ai'
import {
  archiveThread,
  createThread,
  deleteThread,
  exportArtifact,
  getArtifact,
  getThread,
  listArtifactsByThread,
  listThreadsLite,
  openArtifact,
  readArtifactContent,
  renameThread,
} from '../services/artifacts'
import { IPC, type AIChatSendRequest, type AIThreadSummary, type WorkContextBlock } from '@shared/types'

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
    return updateAIMessageFeedback(getDb(), payload.messageId, payload.rating)
  })

  ipcMain.handle(IPC.AI.GENERATE_DAY_SUMMARY, async (_e, date: string) => {
    return generateDaySummary(date)
  })

  ipcMain.handle(IPC.AI.GET_WEEK_REVIEW, async (_e, payload: { weekStart: string }) => {
    return getWeekReview(payload.weekStart)
  })

  ipcMain.handle(IPC.AI.GET_APP_NARRATIVE, async (_e, payload: { canonicalAppId: string; days?: number }) => {
    return getAppNarrative(payload.canonicalAppId, payload.days ?? 7)
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

  // ─── Artifacts ────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.AI.LIST_ARTIFACTS, (_e, payload: { threadId: number }) => {
    return listArtifactsByThread(payload.threadId)
  })

  ipcMain.handle(IPC.AI.GET_ARTIFACT, async (_e, payload: { artifactId: number }) => {
    const record = getArtifact(payload.artifactId)
    if (!record) return null
    return readArtifactContent(payload.artifactId)
  })

  ipcMain.handle(IPC.AI.OPEN_ARTIFACT, async (_e, payload: { artifactId: number }) => {
    return openArtifact(payload.artifactId)
  })

  ipcMain.handle(IPC.AI.EXPORT_ARTIFACT, async (_e, payload: { artifactId: number }) => {
    return exportArtifact(payload.artifactId)
  })
}
