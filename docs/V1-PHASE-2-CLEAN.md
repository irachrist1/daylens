# Daylens v1.0 — Phase 2: Clean (the denoised event stream)

Author: codebase + DB audit, 2026-05-15. Status: spec only, no code changes.

Scope: how the raw capture stream from Layer 1 is denoised into a usable event sequence before any UI view, AI tool, or projection touches it. This phase does not redesign the UI — it names what the "clean" sequence must look like so that Phase 3 (Structure) has a stable contract to project from, and Phases 4/5/6 stop reaching past it to read raw rows.

Read order before touching this spec:
1. `docs/AGENTS.md`
2. `docs/AI-PRODUCT-DIRECTION.md` — D1–D7 are non-negotiable
3. `docs/V1-PHASE-0-READ.md` — Layer 1 capture audit (already done)
4. This doc, then `docs/V1-PHASE-3-STRUCTURE.md`

Claim discipline below: `code-proven` (read from cited source), `db-proven` (verified against the live DB at `~/Library/Application Support/DaylensWindows/daylens.sqlite` — the `~/Library/Application Support/Daylens/...` file is a stale May-5 snapshot), `inferred`, `open question`.

---

## 1. Code-grounded snapshot — what "Clean" looks like today

### 1.1 Three parallel denoise pipelines run, and none of them is canonical

`code-proven`. The raw capture from Layer 1 is denoised in **three** different places, each owned by a different file, each producing a different artifact, each consumed by a different downstream:

| Pipeline | Owner | Output | Consumer |
|---|---|---|---|
| Foreground flush filter | `src/main/services/tracking.ts:1568-1646` (`flushCurrent`) | rows in `app_sessions` | Timeline, Apps, AI (everything) |
| Attribution segmentation | `src/main/services/attribution.ts:185-263` (`normalizeToSegments`) | rows in `activity_segments` | Attribution + work_sessions rollup only |
| Timeline block formation | `src/main/services/workBlocks.ts:1344-1432` (`analyzeSessions` + `buildBlocksForSessions`) | rows in `timeline_blocks` (recomputed on every read) | A subset of detail-only readers (see §1.6) |

There is no "denoised event stream" in the sense the layered approach implies. There is a **raw stream** (`app_sessions`), an **attribution-only stream** (`activity_segments`), and a **block stream** (`timeline_blocks`) that is currently a write-only side-effect of the read path. Phase 4 §9.1 already named this as the largest data-fidelity issue; the audit below makes the shape concrete.

### 1.2 The foreground flush filter (tracking.ts) — what's actually dropped

`code-proven`. The rules a foreground sample must pass to land in `app_sessions`:

1. **OS noise filter** at `tracking.ts:1015-1026` (`isOsNoise`). Hardcoded sets:
   - `OS_NOISE_BUNDLE_IDS`: 9 macOS infrastructure bundle IDs (`com.apple.loginwindow`, `dock`, `WindowManager`, etc.).
   - `OS_NOISE_APP_NAMES`: 6 lowercase exact-matches (`loginwindow`, `dwm.exe`, `svchost.exe`, etc.).
   - `SELF_NOISE_EXE_NAMES`: 5 exact exe matches for self-exclusion.
   - **Plus** a substring scan: any `appName` containing `daylens` / `cmux` / `node.js` is dropped. This is brittle — a project named "cmux-rebuild" or a window whose title says "node.js docs" survives, but the bundle ID test catches the real cases anyway. Flagged at Phase-0 §148.
2. **Self-capture filter** at `tracking.ts:995-1005` (`trackedForegroundSessionExclusionReason`). Two paths: known Daylens bundle IDs (5 variants), and any window title starting with `Daylens:`. Returns a non-null reason string (e.g. `daylens_self_capture`) that goes into the dropped-reason analytics but never produces a row.
3. **Minimum duration** at `tracking.ts:74` (`MIN_SESSION_SEC = 10`). Sub-10s sessions are silently discarded inside `flushCurrent`. A 9-second focus on Slack is invisible to every downstream reader.
4. **Power events** (`tracking.ts:1207-1239`). `lock-screen` / `suspend` flush the in-flight session with `endedReason: 'lock_screen' | 'suspend'`. `unlock-screen` / `resume` only record a state event — no new session is created until the next poll resolves a foreground app.
5. **Idle gating** (`tracking.ts:1322-1361`). Three states:
   - `active`: normal poll.
   - `provisional_idle` (≥120s no input): the in-flight session is **held open**. Records an `idle_start` activity_state_event. Idle time is attributed to the session — explicit choice to avoid fragmenting media playback.
   - `away` (≥300s no input): flush the session at the moment idle began (`idleStartMs = Date.now() - idleSec*1000`), records `away_start`, and returns from the poll. The session's `endedReason` is set to `away`.

