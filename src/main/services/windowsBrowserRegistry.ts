import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserApplication, BrowserCandidate, BrowserFamily, BrowserHistoryLocation } from './browserRegistry'

export type { BrowserApplication, BrowserCandidate, BrowserFamily, BrowserHistoryLocation }

const REGISTRY_CACHE_MS = 60_000
const HISTORY_CACHE_MS = 5 * 60_000
const MAX_HISTORY_SCAN_DEPTH = 6
const SKIPPED_SCAN_DIRECTORIES = new Set([
  'cache',
  'caches',
  'code cache',
  'gpucache',
  'indexeddb',
  'local storage',
  'service worker',
  'session storage',
  'storage',
])

let registryCache: { readAt: number; applications: BrowserApplication[] } | null = null
let historyCache: { readAt: number; locations: BrowserHistoryLocation[] } | null = null

function unique<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = keyFor(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizedPath(value: string): string {
  try {
    return path.resolve(value).toLowerCase()
  } catch {
    return value.toLowerCase()
  }
}

function exeBaseName(exePath: string): string {
  const normalized = exePath.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  const base = parts[parts.length - 1] ?? exePath
  return base.toLowerCase()
}

function bundleIdForExe(exePath: string): string {
  const base = exeBaseName(exePath)
  return base.endsWith('.exe') ? base : `${base}.exe`
}

export function classifyWindowsBrowserFamily(exePath: string, displayName: string): BrowserFamily {
  const haystack = `${exePath} ${displayName}`.toLowerCase()
  if (/(firefox|waterfox|librewolf|zen|palemoon|floorp)/.test(haystack)) return 'firefox'
  if (/(safari|webkit)/.test(haystack)) return 'webkit'
  return 'chromium'
}

function parseRegQueryOutput(output: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('HKEY_') || trimmed.startsWith('End of')) continue
    const match = trimmed.match(/^(\S+)\s+REG_\w+\s+(.*)$/)
    if (!match) continue
    values.set(match[1].trim(), match[2].trim())
  }
  return values
}

function queryRegistry(key: string): Map<string, string> {
  if (process.platform !== 'win32') return new Map()
  try {
    const output = execFileSync('reg', ['query', key], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
      windowsHide: true,
    })
    return parseRegQueryOutput(output)
  } catch {
    return new Map()
  }
}

function listRegistrySubkeys(key: string): string[] {
  if (process.platform !== 'win32') return []
  try {
    const output = execFileSync('reg', ['query', key], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
      windowsHide: true,
    })
    const subkeys: string[] = []
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('End of')) continue
      if (trimmed.startsWith('HKEY_')) {
        const parts = trimmed.split('\\')
        const last = parts[parts.length - 1]
        if (last && !last.includes(' ')) subkeys.push(last)
      }
    }
    return unique(subkeys, (value) => value.toLowerCase())
  } catch {
    return []
  }
}

function parseCommandExe(command: string): string | null {
  const trimmed = command.trim()
  if (!trimmed) return null
  const quoted = trimmed.match(/^"([^"]+)"/)
  if (quoted) return quoted[1]
  const first = trimmed.split(/\s+/)[0]
  return first || null
}


export function parseStartMenuInternetDump(dump: string): BrowserApplication[] {
  const applications: BrowserApplication[] = []
  const lines = dump.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

  let currentName: string | null = null
  let expectingCommand = false

  for (const line of lines) {
    if (line.includes('StartMenuInternet\\') && line.endsWith('\\shell\\open\\command')) {
      expectingCommand = true
      continue
    }
    if (line.includes('StartMenuInternet\\')) {
      expectingCommand = false
      currentName = null
      continue
    }

    const defaultMatch = line.match(/^\(default\)\s+REG_\w+\s+(.+)$/i)
    if (!defaultMatch) continue

    if (expectingCommand) {
      const exePath = parseCommandExe(defaultMatch[1])
      if (!exePath) {
        expectingCommand = false
        continue
      }
      const name = currentName ?? path.basename(exePath, '.exe')
      applications.push({
        name,
        bundleId: bundleIdForExe(exePath),
        appPath: exePath,
        family: classifyWindowsBrowserFamily(exePath, name),
        source: 'launch_services',
      })
      expectingCommand = false
      currentName = null
      continue
    }

    currentName = defaultMatch[1].trim()
  }

  return unique(applications, (app) => app.bundleId.toLowerCase())
}

function readStartMenuInternetBrowsers(): BrowserApplication[] {
  if (process.platform !== 'win32') return []

  const applications: BrowserApplication[] = []
  const root = 'HKCU\\Software\\Clients\\StartMenuInternet'
  for (const progId of listRegistrySubkeys(root)) {
    const name = queryRegistry(`${root}\\${progId}`).get('(Default)') ?? progId
    const command = queryRegistry(`${root}\\${progId}\\shell\\open\\command`).get('(Default)')
    if (!command) continue
    const exePath = parseCommandExe(command)
    if (!exePath || !fs.existsSync(exePath)) continue
    applications.push({
      name,
      bundleId: bundleIdForExe(exePath),
      appPath: exePath,
      family: classifyWindowsBrowserFamily(exePath, name),
      source: 'launch_services',
    })
  }

  return unique(applications, (app) => app.bundleId.toLowerCase())
}

function scanForHistoryFiles(root: string): string[] {
  const found: string[] = []
  const visit = (directory: string, depth: number) => {
    if (depth > MAX_HISTORY_SCAN_DEPTH) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isFile() && (entry.name === 'History' || entry.name === 'places.sqlite')) {
        found.push(fullPath)
        continue
      }
      if (!entry.isDirectory() || SKIPPED_SCAN_DIRECTORIES.has(entry.name.toLowerCase())) continue
      visit(fullPath, depth + 1)
    }
  }

  visit(root, 0)
  return found
}

