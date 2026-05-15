// Streaming-text store for the AI chat tab.
//
// Streaming snapshots used to live in React state on the parent Insights
// component, so every chunk re-rendered the entire AI tab tree — including
// the controlled <textarea> in the composer. That is the typing-flicker bug
// from V1-PHASE-6-AI §6.
//
// This module owns the in-flight snapshot for each assistant message and
// exposes a useSyncExternalStore-friendly API. <StreamingMessage> subscribes
// per messageId, so chunk arrivals only re-render the message body, never
// the composer.

type Listener = () => void

const snapshots = new Map<string, string>()
const listeners = new Map<string, Set<Listener>>()

export function setStreamingSnapshot(messageId: string, snapshot: string): void {
  snapshots.set(messageId, snapshot)
  const subs = listeners.get(messageId)
  if (subs) for (const fn of subs) fn()
}

export function getStreamingSnapshot(messageId: string): string {
  return snapshots.get(messageId) ?? ''
}

export function clearStreamingSnapshot(messageId: string): void {
  snapshots.delete(messageId)
  // Leave listeners in place; the unsubscribe path will drop the set when
  // the component unmounts. Clearing here would orphan a still-mounted
  // <StreamingMessage> waiting for a final flush.
}

export function subscribeStreaming(messageId: string, listener: Listener): () => void {
  let set = listeners.get(messageId)
  if (!set) {
    set = new Set()
    listeners.set(messageId, set)
  }
  set.add(listener)
  return () => {
    const current = listeners.get(messageId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) listeners.delete(messageId)
  }
}
