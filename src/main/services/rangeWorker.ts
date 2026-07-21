// Client for the range-facts worker subprocess (DEV-227). Heavy multi-day
// Apps-view reads run in packages/range-worker on a read-only connection so
// the main process — the one drawing the screen — never blocks on them.
//
// Fail-open by design: if the worker is missing, crashed, or slow, callers
// fall back to running the same query inline (exactly what shipped before).
// The worker is an optimization, never a correctness dependency.
import { fork } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getSettings } from './settings'
import { isRealDayHarness } from '../lib/realDayHarness'
import type { AppSettings, LiveSession } from '@shared/types'

const REQUEST_TIMEOUT_MS = 30_000
const MAX_CRASHES = 3
const CRASH_WINDOW_MS = 5 * 60_000

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let _proc: ChildProcess | null = null
let _nextId = 1
const _pending = new Map<number, PendingRequest>()
const _crashTimes: number[] = []

function resolveWorkerPaths():
  | { serverPath: string; execArgv: string[] }
  | null {
  const root = app.getAppPath()

  if (app.isPackaged) {
    const bundlePath = path.join(root, 'dist', 'range-worker', 'index.cjs')
    if (fs.existsSync(bundlePath)) return { serverPath: bundlePath, execArgv: [] }
    return null
  }

  // Development: TypeScript source through the shared subprocess loader.
  const loaderPath = path.join(root, 'packages', 'mcp-server', 'loader.mjs')
  const serverPath = path.join(root, 'packages', 'range-worker', 'src', 'index.ts')
  if (!fs.existsSync(loaderPath) || !fs.existsSync(serverPath)) return null
  return { serverPath, execArgv: ['--loader', `file://${loaderPath}`] }
}

function workerDisabled(): boolean {
  const now = Date.now()
  while (_crashTimes.length > 0 && now - _crashTimes[0] > CRASH_WINDOW_MS) _crashTimes.shift()
  return _crashTimes.length >= MAX_CRASHES
}

function rejectAllPending(reason: string): void {
  for (const [, pending] of _pending) {
    clearTimeout(pending.timer)
    pending.reject(new Error(reason))
  }
  _pending.clear()
}

function ensureWorker(): ChildProcess | null {
  if (isRealDayHarness()) return null
  if (_proc && !_proc.killed) return _proc
  if (workerDisabled()) return null

  const paths = resolveWorkerPaths()
  if (!paths) return null

  const dbPath = path.join(app.getPath('userData'), 'daylens.sqlite')
  try {
    _proc = fork(paths.serverPath, [], {
      execArgv: paths.execArgv,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DAYLENS_DB_PATH: dbPath,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'json',
    })
  } catch (err) {
    console.error('[range-worker] failed to spawn:', err)
    _proc = null
    return null
  }

  _proc.stderr?.on('data', (chunk: Buffer) => {
    console.warn('[range-worker]', chunk.toString().trim())
  })
  _proc.on('message', (message: { id?: number; ok?: boolean; result?: unknown; error?: string; op?: string }) => {
    if (typeof message?.id !== 'number') return
    const pending = _pending.get(message.id)
    if (!pending) return
    _pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new Error(message.error ?? 'range worker error'))
  })
  _proc.on('error', (err) => {
    console.error('[range-worker] process error:', err)
    _crashTimes.push(Date.now())
    rejectAllPending('range worker errored')
    _proc = null
  })
  _proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`[range-worker] exited with code ${code}`)
      _crashTimes.push(Date.now())
    }
    rejectAllPending('range worker exited')
    _proc = null
  })

  console.log(`[range-worker] started (pid ${_proc.pid})`)
  return _proc
}

// Settings the worker's shared query actually reads. Kept minimal on purpose
// — the snapshot rides every request so worker facts always match main facts.
function settingsSnapshot(): Partial<AppSettings> {
  const settings = getSettings()
  return { focusApps: settings.focusApps }
}

async function runWorkerOp<T>(payload: Record<string, unknown>): Promise<T> {
  const proc = ensureWorker()
  if (!proc) throw new Error('range worker unavailable')
  const id = _nextId++
  const message = { id, settings: settingsSnapshot(), ...payload }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      _pending.delete(id)
      reject(new Error('range worker timed out'))
    }, REQUEST_TIMEOUT_MS)
    _pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
    proc.send(message, (err) => {
      if (err) {
        _pending.delete(id)
        clearTimeout(timer)
        reject(err)
      }
    })
  })
}

export async function workerAppSummaries<T>(
  fromMs: number,
  toMs: number,
  liveSession: LiveSession | null,
): Promise<T> {
  return runWorkerOp<T>({ op: 'appSummaries', fromMs, toMs, liveSession })
}

export async function workerAppDetail<T>(
  canonicalAppId: string,
  daysOrDate: number | string,
  liveSession: LiveSession | null,
): Promise<T> {
  return runWorkerOp<T>({ op: 'appDetail', canonicalAppId, daysOrDate, liveSession })
}

export function stopRangeWorker(): void {
  if (!_proc || _proc.killed) return
  const proc = _proc
  _proc = null
  rejectAllPending('range worker stopped')
  proc.kill('SIGTERM')
  const killTimer = setTimeout(() => {
    if (!proc.killed) proc.kill('SIGKILL')
  }, 5_000)
  proc.on('exit', () => clearTimeout(killTimer))
}
