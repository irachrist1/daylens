import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserApplication, BrowserCandidate, BrowserFamily, BrowserHistoryLocation } from './browserRegistry'

export type { BrowserApplication, BrowserCandidate, BrowserFamily, BrowserHistoryLocation }

const REGISTRY_CACHE_MS = 60_000
const HISTORY_CACHE_MS = 5 * 60_000
const MAX_HISTORY_SCAN_DEPTH = 6
const EXEC_WRAPPERS = new Set(['env', 'flatpak', 'snap', 'gtk-launch', 'sh', 'bash', 'dbus-run-session'])
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
let desktopApplicationsDirsOverride: string[] | null = null

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

function cleanToken(value: string): string {
  return value
    .replace(/^"+|"+$/g, '')
    .replace(/^'+|'+$/g, '')
    .trim()
}

function execCandidateTokens(exec: string | null): string[] {
  if (!exec) return []

  const parts = exec
    .replace(/%[fFuUdDnNickvm]/g, ' ')
    .split(/\s+/)
    .map(cleanToken)
    .filter(Boolean)

  const tokens: string[] = []
  for (const part of parts) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(part)) continue
    if (EXEC_WRAPPERS.has(part)) continue
    if (part.startsWith('-')) continue
    tokens.push(part)
  }

  return tokens
}

function resolveExecBinary(exec: string | null): string | null {
  const tokens = execCandidateTokens(exec)
  return tokens.find((token) => token.startsWith('/') || token.includes('/')) ?? tokens[0] ?? null
}

function desktopApplicationsDirs(): string[] {
  if (desktopApplicationsDirsOverride) return desktopApplicationsDirsOverride
  const home = os.homedir()
  return [
    path.join(home, '.local/share/applications'),
    path.join(home, '.local/share/flatpak/exports/share/applications'),
    '/usr/local/share/applications',
    '/usr/share/applications',
    '/var/lib/flatpak/exports/share/applications',
    '/var/lib/snapd/desktop/applications',
  ]
}

interface ParsedDesktopEntry {
  name: string
  exec: string | null
  filePath: string
  desktopId: string
}

function isBrowserDesktopEntry(fields: Map<string, string>): boolean {
  const mime = (fields.get('MimeType') ?? '').toLowerCase()
  if (mime.includes('text/html')) return true
  if (mime.includes('x-scheme-handler/http')) return true
  if (mime.includes('x-scheme-handler/https')) return true
  const categories = (fields.get('Categories') ?? '').toLowerCase()
  return categories.includes('webbrowser')
}

function parseDesktopEntryFile(filePath: string): ParsedDesktopEntry | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const lines = raw.split(/\r?\n/)
    let inDesktopEntry = false
    const fields = new Map<string, string>()

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      if (trimmed === '[Desktop Entry]') {
        inDesktopEntry = true
        continue
      }
      if (trimmed.startsWith('[') && trimmed !== '[Desktop Entry]') {
        if (inDesktopEntry) break
        continue
      }
      if (!inDesktopEntry) continue
      const idx = trimmed.indexOf('=')
      if (idx <= 0) continue
      fields.set(trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim())
    }

    if (fields.get('Type') !== 'Application') return null
    if (fields.get('NoDisplay') === 'true' || fields.get('Hidden') === 'true') return null
    if (!isBrowserDesktopEntry(fields)) return null

    const name = fields.get('Name')?.trim()
    if (!name) return null

    return {
      name,
      exec: fields.get('Exec')?.trim() || null,
      filePath,
      desktopId: path.basename(filePath, '.desktop'),
    }
  } catch {
    return null
  }
}

export function classifyLinuxBrowserFamily(exePath: string, displayName: string): BrowserFamily {
  const haystack = `${exePath} ${displayName}`.toLowerCase()
  if (/(firefox|waterfox|librewolf|zen|palemoon|floorp|tor browser)/.test(haystack)) return 'firefox'
  if (/(epiphany|midori|surf|webkit)/.test(haystack)) return 'webkit'
  return 'chromium'
}

function bundleIdForExe(exePath: string): string {
  const base = path.basename(exePath).toLowerCase()
  return base.endsWith('.exe') ? base : base
}

export function readLinuxDesktopBrowsers(
  dirs: string[] = desktopApplicationsDirs(),
): BrowserApplication[] {
  const applications: BrowserApplication[] = []

  for (const dir of dirs) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.desktop')) continue
      const parsed = parseDesktopEntryFile(path.join(dir, entry.name))
      if (!parsed) continue

      const exePath = resolveExecBinary(parsed.exec)
      if (!exePath) continue

      applications.push({
        name: parsed.name,
        bundleId: bundleIdForExe(exePath),
        appPath: exePath,
        family: classifyLinuxBrowserFamily(exePath, parsed.name),
        source: 'launch_services',
      })
    }
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

