import type { AITextJobExecutionOptions, ProviderTextResponse, ResolvedProviderConfig } from '../services/aiOrchestration'

type ConversationMessage = { role: 'user' | 'assistant'; content: string }

export interface ProviderAdapter {
  sendText(
    config: ResolvedProviderConfig,
    systemPrompt: string,
    prior: ConversationMessage[],
    userMessage: string,
    options?: AITextJobExecutionOptions,
  ): Promise<ProviderTextResponse>
}

