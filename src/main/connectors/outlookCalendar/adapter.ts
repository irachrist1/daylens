// The Outlook Calendar connector (DEV-190) — Microsoft Graph on the DEV-186
// foundation, mirroring the Google Calendar adapter (DEV-188) so the two
// calendar sources behave identically from the outside. It implements the
// same ConnectorAdapter contract and passes the same conformance suite:
//
//   connect     → the OAuth device code flow (./auth.ts) — the standard
//                 public-client path for a desktop app: only a client ID, the
//                 user code surfaces through onNotice; tokens land in the OS
//                 secure store, the persisted connection config stays
//                 credential-free ({ calendarId } only)
//   sync        → Graph calendarView delta semantics: a full bounded window
//                 first (attested complete, so stale records tombstone), then
//                 incremental deltaLink pages whose "@removed" stubs,
//                 cancellations, and self-declines become explicit
//                 tombstones; an invalidated delta token (HTTP 410) falls
//                 back to a fresh attested full window, and so does a window
//                 that has aged near its forward edge (Graph deltas are
//                 windowed, unlike Google's unbounded syncToken); a thrown
//                 page never advances the cursor (the ingest transaction owns
//                 that invariant)
//   inspect     → credential-free health from the stored-authorization state
//   disconnect  → local credential deletion; the Microsoft identity platform
//                 has no public-client token revocation endpoint — the person
//                 revokes at myaccount.microsoft.com under App permissions
//
// No secrets in code: the client ID (and optional tenant) come from the
// person's connect input or DAYLENS_MICROSOFT_OAUTH_* environment variables.
// Everything with a network shape is injectable, so the entire adapter is
// provable against an in-memory Graph.

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
  buildCalendarViewDeltaUrl,
  getAuthenticatedUser,
  listCalendarViewDeltaPage,
  OutlookDeltaTokenExpiredError,
  type OutlookApiEvent,
} from './api'
import {
  refreshMicrosoftAccessToken,
  runMicrosoftDeviceAuthorization,
  type MicrosoftOAuthTokens,
} from './auth'
import {
  OUTLOOK_ACCOUNT_SCOPE,
  OUTLOOK_CALENDAR_CONNECTOR_ID,
  OUTLOOK_CALENDAR_SCOPE,
  OUTLOOK_REQUESTED_SCOPES,
  isCancelledOutlookEvent,
  isDeclinedBySelf,
  normalizeOutlookEvent,
} from './normalize'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// Matches the registry's manifest-only entry word for word — the consistency
// test (tests/outlookCalendarConnector.test.ts) keeps the two from drifting —
// with `available` flipped: a working adapter ships in this build.
export const OUTLOOK_CALENDAR_MANIFEST: ConnectorManifest = {
  id: OUTLOOK_CALENDAR_CONNECTOR_ID,
  displayName: 'Outlook Calendar',
  providerKind: 'calendar',
  integration: 'direct',
  authKind: 'oauth',
  readOnly: true,
  scopes: [
    { scope: OUTLOOK_CALENDAR_SCOPE, grants: 'Reads your Outlook calendars and events through Microsoft Graph. Never creates, edits, or deletes anything.' },
    { scope: OUTLOOK_ACCOUNT_SCOPE, grants: 'Reads your name and email address, only to label the connected account in Settings.' },
  ],
  whatItBrings:
    'Meetings from your Outlook or Microsoft 365 calendar — titles, times, attendees, and responses — kept in sync automatically. A scheduled event only becomes "you met" when your day\'s activity supports it.',
  sensitivity: 'standard',
  syncCadenceMs: HOUR,
  lookbackDays: 90,
  rateLimit: { maxRequestsPerMinute: 60, backoffBaseMs: 5_000, backoffMaxMs: HOUR },
  available: true,
}

/** Safety cap on pages per sync call — 100 events/page × 40 pages is far past
 *  any realistic 90-day calendar; hitting it means something is wrong and the
 *  sync fails WITHOUT advancing the cursor rather than looping forever. */
const MAX_PAGES_PER_SYNC = 40