### 1.3 What lands in `app_sessions` today

`db-proven` from the live DB (counts as of 2026-05-15 17:51):

- `app_sessions`: 17,967 rows total.
- `ended_reason` distribution: NULL 9,944, `app_switch` 7,608, `away` 343, `suspend` 36, `daylens_self_capture` 29, `lock_screen` 4, `recovered_after_restart` 3.
- `capture_source` distribution: `foreground_poll` 8,502, `import_macos` 9,465.

Two facts to call out:
- **55% of historical rows have `ended_reason = NULL`.** `db-proven`: rows with `ended_reason IS NULL` span 2026-03-19 → 2026-05-15, rows with the field populated span 2026-04-14 → 2026-05-15. The field was added in a recent migration; pre-migration rows have no provenance for *why* a session ended. Any downstream consumer that wants to distinguish "user switched apps" from "machine went to sleep" cannot, for the older half of the corpus.
- **9,465 rows (53%) have `capture_source = import_macos`.** That is a one-shot historical import path, not live tracking. The "denoise" logic in `tracking.ts` was bypassed for those rows — they inherited whatever shape the import did, including a `MIN_SESSION_SEC` that may or may not have matched the live filter. `open question`: what is the floor / OS-noise filter the macOS importer applied? Needs to be traced before Phase 3 can claim the historical corpus is comparable to live data.

### 1.4 Idle and machine-off — three half-truths

`code-proven` and `db-proven`. The current "idle / machine-off" picture is reconstructed at *read time* from three independent sources, each incomplete:

1. **`activity_state_events`** (`db-proven`: 3,023 rows). Written by `recordActivityEvent` in `tracking.ts:1241-1255` and by `handleLockScreen` / `handleSuspend`. Carries event-shape data: `idle_start`, `idle_end`, `away_start`, `away_end`, `lock_screen`, `unlock_screen`, `suspend`, `resume`. Distribution today: `idle_start` 1,140, `idle_end` 638, `away_end` 591, `suspend` 171, `resume` 170, `unlock_screen` 159, `lock_screen` 154. **Asymmetry:** 1,140 `idle_start` vs 638 `idle_end` — 502 "openings" never close on the wire (most because they escalate to `away` and the `away_end` lands on the next resume, but there is no guaranteed pairing logic).
2. **`idle_periods`** (`db-proven`: **0 rows**). Schema exists (`id, device_id, started_at, ended_at, duration_ms, reason`); no writer in the codebase produces rows. `attribution.ts:151-158` reads it ("Real idle_periods rows take precedence; fall back to activity_state_events"). The fallback path is the only path that ever runs.
3. **`app_sessions.ended_reason`** (see §1.3). The closest thing to a per-session "why did this stop" tag. Misses pre-2026-04-14 rows entirely.

Net effect: **there is no canonical "machine was off from A to B" record.** Every consumer that needs that information re-derives it from the three sources, with `attribution.ts:loadIdlePeriods` (lines 149-182) being the only place where the derivation is centralised — but it returns `IdlePeriod[]` for attribution's own use, not as a persisted contract anyone else can join against.

### 1.5 Rapid switch dedup — there isn't one beyond `MIN_SESSION_SEC = 10`

`code-proven`. The only filter against tab-flicker / app-flicker in the foreground capture is the 10-second floor at flush time. There is no:
- "Same bundle ID within N seconds → merge" rule.
- "Switched away and back within N seconds → coalesce" rule.
- Cooldown after a flush before a new session of the same app is allowed to be a separate row.

