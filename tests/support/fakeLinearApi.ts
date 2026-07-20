// An in-memory Linear for the DEV-192 adapter tests: one GraphQL endpoint
// that answers the adapter's two queries — viewer identity and the person's
// issues — with real updatedAt filtering, creator/assignee scoping, cursor
// pagination, key checking, and injected failures with rate-limit headers.
// The adapter under test receives this via its injected `fetchImpl` — no
// request ever leaves the process.

import type { LinearIssueNode } from '../../src/main/connectors/linear/api.ts'
export { createFakeSecretStore } from './fakeGithubApi.ts'

export const FAKE_LINEAR_ENDPOINT = 'https://linear-graphql.test/graphql'
export const FAKE_LINEAR_API_KEY = 'lin_api_testkey0123456789abcdefghijklmnop'

export interface FakeLinearViewer {
  id: string
  name: string
  displayName?: string
  email?: string
  organization?: { id: string; name: string; urlKey: string }
}

export interface InjectedLinearFailure {
  status: number
  retryAfterSec?: number
  /** Epoch-ms reset stamp for the X-RateLimit-Requests-Reset variant. */
  rateLimitResetMs?: number
}

export interface FakeLinearApi {
  fetchImpl: typeof fetch
  putIssue(issue: LinearIssueNode): void
  removeIssue(id: string, options?: { mode?: 'trashed' | 'archived'; updatedAt?: string }): void
  failNext(failure: InjectedLinearFailure): void
  revokeKey(): void
  requestCount(): number
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

export function createFakeLinearApi(viewer: FakeLinearViewer): FakeLinearApi {
  const issues = new Map<string, LinearIssueNode>()
  let pendingFailure: InjectedLinearFailure | null = null
  let keyRevoked = false
  let requests = 0

  const fetchImpl: typeof fetch = async (input, init) => {
    requests += 1
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url !== FAKE_LINEAR_ENDPOINT) return json(404, { errors: [{ message: 'not found' }] })
    if (pendingFailure) {
      const failure = pendingFailure
      pendingFailure = null
      const headers: Record<string, string> = {}
      if (failure.retryAfterSec != null) headers['retry-after'] = String(failure.retryAfterSec)
      if (failure.rateLimitResetMs != null) headers['x-ratelimit-requests-reset'] = String(failure.rateLimitResetMs)
      return json(failure.status, { errors: [{ message: 'injected failure' }] }, headers)
    }
    const headers = new Headers(init?.headers)
    const auth = headers.get('authorization') ?? ''
    if (keyRevoked || auth !== FAKE_LINEAR_API_KEY) {
      return json(401, { errors: [{ message: 'authentication failed', extensions: { code: 'AUTHENTICATION_ERROR' } }] })
    }
    let payload: { query?: string; variables?: Record<string, unknown> } = {}
    try {
      payload = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as typeof payload
    } catch { /* empty */ }
    const query = payload.query ?? ''

    if (/mutation/i.test(query)) {
      // The adapter must never send one; refusing loudly proves it.
      return json(400, { errors: [{ message: 'mutations are refused by the fake' }] })
    }

    if (query.includes('viewer')) {
      return json(200, { data: { viewer: viewer } })
    }

    if (query.includes('issues(')) {
      const variables = payload.variables ?? {}
      const filter = (variables.filter ?? {}) as {
        updatedAt?: { gt?: string }
        or?: Array<{ creator?: { id?: { eq?: string } }; assignee?: { id?: { eq?: string } } }>
      }
      const sinceMs = filter.updatedAt?.gt ? Date.parse(filter.updatedAt.gt) : 0
      const allowedIds = new Set<string>()
      for (const clause of filter.or ?? []) {
        const creator = clause.creator?.id?.eq
        const assignee = clause.assignee?.id?.eq
        if (creator) allowedIds.add(`creator:${creator}`)
        if (assignee) allowedIds.add(`assignee:${assignee}`)
      }
      const involves = (issue: LinearIssueNode): boolean => {
        if (allowedIds.size === 0) return true
        return (issue.creator?.id != null && allowedIds.has(`creator:${issue.creator.id}`))
          || (issue.assignee?.id != null && allowedIds.has(`assignee:${issue.assignee.id}`))
      }
      const matching = [...issues.values()]
        .filter((issue) => involves(issue))
        .filter((issue) => {
          const updated = issue.updatedAt ? Date.parse(issue.updatedAt) : 0
          return updated > sinceMs
        })
        .sort((a, b) => Date.parse(b.updatedAt ?? '0') - Date.parse(a.updatedAt ?? '0'))
      const first = typeof variables.first === 'number' ? variables.first : 50
      const after = typeof variables.after === 'string' ? Number(variables.after) : 0
      const page = matching.slice(after, after + first)
      const nextOffset = after + page.length
      return json(200, {
        data: {
          issues: {
            nodes: page,
            pageInfo: {
              hasNextPage: nextOffset < matching.length,
              endCursor: nextOffset < matching.length ? String(nextOffset) : null,
            },
          },
        },
      })
    }

    return json(400, { errors: [{ message: 'unknown query' }] })
  }

  return {
    fetchImpl,
    putIssue(issue) {
      if (!issue.id) throw new Error('fake issues need ids')
      issues.set(issue.id, issue)
    },
    removeIssue(id, options = {}) {
      const existing = issues.get(id)
      if (!existing) return
      const updatedAt = options.updatedAt ?? new Date().toISOString()
      if ((options.mode ?? 'trashed') === 'trashed') {
        issues.set(id, { ...existing, trashed: true, updatedAt })
      } else {
        issues.set(id, { ...existing, archivedAt: updatedAt, updatedAt })
      }
    },
    failNext(failure) { pendingFailure = failure },
    revokeKey() { keyRevoked = true },
    requestCount() { return requests },
  }
}
