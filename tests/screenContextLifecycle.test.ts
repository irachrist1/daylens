// Screen-context experiment (DEV-197) — the terminal lifecycle harness.
//
// A fake frame source and a deterministic extractor drive the PRODUCTION
// lifecycle, repositories, and migration — no OS screen API anywhere. What
// must hold:
//   - pause, protected surfaces, and exclusions apply BEFORE frame capture;
//   - extraction and the derived-evidence commit are atomic before raw
//     deletion; a crash at any point preserves the invariant;
//   - failures stay quarantined, visible, retryable, and deletable;
//   - delete removes raw and derived records; the ledger keeps only that a
//     frame existed and is gone;
//   - the scheduler respects every rate, power, and backlog boundary;
//   - measurements carry buckets and closed enums only, never content.
import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import {
  ScreenContextLifecycle,
  type ScreenContextMeasureEvent,
  type ScreenContextMeasureProps,
} from '../src/main/services/screenContext/lifecycle.ts'
import {
  evaluateCaptureGate,
  evaluateSamplingSchedule,
  createSamplingSchedulerState,
  noteContextChange,
  recordCapture,
} from '../src/main/services/screenContext/scheduler.ts'
import {
  commitExtractionResult,
  getBacklogTotals,
  getEvidenceForFrame,
  getFrameRecord,
  insertFrameRecord,
  listAllEvidence,
  listAllFrames,
  transitionFrameState,
} from '../src/main/services/screenContext/repository.ts'
import {
  SCREEN_CONTEXT_POLICY,
  type CapturedFrameInput,
  type FrameFileStore,
  type ScreenCaptureGateContext,
  type ScreenExtractionResult,
  type ScreenFrameExtractor,
  type ScreenSamplingEnvironment,
} from '../src/main/services/screenContext/types.ts'
import { buildScreenCaptureGateContext } from '../src/main/services/screenContext/settingsGate.ts'
import type { AppSettings } from '../src/shared/types.ts'

// ─── Harness pieces ───────────────────────────────────────────────────────────

// A distinctive content marker: if it ever shows up in a measurement event or
// a stored error, content leaked.
const SECRET_TITLE = 'Q3 Acquisition Draft SECRET_MARKER_9f1e'

function memoryFrameStore(): FrameFileStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  let seq = 0
  return {
    files,
    write(_id: string, bytes: Uint8Array) {
      const localPath = `/fake/frames/frame_${seq++}.scframe`
      files.set(localPath, bytes)
      return { localPath, byteSize: bytes.byteLength }
    },
    read(localPath: string) {
      const bytes = files.get(localPath)
      if (!bytes) throw new Error('missing frame file')
      return bytes
    },
    delete(localPath: string) { files.delete(localPath) },
    list() { return [...files.keys()] },
  }
}

function deterministicExtractor(overrides: Partial<ScreenExtractionResult> = {}): ScreenFrameExtractor {
  return {
    async extract() {
      return {
        docTitle: SECRET_TITLE,
        ocrSpans: ['acquisition timeline', 'due diligence checklist'],
        subjectRefs: ['Project Falcon'],
        bounding: { x: 0, y: 0, w: 1, h: 1 },
        extractorModel: 'fixture-extractor',
        extractorSchemaVersion: 1,
        confidence: 0.9,
        ...overrides,
      }
    },
  }
}

function failingExtractor(): ScreenFrameExtractor {
  return {
    async extract() {
      throw new Error(`ocr crashed while reading "${SECRET_TITLE}"`)
    },
  }
}

const OPEN_GATE: ScreenCaptureGateContext = {
  consentEnabled: true,
  screenContextPaused: false,
  trackingPaused: false,
  foregroundExcluded: false,
  privateBrowser: false,
  protectedSurface: false,
  screenShareActive: false,
  protectedMediaActive: false,
}

const CALM_ENV: ScreenSamplingEnvironment = {
  onBattery: false, cpuPressure: false, locked: false, idle: false, asleep: false, fullScreenMedia: false,
}

