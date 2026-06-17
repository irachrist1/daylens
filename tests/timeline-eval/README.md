# Timeline Evaluation Harness

Run:

```bash
npm run timeline:eval
```

To regenerate the real founder baseline from the local Daylens database:

```bash
npm run timeline:eval:export-founder
```

The exporter reads expected totals from `founder-truth.json`; it never derives
the target from the sessions it is testing. Those values are manually
transcribed from the live proof screenshots and remain fixed until the founder
confirms or corrects them. Regeneration preserves timestamps, durations,
categories, and behavior-relevant public identities while replacing local
paths, personal names, email/account content, private hosts, and unrelated page
titles with deterministic fixture aliases. The runner rejects a founder fixture
if those sensitive patterns reappear.

The founder fixture is intentionally marked `expectedToFailOnCurrentMain`. The
normal eval command still exits successfully for CI and packet quality gates, but
the fixture stays visibly red in the report. To prove the baseline catches the
current real-day defects, run:

```bash
npm run timeline:eval -- --strict founder-real phase0-contract
```

That strict command should exit nonzero until the later truth packets make all
eight Phase 0 contracts pass:

1. Real day/week dogfood invariants.
2. Segmentation.
3. One-duration consistency.
4. Kind/tag consistency.
5. Distinct gap reasons.
6. System-noise exclusion with a real `loginwindow` sentinel.
7. Apps identity, ownership, totals, and page deduplication.
8. Week chart, day-row, recap, and review-source consistency.

`phase0-contract-witnesses.json` supplies privacy-safe gap and system-noise
inputs that are not guaranteed to occur in the exported founder week.

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
- `expectedGaps`: expected user-facing gap reasons. The Phase 0 witnesses include
  idle/no-samples, away, machine-off, paused, and permission-limited cases.
- `expectedSystemNoise`: source app sentinels that must be removed before any
  timeline, top-app, or summary surface.
- `expectedEpisodes`: the human-expected timeline. These are the unit of
  segmentation, label, category, and intent-role scoring.
- `expectedDay`: optional real-day checks for total minutes, block count,
  minimum material block length, forbidden top apps/labels, and "mattered" /
  carryover leakage.
- `expectedWeek`: optional independent week-total target, optional daily targets,
  and forbidden top apps across the seeded date range.
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
