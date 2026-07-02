# Findings — why Daylens gets the day wrong

**Status:** Investigated · **Date:** 2026-06-20 · **Source:** live `DaylensWindows/daylens.sqlite` (501 MB) + code read

This is the root-cause report behind the issues we saw testing on June 20. Read it before
touching any fix — most of the symptoms are the same disease wearing different costumes, and
fixing a symptom without the cause just moves the bug. Everything here is traced to real rows
in the database or real lines in the code, so it's checkable, not vibes.

The one-line version: **the AI isn't dumb, it's blindfolded.** We've been blaming the brain
for a problem in the eyes.

---

## 1. The proof: what the AI was actually handed

The June 20 block from 10:41–12:29 was named **"Computer activity," category uncategorized**.
You were really chasing a flickering menu bar — Cursor and Warp, terminal commands, the AI in
those editors, opening and closing Accessibility programs, restarting things.

Here is the *entire* evidence object Daylens gave the model to name that block
(`timeline_blocks.evidence_summary_json` for `blk_429e4d13f80b234a`):

```
Zen        44 min   (isBrowser: false)
Codex      19 min
Warp        8 min
Cursor      6 min
TickTick    4 min
pages: []   documents: []   domains: []
```

Five app names and some durations. No window titles, no URLs, no page titles, no files —
nothing about *what you were doing*. Given that, "Computer activity" is the correct answer.
Opus, GPT-5, a sharp human — anyone handed those five lines says "general computer stuff." The
model never had a chance. **A better model on empty evidence is still blind.** The reinvention
we want belongs upstream, in what we capture and assemble — not in a cleverer prompt.

---

## 2. The three capture failures (all proven from the DB)

### 2.1 Window titles are barely captured

`activity_segments` is where window titles, domains, and file paths should live. For June 20:
**59 segments, 0 with a window title, 0 with a domain.** And it's chronically thin even on
good days — only ~10–30% of segments ever carry a title (June 17: 50 of 758; June 19: 9 of
222).

Two suspects, both worth a hard look:
- **Permission.** Reading window titles needs macOS Accessibility (and Screen Recording for
  some surfaces). On June 20 you were toggling Accessibility apps off and on to fix the menu
  bar flicker — you may have starved Daylens's own permission mid-day. *Not yet verified — a
  read-only permission check is the first thing to confirm.*
- **Fragility by design.** The chronic sparsity on normal days says it's not only today's
  toggle. The capture path drops titles far more often than it keeps them.

`raw_window_sessions` and `browser_context_events` are both **0 rows** — empty tables that
look like they were meant to hold this and don't. Worth deciding if they're dead.

### 2.2 Zen (and any unknown browser) is invisible

Browser detection is one hardcoded name regex — `src/main/services/tracking.ts:1072`:

```ts
function looksLikeBrowserApp(bundleId: string, appName: string): boolean {
  const lower = `${bundleId} ${appName}`.toLowerCase()
  return /(chrome|safari|firefox|edge|brave|arc|opera|vivaldi|dia|comet|browser)/.test(lower)
}
```

**Zen isn't in the list.** So the 44 minutes in Zen — the single biggest chunk of that block,
and the one place the real intent lived as page titles — was thrown away. `website_visits`
*does* work (Canva and roadmap.sh were captured fine from other browsers at 13:xx today); it's
specifically Zen's history that's never read, because Daylens doesn't know Zen is a browser.

This is the same root as "categorize apps correctly when the user installs them." A name
allowlist is a guess that breaks on every browser we didn't hardcode. The real fix detects
browser-ness from the app itself — does its Info.plist register it as an `http`/`https`
handler — so the next unknown browser just works on day one.

### 2.3 The evidence assembler only reads app names

Even the content we *do* capture doesn't reach the model. `website_visits` has page titles and
URLs; `activity_segments` has window titles, domains, and file paths. But the block evidence
builder pulls almost entirely from `app_sessions` (names + seconds) and ships
`pages: [], documents: [], domains: []`. The brain is starved even when the eyes happen to
work. Fixing 2.1 and 2.2 only helps if the assembler actually joins that content in.

**Fix all three and the block names itself** — *"Cursor, Warp, terminal, and Accessibility
settings — chasing down the menu-bar flicker"* — with no genius prompt required.

---

## 3. The architecture findings

### 3.1 The AI tab has two answering systems, and the fragile one is the fallback

