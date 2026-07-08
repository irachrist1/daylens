import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')

test('billing sandbox exercises checkout, webhooks, metering, and desktop status', () => {
  const result = spawnSync(process.execPath, ['services/billing/sandbox/run.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_RUN_AS_NODE: '1',
    },
    timeout: 60_000,
  })

  const output = `${result.stdout}\n${result.stderr}`
  assert.equal(result.status, 0, output)
  assert.match(output, /PASS\s+3\. Polar subscription checkout returns a Polar URL/)
  assert.match(output, /PASS\s+4\. Polar subscription webhook sets plan to subscription/)
  assert.match(output, /PASS\s+6\. Flutterwave checkout returns a hosted payment URL/)
  assert.match(output, /PASS\s+7\. Flutterwave webhook grants a 30-day local pass/)
  assert.match(output, /PASS\s+9\. Removing all managed access pauses AI without breaking capture\/local views/)
})
