// Windows app usage history backfill.
//
// Reads the Windows Timeline ActivityCache.db (ActivitiesCache.db) to seed
// the last 24 hours of app sessions on first launch — the same way the browser
// service reads Chrome history retroactively.
//
// ActivityCache.db is at:
//   %LOCALAPPDATA%\ConnectedDevicesPlatform\<account-folder>\ActivitiesCache.db
//
// ActivityType=5 rows are user app activities with StartTime/EndTime as Unix
// seconds (seconds since 1970-01-01). The DB may not exist on Windows 11 22H2+
// where Microsoft removed the Timeline UI — we fail silently in that case.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { getDb } from './database'
import { insertAppSession } from '../db/queries'
import { classifyResult } from './tracking'

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKFILL_WINDOW_MS = 24 * 60 * 60 * 1_000   // 24 hours back
const MAX_SESSION_SEC    = 8 * 60 * 60              // discard sessions > 8 h (likely stale)
const MIN_SESSION_SEC    = 10                        // discard sub-10s noise

// Lowercase substrings that flag OS/self noise in app names
const NOISE_SUBSTRINGS = ['electron', 'daylens', 'node.js', 'dwm', 'csrss', 'svchost']

// ─── ActivitiesCache.db row ───────────────────────────────────────────────────

interface ActivityRow {
  AppActivityId: string
  StartTime:     number   // Unix seconds
  EndTime:       number   // Unix seconds, 0 if still active
  Payload:       Buffer | null
}

// ─── Find all ActivitiesCache.db files ────────────────────────────────────────

function findActivityCachePaths(): string[] {
  const cdpRoot = path.join(os.homedir(), 'AppData', 'Local', 'ConnectedDevicesPlatform')
  if (!fs.existsSync(cdpRoot)) return []

  const results: string[] = []
  try {
    for (const entry of fs.readdirSync(cdpRoot)) {
      const dbPath = path.join(cdpRoot, entry, 'ActivitiesCache.db')
      if (fs.existsSync(dbPath)) results.push(dbPath)
    }
  } catch {
    // readdirSync can fail if the directory is not readable
  }
  return results
}

// ─── App identity parsing ─────────────────────────────────────────────────────
// AppActivityId comes in several formats:
//   1. UWP:  "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App"
//   2. Win32 with GUID prefix:  "{6D809377-...}\path\to\app.exe"
//   3. Win32 full path:  "C:\Program Files\...\app.exe"
//   4. Plain name:  "Google Chrome"

function humanizePackageName(pkgFamily: string): string {
  // Strip publisher hash suffix: "Microsoft.WindowsTerminal_8wekyb3d8bbwe" → "Microsoft.WindowsTerminal"
  const pkgName = pkgFamily.split('_')[0]
  const parts = pkgName.split('.')
  // Drop common vendor prefixes
  const filtered = parts.filter((p) => !['com', 'org', 'net', 'microsoft', 'windows'].includes(p.toLowerCase()))
  if (filtered.length === 0) return pkgName
  return filtered.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

function parseAppActivityId(id: string): { bundleId: string; appName: string } | null {
  if (!id || id.length < 2) return null

  // UWP: "PackageFamilyName!AppId"
  const bang = id.indexOf('!')
  if (bang > 0) {
    const pkgFamily = id.slice(0, bang)
    const appName = humanizePackageName(pkgFamily)
    return { bundleId: pkgFamily, appName }
  }

  // Win32 with GUID prefix: "{GUID}\path\to\app.exe"
  const guidMatch = /^\{[0-9A-Fa-f-]{36}\}[\\\/](.+)/.exec(id)
  if (guidMatch) {
    const filePath = guidMatch[1]
    const exeName  = path.win32.basename(filePath)
    const appName  = exeName.replace(/\.exe$/i, '') || filePath
    return { bundleId: filePath, appName }
  }

  // Win32 full path
  if (id.includes('\\') || (id.includes('/') && !id.startsWith('http'))) {
    const exeName = path.win32.basename(id)
    const appName = exeName.replace(/\.exe$/i, '') || id
    return { bundleId: id, appName }
  }

  // Plain name (e.g. "Google Chrome") — use as-is
  return { bundleId: id, appName: id }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function backfillWindowsHistory(): void {
  if (process.platform !== 'win32') return

  const paths = findActivityCachePaths()
  if (paths.length === 0) {
    console.log('[winhistory] no ActivitiesCache.db found — skipping backfill')
    return
  }

  const fromSec  = Math.floor((Date.now() - BACKFILL_WINDOW_MS) / 1_000)
  const mainDb   = getDb()
  let   totalImported = 0

  for (const dbPath of paths) {
    const tmpPath = path.join(os.tmpdir(), `daylens_ach_${Date.now()}.db`)
    try {
      fs.copyFileSync(dbPath, tmpPath)

      const actDb = new Database(tmpPath, { readonly: true })
      const rows  = actDb.prepare(`
        SELECT AppActivityId, StartTime, EndTime, Payload
        FROM   Activities
        WHERE  ActivityType   = 5
          AND  ActivityStatus = 1
          AND  StartTime      > ?
          AND  AppActivityId  IS NOT NULL
        ORDER  BY StartTime ASC
        LIMIT  2000
      `).all(fromSec) as ActivityRow[]
      actDb.close()

      for (const row of rows) {
        const parsed = parseAppActivityId(row.AppActivityId)
        if (!parsed) continue

        // Prefer Payload JSON appDisplayName when available
        if (row.Payload) {
          try {
            const payload = JSON.parse(row.Payload.toString('utf8')) as Record<string, unknown>
            if (typeof payload.appDisplayName === 'string' && payload.appDisplayName) {
              parsed.appName = payload.appDisplayName
            }
          } catch { /* ignore */ }
        }

        const { bundleId, appName } = parsed

        // Skip OS/self noise
        const lower = appName.toLowerCase()
        if (NOISE_SUBSTRINGS.some((s) => lower.includes(s))) continue

        const startMs        = row.StartTime * 1_000
        const endMs          = row.EndTime > 0 ? row.EndTime * 1_000 : Date.now()
        const durationSeconds = Math.round((endMs - startMs) / 1_000)

        if (durationSeconds < MIN_SESSION_SEC || durationSeconds > MAX_SESSION_SEC) continue

        const { category, isFocused } = classifyResult(bundleId, appName)

        insertAppSession(mainDb, {
          bundleId,
          appName,
          startTime: startMs,
          endTime:   endMs,
          durationSeconds,
          category,
          isFocused,
        })
        totalImported++
      }
    } catch (err) {
      console.warn('[winhistory] failed to read', dbPath, ':', err)
    } finally {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath) } catch { /* best-effort */ }
    }
  }

  if (totalImported > 0) {
    console.log(`[winhistory] backfilled ${totalImported} app sessions from ActivityCache.db`)
  } else {
    console.log('[winhistory] ActivityCache.db found but contained no usable sessions (normal on Windows 11)')
  }
}
