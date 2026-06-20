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
import { getSettings } from './settings'
import { decideSiteCapture, trackingControlsStateFromSettings } from '@shared/trackingControls'
import {
  resolveBrowserApplication,
  type BrowserApplication,
  type BrowserCandidate,
} from './browserRegistry'

const MIN_CONTEXT_SEC = 10
const RECENT_HISTORY_LOOKBACK_MS = 2 * 60_000
// How long the unchanged-title fast path may reuse the last tab read before a
// re-read is forced. Caps how long two same-title tabs could be conflated while
// still cutting the per-5s-poll osascript/history reads during steady reading.
const TAB_CACHE_TRUST_MS = 30_000
const CHROME_OFFSET_US = 11_644_473_600_000_000n

const WINDOWS_BROWSER_APP_IDS = new Set([
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

export interface ActiveBrowserWindowSnapshot {
  bundleId: string
  appName: string
  windowTitle: string | null
  capturedAt: number
  executablePath?: string | null
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

function macBrowserApplicationFor(snapshot: ActiveBrowserWindowSnapshot): BrowserApplication | null {
  return resolveBrowserApplication({
    bundleId: snapshot.bundleId,
    appName: snapshot.appName,
    executablePath: snapshot.executablePath,
  })
}

function browserAppIdFor(snapshot: ActiveBrowserWindowSnapshot): string | null {
  if (process.platform === 'darwin') {
    const application = macBrowserApplicationFor(snapshot)
    if (!application) return null
    return resolveCanonicalBrowser(application.bundleId).canonicalBrowserId ?? application.bundleId.toLowerCase()
  }

  const identity = resolveCanonicalApp(snapshot.bundleId, snapshot.appName)
  if (identity.canonicalAppId && WINDOWS_BROWSER_APP_IDS.has(identity.canonicalAppId)) {
    return identity.canonicalAppId
  }

  const fallback = `${snapshot.bundleId} ${snapshot.appName}`.toLowerCase()
  for (const browserId of WINDOWS_BROWSER_APP_IDS) {
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
  const application = macBrowserApplicationFor(snapshot)
  if (!application || application.family === 'firefox') return null

  if (application.family === 'webkit') {
    return runOsaScript(`
      tell application "${application.name}"
        if (count of windows) is 0 then return ""
        if (count of tabs of front window) is 0 then return ""
        return URL of current tab of front window & linefeed & name of current tab of front window
      end tell
    `)
  }

  return runOsaScript(`
    tell application "${application.name}"
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
    try { if (fs.existsSync(target)) fs.unlinkSync(target) } catch { /* best-effort: temp file may already be gone */ }
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
  const macApplication = process.platform === 'darwin' ? macBrowserApplicationFor(snapshot) : null

  const entries = getBrowserEntries()
    .filter((entry) => fs.existsSync(entry.historyPath))
    .filter((entry) => {
      if (macApplication) return entry.bundleId.split(':', 1)[0] === macApplication.bundleId
      return resolveCanonicalBrowser(entry.bundleId).canonicalBrowserId === browserId
    })

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

export function isBrowserWindowCandidate(candidate: BrowserCandidate): boolean {
  if (process.platform === 'darwin') return resolveBrowserApplication(candidate) !== null
  const snapshot: ActiveBrowserWindowSnapshot = {
    bundleId: candidate.bundleId ?? '',
    appName: candidate.appName ?? '',
    windowTitle: null,
    capturedAt: Date.now(),
    executablePath: candidate.executablePath,
  }
  return browserAppIdFor(snapshot) !== null
}

export class ActiveBrowserContextTracker {
  private inFlight: InFlightBrowserContext | null = null
  private pending: InFlightBrowserContext | null = null
  // The foreground window title (captured cheaply by the tracker) reflects the
  // active tab's page title. While it is unchanged we reuse the in-flight tab
  // instead of re-running the per-sample osascript / history-DB read, which is
  // what made every 5s poll tick stutter on browser-heavy macOS use (F19).
  private lastWindowTitle: string | null = null
  // When the last real tab read happened. The title-cache is only trusted for a
  // bounded window so that two distinct tabs sharing a title (e.g. two "Inbox"
  // pages) can't be merged indefinitely — we force a re-read after this.
  private lastTabReadAt = 0

  constructor(
    private readonly readTab: ActiveBrowserTabReader = readActiveBrowserTab,
    private readonly isBrowser: (snapshot: ActiveBrowserWindowSnapshot) => boolean =
      (snapshot) => browserAppIdFor(snapshot) !== null,
  ) {}

  private promotePending(db: BetterSqlite.Database, capturedAt: number): void {
    if (!this.pending || capturedAt - this.pending.startedAt < MIN_CONTEXT_SEC * 1_000) return
    const pending = this.pending
    this.pending = null
    this.flush(db, pending.startedAt)
    this.inFlight = pending
  }

  private observeTab(
    db: BetterSqlite.Database,
    snapshot: ActiveBrowserWindowSnapshot,
    tab: ActiveBrowserTab,
    normalizedUrl: string | null,
  ): void {
    if (!this.inFlight) {
      this.inFlight = {
        snapshot,
        tab,
        normalizedUrl,
        startedAt: snapshot.capturedAt,
        lastSeenAt: snapshot.capturedAt,
      }
      this.pending = null
      return
    }

    if (sameContext(this.inFlight, tab, normalizedUrl)) {
      this.pending = null
      this.inFlight.snapshot = snapshot
      this.inFlight.tab = tab
      this.inFlight.lastSeenAt = snapshot.capturedAt
      return
    }

    if (this.pending && sameContext(this.pending, tab, normalizedUrl)) {
      this.pending.snapshot = snapshot
      this.pending.tab = tab
      this.pending.lastSeenAt = snapshot.capturedAt
      this.promotePending(db, snapshot.capturedAt)
      return
    }

    this.pending = {
      snapshot,
      tab,
      normalizedUrl,
      startedAt: snapshot.capturedAt,
      lastSeenAt: snapshot.capturedAt,
    }
  }

  sample(db: BetterSqlite.Database, snapshot: ActiveBrowserWindowSnapshot): void {
    if (!this.isBrowser(snapshot)) {
      this.flush(db, snapshot.capturedAt)
      this.pending = null
      this.lastWindowTitle = null
      return
    }

    // Same browser window + same title + still inside the trust window → almost
    // certainly the same active tab, so extend the current context without
    // paying for another tab read. The freshness cap bounds how long a
    // same-title tab switch could go unnoticed.
    if (
      (this.inFlight || this.pending)
      && snapshot.windowTitle
      && snapshot.windowTitle === this.lastWindowTitle
      && snapshot.bundleId === (this.pending?.snapshot.bundleId ?? this.inFlight?.snapshot.bundleId)
      && snapshot.capturedAt - this.lastTabReadAt < TAB_CACHE_TRUST_MS
    ) {
      const cached = this.pending ?? this.inFlight
      if (cached) {
        cached.snapshot = snapshot
        cached.lastSeenAt = snapshot.capturedAt
        if (this.pending) this.promotePending(db, snapshot.capturedAt)
      }
      return
    }

    const tab = this.readTab(snapshot)
    this.lastTabReadAt = snapshot.capturedAt
    const domain = tab ? extractDomain(tab.url) : null
    if (!tab || !domain) {
      this.flush(db, snapshot.capturedAt)
      this.pending = null
      this.lastWindowTitle = null
      return
    }

    this.lastWindowTitle = snapshot.windowTitle ?? null

    const normalizedUrl = normalizeUrlForStorage(tab.url)
    this.observeTab(db, snapshot, tab, normalizedUrl)
  }

  flush(db: BetterSqlite.Database, endTime = Date.now()): boolean {
    const context = this.inFlight
    this.inFlight = null
    this.pending = null
    if (!context) return false

    const domain = extractDomain(context.tab.url)
    if (!domain) return false

    // T3: drop this website visit when the user excluded the site, paused
    // tracking, or it's an incognito window (by title) and skip-incognito is on.
    // Passthrough when Tracking Controls is off — the browser app session is
    // gated separately upstream in tracking.ts.
    if (!decideSiteCapture(trackingControlsStateFromSettings(getSettings()), { domain, windowTitle: context.snapshot.windowTitle }).capture) {
      return false
    }

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
