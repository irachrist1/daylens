// Google OAuth for a desktop app (DEV-188): the standard installed-app flow —
// loopback redirect + PKCE (RFC 8252 §7.3, RFC 7636). No secrets ship in code:
// the OAuth client id (and Google's not-actually-secret desktop "client
// secret", when the owner's client has one) come from the person's connector
// settings or environment. Tokens go straight into the OS secure store via
// ../credentials.ts and NEVER appear in return values other than the token
// set itself, in thrown errors, or in logs.
//
// Everything network-shaped is injectable (`fetchImpl`, endpoints, the
// browser opener), so the whole flow is provable with a stubbed token
// endpoint and a fake browser — no real network, ever, in tests.

import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

/** The token set persisted (as JSON) in the OS secure store — never anywhere
 *  else. `clientId`/`clientSecret` ride along because refresh needs them and
 *  they must not live in the database-backed connection config. */
export interface GoogleOAuthTokens {
  accessToken: string
  refreshToken: string | null
  /** ms epoch when accessToken stops working (with a safety margin applied). */
  expiresAtMs: number
  clientId: string
  clientSecret: string | null
}

export interface PkcePair {
  verifier: string
  challenge: string
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** RFC 7636 S256: a high-entropy verifier and its SHA-256 challenge. */
export function createPkcePair(): PkcePair {
  const verifier = base64Url(randomBytes(48)) // 64 base64url chars ∈ [43, 128]
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export interface AuthUrlInput {
  clientId: string
  redirectUri: string
  scope: string
  state: string
  codeChallenge: string
  authEndpoint?: string
}

export function buildGoogleAuthUrl(input: AuthUrlInput): string {
  const url = new URL(input.authEndpoint ?? GOOGLE_AUTH_ENDPOINT)
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', input.scope)
  url.searchParams.set('state', input.state)
  url.searchParams.set('code_challenge', input.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  // A refresh token, so the hourly background sync outlives the access token.
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

interface TokenResponseBody {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

/** Applied under the reported lifetime so a token is refreshed BEFORE the
 *  provider would reject it mid-sync. */
const EXPIRY_SAFETY_MS = 60_000

async function requestToken(
  fetchImpl: typeof fetch,
  tokenEndpoint: string,
  form: Record<string, string>,
  failureLabel: string,
  nowMs: number,
  previousRefreshToken: string | null,
  client: { clientId: string; clientSecret: string | null },
): Promise<GoogleOAuthTokens> {
  let response: Response
  try {
    response = await fetchImpl(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    })
  } catch {
    // Never echo the underlying error: the request body carries the code /
    // refresh token and some runtimes include it in network error messages.
    throw new Error(`${failureLabel}: Google's token service was unreachable.`)
  }
  if (!response.ok) {
    // Deliberately NOT the response body — provider error bodies can quote
    // the credential material we sent.
    throw new Error(`${failureLabel}: Google's token service answered HTTP ${response.status}.`)
  }
  let body: TokenResponseBody
  try {
    body = await response.json() as TokenResponseBody
  } catch {
    throw new Error(`${failureLabel}: Google's token response was not readable JSON.`)
  }
  if (!body.access_token) {
    throw new Error(`${failureLabel}: Google's token response carried no access token.`)
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? previousRefreshToken,
    expiresAtMs: nowMs + Math.max(0, (body.expires_in ?? 3600) * 1000 - EXPIRY_SAFETY_MS),
    clientId: client.clientId,
    clientSecret: client.clientSecret,
  }
}

export interface ExchangeCodeInput {
  fetchImpl: typeof fetch
  tokenEndpoint?: string
  clientId: string
  clientSecret: string | null
  code: string
  codeVerifier: string
  redirectUri: string
  nowMs: number
}

export async function exchangeAuthorizationCode(input: ExchangeCodeInput): Promise<GoogleOAuthTokens> {
  const form: Record<string, string> = {
    grant_type: 'authorization_code',
    code: input.code,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
  }
  if (input.clientSecret) form.client_secret = input.clientSecret
  return requestToken(
    input.fetchImpl,
    input.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT,
    form,
    'Google authorization could not be completed',
    input.nowMs,
    null,
    { clientId: input.clientId, clientSecret: input.clientSecret },
  )
}

export interface RefreshTokenInput {
  fetchImpl: typeof fetch
  tokenEndpoint?: string
  tokens: GoogleOAuthTokens
  nowMs: number
}

export async function refreshGoogleAccessToken(input: RefreshTokenInput): Promise<GoogleOAuthTokens> {
  if (!input.tokens.refreshToken) {
    throw new Error('Google Calendar authorization expired and no refresh token is stored. Reconnect to resume syncing.')
  }
  const form: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: input.tokens.refreshToken,
    client_id: input.tokens.clientId,
  }
  if (input.tokens.clientSecret) form.client_secret = input.tokens.clientSecret
  return requestToken(
    input.fetchImpl,
    input.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT,
    form,
    'Google Calendar authorization could not be refreshed',
    input.nowMs,
    input.tokens.refreshToken,
    { clientId: input.tokens.clientId, clientSecret: input.tokens.clientSecret },
  )
}

/** Best-effort provider-side revocation on disconnect. Never throws — a
 *  failed revoke must not block the local disconnect. */
export async function revokeGoogleToken(
  fetchImpl: typeof fetch,
  token: string,
  revokeEndpoint = GOOGLE_REVOKE_ENDPOINT,
): Promise<void> {
  try {
    await fetchImpl(revokeEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    })
  } catch {
    // Best effort only.
  }
}

// ─── The loopback flow ───────────────────────────────────────────────────────

export interface LoopbackAuthorizationInput {
  clientId: string
  clientSecret: string | null
  scope: string
  /** Opens the system browser at the authorization URL. */
  openExternal: (url: string) => Promise<void> | void
  fetchImpl: typeof fetch
  authEndpoint?: string
  tokenEndpoint?: string
  /** How long to wait for the person to finish in the browser. */
  timeoutMs?: number
  nowMs?: number
}

const CALLBACK_PATH = '/oauth/google-calendar'
const RESPONSE_PAGE = '<!doctype html><meta charset="utf-8"><title>Daylens</title>'
  + '<body style="font-family:system-ui;padding:48px;max-width:32rem;margin:auto">'
  + '<h2>Google Calendar is connected to Daylens.</h2>'
  + '<p>You can close this tab and return to the app.</p></body>'

/**
 * The full installed-app authorization: bind an ephemeral loopback port on
 * 127.0.0.1, open the browser, wait for Google to redirect back with the
 * code, verify the state, exchange code + PKCE verifier for tokens. The
 * authorization code and state values never appear in thrown errors.
 */
export async function runLoopbackAuthorization(input: LoopbackAuthorizationInput): Promise<GoogleOAuthTokens> {
  const nowMs = input.nowMs ?? Date.now()
  const state = base64Url(randomBytes(24))
  const pkce = createPkcePair()

  const server = http.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Google authorization timed out — the browser flow was not completed.'))
      }, input.timeoutMs ?? 3 * 60_000)

