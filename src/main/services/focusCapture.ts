// Spawns the native capture helper (src/native/capture-helper) and appends its
// newline-delimited JSON events to focus_events. Runs alongside tracking.ts;
// it does not replace the existing capture path. macOS-only.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getDb } from './database'
const FOCUS_EVENT_SCHEMA_VERSION = 1
const FOCUS_EVENT_TYPES = [
  'app_activated',
  'app_deactivated',
  'space_changed',
  'sleep',
  'wake',
  'lock',
  'unlock',
  'tab_changed',
  'tab_sampled',
] as const
const FOCUS_EVENT_SOURCES = ['nsworkspace_event', 'apple_events_tab'] as const
const FOCUS_EVENT_CONFIDENCES = ['observed', 'unknown'] as const

type FocusEventType = typeof FOCUS_EVENT_TYPES[number]
type FocusEventSource = typeof FOCUS_EVENT_SOURCES[number]
type FocusEventConfidence = typeof FOCUS_EVENT_CONFIDENCES[number]

const FOCUS_EVENT_TYPE_SET = new Set<string>(FOCUS_EVENT_TYPES)
const FOCUS_EVENT_SOURCE_SET = new Set<string>(FOCUS_EVENT_SOURCES)
const FOCUS_EVENT_CONFIDENCE_SET = new Set<string>(FOCUS_EVENT_CONFIDENCES)
const WORKSPACE_EVENT_TYPES = new Set<FocusEventType>([
  'app_activated',
  'app_deactivated',
  'space_changed',
  'sleep',
  'wake',
  'lock',
  'unlock',
])
const TAB_EVENT_TYPES = new Set<FocusEventType>(['tab_changed', 'tab_sampled'])

interface HelperEvent {
  ts_ms: number
  mono_ns: number
  event_type: FocusEventType
  app_bundle_id?: string | null
  app_name?: string | null
  pid?: number | null
  window_title?: string | null
  url?: string | null
  page_title?: string | null
  source: FocusEventSource
  confidence: FocusEventConfidence
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
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

function isNullableNumber(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value))
}

function normalizeHelperEvent(raw: unknown): HelperEvent | null {
  if (!isObject(raw)) return null
  const eventType = raw.event_type
  const source = raw.source
  const confidence = raw.confidence
  const schemaVersion = raw.schema_ver ?? FOCUS_EVENT_SCHEMA_VERSION
  if (typeof raw.ts_ms !== 'number' || !Number.isFinite(raw.ts_ms)) return null
  if (typeof raw.mono_ns !== 'number' || !Number.isFinite(raw.mono_ns)) return null
  if (typeof eventType !== 'string' || !FOCUS_EVENT_TYPE_SET.has(eventType)) return null
  if (typeof source !== 'string' || !FOCUS_EVENT_SOURCE_SET.has(source)) return null
  if (typeof confidence !== 'string' || !FOCUS_EVENT_CONFIDENCE_SET.has(confidence)) return null
  if (schemaVersion !== FOCUS_EVENT_SCHEMA_VERSION) return null
  if (!isNullableString(raw.app_bundle_id)) return null
  if (!isNullableString(raw.app_name)) return null
  if (!isNullableNumber(raw.pid)) return null
  if (!isNullableString(raw.window_title)) return null
  if (!isNullableString(raw.url)) return null
  if (!isNullableString(raw.page_title)) return null
  if (!isNullableString(raw.platform)) return null

  const typedEventType = eventType as FocusEventType
  const typedSource = source as FocusEventSource
  const typedConfidence = confidence as FocusEventConfidence
  const url = raw.url ?? null
  const pageTitle = raw.page_title ?? null

  if (typedSource === 'nsworkspace_event' && !WORKSPACE_EVENT_TYPES.has(typedEventType)) return null
  if (typedSource === 'apple_events_tab' && !TAB_EVENT_TYPES.has(typedEventType)) return null
  if (typedConfidence === 'unknown' && (url !== null || pageTitle !== null)) return null
  if (typedSource === 'apple_events_tab' && typedConfidence === 'observed' && !url) return null
  if (typedSource === 'nsworkspace_event' && (url !== null || pageTitle !== null)) return null

  return {
    ts_ms: raw.ts_ms,
    mono_ns: raw.mono_ns,
    event_type: typedEventType,
    app_bundle_id: raw.app_bundle_id ?? null,
    app_name: raw.app_name ?? null,
    pid: raw.pid ?? null,
    window_title: raw.window_title ?? null,
    url,
    page_title: pageTitle,
    source: typedSource,
    confidence: typedConfidence,
    platform: raw.platform ?? 'darwin',
    schema_ver: FOCUS_EVENT_SCHEMA_VERSION,
  }
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
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return
  }
  const ev = normalizeHelperEvent(parsed)
  if (!ev) return
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
