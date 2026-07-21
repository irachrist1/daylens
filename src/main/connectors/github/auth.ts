// GitHub authorization for a desktop app (DEV-191): the OAuth device flow
// (RFC 8628). It is the desktop-friendly path — only a public client id, no
// client secret, no loopback port: Daylens requests a device code, shows the
// person a short user code, opens github.com/login/device in their browser,
// and polls the token endpoint until they approve. Pointing the client id at
// a GitHub App keeps the grant read-only at the PROVIDER: the app's
// permissions (contents/pull_requests/issues/metadata, all read-only) bound
// every token it can ever mint.
//
// Tokens go straight into the OS secure store via ../credentials.ts and never
// appear in return values other than the token set itself, in thrown errors,
// or in logs. The device code — the polling credential — never leaves this
// module; the USER code is deliberately shown to the person (that is how the
// flow works) and is useless without the device code.
//
// Everything network-shaped is injectable (`fetchImpl`, endpoints, the
// browser opener), so the whole flow is provable with stubbed endpoints — no
// real network, ever, in tests.

const GITHUB_DEVICE_CODE_ENDPOINT = 'https://github.com/login/device/code'
const GITHUB_TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token'

/** The token set persisted (as JSON) in the OS secure store — never anywhere
 *  else. `clientId` rides along because refresh needs it and it must not live
 *  in the database-backed connection config. `expiresAtMs: 0` means the token
 *  does not expire (classic OAuth-app device tokens). */
export interface GithubOAuthTokens {
  accessToken: string
  refreshToken: string | null
  expiresAtMs: number
  clientId: string
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

/** Applied under the reported lifetime so a token refreshes BEFORE GitHub
 *  would reject it mid-sync. */
const EXPIRY_SAFETY_MS = 60_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postForm<T>(
  fetchImpl: typeof fetch,
  endpoint: string,
  form: Record<string, string>,
  failureLabel: string,
): Promise<T> {
  let response: Response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
    })
  } catch {
    // Never echo the underlying error: the request body carries the device
    // code / refresh token and some runtimes quote it in network errors.
    throw new Error(`${failureLabel}: GitHub was unreachable.`)
  }
  if (!response.ok) {
    // Deliberately NOT the response body — provider error bodies can quote
    // the credential material we sent.
    throw new Error(`${failureLabel}: GitHub answered HTTP ${response.status}.`)
  }
  try {
    return await response.json() as T
  } catch {
    throw new Error(`${failureLabel}: GitHub's response was not readable JSON.`)
  }
}

function tokensOf(
  body: TokenPollResponse,
  clientId: string,
  nowMs: number,
  previousRefreshToken: string | null,
): GithubOAuthTokens {
  return {
    accessToken: body.access_token!,
    refreshToken: body.refresh_token ?? previousRefreshToken,
    // GitHub App user tokens expire and refresh; classic OAuth-app device
    // tokens carry no expiry and never need refreshing.
    expiresAtMs: body.expires_in != null
      ? nowMs + Math.max(0, body.expires_in * 1000 - EXPIRY_SAFETY_MS)
      : 0,
    clientId,
  }
}

export interface DeviceAuthorizationInput {
  clientId: string
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
 * user code, open the browser, poll the token endpoint at the interval GitHub
 * dictates (honoring slow_down) until the person approves, is denied, or the
 * code expires. The device code never appears in thrown errors.
 */
export async function runDeviceAuthorization(input: DeviceAuthorizationInput): Promise<GithubOAuthTokens> {
  const nowMs = input.nowMs ?? Date.now()
  const label = 'GitHub authorization could not be completed'

  const device = await postForm<DeviceCodeResponse>(
    input.fetchImpl,
    input.deviceCodeEndpoint ?? GITHUB_DEVICE_CODE_ENDPOINT,
    { client_id: input.clientId },
    label,
  )
  if (!device.device_code || !device.user_code || !device.verification_uri) {
    throw new Error(`${label}: GitHub's device-code response was incomplete (is the client ID a device-flow-enabled app?).`)
  }

  input.onUserCode({ userCode: device.user_code, verificationUri: device.verification_uri })
  try {
    await input.openExternal?.(device.verification_uri)
  } catch {
    // The person can still browse there by hand; the code prompt names the address.
  }

  const deadline = Date.now() + (input.timeoutMs ?? 5 * 60_000)
  let intervalMs = Math.max(0, (device.interval ?? 5) * 1000)

  while (true) {
    if (Date.now() > deadline) {
      throw new Error('GitHub authorization timed out — the device code was not approved in time.')
    }
    const poll = await postForm<TokenPollResponse>(
      input.fetchImpl,
      input.tokenEndpoint ?? GITHUB_TOKEN_ENDPOINT,
      {
        client_id: input.clientId,
        device_code: device.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      },
      label,
    )
    if (poll.access_token) return tokensOf(poll, input.clientId, nowMs, null)
    switch (poll.error) {
      case 'authorization_pending':
        break
      case 'slow_down':
        // GitHub names the new minimum interval; without one, add the
        // RFC 8628 five seconds.
        intervalMs = poll.interval != null ? poll.interval * 1000 : intervalMs + 5_000
        break
      case 'access_denied':
        throw new Error('GitHub authorization was denied — the request was cancelled on github.com.')
      case 'expired_token':
        throw new Error('GitHub authorization expired before the code was entered. Connect again for a fresh code.')
      default:
        throw new Error(`${label}: GitHub refused the device authorization.`)
    }
    await sleep(intervalMs)
  }
}

export interface RefreshGithubTokenInput {
  fetchImpl: typeof fetch
  tokens: GithubOAuthTokens
  tokenEndpoint?: string
  nowMs?: number
}

/** Refresh an expiring GitHub App user token. Classic device tokens never
 *  expire (`expiresAtMs: 0`) and never reach this. */
export async function refreshGithubAccessToken(input: RefreshGithubTokenInput): Promise<GithubOAuthTokens> {
  if (!input.tokens.refreshToken) {
    throw new Error('GitHub authorization expired and no refresh token is stored. Reconnect to resume syncing.')
  }
  const body = await postForm<TokenPollResponse>(
    input.fetchImpl,
    input.tokenEndpoint ?? GITHUB_TOKEN_ENDPOINT,
    {
      client_id: input.tokens.clientId,
      grant_type: 'refresh_token',
      refresh_token: input.tokens.refreshToken,
    },
    'GitHub authorization could not be refreshed',
  )
  if (!body.access_token || body.error) {
    throw new Error('GitHub refused to refresh the authorization. Reconnect to resume syncing.')
  }
  return tokensOf(body, input.tokens.clientId, input.nowMs ?? Date.now(), input.tokens.refreshToken)
}
