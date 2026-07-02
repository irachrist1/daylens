# Roadmap — past parity, toward 10x

Synthesized 2026-07-03 from two independent reviews (Opus 4.8 and GPT-5.5, blind to each
other) of the code, specs, and the live DB, run right after the timeline pipeline was
brought to spec. Seven of the nine opportunities below were identified by **both**
reviewers independently — treat that convergence as signal.

The grounding fact both found: Daylens captures rich app/browser/focus/idle signal
(28k app_sessions, 52k website_visits, 153k focus_events) but has **no project, calendar,
git, document, or worklog signal at all** — and the thread layer PRODUCT.md promises
("blocks grouped into threads") is schematized but unbuilt. `work_sessions` holds 294+
tracked hours, 100% unattributed. `projects`, `attribution_rules`,
`daily_entity_rollups`: empty.

Every feature below must hold the 12 invariants: no grades or scores, never guess,
corrections always win and survive rebuilds, one truth across views, metadata-only
capture, local-first.

Ranked by value-to-effort. "Both" = independently proposed by both reviewers.

---

## 1. Obsidian worklog + vault bridge (Both — cheapest genuine 10x)

Daylens drafts the day's `worklog` lines and a vault day-note from finalized blocks;
the founder approves before anything is written. Closes the loop the founder already
runs by hand every day, and is the concrete proof of the personal-context-OS thesis.

Build shape: extend `jobs/eveningConsolidation.ts` / wrap narrative to emit past-tense
worklog lines and a Daylens-owned markdown section; vault path in Settings; preview →
confirm → write.

Acceptance:
- The evening wrap offers a worklog draft, one line per meaningful block/thread,
  past-tense, matching the founder's existing format.
- Nothing is written to disk without explicit approval; a diff is shown first; the
  founder's edits are preserved.
- Reruns update only the Daylens-owned section of the day-note, never the rest.
- Every drafted line traces to a real block — no invented accomplishments.
- Missing vault/path is a plain "not connected" state, never an error loop.

## 2. Git / dev-artifact capture (Both — fixes the evidence at the root)

Poll approved local repos for commit subjects, branches, changed-file counts, PR refs —
metadata only, never contents. The block that once got named "Computer activity" was
really "fixed the timeline capture bug"; that fact lives in `git log`, not in window
titles. Directly cures the findings.md "blindfolded AI" failure and feeds #1, #4, #6.

