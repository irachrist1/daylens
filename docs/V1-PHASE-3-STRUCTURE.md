# Daylens v1.0 — Phase 3: Structure (the projection layer every reader consumes)

Author: codebase + DB audit, 2026-05-15. Status: spec only, no code changes.

Scope: the read-side. Every UI view (Timeline, Apps, AI, Wrapped, Settings) and every AI tool today re-derives data on read from raw `app_sessions` / `website_visits` / `activity_state_events`. This phase names the canonical projection tables that should sit between the clean stream (Phase 2) and the readers — one set of tables, one writer per table, every reader is a thin SELECT.

Read order before touching this spec:
1. `docs/AGENTS.md`
2. `docs/AI-PRODUCT-DIRECTION.md` — D1–D7 are non-negotiable
3. `docs/V1-PHASE-0-READ.md` — Layer 1 audit
4. `docs/V1-PHASE-2-CLEAN.md` — Layer 2 audit (the `clean_events` contract this layer reads)
5. `docs/V1-PHASE-4-TIMELINE.md` §9.2, `docs/V1-PHASE-5-APPS.md` §11, `docs/V1-PHASE-6-AI.md` §2 / §3 — the outputs Layers 4/5/6 demand from this layer

Claim discipline: `code-proven`, `db-proven` (live DB at `~/Library/Application Support/DaylensWindows/daylens.sqlite`), `inferred`, `open question`.

---

## 1. Code-grounded snapshot — what the projection layer looks like today

### 1.1 `timeline_blocks` is written on every read and read by almost no one

`code-proven` + `db-proven`. The `timeline_blocks` table exists and is populated (`db-proven`: 5,659 rows spanning 2026-03-19 → 2026-05-15, with `timeline_block_members` carrying 103,346 rows — 83,521 of type `app_session`, 19,816 `website_visit`, 9 `focus_session`). It looks, on its face, like the canonical projection table that Phase 4 §9.2 asks for.

It is not. Two facts together make it a write-only side effect:

