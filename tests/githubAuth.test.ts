// GitHub device-flow authorization (DEV-191), end to end against stubbed
// endpoints: success (user-code prompt, browser hand-off, polling), denial,
// expiry, timeout, slow_down pacing, refresh, sanitized failures, and the
// network boundary — every request reaches ONLY the injected fetch.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  refreshGithubAccessToken,
  runDeviceAuthorization,
} from '../src/main/connectors/github/auth.ts'
import {
  createFakeGithubApi,
  FAKE_GITHUB_DEVICE_CODE,
  FAKE_GITHUB_ENDPOINTS,
  FAKE_GITHUB_REFRESH_TOKEN,
  FAKE_GITHUB_USER_CODE,
  FAKE_GITHUB_VERIFICATION_URI,
} from './support/fakeGithubApi.ts'

const CLIENT_ID = 'Iv1.testdeviceclient01'

function authInput(fake = createFakeGithubApi()) {
  return {
    fake,
    input: {
      clientId: CLIENT_ID,
      fetchImpl: fake.fetchImpl,
      deviceCodeEndpoint: FAKE_GITHUB_ENDPOINTS.deviceCode,
      tokenEndpoint: FAKE_GITHUB_ENDPOINTS.token,
      timeoutMs: 5_000,
    },
  }
}

test('the happy path: code prompt shown, browser opened, poll resolves to a vaultable token set', async () => {
  const { fake, input } = authInput()
  const prompts: Array<{ userCode: string; verificationUri: string }> = []
  const openedUrls: string[] = []
  const tokens = await runDeviceAuthorization({
    ...input,
    onUserCode: (prompt) => prompts.push(prompt),
    openExternal: (url) => {
      openedUrls.push(url)
      fake.approveDevice()
    },
  })
  assert.deepEqual(prompts, [{ userCode: FAKE_GITHUB_USER_CODE, verificationUri: FAKE_GITHUB_VERIFICATION_URI }])
  assert.deepEqual(openedUrls, [FAKE_GITHUB_VERIFICATION_URI])
  assert.equal(tokens.accessToken, fake.issuedAccessTokens[0])
  assert.equal(tokens.refreshToken, null, 'classic device tokens carry no refresh token')
  assert.equal(tokens.expiresAtMs, 0, 'and no expiry')
  assert.equal(tokens.clientId, CLIENT_ID)
})

test('polling waits through authorization_pending until the person approves', async () => {
  const { fake, input } = authInput()
  // Approval arrives only after the browser opens; the fake answers
  // authorization_pending until then and the flow keeps polling (interval 0).
  let approveAfterPolls = 0
  const tokens = await runDeviceAuthorization({
    ...input,
    onUserCode: () => {},
    openExternal: () => {
      approveAfterPolls = 3
      setTimeout(() => fake.approveDevice(), 20)
    },
  })
  assert.ok(approveAfterPolls > 0)
  assert.ok(fake.tokenPollRequests > 1, 'the token endpoint was polled more than once')
  assert.ok(tokens.accessToken)
})

test('slow_down stretches the polling interval and the flow still completes', async () => {
  const fake = createFakeGithubApi()
  let polls = 0
  const wrappedFetch: typeof fetch = async (url, init) => {
    const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
    if (form.get('grant_type')?.includes('device_code')) {
      polls += 1
      if (polls === 1) {
        return new Response(JSON.stringify({ error: 'slow_down', interval: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }
    return fake.fetchImpl(url, init)
  }
  const tokens = await runDeviceAuthorization({
    clientId: CLIENT_ID,
    fetchImpl: wrappedFetch,
    deviceCodeEndpoint: FAKE_GITHUB_ENDPOINTS.deviceCode,
    tokenEndpoint: FAKE_GITHUB_ENDPOINTS.token,
    timeoutMs: 10_000,
    onUserCode: () => {},
    openExternal: () => fake.approveDevice(),
  })
  assert.ok(tokens.accessToken)
  assert.ok(polls >= 2, 'polling continued after slow_down')
})

test('denial on github.com fails with plain language, never the device code', async () => {
  const { fake, input } = authInput()
  await assert.rejects(
    runDeviceAuthorization({
      ...input,
      onUserCode: () => {},
      openExternal: () => fake.denyDevice(),
    }),
    (error: Error) => error.message.includes('denied') && !error.message.includes(FAKE_GITHUB_DEVICE_CODE),
  )
})

test('an expired device code asks for a fresh connect', async () => {
  const { fake, input } = authInput()
  await assert.rejects(
    runDeviceAuthorization({
      ...input,
      onUserCode: () => {},
      openExternal: () => fake.expireDevice(),
    }),
    (error: Error) => /expired/i.test(error.message),
  )
})

test('an unapproved flow times out instead of polling forever', async () => {
  const { input } = authInput()
  await assert.rejects(
    runDeviceAuthorization({
      ...input,
      timeoutMs: 50,
      onUserCode: () => {},
      openExternal: () => { /* the person never approves */ },
    }),
    (error: Error) => /timed out/.test(error.message),
  )
})

test('endpoint failures are sanitized: no device code, no response body, no token material', async () => {
  const failingFetch: typeof fetch = async () =>
    new Response(`{"secret":"${FAKE_GITHUB_DEVICE_CODE}"}`, { status: 500 })
  await assert.rejects(
    runDeviceAuthorization({
      clientId: CLIENT_ID,
      fetchImpl: failingFetch,
      onUserCode: () => {},
    }),
    (error: Error) => error.message.includes('HTTP 500') && !error.message.includes(FAKE_GITHUB_DEVICE_CODE),
  )
})

test('refresh exchanges the stored refresh token and keeps the client id', async () => {
  const fake = createFakeGithubApi()
  fake.issueExpiringTokens(3600)
  const refreshed = await refreshGithubAccessToken({
    fetchImpl: fake.fetchImpl,
    tokenEndpoint: FAKE_GITHUB_ENDPOINTS.token,
    tokens: {
      accessToken: 'ghu_oldtokenABCdef0123456789abcdefghijk',
      refreshToken: FAKE_GITHUB_REFRESH_TOKEN,
      expiresAtMs: 1,
      clientId: CLIENT_ID,
    },
    nowMs: Date.now(),
  })
  assert.equal(refreshed.accessToken, fake.issuedAccessTokens[0])
  assert.equal(refreshed.clientId, CLIENT_ID)
  assert.ok(refreshed.expiresAtMs > Date.now(), 'the refreshed expiry is in the future')
})

test('refresh without a stored refresh token asks to reconnect instead of guessing', async () => {
  await assert.rejects(
    refreshGithubAccessToken({
      fetchImpl: async () => { throw new Error('must not be called') },
      tokens: { accessToken: 'ghu_tok', refreshToken: null, expiresAtMs: 1, clientId: CLIENT_ID },
    }),
    (error: Error) => /Reconnect/.test(error.message),
  )
})

test('network boundary: the whole flow reaches only the injected fetch, never global fetch', async () => {
  const { fake, input } = authInput()
  const realFetch = globalThis.fetch
  let globalCalls = 0
  globalThis.fetch = (async () => {
    globalCalls += 1
    throw new Error('global fetch must not be used')
  }) as typeof fetch
  try {
    const tokens = await runDeviceAuthorization({
      ...input,
      onUserCode: () => {},
      openExternal: () => fake.approveDevice(),
    })
    assert.ok(tokens.accessToken)
    assert.equal(globalCalls, 0, 'no request escaped to the real network entry point')
  } finally {
    globalThis.fetch = realFetch
  }
})
