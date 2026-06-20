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

test('an uninterrupted late-night stretch belongs to the date where it started', () => {
  const db = createDb()
  insertSession(db, 1, 'Cursor', localMs(2026, 6, 20, 23, 30), localMs(2026, 6, 20, 23, 58))
  insertSession(db, 2, 'Terminal', localMs(2026, 6, 21, 0, 3), localMs(2026, 6, 21, 1, 0))
  insertSession(db, 3, 'Cursor', localMs(2026, 6, 21, 1, 5), localMs(2026, 6, 21, 2, 0))
  insertSession(db, 4, 'Mail', localMs(2026, 6, 21, 2, 20), localMs(2026, 6, 21, 2, 45))

  const previous = ownedDayBounds(db, '2026-06-20')
  const current = ownedDayBounds(db, '2026-06-21')
  assert.equal(previous[1], localMs(2026, 6, 21, 2, 0))
  assert.equal(current[0], localMs(2026, 6, 21, 2, 0))
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

  const previous = ownedDayBounds(db, '2026-06-20')
  assert.equal(previous[1], localDayBounds('2026-06-20')[1])
})
