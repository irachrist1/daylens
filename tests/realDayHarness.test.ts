import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  assertIsolatedRealDayUserData,
  assertRealDayExternalAccessAllowed,
  isRealDayExternalAccessAllowed,
} from '../src/main/lib/realDayHarness'

function withHarnessEnv(run: () => void): void {
  const previousHarness = process.env.DAYLENS_REAL_DAY_HARNESS
  const previousModelNetwork = process.env.DAYLENS_REAL_DAY_ALLOW_MODEL_NETWORK
  process.env.DAYLENS_REAL_DAY_HARNESS = '1'
  delete process.env.DAYLENS_REAL_DAY_ALLOW_MODEL_NETWORK
  try {
    run()
  } finally {
    if (previousHarness === undefined) delete process.env.DAYLENS_REAL_DAY_HARNESS
    else process.env.DAYLENS_REAL_DAY_HARNESS = previousHarness
    if (previousModelNetwork === undefined) delete process.env.DAYLENS_REAL_DAY_ALLOW_MODEL_NETWORK
    else process.env.DAYLENS_REAL_DAY_ALLOW_MODEL_NETWORK = previousModelNetwork
  }
}

test('real-day harness requires an isolated profile outside the live profile', () => {
  withHarnessEnv(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-real-day-'))
    try {
      const live = path.join(root, 'live')
      const isolated = path.join(root, 'isolated')
      fs.mkdirSync(live)

      assert.equal(
        assertIsolatedRealDayUserData(isolated, live),
        path.join(fs.realpathSync.native(root), 'isolated'),
      )
      assert.throws(
        () => assertIsolatedRealDayUserData(undefined, live),
        /requires DAYLENS_DEV_USERDATA/,
      )
      assert.throws(() => assertIsolatedRealDayUserData(live, live), /must not overlap/)
      assert.throws(
        () => assertIsolatedRealDayUserData(path.join(live, 'copy'), live),
        /must not overlap/,
      )
      assert.throws(() => assertIsolatedRealDayUserData(root, live), /must not overlap/)

      const alias = path.join(root, 'live-alias')
      fs.symlinkSync(live, alias)
      assert.throws(() => assertIsolatedRealDayUserData(alias, live), /must not overlap/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

test('real-day harness blocks every external boundary by default', () => {
  withHarnessEnv(() => {
    for (const boundary of [
      'analytics',
      'billing',
      'credential-store',
      'icon',
      'intercom',
      'model-provider',
      'provider-validation',
      'updater',
    ] as const) {
      assert.equal(isRealDayExternalAccessAllowed(boundary), false)
      assert.throws(() => assertRealDayExternalAccessAllowed(boundary), new RegExp(boundary))
    }
  })
})

test('real-day model network opt-in opens only the model-provider boundary', () => {
  withHarnessEnv(() => {
    process.env.DAYLENS_REAL_DAY_ALLOW_MODEL_NETWORK = '1'
    assert.equal(isRealDayExternalAccessAllowed('model-provider'), true)
    assert.equal(isRealDayExternalAccessAllowed('analytics'), false)
    assert.equal(isRealDayExternalAccessAllowed('billing'), false)
  })
})
