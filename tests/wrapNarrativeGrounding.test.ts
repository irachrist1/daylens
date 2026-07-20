// The fact-table backstop: every numeric token in a model-written wrap line
// must ground in the wrap fact table or in a number the writer was actually
// shown. This is the runtime wiring of the fact table under the per-kind
// guards — the check that kills a bare invented integer ("opened it 14
// times") the older guards never policed — plus the read-time reconciliation
// that re-grounds a STORED narrative when the day's facts move under it.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDayFactTable,
  buildPeriodFactTable,
  firstUngroundedNumericToken,
  groundingFormsForRuntime,
} from '../src/main/lib/wrapFactTable.ts'
import {
  reconcileStoredNarrative,
  validateWrappedNarrativeObject,
} from '../src/main/lib/wrappedNarrative.ts'
import { planDayWrapSlides } from '../src/renderer/lib/wrapDeck.ts'
import { buildDayWrapFacts, type DayWrapFacts } from '../src/renderer/lib/dayWrapScenes.ts'
import { DEFAULT_TIMELINE_BLOCK_REVIEW } from '../src/shared/timelineReview.ts'
import type {
  AIWrappedNarrative,
  AppCategory,
  DayEnrichment,
  DayTimelinePayload,
  WorkContextBlock,
  WrappedPeriodFacts,
} from '../src/shared/types.ts'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeBlock(opts: {
  label: string
  start: number
  durationSeconds: number
  category?: AppCategory
  appName?: string
}): WorkContextBlock {
  const category: AppCategory = opts.category ?? 'development'
  const appName = opts.appName ?? 'Cursor'
  return {
    id: `b:${opts.label}:${opts.start}`,
    startTime: opts.start,
    endTime: opts.start + opts.durationSeconds * 1000,
    dominantCategory: category,
    categoryDistribution: { [category]: opts.durationSeconds },
    ruleBasedLabel: opts.label,
    aiLabel: null,
    sessions: [],
    topApps: [{ bundleId: appName.toLowerCase(), appName, category, totalSeconds: opts.durationSeconds, sessionCount: 1, isBrowser: false }],
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

function makeDayPayload(blocks: WorkContextBlock[], date = '2026-05-12'): DayTimelinePayload {
  const total = blocks.reduce((s, b) => s + Math.round((b.endTime - b.startTime) / 1000), 0)
  return {
    date,
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

const NINE_AM = new Date('2026-05-12T09:00:00').getTime()
const ONE_PM = new Date('2026-05-12T13:00:00').getTime()
const SIX_PM = new Date('2026-05-12T18:00:00').getTime()

function workingDayBlocks(): WorkContextBlock[] {
  return [
    makeBlock({ label: 'Auth refactor', start: NINE_AM, durationSeconds: 150 * 60, category: 'development', appName: 'Cursor' }),
    makeBlock({ label: 'Design review', start: ONE_PM, durationSeconds: 40 * 60, category: 'design', appName: 'Figma' }),
    makeBlock({ label: 'YouTube', start: SIX_PM, durationSeconds: 25 * 60, category: 'entertainment', appName: 'YouTube' }),
  ]
}

function workingDayFacts(): DayWrapFacts {
  return buildDayWrapFacts(makeDayPayload(workingDayBlocks()))
}

/** A response with one line per asked slide id — every line numberless so the
 *  base response is always valid, then individual pieces are overridden. */
function deckObject(facts: DayWrapFacts, over: { lines?: Record<string, string>; question?: string; reflection?: string } = {}): Record<string, unknown> {
  const lines: Record<string, string> = {}
  for (const spec of planDayWrapSlides(facts)) {
    if (!spec.ask) continue
    lines[spec.id] = spec.id === 'opening'
      ? 'A steady one, mostly heads-down on the auth work.'
      : 'A steady, honest stretch of the day, plainly told.'
  }
  return {
    lines: { ...lines, ...(over.lines ?? {}) },
    question: over.question ?? 'What pulled you into the design review after lunch?',
    reflection: over.reflection ?? 'You went into the code early and stayed there most of the morning. The afternoon turned to the design review, and a little of the evening went to unwinding. It reads like a day that knew what it was for.',
  }
}

const ENRICHMENT: DayEnrichment = {
  shipped: {
    commitsByProject: [{ project: 'the billing service', commits: 9 }],
    highlights: ['tightened the invoice flow'],
    pullRequests: [{ project: 'the billing service', state: 'merged', count: 2 }],
  },
  meetings: null,
  focusSessions: null,
  meetingNotes: null,
}

// ─── Fact table contents ──────────────────────────────────────────────────────

test('day fact table carries enrichment counts and the two-way split percentages', () => {
  const facts = workingDayFacts()
  const table = buildDayFactTable(facts, workingDayBlocks(), facts.date, ENRICHMENT)

  const ids = Object.keys(table.facts)
  assert.ok(ids.includes('shipped.commits.total.count'), `commit count fact missing: ${ids.join(', ')}`)
  assert.equal(table.facts['shipped.commits.total.count'].value, 9)
  assert.ok(table.facts['shipped.commits.total.count'].groundableForms.includes('nine'),
    'small counts ground their spelled-out word form')
  assert.ok(ids.includes('shipped.prs.total.count'))
  assert.ok(ids.includes('split.workVsLeisure.work.percent'), 'the split slide two-way ratio is a fact')
  assert.ok(ids.includes('day.firstActivity'), 'the literal first-activity clock is a fact')
})

test('period fact table carries active-day count, average, and previous-period delta', () => {
  const period: WrappedPeriodFacts = {
    period: 'week',
    anchorDate: '2026-05-12',
    rangeLabel: 'May 6 – May 12',
    totalSeconds: 10 * 3600,
    workSeconds: 7 * 3600,
    leisureSeconds: 2 * 3600,
    personalSeconds: 1 * 3600,
    previousPeriodSeconds: 8 * 3600,
    daysWithActivity: 4,
    dominantWorkCategory: 'development',
    dominantWorkCategoryPct: 70,
    categories: [],
    topApps: [],
    threads: [],
    leisureSurfaces: [],
    busiestDay: null,
    quietestActiveDay: null,
    longestStretch: null,
    buckets: [],
    busiestBucket: null,
    days: [],
    meetingsSeconds: 0,
    dayEdges: [],
  }
  const table = buildPeriodFactTable(period)
  assert.equal(table.facts['days.active.count']?.value, 4)
  assert.ok(table.facts['day.average.duration'], 'per-active-day average is a fact')
  assert.ok(table.facts['previousPeriod.delta.duration'], 'the compare delta is a fact')
  assert.ok(table.facts['split.workVsLeisure.work.percent'], 'two-way split ratio is a fact')
})

// ─── Grounding forms and the token check ──────────────────────────────────────

test('groundingFormsForRuntime unions table forms with substrate tokens and unit digits', () => {
  const facts = workingDayFacts()
  const table = buildDayFactTable(facts, workingDayBlocks(), facts.date, null)
  const forms = groundingFormsForRuntime(table, 'the stretch ran 2h 30m, the review 40m')

  assert.ok(forms.has('2h 30m'))
  assert.ok(forms.has('2h30m'), 'spacing variants are the same claim')
  assert.ok(forms.has('40m'))
  assert.ok(forms.has('40'), 'a real 40m fact makes "a 40-minute review" honest')
  assert.equal(firstUngroundedNumericToken('a 40-minute review and 2h30m of code', forms), null)

  const invented = firstUngroundedNumericToken('you opened it 14 times', forms)
  assert.ok(invented, 'an invented bare integer is ungrounded')
  assert.equal(invented?.raw, '14')
})

test('"1:1" reads as prose, never as an ungrounded numeric claim', () => {
  assert.equal(firstUngroundedNumericToken('the 1:1 with Sam sat at midday', new Set()), null)
})

// ─── Validation through the deck guards ───────────────────────────────────────

test('a line with an invented bare integer dies to the fact-table backstop', () => {
  const facts = workingDayFacts()
  const table = buildDayFactTable(facts, workingDayBlocks(), facts.date, null)
  const obj = deckObject(facts, {
    lines: { headline: 'You bounced between windows 14 times before the code took hold.' },
  })
  const { narrative, rejections } = validateWrappedNarrativeObject(obj, facts, 'hash', null, table)
  assert.ok(narrative, 'the deck survives; only the bad line dies')
  assert.equal(narrative?.lines.headline, null)
  const rejection = rejections.find((r) => r.id === 'headline')
  assert.ok(rejection, 'the headline rejection is recorded for the repair round')
  assert.match(rejection?.reason ?? '', /fact table/)
})

test('a line quoting a real enrichment count survives the backstop', () => {
  const facts = workingDayFacts()
  const table = buildDayFactTable(facts, workingDayBlocks(), facts.date, ENRICHMENT)
  const obj = deckObject(facts, {
    lines: { headline: 'The code carried the morning, and nine commits to the billing service came out of it.' },
  })
  const { narrative } = validateWrappedNarrativeObject(obj, facts, 'hash', ENRICHMENT, table)
  assert.ok(narrative)
  assert.ok(narrative?.lines.headline, 'a real, grounded count is allowed')
})

test('without a fact table the backstop is off and older callers are unchanged', () => {
  const facts = workingDayFacts()
  const obj = deckObject(facts, {
    lines: { headline: 'You bounced between windows 14 times before the code took hold.' },
  })
  const { narrative } = validateWrappedNarrativeObject(obj, facts, 'hash', null)
  assert.equal(typeof narrative?.lines.headline, 'string', 'no table supplied, no backstop applied')
})

// ─── Read-time reconciliation of a stored narrative ───────────────────────────

test('reconcile keeps grounded stored lines and drops ones the current facts no longer support', () => {
  const facts = workingDayFacts()
  const stored: AIWrappedNarrative = {
    lead: 'A steady one, mostly heads-down on the auth work.',
    lines: {
      opening: 'A steady one, mostly heads-down on the auth work.',
      // A clock claim from the OLD facts: this day's headline facts hold
      // 9am-ish clocks, never 6:45am, so the line cannot stand on the card.
      headline: 'The day found its shape early, going by 6:45am.',
    },
    question: 'What pulled you into the design review after lunch?',
    reflection: 'A morning of code, an afternoon of design, a small evening off the clock. Plainly a day that knew its own shape, and it read that way from the first hour to the last one. Nothing about it needed dressing up.',
    source: 'ai',
    factsHash: 'old-hash',
  }
  const reconciled = reconcileStoredNarrative(stored, facts, 'new-hash')
  assert.ok(reconciled, 'the stored wrap survives because its lead still grounds')
  assert.equal(reconciled?.lead, stored.lead)
  assert.equal(reconciled?.lines.headline, null, 'the stale clock claim cannot render')
  assert.equal(reconciled?.factsHash, 'new-hash')
})

test('reconcile returns null when the stored lead itself no longer grounds', () => {
  const facts = workingDayFacts()
  const stored: AIWrappedNarrative = {
    lead: 'Up before dawn: the day was rolling by 4:30am.',
    lines: { opening: 'Up before dawn: the day was rolling by 4:30am.' },
    question: null,
    reflection: null,
    source: 'ai',
    factsHash: 'old-hash',
  }
  assert.equal(reconcileStoredNarrative(stored, facts, 'new-hash'), null)
})

test('reconcile never resurrects a deterministic fallback as AI prose', () => {
  const facts = workingDayFacts()
  const stored: AIWrappedNarrative = {
    lead: 'Not much tracked yet. Come back once the day has more in it.',
    lines: {},
    question: null,
    reflection: null,
    source: 'fallback',
    factsHash: 'old-hash',
  }
  assert.equal(reconcileStoredNarrative(stored, facts, 'new-hash'), null)
})
