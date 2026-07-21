// GitHub normalization fixtures (DEV-191): commits (multi-line messages,
// timezone offsets), pull requests across their states, reviews with actor
// identity, issues (updated-at effective time, PR-shaped issues skipped),
// self-vs-colleague people, git day-signal projection, and the credential
// gate quarantining token-shaped source content.
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRecordEnvelope } from '../src/main/connectors/contract.ts'
import {
  githubPersonConnectorId,
  involvesLogin,
  normalizeGithubCommit,
  normalizeGithubIssue,
  normalizeGithubPull,
  normalizeGithubReview,
  pullState,
  type GithubNormalizeContext,
} from '../src/main/connectors/github/normalize.ts'

const CONTEXT: GithubNormalizeContext = {
  retrievedAtMs: Date.parse('2026-07-20T12:00:00Z'),
  accountLogin: 'ada-dev',
  owner: 'octo-lab',
  repo: 'api',
  permissionScope: 'metadata:read contents:read pull_requests:read issues:read',
}

test('a commit keeps its subject line only, and its offset time lands on the right local day', () => {
  const record = normalizeGithubCommit({
    sha: 'ab12cd34',
    commit: {
      message: 'Fix watermark drift\n\nLong body with details that must not be ingested.',
      author: { date: '2026-07-18T23:30:00+05:30' },
    },
  }, CONTEXT)!
  assert.equal(record.provenance.sourceRecordId, 'commit:octo-lab/api:ab12cd34')
  assert.equal(record.provenance.effectiveAtMs, Date.parse('2026-07-18T23:30:00+05:30'))
  assert.equal(record.entity.kind, 'repository_activity')
  const activity = (record.entity as { activity?: { kind: string; title: string } }).activity!
  assert.equal(activity.kind, 'commit')
  assert.equal(activity.title, 'Fix watermark drift', 'the body never becomes evidence')
  // +05:30 23:30 is 18:00 UTC — the LOCAL date of that instant, wherever the
  // test runs, is what the day signal must carry.
  const expectedDate = (() => {
    const at = new Date(Date.parse('2026-07-18T23:30:00+05:30'))
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
  })()
  assert.equal(record.gitSignal?.date, expectedDate)
  assert.equal(record.gitSignal?.commit?.message, 'Fix watermark drift')
  assert.deepEqual(validateRecordEnvelope(record), [])
})

test('a commit without a parseable time or sha never becomes a record', () => {
  assert.equal(normalizeGithubCommit({ commit: { message: 'no sha' } }, CONTEXT), null)
  assert.equal(normalizeGithubCommit({ sha: 'ff00aa11', commit: { message: 'no date' } }, CONTEXT), null)
})

test('an overlong commit subject is clipped, not dropped', () => {
  const record = normalizeGithubCommit({
    sha: 'ee11bb22',
    commit: { message: `${'x'.repeat(400)}\nbody`, author: { date: '2026-07-19T10:00:00Z' } },
  }, CONTEXT)!
  const activity = (record.entity as { activity?: { title: string } }).activity!
  assert.ok(activity.title.length <= 140)
  assert.ok(activity.title.endsWith('…'))
})

test('pull request states: open, draft, merged, closed', () => {
  assert.equal(pullState({ state: 'open' }), 'open')
  assert.equal(pullState({ state: 'open', draft: true }), 'draft')
  assert.equal(pullState({ state: 'closed', merged_at: '2026-07-19T15:00:00Z' }), 'merged')
  assert.equal(pullState({ state: 'closed' }), 'closed')
})

test('a merged pull request is effective on its merge day; an open one on its creation day', () => {
  const merged = normalizeGithubPull({
    number: 7,
    title: 'Ship the connector',
    state: 'closed',
    created_at: '2026-07-15T09:00:00Z',
    merged_at: '2026-07-19T15:00:00Z',
    updated_at: '2026-07-19T15:00:00Z',
    user: { login: 'ada-dev' },
  }, CONTEXT)!
  assert.equal(merged.provenance.sourceRecordId, 'pr:octo-lab/api#7')
  assert.equal(merged.provenance.effectiveAtMs, Date.parse('2026-07-19T15:00:00Z'))
  assert.equal(merged.gitSignal?.pr?.state, 'merged')
  assert.deepEqual((merged.entity as { people?: unknown[] }).people, [], 'your own PR mints no person')

  const open = normalizeGithubPull({
    number: 8,
    title: 'Draft idea',
    state: 'open',
    draft: true,
    created_at: '2026-07-18T09:00:00Z',
    updated_at: '2026-07-18T09:30:00Z',
    user: { login: 'ana-collab' },
  }, CONTEXT)!
  assert.equal(open.provenance.effectiveAtMs, Date.parse('2026-07-18T09:00:00Z'))
  assert.equal(open.gitSignal?.pr?.state, 'draft')
  assert.deepEqual((open.entity as { people?: Array<{ connectorId: string }> }).people, [
    { connectorId: githubPersonConnectorId('ana-collab'), displayName: 'ana-collab' },
  ], 'a colleague author becomes a person by login')
})

