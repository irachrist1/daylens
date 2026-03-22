// Browser history polling service.
// Reads local browser SQLite history files periodically, extracts domain-level
// visit data, and writes it to the website_visits table.
//
// Architecture:
//   - Copy History + WAL + SHM to a tmp location before opening (avoids lock contention)
//   - Only read visits newer than the last successful poll time
//   - INSERT OR IGNORE on (browser_bundle_id, visit_time) prevents duplicate rows
//   - All failures are silent — never crashes the main app startup
//
// Platform support:
//   macOS: Chrome, Brave, Arc, Microsoft Edge
//   Windows: TODO (see WINDOWS_PATHS below)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { getDb } from './database'
import { insertWebsiteVisit } from '../db/queries'

// ─── Chrome timestamp arithmetic ─────────────────────────────────────────────
// Chrome stores timestamps as microseconds since 1601-01-01 00:00:00 UTC.
// Current values (~1.34e16) exceed Number.MAX_SAFE_INTEGER (~9.0e15), so BigInt
// arithmetic is required to avoid precision loss.

const CHROME_OFFSET_US = 11_644_473_600_000_000n  // µs between 1601 and Unix epoch

function msToChromeUs(ms: number): bigint {
  return BigInt(ms) * 1000n + CHROME_OFFSET_US
}

function chromeUsToMs(us: bigint): number {
  return Number((us - CHROME_OFFSET_US) / 1000n)
}

// ─── Browser path registry ────────────────────────────────────────────────────

interface BrowserEntry {
  name: string
  bundleId: string      // macOS bundle ID or Windows exe name
  historyPath: string
}

interface HistoryRow {
  url: string
  title: string | null
  visit_time: bigint
  visit_duration: bigint
}

interface ProcessedHistoryRow {
  domain: string
  pageTitle: string | null
  url: string
  visitTime: number
  durationSec: number
}

function macBrowsers(): BrowserEntry[] {
  const home = os.homedir()
  return [
    {
      name:        'Google Chrome',
      bundleId:    'com.google.Chrome',
      historyPath: path.join(home, 'Library/Application Support/Google/Chrome/Default/History'),
    },
    {
      name:        'Brave',
      bundleId:    'com.brave.Browser',
      historyPath: path.join(home, 'Library/Application Support/BraveSoftware/Brave-Browser/Default/History'),
    },
    {
      name:        'Arc',
      bundleId:    'company.thebrowser.Browser',
      historyPath: path.join(home, 'Library/Application Support/Arc/User Data/Default/History'),
    },
    {
      name:        'Microsoft Edge',
      bundleId:    'com.microsoft.edgemac',
      historyPath: path.join(home, 'Library/Application Support/Microsoft Edge/Default/History'),
    },
  ]
}

function windowsBrowsers(): BrowserEntry[] {
  const local = path.join(os.homedir(), 'AppData', 'Local')
  return [
    {
      name:        'Google Chrome',
      bundleId:    'chrome.exe',
      historyPath: path.join(local, 'Google/Chrome/User Data/Default/History'),
    },
    {
      name:        'Microsoft Edge',
      bundleId:    'msedge.exe',
      historyPath: path.join(local, 'Microsoft/Edge/User Data/Default/History'),
    },
    {
      name:        'Brave',
      bundleId:    'brave.exe',
      historyPath: path.join(local, 'BraveSoftware/Brave-Browser/User Data/Default/History'),
    },
    {
      name:        'Firefox',
      bundleId:    'firefox.exe',
      // Firefox uses a profile-based layout — skip for now; Chromium path is standard
      historyPath: path.join(local, 'Mozilla/Firefox/Profiles'),
    },
  ].filter((b) => !b.historyPath.includes('Profiles'))  // skip non-Chromium for now
}

function getBrowserEntries(): BrowserEntry[] {
  if (process.platform === 'darwin') return macBrowsers()
  if (process.platform === 'win32') return windowsBrowsers()
  return []
}

// ─── Domain extraction ────────────────────────────────────────────────────────

