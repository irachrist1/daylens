// R4: Electron's ipcRenderer.invoke rejects with an Error whose message is
// prefixed `Error invoking remote method '<channel>': Error: <real message>`.
// Putting that straight into the UI leaks channel names ("ai:send-message",
// "db:rebuild-timeline-day") and reads like a crash. This sanitizer strips the
// IPC scaffolding down to the human message the main process actually wrote,
// and classifies rate limits so the UI can offer auto-retry. Shared by the
// chat composer and the timeline AI actions (T1/T2).

import { decodeProviderErrorMeta, type AIProviderErrorCode } from '@shared/aiProviderError'

export interface SanitizedError {
  message: string
  isRateLimit: boolean
  retryAfterSeconds: number | null
  // R4/R2: structured class so the UI auto-retries only transient limits and
  // offers switch-provider on a hard wall. 'unknown' for un-tagged errors.
  code: AIProviderErrorCode
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

  // Recover the structured provider-error meta the main process tagged on, and
  // remove the sentinel so it never reaches the UI.
  const decoded = decodeProviderErrorMeta(raw.trim())
  let message = decoded.message.trim()
  if (!message || CHANNEL_LEAK_RE.test(message)) message = fallback

  if (decoded.meta) {
    return {
      message,
      code: decoded.meta.code,
      isRateLimit: decoded.meta.code === 'transient_rate_limit',
      retryAfterSeconds: decoded.meta.retryAfterSeconds ?? null,
    }
  }

  // Untagged fallback (older main, non-provider errors): best-effort heuristics.
  const isRateLimit = /rate.?limit|quota|resource_exhausted|too many requests|\b429\b/i.test(message)
  const retryMatch = message.match(/(?:try again in about|give it about)\s*(\d+)\s*s/i)
  const retryAfterSeconds = retryMatch ? Number(retryMatch[1]) : null

  return { message, isRateLimit, retryAfterSeconds, code: isRateLimit ? 'transient_rate_limit' : 'unknown' }
}
