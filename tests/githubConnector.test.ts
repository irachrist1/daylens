// GitHub connector (DEV-191): the code provider runs the SAME contract
// conformance suite the fake provider and Google Calendar proved
// (connectors.md acceptance: "Direct and brokered adapters pass the same
// contract suite"), against an in-memory GitHub — plus the provider-specific
// legs the suite cannot know about: per-resource watermark incrementality,
// 304-answered quiet syncs, chosen-repositories scoping, mid-sync failure
// atomicity, Retry-After and X-RateLimit-Reset respect, revocation flagging,
// reconnect-window tombstones, coding context in memory/search/day signals,
// credential hygiene across every persisted surface, and registry
// registration.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { assertConnectorContract, OPEN_GATE } from './support/connectorContractSuite.ts'
import {
  createFakeGithubApi,
  createFakeSecretStore,
  FAKE_GITHUB_ENDPOINTS,
  FAKE_GITHUB_USER_CODE,
  type FakeGithubApi,
} from './support/fakeGithubApi.ts'
import {
  createGithubAdapter,
  registerGithubConnector,
  GITHUB_MANIFEST,
} from '../src/main/connectors/github/adapter.ts'
import { connectConnector, disconnectConnector, listConnectorListings, syncConnector } from '../src/main/connectors/service.ts'
import { getConnectorConnection, listConnectorRecords } from '../src/main/connectors/store.ts'
import {
  getConnectorAdapter,
  getConnectorManifest,
  listConnectorManifests,
} from '../src/main/connectors/registry.ts'
import { listEntities, listSuggestedEntityMerges } from '../src/main/services/entities/entityRepository.ts'
import { getExternalSignal, putExternalSignal } from '../src/main/services/externalSignals.ts'
import { indexMemoryForDay } from '../src/main/services/memoryIndex.ts'
import { searchExact } from '../src/main/services/exactSearch.ts'
import type { ConnectorId, GitActivitySignal } from '../src/shared/types.ts'

const GITHUB: ConnectorId = 'github'
const CLIENT_ID = 'Iv1.testdeviceclient01'
const REPO = 'octo-lab/api'
const CONNECT_CONFIG = { clientId: CLIENT_ID, repositories: REPO }

function isoDaysAgo(days: number, hour: number, minute = 0): string {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  at.setHours(hour, minute, 0, 0)
  return at.toISOString()
}

