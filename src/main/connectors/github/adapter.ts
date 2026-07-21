// The GitHub connector (DEV-191) — the code provider on the connector
// foundation. It implements the same ConnectorAdapter contract the calendar
// adapter and the fake provider prove, and passes the same conformance suite:
//
//   connect     → the OAuth device flow (./auth.ts): a public client id, no
//                 secret, no loopback; the person's chosen repositories are
//                 the ONLY scope of what syncs. Tokens land in the OS secure
//                 store; the persisted connection config is { repositories }
//                 and nothing else
//   sync        → per-repository, per-resource watermarks on the contract's
//                 cursor: a bounded full lookback window first (attested
//                 complete, so stale records tombstone on any later full
//                 window), then incremental reads — commits/issues via their
//                 `since` filters, pull requests newest-updated-first until
//                 the watermark, reviews per changed pull. Watermarks only
//                 advance when data arrived, which keeps list URLs stable
//                 between quiet syncs so stored ETags answer 304 (free, and
//                 counted against no rate limit); a thrown page never
//                 advances the cursor (the ingest transaction owns that)
//   inspect     → credential-free health from the stored-authorization state
//   disconnect  → clears the vault entry; a device-flow grant has no
//                 secret-free provider-side revocation, so the person revokes
//                 at github.com/settings/apps (the Settings card says so)
//
// No secrets in code: the client id comes from the person's connect input or
// DAYLENS_GITHUB_OAUTH_CLIENT_ID. Everything with a network shape is
// injectable, so the entire adapter is provable against an in-memory GitHub.

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
  getAuthenticatedUser,
  getRepoSummary,
  listPullReviews,
  listRepoCommits,
  listRepoIssues,
  listRepoPulls,
  type GithubCommitItem,
  type GithubIssueOrPull,
} from './api'
import {
  refreshGithubAccessToken,
  runDeviceAuthorization,
  type GithubOAuthTokens,
} from './auth'
import {
  GITHUB_CONNECTOR_ID,
  involvesLogin,
  normalizeGithubCommit,
  normalizeGithubIssue,
  normalizeGithubPull,
  normalizeGithubReview,
  type GithubNormalizeContext,
} from './normalize'

const HOUR = 60 * 60 * 1000

// Matches the registry's manifest-only entry word for word — the consistency
// test (tests/githubConnector.test.ts) keeps the two from drifting — with
// `available` flipped: a working adapter ships in this build.
export const GITHUB_MANIFEST: ConnectorManifest = {
  id: GITHUB_CONNECTOR_ID,
  displayName: 'GitHub',
  providerKind: 'code',
  integration: 'direct',
  authKind: 'oauth',
  readOnly: true,
  scopes: [
    { scope: 'metadata:read', grants: 'Reads the names and identity of the repositories you choose. GitHub requires this for any repository access.' },
    { scope: 'contents:read', grants: 'Lists your commits — times and subject lines only. Daylens never ingests file contents, diffs, or bodies, and never pushes.' },
    { scope: 'pull_requests:read', grants: 'Reads pull requests and reviews you are involved in — titles, states, and who was involved. Never writes, comments, or merges.' },
    { scope: 'issues:read', grants: 'Reads issues you created or are assigned — titles and states. Never comments or edits.' },
  ],
  whatItBrings:
    'What you actually shipped — commits, pull requests, and reviews with their real repository identity, so "worked on the billing service" becomes a claim your history can back.',
  sensitivity: 'standard',
  syncCadenceMs: HOUR,
  lookbackDays: 90,
  rateLimit: { maxRequestsPerMinute: 60, backoffBaseMs: 10_000, backoffMaxMs: HOUR },
  available: true,
}

/** Bounds per repository per sync. Hitting one means the window is read
 *  partially SHORT of history, never past it — nothing extra tombstones. */
const MAX_COMMIT_PAGES = 10
const MAX_ISSUE_PAGES = 10
const MAX_PULL_PAGES = 4
const MAX_REVIEW_PULLS = 60
/** Bound on how many repositories one connection may sync. */
const MAX_REPOSITORIES = 25

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

interface ResourceCursor {
  /** RFC3339 lower bound the next read uses. Advances only when data arrived,
   *  so an unchanged source keeps an unchanged URL — and its ETag. */
  since: string
  etag: string | null
}

interface RepoCursor {
  commits?: ResourceCursor
  issues?: ResourceCursor
  pulls?: ResourceCursor
}

interface GithubCursor {
  v: 1
  repos: Record<string, RepoCursor>
}

