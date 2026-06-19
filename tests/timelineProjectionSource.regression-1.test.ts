import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { getTimelineDayProjection } from '../src/main/core/query/projections.ts'
import { PROJECTION_VERSION } from '../src/main/core/projections/chunk2.ts'

// Regression: ISSUE-QA-001 — past days preferred sparse focus-event projections
// over the canonical foreground app sessions shown on Today.
// Found by /qa on 2026-06-19.
// Report: artifacts/timeline-v2/qa-2026-06-19/
test('past Timeline days prefer canonical app sessions over sparse derived focus events', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)

  const date = '2026-01-05'
  const start = new Date(2026, 0, 5, 9, 0, 0, 0).getTime()
  const end = start + 30 * 60_000

  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec, category,
      is_focused, window_title, raw_app_name, canonical_app_id,
      app_instance_id, capture_source, ended_reason, capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'com.microsoft.VSCode',
    'Visual Studio Code',
    start,
    end,
    30 * 60,
    'development',
    1,
    'Timeline.tsx — daylens',
    'Visual Studio Code',
    'vscode',
    'com.microsoft.VSCode',
    'foreground_poll',
    'app_switch',
    2,
  )

  const derivedSession = db.prepare(`
    INSERT INTO derived_sessions (
      date, start_ts_ms, end_ts_ms, active_seconds, app_bundle_id, app_name,
      window_title, confidence, category, is_browser, projection_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'observed', 'development', 0, ?)
  `).run(
    date,
    start,
    start + 5 * 60_000,
    5 * 60,
    'com.microsoft.VSCode',
    'Visual Studio Code',
    'Timeline.tsx — daylens',
    PROJECTION_VERSION,
  )
  const derivedBlock = db.prepare(`
    INSERT INTO derived_blocks (
      date, start_ts_ms, end_ts_ms, active_seconds, label, label_source,
      dominant_category, confidence, projection_version, finalized_at
    ) VALUES (?, ?, ?, ?, 'Software development', 'app', 'development', 'observed', ?, ?)
  `).run(
    date,
    start,
    start + 5 * 60_000,
    5 * 60,
    PROJECTION_VERSION,
    end,
  )
  db.prepare(`
    INSERT INTO derived_block_sessions (block_id, session_id)
    VALUES (?, ?)
  `).run(derivedBlock.lastInsertRowid, derivedSession.lastInsertRowid)
  db.prepare(`
    INSERT INTO derived_projection_runs (
      date, projection_version, events_in, sessions_out, blocks_out, finalized_at, started_at
    ) VALUES (?, ?, 1, 1, 1, ?, ?)
  `).run(date, PROJECTION_VERSION, end, start)

  const payload = getTimelineDayProjection(db, date, null, { materialize: false })

  assert.equal(payload.sessions.length, 1)
  assert.equal(payload.sessions[0].durationSeconds, 30 * 60)
  assert.equal(payload.totalSeconds, 30 * 60)
  assert.equal(payload.blocks.length, 1)

  db.close()
})
