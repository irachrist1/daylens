import type { AIThreadMessage } from '@shared/types'

export type ThreadMessage = Omit<AIThreadMessage, 'id'> & {
  id: string | number
  state: 'complete' | 'pending' | 'error'
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
  return `${String(messageId)}:${action}`
}
