// Screen-context experiment surface (DEV-198) — consent, pause, revoke,
// backlog/quarantine with explicit Retry/Delete, exclusion offers, and the
// full wipe, all over the DEV-197 lifecycle. What must hold:
//   - consent is explicit and separate: only the experiment's own enable path
//     sets it, only on supported platforms, only where core tracking already
//     works — enabling normal tracking never enables screen sampling;
//   - pause touches screen sampling only; core tracking settings are untouched;
//   - revoke closes the experiment and deletes every unprocessed frame;
//     the full opt-out additionally deletes every derived record;
//   - the backlog surface is honest and content-free: structural fields only,
//     never OCR text or titles;
//   - Retry and Delete on quarantined frames go through the lifecycle's
//     invariants (delete removes raw AND derived, and records honesty);
//   - accepting an exclusion offer deletes prior records for that source;
//   - status tells the truth about this build (no sampler installed).
import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { __resetSettings, __setSettings, getSettings } from '../src/main/services/settings'
import {
  deleteScreenContextFrame,
  deleteScreenContextForSource,
  enableScreenContextExperiment,
  getScreenContextStatus,
  listScreenContextBacklog,
  resetScreenContextExperimentForTests,
  retryScreenContextFrame,
  revokeScreenContextExperiment,
  screenContextEligibility,
  screenContextExclusionOffers,
  setScreenContextExperimentDeps,
  setScreenContextExperimentUnavailable,
  setScreenContextPaused,
  wipeScreenContext,
} from '../src/main/services/screenContext/experiment.ts'
import {
  commitExtractionResult,
  getFrameRecord,
  insertFrameRecord,
  listAllEvidence,
  listAllFrames,
  transitionFrameState,
} from '../src/main/services/screenContext/repository.ts'
import { recoverScreenContextOnStartup } from '../src/main/services/screenContext/experiment.ts'
import type { FrameFileStore, ScreenFrameExtractor } from '../src/main/services/screenContext/types.ts'
import type { ScreenContextMeasureEvent, ScreenContextMeasureProps } from '../src/main/services/screenContext/lifecycle.ts'
import type { AppSettings } from '../src/shared/types.ts'
import {
  SyncAllowlistViolation,
  assertSyncPayloadAllowed,
} from '../src/shared/syncAllowlist/index'
import { makeCleanRemoteSyncPayload } from './support/remoteSyncPayloadFixture'

// The settings stub exposes __setSettings/__resetSettings; the typed import
// above resolves to the stub under the hermetic loader.
const setStubSettings = __setSettings as unknown as (overrides: Partial<AppSettings>) => AppSettings
const resetStubSettings = __resetSettings as unknown as () => AppSettings

function memoryFrameStore(): FrameFileStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  let seq = 0
  return {
    files,
    write(_id, bytes) {
      const localPath = `/fake/exp/${seq += 1}.scframe`
      files.set(localPath, bytes)
      return { localPath, byteSize: bytes.byteLength }
    },
    read(localPath) {
      const bytes = files.get(localPath)
      if (!bytes) throw new Error('missing frame file')
      return bytes
    },
    delete(localPath) { files.delete(localPath) },
    list() { return [...files.keys()] },
  }
}

const okExtractor: ScreenFrameExtractor = {
  async extract() {
    return {
      docTitle: 'Budget worksheet',
      ocrSpans: ['row 12: totals'],
      subjectRefs: [],
      extractorModel: 'fixture',
      extractorSchemaVersion: 1,
      confidence: 1,
    }
  },
}

const failingExtractor: ScreenFrameExtractor = {
  async extract() { throw new Error('extractor exploded') },
}

interface Env {
  db: Database.Database
  store: ReturnType<typeof memoryFrameStore>
  measured: Array<{ event: ScreenContextMeasureEvent; props: ScreenContextMeasureProps }>
}