function localDateDaysAgo(days: number): string {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

function seedSource(fake: FakeGithubApi): void {
  fake.addRepo(REPO)
  fake.addCommit(REPO, {
    sha: 'c0ffee01',
    message: 'Fix retry backoff in the sync loop',
    date: isoDaysAgo(2, 10, 15),
  })
  fake.putPull(REPO, {
    number: 7,
    title: 'Connector foundation extensions',
    state: 'closed',
    merged_at: isoDaysAgo(1, 15, 0),
    created_at: isoDaysAgo(3, 9, 0),
    updated_at: isoDaysAgo(1, 15, 0),
    user: { login: 'ada-dev' },
  })
  fake.addReview(REPO, 7, {
    id: 501,
    state: 'APPROVED',
    submitted_at: isoDaysAgo(1, 14, 30),
    user: { login: 'ana-collab' },
  })
  fake.putIssue(REPO, {
    number: 12,
    title: 'Sync loses its watermark on restart',
    state: 'open',
    created_at: isoDaysAgo(4, 9, 0),
    updated_at: isoDaysAgo(2, 9, 0),
    user: { login: 'ada-dev' },
  })
}

interface Harness {
  fake: FakeGithubApi
  store: ReturnType<typeof createFakeSecretStore>
  adapter: ReturnType<typeof createGithubAdapter>
}

function createHarness(): Harness {
  const fake = createFakeGithubApi({ login: 'ada-dev' })
  seedSource(fake)
  const store = createFakeSecretStore()
  const adapter = createGithubAdapter({
    fetchImpl: fake.fetchImpl,
    openExternal: () => fake.approveDevice(),
    secretStore: store,
    endpoints: FAKE_GITHUB_ENDPOINTS,
    env: {},
    authTimeoutMs: 10_000,
  })
  return { fake, store, adapter }
}

test('the GitHub adapter passes the full shared contract suite', async () => {
  const { adapter } = createHarness()
  await assertConnectorContract({
    adapter,
    connectInput: { config: CONNECT_CONFIG },
    minRecords: 4,
  })
})

test('the adapter manifest matches the registry entry word for word, with available flipped', () => {
  const upcoming = getConnectorManifest(GITHUB)!
  assert.equal(upcoming.available, false, 'the registry entry stays manifest-only until registration')
  assert.deepEqual(GITHUB_MANIFEST, { ...upcoming, available: true })
})

test('registering the adapter flips github to connectable without hiding the other manifests', () => {
  registerGithubConnector()
  assert.ok(getConnectorAdapter(GITHUB), 'the adapter is registered')
  const manifests = listConnectorManifests()
  assert.equal(manifests.length, 5, 'registration never hides the manifest-only wave')
  assert.equal(manifests.find((manifest) => manifest.id === GITHUB)?.available, true)
  for (const other of ['google_calendar', 'outlook_calendar', 'linear', 'granola'] as const) {
    assert.equal(manifests.find((manifest) => manifest.id === other)?.available, false, `${other} stays manifest-only`)
  }
})

test('watermark incrementality: a quiet source answers 304s, a new commit syncs alone', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    const connected = await connectConnector(db, GITHUB, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    assert.equal(connected.status, 'ok')
    assert.equal(connected.ingested, 4, 'commit + pull + review + issue')
    const cursorAfterFirst = getConnectorConnection(db, GITHUB)!.sync_cursor
    assert.ok(cursorAfterFirst, 'the full window commits a watermark cursor')

    // Nothing changed: every list URL is stable, so the full window's ETags
    // answer the whole quiet sync as 304s — and the cursor stays byte-stable.
    const quiet = await syncConnector(db, GITHUB, { adapter, gate: OPEN_GATE })
    assert.equal(quiet.status, 'ok')
    assert.equal(quiet.ingested, 0)
    assert.equal(fake.etagHits, 3, 'commits, pulls, and issues all answered 304')
    assert.equal(getConnectorConnection(db, GITHUB)!.sync_cursor, cursorAfterFirst)

    // A new commit arrives: the incremental page carries ONLY the delta.
    fake.addCommit(REPO, {
      sha: 'c0ffee02',
      message: 'Quarantine malformed source records whole',
      date: new Date().toISOString(),
    })
    const delta = await syncConnector(db, GITHUB, { adapter, gate: OPEN_GATE })
    assert.equal(delta.status, 'ok')
    assert.equal(delta.ingested, 1, 'only the changed record syncs')
    assert.notEqual(getConnectorConnection(db, GITHUB)!.sync_cursor, cursorAfterFirst)
  } finally {
    db.close()
  }
})

test('only the repositories you choose are read — nothing else is even requested', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  fake.addRepo('octo-lab/secret-payroll')
  fake.addCommit('octo-lab/secret-payroll', {
    sha: 'facade99',
    message: 'Do not ingest me',
    date: isoDaysAgo(1, 9, 0),
  })
  try {
    const connected = await connectConnector(db, GITHUB, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    assert.equal(connected.status, 'ok')
    await syncConnector(db, GITHUB, { adapter, gate: OPEN_GATE })
    assert.equal(fake.requestsFor('octo-lab/secret-payroll'), 0, 'the unchosen repository is never requested')
    const records = listConnectorRecords(db, GITHUB)
    assert.ok(records.every((row) => row.source_record_id.includes('octo-lab/api')))
  } finally {
    db.close()
  }
})

test('a failed read mid-sync advances nothing; the retry ingests the whole window', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    // /user + repo validation succeed, then the sync's THIRD API read fails.
    fake.failNextApiRequest({ status: 500 }, 4)
    const failed = await connectConnector(db, GITHUB, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    assert.equal(failed.status, 'failed')
    const row = getConnectorConnection(db, GITHUB)!
    assert.equal(row.sync_cursor, null, 'a failed page never advances the cursor')
    assert.equal(listConnectorRecords(db, GITHUB).length, 0, 'no partial evidence was stored')
    assert.ok(row.next_retry_at != null, 'the failure schedules a bounded retry')

    const recovered = await syncConnector(db, GITHUB, { adapter, gate: OPEN_GATE })
    assert.equal(recovered.status, 'ok')
    assert.equal(recovered.ingested, 4, 'the retry reads the complete window')
    assert.ok(getConnectorConnection(db, GITHUB)!.sync_cursor)
  } finally {
    db.close()
  }
})

