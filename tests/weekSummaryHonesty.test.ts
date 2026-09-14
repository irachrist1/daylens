import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { insertFocusEvents } from '../src/main/db/focusEventRepository.ts'
import {
  FOCUS_EVENT_SCHEMA_VERSION,
  POLL_FOCUS_EVENT_SOURCE,
  type FocusEventInsert,
} from '../src/main/core/evidence/focusEvent.ts'
import { queryCorrectedActivityFactsForDay } from '../src/main/core/query/activityFactsQuery.ts'
import { executeTool } from '../src/main/services/aiTools.ts'
import { getTimelineDayPayload } from '../src/main/services/workBlocks.ts'
import { FOCUS_DEFINITION, computeSustainedFocus } from '../src/main/lib/focusScore.ts'

const WEEK_START = '2026-09-07'

function localMs(date: string, hour: number, minute = 0): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function focusEvent(
  tsMs: number,
  eventType: FocusEventInsert['event_type'],
  overrides: Partial<FocusEventInsert> = {},
): FocusEventInsert {
  return {
    ts_ms: tsMs,
    mono_ns: tsMs * 1_000_000,
    event_type: eventType,
    app_bundle_id: overrides.app_bundle_id ?? 'com.mitchellh.ghostty',
    app_name: overrides.app_name ?? 'Ghostty',
    pid: overrides.pid ?? 1001,
    window_title: overrides.window_title ?? 'Editor',
    url: null,
    page_title: null,
    source: POLL_FOCUS_EVENT_SOURCE,
    confidence: 'observed',
    platform: 'darwin',
    schema_ver: FOCUS_EVENT_SCHEMA_VERSION,
    ...overrides,
  }
}

function seedAppStretch(
  db: Database.Database,
  date: string,
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
  bundleId: string,
  appName: string,
): void {
  const start = localMs(date, startHour, startMinute)
  const end = localMs(date, endHour, endMinute)
  insertFocusEvents(db, [
    focusEvent(start, 'app_activated', { app_bundle_id: bundleId, app_name: appName }),
    focusEvent(end, 'app_deactivated', { app_bundle_id: bundleId, app_name: appName }),
  ])
}

function seedVisit(db: Database.Database, date: string, hour: number, minute: number): void {
  const visitTime = localMs(date, hour, minute)
  db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, visit_time, visit_time_us, duration_sec,
      browser_bundle_id, canonical_browser_id, source
    ) VALUES (?, ?, ?, ?, ?, ?, 'com.google.Chrome', 'chrome', 'history')
  `).run(
    'github.com',
    'daylens pull request',
    `https://github.com/irachrist1/daylens/pull/${hour}${minute}`,
    visitTime,
    visitTime * 1000,
    120,
  )
}

function session(
  startMin: number,
  durationMin: number,
  category: string,
  appName: string,
): {
  startTime: number
  endTime: number
  durationSeconds: number
  category: string
  bundleId: string
  appName: string
} {
  const startTime = startMin * 60_000
  return {
    startTime,
    endTime: startTime + durationMin * 60_000,
    durationSeconds: durationMin * 60,
    category,
    bundleId: appName.toLowerCase(),
    appName,
  }
}

test('computeSustainedFocus does not count AI-tool hops as focus', () => {
  const breakdown = computeSustainedFocus([
    session(0, 60, 'aiTools', 'Codex'),
    session(60, 60, 'aiTools', 'Grok'),
    session(120, 67, 'aiTools', 'Claude'),
  ])
  assert.equal(breakdown.focusSeconds, 0)
  assert.equal(breakdown.streakCount, 0)
})

test('computeSustainedFocus counts a 30 minute single-app development stretch', () => {
  const breakdown = computeSustainedFocus([
    session(0, 30, 'development', 'Ghostty'),
  ])
  assert.equal(breakdown.focusSeconds, 30 * 60)
  assert.equal(breakdown.streakCount, 1)
})

