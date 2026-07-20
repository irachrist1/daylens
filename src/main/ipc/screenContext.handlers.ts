// Screen-context experiment IPC (DEV-198). The renderer's Settings section
// talks to the experiment surface through these handlers: status, the consent
// decision, pause/resume, revoke, backlog/quarantine inspection with explicit
// Retry/Delete, per-source deletion offers, and the full wipe.
//
// Production wiring for the DEV-197 adapter seams:
//   - frame store: AES-256-GCM encrypted files under userData/screen-context,
//     key generated once and kept in the OS secure store (never on disk next
//     to the frames). No secure store → the experiment is honestly
//     unavailable, with the reason in status.
//   - extractor: no local extraction runtime ships in this build — the seam
//     refuses with a clear message instead of pretending. Frames therefore
//     quarantine visibly rather than silently "succeeding".
//   - OS capture sampler: none in this build (samplerInstalled: false); the
//     spec sequences real screen APIs after this surface, so consent prepares
//     the pipeline and the status says exactly that.
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { app, ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getDb } from '../services/database'
import { getSecureStore } from '../services/secureStore'
import { capture } from '../services/analytics'
import type { AnalyticsEventName } from '@shared/analytics'
import { createEncryptedFrameStore } from '../services/screenContext/encryptedFrameStore'
import type { ScreenFrameExtractor } from '../services/screenContext/types'
import type { ScreenContextMeasure } from '../services/screenContext/lifecycle'
import {
  deleteScreenContextFrame,
  deleteScreenContextForSource,
  enableScreenContextExperiment,
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

async function initScreenContextExperiment(): Promise<void> {
  try {
    const key = await frameStoreKey()
    setScreenContextExperimentDeps({
      frameStore: createEncryptedFrameStore({
        directory: path.join(app.getPath('userData'), 'screen-context', 'frames'),
        key,
      }),
      extractor: noExtractorInstalled,
      measure,
      samplerInstalled: false,
    })
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

  ipcMain.handle(IPC.SCREEN_CONTEXT.ENABLE, () => enableScreenContextExperiment(getDb()))

  ipcMain.handle(IPC.SCREEN_CONTEXT.SET_PAUSED, (_e, paused: boolean) =>
    setScreenContextPaused(getDb(), Boolean(paused)))

  ipcMain.handle(IPC.SCREEN_CONTEXT.REVOKE, (_e, payload: { wipeEverything?: boolean } = {}) =>
    revokeScreenContextExperiment(getDb(), { wipeEverything: Boolean(payload?.wipeEverything) }))

  ipcMain.handle(IPC.SCREEN_CONTEXT.LIST_BACKLOG, () => listScreenContextBacklog(getDb()))

  ipcMain.handle(IPC.SCREEN_CONTEXT.RETRY_FRAME, (_e, frameId: string) =>
    retryScreenContextFrame(getDb(), String(frameId)))

  ipcMain.handle(IPC.SCREEN_CONTEXT.DELETE_FRAME, (_e, frameId: string) =>
    deleteScreenContextFrame(getDb(), String(frameId)))

  ipcMain.handle(IPC.SCREEN_CONTEXT.DELETE_FOR_SOURCE, (_e, source: string) =>
    deleteScreenContextForSource(getDb(), String(source)))

  ipcMain.handle(IPC.SCREEN_CONTEXT.WIPE, () => wipeScreenContext(getDb()))
}
