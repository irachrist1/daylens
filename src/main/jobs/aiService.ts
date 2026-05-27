// AI service — runs in the main process only and routes to the selected provider.
// Renderer communicates via IPC (never direct SDK access)
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenAI, type Content as GoogleContent, type Part as GooglePart } from '@google/genai'
import { app } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  appendConversationMessage,
  clearConversation,
  getAISurfaceSummary,
  getAISurfaceSummarySignature,
  getConversationMessages,
  getConversationState,
  getOrCreateConversation,
  getThreadConversationState,
  getThreadMessages,
  getActiveFocusSession,
  getAppSummariesForRange,
  getDistractionCountForSession,
  getSessionsForRange,
  getWebsiteSummariesForRange,
  listPendingWorkContextCleanupDates,
  getRecentFocusSessions,
  getCategoryOverrides,
  upsertAISurfaceSummary,
  upsertConversationState,
  upsertWorkContextCleanupReview,
  upsertWorkContextInsight,
} from '../db/queries'
import { routeInsightsQuestion, shouldUseRouter, type EntityContext, type TemporalContext } from '../lib/insightsQueryRouter'
import { resolveFollowUp } from '../lib/followUpResolver'
import {
  buildDeterministicFollowUpCandidates,
  buildFollowUpSuggestionPrompts,
  classifyQuestionShape,
  filterFollowUpCandidatesWithReport,
  parseFollowUpSuggestions,
} from '../lib/followUpSuggestions'
import { parseDaySummaryResultText } from '../lib/daySummarySuggestions'
import {
  fallbackGeneratedReportContent,
  parseGeneratedReportResult,
} from '../lib/dayReportFallback'
import { capContextBlock } from '../lib/contextCap'
import { deriveWorkEvidenceSummary } from '../lib/workEvidence'
import { buildAssistantEvidencePack } from '../core/query/assistantEvidence'
import {
  findClientByName,
  findProjectByName,
  listClients,
  listProjects,
  resolveClientQuery,
  resolveDayContext,
  resolveProjectQuery,
} from '../core/query/attributionResolvers'
import { invalidateProjectionScope } from '../core/projections/invalidation'
import { deriveTitleFromMessage, isWeakThreadTitle, type ThreadTitleContext } from '../lib/threadTitles'
import { getDb } from '../services/database'
import {
  createArtifact,
  createThread,
  getThread,
  listArtifactsByThread,
  renameThread,
  touchThreadLastMessage,
} from '../services/artifacts'
import { capture } from '../services/analytics'
import { ANALYTICS_EVENT, classifyFailureKind } from '@shared/analytics'
import { getApiKey, getSettings, hasApiKey } from '../services/settings'
import { computeEnhancedFocusScore, computeFocusScoreV2 } from '../lib/focusScore'
import { getCurrentSession } from '../services/tracking'
import type {
  AIArtifactKind,
  AIChatSendRequest,
  AIChatStreamEvent,
  AIMessageArtifact,
  AIMessageAction,
  AIAnswerKind,
  AIChatTurnResult,
  AIConversationDateRange,
  AIConversationSourceKind,
  AIConversationState,
  AIDailyReportPreparationResult,
  AIEntityStateSnapshot,
  AIRoutingContextSnapshot,
  AIDaySummaryResult,
  AISurfaceSummary,
  AIThreadMessage,
  AIThreadMessageMetadata,
  AIWeeklyBriefStateSnapshot,
  AppCategorySuggestion,
  DayTimelinePayload,
  FollowUpSuggestion,
  FocusSession,
  FocusStartPayload,
  LiveSession,
  WorkContextBlock,
  WorkContextInsight,
} from '@shared/types'
import { DISTRACTION_DOMAINS } from '@shared/types'
import { blockActiveSeconds } from '@shared/blockDuration'
import {
  executeTextAIJob,
  modelForProvider,
  providerLabel,
  type AITextJobExecutionOptions,
  type ProviderTextResponse,
  type ResolvedProviderConfig,
} from '../services/aiOrchestration'
import { buildAnthropicPromptInput } from '../services/anthropicPromptCaching'
import { anthropicTools, openaiTools, googleTools, executeTool, type ToolName } from '../services/aiTools'
import {
  backgroundRelabelDispositionForBlock,
  fallbackNarrativeForBlock,
  getAppDetailPayload,
  getTimelineDayPayload,
  getWorkflowSummaries,
  userVisibleLabelForBlock,
} from '../services/workBlocks'
import {
  buildWeeklyBriefEvidencePack,
  buildWeeklyBriefScaffold,
  type WeeklyBriefContext,
  type WeeklyBriefEvidencePack,
} from '../lib/weeklyBrief'
import { buildCLIProcessPayload, buildCLIProcessSpec } from '../services/cliLaunch'
import { inferWorkIntent } from '../../shared/workIntent'
import { registerWrappedNarrativeProvider } from '../services/wrappedNarrative'
import { registerWrappedPeriodNarrativeProvider } from '../services/wrappedPeriodNarrative'
import { citationFallback, verifyCitedEntities, verifyTimestamps } from '../ai/citations'
import { VOICE_SYSTEM_PROMPT, CHAT_TOOL_USE_SYSTEM_PROMPT } from '../ai/voiceContract'
import { getCurrentTrace, maybeStartTrace, setCurrentTrace, tracingEnabled } from '../ai/trace'

const GOOGLE_CLIENT_HEADER = 'daylens-windows/1.0.0'
const BLOCK_INSIGHT_TIMEOUT_MS = 12_000

type ConversationMessage = { role: 'user' | 'assistant'; content: string }

interface AnswerEnvelope {
  assistantText: string
  answerKind: AIAnswerKind
  sourceKind: AIConversationSourceKind
  resolvedTemporalContext: TemporalContext | null
  conversationState: AIConversationState | null
  suggestedFollowUps: FollowUpSuggestion[]
  actions?: AIMessageAction[]
  artifacts?: AIMessageArtifact[]
}

interface SendMessageOptions {
  onStreamEvent?: (event: AIChatStreamEvent) => void
  /** When set and DAYLENS_AI_TRACE_DIR is configured, the trace file is
   *  written as <scenarioId>.json so the behavioural harness can match it. */
  traceScenarioId?: string | null
}

type RequestedOutputKind = 'report' | 'table' | 'chart' | 'export'

interface ReportArtifactSpec {
  kind: AIMessageArtifact['kind']
  title: string
  format: AIMessageArtifact['format']
  contents: string
  subtitle?: string | null
  extension: string
}

interface ReportContextBundle {
  title: string
  scopeLabel: string
  assistantScaffold: string
  reportMarkdownScaffold: string
  tableColumns: string[]
  tableRows: Array<Record<string, string | number>>
  chartRows: Array<{ label: string; value: number; secondaryValue?: number | null }>
  chartValueLabel: string
  // When present, the report body is rendered deterministically from the
  // bundle's structured data — no LLM call, no fabrication risk. The chat
  // card response is a brief deterministic summary of the same numbers.
  renderDeterministic?: () => { reportMarkdown: string; assistantResponse: string }
}

type DirectReportEntity =
  | { entityType: 'client'; id: string; name: string }
  | { entityType: 'project'; id: string; name: string }

interface CLIToolDetectionResult {
  claude: string | null
  codex: string | null
}

interface CodexExecCapabilities {
  supportsOutputLastMessage: boolean
  supportsSandbox: boolean
  supportsConfig: boolean
}

interface ResolvedCLITool {
  executablePath: string
  codexExecCapabilities: CodexExecCapabilities | null
}

class CLIProviderError extends Error {
  readonly code: 'not_found' | 'non_zero_exit' | 'timeout' | 'launch_failed'

  constructor(code: CLIProviderError['code'], message: string) {
    super(message)
    this.name = 'CLIProviderError'
    this.code = code
  }
}

const CLI_TIMEOUT_MS = 180_000
const conversationTemporalContext = new Map<string, TemporalContext | null>()
const weeklyBriefCache = new Map<string, WeeklyBriefEvidencePack>()
const daySummaryCache = new Map<string, AIDaySummaryResult>()
const cliToolCache: Partial<Record<'claude' | 'codex', Promise<ResolvedCLITool | null>>> = {}
const STREAM_CHUNK_DELAY_MS = 12
const STREAM_CHUNK_SIZE = 32
const USER_VISIBLE_ACTIVITY_PROSE_RULE =
  'Never use raw app names as the activity. Describe activity, work threads, artifacts, pages, or context instead of listing tool names as nouns. '
  + 'When listing apps in response to "what were my top apps" or similar, the PROSE SUBJECT of each row must be the work, not the app. '
  + 'Use the dominantBlockLabel field on each app for the activity. The app name appears as tail-attribution after the activity, never as the row\'s bolded headline. The duration goes last. '
  + 'CORRECT row shape: "Coding in the Building & Testing block (Daylens chat-pipeline work) — Kiro, 1h 19m." '
  + 'WRONG row shapes: "**Kiro** — coding in the Building & Testing block (1h 19m)" (app is still the headline); "Kiro — 1h 19m" (no activity at all); "Kiro: 1h 19m of coding" (app is the subject). '
  + 'Do not bold the app name as the row prefix. Do not put the app name before the em-dash. The em-dash separates activity (left) from attribution + duration (right).'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function emitTextDeltas(
  text: string,
  onDelta?: ((delta: string) => void | Promise<void>) | null,
): Promise<void> {
  if (!text || !onDelta) return
  for (let index = 0; index < text.length; index += STREAM_CHUNK_SIZE) {
    const chunk = text.slice(index, index + STREAM_CHUNK_SIZE)
    await Promise.resolve(onDelta(chunk))
    if (index + STREAM_CHUNK_SIZE < text.length) {
      await wait(STREAM_CHUNK_DELAY_MS)
    }
  }
}

function createChatStreamAccumulator(requestId: string | null | undefined, options?: SendMessageOptions) {
  let snapshot = ''

  return {
    get snapshot() {
      return snapshot
    },
    get enabled() {
      return Boolean(requestId && options?.onStreamEvent)
    },
    async push(delta: string) {
      if (!delta || !requestId || !options?.onStreamEvent) return
      snapshot += delta
      await Promise.resolve(options.onStreamEvent({
        requestId,
        delta,
        snapshot,
      }))
    },
    async streamText(text: string) {
      if (!text) return
      const nextText = snapshot && text.startsWith(snapshot)
        ? text.slice(snapshot.length)
        : text
      if (!nextText) return
      await emitTextDeltas(nextText, (chunk) => this.push(chunk))
    },
  }
}

function looksLikeFocusStartIntent(message: string): boolean {
  const normalized = message.toLowerCase()
  return /\b(start|begin|kick off|set up|launch|resume)\b(?:\s+(?:a|an|my))?(?:\s+\d{1,3}\s*(?:m|min|mins|minute|minutes))?\s+focus(?:\s+session)?\b/.test(normalized)
    || /\bfocus(?:\s+session)?\b.*\b(start|begin|kick off|set up|launch|resume)\b/.test(normalized)
}

function looksLikeFocusStopIntent(message: string): boolean {
  const normalized = message.toLowerCase()
  return /\b(stop|end|finish|wrap up|close|complete)\b(?:\s+(?:my|the))?(?:\s+(?:current|active))?\s+focus(?:\s+session)?\b/.test(normalized)
    || /\bfocus(?:\s+session)?\b.*\b(stop|end|finish|wrap up|close|complete)\b/.test(normalized)
}

function looksLikeFocusReviewIntent(message: string): boolean {
  const normalized = message.toLowerCase()
  return /\b(review|reflect|reflection|recap)\b.*\bfocus(?:\s+session)?\b/.test(normalized)
    || /\bfocus(?:\s+session)?\b.*\b(review|reflect|reflection|recap)\b/.test(normalized)
}

function extractFocusTargetMinutes(message: string): number | null {
  const match = message.match(/\b(\d{1,3})\s*(?:m|min|mins|minute|minutes)\b/i)
  if (!match) return null
  const minutes = Number(match[1])
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  return Math.min(minutes, 480)
}

