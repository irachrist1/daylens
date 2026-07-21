// The entities a day's evidence supports naming — the deterministic source of
// the wrap's "what the day was about" scene. Reads the entity ledger's
// evidence spans and intersects them with the day's SURVIVING timeline blocks,
// so an entity only earns time through evidence the person has not deleted or
// excluded: a span that overlaps nothing that still renders contributes zero.
//
// High-sensitivity entities never surface here (a wrap is shareable and its
// lead can reach a lock screen); raw-artifact-looking names are dropped, not
// shown, exactly as everywhere else prose is built.

import type Database from 'better-sqlite3'
import type { DayWrapEntity } from '@shared/types'
import { looksLikeRawArtifactLabel } from '@shared/blockLabel'
import { findRawArtifactLeak } from '../../lib/wrapNarrativeShared'
import { localDayBounds } from '../../lib/localDate'
import { tableExists } from '../database'

const WRAP_ENTITY_TYPES: ReadonlyArray<DayWrapEntity['type']> = [
  'project', 'client', 'person', 'meeting', 'repository',
]

/** Below this, an entity is a passing mention, not what the day was about. */
const MIN_ENTITY_SECONDS = 10 * 60

const MAX_ENTITIES = 5

interface EvidenceSpanRow {
  entityId: string
  entityType: DayWrapEntity['type']
  name: string
  sensitivity: string
  spanStart: number
  spanEnd: number
}

function overlapSeconds(
  spanStart: number,
  spanEnd: number,
  blocks: ReadonlyArray<{ startTime: number; endTime: number }>,
): number {
  let total = 0
  for (const block of blocks) {
    const start = Math.max(spanStart, block.startTime)
    const end = Math.min(spanEnd, block.endTime)
    if (end > start) total += (end - start) / 1000
  }
  return total
}

export function entitiesForDayWrap(
  db: Database.Database,
  dateStr: string,
  blocks: ReadonlyArray<{ startTime: number; endTime: number }>,
): DayWrapEntity[] {
  if (blocks.length === 0) return []
  if (!tableExists(db, 'entities') || !tableExists(db, 'entity_evidence_refs')) return []

  const [fromMs, toMs] = localDayBounds(dateStr)
  const marks = WRAP_ENTITY_TYPES.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT
      e.id AS entityId,
      e.entity_type AS entityType,
      e.canonical_name AS name,
      e.sensitivity AS sensitivity,
      r.span_start_ms AS spanStart,
      r.span_end_ms AS spanEnd
    FROM entity_evidence_refs r
    JOIN entities e ON e.id = r.entity_id
    WHERE e.status = 'active'
      AND e.sensitivity != 'high'
      AND e.entity_type IN (${marks})
      AND r.span_start_ms IS NOT NULL
      AND r.span_end_ms IS NOT NULL
      AND r.span_end_ms > ?
      AND r.span_start_ms < ?
  `).all(...WRAP_ENTITY_TYPES, fromMs, toMs) as EvidenceSpanRow[]

  const byEntity = new Map<string, DayWrapEntity>()
  for (const row of rows) {
    const name = row.name?.trim()
    // Both raw-artifact guards: the shared label heuristic and the wrap's own
    // prose leak check (paths, branch slugs, snake_case, hex ids).
    if (!name || looksLikeRawArtifactLabel(name) || findRawArtifactLeak(name) != null) continue
    const seconds = overlapSeconds(
      Math.max(row.spanStart, fromMs),
      Math.min(row.spanEnd, toMs),
      blocks,
    )
    if (seconds <= 0) continue
    const existing = byEntity.get(row.entityId)
    if (existing) {
      existing.seconds += seconds
    } else {
      byEntity.set(row.entityId, { id: row.entityId, type: row.entityType, name, seconds })
    }
  }

  return [...byEntity.values()]
    .map((entity) => ({ ...entity, seconds: Math.round(entity.seconds) }))
    .filter((entity) => entity.seconds >= MIN_ENTITY_SECONDS)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, MAX_ENTITIES)
}
