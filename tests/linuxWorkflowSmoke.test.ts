import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const WORKFLOWS = [
  '.github/workflows/verify-linux-runtime.yml',
  '.github/workflows/release-linux.yml',
]

test('linux smoke workflows launch Electron inside a DBus session', () => {
  for (const workflowPath of WORKFLOWS) {
    const source = fs.readFileSync(path.resolve(process.cwd(), workflowPath), 'utf8')
    assert.match(
      source,
      /timeout 90s dbus-run-session -- xvfb-run -a env[\s\S]*?DAYLENS_SMOKE_REPORT_PATH="\$RUNNER_TEMP\/daylens-appimage-smoke\.json"/,
      `${workflowPath} should run AppImage smoke under dbus-run-session`,
    )
    assert.match(
      source,
      /timeout 90s dbus-run-session -- xvfb-run -a env[\s\S]*?DAYLENS_SMOKE_REPORT_PATH="\$RUNNER_TEMP\/daylens-deb-smoke\.json"/,
      `${workflowPath} should run deb smoke under dbus-run-session`,
    )
    assert.match(
      source,
      /timeout 90s dbus-run-session -- "\$APP_PATH"[\s\S]*?DAYLENS_SMOKE_REPORT_PATH=\/smoke\/daylens-rpm-smoke\.json|DAYLENS_SMOKE_REPORT_PATH=\/smoke\/daylens-rpm-smoke\.json[\s\S]*?timeout 90s dbus-run-session -- "\$APP_PATH"/,
      `${workflowPath} should run rpm smoke under dbus-run-session`,
    )
  }
})
