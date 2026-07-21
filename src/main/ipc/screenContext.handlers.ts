// Screen-context experiment IPC (DEV-198). The renderer's Settings section
// talks to the experiment surface through these handlers: status, the consent
// decision, pause/resume, revoke, backlog/quarantine inspection with explicit
// Retry/Delete, per-source deletion offers, the full wipe, and the tester's
// explicit diagnostic sample.
//
// Production wiring for the DEV-197/DEV-198 adapter seams:
//   - frame store: AES-256-GCM encrypted files under userData/screen-context,
//     key generated once and kept in the OS secure store (never on disk next
//     to the frames). No secure store → the experiment is honestly
//     unavailable, with the reason in status.
//   - frame source: the Electron capturer (ScreenCaptureKit on macOS,
//     Windows.Graphics.Capture on Windows) behind EVERY gate — the sampler
//     decides before any pixel is read, and macOS Screen Recording permission
//     is owned by the experiment, never prompted from onboarding.
//   - extractor: no local extraction runtime ships in this build — the seam
//     refuses with a clear message instead of pretending, so captured frames
//     quarantine visibly rather than silently "succeeding".
//   - persistent indicator: the sampler's one active/inactive signal drives
//     the tray indicator, so the indicator can never disagree with reality.
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { app, ipcMain, powerMonitor } from 'electron'
import { IPC } from '@shared/types'
import { getDb } from '../services/database'
import { getSettings } from '../services/settings'
import { getCurrentSession } from '../services/tracking'
import { getSecureStore } from '../services/secureStore'
import { capture } from '../services/analytics'
import type { AnalyticsEventName } from '@shared/analytics'
import { isBrowserApplication } from '../services/browserRegistry'
import { setTrayScreenSamplingIndicator } from '../tray'
import { createEncryptedFrameStore } from '../services/screenContext/encryptedFrameStore'
import type { ScreenFrameExtractor, ScreenSamplingEnvironment } from '../services/screenContext/types'
import type { ScreenContextMeasure } from '../services/screenContext/lifecycle'
import { ScreenContextSampler, type ForegroundSnapshot } from '../services/screenContext/sampler'
import { createElectronScreenFrameSource } from '../services/screenContext/electronFrameSource'
import {
  deleteScreenContextFrame,
  deleteScreenContextForSource,
  enableScreenContextExperiment,
  getScreenContextLifecycleForSampler,
  getScreenContextStatus,
  listScreenContextBacklog,
  recoverScreenContextOnStartup,
  retryScreenContextFrame,
  revokeScreenContextExperiment,
  setScreenContextExperimentDeps,
  setScreenContextExperimentUnavailable,
  setScreenContextPaused,
  wipeScreenContext,
} from '../services/screenContext/experiment'

const KEYTAR_SERVICE = 'Daylens Desktop'
const FRAME_KEY_ACCOUNT = 'screen-context-frame-key'
const SUPPORTED_SAMPLER_PLATFORMS: readonly NodeJS.Platform[] = ['darwin', 'win32']
const IDLE_THRESHOLD_SECONDS = 60

/** The extraction seam for this build: nothing is installed, and it says so.
 *  The lifecycle turns this into a visible quarantine, never a fake success. */
const noExtractorInstalled: ScreenFrameExtractor = {
  async extract() {
    throw new Error('no local extraction runtime is installed in this build')
  },
}

/** Measurement sink: the lifecycle already restricts properties to its closed
 *  bucket/enum vocabulary; the global analytics sanitizer enforces it again. */
const measure: ScreenContextMeasure = (event, props) => {
  capture(event as AnalyticsEventName, props as Record<string, unknown>)
}

let sampler: ScreenContextSampler | null = null
// Lock/sleep state tracked from powerMonitor events — the environment half of
// the sampling backoff.
let machineLocked = false
let machineAsleep = false

function productionEnvironment(): ScreenSamplingEnvironment {
  let onBattery = false
  let idle = false
  try {
    onBattery = powerMonitor.isOnBatteryPower()
    idle = powerMonitor.getSystemIdleTime() >= IDLE_THRESHOLD_SECONDS
  } catch { /* diagnostics-only environments */ }
  return {
    onBattery,
    // No cheap cross-platform CPU-pressure signal in this build; the rate
    // caps and battery/idle/lock backoffs still bound the load.
    cpuPressure: false,
    locked: machineLocked,
    idle,
    asleep: machineAsleep,
    // Full-screen media detection rides a later real-machine pass; the
    // protected-media gate still blocks DRM surfaces at the source (they
    // capture as empty frames and are refused).
    fullScreenMedia: false,
  }
}

function productionForeground(): ForegroundSnapshot {
  const session = getCurrentSession()
  const isBrowser = session
    ? isBrowserApplication({ bundleId: session.bundleId, appName: session.appName })
    : false
  return {
    session,
    domain: null,
    // A browser's private-window state cannot be verified in this build, so
    // it is 'unknown' — and unknown BLOCKS (spec: "a private browser window
    // is active or its privacy state is unknown"). Browsers are therefore
    // never sampled until a verified privacy signal lands.
    privateBrowser: isBrowser ? 'unknown' : false,
    // Screen-share detection is a real-machine pass; sharing surfaces are
    // additionally protected by the OS returning blanked frames.
    screenShareActive: false,
    protectedMediaActive: false,
    displayId: null,
  }
}

