import type Database from 'better-sqlite3'
import type {
  TimelineBlockEditPayload,
  TimelineBlockEditResult,
  WorkContextBlock,
} from '@shared/types'
import { isAppCategory } from '@shared/types'
import { setBlockLabelOverride } from '../db/queries'
import { trimTimelineBlockSpan, writeTimelineBlockReview } from './workBlocks'

export function applyTimelineBlockEdit(
  db: Database.Database,
  block: WorkContextBlock,
  payload: TimelineBlockEditPayload,
): TimelineBlockEditResult {
  const label = payload.label?.trim()
  const labelChanged = Boolean(label && label !== block.label.current)
  const categoryChanged = payload.category !== undefined && payload.category !== block.dominantCategory
  if (payload.category !== undefined && !isAppCategory(payload.category)) {
    throw new Error(`Invalid category: ${String(payload.category)}`)
  }
  const hasSpan = payload.startMs !== undefined || payload.endMs !== undefined
  if (hasSpan && (payload.startMs === undefined || payload.endMs === undefined)) {
    throw new Error('Both block edges are required when editing time.')
  }
  if (hasSpan && block.provisional) {
    throw new Error('Analyze the day before editing block times.')
  }

  const changedFields: TimelineBlockEditResult['changedFields'] = []
  const save = db.transaction(() => {
    if (labelChanged || categoryChanged) {
      writeTimelineBlockReview(db, payload.date, block, {
        state: 'corrected',
        correctedLabel: labelChanged ? label : undefined,
        correctedCategory: categoryChanged ? payload.category : undefined,
      })
      if (labelChanged && label) {
        setBlockLabelOverride(db, block.id, label, block.label.narrative)
        changedFields.push('label')
      }
      if (categoryChanged) changedFields.push('category')
    }
    if (hasSpan) {
      const result = trimTimelineBlockSpan(db, payload.date, block, payload.startMs!, payload.endMs!)
      if (result.changed) changedFields.push('time')
    }
  })
  save()

  return { changed: changedFields.length > 0, changedFields }
}