function setup(options: { extractor?: ScreenFrameExtractor; platform?: NodeJS.Platform } = {}): Env {
  resetStubSettings()
  resetScreenContextExperimentForTests()
  const db = createProductionTestDatabase()
  const store = memoryFrameStore()
  const measured: Env['measured'] = []
  setScreenContextExperimentDeps({
    frameStore: store,
    extractor: options.extractor ?? okExtractor,
    measure: (event, props) => measured.push({ event, props }),
    platform: options.platform ?? 'darwin',
    samplerInstalled: false,
  })
  return { db, store, measured }
}

/** Seed one raw frame directly through the repository (what a capture adapter
 *  would have produced), so surface tests do not need the OS sampler. */
function seedFrame(env: Env, appName = 'Numbers', bundleId = 'com.apple.Numbers') {
  const stored = env.store.write('seed', new TextEncoder().encode('pixels'))
  return insertFrameRecord(env.db, {
    capturedAt: Date.now(),
    trigger: 'diagnostic',
    appBundleId: bundleId,
    appName,
    displayId: 1,
    exclusionPolicyVersion: 1,
    localPath: stored.localPath,
    byteSize: stored.byteSize,
  })
}

// ─── Eligibility and consent ──────────────────────────────────────────────────

test('consent is explicit, platform-gated, and requires core tracking to already work', async () => {
  const env = setup({ platform: 'linux' })
  const linux = screenContextEligibility(getSettings() as AppSettings, 'linux')
  assert.equal(linux.eligible, false)
  assert.match(String(linux.reason), /macOS and Windows/)

  // Supported platform, but core tracking consent missing → not eligible.
  setStubSettings({ captureConsent: { status: 'unset', policyVersion: null, decidedAt: null } as AppSettings['captureConsent'] })
  const noTracking = screenContextEligibility(getSettings() as AppSettings, 'darwin')
  assert.equal(noTracking.eligible, false)
  assert.match(String(noTracking.reason), /tracking/i)

  env.db.close()
})

test('enable sets consent with a timestamp and measures it; enabling normal tracking never enables screen sampling', async () => {
  const env = setup()
  // Baseline: turning tracking things on does not touch the experiment flag.
  setStubSettings({ trackingControlsEnabled: true, trackingPaused: false })
  assert.notEqual((getSettings() as AppSettings).screenContextExperimentEnabled, true)

  const result = await enableScreenContextExperiment(env.db)
  assert.equal(result.ok, true)
  const settings = getSettings() as AppSettings
  assert.equal(settings.screenContextExperimentEnabled, true)
  assert.equal(settings.screenContextPaused, false)
  assert.equal(typeof settings.screenContextConsentAt, 'number')
  assert.ok(env.measured.some((m) => m.event === 'screen_context_consent' && m.props.action === 'enabled'))
  assert.equal(result.status.enabled, true)
  assert.equal(result.status.samplerInstalled, false, 'status is honest: no sampler ships in this build')
  env.db.close()
})

test('enable refuses when the experiment storage is unavailable, with the honest reason', async () => {
  const env = setup()
  setScreenContextExperimentUnavailable('The OS secure store is unavailable, so encrypted frame storage cannot be set up.')
  const result = await enableScreenContextExperiment(env.db)
  assert.equal(result.ok, false)
  assert.match(String(result.reason), /secure store/i)
  assert.notEqual((getSettings() as AppSettings).screenContextExperimentEnabled, true)
  env.db.close()
})

test('pause and resume touch screen sampling only', async () => {
  const env = setup()
  await enableScreenContextExperiment(env.db)
  const before = getSettings() as AppSettings

  const paused = await setScreenContextPaused(env.db, true)
  assert.equal(paused.ok, true)
  const during = getSettings() as AppSettings
  assert.equal(during.screenContextPaused, true)
  assert.equal(during.trackingPaused, before.trackingPaused, 'core tracking pause untouched')
  assert.equal(during.screenContextExperimentEnabled, true, 'pause is not revoke')
  assert.ok(env.measured.some((m) => m.props.action === 'paused'))

  await setScreenContextPaused(env.db, false)
  assert.equal((getSettings() as AppSettings).screenContextPaused, false)
  assert.ok(env.measured.some((m) => m.props.action === 'resumed'))
  env.db.close()
})

