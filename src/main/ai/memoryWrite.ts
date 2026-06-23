// The conversation write path for memory (memory.md §2.1). When the user tells
// Daylens to remember, forget, or correct something in plain chat, this turns
// that instruction into mem0-style ops (ADD / UPDATE / DELETE / NOOP) against
// the current memory. The service (workMemoryProfile.applyMemoryWriteOps) then
// writes them durably and records the audit.
//
// This is the AI taking an ACTION, not answering a data question — allowed, and
// distinct from the read-only resolvers (ai.md ADR 0002). The model only emits
// a constrained JSON of ops; it never touches the database.
import {
  executeTextAIJob,
  type AITextJobExecutionOptions,
  type ProviderTextResponse,
  type ResolvedProviderConfig,
} from '../services/aiOrchestration'
import type { MemoryWriteOp } from '../services/workMemoryProfile'

export type MemoryWriteRunner = (
  config: ResolvedProviderConfig,
  systemPrompt: string,
  prior: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
  options: AITextJobExecutionOptions,
) => Promise<ProviderTextResponse>

export interface CurrentFact {
  id: string
  text: string
}

const MEMORY_VERB_RE = /\b(remember|memoris|memoriz|note that|keep in mind|don'?t forget|for the record|make a note)\b/i
const FORGET_RE = /\b(forget|stop remembering|no longer|don'?t remember|erase that|delete that)\b/i
const CORRECTION_RE = /^\s*(actually|correction|to correct|that'?s (?:wrong|not right|incorrect)|no,? )/i

// Tight detector so we only spend a model call when the user is plausibly
// steering memory. A false positive is still safe — the extractor returns no
// ops and the chat falls through to the normal answer path — but we keep this
// narrow to avoid the extra round-trip on ordinary questions.
export function looksLikeMemoryInstruction(message: string): boolean {
  const m = message.trim()
  if (!m || m.length > 500) return false
  // Recall questions ("do you remember when…", "what do you remember") ask the
  // assistant to recall, not to write memory.
  if (/^(?:do you |you )?remember (?:when|that time|how|what|the time|if|whether)\b/i.test(m)) return false
  if (/\bwhat do you remember\b/i.test(m)) return false
  if (MEMORY_VERB_RE.test(m) || FORGET_RE.test(m)) return true
  if (CORRECTION_RE.test(m) && /\b(i|i'?m|i'?ve|my|me)\b/i.test(m)) return true
  return false
}

function buildExtractorPrompt(currentFacts: CurrentFact[]): string {
  const factLines = currentFacts.length > 0
    ? currentFacts.map((fact, i) => `${i + 1}. ${fact.text}`).join('\n')
    : '(none yet)'
  return [
    'You manage the long-term memory of a personal activity assistant called Daylens.',
    "You are given the user's latest message and the current memory facts (numbered).",
    'Decide what should change. Output ONLY a JSON object: {"ops":[ ... ]}. No prose, no code fences.',
    '',
    'Each op is exactly one of:',
    '  {"action":"add","text":"<one plain fact, second person>"}',
    '  {"action":"update","target":<fact number>,"text":"<the corrected fact>"}',
    '  {"action":"delete","target":<fact number>}',
    '  {"action":"noop"}',
    '',
    'Rules:',
    '- Only act on a clear instruction to remember, forget, or correct something DURABLE about the user — their role, work, tools, clients, projects, or preferences.',
    '- "remember/note/keep in mind X" → add it (or update an existing fact if it revises one).',
    '- "forget/stop remembering/no longer/I don\'t … anymore" → delete the matching fact by its number.',
    '- "actually it\'s X, not Y" / "correction:" → update the matching fact\'s number (or add if nothing matches).',
    '- Write each fact as a short, plain sentence in SECOND person, present tense — e.g. "You work in Digital Operations at Andersen." — one fact per op.',
    '- Use the conversation so far to resolve "that"/"this" (e.g. right after you offered to remember something).',
    '- NEVER store a question, a one-off like "what did I do today", a transient state, or anything the user did not ask you to keep.',
    '- If nothing should change, output {"ops":[{"action":"noop"}]}.',
    '',
    'Current memory facts:',
    factLines,
  ].join('\n')
}

interface RawOp {
  action?: unknown
  target?: unknown
  text?: unknown
}

function sanitizeFactText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, 280)
  return cleaned.length > 0 ? cleaned : undefined
}

// Map the model's index-based ops onto durable ops with real fact ids. Indexes
// are 1-based against the `currentFacts` we showed it; out-of-range targets are
// dropped (for delete) or downgraded to an add (for update).
export function parseMemoryOps(raw: string, currentFacts: CurrentFact[]): MemoryWriteOp[] {
  const fenced = raw.replace(/```(?:json)?/gi, '').trim()
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let parsed: { ops?: unknown }
  try {
    parsed = JSON.parse(fenced.slice(start, end + 1)) as { ops?: unknown }
  } catch {
    return []
  }
  if (!Array.isArray(parsed.ops)) return []

  const ops: MemoryWriteOp[] = []
  for (const entry of parsed.ops as RawOp[]) {
    if (!entry || typeof entry !== 'object') continue
    const action = entry.action
    if (action === 'add') {
      const text = sanitizeFactText(entry.text)
      if (text) ops.push({ action: 'add', text })
    } else if (action === 'update') {
      const text = sanitizeFactText(entry.text)
      const idx = typeof entry.target === 'number' ? entry.target - 1 : -1
      const target = currentFacts[idx]
      if (!text) continue
      if (target) ops.push({ action: 'update', targetId: target.id, text })
      else ops.push({ action: 'add', text })
    } else if (action === 'delete') {
      const idx = typeof entry.target === 'number' ? entry.target - 1 : -1
      const target = currentFacts[idx]
      if (target) ops.push({ action: 'delete', targetId: target.id })
    }
    // action === 'noop' (or anything unknown) → no op
  }
  return ops
}

export async function extractMemoryOps(params: {
  message: string
  currentFacts: CurrentFact[]
  runner: MemoryWriteRunner
  prior?: Array<{ role: 'user' | 'assistant'; content: string }>
}): Promise<MemoryWriteOp[]> {
  let text = ''
  try {
    const result = await executeTextAIJob(
      {
        jobType: 'chat_answer',
        screen: 'ai_chat',
        triggerSource: 'user',
        systemPrompt: buildExtractorPrompt(params.currentFacts),
        userMessage: params.message,
        prior: params.prior,
      },
      params.runner,
    )
    text = result.text
  } catch {
    return []
  }
  return parseMemoryOps(text, params.currentFacts)
}
