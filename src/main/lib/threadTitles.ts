import type { AIAnswerKind } from '@shared/types'

export interface ThreadTitleContext {
  answerKind?: AIAnswerKind | null
  entityName?: string | null
  entityIntent?: string | null
  weeklyBriefIntent?: string | null
}

export const DEFAULT_THREAD_TITLE = 'New chat'

const MAX_THREAD_TITLE_LENGTH = 60
// Q5: Raycast-style thread titles are short (2–5 words). Cap the word count so a
// long first message produces a crisp title, not a 60-character clause.
const MAX_THREAD_TITLE_WORDS = 6

const GENERIC_TITLES = new Set([
  'new chat',
  'untitled chat',
  'chat',
  'thread',
  'conversation',
  'hi',
  'hey',
  'hello',
  'sup',
  'yo',
  'ok',
  'okay',
  'sure',
  'thanks',
  'thank you',
  'yes',
  'no',
])

const WEAK_TITLE_PREFIXES = [
  /^(?:please\s+)?(?:can|could|would|will)\s+you\b/i,
  /^(?:please\s+)?(?:show|tell|give|help|summarize|sum up|explain|compare|review|create|make|draft|turn|generate|write|export)\b/i,
  /^(?:please\s+)?(?:what|how|why|when|where|which)\b/i,
]