// ─── Revoke and the full wipe ─────────────────────────────────────────────────

test('revoke closes the experiment, deletes unprocessed frames immediately, and leaves core tracking usable', async () => {
  const env = setup()
  await enableScreenContextExperiment(env.db)
  const frame = seedFrame(env)
  assert.equal(env.store.files.size, 1)

  const result = await revokeScreenContextExperiment(env.db)
  assert.equal(result.ok, true)
  const settings = getSettings() as AppSettings
  assert.equal(settings.screenContextExperimentEnabled, false)
  assert.equal(settings.screenContextConsentAt, undefined)
  // Core tracking consent is untouched — the experiment never takes tracking down with it.
  assert.equal(settings.captureConsent?.status, 'granted')

  assert.equal(env.store.files.size, 0, 'unprocessed raw file deleted')
  const closed = getFrameRecord(env.db, frame.id)
  assert.equal(closed?.state, 'deleted')
  assert.equal(closed?.deletedWithoutEvidence, true, 'the ledger records that nothing derived survived')
  assert.ok(env.measured.some((m) => m.props.action === 'revoked'))
  env.db.close()
})

test('the full opt-out wipes raw frames AND derived records', async () => {
  const env = setup()
  await enableScreenContextExperiment(env.db)
  // One extracted frame (derived evidence committed, raw eligible for deletion)…
  const extracted = seedFrame(env)
  transitionFrameState(env.db, extracted.id, 'extracting')
  commitExtractionResult(env.db, getFrameRecord(env.db, extracted.id)!, {
    docTitle: 'Budget worksheet', ocrSpans: ['row 12'], subjectRefs: [],
    extractorModel: 'fixture', extractorSchemaVersion: 1, confidence: 1,
  }, 'digest')
  // …and one still-raw frame.
  seedFrame(env, 'TextEdit', 'com.apple.TextEdit')
  assert.ok(listAllEvidence(env.db).length === 1)

  const revoked = await revokeScreenContextExperiment(env.db, { wipeEverything: true })
  assert.equal(revoked.ok, true)
  assert.equal(listAllEvidence(env.db).length, 0, 'every derived record deleted')
  assert.equal(env.store.files.size, 0, 'every raw file deleted')
  assert.ok(listAllFrames(env.db).every((f) => f.state === 'deleted'))
  env.db.close()
})

// ─── Backlog, quarantine, Retry/Delete ────────────────────────────────────────

test('the backlog listing is structural only — no OCR text, titles, or derived content', async () => {
  const env = setup()
  await enableScreenContextExperiment(env.db)
  seedFrame(env)
  const { frames, totals } = listScreenContextBacklog(env.db)
  assert.equal(totals.frames, 1)
  assert.equal(frames.length, 1)
  const allowedKeys = new Set([
    'id', 'capturedAt', 'trigger', 'appName', 'appBundleId', 'state',
    'byteSize', 'retryCount', 'lastError', 'nextRetryAt',
  ])
  for (const key of Object.keys(frames[0])) {
    assert.ok(allowedKeys.has(key), `unexpected backlog field: ${key}`)
  }
  env.db.close()
})

