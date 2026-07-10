# Entities & Episodes — the Daylens day model

Status: proposed 2026-07-10, pending founder approval. Drafted from the 2026-07-10
architecture review (Claude Fable 5). Complements `wrapped-agent-plan.md` (which fixes
the wrap's *writing*); this spec fixes what everything *knows*. On conflict about data
shape, this spec wins; on conflict about voice, `voice.md` wins as always.

## The root cause this addresses

Daylens has no representation of "a thing that happened." The universal data atom is
the time-span-over-apps; meaning is a label string painted onto spans, guessed
independently by each feature from surface artifacts, never joined to real-world
signals, and never persisted as understanding. Verified findings:

- Across the entire schema (`src/main/db/schema.ts`, `migrations.ts`), no table's row
  means "attended a class" or "worked on project X". Blocks, sessions, and segments
  are all time intervals with a label as an attribute.
- Calendar events and git commits are per-day JSON blobs in `external_signals`
  (migrations v43) — no per-event rows, so a join between a block and the meeting that
  explains it is not just missing, it is unwritable.
- Timeline blocks are cut by idle gaps and category runs (`workBlocks.ts`); a
  "meeting" block exists because a video app was foregrounded, never because a
  calendar event happened. The block namer (`generateWorkBlockInsight`,
  `jobs/aiService.ts:4101`) sees one block's titles/apps/sites — no calendar, no git,
  no neighbors, no prior days. The code's own comment calls it the "blindfolded namer."
- "What was the user doing" is derived independently at least seven ways (block
  labeler, chat router, chat planner/resolvers, wrap facts, wrap Q&A, day-summary
  scaffold, weekly brief) plus a rule-based eighth (distraction alerter). Each has its
  own prompt and fact shape. The chat's quality is capped by block-label quality,
  which is why it sometimes "gets" the user and is sometimes confidently wrong.
- The one place signals ARE joined — wrap enrichment (`enrichmentResolve.ts`,
  `eventTypeInference.ts`) — runs in memory at generation time and persists only
  prose. The system learns "that was your ML class" and forgets it before the next
  feature asks.
- Corrections attach to block spans (`blockCorrections.ts`), so teaching the system
  "this is my ML class" on Tuesday teaches it nothing about Thursday. The pattern
  memory (`context_patterns`) matches surface features (apps+domains+title tokens),
  not identity.

Consequence: guards, judges, and voice rules downstream can only make the narration of
misunderstood data more faithful. They fixed lying; they cannot fix not-knowing.

## Objective

Invert the architecture: **one interpreter builds a shared day model; every feature
reads it.** Spans stop being the product's reality and become evidence for it.

**Done means:** for a real tracked day, the `episodes` table says "ML Pipeline class,
11:09am–1:13pm, venue Google Meet, instrument Google Colab, anchored to calendar event
X" with evidence rows pointing at the exact blocks/sessions that support it; the wrap,
the chat, and the timeline all describe that episode with the same identity; renaming
the entity once renames it everywhere including future days; and the comprehension
gate (below) fails any output that mistakes a venue for a project or a class for
reading material.

## The ontology

Three new first-class notions. Names are deliberate: an *entity* is a durable thing in
the user's life; an *episode* is a dated occurrence; *evidence* is why we believe it.

```typescript
// src/shared/types.ts — new

export type EntityKind =
  | 'project'        // Daylens, the billing service, SPCS Build Proposal
  | 'class'          // ML Pipeline (recurring instruction)
  | 'meeting_series' // weekly design review, 1:1 with Sarah
  | 'venue'          // Google Meet, Zoom — where things happen, never work itself
  | 'instrument'     // Colab, Cursor, Warp, Figma — tools work happens WITH
  | 'interest'       // leisure identities worth remembering (a game, a show)

export interface Entity {
  id: string
  kind: EntityKind
  name: string              // the one human name ("ML Pipeline class")
  aliases: string[]         // surface strings that resolve to it (window-title
                            // fragments, calendar-title fragments, repo names)
  origin: 'inferred' | 'user'  // user-origin names are never overwritten
  confidence: number        // for inferred entities; user entities are 1.0
  firstSeen: string         // date
  lastSeen: string
}

export type EpisodeKind =
  | 'class_session' | 'meeting' | 'coding_session' | 'writing_session'
  | 'design_session' | 'research_session' | 'break' | 'leisure_session'
  | 'unknown'              // honest bucket: evidence didn't resolve

export interface Episode {
  id: string
  date: string
  kind: EpisodeKind
  startMs: number
  endMs: number
  /** What it was about. Null for unknown/break. */
  subjectEntityId: string | null
  /** Where it happened (Meet, Zoom) — narrated as venue, never as work. */
  venueEntityId: string | null
  /** Tools it happened with — narrated as instruments, never as subjects. */
  instrumentEntityIds: string[]
  /** Outcomes anchored to external truth (commits, PRs, recorded action items). */
  outcomes: EpisodeOutcome[]
  confidence: number        // drives phrasing downgrades (see honesty rules)
  provenance: EpisodeProvenance
}

export interface EpisodeOutcome {
  kind: 'commits' | 'pr' | 'action_items' | 'artifact'
  entityId: string | null   // the project the commits landed in, etc.
  summary: string           // sanitized, pre-humanized
  externalEventId: string | null
}

export interface EpisodeProvenance {
  /** Which fusion rules fired, for debuggability and the benchmark. */
  rules: string[]
  anchoredToCalendar: boolean
  anchoredToGit: boolean
}
```

### Storage

```sql
-- entities: durable identities, one row per thing in the user's life
CREATE TABLE entities (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'inferred', confidence REAL NOT NULL,
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL
);
CREATE TABLE entity_aliases (
  entity_id TEXT NOT NULL REFERENCES entities(id),
  alias TEXT NOT NULL, source TEXT NOT NULL,  -- window_title | calendar | git | user
  UNIQUE(entity_id, alias)
);

-- external events: calendar/git get REAL ROWS (today: blobs in external_signals).
-- external_signals stays as the raw connector cache; this is the queryable layer.
CREATE TABLE external_events (
  id TEXT PRIMARY KEY, date TEXT NOT NULL,
  source TEXT NOT NULL,          -- calendar | git | focus_app | notes
  kind TEXT NOT NULL,            -- event | commit_batch | pr | session
  title TEXT,                    -- sanitized at write time (same rules as today)
  start_ms INTEGER, duration_min INTEGER,
  payload_json TEXT NOT NULL, captured_at INTEGER NOT NULL
);

-- episodes + evidence: the day model itself
CREATE TABLE episodes (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL,
  start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
  subject_entity_id TEXT REFERENCES entities(id),
  venue_entity_id TEXT REFERENCES entities(id),
  confidence REAL NOT NULL, provenance_json TEXT NOT NULL
);
CREATE TABLE episode_evidence (
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  evidence_type TEXT NOT NULL,   -- block | app_session | website_visit | external_event
  evidence_id TEXT NOT NULL,
  role TEXT NOT NULL             -- subject | venue | instrument | outcome | anchor
);
```

## The interpreter (one fusion pass, many readers)

A new `src/main/services/dayModel.ts` builds the day's episodes. It follows ADR 0002:
**deterministic resolution first, the model never decides whether data exists.**

1. **Gather** (deterministic): the day's timeline payload (blocks + members), the
   day's `external_events`, title clusters, the entity store, and user corrections.
2. **Anchor** (deterministic): join by time overlap + alias match. A calendar event
   overlapping ≥50% with foreground time in a venue app anchors an episode of the
   event's inferred type (`eventTypeInference.ts` moves here and finally feeds
   everything, not just the wrap). Commits authored inside a span anchor a
   coding-session episode to the repo's project entity. These rules are pure code,
   testable with fixtures, and produce most episodes with high confidence.
