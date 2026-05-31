// R4: Electron's ipcRenderer.invoke rejects with an Error whose message is
// prefixed `Error invoking remote method '<channel>': Error: <real message>`.
// Putting that straight into the UI leaks channel names ("ai:send-message",
// "db:rebuild-timeline-day") and reads like a crash. This sanitizer strips the
// IPC scaffolding down to the human message the main process actually wrote,
// and classifies rate limits so the UI can offer auto-retry. Shared by the
// chat composer and the timeline AI actions (T1/T2).

export interface SanitizedError {
  message: string
  isRateLimit: boolean
  retryAfterSeconds: number | null
}

const IPC_PREFIX_RE = /^Error invoking remote method '[^']*':\s*/
const LEADING_ERROR_RE = /^(?:Uncaught\s+)?Error:\s*/
// If channel scaffolding somehow survives, never show it to the user.
const CHANNEL_LEAK_RE = /remote method|ai:[a-z-]+|db:[a-z-]+/i

const DEFAULT_FALLBACK = 'Something went wrong. Please try again.'

export function sanitizeIpcError(error: unknown, fallback: string = DEFAULT_FALLBACK): SanitizedError {
  let raw = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : ''

  raw = raw.replace(IPC_PREFIX_RE, '')
  // Strip the one-or-more leading "Error:" tokens that nest through IPC.
  let previous: string
  do {
    previous = raw
    raw = raw.replace(LEADING_ERROR_RE, '').trim()
  } while (raw !== previous)

  let message = raw.trim()
  if (!message || CHANNEL_LEAK_RE.test(message)) message = fallback

  const isRateLimit = /rate.?limit|quota|resource_exhausted|too many requests|\b429\b/i.test(message)
  const retryMatch = message.match(/try again in about (\d+)\s*s/i)
  const retryAfterSeconds = retryMatch ? Number(retryMatch[1]) : null

  return { message, isRateLimit, retryAfterSeconds }
}
