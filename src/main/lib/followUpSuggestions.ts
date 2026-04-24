import type {
  AIAnswerKind,
  AIConversationState,
  FollowUpAffordance,
  FollowUpSuggestion,
} from '@shared/types'

function titleCaseTopic(topic: string | null): string | null {
  if (!topic) return null
  return topic
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

const ENTITY_STOP_WORDS = new Set([
  'ai',
  'based',
  'daylens',
  'direct',
  'from',
  'tracked',
  'your',
])

function normalizeSuggestion(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

const GENERIC_REJECT_PHRASES = [
  'tell me more',
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
]

function validSuggestion(text: string): boolean {
  const normalized = normalizeSuggestion(text)
  if (!normalized) return false
  if (normalized.split(/\s+/).length > 8) return false
  const lower = normalized.toLowerCase()
  return !GENERIC_REJECT_PHRASES.includes(lower)
}

// Model-generated suggestions must name a specific app, file, page, or entity.
// Accepts suggestions that contain a mid-sentence capitalized word (proper noun)
// or a filename-like token (e.g. "index.ts", "Cursor", "Notion").
function hasNamedEntity(text: string): boolean {
  const words = text.trim().split(/\s+/)
  if (words.length < 2) return false
  return (
    words.slice(1).some((w) => /^[A-Z][a-z]/.test(w)) ||
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

function answerEntity(answerText: string | null | undefined): string | null {
  if (!answerText) return null
  const filename = answerText.match(/\b[\w.-]+\.\w{1,8}\b/)?.[0]
  if (filename) return filename

  const matches = answerText.match(/\b[A-Z][A-Za-z0-9][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9][A-Za-z0-9_-]*){0,2}\b/g) ?? []
  for (const match of matches) {
    const normalized = match.trim()
    if (normalized.length < 3) continue
    if (ENTITY_STOP_WORDS.has(normalized.toLowerCase())) continue
    return normalized
  }
  return null
}

function scopedCandidates(entity: string, state: AIConversationState | null): FollowUpSuggestion[] {
  const compareTarget = state?.dateRange?.label?.toLowerCase().includes('last week')
    ? 'this week'
    : 'yesterday'
  return [
    candidate(`What drove ${entity}?`, 'deepen'),
    candidate(`Which windows mention ${entity}?`, 'narrow'),
    candidate(`What overlapped with ${entity}?`, 'expand'),
    candidate(`Compare ${entity} with ${compareTarget}`, 'compare'),
  ]
}

export function buildDeterministicFollowUpCandidates(
  answerKind: AIAnswerKind,
  state: AIConversationState | null,
  answerText?: string | null,
): FollowUpSuggestion[] {
  const topic = titleCaseTopic(state?.topic ?? null) ?? answerEntity(answerText)
  if (topic) return dedupeSuggestions(scopedCandidates(topic, state)).slice(0, 4)

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
      if (topic) suggestions.unshift(candidate(`Go deeper on ${topic}`, 'deepen'))
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

  return dedupeSuggestions(suggestions).filter((suggestion) => hasNamedEntity(suggestion.text)).slice(0, 6)
}

export function buildFollowUpSuggestionPrompts(
  userQuestion: string,
  answerText: string,
  state: AIConversationState | null,
  candidates: FollowUpSuggestion[],
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    'You write Google-style recommended next questions for Daylens.',
    'Return strict JSON with a single key "suggestions".',
    '"suggestions" must be an array of 3 or 4 short follow-up questions.',
    'Each suggestion must be at most 8 words.',
    'IMPORTANT: every suggestion must name a specific app, file, page, or entity that appeared in the answer.',
    'For example: "How much time in Cursor?" or "Which Notion pages appeared?".',
    'Never write entity-free suggestions like "Tell me more", "What stood out?", "Go deeper", or "What evidence supports that?".',
    'Stay inside the current topic and time scope unless comparison is explicitly useful.',
  ].join(' ')

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
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((value): value is string => typeof value === 'string')
      : []
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