test('a rate-limited sync schedules its retry from Retry-After, and from X-RateLimit-Reset', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    await connectConnector(db, GITHUB, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })

    fake.failNextApiRequest({ status: 403, retryAfterSec: 120 })
    const nowMs = Date.now()
    const limited = await syncConnector(db, GITHUB, { adapter, gate: OPEN_GATE, nowMs })
    assert.equal(limited.status, 'failed')
    let row = getConnectorConnection(db, GITHUB)!
    assert.equal(row.next_retry_at, nowMs + 120_000, 'the retry respects Retry-After over the computed backoff')
    assert.equal(row.status, 'connected', 'rate limiting is not an authorization problem')

    // The primary-limit variant: 403 with X-RateLimit-Remaining: 0 + Reset.
    const resetSec = Math.floor((Date.now() + 300_000) / 1000)
    fake.failNextApiRequest({ status: 403, rateLimitResetSec: resetSec })
    const nowMs2 = Date.now()
    const limitedAgain = await syncConnector(db, GITHUB, { adapter, gate: OPEN_GATE, nowMs: nowMs2 })
    assert.equal(limitedAgain.status, 'failed')
    row = getConnectorConnection(db, GITHUB)!
    assert.ok(row.next_retry_at! > nowMs2 + 200_000, 'the reset stamp drives the retry time')
    assert.ok(!row.last_sync_error?.includes('ghu_'), 'the stored error is sanitized')
  } finally {
    db.close()
  }
})

test('a revoked authorization flags needs_attention on the FIRST failure; reconnecting recovers', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    await connectConnector(db, GITHUB, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })

    fake.revokeAccessTokens()
    const failed = await syncConnector(db, GITHUB, { adapter, gate: OPEN_GATE })
    assert.equal(failed.status, 'failed')
    const row = getConnectorConnection(db, GITHUB)!
    assert.equal(row.consecutive_failures, 1)
    assert.equal(row.status, 'needs_attention', 'auth trouble is flagged immediately, not after a retry loop')
    assert.match(row.last_sync_error ?? '', /Reconnect/)

    const reconnected = await connectConnector(db, GITHUB, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    assert.equal(reconnected.status, 'ok')
    assert.equal(getConnectorConnection(db, GITHUB)!.status, 'connected')
  } finally {
    db.close()
  }
})

test('an expiring GitHub App token refreshes transparently and re-vaults', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter, store } = createHarness()
  fake.issueExpiringTokens(3600)
  try {
    await connectConnector(db, GITHUB, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    assert.equal(fake.refreshRequests, 0)

    // Two hours pass: the stored token is past its expiry.
    const synced = await syncConnector(db, GITHUB, { adapter, gate: OPEN_GATE, nowMs: Date.now() + 2 * 3600_000 })
    assert.equal(synced.status, 'ok')
    assert.equal(fake.refreshRequests, 1, 'the sync refreshed instead of failing')
    const vaulted = [...store.dump().values()].join(' ')
    assert.ok(vaulted.includes(fake.issuedAccessTokens.at(-1)!), 'the refreshed token was re-vaulted')
  } finally {
    db.close()
  }
})