function inferFocusLabel(message: string): string | null {
  const stripped = message
    .replace(/\b(start|begin|kick off|set up|launch|resume)\b/gi, ' ')
    .replace(/\bfocus(?:\s+session)?\b/gi, ' ')
    .replace(/\b(?:a|an|my)\s+\d{1,3}\s*(?:m|min|mins|minute|minutes)\b/gi, ' ')
    .replace(/\bfor\s+\d{1,3}\s*(?:m|min|mins|minute|minutes)\b/gi, ' ')
    .replace(/[?.!,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!stripped) return null
  const trimmed = stripped.replace(/^(on|around|about|called|named)\s+/i, '').trim()
  if (/^(?:for\s+)?(?:what\s+i(?:'m| am)\s+doing\s+now|this\s+work)$/i.test(trimmed)) {
    return null
  }
  if (!trimmed || trimmed.length > 80) return null
  return trimmed
}

function buildFocusStartPayloadFromContext(message: string, liveSession: LiveSession | null): FocusStartPayload {
  const plannedApps = liveSession && liveSession.category !== 'system'
    ? [liveSession.appName]
    : []

  return {
    label: inferFocusLabel(message),
    targetMinutes: extractFocusTargetMinutes(message),
    plannedApps,
  }
}

function formatFocusDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds))
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.round((rounded % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${rounded}s`
}

function focusSessionDurationSeconds(session: FocusSession): number {
  if (session.endTime !== null) return session.durationSeconds
  return Math.max(0, Math.round((Date.now() - session.startTime) / 1_000))
}

function buildFocusReviewNote(session: FocusSession, distractionCount: number): string {
  const parts = [
    `Session: ${session.label || 'Focus session'}`,
    `Duration: ${formatFocusDuration(session.durationSeconds)}`,
  ]

  if (session.targetMinutes) {
    parts.push(`Target: ${session.targetMinutes}m`)
  }
  if (session.plannedApps.length > 0) {
    parts.push(`Planned apps: ${session.plannedApps.join(', ')}`)
  }
  if (distractionCount > 0) {
    parts.push(`Distractions noticed: ${distractionCount}`)
  }

  return `${parts.join(' · ')}.\nWhat went well, what interrupted you, and what should the next session keep or change?`
}

function maybeHandleFocusIntent(message: string): AnswerEnvelope | null {
  const db = getDb()
  const activeFocusSession = getActiveFocusSession(db)
  const liveSession = getCurrentSession()

  if (looksLikeFocusStartIntent(message)) {
    if (activeFocusSession) {
      return {
        assistantText: `A focus session is already running${activeFocusSession.label ? ` for ${activeFocusSession.label}` : ''}. Stop that one first if you want to start a fresh session.`,
        answerKind: 'deterministic_stats',
        sourceKind: 'deterministic',
        resolvedTemporalContext: null,
        conversationState: null,
        suggestedFollowUps: [],
        actions: [
          {
            kind: 'stop_focus_session',
            label: 'Stop active focus session',
            sessionId: activeFocusSession.id,
          },
        ],
      }
    }

    const payload = buildFocusStartPayloadFromContext(message, liveSession)
    const label = payload.label ? ` for ${payload.label}` : ''
    const target = payload.targetMinutes ? ` with a ${payload.targetMinutes} minute target` : ''
    const plannedApps = payload.plannedApps && payload.plannedApps.length > 0
      ? ` I can seed it with ${payload.plannedApps.join(', ')} from your current context.`
      : ''

    return {
      assistantText: `I can start a focus session${label}${target}.${plannedApps} Use the button below when you want to begin.`,
      answerKind: 'deterministic_stats',
      sourceKind: 'deterministic',
      resolvedTemporalContext: null,
      conversationState: null,
      suggestedFollowUps: [],
      actions: [
        {
          kind: 'start_focus_session',
          label: payload.targetMinutes ? `Start ${payload.targetMinutes}m focus session` : 'Start focus session',
          payload,
        },
      ],
    }
  }

  if (looksLikeFocusStopIntent(message)) {
    if (!activeFocusSession) {
      return {
        assistantText: 'There is no active focus session running right now, so there is nothing to stop.',
        answerKind: 'deterministic_stats',
        sourceKind: 'deterministic',
        resolvedTemporalContext: null,
        conversationState: null,
        suggestedFollowUps: [],
      }
    }

    return {
      assistantText: `Your current focus session has been running for ${formatFocusDuration(focusSessionDurationSeconds(activeFocusSession))}${activeFocusSession.label ? ` on ${activeFocusSession.label}` : ''}. Use the button below when you want to stop it.`,
      answerKind: 'deterministic_stats',
      sourceKind: 'deterministic',
      resolvedTemporalContext: null,
      conversationState: null,
      suggestedFollowUps: [],
      actions: [
        {
          kind: 'stop_focus_session',
          label: 'Stop focus session',
          sessionId: activeFocusSession.id,
        },
      ],
    }
  }

  if (looksLikeFocusReviewIntent(message)) {
    if (activeFocusSession) {
      return {
        assistantText: 'This focus session is still running. Stop it first, then you can save a reflection right here in the AI surface.',
        answerKind: 'deterministic_stats',
        sourceKind: 'deterministic',
        resolvedTemporalContext: null,
        conversationState: null,
        suggestedFollowUps: [],
        actions: [
          {
            kind: 'stop_focus_session',
            label: 'Stop current focus session',
            sessionId: activeFocusSession.id,
          },
        ],
      }
    }

    const recentCompleted = getRecentFocusSessions(db, 10).find((session) => session.endTime !== null)
    if (!recentCompleted) {
      return {
        assistantText: 'There is no finished focus session to review yet. Start one from here whenever you are ready.',
        answerKind: 'deterministic_stats',
        sourceKind: 'deterministic',
        resolvedTemporalContext: null,
        conversationState: null,
        suggestedFollowUps: [],
      }
    }

    const distractionCount = getDistractionCountForSession(db, recentCompleted.id)
    return {
      assistantText: `Your most recent focus session lasted ${formatFocusDuration(recentCompleted.durationSeconds)}${recentCompleted.label ? ` on ${recentCompleted.label}` : ''}.${distractionCount > 0 ? ` Daylens noticed ${distractionCount} distraction alert${distractionCount === 1 ? '' : 's'} during it.` : ''} Add a short review below and Daylens will keep it with the session.`,
      answerKind: 'deterministic_stats',
      sourceKind: 'deterministic',
      resolvedTemporalContext: null,
      conversationState: null,
      suggestedFollowUps: [],
      actions: [
        {
          kind: 'review_focus_session',
          label: 'Save focus review',
          sessionId: recentCompleted.id,
          placeholder: 'What worked, what got in the way, and what should the next session keep or change?',
          suggestedNote: buildFocusReviewNote(recentCompleted, distractionCount),
        },
      ],
    }
  }

  return null
}

function toAIConversationDateRange(
  range: { fromMs: number; toMs: number; label: string } | null | undefined,
): AIConversationDateRange | null {
  if (!range) return null
  return {
    fromMs: range.fromMs,
    toMs: range.toMs,
    label: range.label,
  }
}

function serializeWeeklyBriefContext(weeklyBrief: WeeklyBriefContext | null): AIWeeklyBriefStateSnapshot | null {
  if (!weeklyBrief) return null
  return {
    intent: weeklyBrief.intent,
    responseMode: weeklyBrief.responseMode,
    topic: weeklyBrief.topic,
    dateRange: {
      fromMs: weeklyBrief.dateRange.fromMs,
      toMs: weeklyBrief.dateRange.toMs,
      label: weeklyBrief.dateRange.label,
    },
    evidenceKey: weeklyBrief.evidenceKey,
  }
}

function deserializeWeeklyBriefContext(snapshot: AIWeeklyBriefStateSnapshot | null): WeeklyBriefContext | null {
  if (!snapshot) return null
  return {
    intent: snapshot.intent as WeeklyBriefContext['intent'],
    responseMode: snapshot.responseMode as WeeklyBriefContext['responseMode'],
    topic: snapshot.topic,
    dateRange: {
      fromMs: snapshot.dateRange.fromMs,
      toMs: snapshot.dateRange.toMs,
      label: snapshot.dateRange.label,
      startDate: new Date(snapshot.dateRange.fromMs).toISOString().slice(0, 10),
      endDate: new Date(snapshot.dateRange.toMs - 1).toISOString().slice(0, 10),
    },
    evidenceKey: snapshot.evidenceKey,
  }
}

function serializeEntityContext(entity: TemporalContext['entity']): AIEntityStateSnapshot | null {
  if (!entity) return null
  return {
    entityId: entity.entityId,
    entityName: entity.entityName,
    entityType: entity.entityType,
    rangeStartMs: entity.rangeStartMs,
    rangeEndMs: entity.rangeEndMs,
    rangeLabel: entity.rangeLabel,
    intent: entity.intent,
  }
}

function deserializeEntityContext(snapshot: AIEntityStateSnapshot | null): EntityContext | null {
  if (!snapshot) return null
  return {
    entityId: snapshot.entityId,
    entityName: snapshot.entityName,
    entityType: snapshot.entityType,
    rangeStartMs: snapshot.rangeStartMs,
    rangeEndMs: snapshot.rangeEndMs,
    rangeLabel: snapshot.rangeLabel,
    intent: snapshot.intent as EntityContext['intent'],
  }
}

function serializeTemporalContext(context: TemporalContext | null): AIRoutingContextSnapshot | null {
  if (!context) return null
  return {
    dateMs: context.date.getTime(),
    timeWindowStartMs: context.timeWindow?.start.getTime() ?? null,
    timeWindowEndMs: context.timeWindow?.end.getTime() ?? null,
    weeklyBrief: serializeWeeklyBriefContext(context.weeklyBrief),
    entity: serializeEntityContext(context.entity),
  }
}

function deserializeTemporalContext(snapshot: AIRoutingContextSnapshot | null): TemporalContext | null {
  if (!snapshot) return null
  return {
    date: new Date(snapshot.dateMs),
    timeWindow: snapshot.timeWindowStartMs !== null && snapshot.timeWindowEndMs !== null
      ? {
        start: new Date(snapshot.timeWindowStartMs),
        end: new Date(snapshot.timeWindowEndMs),
      }
      : null,
    weeklyBrief: deserializeWeeklyBriefContext(snapshot.weeklyBrief),
    entity: deserializeEntityContext(snapshot.entity),
  }
}

function buildConversationState(
  answerKind: AIAnswerKind,
  sourceKind: AIConversationSourceKind,
  resolvedTemporalContext: TemporalContext | null,
  followUpAffordances: AIConversationState['followUpAffordances'],
  extras?: {
    topic?: string | null
    responseMode?: string | null
    lastIntent?: string | null
    evidenceKey?: string | null
    dateRange?: AIConversationDateRange | null
  },
): AIConversationState {
  return {
    dateRange: extras?.dateRange ?? toAIConversationDateRange(resolvedTemporalContext?.weeklyBrief?.dateRange ?? null),
    topic: extras?.topic ?? resolvedTemporalContext?.weeklyBrief?.topic ?? null,
    responseMode: extras?.responseMode ?? resolvedTemporalContext?.weeklyBrief?.responseMode ?? null,
    lastIntent: extras?.lastIntent ?? resolvedTemporalContext?.weeklyBrief?.intent ?? null,
    evidenceKey: extras?.evidenceKey ?? resolvedTemporalContext?.weeklyBrief?.evidenceKey ?? null,
    answerKind,
    sourceKind,
    followUpAffordances,
    routingContext: serializeTemporalContext(resolvedTemporalContext),
  }
}

function inferDateRangeFromQuestion(
  question: string,
  fallback: AIConversationDateRange | null,
): AIConversationDateRange | null {
  const normalized = question.toLowerCase()
  const now = new Date()
  const isoDate = normalized.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (isoDate?.[1]) {
    const [year, month, day] = isoDate[1].split('-').map(Number)
    const start = new Date(year, month - 1, day)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return {
      fromMs: start.getTime(),
      toMs: end.getTime(),
      label: isoDate[1],
    }
  }
  // "weekly report", "weekly summary", "for the week" — scope to this week
  // when the user names a weekly artifact without explicit "this/last week".
  const mentionsWeek =
    normalized.includes('this week')
    || normalized.includes('last week')
    || /\bweekly\b/.test(normalized)
    || /\bfor the week\b/.test(normalized)
    || /\bof the week\b/.test(normalized)
  if (mentionsWeek) {
    const endInclusive = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const start = new Date(endInclusive)
    start.setDate(start.getDate() - 6)
    const endExclusive = new Date(endInclusive)
    endExclusive.setDate(endExclusive.getDate() + 1)
    return {
      fromMs: start.getTime(),
      toMs: endExclusive.getTime(),
      label: normalized.includes('last week') ? 'last week' : 'this week',
    }
  }
  if (normalized.includes('yesterday')) {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const start = new Date(end)
    start.setDate(start.getDate() - 1)
    return {
      fromMs: start.getTime(),
      toMs: end.getTime(),
      label: 'yesterday',
    }
  }
  if (normalized.includes('today')) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return {
      fromMs: start.getTime(),
      toMs: end.getTime(),
      label: 'today',
    }
  }
  return fallback
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    void promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

function cliBinaryCandidates(tool: 'claude' | 'codex'): string[] {
  const appData = process.env.APPDATA
  const userProfile = process.env.USERPROFILE
  return [
    appData ? path.join(appData, 'npm', `${tool}.cmd`) : null,
    userProfile ? path.join(userProfile, 'AppData', 'Roaming', 'npm', `${tool}.cmd`) : null,
    userProfile ? path.join(userProfile, '.local', 'bin', `${tool}.cmd`) : null,
    userProfile ? path.join(userProfile, '.volta', 'bin', `${tool}.cmd`) : null,
    userProfile ? path.join(userProfile, '.npm-global', 'bin', `${tool}.cmd`) : null,
  ].filter((candidate): candidate is string => Boolean(candidate))
}

function uniquePathEntries(entries: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const entry of entries) {
    if (!entry) continue
    const trimmed = entry.trim()
    if (!trimmed) continue
    const key = process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(trimmed)
  }

  return normalized
}

function buildCLIPath(executablePath: string, currentPath?: string): string {
  const appData = process.env.APPDATA
  const userProfile = process.env.USERPROFILE
  const programFiles = process.env.ProgramFiles
  const programFilesX86 = process.env['ProgramFiles(x86)']

  return uniquePathEntries([
    path.dirname(executablePath),
    appData ? path.join(appData, 'npm') : null,
    userProfile ? path.join(userProfile, 'AppData', 'Roaming', 'npm') : null,
    userProfile ? path.join(userProfile, '.local', 'bin') : null,
    userProfile ? path.join(userProfile, '.volta', 'bin') : null,
    userProfile ? path.join(userProfile, '.npm-global', 'bin') : null,
    programFiles ? path.join(programFiles, 'nodejs') : null,
    programFilesX86 ? path.join(programFilesX86, 'nodejs') : null,
    ...(currentPath ? currentPath.split(path.delimiter) : []),
  ]).join(path.delimiter)
}

function buildCLIEnv(executablePath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: buildCLIPath(executablePath, process.env.PATH),
  }
}

async function findCLIToolPath(tool: 'claude' | 'codex'): Promise<string | null> {
  for (const candidate of cliBinaryCandidates(tool)) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // Try the next candidate.
    }
  }

  return new Promise((resolve) => {
    const child = spawn('where.exe', [tool], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(null)
        return
      }
      const match = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
      resolve(match ?? null)
    })
  })
}

async function runCLIHelpCommand(executablePath: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const spec = buildCLIProcessSpec(executablePath, args)
    const child = spawn(spec.command, spec.args, {
      env: buildCLIEnv(executablePath),
      shell: spec.shell,
      stdio: spec.usesJsonStdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    if (spec.usesJsonStdin) {
      child.stdin?.end(buildCLIProcessPayload(executablePath, args))
    }
    const stdoutStream = child.stdout
    const stderrStream = child.stderr
    if (!stdoutStream || !stderrStream) {
      resolve('')
      return
    }

    let stdout = ''
    let stderr = ''
    let finished = false
    const timer = setTimeout(() => {
      if (finished) return
      finished = true
      child.kill()
      resolve(`${stdout}\n${stderr}`.trim())
    }, 10_000)

    stdoutStream.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    stderrStream.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve('')
    })
    child.on('close', () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve(`${stdout}\n${stderr}`.trim())
    })
  })
}

async function inspectCodexExecCapabilities(executablePath: string): Promise<CodexExecCapabilities> {
  const [codexHelp, codexExecHelp] = await Promise.all([
    runCLIHelpCommand(executablePath, ['--help']),
    runCLIHelpCommand(executablePath, ['exec', '--help']),
  ])

  const combinedHelp = `${codexHelp}\n${codexExecHelp}`
  return {
    supportsOutputLastMessage: combinedHelp.includes('--output-last-message'),
    supportsSandbox: combinedHelp.includes('--sandbox'),
    supportsConfig: combinedHelp.includes('--config'),
  }
}

async function resolveCLITool(tool: 'claude' | 'codex'): Promise<ResolvedCLITool | null> {
  if (!cliToolCache[tool]) {
    cliToolCache[tool] = (async () => {
      const executablePath = await findCLIToolPath(tool)
      if (!executablePath) return null

      return {
        executablePath,
        codexExecCapabilities: tool === 'codex'
          ? await inspectCodexExecCapabilities(executablePath)
          : null,
      }
    })()
  }

  return cliToolCache[tool] ?? null
}

async function resolveCLIToolPath(tool: 'claude' | 'codex'): Promise<string | null> {
  const resolved = await resolveCLITool(tool)
  return resolved?.executablePath ?? null
}

export async function detectCLITools(): Promise<CLIToolDetectionResult> {
  const [claude, codex] = await Promise.all([
    resolveCLIToolPath('claude'),
    resolveCLIToolPath('codex'),
  ])
  return { claude, codex }
}

function openAIInputFromHistory(messages: ConversationMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
}

function googleHistoryFromMessages(messages: ConversationMessage[]): GoogleContent[] {
  // Google requires strictly alternating user/model roles.
  // Strip consecutive same-role messages, keeping only the last one in each run
  // so corrupted histories (e.g. from a prior failed request) don't break the call.
  const filtered: ConversationMessage[] = []
  for (const message of messages) {
    const last = filtered[filtered.length - 1]
    if (last && last.role === message.role) {
      filtered[filtered.length - 1] = message
    } else {
      filtered.push(message)
    }
  }
  return filtered.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }))
}

async function sendWithAnthropic(
  config: ResolvedProviderConfig,
  systemPrompt: string,
  prior: ConversationMessage[],
  userMessage: string,
  options?: AITextJobExecutionOptions,
): Promise<ProviderTextResponse> {
  const client = new Anthropic({ apiKey: config.apiKey ?? '' })
  const promptInput = buildAnthropicPromptInput(systemPrompt, prior, userMessage, options)
  const stream = client.messages.stream({
    model: config.model,
    max_tokens: options?.maxOutputTokens ?? 1024,
    ...promptInput,
  })
  stream.on('text', (delta) => {
    void options?.onDelta?.(delta)
  })
  const response = await stream.finalMessage()

  return {
    text: response.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join(''),
    usage: {
      inputTokens: response.usage.input_tokens ?? null,
      outputTokens: response.usage.output_tokens ?? null,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? null,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? null,
    },
  }
}

async function sendWithOpenAI(
  config: ResolvedProviderConfig,
  systemPrompt: string,
  prior: ConversationMessage[],
  userMessage: string,
  options?: AITextJobExecutionOptions,
): Promise<ProviderTextResponse> {
  const client = new OpenAI({ apiKey: config.apiKey ?? '' })
  const responseStream = await client.responses.create({
    model: config.model,
    instructions: systemPrompt,
    input: openAIInputFromHistory([
      ...prior,
      { role: 'user', content: userMessage },
    ]),
    max_output_tokens: options?.maxOutputTokens ?? 1024,
    store: false,
    stream: true,
  })
  let text = ''
  let usage: ProviderTextResponse['usage'] = null

  for await (const event of responseStream as AsyncIterable<{
    type: string
    delta?: string
    response?: {
      output_text?: string
      usage?: {
        input_tokens?: number | null
        output_tokens?: number | null
        input_tokens_details?: { cached_tokens?: number | null } | null
      } | null
    }
  }>) {
    if (event.type === 'response.output_text.delta' && event.delta) {
      text += event.delta
      await options?.onDelta?.(event.delta)
      continue
    }

    if (event.type === 'response.completed' && event.response) {
      text = event.response.output_text || text
      usage = {
        inputTokens: event.response.usage?.input_tokens ?? null,
        outputTokens: event.response.usage?.output_tokens ?? null,
        cacheReadTokens: event.response.usage?.input_tokens_details?.cached_tokens ?? null,
        cacheWriteTokens: null,
      }
    }
  }

  return {
    text,
    usage,
  }
}

async function sendWithGoogle(
  config: ResolvedProviderConfig,
  systemPrompt: string,
  prior: ConversationMessage[],
  userMessage: string,
  options?: AITextJobExecutionOptions,
): Promise<ProviderTextResponse> {
  const ai = new GoogleGenAI({
    apiKey: config.apiKey ?? '',
    httpOptions: {
      headers: {
        'x-goog-api-client': GOOGLE_CLIENT_HEADER,
      },
    },
  })
  const chat = ai.chats.create({
    model: config.model,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: options?.maxOutputTokens ?? 1024,
    },
    history: googleHistoryFromMessages(prior),
  })

  const response = await chat.sendMessageStream({ message: userMessage })
  let text = ''
  for await (const chunk of response) {
    let nextText = ''
    try {
      nextText = chunk.text ?? ''
    } catch {
      throw new Error('Gemini blocked the response. Try rephrasing or switch AI provider in Settings.')
    }

    const delta = nextText.startsWith(text)
      ? nextText.slice(text.length)
      : nextText
    text = nextText
    if (delta) {
      await options?.onDelta?.(delta)
    }
  }
  if (!text) {
    throw new Error('Gemini returned an empty response. Try rephrasing your question.')
  }
  return {
    text,
    usage: null,
  }
}

const MAX_TOOL_CALLS = 7
const MAX_TOOL_RESULT_TOKENS = 8000
// 1 token ≈ 4 chars — rough budget for tool result JSON payloads
const MAX_TOOL_RESULT_CHARS = MAX_TOOL_RESULT_TOKENS * 4

function estimateChars(messages: { role?: string; content?: unknown }[]): number {
  return messages.reduce((n, m) => n + JSON.stringify(m.content ?? '').length, 0)
}

function truncateOldestToolResults(
  messages: Anthropic.MessageParam[],
  systemPromptChars: number,
): Anthropic.MessageParam[] {
  // Drop the oldest tool_result user messages until we're under budget.
  const budget = MAX_TOOL_RESULT_CHARS - systemPromptChars
  let chars = messages.reduce((n, m) => n + JSON.stringify(m.content).length, 0)
  if (chars <= budget) return messages
  const out = [...messages]
  for (let i = 0; i < out.length && chars > budget; i++) {
    const msg = out[i]
    if (msg.role !== 'user') continue
    const content = Array.isArray(msg.content) ? msg.content : null
    if (!content) continue
    const truncated = content.map((block) => {
      if (block.type !== 'tool_result') return block
      const resultStr = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
      chars -= resultStr.length
      return { ...block, content: '[truncated to fit token budget]' }
    })
    out[i] = { ...msg, content: truncated }
  }
  return out
}

interface AnthropicToolLoopOptions {
  intermediateMaxTokens?: number
  finalMaxTokens?: number
  maxToolCalls?: number
}

async function runAnthropicToolLoop(
  apiKey: string,
  model: string,
  systemPrompt: string,
  prior: ConversationMessage[],
  userMessage: string,
  db: ReturnType<typeof getDb>,
  onDelta: (delta: string) => void | Promise<void>,
  loopOptions: AnthropicToolLoopOptions = {},
): Promise<string> {
  const client = new Anthropic({ apiKey })
  const intermediateMaxTokens = loopOptions.intermediateMaxTokens ?? 1024
  const finalMaxTokens = loopOptions.finalMaxTokens ?? 2048
  const effectiveMaxToolCalls = loopOptions.maxToolCalls ?? MAX_TOOL_CALLS
  const messages: Anthropic.MessageParam[] = [
    ...prior.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: userMessage },
  ]
  const systemChars = systemPrompt.length

  let toolCallCount = 0
  const toolResultTexts: string[] = []
  const trace = getCurrentTrace()
  if (trace) {
    trace.setMeta({
      provider: 'anthropic',
      modelId: model,
      systemPrompt,
      userMessage,
      prior: prior.map((m) => ({ role: m.role, content: m.content })),
    })
  }

  const finalizeWithCheck = async (finalText: string, source: string): Promise<string> => {
    // D3 minute precision: any HH:MM in the answer that doesn't appear in
    // tool results is treated as a paraphrase hallucination. If found,
    // retry once with an explicit "quote the times verbatim" instruction.
    const timestampCheck = verifyTimestamps(finalText, toolResultTexts)
    if (!timestampCheck.ok) {
      capture(ANALYTICS_EVENT.AI_CITATION_RETRY, {
        provider: 'anthropic',
        reason: 'timestamp_paraphrase',
        missing_entity_count: timestampCheck.suspect.length,
      })
      try {
        const retry = await client.messages.create({
          model,
          max_tokens: finalMaxTokens,
          system: systemPrompt,
          messages: [
            ...truncateOldestToolResults(messages, systemChars),
            {
              role: 'user',
              content:
                `Your previous answer used ${timestampCheck.suspect.join(', ')}, but none of those clock times appear in the tool results. ` +
                'Re-state the answer using ONLY the HH:MM ranges that came back from the tools verbatim. Do not paraphrase, round, or invent new times.',
            },
          ],
        })
        const retryText = retry.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
        const retryTimestampCheck = verifyTimestamps(retryText, toolResultTexts)
        if (retryTimestampCheck.ok && retryText.trim()) {
          finalText = retryText
        }
        // If the retry still drifts, fall through to the citation check on
        // the original text rather than looping forever.
      } catch (err) {
        if (trace) trace.addEvent({ kind: 'error', message: err instanceof Error ? err.message : String(err), phase: 'timestamp_retry' })
      }
    }
    const citationCheck = verifyCitedEntities(finalText, toolResultTexts)
    if (trace) {
      trace.addEvent({
        kind: 'citation_check',
        ok: citationCheck.ok,
        missing: citationCheck.missingEntities,
        checked: citationCheck.checkedEntities,
      })
    }
    if (!citationCheck.ok) {
      capture(ANALYTICS_EVENT.AI_CITATION_RETRY, {
        provider: 'anthropic',
        reason: 'missing_entity',
        missing_entity_count: citationCheck.missingEntities.length,
      })
      const retryPrompt =
        `Your previous answer referenced ${citationCheck.missingEntities.join(', ')}, but that text does not appear in the tool results. ` +
        'Answer only from entities present in the tool results, or say you cannot see evidence for the claim.'
      try {
        const retry = await client.messages.create({
          model,
          max_tokens: finalMaxTokens,
          system: systemPrompt,
          messages: [
            ...truncateOldestToolResults(messages, systemChars),
            { role: 'user', content: retryPrompt },
          ],
        })
        const retryText = retry.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
        const retryCheck = verifyCitedEntities(retryText, toolResultTexts)
        if (trace) {
          trace.addEvent({
            kind: 'citation_check',
            ok: retryCheck.ok,
            missing: retryCheck.missingEntities,
            checked: retryCheck.checkedEntities,
            retry: true,
          })
        }
        if (retryCheck.ok && retryText.trim()) {
          if (trace) trace.addEvent({ kind: 'final', text: retryText, source: `${source}+citation_retry` })
          await emitTextDeltas(retryText, onDelta)
          return retryText
        }
        capture(ANALYTICS_EVENT.AI_CITATION_FALLBACK, {
          provider: 'anthropic',
          reason: 'missing_entity',
          missing_entity_count: retryCheck.missingEntities.length,
        })
        const fallback = citationFallback(retryCheck.missingEntities, toolResultTexts)
        if (trace) trace.addEvent({ kind: 'final', text: fallback, source: `${source}+citation_fallback` })
        await emitTextDeltas(fallback, onDelta)
        return fallback
      } catch (err) {
        if (trace) trace.addEvent({ kind: 'error', message: err instanceof Error ? err.message : String(err), phase: 'citation_retry' })
      }
    }
    if (trace) trace.addEvent({ kind: 'final', text: finalText, source })
    await emitTextDeltas(finalText, onDelta)
    return finalText
  }

  while (true) {
    const trimmed = truncateOldestToolResults(messages, systemChars)
    const response = await client.messages.create({
      model,
      max_tokens: intermediateMaxTokens,
      system: systemPrompt,
      tools: anthropicTools,
      messages: trimmed,
    })

    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text')
    const turnText = textBlocks.map((b) => b.text).join('')

    if (trace) {
      trace.addEvent({
        kind: 'turn',
        role: 'assistant',
        text: turnText,
        toolUses: toolUseBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input })),
        stopReason: response.stop_reason ?? null,
        usage: {
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          cacheReadTokens: (response.usage as { cache_read_input_tokens?: number } | undefined)?.cache_read_input_tokens,
          cacheWriteTokens: (response.usage as { cache_creation_input_tokens?: number } | undefined)?.cache_creation_input_tokens,
        },
      })
    }

    if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
      let finalText = turnText
      // Intent-to-act detection: the model produced text that reads like it's
      // about to call a tool ("Let me check...", "I'll look at...") but stopped
      // without actually making any tool calls. Force a retry asking for the
      // final answer using data already gathered.
      const INTENT_TO_ACT_RE = /(let me|i'll|i will|i'll go check|hold on|let me get|let me look|i'll check|i'll pull)/i
      const looksLikeIntentToAct = finalText.trim().length > 0
        && INTENT_TO_ACT_RE.test(finalText.trim())
        && toolUseBlocks.length === 0
        && toolCallCount > 0 // Only retry if we already have some tool data

      // Empty-response / end-turn-without-text / intent-to-act retry. The model
      // occasionally exits with stop_reason=end_turn after producing only
      // "I'll check..." or no text at all. Force one retry with an explicit
      // instruction to synthesize from data already gathered before falling back.
      if (!finalText.trim() || looksLikeIntentToAct) {
        capture(ANALYTICS_EVENT.AI_EMPTY_RESPONSE_RETRY, {
          provider: 'anthropic',
          tool_call_count: toolCallCount,
        })
        try {
          const retry = await client.messages.create({
            model,
            max_tokens: finalMaxTokens,
            system: systemPrompt,
            messages: [
              ...truncateOldestToolResults(messages, systemChars),
              { role: 'user', content: 'Provide your final answer now using the data already gathered. If no data answers the question, say so plainly in one sentence.' },
            ],
          })
          finalText = retry.content
            .filter((b): b is Anthropic.TextBlock => b.type === 'text')
            .map((b) => b.text)
            .join('')
          if (trace) {
            trace.addEvent({
              kind: 'turn',
              role: 'assistant',
              text: finalText,
              toolUses: [],
              stopReason: retry.stop_reason ?? null,
              usage: {
                inputTokens: retry.usage?.input_tokens,
                outputTokens: retry.usage?.output_tokens,
              },
            })
          }
        } catch (err) {
          if (trace) trace.addEvent({ kind: 'error', message: err instanceof Error ? err.message : String(err), phase: 'empty_retry' })
        }
      }
      if (!finalText.trim()) {
        // Deterministic fallback: assemble a "here's what I can see" payload
        // from today's timeline instead of a bare refusal.
        const now = new Date()
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        try {
          const payload = getTimelineDayPayload(db, todayStr, null)
          if (payload.totalSeconds > 0) {
            const topBlocks = payload.blocks
              .filter((b) => (b.endTime - b.startTime) >= 3 * 60_000)
              .slice(0, 3)
              .map((b) => {
                const start = new Date(b.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
                const end = new Date(b.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
                return `${start}-${end}: ${userVisibleLabelForBlock(b)}`
              })
            const totalMin = Math.round(payload.totalSeconds / 60)
            finalText = `Here's what Daylens captured today (${totalMin} minutes tracked): ${topBlocks.join('; ')}. Ask about a specific block or time range for more detail.`
          } else {
            finalText = 'No tracked activity today yet. Daylens captures app sessions when your computer is active — check back once you have some foreground time logged.'
          }
        } catch {
          finalText = 'Daylens has tracked activity available but could not assemble a summary for this question. Try asking about a specific time, app, or day.'
        }
        if (trace) trace.addEvent({ kind: 'final', text: finalText, source: 'deterministic_fallback' })
        await emitTextDeltas(finalText, onDelta)
        return finalText
      }
      return finalizeWithCheck(finalText, 'tool_loop_end_turn')
    }

    // Add assistant turn with all blocks
    messages.push({ role: 'assistant', content: response.content })

    // Every tool_use block needs a matching tool_result — Anthropic API requires it.
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const tb of toolUseBlocks) {
      let result: unknown
      const toolStart = Date.now()
      if (toolCallCount < effectiveMaxToolCalls) {
        toolCallCount++
        try {
          result = executeTool(tb.name as ToolName, tb.input as Record<string, unknown>, db)
        } catch (err) {
          result = { error: String(err) }
        }
        if (process.env.NODE_ENV === 'development' && !tracingEnabled()) {
          console.log(`[ai:tool] ${tb.name}(${JSON.stringify(tb.input)}) → ${JSON.stringify(result).slice(0, 120)}`)
        }
      } else {
        result = { error: 'Tool call cap reached. Please synthesize from available data.' }
      }
      const resultText = JSON.stringify(result)
      toolResultTexts.push(resultText)
      toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: resultText })
      if (trace) {
        trace.addEvent({
          kind: 'tool_result',
          name: tb.name,
          input: tb.input,
          output: result,
          toolUseId: tb.id,
          durationMs: Date.now() - toolStart,
          truncated: false,
        })
      }
    }
    messages.push({ role: 'user', content: toolResults })

    if (toolCallCount >= effectiveMaxToolCalls) {
      // Force a final answer without tools
      const finalResponse = await client.messages.create({
        model,
        max_tokens: finalMaxTokens,
        system: systemPrompt,
        messages: truncateOldestToolResults(messages, systemChars),
      })
      const forcedText = finalResponse.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
      if (trace) {
        trace.addEvent({
          kind: 'turn',
          role: 'assistant',
          text: forcedText,
          toolUses: [],
          stopReason: finalResponse.stop_reason ?? null,
          usage: {
            inputTokens: finalResponse.usage?.input_tokens,
            outputTokens: finalResponse.usage?.output_tokens,
          },
        })
      }
      const fallbackText = forcedText.trim()
        ? forcedText
        : 'Tool call cap reached and I could not synthesise a final answer. Try narrowing the question.'
      return finalizeWithCheck(fallbackText, 'tool_loop_capped')
    }
  }
}

async function runOpenAIToolLoop(
  apiKey: string,
  model: string,
  systemPrompt: string,
  prior: ConversationMessage[],
  userMessage: string,
  db: ReturnType<typeof getDb>,
  onDelta: (delta: string) => void | Promise<void>,
): Promise<string> {
  const client = new OpenAI({ apiKey })

  type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...prior.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: userMessage },
  ]

  let toolCallCount = 0
  const toolResultTexts: string[] = []

  while (true) {
    // Truncate tool results if over budget
    const totalChars = estimateChars(messages)
    if (totalChars > MAX_TOOL_RESULT_CHARS) {
      for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'tool') {
          ;(messages[i] as OpenAI.Chat.Completions.ChatCompletionToolMessageParam).content =
            '[truncated to fit token budget]'
          break
        }
      }
    }

    const response = await client.chat.completions.create({
      model,
      max_tokens: 1024,
      tools: openaiTools,
      messages,
    })

    const choice = response.choices[0]
    if (!choice) break

    const msg = choice.message
    messages.push(msg)

    const toolCalls = msg.tool_calls ?? []
    if (toolCalls.length === 0 || choice.finish_reason === 'stop') {
      const finalText = msg.content ?? ''
      const citationCheck = verifyCitedEntities(finalText, toolResultTexts)
      if (!citationCheck.ok) {
        capture(ANALYTICS_EVENT.AI_CITATION_RETRY, {
          provider: 'openai',
          reason: 'missing_entity',
          missing_entity_count: citationCheck.missingEntities.length,
        })
        const retryPrompt =
          `Your previous answer referenced ${citationCheck.missingEntities.join(', ')}, but that text does not appear in the tool results. ` +
          'Answer only from entities present in the tool results, or say you cannot see evidence for the claim.'
        const retry = await client.chat.completions.create({
          model,
          max_tokens: 1024,
          messages: [...messages, { role: 'user', content: retryPrompt }],
        })
        const retryText = retry.choices[0]?.message.content ?? ''
        const retryCheck = verifyCitedEntities(retryText, toolResultTexts)
        if (retryCheck.ok) {
          await emitTextDeltas(retryText, onDelta)
          return retryText
        }
        capture(ANALYTICS_EVENT.AI_CITATION_FALLBACK, {
          provider: 'openai',
          reason: 'missing_entity',
          missing_entity_count: retryCheck.missingEntities.length,
        })
        const fallback = citationFallback(retryCheck.missingEntities, toolResultTexts)
        await emitTextDeltas(fallback, onDelta)
        return fallback
      }
      await emitTextDeltas(finalText, onDelta)
      return finalText
    }

    for (const tc of toolCalls) {
      if (toolCallCount >= MAX_TOOL_CALLS) break
      if (tc.type !== 'function') continue
      toolCallCount++
      let result: unknown
      try {
        const args = JSON.parse(tc.function.arguments) as Record<string, unknown>
        result = executeTool(tc.function.name as ToolName, args, db)
      } catch (err) {
        result = { error: String(err) }
      }
      if (process.env.NODE_ENV === 'development') {
        console.log(`[ai:tool] ${tc.function.name}(${tc.function.arguments.slice(0, 80)}) → ${JSON.stringify(result).slice(0, 120)}`)
      }
      const resultText = JSON.stringify(result)
      toolResultTexts.push(resultText)
      messages.push({ role: 'tool', tool_call_id: tc.id, content: resultText })
    }

    if (toolCallCount >= MAX_TOOL_CALLS) {
      // Force final answer without tools
      const finalResponse = await client.chat.completions.create({
        model,
        max_tokens: 1024,
        messages,
      })
      const finalText = finalResponse.choices[0]?.message.content ?? ''
      const citationCheck = verifyCitedEntities(finalText, toolResultTexts)
      if (!citationCheck.ok) {
        capture(ANALYTICS_EVENT.AI_CITATION_FALLBACK, {
          provider: 'openai',
          reason: 'missing_entity',
          missing_entity_count: citationCheck.missingEntities.length,
        })
        const fallback = citationFallback(citationCheck.missingEntities, toolResultTexts)
        await emitTextDeltas(fallback, onDelta)
        return fallback
      }
      await emitTextDeltas(finalText, onDelta)
      return finalText
    }
  }
  return ''
}

