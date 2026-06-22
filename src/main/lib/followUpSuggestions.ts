import type {
  AIAnswerKind,
  AIConversationState,
  FollowUpAffordance,
  FollowUpSuggestion,
} from '@shared/types'

const ENTITY_STOP_WORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  'it', 'its', 'my', 'your', 'our', 'his', 'her', 'their',
  'i', 'we', 'he', 'she', 'they', 'you', 'me', 'us', 'him',
  'hi', 'hey', 'hello', 'sup', 'ok', 'okay', 'yes', 'no', 'sure',
  'can', 'could', 'would', 'will', 'should', 'may', 'might',
  'what', 'which', 'where', 'when', 'how', 'why', 'who',
  'all', 'any', 'some', 'more', 'most', 'many', 'much', 'few',
  'new', 'old', 'good', 'great', 'best', 'just', 'now', 'here', 'there',
  'also', 'then', 'let', 'use', 'ask', 'help', 'want', 'need',
  'ai', 'based', 'daylens', 'direct', 'from', 'tracked',
  'e.g', 'i.e', 'etc', 'vs', 'ex',
  // Temporal words that appear capitalized at sentence start but are not entities
  'today', 'yesterday', 'tomorrow',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'morning', 'afternoon', 'evening', 'week', 'month', 'year',
  // Structural words from router answer headers
  'found', 'local', 'evidence', 'data',
])

// Q3: provider / model / product names must never be templated into a
// "How long on X?" data-entity chip (the "How long on Google Gemini?" bug).
// These are meta-entities, not things the user did.
const META_ENTITIES = new Set([
  'daylens', 'gemini', 'google gemini', 'google', 'anthropic', 'claude',
  'openai', 'gpt', 'chatgpt', 'openrouter', 'codex', 'copilot', 'llm', 'ai',
])

const META_ENTITY_RE = /\b(gemini|gpt|chatgpt|claude|opus|sonnet|haiku|openrouter|codex|llama|mistral|flash[-\s]?lite|flash)\b/i

function isMetaEntity(name: string): boolean {
  const lower = name.trim().toLowerCase()
  if (META_ENTITIES.has(lower)) return true
  return META_ENTITY_RE.test(lower)
}

// Q3: an identity / "what model are you" answer has no data entities worth
// templating — return no chips rather than dumb ones.
export function isIdentityAnswer(answerText: string): boolean {
  const lower = answerText.toLowerCase()
  return /\brouted through\b|\bi am daylens\b|\bi'm daylens\b|powering this chat|which model|language model|powered by|\bmodel\b.*\bdaylens\b|\bdaylens\b.*\bmodel\b/.test(lower)
}

