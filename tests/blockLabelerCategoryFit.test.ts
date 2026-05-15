// Regression test for the v1 ship-blocker: a development-dominant block
// was being labeled with a pornhub page title because preferredArtifactLabel
// took pageRefs[0] regardless of dominantCategory. The labeler is now
// category-aware and the domain policy filters adult hosts at source.
//
// Layered through the real production paths:
//   - real schema (SCHEMA_SQL + ensureSearchSchema)
//   - real getTimelineDayPayload (workBlocks.ts) building blocks from
//     app_sessions + website_visits
//   - real labeler (finalizedLabelForBlock → preferredArtifactLabel)
//
// What we assert is the user-observable invariant: a development block
// must NOT carry a porn/social/entertainment page title as its label,
// even when such a visit was captured during the block's time window.

import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { ensureSearchSchema } from '../src/main/db/migrations.ts'
import { getTimelineDayPayload } from '../src/main/services/workBlocks.ts'

function ms(date: string, hour: number, minute = 0): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, hour, minute, 0, 0).getTime()
}

function seedDevSessionWithStrayPornVisit(db: Database.Database, date: string) {
  // 60 min Cursor (development) block; user briefly opens Dia and visits
  // pornhub for 90 seconds in the middle. Pre-fix, this 90s page title
  // would beat the 58-min dev label because preferredArtifactLabel took
  // pageRefs[0] unconditionally.
  const blockStart = ms(date, 9, 0)
  const cursorEnd = ms(date, 10, 0)

  const insertSession = db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name,
      capture_source, capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', 1)
  `)

  // Long Cursor session (development).
  insertSession.run(
    'com.todesktop.230313mzl4w4u92', 'Cursor',
    blockStart, cursorEnd, Math.floor((cursorEnd - blockStart) / 1000),
    'development', 1, 'insightsQueryRouter.ts — daylens', 'Cursor',
  )

  // Stray 90s Dia browser session in the middle.
  const diaStart = ms(date, 9, 30)
  const diaEnd = diaStart + 90 * 1000
  insertSession.run(
    'company.thebrowser.dia', 'Dia',
    diaStart, diaEnd, 90,
    'browsing', 0, 'Pornhub - some title', 'Dia',
  )

  // Website visit row matching the stray browser session.
  db.prepare(`
    INSERT INTO website_visits (
      browser_bundle_id, canonical_browser_id, visit_time, duration_sec,
      url, normalized_url, domain, page_title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'company.thebrowser.dia', 'dia',
    diaStart, 90,
    'https://www.pornhub.com/view_video.php?viewkey=abc123',
    'https://www.pornhub.com/view_video.php',
    'pornhub.com',
    'Cutie Brunette Some Video - Pornhub.com',
  )
}

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  ensureSearchSchema(db)
  return db
}

test('development block does NOT inherit adult-host page title as label', () => {
  const db = setupDb()
  const date = '2026-05-16'
  seedDevSessionWithStrayPornVisit(db, date)

  const payload = getTimelineDayPayload(db, date)
  assert.ok(payload.blocks.length > 0, 'expected at least one block')

  const devBlock = payload.blocks.find((block) => block.dominantCategory === 'development')
  assert.ok(devBlock, 'expected a development-dominant block')

  const label = devBlock.label.current.toLowerCase()
  assert.ok(!label.includes('pornhub'), `dev block label leaked adult title: ${devBlock.label.current}`)
  assert.ok(!label.includes('cutie'), `dev block label leaked adult title: ${devBlock.label.current}`)

  // The adult visit must not have produced any artifact at all —
  // buildPageCandidates filters at source.
  const pornArtifact = devBlock.topArtifacts.find((artifact) =>
    (artifact.host ?? '').includes('pornhub') || artifact.displayTitle.toLowerCase().includes('pornhub'),
  )
  assert.equal(pornArtifact, undefined, 'adult host page must not appear in topArtifacts')

  // No pageRef from the adult host either.
  const pornPage = devBlock.pageRefs.find((page) => page.domain?.includes('pornhub'))
  assert.equal(pornPage, undefined, 'adult host must not appear in pageRefs')

  db.close()
})

test('browsing-dominant block CAN take a non-blocked page title as label', () => {
  const db = setupDb()
  const date = '2026-05-16'
  const start = ms(date, 14, 0)
  const end = ms(date, 14, 30)
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, capture_source, capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'test', 1)
  `).run(
    'com.apple.Safari', 'Safari',
    start, end, Math.floor((end - start) / 1000),
    'browsing', 'Daylens v1 redesign — Notion', 'Safari',
  )
  db.prepare(`
    INSERT INTO website_visits (
      browser_bundle_id, canonical_browser_id, visit_time, duration_sec,
      url, normalized_url, domain, page_title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'com.apple.Safari', 'safari',
    start, Math.floor((end - start) / 1000),
    'https://notion.so/daylens/v1-redesign',
    'https://notion.so/daylens/v1-redesign',
    'notion.so',
    'Daylens v1 redesign',
  )

  const payload = getTimelineDayPayload(db, date)
  const browsingBlock = payload.blocks.find((block) => block.dominantCategory === 'browsing')
  assert.ok(browsingBlock, 'expected browsing-dominant block')
  // The page is allowed to label a browsing block.
  assert.ok(
    browsingBlock!.label.current.length > 0,
    'browsing block should have a non-empty label',
  )
  db.close()
})

test('block with mixed dev + brief non-adult browsing keeps dev-class label', () => {
  const db = setupDb()
  const date = '2026-05-16'
  const start = ms(date, 11, 0)
  const end = ms(date, 12, 0)

  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, capture_source, capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', 1)
  `).run(
    'com.microsoft.VSCode', 'Code',
    start, end, Math.floor((end - start) / 1000),
    'development', 1, 'workBlocks.ts — daylens', 'Code',
  )

  // 2-minute stray Safari visit to a news page — not adult, but the block
  // is still development-dominant. Pre-fix, the news title would win.
  const newsStart = ms(date, 11, 30)
  const newsEnd = newsStart + 120 * 1000
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, capture_source, capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'test', 1)
  `).run(
    'com.apple.Safari', 'Safari',
    newsStart, newsEnd, 120,
    'browsing', 'Some unrelated news article — Hacker News', 'Safari',
  )
  db.prepare(`
    INSERT INTO website_visits (
      browser_bundle_id, canonical_browser_id, visit_time, duration_sec,
      url, normalized_url, domain, page_title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'com.apple.Safari', 'safari',
    newsStart, 120,
    'https://news.ycombinator.com/item?id=12345',
    'https://news.ycombinator.com/item',
    'news.ycombinator.com',
    'Some unrelated news article — Hacker News',
  )

  const payload = getTimelineDayPayload(db, date)
  const devBlock = payload.blocks.find((block) => block.dominantCategory === 'development')
  assert.ok(devBlock, 'expected dev block')
  // Title must not be the news headline — dev block, news page is the wrong category.
  assert.ok(
    !devBlock!.label.current.toLowerCase().includes('hacker news'),
    `dev block leaked news label: ${devBlock!.label.current}`,
  )
  // The block should be labeled by the dev document (e.g. "workBlocks.ts") OR
  // a generic dev label — anything but the news page title.
  assert.ok(
    devBlock!.label.current.length > 0,
    'dev block should have a non-empty label',
  )
  db.close()
})
