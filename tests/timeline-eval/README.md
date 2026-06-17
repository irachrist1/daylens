# Timeline Evaluation Harness

Run:

```bash
npm run timeline:eval
```

The harness is offline and hermetic. Each fixture seeds an in-memory SQLite
database with raw app sessions, optional browser/page evidence, optional
activity boundary events, and expected timeline episodes. The runner then calls
Daylens' current timeline builder, intent inference, and wrapped-facts fallback
path.

## Fixture Format

Fixtures live in `tests/timeline-eval/fixtures/*.json`.

- `sessions`: raw foreground app sessions. Use `start` and `end` in local
  `HH:MM` time for the fixture date.
- `browserEvidence`: page visits that should support browser/page labels and
  intent subjects.
- `activityEvents`: lock, unlock, idle, away, suspend, or resume events when a
  gap should be treated as a hard boundary.
- `expectedEpisodes`: the human-expected timeline. These are the unit of
  segmentation, label, category, and intent-role scoring.
- `expectedWrap`: optional checks against the deterministic wrapped facts and
  fallback narrative. Beyond `quality` / `dominantCategory` / `topAppIncludes` /
  `topDomain`, the review-grounded spine (Wraps V2) can be asserted with:
  - `matteredSubjectIncludes`: a subject/label the "what mattered" spine must name.
  - `needsReviewCount`: exact number of pending blocks the wrap reports as needing
    review (a block is pending when it is low-confidence, rule-only, or live).
  - `carryoverSubjectIncludes`: a subject the "carries into tomorrow" spine must name.
  The runner also checks these structurally: needs-review counts, mattered items,
  and carryover threads must each trace back to real blocks in the payload. The
  per-fixture `Review spine:` line in the report shows what was derived.

This is a scored baseline, not a strict unit test. Current misses are useful:
they describe what a future segmentation, labeling, intent, or wrap change
should improve without requiring live tracking data.