function normalizeSuggestion(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

const GENERIC_REJECT_PHRASES = [
  'tell me more',
  'tell me more about that',
  'anything else',
  'go on',
  'continue',
  'what stood out most',
  'can you be more specific',
  'what evidence supports that',
  'be more specific',
  'say more',
  'expand on that',
  'more details',
  'keep going',
  'what else',
  'is there anything else',
  'tell me about it',
  'go ahead',
  'explain',
  'explain that',
  'can you explain',
]

const TEMPORAL_REJECT_RE = /\b(today|yesterday|tomorrow|this week|last week|next week|this month|last month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening)\b/i
const GREETING_RE = /\b(hi|hey|hello|thanks|thank you)\b/i

export type QuestionShape = 'time' | 'specific_work' | 'cross_cutting' | 'reflective' | 'generative'

export interface FollowUpFilterReport {
  suggestions: FollowUpSuggestion[]
  rejectedByRule: Record<'temporal' | 'greeting' | 'generic' | 'entity' | 'shape' | 'invalid' | 'duplicate', number>
}

function validSuggestion(text: string): boolean {
  const normalized = normalizeSuggestion(text)
  if (!normalized) return false
  if (normalized.split(/\s+/).length > 8) return false
  const lower = normalized.toLowerCase()
  return !GENERIC_REJECT_PHRASES.includes(lower)
}

export function classifyQuestionShape(text: string): QuestionShape {
  const lower = text.toLowerCase()
  if (/\b(how long|how much time|how many hours|spent|duration|when did|longest stretch|gap between)\b/.test(lower)) {
    return 'time'
  }
  if (/\b(write|draft|summari[sz]e|turn .* into|status update|journal|paragraph|recap)\b/.test(lower)) {
    return 'generative'
  }
  if (/\b(show me|which files|which docs|which pages|which windows|what did i work on|what was i doing|what did i do for|for .+)\b/.test(lower)) {
    return 'specific_work'
  }
  if (/\b(compare|trend|rhythm|losing momentum|ratio|pattern|across|vs|versus|best deep work)\b/.test(lower)) {
    return 'cross_cutting'
  }
  return 'reflective'
}

function answerEntityTokens(answerText: string): Set<string> {
  const tokens = new Set<string>()
  const candidates = answerText.match(/\b[A-Za-z0-9][A-Za-z0-9_.-]{2,}\b/g) ?? []
  for (const raw of candidates) {
    const token = raw.toLowerCase().replace(/^[^\w]+|[^\w.:-]+$/g, '')
    if (token.length < 3) continue
    if (ENTITY_STOP_WORDS.has(token)) continue
    if (/^\d+$/.test(token)) continue
    tokens.add(token)
  }
  return tokens
}

function containsAnswerEntity(candidateText: string, answerTokens: Set<string>): boolean {
  if (answerTokens.size === 0) return false
  const lower = candidateText.toLowerCase()
  return [...answerTokens].some((token) => lower.includes(token))
}

export function filterFollowUpCandidatesWithReport(
  answerText: string,
  candidates: FollowUpSuggestion[],
  justAnsweredShape?: QuestionShape | null,
): FollowUpFilterReport {
  const rejectedByRule: FollowUpFilterReport['rejectedByRule'] = {
    temporal: 0,
    greeting: 0,
    generic: 0,
    entity: 0,
    shape: 0,
    invalid: 0,
    duplicate: 0,
  }
  const answerTokens = answerEntityTokens(answerText)
  const seen = new Set<string>()
  const usedShapes = new Set<QuestionShape>()
  const suggestions: FollowUpSuggestion[] = []

  for (const candidate of candidates) {
    const text = normalizeSuggestion(candidate.text)
    const key = text.toLowerCase()
    if (!validSuggestion(text)) {
      rejectedByRule.invalid += 1
      continue
    }
    if (seen.has(key)) {
      rejectedByRule.duplicate += 1
      continue
    }
    if (TEMPORAL_REJECT_RE.test(text)) {
      rejectedByRule.temporal += 1
      continue
    }
    if (GREETING_RE.test(text)) {
      rejectedByRule.greeting += 1
      continue
    }
    if (GENERIC_REJECT_PHRASES.some((phrase) => key.includes(phrase))) {
      rejectedByRule.generic += 1
      continue
    }
    if (!containsAnswerEntity(text, answerTokens)) {
      rejectedByRule.entity += 1
      continue
    }
    const shape = classifyQuestionShape(text)
    if (justAnsweredShape && shape === justAnsweredShape) {
      rejectedByRule.shape += 1
      continue
    }
    if (usedShapes.has(shape)) {
      rejectedByRule.shape += 1
      continue
    }
    seen.add(key)
    usedShapes.add(shape)
    suggestions.push({ ...candidate, text })
  }

  return { suggestions: suggestions.slice(0, 4), rejectedByRule }
}

// Model-generated suggestions must name a specific app, file, page, or entity.
// Accepts suggestions that contain a mid-sentence capitalized word (proper noun)
// or a filename-like token (e.g. "index.ts", "Cursor", "Notion").
function hasNamedEntity(text: string): boolean {
  const words = text.trim().split(/\s+/)
  if (words.length < 2) return false
  return (
    words.slice(1).some((w) => /^[A-Z][a-z]/.test(w) && !ENTITY_STOP_WORDS.has(w.toLowerCase().replace(/\W+$/, ''))) ||
    /\b\w+\.\w{1,6}\b/.test(text)
  )
}

function dedupeSuggestions(items: FollowUpSuggestion[]): FollowUpSuggestion[] {
  const seen = new Set<string>()
  const deduped: FollowUpSuggestion[] = []
  for (const item of items) {
    const normalized = normalizeSuggestion(item.text)
    const key = normalized.toLowerCase()
    if (!validSuggestion(normalized) || seen.has(key)) continue
    seen.add(key)
    deduped.push({ ...item, text: normalized })
  }
  return deduped
}

function candidate(text: string, affordance: FollowUpAffordance): FollowUpSuggestion {
  return { text, source: 'deterministic', affordance }
}

// Pull up to `max` distinct, real (non-meta, non-stop-word) entities from the
// answer — apps, domains, files, proper nouns. Drives grounded follow-up chips
// without a provider call (R1).
export function extractAnswerEntities(answerText: string | null | undefined, max = 3): string[] {
  if (!answerText) return []
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: string): void => {
    const value = raw.trim()
    const key = value.toLowerCase()
    if (value.length < 3 || seen.has(key)) return
    if (ENTITY_STOP_WORDS.has(key)) return
    if (key.includes(' ') && value.split(' ').some((w) => ENTITY_STOP_WORDS.has(w.toLowerCase()))) return
    if (isMetaEntity(value)) return
    seen.add(key)
    out.push(value)
  }
  // Filenames first (e.g. index.ts, schema.sql) — ≥2 chars each side of the dot.
  for (const filename of answerText.match(/\b\w{2,}\.\w{2,8}\b/g) ?? []) push(filename)
  // Then capitalized proper nouns (apps, projects, people).
  for (const match of answerText.match(/\b[A-Z][A-Za-z0-9][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9][A-Za-z0-9_-]*){0,2}\b/g) ?? []) push(match)
  return out.slice(0, max)
}