function parseCursor(cursor: string): GithubCursor | null {
  try {
    const parsed = JSON.parse(cursor) as GithubCursor
    return parsed?.v === 1 && parsed.repos != null ? parsed : null
  } catch {
    return null
  }
}

export function parseRepositoriesInput(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.map((entry) => String(entry))
    : typeof value === 'string' ? value.split(/[\s,]+/) : []
  const seen = new Set<string>()
  const repos: string[] = []
  for (const entry of raw) {
    const trimmed = entry.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '')
    if (!trimmed) continue
    if (!REPO_PATTERN.test(trimmed)) {
      throw new Error(`"${trimmed}" is not an owner/repo repository name (e.g. octo-org/api).`)
    }
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    repos.push(trimmed)
  }
  return repos
}

export interface GithubAdapterDeps {
  /** Network entry point — a test injects an in-memory GitHub here. */
  fetchImpl?: typeof fetch
  /** Opens the system browser at the device-verification page. The default
   *  lazy-loads Electron's shell so this module stays importable without it. */
  openExternal?: (url: string) => Promise<void> | void
  /** Credential vault override for hermetic tests. */
  secretStore?: ConnectorSecretStore | null
  endpoints?: {
    deviceCode?: string
    token?: string
    apiBase?: string
  }
  /** Environment for the DAYLENS_GITHUB_OAUTH_CLIENT_ID fallback. */
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

export function createGithubAdapter(deps: GithubAdapterDeps = {}): ConnectorAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch
  const openExternal = deps.openExternal ?? defaultOpenExternal
  const secretStore = deps.secretStore ?? null
  const env = deps.env ?? process.env
  const apiBase = deps.endpoints?.apiBase

