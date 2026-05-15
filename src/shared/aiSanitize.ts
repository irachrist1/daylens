// Daylens AI output sanitizer — shared between the main-process tool executor
// (sanitizeForModel) and the renderer streaming view (sanitizeForRender).
//
// The two functions share one regex corpus. sanitizeForModel strips matches
// (the model never sees them); sanitizeForRender replaces with [redacted] so
// the user knows something was filtered. Both are last-line defenses; capture-
// side hygiene strips most leak vectors before they reach either layer.

interface Pattern {
  name: string
  regex: RegExp
}

// Order matters. Specific provider shapes run first so they take credit for
// the redaction in the analytics counter; the generic backstops mop up the
// rest. Each regex is /g so we replace every occurrence in a string.
const PATTERNS: Pattern[] = [
  // 1. URL query strings (and fragments) on http(s) URLs. Also any bare
  // ?code=… style query when it follows a path-looking prefix.
  { name: 'url_query', regex: /(https?:\/\/[^\s?#]+)[?#][^\s)\]"'<>]*/gi },

  // 2. JWT — three base64url segments separated by dots, starting with eyJ
  // (a base64 of "{"...). Must run before generic base64 backstop.
  { name: 'jwt', regex: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },

  // 3. Provider-specific token shapes.
  { name: 'openai_key', regex: /sk-[A-Za-z0-9_-]{20,}/g },
  { name: 'slack_token', regex: /xox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'google_oauth', regex: /ya29\.[A-Za-z0-9_.\-]+/g },
  { name: 'github_pat', regex: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: 'aws_access_key', regex: /\bAKIA[0-9A-Z]{16}\b/g },

  // 4. OAuth callback "code=…" / "state=…" / "access_token=…" parameters
  // even when they appear bare (e.g. captured into a window title without
  // the leading URL). Catches the reproduced leak shape.
  { name: 'oauth_param', regex: /\b(?:code|state|access_token|id_token|refresh_token|token|client_secret|api_key)=[A-Za-z0-9_.\-+/=%]{8,}/gi },

  // 5. Hex blobs ≥32 chars (sha-256 hashes, AWS secrets without the prefix,
  // long capture cookies). Word-boundary anchored to avoid clipping into
  // surrounding text.
  { name: 'hex_blob', regex: /\b[0-9a-fA-F]{32,}\b/g },

  // 6. Base64-ish ≥24 chars with mixed case+digits and no whitespace.
  // Requires at least one digit and one of each case to avoid hitting plain
  // English words. The character class includes the URL-safe variants.
  { name: 'base64_blob', regex: /\b(?=[A-Za-z0-9+/=_-]*\d)(?=[A-Za-z0-9+/=_-]*[A-Z])(?=[A-Za-z0-9+/=_-]*[a-z])[A-Za-z0-9+/=_-]{24,}\b/g },

  // 7. Generic high-entropy backstop: ≥32 chars of [A-Za-z0-9_-] with no
  // whitespace. Runs last so the more-specific patterns claim the match.
  { name: 'generic_token', regex: /\b[A-Za-z0-9_-]{32,}\b/g },
]

export interface SanitizeReport {
  redactionCount: number
  patternsHit: string[]
}

function applyPatterns(input: string, replacement: string | ((name: string) => string)): { text: string; report: SanitizeReport } {
  let text = input
  let redactionCount = 0
  const patternsHit: string[] = []

  for (const { name, regex } of PATTERNS) {
    // Reset in case any caller passed a stateful regex by accident; ours are
    // module-local so this is defensive.
    regex.lastIndex = 0
    text = text.replace(regex, (_match, ...args) => {
      // For url_query the first capture group is the URL prefix we want to keep.
      const groupOne = typeof args[0] === 'string' ? args[0] : null
      redactionCount++
      patternsHit.push(name)
      const value = typeof replacement === 'function' ? replacement(name) : replacement
      if (name === 'url_query' && groupOne) {
        // For sanitizeForModel (replacement === '') we want the URL to keep
        // its host+path and lose the query. For sanitizeForRender we want
        // host+path then a redaction marker. Branch on whether the
        // replacement is empty so both behaviors fall out naturally.
        return value === '' ? groupOne : `${groupOne}${value}`
      }
      return value
    })
  }

  return { text, report: { redactionCount, patternsHit } }
}

// sanitizeForModel: strip matches entirely (the model never sees the secret).
// Returns just the cleaned text; report is available via sanitizeForModelWithReport.
export function sanitizeForModel(value: string): string {
  if (!value) return value
  return applyPatterns(value, '').text
}

export function sanitizeForModelWithReport(value: string): { text: string; report: SanitizeReport } {
  if (!value) return { text: value, report: { redactionCount: 0, patternsHit: [] } }
  return applyPatterns(value, '')
}

// sanitizeForRender: replace each match with [redacted] so the user can see
// something was filtered out. Returns the cleaned text plus a report so the
// caller can fire an analytics event when redactionCount > 0.
export function sanitizeForRender(text: string): { text: string; report: SanitizeReport } {
  if (!text) return { text, report: { redactionCount: 0, patternsHit: [] } }
  return applyPatterns(text, '[redacted]')
}

// Deep walk a tool result and run sanitizeForModel on every string field.
// Plain objects, arrays, primitives, and nested combinations are all handled.
// Returns a new value; the input is left untouched so the trace harness can
// still log the pre-sanitization shape.
export function sanitizeToolResult<T>(value: T): T {
  if (value == null) return value
  if (typeof value === 'string') return sanitizeForModel(value) as unknown as T
  if (Array.isArray(value)) return value.map((item) => sanitizeToolResult(item)) as unknown as T
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeToolResult(child)
    }
    return out as unknown as T
  }
  return value
}

// Capture-side helper for browser window titles. When a window_title contains
// a URL token, store stripped to host (or host+path for allowlisted hosts);
// drop query/fragment unconditionally. The original full URL stays in
// website_visits.url, which is captured independently from browser history.
const PATH_ALLOWLIST_HOSTS = new Set([
  'docs.google.com',
  'github.com',
  'linear.app',
  'notion.so',
  'www.notion.so',
  'slack.com',
  'app.slack.com',
])

const URL_TOKEN_REGEX = /\bhttps?:\/\/[^\s)\]'"<>]+/i

export function stripBrowserUrlFromTitle(title: string | null | undefined, isBrowserApp: boolean): string | null {
  if (!title) return title ?? null
  if (!isBrowserApp) return title
  const match = title.match(URL_TOKEN_REGEX)
  if (!match) return title
  const rawUrl = match[0]
  let stripped: string
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()
    const keepPath = PATH_ALLOWLIST_HOSTS.has(host)
    const path = keepPath ? parsed.pathname.replace(/\/+$/, '') : ''
    stripped = `${parsed.host}${path}`
  } catch {
    // URL parse failure: fall back to a regex-based strip of query/fragment.
    stripped = rawUrl.replace(/[?#].*$/, '')
  }
  return title.replace(rawUrl, stripped).trim() || stripped
}
