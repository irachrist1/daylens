import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { runAttributionForRange } from '../src/main/services/attribution.ts'
import { routeInsightsQuestion } from '../src/main/lib/insightsQueryRouter.ts'

function localMs(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function localDayBounds(year: number, month: number, day: number): [number, number] {
  const from = localMs(year, month, day, 0, 0)
  return [from, from + 86_400_000]
}

test('active browser page titles feed evidence-backed time answers', async () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)

  const startTime = localMs(2026, 5, 1, 10, 0)
  const endTime = localMs(2026, 5, 1, 10, 45)
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
      canonical_app_id,
      app_instance_id,
      capture_source,
      capture_version
    ) VALUES (?, ?, ?, ?, ?, 'browsing', 1, ?, ?, 'chrome', ?, 'test', 2)
  `).run(
    'chrome.exe',
    'Google Chrome',
    startTime,
    endTime,
    Math.round((endTime - startTime) / 1000),
    'Google Chrome',
    'Google Chrome',
    'chrome.exe',
  )

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
      browser_profile_id,
      normalized_url,
      page_key,
      source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'default', ?, ?, 'active_browser_context')
  `).run(
    'docs.google.com',
    'ASYV renewal budget - Google Docs',
    'https://docs.google.com/document/d/asyv-renewal',
    startTime,
    BigInt(startTime) * 1000n,
    Math.round((endTime - startTime) / 1000),
    'chrome.exe',
    'chrome',
    'https://docs.google.com/document/d/asyv-renewal',
    'docs.google.com/document/d/asyv-renewal',
  )

  const [fromMs, toMs] = localDayBounds(2026, 5, 1)
  const attribution = runAttributionForRange(fromMs, toMs, {}, db)
  assert.equal(attribution.sessionCount, 1)

  const evidence = db.prepare(`
    SELECT evidence_value
    FROM work_session_evidence
    ORDER BY weight DESC
  `).all() as { evidence_value: string }[]
  assert.ok(evidence.some((row) => row.evidence_value.includes('ASYV renewal budget')))

  const routed = await routeInsightsQuestion(
    'How many hours did I spend on ASYV this week?',
    new Date(2026, 4, 3, 12, 0),
    null,
    db,
  )

  assert.ok(routed && routed.kind === 'answer')
  assert.match(routed.answer, /ASYV in this week \(evidence-backed\): 45m matched/)
  assert.match(routed.answer, /Structured client\/project attribution was missing/)
  db.close()
})
