// Fixture seeders for the AI regression harness. Each fixture seeds a fresh
// in-memory SQLite database with a representative day or week shape and
// returns the reference "today" date for use in router calls.
//
// All times are constructed at fixed local-clock positions so router answers
// are deterministic regardless of when the harness runs.
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../../src/main/db/schema'

export interface FixtureContext {
  db: Database.Database
  today: Date
}

type Fixture = (db: Database.Database) => Date

const REFERENCE_YEAR = 2026
const REFERENCE_MONTH = 4 // May (0-indexed)
const REFERENCE_DAY = 12

function refDate(dayOffset = 0): Date {
  return new Date(REFERENCE_YEAR, REFERENCE_MONTH, REFERENCE_DAY + dayOffset)
}

function localMs(date: Date, hour: number, minute = 0): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0).getTime()
}

function insertSession(
  db: Database.Database,
  args: {
    appName: string
    bundleId: string
    title: string
    start: number
    end: number
    category: string
    focused?: boolean
    canonicalAppId?: string | null
  },
): void {
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec, category,
      is_focused, window_title, raw_app_name, canonical_app_id, app_instance_id,
      capture_source, capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', 1)
  `).run(
    args.bundleId,
    args.appName,
    args.start,
    args.end,
    Math.max(1, Math.round((args.end - args.start) / 1000)),
    args.category,
    args.focused === false ? 0 : 1,
    args.title,
    args.appName,
    args.canonicalAppId ?? null,
    args.bundleId,
  )
}

function insertWebsite(
  db: Database.Database,
  args: { title: string; domain: string; url: string; start: number; durationSec: number; browserBundleId?: string },
): void {
  const browserBundle = args.browserBundleId ?? 'com.google.Chrome'
  db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, visit_time, visit_time_us, duration_sec,
      browser_bundle_id, canonical_browser_id, browser_profile_id,
      normalized_url, page_key, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'chrome', 'default', ?, ?, 'history')
  `).run(
    args.domain,
    args.title,
    args.url,
    args.start,
    BigInt(args.start) * 1000n,
    args.durationSec,
    browserBundle,
    args.url,
    `${args.domain}/page`,
  )
}

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  return db
}

// ─── Fixtures ─────────────────────────────────────────────────────────────

const codingDay: Fixture = (db) => {
  const today = refDate()
  insertSession(db, {
    appName: 'Cursor', bundleId: 'com.todesktop.230313mzl4w4u92', title: 'daylens — ai.ts',
    start: localMs(today, 9, 0), end: localMs(today, 11, 30), category: 'development',
    canonicalAppId: 'cursor',
  })
  insertSession(db, {
    appName: 'Google Chrome', bundleId: 'com.google.Chrome', title: 'react.dev — useEffect',
    start: localMs(today, 11, 35), end: localMs(today, 12, 10), category: 'browsing',
  })
  insertSession(db, {
    appName: 'Cursor', bundleId: 'com.todesktop.230313mzl4w4u92', title: 'daylens — wrappedFacts.ts',
    start: localMs(today, 13, 30), end: localMs(today, 16, 15), category: 'development',
    canonicalAppId: 'cursor',
  })
  insertWebsite(db, {
    title: 'irachrist1/daylens — Pull request',
    domain: 'github.com', url: 'https://github.com/irachrist1/daylens/pull/42',
    start: localMs(today, 11, 35), durationSec: 600,
  })
  insertWebsite(db, {
    title: 'useEffect – React',
    domain: 'react.dev', url: 'https://react.dev/reference/react/useEffect',
    start: localMs(today, 11, 45), durationSec: 900,
  })
  return today
}

const meetingHeavyDay: Fixture = (db) => {
  const today = refDate()
  insertSession(db, {
    appName: 'zoom.us', bundleId: 'us.zoom.xos', title: 'Standup — Daylens team',
    start: localMs(today, 9, 0), end: localMs(today, 9, 45), category: 'meetings',
  })
  insertSession(db, {
    appName: 'Slack', bundleId: 'com.tinyspeck.slackmacgap', title: 'daylens-eng channel',
    start: localMs(today, 9, 50), end: localMs(today, 10, 30), category: 'communication',
  })
  insertSession(db, {
    appName: 'zoom.us', bundleId: 'us.zoom.xos', title: 'Design review — Wrapped redesign',
    start: localMs(today, 10, 45), end: localMs(today, 11, 45), category: 'meetings',
  })
  insertSession(db, {
    appName: 'Slack', bundleId: 'com.tinyspeck.slackmacgap', title: 'Direct message — Christian',
    start: localMs(today, 14, 0), end: localMs(today, 14, 40), category: 'communication',
  })
  return today
}

