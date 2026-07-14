import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  countFocusEventsInRange,
  insertFocusEvents,
  listFocusEventsInRange,
} from '../src/main/db/focusEventRepository.ts'
import type { FocusEvent } from '../src/main/core/evidence/focusEvent.ts'

function createDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE focus_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts_ms INTEGER NOT NULL,
      mono_ns INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      app_bundle_id TEXT,
      app_name TEXT,
      pid INTEGER,
      window_title TEXT,
      url TEXT,
      page_title TEXT,
      source TEXT NOT NULL,
      confidence TEXT NOT NULL,
      platform TEXT NOT NULL,
      schema_ver INTEGER NOT NULL
    )
  `)
  return db
}

function event(tsMs: number, appName: string): FocusEvent {
  return {
    ts_ms: tsMs,
    mono_ns: tsMs * 1_000_000,
    event_type: 'app_activated',
    app_bundle_id: `test.${appName.toLowerCase()}`,
    app_name: appName,
    pid: 1,
    window_title: null,
    url: null,
    page_title: null,
    source: 'nsworkspace_event',
    confidence: 'observed',
    platform: 'darwin',
    schema_ver: 1,
  }
}

test('focus event repository batches inserts and returns a stable range order', () => {
  const db = createDb()
  try {
    insertFocusEvents(db, [event(200, 'Second'), event(100, 'First A'), event(100, 'First B')])

    const rows = listFocusEventsInRange(db, 100, 201)
    assert.deepEqual(rows.map((row) => row.app_name), ['First A', 'First B', 'Second'])
    assert.equal(countFocusEventsInRange(db, 100, 200), 2)
    assert.equal(countFocusEventsInRange(db, 100, 201), 3)
  } finally {
    db.close()
  }
})

test('focus event repository treats an empty insert as a no-op', () => {
  const db = createDb()
  try {
    insertFocusEvents(db, [])
    assert.equal(countFocusEventsInRange(db, 0, 1_000), 0)
  } finally {
    db.close()
  }
})
