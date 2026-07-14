// Regression test: a development-dominant block was being labeled with a
// stray entertainment page title because preferredArtifactLabel took
// pageRefs[0] regardless of dominantCategory. The labeler is category-aware.
//
// Layered through the real production paths:
//   - production test database bootstrap
//   - real getTimelineDayPayload (workBlocks.ts) building blocks from
//     app_sessions + website_visits
//   - real labeler (finalizedLabelForBlock → preferredArtifactLabel)
//
// The user-observable invariant: a development block must NOT carry a
// social/entertainment page title as its label, even when such a visit was
// captured during the block's time window.

import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { getTimelineDayPayload } from '../src/main/services/workBlocks.ts'

function ms(date: string, hour: number, minute = 0): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, hour, minute, 0, 0).getTime()
}

function seedDevSessionWithStrayEntertainmentVisit(db: Database.Database, date: string) {
  // 60 min Cursor (development) block; user briefly opens Dia and watches a
  // video for 90 seconds in the middle. Pre-fix, this 90s page title would
  // beat the 58-min dev label because preferredArtifactLabel took
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

  // Stray 90s Dia browser session in the middle, on an entertainment host.
  const diaStart = ms(date, 9, 30)
  const diaEnd = diaStart + 90 * 1000
  insertSession.run(
    'company.thebrowser.dia', 'Dia',
    diaStart, diaEnd, 90,
    'browsing', 0, 'Ten Amazing Volcano Facts - YouTube', 'Dia',
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
    'https://www.youtube.com/watch?v=abc123',
    'https://www.youtube.com/watch',
    'youtube.com',
    'Ten Amazing Volcano Facts - YouTube',
  )
}

function setupDb(): Database.Database {
  return createProductionTestDatabase()
}

test('development block does NOT inherit a stray entertainment page title as label', () => {
  const db = setupDb()
  const date = '2026-05-16'
  seedDevSessionWithStrayEntertainmentVisit(db, date)

  const payload = getTimelineDayPayload(db, date)
  assert.ok(payload.blocks.length > 0, 'expected at least one block')

  const devBlock = payload.blocks.find((block) => block.dominantCategory === 'development')
  assert.ok(devBlock, 'expected a development-dominant block')

  const label = devBlock.label.current.toLowerCase()
  assert.ok(!label.includes('volcano'), `dev block label leaked the video title: ${devBlock.label.current}`)

  db.close()
})
