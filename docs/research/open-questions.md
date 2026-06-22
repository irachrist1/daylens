# Open questions — cross-cutting decisions

Eleven problems that touch multiple surfaces and have no spec. Each one below: what
exists today, the problem, one recommendation, and the edge cases. Every recommendation
is consistent with the 12 invariants in `docs/plans/DAYLENS-V2-PLAN.md`.

---

## 1. Correction → cache invalidation

**Exists today.** `block_label_overrides` stores user renames; `category_overrides`
stores per-app relabels; both survive rebuilds. Generated text lives in
`ai_surface_summaries` keyed by `(scope_type, scope_key)` with an `input_signature`
(a hash of the assistant scaffold + memory prompt — see `aiService.ts:4174`). On a
cache hit the stored summary is reused; on a signature mismatch it regenerates.
`emitProjectionInvalidation` already pushes scope invalidations to the renderer over IPC.

**Problem.** When you rename a block "Development" → "Configuring the work network," the
day recap, week wrap, and any AI chat turn that named "Development" are now stale. The
signature only covers the scaffold, so a rename that changes a block label may not move it.

**Recommendation.** Fold the override layer into `input_signature`. Mix every applicable
`block_label_overrides.updated_at` and `category_overrides.updated_at` for the scope's
date range into the hash. A rename bumps `updated_at`, the signature changes, the stored
recap/wrap/app-narrative is treated as stale and regenerated on next view. On any
correction, call `invalidateProjectionScope` for the affected date so open views refetch.
This satisfies invariant 8 (corrections always win) and 7 (one truth) without a manual
cache table. Chat history is immutable transcript — never rewrite a past turn; the next
turn reads the corrected blocks.

**Edge cases.** Week/month wraps span a renamed day → include the whole range's override
timestamps. No credits → regeneration is blocked; show the stale recap with a "needs
refresh" marker rather than silently lying (invariant 10). A rename during live day → only
the giant live block exists, nothing to invalidate yet.

---

## 2. Day boundary and timezone

**Exists today.** `localDate.ts` defines a day as local midnight→midnight
(`localDayBounds` = `new Date(y, m, d)` + 86,400,000 ms). No idle/sleep cutoff, no DST
handling, no late-night rule.

**Problem.** A day is local-calendar midnight. Someone coding until 2am has that session
land on the next calendar day, splitting one work stretch across two timelines. The flat
+86.4M ms also assumes every day is 24h, which DST days are not.

**Recommendation.** Keep local midnight as the canonical boundary (simple, matches the
calendar metaphor users expect), but make the boundary **idle-aware**: a session that
crosses midnight is assigned to the day where its *block* started, and the block extends
past midnight until the next 15+ minute idle/lock gap. So a 11pm–2am stretch stays one
block on the start day. Compute bounds from real `Date` arithmetic
(`new Date(y, m, d+1)` minus `new Date(y, m, d)`) so DST days are 23h/25h correctly, not a
hardcoded 86.4M ms.

**Edge cases.** Spring-forward (2am skips to 3am) → no session can start in the gap; safe.
Fall-back (2am repeats) → timestamps are absolute epoch ms so ordering is preserved; just
don't assume monotonic wall-clock. Travel across timezones mid-day → use the device's
current tz at query time, accept a one-time seam. A block that runs 9pm–4am → it belongs
to the start day; the next day opens with whatever follows the idle gap.

---

## 3. Historical data migration

**Exists today.** `versioning.ts` defines `DERIVED_STATE_COMPONENT_VERSIONS` and
`DERIVED_STATE_RESET_COMPONENTS` (app_normalization, inference_pipeline,
projection_contracts). Blocks carry `heuristic_version`; `invalidateTimelineDay` clears a
day so it rebuilds. Raw evidence (app_sessions, website_visits, activity_state_events) is
immutable and complete — invariant: everything is derived and rebuildable.

**Problem.** v2 changes how blocks are built. Re-deriving all history changes old wraps;
not re-deriving makes last week look different from this week.

