// Block-label correction pipeline for AI actions.
//
// A rename is stored in TWO places so it survives a rebuild: the label override
// AND an evidence-keyed review correction. This encodes the exact same sequence
// the manual Timeline edit runs (db.handlers SET_BLOCK_LABEL_OVERRIDE /
// CLEAR_BLOCK_LABEL_OVERRIDE) — same functions, same order, same invalidations —
// so an AI rename goes through the same correction pipeline as a manual one
// (ai-actions.md invariant 3). If the manual handler's sequence changes, change
// it here too.
import type Database from 'better-sqlite3'
import type { WorkContextBlock } from '@shared/types'
import { setBlockLabelOverride, clearBlockLabelOverride } from '../db/queries'
import { writeTimelineBlockReview, getBlockDetailPayload } from './workBlocks'
import { materializeTimelineDayProjection } from '../core/query/projections'
import { invalidateProjectionScope } from '../core/projections/invalidation'
import { getCurrentSession } from './tracking'
import { localDateString } from '../lib/localDate'

function localDateStringForTimestamp(timestamp: number): string {
  return localDateString(new Date(timestamp))
}

// Only today's date can carry a live (unfinished) session; past dates never do.
// Mirrors the pattern used across the IPC handlers.
function liveSessionForDate(dateStr: string) {
  return dateStr === localDateString() ? getCurrentSession() : null
}

function resolveBlock(db: Database.Database, blockId: string, date?: string | null): WorkContextBlock | null {
  if (date) {
    const dayPayload = materializeTimelineDayProjection(db, date, liveSessionForDate(date))
    const found = dayPayload.blocks.find((candidate) => candidate.id === blockId)
    if (found) return found
  }
  return getBlockDetailPayload(db, blockId, getCurrentSession())
}

/** Rename a block. Writes the review correction AND the override, then
 *  invalidates every view that reads the label (timeline, apps, insights).
 *  Returns the resolved date and the prior override (null if the block had no
 *  user override) so an undo can restore the exact previous state. */
export function applyBlockLabelCorrection(
  db: Database.Database,
  payload: { blockId: string; date?: string | null; label: string; narrative?: string | null },
): { date: string; priorOverride: string | null } {
  const block = resolveBlock(db, payload.blockId, payload.date)
  if (!block) throw new Error('Block not found.')
  const dateStr = payload.date ?? localDateStringForTimestamp(block.startTime)
  const priorOverride = block.label.override
  writeTimelineBlockReview(db, dateStr, block, {
    state: 'corrected',
    correctedLabel: payload.label,
  })
  setBlockLabelOverride(db, payload.blockId, payload.label, payload.narrative ?? null)
  invalidateProjectionScope('timeline', 'block_label_override')
  invalidateProjectionScope('apps', 'block_label_override')
  invalidateProjectionScope('insights', 'block_label_override')
  return { date: dateStr, priorOverride }
}

/** Undo a rename. Clears BOTH the override and the review correction, or the
 *  review's correctedLabel keeps winning and the rename never goes away. */
export function clearBlockLabelCorrection(db: Database.Database, blockId: string): void {
  clearBlockLabelOverride(db, blockId)
  const block = getBlockDetailPayload(db, blockId, getCurrentSession())
  if (block) {
    writeTimelineBlockReview(db, localDateStringForTimestamp(block.startTime), block, {
      state: 'auto-approved',
      correctedLabel: null,
    })
  }
  invalidateProjectionScope('timeline', 'block_label_override')
  invalidateProjectionScope('apps', 'block_label_override')
  invalidateProjectionScope('insights', 'block_label_override')
}
