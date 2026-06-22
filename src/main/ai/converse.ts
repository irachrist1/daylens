// The conversational turn (ai.md §3 "the voice", §4.2 the long tail, §5 the
// no-static-text rule). When a message maps to no data resolver — a hello, a
// how-are-you, a what-can-you-do, a joke, an aside — Daylens still answers with
// a REAL model call. It never streams a hardcoded line and never recites a
// capability menu. It stays in character: warm, brief, grounded, and it never
// claims activity it wasn't handed.
import {
  executeTextAIJob,
  type AITextJobExecutionOptions,
  type ProviderTextResponse,
  type ResolvedProviderConfig,
} from '../services/aiOrchestration'
import { VOICE_SYSTEM_PROMPT } from './voiceContract'
import { getCurrentTrace } from './trace'

type ConverseRunner = (
  config: ResolvedProviderConfig,
  systemPrompt: string,
  prior: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
  options: AITextJobExecutionOptions,
) => Promise<ProviderTextResponse>

const CONVERSE_SYSTEM_PROMPT = [
  VOICE_SYSTEM_PROMPT,
  '',
  '## This turn is conversation, not a data lookup',
  "The user said something that doesn't map to their activity — a hello, a how-are-you, a what-can-you-do, a joke, or an aside. Answer the person, not a database.",
  '',
  '## Rules',
  '1. Reply to what they actually said, in one or two short sentences. If they ask how you are, answer it. If they joke, joke back.',
  '2. Mirror their energy. If they\'re playful or use an emoji, you can be playful and use one too (one, tops). If they\'re plain, stay plain.',
  '3. You are Daylens — you help them see what they actually did on their computer. Mention that once, naturally, only when it fits. Never recite a list of things you can do.',
  '4. You were handed no activity this turn, so never state a time, app, page, mood, or accomplishment, and never invent one.',
  "5. Don't interrogate. Avoid clarifying questions when you can reasonably just respond — one warm line beats a quiz. (When they actually want their day, the planner already routes that elsewhere, so you don't need to ask which timeframe.)",
  '6. Never formal, never overexcited, no "great question", no pet names.',
  '',
  'The register to aim for:',
  '"hey, how\'s it going? 😄" → "Hey — doing good, thanks 😄 What\'d you get up to today?"',
  '"why are you not excited to see me?" → "Ha — I am, in my own quiet way. What\'s on your mind?"',
].join('\n')

// A whole-message greeting or check-in — "hi", "hey there", "how's it going",
// "good morning". Anchored end to end so "hey, what did I do today?" does NOT
// match: that one has real content and belongs to the planner.
const GREETING_RE =
  /^(?:hey+|hi+|hello+|hiya|helo|howdy|yo|sup|test|testing|good\s+(?:morning|afternoon|evening|day))[\s,!?.–—-]*$/i

const CHECK_IN_RE =
  /^(?:(?:hey|hi|hello|yo|sup)[\s,!?.–—-]+)?(?:how(?:['’]?s|\s+is|\s+are|\s+r)?\s+(?:it\s+going|your\s+day(?:\s+going)?|things|life|you(?:\s+doing)?|ya|u)|what['’]?s\s+up|wassup)\s*[!?.]*$/i

/**
 * True when the whole message is just a greeting or a check-in, so we can answer
 * it with one `converse` call and skip the planner round-trip entirely. Real
 * questions that merely open with "hey" fall through to the planner.
 */
export function looksLikeGreeting(message: string): boolean {
  const normalized = message.trim().replace(/\s+/g, ' ')
  if (!normalized || normalized.length > 80) return false
  return GREETING_RE.test(normalized) || CHECK_IN_RE.test(normalized)
}

export async function converse(params: {
  message: string
  runner: ConverseRunner
  prior?: Array<{ role: 'user' | 'assistant'; content: string }>
  onDelta?: (delta: string) => void | Promise<void>
  /** Per-thread extra instructions (D4), appended to the system prompt. */
  extraSystem?: string
}): Promise<string> {
  const trace = getCurrentTrace()
  const { text } = await executeTextAIJob(
    {
      jobType: 'chat_answer',
      screen: 'ai_chat',
      triggerSource: 'user',
      systemPrompt: params.extraSystem ? `${CONVERSE_SYSTEM_PROMPT}${params.extraSystem}` : CONVERSE_SYSTEM_PROMPT,
      userMessage: params.message,
      prior: params.prior,
    },
    params.runner,
    { onDelta: params.onDelta },
  )
  const answer = text.trim()
  if (trace) trace.addEvent({ kind: 'phrase_pass', input: '(conversation — no resolver mapped)', output: answer })
  return answer
}

export { CONVERSE_SYSTEM_PROMPT }
