// Linear normalization (DEV-192): one issue node → one shared record
// envelope, minimal by construction — identity, title, state + category,
// team/project/cycle identity, people by Linear user id. Descriptions and
// comments never appear anywhere in the envelope.
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRecordEnvelope } from '../src/main/connectors/contract.ts'
import {
  isRemovedLinearIssue,
  linearPersonConnectorId,
  normalizeLinearIssue,
  type LinearNormalizeContext,
} from '../src/main/connectors/linear/normalize.ts'
import type { LinearIssueNode } from '../src/main/connectors/linear/api.ts'

const CONTEXT: LinearNormalizeContext = {
  retrievedAtMs: Date.parse('2026-07-18T12:00:00Z'),
  viewerId: 'user-self',
  accountLabel: 'Ada · acme',
  workspace: 'acme',
}

function issue(overrides: Partial<LinearIssueNode> = {}): LinearIssueNode {
  return {
    id: 'issue-1',
    identifier: 'DAY-12',
    title: 'Payment bug: retries double-charge',
    createdAt: '2026-07-15T09:00:00Z',
    updatedAt: '2026-07-17T15:30:00Z',
    state: { name: 'In Progress', type: 'started' },
    team: { id: 'team-1', key: 'DAY', name: 'Daylens' },
    project: { id: 'proj-1', name: 'Billing hardening' },
    cycle: { id: 'cycle-1', number: 23, name: null },
    assignee: { id: 'user-self', name: 'Ada', displayName: 'Ada' },
    creator: { id: 'user-dana', name: 'Dana Reyes', displayName: 'dana' },
    ...overrides,
  }
}

test('an issue normalizes to a gate-passing issue_activity envelope with full source identity', () => {
  const record = normalizeLinearIssue(issue(), CONTEXT)
  assert.ok(record)
  assert.deepEqual(validateRecordEnvelope(record!), [])
  assert.equal(record!.provenance.connectorId, 'linear')
  assert.equal(record!.provenance.sourceRecordId, 'issue:issue-1')
  assert.equal(record!.provenance.workspace, 'acme')
  assert.equal(record!.provenance.sensitivity, 'standard')
  assert.equal(record!.provenance.permissionScope, 'read')
  assert.equal(record!.provenance.effectiveAtMs, Date.parse('2026-07-17T15:30:00Z'))

  const entity = record!.entity
  assert.equal(entity.kind, 'issue_activity')
  if (entity.kind !== 'issue_activity') return
  assert.equal(entity.identifier, 'DAY-12')
  assert.equal(entity.state, 'In Progress')
  assert.equal(entity.stateType, 'started')
  assert.deepEqual(entity.team, { key: 'DAY', name: 'Daylens' })
  assert.deepEqual(entity.project, { sourceProjectId: 'proj-1', name: 'Billing hardening' })
  assert.deepEqual(entity.cycle, { number: 23, name: null })
})

test('the account owner is never minted as a connected person of their own work', () => {
  const record = normalizeLinearIssue(issue(), CONTEXT)!
  assert.equal(record.entity.kind, 'issue_activity')
  if (record.entity.kind !== 'issue_activity') return
  assert.deepEqual(record.entity.people, [
    { connectorId: linearPersonConnectorId('user-dana'), displayName: 'dana' },
  ])
})

test('a completed issue lands on its completion day', () => {
  const record = normalizeLinearIssue(
    issue({ completedAt: '2026-07-18T10:00:00Z', state: { name: 'Done', type: 'completed' } }),
    CONTEXT,
  )!
  assert.equal(record.provenance.effectiveAtMs, Date.parse('2026-07-18T10:00:00Z'))
})

test('archived and trashed issues never normalize — the adapter tombstones them instead', () => {
  assert.equal(normalizeLinearIssue(issue({ trashed: true }), CONTEXT), null)
  assert.equal(normalizeLinearIssue(issue({ archivedAt: '2026-07-18T10:00:00Z' }), CONTEXT), null)
  assert.ok(isRemovedLinearIssue(issue({ trashed: true })))
  assert.ok(isRemovedLinearIssue(issue({ archivedAt: '2026-07-18T10:00:00Z' })))
  assert.equal(isRemovedLinearIssue(issue()), false)
})

test('structurally unusable nodes are refused whole', () => {
  assert.equal(normalizeLinearIssue(issue({ id: undefined }), CONTEXT), null)
  assert.equal(
    normalizeLinearIssue(issue({ createdAt: undefined, updatedAt: undefined, completedAt: undefined }), CONTEXT),
    null,
  )
})

test('a very long title is clipped; a missing title falls back to the identifier', () => {
  const long = normalizeLinearIssue(issue({ title: 'x'.repeat(400) }), CONTEXT)!
  assert.equal(long.entity.kind, 'issue_activity')
  if (long.entity.kind === 'issue_activity') {
    assert.ok(long.entity.title.length <= 140)
  }
  const untitled = normalizeLinearIssue(issue({ title: '  ' }), CONTEXT)!
  if (untitled.entity.kind === 'issue_activity') {
    assert.equal(untitled.entity.title, 'DAY-12')
  }
})