3. **Resolve identity** (deterministic): surface strings (title clusters, calendar
   titles, repo names) resolve to entities via `entity_aliases`; unmatched recurring
   strings propose new inferred entities.
4. **Interpret the remainder** (one AI call, whole-day): unanchored spans are
   classified into episodes with the FULL day context — the anchored episodes, the
   entity store, work-memory facts, and the neighbors. This replaces the per-block
   keyhole guess with one sighted pass. Output is constrained to reference existing
   evidence ids and existing or explicitly-proposed entities; the guard rejects
   anything else (same discipline as the wrap guard).
5. **Persist** episodes + evidence + new inferred entities. Fusion is idempotent per
   day: re-running replaces the day's inferred episodes; user-corrected episodes and
   user-origin entities always survive (invariant: corrections win).

### Honesty rules (confidence → phrasing)

- `confidence ≥ 0.75` and anchored: full identity phrasing ("your ML Pipeline class
  on Meet").
- `0.5–0.75` or unanchored: activity phrasing without identity claims ("a video call
  on Meet", "coding in Warp").
- `< 0.5`: the episode is `unknown`; consumers say time, apps, and nothing more.
- A venue entity may never be a subject; an instrument may never be a subject. This is
  enforced structurally (separate columns), not by prompt rules.

### Corrections become knowledge

Renaming on the timeline or in the wrap fix-loop writes through to the entity:
`applyBlockLabelCorrection` (`blockCorrections.ts`) gains an entity-aware path — the
corrected name updates/creates a user-origin entity and registers the block's dominant
surface strings as aliases. Existing span-keyed correction storage stays (it is the
durable rebuild-survival mechanism); the entity write-through is additive. Result: one
correction propagates to every feature and every future day.

## What stays (reuse)

- **Capture and blocks are untouched.** `focus_events` remains ground truth; block
  construction (`workBlocks.ts`) keeps producing spans — they become the evidence
  layer, which is what they actually are.
- **Connectors** (`gitSignals.ts`, `calendarSignals.ts`, `externalSignals.ts`) keep
  their silent best-effort contract; `external_events` rows are written in the same
  collection pass.
- **`eventTypeInference.ts`** moves from wrap-only to the interpreter, unchanged logic.
- **Wrap guard/repair/fallback chain and the benchmark harness** stay; the writer's
  input changes from flat facts to episodes.
- **Chat planner/resolver architecture (ADR 0002)** stays; resolvers gain
  `getEpisodes(date)` and answer from the same model everything else reads.
- **All correction invariants** (user wins, dual-write durability, boundary
  corrections) stay.

## Consumers, staged

**Stage E1 — the model exists (no UI change).** `external_events` rows, entity +
episode tables, the interpreter running on day finalize and on demand. Verification is
against known days: does the model say Jul 9 was a class on Meet with Colab, and Jul 10
a Daylens coding afternoon with 7 commits? Fixture tests for the anchor rules; a live
check on the founder's real DB.
*Done means: episodes for 3 known real days read true, in tests and live.*

**Stage E2 — the wrap reads episodes.** `compactDayFacts` gains the episode view;
slides are planned from episodes (a slide per episode that earned one) instead of
fixed slots; the repetition budget becomes structural (an entity leads at most one
slide). Benchmark gains the comprehension gate: (a) deterministic entity-repetition
check, (b) the judge receives the episode model and scores role errors (venue-as-work,
class-as-reading) as accuracy 0, (c) deck-level pairwise judging against
founder-edited gold decks.
*Done means: the Jul 9 deck names the class once as a class, and the old deck loses
the pairwise comparison.*

**Stage E3 — the chat reads episodes.** `getEpisodes` resolver; `getDay` block
narratives carry episode identity so both chat paths speak the same names.
*Done means: "what did I do this morning?" answers with episode identities identical
to the wrap's.*

**Stage E4 — the timeline shows episodes.** Blocks render with entity-backed labels
when an episode covers them; corrections write through to entities. The blindfolded
per-block namer (`generateWorkBlockInsight`) is demoted to the interpreter's step 4
fallback for unanchored spans.
*Done means: renaming "ML Pipeline" once relabels every past and future session of it.*

Each stage ships independently and is verifiable on real days before the next starts.

## Risks, named honestly

- **Fusion is inference and will sometimes be wrong.** The mitigation is structural:
  confidence-gated phrasing, the `unknown` kind, provenance on every episode, and the
  comprehension gate measuring the interpreter itself (episode-accuracy fixtures from
  known days), not just the prose.
- **Entity sprawl.** Inferred entities need merge/decay: an alias seen once and never
  again decays; the Settings surface later exposes entity management. Out of scope for
  E1 beyond a cap and a decay rule.
- **One user's data distribution.** Same caveat as the wrap benchmark: anchor rules
  are tuned on founder days first. The fixture set needs alien day-shapes (meeting-
  heavy, commit-less, near-empty) before "reliable" is claimed. Carries over from the
  wrapped benchmark plan.
- **Cost.** One whole-day interpret call replaces N per-block relabel calls; expected
  net reduction, but measure in `ai_usage_events` at E1.
