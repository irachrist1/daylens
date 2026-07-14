import Database from 'better-sqlite3'
import type { AppCategory, AppSession } from '../../src/shared/types.ts'
import { insertAppSession, recordActivityStateEvent } from '../../src/main/db/queries.ts'
import { createProductionTestDatabase } from './testDatabase.ts'

export const REAL_WORLD_DATE = '2026-04-24'

export function localMs(date: string, hour: number, minute = 0): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

export function setupRealWorldDb(): Database.Database {
  const db = createProductionTestDatabase()
  seedRealWorldWorkday(db)
  return db
}

function durationSeconds(startTime: number, endTime: number): number {
  return Math.round((endTime - startTime) / 1_000)
}

function seedSession(
  db: Database.Database,
  options: {
    bundleId: string
    appName: string
    category: AppCategory
    startHour: number
    startMinute?: number
    endHour: number
    endMinute?: number
    windowTitle: string | null
    canonicalAppId?: string
  },
): number {
  const startTime = localMs(REAL_WORLD_DATE, options.startHour, options.startMinute ?? 0)
  const endTime = localMs(REAL_WORLD_DATE, options.endHour, options.endMinute ?? 0)
  const session: Omit<AppSession, 'id'> = {
    bundleId: options.bundleId,
    appName: options.appName,
    startTime,
    endTime,
    durationSeconds: durationSeconds(startTime, endTime),
    category: options.category,
    isFocused: ['development', 'research', 'writing', 'aiTools', 'design', 'productivity'].includes(options.category),
    windowTitle: options.windowTitle,
    rawAppName: options.appName,
    canonicalAppId: options.canonicalAppId ?? options.bundleId,
    appInstanceId: options.bundleId,
    captureSource: 'real_world_fixture',
    endedReason: 'app_switch',
    captureVersion: 2,
  }
  return insertAppSession(db, session)
}

function seedVisit(
  db: Database.Database,
  options: {
    domain: string
    title: string
    url: string
    hour: number
    minute: number
    durationSec: number
    browserBundleId: string
  },
): void {
  const visitTime = localMs(REAL_WORLD_DATE, options.hour, options.minute)
  db.prepare(`
    INSERT INTO website_visits (
      domain,
      page_title,
      url,
      visit_time,
      visit_time_us,
      duration_sec,
      browser_bundle_id,
      canonical_browser_id,
      normalized_url,
      page_key,
      source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'real_world_fixture')
  `).run(
    options.domain,
    options.title,
    options.url,
    visitTime,
    visitTime * 1000,
    options.durationSec,
    options.browserBundleId,
    options.browserBundleId,
    options.url,
    options.url.replace(/^https?:\/\//, ''),
  )
}

export function seedRealWorldWorkday(db: Database.Database): void {
  seedSession(db, {
    bundleId: 'com.daylens.app',
    appName: 'Daylens',
    category: 'productivity',
    startHour: 8,
    startMinute: 55,
    endHour: 9,
    endMinute: 5,
    windowTitle: 'Daylens: Timeline',
    canonicalAppId: 'daylens',
  })

  seedSession(db, {
    bundleId: 'com.microsoft.VSCode',
    appName: 'Code',
    category: 'development',
    startHour: 9,
    endHour: 10,
    endMinute: 15,
    windowTitle: 'Timeline.tsx - daylens',
    canonicalAppId: 'vscode',
  })

  seedSession(db, {
    bundleId: 'com.google.Chrome',
    appName: 'Chrome',
    category: 'research',
    startHour: 10,
    startMinute: 15,
    endHour: 10,
    endMinute: 45,
    windowTitle: 'React useEffect docs - react.dev',
    canonicalAppId: 'chrome',
  })

  seedSession(db, {
    bundleId: 'us.zoom.xos',
    appName: 'Zoom',
    category: 'meetings',
    startHour: 10,
    startMinute: 45,
    endHour: 11,
    endMinute: 15,
    windowTitle: 'Weekly product sync',
    canonicalAppId: 'zoom',
  })

  recordActivityStateEvent(db, {
    eventTs: localMs(REAL_WORLD_DATE, 11, 15),
    eventType: 'lock_screen',
    source: 'real_world_fixture',
  })
  recordActivityStateEvent(db, {
    eventTs: localMs(REAL_WORLD_DATE, 12, 0),
    eventType: 'unlock_screen',
    source: 'real_world_fixture',
  })

  seedSession(db, {
    bundleId: 'com.openai.codex',
    appName: 'Codex',
    category: 'aiTools',
    startHour: 12,
    endHour: 12,
    endMinute: 40,
    windowTitle: 'codex - strengthen real-world tests',
    canonicalAppId: 'codex',
  })

  seedSession(db, {
    bundleId: 'com.apple.Safari',
    appName: 'Safari',
    category: 'entertainment',
    startHour: 20,
    endHour: 20,
    endMinute: 30,
    windowTitle: 'Long lecture - YouTube',
    canonicalAppId: 'safari',
  })

  seedVisit(db, {
    domain: 'react.dev',
    title: 'React useEffect docs',
    url: 'https://react.dev/reference/react/useEffect',
    hour: 10,
    minute: 16,
    durationSec: 18 * 60,
    browserBundleId: 'com.google.Chrome',
  })

  seedVisit(db, {
    domain: 'github.com',
    title: 'daylens timeline segmentation pull request',
    url: 'https://github.com/tonny/daylens/pull/42',
    hour: 10,
    minute: 35,
    durationSec: 10 * 60,
    browserBundleId: 'com.google.Chrome',
  })

  seedVisit(db, {
    domain: 'youtube.com',
    title: 'Long lecture',
    url: 'https://www.youtube.com/watch?v=lecture',
    hour: 20,
    minute: 0,
    durationSec: 30 * 60,
    browserBundleId: 'com.apple.Safari',
  })
}
