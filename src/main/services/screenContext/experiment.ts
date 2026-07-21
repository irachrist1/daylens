// Screen-context experiment surface (DEV-198; screen-context.md §Product
// behavior, §Eligibility and consent, §Privacy and deletion).
//
// The DEV-197 lifecycle proved the invariants; this module is the opt-in
// experiment wrapped around it — everything a tester can see and do:
//
//   - consent: explicit, separate from every other consent, offered only from
//     the experiment setup, only where core tracking already works, and only
//     on macOS/Windows. Enabling normal tracking NEVER enables screen
//     sampling; this module is the only writer of the consent flag.
//   - pause/resume: screen sampling only; core tracking untouched.
//   - revoke: closes the experiment, deletes every unprocessed frame, leaves
//     core tracking usable. The full wipe additionally deletes every raw
//     frame AND every derived record — the easy, complete way out.
//   - backlog/quarantine: inspectable, with explicit Retry and Delete.
//   - exclusion offers: an excluded app that still has screen records is an
//     explicit offer to delete its prior screen-derived evidence.
//
// Honesty about this build: no operating-system capture sampler ships yet
// (the spec sequences OS screen APIs after the lifecycle and the experiment
// surface), so `samplerInstalled` is false and the status says so — consent
// prepares the pipeline, it does not start invisible capture. The extractor
// seam likewise refuses with a clear message instead of pretending.
import type Database from 'better-sqlite3'
import { normalizeCaptureConsent, isCaptureConsentCurrent } from '@shared/captureConsent'
import type {
  AppSettings,
  ScreenContextBacklogFrame,
  ScreenContextExclusionOffer,
  ScreenContextStatus,
} from '@shared/types'
// Written as '../../services/settings' (not '../settings') so the hermetic
// test loader recognizes and stubs it like every other settings import.
import { getSettings, setSettings } from '../../services/settings'
import { ScreenContextLifecycle, type ScreenContextMeasure, type ScreenContextNotice } from './lifecycle'
import type { FrameFileStore, ScreenFrameExtractor, ScreenFrameRecord } from './types'
import { listAllEvidence, listAllFrames } from './repository'

// ─── Injected environment ─────────────────────────────────────────────────────

export interface ScreenContextExperimentDeps {
  frameStore: FrameFileStore
  extractor: ScreenFrameExtractor
  measure?: ScreenContextMeasure
  now?: () => number
  platform?: NodeJS.Platform
  /** True once a real OS capture sampler ships in the build. */
  samplerInstalled?: boolean
  /** Live sampler state for status (installed builds wire the sampler's own
   *  getters; absent means never active). */
  getSamplerState?: () => { active: boolean; kind: string | null }
}

let deps: ScreenContextExperimentDeps | null = null
let depsUnavailableReason: string | null = null
/** Kept across an unavailable transition so status still reports the right
 *  platform when storage setup failed. */
let lastPlatform: NodeJS.Platform | null = null
let lifecycle: ScreenContextLifecycle | null = null
let lifecycleDb: Database.Database | null = null
const notices = new Set<ScreenContextNotice>()

function currentPlatform(): NodeJS.Platform {
  return deps?.platform ?? lastPlatform ?? process.platform
}

/** Install the experiment's environment (production wiring at startup, fakes
 *  in tests). Idempotent; replacing the deps drops the cached lifecycle. */
export function setScreenContextExperimentDeps(next: ScreenContextExperimentDeps): void {
  deps = next
  depsUnavailableReason = null
  lastPlatform = next.platform ?? null
  lifecycle = null
  lifecycleDb = null
  notices.clear()
}

/** Record why the experiment cannot run on this machine (e.g. no secure key
 *  storage for the encrypted frame store). Shown honestly in status. */
export function setScreenContextExperimentUnavailable(reason: string): void {
  deps = null
  depsUnavailableReason = reason
  lifecycle = null
  lifecycleDb = null
}

export function resetScreenContextExperimentForTests(): void {
  deps = null
  depsUnavailableReason = null
  lastPlatform = null
  lifecycle = null
  lifecycleDb = null
  notices.clear()
}

function getLifecycle(db: Database.Database): ScreenContextLifecycle | null {
  if (!deps) return null
  if (lifecycle && lifecycleDb === db) return lifecycle
  lifecycle = new ScreenContextLifecycle({
    db,
    frameStore: deps.frameStore,
    extractor: deps.extractor,
    now: deps.now,
    measure: deps.measure,
    notify: (notice) => notices.add(notice),
  })
  lifecycleDb = db
  return lifecycle
}

const measureSink: ScreenContextMeasure = (event, props) => {
  deps?.measure?.(event, props)
}

/** The sampler shares the experiment's ONE lifecycle instance so gates, rate
 *  windows, and backlog state cannot fork. Null while unavailable. */
export function getScreenContextLifecycleForSampler(db: Database.Database): ScreenContextLifecycle | null {
  return getLifecycle(db)
}

// ─── Eligibility ──────────────────────────────────────────────────────────────

