import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { verifyRuntimeCapture } = require('../scripts/verify-runtime-capture.js') as {
  verifyRuntimeCapture: (
    report: Record<string, unknown>,
    statePath: string,
    fail: (message: string) => never,
  ) => Record<string, unknown>
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-runtime-smoke-'))
  const statePath = path.join(dir, 'window-state.json')
  fs.writeFileSync(
    statePath,
    JSON.stringify({
      foreground: { title: 'Runtime Capture Foreground', activated: true },
      fullscreen: { title: 'Runtime Capture Fullscreen', activated: true, fullscreen: true },
    }),
  )
  const report = {
    captureProbe: {
      required: true,
      foregroundTitle: 'Runtime Capture Foreground',
      fullscreenTitle: 'Runtime Capture Fullscreen',
      sessions: [
        {
          windowTitle: 'Runtime Capture Foreground',
          durationSec: 14,
          captureSource: 'foreground_poll',
        },
        {
          windowTitle: 'Runtime Capture Fullscreen',
          durationSec: 13,
          captureSource: 'foreground_poll',
        },
      ],
    },
  }
  const fail = (message: string): never => {
    throw new Error(message)
  }
  return { dir, statePath, report, fail }
}

test('packaged runtime verifier accepts persisted foreground and fullscreen production sessions', () => {
  const { dir, statePath, report, fail } = fixture()
  try {
    const result = verifyRuntimeCapture(report, statePath, fail)
    assert.equal(result.capturedSessions, 2)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('packaged runtime verifier fails clearly when fullscreen capture is absent', () => {
  const { dir, statePath, report, fail } = fixture()
  try {
    const captureProbe = report.captureProbe as { sessions: Array<{ windowTitle: string }> }
    captureProbe.sessions = captureProbe.sessions.filter(
      (session) => session.windowTitle !== 'Runtime Capture Fullscreen',
    )
    assert.throws(
      () => verifyRuntimeCapture(report, statePath, fail),
      /No persisted app session captured the fullscreen probe title/,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('packaged runtime verifier rejects a window that did not actually enter fullscreen', () => {
  const { dir, statePath, report, fail } = fixture()
  try {
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        foreground: { title: 'Runtime Capture Foreground', activated: true },
        fullscreen: { title: 'Runtime Capture Fullscreen', activated: true, fullscreen: false },
      }),
    )
    assert.throws(
      () => verifyRuntimeCapture(report, statePath, fail),
      /fullscreen probe window did not enter fullscreen/,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('macOS and Windows workflows run packaged capture probes', () => {
  const mac = fs.readFileSync(path.resolve('.github/workflows/verify-macos-runtime.yml'), 'utf8')
  const windows = fs.readFileSync(
    path.resolve('.github/workflows/verify-windows-runtime.yml'),
    'utf8',
  )

  assert.match(mac, /scripts\/run-macos-capture-smoke\.sh/)
  assert.match(mac, /scripts\/verify-macos-smoke\.js/)
  assert.match(windows, /scripts\/run-windows-capture-smoke\.ps1/)
  assert.match(windows, /scripts\/verify-windows-smoke\.js/)
  for (const workflow of [mac, windows]) {
    assert.match(workflow, /DAYLENS_SMOKE_EXPECT_FOREGROUND_TITLE/)
    assert.match(workflow, /DAYLENS_SMOKE_EXPECT_FULLSCREEN_TITLE/)
  }
})