function truncateOldestGoogleFunctionResponses(
  contents: GoogleContent[],
  systemPromptChars: number,
): GoogleContent[] {
  const budget = MAX_TOOL_RESULT_CHARS - systemPromptChars
  let chars = contents.reduce((n, c) => n + JSON.stringify(c.parts ?? []).length, 0)
  if (chars <= budget) return contents
  const out = contents.map((c) => ({ ...c, parts: [...(c.parts ?? [])] }))
  for (let i = 0; i < out.length && chars > budget; i++) {
    const c = out[i]
    if (c.role !== 'user') continue
    for (let j = 0; j < c.parts.length; j++) {
      const part = c.parts[j]
      if (!part.functionResponse) continue
      const before = JSON.stringify(part).length
      c.parts[j] = {
        functionResponse: {
          name: part.functionResponse.name,
          response: { result: '[truncated to fit token budget]' },
        },
      }
      chars -= (before - JSON.stringify(c.parts[j]).length)
    }
  }
  return out
}

async function runGoogleToolLoop(
  apiKey: string,
  model: string,
  systemPrompt: string,
  prior: ConversationMessage[],
  userMessage: string,
  db: ReturnType<typeof getDb>,
  onDelta: (delta: string) => void | Promise<void>,
): Promise<string> {
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'x-goog-api-client': GOOGLE_CLIENT_HEADER,
      },
    },
  })

  const contents: GoogleContent[] = [
    ...googleHistoryFromMessages(prior),
    { role: 'user', parts: [{ text: userMessage }] },
  ]
  const systemChars = systemPrompt.length

  let toolCallCount = 0
  const toolResultTexts: string[] = []

  // Helper: extract function calls from a response, falling back to part-scan
  // because @google/genai's `functionCalls` getter is inconsistently populated.
  const extractFunctionCalls = (resp: {
    functionCalls?: Array<{ name?: string; args?: Record<string, unknown> }>
    candidates?: Array<{ content?: { parts?: GooglePart[] } }>
  }): Array<{ name: string; args: Record<string, unknown> }> => {
    const direct = resp.functionCalls ?? []
    if (direct.length > 0) {
      return direct
        .filter((fc): fc is { name: string; args?: Record<string, unknown> } => Boolean(fc.name))
        .map((fc) => ({ name: fc.name, args: fc.args ?? {} }))
    }
    const parts = resp.candidates?.[0]?.content?.parts ?? []
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    for (const part of parts) {
      const fc = part.functionCall
      if (fc?.name) calls.push({ name: fc.name, args: (fc.args ?? {}) as Record<string, unknown> })
    }
    return calls
  }

  // Helper: pull aggregated text from response, translating Gemini safety
  // blocks the same way sendWithGoogle does.
  const safeText = (resp: { text?: string }): string => {
    try {
      return resp.text ?? ''
    } catch {
      throw new Error('Gemini blocked the response. Try rephrasing or switch AI provider in Settings.')
    }
  }

  while (true) {
    const trimmed = truncateOldestGoogleFunctionResponses(contents, systemChars)
    const response = await client.models.generateContent({
      model,
      contents: trimmed,
      config: {
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: googleTools }],
        maxOutputTokens: 1024,
      },
    })

    const functionCalls = extractFunctionCalls(response)
    if (functionCalls.length === 0) {
      const finalText = safeText(response)
      const citationCheck = verifyCitedEntities(finalText, toolResultTexts)
      if (!citationCheck.ok) {
        capture(ANALYTICS_EVENT.AI_CITATION_RETRY, {
          provider: 'google',
          reason: 'missing_entity',
          missing_entity_count: citationCheck.missingEntities.length,
        })
        const retryPrompt =
          `Your previous answer referenced ${citationCheck.missingEntities.join(', ')}, but that text does not appear in the tool results. ` +
          'Answer only from entities present in the tool results, or say you cannot see evidence for the claim.'
        const retryResponse = await client.models.generateContent({
          model,
          contents: [...contents, { role: 'user', parts: [{ text: retryPrompt }] }],
          config: {
            systemInstruction: systemPrompt,
            maxOutputTokens: 1024,
          },
        })
        const retryText = safeText(retryResponse)
        const retryCheck = verifyCitedEntities(retryText, toolResultTexts)
        if (retryCheck.ok) {
          await emitTextDeltas(retryText, onDelta)
          return retryText
        }
        capture(ANALYTICS_EVENT.AI_CITATION_FALLBACK, {
          provider: 'google',
          reason: 'missing_entity',
          missing_entity_count: retryCheck.missingEntities.length,
        })
        const fallback = citationFallback(retryCheck.missingEntities, toolResultTexts)
        await emitTextDeltas(fallback, onDelta)
        return fallback
      }
      await emitTextDeltas(finalText, onDelta)
      return finalText
    }

    // Echo the model turn (with its functionCall parts) back into contents so
    // the next request includes the call/response pair correctly.
    const modelParts = response.candidates?.[0]?.content?.parts ?? []
    contents.push({ role: 'model', parts: modelParts })

    const functionResponseParts: GooglePart[] = []
    for (const fc of functionCalls) {
      let result: unknown
      if (toolCallCount < MAX_TOOL_CALLS) {
        toolCallCount++
        try {
          result = executeTool(fc.name as ToolName, fc.args, db)
        } catch (err) {
          result = { error: String(err) }
        }
        if (process.env.NODE_ENV === 'development') {
          console.log(`[ai:tool] ${fc.name}(${JSON.stringify(fc.args)}) → ${JSON.stringify(result).slice(0, 120)}`)
        }
      } else {
        result = { error: 'Tool call cap reached. Please synthesize from available data.' }
      }
      const resultText = JSON.stringify(result)
      toolResultTexts.push(resultText)
      functionResponseParts.push({
        functionResponse: {
          name: fc.name,
          response: { result },
        },
      })
    }
    contents.push({ role: 'user', parts: functionResponseParts })

    if (toolCallCount >= MAX_TOOL_CALLS) {
      const finalResponse = await client.models.generateContent({
        model,
        contents: truncateOldestGoogleFunctionResponses(contents, systemChars),
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: 1024,
        },
      })
      const finalText = safeText(finalResponse)
      const citationCheck = verifyCitedEntities(finalText, toolResultTexts)
      if (!citationCheck.ok) {
        capture(ANALYTICS_EVENT.AI_CITATION_FALLBACK, {
          provider: 'google',
          reason: 'missing_entity',
          missing_entity_count: citationCheck.missingEntities.length,
        })
        const fallback = citationFallback(citationCheck.missingEntities, toolResultTexts)
        await emitTextDeltas(fallback, onDelta)
        return fallback
      }
      await emitTextDeltas(finalText, onDelta)
      return finalText
    }
  }
}

async function runCLIProvider(
  tool: 'claude' | 'codex',
  prompt: string,
  model?: string,
): Promise<string> {
  const resolvedTool = await resolveCLITool(tool)
  if (!resolvedTool) {
    throw new CLIProviderError('not_found', `${tool} CLI not found`)
  }
  const { executablePath, codexExecCapabilities } = resolvedTool

  const tmpFilePath = path.join(os.tmpdir(), `daylens-${tool}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  const args = tool === 'claude'
    ? ['-p', '--output-format', 'text', ...(model ? ['--model', model] : []), prompt]
    : (() => {
        const nextArgs = ['exec', '--skip-git-repo-check']
        if (codexExecCapabilities?.supportsSandbox) {
          nextArgs.push('--sandbox', 'read-only')
        }
        if (codexExecCapabilities?.supportsConfig) {
          nextArgs.push('--config', 'model_reasoning_effort="low"')
        }
        nextArgs.push('--color', 'never')
        if (codexExecCapabilities?.supportsOutputLastMessage) {
          nextArgs.push('--output-last-message', tmpFilePath)
        }
        if (model) {
          nextArgs.push('--model', model)
        }
        nextArgs.push(prompt)
        return nextArgs
      })()

  try {
    const output = await new Promise<string>((resolve, reject) => {
      const spec = buildCLIProcessSpec(executablePath, args)
      const child = spawn(spec.command, spec.args, {
        env: buildCLIEnv(executablePath),
        shell: spec.shell,
        stdio: spec.usesJsonStdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      if (spec.usesJsonStdin) {
        child.stdin?.end(buildCLIProcessPayload(executablePath, args))
      }
      const stdoutStream = child.stdout
      const stderrStream = child.stderr
      if (!stdoutStream || !stderrStream) {
        reject(new CLIProviderError('launch_failed', `${tool} CLI did not expose stdout/stderr pipes`))
        return
      }

      let stdout = ''
      let stderr = ''
      let finished = false
      const timer = setTimeout(() => {
        if (finished) return
        finished = true
        child.kill()
        reject(new CLIProviderError('timeout', `${tool} CLI timed out after ${CLI_TIMEOUT_MS / 1000}s`))
      }, CLI_TIMEOUT_MS)

      stdoutStream.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      stderrStream.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.on('error', (error) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        reject(new CLIProviderError('launch_failed', error.message))
      })
      child.on('close', async (code) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        try {
          const fileOutput = tool === 'codex' && codexExecCapabilities?.supportsOutputLastMessage
            ? (await fs.readFile(tmpFilePath, 'utf8').catch(() => '')).trim()
            : ''
          const finalOutput = (tool === 'codex' && fileOutput ? fileOutput : stdout).trim()
          if (code !== 0) {
            reject(new CLIProviderError('non_zero_exit', (stderr || finalOutput || `${tool} exited with code ${code ?? 1}`).trim()))
            return
          }
          resolve(finalOutput)
        } catch (error) {
          reject(error)
        }
      })
    })

    return output
  } finally {
    if (tool === 'codex' && codexExecCapabilities?.supportsOutputLastMessage) {
      await fs.unlink(tmpFilePath).catch(() => undefined)
    }
  }
}

async function sendWithProvider(
  config: ResolvedProviderConfig,
  systemPrompt: string,
  prior: ConversationMessage[],
  userMessage: string,
  options?: AITextJobExecutionOptions,
): Promise<ProviderTextResponse> {
  switch (config.provider) {
    case 'claude-cli':
    case 'codex-cli': {
      const existingCLIPrompt = [
        prior.length > 0
          ? `Conversation so far:\n${prior.map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`).join('\n\n')}`
          : null,
        `User: ${userMessage}`,
      ].filter(Boolean).join('\n\n')
      const cliPrompt = `System context:\n${systemPrompt}\n\n${existingCLIPrompt}`
      const text = await runCLIProvider(config.provider === 'claude-cli' ? 'claude' : 'codex', cliPrompt, config.model)
      await emitTextDeltas(text, options?.onDelta)
      return {
        text,
        usage: null,
      }
    }
    case 'openai':
      return sendWithOpenAI(config, systemPrompt, prior, userMessage, options)
    case 'google':
      return sendWithGoogle(config, systemPrompt, prior, userMessage, options)
    case 'anthropic':
    default:
      return sendWithAnthropic(config, systemPrompt, prior, userMessage, options)
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${seconds}s`
}

function dayBounds(date: Date): [number, number] {
  const from = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return [from, from + 86_400_000]
}

function countSwitches(sessions: { bundleId: string }[]): number {
  let switches = 0
  for (let i = 1; i < sessions.length; i++) {
    if (sessions[i].bundleId !== sessions[i - 1].bundleId) {
      switches++
    }
  }
  return switches
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatShortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function formatDateTimeLabel(ms: number): string {
  return `${formatShortDate(ms)} at ${formatClock(ms)}`
}

function hashText(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 12)
}

function localDateKeyForMs(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function detectRequestedOutputKinds(question: string): RequestedOutputKind[] {
  const normalized = question.toLowerCase()

  // Explicit negation: user wants in-chat display only, no artifact files.
  if (
    /\bnot\s+(?:a\s+)?(?:file|download|artifact)\b/.test(normalized)
    || /\bno\s+(?:file|download|artifact)\b/.test(normalized)
    || /\bwithout\s+(?:a\s+)?(?:file|download|saving)\b/.test(normalized)
    || /\bin(?:\s+the)?\s+chat\s+only\b/.test(normalized)
    || /\bdon'?t\s+(?:save|create|make|generate)\s+(?:a\s+)?(?:file|download|artifact)\b/.test(normalized)
  ) {
    return []
  }

  const kinds = new Set<RequestedOutputKind>()

  if (
    /\bcsv\b|\bspreadsheet\b|\bline items\b/.test(normalized)
    || (/\btable\b/.test(normalized) && /\bexport\b|\bdownload\b|\bsave\b/.test(normalized))
  ) {
    kinds.add('table')
  }
  if (/\bchart\b|\bgraph\b|\bplot\b/.test(normalized)) {
    kinds.add('chart')
  }
  if (
    /\breport\b/.test(normalized)
    || /short report i could share/.test(normalized)
    || (/something i can send/.test(normalized) && /\breport\b|\bexport\b/.test(normalized))
    || (/\bshareable\b/.test(normalized) && /\breport\b|\bexport\b/.test(normalized))
  ) {
    kinds.add('report')
  }
  if (/\bexport\b|\bdownload\b/.test(normalized)) {
    kinds.add('export')
  }

  if (kinds.has('export') && !kinds.has('report') && !kinds.has('table') && !kinds.has('chart')) {
    kinds.add('report')
  }

  return [...kinds]
}

function sanitizeFileStem(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized.slice(0, 80) || 'daylens-report'
}

function csvCell(value: string | number): string {
  const raw = String(value ?? '')
  if (!/[",\n]/.test(raw)) return raw
  return `"${raw.replace(/"/g, '""')}"`
}

function buildCsvContent(columns: string[], rows: Array<Record<string, string | number>>): string {
  const header = columns.map(csvCell).join(',')
  const body = rows.map((row) => columns.map((column) => csvCell(row[column] ?? '')).join(','))
  return [header, ...body].join('\n')
}

function buildBarChartHtml(
  title: string,
  subtitle: string,
  valueLabel: string,
  rows: Array<{ label: string; value: number; secondaryValue?: number | null }>,
): string {
  const maxValue = Math.max(1, ...rows.map((row) => row.value))
  const safeRows = rows.slice(0, 12).map((row) => {
    const value = Math.max(0, Number(row.value) || 0)
    const secondaryValue = row.secondaryValue == null ? null : Math.max(0, Number(row.secondaryValue) || 0)
    return {
      label: row.label,
      value,
      secondaryValue,
      widthPct: Math.max(6, Math.round((value / maxValue) * 100)),
      secondaryPct: secondaryValue == null ? null : Math.max(4, Math.round((secondaryValue / maxValue) * 100)),
    }
  })

  const rowMarkup = safeRows.map((row) => `
    <div class="row">
      <div class="label">${row.label}</div>
      <div class="bar-wrap">
        <div class="bar primary" style="width:${row.widthPct}%"></div>
        ${row.secondaryPct == null ? '' : `<div class="bar secondary" style="width:${row.secondaryPct}%"></div>`}
      </div>
      <div class="value">${row.value.toFixed(1)} ${valueLabel}</div>
    </div>
  `).join('\n')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f7f4;
        --surface: #ffffff;
        --text: #171717;
        --muted: #5f5f55;
        --primary: #275efe;
        --secondary: #5ac8a8;
        --border: rgba(23, 23, 23, 0.08);
      }
      body {
        margin: 0;
        font-family: "Segoe UI", "SF Pro Text", "Helvetica Neue", sans-serif;
        background: linear-gradient(180deg, #f9f8f2 0%, var(--bg) 100%);
        color: var(--text);
      }
      main {
        max-width: 900px;
        margin: 0 auto;
        padding: 32px 24px 40px;
      }
      h1 {
        margin: 0 0 6px;
        font-size: 28px;
        line-height: 1.1;
      }
      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }
      .chart {
        margin-top: 24px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 18px 18px 8px;
        box-shadow: 0 20px 40px rgba(23, 23, 23, 0.06);
      }
      .row {
        display: grid;
        grid-template-columns: 150px minmax(0, 1fr) 90px;
        gap: 14px;
        align-items: center;
        margin-bottom: 14px;
      }
      .label, .value {
        font-size: 13px;
      }
      .bar-wrap {
        position: relative;
        height: 22px;
        border-radius: 999px;
        background: #eceae0;
        overflow: hidden;
      }
      .bar {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        border-radius: 999px;
      }
      .primary {
        background: linear-gradient(90deg, #4b7aff 0%, var(--primary) 100%);
      }
      .secondary {
        background: rgba(90, 200, 168, 0.72);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${subtitle}</p>
      <section class="chart">
        ${rowMarkup || '<p>No chartable data was available for this request.</p>'}
      </section>
    </main>
  </body>
</html>`
}

async function ensureGeneratedReportsDir(): Promise<string> {
  const baseDir = app?.getPath?.('userData') ?? os.tmpdir()
  const reportDir = path.join(baseDir, 'generated-reports')
  await fs.mkdir(reportDir, { recursive: true })
  return reportDir
}

async function writeGeneratedArtifacts(
  title: string,
  artifacts: ReportArtifactSpec[],
): Promise<AIMessageArtifact[]> {
  const outputDir = await ensureGeneratedReportsDir()
  const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '')
  const stem = sanitizeFileStem(title)
  const written: AIMessageArtifact[] = []

  for (const artifact of artifacts) {
    const fileName = `${stamp}-${stem}-${sanitizeFileStem(artifact.title)}.${artifact.extension}`
    const filePath = path.join(outputDir, fileName)
    await fs.writeFile(filePath, artifact.contents, 'utf8')
    written.push({
      id: `${stamp}:${artifact.kind}:${artifact.format}:${artifact.title}`,
      kind: artifact.kind,
      title: artifact.title,
      subtitle: artifact.subtitle ?? null,
      format: artifact.format,
      path: filePath,
      openTarget: { kind: 'local_path', value: filePath },
      createdAt: Date.now(),
    })
  }

  return written
}

function parseSurfaceSummaryResult(
  raw: string,
  fallbackTitle: string,
): { title: string; summary: string } | null {
  const normalized = escapeJsonBlock(raw)
  if (!normalized) return null

  try {
    const parsed = JSON.parse(normalized) as { title?: unknown; summary?: unknown }
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
    if (!summary) return null
    return {
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : fallbackTitle,
      summary,
    }
  } catch {
    return {
      title: fallbackTitle,
      summary: normalized,
    }
  }
}

function uniqueAppNames(names: string[]): string[] {
  return names.filter((name, index) => names.indexOf(name) === index)
}

function sessionEndMs(session: { startTime: number; endTime: number | null; durationSeconds: number }): number {
  return session.endTime ?? (session.startTime + session.durationSeconds * 1000)
}

function buildTodayBlocksContext(): string {
  try {
    const db = getDb()
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`
    const payload = getTimelineDayPayload(db, dateStr, null)

    // Only non-trivial blocks (>= 3 min). If nothing non-trivial, still show a short line.
    const blocks = payload.blocks.filter((b) => b.endTime - b.startTime >= 3 * 60_000)
    if (blocks.length === 0) return ''

    const lines = blocks.slice(0, 12).map((block) => {
      const minutes = Math.max(1, Math.round(blockActiveSeconds(block) / 60))
      const label = userVisibleLabelForBlock(block)
      const intent = inferWorkIntent(block)
      const timeRange = `${formatClock(block.startTime)}-${formatClock(block.endTime)}`
      const topApps = block.topApps
        .filter((app) => app.category !== 'system')
        .slice(0, 3)
        .map((app) => app.appName)
      const topSites = block.websites
        .slice(0, 3)
        .map((site) => site.domain.replace(/^www\./, ''))
      const keyPage = block.keyPages.find((t) => t.trim().length > 0)

      const artifacts = block.topArtifacts
        .slice(0, 4)
        .map((a) => a.displayTitle.trim())
        .filter(Boolean)

      const parts = [
        `${timeRange} (${minutes}m) — ${label}`,
        `intent: ${intent.summary}`,
      ]
      if (topApps.length > 0) parts.push(`apps: ${topApps.join(', ')}`)
      if (topSites.length > 0) parts.push(`sites: ${topSites.join(', ')}`)
      if (artifacts.length > 0) parts.push(`artifacts: ${artifacts.join(', ')}`)
      else if (keyPage) parts.push(`key: ${keyPage.slice(0, 80)}`)
      if (block.label.override) parts.push(`user labeled: ${block.label.override}`)
      return `- ${parts.join(' • ')}`
    })

    return ['Today\'s work blocks (chronological):', ...lines].join('\n')
  } catch {
    return ''
  }
}

function buildWorkflowsContext(): string {
  try {
    const db = getDb()
    const workflows = getWorkflowSummaries(db, 14)
    const meaningful = workflows.filter((w) => w.occurrenceCount >= 2).slice(0, 6)
    if (meaningful.length === 0) return ''

    const lines = meaningful.map((w) => {
      const apps = w.canonicalApps.slice(0, 4).join(' + ')
      return `- "${w.label}" (${w.dominantCategory}): ${w.occurrenceCount}× in last 14 days${apps ? ` — ${apps}` : ''}`
    })
    return ['Recurring workflows (last 14 days):', ...lines].join('\n')
  } catch {
    return ''
  }
}

function buildHourlyShapeContext(sessions: { startTime: number; durationSeconds: number; category: string }[]): string {
  if (sessions.length === 0) return ''
  // Build a coarse morning / midday / afternoon / evening profile from today's sessions.
  const buckets: Record<string, Map<string, number>> = {
    morning: new Map(),   // 5-11
    midday: new Map(),    // 11-14
    afternoon: new Map(), // 14-18
    evening: new Map(),   // 18-23
    night: new Map(),     // 23-5
  }
  for (const s of sessions) {
    const hour = new Date(s.startTime).getHours()
    const bucket =
      hour >= 5 && hour < 11 ? 'morning'
      : hour >= 11 && hour < 14 ? 'midday'
      : hour >= 14 && hour < 18 ? 'afternoon'
      : hour >= 18 && hour < 23 ? 'evening'
      : 'night'
    const current = buckets[bucket].get(s.category) ?? 0
    buckets[bucket].set(s.category, current + s.durationSeconds)
  }
  const parts: string[] = []
  for (const [name, map] of Object.entries(buckets)) {
    if (map.size === 0) continue
    const topCat = [...map.entries()].sort((a, b) => b[1] - a[1])[0]
    if (!topCat || topCat[1] < 300) continue // skip buckets with < 5 min
    parts.push(`${name}: mostly ${topCat[0]} (${formatDuration(topCat[1])})`)
  }
  if (parts.length === 0) return ''
  return `Time-of-day shape: ${parts.join('; ')}`
}

function buildRecentFocusContext(): string {
  try {
    const db = getDb()
    const sessions = getRecentFocusSessions(db, 5)
    if (sessions.length === 0) return 'Recent focus sessions: none recorded.'

    const lines = sessions.map((session) => {
      const apps = uniqueAppNames(
        getSessionsForRange(db, session.startTime, sessionEndMs(session))
          .map((item) => item.appName),
      ).slice(0, 5)

      const plan = session.plannedApps.length > 0
        ? session.plannedApps.join(', ')
        : 'not set'
      const observed = apps.length > 0 ? apps.join(', ') : 'none tracked'
      const target = session.targetMinutes ? `, target ${session.targetMinutes}m` : ''

      return `- ${formatDateTimeLabel(session.startTime)}: ${session.label || 'Focus session'} for ${formatDuration(session.durationSeconds)}${target}; planned apps ${plan}; observed apps ${observed}`
    })

    return ['Recent focus sessions:', ...lines].join('\n')
  } catch {
    return 'Recent focus sessions: unavailable.'
  }
}

function parseTimeParts(hourRaw: string, minuteRaw?: string, meridiemRaw?: string): { hour: number; minute: number } | null {
  let hour = Number(hourRaw)
  const minute = Number(minuteRaw ?? '0')
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null

  const meridiem = meridiemRaw?.toLowerCase()
  if (meridiem === 'am') {
    if (hour === 12) hour = 0
  } else if (meridiem === 'pm') {
    if (hour < 12) hour += 12
  }

  if (hour < 0 || hour > 23) return null
  return { hour, minute }
}

function parseTemporalLookup(userMessage: string): { label: string; targetMs: number; dayStart: number; dayEnd: number } | null {
  const lower = userMessage.toLowerCase()
  const now = new Date()

  const relativeFirst = lower.match(/\b(today|yesterday)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)
  const timeFirst = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(today|yesterday)\b/)
  const isoDate = lower.match(/\b(\d{4}-\d{2}-\d{2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)

  let baseDate: Date | null = null
  let label = ''
  let timeParts: { hour: number; minute: number } | null = null

  if (relativeFirst) {
    baseDate = new Date(now)
    if (relativeFirst[1] === 'yesterday') baseDate.setDate(baseDate.getDate() - 1)
    label = relativeFirst[1]
    timeParts = parseTimeParts(relativeFirst[2], relativeFirst[3], relativeFirst[4])
  } else if (timeFirst) {
    baseDate = new Date(now)
    if (timeFirst[4] === 'yesterday') baseDate.setDate(baseDate.getDate() - 1)
    label = timeFirst[4]
    timeParts = parseTimeParts(timeFirst[1], timeFirst[2], timeFirst[3])
  } else if (isoDate) {
    const [year, month, day] = isoDate[1].split('-').map(Number)
    baseDate = new Date(year, month - 1, day)
    label = isoDate[1]
    timeParts = parseTimeParts(isoDate[2], isoDate[3], isoDate[4])
  }

  if (!baseDate || !timeParts) return null

  baseDate.setHours(timeParts.hour, timeParts.minute, 0, 0)
  const dayStart = new Date(baseDate)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)

  return {
    label,
    targetMs: baseDate.getTime(),
    dayStart: dayStart.getTime(),
    dayEnd: dayEnd.getTime(),
  }
}

