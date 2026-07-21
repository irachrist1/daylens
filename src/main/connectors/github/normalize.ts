// Normalization: one GitHub API record → one shared connector record envelope
// (DEV-191), the exact shape the connector foundation stores. Deliberately
// MINIMAL: identity, title, state, times, repository identity, and people by
// GitHub login. Bodies, diffs, patches, and URLs are not ingested — they add
// little to memory and are where credential-shaped content lives. Commit SHAs
// appear ONLY inside the opaque source record id (which the hygiene scan
// exempts as identity), never in titles or payload text.
//
// Returns null for records that must not become evidence: structurally
// unusable items (no id / no parseable time) and pull requests masquerading
// as issues on the issues endpoint.

import type { ConnectorRecordEnvelope } from '../contract'
import type { GithubCommitItem, GithubIssueOrPull, GithubReview } from './api'

export const GITHUB_CONNECTOR_ID = 'github' as const
export const GITHUB_PROVIDER = 'github'

const TITLE_MAX = 140

export interface GithubNormalizeContext {
  retrievedAtMs: number
  /** The connected account's GitHub login — the "self" people are measured
   *  against and the account label Settings shows. */
  accountLogin: string
  owner: string
  repo: string
  permissionScope: string
}

export function githubPersonConnectorId(login: string): string {
  return `${GITHUB_CONNECTOR_ID}:${login.toLowerCase()}`
}

function subjectLine(message: string | undefined): string | null {
  const first = (message ?? '').split('\n', 1)[0].trim()
  if (!first) return null
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1)}…` : first
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

function localDateOf(ms: number): string {
  const at = new Date(ms)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

function localClockOf(ms: number): string {
  const at = new Date(ms)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

function person(login: string | undefined | null, context: GithubNormalizeContext):
  { connectorId: string; displayName: string } | null {
  const trimmed = login?.trim()
  if (!trimmed) return null
  // The account owner is not minted as a "connected person" of their own work.
  if (trimmed.toLowerCase() === context.accountLogin.toLowerCase()) return null
  return { connectorId: githubPersonConnectorId(trimmed), displayName: trimmed }
}

function baseEnvelope(
  context: GithubNormalizeContext,
  sourceRecordId: string,
  effectiveAtMs: number | null,
): Pick<ConnectorRecordEnvelope, 'provenance'> {
  return {
    provenance: {
      connectorId: GITHUB_CONNECTOR_ID,
      accountLabel: context.accountLogin,
      workspace: `${context.owner}/${context.repo}`,
      sourceRecordId,
      retrievedAtMs: context.retrievedAtMs,
      effectiveAtMs,
      sensitivity: 'standard',
      permissionScope: context.permissionScope,
    },
  }
}

/** One commit you authored → a record whose title is the subject line only.
 *  A commit supports work claims only for what it actually records. */
export function normalizeGithubCommit(
  item: GithubCommitItem,
  context: GithubNormalizeContext,
): ConnectorRecordEnvelope | null {
  if (!item.sha) return null
  const title = subjectLine(item.commit?.message) ?? 'Untitled commit'
  const effectiveAtMs = parseTime(item.commit?.author?.date)
  if (effectiveAtMs == null) return null
  return {
    ...baseEnvelope(context, `commit:${context.owner}/${context.repo}:${item.sha}`, effectiveAtMs),
    entity: {
      kind: 'repository_activity',
      provider: GITHUB_PROVIDER,
      owner: context.owner,
      repo: context.repo,
      observedAt: effectiveAtMs,
      activity: { kind: 'commit', title },
    },
    gitSignal: {
      date: localDateOf(effectiveAtMs),
      repo: context.repo,
      commit: { message: title, clock: localClockOf(effectiveAtMs) },
    },
  }
}

export type GithubPullState = 'open' | 'draft' | 'merged' | 'closed'

export function pullState(pull: GithubIssueOrPull): GithubPullState {
  if (pull.merged_at) return 'merged'
  if (pull.state === 'closed') return 'closed'
  return pull.draft ? 'draft' : 'open'
}

/** One pull request you are involved in (author, assignee, or requested
 *  reviewer). Effective time is creation for open PRs and the merge time for
 *  merged ones, so "shipped it" lands on the day it shipped. */
export function normalizeGithubPull(
  pull: GithubIssueOrPull,
  context: GithubNormalizeContext,
): ConnectorRecordEnvelope | null {
  if (pull.number == null) return null
  const title = clippedTitle(pull.title) ?? `Pull request #${pull.number}`
  const state = pullState(pull)
  const effectiveAtMs = parseTime(pull.merged_at) ?? parseTime(pull.created_at)
  if (effectiveAtMs == null) return null
  const author = person(pull.user?.login, context)
  return {
    ...baseEnvelope(context, `pr:${context.owner}/${context.repo}#${pull.number}`, effectiveAtMs),
    entity: {
      kind: 'repository_activity',
      provider: GITHUB_PROVIDER,
      owner: context.owner,
      repo: context.repo,
      observedAt: effectiveAtMs,
      activity: {
        kind: 'pull_request',
        title,
        state,
        actorLogin: author ? author.displayName : null,
      },
      people: author ? [author] : [],
    },
    gitSignal: {
      date: localDateOf(effectiveAtMs),
      repo: context.repo,
      pr: { title, state },
    },
  }
}

