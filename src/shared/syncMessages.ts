export function sanitizeSyncFailureMessage(message: string | null | undefined): string | null {
  const compact = (message ?? '').replace(/\s+/g, ' ').trim()
  if (!compact) return null

  if (/token expired|expired token|could not validate token|invalid token|unauthorized|401|jwt.*expired|expired.*jwt/i.test(compact)) {
    return 'Workspace link expired. Reconnect this device.'
  }

  if (/network|fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|timed out/i.test(compact)) {
    return 'Workspace sync could not reach the server. Check your connection and try again.'
  }

  if (/5\d\d|server error|convex|request id|trace|stack/i.test(compact)) {
    return 'Workspace sync hit a server problem. Try again in a moment.'
  }

  return compact.length > 120 ? `${compact.slice(0, 117).trimEnd()}...` : compact
}
