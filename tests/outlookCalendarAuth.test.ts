// Microsoft device-code authorization (DEV-190), end to end against stubbed
// endpoints: success (user-code prompt, browser hand-off, polling through the
// identity platform's HTTP-400 pending answers), decline, expiry, timeout,
// slow_down pacing, refresh-token rotation, sanitized failures, and the
// network boundary — every request reaches ONLY the injected fetch.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  microsoftDeviceCodeEndpoint,
  microsoftTokenEndpoint,
  refreshMicrosoftAccessToken,
  runMicrosoftDeviceAuthorization,
} from '../src/main/connectors/outlookCalendar/auth.ts'
import { OUTLOOK_REQUESTED_SCOPES } from '../src/main/connectors/outlookCalendar/normalize.ts'
import {
  createFakeMicrosoftGraphApi,
  FAKE_GRAPH_ENDPOINTS,
  FAKE_MS_DEVICE_CODE,
  FAKE_MS_REFRESH_TOKEN,
  FAKE_MS_USER_CODE,
  FAKE_MS_VERIFICATION_URI,
} from './support/fakeMicrosoftGraphApi.ts'

const CLIENT_ID = '11111111-2222-3333-4444-555555555555'

function authInput(fake = createFakeMicrosoftGraphApi()) {
  return {
    fake,
    input: {
      clientId: CLIENT_ID,
      tenant: 'common',
      scope: OUTLOOK_REQUESTED_SCOPES,
      fetchImpl: fake.fetchImpl,
      deviceCodeEndpoint: FAKE_GRAPH_ENDPOINTS.deviceCode,
      tokenEndpoint: FAKE_GRAPH_ENDPOINTS.token,
      timeoutMs: 5_000,
    },
  }
}

test('the default endpoints are the identity platform v2.0 URLs for the tenant', () => {
  assert.equal(
    microsoftDeviceCodeEndpoint('common'),
    'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode',
  )
  assert.equal(
    microsoftTokenEndpoint('organizations'),
    'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
  )
})

test('the happy path: code prompt shown, browser opened, poll resolves to a vaultable token set', async () => {
  const { fake, input } = authInput()
  const prompts: Array<{ userCode: string; verificationUri: string }> = []
  const openedUrls: string[] = []
  const tokens = await runMicrosoftDeviceAuthorization({
    ...input,
    onUserCode: (prompt) => prompts.push(prompt),
    openExternal: (url) => {
      openedUrls.push(url)
      fake.approveDevice()
    },
  })
  assert.deepEqual(prompts, [{ userCode: FAKE_MS_USER_CODE, verificationUri: FAKE_MS_VERIFICATION_URI }])
  assert.deepEqual(openedUrls, [FAKE_MS_VERIFICATION_URI])
  assert.equal(tokens.accessToken, fake.issuedAccessTokens[0])
  assert.equal(tokens.refreshToken, FAKE_MS_REFRESH_TOKEN, 'offline_access yields a refresh token')
  assert.ok(tokens.expiresAtMs > Date.now(), 'the access token expiry is tracked (with safety margin)')
  assert.equal(tokens.clientId, CLIENT_ID)
  assert.equal(tokens.tenant, 'common')
})

test('polling waits through the HTTP-400 authorization_pending answers until the person approves', async () => {
  const { fake, input } = authInput()
  const tokens = await runMicrosoftDeviceAuthorization({
    ...input,
    onUserCode: () => {},
    openExternal: () => {
      // Approval arrives a moment later; the identity platform answers the
      // interim polls with HTTP 400 { error: "authorization_pending" }.
      setTimeout(() => fake.approveDevice(), 20)
    },
  })
  assert.ok(fake.tokenRequests > 1, 'the token endpoint was polled more than once')
  assert.ok(tokens.accessToken)
})

