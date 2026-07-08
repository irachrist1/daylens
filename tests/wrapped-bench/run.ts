// Standalone benchmark runner used to drive the recursive improvement loop
// (Stage 1.3). Unlike the .test.ts gate, it does NOT throw on failure — it
// generates, scores, logs, and prints a report so a failing slide can be
// diagnosed and the prompt retuned, then re-run.
//
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
//     --loader ./tests/support/ts-loader-real.mjs ./tests/wrapped-bench/run.ts [day|week] [date...]
//
// Defaults to the day fixtures. Pass specific dates to iterate one slide/day.

import {
  setupBench, generateDayDeck, generatePeriodDeck, scoreDeck,
  appendLog, formatDeckLog, writeResults, type DeckResult,
} from './harness'

const DAY_FIXTURES = ['2026-07-07', '2026-07-04', '2026-07-02']
const WEEK_FIXTURES = ['2026-07-06'] // anchor inside a full recent week

function color(c: 'green' | 'red' | 'yellow' | 'dim' | 'bold', s: string): string {
  const codes = { green: 32, red: 31, yellow: 33, dim: 2, bold: 1 } as const
  return process.stdout.isTTY ? `\x1b[${codes[c]}m${s}\x1b[0m` : s
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const cadence = (args[0] === 'week' || args[0] === 'day') ? args[0] : 'day'
  const explicitDates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))
  const keys = explicitDates.length ? explicitDates : (cadence === 'week' ? WEEK_FIXTURES : DAY_FIXTURES)

  const changeNote = process.env.WRAPPED_BENCH_NOTE ?? ''
  const ctx = await setupBench()
  appendLog(`\n\n## Runner ${new Date().toISOString()} (${cadence})\n`)

  const results: DeckResult[] = []
  try {
    for (const key of keys) {
      process.stdout.write(color('dim', `\n[gen] ${cadence} ${key} …\n`))
      const deck = cadence === 'week'
        ? await generatePeriodDeck('week', key)
        : await generateDayDeck(key)
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

  const allPass = results.every((r) => r.allSlidesPassed && r.deckAverage >= 9)
  console.log('\n' + color('bold', '=== SUMMARY ==='))
  for (const r of results) {
    const ok = r.allSlidesPassed && r.deckAverage >= 9
    console.log(`${ok ? color('green', 'PASS') : color('red', 'FAIL')}  ${r.cadence} ${r.key}  avg=${r.deckAverage}  failing=[${r.needsWork.filter((s) => !s.passed).map((s) => s.id).join(', ')}]`)
  }
  process.exit(allPass ? 0 : 1)
}

function printDeck(r: DeckResult): void {
  console.log('\n' + color('bold', `${r.cadence} ${r.key}`) + `  deck avg (prose) = ${r.deckAverage >= 9 ? color('green', String(r.deckAverage)) : color('yellow', String(r.deckAverage))}`)
  for (const s of r.slides) {
    const tag = s.passed ? color('green', 'ok ') : color('red', 'BAD')
    const src = s.source === 'fallback' ? color('red', 'FALLBACK') : color('dim', 'ai')
    console.log(`  ${tag} ${s.id.padEnd(16)} ${String(s.score.total).padStart(2)}/10 [${s.score.specificity}/${s.score.tone}/${s.score.accuracy}/${s.score.motion}] ${src}  ${color('dim', truncate(s.line, 80))}`)
    if (!s.passed) console.log(color('dim', `        ↳ ${s.score.reasoning}`))
  }
}

function truncate(s: string, n: number): string { return s.length <= n ? s : s.slice(0, n - 1) + '…' }

main().catch((e) => { console.error(e); process.exit(2) })