/** Graph deltas track a FIXED calendarView window, so the initial window
 *  reaches this far forward; when "now" ages to within the refresh margin of
 *  that edge, the adapter re-windows with a fresh attested full sync. */
const FORWARD_WINDOW_DAYS = 60
const WINDOW_REFRESH_MARGIN_MS = 7 * DAY

/** The persisted cursor: the server-issued deltaLink plus the window edge it
 *  tracks. A cursor is bookkeeping, not a credential — it lives in the
 *  connection row exactly like Google's syncToken and never reaches the
 *  renderer (the listing projection has no cursor field). */
interface OutlookCursor {
  deltaLink: string
  windowEndMs: number
}

function parseCursor(raw: string): OutlookCursor | null {
  try {
    const parsed = JSON.parse(raw) as Partial<OutlookCursor>
    if (typeof parsed.deltaLink !== 'string' || !parsed.deltaLink) return null
    if (typeof parsed.windowEndMs !== 'number' || !Number.isFinite(parsed.windowEndMs)) return null
    return { deltaLink: parsed.deltaLink, windowEndMs: parsed.windowEndMs }
  } catch {
    return null
  }
}

export interface OutlookCalendarAdapterDeps {
  /** Network entry point — a test injects an in-memory Graph here. */
  fetchImpl?: typeof fetch
  /** Opens the system browser for the device-code flow. The default lazy-loads
   *  Electron's shell so this module stays importable without Electron. */
  openExternal?: (url: string) => Promise<void> | void
  /** Credential vault override for hermetic tests. */
  secretStore?: ConnectorSecretStore | null
  endpoints?: {
    deviceCode?: string
    token?: string
    apiBase?: string
  }
  /** Environment for the DAYLENS_MICROSOFT_OAUTH_* fallbacks. */
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

export function createOutlookCalendarAdapter(deps: OutlookCalendarAdapterDeps = {}): ConnectorAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch
  const openExternal = deps.openExternal ?? defaultOpenExternal
  const secretStore = deps.secretStore ?? null
  const env = deps.env ?? process.env

