// node:test driver for the AI regression harness. Each corpus entry becomes
// one subtest so pass/fail shows up per-entry in TAP output. Writes a
// last-run summary at the end for diff reporting.
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCorpus, runAll, writeResults, readPreviousResults, diffSummaries } from './runner'

test('AI regression harness', async (t) => {
  const entries = loadCorpus()
  await t.test(`corpus has at least 60 entries (found ${entries.length})`, () => {
    assert.ok(entries.length >= 60, `expected >= 60 corpus entries, got ${entries.length}`)
  })

  const summary = await runAll()

  for (const result of summary.results) {
    await t.test(result.id, () => {
      assert.deepEqual(result.failures, [], `failures: ${result.failures.join(' | ')}`)
    })
  }

  await t.test('summary', () => {
    const previous = readPreviousResults()
    const diff = diffSummaries(previous, summary)
    if (diff.length > 0) {
      console.log('\n— diff vs previous run —')
      for (const line of diff) console.log('  ' + line)
    }
    writeResults(summary)
    console.log(
      `\nai:bench summary: ${summary.passed}/${summary.total} passed`
      + ` (live ran ${summary.liveRan}, live failed ${summary.liveFailed})`,
    )
    const skippedLive = summary.results
      .filter((result) => !result.live.ran && result.live.reason !== 'router-only entry')
      .map((result) => `${result.id}: ${result.live.reason}`)
    if (skippedLive.length > 0) {
      console.log(`ai:bench live skipped: ${skippedLive.join('; ')}`)
    }
    assert.equal(summary.failed, 0, `${summary.failed} entries failed`)
  })
})
