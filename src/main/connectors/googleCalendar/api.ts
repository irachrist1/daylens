// The thin Google Calendar API read layer (DEV-188). One job: issue GET
// requests with a bearer token and turn provider failures into TYPED,
// SANITIZED errors the adapter can act on — never an error that echoes a
// request URL (it carries the syncToken) or a response body (it could quote
// anything). `fetchImpl` is injected, so tests drive this against an
// in-memory Google and the suite never touches the network.

const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'

/** Google invalidated the incremental sync token (HTTP 410): the adapter must
 *  fall back to a full-window sync. */
export class GoogleSyncTokenExpiredError extends Error {
  constructor() {
    super('Google Calendar invalidated the incremental sync token; a full re-sync is required.')
  }
}

/** The stored authorization no longer works (HTTP 401/403 auth-shaped). */
class GoogleAuthorizationError extends Error {
  constructor() {
    super('Google Calendar authorization was rejected. Reconnect to resume syncing.')
  }
}

/** Rate limited (HTTP 429, or 403 rate-limit reasons). `retryAfterMs` carries
 *  the provider's reset hint so the backoff can respect it. */
class GoogleRateLimitError extends Error {
  readonly retryAfterMs: number | null
  constructor(retryAfterMs: number | null) {
    super('Google Calendar rate-limited the sync; it will retry on a bounded backoff.')
    this.retryAfterMs = retryAfterMs
  }
}

export interface GoogleEventTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

export interface GoogleApiEvent {
  id?: string
  status?: string
  summary?: string
  start?: GoogleEventTime
  end?: GoogleEventTime
  attendees?: Array<{
    email?: string
    displayName?: string
    self?: boolean
    resource?: boolean
    responseStatus?: string
  }>
  recurringEventId?: string
  eventType?: string
}

export interface GoogleEventsPage {
  items?: GoogleApiEvent[]
  nextPageToken?: string
  nextSyncToken?: string
}

export interface GoogleCalendarSummary {
  id?: string
  summary?: string
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
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    throw new Error(`Google Calendar was unreachable while ${what}.`)
  }
  if (response.status === 401) throw new GoogleAuthorizationError()
  if (response.status === 410) throw new GoogleSyncTokenExpiredError()
  if (response.status === 429) throw new GoogleRateLimitError(retryAfterMsOf(response))
  if (response.status === 403) {
    // Google reports quota exhaustion as 403 with rate-limit reasons; without
    // reading the body (which we refuse to echo) treat 403 as authorization
    // trouble ONLY when no Retry-After hints at rate limiting.
    const retryAfterMs = retryAfterMsOf(response)
    if (retryAfterMs != null) throw new GoogleRateLimitError(retryAfterMs)
    throw new GoogleAuthorizationError()
  }
  if (!response.ok) {
    throw new Error(`Google Calendar answered HTTP ${response.status} while ${what}.`)
  }
  try {
    return await response.json() as T
  } catch {
    throw new Error(`Google Calendar returned an unreadable response while ${what}.`)
  }
}

export interface ListEventsParams {
  calendarId: string
  accessToken: string
  syncToken?: string | null
  pageToken?: string | null
  /** RFC3339 lower bound — only valid on full-window syncs (Google rejects it
   *  alongside a syncToken). */
  timeMin?: string | null
  apiBase?: string
}

/** One events page. `singleEvents=true` expands recurring events into
 *  instances (each with its own stable id); `showDeleted=true` makes provider
 *  deletions and cancellations visible as `status: "cancelled"` items. */
export async function listEventsPage(
  fetchImpl: typeof fetch,
  params: ListEventsParams,
): Promise<GoogleEventsPage> {
  const base = params.apiBase ?? GOOGLE_CALENDAR_API_BASE
  const url = new URL(`${base}/calendars/${encodeURIComponent(params.calendarId)}/events`)
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('showDeleted', 'true')
  url.searchParams.set('maxResults', '250')
  if (params.syncToken) url.searchParams.set('syncToken', params.syncToken)
  if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
  if (params.timeMin && !params.syncToken) url.searchParams.set('timeMin', params.timeMin)
  return getJson<GoogleEventsPage>(fetchImpl, url.toString(), params.accessToken, 'listing events')
}

/** The connected calendar's identity — for the primary calendar Google
 *  returns the account email as the id, which becomes the account label. */
export async function getCalendarSummary(
  fetchImpl: typeof fetch,
  params: { calendarId: string; accessToken: string; apiBase?: string },
): Promise<GoogleCalendarSummary> {
  const base = params.apiBase ?? GOOGLE_CALENDAR_API_BASE
  const url = `${base}/calendars/${encodeURIComponent(params.calendarId)}`
  return getJson<GoogleCalendarSummary>(fetchImpl, url, params.accessToken, 'reading the calendar')
}
