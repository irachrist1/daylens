import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { getAppDetailPayload } from '../src/main/services/workBlocks.ts'

function todayKey(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localMs(date: string, hour: number, minute = 0): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

test('app detail omits app-name-only block appearances', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  const date = todayKey()
  const start = localMs(date, 9)
  const end = start + 12 * 60_000

  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id,
      app_name,
      start_time,
      end_time,
      duration_sec,
      category,
      is_focused,
      window_title,
      raw_app_name,
      capture_source,
      capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'test', 1)
  `).run(
    'com.whatsapp.WhatsApp',
    'whatsApp',
    start,
    end,
    12 * 60,
    'communication',
    'WhatsApp',
    'whatsApp',
  )

  const detail = getAppDetailPayload(db, 'whatsapp', 1, null)

  assert.equal(detail.displayName, 'WhatsApp')
  assert.deepEqual(detail.blockAppearances, [])
  db.close()
})

test('app detail keeps total time but merges quick returns into one human session', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  const date = todayKey()
  const start = localMs(date, 9)

  const insert = db.prepare(`
    INSERT INTO app_sessions (
      bundle_id,
      app_name,
      start_time,
      end_time,
      duration_sec,
      category,
      is_focused,
      window_title,
      raw_app_name,
      canonical_app_id,
      capture_source,
      capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'test', 1)
  `)

  insert.run('com.example.TestApp', 'Test App', start, start + 10_000, 10, 'development', 'Brief flicker', 'Test App', 'test-app')
  insert.run('com.example.TestApp', 'Test App', start + 60_000, start + 80_000, 20, 'development', 'Visible session', 'Test App', 'test-app')

  const detail = getAppDetailPayload(db, 'test-app', 1, null)

  assert.equal(detail.totalSeconds, 30)
  assert.equal(detail.sessionCount, 1)
  db.close()
})

test('browser detail reads deduped pages directly, with visit counts and work first', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  const date = todayKey()
  const start = localMs(date, 9)

  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec, category,
      is_focused, window_title, raw_app_name, canonical_app_id, capture_source, capture_version
    ) VALUES ('com.apple.Safari', 'Safari', ?, ?, 3600, 'browsing', 0, 'Safari', 'Safari', 'safari', 'test', 2)
  `).run(start, start + 60 * 60_000)

  const insertVisit = db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, normalized_url, page_key,
      visit_time, visit_time_us, duration_sec, browser_bundle_id,
      canonical_browser_id, browser_profile_id, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'com.apple.Safari', 'safari', 'default', 'test')
  `)
  const githubUrl = 'https://github.com/irachrist1/daylens/pull/82'
  insertVisit.run('github.com', 'DEV-89', githubUrl, githubUrl, 'github.com/irachrist1/daylens/pull/82', start, BigInt(start) * 1_000n, 60)
  insertVisit.run('github.com', 'DEV-89', githubUrl, githubUrl, 'github.com/irachrist1/daylens/pull/82', start + 120_000, BigInt(start + 120_000) * 1_000n, 60)
  const youtubeUrl = 'https://youtube.com/watch?v=1'
  insertVisit.run('youtube.com', 'A long video', youtubeUrl, youtubeUrl, 'youtube.com/watch', start + 240_000, BigInt(start + 240_000) * 1_000n, 1200)
  const secondYoutubeUrl = 'https://youtube.com/watch?v=2'
  insertVisit.run('youtube.com', 'A different video', secondYoutubeUrl, secondYoutubeUrl, 'youtube.com/watch', start + 360_000, BigInt(start + 360_000) * 1_000n, 600)

  const detail = getAppDetailPayload(db, 'safari', 1, null)
  assert.equal(detail.topPages.length, 3)
  assert.equal(detail.topPages[0].domain, 'github.com')
  assert.equal(detail.topPages[0].visitCount, 2)
  assert.equal(detail.topPages[0].totalSeconds, 120)
  assert.equal(detail.topPages[1].domain, 'youtube.com')
  assert.equal(detail.topPages[1].normalizedUrl, youtubeUrl)
  assert.equal(detail.topPages[2].normalizedUrl, secondYoutubeUrl)
  db.close()
})

test('past-day app detail never mixes in the current live session', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  const past = new Date()
  past.setDate(past.getDate() - 1)
  const date = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`
  const start = localMs(date, 9)

  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec, category,
      is_focused, window_title, raw_app_name, canonical_app_id, capture_source, capture_version
    ) VALUES ('com.example.TestApp', 'Test App', ?, ?, 600, 'development', 1, 'Past work', 'Test App', 'test-app', 'test', 2)
  `).run(start, start + 10 * 60_000)

  const detail = getAppDetailPayload(db, 'test-app', date, {
    bundleId: 'com.example.TestApp',
    appName: 'Test App',
    canonicalAppId: 'test-app',
    startTime: Date.now() - 5 * 60_000,
    category: 'development',
  })

  assert.equal(detail.totalSeconds, 600)
  assert.equal(detail.sessionCount, 1)
  db.close()
})
