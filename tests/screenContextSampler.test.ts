// Screen-context sampler (DEV-198) — the loop that reads pixels ONLY after
// every boundary said yes. Driven entirely through the simulated path: a fake
// frame source stands where the Electron capturer (ScreenCaptureKit / Windows
// Graphics Capture) stands in production. What must hold:
//   - excluded apps, unverifiable-private browsers, and protected surfaces
//     (password/payment/credential titles) are refused BEFORE the source is
//     ever asked for pixels;
//   - the scheduler's stability window and rate floors bind automatic frames;
//     a diagnostic sample skips rate limits but never the privacy gate;
//   - a successful two-phase capture measures exactly one attempt;
//   - the persistent-indicator signal follows the sampler's real state:
//     on with consent and running, off on pause or stop.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { ScreenContextLifecycle, type ScreenContextMeasureEvent, type ScreenContextMeasureProps } from '../src/main/services/screenContext/lifecycle.ts'
import { ScreenContextSampler, isProtectedSurfaceTitle, type ForegroundSnapshot, type ScreenFrameSource } from '../src/main/services/screenContext/sampler.ts'
import { listAllFrames } from '../src/main/services/screenContext/repository.ts'
import type { FrameFileStore, ScreenFrameExtractor, ScreenSamplingEnvironment } from '../src/main/services/screenContext/types.ts'
import type { AppSettings, LiveSession } from '../src/shared/types.ts'

function memoryFrameStore(): FrameFileStore {
  const files = new Map<string, Uint8Array>()
  let seq = 0
  return {
    write(_id, bytes) {
      const localPath = `/fake/sampler/${seq += 1}.scframe`
      files.set(localPath, bytes)
      return { localPath, byteSize: bytes.byteLength }
    },
    read(p) { return files.get(p)! },
    delete(p) { files.delete(p) },
    list() { return [...files.keys()] },
  }
}

const idleExtractor: ScreenFrameExtractor = {
  async extract() { throw new Error('not used in sampler tests') },
}

const CALM_ENVIRONMENT: ScreenSamplingEnvironment = {
  onBattery: false, cpuPressure: false, locked: false, idle: false, asleep: false, fullScreenMedia: false,
}

function session(overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    bundleId: 'com.apple.Numbers',
    appName: 'Numbers',
    startTime: 0,
    category: 'productivity',
    windowTitle: 'Quarterly budget',
    ...overrides,
  }
}

interface Rig {
  sampler: ScreenContextSampler
  sourceCalls: number[]
  measured: Array<{ event: ScreenContextMeasureEvent; props: ScreenContextMeasureProps }>
  activeChanges: boolean[]
  settings: Partial<AppSettings>
  foreground: ForegroundSnapshot
  clock: { now: number }
  db: ReturnType<typeof createProductionTestDatabase>
}

function rig(options: {
  settings?: Partial<AppSettings>
  foreground?: Partial<ForegroundSnapshot>
  sourceBytes?: Uint8Array | null
} = {}): Rig {
  const db = createProductionTestDatabase()
  const clock = { now: 1_800_000_000_000 }
  const measured: Rig['measured'] = []
  const lifecycle = new ScreenContextLifecycle({
    db,
    frameStore: memoryFrameStore(),
    extractor: idleExtractor,
    now: () => clock.now,
    measure: (event, props) => measured.push({ event, props }),
  })
  const sourceCalls: number[] = []
  const source: ScreenFrameSource = {
    kind: 'fake',
    async capture(displayId) {
      sourceCalls.push(displayId ?? -1)
      return options.sourceBytes === undefined ? new TextEncoder().encode('pixels') : options.sourceBytes
    },
  }
  const settings: Partial<AppSettings> = {
    screenContextExperimentEnabled: true,
    screenContextPaused: false,
    trackingPaused: false,
    trackingControlsEnabled: true,
    trackingExcludedApps: [],
    trackingExcludedSites: [],
    ...options.settings,
  }
  const foreground: ForegroundSnapshot = {
    session: session(),
    domain: null,
    privateBrowser: false,
    screenShareActive: false,
    protectedMediaActive: false,
    displayId: 7,
    ...options.foreground,
  }
  const activeChanges: boolean[] = []
  const sampler = new ScreenContextSampler({
    lifecycle,
    getSettings: () => settings as AppSettings,
    getForeground: () => foreground,
    getEnvironment: () => CALM_ENVIRONMENT,
    source,
    now: () => clock.now,
    onActiveChange: (active) => activeChanges.push(active),
    scheduleTick: () => ({ unref() {} } as unknown as NodeJS.Timeout),
  })
  return { sampler, sourceCalls, measured, activeChanges, settings, foreground, clock, db }
}

/** Make the current foreground context old enough for the stability window. */
async function stabilize(r: Rig): Promise<void> {
  await r.sampler.tick('interval') // first sight: notes the context change
  r.clock.now += 3_000            // beyond STABILITY_MS
}

// ─── Privacy boundaries decide before pixels ──────────────────────────────────

