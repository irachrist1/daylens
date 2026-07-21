// The thin Linear GraphQL read layer (DEV-192). One job: POST read-only
// queries with the personal API key and turn provider failures into TYPED,
// SANITIZED errors the adapter can act on — never an error that echoes the
// key or a response body (it could quote anything). `fetchImpl` is injected,
// so tests drive this against an in-memory Linear and the suite never touches
// the network.

const LINEAR_GRAPHQL_ENDPOINT = 'https://api.linear.app/graphql'

/** The stored API key no longer works (HTTP 401/403 or an AUTHENTICATION
 *  GraphQL error). `needsAttention` makes the connection flag needs_attention
 *  immediately — Settings shows the reconnect affordance instead of a silent
 *  retry loop. */
class LinearAuthorizationError extends Error {
  readonly needsAttention = true
  constructor() {
    super('Linear rejected the stored API key. Reconnect with a valid personal API key to resume syncing.')
  }
}

/** Rate limited (HTTP 429). `retryAfterMs` carries the provider's reset hint
 *  so the bounded backoff can respect it. */
class LinearRateLimitError extends Error {
  readonly retryAfterMs: number | null
  constructor(retryAfterMs: number | null) {
    super('Linear rate-limited the sync; it will retry on a bounded backoff.')
    this.retryAfterMs = retryAfterMs
  }
}

export interface LinearViewer {
  id?: string
  name?: string
  displayName?: string
  email?: string
  organization?: { id?: string; name?: string; urlKey?: string }
}

export interface LinearIssueNode {
  id?: string
  identifier?: string
  title?: string
  createdAt?: string
  updatedAt?: string
  completedAt?: string | null
  canceledAt?: string | null
  archivedAt?: string | null
  trashed?: boolean | null
  state?: { name?: string; type?: string } | null
  team?: { id?: string; key?: string; name?: string } | null
  project?: { id?: string; name?: string } | null
  cycle?: { id?: string; number?: number; name?: string | null } | null
  assignee?: { id?: string; name?: string; displayName?: string } | null
  creator?: { id?: string; name?: string; displayName?: string } | null
}

export interface LinearIssuePage {
  nodes: LinearIssueNode[]
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
}

function retryAfterMsOf(response: Response): number | null {
  const header = response.headers.get('retry-after')
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000)
  }
  // Linear also exposes the reset instant of the requests budget.
  const reset = response.headers.get('x-ratelimit-requests-reset')
  if (reset) {
    const atMs = Number(reset)
    if (Number.isFinite(atMs) && atMs > Date.now()) return Math.round(atMs - Date.now())
  }
  return null
}

interface GraphqlEnvelope<T> {
  data?: T
  errors?: Array<{ message?: string; extensions?: { code?: string } }>
}

/** One GraphQL POST. The API key rides only the Authorization header; thrown
 *  errors are fixed plain-language strings, never provider bodies. */
async function linearGraphql<T>(
  fetchImpl: typeof fetch,
  options: {
    apiKey: string
    query: string
    variables?: Record<string, unknown>
    endpoint?: string
    what: string
  },
): Promise<T> {
  let response: Response
  try {
    response = await fetchImpl(options.endpoint ?? LINEAR_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: options.apiKey,
      },
      body: JSON.stringify({ query: options.query, variables: options.variables ?? {} }),
    })
  } catch {
    throw new Error(`Linear was unreachable while reading ${options.what}; sync will retry.`)
  }
  if (response.status === 401 || response.status === 403) {
    throw new LinearAuthorizationError()
  }
  if (response.status === 429) {
    throw new LinearRateLimitError(retryAfterMsOf(response))
  }
  if (!response.ok) {
    throw new Error(`Linear answered ${response.status} while reading ${options.what}; sync will retry.`)
  }
  let envelope: GraphqlEnvelope<T>
  try {
    envelope = await response.json() as GraphqlEnvelope<T>
  } catch {
    throw new Error(`Linear returned an unreadable response while reading ${options.what}; sync will retry.`)
  }
  if (envelope.errors && envelope.errors.length > 0) {
    const authShaped = envelope.errors.some((error) =>
      error.extensions?.code === 'AUTHENTICATION_ERROR' || /authentication/i.test(error.message ?? ''))
    if (authShaped) throw new LinearAuthorizationError()
    throw new Error(`Linear rejected the ${options.what} query; sync will retry.`)
  }
  if (envelope.data == null) {
    throw new Error(`Linear returned no data while reading ${options.what}; sync will retry.`)
  }
  return envelope.data
}

const VIEWER_QUERY = `
  query DaylensViewer {
    viewer {
      id
      name
      displayName
      email
      organization { id name urlKey }
    }
  }
`

export async function getViewer(
  fetchImpl: typeof fetch,
  options: { apiKey: string; endpoint?: string },
): Promise<LinearViewer> {
  const data = await linearGraphql<{ viewer?: LinearViewer }>(fetchImpl, {
    apiKey: options.apiKey,
    query: VIEWER_QUERY,
    endpoint: options.endpoint,
    what: 'the connected account',
  })
  if (!data.viewer) throw new Error('Linear did not identify the connected account.')
  return data.viewer
}

const MY_ISSUES_QUERY = `
  query DaylensMyIssues($filter: IssueFilter, $first: Int!, $after: String) {
    issues(filter: $filter, first: $first, after: $after, orderBy: updatedAt, includeArchived: true) {
      nodes {
        id
        identifier
        title
        createdAt
        updatedAt
        completedAt
        canceledAt
        archivedAt
        trashed
        state { name type }
        team { id key name }
        project { id name }
        cycle { id number name }
        assignee { id name displayName }
        creator { id name displayName }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

/** One page of the connected person's issues — created by or assigned to them
 *  — updated after the watermark. Read-only by construction: this module has
 *  no mutation string anywhere. */
export async function listMyIssues(
  fetchImpl: typeof fetch,
  options: {
    apiKey: string
    viewerId: string
    updatedAfterIso: string
    first: number
    after: string | null
    endpoint?: string
  },
): Promise<LinearIssuePage> {
  const data = await linearGraphql<{ issues?: Partial<LinearIssuePage> }>(fetchImpl, {
    apiKey: options.apiKey,
    query: MY_ISSUES_QUERY,
    variables: {
      filter: {
        updatedAt: { gt: options.updatedAfterIso },
        or: [
          { creator: { id: { eq: options.viewerId } } },
          { assignee: { id: { eq: options.viewerId } } },
        ],
      },
      first: options.first,
      after: options.after,
    },
    endpoint: options.endpoint,
    what: 'your issues',
  })
  return {
    nodes: data.issues?.nodes ?? [],
    pageInfo: {
      hasNextPage: data.issues?.pageInfo?.hasNextPage === true,
      endCursor: data.issues?.pageInfo?.endCursor ?? null,
    },
  }
}
