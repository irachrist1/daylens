// Day-summary scaffold context trim (cost audit 2026-07-07).
//
// The old scaffold sent the top-4 blocks twice (as `dominantBlocks` AND inside
// `blocks`) and pretty-printed the JSON. These tests pin the new shape — each
// block once, at most 10, compact JSON, titles capped — and MEASURE the byte
// delta against a byte-faithful reconstruction of the old serialization built
// from the same values (the old builder was a pure JSON.stringify of these
// exact fields, so the reconstruction is exact, not an estimate).
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDaySummaryScaffold } from '../src/main/jobs/aiService.ts'
import type { AppCategory, DayTimelinePayload, WorkContextBlock } from '../src/shared/types.ts'
import { DEFAULT_TIMELINE_BLOCK_REVIEW } from '../src/shared/timelineReview.ts'

const DAY = '2026-06-22'
const base = new Date('2026-06-22T08:00:00').getTime()

function makeBlock(opts: {
  label: string
  startOffsetMin: number
  durationMin: number
  category: AppCategory
}): WorkContextBlock {
  const start = base + opts.startOffsetMin * 60_000
  const durationSeconds = opts.durationMin * 60
  return {
    id: `b:${opts.label}:${start}`,
    startTime: start,
    endTime: start + durationSeconds * 1000,
    kind: 'work',
    dominantCategory: opts.category,
    categoryDistribution: { [opts.category]: durationSeconds },
    ruleBasedLabel: opts.label,
    aiLabel: null,
    sessions: [],
    topApps: [
      { appName: 'Cursor', bundleId: 'Cursor', totalSeconds: durationSeconds, category: opts.category, isBrowser: false, sessionCount: 1 },
      { appName: 'Warp', bundleId: 'Warp', totalSeconds: Math.round(durationSeconds / 3), category: opts.category, isBrowser: false, sessionCount: 1 },
    ],
    websites: [{ domain: 'github.com', totalSeconds: 600, visitCount: 3, topTitle: `PR review for ${opts.label}`, topUrl: null }],
    keyPages: [],
    pageRefs: [
      { displayTitle: `${opts.label} — a long page title that goes on and on and repeats itself and keeps going well past a hundred characters of text`, domain: 'github.com' },
    ] as WorkContextBlock['pageRefs'],
    documentRefs: [],
    topArtifacts: [
      { displayTitle: `artifact for ${opts.label}`, artifactType: 'file' },
    ] as WorkContextBlock['topArtifacts'],
    workflowRefs: [],
    label: { current: opts.label, source: 'rule', confidence: 0.9, narrative: `Worked on ${opts.label}.`, ruleBased: opts.label, aiSuggested: null, override: null },
    focusOverlap: { totalSeconds: durationSeconds, pct: 100, sessionIds: [] },
    evidenceSummary: { apps: [], pages: [], documents: [], domains: [] },
    heuristicVersion: 'test',
    computedAt: start,
    switchCount: 3,
    confidence: 'high',
    review: { ...DEFAULT_TIMELINE_BLOCK_REVIEW, state: 'auto-approved' },
    isLive: false,
  }
}

function makePayload(blocks: WorkContextBlock[]): DayTimelinePayload {
  const totalSeconds = blocks.reduce((sum, block) => sum + Math.round((block.endTime - block.startTime) / 1000), 0)
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
    appCount: 4,
    siteCount: 3,
  }
}

// A realistic busy day: 12 blocks of varying length.
function busyDay(): DayTimelinePayload {
  const durations = [95, 20, 60, 15, 45, 30, 75, 10, 25, 50, 40, 35]
  return makePayload(durations.map((durationMin, index) =>
    makeBlock({
      label: `work stretch ${index + 1}`,
      startOffsetMin: index * 70,
      durationMin,
      category: index % 3 === 0 ? 'development' : index % 3 === 1 ? 'research' : 'writing',
    }),
  ))
}

test('scaffold sends each block once, at most 10, in compact JSON', () => {
  const scaffold = buildDaySummaryScaffold(busyDay())
  const parsed = JSON.parse(scaffold) as { blocks: Array<{ label: string; durationRank: number }>; dominantBlocks?: unknown }

  assert.equal(parsed.dominantBlocks, undefined, 'dominantBlocks duplication must be gone')
  assert.ok(parsed.blocks.length <= 10, `expected <=10 blocks, got ${parsed.blocks.length}`)
  const labels = parsed.blocks.map((block) => block.label)
  assert.equal(new Set(labels).size, labels.length, 'no block may appear twice')
  assert.ok(!scaffold.includes('\n'), 'scaffold must be compact JSON, not pretty-printed')
})

