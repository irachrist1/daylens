// One-shot reporter for the tracking-fidelity eval. Walks every fixture,
// materialises the day timeline payload, and prints each block with its
// sessions, duration, app diversity, and final user-visible label. This is
// diagnostic-only output — not a test — and is safe to run as a node:test
// subtest so it lives inside the existing harness.
//
// Goal: identify fixtures where (a) blocks span obvious context switches,
// (b) blocks fragment across trivial app switches, or (c) the visible label
// reads as a raw app/domain name rather than work intent.
import test from 'node:test'
import { FIXTURES, setupFixture } from '../ai-bench/fixtures'
import { getTimelineDayPayload, userVisibleLabelForBlock } from '../../src/main/services/workBlocks'

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDur(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remainder = mins % 60
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

test('tracking-eval: dump every fixture\'s block shape and label', () => {
  for (const name of Object.keys(FIXTURES)) {
    const { db, today } = setupFixture(name)
    const payload = getTimelineDayPayload(db, localDateString(today), null)
    console.log(`\n─── fixture ${name} ───`)
    console.log(`  totalSeconds=${payload.totalSeconds} blocks=${payload.blocks.length}`)
    for (const block of payload.blocks) {
      const dur = (block.endTime - block.startTime) / 1000
      const apps = [...new Set(block.sessions.map((session) => session.appName))]
      const titles = block.sessions
        .map((session) => session.windowTitle?.trim())
        .filter((title): title is string => Boolean(title))
      const uniqueTitles = [...new Set(titles)]
      const label = userVisibleLabelForBlock(block)
      console.log(
        `  • ${formatClock(block.startTime)}-${formatClock(block.endTime)} `
        + `(${formatDur(dur)}) label="${label}" `
        + `ruleLabel="${block.ruleBasedLabel}" dom=${block.dominantCategory} `
        + `apps=[${apps.join(' | ')}] titles=${uniqueTitles.length}`,
      )
      for (const title of uniqueTitles.slice(0, 3)) {
        console.log(`      └ "${title}"`)
      }
    }
    db.close()
  }
})
