import type { AIMessageAction, AIProviderMode, AIThreadMessage } from '@shared/types'
import type { AIProviderErrorCode } from '@shared/aiProviderError'

export interface AltProvider {
  provider: AIProviderMode
  label: string
}

// A chat message as held in renderer state. `id` may be a synthetic string
// while a turn is in flight (`user:<reqId>` / `assistant:<reqId>`) and becomes
// the persisted numeric id once the server turn resolves.
export type ThreadMessage = Omit<AIThreadMessage, 'id'> & {
  id: string | number
  state: 'pending' | 'complete' | 'error'
  // R4: classified error context for the branded error card (Retry + rate-limit
  // auto-retry hint + switch-provider on a hard wall). Present only when
  // state === 'error'.
  errorInfo?: {
    isRateLimit: boolean
    retryAfterSeconds: number | null
    autoRetryScheduled: boolean
    code: AIProviderErrorCode
    // Other configured providers to offer as a one-tap switch on a hard wall.
    alternateProviders?: AltProvider[]
  }
}

export type MessageAction = 'copy' | 'up' | 'down' | 'retry'

export interface ActionFeedbackEntry {
  pulseNonce: number
  success: boolean
}

export interface MessageActionStateEntry {
  busy: boolean
  error: string | null
  successLabel: string | null
}

export function actionFeedbackKey(messageId: string | number, action: MessageAction): string {
  return `${messageId}:${action}`
}

export function messageActionKey(messageId: string | number, action: AIMessageAction): string {
  const suffix = action.kind === 'start_focus_session'
    ? 'start'
    : action.kind === 'stop_focus_session'
      ? `stop:${action.sessionId}`
      : `review:${action.sessionId}`
  return `${messageId}:${suffix}`
}

export function threadMessagesFromHistory(history: AIThreadMessage[]): ThreadMessage[] {
  return history.map((message, index) => ({
    ...message,
    id: message.id ?? `history:${index}:${message.role}`,
    state: 'complete' as const,
  }))
}
