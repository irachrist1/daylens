// Timeline-block references for entities (memory-and-entities.md
// §Timeline-block references, DEV-177).
//
// Timeline blocks are projections: split, merge, and projection-version
// changes replace block boundaries, and block ids churn with them. An entity's
// reference to a block therefore stores BOTH the block id and the block's wall
// clock span (span_start_ms/span_end_ms on entity_evidence_refs). Resolution
// never returns a dangling id:
//
//   1. the referenced block still exists and is valid → the block id,
//   2. it was replaced but a successor covers the span midpoint → remap to the
//      successor (persisted, so the next read is direct),
//   3. no successor is derivable → the reference DEGRADES to the underlying
//      evidence identifiers and time range — still resolvable, never dangling.
import type Database from 'better-sqlite3'
import type { EntityEvidenceRefRow } from './entityRepository'
import { addEntityEvidenceRef } from './entityRepository'

export const TIMELINE_BLOCK_REF_SOURCE = 'timeline_block'
export const EVIDENCE_SPAN_REF_SOURCE = 'evidence_span'

export interface ResolvedBlockRef {
  refId: string
  entityId: string
  /** Present when the reference resolves to a live block. */
  blockId: string | null
  /** True when the reference degraded to evidence ids + time range. */
  degraded: boolean
  spanStartMs: number | null
  spanEndMs: number | null
  /** Evidence session ids inside the span when degraded. */
  evidenceSessionIds: number[]
}

export function addTimelineBlockRef(
  db: Database.Database,
  entityId: string,
  block: { id: string; startTime: number; endTime: number },
): void {
  addEntityEvidenceRef(db, entityId, {
    sourceType: TIMELINE_BLOCK_REF_SOURCE,
    sourceId: block.id,
    spanStartMs: block.startTime,
    spanEndMs: block.endTime,
  })
}

function blockIsValid(db: Database.Database, blockId: string): boolean {
  return db.prepare(`SELECT 1 FROM timeline_blocks WHERE id = ? AND invalidated_at IS NULL`)
    .get(blockId) != null
}

function successorForSpan(
  db: Database.Database,
  spanStartMs: number,
  spanEndMs: number,
): string | null {
  const midpoint = spanStartMs + (spanEndMs - spanStartMs) / 2
  const row = db.prepare(`
    SELECT id FROM timeline_blocks
    WHERE invalidated_at IS NULL AND start_time <= ? AND end_time > ?
    ORDER BY start_time DESC
    LIMIT 1
  `).get(midpoint, midpoint) as { id: string } | undefined
  return row?.id ?? null
}

function evidenceSessionIdsForSpan(
  db: Database.Database,
  spanStartMs: number,
  spanEndMs: number,
): number[] {
  const rows = db.prepare(`
    SELECT id FROM derived_sessions WHERE start_ts_ms < ? AND end_ts_ms > ?
    UNION
    SELECT id FROM app_sessions WHERE start_time < ? AND COALESCE(end_time, start_time) > ?
  `).all(spanEndMs, spanStartMs, spanEndMs, spanStartMs) as Array<{ id: number }>
  return rows.map((row) => row.id)
}

/**
 * Resolve one stored timeline-block reference. Persists remaps (successor
 * found) and degrades (no successor while the day has valid blocks), so the
 * stored row always reflects the last known resolution.
 */
export function resolveTimelineBlockRef(
  db: Database.Database,
  ref: EntityEvidenceRefRow,
): ResolvedBlockRef {
  const base = {
    refId: ref.id,
    entityId: ref.entity_id,
    spanStartMs: ref.span_start_ms,
    spanEndMs: ref.span_end_ms,
  }
  if (ref.source_type === EVIDENCE_SPAN_REF_SOURCE) {
    return {
      ...base,
      blockId: null,
      degraded: true,
      evidenceSessionIds: ref.span_start_ms != null && ref.span_end_ms != null
        ? evidenceSessionIdsForSpan(db, ref.span_start_ms, ref.span_end_ms)
        : [],
    }
  }
  if (blockIsValid(db, ref.source_id)) {
    return { ...base, blockId: ref.source_id, degraded: false, evidenceSessionIds: [] }
  }
  if (ref.span_start_ms != null && ref.span_end_ms != null) {
    const successor = successorForSpan(db, ref.span_start_ms, ref.span_end_ms)
    if (successor) {
      db.prepare(`UPDATE entity_evidence_refs SET source_id = ? WHERE id = ?`).run(successor, ref.id)
      return { ...base, blockId: successor, degraded: false, evidenceSessionIds: [] }
    }
    // No successor derivable: degrade to the underlying evidence ids + range.
    db.prepare(`UPDATE entity_evidence_refs SET source_type = ? WHERE id = ?`)
      .run(EVIDENCE_SPAN_REF_SOURCE, ref.id)
    return {
      ...base,
      blockId: null,
      degraded: true,
      evidenceSessionIds: evidenceSessionIdsForSpan(db, ref.span_start_ms, ref.span_end_ms),
    }
  }
  // A legacy ref without a span cannot find a successor; it degrades to an
  // empty evidence set rather than dangle.
  db.prepare(`UPDATE entity_evidence_refs SET source_type = ? WHERE id = ?`)
    .run(EVIDENCE_SPAN_REF_SOURCE, ref.id)
  return { ...base, blockId: null, degraded: true, evidenceSessionIds: [] }
}

/** Resolve every timeline-block reference of one entity's merge group. */
export function resolveEntityTimelineBlockRefs(
  db: Database.Database,
  entityIds: string[],
): ResolvedBlockRef[] {
  if (entityIds.length === 0) return []
  const marks = entityIds.map(() => '?').join(', ')
  const refs = db.prepare(`
    SELECT * FROM entity_evidence_refs
    WHERE entity_id IN (${marks}) AND source_type IN (?, ?)
  `).all(...entityIds, TIMELINE_BLOCK_REF_SOURCE, EVIDENCE_SPAN_REF_SOURCE) as EntityEvidenceRefRow[]
  return refs.map((ref) => resolveTimelineBlockRef(db, ref))
}

/** Sweep every stored block ref after a reprojection: remap what has a
 *  successor, degrade what does not. Safe to call any time. */
export function remapTimelineBlockRefs(db: Database.Database): { remapped: number; degraded: number } {
  const refs = db.prepare(`
    SELECT * FROM entity_evidence_refs WHERE source_type = ?
  `).all(TIMELINE_BLOCK_REF_SOURCE) as EntityEvidenceRefRow[]
  let remapped = 0
  let degraded = 0
  for (const ref of refs) {
    if (blockIsValid(db, ref.source_id)) continue
    const resolved = resolveTimelineBlockRef(db, ref)
    if (resolved.degraded) degraded += 1
    else remapped += 1
  }
  return { remapped, degraded }
}
