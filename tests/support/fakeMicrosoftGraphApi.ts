// An in-memory Microsoft for the DEV-190 adapter tests: a stubbed device-code
// pair (device-code + token endpoints with genuine pending/approve/decline/
// expire semantics — HTTP 400 bodies for pending polls, exactly like the real
// identity platform), and a Graph calendarView API with real delta semantics:
// versioned changes, "@removed" deletion stubs, 410 delta-token invalidation,
// nextLink pagination, and Retry-After rate limits. The adapter under test
// receives this via its injected `fetchImpl`/`openExternal`/`secretStore` —
// no real network request ever leaves the process.

import type { ConnectorSecretStore } from '../../src/main/connectors/credentials.ts'
import type { OutlookApiEvent } from '../../src/main/connectors/outlookCalendar/api.ts'

export const FAKE_GRAPH_ENDPOINTS = {
  deviceCode: 'https://ms-login.test/common/oauth2/v2.0/devicecode',
  token: 'https://ms-login.test/common/oauth2/v2.0/token',
  apiBase: 'https://graph.test/v1.0',
}

export const FAKE_MS_DEVICE_CODE = 'msdevicecode-8c1e44b7a2f95d30cc27'
export const FAKE_MS_USER_CODE = 'H7PQ-XR4M'
export const FAKE_MS_VERIFICATION_URI = 'https://microsoft.com/devicelogin'
export const FAKE_MS_REFRESH_TOKEN = '0.AXoAms-refresh-token-4711abcDEF'

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
  event: OutlookApiEvent
  version: number
  /** true = the record is gone at the source; delta pages render it as an
   *  "@removed" stub (the calendarView full window simply omits it). */
  removed: boolean
}

