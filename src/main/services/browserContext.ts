import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import type BetterSqlite from 'better-sqlite3'
import { insertWebsiteVisit } from '../db/queries'
import { normalizeUrlForStorage, pageKeyForUrl, resolveCanonicalApp, resolveCanonicalBrowser } from '../lib/appIdentity'
import { invalidateProjectionScope } from '../core/projections/invalidation'
import { localDateString } from '../lib/localDate'
import { getBrowserEntries, type BrowserEntry } from './browser'

const MIN_CONTEXT_SEC = 5
const RECENT_HISTORY_LOOKBACK_MS = 2 * 60_000
const CHROME_OFFSET_US = 11_644_473_600_000_000n

const BROWSER_APP_IDS = new Set([
  'arc',
  'brave',
  'chrome',
  'chromium',
  'comet',
  'dia',
  'edge',
  'firefox',
  'opera',
  'safari',
  'vivaldi',
])

const MAC_SCRIPT_APP_NAMES: Record<string, string> = {
  arc: 'Arc',
  brave: 'Brave Browser',
  chrome: 'Google Chrome',
  comet: 'Comet',
  dia: 'Dia',
  edge: 'Microsoft Edge',
  firefox: 'Firefox',
  safari: 'Safari',
}

export interface ActiveBrowserWindowSnapshot {
  bundleId: string
  appName: string
  windowTitle: string | null
  capturedAt: number
}

export interface ActiveBrowserTab {
  url: string
  title: string | null
}

export type ActiveBrowserTabReader = (snapshot: ActiveBrowserWindowSnapshot) => ActiveBrowserTab | null

interface InFlightBrowserContext {
  snapshot: ActiveBrowserWindowSnapshot
  tab: ActiveBrowserTab
  normalizedUrl: string | null
  startedAt: number
  lastSeenAt: number
}

function msToChromeUs(ms: number): bigint {
  return BigInt(ms) * 1000n + CHROME_OFFSET_US
}

function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function browserAppIdFor(snapshot: ActiveBrowserWindowSnapshot): string | null {
  const identity = resolveCanonicalApp(snapshot.bundleId, snapshot.appName)
  if (identity.canonicalAppId && BROWSER_APP_IDS.has(identity.canonicalAppId)) {
    return identity.canonicalAppId
  }

  const fallback = `${snapshot.bundleId} ${snapshot.appName}`.toLowerCase()
  for (const browserId of BROWSER_APP_IDS) {
    if (fallback.includes(browserId)) return browserId
  }
  return null
}

function sameContext(left: InFlightBrowserContext, right: ActiveBrowserTab, normalizedUrl: string | null): boolean {
  if (left.normalizedUrl && normalizedUrl) return left.normalizedUrl === normalizedUrl
  return left.tab.url === right.url
}

function parseTabOutput(output: string): ActiveBrowserTab | null {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const url = lines[0]
  if (!url) return null
  const title = lines.slice(1).join(' ').trim() || null
  return { url, title }
}

function runOsaScript(script: string): ActiveBrowserTab | null {
  try {
    const output = execFileSync('osascript', ['-e', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1_500,
    })
    return parseTabOutput(output)
  } catch {
    return null
  }
}

function macActiveTab(snapshot: ActiveBrowserWindowSnapshot): ActiveBrowserTab | null {
  const browserId = browserAppIdFor(snapshot)
  if (!browserId) return null

  const appName = MAC_SCRIPT_APP_NAMES[browserId]
  if (!appName) return null

  if (browserId === 'safari') {
    return runOsaScript(`
      tell application "${appName}"
        if (count of windows) is 0 then return ""
        if (count of tabs of front window) is 0 then return ""
        return URL of current tab of front window & linefeed & name of current tab of front window
      end tell
    `)
  }

  return runOsaScript(`
    tell application "${appName}"
      if (count of windows) is 0 then return ""
      if (count of tabs of front window) is 0 then return ""
      return URL of active tab of front window & linefeed & title of active tab of front window
    end tell
  `)
}

