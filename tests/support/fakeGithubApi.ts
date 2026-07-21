// An in-memory GitHub for the DEV-191 adapter tests: a stubbed device-flow
// pair (device-code + token endpoints with genuine pending/approve/deny/expire
// states), and a REST read API with real conditional-request semantics —
// ETags per exact URL, 304 on If-None-Match, since filters, pagination,
// injected failures with Retry-After / X-RateLimit-Reset. The adapter under
// test receives this via its injected `fetchImpl`/`openExternal`/
// `secretStore` — no request ever leaves the process.

import { createHash } from 'node:crypto'
import type { ConnectorSecretStore } from '../../src/main/connectors/credentials.ts'
import type { GithubCommitItem, GithubIssueOrPull, GithubReview } from '../../src/main/connectors/github/api.ts'

export const FAKE_GITHUB_ENDPOINTS = {
  deviceCode: 'https://github-oauth.test/device/code',
  token: 'https://github-oauth.test/token',
  apiBase: 'https://github-api.test',
}

export const FAKE_GITHUB_DEVICE_CODE = 'devicecode-4f2a71c39b58e6d0aa14'
export const FAKE_GITHUB_USER_CODE = 'ABCD-1234'
export const FAKE_GITHUB_VERIFICATION_URI = 'https://github-oauth.test/login/device'
export const FAKE_GITHUB_REFRESH_TOKEN = 'ghr_refreshtoken0123456789abcdefghijklmn'

export function createFakeSecretStore(): ConnectorSecretStore & { dump(): Map<string, string> } {
  const secrets = new Map<string, string>()
  return {
    async getPassword(service, account) { return secrets.get(`${service}:${account}`) ?? null },
    async setPassword(service, account, password) { secrets.set(`${service}:${account}`, password) },
    async deletePassword(service, account) { return secrets.delete(`${service}:${account}`) },
    dump() { return secrets },
  }
}

export interface InjectedFailure {
  status: number
  retryAfterSec?: number
  /** Unix-seconds reset stamp for the X-RateLimit headers variant. */
  rateLimitResetSec?: number
}

