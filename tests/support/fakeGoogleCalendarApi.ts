// An in-memory Google for the DEV-188 adapter tests: a stubbed OAuth token
// endpoint (with real PKCE verification), a Calendar API with genuine
// syncToken semantics (versioned changes, cancellations, 410 invalidation,
// pageToken pagination, Retry-After rate limits), and a fake browser that
// completes the loopback redirect. The adapter under test receives this via
// its injected `fetchImpl`/`openExternal`/`secretStore` — no real network
// request ever leaves the process (the only HTTP is the adapter's own
// loopback listener on 127.0.0.1).

import { createHash } from 'node:crypto'
import type { ConnectorSecretStore } from '../../src/main/connectors/credentials.ts'
import type { GoogleApiEvent } from '../../src/main/connectors/googleCalendar/api.ts'

export const FAKE_GOOGLE_ENDPOINTS = {
  auth: 'https://google-oauth.test/auth',
  token: 'https://google-oauth.test/token',
  revoke: 'https://google-oauth.test/revoke',
  apiBase: 'https://google-api.test/calendar/v3',
}

export const FAKE_AUTHORIZATION_CODE = 'test-authorization-code-4711'
export const FAKE_REFRESH_TOKEN = '1//refresh-token-abc123DEF456ghi789'

export function createFakeSecretStore(): ConnectorSecretStore & { dump(): Map<string, string> } {
  const secrets = new Map<string, string>()
  return {
    async getPassword(service, account) { return secrets.get(`${service}:${account}`) ?? null },
    async setPassword(service, account, password) { secrets.set(`${service}:${account}`, password) },
    async deletePassword(service, account) { return secrets.delete(`${service}:${account}`) },
    dump() { return secrets },
  }
}

interface VersionedEvent {
  event: GoogleApiEvent
  version: number
}