Downstream this means a user who alt-tabs Slack → IDE → Slack → IDE in 30 seconds produces 4 rows in `app_sessions` (assuming each leg held the foreground for ≥10s), and every Phase 4 block-formation reader sees 4 transitions instead of 2 with two contiguous IDE blocks. `attribution.ts:609-657` has its own `sessionize` step that re-merges adjacent same-bundle segments inside `MAX_MERGE_GAP_MS = 120000` (line 28) — but that merge happens **only** in the attribution path, not for the data Timeline/Apps reads.

### 1.6 Browser context — an entire pipeline that runs to write the wrong table

`code-proven`. `src/main/services/browserContext.ts` (referenced from `tracking.ts:1545-1550`) records browser tab samples per poll into `website_visits`, not into the dedicated `browser_context_events` table that the schema defines. `db-proven`: `browser_context_events` has **0 rows**; `website_visits` has 27,048. The clean event-stream contract is unclear here too — is the "clean" browser stream supposed to be per-tab-visit (what `website_visits` actually stores: one row per domain visit with start, end, page title, browser bundle ID, source) or per-poll-sample (what `browser_context_events`'s schema implies: per-5s tab snapshot)? `open question`: pick one, populate it, and document the deprecation of the other table.

A related concrete: `tracking.ts:1465-1470` strips browser URL query strings from `windowTitle` via `stripBrowserUrlFromTitle(rawResolvedTitle, isBrowserApp)` before insert. This is **partial sanitization** — only `?query` and `#fragment` are stripped on browsers. The OAuth token leak in Phase 0 §UX (Screenshot 12.14.42) survived precisely because the model read a `window_title` that retained the path with the token embedded *in the path*, not the query. The Phase 6 §1B `sanitizeForModel` is the load-bearing fix; the Phase 2 contract is that this stripping is a **best-effort** at capture time, not the final sanitization layer.

### 1.7 `activity_segments` — the closest thing to a clean stream that already exists

`code-proven` and `db-proven`. `attribution.ts:185-263` (`normalizeToSegments`) produces what is structurally the cleanest version of the event stream that Daylens currently writes:

- **Per-session slicing around idle periods** (line 214: `sliceAroundIdle`) — splits a session into multiple segments at idle boundaries instead of swallowing the idle as part of the session.
- **`attention_score`** (line 222) combining `is_focused` and `idle_ratio`. Per-segment attention is a real feature the rest of the system never reads.
- **`class` field** with 4 values (`focused`, `supporting`, `ambient`, `idle` — though `idle` is dropped by the `idleRatio > 0.7` rule at line 227 turning it into segmentClass). `db-proven`: today's classes split `focused` 880, `ambient` 381, `supporting` 92 across 1,353 rows.
- **`enrichedWindowTitle`** at lines 236-239 — falls back to top-domain `pageTitle` when the foreground title is uninformative. The richest title field Daylens currently writes anywhere.

Why it isn't the canonical stream today:
1. **Coverage gap.** `db-proven`: 1,353 `activity_segments` rows vs 17,967 `app_sessions` rows. Segments only exist for ranges where `runAttributionForRange` has run. Attribution runs are debounced (3s per `tracking.ts:1040`) and scoped to specific dates — gaps exist for any date the attribution pipeline never touched.
2. **Different idempotency rule.** `attribution.ts:358-372` clears and re-inserts segments per range every time attribution refreshes. That is correct for attribution but means segment IDs are not stable — `activity_segments.id` is a `randomUUID()` regenerated on every refresh. Nothing else can join on it.
3. **`idle_periods` is empty so the slicing is degenerate.** `attribution.ts:151-182` falls back to reconstructing idle from `activity_state_events`. That works, but the reconstruction has the 502-row asymmetry from §1.4, so the slicing under-counts idle on the older corpus.
4. **No browser SPA awareness.** Segments inherit `app_sessions.window_title` (one per session) plus a single browser top-domain. The "logical pages" gap from Phase 4 §9.1 is not addressed here.

### Pushback

You will push that `activity_segments` is "good enough" — that promoting it to the canonical stream and backfilling the gaps is cheaper than designing a new contract. My counter: it is the right *starting point*, but the canonical clean stream needs to be **the input** to attribution, not produced by it. Today attribution is *both* the consumer and the producer of the cleanest stream, which means the clean-stream contract drifts with attribution's needs. Phase 3 needs a stream that attribution reads from like every other downstream.

---

## 2. The canonical clean event stream — proposal

### 2.1 One table, one writer, every consumer downstream

Add a single Layer-2 table — call it **`clean_events`** — with this shape. It supersedes `activity_segments` as the source-of-truth segmentation and deprecates the unused `raw_window_sessions`, `browser_context_events`, `idle_periods`, `file_activity_events` zombie tables.

```
clean_events(
  id                TEXT PRIMARY KEY,           -- deterministic from (start_ms, bundle_id, hash)
  date              TEXT NOT NULL,              -- local YYYY-MM-DD for indexing
  started_at        INTEGER NOT NULL,           -- epoch ms, minute-aligned at write
  ended_at          INTEGER NOT NULL,           -- epoch ms, minute-aligned at write
  duration_sec      INTEGER NOT NULL,           -- (ended_at - started_at) / 1000, whole seconds

  kind              TEXT NOT NULL,              -- 'foreground' | 'idle' | 'away' | 'machine_off' | 'browser_logical'
  bundle_id         TEXT,                       -- non-null for 'foreground' and 'browser_logical'
  canonical_app_id  TEXT,
  raw_app_name      TEXT,
  display_name      TEXT,

  window_title      TEXT,                       -- best title for this segment (see §2.3)
  page_kind         TEXT,                       -- 'search' | 'feed' | 'mailbox' | 'doc' | 'admin' | 'video' | 'chat' | 'code' | null
  domain            TEXT,                       -- non-null for browser_logical segments
  page_key          TEXT,                       -- stable per-page identifier (host + path + spa-route hash)
  page_title        TEXT,                       -- already sanitized (see §2.7)

  category          TEXT NOT NULL,              -- AppCategory
  attention_class   TEXT NOT NULL,              -- 'focused' | 'supporting' | 'ambient' | 'idle' | 'off'
  attention_score   REAL NOT NULL,              -- 0..1
  input_score       REAL NOT NULL,              -- 0..1
  idle_ratio        REAL NOT NULL,              -- 0..1

  source_session_ids_json TEXT NOT NULL,        -- ['as_42','as_43'] — app_sessions ids this rolls up
  ended_reason      TEXT,                       -- 'app_switch' | 'idle' | 'away' | 'lock_screen' | 'suspend' | 'merged' | 'live'
  confidence        REAL NOT NULL,              -- 0..1, low for reconstructed historical rows
  capture_version   INTEGER NOT NULL,           -- bumped when this contract changes
  computed_at       INTEGER NOT NULL,
  invalidated_at    INTEGER
)
```

Indexes: `(date)`, `(started_at)`, `(canonical_app_id, started_at)`, `(domain, started_at)`. A second small table — `clean_event_pages` — holds per-page-visit rows for browser logical-page splits when more than one logical page occurred inside a `browser_logical` segment, keyed `(event_id, page_key)`.

### 2.2 One writer

`CleanStreamBuilder` — a new service that subscribes to:
- The `flushCurrent` callback in `tracking.ts` (per-session-end).
- The `flushActiveBrowserContext` callback in `browserContext.ts` (per-browser-tab-end).
- The `activity_state_events` insert in `recordActivityEvent` (per state transition).
- The `recoverPersistedLiveSnapshot` recovery path.

The builder takes the *event* (session end, browser flush, state transition) and decides whether to:
1. Append a new `clean_events` row.
2. Merge with the previous row of the same kind/bundle within the same minute (sub-flutter dedup).
3. Split the previous row at an idle/away boundary it now knows about.
4. Mark a range as `kind='machine_off'` when `lock_screen` or `suspend` is followed by `unlock_screen` / `resume` ≥ 60 seconds later.

`clean_events` is the **only** segmented stream the rest of the system reads. Attribution reads it (replacing `normalizeToSegments`'s embedded slicing). Timeline-block formation reads it (replacing `buildBlocksForSessions`'s session-level reasoning). The AI tool surface reads it (replacing the mix of `searchSessions` over raw `app_sessions` and `website_visits`).

### 2.3 Window-title fidelity inside a foreground event

Phase 0 §Layer 1 item 1 names the single largest data-fidelity issue: `app_sessions` stores **one** `window_title` per session. The clean stream's foreground-kind row must promote a richer title:

- **Primary**: a `window_title_history` (JSON array of `{ ts, title }`) attached to the row, sourced from per-poll observations during the session. Phase 0 confirms `activity_events.windowTitle` exists at 5s tick granularity but Daylens does not currently aggregate it; `CleanStreamBuilder` does. `open question`: confirm `activity_events` table is still populated, since the live DB shows it as absent and 5s ticks instead seem to live in the `app_sessions` writer only. **DB check needed before Phase 3 lock.**
- **Secondary**: a `window_title_canonical` field that picks the longest-dwell title from the history. For a 30-minute VS Code session that touched 10 files, the canonical title is the file with the most contiguous foreground time, not the last one observed.
- **Tertiary**: when the source app is a browser, `window_title` is the page title of the dominant tab in the segment, *not* the OS-reported active window title (which often contains the URL).

The Phase 4 §2.3 verb-table activity labels require this — without per-event title history, "Drafting Q2 plan" cannot be derived because the session lost the filename history.

### 2.4 Browser SPA route detection

`clean_events.kind = 'browser_logical'` splits a browser foreground stretch into one row per *logical page*, not per tab visit. Two heuristics, both required:

1. **Window-title change without URL change.** When `window_title` changes by ≥3 normalized tokens but `url` (from `website_visits.fullURL`) is unchanged, emit a new logical-page row. Catches Gmail thread navigation, Linear issue navigation, Notion subpage navigation.
2. **Page-key stability.** A per-host `pageKeyExtractor` (see §2.5) produces a stable identifier. When the extractor's output changes, split. Falls back to URL+title hash.

This is the Phase 4 §9.1 and Phase 5 §11 D-G item. Without it, "research time on Linear issue DAY-142" decays to "research time on linear.app" for the whole session.

### 2.5 Per-host page-key extractors

A small registry — `pageKeyExtractors.ts` — with one extractor per high-traffic SPA host. Day-1 list:
- `mail.google.com` → `mailbox-{label}` or `thread-{thread_id}` (parseable from URL fragment).
- `linear.app` → `team-{team}/issue-{id}` or `view-{view_id}`.
- `notion.so` → `page-{page_hash}` (block ID from URL).
- `github.com` → `repo-{owner/name}/{pull|issues}/{id}` or `repo-{owner/name}`.
- `app.slack.com` → `channel-{channel_id}` (from URL).
- `docs.google.com` → `doc-{doc_id}` (from URL).
- Default fallback: `${host}${pathFirstTwoSegments}` for everything else.

These extractors are deterministic, hand-rolled, and live in shared code so the AI tool surface (Phase 6 `listPagesByDomain`) reads the same identifier. No content extraction — only URL/title parsing.

### 2.6 Rapid-switch dedup

Replace the lone `MIN_SESSION_SEC = 10` with three rules at clean-stream-write time:

1. **Sub-second flutter** (already implicit): the 5s poll cadence is the floor; the builder never sees sub-poll events.
2. **Bounce-back merge.** A `(app A → app B → app A)` triplet where the middle leg is < 15s and the same A bounds it gets coalesced into a single A run; the B leg is recorded as a `bounce` flag on the A row, not lost. Visible to AI as "you briefly checked Slack twice during a 30m focus block" without splitting the block.
3. **Bracket-noise window.** Within the first 10 seconds *and* last 10 seconds of an idle/away resume, ignore foreground apps that don't outlast a 30-second window. Catches the "clicked Finder for a second on the way back" noise.

`MIN_SESSION_SEC` becomes 5 (matching the poll cadence) rather than 10, but the bounce-back rule absorbs the rest. The current 10s floor is throwing away signal that the AI surface specifically asks for: "what did I switch between" needs the switches, not the absences.

### 2.7 Sanitization at the clean-stream boundary

The Phase 6 §1B `sanitizeForModel` is the load-bearing AI-side defense. The Phase 2 contract is **the upstream half**: every string field that lands in `clean_events` (`window_title`, `page_title`, `domain`, `display_name`, history entries, `page_key`) is already cleaned at write time:

- URL query strings stripped (current partial behaviour in `aiSanitize.stripBrowserUrlFromTitle`, extended).
- Secrets stripped: bearer tokens, JWTs, hex blobs ≥32, base64 blobs ≥24, OAuth `code=…` params.
- Single allowlist for what *keeps* the URL path: `docs.google.com`, `github.com`, `linear.app`, `notion.so`, `meet.google.com`. Everything else loses everything past the host.
- The full original URL is still recoverable from `website_visits.url` for the cases that genuinely need it (Phase 5 §3 browsers-carry-the-receipts).

This means a leaked OAuth callback URL **cannot be reconstructed from the clean stream**, even if the AI sanitizer fails. Defense in depth at the data layer.

### 2.8 Machine-off as a first-class kind

When `lock_screen` is followed by `unlock_screen` ≥ 60 seconds later (or `suspend` → `resume`), the builder emits a `clean_events` row with `kind='machine_off'`, `attention_class='off'`, `duration_sec` covering the full off window, and `ended_reason` carrying which transition pair bounded it. This replaces the current "reconstruct from `activity_state_events` at every read" pattern. Phase 4 §3.2 ("Machine off ≥ 2 hours renders as a single italic row") becomes a one-line SELECT against `clean_events WHERE kind = 'machine_off'`.

### 2.9 Backfill posture

`open question`: the historical corpus (9,944 NULL `ended_reason` rows, 9,465 `import_macos` rows) needs a one-shot backfill to produce `clean_events` rows from raw `app_sessions` + reconstructed idle periods. The backfill will have lower `confidence` (e.g. 0.6) than live builder output (0.95) and downstream readers must respect that — AI tool results cite confidence when answering questions about pre-migration dates. **Lean: confidence-aware backfill; do not pretend old data is the same shape as new data.**

---

## 3. What disappears, what shrinks

`code-proven` deprecations enabled by adopting `clean_events` as canonical:

| Today | After Phase 2 |
|---|---|
| `attribution.ts:normalizeToSegments` (78 lines that re-slice raw rows) | Replaced by a 10-line `SELECT FROM clean_events` |
| `attribution.ts:loadIdlePeriods` and its fallback to `activity_state_events` | Removed; idle is a `kind` in `clean_events` |
| `tracking.ts` 502-row idle_start/idle_end asymmetry | Resolved at write time; pairs are guaranteed by the builder |
| `workBlocks.ts:buildBlocksForSessions`'s session-level reasoning (700+ lines) | Reads from `clean_events`; the session-level edge cases (sub-10s gaps, idle merging) are pre-resolved |
| `browser_context_events`, `idle_periods`, `raw_window_sessions`, `file_activity_events` zombie tables | Dropped or repurposed as `clean_event_pages` |
| 4 different ways to reason about "was the machine off" | One: `clean_events WHERE kind = 'machine_off'` |
| 85 raw SELECTs against `app_sessions` / `website_visits` / `activity_state_events` spread across 12 files | A handful of `clean_events` reads in Layer-3 projection writers only |

### Pushback

You will push that this is a bigger lift than "audit how the capture stream is denoised." It is. The Phase 2 *audit* is the table-by-table catalogue in §1; the Phase 2 *proposal* is one table, one writer, one contract. The smaller version of the proposal — backfill `activity_segments` to cover everything and promote it — is on the table but I don't recommend it (see §1.7 reason 2 — segment IDs aren't stable, the contract leaks into attribution).