function buildSpecificTimeContext(userMessage: string): string {
  try {
    const lookup = parseTemporalLookup(userMessage)
    if (!lookup) return ''

    const db = getDb()
    const dayDate = new Date(lookup.dayStart)
    const dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`

    // Look up the work block covering the queried time — this gives us the task
    // label and artifact refs (file names, document names, project names).
    const dayPayload = getTimelineDayPayload(db, dateStr, null)
    const coveringBlock = dayPayload.blocks.find(
      (block) => lookup.targetMs >= block.startTime && lookup.targetMs < block.endTime,
    )

    const daySessions = getSessionsForRange(db, lookup.dayStart, lookup.dayEnd)
    const containing = daySessions.find((session) => {
      const end = sessionEndMs(session)
      return lookup.targetMs >= session.startTime && lookup.targetMs < end
    })
    const windowStart = lookup.targetMs - 45 * 60 * 1000
    const windowEnd = lookup.targetMs + 45 * 60 * 1000
    const nearby = daySessions
      .filter((session) => sessionEndMs(session) > windowStart && session.startTime < windowEnd)
      .slice(0, 5)
    const nearbySites = getWebsiteSummariesForRange(db, windowStart, windowEnd).slice(0, 3)
    const focusSession = getRecentFocusSessions(db, 50).find((session) => {
      const end = sessionEndMs(session)
      return lookup.targetMs >= session.startTime && lookup.targetMs < end
    })

    const lines: string[] = [
      `Specific timeline lookup for ${lookup.label} (${formatDateTimeLabel(lookup.targetMs)}):`,
    ]

    if (coveringBlock) {
      const blockLabel = userVisibleLabelForBlock(coveringBlock)
      const blockArtifacts = coveringBlock.topArtifacts
        .slice(0, 4)
        .map((a) => a.displayTitle.trim())
        .filter(Boolean)
      const blockApps = coveringBlock.topApps
        .filter((app) => app.category !== 'system')
        .slice(0, 3)
        .map((app) => app.appName)
      lines.push(
        `- Work block: "${blockLabel}" (${formatClock(coveringBlock.startTime)}-${formatClock(coveringBlock.endTime)})` +
        (blockApps.length > 0 ? `, apps: ${blockApps.join(', ')}` : '') +
        (blockArtifacts.length > 0 ? `, artifacts: ${blockArtifacts.join(', ')}` : ''),
      )
    }

    if (containing) {
      lines.push(
        `- Foreground app at that time: ${containing.appName} (${containing.category}), ${formatClock(containing.startTime)}-${formatClock(sessionEndMs(containing))}.`,
      )
    } else if (!coveringBlock) {
      lines.push('- No foreground app session covers that exact time.')
    }

    if (nearby.length > 0) {
      lines.push(
        `- Nearby sessions: ${nearby.map((session) => `${session.appName} ${formatClock(session.startTime)}-${formatClock(sessionEndMs(session))}`).join(', ')}.`,
      )
    }

    if (focusSession) {
      const plan = focusSession.plannedApps.length > 0
        ? focusSession.plannedApps.join(', ')
        : 'not set'
      lines.push(
        `- Focus session overlap: ${focusSession.label || 'Focus session'} for ${formatDuration(focusSession.durationSeconds)}${focusSession.targetMinutes ? ` with ${focusSession.targetMinutes}m target` : ''}; planned apps ${plan}.`,
      )
    }

    if (nearbySites.length > 0) {
      lines.push(
        `- Browser evidence near that time: ${nearbySites.map((site) => `${site.domain} (${formatDuration(site.totalSeconds)})`).join(', ')}.`,
      )
    }

    return lines.join('\n')
  } catch {
    return ''
  }
}

function buildStructuredEvidenceContext(): string {
  try {
    const now = new Date()
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const db = getDb()
    const pack = buildAssistantEvidencePack(db, dateStr)

    const dayCtx = resolveDayContext(dateStr, db)
    const workSessions = dayCtx.sessions.slice(0, 12).map((s) => ({
      id: s.work_session_id,
      start: s.start,
      end: s.end,
      duration_ms: s.duration_ms,
      active_ms: s.active_ms,
      client: s.client,
      project: s.project,
      confidence: s.confidence,
      apps: s.apps.slice(0, 5),
      evidence: s.evidence.slice(0, 5),
    }))

    return JSON.stringify({
      date: pack.date,
      generatedAt: pack.generatedAt,
      totals: pack.totals,
      attribution_summary: {
        captured_ms: dayCtx.day_summary.captured_ms,
        active_ms: dayCtx.day_summary.active_ms,
        attributed_ms: dayCtx.day_summary.attributed_ms,
        ambiguous_ms: dayCtx.day_summary.ambiguous_ms,
        unattributed_ms: dayCtx.day_summary.unattributed_ms,
      },
      work_sessions: workSessions,
      topApps: pack.topApps.map((app) => ({
        appName: app.appName,
        category: app.category,
        totalSeconds: app.totalSeconds,
        canonicalAppId: app.canonicalAppId ?? null,
      })),
      topWebsites: pack.topWebsites.map((site) => ({
        domain: site.domain,
        totalSeconds: site.totalSeconds,
        topTitle: site.topTitle,
      })),
      blocks: pack.timeline.blocks,
      workflows: pack.workflows.map((workflow) => ({
        label: workflow.label,
        dominantCategory: workflow.dominantCategory,
        occurrenceCount: workflow.occurrenceCount,
        canonicalApps: workflow.canonicalApps,
      })),
      focusSessions: pack.focusSessions.map((session) => ({
        label: session.label,
        durationSeconds: session.durationSeconds,
        targetMinutes: session.targetMinutes ?? null,
        plannedApps: session.plannedApps,
      })),
      appSpotlights: pack.appSpotlights.map((app) => ({
        displayName: app.displayName,
        totalSeconds: app.totalSeconds,
        topArtifacts: app.topArtifacts.slice(0, 4).map((artifact) => artifact.displayTitle),
        pairedApps: app.pairedApps.slice(0, 4).map((entry) => entry.displayName),
        workflows: app.workflowAppearances.slice(0, 4).map((workflow) => workflow.label),
      })),
      ambiguous_segments: dayCtx.ambiguous_segments.slice(0, 5),
      caveats: [
        ...pack.caveats,
        'work_sessions are attributed via the pipeline; always separate attributed from ambiguous time.',
        'When answering "how many hours on X", prefer attributed work_sessions when a named client or project exists; otherwise fall back to blocks and artifacts instead of raw app totals alone.',
      ],
    }, null, 2)
  } catch {
    return ''
  }
}

function buildAttributionDayContext(dateStr: string): string {
  try {
    const payload = resolveDayContext(dateStr, getDb())
    if (payload.sessions.length === 0) return ''
    return JSON.stringify(payload, null, 2)
  } catch {
    return ''
  }
}

function buildAttributedEntityContext(userMessage: string): string {
  try {
    const entityMatch = userMessage.match(
      /(?:hours?\s+(?:on|for|with|at)\s+|client\s+|project\s+)['"]?([A-Za-z][\w\s&.-]{1,40})['"]?/i,
    )
    if (!entityMatch) return ''
    const db = getDb()
    const candidate = entityMatch[1].trim()

    const now = new Date()
    const weekAgo = new Date(now)
    weekAgo.setDate(weekAgo.getDate() - 7)
    weekAgo.setHours(0, 0, 0, 0)

    const project = findProjectByName(candidate, db)
    if (project) {
      const payload = resolveProjectQuery(
        project.id, weekAgo.getTime(), now.getTime(),
        userMessage, db,
      )
      if (payload) return JSON.stringify(payload, null, 2)
    }

    const client = findClientByName(candidate, db)
    if (!client) return ''
    const payload = resolveClientQuery(
      client.id, weekAgo.getTime(), now.getTime(),
      userMessage, db,
    )
    if (!payload) return ''
    return JSON.stringify(payload, null, 2)
  } catch {
    return ''
  }
}

// Compact historical summary spanning the entire tracked window. Injected into
// the chat system prompt so the LLM can answer follow-up questions about
// all-time totals (e.g. "how many days is that?") after a deterministic router
// hit, instead of contradicting its previous answer with "I only see today".
function buildAllTimeContext(): string {
  try {
    const db = getDb()
    const toMs = Date.now()
    const fromMs = toMs - 2 * 365 * 24 * 60 * 60 * 1000
    const apps = getAppSummariesForRange(db, fromMs, toMs)
    const sites = getWebsiteSummariesForRange(db, fromMs, toMs)
    if (apps.length === 0 && sites.length === 0) return ''

    const firstSessionRow = db
      .prepare('SELECT MIN(start_time) as t FROM app_sessions')
      .get() as { t: number | null } | undefined
    const firstSessionMs = firstSessionRow?.t ?? fromMs
    const trackingDays = Math.max(1, Math.round((toMs - firstSessionMs) / (24 * 60 * 60 * 1000)))

    const totalSeconds = apps.reduce((sum, app) => sum + app.totalSeconds, 0)
    const focusSeconds = apps.filter((a) => a.isFocused).reduce((sum, app) => sum + app.totalSeconds, 0)
    const focusPct = totalSeconds > 0 ? Math.round((focusSeconds / totalSeconds) * 100) : 0

    const distractionSites = sites.filter((s) => DISTRACTION_DOMAINS.includes(s.domain.toLowerCase()))
    const distractionSeconds = distractionSites.reduce((sum, s) => sum + s.totalSeconds, 0)

    const topApps = apps
      .slice(0, 10)
      .map((app) => `${app.appName} (${formatDuration(app.totalSeconds)})`)
      .join(', ')
    const topSites = sites
      .slice(0, 10)
      .map((site) => `${site.domain} (${formatDuration(site.totalSeconds)})`)
      .join(', ')

    const topCategories = new Map<string, number>()
    for (const app of apps) {
      topCategories.set(app.category, (topCategories.get(app.category) ?? 0) + app.totalSeconds)
    }
    const topCategoryList = [...topCategories.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat, sec]) => `${cat} (${formatDuration(sec)})`)
      .join(', ')

    const lines = [
      `Tracking window: ${trackingDays} days (since first recorded session).`,
      `Lifetime tracked time: ${formatDuration(totalSeconds)}, ~${focusPct}% focused.`,
      topCategoryList ? `Lifetime by category: ${topCategoryList}.` : null,
      topApps ? `Lifetime top apps: ${topApps}.` : null,
      topSites ? `Lifetime top sites: ${topSites}.` : null,
      distractionSeconds > 0
        ? `Lifetime distraction time (YouTube, X, Reddit, etc.): ${formatDuration(distractionSeconds)} of ${formatDuration(totalSeconds)} total.`
        : null,
    ].filter((line): line is string => line !== null)

    return lines.join('\n')
  } catch {
    return ''
  }
}

function buildDayContext(): string {
  try {
    const db = getDb()
    const settings = getSettings()
    const now = new Date()
    const [todayFrom, todayTo] = dayBounds(now)
    const summaries = getAppSummariesForRange(db, todayFrom, todayTo)
    const todaySessions = getSessionsForRange(db, todayFrom, todayTo)
    const websites = getWebsiteSummariesForRange(db, todayFrom, todayTo)
    const todayEvidence = deriveWorkEvidenceSummary({
      appSummaries: summaries,
      sessions: todaySessions,
      websiteSummaries: websites,
    })
    const totalSec = summaries.reduce((s, a) => s + a.totalSeconds, 0)
    const focusSec = summaries.filter((a) => a.isFocused).reduce((s, a) => s + a.totalSeconds, 0)
    const focusBreakdown = computeFocusScoreV2({
      sessions: todaySessions.map((session) => ({
        startTime: session.startTime,
        endTime: session.endTime,
        durationSeconds: session.durationSeconds,
        category: session.category,
        isFocused: session.isFocused,
      })),
      totalActiveSeconds: totalSec,
    })

    // User identity & goals
    const userName = settings.userName || 'the user'
    const goalsStr = settings.userGoals?.length
      ? settings.userGoals.join(', ')
      : 'not specified'
    const selectedGoals = new Set(settings.userGoals ?? [])

    const goalContextLines: string[] = []
    if (selectedGoals.has('less-distraction')) {
      const distractionDomains = ['youtube.com', 'x.com', 'twitter.com', 'instagram.com', 'reddit.com', 'tiktok.com', 'netflix.com', 'facebook.com']
      const distractionSites = websites
        .filter((site) => distractionDomains.includes(site.domain.toLowerCase()))
      const distractionSeconds = distractionSites.reduce((sum, site) => sum + site.totalSeconds, 0)
      const topDistractionDomains = distractionSites
        .slice(0, 3)
        .map((site) => site.domain)
      goalContextLines.push(
        `Distraction today: ${Math.round(distractionSeconds / 60)} minutes across [${topDistractionDomains.join(', ') || 'none'}]`,
      )
    }
    if (selectedGoals.has('deep-work')) {
      const deepWorkMinutes = focusBreakdown.deepWorkPct === null
        ? 0
        : Math.round((focusBreakdown.deepWorkPct / 100) * totalSec / 60)
      goalContextLines.push(
        `Deep work today: ${deepWorkMinutes} minutes across ${focusBreakdown.deepWorkSessionCount} sessions. Longest streak: ${Math.round(focusBreakdown.longestStreakSeconds / 60)} minutes.`,
      )
    }

    // Focus sessions
    const focusSessions = getRecentFocusSessions(db, 10).filter((s) => {
      return s.startTime >= todayFrom && s.startTime < todayTo
    })
    const todayFocusSessionCount = focusSessions.length
    const longestFocusSession = focusSessions.reduce((m, s) => Math.max(m, s.durationSeconds), 0)
    const totalFocusSessionSec = focusSessions.reduce((s, x) => s + x.durationSeconds, 0)

    // Category overrides
    const overrides = getCategoryOverrides(db)
    const overrideEntries = Object.entries(overrides)

    // Time context
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    const dayStr = now.toLocaleDateString('en-US', { weekday: 'long' })

    if (summaries.length === 0 && websites.length === 0) {
      return [
        `User: ${userName}`,
        `Goals: ${goalsStr}`,
        ...goalContextLines,
        `Current time: ${timeStr}, ${dayStr}`,
        '',
        'No activity recorded yet today.',
      ].join('\n')
    }

    const topCategories = new Map<string, number>()
    for (const summary of summaries) {
      topCategories.set(summary.category, (topCategories.get(summary.category) ?? 0) + summary.totalSeconds)
    }
    const topApps = summaries
      .slice(0, 5)
      .map((a) => `${a.appName} (${formatDuration(a.totalSeconds)}, ${a.category})`)
      .join(', ')
    const topSites = websites
      .slice(0, 5)
      .map((site) => `${site.domain} (${formatDuration(site.totalSeconds)})`)
      .join(', ')
    const topCategoryList = [...topCategories.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([category, seconds]) => `${category} (${formatDuration(seconds)})`)
      .join(', ')

    const recentDays: string[] = []
    for (let offset = 1; offset <= 6; offset++) {
      const date = new Date(todayFrom - offset * 86_400_000)
      const [fromMs, toMs] = dayBounds(date)
      const daySummaries = getAppSummariesForRange(db, fromMs, toMs)
      const daySessions = getSessionsForRange(db, fromMs, toMs)
      if (daySummaries.length === 0) continue
      const dayTotal = daySummaries.reduce((sum, item) => sum + item.totalSeconds, 0)
      const dayFocus = daySummaries.filter((item) => item.isFocused).reduce((sum, item) => sum + item.totalSeconds, 0)
      const daySwitchesPerHour = dayTotal > 0 ? countSwitches(daySessions) / (dayTotal / 3600) : 0
      const dayFocusScore = computeEnhancedFocusScore({
        focusedSeconds: dayFocus,
        totalSeconds: dayTotal,
        switchesPerHour: daySwitchesPerHour,
        sessions: daySessions.map((session) => ({
          durationSeconds: session.durationSeconds,
          isFocused: session.isFocused,
        })),
      })
      const topApp = daySummaries[0]
      recentDays.push(
        `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ` +
        `${formatDuration(dayTotal)} total, focus score ${dayFocusScore}, top app ${topApp?.appName ?? 'n/a'}`,
      )
    }

    const recentFocusContext = buildRecentFocusContext()
    const todayBlocksContext = buildTodayBlocksContext()
    const workflowsContext = buildWorkflowsContext()
    const structuredEvidenceContext = buildStructuredEvidenceContext()
    const hourlyShapeContext = buildHourlyShapeContext(
      todaySessions.map((s) => ({
        startTime: s.startTime,
        durationSeconds: s.durationSeconds,
        category: s.category,
      })),
    )

    return [
      `User: ${userName}`,
      `Goals: ${goalsStr}`,
      ...goalContextLines,
      `Current time: ${timeStr}, ${dayStr}`,
      '',
      todayFocusSessionCount > 0
        ? `Focus sessions today: ${todayFocusSessionCount} session${todayFocusSessionCount > 1 ? 's' : ''}, longest ${formatDuration(longestFocusSession)}, total ${formatDuration(totalFocusSessionSec)}`
        : 'Focus sessions today: none',
      overrideEntries.length > 0
        ? `User has recategorized: ${overrideEntries.map(([id, cat]) => `${id} → ${cat}`).join(', ')}`
        : '',
      '',
      'Today (totals):',
      `- Total tracked time: ${formatDuration(totalSec)}`,
      `- Focus score: ${focusBreakdown.deepWorkPct === null ? 'Not enough data' : `${focusBreakdown.deepWorkPct}% deep work`} (${formatDuration(focusSec)} in focused apps)`,
      `- Evidence summary: ${todayEvidence.evidenceText}`,
      `- Top categories: ${topCategoryList || 'none yet'}`,
      `- Top apps: ${topApps || 'none yet'}`,
      `- Top websites: ${topSites || 'none yet'}`,
      hourlyShapeContext ? `- ${hourlyShapeContext}` : '',
      '',
      todayBlocksContext,
      '',
      workflowsContext,
      '',
      recentDays.length > 0 ? 'Recent days (trend):' : '',
      ...recentDays.map((line) => `- ${line}`),
      '',
      recentFocusContext,
      structuredEvidenceContext ? 'Structured evidence pack (JSON):' : '',
      structuredEvidenceContext,
      '',
      'Data notes:',
      '- App totals come from tracked foreground-window sessions — reliable.',
      '- Work blocks are segmented by the local heuristic; labels may be rule-based or AI-generated.',
      '- Each block includes a deterministic workIntent guess; prefer that over generic home/feed titles when inferring what the person was trying to do.',
      '- Website timing comes from local browser evidence and may undercount background tabs.',
      '- Focus score weights focused categories (development, writing, design, etc.); browser work may be productive but read as unfocused.',
    ]
      .filter((l) => l !== '')
      .join('\n')
  } catch {
    return ''
  }
}

function escapeJsonBlock(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced?.[1]?.trim() ?? raw.trim()
}


function sanitizeConversationHistory(history: AIThreadMessage[]): { role: 'user' | 'assistant'; content: string }[] {
  const prior = history.slice()
  while (prior.length > 0 && prior[prior.length - 1].role === 'user') {
    prior.pop()
  }
  // Strip user+assistant pairs where the assistant content is empty.
  // Keeping empty assistant messages would corrupt the alternation pattern
  // and cause some providers to return an empty response.
  const sanitized: AIThreadMessage[] = []
  let i = 0
  while (i < prior.length) {
    const msg = prior[i]
    if (msg.role === 'user') {
      const next = prior[i + 1]
      if (next?.role === 'assistant' && !next.content.trim()) {
        i += 2
        continue
      }
    }
    sanitized.push(msg)
    i++
  }
  return sanitized.map((message) => ({
    role: message.role,
    content: message.content,
  }))
}

function blockDurationSeconds(block: Pick<WorkContextBlock, 'startTime' | 'endTime' | 'sessions'>): number {
  return blockActiveSeconds(block as WorkContextBlock)
}

function uniqueStrings(values: Array<string | null | undefined>, limit = values.length): string[] {
  const unique: string[] = []
  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed || unique.includes(trimmed)) continue
    unique.push(trimmed)
    if (unique.length >= limit) break
  }
  return unique
}

function namedEvidenceForSummary(block: WorkContextBlock): string[] {
  return uniqueStrings([
    ...block.topArtifacts.map((artifact) => artifact.displayTitle),
    ...block.pageRefs.map((page) => page.pageTitle ?? page.displayTitle),
    ...block.topApps
      .filter((app) => !app.isBrowser && app.category !== 'system' && app.category !== 'uncategorized')
      .map((app) => app.appName),
  ], 3)
}

function leadSentenceForIntent(block: WorkContextBlock): string {
  const duration = formatDuration(blockDurationSeconds(block))
  const intent = inferWorkIntent(block)

  switch (intent.role) {
    case 'execution':
      return intent.subject
        ? `The clearest named block was ${intent.subject} for ${duration}.`
        : `The clearest block lasted ${duration}, but the label is still broad.`
    case 'research':
      return intent.subject
        ? `A large share of today was captured around ${intent.subject} for ${duration}.`
        : `A large share of today was browsing or page context for ${duration}, but intent is not certain.`
    case 'review':
      return intent.subject
        ? `A large share of today touched ${intent.subject} for ${duration}.`
        : `A large share of today looked like review for ${duration}, based on the available titles.`
    case 'communication':
      return intent.subject
        ? `A large share of today was communication around ${intent.subject} for ${duration}.`
        : `A large share of today was communication for ${duration}.`
    case 'coordination':
      return intent.subject
        ? `A large share of today was coordination around ${intent.subject} for ${duration}.`
        : `A large share of today was coordination for ${duration}.`
    case 'ambient':
      return intent.subject
        ? `A meaningful chunk of today was browser or app context on ${intent.subject} for ${duration}.`
        : `A meaningful chunk of today was browser or app context for ${duration}.`
    case 'ambiguous':
    default:
      return intent.subject
        ? `The day mixed together work touching ${intent.subject} for ${duration}.`
        : `The day mixed together several threads over ${duration}.`
  }
}

function supportingIntentSentence(primary: WorkContextBlock, rankedBlocks: WorkContextBlock[]): string | null {
  const primaryIntent = inferWorkIntent(primary)
  const supporting = rankedBlocks
    .slice(1)
    .map((block) => ({ block, intent: inferWorkIntent(block) }))
    .find(({ intent }) => intent.role !== primaryIntent.role)

  if (!supporting) return null

  if (primaryIntent.role === 'execution' && (supporting.intent.role === 'research' || supporting.intent.role === 'ambient')) {
    return `${supporting.intent.summary} was supporting context, based on the available titles.`
  }

  if ((primaryIntent.role === 'research' || primaryIntent.role === 'ambient') && supporting.intent.role === 'execution') {
    return `The more concrete work evidence showed up in ${supporting.intent.summary.toLowerCase()}.`
  }

  return null
}

function focusSentence(payload: DayTimelinePayload): string {
  if (payload.focusPct >= 70) {
    return `Focus held for ${formatDuration(payload.focusSeconds)} (${payload.focusPct}% of tracked time).`
  }
  return `Focus was more fragmented, with ${formatDuration(payload.focusSeconds)} counted as focused time (${payload.focusPct}%).`
}

function inferFollowUpAffordances(answerKind: AIAnswerKind): AIConversationState['followUpAffordances'] {
  switch (answerKind) {
    case 'weekly_brief':
      return ['deepen', 'literalize', 'narrow', 'compare', 'switch_topic', 'repair']
    case 'weekly_literal_list':
      return ['narrow', 'expand', 'switch_topic', 'switch_timeframe', 'repair']
    case 'deterministic_stats':
      return ['deepen', 'expand', 'compare', 'repair']
    case 'day_summary_style':
    case 'generated_report':
      return ['deepen', 'expand', 'narrow', 'repair']
    case 'freeform_chat':
      return ['deepen', 'expand', 'repair']
    case 'error':
    default:
      return []
  }
}

async function generateSuggestedFollowUps(
  userQuestion: string,
  answerText: string,
  answerKind: AIAnswerKind,
  state: AIConversationState | null,
): Promise<FollowUpSuggestion[]> {
  const justAnsweredShape = classifyQuestionShape(userQuestion)
  const fallbackReport = filterFollowUpCandidatesWithReport(
    answerText,
    buildDeterministicFollowUpCandidates(answerKind, state, answerText),
    justAnsweredShape,
  )
  const fallback = fallbackReport.suggestions
  if (fallback.length < 2 || answerKind === 'error') return fallback.slice(0, 4)

  const preferredProviderOverride = await hasApiKey('anthropic') ? 'anthropic' as const : null
  const { systemPrompt, userPrompt } = buildFollowUpSuggestionPrompts(userQuestion, answerText, state, fallback)

  const runOnce = async (): Promise<FollowUpSuggestion[]> => {
    const { text } = await withTimeout(
      executeTextAIJob(
        {
          jobType: 'chat_followup_suggestions',
          screen: 'ai_chat',
          triggerSource: 'system',
          systemPrompt,
          userMessage: userPrompt,
          preferredProviderOverride,
        },
        sendWithProvider,
      ),
      6_000,
      'Follow-up suggestion generation timed out',
    )
    const parsed = parseFollowUpSuggestions(text, fallback)
    return filterFollowUpCandidatesWithReport(answerText, parsed, justAnsweredShape).suggestions
  }

  try {
    let results = await runOnce()
    // Retry once if every result is deterministic — model output had no named-entity suggestions
    if (results.every((s) => s.source === 'deterministic')) {
      results = await runOnce()
    }
    return results.slice(0, 4)
  } catch (error) {
    capture(ANALYTICS_EVENT.AI_FOLLOWUP_SUGGESTIONS_FALLBACK, {
      failure_kind: classifyFailureKind(error),
      answer_kind: answerKind,
      provider: preferredProviderOverride ?? 'anthropic',
      suggestion_count: fallback.length,
      rejected_temporal_count: fallbackReport.rejectedByRule.temporal,
      rejected_generic_count: fallbackReport.rejectedByRule.generic,
      rejected_entity_count: fallbackReport.rejectedByRule.entity,
      rejected_shape_count: fallbackReport.rejectedByRule.shape,
    })
    return fallback.slice(0, 4)
  }
}

function conversationContextKey(conversationId: number, threadId: number | null): string {
  return threadId == null ? `conversation:${conversationId}` : `thread:${threadId}`
}

function restoreConversationState(conversationId: number): AIConversationState | null {
  const db = getDb()
  const persisted = getConversationState(db, conversationId)
  if (!persisted) return null
  const key = conversationContextKey(conversationId, null)
  if (!conversationTemporalContext.has(key)) {
    conversationTemporalContext.set(key, deserializeTemporalContext(persisted.routingContext))
  }
  return persisted
}

function restoreChatState(conversationId: number, threadId: number | null): AIConversationState | null {
  if (threadId == null) return restoreConversationState(conversationId)
  const db = getDb()
  const persisted = getThreadConversationState(db, threadId)
  if (!persisted) return null
  const key = conversationContextKey(conversationId, threadId)
  if (!conversationTemporalContext.has(key)) {
    conversationTemporalContext.set(key, deserializeTemporalContext(persisted.routingContext))
  }
  return persisted
}

function buildAssistantMetadata(
  answerKind: AIAnswerKind,
  suggestedFollowUps: FollowUpSuggestion[],
  retrySourceUserMessageId: number | null,
  conversationState: AIConversationState | null,
  actions: AIMessageAction[] = [],
  artifacts: AIMessageArtifact[] = [],
  providerError = false,
): AIThreadMessageMetadata {
  return {
    answerKind,
    suggestedFollowUps,
    retryable: !providerError,
    retrySourceUserMessageId,
    contextSnapshot: conversationState,
    providerError,
    actions,
    artifacts,
  }
}

async function persistChatTurn(
  db: ReturnType<typeof getDb>,
  conversationId: number,
  userMessage: string,
  envelope: AnswerEnvelope,
  threadId: number | null = null,
): Promise<AIChatTurnResult> {
  const userEntry = appendConversationMessage(db, conversationId, 'user', userMessage, { threadId })
  const assistantEntry = appendConversationMessage(
    db,
    conversationId,
    'assistant',
    envelope.assistantText,
    {
      threadId,
      metadata: buildAssistantMetadata(
        envelope.answerKind,
        envelope.suggestedFollowUps,
        userEntry.id,
        envelope.conversationState,
        envelope.actions ?? [],
        envelope.artifacts ?? [],
        envelope.answerKind === 'error',
      ),
    },
  )
  if (threadId == null) {
    upsertConversationState(db, conversationId, envelope.conversationState)
  }
  conversationTemporalContext.set(conversationContextKey(conversationId, threadId), envelope.resolvedTemporalContext)
  if (threadId != null) {
    touchThreadLastMessage(db, threadId, Date.now())
    queueWeakThreadTitleUpgrade(threadId, userMessage, envelope)
    // Also persist AIMessageArtifact entries into the durable ai_artifacts table.
    if (envelope.artifacts && envelope.artifacts.length > 0) {
      await persistMessageArtifacts(threadId, assistantEntry.id, envelope.artifacts)
    }
  }
  return {
    assistantMessage: assistantEntry,
    conversationState: envelope.conversationState,
  }
}

function threadTitleContextFromEnvelope(envelope: AnswerEnvelope): ThreadTitleContext {
  return {
    answerKind: envelope.answerKind,
    entityName: envelope.resolvedTemporalContext?.entity?.entityName ?? null,
    entityIntent: envelope.resolvedTemporalContext?.entity?.intent ?? null,
    weeklyBriefIntent: envelope.resolvedTemporalContext?.weeklyBrief?.intent ?? null,
  }
}

function maybeRenameWeakThread(
  threadId: number,
  currentTitle: string | null | undefined,
  userMessage: string,
  context?: ThreadTitleContext,
): void {
  if (!isWeakThreadTitle(currentTitle)) return
  const candidate = deriveTitleFromMessage(userMessage, context)
  if (candidate === currentTitle || isWeakThreadTitle(candidate)) return
  renameThread(threadId, candidate)
}

function queueWeakThreadTitleUpgrade(threadId: number, userMessage: string, envelope: AnswerEnvelope): void {
  const context = threadTitleContextFromEnvelope(envelope)
  const currentTitle = getThread(threadId)?.title ?? null
  maybeRenameWeakThread(threadId, currentTitle, userMessage, context)
}

function mapMessageArtifactKind(
  kind: AIMessageArtifact['kind'],
  format: AIMessageArtifact['format'],
): AIArtifactKind {
  if (kind === 'report') return 'report'
  if (kind === 'chart' || format === 'html') return 'html_chart'
  if (kind === 'table' || format === 'json') return 'json_table'
  if (format === 'csv') return 'csv'
  return 'markdown'
}

async function persistMessageArtifacts(
  threadId: number,
  messageId: number,
  artifacts: AIMessageArtifact[],
): Promise<void> {
  for (const artifact of artifacts) {
    try {
      let fileContent = ''
      try {
        fileContent = await fs.readFile(artifact.path, 'utf8')
      } catch {
        // ignore — createArtifact with existingFilePath still records the row.
      }
      await createArtifact({
        threadId,
        messageId,
        kind: mapMessageArtifactKind(artifact.kind, artifact.format),
        title: artifact.title,
        summary: artifact.subtitle ?? null,
        content: fileContent,
        existingFilePath: artifact.path,
        meta: {
          source: 'assistant_message',
          originalId: artifact.id,
          format: artifact.format,
        },
      })
    } catch (error) {
      console.warn('[ai] failed to persist assistant artifact:', error)
    }
  }
}

function fallbackDaySummary(payload: DayTimelinePayload): AIDaySummaryResult {
  if (payload.totalSeconds === 0) {
    return {
      summary: 'No tracked activity yet today. Once Daylens has real local history, this screen can answer questions about your work, files, pages, and focus patterns.',
      questionSuggestions: [
        'What kinds of questions will you be able to answer once I have more history?',
        'How should I use Daylens if I am not tracking clients?',
        'What should I pay attention to the first few days of tracking?',
      ],
    }
  }

  const rankedBlocks = [...payload.blocks]
    .sort((left, right) => blockDurationSeconds(right) - blockDurationSeconds(left))
    .slice(0, 3)
  const primary = rankedBlocks[0]
  const evidence = primary ? namedEvidenceForSummary(primary) : []

  const summaryParts = [
    `You tracked ${formatDuration(payload.totalSeconds)} across ${payload.blocks.length} block${payload.blocks.length === 1 ? '' : 's'} today.`,
    primary ? leadSentenceForIntent(primary) : null,
    evidence.length > 0 ? `Strongest evidence included ${evidence.join(', ')}.` : null,
    primary ? supportingIntentSentence(primary, rankedBlocks) : null,
    focusSentence(payload),
  ]

  return {
    summary: summaryParts.filter((part): part is string => Boolean(part)).join(' '),
    questionSuggestions: [
      'What did I actually get done today?',
      'Which files, docs, or pages did I touch today?',
      payload.blocks.length >= 3 ? 'Where did my focus break down today?' : 'What should I pick back up next?',
    ],
  }
}

function daySummaryCacheKey(payload: DayTimelinePayload): string {
  return JSON.stringify({
    date: payload.date,
    totalSeconds: payload.totalSeconds,
    focusSeconds: payload.focusSeconds,
    focusPct: payload.focusPct,
    blockCount: payload.blocks.length,
    blocks: payload.blocks.map((block) => ({
      id: block.id,
      label: block.label.current,
      narrative: block.label.narrative,
      startTime: block.startTime,
      endTime: block.endTime,
      dominantCategory: block.dominantCategory,
      topApps: block.topApps.slice(0, 3).map((app) => ({
        appName: app.appName,
        category: app.category,
        isBrowser: app.isBrowser,
      })),
      domains: block.websites.slice(0, 3).map((site) => site.domain),
      artifacts: block.topArtifacts.slice(0, 3).map((artifact) => artifact.displayTitle),
      pages: block.pageRefs.slice(0, 2).map((page) => page.displayTitle),
      workflows: block.workflowRefs.slice(0, 2).map((workflow) => workflow.label),
    })),
  })
}

function buildDaySummaryScaffold(payload: DayTimelinePayload): string {
  const dominantBlocks = [...payload.blocks]
    .sort((left, right) => blockDurationSeconds(right) - blockDurationSeconds(left))
    .slice(0, 4)
    .map((block) => ({
      label: block.label.current,
      timeRange: `${formatClock(block.startTime)}-${formatClock(block.endTime)}`,
      duration: formatDuration(blockDurationSeconds(block)),
      workIntent: inferWorkIntent(block),
      supportingEvidence: namedEvidenceForSummary(block),
    }))

  const topCategories = Array.from(payload.blocks.reduce<Map<string, number>>((map, block) => {
    const durationSeconds = blockDurationSeconds(block)
    map.set(block.dominantCategory, (map.get(block.dominantCategory) ?? 0) + durationSeconds)
    return map
  }, new Map()).entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([category, seconds]) => ({ category, duration: formatDuration(seconds) }))

  const blocks = payload.blocks.slice(0, 8).map((block) => ({
    label: block.label.current,
    narrative: block.label.narrative,
    timeRange: `${formatClock(block.startTime)}-${formatClock(block.endTime)}`,
    duration: formatDuration(blockDurationSeconds(block)),
    dominantCategory: block.dominantCategory,
    confidence: block.confidence,
    workIntent: inferWorkIntent(block),
    topApps: block.topApps.slice(0, 3).map((app) => ({
      appName: app.appName,
      duration: formatDuration(app.totalSeconds),
    })),
    artifacts: block.topArtifacts.slice(0, 4).map((artifact) => ({
      title: artifact.displayTitle,
      type: artifact.artifactType,
    })),
    pages: block.pageRefs.slice(0, 3).map((page) => ({
      title: page.displayTitle,
      domain: page.domain,
    })),
    workflows: block.workflowRefs.slice(0, 3).map((workflow) => workflow.label),
  }))

  const focusSessions = payload.focusSessions.slice(0, 4).map((session) => ({
    label: session.label,
    duration: formatDuration(session.durationSeconds),
    startedAt: formatClock(session.startTime),
  }))

  return JSON.stringify({
    date: payload.date,
    totals: {
      tracked: formatDuration(payload.totalSeconds),
      focus: formatDuration(payload.focusSeconds),
      focusPct: payload.focusPct,
      blockCount: payload.blocks.length,
      appCount: payload.appCount,
      siteCount: payload.siteCount,
    },
    topCategories,
    dominantBlocks,
    blocks,
    focusSessions,
  }, null, 2)
}

function parseDaySummaryResult(raw: string, fallbackQuestions: string[]): AIDaySummaryResult | null {
  return parseDaySummaryResultText(raw, fallbackQuestions)
}

function currentLocalDateString(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export async function generateDaySummary(dateStr: string): Promise<AIDaySummaryResult> {
  const db = getDb()
  const liveSession = dateStr === currentLocalDateString() ? getCurrentSession() : null
  const payload = getTimelineDayPayload(db, dateStr, liveSession)
  const fallback = fallbackDaySummary(payload)

  if (payload.totalSeconds === 0) {
    return fallback
  }

  const cacheKey = daySummaryCacheKey(payload)
  const cached = daySummaryCache.get(cacheKey)
  if (cached) return cached

  const systemPrompt = [
    VOICE_SYSTEM_PROMPT,
    'You are Daylens, writing the opening daily briefing for a desktop work-intelligence app.',
    'Do not use emoji in any part of your response.',
    'Turn deterministic local work evidence into a concise, useful summary.',
    'Focus on what the person was actually working on, what moved forward, and what deserves follow-up.',
    'Prefer the structured workIntent signal over raw homepage, feed, or generic tab labels when they conflict.',
    'Treat generic feed/home usage as context unless the evidence clearly says it was the main task.',
    'Never use raw app names as the subject of a sentence. Instead, describe what the app is used for: Warp or Terminal → "your terminal", a browser (Chrome, Safari, Arc, Firefox) → "your browser", VS Code or Cursor → "your editor", Figma → "your design tool", Slack or Teams → "your messaging app", X.com or Twitter → "social browsing" or a specific activity from the page title. Use the specific app name only when a more descriptive phrase would be unclear.',
    'Use window titles and page titles as evidence for what the user was doing. Do not use the app name as a proxy for the activity. When a page or thread title is available, prefer describing the specific content over naming the platform.',
    'Ignore badge-count prefixes like "(4)" when interpreting page or tab titles.',
    'Mention exact file, document, page, repo, or artifact names only when they appear verbatim in the evidence.',
    'Do not write like a dashboard, analytics panel, or generic AI recap.',
    'Avoid filler like "based on the provided data", "top apps", or "productive/unproductive".',
    'Use specific time ranges and named work blocks when they make the story clearer.',
    'If the evidence is thin or ambiguous, say so plainly and stay modest.',
    'The summary must be declarative and must not ask the user a question.',
    'Return strict JSON with keys "summary" and "questionSuggestions".',
    '"summary" must be 2-4 sentences.',
    '"questionSuggestions" must contain exactly 3 clickable next-query chips spoken by the user to Daylens.',
    'Write questionSuggestions as first-person user queries or direct requests to the assistant, not as questions back to the user.',
    'Good examples: "What did I actually get done today?", "Which files or pages mattered most today?", "Summarize today as a short report I could share".',
    'Bad examples: "Are you building a model right now?", "Did task planning settle into place?", "Is this still in discovery phase?".',
    'Never ask the user to confirm intent, progress, or motivation.',
  ].join(' ')

  const userMessage = [
    `Date: ${dateStr}`,
    '',
    'Write the opening AI summary card and three suggested next-query chips for this day.',
    'The user should feel like Daylens understood the work, not like it stitched together a template.',
    'The chips will be rendered as buttons under an "Ask Daylens" label, so they must read like things the user would click to ask next.',
    '',
    'Structured day evidence (JSON):',
    buildDaySummaryScaffold(payload),
  ].join('\n')

  try {
    const { text } = await withTimeout(
      executeTextAIJob(
        {
          jobType: 'day_summary',
          screen: 'ai_chat',
          triggerSource: 'system',
          systemPrompt,
          userMessage,
        },
        sendWithProvider,
      ),
      15_000,
      'Day summary timed out',
    )

    const parsed = parseDaySummaryResult(text, fallback.questionSuggestions)
    const result = parsed ?? fallback
    daySummaryCache.set(cacheKey, result)
    return result
  } catch (error) {
    console.warn(`[ai] day_summary failed for ${dateStr}:`, error)
    return fallback
  }
}

function buildWeekDateRange(weekStartStr: string): { weekStart: string; weekEnd: string; dates: string[] } {
  const [year, month, day] = weekStartStr.split('-').map(Number)
  const start = new Date(year, month - 1, day)
  const dates = Array.from({ length: 7 }, (_, index) => {
    const next = new Date(start)
    next.setDate(start.getDate() + index)
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
  })
  return {
    weekStart: dates[0],
    weekEnd: dates[dates.length - 1],
    dates,
  }
}

function buildWeekReviewBundle(weekStartStr: string): ReportContextBundle | null {
  const db = getDb()
  const { weekStart, weekEnd, dates } = buildWeekDateRange(weekStartStr)
  const dayPayloads = dates.map((date) => getTimelineDayPayload(db, date, null))
  const activeDays = dayPayloads.filter((payload) => payload.totalSeconds > 0)
  if (activeDays.length === 0) return null

  const totalTrackedSeconds = activeDays.reduce((sum, payload) => sum + payload.totalSeconds, 0)
  const totalFocusSeconds = activeDays.reduce((sum, payload) => sum + payload.focusSeconds, 0)
  const topArtifacts = activeDays
    .flatMap((payload) => payload.blocks.flatMap((block) => block.topArtifacts.slice(0, 2).map((artifact) => artifact.displayTitle)))
    .filter(Boolean)
    .slice(0, 8)

  const topCategories = Array.from(activeDays.reduce<Map<string, number>>((map, payload) => {
    for (const block of payload.blocks) {
      const durationSeconds = blockActiveSeconds(block)
      map.set(block.dominantCategory, (map.get(block.dominantCategory) ?? 0) + durationSeconds)
    }
    return map
  }, new Map()).entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([category, seconds]) => ({ category, duration: formatDuration(seconds) }))

  const dayRows = activeDays.map((payload) => ({
    date: payload.date,
    tracked: formatDuration(payload.totalSeconds),
    focus: formatDuration(payload.focusSeconds),
    focus_pct: payload.focusPct,
    top_blocks: payload.blocks.slice(0, 3).map((block) => block.label.current).filter(Boolean).join(' | ') || 'No clear blocks',
  }))

  const renderDeterministic = (): { reportMarkdown: string; assistantResponse: string } => {
    const weekFocusPct = totalTrackedSeconds > 0 ? Math.round((totalFocusSeconds / totalTrackedSeconds) * 100) : 0
    const bestDay = activeDays.slice().sort((a, b) => b.focusPct - a.focusPct)[0]
    const longestDay = activeDays.slice().sort((a, b) => b.totalSeconds - a.totalSeconds)[0]
    const dayName = (dateStr: string): string => {
      const [y, m, d] = dateStr.split('-').map((n) => Number(n))
      const dt = new Date(y, (m ?? 1) - 1, d ?? 1)
      return dt.toLocaleDateString('en-US', { weekday: 'long' })
    }
    const lines: string[] = []
    lines.push(`# Week of ${weekStart} to ${weekEnd}`, '')
    lines.push(`Daylens tracked **${formatDuration(totalTrackedSeconds)}** across ${activeDays.length} day${activeDays.length === 1 ? '' : 's'}, of which **${formatDuration(totalFocusSeconds)} (${weekFocusPct}%)** was in focused-category work (development, writing, design, research, AI tools).`, '')
    if (bestDay) {
      lines.push(`Strongest focus day was **${dayName(bestDay.date)}, ${bestDay.date}** at ${bestDay.focusPct}% focused (${formatDuration(bestDay.focusSeconds)} of ${formatDuration(bestDay.totalSeconds)} tracked).`, '')
    }
    if (longestDay && longestDay.date !== bestDay?.date) {
      lines.push(`Longest tracked day was **${dayName(longestDay.date)}, ${longestDay.date}** at ${formatDuration(longestDay.totalSeconds)}.`, '')
    }

    if (topCategories.length > 0) {
      lines.push('## Where time went (by category)', '')
      for (const { category, duration } of topCategories) {
        lines.push(`- **${category}** — ${duration}`)
      }
      lines.push('')
    }

    lines.push('## Day by day', '')
    for (const payload of activeDays) {
      const blocks = payload.blocks
        .slice()
        .sort((a, b) => (b.endTime - b.startTime) - (a.endTime - a.startTime))
        .slice(0, 4)
      lines.push(`### ${dayName(payload.date)}, ${payload.date} — ${formatDuration(payload.totalSeconds)} tracked, ${formatDuration(payload.focusSeconds)} focused (${payload.focusPct}%)`)
      if (blocks.length === 0) {
        lines.push('No clear blocks captured for this day.', '')
        continue
      }
      for (const block of blocks) {
        const seconds = blockActiveSeconds(block)
        const label = block.label.current || `${block.dominantCategory} block`
        const start = new Date(block.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
        const end = new Date(block.endTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
        const evidenceBits: string[] = []
        const artifactTitles = block.topArtifacts.slice(0, 2).map((a) => a.displayTitle).filter(Boolean)
        if (artifactTitles.length > 0) evidenceBits.push(`artifacts: ${artifactTitles.join('; ')}`)
        const apps = block.topApps.slice(0, 3).map((a) => a.appName).filter(Boolean)
        if (apps.length > 0) evidenceBits.push(`apps: ${apps.join(', ')}`)
        const tail = evidenceBits.length > 0 ? ` — ${evidenceBits.join(' | ')}` : ''
        lines.push(`- **${label}** (${start}–${end}, ${formatDuration(seconds)})${tail}`)
      }
      lines.push('')
    }

    if (topArtifacts.length > 0) {
      lines.push('## Notable artifacts referenced this week', '')
      for (const title of topArtifacts) lines.push(`- ${title}`)
      lines.push('')
    }

    lines.push('---', '', `_Generated deterministically from Daylens local timeline data. Every number above comes from the tracked blocks for ${weekStart} to ${weekEnd}; no AI synthesis was used in the body of this report._`)

    const chatLines: string[] = []
    chatLines.push(`Weekly report for ${weekStart} to ${weekEnd} attached. Headline: **${formatDuration(totalTrackedSeconds)}** tracked across ${activeDays.length} day${activeDays.length === 1 ? '' : 's'}, **${formatDuration(totalFocusSeconds)} focused (${weekFocusPct}%)** in development, writing, design, research, and AI tools.`)
    chatLines.push('')
    chatLines.push('Day by day:')
    for (const payload of activeDays) {
      const topBlock = payload.blocks.slice().sort((a, b) => (b.endTime - b.startTime) - (a.endTime - a.startTime))[0]
      const topBlockLabel = topBlock?.label.current || (topBlock ? `${topBlock.dominantCategory} block` : 'no clear blocks')
      chatLines.push(`- **${dayName(payload.date)} (${payload.date})** — ${formatDuration(payload.totalSeconds)} tracked, ${formatDuration(payload.focusSeconds)} focused (${payload.focusPct}%); longest block: ${topBlockLabel}`)
    }
    if (bestDay) {
      chatLines.push('')
      chatLines.push(`Strongest focus day was **${dayName(bestDay.date)}** at ${bestDay.focusPct}% (${formatDuration(bestDay.focusSeconds)} of ${formatDuration(bestDay.totalSeconds)} tracked).`)
    }
    chatLines.push('')
    chatLines.push('Every number above is rendered deterministically from the tracked timeline — no AI prose synthesis, so the figures match Daylens exactly. The attached report has the per-block breakdown your manager can read end to end.')

    return {
      reportMarkdown: lines.join('\n'),
      assistantResponse: chatLines.join('\n'),
    }
  }

  return {
    title: `Week review ${weekStart} to ${weekEnd}`,
    scopeLabel: `${weekStart} to ${weekEnd}`,
    renderDeterministic,
    assistantScaffold: JSON.stringify({
      range: { weekStart, weekEnd },
      totals: {
        tracked: formatDuration(totalTrackedSeconds),
        focus: formatDuration(totalFocusSeconds),
        focusPct: totalTrackedSeconds > 0 ? Math.round((totalFocusSeconds / totalTrackedSeconds) * 100) : 0,
        activeDayCount: activeDays.length,
      },
      dailyHighlights: activeDays.map((payload) => ({
        date: payload.date,
        tracked: formatDuration(payload.totalSeconds),
        focus: formatDuration(payload.focusSeconds),
        focusPct: payload.focusPct,
        topBlocks: payload.blocks.slice(0, 3).map((block) => ({
          label: block.label.current,
          duration: formatDuration(blockActiveSeconds(block)),
          artifacts: block.topArtifacts.slice(0, 3).map((artifact) => artifact.displayTitle),
        })),
      })),
      topCategories,
      namedArtifacts: topArtifacts,
    }, null, 2),
    reportMarkdownScaffold: '',
    tableColumns: ['date', 'tracked', 'focus', 'focus_pct', 'top_blocks'],
    tableRows: dayRows,
    chartRows: activeDays.map((payload) => ({
      label: payload.date.slice(5),
      value: Number((payload.totalSeconds / 3600).toFixed(1)),
      secondaryValue: Number((payload.focusSeconds / 3600).toFixed(1)),
    })),
    chartValueLabel: 'hours',
  }
}

const APP_NARRATIVE_CACHE_VERSION = 2

function appNarrativeHasStaleMetrics(summary: AISurfaceSummary | null): boolean {
  if (!summary) return false
  const text = summary.summary.toLowerCase()
  return [
    /\bi don't see strong signal\b/,
    /\bno specific (?:artifacts|pages|work blocks|paired applications)\b/,
    /\bacross\s+\d+\s+sessions?\b/,
    /\b\d+\s+sessions?\s+(?:totaling|totalling|totaled|totalled)\b/,
    /\b(?:totaling|totalling|totaled|totalled)\s+\d+\s+(?:hours?|minutes?)\b/,
    /\b\d+\s+(?:hours?|minutes?)\s+(?:across|over|in)\s+\d+\s+sessions?\b/,
    /\b\d+\s+(?:hours?|minutes?|hrs?|mins?)\b/,
  ].some((pattern) => pattern.test(text))
}

function appNarrativeSignature(detail: ReturnType<typeof getAppDetailPayload>): string {
  // B4: totals (totalSeconds, sessionCount) intentionally excluded from
  // the signature. They tick up every minute as the live session ages —
  // including them in the cache key would invalidate the narrative on
  // every render even when nothing about WHAT the user did has changed.
  // The narrative scaffold no longer contains them either; see
  // buildAppNarrativeBundle.
  return hashText(JSON.stringify({
    version: APP_NARRATIVE_CACHE_VERSION,
    canonicalAppId: detail.canonicalAppId,
    rangeKey: detail.rangeKey,
    topArtifacts: detail.topArtifacts.slice(0, 8).map((artifact) => artifact.displayTitle),
    pairedApps: detail.pairedApps.slice(0, 8).map((item) => item.displayName),
    blockAppearances: detail.blockAppearances.slice(0, 8).map((block) => `${block.blockId}:${block.label}:${block.startTime}:${block.endTime}`),
  }))
}

function buildAppNarrativeBundle(canonicalAppId: string, days = 7): ReportContextBundle | null {
  const detail = getAppDetailPayload(getDb(), canonicalAppId, days, getCurrentSession())
  if (detail.totalSeconds <= 0) return null

  // B8: drop noise-level pairings (under 60 seconds) but keep everything
  // else. The earlier 10%-of-total floor was too aggressive — for a 2h
  // Safari today it required pairings of ≥12 minutes, which filtered out
  // every legit pair and produced the self-contradicting "no paired
  // applications captured" narrative even when the rail clearly shows
  // Safari ran alongside Dia, Kiro, etc. The real fix for B8 (the model
  // inventing apps like "Codex" that aren't in the data) is the closed-set
  // prompt rule below: "Only name apps that appear in pairedApps." That
  // rule prevents fabrication without stripping real signal.
  const filteredPairedApps = detail.pairedApps.filter((item) => item.totalSeconds >= 60)

  // B3: collapse the 24-bucket per-hour distribution into the top whole-hour
  // ranges. The model previously confabulated sub-hour windows like
  // "9:00–9:46am" from the raw distribution, producing arithmetically
  // impossible prose (more session-minutes than the window contains). With
  // whole-hour buckets and an explicit rule against minute-precise windows,
  // the model can only cite ranges that exist.
  const totalHourSeconds = detail.timeOfDayDistribution.reduce((sum, entry) => sum + entry.totalSeconds, 0)
  const topHourBuckets = detail.timeOfDayDistribution
    .filter((entry) => entry.totalSeconds > 0)
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
    .slice(0, 3)
    .map((entry) => ({
      range: `${String(entry.hour).padStart(2, '0')}:00-${String((entry.hour + 1) % 24).padStart(2, '0')}:00`,
      duration: formatDuration(entry.totalSeconds),
      sharePct: totalHourSeconds > 0 ? Math.round((entry.totalSeconds / totalHourSeconds) * 100) : 0,
    }))

  return {
    title: `${detail.displayName} in the last ${days === 1 ? 'day' : `${days} days`}`,
    scopeLabel: `${detail.displayName} over ${days === 1 ? 'today' : `${days} days`}`,
    // B4: do NOT feed totalTracked / sessionCount to the narrative model.
    // The rail recomputes those live (and adds live-session minutes) while
    // the narrative is cache-keyed to a snapshot. The two drift within
    // seconds, producing "2h 19m · 64 sessions" in the header next to
    // "2 hours 18 minutes... 59 sessions" in the narrative. Totals belong
    // in the header and footer; the narrative answers "what did you do
    // here," not "how long was it open."
    assistantScaffold: JSON.stringify({
      app: {
        canonicalAppId: detail.canonicalAppId,
        displayName: detail.displayName,
      },
      topArtifacts: detail.topArtifacts.slice(0, 8).map((artifact) => ({
        title: artifact.displayTitle,
        subtitle: artifact.subtitle ?? artifact.host ?? artifact.path ?? null,
        duration: formatDuration(artifact.totalSeconds),
      })),
      pairedApps: filteredPairedApps.slice(0, 8).map((item) => ({
        displayName: item.displayName,
        duration: formatDuration(item.totalSeconds),
      })),
      blockAppearances: detail.blockAppearances.slice(0, 10).map((block) => ({
        label: block.label,
        when: `${localDateKeyForMs(block.startTime)} ${formatClock(block.startTime)}-${formatClock(block.endTime)}`,
      })),
      topHourBuckets,
    }, null, 2),
    reportMarkdownScaffold: '',
    tableColumns: ['block_label', 'when', 'category'],
    tableRows: detail.blockAppearances.slice(0, 12).map((block) => ({
      block_label: block.label,
      when: `${localDateKeyForMs(block.startTime)} ${formatClock(block.startTime)}-${formatClock(block.endTime)}`,
      category: block.dominantCategory,
    })),
    chartRows: detail.timeOfDayDistribution
      .filter((entry) => entry.totalSeconds > 0)
      .map((entry) => ({
        label: `${String(entry.hour).padStart(2, '0')}:00`,
        value: Number((entry.totalSeconds / 3600).toFixed(1)),
      })),
    chartValueLabel: 'hours',
  }
}

function buildDayReportContentLens(
  payload: DayTimelinePayload,
  dayAttribution: ReturnType<typeof resolveDayContext>,
): Record<string, unknown> {
  const categorySeconds = new Map<string, number>()
  const appSeconds = new Map<string, number>()
  const artifactTitles = new Set<string>()
  const pageTitles = new Set<string>()
  const workflows = new Set<string>()
  const clientSeconds = new Map<string, number>()
  const projectSeconds = new Map<string, number>()

  for (const block of payload.blocks) {
    const durationSeconds = blockDurationSeconds(block)
    categorySeconds.set(block.dominantCategory, (categorySeconds.get(block.dominantCategory) ?? 0) + durationSeconds)
    for (const app of block.topApps.slice(0, 5)) {
      appSeconds.set(app.appName, (appSeconds.get(app.appName) ?? 0) + app.totalSeconds)
    }
    for (const artifact of block.topArtifacts.slice(0, 4)) artifactTitles.add(artifact.displayTitle)
    for (const page of block.pageRefs.slice(0, 4)) {
      const title = page.pageTitle ?? page.displayTitle
      if (title) pageTitles.add(title)
    }
    for (const workflow of block.workflowRefs.slice(0, 3)) workflows.add(workflow.label)
  }

  for (const session of dayAttribution.sessions) {
    if (session.client?.name) {
      clientSeconds.set(session.client.name, (clientSeconds.get(session.client.name) ?? 0) + Math.round(session.active_ms / 1000))
    }
    if (session.project?.name) {
      projectSeconds.set(session.project.name, (projectSeconds.get(session.project.name) ?? 0) + Math.round(session.active_ms / 1000))
    }
  }

  const ranked = (map: Map<string, number>, limit: number) => [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([name, seconds]) => ({ name, duration: formatDuration(seconds) }))

  const topCategories = ranked(categorySeconds, 4)
  const hasNamedAttribution = clientSeconds.size > 0 || projectSeconds.size > 0
  const primaryCategory = topCategories[0]?.name ?? null
  const dayShape = hasNamedAttribution
    ? 'client_or_project_delivery'
    : primaryCategory === 'development'
      ? 'development_or_technical_work'
      : primaryCategory === 'writing'
        ? 'writing_or_document_work'
        : primaryCategory === 'communication'
          ? 'communication_or_coordination'
          : primaryCategory === 'research'
            ? 'research_or_learning'
            : 'mixed_work'

  return {
    dayShape,
    instruction:
      'Use this as a temporary lens for this report only. Do not store or imply a permanent user role from one day.',
    topCategories,
    topApps: ranked(appSeconds, 6),
    namedClients: ranked(clientSeconds, 6),
    namedProjects: ranked(projectSeconds, 6),
    namedArtifacts: [...artifactTitles].slice(0, 10),
    namedPages: [...pageTitles].slice(0, 10),
    workflows: [...workflows].slice(0, 8),
    confidenceNotes: [
      hasNamedAttribution
        ? 'Named client/project sections may be emphasized because structured attribution exists for today.'
        : 'No strong structured client/project attribution exists for today; avoid consultant-specific framing unless the block evidence itself supports it.',
      'If the day looks mixed, write the report around the content shifts instead of forcing one role.',
    ],
  }
}

function buildDayReportBundle(dateStr: string): ReportContextBundle | null {
  const liveSession = dateStr === currentLocalDateString() ? getCurrentSession() : null
  const payload = getTimelineDayPayload(getDb(), dateStr, liveSession)
  if (payload.totalSeconds <= 0) return null
  const settings = getSettings()
  const personalizationEnabled = settings.aiReportPersonalizationEnabled === true
  const dayAttribution = resolveDayContext(dateStr, getDb())
  const contentLens = buildDayReportContentLens(payload, dayAttribution)

  const categoryRows = Array.from(payload.blocks.reduce<Map<string, number>>((map, block) => {
    const durationSeconds = blockActiveSeconds(block)
    map.set(block.dominantCategory, (map.get(block.dominantCategory) ?? 0) + durationSeconds)
    return map
  }, new Map()).entries())
    .sort((left, right) => right[1] - left[1])

  return {
    title: `Day report ${dateStr}`,
    scopeLabel: dateStr,
    assistantScaffold: [
      buildDaySummaryScaffold(payload),
      '',
      'Day report lens (JSON):',
      JSON.stringify({
        personalization: {
          enabled: personalizationEnabled,
          rule: personalizationEnabled
            ? 'Use profile signals only as light emphasis after the evidence; never override what the day actually contains.'
            : 'Personalization is off. Do not infer a durable user role or identity; adapt only to today\'s content.',
        },
        contentLens,
        attribution: {
          summary: dayAttribution.day_summary,
          namedSessions: dayAttribution.sessions.slice(0, 12).map((session) => ({
            start: session.start,
            end: session.end,
            active_ms: session.active_ms,
            client: session.client?.name ?? null,
            project: session.project?.name ?? null,
            confidence: session.confidence,
            apps: session.apps.slice(0, 4).map((app) => app.app_name),
            evidence: session.evidence.slice(0, 4).map((item) => item.value),
          })),
          ambiguousSegments: dayAttribution.ambiguous_segments.slice(0, 6),
        },
      }, null, 2),
    ].join('\n'),
    reportMarkdownScaffold: '',
    tableColumns: ['start', 'end', 'block', 'category', 'apps', 'artifacts', 'duration'],
    tableRows: payload.blocks.slice(0, 16).map((block) => ({
      start: formatClock(block.startTime),
      end: formatClock(block.endTime),
      block: block.label.current,
      category: block.dominantCategory,
      apps: block.topApps.slice(0, 3).map((app) => app.appName).join(' | ') || 'n/a',
      artifacts: block.topArtifacts.slice(0, 3).map((artifact) => artifact.displayTitle).join(' | ') || 'n/a',
      duration: formatDuration(blockActiveSeconds(block)),
    })),
    chartRows: categoryRows.slice(0, 8).map(([category, seconds]) => ({
      label: category,
      value: Number((seconds / 3600).toFixed(1)),
    })),
    chartValueLabel: 'hours',
  }
}

async function generateWeekReview(weekStartStr: string): Promise<AISurfaceSummary | null> {
  const bundle = buildWeekReviewBundle(weekStartStr)
  if (!bundle) return null

  const scopeKey = `week:${weekStartStr}`
  const inputSignature = hashText(bundle.assistantScaffold)
  const existingSignature = getAISurfaceSummarySignature(getDb(), 'timeline_week', scopeKey)
  if (existingSignature === inputSignature) {
    return getAISurfaceSummary(getDb(), 'timeline_week', scopeKey)
  }

  const fallback = getAISurfaceSummary(getDb(), 'timeline_week', scopeKey, { stale: true })
  const systemPrompt = [
    VOICE_SYSTEM_PROMPT,
    'You are Daylens, writing the short week-review card for the Timeline week view.',
    'Do not use emoji in any part of your response.',
    USER_VISIBLE_ACTIVITY_PROSE_RULE,
    'Use only the deterministic local evidence provided.',
    'Focus on the actual work threads, named artifacts, and where the week concentrated.',
    'Avoid dashboard filler or generic productivity language.',
    'Return strict JSON with keys "title" and "summary".',
    '"summary" must be 2-4 sentences and grounded in the evidence.',
  ].join(' ')
  const userMessage = [
    `Write a concise week review for ${bundle.scopeLabel}.`,
    '',
    'Structured week evidence (JSON):',
    bundle.assistantScaffold,
  ].join('\n')

  try {
    const { text } = await executeTextAIJob(
      {
        jobType: 'week_review',
        screen: 'timeline_week',
        triggerSource: 'system',
        systemPrompt,
        userMessage,
      },
      sendWithProvider,
    )
    const parsed = parseSurfaceSummaryResult(text, bundle.title)
    if (!parsed) return fallback
    const stored = upsertAISurfaceSummary(getDb(), {
      scopeType: 'timeline_week',
      scopeKey,
      jobType: 'week_review',
      inputSignature,
      title: parsed.title,
      summary: parsed.summary,
    })
    invalidateProjectionScope('timeline', 'ai:week_review')
    return stored
  } catch (error) {
    console.warn(`[ai] week_review failed for ${scopeKey}:`, error)
    return fallback
  }
}

async function generateAppNarrative(
  canonicalAppId: string,
  days = 7,
): Promise<AISurfaceSummary | null> {
  const bundle = buildAppNarrativeBundle(canonicalAppId, days)
  if (!bundle) return null

  const detail = getAppDetailPayload(getDb(), canonicalAppId, days, getCurrentSession())
  const scopeKey = `app:${detail.canonicalAppId}:${detail.rangeKey}`
  const inputSignature = appNarrativeSignature(detail)
  const existingSignature = getAISurfaceSummarySignature(getDb(), 'app_detail', scopeKey)
  if (existingSignature === inputSignature) {
    const existing = getAISurfaceSummary(getDb(), 'app_detail', scopeKey)
    if (!appNarrativeHasStaleMetrics(existing)) return existing
  }

  const cachedFallback = getAISurfaceSummary(getDb(), 'app_detail', scopeKey, { stale: true })
  const fallback = appNarrativeHasStaleMetrics(cachedFallback) ? null : cachedFallback
  const systemPrompt = [
    VOICE_SYSTEM_PROMPT,
    'You are Daylens, writing the short narrative card for an app detail view.',
    'Do not use emoji in any part of your response.',
    USER_VISIBLE_ACTIVITY_PROSE_RULE,
    'Explain what this tool was helping with, which artifacts or contexts appeared there, and what it tended to pair with.',
    'Use only the deterministic evidence below.',
    'Do not write vanity metrics or generic app summaries.',
    // Citation floor: the summary must name at least two concrete entities
    // from the structured evidence (block labels, artifacts, pages,
    // domains, or paired apps). Evidence-thin apps must say so plainly —
    // a filler sentence like "used for development work" is not acceptable.
    'The "summary" field must cite at least two concrete entities from the evidence: block labels, artifact titles, page/domain names, or paired app names. If the evidence is too thin to cite two entities, say "Daylens has only thin app-specific signal for this app." and stop — do not pad with generic prose.',
    // B4: totals are rendered in the UI header and footer. The narrative
    // must not restate them — the header recomputes live and the cached
    // narrative drifts within seconds. Talk about what was done, not how
    // long it took.
    'Do not state total time, session count, or "across N sessions" / "totaling Xh Ym" framings. Those numbers live in the UI; the narrative says what was done in the app.',
    // B8: paired-app fabrication. The Warp narrative recently named "Codex"
    // as a primary pair even though Codex was absent from the rail and the
    // structured evidence. Treat `pairedApps` as the closed set of allowed
    // names — no inference, no synonyms, no inventing.
    'Only name apps that appear in `pairedApps`. Do not invent app names, infer related tools, or substitute synonyms. If `pairedApps` is empty or has only one entry, do not write a "paired with" sentence at all.',
    // B3: minute-precise window confabulation. The model previously wrote
    // "concentrated in the 9:00–9:46am window" — arithmetic that cannot fit
    // the total minutes claimed. `topHourBuckets` holds the only ranges
    // allowed to appear in prose, expressed as whole-hour spans.
    'When citing a time window, you may only use ranges from `topHourBuckets` (whole-hour spans like "9:00-10:00"). Never invent sub-hour minute boundaries such as "9:00-9:46". If activity spans many hours with no single concentration, say it spans the morning/afternoon/evening rather than citing a fake narrow window.',
    'Return strict JSON with keys "title" and "summary".',
    '"summary" must be 2-4 sentences.',
  ].join(' ')
  const userMessage = [
    `Write an app narrative for ${bundle.scopeLabel}.`,
    '',
    'Structured app evidence (JSON):',
    bundle.assistantScaffold,
  ].join('\n')

  try {
    const { text } = await executeTextAIJob(
      {
        jobType: 'app_narrative',
        screen: 'app_detail',
        triggerSource: 'system',
        systemPrompt,
        userMessage,
      },
      sendWithProvider,
    )
    const parsed = parseSurfaceSummaryResult(text, bundle.title)
    if (!parsed) return fallback
    const stored = upsertAISurfaceSummary(getDb(), {
      scopeType: 'app_detail',
      scopeKey,
      jobType: 'app_narrative',
      inputSignature,
      title: parsed.title,
      summary: parsed.summary,
    })
    invalidateProjectionScope('apps', 'ai:app_narrative', {
      canonicalAppId,
    })
    return stored
  } catch (error) {
    console.warn(`[ai] app_narrative failed for ${scopeKey}:`, error)
    return fallback
  }
}

function buildClientReportBundle(
  clientId: string,
  range: { fromMs: number; toMs: number; label: string },
  question: string,
): ReportContextBundle | null {
  const payload = resolveClientQuery(clientId, range.fromMs, range.toMs, question, getDb())
  if (!payload || payload.sessions.length === 0) return null

  const dailyTotals = new Map<string, { attributedMs: number; ambiguousMs: number }>()
  for (const session of payload.sessions) {
    const key = localDateKeyForMs(new Date(session.start).getTime())
    const existing = dailyTotals.get(key) ?? { attributedMs: 0, ambiguousMs: 0 }
    if (session.attribution_status === 'attributed') existing.attributedMs += session.active_ms
    else if (session.attribution_status === 'ambiguous') existing.ambiguousMs += session.active_ms
    dailyTotals.set(key, existing)
  }

  return {
    title: `${payload.target.client_name} ${range.label} report`,
    scopeLabel: `${payload.target.client_name} in ${range.label}`,
    assistantScaffold: JSON.stringify({
      target: payload.target,
      range: payload.range,
      totals: payload.totals,
      sessions: payload.sessions.slice(0, 16).map((session) => ({
        start: session.start,
        end: session.end,
        active_ms: session.active_ms,
        title: session.title,
        project_name: session.project_name,
        attribution_status: session.attribution_status,
        confidence: session.confidence,
        apps: session.apps.slice(0, 4).map((app) => app.app_name),
        evidence: session.evidence.slice(0, 4).map((item) => item.value),
      })),
      ambiguities: payload.ambiguities.slice(0, 8),
    }, null, 2),
    reportMarkdownScaffold: '',
    tableColumns: ['date', 'start', 'end', 'title', 'project', 'status', 'apps', 'active_hours', 'confidence'],
    tableRows: payload.sessions.slice(0, 32).map((session) => ({
      date: localDateKeyForMs(new Date(session.start).getTime()),
      start: formatClock(new Date(session.start).getTime()),
      end: formatClock(new Date(session.end).getTime()),
      title: session.title?.trim() || session.project_name || payload.target.client_name,
      project: session.project_name ?? '',
      status: session.attribution_status,
      apps: session.apps.slice(0, 4).map((app) => app.app_name).join(' | ') || 'n/a',
      active_hours: Number((session.active_ms / 3_600_000).toFixed(2)),
      confidence: session.confidence == null ? '' : Math.round(session.confidence * 100),
    })),
    chartRows: [...dailyTotals.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([date, totals]) => ({
        label: date.slice(5),
        value: Number((totals.attributedMs / 3_600_000).toFixed(1)),
        secondaryValue: Number((totals.ambiguousMs / 3_600_000).toFixed(1)),
      })),
    chartValueLabel: 'hours',
  }
}

function buildProjectReportBundle(
  projectId: string,
  range: { fromMs: number; toMs: number; label: string },
  question: string,
): ReportContextBundle | null {
  const payload = resolveProjectQuery(projectId, range.fromMs, range.toMs, question, getDb())
  if (!payload || payload.sessions.length === 0) return null

  const dailyTotals = new Map<string, { attributedMs: number; ambiguousMs: number }>()
  for (const session of payload.sessions) {
    const key = localDateKeyForMs(new Date(session.start).getTime())
    const existing = dailyTotals.get(key) ?? { attributedMs: 0, ambiguousMs: 0 }
    if (session.attribution_status === 'attributed') existing.attributedMs += session.active_ms
    else if (session.attribution_status === 'ambiguous') existing.ambiguousMs += session.active_ms
    dailyTotals.set(key, existing)
  }

  return {
    title: `${payload.target.project_name} ${range.label} report`,
    scopeLabel: `${payload.target.project_name} in ${range.label}`,
    assistantScaffold: JSON.stringify({
      target: payload.target,
      range: payload.range,
      totals: payload.totals,
      sessions: payload.sessions.slice(0, 16).map((session) => ({
        start: session.start,
        end: session.end,
        active_ms: session.active_ms,
        title: session.title,
        attribution_status: session.attribution_status,
        confidence: session.confidence,
        apps: session.apps.slice(0, 4).map((app) => app.app_name),
        evidence: session.evidence.slice(0, 4).map((item) => item.value),
      })),
    }, null, 2),
    reportMarkdownScaffold: '',
    tableColumns: ['date', 'start', 'end', 'title', 'client', 'status', 'apps', 'active_hours', 'confidence'],
    tableRows: payload.sessions.slice(0, 32).map((session) => ({
      date: localDateKeyForMs(new Date(session.start).getTime()),
      start: formatClock(new Date(session.start).getTime()),
      end: formatClock(new Date(session.end).getTime()),
      title: session.title?.trim() || payload.target.project_name,
      client: payload.target.client_name,
      status: session.attribution_status,
      apps: session.apps.slice(0, 4).map((app) => app.app_name).join(' | ') || 'n/a',
      active_hours: Number((session.active_ms / 3_600_000).toFixed(2)),
      confidence: session.confidence == null ? '' : Math.round(session.confidence * 100),
    })),
    chartRows: [...dailyTotals.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([date, totals]) => ({
        label: date.slice(5),
        value: Number((totals.attributedMs / 3_600_000).toFixed(1)),
        secondaryValue: Number((totals.ambiguousMs / 3_600_000).toFixed(1)),
      })),
    chartValueLabel: 'hours',
  }
}

function detectDirectEntityForOutput(question: string): DirectReportEntity | null {
  const normalized = question.toLowerCase()
  const explicit = question.match(/\b(?:for|on|about)\s+['"]?([A-Za-z][\w\s&.-]{1,40})['"]?(?:\s+(?:this|last|today|yesterday)|\s+as\b|\s+into\b|[?.!,]|$)/i)
  if (explicit?.[1]) {
    const project = findProjectByName(explicit[1].trim(), getDb())
    if (project) return { entityType: 'project', id: project.id, name: project.name }
    const client = findClientByName(explicit[1].trim(), getDb())
    if (client) return { entityType: 'client', id: client.id, name: client.name }
  }

  for (const project of listProjects(getDb())) {
    const escaped = project.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped.toLowerCase()}\\b`, 'i').test(normalized)) {
      return { entityType: 'project', id: project.id, name: project.name }
    }
  }

  for (const client of listClients(getDb())) {
    const escaped = client.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped.toLowerCase()}\\b`, 'i').test(normalized)) {
      return { entityType: 'client', id: client.id, name: client.name }
    }
  }

  return null
}

function resolveOutputRange(
  question: string,
  restoredState: AIConversationState | null,
  previousContext: TemporalContext | null,
): { fromMs: number; toMs: number; label: string } {
  const explicit = inferDateRangeFromQuestion(question, restoredState?.dateRange ?? null)
  if (previousContext?.entity) {
    return explicit ?? {
      fromMs: previousContext.entity.rangeStartMs,
      toMs: previousContext.entity.rangeEndMs,
      label: previousContext.entity.rangeLabel,
    }
  }
  if (previousContext?.weeklyBrief) {
    const weeklyRange = previousContext.weeklyBrief.dateRange
    return explicit ?? {
      fromMs: weeklyRange.fromMs,
      toMs: weeklyRange.toMs,
      label: weeklyRange.label,
    }
  }
  if (explicit) {
    return {
      fromMs: explicit.fromMs,
      toMs: explicit.toMs,
      label: explicit.label,
    }
  }

  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return {
    fromMs: start.getTime(),
    toMs: end.getTime(),
    label: 'today',
  }
}

async function maybeGenerateRequestedOutput(params: {
  question: string
  restoredState: AIConversationState | null
  previousContext: TemporalContext | null
  routedContext: TemporalContext | null
  routedAnswer?: string | null
  prior: ConversationMessage[]
}): Promise<AnswerEnvelope | null> {
  const outputKinds = detectRequestedOutputKinds(params.question)
  if (outputKinds.length === 0) return null

  const range = resolveOutputRange(params.question, params.restoredState, params.previousContext)
  const directEntity: DirectReportEntity | null = params.routedContext?.entity
    && (params.routedContext.entity.entityType === 'client' || params.routedContext.entity.entityType === 'project')
    ? {
      entityType: params.routedContext.entity.entityType,
      id: params.routedContext.entity.entityId,
      name: params.routedContext.entity.entityName,
    }
    : params.previousContext?.entity
      && (params.previousContext.entity.entityType === 'client' || params.previousContext.entity.entityType === 'project')
      ? {
        entityType: params.previousContext.entity.entityType,
        id: params.previousContext.entity.entityId,
        name: params.previousContext.entity.entityName,
      }
      : detectDirectEntityForOutput(params.question)

  const bundle = directEntity?.entityType === 'client'
    ? buildClientReportBundle(directEntity.id, range, params.question)
    : directEntity?.entityType === 'project'
      ? buildProjectReportBundle(directEntity.id, range, params.question)
      : (range.label.includes('week') || params.previousContext?.weeklyBrief || params.routedContext?.weeklyBrief)
        ? buildWeekReviewBundle(localDateKeyForMs(range.fromMs))
        : buildDayReportBundle(localDateKeyForMs(range.fromMs))

  if (!bundle) return null

  const outputKindsLabel = outputKinds.join(', ')
  const systemPrompt = [
    VOICE_SYSTEM_PROMPT,
    'You are Daylens, generating shareable work-history outputs from deterministic local evidence.',
    'Do not use emoji in any part of your response.',
    USER_VISIBLE_ACTIVITY_PROSE_RULE,
    'Use only the facts in the scaffold below.',
    'Return strict JSON with keys "assistantResponse", "reportTitle", and "reportMarkdown".',
    '"assistantResponse" should be 1-3 short paragraphs for the in-app chat card.',
    '"reportMarkdown" should read like a thoughtful human reviewed the day with care: specific, calm, useful, and grounded.',
    'Write in second person. Avoid motivational fluff, vanity-dashboard language, and generic productivity claims.',
    'Lead with what the day was actually about, then support that read with concrete apps, blocks, artifacts, pages, clients, or projects from the scaffold.',
    'Treat any day-shape or profile hint as a temporary lens for this report only. Content comes first; do not imply a permanent user role.',
    'If structured client or project attribution exists, surface it naturally. If it does not, do not force consultant framing.',
    'Use "looks like" or "suggests" where the evidence is interpretive or attribution is weak.',
    'If tables or charts are requested, assume CSV and HTML companion files will be generated from the deterministic rows provided.',
    'Do not invent extra files, numbers, titles, artifacts, or projects beyond the scaffold.',
  ].join(' ')
  const userMessage = [
    `Original request: ${params.question}`,
    `Requested outputs: ${outputKindsLabel}`,
    params.routedAnswer?.trim() ? `Existing deterministic answer: ${params.routedAnswer.trim()}` : '',
    '',
    'Structured export scaffold (JSON):',
    bundle.assistantScaffold,
  ].filter(Boolean).join('\n')

  let reportContent = fallbackGeneratedReportContent(bundle)
  const trace = getCurrentTrace()
  const deterministic = bundle.renderDeterministic?.()
  if (deterministic) {
    // Bundles that ship a deterministic renderer (e.g. weekly review)
    // skip the LLM entirely — the body is templated from structured data,
    // so there's no fabrication surface. The LLM was producing fluent
    // hallucinations across day rows (Tuesday focus % swap, made-up
    // artifact names) even with "use only the scaffold" prompting.
    reportContent = {
      assistantResponse: deterministic.assistantResponse,
      reportTitle: bundle.title,
      reportMarkdown: deterministic.reportMarkdown,
    }
    if (trace) {
      trace.addEvent({
        kind: 'prose_pass',
        input: `[deterministic_report_template ${bundle.title}]\nscaffold:\n${bundle.assistantScaffold}`,
        output: deterministic.reportMarkdown,
      })
    }
  } else {
    try {
      if (trace) {
        trace.addEvent({
          kind: 'prose_pass',
          input: `[report_generation_input]\nsystem:\n${systemPrompt}\n\nuser:\n${userMessage}`,
          output: '(pending)',
        })
      }
      const { text } = await withTimeout(
        executeTextAIJob(
          {
            jobType: 'report_generation',
            screen: 'ai_chat',
            triggerSource: 'user',
            systemPrompt,
            userMessage,
            prior: params.prior,
          },
          sendWithProvider,
        ),
        60_000,
        'Report generation timed out',
      )
      if (trace) {
        trace.addEvent({
          kind: 'prose_pass',
          input: '[report_generation_raw_output]',
          output: text,
        })
      }
      reportContent = parseGeneratedReportResult(text, bundle.title) ?? reportContent
    } catch (error) {
      console.warn('[ai] report_generation fell back to deterministic export:', error)
      if (trace) {
        trace.addEvent({ kind: 'error', message: error instanceof Error ? error.message : String(error), phase: 'report_generation' })
      }
    }
  }

  const artifactSpecs: ReportArtifactSpec[] = [
    {
      kind: 'report',
      title: 'shareable-report',
      format: 'markdown',
      extension: 'md',
      subtitle: bundle.scopeLabel,
      contents: [
        `# ${reportContent.reportTitle}`,
        '',
        reportContent.reportMarkdown.trim(),
        '',
        `Generated by Daylens for ${bundle.scopeLabel}.`,
      ].join('\n'),
    },
  ]

  if ((outputKinds.includes('table') || outputKinds.includes('export')) && bundle.tableRows.length > 0) {
    artifactSpecs.push({
      kind: 'table',
      title: 'table-export',
      format: 'csv',
      extension: 'csv',
      subtitle: `${bundle.scopeLabel} table`,
      contents: buildCsvContent(bundle.tableColumns, bundle.tableRows),
    })
  }

  if ((outputKinds.includes('chart') || outputKinds.includes('export')) && bundle.chartRows.length > 0) {
    artifactSpecs.push({
      kind: 'chart',
      title: 'chart-export',
      format: 'html',
      extension: 'html',
      subtitle: `${bundle.scopeLabel} chart`,
      contents: buildBarChartHtml(
        reportContent.reportTitle,
        `Generated from Daylens local evidence for ${bundle.scopeLabel}.`,
        bundle.chartValueLabel,
        bundle.chartRows,
      ),
    })
  }

  const artifacts = await writeGeneratedArtifacts(reportContent.reportTitle, artifactSpecs)
  const resolvedTemporalContext = params.routedContext
    ?? params.previousContext
    ?? {
      date: new Date(range.fromMs),
      timeWindow: null,
      weeklyBrief: null,
      entity: null,
    }

  const conversationState = buildConversationState(
    'generated_report',
    'freeform',
    resolvedTemporalContext,
    inferFollowUpAffordances('generated_report'),
    {
      dateRange: {
        fromMs: range.fromMs,
        toMs: range.toMs,
        label: range.label,
      },
      lastIntent: params.restoredState?.lastIntent ?? null,
      topic: params.restoredState?.topic ?? null,
      responseMode: params.restoredState?.responseMode ?? null,
      evidenceKey: params.restoredState?.evidenceKey ?? null,
    },
  )
  const suggestedFollowUps = await generateSuggestedFollowUps(
    params.question,
    reportContent.assistantResponse,
    'generated_report',
    conversationState,
  )

  return {
    assistantText: reportContent.assistantResponse,
    answerKind: 'generated_report',
    sourceKind: 'freeform',
    resolvedTemporalContext,
    conversationState,
    suggestedFollowUps,
    artifacts,
  }
}

function weeklyBriefPrompts(
  userMessage: string,
  briefContext: WeeklyBriefContext,
  pack: WeeklyBriefEvidencePack,
): { systemPrompt: string; userPrompt: string } {
  const modeInstruction = briefContext.responseMode === 'literal'
    ? 'Lead with the named items themselves. A compact numbered list is allowed here if it makes the answer clearer.'
    : briefContext.responseMode === 'deepen'
      ? 'Assume this is a follow-up. Keep the same week and topic, but deepen the synthesis and relationships between the themes.'
      : briefContext.responseMode === 'reading'
        ? 'Lead with the clearest named pages, videos, docs, and artifacts. Interpretation is secondary.'
        : 'Lead with the story of the week, then support it with named evidence.'

  const systemPrompt = [
    VOICE_SYSTEM_PROMPT,
    'You are Daylens.',
    'Do not use emoji in any part of your response.',
    USER_VISIBLE_ACTIVITY_PROSE_RULE,
    'You turn a deterministic weekly browsing evidence pack into a natural editorial briefing.',
    'The evidence selection is already done for you. Your job is writing, not retrieval.',
    'Use only the facts in the scaffold below. Do not invent pages, repos, docs, files, videos, or claims of certainty.',
    'Open with the main idea of the week.',
    'Group the answer into 2-4 short paragraphs or, for literal reading requests, a compact list plus one short caveat.',
    'Mention exact titles when available.',
    'Distinguish named evidence from ambient or generic browser usage.',
    'Use language like "looks like" or "suggests" when interpreting patterns.',
    'Never fall back to dashboard language like top apps, top sites, or distraction time unless the user explicitly asked for stats.',
    'Never say you only have domains if the scaffold includes named pages or artifacts.',
    modeInstruction,
  ].join(' ')

  const userPrompt = [
    `User question: ${userMessage}`,
    '',
    'Structured weekly brief scaffold (JSON):',
    buildWeeklyBriefScaffold(briefContext, pack),
    '',
    'Write the final answer now.',
  ].join('\n')

  return { systemPrompt, userPrompt }
}

function answerKindForWeeklyContext(context: WeeklyBriefContext): AIAnswerKind {
  return context.responseMode === 'literal' ? 'weekly_literal_list' : 'weekly_brief'
}

function parseWorkBlockInsight(raw: string): WorkContextInsight | null {
  const candidate = escapeJsonBlock(raw)
  try {
    const parsed = JSON.parse(candidate) as { label?: unknown; narrative?: unknown }
    return {
      label: typeof parsed.label === 'string' ? parsed.label.trim() : null,
      narrative: typeof parsed.narrative === 'string' ? parsed.narrative.trim() : null,
    }
  } catch {
    const labelMatch = candidate.match(/label\s*:\s*(.+)/i)
    const narrativeMatch = candidate.match(/narrative\s*:\s*([\s\S]+)/i)
    if (!labelMatch && !narrativeMatch) return null
    return {
      label: labelMatch?.[1]?.trim() ?? null,
      narrative: narrativeMatch?.[1]?.trim() ?? null,
    }
  }
}

function workBlockPrompt(block: WorkContextBlock): string {
  const durationMinutes = Math.max(1, Math.round(blockActiveSeconds(block) / 60))

  // Top websites with duration — highest-signal evidence (browser/AI work)
  const websiteLines = block.websites.slice(0, 5).map((site) => {
    const dur = formatDuration(site.totalSeconds)
    const title = site.topTitle ? ` (${site.topTitle.slice(0, 60)})` : ''
    return `  ${site.domain}${title} — ${dur}`
  })

  // Native window titles (non-browser) — document/file context
  const pages = block.keyPages.filter(Boolean).slice(0, 5)

  // Top apps with duration and category
  const appLines = block.topApps.slice(0, 5).map((app) => {
    return `  ${app.appName} (${app.category}) — ${formatDuration(app.totalSeconds)}`
  })

  // Category time breakdown
  const catLines = (Object.entries(block.categoryDistribution) as Array<[string, number]>)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([cat, sec]) => `  ${cat}: ${formatDuration(sec)}`)

  const switchNote = block.switchCount >= 5
    ? `App transitions observed: ${block.switchCount}.`
    : block.switchCount >= 2
      ? `App transitions observed: ${block.switchCount}.`
      : ''

  const lines = [
    'Analyze this Daylens work block.',
    'Return strict JSON: {"label":"...","narrative":"..."}',
    'label: 2-5 word activity description. NEVER return a raw app name, browser name, or bare category name ("Chrome", "Safari", "Cursor", "Warp", "Browsing", "Development").',
    'narrative: 1-2 plain sentences. Evidence-led, no hype, no "the user" prefix.',
    'Priority rules:',
    '  - Window titles and page titles > artifact names > category descriptions > app names only as last-resort context, never as the label.',
    '  - Browser+AI only ≠ Development → call it Research or Planning.',
    '  - Do NOT return "Building & Testing" without a code editor or terminal in the evidence.',
    '',
    `Duration: ${durationMinutes} minutes`,
    `Dominant category: ${block.dominantCategory}`,
    switchNote,
    '',
    websiteLines.length > 0 ? `Website evidence (highest priority):\n${websiteLines.join('\n')}` : 'Websites: none',
    pages.length > 0 ? `Window titles:\n${pages.map((p) => `  ${p}`).join('\n')}` : 'Window titles: none',
    appLines.length > 0 ? `Apps used:\n${appLines.join('\n')}` : 'Apps: none',
    catLines.length > 0 ? `Category breakdown:\n${catLines.join('\n')}` : '',
    `Rule-based label (override this if evidence supports better): ${userVisibleLabelForBlock(block)}`,
  ].filter(Boolean)

  return lines.join('\n')
}