function frameInput(overrides: Partial<CapturedFrameInput> = {}): CapturedFrameInput {
  return {
    bytes: new TextEncoder().encode('fake-frame-pixels'),
    capturedAt: Date.now(),
    trigger: 'diagnostic',
    appBundleId: 'com.apple.TextEdit',
    appName: 'TextEdit',
    displayId: 1,
    ...overrides,
  }
}

interface Harness {
  db: Database.Database
  store: ReturnType<typeof memoryFrameStore>
  lifecycle: ScreenContextLifecycle
  events: Array<{ event: ScreenContextMeasureEvent; props: ScreenContextMeasureProps }>
  notices: string[]
  clock: { nowMs: number }
}

function makeHarness(extractor: ScreenFrameExtractor, startMs = Date.now()): Harness {
  const db = createProductionTestDatabase()
  const store = memoryFrameStore()
  const events: Harness['events'] = []
  const notices: string[] = []
  const clock = { nowMs: startMs }
  const lifecycle = new ScreenContextLifecycle({
    db,
    frameStore: store,
    extractor,
    now: () => clock.nowMs,
    notify: (n) => notices.push(n),
    measure: (event, props) => events.push({ event, props }),
  })
  return { db, store, lifecycle, events, notices, clock }
}

// ─── Schema ───────────────────────────────────────────────────────────────────

