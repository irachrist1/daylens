import type { ReactNode } from 'react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { getStreamingSnapshot, subscribeStreaming } from './streamingStore'

interface StreamingMessageProps {
  messageId: string
  fallback: ReactNode
  // The Markdown renderer is passed in to keep this component decoupled from
  // the parent's markdown implementation.
  renderContent: (text: string) => ReactNode
  // Optional callback fired after each snapshot update — typically used by
  // the parent to scroll the message list to the bottom as content streams in
  // without requiring the parent itself to subscribe to streaming state.
  onSnapshotUpdate?: () => void
}

export function StreamingMessage({ messageId, fallback, renderContent, onSnapshotUpdate }: StreamingMessageProps) {
  // useSyncExternalStore drives a re-render of THIS component on every
  // snapshot push, while the parent stays untouched.
  const snapshot = useSyncExternalStore(
    (listener) => subscribeStreaming(messageId, listener),
    () => getStreamingSnapshot(messageId),
    () => '',
  )

  const lastNotifiedRef = useRef<number>(0)
  useEffect(() => {
    if (snapshot.length === lastNotifiedRef.current) return
    lastNotifiedRef.current = snapshot.length
    onSnapshotUpdate?.()
  }, [snapshot, onSnapshotUpdate])

  if (!snapshot) return <>{fallback}</>
  return <>{renderContent(snapshot)}</>
}
