// The benchmark's fixture days — ONE list shared by the gating test
// (wrappedBenchmark.test.ts) and the improvement-loop runner (run.ts), so the
// two can never quietly diverge.
//
// The set deliberately spans day SHAPES, not just good days ("wrapped yes or
// no.md": measure distributions, include thin/boring/messy days, not best
// runs). Every date is a real day verified in the local DB copy. A wrap must
// hold the quality bar on a rich day AND stay honestly small on a thin one —
// passing only on well-instrumented days is the failure mode this list exists
// to catch.

export type WrapFixtureShape = 'full' | 'thin' | 'boring' | 'lowVariety' | 'floor'

export interface WrapBenchFixture {
  date: string
  shape: WrapFixtureShape
  /** Why this day is in the set — what it exercises. */
  note: string
}

export const DAY_FIXTURES: WrapBenchFixture[] = [
  // Rich days — every gated slide type in the catalog is covered across these.
  { date: '2026-07-07', shape: 'full', note: 'meetings, all daytime story beats, focus, split, late night, forgotten, wildcard, timesink, apps' },
  { date: '2026-07-04', shape: 'full', note: "pre-dawn 'last night's tail' (story-lateNight) beat" },
  { date: '2026-07-02', shape: 'full', note: 'early start + meetings' },
  // Honesty-shaped days — the wrap must stay truthfully small, not dress up.
  { date: '2026-06-12', shape: 'thin', note: '~23m tracked: a thin day must read honestly thin (partial-quality copy, no padding)' },
  { date: '2026-05-23', shape: 'boring', note: '~2h 33m across 2 apps: nothing interesting to inflate; the deck must not invent variety' },
  { date: '2026-05-10', shape: 'lowVariety', note: '~5h across 4 apps: long but monotone; superlatives must stay grounded' },
  // The floor — almost nothing tracked. The correct output is the deterministic
  // honest floor with ZERO provider spend; anything else is a failure.
  { date: '2026-04-06', shape: 'floor', note: '~1m tracked: must return the honest fallback without calling the provider' },
]

// ─── Period fixtures (week / month / year) ────────────────────────────────────
// All three period cadences are REQUIRED gate members. Week held the required
// live bar; month and year were implemented with no quality fixture at all —
// nothing would have caught a regression in either. One honest fixture each,
// anchored where the real DB verifiably has data (the day fixtures span
// April–July 2026).

export interface WrapPeriodFixture {
  period: 'week' | 'month' | 'year'
  anchorDate: string
  /** Why this period is in the set — what it exercises. */
  note: string
}

export const PERIOD_FIXTURES: WrapPeriodFixture[] = [
  { period: 'week', anchorDate: '2026-07-06', note: 'full recent closed week (Jun 30 – Jul 6): threads, day edges, meetings, compare' },
  { period: 'month', anchorDate: '2026-06-15', note: 'June 2026: a full closed month of real days; weekly buckets + bestbucket + thread-0…3' },
  { period: 'year', anchorDate: '2026-06-15', note: '2026 to date: the widest cadence; monthly buckets, long-range totals, superlatives must stay grounded' },
]
