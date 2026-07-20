// Per-display visibility (#21 part 2): a full-screen app on a second monitor
// accrues honest visible time while another app owns input focus. These tests
// drive the TS pipeline against a simulated native sample stream, the same
// way the tracking tests simulate the poll FSM — the Swift sampler itself
// needs a real Mac (see the PR notes).

import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import {
  foldDisplayVisibleSessions,
  deriveSecondaryVisibleSpans,
  rebuildDisplayVisibleSessions,
  getSecondaryDisplayVisibleSpansForRange,
} from '../src/main/core/projections/displayVisibility.ts'
import {
  getDisplayVisibilityStats,
  insertFocusEvents,
  listFocusEvidenceInRange,
} from '../src/main/db/focusEventRepository.ts'
import type { FocusEventInsert } from '../src/main/core/evidence/focusEvent.ts'
import type { StoredFocusEvent } from '../src/main/db/focusEventRepository.ts'
import { shouldCaptureFocusEvent, eventParams } from '../src/main/services/focusCapture.ts'
import { getTimelineDayPayload } from '../src/main/services/workBlocks.ts'
import { localDateString } from '../src/main/lib/localDate.ts'
import type { TrackingControlsState } from '../src/shared/trackingControls.ts'

const DISPLAY_2 = 724062012

function displayEvent(
  tsMs: number,
  eventType: 'display_visible_changed' | 'display_visible_sampled',
  overrides: Partial<FocusEventInsert> = {},
): FocusEventInsert {
  return {
    ts_ms: tsMs,
    mono_ns: tsMs * 1_000_000,
    event_type: eventType,
    app_bundle_id: 'company.thebrowser.dia',
    app_name: 'Dia',
    pid: 4242,
    window_title: 'Supervised Machine Learning — Coursera',
    url: null,
    page_title: null,
    source: 'cg_display_visibility',
    confidence: 'observed',
    platform: 'darwin',
    schema_ver: 2,
    display_id: DISPLAY_2,
    ...overrides,
  }
}

// Simulated stream rows for the pure fold (no DB) — the stored shape the
// repository would return.
function stored(ev: FocusEventInsert, id: number): StoredFocusEvent {
  return {
    ...ev,
    id,
    evidence_id: `ev-${id}`,
    display_id: ev.display_id ?? null,
    sensitivity: 'standard',
    provenance_method: 'cg_window_list',
    permission_scope: 'macos_onscreen_window_visibility',
    policy_version: 1,
  } as StoredFocusEvent
}

function streamOf(events: FocusEventInsert[]): StoredFocusEvent[] {
  return events.map((ev, index) => stored(ev, index + 1))
}

function localMs(date: string, hour: number, minute = 0, second = 0): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, hour, minute, second, 0).getTime()
}

// Heartbeats every 10s from startMs (exclusive) to endMs (inclusive), the way
// the helper proves a full-screen window stayed put.
function heartbeats(startMs: number, endMs: number, overrides: Partial<FocusEventInsert> = {}): FocusEventInsert[] {
  const out: FocusEventInsert[] = []
  for (let ts = startMs + 10_000; ts <= endMs; ts += 10_000) {
    out.push(displayEvent(ts, 'display_visible_sampled', overrides))
  }
  return out
}

test('a full-screen app on a display folds into one visible session bounded by its change events', () => {
  const t0 = 1_000_000
  const sessions = foldDisplayVisibleSessions(streamOf([
    displayEvent(t0, 'display_visible_changed'),
    ...heartbeats(t0, t0 + 120_000),
    displayEvent(t0 + 125_000, 'display_visible_changed', {
      app_bundle_id: null, app_name: null, pid: null, window_title: null,
    }),
  ]), t0 + 600_000)

  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].displayId, DISPLAY_2)
  assert.equal(sessions[0].bundleId, 'company.thebrowser.dia')
  assert.equal(sessions[0].startMs, t0)
  assert.equal(sessions[0].endMs, t0 + 125_000)
  assert.equal(sessions[0].windowTitle, 'Supervised Machine Learning — Coursera')
})