function configRootsForBrowser(application: BrowserApplication, home = os.homedir()): string[] {
  const roots = new Set<string>()
  const consider = (candidate: string) => {
    if (fs.existsSync(candidate)) roots.add(candidate)
  }

  const exeBase = path.basename(application.appPath).toLowerCase()
  const nameToken = application.name.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const config = path.join(home, '.config')
  const mozilla = path.join(home, '.mozilla')
  const zen = path.join(home, '.zen')
  const varApp = path.join(home, '.var', 'app')
  const snapCommon = path.join(home, 'snap')

  if (application.family === 'firefox') {
    consider(path.join(mozilla, 'firefox'))
    consider(zen)
    consider(path.join(config, 'zen'))
    consider(path.join(varApp, 'org.mozilla.firefox', '.mozilla', 'firefox'))
    consider(path.join(varApp, 'io.gitlab.zen_browser.zen', '.zen'))
    consider(path.join(snapCommon, 'firefox', 'common', '.mozilla', 'firefox'))
    consider(path.join(snapCommon, exeBase.replace(/\.exe$/, ''), 'common', '.mozilla', 'firefox'))
  } else {
    if (nameToken.includes('chrome') || exeBase.includes('chrome')) {
      consider(path.join(config, 'google-chrome'))
      consider(path.join(varApp, 'com.google.Chrome', 'config', 'google-chrome'))
      consider(path.join(snapCommon, 'chromium', 'common', 'chromium'))
    }
    if (nameToken.includes('chromium') || exeBase.includes('chromium')) {
      consider(path.join(config, 'chromium'))
      consider(path.join(varApp, 'org.chromium.Chromium', 'config', 'chromium'))
      consider(path.join(snapCommon, 'chromium', 'common', 'chromium'))
    }
    if (nameToken.includes('brave') || exeBase.includes('brave')) {
      consider(path.join(config, 'BraveSoftware', 'Brave-Browser'))
      consider(path.join(varApp, 'com.brave.Browser', 'config', 'BraveSoftware', 'Brave-Browser'))
    }
    if (nameToken.includes('edge') || exeBase.includes('edge') || exeBase.includes('microsoft-edge')) {
      consider(path.join(config, 'microsoft-edge'))
      consider(path.join(varApp, 'com.microsoft.Edge', 'config', 'microsoft-edge'))
    }
    if (nameToken.includes('opera') || exeBase.includes('opera')) {
      consider(path.join(config, 'opera'))
    }
    if (nameToken.includes('vivaldi') || exeBase.includes('vivaldi')) {
      consider(path.join(config, 'vivaldi'))
    }
    if (nameToken.includes('arc') || exeBase.includes('arc')) {
      consider(path.join(config, 'Arc'))
      consider(path.join(config, 'arc'))
    }
    if (nameToken.includes('zen') || exeBase.includes('zen')) {
      consider(zen)
      consider(path.join(config, 'zen'))
      consider(path.join(varApp, 'io.gitlab.zen_browser.zen', '.zen'))
    }

    consider(path.join(config, exeBase.replace(/\.exe$/, '')))
    consider(path.join(config, application.name))
  }

  return [...roots]
}

export function discoverLinuxBrowserHistoryLocations(
  applications = getLinuxBrowserApplications(),
  home = os.homedir(),
): BrowserHistoryLocation[] {
  const locations: BrowserHistoryLocation[] = []

  for (const application of applications) {
    const historyPaths = unique(
      configRootsForBrowser(application, home).flatMap((root) => scanForHistoryFiles(root)),
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

function refreshLinuxBrowserRegistry(): BrowserApplication[] {
  if (process.platform !== 'linux') {
    registryCache = { readAt: Date.now(), applications: [] }
    historyCache = null
    return []
  }
  const applications = readLinuxDesktopBrowsers()
  registryCache = { readAt: Date.now(), applications }
  historyCache = null
  return applications
}

function getLinuxBrowserApplications(): BrowserApplication[] {
  if (process.platform !== 'linux') return []
  if (!registryCache || Date.now() - registryCache.readAt >= REGISTRY_CACHE_MS) {
    return refreshLinuxBrowserRegistry()
  }
  return registryCache.applications
}

export function getLinuxBrowserHistoryLocations(): BrowserHistoryLocation[] {
  if (process.platform !== 'linux') return []
  if (!historyCache || Date.now() - historyCache.readAt >= HISTORY_CACHE_MS) {
    historyCache = {
      readAt: Date.now(),
      locations: discoverLinuxBrowserHistoryLocations(),
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
    path.basename(application.appPath),
    application.bundleId.replace(/\.exe$/i, ''),
  ].map((value) => value.toLowerCase())
  return tokens.some((token) => token.length >= 3 && haystack.includes(token))
}

export function resolveLinuxBrowserApplication(candidate: BrowserCandidate): BrowserApplication | null {
  if (process.platform !== 'linux') return null
  return getLinuxBrowserApplications().find((application) => candidateMatchesApplication(candidate, application)) ?? null
}

export function isLinuxBrowserApplication(candidate: BrowserCandidate): boolean {
  return resolveLinuxBrowserApplication(candidate) !== null
}

export function __setLinuxDesktopApplicationsDirsForTests(dirs: string[] | null): void {
  desktopApplicationsDirsOverride = dirs
  registryCache = null
  historyCache = null
}

export function __resetLinuxBrowserRegistryForTests(): void {
  desktopApplicationsDirsOverride = null
  registryCache = null
  historyCache = null
}