export interface InjectedFailure {
  status: number
  retryAfterSec?: number
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

export interface FakeMicrosoftGraphApi {
  fetchImpl: typeof fetch
  /** The fake person at microsoft.com/devicelogin: approves the pending code.
   *  Wire it into `openExternal` for a flow that completes immediately. */
  approveDevice(): void
  /** The person declines the request at the sign-in page. */
  declineDevice(): void
  /** The device code expires before the person enters it. */
  expireDevice(): void
  /** Add or replace an event; bumps the source version (a delta change). */
  putEvent(event: OutlookApiEvent): void
  /** Provider-side hard deletion: the next delta page carries an "@removed"
   *  stub; the next full window simply omits the event. */
  removeEvent(id: string): void
  /** Provider-side cancellation: the event flips isCancelled and shows up on
   *  the next delta page. */
  cancelEvent(id: string): void
  /** The next events request (after skipping `afterRequests` successful
   *  ones) answers with this failure, once. */
  failNextEventsRequest(failure: InjectedFailure, afterRequests?: number): void
  /** All handed-out delta tokens turn invalid: the next incremental sync gets
   *  HTTP 410 and must fall back to a full window. */
  expireDeltaTokens(): void
  /** Force pagination: each events page carries at most this many items. */
  setPageSize(size: number | null): void
  /** Make the access tokens the poll/refresh mint expire fast, to force the
   *  adapter through the refresh path. */
  setAccessTokenTtlSec(seconds: number): void
  readonly eventsRequests: number
  readonly tokenRequests: number
  readonly refreshRequests: number
  readonly deviceCodeRequests: number
  readonly issuedAccessTokens: string[]
}

export function createFakeMicrosoftGraphApi(
  initialEvents: OutlookApiEvent[] = [],
  options: { accountEmail?: string } = {},
): FakeMicrosoftGraphApi {
  const accountEmail = options.accountEmail ?? 'owner@example.com'
  const events = new Map<string, VersionedEvent>()
  let version = 1
  for (const event of initialEvents) {
    events.set(event.id!, { event, version, removed: false })
  }

  let deviceState: 'idle' | 'pending' | 'approved' | 'declined' | 'expired' = 'idle'
  let tokenSerial = 0
  let deltaTokenFloor = 0 // tokens at or below this version are expired (410)
  let pageSize: number | null = null
  let accessTokenTtlSec = 3600
  const scheduledFailures: Array<{ at: number; failure: InjectedFailure }> = []
  const validAccessTokens = new Set<string>()
  const issuedAccessTokens: string[] = []
  let eventsRequests = 0
  let tokenRequests = 0
  let refreshRequests = 0
  let deviceCodeRequests = 0

  function issueAccessToken(): { access_token: string; refresh_token: string; expires_in: number } {
    tokenSerial += 1
    const token = `eyJfake-ms-access-token-${tokenSerial}-abcDEF123`
    validAccessTokens.add(token)
    issuedAccessTokens.push(token)
    return { access_token: token, refresh_token: FAKE_MS_REFRESH_TOKEN, expires_in: accessTokenTtlSec }
  }

  function authorized(init: RequestInit | undefined): boolean {
    const header = new Headers(init?.headers).get('authorization') ?? ''
    return validAccessTokens.has(header.replace(/^Bearer\s+/i, ''))
  }

  function deltaLinkFor(atVersion: number): string {
    return `${FAKE_GRAPH_ENDPOINTS.apiBase}/me/calendarView/delta?$deltatoken=delta-${atVersion}`
  }

  function nextLinkFor(atVersion: number | null, offset: number, windowKey: string): string {
    const url = new URL(`${FAKE_GRAPH_ENDPOINTS.apiBase}/me/calendarView/delta`)
    url.searchParams.set('$skiptoken', `skip-${offset}-${atVersion ?? 'full'}-${windowKey}`)
    return url.toString()
  }

  function eventsResponse(url: URL): Response {
    const dueIndex = scheduledFailures.findIndex((entry) => entry.at === eventsRequests)
    const injected = dueIndex >= 0 ? scheduledFailures.splice(dueIndex, 1)[0].failure : null
    if (injected) {
      const headers: Record<string, string> = {}
      if (injected.retryAfterSec != null) headers['Retry-After'] = String(injected.retryAfterSec)
      return json(injected.status, { error: { code: 'injected', message: 'injected failure' } }, headers)
    }

    const deltaToken = url.searchParams.get('$deltatoken')
    const skipToken = url.searchParams.get('$skiptoken')

    let sinceVersion: number | null = null
    let offset = 0
    let windowKey = 'live'
    if (skipToken) {
      const [, offsetPart, versionPart, windowPart] = /^skip-(\d+)-([^-]+)-(.*)$/.exec(skipToken) ?? []
      offset = Number(offsetPart ?? 0)
      sinceVersion = versionPart === 'full' ? null : Number(versionPart)
      windowKey = windowPart ?? 'live'
    } else if (deltaToken) {
      const tokenVersion = Number(deltaToken.replace('delta-', ''))
      if (!Number.isFinite(tokenVersion) || tokenVersion <= deltaTokenFloor) {
        return json(410, { error: { code: 'resyncRequired', message: 'The delta token is no longer valid.' } })
      }
      sinceVersion = tokenVersion
    } else {
      // Initial windowed request: startDateTime/endDateTime are required.
      if (!url.searchParams.get('startDateTime') || !url.searchParams.get('endDateTime')) {
        return json(400, { error: { code: 'invalidRequest', message: 'startDateTime and endDateTime are required.' } })
      }
      windowKey = `${url.searchParams.get('startDateTime')}|${url.searchParams.get('endDateTime')}`
    }

    let items: OutlookApiEvent[]
    if (sinceVersion != null) {
      items = [...events.values()]
        .filter((entry) => entry.version > sinceVersion)
        .map((entry) => entry.removed
          ? { id: entry.event.id, '@removed': { reason: 'deleted' } }
          : entry.event)
    } else {
      const [startIso, endIso] = windowKey === 'live' ? [null, null] : windowKey.split('|')
      const startMs = startIso ? Date.parse(startIso) : null
      const endMs = endIso ? Date.parse(endIso) : null
      items = [...events.values()]
        .filter((entry) => !entry.removed && entry.event.isCancelled !== true)
        .filter((entry) => {
          const raw = entry.event.start?.dateTime
          if (!raw || startMs == null || endMs == null) return true
          const ms = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`)
          return Number.isFinite(ms) ? ms >= startMs && ms <= endMs : true
        })
        .map((entry) => entry.event)
    }

    if (pageSize != null && items.length > offset + pageSize) {
      return json(200, {
        value: items.slice(offset, offset + pageSize),
        '@odata.nextLink': nextLinkFor(sinceVersion, offset + pageSize, windowKey),
      })
    }
    return json(200, {
      value: items.slice(offset),
      '@odata.deltaLink': deltaLinkFor(version),
    })
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const href = `${url.origin}${url.pathname}`

    if (href === FAKE_GRAPH_ENDPOINTS.deviceCode) {
      deviceCodeRequests += 1
      deviceState = 'pending'
      return json(200, {
        device_code: FAKE_MS_DEVICE_CODE,
        user_code: FAKE_MS_USER_CODE,
        verification_uri: FAKE_MS_VERIFICATION_URI,
        expires_in: 900,
        interval: 0,
      })
    }

    if (href === FAKE_GRAPH_ENDPOINTS.token) {
      tokenRequests += 1
      const form = formOf(init)
      if (form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:device_code') {
        if (form.get('device_code') !== FAKE_MS_DEVICE_CODE) {
          return json(400, { error: 'bad_verification_code' })
        }
        switch (deviceState) {
          case 'approved': return json(200, issueAccessToken())
          case 'declined': return json(400, { error: 'authorization_declined' })
          case 'expired': return json(400, { error: 'expired_token' })
          default: return json(400, { error: 'authorization_pending' })
        }
      }
      if (form.get('grant_type') === 'refresh_token') {
        refreshRequests += 1
        if (form.get('refresh_token') !== FAKE_MS_REFRESH_TOKEN) {
          return json(400, { error: 'invalid_grant' })
        }
        return json(200, issueAccessToken())
      }
      return json(400, { error: 'unsupported_grant_type' })
    }

    if (href === `${FAKE_GRAPH_ENDPOINTS.apiBase}/me`) {
      if (!authorized(init)) return json(401, { error: { code: 'InvalidAuthenticationToken' } })
      return json(200, { userPrincipalName: accountEmail, mail: accountEmail, displayName: 'Owner Example' })
    }

    if (href === `${FAKE_GRAPH_ENDPOINTS.apiBase}/me/calendarView/delta`) {
      if (!authorized(init)) return json(401, { error: { code: 'InvalidAuthenticationToken' } })
      eventsRequests += 1
      return eventsResponse(url)
    }

    throw new Error(`fake Microsoft Graph received an unexpected request: ${href}`)
  }

  return {
    fetchImpl,
    approveDevice() { deviceState = 'approved' },
    declineDevice() { deviceState = 'declined' },
    expireDevice() { deviceState = 'expired' },
    putEvent(event) {
      version += 1
      events.set(event.id!, { event, version, removed: false })
    },
    removeEvent(id) {
      const existing = events.get(id)
      version += 1
      events.set(id, { event: existing?.event ?? { id }, version, removed: true })
    },
    cancelEvent(id) {
      const existing = events.get(id)
      version += 1
      events.set(id, { event: { ...(existing?.event ?? {}), id, isCancelled: true }, version, removed: false })
    },
    failNextEventsRequest(failure, afterRequests = 0) {
      scheduledFailures.push({ at: eventsRequests + 1 + afterRequests, failure })
    },
    expireDeltaTokens() {
      deltaTokenFloor = version
      version += 1
    },
    setPageSize(size) { pageSize = size },
    setAccessTokenTtlSec(seconds) { accessTokenTtlSec = seconds },
    get eventsRequests() { return eventsRequests },
    get tokenRequests() { return tokenRequests },
    get refreshRequests() { return refreshRequests },
    get deviceCodeRequests() { return deviceCodeRequests },
    get issuedAccessTokens() { return issuedAccessTokens },
  }
}