const SUPPORTED_PLATFORMS: readonly NodeJS.Platform[] = ['darwin', 'win32']

export function screenContextEligibility(
  settings: AppSettings,
  platform: NodeJS.Platform,
): { eligible: boolean; reason: string | null } {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    return { eligible: false, reason: 'The screen-context experiment is available on macOS and Windows only.' }
  }
  if (depsUnavailableReason) {
    return { eligible: false, reason: depsUnavailableReason }
  }
  // Core tracking must already be working before screen permission is
  // requested — the experiment never leads onboarding.
  if (!isCaptureConsentCurrent(normalizeCaptureConsent(settings.captureConsent))) {
    return { eligible: false, reason: 'Finish setting up normal tracking first — the experiment builds on it and never replaces it.' }
  }
  return { eligible: true, reason: null }
}

// ─── Status ───────────────────────────────────────────────────────────────────

function excludedAppMatches(frame: ScreenFrameRecord, excluded: string): boolean {
  const needle = excluded.trim().toLowerCase()
  if (!needle) return false
  return frame.appBundleId?.toLowerCase() === needle
    || frame.appName?.toLowerCase() === needle
}

/** Excluded apps that still hold screen-context records. Each entry is the
 *  spec's "explicit deletion offer" for that source. Site exclusions cannot
 *  be offered yet: frames carry app identity only (no domain), so there is
 *  nothing truthful to match a site against. */
export function screenContextExclusionOffers(
  db: Database.Database,
  settings: AppSettings,
): ScreenContextExclusionOffer[] {
  const excludedApps = settings.trackingExcludedApps ?? []
  if (excludedApps.length === 0) return []
  const frames = listAllFrames(db)
  const evidence = listAllEvidence(db)
  const offers: ScreenContextExclusionOffer[] = []
  for (const excluded of excludedApps) {
    const matchingFrames = frames.filter((frame) =>
      frame.state !== 'deleted' && excludedAppMatches(frame, excluded))
    const matchingEvidence = evidence.filter((row) => {
      const needle = excluded.trim().toLowerCase()
      return row.appBundleId?.toLowerCase() === needle || row.appName?.toLowerCase() === needle
    })
    if (matchingFrames.length > 0 || matchingEvidence.length > 0) {
      offers.push({
        source: excluded,
        frameCount: matchingFrames.length,
        evidenceCount: matchingEvidence.length,
      })
    }
  }
  return offers
}

export function getScreenContextStatus(db: Database.Database): ScreenContextStatus {
  const settings = getSettings()
  const platform = currentPlatform()
  const eligibility = screenContextEligibility(settings, platform)
  const cycle = getLifecycle(db)
  const backlog = cycle ? cycle.backlog().totals : { frames: 0, bytes: 0 }
  const frames = cycle ? listAllFrames(db) : []
  const captured = frames.filter((frame) => frame.state !== 'deleted')
  return {
    supportedPlatform: SUPPORTED_PLATFORMS.includes(platform),
    eligible: eligibility.eligible,
    eligibilityReason: eligibility.reason,
    enabled: settings.screenContextExperimentEnabled === true,
    paused: settings.screenContextPaused === true,
    consentAt: settings.screenContextConsentAt ?? null,
    samplerInstalled: deps?.samplerInstalled === true,
    samplerActive: deps?.getSamplerState?.().active === true,
    samplerKind: deps?.getSamplerState?.().kind ?? null,
    backlog,
    backlogCapReached: cycle ? cycle.backlogCapReached() : false,
    quarantinedCount: cycle ? cycle.quarantined().length : 0,
    evidenceCount: cycle ? listAllEvidence(db).length : 0,
    lastCapturedAt: captured.length > 0 ? Math.max(...captured.map((f) => f.capturedAt)) : null,
    exclusionOffers: cycle ? screenContextExclusionOffers(db, settings) : [],
  }
}

// ─── Consent, pause, revoke ───────────────────────────────────────────────────

export interface ScreenContextActionResult {
  ok: boolean
  reason: string | null
  status: ScreenContextStatus
}

function result(db: Database.Database, ok: boolean, reason: string | null = null): ScreenContextActionResult {
  return { ok, reason, status: getScreenContextStatus(db) }
}

/** Enable the experiment — the ONLY code path that may set the consent flag,
 *  and only after the renderer's explicit consent flow. */
export async function enableScreenContextExperiment(db: Database.Database): Promise<ScreenContextActionResult> {
  const settings = getSettings()
  const eligibility = screenContextEligibility(settings, currentPlatform())
  if (!eligibility.eligible) return result(db, false, eligibility.reason)
  if (settings.screenContextExperimentEnabled === true) return result(db, true)
  await setSettings({
    screenContextExperimentEnabled: true,
    screenContextPaused: false,
    screenContextConsentAt: (deps?.now ?? Date.now.bind(Date))(),
  })
  measureSink('screen_context_consent', { action: 'enabled' })
  // Restore the lifecycle invariant for anything a previous participation or
  // crash left behind before any new frame could arrive.
  getLifecycle(db)?.recoverOrphans()
  return result(db, true)
}

