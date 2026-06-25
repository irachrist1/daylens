import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDayWrapFacts } from '../src/renderer/lib/dayWrapScenes.ts'
import { looksLikeRawArtifactLabel } from '../src/renderer/lib/wrappedFacts.ts'
import type { AppCategory, DayTimelinePayload, WorkContextBlock } from '../src/shared/types.ts'
import { DEFAULT_TIMELINE_BLOCK_REVIEW } from '../src/shared/timelineReview.ts'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeBlock(opts: {
  label: string
  start: number
  durationSeconds: number
  category?: AppCategory
}): WorkContextBlock {
  const category: AppCategory = opts.category ?? 'development'
  return {
    id: `b:${opts.label}:${opts.start}`,
    startTime: opts.start,
    endTime: opts.start + opts.durationSeconds * 1000,
    dominantCategory: category,
    categoryDistribution: { [category]: opts.durationSeconds },
    ruleBasedLabel: opts.label,
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
      current: opts.label,
      source: 'rule',
      confidence: 0.92,
      narrative: null,
      ruleBased: opts.label,
      aiSuggested: null,
      override: null,
    },
    focusOverlap: { totalSeconds: opts.durationSeconds, pct: 100, sessionIds: [] },
    evidenceSummary: { apps: [], pages: [], documents: [], domains: [] },
    heuristicVersion: 'test',
    computedAt: opts.start,
    switchCount: 0,
    confidence: 'high',
    review: { ...DEFAULT_TIMELINE_BLOCK_REVIEW, state: 'auto-approved' },
    isLive: false,
  }
}

function makeDayPayload(blocks: WorkContextBlock[]): DayTimelinePayload {
  const total = blocks.reduce((s, b) => s + Math.round((b.endTime - b.startTime) / 1000), 0)
  return {
    date: '2026-06-23', // a fixed past Tuesday so weekday/date labels are stable
    sessions: [],
    websites: [],
    blocks,
    segments: [],
    focusSessions: [],
    computedAt: Date.now(),
    version: 'test',
    totalSeconds: total,
    focusSeconds: total,
    focusPct: 100,
    appCount: 0,
    siteCount: 0,
  }
}

const NINE_AM = new Date('2026-06-23T09:00:00').getTime()

// ─── Tests ─────────────────────────────────────────────────────────────────────

test('headline, ribbon, and the work split all reconcile to one number', () => {
  const facts = buildDayWrapFacts(makeDayPayload([
    makeBlock({ label: 'Auth refactor', start: NINE_AM, durationSeconds: 90 * 60, category: 'development' }),
    makeBlock({ label: 'Design review', start: NINE_AM + 100 * 60_000, durationSeconds: 40 * 60, category: 'design' }),
  ]))
  const ribbonTotal = facts.ribbon.reduce((s, seg) => s + seg.seconds, 0)
  assert.equal(facts.activeSeconds, facts.workSeconds + facts.leisureSeconds + facts.personalSeconds)
  assert.equal(facts.activeSeconds, ribbonTotal)
  assert.equal(facts.workSeconds, 130 * 60)
  assert.equal(facts.leisureSeconds, 0)
})

test('a raw filename never leaks as an activity name', () => {
  const facts = buildDayWrapFacts(makeDayPayload([
    makeBlock({ label: 'BofA_Internship_Essay.docx', start: NINE_AM, durationSeconds: 80 * 60, category: 'writing' }),
    makeBlock({ label: 'MLPipeline_Week2.ipynb', start: NINE_AM + 90 * 60_000, durationSeconds: 60 * 60, category: 'development' }),
  ]))
  for (const activity of facts.workActivities) {
    assert.ok(!looksLikeRawArtifactLabel(activity.name), `leaked raw label: ${activity.name}`)
    assert.ok(!/_/.test(activity.name), `underscore leaked: ${activity.name}`)
    assert.ok(!/\.(docx|ipynb)$/i.test(activity.name), `extension leaked: ${activity.name}`)
  }
})

test('the standout is the single longest work stretch and never exceeds the headline', () => {
  const facts = buildDayWrapFacts(makeDayPayload([
    makeBlock({ label: 'Short sync', start: NINE_AM, durationSeconds: 30 * 60, category: 'meetings' }),
    makeBlock({ label: 'Deep build', start: NINE_AM + 40 * 60_000, durationSeconds: 134 * 60, category: 'development' }),
  ]))
  assert.ok(facts.standout, 'expected a standout')
  assert.equal(facts.standout!.seconds, 134 * 60)
  assert.ok(facts.standout!.seconds <= facts.activeSeconds)
})

test('no standout when nothing clears the bar', () => {
  const facts = buildDayWrapFacts(makeDayPayload([
    makeBlock({ label: 'Email triage', start: NINE_AM, durationSeconds: 12 * 60, category: 'email' }),
    makeBlock({ label: 'Quick fix', start: NINE_AM + 20 * 60_000, durationSeconds: 18 * 60, category: 'development' }),
  ]))
  assert.equal(facts.standout, null)
})

test('a leisure-heavy day is flagged as a rest day', () => {
  const facts = buildDayWrapFacts(makeDayPayload([
    makeBlock({ label: 'Watching', start: NINE_AM, durationSeconds: 120 * 60, category: 'entertainment' }),
    makeBlock({ label: 'Quick patch', start: NINE_AM + 130 * 60_000, durationSeconds: 20 * 60, category: 'development' }),
  ]))
  assert.equal(facts.isLeisureDay, true)
  assert.ok(facts.leisureSeconds >= facts.workSeconds)
})

test('framing labels are human and dated', () => {
  const facts = buildDayWrapFacts(makeDayPayload([
    makeBlock({ label: 'Auth refactor', start: NINE_AM, durationSeconds: 90 * 60, category: 'development' }),
  ]))
  assert.equal(facts.weekday, 'TUESDAY')
  assert.equal(facts.dateLabel, 'JUN 23')
})