test('a visible span never stretches across a sampling hole: it ends at the last proof plus the tolerated gap', () => {
  const t0 = 1_000_000
  // Proof stops at t0+10s; the next event arrives 5 minutes later.
  const sessions = foldDisplayVisibleSessions(streamOf([
    displayEvent(t0, 'display_visible_changed'),
    displayEvent(t0 + 10_000, 'display_visible_sampled'),
    displayEvent(t0 + 300_000, 'display_visible_changed', {
      app_bundle_id: null, app_name: null, pid: null, window_title: null,
    }),
  ]), t0 + 600_000)

  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].endMs, t0 + 10_000 + 30_000, 'end = last heartbeat + max tolerated hole, never the far edge')
})

test('sleep and lock close every open visible span at the machine-state boundary', () => {
  const t0 = 1_000_000
  const sleepEvent: FocusEventInsert = {
    ts_ms: t0 + 40_000,
    mono_ns: (t0 + 40_000) * 1_000_000,
    event_type: 'sleep',
    app_bundle_id: null,
    app_name: null,
    pid: null,
    window_title: null,
    url: null,
    page_title: null,
    source: 'nsworkspace_event',
    confidence: 'observed',
    platform: 'darwin',
    schema_ver: 2,
  }
  const sessions = foldDisplayVisibleSessions(streamOf([
    displayEvent(t0, 'display_visible_changed'),
    ...heartbeats(t0, t0 + 40_000),
    sleepEvent,
    ...heartbeats(t0 + 3_600_000, t0 + 3_700_000), // stale post-hole samples open a NEW span
  ]), t0 + 4_000_000)

  assert.equal(sessions.length, 2)
  assert.equal(sessions[0].endMs, t0 + 40_000, 'sleep closes the span exactly at the boundary')
  assert.ok(sessions[1].startMs >= t0 + 3_600_000, 'post-wake visibility is a fresh span, not a stretch')
})

test('identity-free watching heartbeats are health signal only — they never open a session', () => {
  const t0 = 1_000_000
  const sessions = foldDisplayVisibleSessions(streamOf([
    displayEvent(t0, 'display_visible_changed', { app_bundle_id: null, app_name: null, pid: null, window_title: null }),
    displayEvent(t0 + 300_000, 'display_visible_sampled', { app_bundle_id: null, app_name: null, pid: null, window_title: null }),
  ]), t0 + 600_000)
  assert.equal(sessions.length, 0)
})

test('sub-10s visibility flicker is dropped as noise', () => {
  const t0 = 1_000_000
  const sessions = foldDisplayVisibleSessions(streamOf([
    displayEvent(t0, 'display_visible_changed'),
    displayEvent(t0 + 5_000, 'display_visible_changed', {
      app_bundle_id: null, app_name: null, pid: null, window_title: null,
    }),
  ]), t0 + 600_000)
  assert.equal(sessions.length, 0)
})

// ─── The honesty join: visible vs focused ────────────────────────────────────

test("the owner's morning: full-screen Coursera in Dia on monitor 2 accrues visible time while Notion owns focus on monitor 1", () => {
  const nineThirteen = 1_800_000_000_000
  const elevenTwentyThree = nineThirteen + (2 * 60 + 10) * 60_000

  const visible = foldDisplayVisibleSessions(streamOf([
    displayEvent(nineThirteen, 'display_visible_changed'),
    ...heartbeats(nineThirteen, elevenTwentyThree),
  ]), elevenTwentyThree)

  const spans = deriveSecondaryVisibleSpans(visible, [
    { bundleId: 'notion.id', appName: 'Notion', startTime: nineThirteen, endTime: elevenTwentyThree },
  ])

  assert.equal(spans.length, 1)
  const span = spans[0]
  assert.equal(span.presence, 'visible', 'the label must say what it is: visible/playing, not input-focused')
  assert.equal(span.appName, 'Dia')
  const durationMinutes = (span.endTime - span.startTime) / 60_000
  assert.ok(durationMinutes >= 129 && durationMinutes <= 130, `the 2h10m stretch survives (~130m, got ${durationMinutes})`)
})

