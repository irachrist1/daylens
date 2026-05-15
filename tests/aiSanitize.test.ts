import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeForModel,
  sanitizeForRender,
  sanitizeToolResult,
  stripBrowserUrlFromTitle,
} from '../src/shared/aiSanitize.ts'

// ---------------------------------------------------------------------------
// Reproduced leak case — must be the first thing this file proves.
// "Which pages opened in Google Meet?" answered with item 7 = a raw OAuth
// callback URL containing code=1.ARMB… and a base64-ish blob. The model is
// allowed to parrot URLs but every secret-shaped substring must be gone.
// ---------------------------------------------------------------------------

const LEAK_REPRO_URL =
  'https://login.live.com/oauth20_authorize.srf?code=1.ARMB-AbCdEf12345_GhIjKlMnOpQrStUvWxYz1234567890abcdEFGH&state=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

test('reproduced leak: OAuth callback with base64 + JWT — sanitizeForModel strips both', () => {
  const cleaned = sanitizeForModel(LEAK_REPRO_URL)
  assert.ok(!cleaned.includes('1.ARMB-AbCdEf'), `code= survived: ${cleaned}`)
  assert.ok(!cleaned.includes('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'), `JWT signature survived: ${cleaned}`)
  assert.ok(!cleaned.includes('eyJhbGciOiJIUzI1NiJ9'), `JWT header survived: ${cleaned}`)
  // Host + path may stay; the ?query and the blob must not.
  assert.ok(cleaned.includes('login.live.com'))
  assert.ok(!cleaned.includes('?code='))
})

test('reproduced leak: sanitizeForRender replaces matches with [redacted] and reports', () => {
  const { text, report } = sanitizeForRender(`Item 7. ${LEAK_REPRO_URL}`)
  assert.ok(!text.includes('1.ARMB-AbCdEf'))
  assert.ok(!text.includes('eyJhbGciOiJIUzI1NiJ9'))
  assert.ok(text.includes('[redacted]'))
  assert.ok(report.redactionCount >= 1, 'expected at least one redaction')
})

// ---------------------------------------------------------------------------
// Per-shape corpus — each pattern from the brief gets its own assertion pair.
// ---------------------------------------------------------------------------

test('JWT — three base64-ish segments separated by dots', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.4c9X3pFhX-VeCqxDgu0w1zTPK_4lmQ8R8oHt8Y9b0aQ'
  const cleaned = sanitizeForModel(`token: ${jwt}`)
  assert.ok(!cleaned.includes(jwt))
  assert.ok(!cleaned.includes('eyJhbGciOiJIUzI1NiJ9'))
  const { text } = sanitizeForRender(`token: ${jwt}`)
  assert.ok(text.includes('[redacted]'))
})

test('AWS access key id', () => {
  const aws = 'AKIAIOSFODNN7EXAMPLE'
  const cleaned = sanitizeForModel(`AWS_ACCESS_KEY_ID=${aws}`)
  assert.ok(!cleaned.includes(aws), `AWS key survived: ${cleaned}`)
})

test('GitHub PAT (ghp_/gho_/ghu_/ghs_/ghr_)', () => {
  const pat = 'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcd'
  const cleaned = sanitizeForModel(`GITHUB_TOKEN=${pat}`)
  assert.ok(!cleaned.includes(pat))
})

test('Slack bot token (xoxb-)', () => {
  // Split literal so the test fixture doesn't trip secret scanners.
  const slack = ['xo', 'xb', '-1234567890-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx'].join('')
  const cleaned = sanitizeForModel(`slack: ${slack}`)
  assert.ok(!cleaned.includes(slack))
})

test('OpenAI key (sk-)', () => {
  const sk = 'sk-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789aBcD'
  const cleaned = sanitizeForModel(`OPENAI_API_KEY=${sk}`)
  assert.ok(!cleaned.includes(sk))
})

test('Google OAuth (ya29.)', () => {
  const ya = 'ya29.A0ARrdaM-AbCdEf-1234_5678.GhIjKl9012.MnOpQr'
  const cleaned = sanitizeForModel(`bearer ${ya}`)
  assert.ok(!cleaned.includes(ya))
})

