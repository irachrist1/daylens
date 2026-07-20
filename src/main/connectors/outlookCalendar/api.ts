// The thin Microsoft Graph read layer (DEV-190). One job: issue GET requests
// with a bearer token and turn provider failures into TYPED, SANITIZED errors
// the adapter can act on — never an error that echoes a request URL (delta
// links carry an opaque continuation token) or a response body (it could
// quote anything). `fetchImpl` is injected, so tests drive this against an
// in-memory Graph and the suite never touches the network.

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0'

/** Graph invalidated the delta token (HTTP 410 Gone): the adapter must fall
 *  back to a fresh full-window sync. */
export class OutlookDeltaTokenExpiredError extends Error {
  constructor() {
    super('Outlook Calendar invalidated the incremental delta token; a full re-sync is required.')
  }
}

/** The stored authorization no longer works (HTTP 401/403 auth-shaped).
 *  `needsAttention` makes the connection flag needs_attention immediately —
 *  Settings shows the reauthorize affordance instead of a silent retry loop. */
class OutlookAuthorizationError extends Error {
  readonly needsAttention = true
  constructor() {
    super('Outlook Calendar authorization was rejected. Reconnect to resume syncing.')
  }
}

/** Rate limited / throttled (HTTP 429 or 503 with Retry-After). `retryAfterMs`
 *  carries the provider's reset hint so the backoff can respect it. */
class OutlookRateLimitError extends Error {
  readonly retryAfterMs: number | null
  constructor(retryAfterMs: number | null) {
    super('Outlook Calendar rate-limited the sync; it will retry on a bounded backoff.')
    this.retryAfterMs = retryAfterMs
  }
}

/** Graph renders event times as { dateTime, timeZone }. The adapter requests
 *  `Prefer: outlook.timezone="UTC"`, so timeZone is UTC on real responses. */
export interface OutlookDateTime {
  dateTime?: string
  timeZone?: string
}

export interface OutlookApiEvent {
  id?: string
  /** Delta deletions arrive as { id, "@removed": { reason } } stubs. */
  '@removed'?: { reason?: string }
  subject?: string
  isAllDay?: boolean
  isCancelled?: boolean
  start?: OutlookDateTime
  end?: OutlookDateTime
  /** The calendar OWNER's own response to the invitation. */
  responseStatus?: { response?: string }
  attendees?: Array<{
    emailAddress?: { address?: string; name?: string }
    /** required | optional | resource — rooms/equipment are `resource`. */
    type?: string
    status?: { response?: string }
  }>
  organizer?: { emailAddress?: { address?: string; name?: string } }
}

export interface OutlookDeltaPage {
  value?: OutlookApiEvent[]
  '@odata.nextLink'?: string
  '@odata.deltaLink'?: string
}

export interface OutlookUser {
  userPrincipalName?: string
  mail?: string
  displayName?: string
}

function retryAfterMsOf(response: Response): number | null {
  const header = response.headers.get('retry-after')
  if (!header) return null
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null
}

async function getJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  accessToken: string,
  what: string,
): Promise<T> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // UTC event times (unambiguous epochs) and bounded page sizes.
        Prefer: 'outlook.timezone="UTC", odata.maxpagesize=100',
      },
    })
  } catch {
    throw new Error(`Outlook Calendar was unreachable while ${what}.`)
  }
  if (response.status === 401) throw new OutlookAuthorizationError()
  if (response.status === 410) throw new OutlookDeltaTokenExpiredError()
  if (response.status === 429 || response.status === 503) {
    throw new OutlookRateLimitError(retryAfterMsOf(response))
  }
  if (response.status === 403) {
    // Graph reports both permission loss and some throttling as 403; without
    // reading the body (which we refuse to echo) treat 403 as authorization
    // trouble ONLY when no Retry-After hints at rate limiting.
    const retryAfterMs = retryAfterMsOf(response)
    if (retryAfterMs != null) throw new OutlookRateLimitError(retryAfterMs)
    throw new OutlookAuthorizationError()
  }
  if (!response.ok) {
    throw new Error(`Outlook Calendar answered HTTP ${response.status} while ${what}.`)
  }
  try {
    return await response.json() as T
  } catch {
    throw new Error(`Outlook Calendar returned an unreadable response while ${what}.`)
  }
}

/** The initial calendarView delta request for a bounded window. Graph expands
 *  recurring events into instances inside the window (there is no
 *  seriesMaster to unfold), mirroring Google's singleEvents=true. */
export function buildCalendarViewDeltaUrl(
  params: { startIso: string; endIso: string; apiBase?: string },
): string {
  const base = params.apiBase ?? GRAPH_API_BASE
  const url = new URL(`${base}/me/calendarView/delta`)
  url.searchParams.set('startDateTime', params.startIso)
  url.searchParams.set('endDateTime', params.endIso)
  return url.toString()
}

/**
 * One delta page — either the initial windowed request or a continuation via
 * the server-issued nextLink/deltaLink. Continuation links are followed ONLY
 * when they stay on the API origin: a response can never redirect the bearer
 * token somewhere else.
 */
export async function listCalendarViewDeltaPage(
  fetchImpl: typeof fetch,
  params: { url: string; accessToken: string; apiBase?: string },
): Promise<OutlookDeltaPage> {
  const base = params.apiBase ?? GRAPH_API_BASE
  const allowedOrigin = new URL(base).origin
  let requestOrigin: string
  try {
    requestOrigin = new URL(params.url).origin
  } catch {
    throw new Error('Outlook Calendar sync was given an unusable continuation link.')
  }
  if (requestOrigin !== allowedOrigin) {
    throw new Error('Outlook Calendar sync refused a continuation link that left the Microsoft Graph origin.')
  }
  return getJson<OutlookDeltaPage>(fetchImpl, params.url, params.accessToken, 'listing events')
}

/** The connected account's identity — the honest account label Settings shows
 *  (mail, falling back to the principal name). Requires User.Read. */
export async function getAuthenticatedUser(
  fetchImpl: typeof fetch,
  params: { accessToken: string; apiBase?: string },
): Promise<OutlookUser> {
  const base = params.apiBase ?? GRAPH_API_BASE
  return getJson<OutlookUser>(fetchImpl, `${base}/me`, params.accessToken, 'reading the account')
}
