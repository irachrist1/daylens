// A one-shot handoff for pre-filling the AI composer from another view. The
// AI tab mounts only after navigation, so an event dispatched before navigate
// (Settings → Memory → "Chat about your memory") fired before any listener
// existed and was lost. The queuing view stashes the prompt here; the AI tab
// reads and clears it on mount.
let pendingChatSeed: string | null = null

export function setPendingChatSeed(text: string): void {
  pendingChatSeed = text.trim() || null
}

export function consumePendingChatSeed(): string | null {
  const value = pendingChatSeed
  pendingChatSeed = null
  return value
}
