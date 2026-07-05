import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { getWebsiteSummariesForRange, getTopPagesForDomains } from '../src/main/db/queries.ts'

// Invariant 5 (the name says what you did) needs richer INPUT, not raw titles.
// Evidence selection used to rank page titles purely by reconciled dwell time,
// so a domain was represented by its longest-dwelt page — which for Notion is a
// generic hub ("Notes | All Notes | Notion", 649s), while the intent-bearing
// pages the user briefly opened ("AI Training Session | Notion", 12s;
// "Andersen AI Training — Level 3: AI Systems with Claude", 9s) were dropped.
// These are the real 2026-07-02 evening-block dwell numbers.

const DIA = 'company.thebrowser.dia'

function localMs(hour: number, minute = 0): number {
  return new Date(2026, 6, 2, hour, minute, 0, 0).getTime()
}

function insertSession(db: Database.Database, startMs: number, endMs: number): void {
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, capture_source, capture_version
    ) VALUES (?, 'Dia', ?, ?, ?, 'browsing', 1, 'foreground_poll', 1)
  `).run(DIA, startMs, endMs, Math.round((endMs - startMs) / 1000))
}

function insertVisit(db: Database.Database, title: string, path: string, visitMs: number, durationSec: number): void {
  db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, visit_time, visit_time_us, duration_sec,
      browser_bundle_id, source
    ) VALUES ('app.notion.com', ?, ?, ?, ?, ?, ?, 'history')
  `).run(title, `https://app.notion.com/${path}`, visitMs, visitMs * 1000, durationSec, DIA)
}

function seed(db: Database.Database): void {
  insertSession(db, localMs(23, 0), localMs(23, 30))
  // Generic workspace hub, most dwell — the page the user idled on.
  insertVisit(db, 'Notes | All Notes | Notion', 'notes-index', localMs(23, 0), 649)
  // The intent-bearing pages, briefly opened.
  insertVisit(db, 'AI Training Session | Notion', 'ai-training', localMs(23, 15), 12)
  insertVisit(db, 'Andersen AI Training — Level 3: AI Systems with Claude', 'andersen', localMs(23, 16), 9)
}

test('a domain summary top title prefers a specific page over a generic workspace hub', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  seed(db)

  const summaries = getWebsiteSummariesForRange(db, localMs(23, 0), localMs(23, 30))
  const notion = summaries.find((s) => s.domain === 'app.notion.com')
  assert.ok(notion, 'notion domain must appear')
  assert.notEqual(notion.topTitle, 'Notes | All Notes | Notion', 'a generic index page must not become "the Notes page" headline')
  assert.match(String(notion.topTitle), /AI Training|Andersen/, 'the specific work page names the domain')

  db.close()
})

test('top-pages evidence surfaces the specific intent-bearing titles, not just the high-dwell hub', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  seed(db)

  const byDomain = getTopPagesForDomains(db, localMs(23, 0), localMs(23, 30), ['app.notion.com'], 2)
  const titles = (byDomain['app.notion.com'] ?? []).map((p) => p.title)

  assert.ok(
    titles.some((t) => /AI Training Session/.test(String(t))),
    `expected "AI Training Session" among top pages, got: ${JSON.stringify(titles)}`,
  )
  assert.ok(
    titles.some((t) => /Andersen AI Training/.test(String(t))),
    `expected "Andersen AI Training" among top pages, got: ${JSON.stringify(titles)}`,
  )
  assert.notEqual(titles[0], 'Notes | All Notes | Notion', 'the generic hub must not be the sole/leading Notion signal')

  db.close()
})
