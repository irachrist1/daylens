// The Google installed-app OAuth flow (DEV-188): PKCE material, the
// authorization URL, the loopback redirect end to end against a STUBBED token
// endpoint (never real network — the token/refresh path is proven to use only
// the injected fetch, in the network-boundary pattern), refusal paths (denial,
// state mismatch, timeout), and the hygiene rule: no thrown error ever carries
// the authorization code, a token, or other credential-shaped content.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  buildGoogleAuthUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  refreshGoogleAccessToken,
  runLoopbackAuthorization,
  type GoogleOAuthTokens,
} from '../src/main/connectors/googleCalendar/oauth.ts'
import { GOOGLE_CALENDAR_SCOPE } from '../src/main/connectors/googleCalendar/normalize.ts'
import {
  createFakeGoogleCalendarApi,
  FAKE_AUTHORIZATION_CODE,
  FAKE_GOOGLE_ENDPOINTS,
  FAKE_REFRESH_TOKEN,
} from './support/fakeGoogleCalendarApi.ts'
import { containsCredential } from '../src/shared/credentialPatterns.ts'

const CLIENT_ID = 'testclient.apps.googleusercontent.com'

test('PKCE pairs are high-entropy and S256-consistent', () => {
  const pair = createPkcePair()
  assert.ok(pair.verifier.length >= 43 && pair.verifier.length <= 128, 'verifier length per RFC 7636')
  const expected = createHash('sha256').update(pair.verifier).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  assert.equal(pair.challenge, expected)
  assert.notEqual(createPkcePair().verifier, pair.verifier, 'verifiers are unique')
})

test('the authorization URL carries the installed-app parameters exactly', () => {
  const url = new URL(buildGoogleAuthUrl({
    clientId: CLIENT_ID,
    redirectUri: 'http://127.0.0.1:49152/oauth/google-calendar',
    scope: GOOGLE_CALENDAR_SCOPE,
    state: 'state-123',
    codeChallenge: 'challenge-abc',
  }))
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID)
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('scope'), GOOGLE_CALENDAR_SCOPE)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-abc')
  assert.equal(url.searchParams.get('access_type'), 'offline', 'a refresh token is requested for background sync')
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:49152/oauth/google-calendar')
})

test('the loopback flow completes end to end: browser redirect → PKCE-verified code exchange → tokens', async () => {
  const fake = createFakeGoogleCalendarApi()
  const tokens = await runLoopbackAuthorization({
    clientId: CLIENT_ID,
    clientSecret: null,
    scope: GOOGLE_CALENDAR_SCOPE,
    openExternal: (url) => fake.browse(url),
    fetchImpl: fake.fetchImpl,
    authEndpoint: FAKE_GOOGLE_ENDPOINTS.auth,
    tokenEndpoint: FAKE_GOOGLE_ENDPOINTS.token,
    timeoutMs: 10_000,
  })
  // The fake token endpoint 400s unless sha256(code_verifier) matches the
  // code_challenge from the auth URL — success IS the PKCE proof.
  assert.equal(tokens.accessToken, fake.issuedAccessTokens[0])
  assert.equal(tokens.refreshToken, FAKE_REFRESH_TOKEN)
  assert.ok(tokens.expiresAtMs > Date.now())
  assert.equal(tokens.clientId, CLIENT_ID)
})

test('a denied grant rejects with a plain-language error that carries no code, state, or token', async () => {
  const fake = createFakeGoogleCalendarApi()
  await assert.rejects(
    runLoopbackAuthorization({
      clientId: CLIENT_ID,
      clientSecret: null,
      scope: GOOGLE_CALENDAR_SCOPE,
      openExternal: (url) => fake.browseDeny(url),
      fetchImpl: fake.fetchImpl,
      authEndpoint: FAKE_GOOGLE_ENDPOINTS.auth,
      tokenEndpoint: FAKE_GOOGLE_ENDPOINTS.token,
      timeoutMs: 10_000,
    }),
    (error: Error) => {
      assert.ok(!error.message.includes(FAKE_AUTHORIZATION_CODE))
      assert.equal(containsCredential(error.message), false, `error leaks credential-shaped content: ${error.message}`)
      return /refused|denied/i.test(error.message)
    },
  )
})

test('a redirect with the wrong state is rejected — the code is never exchanged', async () => {
  const fake = createFakeGoogleCalendarApi()
  await assert.rejects(
    runLoopbackAuthorization({
      clientId: CLIENT_ID,
      clientSecret: null,
      scope: GOOGLE_CALENDAR_SCOPE,
      openExternal: async (url) => {
        const parsed = new URL(url)
        const redirectUri = parsed.searchParams.get('redirect_uri')!
        await fetch(`${redirectUri}?state=forged-state&code=${FAKE_AUTHORIZATION_CODE}`)
      },
      fetchImpl: fake.fetchImpl,
      authEndpoint: FAKE_GOOGLE_ENDPOINTS.auth,
      tokenEndpoint: FAKE_GOOGLE_ENDPOINTS.token,
      timeoutMs: 10_000,
    }),
    (error: Error) => /state did not match/.test(error.message),
  )
  assert.equal(fake.tokenRequests, 0, 'no exchange happens on a forged redirect')
})

