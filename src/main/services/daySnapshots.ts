// Frozen daily snapshots — service layer. Owns persistence and the "freeze a
// finalized day" decision. Past days freeze once (and re-freeze only when their
// underlying facts change, e.g. the user corrects a label). Today stays live
// (finalizedAt = 0) and is never persisted, because it isn't done yet.
//
// briefs-wraps.md §6.1, invariant 4: weekly/monthly/annual wraps SUM these.

import type Database from 'better-sqlite3'
import type { DaySnapshot } from '@shared/types'
import { getDb } from './database'
import { getTimelineDayPayload } from './workBlocks'
import { getCurrentSession } from './tracking'
import {
  getDaySnapshotRow,
  getDaySnapshotRowsForRange,
  getSessionsForRange,
  upsertDaySnapshot,
} from '../db/queries'
import { localDateString, localDayBounds, shiftLocalDateString } from '../lib/localDate'
import { buildDaySnapshot, isCurrentSnapshot } from '../lib/daySnapshot'

function hasActivityOn(db: Database.Database, date: string): boolean {
  const [fromMs, toMs] = localDayBounds(date)
  return getSessionsForRange(db, fromMs, toMs).length > 0
}

function buildLiveSnapshot(db: Database.Database, date: string): DaySnapshot {
  const today = localDateString()
  const liveSession = date === today ? getCurrentSession() : null
  const payload = getTimelineDayPayload(db, date, liveSession)
  return buildDaySnapshot(payload)
}

/**
 * Return the snapshot for one day. Past days are frozen on first read (and
 * re-frozen if their facts changed since). Today is computed live and never
 * persisted. Returns null when the day has no tracked activity at all.
 */
function getOrBuildDaySnapshot(date: string): DaySnapshot | null {
  const db = getDb()
  const today = localDateString()
  const isPast = date < today

  if (isPast) {
    const frozen = getDaySnapshotRow(db, date)
    const fresh = buildLiveSnapshot(db, date)
    if (fresh.totalActiveSeconds <= 0) {
      // Nothing tracked — leave it absent rather than freezing an empty day.
      return frozen && frozen.totalActiveSeconds > 0 ? frozen : null
    }
    if (frozen && frozen.factsHash === fresh.factsHash) return frozen
    const finalized: DaySnapshot = { ...fresh, finalizedAt: Date.now() }
    upsertDaySnapshot(db, finalized)
    return finalized
  }

  // Today (or a future date) — live, unpersisted.
  const live = buildLiveSnapshot(db, date)
  return live.totalActiveSeconds > 0 ? live : null
}

/** Freeze a specific day now — called when a day is explicitly finalized
 *  (Analyze Day) or has rolled over. Idempotent. */
export function freezeDaySnapshot(date: string): DaySnapshot | null {
  const db = getDb()
  if (!hasActivityOn(db, date)) return null
  const snapshot = { ...buildLiveSnapshot(db, date), finalizedAt: Date.now() }
  upsertDaySnapshot(db, snapshot)
  return snapshot
}

/**
 * All snapshots in an inclusive date range, frozen where they should be. Days
 * with no activity are simply absent from the result. The single source the
 * weekly/monthly/annual wraps read from.
 */
export function getDaySnapshotsForRange(startDate: string, endDate: string): DaySnapshot[] {
  const db = getDb()
  const today = localDateString()
  const frozen = new Map(getDaySnapshotRowsForRange(db, startDate, endDate).map((s) => [s.date, s]))

  const out: DaySnapshot[] = []
  let cursor = startDate
  // Guard the loop so a bad range can never spin forever.
  for (let i = 0; i <= 400 && cursor <= endDate; i += 1) {
    if (cursor < today) {
      const cached = frozen.get(cursor)
      // Serve a frozen row only when the CURRENT builder made it. A row from
      // an older builder is stale by construction (kind resolution, meeting
      // truth, and subject guards can all change) and would otherwise
      // be served forever — the hash check below never runs on this fast path.
      if (cached && cached.totalActiveSeconds > 0 && cached.finalizedAt > 0 && isCurrentSnapshot(cached)) {
        out.push(cached)
      } else {
        const built = getOrBuildDaySnapshot(cursor)
        if (built) out.push(built)
      }
    } else if (cursor === today) {
      const live = getOrBuildDaySnapshot(cursor)
      if (live) out.push(live)
    }
    cursor = shiftLocalDateString(cursor, 1)
  }
  return out
}