---

## 4. P0 cross-check (AI-PRODUCT-DIRECTION.md D1–D7)

| Directive | This spec |
|---|---|
| **D1 — Activity, not app** | Respected indirectly. The clean stream's `window_title_history`, `page_kind`, and `page_key` are the inputs that *make* activity-shaped labels possible downstream. Without per-event title fidelity (§2.3) and SPA logical pages (§2.4), Phase 4's verbed-activity templates degrade to app names. |
| **D2 — Time awareness** | Respected. `trackingWindowStart` is `MIN(clean_events.started_at)` — a single deterministic source. `kind='machine_off'` rows make the "tracking gap" copy from D2 a one-shot lookup instead of three-table joins. |
| **D3 — Minute-level precision** | Respected. Clean stream rows minute-align `started_at` / `ended_at` at write (§2.1). All downstream `duration_sec` math operates on whole-minute boundaries; the 30m-as-2h1m bug from D3 cannot survive because there is no longer a summation across raw sessions. |
| **D4 — Never refuse** | Respected. The `confidence` field (§2.1) is the foundation for the "name the closest captured signal" pattern — low-confidence backfill rows are still answerable, just with provenance. The AI surface (Phase 6) reads confidence and qualifies its answers; it never refuses. |
| **D5 — Apps view is context, not totals** | Indirect: the clean stream provides the per-segment `attention_class` and `page_kind` that Phase 5's deterministic narratives (§5a of Phase 5) need to lead with activity rather than minute totals. |
| **D6 — Capture surface is a tradeoff** | Load-bearing. §2.3 (window-title history), §2.4 (SPA splits), §2.5 (per-host extractors) are exactly the D6 roadmap items called out in `AI-PRODUCT-DIRECTION.md:131-136` — title-fidelity for VS Code/Cursor/Kiro, browser SPA detection. None are punted. |
| **D7 — Common understanding** | Respected. This doc cites AGENTS, AI-PRODUCT-DIRECTION, PRODUCT-SPEC, Phase 0, Phase 4, Phase 5, Phase 6 explicitly. |

