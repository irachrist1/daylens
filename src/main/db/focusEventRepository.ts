import type Database from 'better-sqlite3'
import type { FocusEvent } from '../core/evidence/focusEvent'

export interface StoredFocusEvent extends FocusEvent {
  id: number
}

const INSERT_FOCUS_EVENT = `
  INSERT INTO focus_events
    (ts_ms, mono_ns, event_type, app_bundle_id, app_name, pid, window_title,
     url, page_title, source, confidence, platform, schema_ver)
  VALUES
    (@ts_ms, @mono_ns, @event_type, @app_bundle_id, @app_name, @pid, @window_title,
     @url, @page_title, @source, @confidence, @platform, @schema_ver)
`

export function insertFocusEvents(db: Database.Database, events: readonly FocusEvent[]): void {
  if (events.length === 0) return
  const insert = db.prepare(INSERT_FOCUS_EVENT)
  db.transaction((batch: readonly FocusEvent[]) => {
    for (const event of batch) insert.run(event)
  })(events)
}

export function listFocusEventsInRange(
  db: Database.Database,
  fromMs: number,
  toMs: number,
): StoredFocusEvent[] {
  return db.prepare(`
    SELECT id, ts_ms, mono_ns, event_type, app_bundle_id, app_name, pid,
           window_title, url, page_title, source, confidence, platform, schema_ver
      FROM focus_events
     WHERE ts_ms >= ? AND ts_ms < ?
     ORDER BY ts_ms ASC, id ASC
  `).all(fromMs, toMs) as StoredFocusEvent[]
}

export function countFocusEventsInRange(
  db: Database.Database,
  fromMs: number,
  toMs: number,
): number {
  const row = db.prepare(
    'SELECT COUNT(*) AS count FROM focus_events WHERE ts_ms >= ? AND ts_ms < ?',
  ).get(fromMs, toMs) as { count: number }
  return row.count
}
