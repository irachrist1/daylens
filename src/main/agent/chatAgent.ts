// The chat agent loop (ADR 0003). One loop for every chat answer: the model
// reasons over the conversation, calls read-only tools, optionally asks the
// user one clarifying question, and streams the answer in the Daylens voice.
//
// Grounding is enforced here, not hoped for:
//   - every tool returns real rows or an explicit miss (tool contracts),
//   - the turn keeps a full tool trace (persisted with the message),
//   - clock times and named entities in the final text are verified against
//     the turn's tool results; one violation triggers one corrective retry
//     whose replacement streams over the same snapshot channel.
//
// This function is the ONE chat entrypoint body — the IPC handler and the
// terminal bench both reach it through sendMessage (ai.md §4.3). Keep every
// behavior deps-injected so the bench cannot diverge from the UI.
import { streamText, stepCountIs, type ModelMessage, type ToolSet } from 'ai'
import type Database from 'better-sqlite3'
import os from 'node:os'
import type { AIMessageArtifact } from '@shared/types'
import type { ResolvedProviderConfig, AIProviderUsage } from '../services/aiOrchestration'
import { providerLabel } from '../services/aiOrchestration'
import { recordProviderCall } from '../services/aiRateLimiter'
import { verifyTimestamps, verifyCitedEntities } from '../ai/citations'
import { languageModelFor } from './providerModel'
import { buildDaylensTools } from './daylensTools'
import { buildSystemTools } from './systemTools'
import { buildInteractionTools, type AgentQuestion } from './interactionTools'
import { connectMcpTools, type McpServerConfig } from './mcpTools'
import { buildAgentSystemPrompt } from './systemPrompt'

const MAX_STEPS = 14
const MAX_OUTPUT_TOKENS = 8_000
const MAX_TOOL_RESULT_CHARS = 60_000

export interface AgentToolTraceEntry {
  tool: string
  input: unknown
  /** JSON of the tool result, truncated for persistence. */
  output: string
}

export interface ChatAgentDeps {
  db: Database.Database
  config: ResolvedProviderConfig
  /** Streams the growing answer (and tool status lines) to the renderer / bench collector. */
  onStreamEvent?: (event: { delta: string; snapshot: string; status?: string }) => void | Promise<void>
  askUser: (question: AgentQuestion) => Promise<string>
  artifactDir: string
  mcpServers?: McpServerConfig[]
  extraSystem?: string | null
  signal?: AbortSignal
  now?: Date
  trackingStart?: string | null
}

export interface ChatAgentResult {
  text: string
  toolTrace: AgentToolTraceEntry[]
  artifacts: AIMessageArtifact[]
  usage: AIProviderUsage
  stepCount: number
  groundingRetried: boolean
}

function statusForTool(tool: string, input: unknown): string {
  const params = (input ?? {}) as Record<string, unknown>
  switch (tool) {
    case 'get_moment': return `Looking at ${params.date ?? ''} ${params.time ?? ''}`.trim()
    case 'get_day_overview': return `Reading ${params.date ?? 'the day'}`
    case 'search_history': return `Searching for "${params.query ?? ''}"`
    case 'list_page_visits': return 'Going through your page visits'
    case 'get_app_usage': return `Checking time in ${params.appName ?? 'that app'}`
    case 'get_week_summary': return 'Reading the week'
    case 'git': return 'Reading git history'
    case 'read_file': return 'Reading a file'
    case 'list_dir': return 'Listing a folder'
    case 'create_artifact': return 'Building your file'
    case 'ask_user': return 'Asking you'
    default: return tool.startsWith('mcp_') ? `Using ${tool.replace(/^mcp_/, '').replace(/_/g, ' ')}` : 'Working'
  }
}

/**
 * Tool results carry epoch-ms numbers; the verifiers compare literal strings.
 * Augment the evidence corpus with local HH:MM / YYYY-MM-DD renderings of every
 * epoch-shaped number so a correctly cited time never reads as a violation.
 */
function evidenceWithFormattedTimes(raw: string): string {
  const extras = new Set<string>()
  const numberPattern = /\b1[5-9]\d{11}\b|\b2[0-2]\d{11}\b/g
  let match: RegExpExecArray | null
  while ((match = numberPattern.exec(raw)) !== null) {
    const value = Number(match[0])
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) continue
    extras.add(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`)
    extras.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`)
  }
  return extras.size > 0 ? `${raw}\n${[...extras].join(' ')}` : raw
}

