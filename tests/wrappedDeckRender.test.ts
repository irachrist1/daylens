import test from 'node:test'
import assert from 'node:assert/strict'

// Renderer-level guards for the deck-era Wrapped, rendered for real through
// react-dom/server against a stubbed window.daylens bridge:
//   1. First open shows the cinematic "Generating your wrap" screen — the old
//      build rendered a broken bare shell with no loading signal.
//   2. The deck renders real slides from real facts (progress segments, the
//      opening line, ask affordance) — not placeholders.
//
// SSR renders the initial state only (no effects), which is exactly the
// first-paint the loading bug lived in.

// The window bridge must exist BEFORE the renderer modules load (lib/ipc reads
// window.daylens at import time), so every import below is dynamic.
const windowStub = {
  daylens: {
    ai: {
      getWrapProviderState: async () => ({ connected: true, provider: 'Anthropic Claude' }),
      getWrappedNarrative: async () => null,
      getWrappedPeriodWrap: async () => null,
      askWrapped: async () => ({ answer: 'A real answer.', error: null }),
    },
  },
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
}
;(globalThis as Record<string, unknown>).window = windowStub

const { renderToStaticMarkup } = await import('react-dom/server')
const { createElement } = await import('react')
const { default: DayWrapped } = await import('../src/renderer/components/DayWrapped.tsx')
const { default: WrapDeck } = await import('../src/renderer/components/wrap/WrapDeck.tsx')
const { buildDayWrapFacts } = await import('../src/renderer/lib/dayWrapScenes.ts')
const { planDayWrapSlides, dayWrapDeckMeta } = await import('../src/renderer/lib/wrapDeck.ts')
const { DEFAULT_TIMELINE_BLOCK_REVIEW } = await import('../src/shared/timelineReview.ts')

import type { AppCategory, DayTimelinePayload, WorkContextBlock } from '../src/shared/types.ts'

function makeBlock(opts: { label: string; start: number; durationSeconds: number; category?: AppCategory; appName?: string }): WorkContextBlock {
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
    label: { current: opts.label, source: 'rule', confidence: 0.92, narrative: null, ruleBased: opts.label, aiSuggested: null, override: null },
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

// A finished past day (never threshold-gated), with real work in it.
const PAST_DATE = '2026-05-12'
const at = (time: string) => new Date(`${PAST_DATE}T${time}:00`).getTime()

function pastDayPayload(): DayTimelinePayload {
  const blocks = [
    makeBlock({ label: 'Auth refactor', start: at('09:00'), durationSeconds: 150 * 60 }),
    makeBlock({ label: 'Design review', start: at('13:00'), durationSeconds: 60 * 60, category: 'design', appName: 'Figma' }),
  ]
  const total = blocks.reduce((s, b) => s + Math.round((b.endTime - b.startTime) / 1000), 0)
  return {
    date: PAST_DATE, sessions: [], websites: [], blocks, segments: [], focusSessions: [],
    computedAt: Date.now(), version: 'test', totalSeconds: total, focusSeconds: total, focusPct: 100, appCount: 0, siteCount: 0,
  }
}

test('first open: the generating screen shows while the wrap is assembled', () => {
  const html = renderToStaticMarkup(createElement(DayWrapped, {
    data: pastDayPayload(),
    onClose: () => {},
    onOpenReport: () => {},
  }))
  assert.match(html, /wrap-generating/, 'expected the generating screen testid on first paint')
  assert.match(html, /Generating your wrap/, 'expected the generating headline')
  assert.doesNotMatch(html, /tap for the story/, 'the deck must not render before the narrative is ready')
})

test('deck: slides render with real data — opening line, progress segments, ask affordance', () => {
  const facts = buildDayWrapFacts(pastDayPayload())
  const slides = planDayWrapSlides(facts)
  const html = renderToStaticMarkup(createElement(WrapDeck, {
    slides,
    meta: dayWrapDeckMeta(facts),
    narrative: {
      lines: { opening: 'A morning that went straight into the code.' },
      question: 'What broke the long stretch at 11:30?',
      reflection: 'A steady day.',
    },
    seed: facts.seed,
    exportStem: `daylens-${facts.date}`,
    onClose: () => {},
    ask: async () => ({ answer: 'ok', error: null }),
  }))

  // The opening slide leads with the AI's line.
  assert.match(html, /A morning that went straight into the code\./)
  // One progress segment per slide.
  const segments = html.match(/height:3px/g) ?? []
  assert.equal(segments.length, slides.length, `expected ${slides.length} progress segments, got ${segments.length}`)
  // Interactivity is discoverable on every slide.
  assert.match(html, /Ask about this/)
  assert.match(html, /Save slide/)
})

test('deck: a slide without an AI line renders its deterministic fallback, never blank', () => {
  const facts = buildDayWrapFacts(pastDayPayload())
  const slides = planDayWrapSlides(facts)
  const opening = slides[0]
  const html = renderToStaticMarkup(createElement(WrapDeck, {
    slides,
    meta: dayWrapDeckMeta(facts),
    narrative: { lines: {}, question: null, reflection: null },
    seed: facts.seed,
    exportStem: `daylens-${facts.date}`,
    onClose: () => {},
    ask: async () => ({ answer: null, error: 'no provider' }),
  }))
  assert.ok(html.includes(opening.fallbackLine), 'expected the deterministic opening fallback')
})