const youtubeDriftDay: Fixture = (db) => {
  const today = refDate()
  insertSession(db, {
    appName: 'Google Chrome', bundleId: 'com.google.Chrome',
    title: 'How to build a Rust web server - YouTube',
    start: localMs(today, 9, 0), end: localMs(today, 11, 30), category: 'browsing',
  })
  insertSession(db, {
    appName: 'Google Chrome', bundleId: 'com.google.Chrome',
    title: 'Lo-fi beats to study to - YouTube',
    start: localMs(today, 13, 0), end: localMs(today, 15, 30), category: 'browsing',
  })
  insertWebsite(db, {
    title: 'How to build a Rust web server - YouTube',
    domain: 'youtube.com', url: 'https://youtube.com/watch?v=abc',
    start: localMs(today, 9, 0), durationSec: 9000,
  })
  insertWebsite(db, {
    title: 'Lo-fi beats to study to - YouTube',
    domain: 'youtube.com', url: 'https://youtube.com/watch?v=def',
    start: localMs(today, 13, 0), durationSec: 9000,
  })
  return today
}

const excelClientReportDay: Fixture = (db) => {
  const today = refDate()
  insertSession(db, {
    appName: 'Microsoft Excel', bundleId: 'com.microsoft.Excel',
    title: 'ASYV_Unified_Financial_Report_20260512',
    start: localMs(today, 9, 30), end: localMs(today, 12, 15), category: 'productivity',
    canonicalAppId: 'excel',
  })
  insertSession(db, {
    appName: 'Microsoft Outlook', bundleId: 'com.microsoft.Outlook',
    title: 'Inbox — christian@daylens.dev',
    start: localMs(today, 12, 30), end: localMs(today, 13, 0), category: 'email',
  })
  insertSession(db, {
    appName: 'Microsoft Excel', bundleId: 'com.microsoft.Excel',
    title: 'ASYV_Unified_Financial_Report_20260512 (Actuals)',
    start: localMs(today, 14, 0), end: localMs(today, 16, 45), category: 'productivity',
    canonicalAppId: 'excel',
  })
  insertWebsite(db, {
    title: 'Canva — ASYV board deck',
    domain: 'canva.com', url: 'https://canva.com/design/asyv',
    start: localMs(today, 13, 5), durationSec: 600,
  })
  return today
}

const quietDay: Fixture = (db) => {
  const today = refDate()
  insertSession(db, {
    appName: 'Notes', bundleId: 'com.apple.Notes', title: 'Untitled',
    start: localMs(today, 14, 0), end: localMs(today, 14, 7), category: 'productivity',
  })
  return today
}

const emptyDay: Fixture = () => refDate()

const yesterdayCodingDay: Fixture = (db) => {
  const today = refDate()
  const yesterday = refDate(-1)
  insertSession(db, {
    appName: 'Cursor', bundleId: 'com.todesktop.230313mzl4w4u92', title: 'daylens — yesterday work',
    start: localMs(yesterday, 10, 0), end: localMs(yesterday, 13, 0), category: 'development',
    canonicalAppId: 'cursor',
  })
  insertSession(db, {
    appName: 'Cursor', bundleId: 'com.todesktop.230313mzl4w4u92', title: 'daylens — afternoon push',
    start: localMs(yesterday, 14, 0), end: localMs(yesterday, 17, 30), category: 'development',
    canonicalAppId: 'cursor',
  })
  return today
}

