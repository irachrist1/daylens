// Shift-click merge selection — the pure logic behind multi-select-then-merge
// on the Timeline day grid, pulled out so it can be unit-tested without a DOM
// harness (same pattern as blockDetailRowTree.ts / dayWrapScenes.ts).
//
// Two gestures reach the same merge, side by side (timeline.md §2): right-click
// a single block → "Merge with above/below", OR click a block then shift-/cmd-
// click another to select the whole run between them and merge it in one go.
// This module owns the second gesture's two questions: which blocks does the
// span cover, and can that span be merged right now.

import type { WorkContextBlock } from '@shared/types'

// The contiguous, inclusive run the selection covers, ordered by start time.
// Blocks are continuous time, so the span the user sees highlighted — anchor
// through the shift-clicked end — is exactly what fuses, in-between blocks
// included. Returns just the anchor for a plain single selection, and stays
// robust when either id has gone stale (e.g. after a rebuild) by collapsing to
// the anchor rather than throwing.
export function mergeSelectionSpan(
  sortedBlocks: readonly WorkContextBlock[],
  anchorId: string | null,
  rangeEndId: string | null,
): WorkContextBlock[] {
  if (!anchorId) return []
  const i = sortedBlocks.findIndex((block) => block.id === anchorId)
  if (i < 0) return []
  const anchor = sortedBlocks[i]
  if (!rangeEndId || rangeEndId === anchorId) return [anchor]
  const j = sortedBlocks.findIndex((block) => block.id === rangeEndId)
  if (j < 0) return [anchor]
  const [lo, hi] = i <= j ? [i, j] : [j, i]
  return sortedBlocks.slice(lo, hi + 1)
}

export interface SpanMergeState {
  // A merge is on the table: the span covers two or more blocks.
  isSpan: boolean
  // How many blocks the span covers (drives the "Merge N blocks" label).
  count: number
  // A provisional (live, not-yet-analyzed) block sits inside the span — the
  // merge must wait until it settles (timeline.md §4), so the action is shown
  // but disabled rather than hidden.
  hasLiveBlock: boolean
  // The action can fire right now: a real span with no live block in it.
  canMerge: boolean
  // The two endpoints handed to ipc.db.mergeTimelineEpisodes; the server fuses
  // everything between them. Null when the selection isn't a span.
  endpointIds: [string, string] | null
}

export function spanMergeState(span: readonly WorkContextBlock[]): SpanMergeState {
  const count = span.length
  const isSpan = count >= 2
  const hasLiveBlock = span.some((block) => block.provisional)
  return {
    isSpan,
    count,
    hasLiveBlock,
    canMerge: isSpan && !hasLiveBlock,
    endpointIds: isSpan ? [span[0].id, span[count - 1].id] : null,
  }
}
