// Structured provider-error envelope (R4 + R2).
//
// Electron's ipcRenderer.invoke flattens a thrown Error to its `message` string
// and adds an `Error invoking remote method '<channel>':` prefix — custom
// properties do not survive. So to get a machine-readable error *class* across
// the IPC boundary we tag the human message with a compact, strippable
// sentinel. The visible part is always the friendly copy; the sentinel carries
// the code + retry hint and is removed before display (renderer sanitizeIpcError).
//
// Imported by BOTH main and renderer, so it stays free of Node-only APIs.

export type AIProviderErrorCode =
  // Brief per-minute spike / transient 429 — safe to retry silently.
  | 'transient_rate_limit'
  // Daily / free-tier request allowance exhausted, or a hard RESOURCE_EXHAUSTED.
  // Retrying immediately just fails again — the user must add billing, switch
  // provider, or wait. (This is the Gemini free-tier 500/day case.)
  | 'quota_exhausted'
  // Pre-paid credit balance too low.
  | 'credit_exhausted'
  // Key rejected (401/403).
  | 'auth'
  // The selected model id no longer exists on this key (404 / not_found_error
  // — e.g. a deprecated dated snapshot still selected in Settings).
  | 'model_unavailable'
  // Couldn't reach the provider at all (offline, DNS, connection reset).
  | 'network'
  // Anything else.
  | 'unknown'

export interface AIProviderErrorMeta {
  code: AIProviderErrorCode
  // Seconds the provider asked us to wait, when known (transient case).
  retryAfterSeconds?: number | null
}

// Distinct, unlikely-to-collide bracket markers. The inner payload is plain
// JSON (no closing bracket char), so a single regex recovers it.
const SENTINEL_RE = /\s*⟦dlerr:(\{[^⟧]*\})⟧\s*$/

export function encodeProviderErrorMeta(userMessage: string, meta: AIProviderErrorMeta): string {
  try {
    return `${userMessage} ⟦dlerr:${JSON.stringify(meta)}⟧`
  } catch {
    return userMessage
  }
}

/** Split a (possibly) tagged message into its clean text + decoded meta. */
export function decodeProviderErrorMeta(message: string): { message: string; meta: AIProviderErrorMeta | null } {
  const match = message.match(SENTINEL_RE)
  if (!match) return { message, meta: null }
  const clean = message.replace(SENTINEL_RE, '').trim()
  try {
    const meta = JSON.parse(match[1]) as AIProviderErrorMeta
    if (meta && typeof meta.code === 'string') return { message: clean, meta }
  } catch {
    /* fall through */
  }
  return { message: clean, meta: null }
}

export function isProviderErrorEncoded(message: string): boolean {
  return SENTINEL_RE.test(message)
}

/** Hard walls need user action (billing / switch / re-key / re-pick a model); transient does not. */
export function isHardProviderWall(code: AIProviderErrorCode): boolean {
  return code === 'quota_exhausted' || code === 'credit_exhausted' || code === 'auth' || code === 'model_unavailable'
}