function parseSuggestedCategory(raw: string): AppCategorySuggestion | null {
  const candidate = escapeJsonBlock(raw)
  try {
    const parsed = JSON.parse(candidate) as { category?: unknown; reason?: unknown }
    const category = typeof parsed.category === 'string' ? parsed.category.trim() : null
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : null
    return {
      suggestedCategory: isAppCategory(category) ? category : null,
      reason,
    }
  } catch {
    const normalized = candidate.trim().toLowerCase()
    if (isAppCategory(normalized)) {
      return { suggestedCategory: normalized, reason: null }
    }
    return null
  }
}

function isAppCategory(value: string | null): value is import('@shared/types').AppCategory {
  return value !== null && [
    'development',
    'communication',
    'research',
    'writing',
    'aiTools',
    'design',
    'browsing',
    'meetings',
    'entertainment',
    'email',
    'productivity',
    'social',
    'system',
    'uncategorized',
  ].includes(value)
}

function appCategorySuggestionPrompt(bundleId: string, appName: string): string {
  return [
    'Classify this app into one Daylens category.',
    'Return strict JSON: {"category":"...","reason":"..."}',
    'Allowed categories: development, communication, research, writing, aiTools, design, browsing, meetings, entertainment, email, productivity, social, system, uncategorized',
    'Use uncategorized only if the app identity is genuinely ambiguous.',
    `Bundle or executable: ${bundleId || 'Unknown'}`,
    `App name: ${appName || 'Unknown'}`,
  ].join('\n')
}

