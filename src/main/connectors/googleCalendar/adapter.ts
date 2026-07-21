// The Google Calendar connector (DEV-188) — the first REAL provider on the
// DEV-186 foundation. It implements the same ConnectorAdapter contract the
// fake provider proves and passes the same conformance suite:
//
//   connect     → the installed-app OAuth flow (loopback + PKCE, ./oauth.ts);
//                 tokens land in the OS secure store, the persisted connection
//                 config stays credential-free ({ calendarId } only)
//   sync        → Google syncToken semantics: a full bounded-lookback window
//                 first (attested complete, so stale records tombstone), then
//                 incremental pages whose cancellations become explicit
//                 tombstones; an invalidated token (HTTP 410) falls back to a
//                 fresh attested full window; a thrown page never advances the
//                 cursor (the ingest transaction owns that invariant)
//   inspect     → credential-free health from the stored-authorization state
//   disconnect  → best-effort provider-side token revocation; the service
//                 layer owns credential deletion and local data removal
//
// No secrets in code: the OAuth client id (and optional desktop client
// secret) come from the person's connect input or DAYLENS_GOOGLE_OAUTH_*
// environment variables. Everything with a network shape is injectable, so
// the entire adapter is provable against an in-memory Google.

import { registerConnectorAdapter } from '../registry'
import type {
  ConnectorAdapter,
  ConnectorConnectInput,
  ConnectorConnectResult,
  ConnectorConnection,
  ConnectorHealth,
  ConnectorManifest,
  ConnectorRecordEnvelope,
  ConnectorSyncPage,
  ConnectorSyncRequest,
} from '../contract'
import {
  clearConnectorSecret,
  getConnectorSecret,
  setConnectorSecret,
  type ConnectorSecretStore,
} from '../credentials'
import {
  getCalendarSummary,
  listEventsPage,
  GoogleSyncTokenExpiredError,
  type GoogleApiEvent,
} from './api'
import {
  refreshGoogleAccessToken,
  revokeGoogleToken,
  runLoopbackAuthorization,
  type GoogleOAuthTokens,
} from './oauth'
import {
  GOOGLE_CALENDAR_CONNECTOR_ID,
  GOOGLE_CALENDAR_SCOPE,
  isCancelledGoogleEvent,
  isDeclinedBySelf,
  normalizeGoogleEvent,
} from './normalize'

const HOUR = 60 * 60 * 1000

// Matches the registry's manifest-only entry word for word — the consistency
// test (tests/googleCalendarConnector.test.ts) keeps the two from drifting —
// with `available` flipped: a working adapter ships in this build.
export const GOOGLE_CALENDAR_MANIFEST: ConnectorManifest = {
  id: GOOGLE_CALENDAR_CONNECTOR_ID,
  displayName: 'Google Calendar',
  providerKind: 'calendar',
  integration: 'direct',
  authKind: 'oauth',
  readOnly: true,
  scopes: [
    { scope: GOOGLE_CALENDAR_SCOPE, grants: 'Reads your calendars and events. Never creates, edits, or deletes anything.' },
  ],
  whatItBrings:
    'Your meetings as they actually happen — titles, times, attendees, and responses — kept in sync automatically. A scheduled event only becomes "you met" when your day\'s activity supports it.',
  sensitivity: 'standard',
  syncCadenceMs: HOUR,
  lookbackDays: 90,
  rateLimit: { maxRequestsPerMinute: 60, backoffBaseMs: 5_000, backoffMaxMs: HOUR },
  available: true,
}

/** Safety cap on pages per sync call — 250 events/page × 40 pages is far past
 *  any realistic 90-day calendar; hitting it means something is wrong and the
 *  sync fails WITHOUT advancing the cursor rather than looping forever. */
const MAX_PAGES_PER_SYNC = 40

export interface GoogleCalendarAdapterDeps {
  /** Network entry point — a test injects an in-memory Google here. */
  fetchImpl?: typeof fetch
  /** Opens the system browser for the OAuth flow. The default lazy-loads
   *  Electron's shell so this module stays importable without Electron. */
  openExternal?: (url: string) => Promise<void> | void
  /** Credential vault override for hermetic tests. */
  secretStore?: ConnectorSecretStore | null
  endpoints?: {
    auth?: string
    token?: string
    revoke?: string
    apiBase?: string
  }
  /** Environment for the DAYLENS_GOOGLE_OAUTH_* fallbacks. */
  env?: Record<string, string | undefined>
  authTimeoutMs?: number
}