### Pushback

You may push on D6 — that §2.4 / §2.5 SPA detection is a meaningful new capture surface, not a Layer-2 denoise concern. Counter: it is both. The capture (URL + title sampling) is already happening; the denoise produces the *logical* unit from those samples. Phase 1 (Layer 1) handles whether the raw URL is captured at all; Phase 2 handles whether two URLs that share a host but differ by SPA route are treated as one event or two. The fix lives at the boundary, not in either pure layer.

---

## 5. Section-by-section pushback

§1.1 — "three pipelines and none is canonical": you may say `app_sessions` *is* the canonical stream, and `activity_segments` + `timeline_blocks` are downstream consumers. I disagree because `app_sessions` is raw, not clean — it carries the `MIN_SESSION_SEC=10` floor and the OS-noise filter, but everything else (idle slicing, attention scoring, page logic) is downstream. "Raw" and "clean" need to be two different artifacts.

§1.4 — "no canonical machine-off record": you may say the 502-row asymmetry is small enough to live with. It probably is for live data, but pre-2026-04-14 rows have `ended_reason = NULL` for 55% of the corpus, and any AI answer about a historical date will hit reconstructed idle. The clean stream's `machine_off` rows close this once.

§2.1 — table shape: you may push that 20 columns is too many for a "clean" table. I'd argue every column is a downstream consumer's actual need (Phase 4 reads `kind`, `attention_class`, `category`, `window_title`, `page_kind`; Phase 5 reads `domain`, `page_key`, `page_title`; Phase 6 reads everything for sanitization context). Removing columns just pushes the joins back into the consumers.