function profileIdForHistoryPath(historyPath: string): string {
  const parent = path.basename(path.dirname(historyPath))
  if (/^default$/i.test(parent)) return 'default'
  if (/^profile \d+$/i.test(parent)) return parent
  return parent || 'default'
}

function historyPathMatchesFamily(historyPath: string, family: BrowserFamily): boolean {
  const base = path.basename(historyPath)
  if (family === 'firefox') return base === 'places.sqlite'
  return base === 'History'
}

function appDataRootsForBrowser(application: BrowserApplication, home = os.homedir()): string[] {
  const local = path.join(home, 'AppData', 'Local')
  const roaming = path.join(home, 'AppData', 'Roaming')
  const exeBase = path.basename(application.appPath, '.exe').toLowerCase()
  const nameToken = application.name.toLowerCase().replace(/[^a-z0-9]+/g, '')

  const roots = new Set<string>()
  const consider = (candidate: string) => {
    if (fs.existsSync(candidate)) roots.add(candidate)
  }

  if (application.family === 'firefox') {
    consider(path.join(roaming, 'Mozilla', 'Firefox'))
    consider(path.join(roaming, exeBase))
    consider(path.join(roaming, 'zen'))
    consider(path.join(roaming, 'Zen'))
  } else {
    consider(path.join(local, application.name))
    consider(path.join(local, application.name, 'User Data'))
    consider(path.join(local, exeBase))
    consider(path.join(local, exeBase, 'User Data'))
    if (nameToken.includes('chrome')) consider(path.join(local, 'Google', 'Chrome', 'User Data'))
    if (nameToken.includes('edge')) consider(path.join(local, 'Microsoft', 'Edge', 'User Data'))
    if (nameToken.includes('brave')) consider(path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'))
    if (nameToken.includes('arc')) {
      consider(path.join(local, 'Arc', 'User Data'))
      consider(path.join(local, 'The Browser Company', 'Arc', 'User Data'))
    }
    if (nameToken.includes('dia')) {
      consider(path.join(local, 'Dia', 'User Data'))
      consider(path.join(local, 'The Browser Company', 'Dia', 'User Data'))
    }
    if (nameToken.includes('comet')) {
      consider(path.join(local, 'Comet', 'User Data'))
      consider(path.join(local, 'Perplexity', 'Comet', 'User Data'))
    }
  }

  const exeDir = path.dirname(application.appPath)
  consider(path.join(exeDir, 'User Data'))

  return [...roots]
}

function discoverWindowsBrowserHistoryLocations(
  applications = getWindowsBrowserApplications(),
  home = os.homedir(),
): BrowserHistoryLocation[] {
  const locations: BrowserHistoryLocation[] = []

  for (const application of applications) {
    const historyPaths = unique(
      appDataRootsForBrowser(application, home).flatMap((root) => scanForHistoryFiles(root)),
      normalizedPath,
    )
    for (const historyPath of historyPaths) {
      if (!historyPathMatchesFamily(historyPath, application.family)) continue
      locations.push({
        ...application,
        historyPath,
        profileId: profileIdForHistoryPath(historyPath),
      })
    }
  }

  return unique(locations, (location) => normalizedPath(location.historyPath))
}

function refreshWindowsBrowserRegistry(): BrowserApplication[] {
  if (process.platform !== 'win32') {
    registryCache = { readAt: Date.now(), applications: [] }
    historyCache = null
    return []
  }
  const applications = readStartMenuInternetBrowsers()
  registryCache = { readAt: Date.now(), applications }
  historyCache = null
  return applications
}

function getWindowsBrowserApplications(): BrowserApplication[] {
  if (process.platform !== 'win32') return []
  if (!registryCache || Date.now() - registryCache.readAt >= REGISTRY_CACHE_MS) {
    return refreshWindowsBrowserRegistry()
  }
  return registryCache.applications
}

export function getWindowsBrowserHistoryLocations(): BrowserHistoryLocation[] {
  if (process.platform !== 'win32') return []
  if (!historyCache || Date.now() - historyCache.readAt >= HISTORY_CACHE_MS) {
    historyCache = {
      readAt: Date.now(),
      locations: discoverWindowsBrowserHistoryLocations(),
    }
  }
  return historyCache.locations
}

function candidateMatchesApplication(candidate: BrowserCandidate, application: BrowserApplication): boolean {
  const bundleId = candidate.bundleId?.trim().toLowerCase()
  if (bundleId && bundleId === application.bundleId.toLowerCase()) return true
  if (bundleId && bundleId === path.basename(application.appPath).toLowerCase()) return true

  const candidatePath = candidate.executablePath?.trim()
  if (candidatePath && normalizedPath(candidatePath) === normalizedPath(application.appPath)) return true

  const haystack = `${candidate.bundleId ?? ''} ${candidate.appName ?? ''} ${candidate.executablePath ?? ''}`.toLowerCase()
  const tokens = [
    application.name,
    path.basename(application.appPath, '.exe'),
    application.bundleId.replace(/\.exe$/i, ''),
  ].map((value) => value.toLowerCase())
  return tokens.some((token) => token.length >= 3 && haystack.includes(token))
}

export function resolveWindowsBrowserApplication(candidate: BrowserCandidate): BrowserApplication | null {
  if (process.platform !== 'win32') return null
  return getWindowsBrowserApplications().find((application) => candidateMatchesApplication(candidate, application)) ?? null
}

export function isWindowsBrowserApplication(candidate: BrowserCandidate): boolean {
  return resolveWindowsBrowserApplication(candidate) !== null
}