export async function runChatAgentTurn(
  question: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  deps: ChatAgentDeps,
): Promise<ChatAgentResult> {
  const now = deps.now ?? new Date()
  const artifacts: AIMessageArtifact[] = []
  const toolTrace: AgentToolTraceEntry[] = []
  const toolResultStrings: string[] = []
  let stepCount = 0

  const usage: AIProviderUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const addUsage = (u: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } | undefined) => {
    if (!u) return
    usage.inputTokens = (usage.inputTokens ?? 0) + (u.inputTokens ?? 0)
    usage.outputTokens = (usage.outputTokens ?? 0) + (u.outputTokens ?? 0)
    usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + (u.cachedInputTokens ?? 0)
  }

  const mcp = await connectMcpTools(deps.mcpServers ?? [])
  try {
    const tools: ToolSet = {
      ...buildDaylensTools(deps.db),
      ...buildSystemTools(),
      ...buildInteractionTools({
        askUser: deps.askUser,
        artifactDir: deps.artifactDir,
        onArtifact: (artifact) => artifacts.push(artifact),
        signal: deps.signal,
      }),
      ...mcp.tools,
    }

    const system = buildAgentSystemPrompt({
      now,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      trackingStart: deps.trackingStart ?? null,
      providerLabel: providerLabel(deps.config.provider),
      model: deps.config.model,
      homeDir: os.homedir(),
      extraSystem: deps.extraSystem,
    })

    const messages: ModelMessage[] = [
      ...history.map((message) => ({ role: message.role, content: message.content } as ModelMessage)),
      { role: 'user', content: question },
    ]

    let snapshot = ''
    const streamTurn = async (turnMessages: ModelMessage[], replaceFrom: string | null): Promise<string> => {
      const result = streamText({
        model: languageModelFor(deps.config),
        system,
        messages: turnMessages,
        tools,
        stopWhen: stepCountIs(MAX_STEPS),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: deps.signal,
      })

      let text = ''
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'start-step':
            stepCount += 1
            recordProviderCall()
            // Text from consecutive steps would otherwise concatenate with no
            // separator ("…data fresh.Now I have…") — glued prose in the UI and
            // phantom entities ("fresh.Now") in the grounding check.
            if (text) {
              text += '\n\n'
              snapshot = replaceFrom != null ? replaceFrom + text : snapshot + '\n\n'
              await deps.onStreamEvent?.({ delta: replaceFrom != null ? '' : '\n\n', snapshot })
            }
            break
          case 'text-delta': {
            text += part.text
            // A grounding retry replaces the already-streamed answer: reset the
            // snapshot to the retry's own text and stream from there.
            snapshot = replaceFrom != null ? replaceFrom + text : snapshot + part.text
            if (replaceFrom != null) {
              await deps.onStreamEvent?.({ delta: '', snapshot })
            } else {
              await deps.onStreamEvent?.({ delta: part.text, snapshot })
            }
            break
          }
          case 'tool-call':
            await deps.onStreamEvent?.({ delta: '', snapshot, status: statusForTool(part.toolName, part.input) })
            break
          case 'tool-result': {
            const output = JSON.stringify(part.output ?? null)
            const bounded = output.length > MAX_TOOL_RESULT_CHARS ? `${output.slice(0, MAX_TOOL_RESULT_CHARS)}…` : output
            toolTrace.push({ tool: part.toolName, input: part.input, output: bounded })
            toolResultStrings.push(evidenceWithFormattedTimes(bounded))
            break
          }
          case 'tool-error': {
            const message = JSON.stringify({ found: false, reason: String((part as { error?: unknown }).error ?? 'tool error') })
            toolTrace.push({ tool: part.toolName, input: part.input, output: message })
            break
          }
          case 'finish-step':
            addUsage(part.usage)
            break
          case 'error':
            throw part.error instanceof Error ? part.error : new Error(String(part.error))
          default:
            break
        }
      }
      return text.trim()
    }

    let text = await streamTurn(messages, null)
    let groundingRetried = false

    // Grounding verification (ADR 0003 §3): every clock time and quoted entity
    // in the answer must appear in this turn's tool results (or the user's own
    // words). One named-violation retry; a second failure ships anyway with the
    // violation logged — never a crash, the SOFT-guard philosophy.
    if (text && toolResultStrings.length > 0) {
      const corpus = [...toolResultStrings, question]
      const timestamps = verifyTimestamps(text, corpus)
      const entities = verifyCitedEntities(text, corpus)
      if (!timestamps.ok || !entities.ok) {
        groundingRetried = true
        const problems = [
          ...timestamps.suspect.map((ts) => `the time ${ts} does not appear in any tool result`),
          ...entities.missingEntities.map((entity) => `"${entity}" does not appear in any tool result`),
        ].join('; ')
        console.warn(`[agent:grounding] retrying answer — ${problems}`)
        const retryMessages: ModelMessage[] = [
          ...messages,
          { role: 'assistant', content: text },
          {
            role: 'user',
            content: `Your answer failed the grounding check: ${problems}. Rewrite it using only times and names that appear in the tool results you already have (call a tool again if you need to re-check). Reply with the corrected answer only.`,
          },
        ]
        const replacement = await streamTurn(retryMessages, '')
        if (replacement) {
          text = replacement
          const recheck = verifyTimestamps(text, [...toolResultStrings, question])
          if (!recheck.ok) console.warn(`[agent:grounding] still suspect after retry: ${recheck.suspect.join(', ')}`)
        }
      }
    }

    return { text, toolTrace, artifacts, usage, stepCount, groundingRetried }
  } finally {
    await mcp.close()
  }
}