`aiService.ts` decides per question (`shouldUseRouter`) between:
- a **deterministic resolver** (`routeInsightsQuestion`, `insightsQueryRouter.ts`) — the app
  fetches facts, the model phrases them. This is what `ai.md` §4 mandates and it's the good
  path.
- an **agentic tool-loop** (`anthropicTools`/`executeTool`, the 9 JSON-schema tools:
  `getDaySummary`, `getAppUsage`, `searchSessions`, `getBlockAtTime`, …) where the *model*
  orchestrates tool calls.

When the router doesn't recognize a question, it falls through to the tool-loop — and the
tool-loop is the thing that begs *"could you share the getDaySummary output again?"* The most
important question in the app, "what did I work on today," lands in the fragile path.

The irony worth remembering: we keep saying *never build a fallback, reinvent instead.* **The
app's number-one bug is a fallback.** The reinvention is already written down (`ai.md` §4:
resolver-first, always). The move is to delete the agentic path, not patch it.

### 3.2 MCP is a side feature, not the engine

`mcpServer.ts` spawns a subprocess so *external* clients (Claude Desktop, Cursor) can query the
DB. It's `mcpServerEnabled: false` by default and has nothing to do with how the AI tab answers
questions. For the problems we're fixing, it's a distraction — park it.

### 3.3 The complexity is real and it's a tax

- **Five overlapping notions of "a block"** in the schema: `timeline_blocks`, `derived_blocks`,
  `work_sessions`, `activity_segments`, `app_sessions`. 60+ tables total.
- **Giant files**: `aiService.ts` ~6,100 lines, `workBlocks.ts` ~5,556, `insightsQueryRouter.ts`
  ~2,795. The old block engine (`workBlocks.ts`) is the ~5,000 lines of rules that produced 53
  blocks for an 8-block day (see `docs/adr/0001`).

Every change pays a tax to this. Simplifying toward **one evidence object per block, read by
every surface** is the through-line that pays it back.

---

## 4. On scale — 2 years, yearly recaps, context windows

The honest answer: this is the *same* principle as resolver-first, stretched across time, and
the spec already points at it. You never put a year of events in a context window.

- **Hierarchical rollups.** A day finalizes into a **frozen snapshot**; a week sums seven
  frozen days; a month sums weeks; a year sums months (`briefs-wraps.md` §6.1). A yearly
  Wrapped reads ~12 small summaries, not millions of events. The bones already exist:
  `daily_entity_rollups`, `ai_surface_summaries`, `daily_memory_archive`.
- **Retrieval, not context, for recall.** "That link about aliens from last March" is a
  search problem. The FTS tables already exist: `website_visits_fts`, `app_sessions_fts`,
  `artifacts_fts`. That's our RAG.
- **Sparse attention is not our problem.** It's a model-internal concern. Our job, at one day
  or two years, is to hand the model only the handful of facts a question needs.

Same rule at every scale: resolve a small, true set of facts, then let the model phrase them.

---

## 5. What this means for the build

The foundation isn't the Timeline UI or the AI prompt. It's: **capture the truth (window
titles, every browser, files), resolve one clean evidence object per block, and let every
surface — Timeline, Apps, AI, Wraps — read from that one object.** One honest source, three
views. Everything we're frustrated by is downstream of that source being empty or wrong.

Recommended order — fix the eyes before the brain:

1. **Capture/permission.** Confirm and repair window-title + screen-recording capture so
   segments actually carry content.
2. **Browser detection.** Replace the name regex with real detection (URL-handler / Info.plist),
   so Zen and the next unknown browser work without a code change.
3. **Evidence object.** Rebuild the per-block evidence to include the page titles, window
   titles, and files we capture — one object every surface reads.
4. **Resolver-first AI.** Delete the agentic tool-loop; route every question through the
   deterministic resolver per `ai.md` §4.

Once a block carries real evidence, naming, merging, the Apps view, and the AI tab all get
dramatically easier — and each is provable on a real day's data.

---

## 6. Still to verify / decide

- **macOS permission state** for Daylens (Accessibility + Screen Recording) — read-only check,
  do first. Tells us if §2.1's zero-titles is a revoked permission (fixable now) or deeper.
- **Are `raw_window_sessions` / `browser_context_events` dead tables?** Both 0 rows. Keep or cut.
- **Resolver-first teardown** — confirmed direction? It means deleting working code (the tool
  path), not patching it.