§2.3 — `window_title_history`: you may want this as a separate sidecar table (`clean_event_titles`) rather than JSON. Reasonable. My lean: JSON on the row for v1.0 because the access pattern is "read the row + decide which title to show" and never "join across title rows." If we later add per-title queries (e.g. AI search over title history), promote to a table.

§2.4 — SPA detection: you may say a 5-host extractor list is too narrow and we should pin it later. Counter: 5 hosts cover most of Tonny's actual workflow per `~/.claude/projects/-Users-tonny-Dev-Personal-daylens/memory/strategic_ai_plan.md`; the fallback `${host}${pathFirstTwoSegments}` handles the long tail without lying about it.

§2.6 — `MIN_SESSION_SEC = 5` instead of 10: you may say lowering the floor risks DB bloat. Concrete check: with poll cadence 5s, the maximum new rows per day is bounded by ~17,280 events; the bounce-back merge (§2.6 rule 2) cuts the realistic increase to ≤30% over today's row count. Worth measuring before commit.

§2.7 — pre-sanitization at the data layer: you may push that the Phase 6 sanitizer is enough and pre-cleaning is paranoia. Counter: pre-cleaning means the secret never sits in the DB, so a SQL inspector / a future export feature / a corrupted backup can't leak it either. Defense in depth.