// Cache AI category suggestions to avoid re-sending identical classification requests.
// Keyed by "bundleId::appName" (lowercased). Survives for the lifetime of the process.
const _categorySuggestionCache = new Map<string, AppCategorySuggestion>()

export async function suggestAppCategory(bundleId: string, appName: string): Promise<AppCategorySuggestion> {
  const cacheKey = `${bundleId}::${appName}`.toLowerCase()
  const cached = _categorySuggestionCache.get(cacheKey)
  if (cached) return cached

  const systemPrompt = [
    VOICE_SYSTEM_PROMPT,
    'You are Daylens.',
    'You classify productivity apps conservatively.',
    'Prefer email for mail clients, communication for chat clients, browsing only for real web browsers.',
    'Return only valid JSON.',
  ].join(' ')

  try {
    const { text } = await executeTextAIJob(
      {
        jobType: 'attribution_assist',
        screen: 'background',
        triggerSource: 'system',
        systemPrompt,
        userMessage: appCategorySuggestionPrompt(bundleId, appName),
      },
      sendWithProvider,
    )
    const parsed = parseSuggestedCategory(text)
    if (parsed?.suggestedCategory) {
      _categorySuggestionCache.set(cacheKey, parsed)
      return parsed
    }
  } catch {
    // Fall through to no-suggestion result.
  }

  const noSuggestion: AppCategorySuggestion = { suggestedCategory: null, reason: null }
  _categorySuggestionCache.set(cacheKey, noSuggestion)
  return noSuggestion
}

