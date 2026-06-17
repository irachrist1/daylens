import type { TimelineBlockReview, TimelineBlockReviewState, WorkContextBlock } from './types'

export const TIMELINE_BLOCK_REVIEW_STATES: readonly TimelineBlockReviewState[] = [
  'auto-approved',
  'pending',
  'approved',
  'corrected',
  'ignored',
]

export function isTimelineBlockReviewState(value: unknown): value is TimelineBlockReviewState {
  return typeof value === 'string' && TIMELINE_BLOCK_REVIEW_STATES.includes(value as TimelineBlockReviewState)
}

export const DEFAULT_TIMELINE_BLOCK_REVIEW: TimelineBlockReview = {
  state: 'pending',
  source: 'default',
  originalBlockId: null,
  originalLabel: null,
  originalIntentRole: null,
  originalIntentSubject: null,
  correctedLabel: null,
  correctedIntentRole: null,
  correctedIntentSubject: null,
  updatedAt: null,
}

export function isTrustedTimelineBlock(block: { review?: WorkContextBlock['review'] }): boolean {
  return block.review?.state !== 'ignored'
}