Build shape: new `services/gitCapture.ts`; repo roots auto-discovered from artifacts;
new `git_events` table (or revive `file_activity_events`' unused `repo_remote_url`);
enrich `evidence_summary_json` so naming and resolvers see commits.

Acceptance:
- A block spanning a commit carries that commit's subject and file stats in its
  evidence object.
- On a day with commits, at least one block is named from commit intent, not an app.
- Repo roots are discovered without manual path configuration; excluded repos stay
  invisible.
- No file contents are ever stored — only paths, subjects, counts, timestamps.

## 3. The thread layer (Both — the unbuilt core promise)

Derive goal-threads grouping blocks across days ("Timeline rework", "Set up the work
network") — the thing PRODUCT.md promises and that weekly wraps, "what mattered," and
the project ledger all presuppose. Pure derivation over existing blocks; no new capture.

Build shape: new projection clustering blocks by shared artifacts (repo, domain, doc),
label similarity, temporal recurrence; `threads` table + block→thread membership;
rename/merge/close as corrections through the existing review pattern.

Acceptance:
- Two blocks on different days on the same work land in one thread with real summed
  hours that reconcile with the Timeline.
- Renaming or merging a thread survives a full rebuild.
- A one-off block stays standalone — no junk threads.
- Thread status is "last touched", never an inferred "unfinished" claim.

## 4. Calendar ingest (Both) → planned-vs-actual (Opus)

Read-only local calendar metadata (title, times, attendee count, response status).
Meetings are invisible to screen capture yet dominate a founder's day; calendar is the
only source of *intended* structure. Phase two: reconcile the intended day against the
lived one — the highest-order question a day-reviewer has.

Build shape: `services/calendarCapture.ts` (EventKit), `calendar_events` table; feed
meeting blocks (`block_kind` already supports meetings), then a reconciliation resolver
+ wrap card.

Acceptance:
- A calendar meeting with corroborating activity (Meet/Zoom foreground, near-zero
  typing) becomes a meeting block with title and attendee count.
- A scheduled event with no observed activity is shown as "not observed" — stated,
  never judged, never asserted as attended (invariant 9).
- Only event metadata is stored; disconnecting deletes it.
- Reconciliation output is phrased as fact ("planned X, the day went Y"), never a
  completion percentage. Totals tie to the Timeline.

## 5. Client / project time ledger (Both — explicitly requested)

The founder's own work-memory fact says "track billable work across clients and
projects." The schema (`clients`, `projects`, `attribution_rules`,
`daily_entity_rollups`) and services (`attribution.ts`, resolvers) exist; nothing
populates them. Depends on #2/#3 for strong attribution keys.

Acceptance:
- A rule (repo/domain/app → project) reclassifies matching past sessions and survives
  rebuilds.
- "How much time on <client> this week" returns totals equal to those blocks on the
  Timeline.
- Low-confidence work stays visibly unattributed — never force-fit (invariant 9).
- AI answers client/project questions with block-level evidence.

## 6. Work patterns / temporal self-knowledge (Both)

Derive when deep stretches happen, longest-uninterrupted windows, interruption and
resumption shapes, meeting-heavy days — from the 153k focus_events + blocks already on
disk. No new capture; no view asks these questions today.

Acceptance:
- "When do I do my deepest work" returns a concrete window backed by named blocks on
  real days, or "not enough evidence."
- Patterns are stated as neutral observations ("your longest uninterrupted stretches
  cluster 8–10am"), never a score, grade, or ranking of days (invariant: no grades —
  both reviewers flagged this as the feature's failure mode).
- Interruption examples point to exact blocks and gaps.

## 7. File / document activity (Codex)

Metadata for documents touched under user-approved roots (path, title, app,
timestamps). The schema expected this signal (`activity_segments.file_path`: 0 rows
ever). Strengthens recall and attribution.

Acceptance:
- Opening/editing a file under an approved root creates a document artifact visible in
  block detail.
- Opt-in roots with exclusions; deletion removes the records; contents never read.
- "Find the doc from yesterday" resolves through recall with the artifact as evidence.

## 8. Input cadence, metadata-only (Both — flagged riskiest by both)

Per-minute keyboard/mouse **counts** (never keys, text, or coordinates) to distinguish
active work from a parked foreground window — a distinction the evidence object
genuinely cannot make today.

Acceptance:
- Only aggregate counts per interval are stored; disabling removes cadence from every
  surface and answer.
- A foreground app with zero input is distinguishable from active work in block
  evidence; segmentation may use it for boundaries.
- Cadence never surfaces as a percentage, score, or "focus" metric anywhere
  (invariant 9's hard line; the moment it's a displayed number, it's a grade).

## 9. Cross-device metadata import (Codex — furthest out)

A second device contributes metadata-only activity via local import (schema already has
`devices`). Gaps stay honest: "other device activity" only when backed by rows; a gap
is never filled with a guess.

---

## Deliberately not on the list

- **Cross-surface recall** — already wired (`resolvers.ts` `recall` + 3,972 artifacts /
  22k mentions). Improving it is polish, not new capability.
- **App Detail raw-SUM page durations** (`getDomainSummariesForBrowser` /
  `getPageSummariesForBrowser`) — known small divergence, tracked from the 2026-07-03
  reconciliation work; a cleanup, not roadmap.

## Sequencing note

#1 ships first (smallest, proves the output loop). #2 and #3 are the two foundations —
one fixes the evidence, one builds the missing spine — and unlock #4/#5/#6 almost for
free. #8 waits until the invariant-safe framing is settled with the founder.