test('a failed frame quarantines; explicit Retry succeeds after the extractor recovers; explicit Delete records honesty', async () => {
  const env = setup({ extractor: failingExtractor })
  await enableScreenContextExperiment(env.db)
  const a = seedFrame(env)
  const b = seedFrame(env, 'TextEdit', 'com.apple.TextEdit')

  // Retry only applies to quarantined frames — a fresh capture is not one.
  const firstTry = await retryScreenContextFrame(env.db, a.id)
  assert.equal(firstTry.ok, false, 'not quarantined yet — retry only applies to quarantined frames')
  // Drive the failure the way production does: startup recovery processes the
  // backlog, and the failing extractor quarantines both frames.
  await recoverScreenContextOnStartup(env.db)
  const afterFail = getFrameRecord(env.db, a.id)
  assert.equal(afterFail?.state, 'quarantined')
  assert.equal(getScreenContextStatus(env.db).quarantinedCount >= 1, true)

  // The person's explicit Retry outranks backoff — swap in a working extractor.
  setScreenContextExperimentDeps({
    frameStore: env.store,
    extractor: okExtractor,
    measure: (event, props) => env.measured.push({ event, props }),
    platform: 'darwin',
    samplerInstalled: false,
  })
  const retried = await retryScreenContextFrame(env.db, a.id)
  assert.equal(retried.ok, true)
  assert.equal(getFrameRecord(env.db, a.id)?.state, 'deleted', 'extracted then raw-deleted')
  assert.equal(listAllEvidence(env.db).some((e) => e.frameId === a.id), true)

  // Explicit Delete on the other (still failing) frame removes raw + records honesty.
  await recoverScreenContextOnStartup(env.db)
  const deleted = deleteScreenContextFrame(env.db, b.id)
  assert.equal(deleted.ok, true)
  const bRecord = getFrameRecord(env.db, b.id)
  assert.equal(bRecord?.state, 'deleted')
  assert.equal(bRecord?.deletedWithoutEvidence, true)
  env.db.close()
})

// ─── Exclusion offers ─────────────────────────────────────────────────────────

test('an excluded app with prior screen records becomes an explicit deletion offer, and accepting it deletes them', async () => {
  const env = setup()
  await enableScreenContextExperiment(env.db)
  seedFrame(env, 'Numbers', 'com.apple.Numbers')
  seedFrame(env, 'TextEdit', 'com.apple.TextEdit')

  setStubSettings({ trackingControlsEnabled: true, trackingExcludedApps: ['com.apple.Numbers'] })
  const offers = screenContextExclusionOffers(env.db, getSettings() as AppSettings)
  assert.equal(offers.length, 1)
  assert.equal(offers[0].source, 'com.apple.Numbers')
  assert.equal(offers[0].frameCount, 1)

  const status = getScreenContextStatus(env.db)
  assert.deepEqual(status.exclusionOffers.map((o) => o.source), ['com.apple.Numbers'])

  const accepted = deleteScreenContextForSource(env.db, 'com.apple.Numbers')
  assert.equal(accepted.ok, true)
  assert.equal(accepted.deleted, 1)
  assert.equal(screenContextExclusionOffers(env.db, getSettings() as AppSettings).length, 0)
  // The other app's frame is untouched.
  assert.equal(listScreenContextBacklog(env.db).totals.frames, 1)
  env.db.close()
})

// ─── Wipe and status ──────────────────────────────────────────────────────────

test('wipe deletes everything but leaves the consent decision alone', async () => {
  const env = setup()
  await enableScreenContextExperiment(env.db)
  seedFrame(env)
  const wiped = wipeScreenContext(env.db)
  assert.equal(wiped.ok, true)
  assert.equal(wiped.deleted, 1)
  assert.equal(listScreenContextBacklog(env.db).totals.frames, 0)
  assert.equal((getSettings() as AppSettings).screenContextExperimentEnabled, true, 'wiping data and leaving are separate decisions')
  env.db.close()
})

// ─── Local-only proof for the surface's own vocabulary ───────────────────────

test('experiment status/consent fields cannot ride the sync payload', () => {
  const dirty = {
    ...makeCleanRemoteSyncPayload(),
    screenContextStatus: { enabled: true, backlog: { frames: 3, bytes: 100 } },
  }
  assert.throws(
    () => assertSyncPayloadAllowed(dirty),
    (error: unknown) => {
      assert.ok(error instanceof SyncAllowlistViolation)
      assert.ok(error.violations.some((item) => item.class === 'extra_field'))
      return true
    },
  )
})