test('slow_down stretches the polling interval and the flow still completes', async () => {
  const fake = createFakeMicrosoftGraphApi()
  let polls = 0
  const wrappedFetch: typeof fetch = async (url, init) => {
    const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
    if (form.get('grant_type')?.includes('device_code')) {
      polls += 1
      if (polls === 1) {
        return new Response(JSON.stringify({ error: 'slow_down', interval: 0 }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }
    return fake.fetchImpl(url, init)
  }
  const tokens = await runMicrosoftDeviceAuthorization({
    clientId: CLIENT_ID,
    tenant: 'common',
    scope: OUTLOOK_REQUESTED_SCOPES,
    fetchImpl: wrappedFetch,
    deviceCodeEndpoint: FAKE_GRAPH_ENDPOINTS.deviceCode,
    tokenEndpoint: FAKE_GRAPH_ENDPOINTS.token,
    timeoutMs: 10_000,
    onUserCode: () => {},
    openExternal: () => fake.approveDevice(),
  })
  assert.ok(tokens.accessToken)
  assert.ok(polls >= 2, 'polling continued after slow_down')
})

test('a decline at the sign-in page fails with plain language, never the device code', async () => {
  const { fake, input } = authInput()
  await assert.rejects(
    runMicrosoftDeviceAuthorization({
      ...input,
      onUserCode: () => {},
      openExternal: () => fake.declineDevice(),
    }),
    (error: Error) => error.message.includes('declined') && !error.message.includes(FAKE_MS_DEVICE_CODE),
  )
})

test('an expired device code asks for a fresh connect', async () => {
  const { fake, input } = authInput()
  await assert.rejects(
    runMicrosoftDeviceAuthorization({
      ...input,
      onUserCode: () => {},
      openExternal: () => fake.expireDevice(),
    }),
    (error: Error) => error.message.includes('fresh code') && !error.message.includes(FAKE_MS_DEVICE_CODE),
  )
})

test('never-approved authorization times out with a sanitized message', async () => {
  const { input } = authInput()
  await assert.rejects(
    runMicrosoftDeviceAuthorization({
      ...input,
      timeoutMs: 50,
      onUserCode: () => {},
      openExternal: () => { /* the person never approves */ },
    }),
    (error: Error) => error.message.includes('timed out') && !error.message.includes(FAKE_MS_DEVICE_CODE),
  )
})

test('an unreachable token service fails without echoing request material', async () => {
  await assert.rejects(
    runMicrosoftDeviceAuthorization({
      clientId: CLIENT_ID,
      tenant: 'common',
      scope: OUTLOOK_REQUESTED_SCOPES,
      fetchImpl: async () => { throw new Error(`socket hang up while sending device_code=${FAKE_MS_DEVICE_CODE}`) },
      onUserCode: () => {},
      timeoutMs: 1_000,
    }),
    (error: Error) => error.message.includes('unreachable') && !error.message.includes(FAKE_MS_DEVICE_CODE),
  )
})

test('refresh rotates the token set and keeps client id + tenant for the next refresh', async () => {
  const fake = createFakeMicrosoftGraphApi()
  const refreshed = await refreshMicrosoftAccessToken({
    fetchImpl: fake.fetchImpl,
    tokenEndpoint: FAKE_GRAPH_ENDPOINTS.token,
    scope: OUTLOOK_REQUESTED_SCOPES,
    tokens: {
      accessToken: 'stale-token',
      refreshToken: FAKE_MS_REFRESH_TOKEN,
      expiresAtMs: 1,
      clientId: CLIENT_ID,
      tenant: 'common',
    },
  })
  assert.equal(refreshed.accessToken, fake.issuedAccessTokens[0])
  assert.equal(refreshed.refreshToken, FAKE_MS_REFRESH_TOKEN)
  assert.equal(refreshed.clientId, CLIENT_ID)
  assert.equal(refreshed.tenant, 'common')
  assert.ok(refreshed.expiresAtMs > Date.now())
})

test('a refused refresh asks for a reconnect without echoing the refresh token', async () => {
  const fake = createFakeMicrosoftGraphApi()
  await assert.rejects(
    refreshMicrosoftAccessToken({
      fetchImpl: fake.fetchImpl,
      tokenEndpoint: FAKE_GRAPH_ENDPOINTS.token,
      scope: OUTLOOK_REQUESTED_SCOPES,
      tokens: {
        accessToken: 'stale-token',
        refreshToken: 'no-longer-valid-refresh-token',
        expiresAtMs: 1,
        clientId: CLIENT_ID,
        tenant: 'common',
      },
    }),
    (error: Error) => error.message.includes('Reconnect') && !error.message.includes('no-longer-valid-refresh-token'),
  )
})

test('a missing refresh token cannot refresh — plain-language reconnect guidance', async () => {
  await assert.rejects(
    refreshMicrosoftAccessToken({
      fetchImpl: async () => { throw new Error('must not be called') },
      scope: OUTLOOK_REQUESTED_SCOPES,
      tokens: {
        accessToken: 'stale-token',
        refreshToken: null,
        expiresAtMs: 1,
        clientId: CLIENT_ID,
        tenant: 'common',
      },
    }),
    (error: Error) => error.message.includes('Reconnect'),
  )
})