export interface InjectedFailure {
  status: number
  retryAfterSec?: number
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function formOf(init: RequestInit | undefined): URLSearchParams {
  return new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

export interface FakeGoogleCalendarApi {
  fetchImpl: typeof fetch
  /** The fake system browser: parses the auth URL, records the PKCE
   *  challenge, and completes the loopback redirect with a valid code. */
  browse(url: string): Promise<void>
  /** A browser session where the person denies the grant. */
  browseDeny(url: string): Promise<void>
  /** Add or replace an event; bumps the source version (a syncToken delta). */
  putEvent(event: GoogleApiEvent): void
  /** Provider-side deletion: the event flips to status "cancelled" and shows
   *  up on the next incremental page (showDeleted semantics). */
  cancelEvent(id: string): void
  /** The next events request (after skipping `afterRequests` successful
   *  ones) answers with this failure, once. `afterRequests: 1` fails the
   *  SECOND page of a paginated sync. */
  failNextEventsRequest(failure: InjectedFailure, afterRequests?: number): void
  /** All handed-out sync tokens turn invalid: the next incremental sync gets
   *  HTTP 410 and must fall back to a full window. */
  expireSyncTokens(): void
  /** Force pagination: each events page carries at most this many items. */
  setPageSize(size: number | null): void
  readonly eventsRequests: number
  readonly tokenRequests: number
  readonly refreshRequests: number
  readonly revokedTokens: string[]
  readonly issuedAccessTokens: string[]
}

export function createFakeGoogleCalendarApi(
  initialEvents: GoogleApiEvent[] = [],
  options: { accountEmail?: string } = {},
): FakeGoogleCalendarApi {
  const accountEmail = options.accountEmail ?? 'owner@example.com'
  const events = new Map<string, VersionedEvent>()
  let version = 1
  for (const event of initialEvents) {
    events.set(event.id!, { event, version })
  }

  let pendingChallenge: string | null = null
  let tokenSerial = 0
  let syncTokenFloor = 0 // tokens at or below this version are expired (410)
  let pageSize: number | null = null
  const scheduledFailures: Array<{ at: number; failure: InjectedFailure }> = []
  const validAccessTokens = new Set<string>()
  const issuedAccessTokens: string[] = []
  const revokedTokens: string[] = []
  let eventsRequests = 0
  let tokenRequests = 0
  let refreshRequests = 0

  function issueAccessToken(): string {
    tokenSerial += 1
    const token = `ya29.fake-access-token-${tokenSerial}-abcDEF123`
    validAccessTokens.add(token)
    issuedAccessTokens.push(token)
    return token
  }

  function authorized(init: RequestInit | undefined): boolean {
    const header = new Headers(init?.headers).get('authorization') ?? ''
    return validAccessTokens.has(header.replace(/^Bearer\s+/i, ''))
  }

  function eventsResponse(url: URL): Response {
    const dueIndex = scheduledFailures.findIndex((entry) => entry.at === eventsRequests)
    const injected = dueIndex >= 0 ? scheduledFailures.splice(dueIndex, 1)[0].failure : null
    if (injected) {
      const headers: Record<string, string> = {}
      if (injected.retryAfterSec != null) headers['Retry-After'] = String(injected.retryAfterSec)
      return json(injected.status, { error: { code: injected.status, message: 'injected failure' } }, headers)
    }

    const syncToken = url.searchParams.get('syncToken')
    const pageToken = url.searchParams.get('pageToken')
    const offset = pageToken ? Number(pageToken.replace('offset-', '')) : 0

    let items: GoogleApiEvent[]
    if (syncToken) {
      const tokenVersion = Number(syncToken.replace('sync-', ''))
      if (!Number.isFinite(tokenVersion) || tokenVersion <= syncTokenFloor) {
        return json(410, { error: { code: 410, message: 'Sync token is no longer valid.' } })
      }
      items = [...events.values()]
        .filter((entry) => entry.version > tokenVersion)
        .map((entry) => entry.event)
    } else {
      const timeMin = url.searchParams.get('timeMin')
      const timeMinMs = timeMin ? Date.parse(timeMin) : null
      items = [...events.values()]
        .filter((entry) => entry.event.status !== 'cancelled')
        .filter((entry) => {
          if (timeMinMs == null) return true
          const start = entry.event.start?.dateTime ?? entry.event.start?.date
          const startMs = start ? Date.parse(start) : NaN
          return Number.isFinite(startMs) ? startMs >= timeMinMs : true
        })
        .map((entry) => entry.event)
    }

    if (pageSize != null && items.length > offset + pageSize) {
      return json(200, {
        items: items.slice(offset, offset + pageSize),
        nextPageToken: `offset-${offset + pageSize}`,
      })
    }
    return json(200, {
      items: items.slice(offset),
      nextSyncToken: `sync-${version}`,
    })
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const href = `${url.origin}${url.pathname}`

    if (href === FAKE_GOOGLE_ENDPOINTS.token) {
      tokenRequests += 1
      const form = formOf(init)
      if (form.get('grant_type') === 'authorization_code') {
        if (form.get('code') !== FAKE_AUTHORIZATION_CODE) {
          return json(400, { error: 'invalid_grant' })
        }
        const verifier = form.get('code_verifier') ?? ''
        const challenge = base64Url(createHash('sha256').update(verifier).digest())
        if (!pendingChallenge || challenge !== pendingChallenge) {
          return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' })
        }
        pendingChallenge = null
        return json(200, {
          access_token: issueAccessToken(),
          refresh_token: FAKE_REFRESH_TOKEN,
          expires_in: 3600,
        })
      }
      if (form.get('grant_type') === 'refresh_token') {
        refreshRequests += 1
        if (form.get('refresh_token') !== FAKE_REFRESH_TOKEN) {
          return json(400, { error: 'invalid_grant' })
        }
        return json(200, { access_token: issueAccessToken(), expires_in: 3600 })
      }
      return json(400, { error: 'unsupported_grant_type' })
    }

    if (href === FAKE_GOOGLE_ENDPOINTS.revoke) {
      revokedTokens.push(formOf(init).get('token') ?? '')
      return json(200, {})
    }

    if (href.startsWith(`${FAKE_GOOGLE_ENDPOINTS.apiBase}/calendars/`)) {
      if (!authorized(init)) return json(401, { error: { code: 401, message: 'Invalid credentials' } })
      if (url.pathname.endsWith('/events')) {
        eventsRequests += 1
        return eventsResponse(url)
      }
      return json(200, { id: accountEmail, summary: accountEmail })
    }

    throw new Error(`fake Google received an unexpected request: ${href}`)
  }

  async function completeRedirect(authUrl: string, params: Record<string, string>): Promise<void> {
    const parsed = new URL(authUrl)
    const redirectUri = parsed.searchParams.get('redirect_uri')
    const state = parsed.searchParams.get('state')
    pendingChallenge = parsed.searchParams.get('code_challenge')
    if (!redirectUri || !state) throw new Error('auth URL is missing redirect_uri/state')
    const callback = new URL(redirectUri)
    callback.searchParams.set('state', state)
    for (const [key, value] of Object.entries(params)) callback.searchParams.set(key, value)
    // The one real request in the whole fixture: the loopback listener the
    // adapter itself opened on 127.0.0.1.
    await fetch(callback.toString())
  }

  return {
    fetchImpl,
    browse: (url) => completeRedirect(url, { code: FAKE_AUTHORIZATION_CODE }),
    browseDeny: (url) => completeRedirect(url, { error: 'access_denied' }),
    putEvent(event) {
      version += 1
      events.set(event.id!, { event, version })
    },
    cancelEvent(id) {
      const existing = events.get(id)
      version += 1
      events.set(id, { event: { ...(existing?.event ?? {}), id, status: 'cancelled' }, version })
    },
    failNextEventsRequest(failure, afterRequests = 0) {
      scheduledFailures.push({ at: eventsRequests + 1 + afterRequests, failure })
    },
    expireSyncTokens() {
      // Every token handed out so far dies; the next full sync issues a
      // fresh, LIVE one (version moves past the floor).
      syncTokenFloor = version
      version += 1
    },
    setPageSize(size) { pageSize = size },
    get eventsRequests() { return eventsRequests },
    get tokenRequests() { return tokenRequests },
    get refreshRequests() { return refreshRequests },
    get revokedTokens() { return revokedTokens },
    get issuedAccessTokens() { return issuedAccessTokens },
  }
}