test('time an app was both visible and input-focused belongs to the foreground stream alone — no double counting', () => {
  const t0 = 1_800_000_000_000
  const visible = foldDisplayVisibleSessions(streamOf([
    displayEvent(t0, 'display_visible_changed'),
    ...heartbeats(t0, t0 + 60 * 60_000),
  ]), t0 + 60 * 60_000)

  // Dia itself owned input focus for the middle 20 minutes.
  const spans = deriveSecondaryVisibleSpans(visible, [
    { bundleId: 'company.thebrowser.dia', appName: 'Dia', startTime: t0 + 20 * 60_000, endTime: t0 + 40 * 60_000 },
  ])

  assert.equal(spans.length, 2, 'the focused middle is cut out')
  assert.equal(spans[0].startTime, t0)
  assert.equal(spans[0].endTime, t0 + 20 * 60_000)
  assert.equal(spans[1].startTime, t0 + 40 * 60_000)
  const visibleSeconds = spans.reduce((sum, s) => sum + (s.endTime - s.startTime), 0) / 1000
  assert.equal(visibleSeconds, 40 * 60, 'visible + focused = the whole hour, each minute counted once')
})

// ─── Privacy ─────────────────────────────────────────────────────────────────

const controls: TrackingControlsState = {
  consented: true, enabled: true, paused: false,
  excludedApps: ['com.spotify.client'], excludedSites: [],
}

test('privacy gates apply to the visible stream: excluded apps, incognito titles, and consent', () => {
  const excluded = displayEvent(0, 'display_visible_changed', { app_bundle_id: 'com.spotify.client', app_name: 'Spotify' })
  assert.equal(shouldCaptureFocusEvent(excluded, controls), false, 'an excluded app is invisible on every display')

  const incognito = displayEvent(0, 'display_visible_changed', { window_title: 'Secret course (Incognito)' })
  assert.equal(shouldCaptureFocusEvent(incognito, controls), false, 'a private window is never evidence, full-screen or not')

  const unconsented: TrackingControlsState = { ...controls, consented: false }
  assert.equal(shouldCaptureFocusEvent(displayEvent(0, 'display_visible_changed'), unconsented), false)

  assert.equal(shouldCaptureFocusEvent(displayEvent(0, 'display_visible_changed'), controls), true)
})

test('a browser full-screen on a second display keeps app identity and timing only — the title is stripped before persistence', () => {
  const dia = eventParams({
    ...displayEvent(1_000, 'display_visible_changed'),
    display_id: DISPLAY_2,
  } as never)
  assert.equal(dia.app_bundle_id, 'company.thebrowser.dia', 'identity survives')
  assert.equal(dia.window_title, null, 'an unverifiable browser window title never persists')
  assert.equal(dia.display_id, DISPLAY_2, 'the display fact survives')

  const keynote = eventParams({
    ...displayEvent(1_000, 'display_visible_changed', {
      app_bundle_id: 'com.apple.iWork.Keynote', app_name: 'Keynote', window_title: 'Q3 review',
    }),
  } as never)
  assert.equal(keynote.window_title, 'Q3 review', 'a non-browser title flows through the normal title pipeline')
})

// ─── Repository contract ─────────────────────────────────────────────────────

test('the repository enforces the display contract: display events need a display, others must not claim one, page content is rejected', () => {
  const db = createProductionTestDatabase()
  try {
    const missingDisplay = insertFocusEvents(db, [displayEvent(1_000, 'display_visible_changed', { display_id: null })])
    assert.deepEqual([missingDisplay.inserted, missingDisplay.rejectedReasons], [0, ['display_identity_violation']])

    const foregroundWithDisplay = insertFocusEvents(db, [{
      ...displayEvent(2_000, 'display_visible_changed'),
      event_type: 'app_activated',
      source: 'nsworkspace_event',
      window_title: null,
    }])
    assert.deepEqual([foregroundWithDisplay.inserted, foregroundWithDisplay.rejectedReasons], [0, ['display_identity_violation']])

    const withPageContent = insertFocusEvents(db, [displayEvent(3_000, 'display_visible_sampled', { url: 'https://coursera.org/learn' })])
    assert.deepEqual([withPageContent.inserted, withPageContent.rejectedReasons], [0, ['page_content_violation']])

    const wrongSource = insertFocusEvents(db, [{
      ...displayEvent(4_000, 'display_visible_changed'),
      source: 'foreground_poll',
      display_id: null,
    }])
    assert.deepEqual([wrongSource.inserted, wrongSource.rejectedReasons], [0, ['source_kind_mismatch']])

    const good = insertFocusEvents(db, [displayEvent(5_000, 'display_visible_changed')])
    assert.deepEqual([good.inserted, good.rejected], [1, 0])

    const envelopes = listFocusEvidenceInRange(db, 5_000, 5_001, 'device-1')
    assert.equal(envelopes.length, 1)
    assert.equal(envelopes[0].kind, 'display_visible_changed')
    assert.equal((envelopes[0].payload as { displayId: number | null }).displayId, DISPLAY_2)
    assert.equal(envelopes[0].provenance.method, 'cg_window_list')
  } finally {
    db.close()
  }
})

