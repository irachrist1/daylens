#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const stages = [
  {
    id: 'tracking-foundation',
    prompt: `
Audit only Windows tracking paths in this Daylens repo. Read tracking.ts Windows branches,
windowsFocusCapture.ts, windowsBrowserRegistry.ts, windowsHistory.ts, browser.ts Windows
history paths, and db/queries.ts reconciliation. Do not edit. Find Windows-only bugs that
could create phantom sessions, incognito/private leakage, site time exceeding browser time,
or UWP identity/category problems. If nothing is found, say so clearly with evidence.
`.trim(),
  },
  {
    id: 'updater-windows',
    prompt: `
Audit only the Windows auto-updater and release/signing path in this Daylens repo:
src/main/services/updater.ts, electron-builder.config.js, .github/workflows/release-windows.yml,
and Windows signing docs. Do not edit. Find whether unsigned Windows updates can ship or
install, whether update metadata/artifacts are verified, and what tests or policy gates are
missing. If nothing is found, say so clearly with evidence.
`.trim(),
  },
  {
    id: 'test-parity',
    prompt: `
Audit tests for Windows parity in this Daylens repo. Do not edit. Identify macOS-only
coverage around sleep gaps, private/incognito blocking, browser/site reconciliation, and
browser discovery that lacks Windows-equivalent tests. Recommend focused regression tests.
If coverage is already adequate, say so clearly with test names.
`.trim(),
  },
]

function runCodex(stage) {
  const args = ['exec', '-s', 'read-only', stage.prompt]
  const result = spawnSync('codex', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WORKFLOW_STAGE: stage.id,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    stage: stage.id,
    status: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  }
}

function main() {
  const requested = process.argv.slice(2)
  const selected = requested.length > 0
    ? stages.filter((stage) => requested.includes(stage.id))
    : stages

  if (selected.length === 0) {
    console.error(`No matching stages. Known stages: ${stages.map((stage) => stage.id).join(', ')}`)
    process.exit(1)
  }

  const results = selected.map(runCodex)
  for (const result of results) {
    console.log(`\n## ${result.stage}`)
    if (result.stdout) console.log(result.stdout)
    if (result.stderr) console.error(result.stderr)
    if (result.status !== 0) process.exitCode = result.status
  }
}

main()
