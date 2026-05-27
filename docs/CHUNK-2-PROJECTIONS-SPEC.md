# Chunk 2 — Session + Block Projections

Status: **design — not implemented.** Not done until the verification tests pass against real `focus_events` data.

Depends on: Chunk 1 (`focus_events` must be populated). Read `CAPTURE-HELPER-SPEC.md` and `ARCHITECTURE-FIX-PLAN.md` first.

## The principle

Sessions and blocks are **pure, deterministic, replayable projections** over `focus_events`. Capture is never re-run. When the interpretation logic is wrong, you fix the function and reproject over the same events. This permanently kills the "code fixed, data never migrated" bug that has plagued every prior attempt.

```
focus_events (raw, append-only, never edited)
      │
      ▼  projection 1 (pure fold)
derived_sessions (atomic focus spans)
      │
      ▼  projection 2 (segmentation + labeling)
derived_blocks (coherent work episodes)
```

Both derived tables can be dropped and rebuilt from `focus_events` at any time. Both carry a `projection_version`. Bumping the version and reprojecting updates stale rows idempotently.

## Projection 1: Sessions

Fold the event stream into atomic focus sessions.

A session is a contiguous span where the same `(app_bundle_id, tab_url)` was foregrounded. For non-browsers, `tab_url` is null and the session keys on app + window_title. For browsers, a `tab_changed` ends the current session and starts a new one even though the app didn't change.

```sql
CREATE TABLE derived_sessions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  start_ts_ms        INTEGER NOT NULL,
  end_ts_ms          INTEGER NOT NULL,
  active_seconds     INTEGER NOT NULL,   -- from mono_ns deltas, idle subtracted
  app_bundle_id      TEXT,
  app_name           TEXT,
  window_title       TEXT,
  url                TEXT,
  page_title         TEXT,
  confidence         TEXT NOT NULL,      -- observed | uncertain (propagated from events)
  projection_version INTEGER NOT NULL
);
```

Rules:
- **Start** a session on `app_activated` or `tab_changed`.
- **End** it on the next `app_activated` / `tab_changed` / `app_deactivated` / `idle_start` / `lock` / `sleep`.
- **Duration** is computed from `mono_ns` deltas (monotonic clock), never wall-clock subtraction. `end_ts_ms - start_ts_ms` is for display only.
- **Idle subtraction**: if `idle_start`...`idle_end` falls inside a session, those seconds are excluded from `active_seconds`.
- **Confidence propagates**: a session built from `confidence=unknown` events is `uncertain`, with null url/title. Never fabricate content for an uncertain session.
- **Pure**: same events in → same sessions out, byte-identical. No randomness, no clock reads during projection.

## Projection 2: Blocks

Group sessions into coherent work episodes. This is where "Twitter 12:54-1:54" gets fixed.

```sql
CREATE TABLE derived_blocks (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  start_ts_ms        INTEGER NOT NULL,
  end_ts_ms          INTEGER NOT NULL,
  active_seconds     INTEGER NOT NULL,
  label              TEXT NOT NULL,      -- clean prose, deterministic
  label_source       TEXT NOT NULL,      -- artifact | domain | app | ai
  dominant_category  TEXT,
  confidence         TEXT NOT NULL,
  projection_version INTEGER NOT NULL
);
-- plus a join table derived_block_sessions(block_id, session_id)
```

### Segmentation (the core fix)

Do NOT split on a fixed timer (the current `LONG_SINGLE_APP_THRESHOLD_SEC = 45 * 60` in `workBlocks.ts` is the bug). Split on **real boundaries**:

- Idle gap longer than a threshold (e.g. > 5 min away).
- Project / repo / domain change (github.com/projectA → coursera.org is a boundary; switching tabs within the same project is not).
- Category shift (development → communication → entertainment).
- `lock` / `sleep` always ends a block.

Sessions between two boundaries that share a project, domain, or topic form one block, even when apps interleave (Cursor + browser docs + terminal on the same task = one block).

The hour where the user flipped between Twitter, a doc, and a video becomes **several** blocks at the real switch points, each labeled by what it actually was, not by whatever URL the poll happened to catch.

### Labeling

Deterministic, from the block's own sessions, in priority order:
1. User override (if set).
2. Dominant artifact / page title (cleaned).
3. Dominant domain or project ("Coursera deep learning", not "coursera.org | ...").
4. App name only as a last resort.

Cleaning rules (carry over from `naturalizeLabel` in `workBlocks.ts` but apply at projection time):
- No literal pipes. "Course | Perusall" → "Course on Perusall" or the longest content segment.
- No raw window titles as labels.
- No shell usernames ("tonny") or bare cwd strings for terminal apps — prefer the block's dominant work context.

AI labeling is optional polish layered on top, cached, and is **never** the source of a factual claim. A block's facts (time, apps, pages) come from sessions; the AI only phrases the label.

### Versioning (kills the migration bug)

`projection_version` is a constant in the projection code. When labeling or segmentation logic changes, bump it. A reprojection pass rewrites every block whose stored version is older. Idempotent: running it twice changes nothing the second time. This is Chunk 4's mechanism too.

## Transition

Run alongside the existing path. Do NOT delete `app_sessions`, `timeline_blocks`, or the `workBlocks.ts` builders yet.

1. Build both projections, writing to `derived_sessions` / `derived_blocks`.
2. Compare against `app_sessions` / `timeline_blocks` for the same day. Surface differences.
3. Once the regression corpus confirms the projections match or beat the old output, switch Timeline / Apps / AI to read from the derived tables (this is the cut-over, coordinate with the Chunk 3 query layer).
4. Then remove the old builders.

## Verification

| Test | Pass condition |
|---|---|
| Determinism | Reproject twice from the same `focus_events`. `derived_sessions` and `derived_blocks` are byte-identical. |
| Duration integrity | Sum of `active_seconds` across sessions in a window equals active (non-idle) wall time in that window, within a few seconds. |
| The Twitter hour | Take a real hour where you switched among several things. It produces multiple blocks at the real switch points, each labeled by what it was. No single block mislabeled with one tab's title. |
| Clean labels | No block label contains a pipe, a raw window title, or a shell username. |
| Confidence honesty | Sessions built from `confidence=unknown` events are `uncertain` with null url/title. No fabricated content. |
| Idempotent relabel | Bump `projection_version`, reproject. Stale rows update to the new label. Running again changes nothing. |
| Frozen corpus | Annotate one real 30-min `focus_events` window with ground truth. The projection's blocks match the annotation. Future changes graded against this. |