test('capture health reports the display stream honestly: unavailable → watching → visible', () => {
  const db = createProductionTestDatabase()
  try {
    assert.equal(getDisplayVisibilityStats(db, 0).recentSamples, 0, 'no samples = no signal, health says so')

    // The stream watches a display with nothing full-screen…
    insertFocusEvents(db, [displayEvent(10_000, 'display_visible_changed', {
      app_bundle_id: null, app_name: null, pid: null, window_title: null,
    })])
    let stats = getDisplayVisibilityStats(db, 0)
    assert.equal(stats.recentSamples, 1)
    assert.equal(stats.distinctDisplays, 1)
    assert.equal(stats.samplesWithApp, 0)

    // …then a full-screen app appears.
    insertFocusEvents(db, [displayEvent(20_000, 'display_visible_changed')])
    stats = getDisplayVisibilityStats(db, 0)
    assert.equal(stats.samplesWithApp, 1)
    assert.equal(stats.lastSampleAtMs, 20_000)
  } finally {
    db.close()
  }
})

// ─── End to end: the day reconstructs fully ──────────────────────────────────

function insertSession(db: Database.Database, o: { bundleId: string; appName: string; start: number; end: number; category: string; windowTitle?: string }): void {
  db.prepare(`INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec, category, is_focused, window_title, raw_app_name, canonical_app_id, capture_source, capture_version)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'test', 2)`).run(
    o.bundleId, o.appName, o.start, o.end, Math.round((o.end - o.start) / 1000), o.category, o.windowTitle ?? null, o.appName, o.bundleId,
  )
}

test("the timeline day payload carries the second monitor: Notion focused on monitor 1, full-screen Dia/Coursera visible on monitor 2", () => {
  const db = createProductionTestDatabase()
  try {
    const today = localDateString()
    const start = localMs(today, 9, 13)
    const end = localMs(today, 11, 23)

    // Monitor 1: the user takes notes in Notion the whole stretch.
    insertSession(db, { bundleId: 'notion.id', appName: 'Notion', start, end, category: 'productivity', windowTitle: 'ML roadmap' })

    // Monitor 2: the simulated native stream reports Dia full-screen.
    insertFocusEvents(db, [
      displayEvent(start, 'display_visible_changed'),
      ...heartbeats(start, end),
    ])

    const payload = getTimelineDayPayload(db, today, null, { materialize: false })

    assert.ok(payload.totalSeconds > 0, 'the focused day is present')
    const spans = payload.secondaryDisplay ?? []
    assert.equal(spans.length, 1, 'the second monitor is part of the day')
    assert.equal(spans[0].appName, 'Dia')
    assert.equal(spans[0].presence, 'visible', 'labeled for what it is — visible, not input-focused')
    const visibleMinutes = (spans[0].endTime - spans[0].startTime) / 60_000
    assert.ok(visibleMinutes >= 125, `the ~2h10m Coursera stretch is in the day (got ${visibleMinutes}m)`)

    // The visible time is presence evidence — it must NOT inflate the
    // input-focused foreground total.
    assert.ok(payload.totalSeconds <= (end - start) / 1000 + 60, 'foreground totals stay input-focused truth')

    // Same visible stream, rebuilt straight from canonical evidence.
    const sessions = rebuildDisplayVisibleSessions(db, start, end)
    assert.equal(sessions.length, 1)

    // An exclusion added later hides the app from the visible stream too.
    db.prepare(`INSERT INTO evidence_exclusions (id, date, kind, bundle_id, app_name, domain, span_start_ms, span_end_ms, created_at)
      VALUES ('x1', ?, 'app', 'company.thebrowser.dia', 'Dia', NULL, ?, ?, ?)`).run(today, start, end, Date.now())
    const excludedSpans = getSecondaryDisplayVisibleSpansForRange(db, start, end, payload.sessions)
    assert.equal(excludedSpans.length, 0, 'excluded evidence cannot resurface through the visible stream')
  } finally {
    db.close()
  }
})
