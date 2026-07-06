import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { clearTestDb, setTestDb } from './support/database-stub.mjs'
import { weightedCategoryDistributionFor } from '../src/main/services/workBlocks.ts'
import type { AppSession } from '../src/shared/types.ts'

// Site-weighted category distribution (2026-07-06 founder audit): a browser
// session's seconds split across the categories of the sites reconciled
// inside the block, so a browser-centric day stops collapsing every block
// into the browser app's own category (one color everywhere). Invariant under
// test: Σ distribution = Σ session seconds — capture-gap visit credit is
// page EVIDENCE, never extra category seconds (Codex review finding #6).

const DAY_START = new Date(2026, 6, 3, 9, 0, 0, 0).getTime()
const HOUR = 3_600_000

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  setTestDb(db)
  return db
}

function insertSession(db: Database.Database, session: AppSession): void {
  db.prepare(`
    INSERT INTO app_sessions (
      id, bundle_id, app_name, start_time, end_time, duration_sec, category,
      is_focused, window_title, raw_app_name, canonical_app_id,
      app_instance_id, capture_source, capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'foreground_poll', 2)
  `).run(
    session.id,
    session.bundleId,
    session.appName,
    session.startTime,
    session.endTime,
    session.durationSeconds,
    session.category,
    session.isFocused ? 1 : 0,
    session.windowTitle,
    session.rawAppName,
    session.canonicalAppId,
    session.appInstanceId,
  )
}

function insertVisit(
  db: Database.Database,
  opts: { domain: string; visitTime: number; durationSec: number; browserBundleId?: string | null },
): void {
  db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, visit_time, visit_time_us, duration_sec,
      browser_bundle_id, canonical_browser_id, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active_browser_context')
  `).run(
    opts.domain,
    `Page on ${opts.domain}`,
    `https://${opts.domain}/`,
    opts.visitTime,
    opts.visitTime * 1000,
    opts.durationSec,
    opts.browserBundleId ?? 'company.thebrowser.dia',
    opts.browserBundleId === undefined ? 'dia' : null,
  )
}

function session(partial: Partial<AppSession> & Pick<AppSession, 'id' | 'startTime' | 'endTime'>): AppSession {
  const durationSeconds = Math.round(((partial.endTime ?? 0) - partial.startTime) / 1000)
  return {
    bundleId: 'company.thebrowser.dia',
    appName: 'Dia',
    durationSeconds,
    category: 'browsing',
    isFocused: false,
    windowTitle: null,
    rawAppName: 'Dia',
    canonicalAppId: 'dia',
    appInstanceId: 'company.thebrowser.dia',
    captureSource: 'foreground_poll',
    endedReason: null,
    captureVersion: 2,
    ...partial,
  } as AppSession
}

test('browser seconds split across reconciled site categories; the rest stays browsing', () => {
  const db = makeDb()
  try {
    // One Dia hour: 30 min on canva.com (design), the rest unattributed.
    const dia = session({ id: 1, startTime: DAY_START, endTime: DAY_START + HOUR })
    insertSession(db, dia)
    insertVisit(db, { domain: 'canva.com', visitTime: DAY_START, durationSec: 1800 })

    const distribution = weightedCategoryDistributionFor(db, [dia], DAY_START, DAY_START + HOUR)
    assert.equal(distribution.design, 1800)
    assert.equal(distribution.browsing, 1800)

    const total = Object.values(distribution).reduce((sum, sec) => sum + (sec ?? 0), 0)
    assert.equal(total, 3600, 'distribution must sum to session seconds')
  } finally {
    clearTestDb()
    db.close()
  }
})

test('capture-gap visit credit never adds seconds a session never had', () => {
  const db = makeDb()
  try {
    // 30 min of Dia, then a youtube visit accruing for an hour AFTER the
    // session ended (no app session there at all — an honest capture gap).
    // Reconciliation counts that visit as page evidence, but the category
    // distribution must stay bounded by the session's own 1800s.
    const dia = session({ id: 1, startTime: DAY_START, endTime: DAY_START + 1800_000 })
    insertSession(db, dia)
    insertVisit(db, { domain: 'youtube.com', visitTime: DAY_START + 2 * HOUR, durationSec: 3600 })

    const distribution = weightedCategoryDistributionFor(db, [dia], DAY_START, DAY_START + 4 * HOUR)
    assert.equal(distribution.entertainment ?? 0, 0, 'gap-time visit must not enter the distribution')
    assert.equal(distribution.browsing, 1800)

    const total = Object.values(distribution).reduce((sum, sec) => sum + (sec ?? 0), 0)
    assert.equal(total, 1800)
  } finally {
    clearTestDb()
    db.close()
  }
})

test('non-browser sessions keep their app category; browsers re-weight independently', () => {
  const db = makeDb()
  try {
    const dia = session({ id: 1, startTime: DAY_START, endTime: DAY_START + HOUR })
    const warp = session({
      id: 2,
      bundleId: 'dev.warp.Warp-Stable',
      appName: 'Warp',
      rawAppName: 'Warp',
      canonicalAppId: 'warp',
      appInstanceId: 'dev.warp.Warp-Stable',
      category: 'development',
      startTime: DAY_START + HOUR,
      endTime: DAY_START + HOUR + 1800_000,
    })
    insertSession(db, dia)
    insertSession(db, warp)
    insertVisit(db, { domain: 'claude.ai', visitTime: DAY_START, durationSec: 2700 })

    const distribution = weightedCategoryDistributionFor(db, [dia, warp], DAY_START, DAY_START + 2 * HOUR)
    assert.equal(distribution.aiTools, 2700)
    assert.equal(distribution.browsing, 900)
    assert.equal(distribution.development, 1800)

    const total = Object.values(distribution).reduce((sum, sec) => sum + (sec ?? 0), 0)
    assert.equal(total, 3600 + 1800)
  } finally {
    clearTestDb()
    db.close()
  }
})