/** One submitted review on a pull request you are involved in. The actor is
 *  the reviewer (yourself, or a colleague by login). Pending reviews are not
 *  evidence of anything and never normalize. */
export function normalizeGithubReview(
  review: GithubReview,
  pull: GithubIssueOrPull,
  context: GithubNormalizeContext,
): ConnectorRecordEnvelope | null {
  if (review.id == null || pull.number == null) return null
  const state = (review.state ?? '').toLowerCase().replace(/_/g, ' ')
  if (!state || state === 'pending') return null
  const effectiveAtMs = parseTime(review.submitted_at)
  if (effectiveAtMs == null) return null
  const title = clippedTitle(pull.title) ?? `Pull request #${pull.number}`
  const reviewer = person(review.user?.login, context)
  return {
    ...baseEnvelope(
      context,
      `review:${context.owner}/${context.repo}#${pull.number}:${review.id}`,
      effectiveAtMs,
    ),
    entity: {
      kind: 'repository_activity',
      provider: GITHUB_PROVIDER,
      owner: context.owner,
      repo: context.repo,
      observedAt: effectiveAtMs,
      activity: {
        kind: 'review',
        title,
        state,
        actorLogin: reviewer ? reviewer.displayName : null,
      },
      people: reviewer ? [reviewer] : [],
    },
  }
}

/** One issue you touched (author or assignee). Pull requests returned by the
 *  issues endpoint are skipped — they have their own richer normalization. */
export function normalizeGithubIssue(
  issue: GithubIssueOrPull,
  context: GithubNormalizeContext,
): ConnectorRecordEnvelope | null {
  if (issue.number == null || issue.pull_request != null) return null
  const title = clippedTitle(issue.title) ?? `Issue #${issue.number}`
  const effectiveAtMs = parseTime(issue.updated_at) ?? parseTime(issue.created_at)
  if (effectiveAtMs == null) return null
  const author = person(issue.user?.login, context)
  return {
    ...baseEnvelope(context, `issue:${context.owner}/${context.repo}#${issue.number}`, effectiveAtMs),
    entity: {
      kind: 'repository_activity',
      provider: GITHUB_PROVIDER,
      owner: context.owner,
      repo: context.repo,
      observedAt: effectiveAtMs,
      activity: {
        kind: 'issue',
        title,
        state: issue.state ?? null,
        actorLogin: author ? author.displayName : null,
      },
      people: author ? [author] : [],
    },
  }
}

/** Is the connected account involved in this pull/issue: author, assignee,
 *  or requested reviewer? Cross-checked case-insensitively by login. */
export function involvesLogin(item: GithubIssueOrPull, login: string): boolean {
  const target = login.toLowerCase()
  if (item.user?.login?.toLowerCase() === target) return true
  if ((item.assignees ?? []).some((assignee) => assignee.login?.toLowerCase() === target)) return true
  return (item.requested_reviewers ?? []).some((reviewer) => reviewer.login?.toLowerCase() === target)
}
