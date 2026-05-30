import type { AIMessageAction, AIMessageArtifact } from '@shared/types'

export function artifactFormatLabel(artifact: AIMessageArtifact): string {
  switch (artifact.format) {
    case 'csv':
      return 'CSV'
    case 'html':
      return 'HTML'
    case 'json':
      return 'JSON'
    case 'markdown':
    default:
      return 'Markdown'
  }
}

export function messageActionKey(messageId: string | number, action: AIMessageAction): string {
  const suffix = action.kind === 'start_focus_session'
    ? action.payload.label ?? action.payload.targetMinutes ?? 'start'
    : action.sessionId
  return `${String(messageId)}:${action.kind}:${String(suffix)}`
}

export function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

import type { AIThreadMessage } from '@shared/types'
import type { ThreadMessage } from './types'

export function threadMessagesFromHistory(history: AIThreadMessage[]): ThreadMessage[] {
  return history.map((message, index) => ({
    ...message,
    id: message.id ?? `history:${index}:${message.role}`,
    state: 'complete',
  }))
}