**Recommendation.** Re-derive lazily, never eagerly. Bump `inference_pipeline` version. A
day is rebuilt with v2 logic only when it is next opened (or its wrap next requested);
until then it keeps its v1 blocks tagged with the old `heuristic_version`. User
corrections re-attach by lineage (`timeline_block_reviews.evidence_key`,
`timeline_boundary_corrections` keyed by session pair), so renames survive the rebuild.
**Frozen wrap snapshots are never retroactively changed** (briefs-wraps invariant 4) — a
week already wrapped keeps its frozen numbers; only unwrapped/future periods get v2. This
avoids a multi-minute startup migration and keeps numbers internally consistent.

**Edge cases.** A week half-v1, half-v2 → freeze per day, sum frozen days, numbers still
agree. User opens a 3-week-old day → rebuild that one day on demand (<1s, see Q4). Don't
re-derive a day with no raw evidence; show "untracked," not empty (invariant 10).

---

## 4. Performance at scale

**Exists today.** Real volume: 5,977 Safari "sessions"/week, 119h tracked/30d.
Segmentation (`chunk2.ts:segmentBlocks`) is a single linear pass over ordered sessions
(O(n)); block labeling makes one AI call per block. Blocks persist in `timeline_blocks`
with `invalidated_at`, so a built day is read, not recomputed.

**Problem.** Re-segmenting a day touches every raw session that day. The bottleneck is not
the linear segmentation — it's (a) the per-block AI label calls and (b) the raw session
count inflated by micro-sessions (Q5).

**Recommendation.** Three things. (1) Collapse micro-sessions into real sessions at read
time (Q5) so segmentation sees ~hundreds of rows/day, not thousands. (2) Cache built
blocks per day (already the model) and only rebuild on invalidation — a month view reads
30 frozen days, it does not re-segment 30 days. (3) Batch block labeling: one day's blocks
go to the model together, not one call each, and only blocks whose evidence changed get
relabeled. Target: rebuilding one day < 1s of compute excluding the AI call; a 30-day view
renders from cached snapshots in < 200ms.

**Edge cases.** First-ever open of a 30-day-history install → show days incrementally as
each rebuilds, don't block on all 30. Live day → one giant block, no per-block AI cost
until "Analyze Day" (timeline spec §4). A day with a genuine 2,000-session burst (browser
tab storm) → the Q5 merge is what keeps it bounded; cap labeling input by sampling
evidence, never by dropping time.

---

## 5. Session definition

**Exists today.** Raw foreground sessions are recorded per focus change; the Apps subtitle
counts them directly, producing 5,977 for Safari in a week. No merge threshold exists.

**Problem.** "Session" currently means "focus event," so every tab flick or alt-tab is a
session. The number is meaningless and erodes trust in every other number on the screen.

**Recommendation.** Define a **session as a continuous engagement with one app, where
returns within 2 minutes are the same session.** Concretely: merge consecutive same-app
sessions when the gap between them is < 120s, regardless of what was focused in between
(a 30s glance at Slack and back to Cursor is still one Cursor session). A session must also
clear a 30s floor — anything shorter is absorbed into the neighbor, not counted. This turns
5,977 into a believable double-digit number and matches how a person remembers "I was in
Safari a few times today." Compute it at read time from raw sessions so it stays a
projection, not a destructive capture change (raw evidence stays intact).

**Edge cases.** App in the background but audible (music) → not a session, no focus. Rapid
A→B→A→B switching during pair-debugging → merges into one A session and one B session, not
twenty. Sanity benchmark for the eval harness: Safari/week should be tens, not thousands;
assert an upper bound. The 2-min threshold is the same family as the block detour cutoff
but smaller — sessions live *inside* blocks.

---

## 6. AI privacy boundary

**Exists today.** Exclusions (`trackingExcludedApps`, `trackingExcludedSites`,
`skipIncognito`) are enforced at **capture** — `CaptureBlockReason` drops them before they
hit SQLite (`trackingControls.ts`). `aiSanitize.ts` strips secrets (tokens, JWTs, URL
query strings) from every tool result via `sanitizeToolResult` before the model sees it.
`stripBrowserUrlFromTitle` drops query params from titles at capture.

**Problem.** Exclusion is capture-time only. If a user adds an exclusion *after* data was
captured, that old data is still in the DB and still flows to the provider. And there's no
single choke point asserting "this is what leaves the machine."

