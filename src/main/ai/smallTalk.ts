import { VOICE_SYSTEM_PROMPT } from './voiceContract'

const SIMPLE_GREETING_RE =
  /^\s*(?:hey|hi|hello|howdy|hiya|helo|yo|sup|good\s+(?:morning|afternoon|evening)|test|testing)\s*[!?.]*\s*$/i

const CHECK_IN_RE =
  /^\s*(?:how(?:['’]s| is) it going|how are you|what(?:['’]s| is) up|how(?:['’]s| is) your day(?: going)?)\s*[!?.]*\s*$/i

const GREETING_WITH_CHECK_IN_RE =
  /^\s*(?:hey|hi|hello|howdy|hiya|helo|yo|sup|good\s+(?:morning|afternoon|evening))[\s,!?.—-]+(?:how(?:['’]s| is) it going|how are you|what(?:['’]s| is) up|how(?:['’]s| is) your day(?: going)?)\s*[!?.]*\s*$/i

export function isConversationalGreeting(message: string): boolean {
  const normalized = message.trim().replace(/\s+/g, ' ')
  if (!normalized || normalized.length > 100) return false
  return SIMPLE_GREETING_RE.test(normalized)
    || CHECK_IN_RE.test(normalized)
    || GREETING_WITH_CHECK_IN_RE.test(normalized)
}

export const CONVERSATIONAL_GREETING_SYSTEM_PROMPT = [
  VOICE_SYSTEM_PROMPT,
  '',
  '## Your job: answer a casual greeting',
  'Reply naturally in one short sentence.',
  'Sound warm, relaxed, and present — never formal, overexcited, or robotic.',
  'Do not list every Daylens capability. A light invitation to ask about the person\'s day is enough.',
  'Do not claim anything about their activity, mood, or progress. No emoji.',
].join('\n')