  async function readTokens(): Promise<GithubOAuthTokens | null> {
    const raw = await getConnectorSecret(GITHUB_CONNECTOR_ID, secretStore)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Partial<GithubOAuthTokens>
      if (!parsed.accessToken || !parsed.clientId) return null
      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken ?? null,
        expiresAtMs: parsed.expiresAtMs ?? 0,
        clientId: parsed.clientId,
      }
    } catch {
      return null
    }
  }

  async function writeTokens(tokens: GithubOAuthTokens): Promise<void> {
    await setConnectorSecret(GITHUB_CONNECTOR_ID, JSON.stringify(tokens), secretStore)
  }

  /** Marks an error as reauthorization-shaped: the connection flags
   *  needs_attention on the FIRST failure and Settings offers Reconnect. */
  function asReauthorizationError(error: Error): Error {
    Object.assign(error, { needsAttention: true })
    return error
  }

  /** A working access token, refreshing (and re-persisting) when the stored
   *  one expires. `expiresAtMs: 0` marks a non-expiring device token. */
  async function freshTokens(nowMs: number): Promise<GithubOAuthTokens> {
    const tokens = await readTokens()
    if (!tokens) {
      throw asReauthorizationError(new Error('GitHub authorization is missing. Reconnect to resume syncing.'))
    }
    if (tokens.expiresAtMs === 0 || tokens.expiresAtMs > nowMs) return tokens
    let refreshed: GithubOAuthTokens
    try {
      refreshed = await refreshGithubAccessToken({
        fetchImpl,
        tokenEndpoint: deps.endpoints?.token,
        tokens,
        nowMs,
      })
    } catch (error) {
      // GitHub ANSWERED and refused (revoked/expired grant) → reauthorize.
      // An unreachable token service is transient — plain retryable failure.
      if (error instanceof Error && !/unreachable/.test(error.message)) {
        throw asReauthorizationError(error)
      }
      throw error
    }
    await writeTokens(refreshed)
    return refreshed
  }

  function configuredRepositories(connection: ConnectorConnection): Array<{ owner: string; repo: string; key: string }> {
    const repos = parseRepositoriesInput(connection.config.repositories)
    return repos.map((fullName) => {
      const [owner, repo] = fullName.split('/')
      return { owner, repo, key: fullName.toLowerCase() }
    })
  }

  function normalizeContext(
    owner: string,
    repo: string,
    login: string,
    nowMs: number,
  ): GithubNormalizeContext {
    return {
      retrievedAtMs: nowMs,
      accountLogin: login,
      owner,
      repo,
      permissionScope: GITHUB_MANIFEST.scopes.map((scope) => scope.scope).join(' '),
    }
  }

  async function accountLogin(connection: ConnectorConnection, accessToken: string): Promise<string> {
    const stored = trimmed(connection.accountLabel)
    if (stored) return stored
    const user = await getAuthenticatedUser(fetchImpl, { accessToken, apiBase })
    const login = trimmed(user.login)
    if (!login) throw new Error('GitHub did not identify the connected account.')
    return login
  }

  async function collectCommits(
    owner: string,
    repo: string,
    login: string,
    accessToken: string,
    dateFloorMs: number,
    etag: string | null,
    nowMs: number,
  ): Promise<{ status: 'ok'; items: GithubCommitItem[]; etag: string | null } | { status: 'not_modified' }> {
    const items: GithubCommitItem[] = []
    let pageEtag: string | null = null
    for (let page = 1; page <= MAX_COMMIT_PAGES; page += 1) {
      const result = await listRepoCommits(fetchImpl, {
        owner, repo, accessToken, author: login, page,
        etag: page === 1 ? etag : null,
        apiBase, nowMs,
      })
      if (result.status === 'not_modified') return { status: 'not_modified' }
      if (page === 1) pageEtag = result.etag
      let pastFloor = false
      for (const item of result.body) {
        const dateMs = item.commit?.author?.date ? Date.parse(item.commit.author.date) : NaN
        if (Number.isFinite(dateMs) && dateMs < dateFloorMs) {
          pastFloor = true
          break
        }
        items.push(item)
      }
      if (pastFloor || result.body.length < 100) break
    }
    return { status: 'ok', items, etag: pageEtag }
  }

  async function collectIssues(
    owner: string,
    repo: string,
    accessToken: string,
    updatedFloorMs: number,
    etag: string | null,
    nowMs: number,
  ): Promise<{ status: 'ok'; items: GithubIssueOrPull[]; etag: string | null } | { status: 'not_modified' }> {
    const items: GithubIssueOrPull[] = []
    let pageEtag: string | null = null
    for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
      const result = await listRepoIssues(fetchImpl, {
        owner, repo, accessToken, page,
        etag: page === 1 ? etag : null,
        apiBase, nowMs,
      })
      if (result.status === 'not_modified') return { status: 'not_modified' }
      if (page === 1) pageEtag = result.etag
      let pastFloor = false
      for (const issue of result.body) {
        const updatedMs = issue.updated_at ? Date.parse(issue.updated_at) : NaN
        if (Number.isFinite(updatedMs) && updatedMs < updatedFloorMs) {
          pastFloor = true
          break
        }
        items.push(issue)
      }
      if (pastFloor || result.body.length < 100) break
    }
    return { status: 'ok', items, etag: pageEtag }
  }

  async function collectPulls(
    owner: string,
    repo: string,
    accessToken: string,
    updatedFloorMs: number,
    etag: string | null,
    nowMs: number,
  ): Promise<{ status: 'ok'; items: GithubIssueOrPull[]; etag: string | null } | { status: 'not_modified' }> {
    const items: GithubIssueOrPull[] = []
    let pageEtag: string | null = null
    for (let page = 1; page <= MAX_PULL_PAGES; page += 1) {
      const result = await listRepoPulls(fetchImpl, {
        owner, repo, accessToken, page,
        etag: page === 1 ? etag : null,
        apiBase, nowMs,
      })
      if (result.status === 'not_modified') return { status: 'not_modified' }
      if (page === 1) pageEtag = result.etag
      let pastFloor = false
      for (const pull of result.body) {
        const updatedMs = pull.updated_at ? Date.parse(pull.updated_at) : NaN
        if (Number.isFinite(updatedMs) && updatedMs < updatedFloorMs) {
          pastFloor = true
          break
        }
        items.push(pull)
      }
      if (pastFloor || result.body.length < 50) break
    }
    return { status: 'ok', items, etag: pageEtag }
  }

  async function pullAndReviewRecords(
    owner: string,
    repo: string,
    login: string,
    accessToken: string,
    pulls: GithubIssueOrPull[],
    nowMs: number,
  ): Promise<ConnectorRecordEnvelope[]> {
    const context = normalizeContext(owner, repo, login, nowMs)
    const records: ConnectorRecordEnvelope[] = []
    let reviewFetches = 0
    for (const pull of pulls) {
      if (!involvesLogin(pull, login)) continue
      const record = normalizeGithubPull(pull, context)
      if (record) records.push(record)
      if (pull.number == null || reviewFetches >= MAX_REVIEW_PULLS) continue
      reviewFetches += 1
      const reviews = await listPullReviews(fetchImpl, {
        owner, repo, pullNumber: pull.number, accessToken, apiBase, nowMs,
      })
      for (const review of reviews) {
        const reviewRecord = normalizeGithubReview(review, pull, context)
        if (reviewRecord) records.push(reviewRecord)
      }
    }
    return records
  }

  /** Advance a resource watermark past the newest item seen, or keep it. */
  function advancedSince(previous: string, maxSeenMs: number | null): string {
    if (maxSeenMs == null) return previous
    const next = new Date(maxSeenMs + 1000)
    return Date.parse(previous) >= next.getTime() ? previous : next.toISOString()
  }

  function maxTimeOf(values: Array<string | undefined | null>): number | null {
    let max: number | null = null
    for (const value of values) {
      if (!value) continue
      const ms = Date.parse(value)
      if (Number.isFinite(ms) && (max == null || ms > max)) max = ms
    }
    return max
  }

  async function fullWindowSync(
    connection: ConnectorConnection,
    accessToken: string,
    nowMs: number,
  ): Promise<ConnectorSyncPage> {
    const login = await accountLogin(connection, accessToken)
    const sinceIso = new Date(nowMs - GITHUB_MANIFEST.lookbackDays * 24 * HOUR).toISOString()
    const records: ConnectorRecordEnvelope[] = []
    const cursor: GithubCursor = { v: 1, repos: {} }

    for (const { owner, repo, key } of configuredRepositories(connection)) {
      const context = normalizeContext(owner, repo, login, nowMs)

      const commits = await collectCommits(owner, repo, login, accessToken, Date.parse(sinceIso), null, nowMs)
      const commitItems = commits.status === 'ok' ? commits.items : []
      for (const item of commitItems) {
        const record = normalizeGithubCommit(item, context)
        if (record) records.push(record)
      }

      const pulls = await collectPulls(owner, repo, accessToken, Date.parse(sinceIso), null, nowMs)
      const pullItems = pulls.status === 'ok' ? pulls.items : []
      records.push(...await pullAndReviewRecords(owner, repo, login, accessToken, pullItems, nowMs))

      const issues = await collectIssues(owner, repo, accessToken, Date.parse(sinceIso), null, nowMs)
      const issueItems = issues.status === 'ok' ? issues.items : []
      for (const issue of issueItems) {
        if (issue.pull_request != null || !involvesLogin(issue, login)) continue
        const record = normalizeGithubIssue(issue, context)
        if (record) records.push(record)
      }

      // Watermarks start just past the newest item seen. The list URLs carry
      // no time parameter, so every first-page ETag stays valid until the
      // resource actually changes — a quiet source syncs as three 304s.
      cursor.repos[key] = {
        commits: {
          since: advancedSince(sinceIso, maxTimeOf(commitItems.map((item) => item.commit?.author?.date))),
          etag: commits.status === 'ok' ? commits.etag : null,
        },
        pulls: {
          since: advancedSince(sinceIso, maxTimeOf(pullItems.map((pull) => pull.updated_at))),
          etag: pulls.status === 'ok' ? pulls.etag : null,
        },
        issues: {
          since: advancedSince(sinceIso, maxTimeOf(issueItems.map((issue) => issue.updated_at))),
          etag: issues.status === 'ok' ? issues.etag : null,
        },
      }
    }

    return {
      records,
      nextCursor: JSON.stringify(cursor),
      // The window is a complete view of what this connection scopes to (the
      // chosen repositories over the bounded lookback): every kept record id
      // is attested, so a known record missing from it — deleted upstream, or
      // from a repository no longer chosen — tombstones.
      presentSourceRecordIds: records.map((record) => record.provenance.sourceRecordId),
    }
  }

  async function incrementalSync(
    connection: ConnectorConnection,
    accessToken: string,
    cursor: GithubCursor,
    nowMs: number,
  ): Promise<ConnectorSyncPage> {
    const login = await accountLogin(connection, accessToken)
    const fallbackSince = new Date(nowMs - GITHUB_MANIFEST.lookbackDays * 24 * HOUR).toISOString()
    const records: ConnectorRecordEnvelope[] = []
    const nextCursor: GithubCursor = { v: 1, repos: {} }

    for (const { owner, repo, key } of configuredRepositories(connection)) {
      const context = normalizeContext(owner, repo, login, nowMs)
      const previous = cursor.repos[key] ?? {}
      const next: RepoCursor = {}

      const commitState = previous.commits ?? { since: fallbackSince, etag: null }
      const commits = await collectCommits(
        owner, repo, login, accessToken, Date.parse(commitState.since), commitState.etag, nowMs,
      )
      if (commits.status === 'not_modified') {
        next.commits = commitState
      } else {
        for (const item of commits.items) {
          const record = normalizeGithubCommit(item, context)
          if (record) records.push(record)
        }
        next.commits = {
          since: advancedSince(commitState.since, maxTimeOf(commits.items.map((item) => item.commit?.author?.date))),
          etag: commits.etag,
        }
      }

      const pullState = previous.pulls ?? { since: fallbackSince, etag: null }
      const pulls = await collectPulls(owner, repo, accessToken, Date.parse(pullState.since), pullState.etag, nowMs)
      if (pulls.status === 'not_modified') {
        next.pulls = pullState
      } else {
        records.push(...await pullAndReviewRecords(owner, repo, login, accessToken, pulls.items, nowMs))
        next.pulls = {
          since: advancedSince(pullState.since, maxTimeOf(pulls.items.map((pull) => pull.updated_at))),
          etag: pulls.etag,
        }
      }

      const issueState = previous.issues ?? { since: fallbackSince, etag: null }
      const issues = await collectIssues(owner, repo, accessToken, Date.parse(issueState.since), issueState.etag, nowMs)
      if (issues.status === 'not_modified') {
        next.issues = issueState
      } else {
        for (const issue of issues.items) {
          if (issue.pull_request != null || !involvesLogin(issue, login)) continue
          const record = normalizeGithubIssue(issue, context)
          if (record) records.push(record)
        }
        next.issues = {
          since: advancedSince(issueState.since, maxTimeOf(issues.items.map((issue) => issue.updated_at))),
          etag: issues.etag,
        }
      }

      nextCursor.repos[key] = next
    }

    return {
      records,
      nextCursor: JSON.stringify(nextCursor),
      unchanged: records.length === 0 ? true : undefined,
    }
  }

  return {
    manifest: GITHUB_MANIFEST,

    async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
      const clientId = trimmed(input.config.clientId) ?? trimmed(env.DAYLENS_GITHUB_OAUTH_CLIENT_ID)
      if (!clientId) {
        throw new Error(
          'GitHub needs an OAuth client ID. Create a GitHub App with device flow enabled and read-only permissions, then paste its client ID here.',
        )
      }
      const repositories = parseRepositoriesInput(input.config.repositories)
      if (repositories.length === 0) {
        throw new Error('Choose at least one repository to sync, as owner/repo (e.g. octo-org/api). Only the repositories you list here are read.')
      }
      if (repositories.length > MAX_REPOSITORIES) {
        throw new Error(`Choose up to ${MAX_REPOSITORIES} repositories per connection.`)
      }

      const tokens = await runDeviceAuthorization({
        clientId,
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

      const user = await getAuthenticatedUser(fetchImpl, { accessToken: tokens.accessToken, apiBase })
      const login = trimmed(user.login)
      if (!login) throw new Error('GitHub did not identify the connected account.')

      // Every chosen repository must be readable NOW — a typo or a private
      // repository the grant cannot see fails the connect with its name,
      // instead of silently syncing nothing.
      for (const fullName of repositories) {
        const [owner, repo] = fullName.split('/')
        await getRepoSummary(fetchImpl, { owner, repo, accessToken: tokens.accessToken, apiBase })
      }

      // The persisted config is credential-free BY CONSTRUCTION: the client
      // id lives only in the vault JSON next to the tokens.
      return { accountLabel: login, config: { repositories } }
    },

    async sync(request: ConnectorSyncRequest): Promise<ConnectorSyncPage> {
      const tokens = await freshTokens(request.nowMs)
      const cursor = request.cursor ? parseCursor(request.cursor) : null
      if (!cursor) {
        return fullWindowSync(request.connection, tokens.accessToken, request.nowMs)
      }
      return incrementalSync(request.connection, tokens.accessToken, cursor, request.nowMs)
    },

    async inspect(_connection: ConnectorConnection): Promise<ConnectorHealth> {
      const tokens = await readTokens()
      if (!tokens) {
        return {
          state: 'needs_attention',
          summary: 'No GitHub authorization is stored on this machine. Reconnect to resume syncing.',
        }
      }
      if (tokens.expiresAtMs > 0 && tokens.expiresAtMs <= Date.now() && !tokens.refreshToken) {
        return {
          state: 'needs_attention',
          summary: 'The GitHub authorization expired and cannot refresh itself. Reconnect to resume syncing.',
        }
      }
      return { state: 'ok', summary: 'Authorized. Repository activity syncs on the hourly schedule.' }
    },

    async disconnect(_connection: ConnectorConnection): Promise<void> {
      // A device-flow grant has no provider-side revocation without the app's
      // client secret; the person revokes at github.com/settings/applications.
      // Locally the credential is deleted — no further sync can ever run.
      await clearConnectorSecret(GITHUB_CONNECTOR_ID, secretStore)
    },
  }
}

/** Startup wiring: register the working adapter so Settings → Connections
 *  gains the connect/sync/disconnect lifecycle for GitHub. */
export function registerGithubConnector(): void {
  registerConnectorAdapter(createGithubAdapter())
}
