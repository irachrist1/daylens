// Spawns the Windows UIA capture helper and appends NDJSON events to focus_events.
// Runs alongside tracking.ts on win32 only.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { shouldCaptureFocusEvent } from './focusCapture'
import { getDb } from './database'
import { getSettings } from './settings'
import { trackingControlsStateFromSettings } from '@shared/trackingControls'

const FOCUS_EVENT_SCHEMA_VERSION = 1
const FOCUS_EVENT_TYPES = [
  'app_activated',
  'app_deactivated',
  'window_changed',
  'space_changed',
  'sleep',
  'wake',
  'lock',
  'unlock',
  'tab_changed',
  'tab_sampled',
] as const
const FOCUS_EVENT_SOURCES = ['uia_foreground', 'uia_tab'] as const
const FOCUS_EVENT_CONFIDENCES = ['observed', 'unknown'] as const

type FocusEventType = typeof FOCUS_EVENT_TYPES[number]
type FocusEventSource = typeof FOCUS_EVENT_SOURCES[number]
type FocusEventConfidence = typeof FOCUS_EVENT_CONFIDENCES[number]

const FOCUS_EVENT_TYPE_SET = new Set<string>(FOCUS_EVENT_TYPES)
const FOCUS_EVENT_SOURCE_SET = new Set<string>(FOCUS_EVENT_SOURCES)
const FOCUS_EVENT_CONFIDENCE_SET = new Set<string>(FOCUS_EVENT_CONFIDENCES)
const FOREGROUND_EVENT_TYPES = new Set<FocusEventType>([
  'app_activated',
  'app_deactivated',
  'window_changed',
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
  const fileName = 'windows-capture-helper.exe'
  return app.isPackaged
    ? path.join(process.resourcesPath, 'build', fileName)
    : path.join(__dirname, '..', '..', 'build', fileName)
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

export function normalizeWindowsHelperEvent(raw: unknown): HelperEvent | null {
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

  if (typedSource === 'uia_foreground' && !FOREGROUND_EVENT_TYPES.has(typedEventType)) return null
  if (typedSource === 'uia_tab' && !TAB_EVENT_TYPES.has(typedEventType)) return null
  if (typedConfidence === 'unknown' && (url !== null || pageTitle !== null)) return null
  if (typedSource === 'uia_tab' && typedConfidence === 'observed' && !url) return null
  if (typedSource === 'uia_foreground' && (url !== null || pageTitle !== null)) return null

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
    platform: raw.platform ?? 'win32',
    schema_ver: FOCUS_EVENT_SCHEMA_VERSION,
  }
}

const FOCUS_FLUSH_INTERVAL_MS = 250
const FOCUS_FLUSH_MAX_BATCH = 100
let pendingEvents: HelperEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function eventParams(ev: HelperEvent): Record<string, unknown> {
  return {
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
    platform: ev.platform ?? 'win32',
    schema_ver: ev.schema_ver ?? 1,
  }
}

function flushFocusEvents(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (pendingEvents.length === 0) return
  const batch = pendingEvents
  pendingEvents = []
  try {
    const db = getDb()
    const stmt = db.prepare(
      `INSERT INTO focus_events
         (ts_ms, mono_ns, event_type, app_bundle_id, app_name, pid, window_title, url, page_title, source, confidence, platform, schema_ver)
       VALUES (@ts_ms, @mono_ns, @event_type, @app_bundle_id, @app_name, @pid, @window_title, @url, @page_title, @source, @confidence, @platform, @schema_ver)`
    )
    const insertAll = db.transaction((events: HelperEvent[]) => {
      for (const ev of events) stmt.run(eventParams(ev))
    })
    insertAll(batch)
  } catch (err) {
    console.warn('[windowsFocusCapture] batch insert failed:', err)
  }
}

function enqueueEvent(ev: HelperEvent): void {
  if (!shouldCaptureFocusEvent(ev, trackingControlsStateFromSettings(getSettings()))) return
  pendingEvents.push(ev)
  if (pendingEvents.length >= FOCUS_FLUSH_MAX_BATCH) {
    flushFocusEvents()
    return
  }
  if (!flushTimer) {
    flushTimer = setTimeout(flushFocusEvents, FOCUS_FLUSH_INTERVAL_MS)
  }
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
  const ev = normalizeWindowsHelperEvent(parsed)
  if (!ev) return
  enqueueEvent(ev)
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
    console.warn(`[windowsFocusCapture] helper not found at ${bin} — run "npm run build:capture-helper" on Windows`)
    return
  }

  let proc: ChildProcessWithoutNullStreams
  try {
    proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (err) {
    console.warn('[windowsFocusCapture] spawn failed:', err)
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
    if (msg) console.log('[windowsFocusCapture]', msg)
  })

  proc.on('error', (err) => {
    console.warn('[windowsFocusCapture] process error:', err)
  })

  proc.on('exit', (code, signal) => {
    if (child === proc) child = null
    if (shutdownKillTimer) {
      clearTimeout(shutdownKillTimer)
      shutdownKillTimer = null
    }
    if (stopping) return
    if (Date.now() - spawnedAt >= STABLE_UPTIME_MS) restartDelay = 1000
    console.warn(`[windowsFocusCapture] helper exited (code=${code} signal=${signal}); restarting`)
    scheduleRestart()
  })
}

export function startWindowsFocusCapture(): void {
  if (process.platform !== 'win32') return
  stopping = false
  spawnHelper()
}

export function stopWindowsFocusCapture(): void {
  if (process.platform !== 'win32') return
  stopping = true
  flushFocusEvents()
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
      proc.kill('SIGTERM')
    } catch {
      /* noop */
    }
    shutdownKillTimer = setTimeout(() => {
      shutdownKillTimer = null
      if (child !== proc) return
      try {
        proc.kill('SIGKILL')
      } catch {
        /* noop */
      }
      child = null
    }, SHUTDOWN_KILL_DELAY_MS)
  }
}

export function isWindowsFocusCaptureRunning(): boolean {
  return child !== null
}
