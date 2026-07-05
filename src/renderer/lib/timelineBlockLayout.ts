// Calendar-track card heights (2026-07-05, docs/issues-2026-07-05.md §3).
//
// A card sits at its wall-clock position and its height is its duration
// (timeline.md §3.4 / invariant 4). The readability floor (a just-started or
// sliver block still needs a clickable card) used to be applied blindly:
// `max(minHeight, durationPx)` with the top pinned at the true start meant a
// short block PAINTED PAST ITS REAL END — covering the idle gap below it, its
// "Idle · 12m" caption, and sometimes the next block's header. The founder saw
// it as "the distance between idle time and the next block is wrong".
//
// The rule here: the floor may stretch a card into genuinely empty space it
// does not distort, but it must never reach the next block's top. When the
// floor doesn't fit, the card falls back to its truthful proportional height —
// the clock wins over the floor, never the other way around.

export interface LayoutBlockSpan {
  // Pixel offset of the block's start on the track.
  top: number
  // Pixel offset of the block's (layout) end on the track.
  bottom: number
}

// Breathing room kept between a floored card and the next card's top, so two
// adjacent cards never visually fuse.
const CARD_CLEARANCE_PX = 2

export function calendarCardHeights(spans: LayoutBlockSpan[], minHeight: number): number[] {
  return spans.map((span, index) => {
    const trueHeight = Math.max(1, span.bottom - span.top)
    const floored = Math.max(minHeight, trueHeight)
    const next = spans[index + 1]
    if (!next) return floored
    const available = next.top - span.top - CARD_CLEARANCE_PX
    // The floor only applies when it fits in front of the next block; a real
    // (true-duration) overlap is drawn as-is rather than silently shrunk.
    if (floored > available) return Math.max(trueHeight, Math.min(floored, available))
    return floored
  })
}
