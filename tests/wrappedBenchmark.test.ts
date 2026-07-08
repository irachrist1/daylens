// tests/wrappedBenchmark.test.ts — the ground truth for whether Wrapped content
// is good enough to ship (Stage 1.2). Runs against the REAL provider and the REAL
// database, never mocks. Each fixture is a real day whose facts exercise a set of
// catalog slides; the deck is generated through the production path and every
// AI-written line is scored against the rubric in docs/wrapped-slide-catalog.md.
//
// Thresholds (fail the suite if not met):
//   - every slide (prose and caption) scores >= 7 and shipped an AI line
//   - the deck average over prose slides is >= 9
//
// This is LIVE-ONLY: it needs the Anthropic key in keytar and hits the network,
// so it is excluded from the hermetic `npm test` suite and owns its own script:
//   npm run wrapped:bench
//
// Full per-slide scores and judge reasoning for every run land in
// docs/wrapped-benchmark-log.md.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  setupBench, generateDayDeck, scoreDeck, appendLog, formatDeckLog, writeResults,
  type BenchContext, type DeckResult,
} from './wrapped-bench/harness'

// Real fixture days (verified via tests/wrapped-bench/explore.ts). Together they
// cover every gated day-slide type in the catalog:
//   2026-07-07 — full day: meetings, all three daytime story beats, focus, split,
//                late night, forgotten, wildcard, time sink, apps.
//   2026-07-04 — has the pre-dawn "last night's tail" (story-lateNight) beat.
//   2026-07-02 — has an early start and meetings.
const DAY_FIXTURES = ['2026-07-07', '2026-07-04', '2026-07-02']

let ctx: BenchContext | null = null
const allResults: DeckResult[] = []

before(async () => {
  ctx = await setupBench()
  appendLog(`\n\n## Benchmark run ${new Date().toISOString()} (day cadence)\n`)
}, { timeout: 120_000 })

after(() => {
  if (allResults.length) writeResults(allResults)
  ctx?.cleanup()
})

for (const date of DAY_FIXTURES) {
  test(`day wrap ${date} clears the rubric`, { timeout: 300_000 }, async () => {
    assert.ok(ctx, 'bench context not initialized')
    const deck = await generateDayDeck(date)
    assert.notEqual(deck.source, 'fallback', `whole deck fell back for ${date} — provider/generation failed, not a content bug`)

    const result = await scoreDeck(ctx.anthropic, 'day', date, deck)
    allResults.push(result)
    appendLog(formatDeckLog(`day ${date}`, result, ''))

    // Report EVERY failing slide in one shot, not just the first.
    const failures = result.slides
      .filter((s) => !s.passed)
      .map((s) => `  - ${s.id} [${s.source}] scored ${s.score.total}/10 (spec ${s.score.specificity}, tone ${s.score.tone}, acc ${s.score.accuracy}, mot ${s.score.motion}): "${s.line}" — ${s.score.reasoning}`)

    const problems: string[] = []
    if (failures.length) problems.push(`slides below 7 or fell back:\n${failures.join('\n')}`)
    if (result.deckAverage < 9) problems.push(`deck average ${result.deckAverage} < 9`)

    assert.equal(problems.length, 0, `\n${date} did not clear the bar:\n${problems.join('\n')}\n`)
  })
}