test('a reconnect reads a fresh attested window: records deleted at the source tombstone', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  try {
    await connectConnector(db, GITHUB, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    assert.equal(listConnectorRecords(db, GITHUB).length, 4)

    fake.removeCommit(REPO, 'c0ffee01')
    const reconnected = await connectConnector(db, GITHUB, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    assert.equal(reconnected.status, 'ok')
    assert.ok(reconnected.tombstoned >= 1, 'the attested window tombstones the vanished commit')
    const tombstone = listConnectorRecords(db, GITHUB, { includeTombstoned: true })
      .find((row) => row.source_record_id === `commit:${REPO}:c0ffee01`)
    assert.ok(tombstone?.tombstoned_at != null, 'the deletion is an explicit tombstone, not silence')
  } finally {
    db.close()
  }
})

test('synced coding work becomes connected memory: searchable, honestly labeled, with people by login', async () => {
  const db = createProductionTestDatabase()
  const { adapter } = createHarness()
  const mergeDate = localDateDaysAgo(1)
  const commitDate = localDateDaysAgo(2)
  try {
    await connectConnector(db, GITHUB, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    indexMemoryForDay(db, mergeDate)
    indexMemoryForDay(db, commitDate)

    const statements = (db.prepare(
      `SELECT statement, memory_type FROM memory_records WHERE record_kind = 'connected_activity'`,
    ).all() as Array<{ statement: string; memory_type: string }>)
    assert.ok(statements.length >= 3, 'commit, pull request, and review are memory')
    for (const record of statements) {
      assert.match(record.statement, /^GitHub: /, 'every statement names its provider')
      assert.equal(record.memory_type, 'connected', 'connected origin — distinct from captured activity')
    }
    assert.ok(statements.some((record) => record.statement.includes('merged pull request "Connector foundation extensions"')))
    assert.ok(statements.some((record) => record.statement.includes('review by ana-collab')))

    // Exact search: the repository entity resolves, and the moments carry the
    // honest provider label + connected sourceType.
    const results = searchExact(db, 'Connector foundation extensions')
    const momentHit = results.find((result) => result.type === 'session' && 'appName' in result && result.appName === 'GitHub')
    assert.ok(momentHit, 'the pull request surfaces in exact search, labeled GitHub')
    assert.equal((momentHit as { sourceType?: string }).sourceType, 'connected')

    const repoResults = searchExact(db, 'api')
    const repoEntity = repoResults.find((result) => result.type === 'entity' && result.entityType === 'repository')
    assert.ok(repoEntity, 'the repository entity is searchable by name')
    assert.equal((repoEntity as { sourceType: string }).sourceType, 'connected')

    // The reviewer exists as a person by GitHub login — searching them finds
    // the review they were part of.
    const people = listEntities(db, { type: 'person' })
    assert.deepEqual(people.map((person) => person.name), ['ana-collab'])
    const personMoments = searchExact(db, 'ana-collab')
    assert.ok(
      personMoments.some((result) => result.type === 'session' && 'appName' in result && result.appName === 'GitHub'),
      'a person search reaches the review moment',
    )

    // The day layer shows coding context: the commit and the merged PR.
    const commitSignal = getExternalSignal<GitActivitySignal>(db, commitDate, 'git')
    assert.ok(commitSignal, 'the commit day has a git signal')
    const repoEntry = commitSignal!.payload.repos.find((repo) => repo.repo === 'api')
    assert.equal(repoEntry?.commitCount, 1)
    assert.ok(repoEntry?.messages.includes('Fix retry backoff in the sync loop'))
    const mergeSignal = getExternalSignal<GitActivitySignal>(db, mergeDate, 'git')
    assert.ok(mergeSignal?.payload.prs.some((pr) => pr.title === 'Connector foundation extensions' && pr.state === 'merged'))
  } finally {
    db.close()
  }
})

test('a locally observed repository and its GitHub identity become ONE entity — corroborated, never by name alone', async () => {
  const db = createProductionTestDatabase()
  const { adapter } = createHarness()
  const commitDate = localDateDaysAgo(2)
  try {
    // The local git probe saw the same repo folder with the same commit that
    // day; its adoption mints the provisional local-identity entity.
    putExternalSignal(db, commitDate, 'git', {
      repos: [{
        repo: 'api',
        commitCount: 1,
        messages: ['Fix retry backoff in the sync loop'],
        firstCommitClock: '10:15',
        lastCommitClock: '10:15',
      }],
      totalCommits: 1,
      prs: [],
    })
    const before = db.prepare(
      `SELECT identity_key FROM entities WHERE entity_type = 'repository' AND status = 'active'`,
    ).all() as Array<{ identity_key: string }>
    assert.deepEqual(before.map((row) => row.identity_key), ['local:api'])

    await connectConnector(db, GITHUB, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })

    const active = db.prepare(
      `SELECT id, identity_key FROM entities WHERE entity_type = 'repository' AND status = 'active'`,
    ).all() as Array<{ id: string; identity_key: string }>
    assert.equal(active.length, 1, 'local-git and GitHub identity unified into one repository entity')
    assert.equal(active[0].identity_key, 'provider:github/octo-lab/api', 'the survivor keeps PROVIDER identity')
    const merged = db.prepare(
      `SELECT merged_into_id FROM entities WHERE entity_type = 'repository' AND status = 'merged'`,
    ).all() as Array<{ merged_into_id: string }>
    assert.deepEqual(merged.map((row) => row.merged_into_id), [active[0].id], 'the merge is the reversible pointer flip')

    // The shared commit was not double-counted in the day layer either.
    const signal = getExternalSignal<GitActivitySignal>(db, commitDate, 'git')!
    assert.equal(signal.payload.repos.find((repo) => repo.repo === 'api')?.commitCount, 1)
  } finally {
    db.close()
  }
})

test('a same-named local repository WITHOUT corroboration stays separate — a suggestion, never an auto-merge', async () => {
  const db = createProductionTestDatabase()
  const { adapter } = createHarness()
  try {
    // A local folder called "api" the probe observed on a DIFFERENT day with
    // DIFFERENT commits: the name matches, nothing else does.
    putExternalSignal(db, localDateDaysAgo(5), 'git', {
      repos: [{
        repo: 'api',
        commitCount: 1,
        messages: ['Unrelated local work in a different api'],
        firstCommitClock: '09:00',
        lastCommitClock: '09:00',
      }],
      totalCommits: 1,
      prs: [],
    })
    await connectConnector(db, GITHUB, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })

    const active = db.prepare(
      `SELECT identity_key FROM entities WHERE entity_type = 'repository' AND status = 'active' ORDER BY identity_key`,
    ).all() as Array<{ identity_key: string }>
    assert.deepEqual(
      active.map((row) => row.identity_key),
      ['local:api', 'provider:github/octo-lab/api'],
      'a shared display name alone never merges',
    )
    const suggestions = listSuggestedEntityMerges(db)
    assert.ok(
      suggestions.some((entry) => entry.type === 'repository'),
      'the low-confidence match stays visible as a suggestion for a person to decide',
    )
  } finally {
    db.close()
  }
})

