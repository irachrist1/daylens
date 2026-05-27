import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const helperPath = path.resolve('build/capture-helper')
const cases = [
  'permission_denied',
  'permission_not_determined',
  'timeout',
  'missing_value',
  'unsupported_browser',
]

function runProbe(mode: string): Record<string, unknown> {
  assert.equal(process.platform, 'darwin')
  assert.ok(fs.existsSync(helperPath), `missing helper binary at ${helperPath}; run npm run build:capture-helper`)

  const result = spawnSync(helperPath, [], {
    env: {
      ...process.env,
      DAYLENS_CAPTURE_HELPER_NEVER_GUESS_PROBE: mode,
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  const lines = result.stdout.trim().split('\n').filter(Boolean)
  assert.equal(lines.length, 1, result.stdout)
  return JSON.parse(lines[0]) as Record<string, unknown>
}

test('capture helper emits unknown/null tab events for forced failure cases', { skip: process.platform !== 'darwin' }, async (t) => {
  for (const mode of cases) {
    await t.test(mode, () => {
      const event = runProbe(mode)

      assert.equal(event.event_type, 'tab_changed')
      assert.equal(event.source, 'apple_events_tab')
      assert.equal(event.confidence, 'unknown')
      assert.equal(event.url ?? null, null)
      assert.equal(event.page_title ?? null, null)
      assert.notEqual(event.url, 'https://stale.example.test/previous')
      assert.notEqual(event.page_title, 'Stale page title')
    })
  }
})
