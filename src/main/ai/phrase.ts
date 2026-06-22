// The phrase step (ADR 0002, ai.md §4 step 3). The model is handed ONLY the
// facts the resolvers returned, plus the question, and writes the answer in the
// Daylens voice using the format that fits (prose / table / bullets). It does
// not decide what is true — it narrates what it was handed. No fetching, no
// tools, no loop.
import {
  executeTextAIJob,
  type AITextJobExecutionOptions,
  type ProviderTextResponse,
  type ResolvedProviderConfig,
} from '../services/aiOrchestration'
import { VOICE_SYSTEM_PROMPT } from './voiceContract'
import { getCurrentTrace } from './trace'
import { serializeFact, type ResolvedFact } from './resolvers'

type PhraseRunner = (
  config: ResolvedProviderConfig,
  systemPrompt: string,
  prior: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
  options: AITextJobExecutionOptions,
) => Promise<ProviderTextResponse>

const PHRASE_SYSTEM_PROMPT = [
  VOICE_SYSTEM_PROMPT,
  '',
  '## Your job: write the answer from the FACTS below',
  'The FACTS were resolved from the user\'s real local activity. They are the ONLY truth you have. Narrate them — never invent, never fetch, never ask the user to supply anything.',
  '',
  '## Rules',
  '1. Lead with the answer. No preamble, no restating the question, no "based on the data".',
  '2. Every number, time, app, page, and label you state must appear in the FACTS verbatim. Do not round or invent.',
  '3. Pick the format that fits:',
  '   - A breakdown of time per day / per app / per project → a real Markdown table (| header | … | with a |---| separator row). Lead with one sentence, then the table.',
  '   - A single answer or a link/page recall → short grounded prose (1–3 sentences).',
  '   - A handful of distinct items → bullets only if that reads better than prose.',
  '4. For a link/page recall, name the best match — title, site, when, how long — and include the URL on its own line if the FACTS have one.',
  '5. If the FACTS say there is no/low activity, say so plainly in one calm line. Never apologize, never pad with "likely", never beg for context.',
  '6. If the FACTS flag that no projects are set up, give the inferred breakdown AND offer to set up named projects in Settings. Never dead-end.',
  '7. Never claim editing/writing/intent — only that an app or window was open or a page was seen. No emoji.',
].join('\n')

export async function phraseAnswer(
  params: {
    question: string
    facts: ResolvedFact[]
    runner: PhraseRunner
    onDelta?: (delta: string) => void | Promise<void>
    prior?: Array<{ role: 'user' | 'assistant'; content: string }>
    /** Per-thread extra instructions (D4), appended to the system prompt. */
    extraSystem?: string
  },
): Promise<string> {
  const factsBlock = params.facts.map(serializeFact).join('\n\n')
  const userMessage = `Question: ${params.question}\n\nFACTS:\n${factsBlock}`
  const trace = getCurrentTrace()
  const { text } = await executeTextAIJob(
    {
      jobType: 'chat_answer',
      screen: 'ai_chat',
      triggerSource: 'user',
      systemPrompt: params.extraSystem ? `${PHRASE_SYSTEM_PROMPT}${params.extraSystem}` : PHRASE_SYSTEM_PROMPT,
      userMessage,
      prior: params.prior,
    },
    params.runner,
    { onDelta: params.onDelta },
  )
  const answer = text.trim()
  if (trace) trace.addEvent({ kind: 'phrase_pass', input: factsBlock, output: answer })
  return answer
}