test('week and day summaries report real focus, expose the definition, and mark uncaptured days', () => {
  const db = createProductionTestDatabase()

  // Era starts before the week so a later empty day is a gap, not pre-capture.
  seedAppStretch(db, '2026-09-06', 9, 0, 9, 30, 'com.mitchellh.ghostty', 'Ghostty')

  // The DEV-489 example: 7 Sep 10:46–13:53 Codex / Grok / Claude.
  seedAppStretch(db, '2026-09-07', 10, 46, 11, 46, 'com.openai.codex', 'Codex')
  seedAppStretch(db, '2026-09-07', 11, 46, 12, 46, 'com.xai.grok', 'Grok')
  seedAppStretch(db, '2026-09-07', 12, 46, 13, 53, 'com.anthropic.claude', 'Claude')

  seedAppStretch(db, '2026-09-08', 9, 0, 9, 30, 'com.mitchellh.ghostty', 'Ghostty')

  seedVisit(db, '2026-09-09', 10, 0)
  seedVisit(db, '2026-09-09', 11, 0)
  seedVisit(db, '2026-09-09', 15, 0)

  const monday = queryCorrectedActivityFactsForDay(db, '2026-09-07', {
    nowMs: localMs('2026-09-14', 12),
    asOfMs: localMs('2026-09-08', 0),
  })
  assert.ok(monday.totalSeconds > 0, 'Monday has captured AI-tool time')
  assert.equal(monday.focusSeconds, 0, 'switching Codex/Grok/Claude is not focus')
  assert.ok(monday.workCategorySeconds > 0, 'category time is still available under its own name')

  const wednesday = queryCorrectedActivityFactsForDay(db, '2026-09-09', {
    nowMs: localMs('2026-09-14', 12),
    asOfMs: localMs('2026-09-10', 0),
  })
  assert.equal(wednesday.totalSeconds, 0)
  assert.equal(wednesday.captureCoverage, 'none')
  assert.ok(wednesday.websiteVisitCount >= 3)
  assert.ok(
    wednesday.gaps.some((gap) => gap.kind === 'capture_unavailable'),
    `expected a capture_unavailable gap, got ${JSON.stringify(wednesday.gaps)}`,
  )

  const saturday = queryCorrectedActivityFactsForDay(db, '2026-09-12', {
    nowMs: localMs('2026-09-14', 12),
    asOfMs: localMs('2026-09-13', 0),
  })
  assert.equal(saturday.totalSeconds, 0)
  assert.equal(saturday.captureCoverage, 'none')
  assert.ok(saturday.gaps.some((gap) => gap.kind === 'unknown' || gap.kind === 'capture_unavailable'))

  const week = executeTool('getWeekSummary', { weekStartDate: WEEK_START }, db) as {
    focusPct: number
    totalFocusSeconds: number
    focusDefinition: string
    captureCoverage: string
    dailyBreakdown: Array<{
      date: string
      totalSeconds: number
      focusSeconds: number
      captureStatus: string
      captureCoverage: string
      websiteVisitCount: number
      gaps: Array<{ kind: string }>
    }>
  }
  assert.equal(week.focusDefinition, FOCUS_DEFINITION)
  const mondayRow = week.dailyBreakdown.find((day) => day.date === '2026-09-07')
  assert.ok(mondayRow)
  assert.equal(mondayRow.focusSeconds, 0)
  assert.ok(mondayRow.totalSeconds > 0)
  const tuesdayRow = week.dailyBreakdown.find((day) => day.date === '2026-09-08')
  assert.ok(tuesdayRow)
  assert.equal(tuesdayRow.focusSeconds, 30 * 60)
  assert.ok(
    week.focusPct > 0 && week.focusPct < 20,
    `real focus should be the Tuesday Ghostty stretch, not Monday AI-tool time; got ${week.focusPct}%`,
  )
  assert.equal(week.captureCoverage, 'partial')

  const sep9 = week.dailyBreakdown.find((day) => day.date === '2026-09-09')
  assert.ok(sep9)
  assert.equal(sep9.totalSeconds, 0)
  assert.equal(sep9.captureStatus, 'uncaptured')
  assert.ok(sep9.websiteVisitCount >= 3)
  assert.ok(sep9.gaps.some((gap) => gap.kind === 'capture_unavailable'))

  const sep12 = week.dailyBreakdown.find((day) => day.date === '2026-09-12')
  assert.ok(sep12)
  assert.equal(sep12.captureStatus, 'uncaptured')

  const mondaySummary = executeTool('getDaySummary', { date: '2026-09-07' }, db) as {
    focusSeconds: number
    focusDefinition: string
    workCategorySeconds: number
  }
  assert.equal(mondaySummary.focusDefinition, FOCUS_DEFINITION)
  assert.equal(mondaySummary.focusSeconds, 0)
  assert.ok(mondaySummary.workCategorySeconds > 0)

  const mondayTimeline = getTimelineDayPayload(db, '2026-09-07', null)
  assert.equal(mondayTimeline.focusSeconds, 0)

  const wednesdayTimeline = getTimelineDayPayload(db, '2026-09-09', null)
  assert.ok(
    wednesdayTimeline.segments.some((segment) =>
      segment.kind !== 'work_block' && (
        segment.kind === 'capture_unavailable' || segment.kind === 'untracked'
      ),
    ),
    'an uncaptured day must render as a gap, not an empty zero-activity day',
  )

  db.close()
})
