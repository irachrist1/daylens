#!/usr/bin/env node
/**
 * migrate-macos-data.js
 *
 * Migrates app_sessions and website_visits from the macOS Daylens DB
 * into the DaylensWindows DB.
 *
 * Safe to run multiple times — uses INSERT OR IGNORE on unique constraints.
 * Does NOT delete or overwrite any existing DaylensWindows data.
 *
 * Uses the sqlite3 CLI (no native Node addons needed).
 *
 * Usage:
 *   node scripts/migrate-macos-data.js [--dry-run]
 */

const { execSync, spawnSync } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')

const DRY_RUN = process.argv.includes('--dry-run')

const MACOS_DB = path.join(os.homedir(), 'Library/Application Support/Daylens/daylens.sqlite')
const WINDOWS_DB = path.join(os.homedir(), 'Library/Application Support/DaylensWindows/daylens.sqlite')

// Verify sqlite3 is available
const which = spawnSync('which', ['sqlite3'])
if (which.status !== 0) {
  console.error('sqlite3 CLI not found. Install it with: brew install sqlite')
  process.exit(1)
}
const SQLITE3 = 'sqlite3'

function sql(dbPath, query, readOnly = false) {
  const args = readOnly ? ['-readonly', dbPath, query] : [dbPath, query]
  const result = spawnSync(SQLITE3, args, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`sqlite3 error: ${result.stderr}`)
  return result.stdout.trim()
}

function count(dbPath, table) {
  return parseInt(sql(dbPath, `SELECT COUNT(*) FROM ${table}`, true), 10)
}

if (!fs.existsSync(MACOS_DB)) {
  console.error(`macOS Daylens DB not found: ${MACOS_DB}`)
  process.exit(1)
}
if (!fs.existsSync(WINDOWS_DB)) {
  console.error(`DaylensWindows DB not found: ${WINDOWS_DB}`)
  process.exit(1)
}

// ── Pre-migration counts ───────────────────────────────────────────────────────
const srcSessionCount = count(MACOS_DB, 'app_sessions')
const srcVisitCount   = count(MACOS_DB, 'website_visits')
const dstSessionsBefore = count(WINDOWS_DB, 'app_sessions')
const dstVisitsBefore   = count(WINDOWS_DB, 'website_visits')

console.log('\n── Source (macOS Daylens) ────────────────────────────────────')
console.log(`  app_sessions:   ${srcSessionCount}`)
console.log(`  website_visits: ${srcVisitCount}`)

console.log('\n── Destination (DaylensWindows) — before ─────────────────────')
console.log(`  app_sessions:   ${dstSessionsBefore}`)
console.log(`  website_visits: ${dstVisitsBefore}`)

if (DRY_RUN) {
  console.log('\n[DRY RUN — no changes written]\n')
  process.exit(0)
}

// ── Run migration via ATTACH ──────────────────────────────────────────────────
// We ATTACH the macOS DB into the DaylensWindows DB connection so we can do a
// single INSERT … SELECT across both DBs in one sqlite3 process.

const macosDbEscaped = MACOS_DB.replace(/'/g, "''")

const migrationSQL = `
PRAGMA busy_timeout = 30000;
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = OFF;

ATTACH DATABASE '${macosDbEscaped}' AS macos;

-- ── app_sessions ──────────────────────────────────────────────────────────────
-- macOS: startTime TEXT "2026-03-19 02:01:55.315", duration DOUBLE (seconds)
-- Windows: start_time INTEGER (ms), duration_sec INTEGER (seconds)
INSERT OR IGNORE INTO main.app_sessions
  (bundle_id, app_name, start_time, end_time, duration_sec, category, window_title, is_focused, capture_source, capture_version)
SELECT
  COALESCE(bundleID, ''),
  COALESCE(appName, 'Unknown'),
  CAST((julianday(startTime) - 2440587.5) * 86400000 AS INTEGER),
  CASE WHEN endTime IS NOT NULL THEN CAST((julianday(endTime) - 2440587.5) * 86400000 AS INTEGER) ELSE NULL END,
  CAST(ROUND(COALESCE(duration, 0)) AS INTEGER),
  COALESCE(category, 'uncategorized'),
  windowTitle,
  0,
  'import_macos',
  1
FROM macos.app_sessions
WHERE startTime IS NOT NULL;

-- ── website_visits ────────────────────────────────────────────────────────────
-- macOS: startTime TEXT, duration DOUBLE (seconds), fullURL, pageTitle, browserBundleID
-- Windows: visit_time INTEGER (ms), visit_time_us INTEGER (µs), duration_sec INTEGER
INSERT OR IGNORE INTO main.website_visits
  (domain, page_title, url, visit_time, visit_time_us, duration_sec, browser_bundle_id, source)
SELECT
  COALESCE(domain, ''),
  pageTitle,
  fullURL,
  CAST((julianday(startTime) - 2440587.5) * 86400000 AS INTEGER),
  CAST((julianday(startTime) - 2440587.5) * 86400000000 AS INTEGER),
  CAST(ROUND(COALESCE(duration, 0)) AS INTEGER),
  browserBundleID,
  'import_macos'
FROM macos.website_visits
WHERE startTime IS NOT NULL;

DETACH DATABASE macos;
`

console.log('\n── Running migration… ────────────────────────────────────────')
const result = spawnSync(SQLITE3, [WINDOWS_DB], {
  input: migrationSQL,
  encoding: 'utf8',
})

if (result.status !== 0) {
  console.error('Migration failed:')
  console.error(result.stderr)
  process.exit(1)
}

if (result.stderr) {
  console.warn('Warnings:', result.stderr)
}

// ── Post-migration counts ──────────────────────────────────────────────────────
const dstSessionsAfter = count(WINDOWS_DB, 'app_sessions')
const dstVisitsAfter   = count(WINDOWS_DB, 'website_visits')

console.log('\n── Destination (DaylensWindows) — after ──────────────────────')
console.log(`  app_sessions:   ${dstSessionsBefore} → ${dstSessionsAfter} (+${dstSessionsAfter - dstSessionsBefore})`)
console.log(`  website_visits: ${dstVisitsBefore} → ${dstVisitsAfter} (+${dstVisitsAfter - dstVisitsBefore})`)

const dateRange = sql(WINDOWS_DB, `
  SELECT datetime(MIN(start_time)/1000, 'unixepoch', 'localtime') || ' → ' || datetime(MAX(start_time)/1000, 'unixepoch', 'localtime')
  FROM app_sessions
`, true)
console.log(`  date range: ${dateRange}`)

console.log('\nMigration complete.\n')
