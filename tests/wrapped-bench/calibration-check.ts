// Tiny calibration sanity check: does the anchored judge now SEPARATE a great
// line from a weak one for the same slide? Cheap (a handful of judge calls), no
// deck generation. Proves the "grades bad lines high" fix before spending on a
// full run.
//
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
//     --loader ./tests/support/ts-loader-real.mjs ./tests/wrapped-bench/calibration-check.ts

import { setupBench, judge } from './harness'
import { anchorsFor } from './anchors'

const WHOLE_DAY = JSON.stringify({
  date: '2026-06-24', weekday: 'TUESDAY', total: '6h 40m', dayBegan: '7:12am',
  split: { work: '5h 50m', leisure: '50m', mostlyRest: false },
  workedOn: [{ what: 'building the tracking engine', time: '4h 10m' }],
  longestStretch: { time: '2h 28m', on: 'tracking engine', from: '7:12am to 9:40am' },
})

const CASES: Array<{ slideId: string; label: string; line: string }> = [
  { slideId: 'opening', label: 'GREAT', line: 'A maker\'s morning that set the whole tone, then the day opened up after the design review. The tracking engine quietly won the day.' },
  { slideId: 'opening', label: 'WEAK', line: 'Today was a productive and focused day with lots of great work in Cursor.' },
  { slideId: 'headline', label: 'GREAT', line: 'Most of it stacked up before lunch, when the tracking engine took your two best hours in one sitting.' },
  { slideId: 'headline', label: 'WEAK', line: 'You tracked 6h 40m across the day.' },
]

async function main(): Promise<void> {
  const ctx = await setupBench()
  try {
    console.log('\n=== Judge calibration check (anchored, median-of-3) ===\n')
    for (const c of CASES) {
      const score = await judge(ctx.anthropic, {
        cadence: 'day', slideId: c.slideId, kicker: '', factsNote: WHOLE_DAY, wholeDayFacts: WHOLE_DAY,
        caption: false, line: c.line, role: 'line', anchors: anchorsFor('day', c.slideId),
      })
      console.log(`[${c.slideId} · ${c.label}] total=${score.total}  (spec ${score.specificity}/3, tone ${score.tone}/2, acc ${score.accuracy}/3, mot ${score.motion}/2)`)
      console.log(`   line: ${c.line}`)
      console.log(`   why:  ${score.reasoning}\n`)
    }
  } finally {
    ctx.cleanup()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
