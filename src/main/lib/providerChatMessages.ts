// One place that shapes a conversation's history for the AI providers. Every
// provider consumes the same (prior turns + new user message) sequence; the
// only real differences are where the system prompt rides and Google's
// strict user/model alternation — those small deltas live here, named, instead
// of being re-derived inline in each sendWith* function.

export interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

/** The full turn sequence a provider should see: prior history plus the new user message. */
export function historyWithUserTurn(prior: ChatHistoryMessage[], userMessage: string): ChatHistoryMessage[] {
  return [
    ...prior.map((message) => ({ role: message.role, content: message.content })),
    { role: 'user' as const, content: userMessage },
  ]
}

/**
 * OpenAI-compatible chat-completions shape (OpenAI proxy, OpenRouter, the
 * managed Daylens proxy): the system prompt is the first message in the array.
 */
export function toChatCompletionMessages(
  systemPrompt: string,
  prior: ChatHistoryMessage[],
  userMessage: string,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return [
    { role: 'system' as const, content: systemPrompt },
    ...historyWithUserTurn(prior, userMessage),
  ]
}

export interface GoogleHistoryContent {
  role: 'user' | 'model'
  parts: Array<{ text: string }>
}

/**
 * Google requires strictly alternating user/model roles.
 * Strip consecutive same-role messages, keeping only the last one in each run
 * so corrupted histories (e.g. from a prior failed request) don't break the call.
 */
export function toGoogleHistory(messages: ChatHistoryMessage[]): GoogleHistoryContent[] {
  const filtered: ChatHistoryMessage[] = []
  for (const message of messages) {
    const last = filtered[filtered.length - 1]
    if (last && last.role === message.role) {
      filtered[filtered.length - 1] = message
    } else {
      filtered.push(message)
    }
  }
  return filtered.map((message) => ({
    role: message.role === 'assistant' ? 'model' as const : 'user' as const,
    parts: [{ text: message.content }],
  }))
}