test('an excluded app is refused before the frame source is ever asked', async () => {
  const r = rig({ settings: { trackingExcludedApps: ['com.apple.Numbers'] } })
  await stabilize(r)
  const result = await r.sampler.tick('interval')
  assert.equal(result.captured, false)
  assert.equal(result.reason, 'excluded_app')
  assert.equal(r.sourceCalls.length, 0, 'no pixel was read')
  assert.equal(listAllFrames(r.db).length, 0)
  r.db.close()
})

test('a browser whose private-window state cannot be verified is never sampled', async () => {
  const r = rig({
    foreground: {
      session: session({ bundleId: 'com.google.Chrome', appName: 'Google Chrome', windowTitle: 'Research' }),
      privateBrowser: 'unknown',
    },
  })
  await stabilize(r)
  const result = await r.sampler.tick('interval')
  assert.equal(result.captured, false)
  assert.equal(result.reason, 'private_browser')
  assert.equal(r.sourceCalls.length, 0)
  r.db.close()
})

test('password, payment, and credential-shaped titles are protected surfaces', async () => {
  assert.equal(isProtectedSurfaceTitle('1Password — vault'), true)
  assert.equal(isProtectedSurfaceTitle('Checkout — payment details'), true)
  assert.equal(isProtectedSurfaceTitle('Sign in to ACME'), true)
  assert.equal(isProtectedSurfaceTitle('oauth callback code=abcdef12345678 state=xyz98765'), true)
  assert.equal(isProtectedSurfaceTitle('Quarterly budget'), false)

  const r = rig({ foreground: { session: session({ windowTitle: 'Enter your password' }) } })
  await stabilize(r)
  const result = await r.sampler.tick('interval')
  assert.equal(result.captured, false)
  assert.equal(result.reason, 'protected_surface')
  assert.equal(r.sourceCalls.length, 0)
  r.db.close()
})

test('pause blocks every capture — diagnostic samples included', async () => {
  const r = rig({ settings: { screenContextPaused: true } })
  await stabilize(r)
  const interval = await r.sampler.tick('interval')
  assert.equal(interval.reason, 'screen_context_paused')
  const diagnostic = await r.sampler.requestDiagnosticSample()
  assert.equal(diagnostic.captured, false)
  assert.equal(diagnostic.reason, 'screen_context_paused')
  assert.equal(r.sourceCalls.length, 0)
  r.db.close()
})

// ─── Scheduler boundaries ─────────────────────────────────────────────────────

test('a fresh context is not stable; a stable one captures with the app identity attached', async () => {
  const r = rig()
  const first = await r.sampler.tick('interval')
  assert.equal(first.captured, false)
  assert.equal(first.reason, 'context_not_stable')

  r.clock.now += 3_000
  const second = await r.sampler.tick('interval')
  assert.equal(second.captured, true)
  assert.equal(r.sourceCalls.length, 1)
  const frames = listAllFrames(r.db)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].appName, 'Numbers')
  assert.equal(frames[0].displayId, 7)

  // A successful two-phase capture measured exactly ONE attempt.
  const attempts = r.measured.filter((m) => m.event === 'screen_context_capture' && m.props.outcome === 'attempted')
  assert.equal(attempts.length, 2, 'one attempt for the unstable tick, one for the capture')
  r.db.close()
})

test('the minimum automatic interval binds ticks; a diagnostic sample skips it', async () => {
  const r = rig()
  await stabilize(r)
  const first = await r.sampler.tick('interval')
  assert.equal(first.captured, true)

  r.clock.now += 5_000 // inside the 30s floor
  const tooSoon = await r.sampler.tick('interval')
  assert.equal(tooSoon.captured, false)
  assert.equal(tooSoon.reason, 'rate_min_interval')

  const diagnostic = await r.sampler.requestDiagnosticSample()
  assert.equal(diagnostic.captured, true, 'the person explicitly asked — rate limits do not apply')
  assert.equal(listAllFrames(r.db).length, 2)
  r.db.close()
})

test('a source that returns nothing produces no frame and an honest reason', async () => {
  const r = rig({ sourceBytes: null })
  await stabilize(r)
  const result = await r.sampler.tick('interval')
  assert.equal(result.captured, false)
  assert.equal(result.reason, 'source_unavailable')
  assert.equal(listAllFrames(r.db).length, 0)
  r.db.close()
})

// ─── The persistent indicator follows reality ─────────────────────────────────

test('the indicator signal turns on with consent + running, and off on pause and stop', async () => {
  const r = rig()
  r.sampler.start()
  assert.deepEqual(r.activeChanges, [true])

  r.settings.screenContextPaused = true
  r.sampler.publishActive()
  assert.deepEqual(r.activeChanges, [true, false])

  r.settings.screenContextPaused = false
  r.sampler.publishActive()
  assert.deepEqual(r.activeChanges, [true, false, true])

  r.sampler.stop()
  assert.deepEqual(r.activeChanges, [true, false, true, false])
  r.db.close()
})

test('without consent the sampler never reports active', () => {
  const r = rig({ settings: { screenContextExperimentEnabled: false } })
  r.sampler.start()
  assert.equal(r.sampler.active, false)
  assert.deepEqual(r.activeChanges, [], 'no active=true was ever published')
  r.sampler.stop()
  r.db.close()
})
