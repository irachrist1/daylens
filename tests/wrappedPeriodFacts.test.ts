// Pure aggregation of frozen daily snapshots into period facts. The whole point
// of invariant 4: the wrap's totals are a SUM of frozen days, so they can't
// disagree with the days they came from.
import test from 'node:test'
import assert from 'node:assert/strict'
import { rollupSnapshots, bucketTotals } from '../src/main/lib/wrappedPeriodFacts.ts'
import type { DaySnapshot } from '../src/shared/types.ts'

function snap(overrides: Partial<DaySnapshot> & { date: string }): DaySnapshot {
  return {
    date: overrides.date,
    totalActiveSeconds: overrides.totalActiveSeconds ?? 0,
    kind: overrides.kind ?? { work: 0, leisure: 0, personal: 0, idle: 0 },
    dominantWorkCategory: overrides.dominantWorkCategory ?? null,
    categories: overrides.categories ?? [],
    apps: overrides.apps ?? [],
    domains: overrides.domains ?? [],
    leisureSurfaces: overrides.leisureSurfaces ?? [],
    threads: overrides.threads ?? [],
    longestBlock: overrides.longestBlock ?? null,
    factsHash: 'h',
    finalizedAt: 1,
  }
}

const dayLabel = (d: string) => d.slice(-2)

test('totals are the exact sum of frozen day totals', () => {
  const snaps = [
    snap({ date: '2026-06-16', totalActiveSeconds: 3600, kind: { work: 3600, leisure: 0, personal: 0, idle: 0 } }),
    snap({ date: '2026-06-17', totalActiveSeconds: 7200, kind: { work: 5400, leisure: 1800, personal: 0, idle: 0 } }),
  ]
  const r = rollupSnapshots(snaps, dayLabel)
  assert.equal(r.totalSeconds, 10800)
  assert.equal(r.workSeconds, 9000)
  assert.equal(r.leisureSeconds, 1800)
  assert.equal(r.daysWithActivity, 2)
})

test('threads aggregate across days by subject, counting active days', () => {
  const snaps = [
    snap({ date: '2026-06-16', totalActiveSeconds: 3600, kind: { work: 3600, leisure: 0, personal: 0, idle: 0 },
      threads: [{ subject: 'the timeline rework', role: 'execution', seconds: 3600 }] }),
    snap({ date: '2026-06-17', totalActiveSeconds: 3600, kind: { work: 3600, leisure: 0, personal: 0, idle: 0 },
      threads: [{ subject: 'the timeline rework', role: 'execution', seconds: 1800 }, { subject: 'malaria notebook', role: 'research', seconds: 1800 }] }),
  ]
  const r = rollupSnapshots(snaps, dayLabel)
  const rework = r.threads.find((t) => t.subject === 'the timeline rework')
  assert.ok(rework)
  assert.equal(rework.seconds, 5400)
  assert.equal(rework.daysActive, 2)
  // Biggest thread first.
  assert.equal(r.threads[0].subject, 'the timeline rework')
})

test('main mode is the dominant WORK category, never leisure', () => {
  // A working day with a lot of entertainment on the side must not flip the mode.
  const snaps = [
    snap({ date: '2026-06-16', totalActiveSeconds: 9000,
      kind: { work: 3600, leisure: 5400, personal: 0, idle: 0 },
      categories: [
        { category: 'entertainment', seconds: 5400 },
        { category: 'development', seconds: 3000 },
        { category: 'writing', seconds: 600 },
      ] }),
  ]
  const r = rollupSnapshots(snaps, dayLabel)
  assert.equal(r.dominantWorkCategory, 'development')
  // entertainment/social are excluded from the work breakdown entirely.
  assert.ok(!r.categories.some((c) => c.category === 'entertainment'))
})

test('superlatives: busiest day and longest stretch', () => {
  const snaps = [
    snap({ date: '2026-06-16', totalActiveSeconds: 3600, kind: { work: 3600, leisure: 0, personal: 0, idle: 0 },
      longestBlock: { label: 'the rework', seconds: 1800, startClock: '9:00 AM' } }),
    snap({ date: '2026-06-17', totalActiveSeconds: 21600, kind: { work: 21600, leisure: 0, personal: 0, idle: 0 },
      longestBlock: { label: 'Intune', seconds: 10800, startClock: '1:00 PM' } }),
  ]
  const r = rollupSnapshots(snaps, dayLabel)
  assert.equal(r.busiestDay?.dateStr, '2026-06-17')
  assert.equal(r.busiestDay?.dayLabel, '17')
  assert.equal(r.longestStretch?.seconds, 10800)
  assert.equal(r.longestStretch?.label, 'Intune')
})

test('quietest active day only appears with more than one active day', () => {
  const one = rollupSnapshots([snap({ date: '2026-06-16', totalActiveSeconds: 3600, kind: { work: 3600, leisure: 0, personal: 0, idle: 0 } })], dayLabel)
  assert.equal(one.quietestActiveDay, null)
})

test('bucketTotals finds the busiest bucket and excludes leisure categories', () => {
  const week1 = [snap({ date: '2026-06-01', totalActiveSeconds: 3600, kind: { work: 3600, leisure: 0, personal: 0, idle: 0 }, categories: [{ category: 'development', seconds: 3600 }] })]
  const week2 = [snap({ date: '2026-06-08', totalActiveSeconds: 7200, kind: { work: 7200, leisure: 0, personal: 0, idle: 0 }, categories: [{ category: 'writing', seconds: 7200 }] })]
  const { buckets, busiestBucket } = bucketTotals([
    { label: 'Week of Jun 1', snapshots: week1 },
    { label: 'Week of Jun 8', snapshots: week2 },
  ])
  assert.equal(buckets.length, 2)
  assert.equal(busiestBucket?.label, 'Week of Jun 8')
  assert.equal(busiestBucket?.totalSeconds, 7200)
})
