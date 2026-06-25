// Persistence for generated wraps (DEV-118 / wrapped.md §3.3). A wrap is shown
// on open, never silently regenerated: once generated it is stored keyed by
// cadence + period (the DATE for a day, the anchor for a period), NOT by a facts
// hash — so today's wrap stays stable as the day accrues more activity, and only
// an explicit Regenerate (force) replaces it. The stored generated_at drives the
// honest "generated <when>" marker instead of stamping "just now" on every open.

import type Database from 'better-sqlite3'

export type WrappedCadence = 'day' | 'week' | 'month' | 'year'

export interface StoredWrappedNarrative<T> {
  narrative: T
  factsHash: string
  generatedAt: number
}

export function getStoredWrappedNarrative<T>(
  db: Database.Database,
  cadence: WrappedCadence,
  periodKey: string,
): StoredWrappedNarrative<T> | null {
  const row = db.prepare(`
    SELECT narrative_json, facts_hash, generated_at
    FROM wrapped_narratives
    WHERE cadence = ? AND period_key = ?
  `).get(cadence, periodKey) as { narrative_json: string; facts_hash: string; generated_at: number } | undefined
  if (!row) return null
  try {
    return {
      narrative: JSON.parse(row.narrative_json) as T,
      factsHash: row.facts_hash,
      generatedAt: row.generated_at,
    }
  } catch {
    return null
  }
}

export function putStoredWrappedNarrative<T>(
  db: Database.Database,
  cadence: WrappedCadence,
  periodKey: string,
  narrative: T,
  factsHash: string,
  generatedAt: number,
): void {
  db.prepare(`
    INSERT INTO wrapped_narratives (cadence, period_key, facts_hash, narrative_json, generated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(cadence, period_key) DO UPDATE SET
      facts_hash = excluded.facts_hash,
      narrative_json = excluded.narrative_json,
      generated_at = excluded.generated_at
  `).run(cadence, periodKey, factsHash, JSON.stringify(narrative), generatedAt)
}