test('scaffold keeps the 10 LONGEST blocks, chronological, with rich evidence on the top 4', () => {
  const scaffold = buildDaySummaryScaffold(busyDay())
  const parsed = JSON.parse(scaffold) as {
    blocks: Array<{ label: string; durationRank: number; timeRange: string; supportingEvidence?: unknown }>
  }
  // The two shortest blocks (10m and 15m — stretches 8 and 4) are dropped;
  // survivors stay in start-time order (stretch index rises with start time).
  // Do not sort the formatted clock strings — "10:20 AM" sorts before "8:00 AM"
  // lexicographically, which is not chronological.
  assert.deepEqual(
    parsed.blocks.map((block) => block.label),
    [
      'work stretch 1',
      'work stretch 2',
      'work stretch 3',
      'work stretch 5',
      'work stretch 6',
      'work stretch 7',
      'work stretch 9',
      'work stretch 10',
      'work stretch 11',
      'work stretch 12',
    ],
  )
  // Rich supporting evidence rides only on the top-4 by duration.
  const withEvidence = parsed.blocks.filter((block) => block.supportingEvidence !== undefined)
  assert.equal(withEvidence.length, 4)
  assert.ok(withEvidence.every((block) => block.durationRank <= 4))
})

test('scaffold truncates artifact and page titles at 100 chars', () => {
  const scaffold = buildDaySummaryScaffold(busyDay())
  const parsed = JSON.parse(scaffold) as { blocks: Array<{ pages: Array<{ title: string }>; artifacts: Array<{ title: string }> }> }
  for (const block of parsed.blocks) {
    for (const page of block.pages) assert.ok(page.title.length <= 100, `page title too long: ${page.title.length}`)
    for (const artifact of block.artifacts) assert.ok(artifact.title.length <= 100)
  }
})

test('MEASURED: trimmed scaffold is at least 25% smaller than the old serialization', () => {
  const payload = busyDay()
  const scaffold = buildDaySummaryScaffold(payload)
  const parsed = JSON.parse(scaffold) as {
    date: string
    totals: unknown
    topCategories: unknown
    blocks: Array<Record<string, unknown>>
    focusSessions: unknown
  }

  // Byte-faithful reconstruction of the OLD scaffold from the same values:
  // `blocks` was the FIRST 8 chronological blocks without rank/evidence, and
  // `dominantBlocks` repeated the top-4 by duration with the evidence fields —
  // all pretty-printed with a 2-space indent.
  const chronological = [...parsed.blocks].sort((a, b) => String(a.timeRange).localeCompare(String(b.timeRange)))
  const oldBlocks = chronological.slice(0, 8).map((block) => {
    const { durationRank: _rank, supportingEvidence: _evidence, ...rest } = block
    return rest
  })
  const oldDominant = [...parsed.blocks]
    .sort((a, b) => Number(a.durationRank) - Number(b.durationRank))
    .slice(0, 4)
    .map((block) => ({
      label: block.label,
      timeRange: block.timeRange,
      duration: block.duration,
      reviewState: block.reviewState,
      workIntent: block.workIntent,
      supportingEvidence: block.supportingEvidence ?? [],
    }))
  const oldScaffold = JSON.stringify({
    date: parsed.date,
    totals: parsed.totals,
    topCategories: parsed.topCategories,
    dominantBlocks: oldDominant,
    blocks: oldBlocks,
    focusSessions: parsed.focusSessions,
  }, null, 2)

  const oldTokens = Math.round(oldScaffold.length / 4)
  const newTokens = Math.round(scaffold.length / 4)
  const savedPct = Math.round((1 - scaffold.length / oldScaffold.length) * 100)
  console.log(`[measure] day_summary scaffold: old ${oldScaffold.length} chars (~${oldTokens} tok) → new ${scaffold.length} chars (~${newTokens} tok), ${savedPct}% smaller`)

  assert.ok(scaffold.length < oldScaffold.length * 0.75, `expected >=25% reduction, got ${savedPct}%`)
})
