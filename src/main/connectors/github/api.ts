// The thin GitHub REST read layer (DEV-191). One job: issue GET requests with
// a bearer token and turn provider failures into TYPED, SANITIZED errors the
// adapter can act on — never an error that echoes a request URL or a response
// body (either could quote anything). Conditional requests ride along where
// they are cheap: every list read carries its stored ETag and a 304 answer
// costs no rate-limit budget and moves no data. `fetchImpl` is injected, so
// tests drive this against an in-memory GitHub and never touch the network.

const GITHUB_API_BASE = 'https://api.github.com'

/** The stored authorization no longer works (HTTP 401, or 403 that is not
 *  rate-limit shaped). `needsAttention` makes the connection flag
 *  needs_attention immediately — Settings shows the reauthorize affordance
 *  instead of a silent retry loop. */
export class GithubAuthorizationError extends Error {
  readonly needsAttention = true
  constructor() {
    super('GitHub authorization was rejected. Reconnect to resume syncing.')
  }
}

/** Rate limited (HTTP 429, or 403 with rate-limit headers). `retryAfterMs`
 *  carries the provider's reset hint so the backoff can respect it. */
export class GithubRateLimitError extends Error {
  readonly retryAfterMs: number | null
  constructor(retryAfterMs: number | null) {
    super('GitHub rate-limited the sync; it will retry on a bounded backoff.')
    this.retryAfterMs = retryAfterMs
  }
}

/** The requested repository does not exist or the token cannot see it. */
export class GithubNotFoundError extends Error {
  constructor(what: string) {
    super(`GitHub could not find ${what} with this authorization.`)
  }
}

export interface GithubUser {
  login?: string
  name?: string | null
}

export interface GithubRepoSummary {
  full_name?: string
  private?: boolean
}

export interface GithubCommitItem {
  sha?: string
  commit?: {
    message?: string
    author?: { name?: string; email?: string; date?: string }
  }
  author?: { login?: string } | null
}

export interface GithubIssueOrPull {
  number?: number
  title?: string
  state?: string
  draft?: boolean
  merged_at?: string | null
  created_at?: string
  updated_at?: string
  user?: { login?: string } | null
  assignees?: Array<{ login?: string }> | null
  requested_reviewers?: Array<{ login?: string }> | null
  /** Present on items from the issues endpoint that are really pull requests. */
  pull_request?: unknown
}

export interface GithubReview {
  id?: number
  state?: string
  submitted_at?: string
  user?: { login?: string } | null
}

/** A conditional GET's outcome: fresh JSON with its new ETag, or 304. */
export type GithubConditionalResult<T> =
  | { status: 'ok'; body: T; etag: string | null }
  | { status: 'not_modified' }

function retryAfterMsOf(response: Response, nowMs: number): number | null {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000)
  }
  const reset = response.headers.get('x-ratelimit-reset')
  if (reset) {
    const resetMs = Number(reset) * 1000
    if (Number.isFinite(resetMs) && resetMs > nowMs) return Math.round(resetMs - nowMs)
  }
  return null
}

function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true
  if (response.status !== 403) return false
  if (response.headers.get('retry-after')) return true
  return response.headers.get('x-ratelimit-remaining') === '0'
}

export interface GithubGetParams {
  /** Path + query under the API base, e.g. `/repos/o/r/commits?since=…`. */
  path: string
  accessToken: string
  /** Stored ETag for this exact path; the response may be 304. */
  etag?: string | null
  apiBase?: string
  nowMs?: number
}

export async function githubGet<T>(
  fetchImpl: typeof fetch,
  params: GithubGetParams,
  what: string,
): Promise<GithubConditionalResult<T>> {
  const nowMs = params.nowMs ?? Date.now()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.accessToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Daylens',
  }
  if (params.etag) headers['If-None-Match'] = params.etag
  let response: Response
  try {
    response = await fetchImpl(`${params.apiBase ?? GITHUB_API_BASE}${params.path}`, {
      method: 'GET',
      headers,
    })
  } catch {
    throw new Error(`GitHub was unreachable while ${what}.`)
  }
  if (response.status === 304) return { status: 'not_modified' }
  if (isRateLimited(response)) throw new GithubRateLimitError(retryAfterMsOf(response, nowMs))
  if (response.status === 401 || response.status === 403) throw new GithubAuthorizationError()
  if (response.status === 404) throw new GithubNotFoundError(what.replace(/^reading /, ''))
  if (!response.ok) {
    throw new Error(`GitHub answered HTTP ${response.status} while ${what}.`)
  }
  let body: T
  try {
    body = await response.json() as T
  } catch {
    throw new Error(`GitHub returned an unreadable response while ${what}.`)
  }
  return { status: 'ok', body, etag: response.headers.get('etag') }
}