test('generic base64-ish ≥24 chars (mixed case + digits)', () => {
  const blob = 'Q29uZmlkZW50aWFsU2VjcmV0VG9rZW5BYjEyMzQ='
  const cleaned = sanitizeForModel(`payload=${blob}`)
  assert.ok(!cleaned.includes(blob))
})

test('hex blob ≥32 chars', () => {
  const hex = 'd41d8cd98f00b204e9800998ecf8427e8a4f9b3c2d1e6f7a0b9c8d7e6f5a4b3c'
  const cleaned = sanitizeForModel(`sha=${hex}`)
  assert.ok(!cleaned.includes(hex))
})

test('URL with query string — keeps host+path, drops query', () => {
  const url = 'https://example.com/oauth/callback?code=abc123def456&state=xyz789'
  const cleaned = sanitizeForModel(url)
  assert.ok(cleaned.startsWith('https://example.com/oauth/callback'))
  assert.ok(!cleaned.includes('code='))
  assert.ok(!cleaned.includes('state='))
})

test('innocent prose passes through unchanged', () => {
  const text = 'I worked on the router refactor today and reviewed three PRs.'
  assert.equal(sanitizeForModel(text), text)
  const { text: rendered, report } = sanitizeForRender(text)
  assert.equal(rendered, text)
  assert.equal(report.redactionCount, 0)
})

// ---------------------------------------------------------------------------
// Tool result deep-walk — proves 1B applies through nested structures.
// ---------------------------------------------------------------------------

test('sanitizeToolResult deep-walks nested objects and arrays', () => {
  const input = {
    hits: [
      { title: 'Login', windowTitle: `Sign in - ${LEAK_REPRO_URL}` },
      { title: 'Dashboard', windowTitle: 'Dashboard - app.example.com' },
    ],
    meta: { lastToken: 'sk-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789aBcD' },
    count: 2,
  }
  const out = sanitizeToolResult(input) as typeof input
  assert.ok(!out.hits[0].windowTitle.includes('1.ARMB-AbCdEf'))
  assert.ok(!out.meta.lastToken.includes('sk-AbCdEf'))
  assert.equal(out.count, 2)
  assert.equal(out.hits[1].windowTitle, 'Dashboard - app.example.com')
})

// ---------------------------------------------------------------------------
// Capture-side helper (1A).
// ---------------------------------------------------------------------------

test('stripBrowserUrlFromTitle drops query/fragment for browsers', () => {
  const stripped = stripBrowserUrlFromTitle(
    `Sign in - ${LEAK_REPRO_URL}`,
    true,
  )
  assert.ok(stripped !== null)
  assert.ok(!stripped!.includes('?code='))
  assert.ok(!stripped!.includes('1.ARMB'))
})

test('stripBrowserUrlFromTitle keeps full path for allowlisted hosts', () => {
  const title = 'PR #42 - https://github.com/daylens/daylens/pull/42?notification_referrer_id=foo'
  const stripped = stripBrowserUrlFromTitle(title, true)
  assert.ok(stripped!.includes('github.com/daylens/daylens/pull/42'))
  assert.ok(!stripped!.includes('notification_referrer_id'))
})

test('stripBrowserUrlFromTitle drops path for non-allowlisted hosts', () => {
  const title = 'Login - https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=xyz'
  const stripped = stripBrowserUrlFromTitle(title, true)
  assert.ok(stripped!.includes('login.microsoftonline.com'))
  assert.ok(!stripped!.includes('client_id'))
  // Path is dropped (not on allowlist).
  assert.ok(!stripped!.includes('/common/oauth2/v2.0/authorize'))
})

test('stripBrowserUrlFromTitle is a no-op for non-browser apps', () => {
  const title = `VS Code - ${LEAK_REPRO_URL}`
  const stripped = stripBrowserUrlFromTitle(title, false)
  assert.equal(stripped, title)
})

test('stripBrowserUrlFromTitle handles titles without URLs', () => {
  assert.equal(stripBrowserUrlFromTitle('GitHub Pull Requests', true), 'GitHub Pull Requests')
  assert.equal(stripBrowserUrlFromTitle(null, true), null)
})