async function defaultOpenExternal(url: string): Promise<void> {
  const { shell } = await import('electron')
  await shell.openExternal(url)
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function createGoogleCalendarAdapter(deps: GoogleCalendarAdapterDeps = {}): ConnectorAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch
  const openExternal = deps.openExternal ?? defaultOpenExternal
  const secretStore = deps.secretStore ?? null
  const env = deps.env ?? process.env

  async function readTokens(): Promise<GoogleOAuthTokens | null> {
    const raw = await getConnectorSecret(GOOGLE_CALENDAR_CONNECTOR_ID, secretStore)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Partial<GoogleOAuthTokens>
      if (!parsed.accessToken || !parsed.clientId) return null
      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken ?? null,
        expiresAtMs: parsed.expiresAtMs ?? 0,
        clientId: parsed.clientId,
        clientSecret: parsed.clientSecret ?? null,
      }
    } catch {
      return null
    }
  }

  async function writeTokens(tokens: GoogleOAuthTokens): Promise<void> {
    await setConnectorSecret(GOOGLE_CALENDAR_CONNECTOR_ID, JSON.stringify(tokens), secretStore)
  }

  /** Marks an error as reauthorization-shaped: the connection flags
   *  needs_attention on the FIRST failure and Settings offers Reconnect. */
  function asReauthorizationError(error: Error): Error {
    Object.assign(error, { needsAttention: true })
    return error
  }

  /** A working access token, refreshing (and re-persisting) when the stored
   *  one is at or past its safety-margin expiry. */
  async function freshTokens(nowMs: number): Promise<GoogleOAuthTokens> {
    const tokens = await readTokens()
    if (!tokens) {
      throw asReauthorizationError(new Error('Google Calendar authorization is missing. Reconnect to resume syncing.'))
    }
    if (tokens.expiresAtMs > nowMs) return tokens
    let refreshed: GoogleOAuthTokens
    try {
      refreshed = await refreshGoogleAccessToken({
        fetchImpl,
        tokenEndpoint: deps.endpoints?.token,
        tokens,
        nowMs,
      })
    } catch (error) {
      // Google ANSWERED and refused (revoked/expired grant) → reauthorize.
      // An unreachable token service is transient — plain retryable failure.
      if (error instanceof Error && !/unreachable/.test(error.message)) {
        throw asReauthorizationError(error)
      }
      throw error
    }
    await writeTokens(refreshed)
    return refreshed
  }

  async function fullWindowSync(
    connection: ConnectorConnection,
    accessToken: string,
    nowMs: number,
  ): Promise<ConnectorSyncPage> {
    const calendarId = trimmed(connection.config.calendarId) ?? 'primary'
    const timeMin = new Date(nowMs - GOOGLE_CALENDAR_MANIFEST.lookbackDays * 24 * HOUR).toISOString()
    const events: GoogleApiEvent[] = []
    let pageToken: string | null = null
    let syncToken: string | null = null
    for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_SYNC; pageIndex += 1) {
      const page = await listEventsPage(fetchImpl, {
        calendarId,
        accessToken,
        timeMin,
        pageToken,
        apiBase: deps.endpoints?.apiBase,
      })
      events.push(...(page.items ?? []))
      if (page.nextPageToken) {
        pageToken = page.nextPageToken
        continue
      }
      syncToken = page.nextSyncToken ?? null
      break
    }
    if (!syncToken) {
      throw new Error('Google Calendar did not complete the sync window (no sync token was issued).')
    }

    const records: ConnectorRecordEnvelope[] = []
    for (const event of events) {
      const record = normalizeGoogleEvent(event, {
        retrievedAtMs: nowMs,
        accountLabel: connection.accountLabel,
        calendarId,
      })
      if (record) records.push(record)
    }
    return {
      records,
      nextCursor: syncToken,
      // The window is a complete view: every kept record id is attested, so a
      // known record missing from it (deleted, newly declined, moved out of
      // the window) tombstones. Cancelled/declined items are simply absent.
      presentSourceRecordIds: records.map((record) => record.provenance.sourceRecordId),
    }
  }

  async function incrementalSync(
    connection: ConnectorConnection,
    accessToken: string,
    syncToken: string,
    nowMs: number,
  ): Promise<ConnectorSyncPage> {
    const calendarId = trimmed(connection.config.calendarId) ?? 'primary'
    const events: GoogleApiEvent[] = []
    let pageToken: string | null = null
    let nextSyncToken: string | null = null
    for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_SYNC; pageIndex += 1) {
      const page = await listEventsPage(fetchImpl, {
        calendarId,
        accessToken,
        syncToken,
        pageToken,
        apiBase: deps.endpoints?.apiBase,
      })
      events.push(...(page.items ?? []))
      if (page.nextPageToken) {
        pageToken = page.nextPageToken
        continue
      }
      nextSyncToken = page.nextSyncToken ?? null
      break
    }

    if (events.length === 0) {
      return { records: [], nextCursor: nextSyncToken ?? syncToken, unchanged: true }
    }

    const records: ConnectorRecordEnvelope[] = []
    const deleted: string[] = []
    for (const event of events) {
      if (!event.id) continue
      // A cancellation — and a decline by the person — is a deletion for
      // Daylens: the record (if known) tombstones with its derived data.
      if (isCancelledGoogleEvent(event) || isDeclinedBySelf(event)) {
        deleted.push(event.id)
        continue
      }
      const record = normalizeGoogleEvent(event, {
        retrievedAtMs: nowMs,
        accountLabel: connection.accountLabel,
        calendarId,
      })
      if (record) records.push(record)
    }
    return {
      records,
      nextCursor: nextSyncToken ?? syncToken,
      deletedSourceRecordIds: deleted.length > 0 ? deleted : undefined,
    }
  }

  return {
    manifest: GOOGLE_CALENDAR_MANIFEST,

    async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
      const clientId = trimmed(input.config.clientId) ?? trimmed(env.DAYLENS_GOOGLE_OAUTH_CLIENT_ID)
      if (!clientId) {
        throw new Error(
          'Google Calendar needs an OAuth client ID. Create a "Desktop app" OAuth client in Google Cloud Console and paste its client ID here.',
        )
      }
      const clientSecret = trimmed(input.config.clientSecret) ?? trimmed(env.DAYLENS_GOOGLE_OAUTH_CLIENT_SECRET)

      const tokens = await runLoopbackAuthorization({
        clientId,
        clientSecret,
        scope: GOOGLE_CALENDAR_SCOPE,
        openExternal,
        fetchImpl,
        authEndpoint: deps.endpoints?.auth,
        tokenEndpoint: deps.endpoints?.token,
        timeoutMs: deps.authTimeoutMs,
      })
      await writeTokens(tokens)

      // For the primary calendar Google returns the account email as the id —
      // the honest account label Settings shows.
      const calendarId = trimmed(input.config.calendarId) ?? 'primary'
      let accountLabel = 'Google account'
      try {
        const calendar = await getCalendarSummary(fetchImpl, {
          calendarId,
          accessToken: tokens.accessToken,
          apiBase: deps.endpoints?.apiBase,
        })
        accountLabel = trimmed(calendar.id) ?? trimmed(calendar.summary) ?? accountLabel
      } catch {
        // The label is cosmetic; a failed lookup must not undo a completed
        // authorization. The first sync will surface real API trouble.
      }

      // The persisted config is credential-free BY CONSTRUCTION: the client
      // id/secret live only in the vault JSON next to the tokens.
      return { accountLabel, config: { calendarId } }
    },

    async sync(request: ConnectorSyncRequest): Promise<ConnectorSyncPage> {
      const tokens = await freshTokens(request.nowMs)
      if (!request.cursor) {
        return fullWindowSync(request.connection, tokens.accessToken, request.nowMs)
      }
      try {
        return await incrementalSync(request.connection, tokens.accessToken, request.cursor, request.nowMs)
      } catch (error) {
        if (error instanceof GoogleSyncTokenExpiredError) {
          // Google invalidated the incremental token: fall back to a fresh
          // attested full window — stale local records tombstone there.
          return fullWindowSync(request.connection, tokens.accessToken, request.nowMs)
        }
        throw error
      }
    },

    async inspect(_connection: ConnectorConnection): Promise<ConnectorHealth> {
      const tokens = await readTokens()
      if (!tokens) {
        return {
          state: 'needs_attention',
          summary: 'No Google authorization is stored on this machine. Reconnect to resume syncing.',
        }
      }
      if (tokens.expiresAtMs <= Date.now() && !tokens.refreshToken) {
        return {
          state: 'needs_attention',
          summary: 'The Google authorization expired and cannot refresh itself. Reconnect to resume syncing.',
        }
      }
      return { state: 'ok', summary: 'Authorized. Events sync on the hourly schedule.' }
    },

    async disconnect(_connection: ConnectorConnection): Promise<void> {
      // Provider-side cleanup: revoke the grant at Google, best effort. The
      // service layer deletes the vault entry and (on request) local data.
      const tokens = await readTokens()
      if (!tokens) return
      await revokeGoogleToken(fetchImpl, tokens.refreshToken ?? tokens.accessToken, deps.endpoints?.revoke)
      await clearConnectorSecret(GOOGLE_CALENDAR_CONNECTOR_ID, secretStore)
    },
  }
}

/** Startup wiring: register the working adapter so Settings → Connections
 *  gains the connect/sync/disconnect lifecycle for Google Calendar. */
export function registerGoogleCalendarConnector(): void {
  registerConnectorAdapter(createGoogleCalendarAdapter())
}