- **The unknown-intent rule.** When the engine genuinely can't tell, what shows? Proposal:
  name from whatever evidence exists ("Cursor, Warp, and terminal — likely focused work"),
  never the word "Uncategorized," never a guessed title, never begging the user.

---

## 7. How to reproduce this

The DB is at `~/Library/Application Support/DaylensWindows/daylens.sqlite` (open
`-readonly`; it's live with an active WAL). Today's blocks:

```sql
SELECT id, time(start_time/1000,'unixepoch','localtime'),
       time(end_time/1000,'unixepoch','localtime'),
       dominant_category, label_current, label_source
FROM timeline_blocks WHERE date='2026-06-20' AND invalidated_at IS NULL ORDER BY start_time;
```

The evidence a block was named from is `timeline_blocks.evidence_summary_json`. The real
content for a time window lives in `website_visits` (page_title, url) and `activity_segments`
(window_title, domain, file_path). Compare the two and the starvation is obvious.

---

*Companion to the behavior specs in `docs/specs/`. Prior art on how other trackers solved
this (Rize, Toggl, StayFree) lives in `docs/research/prior-art.md`.*

---

# 2026-06-25 — the day still came out wrong: blocks, then names, then capture

**Status:** Fixed + tested · **Source:** live `daylens.sqlite` + code read

Testing the daily wrap on June 25 turned up a chain of bugs, and the lesson from June 20
repeated: the symptom showed at the top (the wrap "felt flat, made no sense") but the bug was
always at the bottom. We fixed bottom-up — capture, then blocks, then names — and pinned each
fix with a test. The wrap mostly fixed itself once the blocks and names underneath it were
right, because it reads the same data.

## The phantom 2am day

The wrap said the day ran "1:56am to 1:09pm" and that "1h 47m landed in the morning." Neither
was true; the first real session was 9:41am. The cause: a 24-second glance at Claude at 1:56am
(real — the user woke briefly) was a sub-15-minute sliver, and `enforceMinimumBlockFloor` folded
every sliver into its nearest neighbour with no gap check. So the blip folded across an 8-hour
sleep gap into the 9:41am block, making one 11-hour block that started at 2am.

Fix: a sliver only folds across a gap under 30 minutes (`TIMELINE_SLIVER_FOLD_MAX_GAP_MS`); a
sliver isolated by a bigger gap, when the day has a real block elsewhere, is dropped as noise.
(`workBlocks.ts` → `enforceMinimumBlockFloor`; test `tests/timelineSegmentation.test.ts`.)

## The "Away 3h 47m" bar before the day began

The overnight sleep (Mac `suspend` 5:53am → `resume` 9:41am in `activity_state_events`) was
drawn as an "Away" bar above the first block. The day starts when you start. Fix:
`buildSegmentsForDay` never renders a gap before the first real block.

## Today split into named blocks on its own

Per `timeline.md` §4, today stays ONE provisional "Active now" block until the user clicks
Analyze. It was showing named blocks. This was **not** a background job — we traced every path:
startup finalizes yesterday only and explicitly skips today, `reprojectStaleDays` skips today,
the tracking loop never materializes, quit only syncs. It was the user's own "Re-analyze with
AI" click, which is the analyze action. Separately, the provisional builder anchored the one
block at the 1:56am blip. Fix: `buildProvisionalLiveBlocks` drops leading noise so the live
block starts at real activity; the gate is unchanged. (test `tests/provisionalLiveDay.test.ts`.)

## Names: "daylens", "AGENT", an article title

Blocks were named after raw machine identifiers — the repo (`daylens`), a SCREAMING file stem
(`AGENT`, from `AGENT-EXECUTION-PLAN.md`), and a web article's title. Fix:
`looksLikeRawArtifactLabel` (`src/shared/blockLabel.ts`) rejects SCREAMING / SCREAMING-KEBAB
stems, with or without a file extension, from block names and summaries, falling back to an
evidence-based name. It deliberately does **not** reject ordinary filenames, paths, or repo
names — those are the existing label design, pinned by the `blockOwnership` and
`workBlockSplitting` tests. Turning a filename or repo into a human "verb + object" name is the
AI naming path (§3.5 tier 2), which already exists behind "Re-analyze with AI"; making it run
without a manual click and tuning its prompt is the next quality lever, not a deterministic
patch.

## The class that vanished

A 2-hour Google Meet class showed as ~3 minutes. Input-based idle detection flushed the session
as "away" after 5 minutes with no keystrokes — right for an empty desk, wrong for a class you
are watching. Fix: `src/main/lib/passivePresence.ts` holds a session open through no-input idle
when it is a watched video, a live call, or an online class (native meeting apps by category;
browser Meet/Zoom/Teams by window title), with guards so "team meeting notes.md" stays active
work. This affects future capture only — a class already truncated in the DB can't be recovered
— and a genuine walk-away still ends the session on screen sleep/lock.

## Still open

- **AI block naming quality.** The path exists; it needs to run without a manual click and the
  prompt needs tuning so names read as "Redesigning onboarding", not "daylens".
- **Wrapped persistence.** Persist a generated wrap and show it on open instead of regenerating;
  propagate the naming/voice fixes to week/month/year.
- **Span vs active time.** A block's drawn span still disagrees with its active time when an
  untracked passive stretch sits inside it; the passive-capture fix narrows this going forward.

---

# 2026-07-02 — chat memory, composer, and suggestions

**Status:** Fixed + regression-tested · **Source:** live `daylens.sqlite`, screenshots, and code read

## Memory was replacing the answer

`sendMessageInner` treated a memory proposal as a complete answer. Once
`maybeHandleMemoryInstruction` returned a preview card, the function persisted that card and
returned before the normal plan → resolve → phrase path ran. Confirming the card only committed
the database write, so there was no answer left to deliver. Memory proposals now decorate the
normal completed answer as action widgets. The write remains confirm-first, but it cannot
terminate the response.

The repeated banner had a second cause: every day/range answer called
`proposeUnstoredMemoryFact`, so ordinary questions could append an evidence-derived “remember
that?” nudge. That path is gone. A preview now requires an explicit memory command or a narrow,
high-confidence durable statement such as a name, role, recurring fact, correction, or stated
preference. “Help me remember what I worked on” is treated as a product request, not a fact.

## The composer disabled its own editing surface

`AICompose` set `contentEditable={!loading}` and dimmed the whole input while a turn was in
flight. The editor is now always content-editable; only sending another turn waits for the
current one. The draft stays DOM-owned, so streaming updates do not disturb typing or cursor
selection.

The misplaced caret came from rendering placeholder text with `.dl-composer::before` inside the
contenteditable element. Chromium can position its native caret after generated pseudo-content,
even though typed text starts at the left edge. The placeholder is now a pointer-free sibling
overlay, leaving the editable element genuinely empty and the caret at the real insertion point
on macOS and Windows.

## Empty-chat suggestions were static

The empty state used four hardcoded prompts. Follow-up suggestions already used a metered model
call, and live `ai_usage_events` rows proved their input/output tokens were recorded, but Settings
grouped `chat_followup_suggestions` into “AI chat.” Empty-chat suggestions now come from recent
real user queries, pass an anchor check against those queries, and use the cheapest model for the
selected provider (Claude Haiku 4.5 for Anthropic). Both starter and follow-up calls remain fully
metered and appear as **Suggestions** in Settings usage.

---

# 2026-07-02 — the calendar day was wrong three layers down: noise, ids, and a loop guard

**Status:** Fixed + regression-tested · **Source:** live `daylens.sqlite` (July 1) + code read

Testing the new calendar timeline on July 1 showed three engine bugs, each traced to a real
row before touching code. All three fixes are pinned by tests.

## A 9-hour "Uncategorized long idle period" owned the morning

`timeline_blocks` for July 1 opened with a 594-minute block (12:23 AM – 10:17 AM) whose top
evidence was **loginwindow, 8h 57m**. Cause: past days rebuild from `derived_sessions`
(`getDerivedDayTimelinePayload`), and that read path never applied the shared system-noise
policy — only the `app_sessions` reader (`getSessionsForRange` → `isUxNoise`) filtered it. The
overnight lock screen became the day's biggest "activity" (invariant 11 broken). Fix: the
derived path now filters `isSystemNoiseApp` (`src/main/core/query/projections.ts`), and
SecurityAgent/SecurityAgentHelper joined the shared noise list. Rebuilt against a sandbox copy
of the live DB, July 1 now starts at 9:21 AM where the real day started.

## "Merge works half the time" — session ids live in two namespaces

A merge correction is keyed by the two session ids straddling the boundary. Today those are
`app_sessions` ids (~47k); a settled past day re-reads through `derived_sessions` ids (~440k),
and derived ids churn on every reprojection. A merge recorded in one namespace can never match
in the other, so user merges silently unraveled on the next rebuild — exactly "works half the
time". Fix: corrections now also store the merged span's wall-clock range
(`span_start_ms`/`span_end_ms`, migration 41), and the boundary scorer erases any proposed
boundary whose junction falls inside a user-fused span, whatever ids the sessions carry.
Test: `workBlockSplitting` "survives even when session ids change namespace".

## 12-second blocks reached the screen — the floor pass exited early

July 1 persisted two sub-minute blocks at 18:55. `enforceMinimumBlockFloor` folds one sliver
per outer-loop pass, but the loop guard was bounded by the *shrinking* `result.length`, so a
fragmented day ran out of iterations before running out of slivers. Fix: bound by the original
count (N candidates can need up to N-1 folds). Test: timelineSegmentation "a heavily
fragmented day leaves no sub-floor blocks behind".

## Founder decision recorded: the 45-minute session break

One block = one sitting. Away under 45 minutes (coffee, a call, a lull) stays INSIDE the same
continuous block; away 45+ minutes ends it. `IDLE_GAP_THRESHOLD_MS`, the same-work bridge, and
the sliver-fold gap all sit on 45m now; block span ceilings rose to 3h/5h/6h so a real
afternoon reads as one calendar block, not slices. Heuristic bumped to `timeline-v8` —
unprocessed past days rebuild on revisit; AI/user-processed days are kept (re-analyze to adopt
the new shape).

---

# 2026-07-02 — empty chat failures were hidden, and null selection meant two things

**Status:** Fixed + regression-tested · **Source:** live `ai_usage_events` + built-app run

The missing starter questions were not an Anthropic outage: live usage showed successful
Claude Haiku 4.5 suggestion calls. The empty-chat effect required a narrow combination of
thread hydration, history, and null selection, then converted every provider or parse failure
to `[]`. It now runs for an explicit new-chat draft, returns structured label/full-prompt
suggestions, and falls back to recent real queries with a visible status instead of blank UI.

The new-chat snapback had the same overloaded null at its root. `activeThreadId === null`
meant both “the user intentionally opened a new draft” and “no thread has been adopted yet.”
Any background list refresh could therefore adopt the previous conversation. New-draft state
is now explicit; thread refreshes are tied to the navigation version that started them, so a
stale refresh cannot replace the draft.

Historical answers can still contain the retired inline “remember that” nudge even after the
generator stops producing it. The renderer now strips that exact legacy tail on history load
and on newly completed answers; memory consent remains exclusively in the action widget.

---

# 2026-07-02 — the whole-day provisional block conflated engagement with elapsed clock

**Status:** Fixed + regression-tested · **Source:** live `DaylensWindows/daylens.sqlite` + engine run

The "12:00 AM – 10:54 AM" card was not an idle-detection failure — it was
`buildProvisionalLiveBlocks` bundling the entire live day into ONE block whose span covered
every gap between sittings, including a 5½-hour sleep. The spec's own §4 ("breaks where idle
15+ minutes") was never implemented on the live path. The provisional day is now one neutral
block per continuous sitting ("Active now" for the live sitting, "Earlier today" for finished
ones), split at real gaps. Test: workBlockSplitting "the live day is one provisional block
per sitting until it is analyzed".

## Founder decision recorded: the 15-minute session break (supersedes 45)

A real activity gap of ~15+ minutes ends the block — never absorbed, never a detour, never
tracked time; it renders as blank space sized by the clock. `IDLE_GAP_THRESHOLD_MS`, the
same-work bridge, the sliver-fold cap, and the visible-gap floor all sit on 15m now.
Heuristic bumped to `timeline-v9` — unprocessed past days rebuild on revisit; AI/user-
processed days are kept (Re-analyze to adopt the new shape). Day ownership deliberately
keeps the wider 45-minute sitting (`dayOwnership.ts`) so a short midnight pause doesn't flip
late-night work to tomorrow; the no-straddle invariant only needs ownership ≥ the block
threshold. The "Idle or away" row is gone from Detours (idle isn't something you were "in"),
and blocks whose span exceeds 6 unbroken hours are flagged in the main-process log instead
of trusted silently. Learning-vs-detour classification deferred to DEV-119.