async function frameStoreKey(): Promise<Uint8Array> {
  const keytar = getSecureStore()
  if (!keytar) throw new Error('The OS secure store is unavailable, so encrypted frame storage cannot be set up.')
  const existing = await keytar.getPassword(KEYTAR_SERVICE, FRAME_KEY_ACCOUNT)
  if (existing) {
    const key = Buffer.from(existing, 'base64')
    if (key.length === 32) return key
  }
  const fresh = randomBytes(32)
  await keytar.setPassword(KEYTAR_SERVICE, FRAME_KEY_ACCOUNT, fresh.toString('base64'))
  return fresh
}

function syncSamplerToConsent(): void {
  if (!sampler) return
  const settings = getSettings()
  if (settings.screenContextExperimentEnabled === true) sampler.start()
  else sampler.stop()
  sampler.publishActive()
}

async function initScreenContextExperiment(): Promise<void> {
  try {
    const key = await frameStoreKey()
    const samplerSupported = SUPPORTED_SAMPLER_PLATFORMS.includes(process.platform)
    setScreenContextExperimentDeps({
      frameStore: createEncryptedFrameStore({
        directory: path.join(app.getPath('userData'), 'screen-context', 'frames'),
        key,
      }),
      extractor: noExtractorInstalled,
      measure,
      samplerInstalled: samplerSupported,
      getSamplerState: () => ({
        active: sampler?.active === true,
        kind: samplerSupported ? (sampler?.sourceKind ?? null) : null,
      }),
    })

    if (samplerSupported) {
      try {
        powerMonitor.on('lock-screen', () => { machineLocked = true })
        powerMonitor.on('unlock-screen', () => { machineLocked = false })
        powerMonitor.on('suspend', () => { machineAsleep = true })
        powerMonitor.on('resume', () => { machineAsleep = false })
      } catch { /* diagnostics-only environments */ }
      sampler = new ScreenContextSampler({
        lifecycle: getScreenContextLifecycleForSampler(getDb())!,
        getSettings,
        getForeground: productionForeground,
        getEnvironment: productionEnvironment,
        source: createElectronScreenFrameSource(),
        onActiveChange: (active) => setTrayScreenSamplingIndicator(active),
      })
      syncSamplerToConsent()
    }

    // Crash recovery on startup (spec §Privacy and deletion): orphan files
    // and interrupted lifecycles are restored or closed out honestly.
    await recoverScreenContextOnStartup(getDb())
  } catch (error) {
    setScreenContextExperimentUnavailable(
      error instanceof Error ? error.message : 'Screen-context storage could not be set up on this machine.',
    )
  }
}

export function registerScreenContextHandlers(): void {
  void initScreenContextExperiment()

  ipcMain.handle(IPC.SCREEN_CONTEXT.STATUS, () => getScreenContextStatus(getDb()))

  ipcMain.handle(IPC.SCREEN_CONTEXT.ENABLE, async () => {
    const result = await enableScreenContextExperiment(getDb())
    syncSamplerToConsent()
    return { ...result, status: getScreenContextStatus(getDb()) }
  })

  ipcMain.handle(IPC.SCREEN_CONTEXT.SET_PAUSED, async (_e, paused: boolean) => {
    const result = await setScreenContextPaused(getDb(), Boolean(paused))
    syncSamplerToConsent()
    return { ...result, status: getScreenContextStatus(getDb()) }
  })

  ipcMain.handle(IPC.SCREEN_CONTEXT.REVOKE, async (_e, payload: { wipeEverything?: boolean } = {}) => {
    const result = await revokeScreenContextExperiment(getDb(), { wipeEverything: Boolean(payload?.wipeEverything) })
    syncSamplerToConsent()
    return { ...result, status: getScreenContextStatus(getDb()) }
  })

  ipcMain.handle(IPC.SCREEN_CONTEXT.LIST_BACKLOG, () => listScreenContextBacklog(getDb()))

  ipcMain.handle(IPC.SCREEN_CONTEXT.RETRY_FRAME, (_e, frameId: string) =>
    retryScreenContextFrame(getDb(), String(frameId)))

  ipcMain.handle(IPC.SCREEN_CONTEXT.DELETE_FRAME, (_e, frameId: string) =>
    deleteScreenContextFrame(getDb(), String(frameId)))

  ipcMain.handle(IPC.SCREEN_CONTEXT.DELETE_FOR_SOURCE, (_e, source: string) =>
    deleteScreenContextForSource(getDb(), String(source)))

  ipcMain.handle(IPC.SCREEN_CONTEXT.WIPE, () => wipeScreenContext(getDb()))

  ipcMain.handle(IPC.SCREEN_CONTEXT.DIAGNOSTIC_SAMPLE, async () => {
    if (!sampler) {
      return { captured: false, reason: 'No screen sampler is available on this platform.' }
    }
    return sampler.requestDiagnosticSample()
  })
}
