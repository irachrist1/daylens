import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { localDayBounds } from '../src/main/lib/localDate.ts'
import { getCorrectedAppSummariesForRange } from '../src/main/services/activityFacts.ts'
import { executeTool, type DaySummaryResult } from '../src/main/services/aiTools.ts'
import { getTimelineDayPayload, userVisibleLabelForBlock } from '../src/main/services/workBlocks.ts'

const DATE = '2026-07-12'
const START = new Date(2026, 6, 12, 20, 0, 0, 0).getTime()
const END = START + 10 * 60_000

function setupDb(): Database.Database {
  const db = createProductionTestDatabase()
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec, category,
      is_focused, window_title, raw_app_name, canonical_app_id,
      app_instance_id, capture_source, capture_version
    ) VALUES ('company.thebrowser.dia', 'Dia', ?, ?, 600, 'browsing',
      0, NULL, 'Dia', 'dia', 'company.thebrowser.dia', 'foreground_poll', 2)
  `).run(START, END)
  db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, normalized_url, page_key,
      visit_time, visit_time_us, duration_sec, browser_bundle_id,
      canonical_browser_id, browser_profile_id, source
    ) VALUES ('netflix.com', 'Netflix', 'https://netflix.com/watch/81234567',
      'https://netflix.com/watch/81234567', 'netflix.com/watch/81234567',
      ?, ?, 600, 'company.thebrowser.dia', 'dia', 'default',
      'active_browser_context')
  `).run(START, BigInt(START) * 1000n)
  db.prepare(`
    INSERT INTO activity_state_events (event_ts, event_type, source, metadata_json)
    VALUES (?, 'idle_start', 'tracking', '{"heldForMediaPlayback":true}'),
           (?, 'idle_end', 'tracking', '{}')
  `).run(START + 2 * 60_000, END)
  return db
}

test('sustained titleless Netflix agrees across Timeline, Apps, and agent facts', () => {
  const db = setupDb()
  try {
    const timeline = getTimelineDayPayload(db, DATE)
    const netflixBlock = timeline.blocks.find((block) => block.dominantCategory === 'entertainment')
    assert.ok(netflixBlock, 'Timeline should show an entertainment block')
    assert.equal(netflixBlock?.endTime - netflixBlock!.startTime, 10 * 60_000)
    assert.match(userVisibleLabelForBlock(netflixBlock!), /watching|netflix/i)

    const [fromMs, toMs] = localDayBounds(DATE)
    const diaApp = getCorrectedAppSummariesForRange(db, fromMs, toMs)
      .find((app) => app.appName === 'Dia')
    assert.ok(diaApp)
    assert.equal(diaApp?.totalSeconds, 600)

    const agent = executeTool('getDaySummary', { date: DATE }, db) as DaySummaryResult
    const agentDia = agent._evidence.topApps.find((app) => app.appName === 'Dia')
    assert.ok(agent.blocks.some((block) => block.dominantCategory === 'entertainment'))
    assert.equal(agentDia?.totalSeconds, 600)
    assert.equal(agent.totalTrackedSeconds, timeline.totalSeconds)
  } finally {
    db.close()
  }
})
