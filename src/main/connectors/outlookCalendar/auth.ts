// Microsoft authorization for a desktop app (DEV-190): the OAuth 2.0 device
// authorization grant (RFC 8628) against the Microsoft identity platform —
// the standard public-client path for desktop apps. Only a client ID, no
// client secret, no loopback port: Daylens requests a device code, shows the
// person a short user code, opens microsoft.com/devicelogin in their browser,
// and polls the token endpoint until they approve. The requested scopes are
// read-only (Calendars.Read, User.Read) plus offline_access so the hourly
// background sync can refresh without re-prompting.
//
// Tokens go straight into the OS secure store via ../credentials.ts and never
// appear in return values other than the token set itself, in thrown errors,
// or in logs. The device code — the polling credential — never leaves this
// module; the USER code is deliberately shown to the person (that is how the
// flow works) and is useless without the device code.
//
// One Microsoft-specific wrinkle: unlike GitHub, the identity platform
// answers a still-pending poll with HTTP 400 + { error: "authorization_pending" }.
// The poll therefore reads the JSON body of non-OK responses, acts ONLY on
// the whitelisted `error` code, and never echoes `error_description` (which
// can quote request material).
//
// Everything network-shaped is injectable (`fetchImpl`, endpoints, the
// browser opener), so the whole flow is provable with stubbed endpoints — no
// real network, ever, in tests.

const MICROSOFT_LOGIN_BASE = 'https://login.microsoftonline.com'

export function microsoftDeviceCodeEndpoint(tenant: string): string {
  return `${MICROSOFT_LOGIN_BASE}/${encodeURIComponent(tenant)}/oauth2/v2.0/devicecode`
}

export function microsoftTokenEndpoint(tenant: string): string {
  return `${MICROSOFT_LOGIN_BASE}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`
}

/** The token set persisted (as JSON) in the OS secure store — never anywhere
 *  else. `clientId`/`tenant` ride along because refresh needs them and they
 *  must not live in the database-backed connection config. */
export interface MicrosoftOAuthTokens {
  accessToken: string
  refreshToken: string | null
  /** ms epoch when accessToken stops working (safety margin applied). */
  expiresAtMs: number
  clientId: string
  tenant: string
}

interface DeviceCodeResponse {
  device_code?: string
  user_code?: string
  verification_uri?: string
  expires_in?: number
  interval?: number
}

interface TokenPollResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  interval?: number
}

/** Applied under the reported lifetime so a token refreshes BEFORE Microsoft
 *  would reject it mid-sync. */
const EXPIRY_SAFETY_MS = 60_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** POST a form and return { ok, body }. Non-OK responses still parse their
 *  JSON (the identity platform reports poll state through 400 bodies), but a
 *  network failure or unreadable body throws WITHOUT echoing the underlying
 *  error — the request body carries the device code / refresh token and some
 *  runtimes quote it in network errors. */
async function postForm(
  fetchImpl: typeof fetch,
  endpoint: string,
  form: Record<string, string>,
  failureLabel: string,
): Promise<{ ok: boolean; body: TokenPollResponse & DeviceCodeResponse }> {
  let response: Response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    })
  } catch {
    throw new Error(`${failureLabel}: Microsoft's sign-in service was unreachable.`)
  }
  try {
    return { ok: response.ok, body: await response.json() as TokenPollResponse & DeviceCodeResponse }
  } catch {
    // Deliberately NOT the response body or status text — provider error
    // bodies can quote the credential material we sent.
    throw new Error(`${failureLabel}: Microsoft's response was not readable JSON.`)
  }
}

function tokensOf(
  body: TokenPollResponse,
  client: { clientId: string; tenant: string },
  nowMs: number,
  previousRefreshToken: string | null,
): MicrosoftOAuthTokens {
  return {
    accessToken: body.access_token!,
    // The identity platform rotates refresh tokens: always keep the newest.
    refreshToken: body.refresh_token ?? previousRefreshToken,
    expiresAtMs: nowMs + Math.max(0, (body.expires_in ?? 3600) * 1000 - EXPIRY_SAFETY_MS),
    clientId: client.clientId,
    tenant: client.tenant,
  }
}

export interface MicrosoftDeviceAuthorizationInput {
  clientId: string
  /** Entra tenant: "common" (any account), "organizations", "consumers", or a
   *  specific tenant id. Desktop default is "common". */
  tenant: string
  /** The full space-separated scope string requested from the provider. */
  scope: string
  fetchImpl: typeof fetch
  /** Shows the person their user code and where to enter it. REQUIRED for a
   *  device flow to be completable — the code exists nowhere else. */
  onUserCode: (prompt: { userCode: string; verificationUri: string }) => void
  /** Opens the system browser at the verification page. Best effort — the
   *  person can also type the address by hand. */
  openExternal?: (url: string) => Promise<void> | void
  deviceCodeEndpoint?: string
  tokenEndpoint?: string
  /** How long to wait for the person to approve in the browser. */
  timeoutMs?: number
  nowMs?: number
}

