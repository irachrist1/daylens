// Frozen daily snapshot build — the numbers a wrap sums must come from the same
// trusted blocks the Timeline reads.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDaySnapshot, computeSnapshotHash } from '../src/main/lib/daySnapshot.ts'
import type { AppCategory, DayTimelinePayload, WorkContextBlock } from '../src/shared/types.ts'
import type { WorkKind } from '../src/shared/workKind.ts'
import { DEFAULT_TIMELINE_BLOCK_REVIEW } from '../src/shared/timelineReview.ts'

const DAY = '2026-06-22'
const base = new Date('2026-06-22T09:00:00').getTime()

function makeBlock(opts: {
  label: string
  startOffsetMin: number
  durationMin: number
  kind: WorkKind
  category: AppCategory
  apps?: Array<{ appName: string; totalSeconds: number; category: AppCategory; isBrowser: boolean }>
  domains?: Array<{ domain: string; totalSeconds: number }>
  intentSubject?: string
  intentRole?: 'execution' | 'research' | 'review' | 'coordination'
}): WorkContextBlock {
  const start = base + opts.startOffsetMin * 60_000
  const durationSeconds = opts.durationMin * 60
  return {
    id: `b:${opts.label}:${start}`,
    startTime: start,
    endTime: start + durationSeconds * 1000,
    kind: opts.kind,
    dominantCategory: opts.category,
    categoryDistribution: { [opts.category]: durationSeconds },
    ruleBasedLabel: opts.label,
    aiLabel: null,
    sessions: [],
    topApps: (opts.apps ?? []).map((a) => ({ ...a, bundleId: a.appName, sessionCount: 1 })),
    websites: (opts.domains ?? []).map((d) => ({ domain: d.domain, totalSeconds: d.totalSeconds, visitCount: 1, topTitle: null, topUrl: null })),
    keyPages: [],
    pageRefs: [],
    documentRefs: [],
    topArtifacts: [],
    workflowRefs: [],
    label: { current: opts.label, source: 'rule', confidence: 0.92, narrative: null, ruleBased: opts.label, aiSuggested: null, override: null },
    focusOverlap: { totalSeconds: durationSeconds, pct: 100, sessionIds: [] },
    evidenceSummary: { apps: [], pages: [], documents: [], domains: [] },
    heuristicVersion: 'test',
    computedAt: start,
    switchCount: 0,
    confidence: 'high',
    review: {
      ...DEFAULT_TIMELINE_BLOCK_REVIEW,
      state: 'auto-approved',
      correctedIntentRole: opts.intentRole ?? null,
      correctedIntentSubject: opts.intentSubject ?? null,
    },
    isLive: false,
  }
}

function makePayload(blocks: WorkContextBlock[]): DayTimelinePayload {
  const totalSeconds = blocks.reduce((s, b) => s + Math.round((b.endTime - b.startTime) / 1000), 0)
  return {
    date: DAY,
    sessions: [],
    websites: [],
    blocks,
    segments: [],
    focusSessions: [],
    computedAt: Date.now(),
    version: 'test',
    totalSeconds,
    focusSeconds: totalSeconds,
    focusPct: 100,
    appCount: 0,
    siteCount: 0,
  }
}

function workDay(): DayTimelinePayload {
  return makePayload([
    makeBlock({ label: 'timeline rework', startOffsetMin: 0, durationMin: 80, kind: 'work', category: 'development',
      apps: [{ appName: 'Cursor', totalSeconds: 80 * 60, category: 'development', isBrowser: false }],
      intentSubject: 'the timeline rework', intentRole: 'execution' }),
    makeBlock({ label: 'malaria notebook', startOffsetMin: 90, durationMin: 40, kind: 'work', category: 'research',
      apps: [{ appName: 'Jupyter', totalSeconds: 40 * 60, category: 'research', isBrowser: false }],
      intentSubject: 'the malaria notebook', intentRole: 'research' }),
    makeBlock({ label: 'YouTube', startOffsetMin: 140, durationMin: 30, kind: 'leisure', category: 'entertainment',
      apps: [{ appName: 'Chrome', totalSeconds: 30 * 60, category: 'browsing', isBrowser: true }],
      domains: [{ domain: 'youtube.com', totalSeconds: 30 * 60 }] }),
  ])
}

test('snapshot total is the sum of trusted block active seconds', () => {
  const snap = buildDaySnapshot(workDay())
  assert.equal(snap.totalActiveSeconds, (80 + 40 + 30) * 60)
})

test('snapshot kind split separates work from leisure', () => {
  const snap = buildDaySnapshot(workDay())
  assert.equal(snap.kind.work, (80 + 40) * 60)
  assert.equal(snap.kind.leisure, 30 * 60)
})

test('dominant work category is the biggest WORK category, never leisure', () => {
  const snap = buildDaySnapshot(workDay())
  assert.equal(snap.dominantWorkCategory, 'development')
})

test('threads are named for the work and sorted by time', () => {
  const snap = buildDaySnapshot(workDay())
  assert.equal(snap.threads[0].subject, 'the timeline rework')
  assert.equal(snap.threads[0].seconds, 80 * 60)
  assert.ok(snap.threads.some((t) => t.subject === 'the malaria notebook'))
})

test('longest block is the longest work stretch, named for the work', () => {
  const snap = buildDaySnapshot(workDay())
  assert.equal(snap.longestBlock?.seconds, 80 * 60)
  assert.equal(snap.longestBlock?.label, 'the timeline rework')
})

test('leisure surfaces and top apps are captured', () => {
  const snap = buildDaySnapshot(workDay())
  assert.ok(snap.leisureSurfaces.includes('YouTube'))
  assert.equal(snap.apps[0].appName, 'Cursor')
})

test('snapshot hash is stable for the same facts and changes with the total', () => {
  const a = buildDaySnapshot(workDay())
  const b = buildDaySnapshot(workDay())
  assert.equal(a.factsHash, b.factsHash)
  assert.equal(computeSnapshotHash(a), a.factsHash)

  const changed = { ...a, totalActiveSeconds: a.totalActiveSeconds + 7200 }
  assert.notEqual(computeSnapshotHash(changed), a.factsHash)
})

test('an empty day yields an empty snapshot', () => {
  const snap = buildDaySnapshot(makePayload([]))
  assert.equal(snap.totalActiveSeconds, 0)
  assert.equal(snap.dominantWorkCategory, null)
  assert.equal(snap.threads.length, 0)
  assert.equal(snap.longestBlock, null)
})