test('disconnect keeps or deletes: keep retains imported evidence, delete removes it from memory and search', async () => {
  const db = createProductionTestDatabase()
  const { adapter, store } = createHarness()
  const mergeDate = localDateDaysAgo(1)
  const commitDate = localDateDaysAgo(2)
  try {
    await connectConnector(db, GITHUB, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    indexMemoryForDay(db, mergeDate)

    // Keep: syncing stops, the credential dies, the evidence stays.
    await disconnectConnector(db, GITHUB, { deleteData: false, adapter, secretStore: store })
    assert.equal(store.dump().size, 0, 'no credential survives the disconnect')
    assert.equal(getConnectorConnection(db, GITHUB)?.status, 'disconnected')
    assert.equal(listConnectorRecords(db, GITHUB).length, 4, 'kept data stays')
    assert.ok(listEntities(db, { type: 'repository' }).length >= 1)

    // Reconnect, then disconnect WITH deletion: every derivative goes.
    await connectConnector(db, GITHUB, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    await disconnectConnector(db, GITHUB, { deleteData: true, adapter, secretStore: store })
    indexMemoryForDay(db, mergeDate)
    indexMemoryForDay(db, commitDate)

    assert.equal(listConnectorRecords(db, GITHUB, { includeTombstoned: true }).length, 0)
    assert.equal(listEntities(db, { type: 'repository' }).length, 0)
    assert.equal(listEntities(db, { type: 'person' }).length, 0)
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM memory_records WHERE record_kind = 'connected_activity'`).get() as { c: number }).c,
      0,
      'no connected-activity memory survives the deletion',
    )
    assert.equal(searchExact(db, 'Connector foundation extensions').length, 0, 'search cannot resurrect deleted evidence')
    assert.equal(getExternalSignal<GitActivitySignal>(db, commitDate, 'git'), null, 'the day git signal is cleaned')
  } finally {
    db.close()
  }
})

test('a credential-shaped commit message is quarantined whole, never partially ingested', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter } = createHarness()
  fake.addCommit(REPO, {
    sha: 'deadbee1',
    message: 'oops committed token ghp_abcdefghijklmnopqrstuvwxyz012345',
    date: isoDaysAgo(1, 8, 0),
  })
  try {
    const connected = await connectConnector(db, GITHUB, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    assert.equal(connected.status, 'ok')
    assert.equal(connected.quarantined, 1, 'the token-bearing record is quarantined')
    assert.ok(!listConnectorRecords(db, GITHUB).some((row) => row.source_record_id.includes('deadbee1')))
    assert.ok(!JSON.stringify(listConnectorRecords(db, GITHUB)).includes('ghp_'))
  } finally {
    db.close()
  }
})

test('credential hygiene: tokens and the client id never reach the database, listing, entities, or errors', async () => {
  const db = createProductionTestDatabase()
  const { fake, adapter, store } = createHarness()
  try {
    await connectConnector(db, GITHUB, CONNECT_CONFIG, { adapter, gate: OPEN_GATE })
    fake.failNextApiRequest({ status: 500 })
    await syncConnector(db, GITHUB, { adapter, gate: OPEN_GATE })

    const secrets = [...fake.issuedAccessTokens]
    assert.ok(secrets.length >= 1)
    // The vault HAS the secret (that is its job)…
    assert.ok([...store.dump().values()].some((value) => value.includes(secrets[0])))

    // …and NOTHING persisted or renderer-visible does.
    const persisted: string[] = []
    for (const table of ['connector_connections', 'connector_records', 'entities', 'entity_aliases', 'external_signals', 'memory_records']) {
      for (const row of db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>) {
        persisted.push(JSON.stringify(row))
      }
    }
    persisted.push(JSON.stringify(listConnectorListings(db)))
    for (const surface of persisted) {
      for (const secret of secrets) {
        assert.ok(!surface.includes(secret), `a token leaked into: ${surface.slice(0, 120)}…`)
      }
      assert.ok(!surface.includes(CLIENT_ID), 'the OAuth client id stays out of the database (vault-only)')
    }
  } finally {
    db.close()
  }
})

test('connecting reports honest progress: authorizing with the device code, then the bounded import', async () => {
  const db = createProductionTestDatabase()
  const { adapter } = createHarness()
  try {
    const progress: Array<{ phase: string; notice?: string }> = []
    const summary = await connectConnector(db, GITHUB, CONNECT_CONFIG, {
      adapter,
      gate: OPEN_GATE,
      onProgress: (phase, notice) => progress.push({ phase, notice }),
    })
    assert.equal(summary.status, 'ok')
    assert.deepEqual(progress.map((entry) => entry.phase), ['authorizing', 'authorizing', 'syncing'])
    const codeNotice = progress.find((entry) => entry.notice)
    assert.ok(codeNotice?.notice?.includes(FAKE_GITHUB_USER_CODE), 'the person is shown their device code')
  } finally {
    db.close()
  }
})

test('connect fails with plain-language guidance without a client id or repositories', async () => {
  const { adapter } = createHarness()
  await assert.rejects(
    adapter.connect({ config: { repositories: REPO } }),
    (error: Error) => error.message.includes('client ID'),
  )
  await assert.rejects(
    adapter.connect({ config: { clientId: CLIENT_ID } }),
    (error: Error) => error.message.includes('owner/repo'),
  )
  await assert.rejects(
    adapter.connect({ config: { clientId: CLIENT_ID, repositories: 'not a repo name' } }),
    (error: Error) => error.message.includes('owner/repo'),
  )
})

test('connect verifies every chosen repository is reachable before finishing', async () => {
  const { adapter } = createHarness()
  await assert.rejects(
    adapter.connect({ config: { clientId: CLIENT_ID, repositories: `${REPO}, octo-lab/nope` } }),
    (error: Error) => error.message.includes('octo-lab/nope'),
  )
})

test('health inspection is credential-free and honest about a missing authorization', async () => {
  const { adapter, store } = createHarness()
  const connection = {
    connectorId: GITHUB,
    status: 'connected' as const,
    accountLabel: 'ada-dev',
    config: { repositories: [REPO] },
    cursor: null,
  }
  const missing = await adapter.inspect!(connection)
  assert.equal(missing.state, 'needs_attention')
  assert.match(missing.summary, /Reconnect/)

  await adapter.connect({ config: CONNECT_CONFIG })
  const healthy = await adapter.inspect!(connection)
  assert.equal(healthy.state, 'ok')
  assert.ok(!JSON.stringify(healthy).includes('ghu_'), 'health never carries token material')
  assert.ok(store.dump().size > 0)
})
