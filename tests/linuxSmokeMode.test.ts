import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const MAIN_PROCESS_SOURCE = path.resolve(process.cwd(), 'src/main/index.ts')

test('linux smoke mode does not start remote sync or startup workload timers', () => {
  const source = fs.readFileSync(MAIN_PROCESS_SOURCE, 'utf8')

  assert.match(
    source,
    /if \(!SMOKE_TEST\) \{[\s\S]*?startSync\(\)[\s\S]*?startDailySummaryNotifier\(mainWindow\)[\s\S]*?startDistractionAlerter\(\)[\s\S]*?\}/,
    'smoke mode should not start remote sync, daily notification, or distraction timers',
  )
  assert.match(
    source,
    /if \(!SMOKE_TEST\) \{[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?finalizePreviousDay\(\)[\s\S]*?\}, 10_000\)[\s\S]*?\}/,
    'smoke mode should not run startup finalization, which can invoke remote sync',
  )
})