/**
 * The full device authorization: request a device+user code pair, surface the
 * user code, open the browser, poll the token endpoint at the interval
 * Microsoft dictates (honoring slow_down) until the person approves, declines,
 * or the code expires. The device code never appears in thrown errors.
 */
export async function runMicrosoftDeviceAuthorization(
  input: MicrosoftDeviceAuthorizationInput,
): Promise<MicrosoftOAuthTokens> {
  const nowMs = input.nowMs ?? Date.now()
  const label = 'Microsoft authorization could not be completed'
  const deviceCodeEndpoint = input.deviceCodeEndpoint ?? microsoftDeviceCodeEndpoint(input.tenant)
  const tokenEndpoint = input.tokenEndpoint ?? microsoftTokenEndpoint(input.tenant)

  const device = await postForm(
    input.fetchImpl,
    deviceCodeEndpoint,
    { client_id: input.clientId, scope: input.scope },
    label,
  )
  if (!device.ok || !device.body.device_code || !device.body.user_code || !device.body.verification_uri) {
    throw new Error(`${label}: Microsoft's device-code response was incomplete (is the client ID a public-client app with device code flow allowed?).`)
  }

  input.onUserCode({ userCode: device.body.user_code, verificationUri: device.body.verification_uri })
  try {
    await input.openExternal?.(device.body.verification_uri)
  } catch {
    // The person can still browse there by hand; the code prompt names the address.
  }

  const deadline = Date.now() + (input.timeoutMs ?? 5 * 60_000)
  let intervalMs = Math.max(0, (device.body.interval ?? 5) * 1000)

  while (true) {
    if (Date.now() > deadline) {
      throw new Error('Microsoft authorization timed out — the device code was not approved in time.')
    }
    const poll = await postForm(
      input.fetchImpl,
      tokenEndpoint,
      {
        client_id: input.clientId,
        device_code: device.body.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      },
      label,
    )
    if (poll.ok && poll.body.access_token) {
      return tokensOf(poll.body, { clientId: input.clientId, tenant: input.tenant }, nowMs, null)
    }
    switch (poll.body.error) {
      case 'authorization_pending':
        break
      case 'slow_down':
        // Microsoft names the new minimum interval; without one, add the
        // RFC 8628 five seconds.
        intervalMs = poll.body.interval != null ? poll.body.interval * 1000 : intervalMs + 5_000
        break
      case 'authorization_declined':
        throw new Error('Microsoft authorization was declined — the request was cancelled at the sign-in page.')
      case 'expired_token':
        throw new Error('Microsoft authorization expired before the code was entered. Connect again for a fresh code.')
      default:
        // Any other error code (bad_verification_code, invalid_client, ...)
        // is unrecoverable for this attempt. Never echo error_description.
        throw new Error(`${label}: Microsoft refused the device authorization.`)
    }
    await sleep(intervalMs)
  }
}

export interface RefreshMicrosoftTokenInput {
  fetchImpl: typeof fetch
  tokens: MicrosoftOAuthTokens
  scope: string
  tokenEndpoint?: string
  nowMs?: number
}

/** Refresh an expiring access token with the stored (rotating) refresh token. */
export async function refreshMicrosoftAccessToken(
  input: RefreshMicrosoftTokenInput,
): Promise<MicrosoftOAuthTokens> {
  if (!input.tokens.refreshToken) {
    throw new Error('Outlook Calendar authorization expired and no refresh token is stored. Reconnect to resume syncing.')
  }
  const label = 'Outlook Calendar authorization could not be refreshed'
  const { ok, body } = await postForm(
    input.fetchImpl,
    input.tokenEndpoint ?? microsoftTokenEndpoint(input.tokens.tenant),
    {
      client_id: input.tokens.clientId,
      grant_type: 'refresh_token',
      refresh_token: input.tokens.refreshToken,
      scope: input.scope,
    },
    label,
  )
  if (!ok || !body.access_token) {
    throw new Error('Microsoft refused to refresh the authorization. Reconnect to resume syncing.')
  }
  return tokensOf(body, { clientId: input.tokens.clientId, tenant: input.tokens.tenant }, input.nowMs ?? Date.now(), input.tokens.refreshToken)
}
