import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type Database from 'better-sqlite3'
import type { AIMessageRating } from '@shared/types'
import { getSettings } from './settings'

declare const __DAYLENS_CONVEX_SITE_URL__: string | undefined

const CLIENT_ID_KEY = 'aiFeedbackClientId'
const USER_PROMPT_MAX_CHARS = 2_000
const ASSISTANT_ANSWER_MAX_CHARS = 4_000
const DEFAULT_CONVEX_SITE_URL = typeof __DAYLENS_CONVEX_SITE_URL__ === 'string'
  ? __DAYLENS_CONVEX_SITE_URL__
  : 'https://decisive-aardvark-847.convex.site'

type StoreLike = {
  get: (key: string, defaultValue?: unknown) => unknown
  set: (key: string, value: unknown) => void
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface MessageRow {
  id: number
  conversationId: number
  threadId: number | null
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  metadataJson: string | null
  rating: AIMessageRating | null
  ratingUpdatedAt: number | null
}

export interface AIFeedbackUploadPayload {
  eventType: 'rated'
  feedbackKey: string
  clientId: string
  appVersion: string
  platform: NodeJS.Platform
  rating: AIMessageRating
  ratingUpdatedAt: number
  answerKind: string | null
  provider: string | null
  model: string | null
  conversationId: number
  threadId: number | null
  userMessageId: number | null
  assistantMessageId: number
  userPromptExcerpt: string | null
  assistantAnswerExcerpt: string
  userPromptTruncated: boolean
  assistantAnswerTruncated: boolean
  redacted: boolean
  createdAt: number
}

export interface AIFeedbackUploadDeps {
  fetch?: FetchLike
  getClientId?: () => Promise<string>
  getSettings?: () => { shareAIFeedbackExamples: boolean }
  getSiteUrl?: () => string
  getAppVersion?: () => string
  getPlatform?: () => NodeJS.Platform
  now?: () => number
  warn?: (message: string, error: unknown) => void
}

let storePromise: Promise<StoreLike> | null = null

async function getStore(): Promise<StoreLike> {
  if (!storePromise) {
    storePromise = import('electron-store')
      .then(({ default: Store }) => new Store() as StoreLike)
  }
  return storePromise
}

async function getOrCreateFeedbackClientId(): Promise<string> {
  const store = await getStore()
  const existing = store.get(CLIENT_ID_KEY, null)
  if (typeof existing === 'string' && existing.trim()) return existing
  const next = randomUUID()
  store.set(CLIENT_ID_KEY, next)
  return next
}

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function redactFeedbackText(input: string, maxChars: number): {
  text: string
  truncated: boolean
  redacted: boolean
} {
  let redacted = false
  const replace = (pattern: RegExp, replacement: string, value: string): string => {
    const next = value.replace(pattern, replacement)
    if (next !== value) redacted = true
    return next
  }

  let output = input
  output = replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, '[redacted-url]', output)
  output = replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]', output)
  output = replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, '[redacted-path]', output)
  output = output.replace(/(?:^|[\s(])\/(?:Users|home|tmp|var|private|mnt)\/[^\s)]+/g, (match: string) => {
    redacted = true
    return match[0] === '/' ? '[redacted-path]' : `${match[0]}[redacted-path]`
  })
  output = replace(/\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g, '[redacted-token]', output)

  const truncated = output.length > maxChars
  if (truncated) {
    output = output.slice(0, maxChars)
  }

  return {
    text: output,
    truncated,
    redacted,
  }
}

function loadMessage(db: Database.Database, messageId: number): MessageRow | null {
  const row = db.prepare(`
    SELECT
      id,
      conversation_id AS conversationId,
      thread_id AS threadId,
      role,
      content,
      created_at AS createdAt,
      metadata_json AS metadataJson,
      rating,
      rating_updated_at AS ratingUpdatedAt
    FROM ai_messages
    WHERE id = ?
    LIMIT 1
  `).get(messageId) as MessageRow | undefined

  return row ?? null
}

