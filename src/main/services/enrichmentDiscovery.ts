// Enrichment discovery (wrapped Stage 0.2) — optional local sources beyond
// Daylens' own tracking: MCP servers configured for Claude Desktop, and known
// focus-timer apps installed on this machine.
//
// Discovery only. This module never launches an MCP server, never calls a
// tool, and never spawns a subprocess. It reads a JSON config file and probes
// the filesystem for known app bundles/containers, nothing else. Every path
// is best-effort and silent: a missing file, a malformed config, or an
// unreadable store returns an empty/null result, never a thrown error.
//
// Server command arguments, paths, and env values are deliberately never
// surfaced here (they can carry tokens/secrets) — only the server name and
// transport kind leave this module.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FocusAppSignal } from '@shared/types'

export interface McpServerDiscovery {
  /** Server key from the config ("notion", "linear", "jira"). */
  name: string
  /** 'stdio' when a command is configured, 'http' when a url is. */
  transport: 'stdio' | 'http' | 'unknown'
}

export interface FocusAppDiscovery {
  app: string // "Raycast Focus" | "Be Focused" | "Session"
  installed: boolean
}

/** Where a discovery scan should look. Every field is optional and defaults
 *  to the real machine so tests can point at a temp directory structure. */
export interface FocusAppRoots {
  homeDir?: string
  /** Directories that may each contain a top-level .app bundle. */
  applicationsDirs?: string[]
  /** The `~/Library/Containers` equivalent, for Mac App Store sandboxed apps. */
  containersDir?: string
}

type RawSessionRecord = Record<string, unknown>
type ParsedSession = FocusAppSignal['sessions'][number]

/** Path to the Claude Desktop MCP config for this platform. Injectable via
 *  the arguments so tests can point at a temp fixture. */
export function claudeDesktopConfigPath(
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
  appData: string | undefined = process.env.APPDATA,
): string {
  if (platform === 'win32') {
    const base = appData && appData.length > 0 ? appData : path.join(homeDir, 'AppData', 'Roaming')
    return path.join(base, 'Claude', 'claude_desktop_config.json')
  }
  return path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
}

/** Installed MCP servers from the Claude Desktop config. Discovery ONLY —
 *  never launches or calls them. Empty array when no config exists. */
export function discoverMcpServers(configPath: string = claudeDesktopConfigPath()): McpServerDiscovery[] {
  let raw: string
  try {
    raw = fs.readFileSync(configPath, 'utf8')
  } catch {
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  if (!parsed || typeof parsed !== 'object') return []
  const servers = (parsed as Record<string, unknown>).mcpServers
  if (!servers || typeof servers !== 'object') return []

  const result: McpServerDiscovery[] = []
  for (const [name, value] of Object.entries(servers as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      result.push({ name, transport: 'unknown' })
      continue
    }
    const entry = value as Record<string, unknown>
    if (typeof entry.command === 'string' && entry.command.length > 0) {
      result.push({ name, transport: 'stdio' })
    } else if (typeof entry.url === 'string' && entry.url.length > 0) {
      result.push({ name, transport: 'http' })
    } else {
      result.push({ name, transport: 'unknown' })
    }
  }
  return result
}

function defaultFocusAppRoots(homeDir: string): Required<Omit<FocusAppRoots, 'homeDir'>> {
  return {
    applicationsDirs: ['/Applications', path.join(homeDir, 'Applications')],
    containersDir: path.join(homeDir, 'Library', 'Containers'),
  }
}

function appBundleExists(dirs: string[], bundleName: string): boolean {
  return dirs.some((dir) => {
    try {
      return fs.existsSync(path.join(dir, bundleName))
    } catch {
      return false
    }
  })
}

function containerMatches(containersDir: string, patterns: RegExp[]): boolean {
  try {
    const entries = fs.readdirSync(containersDir)
    return entries.some((entry) => patterns.some((re) => re.test(entry)))
  } catch {
    return false
  }
}

/** Which known focus tools are installed on this machine. Windows returns []
 *  for now — none of the known tools are cross-platform detected yet. */
export function detectFocusApps(roots: FocusAppRoots = {}): FocusAppDiscovery[] {
  if (process.platform === 'win32') return []

  const homeDir = roots.homeDir ?? os.homedir()
  const defaults = defaultFocusAppRoots(homeDir)
  const applicationsDirs = roots.applicationsDirs ?? defaults.applicationsDirs
  const containersDir = roots.containersDir ?? defaults.containersDir

  const raycastInstalled = appBundleExists(applicationsDirs, 'Raycast.app')
  const beFocusedInstalled =
    appBundleExists(applicationsDirs, 'Be Focused.app') ||
    containerMatches(containersDir, [/\.BeFocused/i, /^com\.xwavesoft\.befocused/i])
  const sessionInstalled = appBundleExists(applicationsDirs, 'Session.app')

  return [
    { app: 'Raycast Focus', installed: raycastInstalled },
    { app: 'Be Focused', installed: beFocusedInstalled },
    { app: 'Session', installed: sessionInstalled },
  ]
}

/** "2:30pm" style: lowercase, no leading zero, no ":00" on the hour. */
function clock(ms: number): string {
  return new Date(ms)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(':00', '')
    .replace(' ', '')
    .toLowerCase()
}

function localDateKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const SESSION_ARRAY_KEYS = ['sessions', 'focusSessions', 'items', 'history']
const START_KEYS = ['start', 'startTime', 'startedAt', 'date', 'timestamp', 'ts']
const DURATION_KEYS = ['duration', 'durationMinutes', 'minutes', 'lengthMinutes']
const LABEL_KEYS = ['label', 'title', 'name', 'project']

function firstOf(obj: RawSessionRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key]
  }
  return undefined
}

