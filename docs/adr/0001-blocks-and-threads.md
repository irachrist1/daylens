# ADR 0001 — A day is blocks grouped into threads

**Status:** Accepted · **Date:** 2026-06-18

## Context

Daylens turns raw computer activity into an honest account of what the user did.
The original engine (`src/main/services/workBlocks.ts`, ~5,000 lines) builds its unit
around app/category coherence — "you stayed in the same app for a while" is a block.

On a real day that produced **53 blocks where the user's day had ~8**. Titles came from
window/page titles ("Ubiquiti Account"), and a single stray tab (X.com) flipped a whole
block of network work to category SOCIAL. The unit was defined by *apps*, not by what the
user was *trying to do*.

## Decision

Model a day in two levels.

- **Block** — one *contiguous* stretch of a single intent, shown on the Timeline.
  Assembled from sessions. The apps and sites inside are *evidence*, not the definition.
  A brief detour is absorbed, not split out.
- **Thread** — a persistent goal that ties blocks together across gaps or days.
  Built from blocks. "What mattered" and the recaps are organized around threads.

Internally: **sessions** (atomic) → **blocks** (contiguous intent) → **threads** (goal).
"Episode" is retired as a term; "block" is canonical.

Who decides what:

- **Code** owns time, duration, evidence membership, and hard constraints.
- **AI** proposes the subject, the human title, and thread relationships.
- **A validator** decides whether an AI proposal is supported by evidence before it is stored.

## Consequences

- The segmentation engine is rebuilt around choosing the best *whole-day partition* into
  blocks, not greedy adjacent merges. Target the engine must hit: the founder day renders
  as **~8 believable blocks, not 53**.
- Every surface — Timeline, Apps, AI, recaps — reads the same block/thread facts. None
  computes its own totals. (This is what stops the "42h here, 46h there" disagreements.)
- This is hard to reverse: it reshapes the core data model. Recorded here so future work
  does not drift back to app-based units.

## Alternatives considered

- **App-coherence units (status quo).** Rejected — the root cause of mislabeling,
  over-segmentation, and miscategorization.
- **A single intent-span unit, no thread.** Rejected — it can't express resuming the same
  goal after a gap, which the weekly review and "What mattered" both need.