/** Unconditional convenience for reads whose answers are never cached. */
async function getJson<T>(
  fetchImpl: typeof fetch,
  params: Omit<GithubGetParams, 'etag'>,
  what: string,
): Promise<T> {
  const result = await githubGet<T>(fetchImpl, params, what)
  if (result.status !== 'ok') {
    throw new Error(`GitHub returned an unexpected empty response while ${what}.`)
  }
  return result.body
}

export async function getAuthenticatedUser(
  fetchImpl: typeof fetch,
  params: { accessToken: string; apiBase?: string },
): Promise<GithubUser> {
  return getJson<GithubUser>(fetchImpl, { ...params, path: '/user' }, 'reading the connected account')
}

export async function getRepoSummary(
  fetchImpl: typeof fetch,
  params: { owner: string; repo: string; accessToken: string; apiBase?: string },
): Promise<GithubRepoSummary> {
  const { owner, repo, ...rest } = params
  return getJson<GithubRepoSummary>(
    fetchImpl,
    { ...rest, path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` },
    `the repository ${owner}/${repo}`,
  )
}

export interface ListCommitsParams {
  owner: string
  repo: string
  accessToken: string
  /** Only commits authored by this login — the connected account. */
  author: string
  page: number
  perPage?: number
  etag?: string | null
  apiBase?: string
  nowMs?: number
}

/** Commits newest first. Deliberately NO `since` parameter: the URL stays
 *  identical between syncs, so the stored ETag answers 304 on quiet sources
 *  and the sync cursor is byte-stable when nothing changed. The adapter stops
 *  paging once commit dates fall behind its watermark. */
export async function listRepoCommits(
  fetchImpl: typeof fetch,
  params: ListCommitsParams,
): Promise<GithubConditionalResult<GithubCommitItem[]>> {
  const query = new URLSearchParams({
    author: params.author,
    per_page: String(params.perPage ?? 100),
    page: String(params.page),
  })
  return githubGet<GithubCommitItem[]>(fetchImpl, {
    path: `/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/commits?${query}`,
    accessToken: params.accessToken,
    etag: params.etag,
    apiBase: params.apiBase,
    nowMs: params.nowMs,
  }, `listing commits in ${params.owner}/${params.repo}`)
}

export interface ListIssuesParams {
  owner: string
  repo: string
  accessToken: string
  page: number
  perPage?: number
  etag?: string | null
  apiBase?: string
  nowMs?: number
}

/** Issues newest-updated first, on a stable URL (no `since` — see commits).
 *  The endpoint also returns pull requests (flagged by `pull_request`); the
 *  adapter skips those — pulls have their own richer read below. */
export async function listRepoIssues(
  fetchImpl: typeof fetch,
  params: ListIssuesParams,
): Promise<GithubConditionalResult<GithubIssueOrPull[]>> {
  const query = new URLSearchParams({
    state: 'all',
    sort: 'updated',
    direction: 'desc',
    per_page: String(params.perPage ?? 100),
    page: String(params.page),
  })
  return githubGet<GithubIssueOrPull[]>(fetchImpl, {
    path: `/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/issues?${query}`,
    accessToken: params.accessToken,
    etag: params.etag,
    apiBase: params.apiBase,
    nowMs: params.nowMs,
  }, `listing issues in ${params.owner}/${params.repo}`)
}

export interface ListPullsParams {
  owner: string
  repo: string
  accessToken: string
  page: number
  perPage?: number
  etag?: string | null
  apiBase?: string
  nowMs?: number
}

/** Pull requests newest-updated first. The endpoint has no `since` filter;
 *  the adapter stops paging once updated_at falls behind its watermark. */
export async function listRepoPulls(
  fetchImpl: typeof fetch,
  params: ListPullsParams,
): Promise<GithubConditionalResult<GithubIssueOrPull[]>> {
  const query = new URLSearchParams({
    state: 'all',
    sort: 'updated',
    direction: 'desc',
    per_page: String(params.perPage ?? 50),
    page: String(params.page),
  })
  return githubGet<GithubIssueOrPull[]>(fetchImpl, {
    path: `/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/pulls?${query}`,
    accessToken: params.accessToken,
    etag: params.etag,
    apiBase: params.apiBase,
    nowMs: params.nowMs,
  }, `listing pull requests in ${params.owner}/${params.repo}`)
}

export async function listPullReviews(
  fetchImpl: typeof fetch,
  params: { owner: string; repo: string; pullNumber: number; accessToken: string; apiBase?: string; nowMs?: number },
): Promise<GithubReview[]> {
  return getJson<GithubReview[]>(fetchImpl, {
    path: `/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/pulls/${params.pullNumber}/reviews?per_page=100`,
    accessToken: params.accessToken,
    apiBase: params.apiBase,
    nowMs: params.nowMs,
  }, `listing reviews in ${params.owner}/${params.repo}`)
}