export async function setScreenContextPaused(db: Database.Database, paused: boolean): Promise<ScreenContextActionResult> {
  const settings = getSettings()
  if (settings.screenContextExperimentEnabled !== true) {
    return result(db, false, 'The experiment is not enabled.')
  }
  if (Boolean(settings.screenContextPaused) !== paused) {
    await setSettings({ screenContextPaused: paused })
    measureSink('screen_context_consent', { action: paused ? 'paused' : 'resumed' })
  }
  return result(db, true)
}

/** Revoke consent: closes the experiment and deletes every unprocessed frame
 *  immediately (spec §Eligibility and consent). With `wipeEverything`, every
 *  raw frame AND every derived record goes too — the full opt-out. Core
 *  tracking is untouched either way. */
export async function revokeScreenContextExperiment(
  db: Database.Database,
  options: { wipeEverything?: boolean } = {},
): Promise<ScreenContextActionResult> {
  const cycle = getLifecycle(db)
  if (cycle) {
    if (options.wipeEverything) cycle.deleteAll()
    cycle.revokeConsent()
  }
  await setSettings({
    screenContextExperimentEnabled: false,
    screenContextPaused: false,
    screenContextConsentAt: undefined,
  })
  return result(db, true)
}

// ─── Backlog, quarantine, deletion ────────────────────────────────────────────

function toBacklogFrame(frame: ScreenFrameRecord): ScreenContextBacklogFrame {
  // Structural fields only — never derived evidence content.
  return {
    id: frame.id,
    capturedAt: frame.capturedAt,
    trigger: frame.trigger,
    appName: frame.appName,
    appBundleId: frame.appBundleId,
    state: frame.state,
    byteSize: frame.byteSize,
    retryCount: frame.retryCount,
    lastError: frame.lastError,
    nextRetryAt: frame.nextRetryAt,
  }
}

export function listScreenContextBacklog(db: Database.Database): {
  frames: ScreenContextBacklogFrame[]
  totals: { frames: number; bytes: number }
} {
  const cycle = getLifecycle(db)
  if (!cycle) return { frames: [], totals: { frames: 0, bytes: 0 } }
  const { frames, totals } = cycle.backlog()
  return { frames: frames.map(toBacklogFrame), totals }
}

export async function retryScreenContextFrame(db: Database.Database, frameId: string): Promise<{ ok: boolean; reason: string | null }> {
  const cycle = getLifecycle(db)
  if (!cycle) return { ok: false, reason: depsUnavailableReason ?? 'The experiment is not set up on this machine.' }
  const evidence = await cycle.retryFrame(frameId)
  if (evidence) return { ok: true, reason: null }
  const stillQuarantined = cycle.quarantined().some((frame) => frame.id === frameId)
  return {
    ok: false,
    reason: stillQuarantined
      ? 'Extraction failed again — the frame stays quarantined. Retry later or delete it.'
      : 'That frame is not waiting in quarantine.',
  }
}

export function deleteScreenContextFrame(db: Database.Database, frameId: string): { ok: boolean; reason: string | null } {
  const cycle = getLifecycle(db)
  if (!cycle) return { ok: false, reason: depsUnavailableReason ?? 'The experiment is not set up on this machine.' }
  const deleted = cycle.deleteFrame(frameId)
  return deleted ? { ok: true, reason: null } : { ok: false, reason: 'That frame is already gone.' }
}

/** Accept an exclusion offer: delete every frame and derived record for one
 *  excluded app source (matched by bundle id or name — the same identity the
 *  offer was computed from). */
export function deleteScreenContextForSource(db: Database.Database, source: string): { ok: boolean; deleted: number } {
  const cycle = getLifecycle(db)
  if (!cycle) return { ok: false, deleted: 0 }
  const deleted = cycle.deleteForSource({ bundleId: source, appName: source })
  return { ok: true, deleted }
}

/** The full wipe: every raw frame and every derived screen-context record,
 *  regardless of state. Consent stays as-is — wiping data and leaving the
 *  experiment are separate decisions. */
export function wipeScreenContext(db: Database.Database): { ok: boolean; deleted: number } {
  const cycle = getLifecycle(db)
  if (!cycle) return { ok: false, deleted: 0 }
  return { ok: true, deleted: cycle.deleteAll() }
}

/** Startup recovery: with consent in place, restore the lifecycle invariant
 *  (orphan files, interrupted extractions, unfinished deletions) and process
 *  whatever the backlog can process. Safe to call when ineligible — it does
 *  nothing without deps. */
export async function recoverScreenContextOnStartup(db: Database.Database): Promise<void> {
  const settings = getSettings()
  if (settings.screenContextExperimentEnabled !== true) return
  const cycle = getLifecycle(db)
  if (!cycle) return
  cycle.recoverOrphans()
  await cycle.processBacklog()
}