§2.8 — `machine_off` as a kind: you may say it crosses date boundaries and complicates per-date indexing. True — a 9pm → 7am off window spans two `date` values. My lean: write two rows, one per date, with a `continuation_id` linking them. Adds three lines to the builder.

§2.9 — confidence-aware backfill: you may push for the simpler "drop the import_macos rows" or "treat all historical rows as confidence 1.0." Counter: dropping loses real signal (9,465 rows is half the corpus); pretending they're high-confidence misleads AI answers about historical dates. Confidence is honest.

---

## 6. Decisions for Tonny — numbered

Each entry includes my lean.

1. **Adopt `clean_events` as the canonical Layer-2 stream.** Yes / no, with the smaller fallback being "backfill and promote `activity_segments`." **Lean: yes, new table.** The `activity_segments` shape is too coupled to attribution to be the contract.

2. **Per-event window-title history (§2.3).** Inline JSON on `clean_events` rows, or a sidecar `clean_event_titles` table? **Lean: inline JSON for v1.0.** Promote later if access patterns warrant.

3. **SPA logical-page detection (§2.4).** Block on it for Phase 4 ship (no Timeline redesign without it, matching Phase 4 §11 decision 13), or ship Phase 4 on one-URL-per-session and add SPA in v1.1? **Lean: block on it.** Without SPA, Phase 4 §2.3's "Researching {entity}" decays to domain stems for Gmail/Linear/Notion/Slack — the most-used hosts.