const FILLER_PREFIXES = [
  // FB6: strip "in detail" / "in full" lead-ins before the real verb.
  /^(?:please\s+)?in\s+(?:full\s+)?detail[,:]?\s+/i,
  /^(?:please\s+)?in\s+full[,:]?\s+/i,
  /^(?:please\s+)?(?:can|could|would|will)\s+you\s+/i,
  /^(?:please\s+)?(?:show|tell|give|help|summarize|sum up|explain|compare|review|create|make|draft|turn|generate|write|export)\s+(?:me\s+)?/i,
  /^(?:please\s+)?i\s+(?:want|need|would like)\s+(?:to\s+)?/i,
  /^(?:please\s+)?let(?:'s| us)\s+/i,
]

// FB6: a title must never be a bare stopword/timeframe ("today", "the week").
// If a derived title collapses to only these, fall back to a topic phrase.
const BARE_WEAK_WORDS = new Set([
  'today', 'yesterday', 'tomorrow', 'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years',
  'this', 'that', 'last', 'next', 'the', 'a', 'an', 'my', 'me', 'i', 'it', 'all', 'everything',
  'stuff', 'things', 'thing', 'now', 'recent', 'recently',
  'morning', 'afternoon', 'evening', 'night',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
])

function isBareWeakPhrase(value: string): boolean {
  const words = collapseWhitespace(value).toLowerCase().replace(/['’?.!,…]/g, '').split(' ').filter(Boolean)
  if (words.length === 0) return true
  return words.every((word) => BARE_WEAK_WORDS.has(word))
}

function timeframeWordCased(normalized: string): string | null {
  if (/\btoday\b/.test(normalized)) return 'Today'
  if (/\byesterday\b/.test(normalized)) return 'Yesterday'
  if (/\bthis week\b/.test(normalized)) return 'This week'
  if (/\blast week\b/.test(normalized)) return 'Last week'
  if (/\bthis month\b/.test(normalized)) return 'This month'
  if (/\blast month\b/.test(normalized)) return 'Last month'
  return null
}

const WEEKDAY_NAMES = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

function weekdayWordCased(normalized: string): string | null {
  for (const day of WEEKDAY_NAMES) {
    if (new RegExp(`\\b${day}\\b`).test(normalized)) {
      return day.charAt(0).toUpperCase() + day.slice(1)
    }
  }
  return null
}

/** Prefer a named weekday ("Tuesday") over a relative timeframe ("Today"). */
function topicTimeAnchor(normalized: string): string | null {
  return weekdayWordCased(normalized) ?? timeframeWordCased(normalized)
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[\s?!.,;:]+$/g, '')
}

function titleCase(value: string): string {
  // Capitalize the first letter of each space-separated word only — never after
  // an apostrophe/hyphen, so "today's work" → "Today's Work", not "Today'S Work".
  return value.replace(/(^|\s)([a-z])/g, (_, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`)
}

function trimTitle(value: string): string {
  const normalized = collapseWhitespace(stripTrailingPunctuation(value))

  // Q5: cap the word count first so a long first message yields a short, clean
  // title. The trailing ellipsis keeps it detectable as weak (isWeakThreadTitle)
  // so a later, cleaner message can upgrade it.
  const allWords = normalized.split(' ')
  if (allWords.length > MAX_THREAD_TITLE_WORDS) {
    return `${allWords.slice(0, MAX_THREAD_TITLE_WORDS).join(' ')}…`
  }

  if (normalized.length <= MAX_THREAD_TITLE_LENGTH) return normalized

  const words = normalized.split(' ')
  let output = ''
  for (const word of words) {
    const candidate = output ? `${output} ${word}` : word
    if (candidate.length > MAX_THREAD_TITLE_LENGTH - 1) break
    output = candidate
  }

  const clipped = output || normalized.slice(0, MAX_THREAD_TITLE_LENGTH - 1).trimEnd()
  return `${clipped}…`
}

function timeframePrefix(normalized: string): 'Daily' | 'Weekly' | 'Monthly' | null {
  if (/\b(today|yesterday|day)\b/.test(normalized)) return 'Daily'
  if (/\b(this week|last week|week)\b/.test(normalized)) return 'Weekly'
  if (/\b(this month|last month|month)\b/.test(normalized)) return 'Monthly'
  return null
}

function intentTitleFromContext(context?: ThreadTitleContext): string | null {
  const weeklyIntent = context?.weeklyBriefIntent ?? null
  if (weeklyIntent === 'weekly_browsing_reading_brief') return 'Weekly reading recap'
  if (weeklyIntent === 'weekly_topic_exploration_brief') return 'Weekly exploration recap'
  if (weeklyIntent === 'weekly_deepen_followup') return 'Weekly follow-up'

  const entityName = collapseWhitespace(context?.entityName ?? '')
  const entityIntent = context?.entityIntent ?? null
  if (entityName && entityIntent === 'invoice') return trimTitle(`${entityName} invoice`)
  if (entityName && entityIntent === 'time') return trimTitle(`Time on ${entityName}`)
  if (entityName && entityIntent === 'timeline') return trimTitle(`${entityName} timeline`)
  if (entityName && entityIntent === 'appBreakdown') return trimTitle(`${entityName} apps`)
  if (entityName && entityIntent === 'evidence') return trimTitle(`${entityName} evidence`)
  if (entityName && entityIntent === 'ambiguity') return trimTitle(`${entityName} attribution`)

  if (context?.answerKind === 'generated_report') return 'Report'
  return null
}

function intentTitleFromPrompt(message: string): string | null {
  const normalized = collapseWhitespace(message).toLowerCase()
  if (!normalized) return null

  const timeframe = timeframePrefix(normalized)
  const prefix = timeframe ?? ''

  if ((/\b(review|reflect|reflection|recap)\b/.test(normalized) && /\bfocus(?:\s+session)?\b/.test(normalized))) {
    return 'Focus review'
  }
  if ((/\b(start|begin|kick off|set up|launch|resume)\b/.test(normalized) && /\bfocus(?:\s+session)?\b/.test(normalized))) {
    return 'Start focus session'
  }
  if ((/\b(stop|end|finish|wrap up|close|complete)\b/.test(normalized) && /\bfocus(?:\s+session)?\b/.test(normalized))) {
    return 'Stop focus session'
  }
  if (/\bfocus(?:\s+session)?\b/.test(normalized)) {
    return 'Focus session'
  }

  // FB6: "what did I work on / do <timeframe>" must become a real topic phrase
  // ("Today's work"), never the bare timeframe word ("today").
  if (
    /\bwork(?:ed)?\s+on\b/.test(normalized)
    || /\b(?:get|got)\s+done\b/.test(normalized)
    || /\baccomplish/.test(normalized)
    || /\bwhat\s+did\s+i\s+do\b/.test(normalized)
  ) {
    const tf = topicTimeAnchor(normalized)
    if (tf) return `${tf}'s work`
  }

  // Moment / watching questions must never keep the raw "What was I watching…"
  // clause — that truncates with an ellipsis and stays forever-weak, so the
  // sidebar never upgrades past the first prompt fragment.
  if (
    /\bwatch(?:ing|ed)?\b|\bvideo(?:s)?\b/.test(normalized)
    || /\blooking at\b/.test(normalized)
    || /\bwhat page\b/.test(normalized)
    || /\bpage was i on\b/.test(normalized)
  ) {
    const tf = topicTimeAnchor(normalized)
    const noun = /\bwatch(?:ing|ed)?\b|\bvideo(?:s)?\b/.test(normalized) ? 'watching' : 'page'
    if (tf) return noun === 'watching' ? `${tf} watching` : `${tf} page`
    return noun === 'watching' ? 'Watching' : 'Page'
  }

  // FB6: "when was I most focused this week" → "This week focus", not a clipped clause.
  if (/\bfocused\b|\bdeep work\b/.test(normalized)) {
    const tf = topicTimeAnchor(normalized)
    if (tf) return `${tf} focus`
  }

  // Podcasts / listening questions ("what podcasts did I listen to this month")
  // must become a topic phrase, never the clipped question.
  if (/\bpodcasts?\b/.test(normalized)) {
    const tf = topicTimeAnchor(normalized)
    return tf ? `Podcasts ${tf.toLowerCase()}` : 'Podcasts'
  }
  if (/\blisten(?:ed|ing)?\b/.test(normalized)) {
    const tf = topicTimeAnchor(normalized)
    return tf ? `${tf} listening` : 'Listening'
  }

  // "What did I ship / build / commit this month" → "Shipped this month".
  if (/\bship(?:ped|ping)?\b/.test(normalized) || /\bcommit(?:s|ted)?\b/.test(normalized)) {
    const tf = topicTimeAnchor(normalized)
    return tf ? `Shipped ${tf.toLowerCase()}` : 'Shipped'
  }

  if (/\bexport\b|\bdownload\b/.test(normalized)) {
    return prefix ? `${prefix} export` : 'Export'
  }
  if (/\bchart\b|\bgraph\b|\bplot\b/.test(normalized)) {
    return prefix ? `${prefix} chart` : 'Chart'
  }
  if (/\btable\b|\bcsv\b|\bspreadsheet\b/.test(normalized)) {
    return prefix ? `${prefix} table` : 'Table'
  }
  if (/\breport\b/.test(normalized) || /\bshareable\b/.test(normalized)) {
    return prefix ? `${prefix} report` : 'Report'
  }
  if (/\brecap\b|\bsummary\b/.test(normalized)) {
    return prefix ? `${prefix} recap` : 'Recap'
  }

  return null
}

function extractSubjectTitle(message: string): string | null {
  let cleaned = collapseWhitespace(message)
  if (!cleaned) return null

  let changed = true
  while (changed) {
    changed = false
    for (const pattern of FILLER_PREFIXES) {
      const next = cleaned.replace(pattern, '')
      if (next !== cleaned) {
        cleaned = collapseWhitespace(next)
        changed = true
      }
    }
  }

  const specificPatterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    // FB6: "everything I did/touched on this laptop" → "Everything I did".
    [/\beverything i (?:did|touched|worked on|got done)\b(?!\s+for\b)/i, () => 'Everything I did'],
    [/\beverything i touched for\s+(.+?)(?:\b(?:today|yesterday|this week|last week|this month|last month)\b|[?.!]|$)/i, (match) => match[1] ?? ''],
    [/\b(?:time|hours?) (?:did i spend|i spent|spent)\s+on\s+(.+?)(?:\b(?:today|yesterday|this week|last week|this month|last month)\b|[?.!,]|$)/i, (match) => `Time on ${match[1] ?? ''}`],
    [/\b(?:my\s+)?time on\s+(.+?)(?:\b(?:today|yesterday|this week|last week|this month|last month)\b|[?.!,]|$)/i, (match) => `Time on ${match[1] ?? ''}`],
    [/\b(?:tell me more about|more about|details on|work on|about)\s+(.+?)(?:\b(?:today|yesterday|this week|last week|this month|last month)\b|[?.!,]|$)/i, (match) => match[1] ?? ''],
  ]

  for (const [pattern, mapMatch] of specificPatterns) {
    const match = cleaned.match(pattern)
    if (match) {
      const candidate = collapseWhitespace(mapMatch(match))
      return candidate ? trimTitle(candidate) : null
    }
  }

  cleaned = cleaned
    .replace(/^(?:my|a|an|the)\s+/i, '')
    .replace(/^(?:short|quick|brief|shareable)\s+/i, '')
    .replace(/^(?:report|summary|recap)\s+(?:about|of)\s+/i, '')

  const firstClause = cleaned.split(/[.?!]/, 1)[0] ?? cleaned
  const candidate = trimTitle(firstClause)
  if (!candidate) return null
  // Capitalize the leading word so "last 7 days by project" → "Last 7 days by project".
  return candidate.charAt(0).toUpperCase() + candidate.slice(1)
}

export function normalizeThreadTitle(title: string | null | undefined, fallback = DEFAULT_THREAD_TITLE): string {
  const normalized = collapseWhitespace(title ?? '')
  return normalized || fallback
}

export function isWeakThreadTitle(title: string | null | undefined): boolean {
  const normalized = normalizeThreadTitle(title, '').trim()
  if (!normalized) return true
  if (GENERIC_TITLES.has(normalized.toLowerCase())) return true
  if (normalized.endsWith('…')) return true
  // FB6: a bare stopword/timeframe ("today", "the week") is a weak title.
  if (isBareWeakPhrase(normalized)) return true
  return WEAK_TITLE_PREFIXES.some((pattern) => pattern.test(normalized))
}

export function deriveTitleFromMessage(message: string, context?: ThreadTitleContext): string {
  const normalized = collapseWhitespace(message)
  if (!normalized) return DEFAULT_THREAD_TITLE

  // Single-word greetings/fillers can't produce a meaningful title.
  // Return the default so the next real message can rename the thread.
  if (GENERIC_TITLES.has(normalized.toLowerCase())) return DEFAULT_THREAD_TITLE

  const intentTitle = intentTitleFromPrompt(normalized) ?? intentTitleFromContext(context)
  if (intentTitle) return trimTitle(titleCase(intentTitle))

  const extracted = extractSubjectTitle(normalized)
  if (extracted && !isBareWeakPhrase(extracted)) return extracted

  // FB6: never title a thread with a bare stopword/timeframe — keep the default
  // so a later, more specific message can rename it.
  const whole = trimTitle(normalized)
  if (isBareWeakPhrase(whole)) return DEFAULT_THREAD_TITLE
  return whole
}