  async function readTokens(): Promise<MicrosoftOAuthTokens | null> {
    const raw = await getConnectorSecret(OUTLOOK_CALENDAR_CONNECTOR_ID, secretStore)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Partial<MicrosoftOAuthTokens>
      if (!parsed.accessToken || !parsed.clientId) return null
      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken ?? null,
        expiresAtMs: parsed.expiresAtMs ?? 0,
        clientId: parsed.clientId,
        tenant: parsed.tenant ?? 'common',
      }
    } catch {
      return null
    }
  }

  async function writeTokens(tokens: MicrosoftOAuthTokens): Promise<void> {
    await setConnectorSecret(OUTLOOK_CALENDAR_CONNECTOR_ID, JSON.stringify(tokens), secretStore)
  }

  /** Marks an error as reauthorization-shaped: the connection flags
   *  needs_attention on the FIRST failure and Settings offers Reconnect. */
  function asReauthorizationError(error: Error): Error {
    Object.assign(error, { needsAttention: true })
    return error
  }

  /** A working access token, refreshing (and re-persisting) when the stored
   *  one is at or past its safety-margin expiry. */
  async function freshTokens(nowMs: number): Promise<MicrosoftOAuthTokens> {
    const tokens = await readTokens()
    if (!tokens) {
      throw asReauthorizationError(new Error('Outlook Calendar authorization is missing. Reconnect to resume syncing.'))
    }
    if (tokens.expiresAtMs > nowMs) return tokens
    let refreshed: MicrosoftOAuthTokens
    try {
      refreshed = await refreshMicrosoftAccessToken({
        fetchImpl,
        tokenEndpoint: deps.endpoints?.token,
        tokens,
        scope: OUTLOOK_REQUESTED_SCOPES,
        nowMs,
      })
    } catch (error) {
      // Microsoft ANSWERED and refused (revoked/expired grant) → reauthorize.
      // An unreachable token service is transient — plain retryable failure.
      if (error instanceof Error && !/unreachable/.test(error.message)) {
        throw asReauthorizationError(error)
      }
      throw error
    }
    await writeTokens(refreshed)
    return refreshed
  }

  /** The connected account's own email, for owner-exclusion in normalize. It
   *  is persisted as the account label at connect time; fall back to it. */
  function ownerEmailOf(connection: ConnectorConnection): string | null {
    const label = trimmed(connection.accountLabel)
    return label && label.includes('@') ? label : null
  }

  /** Walk delta pages from `firstUrl` until Graph issues a deltaLink. */
  async function collectDeltaPages(
    firstUrl: string,
    accessToken: string,
  ): Promise<{ events: OutlookApiEvent[]; deltaLink: string }> {
    const events: OutlookApiEvent[] = []
    let url = firstUrl
    for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_SYNC; pageIndex += 1) {
      const page = await listCalendarViewDeltaPage(fetchImpl, {
        url,
        accessToken,
        apiBase: deps.endpoints?.apiBase,
      })
      events.push(...(page.value ?? []))
      if (page['@odata.nextLink']) {
        url = page['@odata.nextLink']
        continue
      }
      if (page['@odata.deltaLink']) {
        return { events, deltaLink: page['@odata.deltaLink'] }
      }
      break
    }
    throw new Error('Outlook Calendar did not complete the sync window (no delta link was issued).')
  }

  async function fullWindowSync(
    connection: ConnectorConnection,
    accessToken: string,
    nowMs: number,
  ): Promise<ConnectorSyncPage> {
    const calendarId = trimmed(connection.config.calendarId) ?? 'default'
    const windowEndMs = nowMs + FORWARD_WINDOW_DAYS * DAY
    const firstUrl = buildCalendarViewDeltaUrl({
      startIso: new Date(nowMs - OUTLOOK_CALENDAR_MANIFEST.lookbackDays * DAY).toISOString(),
      endIso: new Date(windowEndMs).toISOString(),
      apiBase: deps.endpoints?.apiBase,
    })
    const { events, deltaLink } = await collectDeltaPages(firstUrl, accessToken)

    const records: ConnectorRecordEnvelope[] = []
    for (const event of events) {
      const record = normalizeOutlookEvent(event, {
        retrievedAtMs: nowMs,
        accountLabel: connection.accountLabel,
        calendarId,
        ownerEmail: ownerEmailOf(connection),
      })
      if (record) records.push(record)
    }
    return {
      records,
      nextCursor: JSON.stringify({ deltaLink, windowEndMs } satisfies OutlookCursor),
      // The window is a complete view: every kept record id is attested, so a
      // known record missing from it (deleted, newly declined, moved out of
      // the window) tombstones. Cancelled/declined items are simply absent.
      presentSourceRecordIds: records.map((record) => record.provenance.sourceRecordId),
    }
  }

  async function incrementalSync(
    connection: ConnectorConnection,
    accessToken: string,
    cursor: OutlookCursor,
    nowMs: number,
  ): Promise<ConnectorSyncPage> {
    const calendarId = trimmed(connection.config.calendarId) ?? 'default'
    const { events, deltaLink } = await collectDeltaPages(cursor.deltaLink, accessToken)
    const nextCursor = JSON.stringify({ deltaLink, windowEndMs: cursor.windowEndMs } satisfies OutlookCursor)

    if (events.length === 0) {
      return { records: [], nextCursor, unchanged: true }
    }

    const records: ConnectorRecordEnvelope[] = []
    const deleted: string[] = []
    for (const event of events) {
      if (!event.id) continue
      // A deletion stub, a cancellation — and a decline by the person — is a
      // deletion for Daylens: the record (if known) tombstones with its
      // derived data.
      if (isCancelledOutlookEvent(event) || isDeclinedBySelf(event)) {
        deleted.push(event.id)
        continue
      }
      const record = normalizeOutlookEvent(event, {
        retrievedAtMs: nowMs,
        accountLabel: connection.accountLabel,
        calendarId,
        ownerEmail: ownerEmailOf(connection),
      })
      if (record) records.push(record)
    }
    return {
      records,
      nextCursor,
      deletedSourceRecordIds: deleted.length > 0 ? deleted : undefined,
    }
  }

  return {
    manifest: OUTLOOK_CALENDAR_MANIFEST,

    async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
      const clientId = trimmed(input.config.clientId) ?? trimmed(env.DAYLENS_MICROSOFT_OAUTH_CLIENT_ID)
      if (!clientId) {
        throw new Error(
          'Outlook Calendar needs a Microsoft application (client) ID. Register a public-client app in Microsoft Entra (Azure) with "Allow public client flows" on and paste its Application ID here.',
        )
      }
      const tenant = trimmed(input.config.tenant) ?? trimmed(env.DAYLENS_MICROSOFT_OAUTH_TENANT) ?? 'common'

      const tokens = await runMicrosoftDeviceAuthorization({
        clientId,
        tenant,
        scope: OUTLOOK_REQUESTED_SCOPES,
        fetchImpl,
        onUserCode: ({ userCode, verificationUri }) => {
          input.onNotice?.(`Enter code ${userCode} at ${verificationUri} to authorize Daylens (opening in your browser).`)
        },
        openExternal,
        deviceCodeEndpoint: deps.endpoints?.deviceCode,
        tokenEndpoint: deps.endpoints?.token,
        timeoutMs: deps.authTimeoutMs,
      })
      await writeTokens(tokens)

      // The honest account label Settings shows — and the owner identity the
      // normalizer uses to keep the person out of their own attendee lists.
      let accountLabel = 'Microsoft account'
      try {
        const user = await getAuthenticatedUser(fetchImpl, {
          accessToken: tokens.accessToken,
          apiBase: deps.endpoints?.apiBase,
        })
        accountLabel = trimmed(user.mail) ?? trimmed(user.userPrincipalName) ?? trimmed(user.displayName) ?? accountLabel
      } catch {
        // The label is cosmetic; a failed lookup must not undo a completed
        // authorization. The first sync will surface real API trouble.
      }

      // The persisted config is credential-free BY CONSTRUCTION: the client
      // id/tenant live only in the vault JSON next to the tokens.
      return { accountLabel, config: { calendarId: 'default' } }
    },

    async sync(request: ConnectorSyncRequest): Promise<ConnectorSyncPage> {
      const tokens = await freshTokens(request.nowMs)
      const cursor = request.cursor ? parseCursor(request.cursor) : null
      // No cursor, an unreadable cursor, or a window whose forward edge is
      // near: a fresh attested full window (Graph deltas cannot outlive their
      // calendarView window the way Google's syncToken can).
      if (!cursor || request.nowMs >= cursor.windowEndMs - WINDOW_REFRESH_MARGIN_MS) {
        return fullWindowSync(request.connection, tokens.accessToken, request.nowMs)
      }
      try {
        return await incrementalSync(request.connection, tokens.accessToken, cursor, request.nowMs)
      } catch (error) {
        if (error instanceof OutlookDeltaTokenExpiredError) {
          // Graph invalidated the delta token: fall back to a fresh attested
          // full window — stale local records tombstone there.
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
          summary: 'No Microsoft authorization is stored on this machine. Reconnect to resume syncing.',
        }
      }
      if (tokens.expiresAtMs <= Date.now() && !tokens.refreshToken) {
        return {
          state: 'needs_attention',
          summary: 'The Microsoft authorization expired and cannot refresh itself. Reconnect to resume syncing.',
        }
      }
      return { state: 'ok', summary: 'Authorized. Events sync on the hourly schedule.' }
    },

    async disconnect(_connection: ConnectorConnection): Promise<void> {
      // The Microsoft identity platform has no public-client token revocation
      // endpoint; the person revokes at myaccount.microsoft.com under App
      // permissions. Locally the credential is deleted — no further sync can
      // ever run. (The service layer also clears the vault; doing it here too
      // keeps the adapter safe standalone.)
      await clearConnectorSecret(OUTLOOK_CALENDAR_CONNECTOR_ID, secretStore)
    },
  }
}

/** Startup wiring: register the working adapter so Settings → Connections
 *  gains the connect/sync/disconnect lifecycle for Outlook Calendar. */
export function registerOutlookCalendarConnector(): void {
  registerConnectorAdapter(createOutlookCalendarAdapter())
}
