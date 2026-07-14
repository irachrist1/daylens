import type { AIActionUndo, AIAnswerTransformKind, AIMessageAction, AIProviderMode, AIThreadMessage } from '@shared/types'
import type { AIProviderErrorCode } from '@shared/aiProviderError'
import { ANSWER_TRANSFORM_KINDS, TRANSFORM_LABELS } from '@shared/answerTransforms'
import { stripLegacyMemoryNudge } from '@shared/aiSanitize'

export interface AltProvider {
  provider: AIProviderMode
  label: string
}

// A chat message as held in renderer state. `id` may be a synthetic string
// while a turn is in flight (`user:<reqId>` / `assistant:<reqId>`) and becomes
// the persisted numeric id once the server turn resolves.
// `cancelled`: the user hit Stop mid-generation — the turn was aborted in the
// main process, nothing was persisted, and the row must never read as a
// completed answer.
export type ThreadMessage = Omit<AIThreadMessage, 'id'> & {
  id: string | number
  state: 'pending' | 'complete' | 'error' | 'cancelled'
  // Classified error context for the branded error card (Retry + rate-limit
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

// Post-answer transforms run a real model call against the SPECIFIC prior
// answer (request.transform). Labels + instructions live in shared/answerTransforms.
export type AnswerTransform = AIAnswerTransformKind
export const ANSWER_TRANSFORMS: { kind: AnswerTransform; label: string }[] =
  ANSWER_TRANSFORM_KINDS.map((kind) => ({ kind, label: TRANSFORM_LABELS[kind] }))

export interface ActionFeedbackEntry {
  pulseNonce: number
  success: boolean
}

export interface MessageActionStateEntry {
  busy: boolean
  error: string | null
  successLabel: string | null
}

// Per-proposal state for an action widget (preview → confirm). Keyed
// by AIActionWidget.proposalId.
export interface ActionWidgetStateEntry {
  status: 'idle' | 'committing' | 'committed' | 'undoing' | 'error'
  summary?: string | null
  undo?: AIActionUndo | null
  error?: string | null
  // Set when the user cancels the preview, so the card collapses to a quiet note.
  dismissed?: boolean
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
    content: stripLegacyMemoryNudge(message.content),
    id: message.id ?? `history:${index}:${message.role}`,
    state: 'complete' as const,
  }))
}
