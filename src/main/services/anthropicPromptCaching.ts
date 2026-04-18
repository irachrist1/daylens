import type { AITextJobExecutionOptions } from './aiOrchestration'

export type AnthropicConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

type AnthropicCacheControl = {
  type: 'ephemeral'
}

type AnthropicTextBlock = {
  type: 'text'
  text: string
  cache_control?: AnthropicCacheControl
}

export type AnthropicPromptInput = {
  system: string | AnthropicTextBlock[]
  messages: Array<{
    role: 'user' | 'assistant'
    content: string | AnthropicTextBlock[]
  }>
}

function cacheControlForOptions(options?: AITextJobExecutionOptions): AnthropicCacheControl | null {
  if (!options?.promptCachingEnabled) return null
  if (options.cachePolicy === 'off') return null
  return { type: 'ephemeral' }
}

// Anthropic caches the prompt prefix through the block carrying cache_control.
// Daylens uses two shapes:
// - stable_prefix: cache the reusable system prompt, not the newest user turn
// - repeated_payload: cache the full request by marking the final user payload
export function buildAnthropicPromptInput(
  systemPrompt: string,
  prior: AnthropicConversationMessage[],
  userMessage: string,
  options?: AITextJobExecutionOptions,
): AnthropicPromptInput {
  const cacheControl = cacheControlForOptions(options)
  const messages: AnthropicPromptInput['messages'] = prior.map((message) => ({
    role: message.role,
    content: message.content,
  }))

  if (cacheControl && options?.cachePolicy === 'repeated_payload') {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: userMessage, cache_control: cacheControl }],
    })
  } else {
    messages.push({ role: 'user', content: userMessage })
  }

  return {
    system: cacheControl && options?.cachePolicy === 'stable_prefix'
      ? [{ type: 'text', text: systemPrompt, cache_control: cacheControl }]
      : systemPrompt,
    messages,
  }
}
