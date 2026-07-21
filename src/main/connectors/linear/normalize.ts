// Normalization: one Linear issue → one shared connector record envelope
// (DEV-192), the exact shape the connector foundation stores. Deliberately
// MINIMAL: issue identity, title, state, times, team/project/cycle identity,
// and people by Linear user id. Descriptions and comments are NOT ingested —
// the accepted `read` scope covers them, but they add little to memory and
// are where credential-shaped content lives (connectors.md §Linear admits
// them "only when the accepted scope permits"; this slice keeps them out).
//
// Returns null for issues that must not become evidence: structurally
// unusable nodes (no id / no parseable time) and archived or trashed issues —
// the ADAPTER turns those into tombstones; normalize never partially ingests
// them.

import type { ConnectorRecordEnvelope } from '../contract'
import type { LinearIssueNode } from './api'

export const LINEAR_CONNECTOR_ID = 'linear' as const
export const LINEAR_PROVIDER = 'linear'
export const LINEAR_SCOPE = 'read'

const TITLE_MAX = 140

export interface LinearNormalizeContext {
  retrievedAtMs: number
  /** The connected account's Linear user id — the "self" people are measured
   *  against (never minted as a "connected person" of their own work). */
  viewerId: string
  accountLabel: string | null
  /** Workspace identity label (the organization's url key or name). */
  workspace: string | null
}

export function linearPersonConnectorId(userId: string): string {
  return `${LINEAR_CONNECTOR_ID}:${userId}`
}

function clippedTitle(title: string | undefined): string | null {
  const trimmed = (title ?? '').trim()
  if (!trimmed) return null
  return trimmed.length > TITLE_MAX ? `${trimmed.slice(0, TITLE_MAX - 1)}…` : trimmed
}

function parseTime(value: string | undefined | null): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

export function isRemovedLinearIssue(issue: LinearIssueNode): boolean {
  return issue.trashed === true || issue.archivedAt != null
}

function person(
  user: { id?: string; name?: string; displayName?: string } | null | undefined,
  context: LinearNormalizeContext,
): { connectorId: string; displayName: string } | null {
  const id = user?.id?.trim()
  if (!id || id === context.viewerId) return null
  const displayName = user?.displayName?.trim() || user?.name?.trim()
  if (!displayName) return null
  return { connectorId: linearPersonConnectorId(id), displayName }
}

/**
 * One issue the connected person created or is assigned. Effective time is
 * the completion time when the issue completed, otherwise its last update —
 * "moved DAY-12 to In Progress" lands on the day it moved.
 */
export function normalizeLinearIssue(
  issue: LinearIssueNode,
  context: LinearNormalizeContext,
): ConnectorRecordEnvelope | null {
  if (!issue.id || isRemovedLinearIssue(issue)) return null
  const effectiveAtMs = parseTime(issue.completedAt) ?? parseTime(issue.updatedAt) ?? parseTime(issue.createdAt)
  if (effectiveAtMs == null) return null
  const identifier = issue.identifier?.trim() || issue.id
  const title = clippedTitle(issue.title) ?? identifier

  const people: Array<{ connectorId: string; displayName: string }> = []
  const seen = new Set<string>()
  for (const candidate of [person(issue.creator, context), person(issue.assignee, context)]) {
    if (!candidate || seen.has(candidate.connectorId)) continue
    seen.add(candidate.connectorId)
    people.push(candidate)
  }

  return {
    provenance: {
      connectorId: LINEAR_CONNECTOR_ID,
      accountLabel: context.accountLabel,
      workspace: context.workspace,
      sourceRecordId: `issue:${issue.id}`,
      retrievedAtMs: context.retrievedAtMs,
      effectiveAtMs,
      sensitivity: 'standard',
      permissionScope: LINEAR_SCOPE,
    },
    entity: {
      kind: 'issue_activity',
      provider: LINEAR_PROVIDER,
      workspace: context.workspace,
      sourceIssueId: issue.id,
      identifier,
      title,
      state: issue.state?.name?.trim() || null,
      stateType: issue.state?.type?.trim() || null,
      team: issue.team?.key?.trim()
        ? { key: issue.team.key.trim(), name: issue.team.name?.trim() || issue.team.key.trim() }
        : null,
      project: issue.project?.id?.trim()
        ? { sourceProjectId: issue.project.id.trim(), name: issue.project.name?.trim() || 'Untitled project' }
        : null,
      cycle: typeof issue.cycle?.number === 'number'
        ? { number: issue.cycle.number, name: issue.cycle.name?.trim() || null }
        : null,
      observedAt: effectiveAtMs,
      people,
    },
  }
}