function extractDomain(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function processHistoryRows(rows: HistoryRow[]): ProcessedHistoryRow[] {
  return rows
    .map((row, i) => {
      const visitMs = chromeUsToMs(row.visit_time)
      const chromeDurationSec = Math.max(0, Number(row.visit_duration / 1_000_000n))

      if (chromeDurationSec > 0 && chromeDurationSec < 2) return null

      const domain = extractDomain(row.url)
      if (!domain) return null

      let estimatedDurationSec: number
      if (i < rows.length - 1) {
        const nextVisitMs = chromeUsToMs(rows[i + 1].visit_time)
        estimatedDurationSec = Math.round((nextVisitMs - visitMs) / 1000)
        estimatedDurationSec = Math.min(Math.max(estimatedDurationSec, 0), 1800)
      } else {
        // Terminal row — no successor to measure gap against.
      // Use Chrome's duration if reliable, otherwise a 30s default (median dwell time).
      estimatedDurationSec = chromeDurationSec > 0 ? chromeDurationSec : 30
      }

      const finalDuration = chromeDurationSec > 2
        ? Math.max(Math.min(chromeDurationSec, estimatedDurationSec), 1)
        : Math.max(estimatedDurationSec, 5)

      return {
        domain,
        pageTitle: row.title ?? null,
        url: row.url,
        visitTime: visitMs,
        durationSec: finalDuration,
      }
    })
    .filter((row): row is ProcessedHistoryRow => row !== null)
}

// ─── State ────────────────────────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setInterval> | null = null
let lastPollMs = 0

export const browserStatus = {
  lastPoll:         null as number | null,
  visitsToday:      0,
  error:            null as string | null,
  browsersPollable: 0,
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function startBrowserTracking(): void {
  if (pollTimer) return
  // Fire immediately on start — first poll looks back 24 h
  void pollAll()
  pollTimer = setInterval(() => void pollAll(), 60_000)
  console.log('[browser] tracking started')
}

export function stopBrowserTracking(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export function getBrowserStatus() {
  return { ...browserStatus }
}

// ─── Poll ─────────────────────────────────────────────────────────────────────

async function pollAll(): Promise<void> {
  const browsers   = getBrowserEntries()
  const pollFrom   = lastPollMs || Date.now() - 86_400_000
  const pollNow    = Date.now()
  const db         = getDb()

  let totalInserted = 0
  let pollable      = 0
  let lastError: string | null = null

  for (const browser of browsers) {
    if (!fs.existsSync(browser.historyPath)) continue
    pollable++

    const tmpBase = path.join(os.tmpdir(), `daylens_bh_${Date.now()}`)
    const tmpDb   = tmpBase + '.sqlite'
    const tmpWal  = tmpBase + '.sqlite-wal'
    const tmpShm  = tmpBase + '.sqlite-shm'

    try {
      // Copy the history DB and its WAL/SHM companions atomically.
      // Without the WAL copy, opening the main file may give stale data.
      fs.copyFileSync(browser.historyPath, tmpDb)
      const walSrc = browser.historyPath + '-wal'
      const shmSrc = browser.historyPath + '-shm'
      if (fs.existsSync(walSrc)) fs.copyFileSync(walSrc, tmpWal)
      if (fs.existsSync(shmSrc)) fs.copyFileSync(shmSrc, tmpShm)

      const histDb = new Database(tmpDb, { readonly: true })
      histDb.defaultSafeIntegers(true)   // return BigInt for large integers

      const fromChrome = msToChromeUs(pollFrom)
      const query = histDb.prepare(`
        SELECT u.url, u.title, v.visit_time, v.visit_duration
        FROM visits v
        JOIN urls u ON v.url = u.id
        WHERE v.visit_time > ?
        ORDER BY v.visit_time ASC
        LIMIT 500
      `)

      let cursor = fromChrome
      let batchCount = 0
      let hitBatchLimit = false
      let pendingRow: HistoryRow | null = null
      const MAX_BATCHES = 10

      while (batchCount < MAX_BATCHES) {
        const rows = query.all(cursor) as HistoryRow[]
        if (rows.length === 0) break

        const batchRows: HistoryRow[] = pendingRow ? [pendingRow, ...rows] : rows
        const isFinalBatch = rows.length < 500
        const rowsToProcess = isFinalBatch ? batchRows : batchRows.slice(0, -1)
        pendingRow = isFinalBatch ? null : batchRows[batchRows.length - 1]

        for (const processed of processHistoryRows(rowsToProcess)) {
          insertWebsiteVisit(db, {
            domain: processed.domain,
            pageTitle: processed.pageTitle,
            url: processed.url,
            visitTime: processed.visitTime,
            durationSec: processed.durationSec,
            browserBundleId: browser.bundleId,
            source: 'chrome_history',
          })
          totalInserted++
        }

        cursor = rows[rows.length - 1].visit_time
        batchCount++

        if (isFinalBatch) break
        if (batchCount === MAX_BATCHES) hitBatchLimit = true
      }

      if (pendingRow) {
        for (const processed of processHistoryRows([pendingRow])) {
          insertWebsiteVisit(db, {
            domain: processed.domain,
            pageTitle: processed.pageTitle,
            url: processed.url,
            visitTime: processed.visitTime,
            durationSec: processed.durationSec,
            browserBundleId: browser.bundleId,
            source: 'chrome_history',
          })
          totalInserted++
        }
      }

      if (hitBatchLimit) {
        console.warn(`[browser] hit batch limit while polling ${browser.name}`)
      }

      histDb.close()
    } catch (err) {
      lastError = String(err)
      console.warn(`[browser] failed to poll ${browser.name}:`, err)
    } finally {
      for (const f of [tmpDb, tmpWal, tmpShm]) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch {}
      }
    }
  }

  lastPollMs = pollNow

  // Count today's visits for status
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const countRow = db
    .prepare(`SELECT COUNT(*) AS c FROM website_visits WHERE visit_time >= ?`)
    .get(todayStart.getTime()) as { c: number } | undefined

  browserStatus.lastPoll         = pollNow
  browserStatus.visitsToday      = countRow?.c ?? 0
  browserStatus.error            = lastError
  browserStatus.browsersPollable = pollable

  if (totalInserted > 0) {
    console.log(`[browser] inserted ${totalInserted} visits from ${pollable} browser(s)`)
  }
}