interface RepoState {
  owner: string
  repo: string
  commits: GithubCommitItem[]
  pulls: Map<number, GithubIssueOrPull>
  reviews: Map<number, GithubReview[]>
  issues: Map<number, GithubIssueOrPull>
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function formOf(init: RequestInit | undefined): URLSearchParams {
  return new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
}

export interface FakeGithubApi {
  fetchImpl: typeof fetch
  /** The fake person on github.com: approves the pending device code. Wire it
   *  as the adapter's `openExternal` for a completing flow. */
  approveDevice(): void
  denyDevice(): void
  expireDevice(): void
  /** Issue GitHub-App-style expiring tokens (with refresh) instead of the
   *  classic non-expiring device tokens. */
  issueExpiringTokens(expiresInSec?: number): void
  addRepo(fullName: string): void
  addCommit(fullName: string, commit: { sha: string; message: string; date: string; authorLogin?: string }): void
  removeCommit(fullName: string, sha: string): void
  putPull(fullName: string, pull: GithubIssueOrPull): void
  addReview(fullName: string, pullNumber: number, review: GithubReview): void
  putIssue(fullName: string, issue: GithubIssueOrPull): void
  /** The next API request (after skipping `afterRequests` successful ones)
   *  answers with this failure, once. */
  failNextApiRequest(failure: InjectedFailure, afterRequests?: number): void
  /** Invalidate every issued access token (grant revoked at GitHub). */
  revokeAccessTokens(): void
  readonly apiRequests: number
  readonly etagHits: number
  readonly deviceCodeRequests: number
  readonly tokenPollRequests: number
  readonly refreshRequests: number
  readonly issuedAccessTokens: string[]
  requestsFor(fullName: string): number
}

export function createFakeGithubApi(options: { login?: string } = {}): FakeGithubApi {
  const login = options.login ?? 'ada-dev'
  const repos = new Map<string, RepoState>()

  let deviceState: 'idle' | 'pending' | 'approved' | 'denied' | 'expired' = 'idle'
  let expiringTokens: number | null = null
  let tokenSerial = 0
  const validAccessTokens = new Set<string>()
  const issuedAccessTokens: string[] = []
  const scheduledFailures: Array<{ at: number; failure: InjectedFailure }> = []
  const repoRequestCounts = new Map<string, number>()
  let apiRequests = 0
  let etagHits = 0
  let deviceCodeRequests = 0
  let tokenPollRequests = 0
  let refreshRequests = 0

  function repoState(fullName: string): RepoState {
    const key = fullName.toLowerCase()
    let state = repos.get(key)
    if (!state) {
      const [owner, repo] = fullName.split('/')
      state = { owner, repo, commits: [], pulls: new Map(), reviews: new Map(), issues: new Map() }
      repos.set(key, state)
    }
    return state
  }

  function issueAccessToken(): Record<string, unknown> {
    tokenSerial += 1
    const token = `ghu_fakeaccesstoken${tokenSerial}ABCdef0123456789`
    validAccessTokens.add(token)
    issuedAccessTokens.push(token)
    const body: Record<string, unknown> = { access_token: token, token_type: 'bearer' }
    if (expiringTokens != null) {
      body.expires_in = expiringTokens
      body.refresh_token = FAKE_GITHUB_REFRESH_TOKEN
    }
    return body
  }

  function authorized(init: RequestInit | undefined): boolean {
    const header = new Headers(init?.headers).get('authorization') ?? ''
    return validAccessTokens.has(header.replace(/^Bearer\s+/i, ''))
  }

  function etagFor(url: URL, body: unknown): string {
    const digest = createHash('sha1').update(url.pathname + url.search + JSON.stringify(body)).digest('hex')
    return `W/"${digest}"`
  }

  /** 200-with-ETag / 304 semantics for one computed list response. */
  function conditional(url: URL, init: RequestInit | undefined, body: unknown): Response {
    const etag = etagFor(url, body)
    const requested = new Headers(init?.headers).get('if-none-match')
    if (requested && requested === etag) {
      etagHits += 1
      return new Response(null, { status: 304, headers: { ETag: etag } })
    }
    return json(200, body, { ETag: etag })
  }

  function injectedFailure(): Response | null {
    const dueIndex = scheduledFailures.findIndex((entry) => entry.at === apiRequests)
    if (dueIndex < 0) return null
    const { failure } = scheduledFailures.splice(dueIndex, 1)[0]
    const headers: Record<string, string> = {}
    if (failure.retryAfterSec != null) headers['Retry-After'] = String(failure.retryAfterSec)
    if (failure.rateLimitResetSec != null) {
      headers['X-RateLimit-Remaining'] = '0'
      headers['X-RateLimit-Reset'] = String(failure.rateLimitResetSec)
    }
    return json(failure.status, { message: 'injected failure' }, headers)
  }

  function pageOf<T>(items: T[], url: URL, perPageDefault: number): T[] {
    const perPage = Number(url.searchParams.get('per_page') ?? perPageDefault)
    const page = Number(url.searchParams.get('page') ?? 1)
    return items.slice((page - 1) * perPage, page * perPage)
  }

  function apiResponse(url: URL, init: RequestInit | undefined): Response {
    apiRequests += 1
    const failed = injectedFailure()
    if (failed) return failed
    if (!authorized(init)) return json(401, { message: 'Bad credentials' })

    if (url.pathname === '/user') return json(200, { login })

    const match = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(url.pathname)
    if (!match) return json(404, { message: 'Not Found' })
    const fullName = `${match[1]}/${match[2]}`
    const key = fullName.toLowerCase()
    repoRequestCounts.set(key, (repoRequestCounts.get(key) ?? 0) + 1)
    const state = repos.get(key)
    if (!state) return json(404, { message: 'Not Found' })
    const rest = match[3] ?? ''

    if (rest === '') return json(200, { full_name: fullName, private: false })

    if (rest === '/commits') {
      const author = url.searchParams.get('author')?.toLowerCase()
      const sinceMs = url.searchParams.get('since') ? Date.parse(url.searchParams.get('since')!) : null
      const items = state.commits
        .filter((commit) => author == null || (commit.author?.login ?? login).toLowerCase() === author)
        .filter((commit) => {
          if (sinceMs == null) return true
          const ms = commit.commit?.author?.date ? Date.parse(commit.commit.author.date) : NaN
          return Number.isFinite(ms) ? ms >= sinceMs : false
        })
        .sort((a, b) => Date.parse(b.commit?.author?.date ?? '0') - Date.parse(a.commit?.author?.date ?? '0'))
      return conditional(url, init, pageOf(items, url, 100))
    }

    if (rest === '/issues') {
      const sinceMs = url.searchParams.get('since') ? Date.parse(url.searchParams.get('since')!) : null
      // GitHub's issues endpoint also returns pull requests, flagged by a
      // pull_request field — the adapter must skip those.
      const all = [
        ...state.issues.values(),
        ...[...state.pulls.values()].map((pull) => ({ ...pull, pull_request: { url: 'pull' } })),
      ]
        .filter((item) => {
          if (sinceMs == null) return true
          const ms = item.updated_at ? Date.parse(item.updated_at) : NaN
          return Number.isFinite(ms) ? ms >= sinceMs : false
        })
        .sort((a, b) => Date.parse(b.updated_at ?? '0') - Date.parse(a.updated_at ?? '0'))
      return conditional(url, init, pageOf(all, url, 100))
    }

    if (rest === '/pulls') {
      const items = [...state.pulls.values()]
        .sort((a, b) => Date.parse(b.updated_at ?? '0') - Date.parse(a.updated_at ?? '0'))
      return conditional(url, init, pageOf(items, url, 50))
    }

    const reviewsMatch = /^\/pulls\/(\d+)\/reviews$/.exec(rest)
    if (reviewsMatch) {
      return json(200, state.reviews.get(Number(reviewsMatch[1])) ?? [])
    }

    return json(404, { message: 'Not Found' })
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const href = `${url.origin}${url.pathname}`

    if (href === FAKE_GITHUB_ENDPOINTS.deviceCode) {
      deviceCodeRequests += 1
      deviceState = 'pending'
      return json(200, {
        device_code: FAKE_GITHUB_DEVICE_CODE,
        user_code: FAKE_GITHUB_USER_CODE,
        verification_uri: FAKE_GITHUB_VERIFICATION_URI,
        expires_in: 900,
        interval: 0,
      })
    }

    if (href === FAKE_GITHUB_ENDPOINTS.token) {
      const form = formOf(init)
      if (form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:device_code') {
        tokenPollRequests += 1
        if (form.get('device_code') !== FAKE_GITHUB_DEVICE_CODE) return json(200, { error: 'incorrect_device_code' })
        switch (deviceState) {
          case 'approved': return json(200, issueAccessToken())
          case 'denied': return json(200, { error: 'access_denied' })
          case 'expired': return json(200, { error: 'expired_token' })
          default: return json(200, { error: 'authorization_pending' })
        }
      }
      if (form.get('grant_type') === 'refresh_token') {
        refreshRequests += 1
        if (form.get('refresh_token') !== FAKE_GITHUB_REFRESH_TOKEN) return json(200, { error: 'bad_refresh_token' })
        return json(200, issueAccessToken())
      }
      return json(200, { error: 'unsupported_grant_type' })
    }

    if (url.origin === new URL(FAKE_GITHUB_ENDPOINTS.apiBase).origin) {
      return apiResponse(url, init)
    }

    throw new Error(`fake GitHub received an unexpected request: ${href}`)
  }

  return {
    fetchImpl,
    approveDevice() { deviceState = 'approved' },
    denyDevice() { deviceState = 'denied' },
    expireDevice() { deviceState = 'expired' },
    issueExpiringTokens(expiresInSec = 8 * 60 * 60) { expiringTokens = expiresInSec },
    addRepo(fullName) { repoState(fullName) },
    addCommit(fullName, commit) {
      repoState(fullName).commits.push({
        sha: commit.sha,
        commit: { message: commit.message, author: { date: commit.date } },
        author: { login: commit.authorLogin ?? login },
      })
    },
    removeCommit(fullName, sha) {
      const state = repoState(fullName)
      state.commits = state.commits.filter((commit) => commit.sha !== sha)
    },
    putPull(fullName, pull) {
      if (pull.number == null) throw new Error('a fake pull needs a number')
      repoState(fullName).pulls.set(pull.number, pull)
    },
    addReview(fullName, pullNumber, review) {
      const state = repoState(fullName)
      state.reviews.set(pullNumber, [...(state.reviews.get(pullNumber) ?? []), review])
    },
    putIssue(fullName, issue) {
      if (issue.number == null) throw new Error('a fake issue needs a number')
      repoState(fullName).issues.set(issue.number, issue)
    },
    failNextApiRequest(failure, afterRequests = 0) {
      scheduledFailures.push({ at: apiRequests + 1 + afterRequests, failure })
    },
    revokeAccessTokens() { validAccessTokens.clear() },
    get apiRequests() { return apiRequests },
    get etagHits() { return etagHits },
    get deviceCodeRequests() { return deviceCodeRequests },
    get tokenPollRequests() { return tokenPollRequests },
    get refreshRequests() { return refreshRequests },
    get issuedAccessTokens() { return issuedAccessTokens },
    requestsFor(fullName) { return repoRequestCounts.get(fullName.toLowerCase()) ?? 0 },
  }
}
