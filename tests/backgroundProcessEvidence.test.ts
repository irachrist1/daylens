import test from 'node:test'
import assert from 'node:assert/strict'
import {
  __resetBackgroundProcessEvidenceForTests,
  getBackgroundProcessEvidence,
  isBackgroundProcessNoise,
  observeProcessSnapshots,
} from '../src/main/services/backgroundProcessEvidence.ts'

test('background process evidence ignores system noise and short runs', () => {
  __resetBackgroundProcessEvidenceForTests()
  const originalPlatform = process.platform
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })

  try {
    assert.equal(isBackgroundProcessNoise('svchost'), true)
    assert.equal(isBackgroundProcessNoise('node'), false)

    const start = Date.now()
    observeProcessSnapshots([
      { pid: 1, name: 'node', cpuPercent: 0, memoryMb: 512, capturedAt: start },
    ], start)
    observeProcessSnapshots([
      { pid: 1, name: 'node', cpuPercent: 0, memoryMb: 512, capturedAt: start + 2 * 60_000 },
    ], start + 2 * 60_000)

    const evidence = getBackgroundProcessEvidence(start, start + 2 * 60_000)
    assert.equal(evidence.length, 0)

    observeProcessSnapshots([
      { pid: 1, name: 'node', cpuPercent: 0, memoryMb: 512, capturedAt: start + 6 * 60_000 },
    ], start + 6 * 60_000)

    const longEvidence = getBackgroundProcessEvidence(start, start + 6 * 60_000)
    assert.equal(longEvidence.length, 1)
    assert.equal(longEvidence[0]?.name, 'node')
    assert.ok((longEvidence[0]?.totalSeconds ?? 0) >= 300)
  } finally {
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
    __resetBackgroundProcessEvidenceForTests()
  }
})