export async function generateWorkBlockInsight(
  block: WorkContextBlock,
  options?: { jobType?: 'block_label_preview' | 'block_label_finalize' | 'block_cleanup_relabel'; triggerSource?: 'system' | 'background' },
): Promise<WorkContextInsight> {
  const systemPrompt = [
    VOICE_SYSTEM_PROMPT,
    'You are Daylens.',
    'You label productivity timeline blocks from local activity evidence.',
    'Do not use emoji in any part of your response.',
    'Be concrete, restrained, and evidence-led.',
    'Never mention the model provider.',
    'If the evidence is weak, keep the label generic but still useful.',
    'Return only valid JSON.',
  ].join(' ')

  try {
    const { text } = await withTimeout(
      executeTextAIJob(
        {
          jobType: options?.jobType ?? (block.isLive ? 'block_label_preview' : 'block_label_finalize'),
          screen: 'timeline_day',
          triggerSource: options?.triggerSource ?? (block.isLive ? 'system' : 'background'),
          systemPrompt,
          userMessage: workBlockPrompt(block),
        },
        sendWithProvider,
      ),
      BLOCK_INSIGHT_TIMEOUT_MS,
      'Block insight timed out',
    )
    const parsed = parseWorkBlockInsight(text)

    const insight = {
      label: parsed?.label || userVisibleLabelForBlock(block),
      narrative: parsed?.narrative || fallbackNarrativeForBlock(block),
    }
    if (!block.isLive) {
      upsertWorkContextInsight(getDb(), {
        startMs: block.startTime,
        endMs: block.endTime,
        insight,
        sourceBlockIds: [block.id],
      })
    }
    return insight
  } catch {
    const insight = {
      label: userVisibleLabelForBlock(block),
      narrative: fallbackNarrativeForBlock(block),
    }
    if (!block.isLive && block.aiLabel) {
      upsertWorkContextInsight(getDb(), {
        startMs: block.startTime,
        endMs: block.endTime,
        insight,
        sourceBlockIds: [block.id],
      })
    }
    return insight
  }
}

const queuedBlockInsightJobs = new Set<string>()
let lastCleanupAnchorDate: string | null = null
const BLOCK_FINALIZE_QUIET_MS = 90_000
const CLEANUP_BLOCK_BATCH_SIZE = 12
const CLEANUP_BATCH_PAUSE_MS = 750

const cleanupQueueState: {
  active: boolean
  pendingDates: string[]
  pendingBlocks: WorkContextBlock[]
} = {
  active: false,
  pendingDates: [],
  pendingBlocks: [],
}
let cleanupQueueTimer: ReturnType<typeof setTimeout> | null = null

function resetCleanupQueue(): void {
  if (cleanupQueueTimer) {
    clearTimeout(cleanupQueueTimer)
    cleanupQueueTimer = null
  }
  cleanupQueueState.active = false
  cleanupQueueState.pendingDates = []
  cleanupQueueState.pendingBlocks = []
}

function markBlockCleanupReviewed(block: WorkContextBlock): void {
  upsertWorkContextCleanupReview(getDb(), {
    startMs: block.startTime,
    endMs: block.endTime,
    stableLabel: block.label.current,
    sourceBlockIds: [block.id],
  })
}

function fillCleanupQueue(): void {
  const db = getDb()
  while (cleanupQueueState.pendingBlocks.length === 0 && cleanupQueueState.pendingDates.length > 0) {
    const dateStr = cleanupQueueState.pendingDates.shift()
    if (!dateStr) break

    const payload = getTimelineDayPayload(db, dateStr, null)
    for (const block of payload.blocks) {
      const disposition = backgroundRelabelDispositionForBlock(block)
      if (disposition === 'review') {
        markBlockCleanupReviewed(block)
        continue
      }
      if (disposition === 'relabel') {
        cleanupQueueState.pendingBlocks.push(block)
      }
    }
  }
}

async function runBlockInsightJob(
  block: WorkContextBlock,
  jobType: 'block_label_finalize' | 'block_cleanup_relabel',
): Promise<void> {
  if (queuedBlockInsightJobs.has(`${jobType}:${block.id}`)) return
  queuedBlockInsightJobs.add(`${jobType}:${block.id}`)

  try {
    await generateWorkBlockInsight(block, { jobType, triggerSource: 'background' })
    invalidateProjectionScope('timeline', `ai:${jobType}`)
    invalidateProjectionScope('apps', `ai:${jobType}`)
    invalidateProjectionScope('insights', `ai:${jobType}`)
  } catch (error) {
    console.warn(`[ai] ${jobType} failed for block ${block.id}:`, error)
  } finally {
    queuedBlockInsightJobs.delete(`${jobType}:${block.id}`)
  }
}

async function processCleanupQueue(): Promise<void> {
  if (!cleanupQueueState.active) return
  if (!getSettings().aiBackgroundEnrichment) {
    resetCleanupQueue()
    return
  }

  try {
    fillCleanupQueue()
    if (cleanupQueueState.pendingBlocks.length === 0) {
      resetCleanupQueue()
      return
    }

    const batch = cleanupQueueState.pendingBlocks.splice(0, CLEANUP_BLOCK_BATCH_SIZE)
    for (const block of batch) {
      await runBlockInsightJob(block, 'block_cleanup_relabel')
    }

    fillCleanupQueue()
    if (cleanupQueueState.pendingBlocks.length === 0 && cleanupQueueState.pendingDates.length === 0) {
      resetCleanupQueue()
      return
    }

    cleanupQueueTimer = setTimeout(() => {
      cleanupQueueTimer = null
      void processCleanupQueue()
    }, CLEANUP_BATCH_PAUSE_MS)
  } catch (error) {
    console.warn('[ai] block cleanup sweep failed:', error)
    resetCleanupQueue()
  }
}

function scheduleOvernightCleanup(anchorDate: string): void {
  if (!getSettings().aiBackgroundEnrichment) return
  if (cleanupQueueState.active) {
    lastCleanupAnchorDate = anchorDate
    return
  }
  if (lastCleanupAnchorDate === anchorDate) return

  const pendingDates = listPendingWorkContextCleanupDates(getDb(), anchorDate)
  lastCleanupAnchorDate = anchorDate
  if (pendingDates.length === 0) return

  cleanupQueueState.active = true
  cleanupQueueState.pendingDates = pendingDates
  cleanupQueueState.pendingBlocks = []
  void processCleanupQueue()
}

export function scheduleTimelineAIJobs(payload: DayTimelinePayload): void {
  const settings = getSettings()
  if (!settings.aiBackgroundEnrichment) return

  const now = Date.now()
  for (const block of payload.blocks) {
    if (backgroundRelabelDispositionForBlock(block) !== 'relabel') continue
    if (now - block.endTime < BLOCK_FINALIZE_QUIET_MS) continue
    void runBlockInsightJob(block, 'block_label_finalize')
  }

  scheduleOvernightCleanup(currentLocalDateString())
}

const APP_VOCABULARY_HINT =
  'App vocabulary (use this to interpret app names correctly): ' +
  'Dia = AI-powered browser; Arc/Chrome/Safari/Firefox/Brave/Edge/Opera/Vivaldi = browsers; ' +
  'Warp/Ghostty/iTerm2/Terminal/Alacritty/Kitty = terminals; ' +
  'Cursor/VS Code/Xcode/Zed/Sublime = code editors; ' +
  'Claude/ChatGPT/Codex/Perplexity/Copilot/Comet = AI tools; ' +
  'Slack/Discord/Teams/Messages/WhatsApp/Telegram/Signal = team chat or messaging; ' +
  'Notion/Obsidian/Bear/Craft/Word/Notes/Journal = notes and writing; ' +
  'Figma/Sketch/Canva/Miro = design; ' +
  'Linear/Jira/Asana/Todoist/TickTick/Trello = project and task management; ' +
  'Spotify/Apple Music/VLC/Podcasts = media playback; ' +
  'Zoom/Loom = video meetings; ' +
  'Outlook/Spark/Apple Mail = email. ' +
  'Key websites: x.com and twitter.com = X (social media); youtube.com = video platform; reddit.com = forum/discussion; instagram.com = social media; github.com = code hosting.'

