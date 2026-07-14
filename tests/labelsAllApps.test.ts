// Settings spec §4 / invariant #3: the Labels list shows EVERY app the user has
// used — including low-usage and uncategorized ones — so nothing (e.g. Zen) is
// unreachable. System noise never appears. A relabel reports what it touched.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import {
  getAllAppsForLabeling,
  getCategoryOverrideEffect,
  setCategoryOverride,
} from '../src/main/db/queries.ts'

function insertSession(
  db: Database.Database,
  opts: { bundleId: string; appName: string; startTime: number; durationSec: number; category?: string },
): void {
  db.prepare(`
    INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec, category)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    opts.bundleId,
    opts.appName,
    opts.startTime,
    opts.startTime + opts.durationSec * 1000,
    opts.durationSec,
    opts.category ?? 'uncategorized',
  )
}

const DAY = 86_400_000
const BASE = 1_700_000_000_000

test('Labels list includes every used app, including low-usage ones', () => {
  const db = createProductionTestDatabase()
  try {
    // A heavily-used dev app and a barely-used browser — both must be listed.
    insertSession(db, { bundleId: 'com.cursor.app', appName: 'Cursor', startTime: BASE, durationSec: 3600, category: 'development' })
    insertSession(db, { bundleId: 'com.zen.browser', appName: 'Zen', startTime: BASE + 1000, durationSec: 30, category: 'browsing' })

    const apps = getAllAppsForLabeling(db)
    const bundles = apps.map((a) => a.bundleId)
    assert.ok(bundles.includes('com.cursor.app'), 'Cursor should be listed')
    assert.ok(bundles.includes('com.zen.browser'), 'low-usage Zen must still be listed')
  } finally {
    db.close()
  }
})

test('System noise and sub-dwell blips never appear', () => {
  const db = createProductionTestDatabase()
  try {
    insertSession(db, { bundleId: 'com.cursor.app', appName: 'Cursor', startTime: BASE, durationSec: 600 })
    insertSession(db, { bundleId: 'com.apple.finder', appName: 'Finder', startTime: BASE + 1000, durationSec: 300 })
    insertSession(db, { bundleId: 'com.blip.app', appName: 'Blip', startTime: BASE + 2000, durationSec: 5 })

    const bundles = getAllAppsForLabeling(db).map((a) => a.bundleId)
    assert.ok(!bundles.includes('com.apple.finder'), 'Finder (UX noise) must be excluded')
    assert.ok(!bundles.includes('com.blip.app'), 'sub-dwell blip must be excluded')
  } finally {
    db.close()
  }
})

test('An override wins as the effective category in the list', () => {
  const db = createProductionTestDatabase()
  try {
    insertSession(db, { bundleId: 'com.zen.browser', appName: 'Zen', startTime: BASE, durationSec: 120, category: 'browsing' })
    setCategoryOverride(db, 'com.zen.browser', 'entertainment')

    const zen = getAllAppsForLabeling(db).find((a) => a.bundleId === 'com.zen.browser')
    assert.ok(zen)
    assert.equal(zen.category, 'entertainment', 'override must win over the detected category')
  } finally {
    db.close()
  }
})

test('A relabel reports the days/sessions it touched', () => {
  const db = createProductionTestDatabase()
  try {
    // Same app on three distinct local days.
    insertSession(db, { bundleId: 'com.zen.browser', appName: 'Zen', startTime: BASE, durationSec: 120 })
    insertSession(db, { bundleId: 'com.zen.browser', appName: 'Zen', startTime: BASE + DAY, durationSec: 120 })
    insertSession(db, { bundleId: 'com.zen.browser', appName: 'Zen', startTime: BASE + 2 * DAY, durationSec: 120 })

    const effect = getCategoryOverrideEffect(db, 'com.zen.browser')
    assert.equal(effect.sessionsAffected, 3)
    assert.equal(effect.daysAffected, 3, 'three distinct local days were seeded')
  } finally {
    db.close()
  }
})
