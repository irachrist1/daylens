import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { getRecapRange } from '../src/main/services/workBlocks.ts'
import { buildRecapSummaries } from '../src/renderer/lib/recap.ts'
import type { DayTimelinePayload } from '../src/shared/types.ts'

// Use a date in the past so getRecapRange takes the lightweight path
// (the "today" branch falls back to the full getTimelineDayPayload).
const PAST_DATE = '2026-04-12'

function localMs(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function makeDb(): Database.Database {
  return createProductionTestDatabase()
}

function seedSingleBlockDay(db: Database.Database): void {
  const start = localMs(2026, 4, 12, 10, 0)
  const end = localMs(2026, 4, 12, 11, 0)
  const computedAt = end

  const sessionStmt = db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, capture_source, capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  // Kiro is tracked for the first 50 minutes; the Safari visit sits in the
  // untracked tail of the hour. Site time only counts while its browser was
  // frontmost or while nothing was tracked at all — a visit behind another
  // focused app is a background tab and reconciles to zero.
  const info = sessionStmt.run(
    'com.kiro.kiro', 'Kiro', start, start + 50 * 60_000, 3000,
    'development', 1, 'src/main/services/workBlocks.ts — daylens', 'foreground_poll', 1,
  )
  const sessionId = String(info.lastInsertRowid)

  db.prepare(`
    INSERT INTO website_visits (
      browser_bundle_id, canonical_browser_id, visit_time, duration_sec,
      url, normalized_url, domain, page_title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'com.apple.Safari', 'safari', start + 50 * 60_000, 600,
    'https://github.com/irachrist1/daylens-v1/pull/36',
    'https://github.com/irachrist1/daylens-v1/pull/36',
    'github.com',
    'daylens-v1 pull request',
  )

  const evidenceSummary = {
    apps: [
      {
        bundleId: 'com.kiro.kiro',
        appName: 'Kiro',
        category: 'development',
        totalSeconds: 3600,
        sessionCount: 1,
        isBrowser: false,
      },
    ],
    pages: [],
    documents: [
      {
        id: 'doc-1',
        artifactType: 'window',
        displayTitle: 'workBlocks.ts — daylens',
        totalSeconds: 3600,
        confidence: 0.8,
        openTarget: { kind: 'none' },
      },
    ],
    domains: [],
  }

  db.prepare(`
    INSERT INTO timeline_blocks (
      id, date, start_time, end_time, block_kind,
      dominant_category, category_distribution_json, switch_count,
      label_current, label_source, label_confidence, narrative_current,
      evidence_summary_json, is_live, heuristic_version, computed_at,
      invalidated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'block-1', PAST_DATE, start, end, 'work',
    'development', JSON.stringify({ development: 1 }), 2,
    'Editing workBlocks.ts', 'artifact', 0.85, 'Focused editing session',
    JSON.stringify(evidenceSummary), 0, 'test-heuristic', computedAt,
    null,
  )

  db.prepare(`
    INSERT INTO timeline_block_members (block_id, member_type, member_id, start_time, end_time, weight_seconds)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('block-1', 'app_session', sessionId, start, end, 3600)

  db.prepare(`
    INSERT INTO timeline_block_labels (id, block_id, label, narrative, source, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('label-1', 'block-1', 'Editing workBlocks.ts', null, 'artifact', 0.85, computedAt)
}

test('getRecapRange lightweight payload populates every field recap consumers read', () => {
  const db = makeDb()
  seedSingleBlockDay(db)

  const payloads = getRecapRange(db, [PAST_DATE])
  assert.equal(payloads.length, 1)

  const payload = payloads[0]
  assert.equal(payload.date, PAST_DATE)
  assert.ok(payload.totalSeconds > 0, 'totalSeconds must be populated')
  assert.equal(typeof payload.focusSeconds, 'number', 'focusSeconds must be a number')
  assert.equal(payload.focusSeconds, payload.totalSeconds, 'development session counts as focused')
  assert.ok(Array.isArray(payload.sessions) && payload.sessions.length === 1, 'sessions must be real day sessions')
  assert.ok(Array.isArray(payload.websites) && payload.websites.length === 1, 'websites must be real day websites')
  assert.ok(Array.isArray(payload.segments) && payload.segments.some((segment) => segment.kind === 'work_block'), 'segments must include work blocks')
  assert.equal(payload.appCount, 1, 'appCount must be populated from real sessions')
  assert.equal(payload.siteCount, 1, 'siteCount must be populated from real websites')
  assert.ok(Array.isArray(payload.blocks) && payload.blocks.length === 1, 'blocks must be populated')
  assert.ok(Array.isArray(payload.focusSessions), 'focusSessions must be an array')

  const block = payload.blocks[0]
  assert.equal(typeof block.startTime, 'number')
  assert.equal(typeof block.endTime, 'number')
  assert.equal(block.dominantCategory, 'development')
  assert.equal(typeof block.switchCount, 'number')
  assert.ok(block.label.current.length > 0, 'block.label.current must be populated')
  assert.ok(Array.isArray(block.topApps), 'block.topApps must be populated')
  assert.ok(block.topApps.length > 0, 'block.topApps populated from evidence_summary_json')
  assert.ok(Array.isArray(block.sessions) && block.sessions.length === 1, 'block.sessions must use real member sessions')
  assert.ok(Array.isArray(block.websites) && block.websites.length === 1, 'block.websites must be populated from website visits')
  assert.ok(block.keyPages.includes('daylens-v1 pull request'), 'keyPages must be populated from top pages')
  assert.ok(Array.isArray(block.pageRefs), 'block.pageRefs must be an array')
  assert.ok(Array.isArray(block.documentRefs), 'block.documentRefs must be populated')
  assert.ok(Array.isArray(block.topArtifacts), 'block.topArtifacts must be populated')
})

test('buildRecapSummaries produces a non-empty day summary from a lightweight payload', () => {
  const db = makeDb()
  seedSingleBlockDay(db)

  const payloads = getRecapRange(db, [PAST_DATE])
  const summaries = buildRecapSummaries(payloads as DayTimelinePayload[], PAST_DATE)

  assert.ok(summaries.day, 'day summary must exist')
  assert.equal(summaries.day.hasData, true, 'day summary must have data when blocks are present')
  assert.ok(summaries.day.metrics, 'metrics block must be populated')
  assert.ok(summaries.day.trend.length > 0, 'trend must have at least one point')
  // standoutArtifacts come from block.topArtifacts which is the lightweight
  // payload's main carrier of work evidence.
  assert.ok(Array.isArray(summaries.day.standoutArtifacts), 'standoutArtifacts must be an array')
})