function copyHistoryDb(historyPath: string, prefix: string): { dbPath: string; walPath: string; shmPath: string } {
  const tmpBase = path.join(os.tmpdir(), `${prefix}_${process.pid}_${Date.now()}_${Math.random().toString(16).slice(2)}`)
  const dbPath = `${tmpBase}.sqlite`
  const walPath = `${tmpBase}.sqlite-wal`
  const shmPath = `${tmpBase}.sqlite-shm`

  fs.copyFileSync(historyPath, dbPath)
  if (fs.existsSync(`${historyPath}-wal`)) fs.copyFileSync(`${historyPath}-wal`, walPath)
  if (fs.existsSync(`${historyPath}-shm`)) fs.copyFileSync(`${historyPath}-shm`, shmPath)

  return { dbPath, walPath, shmPath }
}

function cleanupHistoryCopy(paths: { dbPath: string; walPath: string; shmPath: string }): void {
  for (const target of [paths.dbPath, paths.walPath, paths.shmPath]) {
    try { if (fs.existsSync(target)) fs.unlinkSync(target) } catch {}
  }
}

function titleTokens(value: string | null | undefined): string[] {
  return (value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
}

function titleMatchesWindow(pageTitle: string | null, windowTitle: string | null): boolean {
  const pageTokens = new Set(titleTokens(pageTitle))
  if (pageTokens.size === 0) return false
  return titleTokens(windowTitle).some((token) => pageTokens.has(token))
}

function recentChromiumTab(entry: BrowserEntry, now: number, windowTitle: string | null): ActiveBrowserTab | null {
  const copy = copyHistoryDb(entry.historyPath, 'daylens_active_chromium')
  try {
    const db = new Database(copy.dbPath, { readonly: true })
    db.defaultSafeIntegers(true)
    const rows = db.prepare(`
      SELECT u.url, u.title, v.visit_time
      FROM visits v
      JOIN urls u ON v.url = u.id
      WHERE v.visit_time > ?
      ORDER BY v.visit_time DESC
      LIMIT 12
    `).all(msToChromeUs(now - RECENT_HISTORY_LOOKBACK_MS)) as { url: string; title: string | null; visit_time: bigint }[]
    db.close()

    const row = rows.find((candidate) => titleMatchesWindow(candidate.title, windowTitle)) ?? rows[0]
    return row ? { url: row.url, title: row.title ?? null } : null
  } catch {
    return null
  } finally {
    cleanupHistoryCopy(copy)
  }
}

function recentFirefoxTab(entry: BrowserEntry, now: number, windowTitle: string | null): ActiveBrowserTab | null {
  const copy = copyHistoryDb(entry.historyPath, 'daylens_active_firefox')
  try {
    const db = new Database(copy.dbPath, { readonly: true })
    db.defaultSafeIntegers(true)
    const rows = db.prepare(`
      SELECT p.url, p.title, v.visit_date
      FROM moz_historyvisits v
      JOIN moz_places p ON v.place_id = p.id
      WHERE v.visit_date > ?
      ORDER BY v.visit_date DESC
      LIMIT 12
    `).all(BigInt(now - RECENT_HISTORY_LOOKBACK_MS) * 1000n) as { url: string; title: string | null; visit_date: bigint }[]
    db.close()

    const row = rows.find((candidate) => titleMatchesWindow(candidate.title, windowTitle)) ?? rows[0]
    return row ? { url: row.url, title: row.title ?? null } : null
  } catch {
    return null
  } finally {
    cleanupHistoryCopy(copy)
  }
}

function recentHistoryTab(snapshot: ActiveBrowserWindowSnapshot): ActiveBrowserTab | null {
  const browserId = browserAppIdFor(snapshot)
  if (!browserId) return null

  const entries = getBrowserEntries()
    .filter((entry) => fs.existsSync(entry.historyPath))
    .filter((entry) => resolveCanonicalBrowser(entry.bundleId).canonicalBrowserId === browserId)

  for (const entry of entries) {
    const tab = entry.type === 'firefox'
      ? recentFirefoxTab(entry, snapshot.capturedAt, snapshot.windowTitle)
      : recentChromiumTab(entry, snapshot.capturedAt, snapshot.windowTitle)
    if (tab) return tab
  }

  return null
}

export function readActiveBrowserTab(snapshot: ActiveBrowserWindowSnapshot): ActiveBrowserTab | null {
  if (!browserAppIdFor(snapshot)) return null

  if (process.platform === 'darwin') {
    return macActiveTab(snapshot) ?? recentHistoryTab(snapshot)
  }

  if (process.platform === 'win32') {
    return recentHistoryTab(snapshot)
  }

  return null
}

export class ActiveBrowserContextTracker {
  private inFlight: InFlightBrowserContext | null = null

  constructor(private readonly readTab: ActiveBrowserTabReader = readActiveBrowserTab) {}

  sample(db: BetterSqlite.Database, snapshot: ActiveBrowserWindowSnapshot): void {
    if (!browserAppIdFor(snapshot)) {
      this.flush(db, snapshot.capturedAt)
      return
    }

    const tab = this.readTab(snapshot)
    const domain = tab ? extractDomain(tab.url) : null
    if (!tab || !domain) {
      this.flush(db, snapshot.capturedAt)
      return
    }

    const normalizedUrl = normalizeUrlForStorage(tab.url)
    if (this.inFlight && sameContext(this.inFlight, tab, normalizedUrl)) {
      this.inFlight.snapshot = snapshot
      this.inFlight.tab = tab
      this.inFlight.lastSeenAt = snapshot.capturedAt
      return
    }

    this.flush(db, snapshot.capturedAt)
    this.inFlight = {
      snapshot,
      tab,
      normalizedUrl,
      startedAt: snapshot.capturedAt,
      lastSeenAt: snapshot.capturedAt,
    }
  }

  flush(db: BetterSqlite.Database, endTime = Date.now()): boolean {
    const context = this.inFlight
    this.inFlight = null
    if (!context) return false

    const domain = extractDomain(context.tab.url)
    if (!domain) return false

    const effectiveEnd = Math.max(endTime, context.lastSeenAt)
    const durationSec = Math.round((effectiveEnd - context.startedAt) / 1000)
    if (durationSec < MIN_CONTEXT_SEC) return false

    const browserIdentity = resolveCanonicalBrowser(context.snapshot.bundleId)
    const inserted = insertWebsiteVisit(db, {
      domain,
      pageTitle: context.tab.title,
      url: context.tab.url,
      normalizedUrl: context.normalizedUrl,
      pageKey: pageKeyForUrl(context.tab.url),
      visitTime: context.startedAt,
      visitTimeUs: BigInt(context.startedAt) * 1000n,
      durationSec,
      browserBundleId: context.snapshot.bundleId,
      canonicalBrowserId: browserIdentity.canonicalBrowserId,
      browserProfileId: browserIdentity.browserProfileId,
      source: 'active_browser_context',
    })

    if (inserted) {
      invalidateProjectionScope('timeline', 'active_browser_context_recorded', {
        date: localDateString(new Date(context.startedAt)),
      })
      invalidateProjectionScope('apps', 'active_browser_context_recorded', {
        canonicalAppId: browserIdentity.canonicalBrowserId,
      })
      invalidateProjectionScope('insights', 'active_browser_context_recorded', {
        date: localDateString(new Date(context.startedAt)),
      })
    }

    return inserted
  }
}

const activeBrowserContextTracker = new ActiveBrowserContextTracker()

export function recordActiveBrowserContextSample(
  db: BetterSqlite.Database,
  snapshot: ActiveBrowserWindowSnapshot,
): void {
  activeBrowserContextTracker.sample(db, snapshot)
}

export function flushActiveBrowserContext(
  db: BetterSqlite.Database,
  endTime = Date.now(),
): boolean {
  return activeBrowserContextTracker.flush(db, endTime)
}
