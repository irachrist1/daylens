// Standalone benchmark runner used to drive the recursive improvement loop
// (Stage 1.3). Unlike the .test.ts gate, it does NOT throw on failure — it
// generates, scores, logs, and prints a report so a failing slide can be
// diagnosed and the prompt retuned, then re-run.
//
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
//     --loader ./tests/support/ts-loader-real.mjs ./tests/wrapped-bench/run.ts [day|week|month|year] [date...]
//
// Defaults to the day fixtures. Pass specific dates to iterate one slide/day.
// Every deck also gets the WHOLE-DECK judgment (repetition / arc /
// contradiction / emoji budget) — the same gate the .test.ts suite enforces.

import {
  setupBench, generateDayDeck, generatePeriodDeck, scoreDeck,
  appendLog, formatDeckLog, writeResults, type DeckResult,
} from './harness'
import { formatDeckJudge } from './deckJudge'
// One fixture list, shared with the gating test — see fixtures.ts for why the
// set spans rich, thin, boring, and floor day shapes (and all three period
// cadences).
import { DAY_FIXTURES, PERIOD_FIXTURES } from './fixtures'

function color(c: 'green' | 'red' | 'yellow' | 'dim' | 'bold', s: string): string {
  const codes = { green: 32, red: 31, yellow: 33, dim: 2, bold: 1 } as const
  return process.stdout.isTTY ? `\x1b[${codes[c]}m${s}\x1b[0m` : s
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const cadence = (args[0] === 'week' || args[0] === 'month' || args[0] === 'year' || args[0] === 'day') ? args[0] : 'day'
  const explicitDates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))
  const keys = explicitDates.length
    ? explicitDates
    : cadence === 'day'
      ? DAY_FIXTURES.map((f) => f.date)
      : PERIOD_FIXTURES.filter((f) => f.period === cadence).map((f) => f.anchorDate)

  const changeNote = process.env.WRAPPED_BENCH_NOTE ?? ''
  const ctx = await setupBench()
  appendLog(`\n\n## Runner ${new Date().toISOString()} (${cadence})\n`)

  const results: DeckResult[] = []
  try {
    for (const key of keys) {
      process.stdout.write(color('dim', `\n[gen] ${cadence} ${key} …\n`))
      if (cadence === 'day') {
        const deck = await generateDayDeck(key)
        // A floor day's correct output is the honest deterministic fallback with
        // zero provider spend — assert that, don't judge deterministic copy.
        if (deck.facts.quality === 'empty' || deck.facts.quality === 'tooEarly') {
          const ok = deck.source === 'fallback'
          console.log(ok
            ? color('green', `[${key}] floor day (quality=${deck.facts.quality}) returned the honest fallback — correct`)
            : color('red', `[${key}] floor day (quality=${deck.facts.quality}) produced AI content — the quality gate is broken`))
          if (!ok) process.exitCode = 1
          continue
        }
        if (deck.source === 'fallback') {
          console.log(color('red', `[${key}] WHOLE DECK FELL BACK (source=fallback) — provider/generation failed`))
        }
        const result = await scoreDeck(ctx.anthropic, cadence, key, deck)
        results.push(result)
        appendLog(formatDeckLog(`${cadence} ${key}`, result, changeNote))
        printDeck(result)
        continue
      }
      const deck = await generatePeriodDeck(cadence, key)
      if (deck.source === 'fallback') {
        console.log(color('red', `[${key}] WHOLE DECK FELL BACK (source=fallback) — provider/generation failed`))
      }
      const result = await scoreDeck(ctx.anthropic, cadence, key, deck)
      results.push(result)
      appendLog(formatDeckLog(`${cadence} ${key}`, result, changeNote))
      printDeck(result)
    }
  } finally {
    if (results.length) writeResults(results)
    ctx.cleanup()
  }

  const allPass = results.every((r) => r.passed)
  console.log('\n' + color('bold', '=== SUMMARY ==='))
  for (const r of results) {
    console.log(`${r.passed ? color('green', 'PASS') : color('red', 'FAIL')}  ${r.cadence} ${r.key}  avg=${r.deckAverage}  failing=[${r.needsWork.filter((s) => !s.passed).map((s) => s.id).join(', ')}]`)
    if (!r.deckJudge.passed) console.log(color('red', `      deck judge: ${formatDeckJudge(r.deckJudge)}`))
  }
  process.exit(allPass && process.exitCode !== 1 ? 0 : 1)
}

function printDeck(r: DeckResult): void {
  console.log('\n' + color('bold', `${r.cadence} ${r.key}`) + `  deck avg (prose) = ${r.deckAverage >= 9 ? color('green', String(r.deckAverage)) : color('yellow', String(r.deckAverage))}`)
  for (const s of r.slides) {
    const tag = s.passed ? color('green', 'ok ') : color('red', 'BAD')
    const src = s.source === 'fallback' ? color('red', 'FALLBACK') : color('dim', 'ai')
    console.log(`  ${tag} ${s.id.padEnd(16)} ${String(s.score.total).padStart(2)}/10 [${s.score.specificity}/${s.score.tone}/${s.score.accuracy}/${s.score.motion}] ${src}  ${color('dim', truncate(s.line, 80))}`)
    if (!s.passed) console.log(color('dim', `        ↳ ${s.score.reasoning}`))
  }
  const judgeLine = formatDeckJudge(r.deckJudge)
  console.log(`  ${r.deckJudge.passed ? color('green', 'deck') : color('red', 'DECK')} ${color(r.deckJudge.passed ? 'dim' : 'red', judgeLine)}`)
}

function truncate(s: string, n: number): string { return s.length <= n ? s : s.slice(0, n - 1) + '…' }

main().catch((e) => { console.error(e); process.exit(2) })