// FB10: the deterministic builder no longer templates entity nouns into
// "How long on ${X}?" chips — that stray-noun templating is exactly what produced
// "How long on Top?" (Top was a section-header word). It now returns generic,
// shape-varied SEEDS only. They guide the model follow-up generator; the
// grounding filter drops them as final output, so a turn shows real
// model-generated follow-ups or none.
export function buildDeterministicFollowUpCandidates(
  answerKind: AIAnswerKind,
  state: AIConversationState | null,
  answerText?: string | null,
): FollowUpSuggestion[] {
  void answerText
  const rangeLabel = state?.dateRange?.label?.toLowerCase().includes('last week') ? 'last week' : 'this week'
  const suggestions: FollowUpSuggestion[] = []

  switch (answerKind) {
    case 'weekly_brief':
      suggestions.push(
        candidate('Go deeper on the main themes', 'deepen'),
        candidate('Exactly what did I read?', 'literalize'),
        candidate('What was active work vs reading?', 'narrow'),
        candidate(rangeLabel === 'last week' ? 'Compare this with this week' : 'Compare this with last week', 'compare'),
      )
      break
    case 'weekly_literal_list':
      suggestions.push(
        candidate('Which of these were AI-related?', 'narrow'),
        candidate('What did I spend longest on?', 'expand'),
        candidate('Show only browser pages', 'narrow'),
        candidate('What was noise vs signal?', 'expand'),
      )
      break
    case 'deterministic_stats':
      suggestions.push(
        candidate('What drove this result?', 'deepen'),
        candidate('Which apps shaped it most?', 'expand'),
        candidate('How did the day break down?', 'expand'),
        candidate(rangeLabel === 'last week' ? 'Compare this with this week' : 'Compare this with yesterday', 'compare'),
      )
      break
    case 'day_summary_style':
      suggestions.push(
        candidate('What did I actually finish?', 'expand'),
        candidate('Which files or pages mattered?', 'narrow'),
        candidate('Where did focus break down?', 'deepen'),
        candidate('What should I pick up next?', 'repair'),
      )
      break
    case 'freeform_chat':
      suggestions.push(
        candidate('Can you be more specific?', 'repair'),
        candidate('What evidence supports that?', 'deepen'),
        candidate('What stood out most?', 'deepen'),
        candidate('Compare that with yesterday', 'compare'),
      )
      break
    case 'error':
    default:
      break
  }

  return dedupeSuggestions(suggestions).slice(0, 6)
}

