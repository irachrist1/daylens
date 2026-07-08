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
- `expectedWrap`: optional checks against the deterministic wrap facts
  (`buildDayWrapFacts`) and the deck's fallback narrative:
  - `quality`: `empty` / `tooEarly` / `partial` / `full`.
  - `isLeisureDay`: whether the day reads as a leisure day.
  - `workActivityIncludes`: a name the ranked work activities must include.
  - `appSiteIncludes`: a branded app/site the "where the time went" slices must
    include ("Cursor", "Gmail").
  - `topLeisureIncludes`: a friendly leisure surface ("YouTube", "Netflix").
  - `standoutIncludes`: what the longest-stretch standout must be about.
  The runner also checks the facts structurally: the kind split must match an
  independent recount of the trusted blocks, the headline must reconcile with
  the split, slice, and ribbon totals, and every work activity and standout
  must trace back to a real trusted work block. The per-fixture `Wrap facts:`
  line in the report shows what was derived.

This is a scored baseline, not a strict unit test. Current misses are useful:
they describe what a future segmentation, labeling, intent, or wrap change
should improve without requiring live tracking data.
