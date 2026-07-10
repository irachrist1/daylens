// tests/wrappedBenchmark.test.ts — the ground truth for whether Wrapped content
// is good enough to ship (Stage 1.2). Runs against the REAL provider and the REAL
// database, never mocks. The fixture days (tests/wrapped-bench/fixtures.ts, one
// list shared with the runner) deliberately span day SHAPES — rich, thin, boring,
// low-variety, and near-empty — because a wrap that only passes on good days is
// the failure mode this suite exists to catch ("wrapped yes or no.md").
//
// Thresholds (fail the suite if not met):
//   - every slide (prose and caption) scores >= 7 and shipped an AI line
//   - the deck average over prose slides is >= 9
//   - NO line trips the deterministic honesty check (raw technical text,
//     attendance/idle/speculation overclaims) — automatic fail regardless of score
//   - a floor-shaped day (empty / tooEarly) must return the honest deterministic
//     fallback WITHOUT spending a provider call
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
import { DAY_FIXTURES } from './wrapped-bench/fixtures'

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

for (const fixture of DAY_FIXTURES) {
  test(`day wrap ${fixture.date} (${fixture.shape}) clears the rubric`, { timeout: 300_000 }, async () => {
    assert.ok(ctx, 'bench context not initialized')
    const deck = await generateDayDeck(fixture.date)

    // A near-empty day's ONLY correct output is the honest deterministic floor,
    // produced without a provider call. Nothing to judge; inventing a deck here
    // would itself be the failure.
    if (deck.facts.quality === 'empty' || deck.facts.quality === 'tooEarly') {
      assert.equal(fixture.shape, 'floor', `${fixture.date} is quality=${deck.facts.quality} but the fixture list expected shape=${fixture.shape} — the day's data changed; refresh fixtures.ts`)
      assert.equal(deck.source, 'fallback', `a ${deck.facts.quality} day must return the deterministic floor, never AI content`)
      assert.equal(Object.values(deck.lines).filter(Boolean).length, 0, 'a floor day must not carry AI slide lines')
      return
    }
    assert.notEqual(fixture.shape, 'floor', `${fixture.date} was expected to be a floor day but produced quality=${deck.facts.quality} — refresh fixtures.ts`)
    assert.notEqual(deck.source, 'fallback', `whole deck fell back for ${fixture.date} — provider/generation failed, not a content bug`)

    const result = await scoreDeck(ctx.anthropic, 'day', fixture.date, deck)
    allResults.push(result)
    appendLog(formatDeckLog(`day ${fixture.date} (${fixture.shape})`, result, ''))

    // Report EVERY failing slide in one shot, not just the first.
    const failures = result.slides
      .filter((s) => !s.passed)
      .map((s) => `  - ${s.id} [${s.source}] scored ${s.score.total}/10 (spec ${s.score.specificity}, tone ${s.score.tone}, acc ${s.score.accuracy}, mot ${s.score.motion}): "${s.line}" — ${s.score.reasoning}`)

    const problems: string[] = []
    if (failures.length) problems.push(`slides below 7, fell back, or tripped the deterministic honesty check:\n${failures.join('\n')}`)
    if (result.deckAverage < 9) problems.push(`deck average ${result.deckAverage} < 9`)

    assert.equal(problems.length, 0, `\n${fixture.date} (${fixture.shape}: ${fixture.note}) did not clear the bar:\n${problems.join('\n')}\n`)
  })
}