function ensureEvidenceLead(text: string): string {
  return text
    .trim()
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

async function routerProsePass(
  question: string,
  structuredData: string,
): Promise<string> {
  const trace = getCurrentTrace()
  const emit = (output: string, fallback?: 'timestamp_mismatch' | 'empty' | 'error' | 'timeout') => {
    if (trace) trace.addEvent({ kind: 'prose_pass', input: structuredData, output, ...(fallback ? { fallback } : {}) })
  }
  const systemPrompt =
    VOICE_SYSTEM_PROMPT + '\n\n' +
    `## Job: rewrite structured data into prose\n` +
    `The user asked: "${question}".\n` +
    `Rewrite the structured data below as one to three natural sentences.\n\n` +
    `## STRICT RULES — violations = wrong answer\n` +
    `1. Add NOTHING that is not in the structured data. No invented album names, file names, project names, durations, percentages, time ranges, app names, or block labels. If the structured data does not contain "Google Photos" or "houses", you must NOT say either.\n` +
    `2. Every number you state (minutes, hours, percent, "around 3pm") must appear in the structured data. Do not paraphrase, round, or interpret. "3h 16m" if the data says "3h 16m" — never "about 3 hours."\n` +
    `3. App names are evidence, not the answer. If the data says "Photos app was foreground for 3 minutes", write "you spent 3 minutes in the Photos app" — never "you were browsing photos" and never "you were looking at an album called X." If a window title or block label appears, you may quote it verbatim.\n` +
    `4. If the structured data has no answer to the user's question, say so plainly and offer the closest evidence — do not pad with generic productivity prose.\n` +
    `5. ${USER_VISIBLE_ACTIVITY_PROSE_RULE}\n` +
    `6. No bullets, no numbered lists, no tables. Plain prose only.\n` +
    `7. Never claim editing, writing, attention, or intent — only that an app or window was open.\n` +
    `8. Do not open with "From your app sessions..." or any boilerplate evidence prefix.\n` +
    `9. Do not use emoji.\n\n` +
    APP_VOCABULARY_HINT

  try {
    const { text } = await withTimeout(
      executeTextAIJob(
        {
          jobType: 'chat_answer',
          screen: 'ai_chat',
          triggerSource: 'user',
          systemPrompt,
          userMessage: structuredData,
        },
        sendWithProvider,
      ),
      10_000,
      'prose-pass timeout',
    )
    const trimmed = text.trim()
    if (!trimmed) {
      const out = structuredData.trim()
      emit(out, 'empty')
      return out
    }
    // Cheap post-check: every HH:MM in the rewrite must appear in the
    // structured data. Catches the most common fabrication shape (the
    // prose pass inventing time ranges that "feel" right).
    const { verifyTimestamps } = await import('../ai/citations')
    const check = verifyTimestamps(trimmed, [structuredData])
    if (!check.ok) {
      // Fall back to the structured data verbatim — better an ugly true
      // answer than a smooth fabricated one.
      const out = structuredData.trim()
      emit(out, 'timestamp_mismatch')
      return out
    }
    emit(trimmed)
    return trimmed
  } catch {
    // Fall through to structured data — better to show full data than a truncated header
  }

  const out = structuredData.trim()
  emit(out, 'error')
  return out
}

export async function sendMessage(payload: AIChatSendRequest, options: SendMessageOptions = {}): Promise<AIChatTurnResult> {
  const recorder = maybeStartTrace({
    scenarioId: options.traceScenarioId ?? null,
    tag: 'sendMessage',
  })
  try {
    const result = await sendMessageInner(payload, options)
    if (recorder) {
      recorder.finish(result.assistantMessage?.content)
    }
    return result
  } catch (err) {
    if (recorder) {
      recorder.finish(undefined, err instanceof Error ? err.message : String(err))
    }
    throw err
  } finally {
    if (recorder) setCurrentTrace(null)
  }
}

async function sendMessageInner(payload: AIChatSendRequest, options: SendMessageOptions = {}): Promise<AIChatTurnResult> {
  const userMessage = payload.message
  const db = getDb()
  const conversationId = getOrCreateConversation(db)
  let threadId = payload.threadId ?? null
  if (threadId == null) {
    // Silently create a thread titled from the first user message so legacy
    // call-sites that omit threadId still end up with durable thread rows.
    const created = createThread(deriveTitleFromMessage(userMessage))
    threadId = created.id
  } else {
    // Ensure the referenced thread exists; if not, fall back to a fresh one.
    const existing = getThread(threadId)
    if (!existing) {
      const created = createThread(deriveTitleFromMessage(userMessage))
      threadId = created.id
    } else {
      maybeRenameWeakThread(threadId, existing.title, userMessage)
    }
  }
  const history = threadId == null
    ? getConversationMessages(db, conversationId)
    : getThreadMessages(db, threadId)
  const stream = createChatStreamAccumulator(payload.clientRequestId ?? null, options)
  const restoredState = payload.contextOverride ?? restoreChatState(conversationId, threadId)
  const restoredTemporalContext = deserializeTemporalContext(restoredState?.routingContext ?? null)
  const followUpResolution = resolveFollowUp(userMessage, restoredState, history)
  const effectiveUserMessage = followUpResolution.effectivePrompt
  const contextKey = conversationContextKey(conversationId, threadId)
  const previousContext = followUpResolution.shouldResetContext
    ? null
    : (restoredTemporalContext
      ?? conversationTemporalContext.get(contextKey)
      ?? null)

  capture(ANALYTICS_EVENT.AI_FOLLOWUP_RESOLUTION, {
    kind: followUpResolution.kind,
    followup_class: followUpResolution.followUpClass,
    reused_context: followUpResolution.shouldReuseContext,
    reset_context: followUpResolution.shouldResetContext,
    answer_kind: restoredState?.answerKind ?? null,
    source_kind: restoredState?.sourceKind ?? null,
  })

  if (process.env.NODE_ENV === 'development') {
    console.log(`[ai:chat] ← "${userMessage.slice(0, 120)}"`)
  }

  if (/^\s*(hey|hi|hello|sup|yo|howdy|hiya|helo|test|testing)\s*[!.?]?\s*$/i.test(effectiveUserMessage)) {
    const greetingText = 'Hey! What would you like to know about your day?'
    await stream.streamText(greetingText)
    return persistChatTurn(db, conversationId, userMessage, {
      assistantText: greetingText,
      answerKind: 'freeform_chat',
      sourceKind: 'deterministic',
      resolvedTemporalContext: null,
      conversationState: null,
      suggestedFollowUps: [],
    }, threadId)
  }

  const focusIntent = maybeHandleFocusIntent(effectiveUserMessage)
  if (focusIntent) {
    await stream.streamText(focusIntent.assistantText)
    return persistChatTurn(db, conversationId, userMessage, focusIntent, threadId)
  }

  const prior = sanitizeConversationHistory(history)
  const directReportEnvelope = await maybeGenerateRequestedOutput({
    question: effectiveUserMessage,
    restoredState,
    previousContext,
    routedContext: previousContext,
    routedAnswer: null,
    prior,
  })
  if (directReportEnvelope) {
    await stream.streamText(directReportEnvelope.assistantText)
    return persistChatTurn(db, conversationId, userMessage, directReportEnvelope, threadId)
  }

  const routed = shouldUseRouter(effectiveUserMessage)
    ? await routeInsightsQuestion(effectiveUserMessage, new Date(), previousContext, db)
    : null
  const reportEnvelope = await maybeGenerateRequestedOutput({
    question: effectiveUserMessage,
    restoredState,
    previousContext,
    routedContext: routed?.resolvedContext ?? previousContext,
    routedAnswer: routed?.kind === 'answer' ? routed.answer : null,
    prior,
  })
  if (reportEnvelope) {
    await stream.streamText(reportEnvelope.assistantText)
    return persistChatTurn(db, conversationId, userMessage, reportEnvelope, threadId)
  }

  if (routed) {
    if (routed.kind === 'weeklyBrief') {
      const settings = getSettings()
      const chatProvider = settings.aiChatProvider ?? settings.aiProvider ?? 'anthropic'
      const chatModel = modelForProvider(chatProvider, 'quality', settings)
      let pack = routed.briefContext.evidenceKey ? weeklyBriefCache.get(routed.briefContext.evidenceKey) ?? null : null
      if (!pack) {
        pack = buildWeeklyBriefEvidencePack(db, routed.briefContext)
        weeklyBriefCache.set(pack.evidenceKey, pack)
      }
      const resolvedWeeklyContext: WeeklyBriefContext = {
        ...routed.briefContext,
        evidenceKey: pack.evidenceKey,
      }
      const { systemPrompt, userPrompt } = weeklyBriefPrompts(effectiveUserMessage, resolvedWeeklyContext, pack)
      if (process.env.NODE_ENV === 'development') {
        console.log(`[ai:chat] weekly brief → provider=${chatProvider} model=${chatModel} mode=${resolvedWeeklyContext.responseMode} key=${pack.evidenceKey}`)
      }
      const { text } = await executeTextAIJob(
        {
          jobType: 'chat_answer',
          screen: 'ai_chat',
          triggerSource: 'user',
          systemPrompt,
          userMessage: userPrompt,
          prior,
        },
        sendWithProvider,
        { onDelta: (delta) => stream.push(delta) },
      )
      const assistantText = ensureEvidenceLead(text)
      await stream.streamText(assistantText)
      if (!assistantText.trim()) {
        throw new Error('The AI returned an empty response. Please try again.')
      }
      const resolvedTemporalContext: TemporalContext = {
        ...routed.resolvedContext,
        weeklyBrief: resolvedWeeklyContext,
      }
      const answerKind = answerKindForWeeklyContext(resolvedWeeklyContext)
      const conversationState = buildConversationState(
        answerKind,
        'weekly_brief',
        resolvedTemporalContext,
        inferFollowUpAffordances(answerKind),
      )
      const suggestedFollowUps = await generateSuggestedFollowUps(userMessage, assistantText, answerKind, conversationState)
      return persistChatTurn(db, conversationId, userMessage, {
        assistantText,
        answerKind,
        sourceKind: 'weekly_brief',
        resolvedTemporalContext,
        conversationState,
        suggestedFollowUps,
      }, threadId)
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(`[ai:chat] router hit → "${routed.answer.slice(0, 120)}"`)
    }
    const traceForRouter = getCurrentTrace()
    if (traceForRouter) {
      traceForRouter.addEvent({
        kind: 'router_decision',
        routedKind: routed.kind,
        structuredAnswer: routed.answer,
        hasTimeWindow: Boolean(routed.resolvedContext?.timeWindow),
      })
    }
    const answerKind: AIAnswerKind = 'deterministic_stats'
    const resolvedTemporalContext: TemporalContext = {
      ...routed.resolvedContext,
      weeklyBrief: null,
    }
    const conversationState = buildConversationState(
      answerKind,
      'deterministic',
      resolvedTemporalContext,
      inferFollowUpAffordances(answerKind),
      {
        dateRange: inferDateRangeFromQuestion(effectiveUserMessage, restoredState?.dateRange ?? null),
        topic: followUpResolution.shouldReuseContext ? restoredState?.topic ?? null : null,
        responseMode: null,
        lastIntent: followUpResolution.followUpClass,
        evidenceKey: null,
      },
    )
    const proseAnswer = await routerProsePass(effectiveUserMessage, routed.answer)
    await stream.streamText(proseAnswer)
    const suggestedFollowUps = await generateSuggestedFollowUps(userMessage, proseAnswer, answerKind, conversationState)
    return persistChatTurn(db, conversationId, userMessage, {
      assistantText: proseAnswer,
      answerKind,
      sourceKind: 'deterministic',
      resolvedTemporalContext,
      conversationState,
      suggestedFollowUps,
    }, threadId)
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[ai:chat] router miss → falling back to LLM`)
  }

  const settings = getSettings()
  const { userName } = settings
  const chatProvider = settings.aiChatProvider ?? settings.aiProvider ?? 'anthropic'
  const chatModel = modelForProvider(chatProvider, 'quality', settings)
  const persona = userName
    ? `You are Daylens, a personal productivity coach helping ${userName} understand their time.`
    : `You are Daylens, a personal productivity coach embedded in a local screen-time tracker.`

  let assistantText: string

  if (chatProvider === 'anthropic' || chatProvider === 'openai' || chatProvider === 'google') {
    const now = new Date()
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const weekdayName = now.toLocaleDateString('en-US', { weekday: 'long' })

    // Tracking window: when Daylens first started capturing data for this user.
    const firstSessionRow = db
      .prepare('SELECT MIN(start_time) as t FROM app_sessions')
      .get() as { t: number | null } | undefined
    const trackingWindowLine = firstSessionRow?.t
      ? `Daylens started tracking on ${new Date(firstSessionRow.t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. For any date before that, say "Daylens started tracking on <date>" and offer what's available from that date forward. Never say "I don't have data" — instead frame it as "here's what Daylens captured starting from <date>."`
      : 'Daylens has no tracked sessions yet. If asked about past activity, say tracking just started and offer to answer once activity is captured.'

    const systemPrompt = [
      VOICE_SYSTEM_PROMPT,
      persona,
      `Today is ${weekdayName}, ${todayStr}. It is currently ${nowHHMM} local. If the user asks about a moment LATER than ${nowHHMM} today, that moment has not happened yet — acknowledge that plainly instead of saying "no tracked activity."`,
      trackingWindowLine,
      '',
      CHAT_TOOL_USE_SYSTEM_PROMPT,
      USER_VISIBLE_ACTIVITY_PROSE_RULE,
      APP_VOCABULARY_HINT,
      `If asked what model is powering this chat: say you are Daylens, currently routed through ${providerLabel(chatProvider)} (${chatModel}).`,
    ].join('\n')

    if (process.env.NODE_ENV === 'development') {
      console.log(`[ai:chat] tool-use path → provider=${chatProvider} model=${chatModel}`)
    }

    const resolvedApiKey = (await getApiKey(chatProvider)) ?? ''

    // Generative questions (drafts, status updates, recaps) need more tool
    // calls to gather sufficient context before synthesizing.
    const questionShape = classifyQuestionShape(effectiveUserMessage)
    // Generative drafts need many lookups to gather context. Reflective
    // questions ("when am I most focused?") need multi-day exploration —
    // give them headroom too so they don't hit the cap.
    const loopOpts: AnthropicToolLoopOptions =
      questionShape === 'generative'
        ? { maxToolCalls: 10 }
        : questionShape === 'reflective' || questionShape === 'cross_cutting'
          ? { maxToolCalls: 9 }
          : {}

    assistantText = chatProvider === 'anthropic'
      ? await runAnthropicToolLoop(resolvedApiKey, chatModel, systemPrompt, prior, effectiveUserMessage, db, (delta) => stream.push(delta), loopOpts)
      : chatProvider === 'openai'
        ? await runOpenAIToolLoop(resolvedApiKey, chatModel, systemPrompt, prior, effectiveUserMessage, db, (delta) => stream.push(delta))
        : await runGoogleToolLoop(resolvedApiKey, chatModel, systemPrompt, prior, effectiveUserMessage, db, (delta) => stream.push(delta))
    assistantText = assistantText.trim()
  } else {
    // Legacy static-context path — CLI providers only.
    // CLI providers (`claude`, `codex`) own their own loop and cannot use our
    // tool-calling pipeline; they receive a prebaked context blob instead.
    const now = new Date()
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const dayContext = capContextBlock(buildDayContext())
    const allTimeContext = capContextBlock(buildAllTimeContext())
    const specificTimeContext = capContextBlock(buildSpecificTimeContext(userMessage))
    const attributionDayCtx = capContextBlock(buildAttributionDayContext(todayStr))
    const attributionEntityCtx = capContextBlock(buildAttributedEntityContext(userMessage))
    const preferredConfig = {
      provider: chatProvider,
      model: chatModel,
    }
    const systemPrompt =
      VOICE_SYSTEM_PROMPT + '\n' +
      persona + ' You have access to tracked local activity data — app sessions, website visits, attributed work sessions, and recurring workflows.\n\n' +
      'Your job is to synthesize, not recite. The user can already see raw totals in the UI. They come to you to understand what the day actually looked like and what was getting done.\n\n' +
      'How to think:\n' +
      '- Work sessions are the primary data unit. They can carry attributed client/project context, confidence scores, app roles, and evidence trails. Use them when answering grounded questions about named workstreams.\n' +
      '- For attributed entity questions, use attributed work_sessions first. Report attributed hours first, then ambiguous time separately. Never silently include ambiguous time in attributed totals.\n' +
      '- Not every repo, class, research topic, or internal initiative has a first-class attribution record yet. When structured attribution is missing, ground the answer in blocks, artifacts, window titles, and websites instead of pretending the entity is fully attributed.\n' +
      '- Read the work-block structure for additional context. Blocks group related activity with labels, apps, and websites.\n' +
      '- Grounding contract: only mention a file, doc, page, repo, or project name if it appears verbatim in the evidence below (block labels, artifact titles, window titles, websites, or attributed work_sessions).\n' +
      '- If the evidence only shows an app or domain, keep the answer at that level. Do not invent repo names, filenames, meeting titles, or document titles.\n' +
      '- Connect apps to intent carefully: Chrome + docs.google.com + a specific title can indicate a document; Cursor + GitHub can indicate code work; Slack + a long block can indicate a conversation thread.\n' +
      '- Notice patterns: recurring workflows show habitual projects or rituals. Time-of-day shape shows when the user focuses vs. communicates.\n' +
      '- Prefer the specific over the generic. "Drafted the Q2 planning doc in Google Docs around 10-11am, then switched to Slack for 30m" beats "You spent 2h in Chrome."\n' +
      '- When the evidence is ambiguous, say "looks like" or "probably" rather than inventing specifics. Don\'t hallucinate project names or document titles that aren\'t in the evidence.\n' +
      '- You DO have access to all-time tracked data (see "Lifetime tracked data" below) and recent daily history, not just today. Never tell the user "I only have today\'s data" — that is false. If you\'ve already given a lifetime/weekly/yesterday answer earlier in this conversation, treat it as ground truth and use it for follow-ups (e.g. "how many days is that" → the tracking window stated above).\n\n' +
      'How to write:\n' +
      '- Conversational, grounded, slightly social — a thoughtful friend who reviewed your day, not a dashboard.\n' +
      `- ${USER_VISIBLE_ACTIVITY_PROSE_RULE}\n` +
      '- Lead with the story of the day (what the user was doing and when), then surface totals only if the user asked or if a number matters.\n' +
      '- Keep it short. 2-5 sentences for most questions. Use bullet points only when listing distinct blocks or suggestions.\n' +
      '- Reference block time ranges and labels when they add specificity: "between 9:30 and 11:00 you were in a research block on arxiv and Claude".\n' +
      '- Never say "the user" — address them directly ("you").\n' +
      '- Do not use emoji in any part of your response.\n' +
      '- Always speak as Daylens, never as a raw model/provider persona.\n' +
      `- If asked what model is powering this chat: say you are Daylens, currently routed through ${providerLabel(preferredConfig.provider)} (${preferredConfig.model}).\n` +
      '- If the data genuinely doesn\'t answer the question, say so plainly and offer what you can infer.\n' +
      '- For recommendations, keep them concrete and tied to observed patterns — not generic productivity advice.\n' +
      '- Evidence-type rule: weave evidence type naturally into the answer when it adds clarity (e.g. "your window titles showed...", "based on your app sessions...") — do not open every answer with a boilerplate evidence prefix. ' +
      'Never write "you edited X" or "you worked on Y" — the data shows foreground time and window-title strings, not edits or intent. ' +
      'Use "you had X open" or "your window title read Y" instead.\n' +
      '- Capture contract — Daylens DOES capture: foreground app sessions (app name, bundle ID, window title, duration), website visits (URL, page title, estimated duration), idle/away/suspend state, focus sessions, reconstructed timeline blocks, AI artifacts it generated.\n' +
      '- Capture contract — Daylens does NOT capture: file open/save/edit events, document contents, screen pixels, screenshots, keystrokes, clipboard, which browser tab is visible when the window title only names the browser, terminal commands (only the window-title string), call audio, email contents, message contents.\n' +
      '- Refusal rule: if the user asks about anything in the NOT-captured list, say so plainly in one or two sentences, then offer the closest thing you actually can see. Never dump an unrelated aggregation to avoid saying "I do not have that".\n\n' +
      (allTimeContext ? `Lifetime tracked data:\n${allTimeContext}\n\n` : '') +
      (dayContext
        ? `Today's tracked data:\n${dayContext}`
        : 'No activity has been recorded yet today. If the user asks about stats for today specifically, say tracking needs more time — but lifetime data above may still apply.') +
      (specificTimeContext ? `\n\nSpecific historical context:\n${specificTimeContext}` : '') +
      (attributionDayCtx ? `\n\nAttribution-layer work sessions (JSON):\n${attributionDayCtx}` : '') +
      (attributionEntityCtx ? `\n\nClient/project attribution context (JSON):\n${attributionEntityCtx}` : '')

    if (process.env.NODE_ENV === 'development') {
      console.log(`[ai:chat] static-context path → provider=${chatProvider} model=${chatModel}`)
    }
    const { text } = await executeTextAIJob(
      {
        jobType: 'chat_answer',
        screen: 'ai_chat',
        triggerSource: 'user',
        systemPrompt,
        userMessage: effectiveUserMessage,
        prior,
      },
      sendWithProvider,
      { onDelta: (delta) => stream.push(delta) },
    )
    assistantText = text.trim()
    await stream.streamText(assistantText)
  }

  // Don't save an empty assistant response — it would corrupt future prior
  // history and cause the AI to receive empty content blocks.
  if (!assistantText.trim()) {
    throw new Error('The AI returned an empty response. Please try again.')
  }

  const answerKind: AIAnswerKind = 'freeform_chat'
  const resolvedTemporalContext: TemporalContext = followUpResolution.shouldReuseContext && previousContext
    ? previousContext
    : {
      date: new Date(),
      timeWindow: null,
      weeklyBrief: null,
      entity: null,
    }
  const conversationState = buildConversationState(
    answerKind,
    'freeform',
    resolvedTemporalContext,
    inferFollowUpAffordances(answerKind),
    {
      dateRange: inferDateRangeFromQuestion(effectiveUserMessage, followUpResolution.shouldReuseContext ? restoredState?.dateRange ?? null : null),
      topic: followUpResolution.shouldReuseContext ? restoredState?.topic ?? null : null,
      responseMode: followUpResolution.shouldReuseContext ? restoredState?.responseMode ?? null : null,
      lastIntent: followUpResolution.followUpClass,
      evidenceKey: followUpResolution.shouldReuseContext ? restoredState?.evidenceKey ?? null : null,
    },
  )
  const suggestedFollowUps = await generateSuggestedFollowUps(userMessage, assistantText, answerKind, conversationState)
  return persistChatTurn(db, conversationId, userMessage, {
    assistantText,
    answerKind,
    sourceKind: 'freeform',
    resolvedTemporalContext,
    conversationState,
    suggestedFollowUps,
  }, threadId)
}

export async function prepareDailyReport(dateStr = currentLocalDateString()): Promise<AIDailyReportPreparationResult> {
  try {
    const bundle = buildDayReportBundle(dateStr)
    if (!bundle) {
      return {
        date: dateStr,
        threadId: null,
        artifactId: null,
        prepared: false,
        status: 'no_activity',
      }
    }

    const thread = createThread(`Day report ${dateStr}`)
    await sendMessage({
      message: dateStr === currentLocalDateString()
        ? 'Draft a report for today.'
        : `Draft a report for ${dateStr}.`,
      threadId: thread.id,
    })

    let artifactId: number | null = null
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const reportArtifact = listArtifactsByThread(thread.id)
        .find((artifact) => {
          if (artifact.kind !== 'report' && artifact.kind !== 'markdown') return false
          const source = typeof artifact.meta?.source === 'string' ? artifact.meta.source : ''
          if (source === 'debug_evidence') return false
          return true
        })
      if (reportArtifact) {
        artifactId = reportArtifact.id
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    return {
      date: dateStr,
      threadId: thread.id,
      artifactId,
      prepared: artifactId != null,
      status: artifactId != null ? 'ready' : 'failed',
      error: artifactId == null ? 'No user-facing report artifact was created.' : undefined,
    }
  } catch (error) {
    console.warn(`[ai] failed to prepare daily report for ${dateStr}:`, error)
    return {
      date: dateStr,
      threadId: null,
      artifactId: null,
      prepared: false,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function getAIHistory(threadId?: number | null): AIThreadMessage[] {
  const db = getDb()
  const conversationId = getOrCreateConversation(db)
  restoreConversationState(conversationId)
  if (threadId != null) {
    return getThreadMessages(db, threadId)
  }
  return getConversationMessages(db, conversationId)
}

export function getThreadHistory(threadId: number): AIThreadMessage[] {
  return getThreadMessages(getDb(), threadId)
}

export async function getWeekReview(weekStartStr: string): Promise<AISurfaceSummary | null> {
  return generateWeekReview(weekStartStr)
}

export async function getAppNarrative(
  canonicalAppId: string,
  days = 7,
): Promise<AISurfaceSummary | null> {
  return generateAppNarrative(canonicalAppId, days)
}

export function clearAIHistory(): void {
  const db = getDb()
  const conversationId = getOrCreateConversation(db)
  clearConversation(db, conversationId)
  conversationTemporalContext.clear()
}

export async function testCLITool(tool: 'claude' | 'codex'): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  try {
    const expectedToken = `DAYLENS_OK_${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    const output = await runCLIProvider(
      tool,
      `System context:\nYou are a test runner. Reply with exactly ${expectedToken} and nothing else.\n\nUser: Reply with exactly ${expectedToken} and nothing else.`,
    )
    const normalizedOutput = output.trim()
    if (normalizedOutput !== expectedToken) {
      return {
        ok: false,
        error: `Unexpected CLI output: ${normalizedOutput.slice(0, 120) || '(empty response)'}`,
      }
    }
    return { ok: true, output: normalizedOutput }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// Hook wrappedNarrative into the shared provider sender so it can run through
// the same execution path (provider fallback, usage logging, prompt caching).
registerWrappedNarrativeProvider(sendWithProvider)
registerWrappedPeriodNarrativeProvider(sendWithProvider)