test('a review carries its outcome and reviewer; your own review names no actor', () => {
  const pull = { number: 7, title: 'Ship the connector', user: { login: 'ada-dev' } }
  const theirs = normalizeGithubReview(
    { id: 501, state: 'CHANGES_REQUESTED', submitted_at: '2026-07-19T14:00:00Z', user: { login: 'ana-collab' } },
    pull,
    CONTEXT,
  )!
  assert.equal(theirs.provenance.sourceRecordId, 'review:octo-lab/api#7:501')
  const theirActivity = (theirs.entity as { activity?: { state?: string | null; actorLogin?: string | null } }).activity!
  assert.equal(theirActivity.state, 'changes requested')
  assert.equal(theirActivity.actorLogin, 'ana-collab')

  const mine = normalizeGithubReview(
    { id: 502, state: 'APPROVED', submitted_at: '2026-07-19T16:00:00Z', user: { login: 'ada-dev' } },
    pull,
    CONTEXT,
  )!
  const myActivity = (mine.entity as { activity?: { actorLogin?: string | null } }).activity!
  assert.equal(myActivity.actorLogin, null)
  assert.deepEqual((mine.entity as { people?: unknown[] }).people, [])

  const pending = normalizeGithubReview(
    { id: 503, state: 'PENDING', user: { login: 'ana-collab' } },
    pull,
    CONTEXT,
  )
  assert.equal(pending, null, 'a pending review is not evidence of anything')
})

test('an issue is effective when it was last touched, and a PR-shaped issue is skipped', () => {
  const issue = normalizeGithubIssue({
    number: 12,
    title: 'Sync loses its watermark',
    state: 'open',
    created_at: '2026-07-10T09:00:00Z',
    updated_at: '2026-07-19T11:00:00Z',
    user: { login: 'ada-dev' },
  }, CONTEXT)!
  assert.equal(issue.provenance.sourceRecordId, 'issue:octo-lab/api#12')
  assert.equal(issue.provenance.effectiveAtMs, Date.parse('2026-07-19T11:00:00Z'))
  assert.equal(issue.gitSignal, undefined, 'issues are memory, not day git activity')

  const prShaped = normalizeGithubIssue({
    number: 7,
    title: 'Really a PR',
    updated_at: '2026-07-19T11:00:00Z',
    pull_request: {},
  }, CONTEXT)
  assert.equal(prShaped, null)
})

test('involvement: author, assignee, or requested reviewer — case-insensitive by login', () => {
  assert.equal(involvesLogin({ user: { login: 'Ada-Dev' } }, 'ada-dev'), true)
  assert.equal(involvesLogin({ user: { login: 'other' }, assignees: [{ login: 'ada-dev' }] }, 'ada-dev'), true)
  assert.equal(involvesLogin({ user: { login: 'other' }, requested_reviewers: [{ login: 'ADA-dev' }] }, 'ada-dev'), true)
  assert.equal(involvesLogin({ user: { login: 'other' } }, 'ada-dev'), false)
})

test('token-shaped source content fails the record gate and quarantines whole', () => {
  const record = normalizeGithubCommit({
    sha: 'cc44dd55',
    commit: {
      message: 'add key ghp_abcdefghijklmnopqrstuvwxyz012345',
      author: { date: '2026-07-19T10:00:00Z' },
    },
  }, CONTEXT)!
  const problems = validateRecordEnvelope(record)
  assert.ok(problems.some((problem) => problem.includes('credential-shaped')))
})

test('provenance is complete on every record shape', () => {
  const record = normalizeGithubPull({
    number: 9,
    title: 'Anything',
    state: 'open',
    created_at: '2026-07-19T09:00:00Z',
    updated_at: '2026-07-19T09:00:00Z',
    user: { login: 'ada-dev' },
  }, CONTEXT)!
  assert.equal(record.provenance.connectorId, 'github')
  assert.equal(record.provenance.accountLabel, 'ada-dev')
  assert.equal(record.provenance.workspace, 'octo-lab/api')
  assert.equal(record.provenance.sensitivity, 'standard')
  assert.ok(record.provenance.permissionScope.includes('contents:read'))
  assert.ok(record.provenance.retrievedAtMs > 0)
})
