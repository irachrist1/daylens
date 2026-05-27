// Spawns the native capture helper (src/native/capture-helper) and appends its
// newline-delimited JSON events to focus_events. Runs alongside tracking.ts;
// it does not replace the existing capture path. macOS-only.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getDb } from './database'

interface HelperEvent {
  ts_ms: number
  mono_ns: number
  event_type: string
  app_bundle_id?: string | null
  app_name?: string | null
  pid?: number | null
  window_title?: string | null
  url?: string | null
  page_title?: string | null
  source: string
  confidence: string
  platform?: string | null
  schema_ver?: number | null
}

let child: ChildProcessWithoutNullStreams | null = null
let stopping = false
let restartTimer: ReturnType<typeof setTimeout> | null = null
let shutdownKillTimer: ReturnType<typeof setTimeout> | null = null
let restartDelay = 1000
let spawnedAt = 0
const MAX_RESTART_DELAY = 30_000
const STABLE_UPTIME_MS = 10_000
const SHUTDOWN_KILL_DELAY_MS = 1500

function helperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'capture-helper')
    : path.join(__dirname, '..', '..', 'build', 'capture-helper')
}

function insertEvent(ev: HelperEvent): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO focus_events
       (ts_ms, mono_ns, event_type, app_bundle_id, app_name, pid, window_title, url, page_title, source, confidence, platform, schema_ver)
     VALUES (@ts_ms, @mono_ns, @event_type, @app_bundle_id, @app_name, @pid, @window_title, @url, @page_title, @source, @confidence, @platform, @schema_ver)`
  ).run({
    ts_ms: ev.ts_ms,
    mono_ns: ev.mono_ns,
    event_type: ev.event_type,
    app_bundle_id: ev.app_bundle_id ?? null,
    app_name: ev.app_name ?? null,
    pid: ev.pid ?? null,
    window_title: ev.window_title ?? null,
    url: ev.url ?? null,
    page_title: ev.page_title ?? null,
    source: ev.source,
    confidence: ev.confidence,
    platform: ev.platform ?? 'darwin',
    schema_ver: ev.schema_ver ?? 1,
  })
}

function handleLine(line: string): void {
  const trimmed = line.trim()
  if (!trimmed) return
  let ev: HelperEvent
  try {
    ev = JSON.parse(trimmed) as HelperEvent
  } catch {
    return
  }
  if (!ev.event_type || !ev.source || !ev.confidence) return
  try {
    insertEvent(ev)
  } catch (err) {
    console.warn('[focusCapture] insert failed:', err)
  }
}

function scheduleRestart(): void {
  if (stopping || restartTimer) return
  restartTimer = setTimeout(() => {
    restartTimer = null
    restartDelay = Math.min(restartDelay * 2, MAX_RESTART_DELAY)
    spawnHelper()
  }, restartDelay)
}

function spawnHelper(): void {
  if (stopping || child) return

  const bin = helperPath()
  if (!fs.existsSync(bin)) {
    console.warn(`[focusCapture] helper not found at ${bin} — run "npm run build:capture-helper"`)
    return
  }

  let proc: ChildProcessWithoutNullStreams
  try {
    proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (err) {
    console.warn('[focusCapture] spawn failed:', err)
    scheduleRestart()
    return
  }
  child = proc
  spawnedAt = Date.now()

  let buffer = ''
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let nl = buffer.indexOf('\n')
    while (nl !== -1) {
      handleLine(buffer.slice(0, nl))
      buffer = buffer.slice(nl + 1)
      nl = buffer.indexOf('\n')
    }
  })

  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (chunk: string) => {
    const msg = chunk.trim()
    if (msg) console.log('[focusCapture]', msg)
  })

  proc.on('error', (err) => {
    console.warn('[focusCapture] process error:', err)
  })

  proc.on('exit', (code, signal) => {
    if (child === proc) child = null
    if (shutdownKillTimer) {
      clearTimeout(shutdownKillTimer)
      shutdownKillTimer = null
    }
    if (stopping) return
    // A run that stayed up resets the backoff; a fast crash escalates it.
    if (Date.now() - spawnedAt >= STABLE_UPTIME_MS) restartDelay = 1000
    console.warn(`[focusCapture] helper exited (code=${code} signal=${signal}); restarting`)
    scheduleRestart()
  })
}

export function startFocusCapture(): void {
  if (process.platform !== 'darwin') return
  stopping = false
  spawnHelper()
}

export function stopFocusCapture(): void {
  stopping = true
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (shutdownKillTimer) {
    clearTimeout(shutdownKillTimer)
    shutdownKillTimer = null
  }
  const proc = child
  if (proc) {
    try {
      proc.stdin.write('shutdown\n')
      proc.stdin.end()
    } catch {
      /* noop */
    }
    shutdownKillTimer = setTimeout(() => {
      shutdownKillTimer = null
      if (child !== proc) return
      try {
        proc.kill('SIGTERM')
      } catch {
        /* noop */
      }
      child = null
    }, SHUTDOWN_KILL_DELAY_MS)
  }
}
