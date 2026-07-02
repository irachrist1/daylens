import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { ownedDayBounds } from '../src/main/lib/dayOwnership.ts'
import { localDayBounds } from '../src/main/lib/localDate.ts'

function localMs(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function createDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE app_sessions (
      id INTEGER PRIMARY KEY,
      app_name TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      duration_sec INTEGER NOT NULL
    );
    CREATE TABLE activity_state_events (
      id INTEGER PRIMARY KEY,
      event_ts INTEGER NOT NULL,
      event_type TEXT NOT NULL
    );
  `)
  return db
}

function createTimelineBlocksTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE timeline_blocks (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      is_live INTEGER NOT NULL DEFAULT 0,
      invalidated_at INTEGER
    );
  `)
}

function insertSession(
  db: Database.Database,
  id: number,
  appName: string,
  start: number,
  end: number,
): void {
  db.prepare(`
    INSERT INTO app_sessions (id, app_name, start_time, end_time, duration_sec)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, appName, start, end, Math.round((end - start) / 1_000))
}

test('a finished late-night sitting belongs to the date where it started', () => {
  const db = createDb()
  insertSession(db, 1, 'Cursor', localMs(2026, 6, 20, 23, 30), localMs(2026, 6, 20, 23, 58))
  insertSession(db, 2, 'Terminal', localMs(2026, 6, 21, 0, 3), localMs(2026, 6, 21, 1, 0))
  insertSession(db, 3, 'Cursor', localMs(2026, 6, 21, 1, 5), localMs(2026, 6, 21, 2, 0))
  // A 20-minute pause stays inside the same sitting (45-minute break rule).
  insertSession(db, 4, 'Mail', localMs(2026, 6, 21, 2, 20), localMs(2026, 6, 21, 2, 45))
  // 75 minutes away seals the sitting; this one belongs to the 21st.
  insertSession(db, 5, 'Cursor', localMs(2026, 6, 21, 4, 0), localMs(2026, 6, 21, 5, 0))

  const nowMs = localMs(2026, 6, 21, 12, 0)
  const previous = ownedDayBounds(db, '2026-06-20', { nowMs })
  const current = ownedDayBounds(db, '2026-06-21', { nowMs })
  assert.equal(previous[1], localMs(2026, 6, 21, 2, 45))
  assert.equal(current[0], localMs(2026, 6, 21, 2, 45))
  assert.equal(current[1], localDayBounds('2026-06-21')[1])
})

test('a lock ends midnight carryover even when the next session starts quickly', () => {
  const db = createDb()
  insertSession(db, 1, 'Cursor', localMs(2026, 6, 20, 23, 40), localMs(2026, 6, 20, 23, 59))
  insertSession(db, 2, 'Cursor', localMs(2026, 6, 21, 0, 5), localMs(2026, 6, 21, 1, 0))
  db.prepare(`
    INSERT INTO activity_state_events (event_ts, event_type)
    VALUES (?, 'lock_screen')
  `).run(localMs(2026, 6, 21, 0, 1))

  const previous = ownedDayBounds(db, '2026-06-20', { nowMs: localMs(2026, 6, 21, 12, 0) })
  assert.equal(previous[1], localDayBounds('2026-06-20')[1])
})

// The resetting-tracked-time bug (2026-07-02): while a cross-midnight sitting
// is still running, the carry boundary advanced with every session flush, so
// "today" never began — its payload held only the in-memory live session and
// the tracked counter reset on every app switch. An open sitting is never
// carried backward; ownership is decided once the sitting has actually ended.
test('an open sitting is never carried into the previous day', () => {
  const db = createDb()
  insertSession(db, 1, 'Cursor', localMs(2026, 6, 20, 23, 30), localMs(2026, 6, 20, 23, 59))
  insertSession(db, 2, 'Terminal', localMs(2026, 6, 21, 0, 3), localMs(2026, 6, 21, 2, 0))

  // 10 minutes after the last flush: the sitting is still open.
  const during = localMs(2026, 6, 21, 2, 10)
  assert.equal(ownedDayBounds(db, '2026-06-21', { nowMs: during })[0], localDayBounds('2026-06-21')[0])
  assert.equal(ownedDayBounds(db, '2026-06-20', { nowMs: during })[1], localDayBounds('2026-06-20')[1])

  // 90 minutes after the last flush: the sitting is sealed and carries back.
  const after = localMs(2026, 6, 21, 3, 30)
  assert.equal(ownedDayBounds(db, '2026-06-21', { nowMs: after })[0], localMs(2026, 6, 21, 2, 0))
  assert.equal(ownedDayBounds(db, '2026-06-20', { nowMs: after })[1], localMs(2026, 6, 21, 2, 0))
})

test('a live in-memory session keeps the sitting open even when flushes are stale', () => {
  const db = createDb()
  insertSession(db, 1, 'Cursor', localMs(2026, 6, 20, 23, 30), localMs(2026, 6, 20, 23, 59))
  insertSession(db, 2, 'Cursor', localMs(2026, 6, 21, 0, 3), localMs(2026, 6, 21, 0, 30))

  // A long single-app session flushes only on switch: the last flush is an
  // hour old, but the tracker's live session continues the chain.
  const options = { nowMs: localMs(2026, 6, 21, 1, 30), liveSessionStartMs: localMs(2026, 6, 21, 0, 32) }
  assert.equal(ownedDayBounds(db, '2026-06-21', options)[0], localDayBounds('2026-06-21')[0])
  assert.equal(ownedDayBounds(db, '2026-06-20', options)[1], localDayBounds('2026-06-20')[1])
})

test("the previous day's persisted blocks pin the boundary between the days", () => {
  const db = createDb()
  createTimelineBlocksTable(db)
  insertSession(db, 1, 'Cursor', localMs(2026, 6, 20, 23, 30), localMs(2026, 6, 20, 23, 59))
  insertSession(db, 2, 'Terminal', localMs(2026, 6, 21, 0, 3), localMs(2026, 6, 21, 2, 0))
  insertSession(db, 3, 'Cursor', localMs(2026, 6, 21, 2, 5), localMs(2026, 6, 21, 3, 0))
  // The 20th was materialized claiming through 02:00; once written, that
  // boundary never moves again, whatever the session chain would say.
  db.prepare(`
    INSERT INTO timeline_blocks (id, date, start_time, end_time, is_live, invalidated_at)
    VALUES ('blk-1', '2026-06-20', ?, ?, 0, NULL)
  `).run(localMs(2026, 6, 20, 22, 0), localMs(2026, 6, 21, 2, 0))

  const nowMs = localMs(2026, 6, 21, 12, 0)
  assert.equal(ownedDayBounds(db, '2026-06-21', { nowMs })[0], localMs(2026, 6, 21, 2, 0))
  assert.equal(ownedDayBounds(db, '2026-06-20', { nowMs })[1], localMs(2026, 6, 21, 2, 0))
})