export function buildFollowUpSuggestionPrompts(
  userQuestion: string,
  answerText: string,
  state: AIConversationState | null,
  candidates: FollowUpSuggestion[],
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You generate follow-up question chips for Daylens, a local screen-time and productivity tracker.

OUTPUT FORMAT
Return only valid JSON: { "suggestions": ["...", "...", "..."] }
No markdown, no explanation.

RULES
1. Return 3–4 suggestions, or [] if the answer is a greeting or contains no productivity data.
2. Each suggestion must be ≤8 words.
3. Every suggestion must reference a specific named entity that appears in the answer — an app (Cursor, Chrome, Notion), a file, a page title, a person, a project, or a domain. Do not invent names; pull them from the answer text.
4. Vary the question type across suggestions: one about time/duration, one about specific content (windows, pages, files), one about comparison or trend, one about cause or breakdown.
5. Ground each suggestion in what the answer actually said. Do not ask about something the answer did not mention.
6. Prefer the WORK as the subject — a project, page, file, task, person, or a specific number / time range from the answer ("Break down the 4h 8m repo session", "Which days was Coursera my main focus?"). Never make a bare app / provider / model name the subject of a "how long on X" question, and never template from a section-header word ("Top work threads" must not become "How long on Top?").
7. Forbidden phrases (never use): "Tell me more", "What stood out", "Go deeper", "What else", "Can you explain", "What evidence", "Say more", "Expand on", "Be more specific", "Continue".
8. Forbidden patterns: fragment suggestions like "What drove The?" or "Which windows mention Hey?" — these indicate a stop-word or header word leaked into the entity slot. If you cannot name a real entity, number, or timeframe from the answer, return [].

GOOD EXAMPLES
"Which days was Coursera my main focus?"
"Break down the 4h 8m Daylens repo session."
"How does this week's 31% focus compare to last week?"
"Export this 7-day summary as a CSV."
"What pulled me off task on May 31?"
"What was the Study Planner page about?"

BAD EXAMPLES (never produce these)
"How long on Top?" — section-header word, not a real entity
"What drove The?" — stop word in entity slot
"Draft a short note on Notion" — treats the tool as the subject
"Tell me more about that" — generic filler
"What else happened?" — vague`

  const userPrompt = JSON.stringify({
    userQuestion,
    answerPreview: answerText.slice(0, 1_500),
    conversationState: state,
    candidateSuggestions: candidates.map((item) => item.text),
  }, null, 2)

  return { systemPrompt, userPrompt }
}

export function parseFollowUpSuggestions(
  raw: string,
  fallback: FollowUpSuggestion[],
): FollowUpSuggestion[] {
  const normalized = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  if (!normalized) return dedupeSuggestions(fallback).slice(0, 4)

  try {
    const parsed = JSON.parse(normalized) as { suggestions?: unknown }
    if (!Array.isArray(parsed.suggestions)) return dedupeSuggestions(fallback).slice(0, 4)
    // Model explicitly returned empty — no good suggestions for this response.
    if (parsed.suggestions.length === 0) return []
    const suggestions = parsed.suggestions.filter((value): value is string => typeof value === 'string')
    const rewritten = dedupeSuggestions(
      suggestions
        .filter((text) => hasNamedEntity(text))
        .map((text) => ({ text, source: 'model' as const })),
    )
    if (rewritten.length >= 2) return rewritten.slice(0, 4)
  } catch {
    // Fall through to deterministic suggestions.
  }

  return dedupeSuggestions(fallback).slice(0, 4)
}