**Recommendation.** Add an exclusion pass at the resolver boundary, not just at capture.
Every resolver that builds AI context (`assistantEvidence`, day/week payloads, wrap
inputs) filters rows whose app or host matches the *current* exclusion lists before
handing anything to the model — so a newly-excluded app retroactively disappears from AI
output even though its raw rows remain. Keep `sanitizeToolResult` as the last-line secret
filter. What goes over the wire: app names, block labels, domains/hosts, page titles
(query-stripped), times, and durations — never full URLs with query strings, never
secrets, never excluded apps/sites. Document this list in `ai.md` as the privacy contract.

**Edge cases.** Adult/social/entertainment hosts are already gated from *labels*
(`domainPolicy.ts`) but still reach recall — that's intended (the user can ask "that link
about X"), so recall is exempt from the leisure gate but not from user exclusions. No
provider connected → nothing leaves at all (no-credits rule). MCP server reads the same DB
— it must apply the same resolver-level exclusion (Q10).

---

## 7. Browser distinction

**Exists today.** `BROWSER_APP_IDS` enumerates 11 browsers (Safari, Chrome, Arc, Dia,
Brave, Edge, Firefox, Opera, Vivaldi, Chromium, Comet). `website_visits.browser_bundle_id`
records which browser loaded each page, and the Apps spec already requires domains to
attribute to the hosting browser, not the focused app (`apps.md` §3.3).

**Problem.** With Chrome and Safari both open on GitHub, the same domain appears under two
apps; in the Timeline both feed one block; the totals must not double-count.

**Recommendation.** Treat each browser as its own first-class app everywhere (Apps view,
domain attribution) but attribute time by **focus, not by open windows.** Only the focused
browser accrues time, so two browsers open on GitHub never double-count — whichever is
focused owns those seconds. In the Apps view, `github.com` legitimately shows under both
Chrome and Safari with each one's real focused time. In the Timeline, both collapse into
one intent block ("Working on GitHub") because blocks group by intent, not by app
(invariant 1) — the block's evidence simply lists two browsers. Domain rows always carry
`browser_bundle_id`, so attribution stays unambiguous.

**Edge cases.** A browser not in the known set → falls back to substring match
(`browserAppIdFor`); if still unknown, treat as a non-browser app (no domain section,
apps.md invariant 5). Picture-in-picture / background tab playing audio → not focused, no
time. Same page open in two browsers simultaneously → two domain rows, summed only inside
their own app, never across apps.

---

## 8. Offline / local-AI fallback

**Exists today.** The no-credits rule is absolute (`ai.md` §5, briefs-wraps §7): no API,
no AI text — one message pointing to Settings, nothing fabricated. Capture, segmentation
(`chunk2.ts`), session merge, domain attribution, and dedup are all pure local computation
with no network.

**Problem.** "No credits, no AI" could be misread as "no app offline." Need to draw the
line between what needs the provider and what doesn't.

**Recommendation.** Everything except *generated prose* works fully offline. The Timeline
renders blocks, durations, gaps, and the stats bar with no API. Apps shows time, domains,
deduped pages offline. Block **segmentation and naming split**: segmentation (boundaries,
merges, sizes) is deterministic local code and always runs; the human *title* is AI and
needs the provider, falling back to a plain evidence-based label offline (timeline spec
§3.5 already specifies this validator fallback). Only chat answers, recaps, and wraps
require the API. **Do not** wire Ollama as a silent fallback — invariant 5 says every AI
surface uses the one model picked in Settings, and a local model would violate "one model
everywhere" and quietly change the voice. If local models are ever offered, they must be an
explicit Settings choice, not an automatic offline swap.

**Edge cases.** Offline mid-generation → fail with a provider-named error, never a canned
answer (invariant 3). Offline block with no AI title → evidence-based fallback label, not
"Untitled." Reconnecting → stale recaps regenerate on next view (Q1). MCP works offline (it
reads the local DB) but its prose-generating tools, if any, follow the same rule.

---

## 9. Accessibility and keyboard flows

**Exists today.** Partial: 27 `aria-label`, 11 `role=`, scattered `aria-selected/pressed/
expanded`, and a `CommandPalette` (⌘K). No evidence of a full keyboard path through chat,
the correction panel, or the wrap carousel; no focus-management audit.