function loadPriorUserMessage(db: Database.Database, assistant: MessageRow): MessageRow | null {
  const row = assistant.threadId != null
    ? db.prepare(`
        SELECT
          id,
          conversation_id AS conversationId,
          thread_id AS threadId,
          role,
          content,
          created_at AS createdAt,
          metadata_json AS metadataJson,
          rating,
          rating_updated_at AS ratingUpdatedAt
        FROM ai_messages
        WHERE thread_id = ?
          AND role = 'user'
          AND created_at <= ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `).get(assistant.threadId, assistant.createdAt)
    : db.prepare(`
        SELECT
          id,
          conversation_id AS conversationId,
          thread_id AS threadId,
          role,
          content,
          created_at AS createdAt,
          metadata_json AS metadataJson,
          rating,
          rating_updated_at AS ratingUpdatedAt
        FROM ai_messages
        WHERE conversation_id = ?
          AND role = 'user'
          AND created_at <= ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `).get(assistant.conversationId, assistant.createdAt)

  return (row as MessageRow | undefined) ?? null
}

export async function buildAIFeedbackUploadPayload(
  db: Database.Database,
  messageId: number,
  rating: AIMessageRating,
  deps: AIFeedbackUploadDeps = {},
): Promise<AIFeedbackUploadPayload | null> {
  const assistant = loadMessage(db, messageId)
  if (!assistant || assistant.role !== 'assistant') return null

  const clientId = await (deps.getClientId ?? getOrCreateFeedbackClientId)()
  const now = deps.now?.() ?? Date.now()
  const metadata = parseJsonObject(assistant.metadataJson)
  const priorUser = loadPriorUserMessage(db, assistant)
  const assistantExcerpt = redactFeedbackText(assistant.content, ASSISTANT_ANSWER_MAX_CHARS)
  const userExcerpt = priorUser ? redactFeedbackText(priorUser.content, USER_PROMPT_MAX_CHARS) : null

  return {
    eventType: 'rated',
    feedbackKey: `${clientId}:${assistant.id}`,
    clientId,
    appVersion: deps.getAppVersion?.() ?? app.getVersion(),
    platform: deps.getPlatform?.() ?? process.platform,
    rating,
    ratingUpdatedAt: assistant.ratingUpdatedAt ?? now,
    answerKind: stringOrNull(metadata.answerKind),
    provider: stringOrNull(metadata.provider),
    model: stringOrNull(metadata.model),
    conversationId: assistant.conversationId,
    threadId: assistant.threadId,
    userMessageId: priorUser?.id ?? null,
    assistantMessageId: assistant.id,
    userPromptExcerpt: userExcerpt?.text ?? null,
    assistantAnswerExcerpt: assistantExcerpt.text,
    userPromptTruncated: userExcerpt?.truncated ?? false,
    assistantAnswerTruncated: assistantExcerpt.truncated,
    redacted: assistantExcerpt.redacted || Boolean(userExcerpt?.redacted),
    createdAt: now,
  }
}

export async function uploadRatedAIMessageFeedback(
  db: Database.Database,
  messageId: number,
  rating: AIMessageRating | null,
  deps: AIFeedbackUploadDeps = {},
): Promise<void> {
  if (!rating) return
  const settings = deps.getSettings?.() ?? getSettings()
  if (!settings.shareAIFeedbackExamples) return

  try {
    const payload = await buildAIFeedbackUploadPayload(db, messageId, rating, deps)
    if (!payload) return

    const siteUrl = (deps.getSiteUrl?.() ?? DEFAULT_CONVEX_SITE_URL).replace(/\/+$/, '')
    if (!siteUrl) return

    const fetchImpl = deps.fetch ?? fetch
    await fetchImpl(`${siteUrl}/feedback/ai-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    const warn = deps.warn ?? ((message: string, err: unknown) => console.warn(message, err))
    warn('[ai-feedback] upload failed:', error)
  }
}