test('v60 creates the frame ledger and evidence store', () => {
  const db = createProductionTestDatabase()
  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'screen_context_%' ORDER BY name`,
  ).all() as Array<{ name: string }>
  assert.deepEqual(tables.map((t) => t.name), ['screen_context_evidence', 'screen_context_frames'])
  db.close()
})

// ─── Privacy gates BEFORE capture ─────────────────────────────────────────────

test('every privacy boundary blocks before capture — no file, no row', () => {
  const cases: Array<[Partial<ScreenCaptureGateContext>, string]> = [
    [{ consentEnabled: false }, 'consent_missing'],
    [{ trackingPaused: true }, 'tracking_paused'],
    [{ screenContextPaused: true }, 'screen_context_paused'],
    [{ foregroundExcluded: true }, 'excluded_app'],
    [{ privateBrowser: true }, 'private_browser'],
    [{ privateBrowser: 'unknown' }, 'private_browser'],
    [{ protectedSurface: true }, 'protected_surface'],
    [{ screenShareActive: true }, 'screen_share'],
    [{ protectedMediaActive: true }, 'protected_media'],
  ]
  for (const [override, expectedReason] of cases) {
    const { db, store, lifecycle } = makeHarness(deterministicExtractor())
    const result = lifecycle.captureFrame(frameInput(), { ...OPEN_GATE, ...override }, CALM_ENV)
    assert.equal(result.captured, false, expectedReason)
    assert.equal(result.reason, expectedReason)
    assert.equal(store.files.size, 0, `${expectedReason}: raw file must not exist`)
    assert.equal(listAllFrames(db).length, 0, `${expectedReason}: no ledger row`)
    db.close()
  }
})

test('the pure gate refuses in specification order: consent before everything', () => {
  const decision = evaluateCaptureGate({
    ...OPEN_GATE,
    consentEnabled: false,
    protectedSurface: true,
    screenShareActive: true,
  })
  assert.deepEqual(decision, { allowed: false, reason: 'consent_missing' })
})

test('tracking-controls exclusions bind screen capture through the same matcher', () => {
  const settings = {
    trackingControlsEnabled: true,
    trackingExcludedApps: ['com.secret.app'],
    trackingExcludedSites: ['bank.example'],
    screenContextExperimentEnabled: true,
  } as unknown as AppSettings
  const excludedApp = buildScreenCaptureGateContext(settings, {
    bundleId: 'com.secret.app', appName: 'Secret App', privateBrowser: false,
    protectedSurface: false, screenShareActive: false, protectedMediaActive: false,
  })
  assert.equal(excludedApp.foregroundExcluded, true)
  const excludedSite = buildScreenCaptureGateContext(settings, {
    bundleId: 'com.browser', appName: 'Browser', domain: 'online.bank.example', privateBrowser: false,
    protectedSurface: false, screenShareActive: false, protectedMediaActive: false,
  })
  assert.equal(excludedSite.foregroundExcluded, true)
  const allowed = buildScreenCaptureGateContext(settings, {
    bundleId: 'com.apple.TextEdit', appName: 'TextEdit', privateBrowser: false,
    protectedSurface: false, screenShareActive: false, protectedMediaActive: false,
  })
  assert.equal(allowed.foregroundExcluded, false)
  assert.equal(allowed.consentEnabled, true)
})

test('enabling normal tracking never enables screen sampling', () => {
  const settings = {
    captureConsent: { consented: true },
    trackingControlsEnabled: false,
  } as unknown as AppSettings
  const gate = buildScreenCaptureGateContext(settings, {
    bundleId: 'com.apple.TextEdit', appName: 'TextEdit', privateBrowser: false,
    protectedSurface: false, screenShareActive: false, protectedMediaActive: false,
  })
  assert.equal(gate.consentEnabled, false)
  assert.deepEqual(evaluateCaptureGate(gate), { allowed: false, reason: 'consent_missing' })
})

// ─── The sampling scheduler ───────────────────────────────────────────────────

test('scheduler: stability, minimum interval, hourly cap, bounded re-sampling, power backoff', () => {
  const state = createSamplingSchedulerState()
  let now = 1_000_000

  // Not stable yet.
  noteContextChange(state, now)
  assert.equal(evaluateSamplingSchedule(state, now + 1_000, 'stability', CALM_ENV).reason, 'context_not_stable')
  now += SCREEN_CONTEXT_POLICY.STABILITY_MS + 1
  assert.equal(evaluateSamplingSchedule(state, now, 'stability', CALM_ENV).allowed, true)
  recordCapture(state, now, 'stability')

  // Minimum automatic interval.
  assert.equal(
    evaluateSamplingSchedule(state, now + SCREEN_CONTEXT_POLICY.MIN_AUTOMATIC_INTERVAL_MS - 1, 'context_change', CALM_ENV).reason,
    'rate_min_interval',
  )

  // Bounded same-context re-sampling: past the 30s floor but inside the 60s
  // same-context window, an 'interval' resample must wait.
  const at45s = now + 45_000
  assert.equal(evaluateSamplingSchedule(state, at45s, 'interval', CALM_ENV).reason, 'bounded_interval')
  const at61s = now + SCREEN_CONTEXT_POLICY.SAME_CONTEXT_INTERVAL_MS + 1_000
  assert.equal(evaluateSamplingSchedule(state, at61s, 'interval', CALM_ENV).allowed, true)

  // Hourly ceiling.
  const capped = createSamplingSchedulerState()
  capped.contextStableSinceMs = 0
  let t = 10 * 60 * 60 * 1000
  for (let i = 0; i < SCREEN_CONTEXT_POLICY.MAX_FRAMES_PER_HOUR; i++) {
    capped.automaticCaptureTimesMs.push(t - i * 25_000)
  }
  t += SCREEN_CONTEXT_POLICY.MIN_AUTOMATIC_INTERVAL_MS
  assert.equal(evaluateSamplingSchedule(capped, t, 'context_change', CALM_ENV).reason, 'rate_hourly_cap')

  // Power/attention backoff, each dimension alone.
  for (const key of ['onBattery', 'cpuPressure', 'locked', 'idle', 'asleep', 'fullScreenMedia'] as const) {
    const env = { ...CALM_ENV, [key]: true }
    assert.equal(evaluateSamplingSchedule(state, at61s, 'interval', env).reason, 'power_backoff', key)
  }

  // A diagnostic sample skips rate limits (the person explicitly asked).
  assert.equal(evaluateSamplingSchedule(state, now + 1, 'diagnostic', { ...CALM_ENV, onBattery: true }).allowed, true)
})

// ─── The happy path: atomic commit, then raw deletion ─────────────────────────

test('capture → extract → atomic evidence commit → raw file deleted', async () => {
  const { db, store, lifecycle } = makeHarness(deterministicExtractor())
  const result = lifecycle.captureFrame(frameInput(), OPEN_GATE, CALM_ENV)
  assert.equal(result.captured, true)
  const frame = result.frame!
  assert.equal(frame.state, 'captured')
  assert.equal(store.files.size, 1)

  const evidence = await lifecycle.processFrame(frame.id)
  assert.ok(evidence, 'extraction must produce evidence')
  assert.equal(evidence!.docTitle, SECRET_TITLE)
  assert.equal(evidence!.sensitivity, 'high')
  assert.match(evidence!.frameDigest, /^[0-9a-f]{64}$/)
  assert.equal(evidence!.extractorModel, 'fixture-extractor')

  const done = getFrameRecord(db, frame.id)!
  assert.equal(done.state, 'deleted')
  assert.equal(done.localPath, null)
  assert.equal(done.deletedWithoutEvidence, false)
  assert.equal(store.files.size, 0, 'raw file deleted only after the commit')
  // The derived record holds no image and no reconstructed pixels.
  assert.ok(!('bytes' in evidence!))
  db.close()
})

test('the ledger refuses illegal lifecycle transitions', () => {
  const db = createProductionTestDatabase()
  const frame = insertFrameRecord(db, {
    capturedAt: Date.now(), trigger: 'diagnostic', appBundleId: null, appName: null,
    displayId: null, exclusionPolicyVersion: 1, localPath: '/fake/x.scframe', byteSize: 10,
  })
  assert.throws(() => transitionFrameState(db, frame.id, 'safe_to_delete'), /illegal lifecycle transition/)
  assert.throws(() => transitionFrameState(db, frame.id, 'indexed'), /illegal lifecycle transition/)
  assert.equal(getFrameRecord(db, frame.id)!.state, 'captured')
  db.close()
})

// ─── Failure, quarantine, bounded retries ─────────────────────────────────────

test('extraction failure quarantines with the raw file intact, retries bounded, then waits for the person', async () => {
  const { db, store, lifecycle, clock, notices } = makeHarness(failingExtractor())
  const { frame } = lifecycle.captureFrame(frameInput({ capturedAt: clock.nowMs }), OPEN_GATE, CALM_ENV)

  await lifecycle.processFrame(frame!.id)
  let record = getFrameRecord(db, frame!.id)!
  assert.equal(record.state, 'quarantined')
  assert.equal(record.retryCount, 1)
  assert.ok(record.nextRetryAt! > clock.nowMs)
  assert.equal(store.files.size, 1, 'the only copy is never deleted before extraction succeeds')
  assert.equal(getEvidenceForFrame(db, frame!.id), null)

  // Automatic retries burn down the bounded budget.
  for (let i = record.retryCount; i < SCREEN_CONTEXT_POLICY.MAX_EXTRACTION_RETRIES; i++) {
    clock.nowMs = record.nextRetryAt! + 1
    await lifecycle.processBacklog()
    record = getFrameRecord(db, frame!.id)!
    assert.equal(record.state, 'quarantined')
  }
  assert.equal(record.retryCount, SCREEN_CONTEXT_POLICY.MAX_EXTRACTION_RETRIES)
  assert.equal(record.nextRetryAt, null, 'budget exhausted: no automatic retry is scheduled')

  // The backlog pass no longer touches it, but says someone should look.
  clock.nowMs += 60 * 60 * 1000
  await lifecycle.processBacklog()
  assert.equal(getFrameRecord(db, frame!.id)!.retryCount, SCREEN_CONTEXT_POLICY.MAX_EXTRACTION_RETRIES)
  assert.ok(notices.includes('quarantine_needs_attention'))
  assert.equal(store.files.size, 1, 'still never silently deleted')
  db.close()
})

test('a frame past the raw safety window is not auto-retried and is never silently deleted', async () => {
  const { db, store, lifecycle, clock } = makeHarness(failingExtractor())
  const { frame } = lifecycle.captureFrame(frameInput({ capturedAt: clock.nowMs }), OPEN_GATE, CALM_ENV)
  await lifecycle.processFrame(frame!.id)

  clock.nowMs += SCREEN_CONTEXT_POLICY.RAW_SAFETY_WINDOW_MS + 1
  await lifecycle.processBacklog()
  const record = getFrameRecord(db, frame!.id)!
  assert.equal(record.state, 'quarantined')
  assert.equal(record.retryCount, 1, 'no automatic retry after the safety window')
  assert.equal(store.files.size, 1)
  db.close()
})

test('explicit Retry outranks the exhausted budget; explicit Delete records that nothing survived', async () => {
  const harness = makeHarness(failingExtractor())
  const { db, store, lifecycle, clock } = harness
  const { frame } = lifecycle.captureFrame(frameInput({ capturedAt: clock.nowMs }), OPEN_GATE, CALM_ENV)
  await lifecycle.processFrame(frame!.id)

  // Person taps Retry with a now-working extractor: swap the adapter by
  // building a fresh lifecycle over the same db + store (adapters are seams).
  const fixed = new ScreenContextLifecycle({
    db, frameStore: store, extractor: deterministicExtractor(), now: () => clock.nowMs,
  })
  const evidence = await fixed.retryFrame(frame!.id)
  assert.ok(evidence, 'explicit retry extracts')
  assert.equal(getFrameRecord(db, frame!.id)!.state, 'deleted')
  assert.equal(store.files.size, 0)

  // And the Delete path on a fresh failing frame.
  const second = lifecycle.captureFrame(frameInput({ capturedAt: clock.nowMs }), OPEN_GATE, CALM_ENV)
  await lifecycle.processFrame(second.frame!.id)
  assert.equal(lifecycle.deleteFrame(second.frame!.id), true)
  const deleted = getFrameRecord(db, second.frame!.id)!
  assert.equal(deleted.state, 'deleted')
  assert.equal(deleted.deletedWithoutEvidence, true, 'explicit deletion records no derived evidence survived')
  assert.equal(store.files.size, 0)
  db.close()
})

// ─── Crash recovery ───────────────────────────────────────────────────────────

test('crash between evidence commit and raw deletion: recovery finishes the deletion, evidence survives', () => {
  const { db, store, lifecycle } = makeHarness(deterministicExtractor())
  const { frame } = lifecycle.captureFrame(frameInput(), OPEN_GATE, CALM_ENV)
  // Simulate the crash: walk to the committed state by hand, leave the file.
  transitionFrameState(db, frame!.id, 'extracting')
  commitExtractionResult(db, getFrameRecord(db, frame!.id)!, {
    docTitle: 'Doc', ocrSpans: [], subjectRefs: [],
    extractorModel: 'fixture-extractor', extractorSchemaVersion: 1, confidence: 1,
  }, 'a'.repeat(64))
  assert.equal(getFrameRecord(db, frame!.id)!.state, 'indexed')
  assert.equal(store.files.size, 1)

  lifecycle.recoverOrphans()
  assert.equal(getFrameRecord(db, frame!.id)!.state, 'deleted')
  assert.equal(store.files.size, 0)
  assert.ok(getEvidenceForFrame(db, frame!.id), 'the committed evidence survives recovery')
  db.close()
})

test('crash mid-extraction: recovery quarantines for retry, never deletes the only copy', () => {
  const { db, store, lifecycle } = makeHarness(deterministicExtractor())
  const { frame } = lifecycle.captureFrame(frameInput(), OPEN_GATE, CALM_ENV)
  transitionFrameState(db, frame!.id, 'extracting')

  lifecycle.recoverOrphans()
  const record = getFrameRecord(db, frame!.id)!
  assert.equal(record.state, 'quarantined')
  assert.equal(store.files.size, 1)
  db.close()
})

test('orphan files with no valid record are deleted; records whose file vanished close honestly', () => {
  const { db, store, lifecycle } = makeHarness(deterministicExtractor())
  // An orphan file nothing claims.
  store.files.set('/fake/frames/orphan.scframe', new Uint8Array([1, 2, 3]))
  // A captured record whose file vanished.
  const { frame } = lifecycle.captureFrame(frameInput(), OPEN_GATE, CALM_ENV)
  store.files.delete(getFrameRecord(db, frame!.id)!.localPath!)

  lifecycle.recoverOrphans()
  assert.ok(!store.files.has('/fake/frames/orphan.scframe'), 'orphan file deleted')
  const record = getFrameRecord(db, frame!.id)!
  assert.equal(record.state, 'deleted')
  assert.equal(record.deletedWithoutEvidence, true)
  db.close()
})

// ─── Backlog caps ─────────────────────────────────────────────────────────────

test('reaching the backlog cap blocks new capture, pauses, and notifies once', () => {
  const { db, lifecycle, notices } = makeHarness(deterministicExtractor())
  for (let i = 0; i < SCREEN_CONTEXT_POLICY.MAX_BACKLOG_FRAMES; i++) {
    insertFrameRecord(db, {
      capturedAt: Date.now() - i, trigger: 'interval', appBundleId: null, appName: null,
      displayId: null, exclusionPolicyVersion: 1, localPath: `/fake/backlog/${i}.scframe`, byteSize: 1_000,
    })
  }
  assert.equal(getBacklogTotals(db).frames, SCREEN_CONTEXT_POLICY.MAX_BACKLOG_FRAMES)
  const first = lifecycle.captureFrame(frameInput(), OPEN_GATE, CALM_ENV)
  assert.equal(first.captured, false)
  assert.equal(first.reason, 'backlog_cap')
  const second = lifecycle.captureFrame(frameInput(), OPEN_GATE, CALM_ENV)
  assert.equal(second.reason, 'backlog_cap')
  assert.deepEqual(notices.filter((n) => n === 'backlog_cap_reached'), ['backlog_cap_reached'], 'notified once')
  db.close()
})

test('the byte cap alone also pauses sampling', () => {
  const { db, lifecycle } = makeHarness(deterministicExtractor())
  insertFrameRecord(db, {
    capturedAt: Date.now(), trigger: 'interval', appBundleId: null, appName: null,
    displayId: null, exclusionPolicyVersion: 1, localPath: '/fake/big.scframe',
    byteSize: SCREEN_CONTEXT_POLICY.MAX_BACKLOG_BYTES,
  })
  assert.equal(lifecycle.captureFrame(frameInput(), OPEN_GATE, CALM_ENV).reason, 'backlog_cap')
  db.close()
})

// ─── Deletion owners ──────────────────────────────────────────────────────────

test('revoking consent deletes unprocessed frames and leaves committed evidence intact', async () => {
  const { db, store, lifecycle } = makeHarness(deterministicExtractor())
  const processed = lifecycle.captureFrame(frameInput(), OPEN_GATE, CALM_ENV)
  await lifecycle.processFrame(processed.frame!.id)
  const pending = lifecycle.captureFrame(frameInput(), OPEN_GATE, CALM_ENV)

  lifecycle.revokeConsent()
  assert.equal(getFrameRecord(db, pending.frame!.id)!.state, 'deleted')
  assert.equal(getFrameRecord(db, pending.frame!.id)!.deletedWithoutEvidence, true)
  assert.equal(store.files.size, 0, 'no raw frame survives revocation')
  assert.ok(getEvidenceForFrame(db, processed.frame!.id), 'already-derived evidence is not silently destroyed by revoke')
  db.close()
})

test('excluding a source deletes its raw and derived records', async () => {
  const { db, store, lifecycle } = makeHarness(deterministicExtractor())
  const secret = lifecycle.captureFrame(
    frameInput({ appBundleId: 'com.secret.app', appName: 'Secret App' }), OPEN_GATE, CALM_ENV,
  )
  await lifecycle.processFrame(secret.frame!.id)
  const other = lifecycle.captureFrame(frameInput(), OPEN_GATE, CALM_ENV)

  const deleted = lifecycle.deleteForSource({ bundleId: 'com.secret.app' })
  assert.equal(deleted, 1)
  assert.equal(getEvidenceForFrame(db, secret.frame!.id), null, 'derived evidence for the excluded source is gone')
  assert.equal(getFrameRecord(db, other.frame!.id)!.state, 'captured', 'other sources untouched')
  assert.equal(store.files.size, 1)
  db.close()
})

test('delete-everything removes every raw and derived screen-context record', async () => {
  const { db, store, lifecycle } = makeHarness(deterministicExtractor())
  const a = lifecycle.captureFrame(frameInput(), OPEN_GATE, CALM_ENV)
  await lifecycle.processFrame(a.frame!.id)
  lifecycle.captureFrame(frameInput(), OPEN_GATE, CALM_ENV)

  lifecycle.deleteAll()
  assert.equal(listAllEvidence(db).length, 0)
  assert.equal(store.files.size, 0)
  assert.ok(listAllFrames(db).every((f) => f.state === 'deleted'))
  db.close()
})

test('deleting a period removes only that period', async () => {
  const { db, lifecycle, clock } = makeHarness(deterministicExtractor())
  const early = lifecycle.captureFrame(frameInput({ capturedAt: clock.nowMs - 60_000 }), OPEN_GATE, CALM_ENV)
  const late = lifecycle.captureFrame(frameInput({ capturedAt: clock.nowMs }), OPEN_GATE, CALM_ENV)
  lifecycle.deleteForPeriod(clock.nowMs - 120_000, clock.nowMs - 1_000)
  assert.equal(getFrameRecord(db, early.frame!.id)!.state, 'deleted')
  assert.equal(getFrameRecord(db, late.frame!.id)!.state, 'captured')
  db.close()
})

// ─── The measurement contract ─────────────────────────────────────────────────

const ALLOWED_MEASURE_KEYS = new Set([
  'action', 'outcome', 'blocked_reason', 'trigger',
  'latency_bucket', 'byte_bucket', 'backlog_bucket', 'retry_count', 'added_new_fact',
])

test('measurements carry closed enums and buckets only — never content, names, or timestamps', async () => {
  const { db, lifecycle, events, clock } = makeHarness(deterministicExtractor())
  // Blocked, succeeded, extracted, failed — a full spread of emissions.
  lifecycle.captureFrame(frameInput(), { ...OPEN_GATE, protectedSurface: true }, CALM_ENV)
  const ok = lifecycle.captureFrame(frameInput({ appName: SECRET_TITLE }), OPEN_GATE, CALM_ENV)
  await lifecycle.processFrame(ok.frame!.id)
  const failing = new ScreenContextLifecycle({
    db, frameStore: memoryFrameStore(), extractor: failingExtractor(),
    now: () => clock.nowMs, measure: (event, props) => events.push({ event, props }),
  })
  const bad = failing.captureFrame(frameInput({ appName: SECRET_TITLE }), OPEN_GATE, CALM_ENV)
  await failing.processFrame(bad.frame!.id)

  assert.ok(events.length >= 6, 'the scenario emitted measurements')
  for (const { event, props } of events) {
    assert.match(event, /^screen_context_/)
    for (const [key, value] of Object.entries(props)) {
      assert.ok(ALLOWED_MEASURE_KEYS.has(key), `unexpected measurement property: ${key}`)
      if (typeof value === 'string') {
        assert.ok(!value.includes('SECRET_MARKER'), `content leaked into ${key}`)
        assert.ok(!value.includes('TextEdit'), `app name leaked into ${key}`)
        assert.ok(value.length <= 40, `suspiciously long measurement value in ${key}`)
      }
      if (typeof value === 'number') {
        assert.ok(value < 10_000, `${key} looks like a timestamp: ${value}`)
      }
    }
  }
  db.close()
})

test('a stored extraction error is bounded but the harness content marker never reaches measurements', async () => {
  const { db, lifecycle, events } = makeHarness(failingExtractor())
  const { frame } = lifecycle.captureFrame(frameInput(), OPEN_GATE, CALM_ENV)
  await lifecycle.processFrame(frame!.id)
  const serialized = JSON.stringify(events)
  assert.ok(!serialized.includes('SECRET_MARKER'), 'extractor error content must not reach measurements')
  db.close()
})