test('an unfinished browser flow times out with a clean error', async () => {
  const fake = createFakeGoogleCalendarApi()
  await assert.rejects(
    runLoopbackAuthorization({
      clientId: CLIENT_ID,
      clientSecret: null,
      scope: GOOGLE_CALENDAR_SCOPE,
      openExternal: () => { /* the person never completes the browser flow */ },
      fetchImpl: fake.fetchImpl,
      authEndpoint: FAKE_GOOGLE_ENDPOINTS.auth,
      tokenEndpoint: FAKE_GOOGLE_ENDPOINTS.token,
      timeoutMs: 50,
    }),
    (error: Error) => /timed out/.test(error.message),
  )
})

test('token refresh uses the stored refresh token and keeps it when Google omits a new one', async () => {
  const fake = createFakeGoogleCalendarApi()
  const stored: GoogleOAuthTokens = {
    accessToken: 'ya29.fake-old-access-token-x',
    refreshToken: FAKE_REFRESH_TOKEN,
    expiresAtMs: 1,
    clientId: CLIENT_ID,
    clientSecret: null,
  }
  const refreshed = await refreshGoogleAccessToken({
    fetchImpl: fake.fetchImpl,
    tokenEndpoint: FAKE_GOOGLE_ENDPOINTS.token,
    tokens: stored,
    nowMs: Date.now(),
  })
  assert.equal(refreshed.accessToken, fake.issuedAccessTokens[0])
  assert.equal(refreshed.refreshToken, FAKE_REFRESH_TOKEN, 'the refresh token survives rotation-less refreshes')
  assert.ok(refreshed.expiresAtMs > Date.now())
})

test('failed exchanges and refreshes throw sanitized errors — HTTP status only, never the request material', async () => {
  const refusingFetch: typeof fetch = async () => new Response('{"error":"invalid_grant"}', { status: 400 })
  await assert.rejects(
    exchangeAuthorizationCode({
      fetchImpl: refusingFetch,
      tokenEndpoint: FAKE_GOOGLE_ENDPOINTS.token,
      clientId: CLIENT_ID,
      clientSecret: 'GOCSPX-fake-desktop-secret-123',
      code: FAKE_AUTHORIZATION_CODE,
      codeVerifier: 'verifier-abcdefghijklmnopqrstuvwxyz-0123456789-ABCDEF',
      redirectUri: 'http://127.0.0.1:1/oauth/google-calendar',
      nowMs: Date.now(),
    }),
    (error: Error) => {
      assert.ok(!error.message.includes(FAKE_AUTHORIZATION_CODE))
      assert.ok(!error.message.includes('GOCSPX'))
      assert.equal(containsCredential(error.message), false)
      return /HTTP 400/.test(error.message)
    },
  )
  await assert.rejects(
    refreshGoogleAccessToken({
      fetchImpl: refusingFetch,
      tokenEndpoint: FAKE_GOOGLE_ENDPOINTS.token,
      tokens: {
        accessToken: 'ya29.fake-old-access-token-x',
        refreshToken: FAKE_REFRESH_TOKEN,
        expiresAtMs: 1,
        clientId: CLIENT_ID,
        clientSecret: null,
      },
      nowMs: Date.now(),
    }),
    (error: Error) => {
      assert.ok(!error.message.includes(FAKE_REFRESH_TOKEN))
      assert.equal(containsCredential(error.message), false)
      return /could not be refreshed/.test(error.message)
    },
  )
})

test('network boundary: token exchange and refresh reach ONLY the injected fetch — never the process globals', async () => {
  const attempts: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = ((input: unknown) => {
    attempts.push(String(input))
    throw new Error('network disabled by googleCalendarOAuth boundary test')
  }) as typeof fetch
  try {
    const fake = createFakeGoogleCalendarApi()
    // Prime the PKCE challenge the way the real flow does, without loopback.
    const pair = createPkcePair()
    await fake.browse(buildGoogleAuthUrl({
      clientId: CLIENT_ID,
      redirectUri: 'http://127.0.0.1:1/never-listened',
      scope: GOOGLE_CALENDAR_SCOPE,
      state: 's',
      codeChallenge: pair.challenge,
      authEndpoint: FAKE_GOOGLE_ENDPOINTS.auth,
    })).catch(() => { /* the redirect target does not exist — only the challenge capture matters */ })

    const tokens = await exchangeAuthorizationCode({
      fetchImpl: fake.fetchImpl,
      tokenEndpoint: FAKE_GOOGLE_ENDPOINTS.token,
      clientId: CLIENT_ID,
      clientSecret: null,
      code: FAKE_AUTHORIZATION_CODE,
      codeVerifier: pair.verifier,
      redirectUri: 'http://127.0.0.1:1/never-listened',
      nowMs: Date.now(),
    })
    await refreshGoogleAccessToken({
      fetchImpl: fake.fetchImpl,
      tokenEndpoint: FAKE_GOOGLE_ENDPOINTS.token,
      tokens,
      nowMs: Date.now(),
    })
    // fake.browse hit globalThis.fetch once (the loopback simulation) and was
    // swallowed above; the token calls themselves must record NOTHING beyond it.
    assert.ok(attempts.length <= 1, `token calls escaped to the process globals: ${attempts.join(', ')}`)
    assert.ok(attempts.every((attempt) => attempt.includes('127.0.0.1')), 'only the loopback redirect may touch fetch')
  } finally {
    globalThis.fetch = realFetch
  }
})
