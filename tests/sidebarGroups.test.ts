// W1-C: sidebar grouping invariants (sidebarGroups.ts) — one row per thread
// id, disjoint active/archive partition, recency buckets newest-first. The
// founder-visible "duplicate" rows ("This Week Focus" twice) were distinct DB
// rows with identical derived titles; the creation-side fix lives in
// aiService/artifacts (authoritative threadId + empty-draft reuse), and this
// grouping layer guarantees the LIST itself can never double-render a thread.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { AIThreadSummary } from '../src/shared/types.ts'
import { groupThreadsForSidebar, recencyGroupOf } from '../src/renderer/views/insights/sidebarGroups.ts'

const NOW = new Date(2026, 6, 11, 12, 0, 0) // local Jul 11 2026, noon
const DAY = 86_400_000

function thread(id: number, overrides: Partial<AIThreadSummary> = {}): AIThreadSummary {
  return {
    id,
    title: `Thread ${id}`,
    createdAt: NOW.getTime() - DAY,
    updatedAt: NOW.getTime(),
    lastMessageAt: NOW.getTime() - 60_000,
    archived: false,
    messageCount: 2,
    lastSnippet: null,
    ...overrides,
  }
}

test('every thread id renders exactly once even if the source list contains duplicates', () => {
  const dupe = thread(184, { title: 'This Week Focus' })
  const { groups, archived } = groupThreadsForSidebar([dupe, thread(185, { title: 'This Week Focus' }), { ...dupe }], '', NOW)
  const renderedIds = groups.flatMap((group) => group.items.map((item) => item.id))
  assert.deepEqual([...renderedIds].sort(), [184, 185])
  assert.equal(archived.length, 0)
})

test('two DIFFERENT threads with the same title both stay visible — they are distinct conversations', () => {
  const { groups } = groupThreadsForSidebar([
    thread(184, { title: 'Focus Session' }),
    thread(185, { title: 'Focus Session', lastMessageAt: NOW.getTime() - 120_000 }),
  ], '', NOW)
  assert.equal(groups.flatMap((g) => g.items).length, 2)
})

test('active and archived are a disjoint partition — an archived thread never shows in a recency group', () => {
  const rows = [
    thread(1),
    thread(2, { archived: true }),
    thread(3, { archived: true, lastMessageAt: NOW.getTime() - 40 * DAY }),
  ]
  const { groups, archived } = groupThreadsForSidebar(rows, '', NOW)
  const groupedIds = groups.flatMap((group) => group.items.map((item) => item.id))
  assert.deepEqual(groupedIds, [1])
  assert.deepEqual(archived.map((row) => row.id), [2, 3])
  for (const id of archived.map((row) => row.id)) {
    assert.equal(groupedIds.includes(id), false)
  }
})

test('threads land in the right recency bucket and are newest-first within it', () => {
  const rows = [
    thread(1, { lastMessageAt: NOW.getTime() - 2 * 60_000 }),          // Today
    thread(2, { lastMessageAt: NOW.getTime() - 60_000 }),              // Today, newer
    thread(3, { lastMessageAt: NOW.getTime() - 20 * 3_600_000 }),      // Yesterday (16:00 prior day)
    thread(4, { lastMessageAt: NOW.getTime() - 3 * DAY }),             // Previous 7 Days
    thread(5, { lastMessageAt: NOW.getTime() - 20 * DAY }),            // Previous 30 Days
    thread(6, { lastMessageAt: NOW.getTime() - 90 * DAY }),            // Older
  ]
  const { groups } = groupThreadsForSidebar(rows, '', NOW)
  assert.deepEqual(groups.map((group) => group.label), ['Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days', 'Older'])
  assert.deepEqual(groups[0].items.map((item) => item.id), [2, 1])
})

test('search filters by title and snippet across both sections', () => {
  const rows = [
    thread(1, { title: 'Weekly Report' }),
    thread(2, { title: 'Hey man', lastSnippet: 'the weekly numbers you asked for' }),
    thread(3, { title: 'Time on youtube' }),
    thread(4, { title: 'Weekly Report', archived: true }),
  ]
  const { groups, archived } = groupThreadsForSidebar(rows, 'weekly', NOW)
  assert.deepEqual(groups.flatMap((g) => g.items.map((i) => i.id)).sort(), [1, 2])
  assert.deepEqual(archived.map((row) => row.id), [4])
})

test('recencyGroupOf boundaries', () => {
  const startToday = new Date(2026, 6, 11).getTime()
  assert.equal(recencyGroupOf(startToday, NOW), 'Today')
  assert.equal(recencyGroupOf(startToday - 1, NOW), 'Yesterday')
  assert.equal(recencyGroupOf(startToday - DAY - 1, NOW), 'Previous 7 Days')
  assert.equal(recencyGroupOf(startToday - 7 * DAY - 1, NOW), 'Previous 30 Days')
  assert.equal(recencyGroupOf(startToday - 30 * DAY - 1, NOW), 'Older')
})