**Problem.** Every surface is reachable by mouse; keyboard-only and screen-reader paths are
unverified. The correction flow (rename/merge) and the wrap carousel are the highest risk.

**Recommendation.** Make keyboard-completable the bar for every primary flow, verified per
packet, not a separate accessibility packet at the end. Concretely: (1) Chat — input is
always focused on open, ⌘↵ sends, ↑/↓ moves through sidebar conversations, Esc cancels a
generation. (2) Corrections — a focused block opens its panel with Enter, Rename is a
labeled text field, Merge above/below are buttons in tab order. (3) Wrap carousel — ←/→
move cards, focus is trapped in the modal and returns to the trigger on close. Every
interactive control gets an `aria-label`; every list uses roving `tabIndex`. The quality
gate (drive the app, screenshot) should include one keyboard-only pass per surface.

**Edge cases.** Generation in flight + user tabs away → focus must not get stuck on a
disabled control (this is a current bug, `ai.md` §9). Screen reader on a live-updating
block → announce politely (`aria-live="polite"`), don't spam. Reduced-motion users → the
carousel and InlineRevealText respect `prefers-reduced-motion`.

---

## 10. Packaging vs dev behavior

**Exists today.** `mcpServer.ts` already branches on `app.isPackaged`: packaged runs a
compiled bundle, dev runs TS through a loader with visible repo paths. The MCP toggle is
on with dev paths in the current build (a dev artifact, not the prod default). `updater.ts`
exists; auto-update is packaged-only.

**Problem.** The shipped build should not expose dev filesystem paths, default-on MCP, or
debug surfaces. Need an explicit list of what differs.

**Recommendation.** Gate environment differences on `app.isPackaged`, one switch, listed in
one place. Packaged build: **MCP off by default** (DAYLENS-V2-PLAN settings §); the config
snippet shows the user's real userData DB path, never repo paths; auto-update **on**;
debug menu and `debug.handlers.ts` IPC **disabled**; error reporting respects the analytics
opt-in (local-only honored). Dev build: MCP may default on for convenience; debug menu on;
auto-update off with a one-line "dev build — update via git" note (settings spec already
wants this). Never ship a default that sends data off-machine without the opt-in.

**Edge cases.** User enabled MCP in dev, then installs the packaged build → respect their
saved setting, don't silently flip it, but the *default* for a fresh packaged install is
off. Auto-update on a dev build → no-op with explanation, never a broken update path.
Analytics toggle off → no telemetry and no error reports leave the machine.

---

## 11. Correction audit trail

**Exists today.** `timeline_block_reviews` stores `original_block_json` and
`correction_json` with a `review_state` (`auto-approved`/`pending`/`approved`/`corrected`/
`ignored`) — so the pre-correction state is already retained. `block_label_overrides`
holds the current user label; `label_source` on a block distinguishes `rule`/`ai`/`user`.
Boundary edits live in `timeline_boundary_corrections` (split/merge, keyed by session pair).

**Problem.** The data to show "what it was before" and "who named this" exists but isn't
surfaced; there's no undo affordance, and the app must never let re-analysis overwrite a
human name (invariant 8; locked / protected user edits must survive re-analysis).

**Recommendation.** Use `label_source` as the authority flag: `user` and an active
`block_label_overrides` row are human-authoritative and re-analysis/rebuild must skip them
(the code already checks `block.label.source === 'user' || override` before relabeling —
make that check exhaustive across every relabel path). Surface the trail from the data
that's already stored: the block detail panel shows "You renamed this from 'Development'"
read from `original_block_json`, with an **Undo** that deletes the override row and lets
the AI label win again. Distinguish visually — a quiet "edited by you" marker on
human-named blocks, nothing on AI-named ones. No new table needed.

**Edge cases.** Rebuild changes block IDs → corrections re-attach by `evidence_key` /
session-pair lineage, the trail follows. Undo a merge → restore the two original blocks
from the boundary correction. User renames, then the underlying evidence is deleted (Q1
page delete) → the override is orphaned; drop it and tell the user the block it named is
gone, don't keep a label pointing at nothing.
