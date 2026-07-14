// Pure state transitions for a chat turn's lifecycle.
//
// A turn in flight lives in renderer state as a synthetic pair —
// `user:<requestId>` + `assistant:<requestId>` — and is reconciled when the
// main-process promise settles. These transitions are extracted from
// useAIChat so the reconciliation invariants are unit-testable without a DOM:
//   - a completed turn flips the SAME pending row to the persisted message;
//   - a failed turn flips it to a classified error card;
//   - a CANCELLED turn stays cancelled — a late completion or rejection from
//     the superseded request must never turn it into a fake answer or error;
//   - a retry removes the pair in place instead of appending a duplicate.

import type { AIThreadMessage } from '@shared/types'
import type { AIProviderErrorCode } from '@shared/aiProviderError'
import { stripLegacyMemoryNudge } from '@shared/aiSanitize'
import type { AltProvider, ThreadMessage } from './types'

export function beginTurn(
  messages: ThreadMessage[],
  params: { userId: string; assistantId: string; prompt: string; createdAt: number },
): ThreadMessage[] {
  return [
    ...messages,
    { id: params.userId, role: 'user', content: params.prompt, createdAt: params.createdAt, state: 'complete' },
    { id: params.assistantId, role: 'assistant', content: '', createdAt: params.createdAt, state: 'pending' },
  ]
}

/**
 * Flip the pending assistant row to the persisted answer. A row the user
 * already cancelled is left untouched: the cancel won the race, and a late
 * completion must never resurface as a completed answer.
 */
export function completeTurn(
  messages: ThreadMessage[],
  assistantId: string,
  assistantMessage: AIThreadMessage,
): ThreadMessage[] {
  return messages.map((message) => (
    message.id === assistantId && message.state === 'pending'
      ? { ...assistantMessage, content: stripLegacyMemoryNudge(assistantMessage.content), state: 'complete' as const }
      : message
  ))
}

export interface TurnFailure {
  message: string
  code: AIProviderErrorCode
  retryAfterSeconds: number | null
}

/**
 * Classify a failed turn for the error card. Only a *transient* per-minute
 * rate limit is auto-retried (once); hard walls (quota / credit / auth) get
 * the switch-provider affordance instead — retrying them just fails again.
 */
export function classifyTurnFailure(
  failure: Pick<TurnFailure, 'code' | 'retryAfterSeconds'>,
  autoRetryCount: number,
  alternateProviders: AltProvider[],
): {
  isTransient: boolean
  isHardWall: boolean
  willAutoRetry: boolean
  errorInfo: NonNullable<ThreadMessage['errorInfo']>
} {
  const isTransient = failure.code === 'transient_rate_limit'
  const isHardWall = failure.code === 'quota_exhausted'
    || failure.code === 'credit_exhausted'
    || failure.code === 'auth'
  const willAutoRetry = isTransient && autoRetryCount < 1
  return {
    isTransient,
    isHardWall,
    willAutoRetry,
    errorInfo: {
      isRateLimit: isTransient,
      retryAfterSeconds: failure.retryAfterSeconds,
      autoRetryScheduled: willAutoRetry,
      code: failure.code,
      alternateProviders: isHardWall && alternateProviders.length > 0 ? alternateProviders : undefined,
    },
  }
}

/** Flip the pending assistant row to an error card (cancelled rows stay cancelled). */
export function failTurn(
  messages: ThreadMessage[],
  assistantId: string,
  failure: TurnFailure,
  errorInfo: NonNullable<ThreadMessage['errorInfo']>,
): ThreadMessage[] {
  return messages.map((message) => (
    message.id === assistantId && message.state === 'pending'
      ? { ...message, content: failure.message, state: 'error' as const, errorInfo }
      : message
  ))
}

/** Flip the pending assistant row to the cancelled state. */
export function cancelTurn(messages: ThreadMessage[], assistantId: string): ThreadMessage[] {
  return messages.map((message) => (
    message.id === assistantId && message.state === 'pending'
      ? { ...message, content: '', state: 'cancelled' as const }
      : message
  ))
}

/** Remove a turn's pair in place (retry / switch-provider re-runs it). */
export function removeTurn(
  messages: ThreadMessage[],
  assistantId: string | number,
  userId: string | number,
): ThreadMessage[] {
  return messages.filter((message) => message.id !== assistantId && message.id !== userId)
}

/**
 * Whether the renderer should adopt the thread the server persisted this turn
 * into. Only a send from a new-chat draft adopts (an existing thread is
 * already selected), and only when the user has not navigated away
 * mid-generation (tab/thread switches bump the navigation version).
 */
export function shouldAdoptThreadAfterTurn(params: {
  requestThreadId: number | null
  responseThreadId: number | null | undefined
  navigationVersionAtSend: number
  navigationVersionNow: number
}): boolean {
  return params.requestThreadId == null
    && params.responseThreadId != null
    && params.navigationVersionAtSend === params.navigationVersionNow
}

/**
 * Prepend an older history page, dropping any row whose id is already on
 * screen — overlapping pages (e.g. a message persisted between two loads
 * shifting the cursor) must never render the same message twice.
 */
export function prependEarlierMessages(
  current: ThreadMessage[],
  earlier: ThreadMessage[],
): ThreadMessage[] {
  const seen = new Set(current.map((message) => message.id))
  return [...earlier.filter((message) => !seen.has(message.id)), ...current]
}

/** Optimistic rename for the sidebar/header, with its exact-revert counterpart. */
export function applyThreadTitle<T extends { id: number; title: string }>(
  threads: T[],
  threadId: number,
  title: string,
): T[] {
  return threads.map((thread) => (thread.id === threadId ? { ...thread, title } : thread))
}
