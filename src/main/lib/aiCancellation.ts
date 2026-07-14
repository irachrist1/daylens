// Real cancel for AI chat turns.
//
// The renderer's Stop button must abort the in-flight provider HTTP request,
// not just hide the spinner. A chat turn fans out through several layers
// (sendMessage → planner/converse/phrase/report → executeTextAIJob →
// sendWithProvider → SDK call), so instead of threading an AbortSignal through
// every signature, the turn runs inside an AsyncLocalStorage context carrying
// its signal. The single choke point every provider call goes through
// (executeTextAIJob) reads the ambient signal and hands it to the SDK call.
//
// A registry maps the renderer's clientRequestId to the turn's AbortController
// so the `ai:cancel-message` IPC handler can abort it from outside the call.

import { AsyncLocalStorage } from 'node:async_hooks'

const abortSignalStore = new AsyncLocalStorage<AbortSignal>()
const activeControllers = new Map<string, AbortController>()

/** Message on the error thrown when a turn is aborted between provider calls. */
export const AI_CANCELLED_MESSAGE = 'Generation stopped.'

export function abortError(): Error {
  return new Error(AI_CANCELLED_MESSAGE)
}

/** True when `error` is a user-initiated abort. The SDKs throw `AbortError`
 *  (fetch / Google) or `APIUserAbortError` (Anthropic / OpenAI). */
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { name?: string; message?: string }
  if (e.name === 'AbortError' || e.name === 'APIUserAbortError') return true
  return e.message === AI_CANCELLED_MESSAGE
}

/** Run `fn` with `signal` as the ambient abort signal for every AI call inside. */
export function runWithAbortSignal<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  return abortSignalStore.run(signal, fn)
}

/** The ambient abort signal of the current chat turn, if any. */
export function getAmbientAbortSignal(): AbortSignal | undefined {
  return abortSignalStore.getStore()
}

/** Register the controller for a turn so ai:cancel-message can reach it. */
export function registerAICancellation(requestId: string, controller: AbortController): void {
  activeControllers.set(requestId, controller)
}

/** Unregister on turn settle. Only removes the exact controller it was given. */
export function unregisterAICancellation(requestId: string, controller: AbortController): void {
  if (activeControllers.get(requestId) === controller) {
    activeControllers.delete(requestId)
  }
}

/**
 * Abort the in-flight turn with this clientRequestId. Returns true when a
 * matching turn was found (it may already have settled otherwise).
 */
export function cancelAIRequest(requestId: string): boolean {
  const controller = activeControllers.get(requestId)
  if (!controller) return false
  controller.abort()
  return true
}