const weekOfCoding: Fixture = (db) => {
  const today = refDate()
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = refDate(-offset)
    insertSession(db, {
      appName: 'Cursor', bundleId: 'com.todesktop.230313mzl4w4u92',
      title: `daylens — day ${REFERENCE_DAY - offset}`,
      start: localMs(day, 9, 30), end: localMs(day, 12, 30), category: 'development',
      canonicalAppId: 'cursor',
    })
    insertSession(db, {
      appName: 'Google Chrome', bundleId: 'com.google.Chrome',
      title: 'github.com — irachrist1/daylens',
      start: localMs(day, 13, 0), end: localMs(day, 14, 0), category: 'browsing',
    })
    insertWebsite(db, {
      title: 'irachrist1/daylens — commits',
      domain: 'github.com', url: 'https://github.com/irachrist1/daylens/commits/main',
      start: localMs(day, 13, 5), durationSec: 1200,
    })
  }
  return today
}

const figmaDesignDay: Fixture = (db) => {
  const today = refDate()
  insertSession(db, {
    appName: 'Figma', bundleId: 'com.figma.Desktop', title: 'Daylens — Wrapped redesign',
    start: localMs(today, 9, 0), end: localMs(today, 11, 30), category: 'design',
    canonicalAppId: 'figma',
  })
  insertSession(db, {
    appName: 'Figma', bundleId: 'com.figma.Desktop', title: 'Daylens — Settings v2',
    start: localMs(today, 13, 30), end: localMs(today, 16, 0), category: 'design',
    canonicalAppId: 'figma',
  })
  return today
}

const allDayChatGPT: Fixture = (db) => {
  const today = refDate()
  insertSession(db, {
    appName: 'Google Chrome', bundleId: 'com.google.Chrome', title: 'ChatGPT — Daylens audit',
    start: localMs(today, 9, 0), end: localMs(today, 11, 0), category: 'aiTools',
  })
  insertSession(db, {
    appName: 'Google Chrome', bundleId: 'com.google.Chrome', title: 'Claude — refactor plan',
    start: localMs(today, 13, 0), end: localMs(today, 15, 30), category: 'aiTools',
  })
  insertWebsite(db, {
    title: 'ChatGPT — Daylens audit',
    domain: 'chatgpt.com', url: 'https://chatgpt.com/c/abc',
    start: localMs(today, 9, 0), durationSec: 7200,
  })
  insertWebsite(db, {
    title: 'Claude — refactor plan',
    domain: 'claude.ai', url: 'https://claude.ai/chat/xyz',
    start: localMs(today, 13, 0), durationSec: 9000,
  })
  return today
}

// Regression fixture: a single, uninterrupted 3-hour Cursor session on one
// file. Before the coherent-ceiling change this fragmented into three blocks
// (the last labelled "Untitled block"). The new heuristic keeps it as one
// block. Pairs with corpus entries `long_cursor_session_*` below.
const longCursorSession: Fixture = (db) => {
  const today = refDate()
  insertSession(db, {
    appName: 'Cursor', bundleId: 'com.todesktop.230313mzl4w4u92',
    title: 'daylens — chatAnswer.ts',
    start: localMs(today, 9, 0), end: localMs(today, 12, 0), category: 'development',
    canonicalAppId: 'cursor',
  })
  return today
}

// Regression fixture: a single 2h 45m Excel session on one file (ASYV
// financial report). Locks the expectation that it stays as one block and
// surfaces ASYV evidence end-to-end.
const longExcelReport: Fixture = (db) => {
  const today = refDate()
  insertSession(db, {
    appName: 'Microsoft Excel', bundleId: 'com.microsoft.Excel',
    title: 'ASYV_Unified_Financial_Report_20260512',
    start: localMs(today, 9, 30), end: localMs(today, 12, 15), category: 'productivity',
    canonicalAppId: 'excel',
  })
  return today
}

export const FIXTURES: Record<string, Fixture> = {
  codingDay,
  meetingHeavyDay,
  youtubeDriftDay,
  excelClientReportDay,
  quietDay,
  emptyDay,
  yesterdayCodingDay,
  weekOfCoding,
  figmaDesignDay,
  allDayChatGPT,
  longCursorSession,
  longExcelReport,
}

export function setupFixture(name: string): FixtureContext {
  const fixture = FIXTURES[name]
  if (!fixture) throw new Error(`Unknown fixture: ${name}`)
  const db = freshDb()
  const today = fixture(db)
  return { db, today }
}