      server.on('request', (request, response) => {
        const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
        if (url.pathname !== CALLBACK_PATH) {
          response.writeHead(404).end()
          return
        }
        const returnedState = url.searchParams.get('state')
        const returnedCode = url.searchParams.get('code')
        const providerError = url.searchParams.get('error')
        if (providerError || !returnedCode || returnedState !== state) {
          response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          response.end('<!doctype html><body>Authorization was not completed. You can close this tab.</body>')
          clearTimeout(timer)
          reject(new Error(providerError
            ? 'Google refused the authorization (the request was denied or the OAuth client is misconfigured).'
            : returnedCode
              ? 'Google authorization failed: the returned state did not match this request.'
              : 'Google authorization failed: the browser redirect carried no authorization code.'))
          return
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(RESPONSE_PAGE)
        clearTimeout(timer)
        resolve(returnedCode)
      })

      const authUrl = buildGoogleAuthUrl({
        clientId: input.clientId,
        redirectUri,
        scope: input.scope,
        state,
        codeChallenge: pkce.challenge,
        authEndpoint: input.authEndpoint,
      })
      void Promise.resolve(input.openExternal(authUrl)).catch(() => {
        clearTimeout(timer)
        reject(new Error('The system browser could not be opened for Google authorization.'))
      })
    })

    return await exchangeAuthorizationCode({
      fetchImpl: input.fetchImpl,
      tokenEndpoint: input.tokenEndpoint,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      code,
      codeVerifier: pkce.verifier,
      redirectUri,
      nowMs,
    })
  } finally {
    server.close()
  }
}
