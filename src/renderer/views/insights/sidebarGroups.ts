// Pure grouping for the conversation sidebar (extracted from
// ConversationSidebar so the invariants are unit-testable):
//   - every thread id renders at most ONCE — a row can never appear in two
//     recency groups, in a group and Archive, or twice inside one group;
//   - active vs archived is a disjoint partition;
//   - groups are recency buckets ordered Today → Older, items newest-first.
//
// Note the historical bug this guards: the visible "duplicate" sidebar rows
// ("This Week Focus" twice) were DISTINCT thread rows with identical derived
// titles, created when a draft send failed/raced and the next send minted a
// new thread instead of reusing it. That's fixed at the source (authoritative
// threadId on the turn result + empty-draft reuse in the main process); the
// by-id dedupe here is the defensive layer for the list itself.

import type { AIThreadSummary } from '@shared/types'

export const GROUP_ORDER = ['Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days', 'Older'] as const
export type GroupLabel = (typeof GROUP_ORDER)[number]

const DAY_MS = 86_400_000

export function recencyGroupOf(ms: number, now: Date = new Date()): GroupLabel {
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ms >= startToday) return 'Today'
  if (ms >= startToday - DAY_MS) return 'Yesterday'
  if (ms >= startToday - 7 * DAY_MS) return 'Previous 7 Days'
  if (ms >= startToday - 30 * DAY_MS) return 'Previous 30 Days'
  return 'Older'
}

export function threadMatchesQuery(thread: AIThreadSummary, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return thread.title.toLowerCase().includes(q) || (thread.lastSnippet ?? '').toLowerCase().includes(q)
}

export interface SidebarGroups {
  groups: Array<{ label: GroupLabel; items: AIThreadSummary[] }>
  archived: AIThreadSummary[]
}

export function groupThreadsForSidebar(
  threads: AIThreadSummary[],
  query: string,
  now: Date = new Date(),
): SidebarGroups {
  // Defensive by-id dedupe: whatever the list source hands us, one row per
  // thread (first occurrence wins).
  const seen = new Set<number>()
  const unique = threads.filter((thread) => {
    if (seen.has(thread.id)) return false
    seen.add(thread.id)
    return true
  })

  const active = unique.filter((thread) => !thread.archived && threadMatchesQuery(thread, query))
  const archived = unique
    .filter((thread) => thread.archived && threadMatchesQuery(thread, query))
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)

  const byGroup = new Map<GroupLabel, AIThreadSummary[]>()
  for (const thread of [...active].sort((a, b) => b.lastMessageAt - a.lastMessageAt)) {
    const label = recencyGroupOf(thread.lastMessageAt, now)
    const bucket = byGroup.get(label) ?? []
    bucket.push(thread)
    byGroup.set(label, bucket)
  }
  const groups = GROUP_ORDER
    .map((label) => ({ label, items: byGroup.get(label) ?? [] }))
    .filter((group) => group.items.length > 0)

  return { groups, archived }
}