1. **It is written by the read path.** `workBlocks.ts:1853-1861` (`buildTimelineBlocksForDay`) is called from `getTimelineDayPayload` (`workBlocks.ts:2088-2119`) on every invocation. The function rebuilds blocks from raw `app_sessions` via `buildBlocksForSessions`, then calls `persistTimelineDay` to write them. So every time a UI tab opens, `timeline_blocks` rows for that date are recomputed and re-inserted (`ON CONFLICT(id) DO UPDATE SET ...`).
2. **Almost no reader reads it.** A grep for `FROM timeline_blocks` across `src/main` returns exactly four call sites:
   - `src/main/services/workBlocks.ts:775` — `loadPersistedAppDetailBlocksForDates`, used **only** as a fallback inside `getAppDetailPayload` for legacy persisted blocks; the main path of `getAppDetailPayload` still rebuilds from sessions.
   - `src/main/db/queries.ts:2145, 2159, 2178` — three DISTINCT-date probes that only ask "did any block exist for this date?" (used by Wrapped's date range detection and similar).
   - `src/main/services/workBlocks.ts:2266` — a JOIN inside `getWorkflowSummaries` so workflow occurrences can filter to non-invalidated blocks.
   - `src/main/db/migrations.ts` — schema management.

None of these is a reader serving a UI view. Every `GET_TIMELINE_DAY`, `GET_APP_SUMMARIES`, `GET_APP_DETAIL`, `GET_APP_ACTIVITY_DIGEST`, `GET_HISTORY_DAY`, `GET_WEEKLY_SUMMARY`, `generateDaySummary`, `generateAppNarrative`, `weeklyBrief`, AI chat tool call lands on a re-derivation of blocks from raw sessions, **not** on a SELECT against `timeline_blocks`.

The cost is paid twice per request: the DB read (sessions, websites, activity_events for the day) + the rebuild (`buildBlocksForSessions` → ~50ms for a typical 22-block day per Phase 4 §8.2) + the write back into `timeline_blocks`. The persisted projection is performing the role of a *cache that no consumer hits*.

### 1.2 The 85 raw SELECTs

`code-proven`. Across `src/main`, 85 SELECT statements hit Layer-1 or Layer-2 tables (`app_sessions`, `website_visits`, `activity_state_events`, `activity_segments`, `timeline_blocks` writes via `persistTimelineDay`). They live in 12 files:

| File | Why it reads raw |
|---|---|
| `src/main/db/queries.ts` | The big query module — `getAppSummariesForRange`, `getSessionsForRange`, `getSessionsForApp`, `getWebsiteSummariesForRange`, `getPeakHours`, `getFocusSessionsForDateRange`, etc. |
| `src/main/services/workBlocks.ts` | Block builders + `getTimelineDayPayload` + `getAppDetailPayload` |
| `src/main/services/attribution.ts` | `normalizeToSegments`, segment scoring, work-session sessionization |
| `src/main/services/tracking.ts` | The capture writer (legitimate; this is the producer) |
| `src/main/services/aiTools.ts` | The AI tool surface — `searchSessions`, `getDaySummary`, `getAppUsage`, `searchFileMentions`, `getBlockAtTime` each issue their own SELECTs |
| `src/main/services/browser.ts` | Browser history reader (capture-side; legitimate) |
| `src/main/lib/insightsQueryRouter.ts` | The deterministic router calling `getAppSummariesForRange`, `getSessionsForRange`, `getTimelineDayPayload` per question |
| `src/main/lib/windowTitleFilenames.ts` | Re-extracts filenames from `app_sessions.window_title` on demand |
| `src/main/jobs/aiService.ts` | Per-job AI builders — each grabs its own slice of raw rows |
| `src/main/ipc/db.handlers.ts` | IPC handlers — some pass through, some re-derive (notably `GET_APP_ACTIVITY_DIGEST`) |
| `src/main/core/query/...` | The "projections" wrapper module that mostly forwards to the legacy functions |
| `src/main/db/migrations.ts` | Schema-side; legitimate. |

The five files that *consume* raw rows on UI/AI request paths — `workBlocks.ts`, `queries.ts`, `aiTools.ts`, `insightsQueryRouter.ts`, `aiService.ts` — together hold roughly **40 distinct SQL statements** that any UI tab visit might trigger. Each statement re-derives a different aggregation. There are at least three different ways the codebase aggregates "minutes per app over a date range" (`getAppSummariesForRange` in `queries.ts:526`, `getSessionsForRange` + manual sum in `aiService.ts:2579-2580`, `getAppDetailPayload` in `workBlocks.ts:2351`).

### 1.3 The empty projection tables — what was attempted and abandoned

`db-proven`. Tables that exist with their schemas but hold 0 rows:

| Table | Schema purpose | Current state |
|---|---|---|
| `daily_entity_rollups` | Per-day client/project attribution rollup | 0 rows. No writer in the codebase populates it (`grep "INSERT INTO daily_entity_rollups"` returns 0 matches in `src/main`). |
| `idle_periods` | Canonical idle periods | 0 rows. Same — no writer. Phase 2 §1.4 covers this. |
| `raw_window_sessions` | Per-window raw capture | 0 rows. No writer. |
| `browser_context_events` | Per-poll browser tab sample | 0 rows. No writer; the capture path writes to `website_visits` instead. Phase 2 §1.6 covers this. |
| `file_activity_events` | Filesystem-level activity | 0 rows. No writer. |

Five projection-shaped tables have been allocated and left empty. They reflect plans that didn't ship. They should be either populated by Phase 3 writers or dropped from the schema; leaving them as zombies confuses future readers.

### 1.4 What actually backs each UI view today

`code-proven`. The read path for each view, traced from the IPC handler:

**Timeline tab (`ipc.db.getTimelineDay(date)`)**
- `db.handlers.ts:198-204` → `getTimelineDayProjection` → `getTimelineDayPayload` (`workBlocks.ts:2088`)
- That function: `getSessionsForRange` + `getWebsiteSummariesForRange` + `buildBlocksForSessions` + `buildSegmentsForDay` + `getFocusSessionsForDateRange` + sums.
- Persists into `timeline_blocks` as a side effect; reader never reads back.

**Apps tab (`ipc.db.getAppSummaries(days)`, `ipc.db.getAppActivityDigest(days)`, `ipc.db.getAppDetail(canonicalAppId, days)`)**
- Summaries → `getAppSummariesForRange` (`queries.ts:526`) — reads `app_sessions` directly, GROUPs by `canonical_app_id ?? bundle_id`.
- Digest → `db.handlers.ts:275-290` walks **every day** in the range, calling `getTimelineDayProjection` per day. For `days=30` that's 30 full timeline rebuilds per Apps visit. Phase 5 §10a calls this out as the "expensive call today."
- Detail → `getAppDetailPayload` (`workBlocks.ts:2351`) — reads `getSessionsForApp` + filters block payload by app.

**AI chat (`ipc.ai.chat(...)` → tool calls)**
- Every tool in `src/main/services/aiTools.ts` issues its own SQL. `searchSessions` runs FTS against `app_sessions_fts`. `getDaySummary` calls `getTimelineDayPayload` → see above. `getAppUsage` calls `getAppSummariesForRange`. `getBlockAtTime` calls `getTimelineDayPayload`. `searchFileMentions` runs custom FTS against window titles.

**Wrapped / weekly brief**
- `weeklyBrief.ts` iterates dates and calls `getTimelineDayPayload` per date. For a 7-day brief that's 7 full rebuilds. `wrappedNarrative.ts` does similar across a year.

**Insights / "what's stood out"**
- `insightsQueryRouter.ts` (2,699 lines) is a question-shape router. Per Phase 0 §Code mass, it issues `getAppSummariesForRange`, `getSessionsForRange`, `getTimelineDayPayload` per branch. For a multi-day question it loops over dates.

Net: **every UI view's read latency is bounded by a fresh re-derivation from raw rows**, and the most common shapes (`day_summary`, `app_period_summary`, `domain_day_breakdown`) are computed dozens of times per session.

### 1.5 The `ai_surface_summaries` table is the only working projection

`code-proven` + `db-proven`. `ai_surface_summaries` (72 rows live) is written by `aiService.ts` after a successful per-app-narrative / per-block-insight / per-day-summary AI generation, keyed by a content signature (`appNarrativeSignature` etc.). It is read by `getAppNarrative` (`aiService.ts:3586`) and similar lookups. The signature check at read time short-circuits the AI call when nothing material has changed.

This is the **only** projection in the system that follows the contract Phase 3 wants: write once via a deterministic builder, read via a thin SELECT, invalidate via a fingerprint. It works because the AI cost (real money) forced the discipline.

### 1.6 Invalidation already exists but only triggers cache flushes, not projection rebuilds

`code-proven`. `src/main/core/projections/invalidation.ts` exposes `invalidateProjectionScope(scope, reason, payload)`. Callers in `tracking.ts:1187-1196`, `workBlocks.ts`, `attribution.ts` all emit `invalidateProjectionScope('timeline', ...)` / `'apps'` / `'insights'`. The signal is wired into:
- `useProjectionResource` on the renderer side — re-fetches the IPC.
- `aiService` to bust per-day AI cache entries.

It is **not** wired into a "rebuild this projection table now" path, because there are no projection tables to rebuild. The invalidation cascade fires correctly; nothing actionable listens on the rebuild side. This is the lever Phase 3 plugs into.

### 1.7 Concrete duct-tape pattern: "the same SELECT, written three ways"

`code-proven`. "Apps used over the last 7 days" lives in:
1. `queries.ts:526-585` — `getAppSummariesForRange` (the canonical version). GROUP BY `canonical_app_id ?? bundle_id`. Used by Apps tab list rail.
2. `aiService.ts:2579-2585` — `getAppSummariesForRange(db, fromMs, toMs)` is called, but then the result is reshaped *again* into `topApps` for prompt context with different fields. The reshape is duplicated across ~6 different per-job builders.
3. `aiTools.ts` `getAppUsage` — re-aggregates `app_sessions` rows directly with its own SQL because the tool result shape (`{ name, bundleId, totalSeconds, sessionCount, isFocused, category, lastActiveAt }`) doesn't match `AppSummary`.

Three readers, three near-identical aggregations, three places to update when the canonical-app catalog changes. Phase 3 collapses these to one.

### Pushback

You may push that the "85 raw SELECTs" count is misleading — most are inside `queries.ts` which is the *one* place such queries should live. Partially true: centralisation by file doesn't equal centralisation by *result shape*. The `aiService.ts` reshape pattern (§1.7) is the proof — even when the SELECT is one helper call, the consumer reshapes it to a per-use shape so often that the canonical shape isn't load-bearing.

---

## 2. The canonical projection set — proposal

One principle: **every UI view is a thin SELECT against a Layer-3 projection**. No view re-derives from `clean_events`. No view re-derives from `app_sessions`. If a UI question can't be answered by a SELECT under 50ms, the projection is missing — fix that, not the renderer.

### 2.1 The projection tables

Seven tables. Each has one writer (a builder in `src/main/projections/`), one read API (a function in `src/main/projections/readers.ts`), and a documented invalidation trigger.

#### A. `timeline_blocks` — promote to authoritative

The table exists; this proposal promotes it from "write-only zombie" to "the read path." Add fields per Phase 4 §9.2 and Phase 5 §11:

```
timeline_blocks(
  -- existing columns retained:
  id, date, start_time, end_time, block_kind, dominant_category,
  category_distribution_json, switch_count,
  label_current, label_source, label_confidence, narrative_current,
  evidence_summary_json, is_live, heuristic_version, computed_at, invalidated_at,

  -- new columns (Phase 4/5 demands):
  dominant_entity_kind        TEXT,    -- 'doc' | 'pr' | 'admin' | 'search' | 'meeting' | 'chat' | 'feed' | 'video' | 'code' | null
  dominant_entity_label       TEXT,    -- 'daylens#142', 'Q2 plan.docx', 'meet.google.com/abc'
  activity_kind               TEXT NOT NULL DEFAULT 'work',  -- 'coding'|'reviewing'|'drafting'|'researching'|'meeting'|'coordinating'|'admin'|'learning'|'thin'
  evidence_quality            TEXT NOT NULL DEFAULT 'thick', -- 'thick'|'thin'|'ambiguous'
  continuation_of_block_id    TEXT REFERENCES timeline_blocks(id),
  active_seconds              INTEGER NOT NULL DEFAULT 0,    -- engagement; not for display span
  displayed_span_seconds      INTEGER NOT NULL DEFAULT 0,    -- end_time - start_time / 1000; for display
  fingerprint                 TEXT NOT NULL                  -- content hash for cache invalidation
)
```

Per Phase 4 §9.2 every new field has a named consumer. `dominant_entity_*` drives §2.3's verbed activity labels. `activity_kind` drives §4.2 summary templates. `evidence_quality` gates AI calls. `continuation_of_block_id` drives §5.3 "Continued from 10:29 AM". `active_seconds` vs `displayed_span_seconds` resolves the D3 minute-precision bug.

Writer: `projections/timelineBlocks.ts:rebuildForDate(date)`. Reads `clean_events WHERE date = ?`. Emits one row per block. Idempotent; invalidates by `(date, fingerprint)` comparison.

Reader: `getTimelineDay(date)` becomes a SELECT against `timeline_blocks` + `timeline_block_members` + `timeline_block_labels`. **No more `buildBlocksForSessions` on the read path.**

#### B. `app_day_rollups` — backs the Apps list rail

```
app_day_rollups(
  date              TEXT NOT NULL,
  canonical_app_id  TEXT NOT NULL,
  bundle_id         TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  category          TEXT NOT NULL,
  total_seconds     INTEGER NOT NULL,
  active_seconds    INTEGER NOT NULL,
  session_count     INTEGER NOT NULL,
  first_seen_at     INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL,
  top_block_id      TEXT,                  -- for the "headline" of the list row
  top_window_title  TEXT,                  -- sanitized
  fingerprint       TEXT NOT NULL,
  computed_at       INTEGER NOT NULL,
  PRIMARY KEY (date, canonical_app_id)
)
```

Plus an indexed view (or a second table) `app_period_rollups(canonical_app_id, range_key, ...)` for `1d`/`7d`/`30d` rollups that the Apps tab `getAppSummaries(days)` currently recomputes per call.

Writer: rebuild per (date, canonical_app_id) on clean-events invalidation for that date. Period rollups are derived from day rollups via simple aggregation; cache key includes `(canonical_app_id, range_key)`.

Reader: `getAppSummaries(days)` becomes `SELECT ... FROM app_period_rollups WHERE range_key = ?`. The Apps tab `getAppActivityDigest(days)` 30-day walk (Phase 5 §10a) collapses to a single SELECT.

#### C. `domain_day_rollups` and `page_day_rollups` — back the browser views

```
domain_day_rollups(
  date                 TEXT NOT NULL,
  canonical_browser_id TEXT NOT NULL,
  domain               TEXT NOT NULL,
  total_seconds        INTEGER NOT NULL,
  visit_count          INTEGER NOT NULL,
  top_page_key         TEXT,
  top_page_title       TEXT,                -- sanitized
  first_seen_at        INTEGER NOT NULL,
  last_seen_at         INTEGER NOT NULL,
  PRIMARY KEY (date, canonical_browser_id, domain)
)

page_day_rollups(
  date                 TEXT NOT NULL,
  canonical_browser_id TEXT NOT NULL,
  page_key             TEXT NOT NULL,       -- from Phase 2 §2.5 extractor
  domain               TEXT NOT NULL,
  page_title           TEXT,                -- sanitized
  total_seconds        INTEGER NOT NULL,
  visit_count          INTEGER NOT NULL,
  first_seen_at        INTEGER NOT NULL,
  last_seen_at         INTEGER NOT NULL,
  PRIMARY KEY (date, canonical_browser_id, page_key)
)
```

Writer: rebuild on `clean_events` invalidation for that date, reading the `kind='browser_logical'` rows.

Reader: Phase 5 §3a (browsers carry the receipts) reads `domain_day_rollups WHERE canonical_browser_id = ? AND date = ?`. Phase 6 §2 `listPagesByDomain` tool reads `page_day_rollups WHERE domain = ? AND date BETWEEN ?`. The Apps tab "Time by domain" view (`Apps.tsx:764-801`) becomes a single SELECT.

#### D. `day_summaries` — backs Timeline's "shape of the day" rail

```
day_summaries(
  date              TEXT PRIMARY KEY,
  total_seconds     INTEGER NOT NULL,
  focused_seconds   INTEGER NOT NULL,
  block_count       INTEGER NOT NULL,
  off_seconds       INTEGER NOT NULL,         -- from clean_events kind='machine_off'
  first_block_at    INTEGER,
  last_block_at     INTEGER,
  longest_focus_block_id  TEXT,
  biggest_detour_block_id TEXT,
  ai_summary        TEXT,                     -- the "shape of the day" paragraph
  ai_summary_source TEXT,                     -- 'ai' | 'deterministic' | null
  ai_fingerprint    TEXT,
  computed_at       INTEGER NOT NULL
)
```

Writer: deterministic part rebuilds on any `timeline_blocks` invalidation for that date. AI part fills async, keyed by `ai_fingerprint` (block count + total seconds rounded to 5 minutes, per Phase 4 §8.4 fix).

Reader: Timeline's `DaySummaryInspector` reads `day_summaries WHERE date = ?` instead of calling `ipc.ai.generateDaySummary` on mount.

#### E. `weekly_summaries` — backs the week view + weekly brief

```
weekly_summaries(
  week_start_date   TEXT PRIMARY KEY,         -- Monday local
  total_seconds     INTEGER NOT NULL,
  focused_seconds   INTEGER NOT NULL,
  block_count       INTEGER NOT NULL,
  off_seconds       INTEGER NOT NULL,
  per_day_json      TEXT NOT NULL,            -- array of {date, totals, top_block_label}
  ai_brief          TEXT,
  ai_fingerprint    TEXT,
  computed_at       INTEGER NOT NULL
)
```

Writer: rebuild when any constituent date's `day_summaries` invalidates.

Reader: Timeline's `WeekView` (`Timeline.tsx:1067`) — currently 7 parallel `getTimelineDay` calls — becomes a single SELECT. Phase 4 §8.3 perf fix lands.

#### F. `entity_day_rollups` — backs attribution + the "what's a client" question

```
entity_day_rollups(
  date              TEXT NOT NULL,
  entity_kind       TEXT NOT NULL,            -- 'client' | 'project'
  entity_id         TEXT NOT NULL,
  attributed_seconds INTEGER NOT NULL,
  ambiguous_seconds  INTEGER NOT NULL,
  block_count        INTEGER NOT NULL,
  fingerprint        TEXT NOT NULL,
  computed_at        INTEGER NOT NULL,
  PRIMARY KEY (date, entity_kind, entity_id)
)
```

Effectively replaces the empty `daily_entity_rollups` table — the existing schema is close to right, just gets actually populated, with the entity-kind generalisation and a fingerprint. Writer reads `clean_events` + segment_attributions; reader serves attribution context and the Phase 6 `listClients` / `getAttributionContext` tools.

#### G. `ai_surface_summaries` — already correct; rename to fit the pattern

Already working (see §1.5). Rename the columns to align with the rest of the projection set (`scope_key`, `fingerprint`, `payload_json`, `computed_at`) but keep the writer/reader contract. This is where per-block insight prose, per-app narratives, per-day summaries that already passed the gate land.

### 2.2 One projection writer per table

```
src/main/projections/
  timelineBlocks.ts       — writes A
  appRollups.ts           — writes B (day + period)
  domainPageRollups.ts    — writes C (domain + page day rollups)
  daySummaries.ts         — writes D
  weeklySummaries.ts      — writes E
  entityRollups.ts        — writes F
  aiSurfaceSummaries.ts   — writes G (existing logic, normalised)

  invalidation.ts         — existing module, extended to trigger writers
  readers.ts              — one function per UI question, all are thin SELECTs
```

Every writer is:
- **Idempotent per (key, fingerprint).** If fingerprint matches the persisted row, skip the rebuild.
- **Triggered by `invalidateProjectionScope`** (the existing wire in §1.6). The invalidation payload always includes a `date` (or `canonical_app_id`, etc.) so the writer knows what subset to rebuild.
- **Tolerant of missing upstream.** If `clean_events` for the date isn't built yet, the writer no-ops with a logged reason and re-runs when clean-events lands.

### 2.3 One reader API

`projections/readers.ts` exports the canonical question-shape functions. Each is a thin SELECT (occasionally a JOIN). Examples:

```
getTimelineDay(date): TimelineDayPayload                — SELECT FROM timeline_blocks + timeline_block_members
getAppSummaries(rangeKey): AppRollup[]                  — SELECT FROM app_period_rollups WHERE range_key = ?
getAppDetail(canonicalAppId, rangeKey): AppDetail       — SELECT FROM app_day_rollups + domain_day_rollups
getDaySummary(date): DaySummary                          — SELECT FROM day_summaries
getWeek(weekStart): WeekSummary                          — SELECT FROM weekly_summaries
listPagesByDomain(domain, rangeKey): PageVisit[]        — SELECT FROM page_day_rollups
getEntityContext(entityKind, entityId, range): EntityRollup — SELECT FROM entity_day_rollups
```

The current per-job builders in `aiService.ts`, the per-tool readers in `aiTools.ts`, and the route bodies in `insightsQueryRouter.ts` all migrate to these — they stop re-shaping raw data.

Phase 6 §3 ("Universal output shape contract") becomes free: every projection reader returns primitive-typed rows with sanitized strings (because Phase 2 §2.7 already sanitized them at write time into `clean_events`). The AI tool surface stops re-sanitizing per call.

### 2.4 Invalidation flow, end-to-end

```
[clean_events writer] -> emits {date, scope='timeline'}
   |
   v
invalidateProjectionScope('timeline', ..., {date})
   |
   v
projections/invalidation.ts dispatcher:
   - calls timelineBlocks.rebuildForDate(date)
     -> recomputes fingerprint
     -> if changed: UPDATE timeline_blocks row(s) for that date
                    invalidateProjectionScope('day_summary', ..., {date})
                    invalidateProjectionScope('weekly_summary', ..., {weekStart})
                    invalidateProjectionScope('app_day_rollup', ..., {date})
   - calls appRollups.rebuildForDate(date)
     -> ...
   - calls domainPageRollups.rebuildForDate(date)
     -> ...

Renderer's useProjectionResource hears the original scope event and re-fetches via the reader; the reader hits the freshly-rebuilt row.
```

A live-block delta channel (Phase 4 §8.2 perf fix) bypasses the rebuild for the in-flight block — it pushes the live block's id/label/endTime to the renderer directly while the persisted `timeline_blocks` row is still the prior-completed block.

### 2.5 What disappears in this layer

`code-proven`:
- `workBlocks.ts:getTimelineDayPayload` — 31 lines; collapses to a thin reader.
- `workBlocks.ts:buildBlocksForSessions` and its 700+ lines of session-level reasoning — runs **only inside `timelineBlocks.ts`** as part of the writer, not on every read.
- `workBlocks.ts:loadPersistedAppDetailBlocksForDates` — already implements the "read from `timeline_blocks`" pattern; the rest of the file converges on it.
- `db.handlers.ts:GET_APP_ACTIVITY_DIGEST` 30-day walk — becomes one SELECT against `app_day_rollups`.
- `aiService.ts:appNarrativeSignature` and the per-job fingerprint scattered logic — generalises into the per-projection fingerprint column.
- The three different "minutes per app over date range" implementations from §1.7 — one reader.
- The empty `daily_entity_rollups`, `idle_periods`, `raw_window_sessions`, `browser_context_events`, `file_activity_events` zombie tables — either populated by Phase 3 writers (`entity_day_rollups`) or dropped.

### Pushback

You may push that this is "build a new system before the old one is paid off." Counter: the existing `timeline_blocks` already implements 80% of the projection contract — schema, writer, idempotency. The Phase 3 work is mostly *removing* the recomputation paths on the read side, plus adding the four siblings (`app_day_rollups`, `domain_day_rollups`, `page_day_rollups`, `day_summaries`, `weekly_summaries`). The line count goes *down*, not up.

---

## 3. P0 cross-check (AI-PRODUCT-DIRECTION.md D1–D7)

| Directive | This spec |
|---|---|
| **D1 — Activity, not app** | Respected. `timeline_blocks.dominant_entity_kind` / `dominant_entity_label` / `activity_kind` are persisted at projection-write time — every reader (Timeline, Apps, AI, Wrapped) gets activity-shaped data, never raw `topApps` lists. The verbed-activity labels Phase 4 §2.3 needs are computed once and reused. |
| **D2 — Time awareness** | Respected. `trackingWindowStart = MIN(clean_events.started_at)` (Phase 2) and "earliest day with data" = `MIN(day_summaries.date WHERE block_count > 0)` are single-lookup answers. The four D2 edge cases all become projection reads. |
| **D3 — Minute-level precision** | Respected. `timeline_blocks` carries both `displayed_span_seconds` (end_time - start_time / 1000, minute-aligned) and `active_seconds` (engagement) as separate columns. The summing-across-sessions bug from D3 cannot survive: there is no longer a summing path on the read side. |
| **D4 — Never refuse** | Respected. `evidence_quality` on `timeline_blocks` (thick/thin/ambiguous) and the per-projection `fingerprint`/`computed_at` give the AI surface the metadata to qualify answers ("Daylens captured this on a thin signal day") instead of refusing. Phase 6 §7 deterministic-fallback templates read these fields. |
| **D5 — Apps view is context, not totals** | Load-bearing. `app_day_rollups.top_block_id` + `top_window_title` are the "what happened" headline columns. Minute totals (`total_seconds`, `active_seconds`) are siblings, not the lead. The Apps view becomes: `SELECT ... FROM app_day_rollups + JOIN timeline_blocks ON top_block_id ...`. |
| **D6 — Capture surface is a tradeoff** | Indirect. The projection layer doesn't decide *what* gets captured; it decides *how* readers consume it. New capture surfaces (Phase 2 SPA detection, Phase 6 future captures) flow through `clean_events` and emerge in the projections without any reader change. That isolation is the value. |
| **D7 — Common understanding** | Respected. This doc cites AGENTS, AI-PRODUCT-DIRECTION, PRODUCT-SPEC, Phase 0, Phase 2, Phase 4, Phase 5, Phase 6 explicitly and obeys the read order. |

### Pushback

You may push on D3 — that storing both `displayed_span_seconds` and `active_seconds` doubles the surface for the bug to re-emerge. Counter: the bug emerges *only* when a renderer sums the wrong column. With both columns persisted and named, the renderer picks one explicitly. The current bug is "the renderer sums `session.durationSeconds` because no other field exists" — that root cause is gone.

---

## 4. Section-by-section pushback

§1.1 — "timeline_blocks is write-only": you may say the table is read by `loadPersistedAppDetailBlocksForDates` (which it is) and that the recompute-on-read pattern is a deliberate eventually-consistent fallback. Counter: 1 fallback consumer for 5,659 rows of persisted data is not eventual consistency, it's a leak. The persisted shape exists; nobody reads it because the read path was built first and never refactored once writes started landing.

§1.2 — "85 raw SELECTs": you may say half are in `tracking.ts` and `migrations.ts` and legitimately read raw because they *are* the producer or DDL. True. The number that matters is the ~40 in `workBlocks.ts` + `queries.ts` + `aiTools.ts` + `insightsQueryRouter.ts` + `aiService.ts` that run on user-facing request paths. That's the count Phase 3 collapses.

§1.3 — "drop the zombie tables": you may push that `daily_entity_rollups` was schema-ready for a writer that didn't ship and dropping it loses the design intent. My counter: the design intent is preserved in `entity_day_rollups` in this spec, with the rename making it obvious that Phase 3 *is* the long-deferred writer.

§2.1 column A — adding 7 columns to `timeline_blocks`: you may say widening the canonical table couples it to Phase 4's specific needs. Reasonable. The narrower alternative is a sidecar `timeline_block_extensions` table — but every reader already needs the sidecar to render a useful label, so the join would be universal. Better to fold the extensions in.

§2.1 column D — `day_summaries`: you may say the AI-summary field belongs in `ai_surface_summaries`, not `day_summaries`. Fine — keep the AI text in `ai_surface_summaries` and let `day_summaries` carry only the deterministic columns. The Timeline reader does a JOIN. My lean: collocate for v1.0 because there is exactly one consumer pattern (the day rail) and the join is cheap.

§2.2 — "one writer per table": you may say in practice the writers will end up calling shared helpers (artifact extraction, entity inference) so the "one writer" boundary is soft. Yes — the shared helpers live in `src/main/projections/lib/` and are called by multiple writers. The boundary that matters is: only one *file* is allowed to `INSERT INTO timeline_blocks`; only one to `INSERT INTO app_day_rollups`; etc. That keeps the schema-of-truth single-owned.

§2.4 — invalidation cascade: you may push that fan-out cascades cause invalidation storms when the live block ticks. They will if naive. Mitigation: the cascade only emits when fingerprints actually change. The live-block delta channel (§2.4 final paragraph) means the *only* projection that changes per-tick is the live block; everything else fingerprint-matches and short-circuits.

§2.5 — collapse line count: you may want a number. Rough estimate from grep + line counts: ~600 lines of recompute logic across `workBlocks.ts` (block-formation read paths), `db.handlers.ts` (digest 30-day walk), `aiService.ts` (per-job reshape), `aiTools.ts` (per-tool reshape) move into projection writers (still present) but stop running on the read side. Net read-path code is ~80% smaller; total code is roughly flat. The *latency* delta is what matters: a 30d Apps tab visit drops from ~30 timeline-day rebuilds to one indexed SELECT.

---

## 5. Decisions for Tonny — numbered

Each entry includes my lean.

1. **Promote `timeline_blocks` to authoritative.** Stop calling `buildBlocksForSessions` from the read path. Yes / no. **Lean: yes.** The table is already 80% there; the remaining work is on the read side, not the write side.

2. **Add the seven new fields to `timeline_blocks`** (`dominant_entity_kind`, `dominant_entity_label`, `activity_kind`, `evidence_quality`, `continuation_of_block_id`, `active_seconds`, `displayed_span_seconds`, `fingerprint`)? Yes / no. **Lean: yes.** Every field has a Phase 4 / Phase 5 / Phase 6 consumer named.

3. **Build `app_day_rollups` + `app_period_rollups`.** Yes / no. **Lean: yes.** The 30-day Apps digest walk (Phase 5 §10a) is the most-felt single perf problem in the codebase and is gone with this table.

4. **Build `domain_day_rollups` + `page_day_rollups`.** Yes / no. **Lean: yes.** Phase 5 §3 (browsers carry the receipts) and Phase 6 §2 (`listPagesByDomain` tool) both depend on it.

5. **Build `day_summaries` and `weekly_summaries`.** Yes / no. **Lean: yes.** WeekView's 7-parallel-`getTimelineDay` (Phase 4 §8.3) is a single SELECT after.

6. **Populate `entity_day_rollups`** (the renamed `daily_entity_rollups`). Yes / no. **Lean: yes.** Attribution UI + AI tools need it; the schema-without-writer state is the worst of both.

7. **Drop the remaining zombie tables** (`raw_window_sessions`, `browser_context_events`, `file_activity_events`, `idle_periods`). Yes / no. **Lean: yes**, after Phase 2 lands and confirms the consumers (none) are gone. Keep DDL for one release as in Phase 2 §6 decision 9 to preserve migration ordering.

8. **Single-writer-per-table contract.** Yes / no. **Lean: yes.** Enforce by file convention; codify in `docs/AGENTS.md` once the layout exists.

9. **Live-block delta channel** (Phase 4 §8.2 — push live-block id/label/endTime over a dedicated IPC; don't re-fetch the full day). Build it as part of Phase 3, or punt to a follow-up? **Lean: part of Phase 3.** The 30s full-day re-fetch is the worst single Timeline UX cost and the projection rebuild every 30s of the live block is the cause.

10. **Fingerprint shape on each projection.** Stable hash of `(input row hashes + heuristic_version)`, or a content-only hash? **Lean: input hashes + heuristic version.** Means a heuristic-version bump force-rebuilds everything; content-only could leave stale rows when only the rule changed.

11. **AI-text columns live in `ai_surface_summaries` only, or duplicated into `day_summaries.ai_summary`?** **Lean: in `ai_surface_summaries` only; `day_summaries` JOINs.** Avoids two sources of truth.

12. **Project layout — `src/main/projections/`.** Or keep the writers inside `src/main/services/workBlocks.ts` until they outgrow it? **Lean: new directory.** The whole point of Phase 3 is to draw a boundary that survives the next 5,000 lines of growth; folding the writers into `workBlocks.ts` recreates the monolith inside a year.

13. **Backward-compatibility window for the recompute-on-read path.** Keep `buildBlocksForSessions` as a fallback when a projection row is missing, or hard-cut over and accept a brief blank state? **Lean: keep as a one-release fallback.** A read that finds no projection row triggers an inline writer call (synchronous, cached for the request), so the experience is "slow once, then fast forever" — never blank.

### Pushback

You will likely flip my lean on at least #1 (the existing recompute-on-read is fine for live data, only batch jobs need projections), #9 (the live-block delta channel is a v1.1 luxury), and #12 (file-system reorganisation slows other work). Mark the disagreements before any spec lock.

---

*Phases 2 and 3 together give Phases 4 / 5 / 6 the data layer they assume. With both in place, every UI view in v1.0 reads from a thin SELECT against a deterministic projection; every AI tool reads sanitized primitive rows; every "what changed" event lands in one place.*
