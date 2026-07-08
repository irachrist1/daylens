// Guards the Apps view 30-day range. Switching to 30d used to freeze the app:
// getBrowserActivityBreakdown -> reconcileWebsiteVisits scaled O(visits²) (a
// per-visit full rescan of the growing "claimed" interval set, plus a
// per-visit rebuild of the browser's foreground windows), so a heavy browser
// user's 30-day history blocked the main process for 15-30s. This test builds
// a browser-heavy 30-day dataset and asserts the detail path (a) returns
// correct, reconciled totals and (b) completes well inside a time budget the
// old quadratic path could never meet.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { getAppDetailPayload } from '../src/main/services/workBlocks.ts'

function localDateString(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dayStartMs(offset: number): number {
  const [y, m, d] = localDateString(offset).split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function seedBrowserDays(db: Database.Database, days: number, visitsPerDay: number): void {
  const insertSession = db.prepare(`
    INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec, category,
      is_focused, window_title, raw_app_name, canonical_app_id, capture_source, capture_version)
    VALUES ('com.apple.Safari','Safari',?,?,?, 'browsing',0,'Safari','Safari','safari','test',2)`)
  const insertVisit = db.prepare(`
    INSERT INTO website_visits (domain, page_title, url, normalized_url, page_key,
      visit_time, visit_time_us, duration_sec, browser_bundle_id, canonical_browser_id, browser_profile_id, source)
    VALUES (?,?,?,?,?,?,?,?, 'com.apple.Safari','safari','default', ?)`)
  const domains = ['github.com', 'youtube.com', 'stackoverflow.com', 'notion.so', 'google.com', 'x.com', 'reddit.com', 'docs.google.com']
  const tx = db.transaction(() => {
    for (let day = 0; day < days; day++) {
      const sessionStart = dayStartMs(-day) + 9 * 3600_000
      insertSession.run(sessionStart, sessionStart + 8 * 3600_000, 8 * 3600)
      for (let i = 0; i < visitsPerDay; i++) {
        const domain = domains[i % domains.length]
        const vt = sessionStart + i * 60_000
        const url = `https://${domain}/page${i}`
        // Interleave active-context and history rows the way the two capture
        // paths really do — this is what fragmented "claimed" in the old code.
        insertVisit.run(domain, `Title ${i}`, url, url, `${domain}/page${i}`, vt, BigInt(vt) * 1000n, 90, i % 3 === 0 ? 'active_browser_context' : 'history')
      }
    }
  })
  tx()
}

test('30d browser detail reconciles and never exceeds the browser total', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  seedBrowserDays(db, 30, 200)

  const detail = getAppDetailPayload(db, 'safari', 30, null)
  const activity = detail.browserActivity
  assert.ok(activity, 'browser app must carry browserActivity')

  // Attribution can never invent time beyond what the browser was foregrounded.
  assert.ok(activity.attributedSeconds <= detail.totalSeconds)
  assert.equal(activity.unattributedSeconds, Math.max(0, detail.totalSeconds - activity.attributedSeconds))

  // Domain totals equal the sum of their pages; attributed equals the sum of
  // domains — the arithmetic the user checks on screen closes by construction.
  let domainSum = 0
  for (const domain of activity.domains) {
    const pageSum = domain.pages.reduce((n, p) => n + p.totalSeconds, 0)
    assert.equal(domain.totalSeconds, pageSum, `domain ${domain.domain} total must equal its pages' sum`)
    domainSum += domain.totalSeconds
  }
  assert.equal(activity.attributedSeconds, domainSum)
  db.close()
})

test('30d browser detail stays fast on a heavy history (no O(visits²) regression)', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  // ~36k in-window visits across 30 days. On the old quadratic path this took
  // several seconds; the reconciled path finishes in a few hundred ms.
  seedBrowserDays(db, 30, 1200)

  const started = Date.now()
  const detail = getAppDetailPayload(db, 'safari', 30, null)
  const elapsed = Date.now() - started

  assert.ok(detail.browserActivity, 'browser app must carry browserActivity')
  assert.ok(
    elapsed < 3000,
    `30d browser detail took ${elapsed}ms; expected < 3000ms (a slower result signals the O(visits²) freeze regressed)`,
  )
  db.close()
})