4. **Per-host page-key extractor coverage at v1.0 (§2.5).** Day-1 5-host list (Gmail / Linear / Notion / GitHub / Slack / Docs / Meet), or a smaller minimum? **Lean: 5-host minimum plus the `${host}${pathFirstTwoSegments}` default.** Anything more is a curation chore that delays.

5. **Rapid-switch dedup (§2.6).** Lower `MIN_SESSION_SEC` to 5 and add bounce-back merge + bracket-noise filter? Or keep 10? **Lean: lower to 5 + add the merges.** The current 10s floor discards real attention-switch signal that the AI surface specifically wants.

6. **Pre-sanitization at clean-stream write (§2.7).** Yes / no. **Lean: yes.** Defense in depth; the Phase 6 sanitizer is independent.

7. **`machine_off` as a first-class `kind` (§2.8).** Yes / no. **Lean: yes.** Replaces three-source reconstruction with one SELECT.

8. **Confidence-aware historical backfill (§2.9).** Yes / no; if yes, the confidence floor for `import_macos` rows. **Lean: yes, default 0.6 for pre-2026-04-14 rows, 0.95 for live builder output.**

9. **Deprecate the zombie tables (`raw_window_sessions`, `idle_periods`, `browser_context_events`, `file_activity_events`, plus possibly `activity_segments` after migration).** Yes / no; if yes, drop or keep as no-op DDL for one more release. **Lean: keep DDL for one release to avoid breaking field-level migrations, then drop.**

10. **Single writer (`CleanStreamBuilder`) hooked to `flushCurrent` + `flushActiveBrowserContext` + state-event inserts.** Or accept a multi-writer model where each callsite produces its own clean rows? **Lean: single writer.** Multi-writer reintroduces the "three pipelines" problem this spec is designed to end.

11. **Browser context table choice (§1.6 open question).** Drop `browser_context_events` and keep `website_visits` as the per-visit log, or repurpose `browser_context_events` for per-poll samples and demote `website_visits` to a roll-up? **Lean: drop `browser_context_events`, keep `website_visits` as the per-visit log, and let `clean_events.kind='browser_logical'` be the per-logical-page projection.**

12. **`activity_events` table — still populated?** §2.3 depends on per-poll title history. Verify it exists and is current in the live DB before Phase 3 locks the contract. **Lean: spike check today (5 minutes); if missing, the title-history feature shifts to Layer 1 and Phase 2 ships without it, accepting Phase 4 will degrade to one-title-per-session.**

13. **Single-line per `kind`, or split foreground vs idle vs machine-off into separate tables?** **Lean: single table.** Downstream queries are almost always "give me everything in this date range" — splitting forces every reader to UNION.

### Pushback

You will likely flip my lean on at least #3 (don't block Phase 4 on SPA — ship and iterate), #5 (don't lower the floor — fragmentation will make the timeline noisier), and #11 (keep `browser_context_events`; you wrote the schema for a reason). Mark the disagreements before any spec lock.

---

*Next: `docs/V1-PHASE-3-STRUCTURE.md` — what projection tables every UI view reads, given the clean stream above.*
