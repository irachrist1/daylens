import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeSelectionSpan, spanMergeState } from '../src/renderer/lib/timelineMergeSelection.ts'
import { DEFAULT_TIMELINE_BLOCK_REVIEW } from '../src/shared/timelineReview.ts'
import type { AppCategory, WorkContextBlock } from '../src/shared/types.ts'

// Shift-click multi-select-then-merge on the Timeline day grid. This pins the
// two pure questions the gesture asks — which blocks the span covers, and
// whether that span can be merged right now — the exact logic Timeline.tsx
// feeds to the block highlight and the "Merge N blocks" context-menu item. It
// exercises the shipped code path (Timeline imports these functions), so a
// regression that silently drops shift-selection or its merge action fails
// here, not just in a screenshot.

function makeBlock(id: string, startMinute: number, opts: { provisional?: boolean; live?: boolean } = {}): WorkContextBlock {
  const category: AppCategory = 'development'
  const startTime = startMinute * 60 * 1000
  const endTime = startTime + 30 * 60 * 1000
  return {
    id,
    startTime,
    endTime,
    dominantCategory: category,
    categoryDistribution: { [category]: 1800 },
    ruleBasedLabel: 'Coding',
    aiLabel: null,
    sessions: [],
    topApps: [],
    websites: [],
    keyPages: [],
    pageRefs: [],
    documentRefs: [],
    topArtifacts: [],
    workflowRefs: [],
    label: {
      current: 'Coding',
      source: 'rule',
      confidence: 0.8,
      narrative: null,
      ruleBased: 'Coding',
      aiSuggested: null,
      override: null,
    },
    focusOverlap: { totalSeconds: 1800, pct: 100, sessionIds: [] },
    evidenceSummary: { apps: [], pages: [], documents: [], domains: [] },
    heuristicVersion: 'test',
    computedAt: 0,
    switchCount: 0,
    confidence: 'high',
    review: { ...DEFAULT_TIMELINE_BLOCK_REVIEW, state: 'auto-approved' },
    isLive: opts.live ?? false,
    provisional: opts.provisional,
  }
}

// Four back-to-back blocks in start order — the run shift-selection walks over.
const A = makeBlock('a', 0)
const B = makeBlock('b', 30)
const C = makeBlock('c', 60)
const D = makeBlock('d', 90)
const SORTED = [A, B, C, D]

test('no anchor selects nothing', () => {
  assert.deepEqual(mergeSelectionSpan(SORTED, null, null), [])
})

test('a plain click (anchor, no range end) selects just that block', () => {
  assert.deepEqual(mergeSelectionSpan(SORTED, 'b', null).map((x) => x.id), ['b'])
})

test('shift-clicking the same block is not a span — still just the anchor', () => {
  assert.deepEqual(mergeSelectionSpan(SORTED, 'b', 'b').map((x) => x.id), ['b'])
})

test('shift-click forward selects the inclusive run in start order', () => {
  // Click A, shift-click D → A,B,C,D (the in-between blocks come along).
  assert.deepEqual(mergeSelectionSpan(SORTED, 'a', 'd').map((x) => x.id), ['a', 'b', 'c', 'd'])
})

test('shift-click backward selects the same run, still in start order', () => {
  // Click D, shift-click A → span is A..D, not reversed.
  assert.deepEqual(mergeSelectionSpan(SORTED, 'd', 'a').map((x) => x.id), ['a', 'b', 'c', 'd'])
})

test('a middle-to-middle span is exactly the inclusive slice', () => {
  assert.deepEqual(mergeSelectionSpan(SORTED, 'b', 'c').map((x) => x.id), ['b', 'c'])
})

test('a stale anchor (block left the day) collapses to no selection', () => {
  assert.deepEqual(mergeSelectionSpan(SORTED, 'gone', 'd'), [])
})

test('a stale range end (block left the day) collapses back to the anchor', () => {
  assert.deepEqual(mergeSelectionSpan(SORTED, 'b', 'gone').map((x) => x.id), ['b'])
})

test('a single-block selection offers no merge', () => {
  const state = spanMergeState(mergeSelectionSpan(SORTED, 'b', null))
  assert.equal(state.isSpan, false)
  assert.equal(state.count, 1)
  assert.equal(state.canMerge, false)
  assert.equal(state.endpointIds, null)
})

test('a two-block span offers an enabled merge with both endpoints', () => {
  const state = spanMergeState(mergeSelectionSpan(SORTED, 'b', 'c'))
  assert.equal(state.isSpan, true)
  assert.equal(state.count, 2)
  assert.equal(state.hasLiveBlock, false)
  assert.equal(state.canMerge, true)
  assert.deepEqual(state.endpointIds, ['b', 'c'])
})

test('a wider span hands the server only its two endpoints (it fuses the middle)', () => {
  const state = spanMergeState(mergeSelectionSpan(SORTED, 'a', 'd'))
  assert.equal(state.count, 4)
  assert.deepEqual(state.endpointIds, ['a', 'd'])
})

test('a span containing a live/provisional block shows the merge but disables it', () => {
  // A live "Active now" block anywhere in the run means the action is offered
  // (so the count is visible) but cannot fire until the block settles.
  const live = makeBlock('c', 60, { provisional: true, live: true })
  const withLive = [A, B, live, D]
  const state = spanMergeState(mergeSelectionSpan(withLive, 'b', 'd'))
  assert.equal(state.isSpan, true)
  assert.equal(state.count, 3)
  assert.equal(state.hasLiveBlock, true)
  assert.equal(state.canMerge, false)
  // Endpoints are still reported so the label ("Merge 3 blocks") renders; the
  // caller gates the click on canMerge.
  assert.deepEqual(state.endpointIds, ['b', 'd'])
})

test('propagated gesture: click then shift-click makes the merge action available', () => {
  // Mirror the Timeline flow: anchor = first click, rangeEnd = shift-click.
  const anchorId = 'a'
  const shiftClickedId = 'c'
  const span = mergeSelectionSpan(SORTED, anchorId, shiftClickedId)
  const highlighted = new Set(span.map((b) => b.id))
  // The whole run highlights, anchor included.
  assert.deepEqual([...highlighted].sort(), ['a', 'b', 'c'])
  const state = spanMergeState(span)
  // Right-clicking any block inside the span would offer "Merge 3 blocks".
  assert.ok(state.isSpan && state.canMerge)
  assert.equal(state.count, 3)
})