/** Best-effort epoch-ms coercion: numbers are treated as ms (or seconds, if
 *  clearly too small to be ms) and strings are parsed as dates. */
function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000
  }
  if (typeof value === 'string') {
    const parsedMs = Date.parse(value)
    return Number.isFinite(parsedMs) ? parsedMs : null
  }
  return null
}

/** A store's shape is unknown ahead of time, so this accepts either a bare
 *  array of session-like records or an object with a plausibly-named array
 *  property. Anything else yields no sessions — never a throw. */
function extractSessionArray(parsed: unknown): RawSessionRecord[] {
  const isRecord = (x: unknown): x is RawSessionRecord => !!x && typeof x === 'object'
  if (Array.isArray(parsed)) return parsed.filter(isRecord)
  if (parsed && typeof parsed === 'object') {
    for (const key of SESSION_ARRAY_KEYS) {
      const value = (parsed as Record<string, unknown>)[key]
      if (Array.isArray(value)) return value.filter(isRecord)
    }
  }
  return []
}

/** Reads one candidate JSON store and returns the sessions that overlap the
 *  given local date. Missing file, malformed JSON, or an unrecognized shape
 *  all silently yield []. */
function parseSessionsForDate(jsonPath: string, date: string): ParsedSession[] {
  let raw: string
  try {
    raw = fs.readFileSync(jsonPath, 'utf8')
  } catch {
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  const sessions: ParsedSession[] = []
  for (const record of extractSessionArray(parsed)) {
    const startMs = toEpochMs(firstOf(record, START_KEYS))
    if (startMs === null || localDateKey(startMs) !== date) continue
    const durationRaw = firstOf(record, DURATION_KEYS)
    const labelRaw = firstOf(record, LABEL_KEYS)
    sessions.push({
      startClock:       clock(startMs),
      durationMinutes:  typeof durationRaw === 'number' ? durationRaw : null,
      label:            typeof labelRaw === 'string' ? labelRaw : null,
    })
  }
  return sessions
}

/** Plausible local-store locations per known focus app. Store formats are not
 *  documented, so these are best guesses — parsing is a bonus, not a
 *  requirement (see parseSessionsForDate's silent fallbacks). */
function candidateStorePaths(app: string, homeDir: string): string[] {
  switch (app) {
    case 'Raycast Focus':
      return [
        path.join(homeDir, 'Library', 'Application Support', 'com.raycast.macos', 'focus-sessions.json'),
        path.join(homeDir, 'Library', 'Application Support', 'com.raycast.macos', 'extensions', 'focus', 'sessions.json'),
      ]
    case 'Be Focused':
      return [
        path.join(homeDir, 'Library', 'Application Support', 'Be Focused', 'sessions.json'),
      ]
    case 'Session':
      return [
        path.join(homeDir, 'Library', 'Application Support', 'Session', 'sessions.json'),
      ]
    default:
      return []
  }
}

/** Focus sessions for a local date (YYYY-MM-DD) read from installed focus
 *  apps' local stores, when readable. Presence with unreadable logs yields a
 *  FocusAppSignal with sessions: []. Null when no focus app is installed. */
export async function collectFocusAppSignals(
  date: string,
  roots: FocusAppRoots = {},
): Promise<FocusAppSignal[] | null> {
  const installedApps = detectFocusApps(roots).filter((entry) => entry.installed)
  if (installedApps.length === 0) return null

  const homeDir = roots.homeDir ?? os.homedir()
  return installedApps.map(({ app }): FocusAppSignal => {
    let sessions: ParsedSession[] = []
    for (const storePath of candidateStorePaths(app, homeDir)) {
      const parsed = parseSessionsForDate(storePath, date)
      if (parsed.length > 0) {
        sessions = parsed
        break
      }
    }
    return { app, sessions }
  })
}
