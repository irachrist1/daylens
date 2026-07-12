# Findings — why Daylens gets the day wrong

**Status:** Investigated · **Date:** 2026-06-20 · **Source:** live `DaylensWindows/daylens.sqlite` (501 MB) + code read

This is the root-cause report behind the issues we saw testing on June 20. Read it before
touching any fix — most of the symptoms are the same disease wearing different costumes, and
fixing a symptom without the cause just moves the bug. Everything here is traced to real rows
in the database or real lines in the code, so it's checkable, not vibes.

The one-line version: **the AI isn't dumb, it's blindfolded.** We've been blaming the brain
for a problem in the eyes.

---

## 2026-07-07 (evening) — Wrapped: ungrounded clock times, spillover framing, tool-brand inversion, export canvas cap

**Status:** Fixed in code · **Source:** founder screenshots of the live Jul 7 wrap +
the stored `wrapped_narratives` row for 2026-07-07.

Four distinct diseases behind "the wrap reads absurd and sometimes outright wrong":

1. **The model garbles clock times and no guard caught it.** The slide kicker said
   "MORNING · 11:15AM TO 12:27PM" while the AI line on the same card said "You started at
   midnight on the Machine Learning Pipeline meeting … until just after 12:30am" (a real
   11am–1pm meeting narrated as midnight; the ask-anything chat then "corrected" itself to
   another wrong time). The validators checked hour totals and percentages but never clock
   times. Fix: `clockTokensIn`/`guardContextTimes` in `wrapNarrativeShared.ts` — any clock
   token (`8:22pm`, `midnight`, `noon`) in a line must appear in that slide's own
   kicker/factsNote or the line dies to its deterministic fallback; question/reflection are
   checked against the whole deck's tokens. Plus a TIME LITERACY block in both prompts and
   the ask prompt ("12:27pm is 27 minutes after noon…", copy times verbatim, no clock math).

2. **Last night's tail framed the day.** A 27-minute sliver just after midnight made the
   headline read "12am to 8:22pm" and the opening "You stayed late into the night". Fix: a
   pre-dawn beat under 45m with a real day after it is marked `spillover` in `buildDayStory`
   (label "Last night's tail"); `mainStartClock` carries the first real beat's clock, the
   headline/prompt frame the day as beginning there, and the spillover slide's ask forbids
   framing it as the day's start.

3. **Tool brands and UI chrome became work subjects.** "designing Claude Code" (the tool he
   was working IN), "building Earlier today" (a relative-time UI string as a project name),
   "the AskUserQuestion feature" (a camelCase code token). Fix: `TOOL_BRAND_NAMES` rejection
   in `workActivityName` (the instrument is never the subject), and `looksLikeRawArtifactLabel`
   now rejects relative-time phrases and lone camelCase identifiers.

4. **Export silently failed on big decks.** One canvas column of 1350px panels exceeds the
   ~32k px browser canvas cap at ~24 slides (any month deck), `toBlob` returns null, no file.
   Fix: `exportGrid` — decks past 12 panels pack two columns; regression test renders a
   30-slide deck.

Also shipped with it: earned-praise policy (praise unbanned; at most ONE celebratory emoji
from a curated set, line-final — `emojiUsageAllowed`), the user's first name allowed on a
couple of slides, seeded shuffle of each deck's middle (`seededShuffle`; stable per
day/anchor, different across days), rotated narrative angles per seed, month decks gain a
busiest-week card and four thread deep-dives, the ask-anything prompt now carries the full
deck outline, and the ask panel no longer covers the slide text (the frame cedes its bottom
while the panel is open).

## 2026-07-07 — Wrapped: leisure counted as work + midnight day-story split

**Status:** Fixed in code · **Source:** live `DaylensWindows/daylens.sqlite`, blocks for
2026-07-06 / 07-03 / 06-27; running-app IPC audit.

Three separate diseases behind "Wrapped is broken":

1. **Stale main process (the ghost).** The `ai:ask-wrapped` handler and the whole deck
   backend existed in source but the running app had an older compiled `dist/main`. That is
   the "No handler registered for 'ai:ask-wrapped'" error and every slide showing its
   deterministic fallback. Fix: rebuild `build:main` + `build:preload` and restart. Not a new
   bug, a build-freshness bug. Always suspect this first when "everything errors."

2. **Leisure stamped as development → counted as work (the real root).** Block
   `2026-07-06 00:00–04:00` was a mostly-YouTube/Netflix night, stored
   `dominant_category=development, block_kind=work`. Cause: `dominantCategoryForBlock`'s
   localhost rule (`workBlocks.ts`) promoted any browsing-base block to `development` whenever
   a `localhost` page was open AND `distribution.development > 0`, with **no share guard**. The
   block had a 262s dev sliver (2.7%) and a `localhost:4321` tab, so a 4h leisure block became
   development → `kind: 'work'` (kind follows `FOCUSED_CATEGORIES.includes(dominantCategory)`).
   The dev evidence (localhost 2055s + dev 262s = 2317s) was actually out-weighed by leisure
   (entertainment 2843 + social 510 = 3353s). Fix: the localhost promotion now requires
   `localhostSeconds + devSeconds >= entertainmentSeconds + socialSeconds`. Regression tests in
   `blockCategoryDominance.test.ts`. **Propagation:** the wrap reads `block.kind` straight from
   the stored `block_kind` (`timelineCalendarRange.ts:112`), so already-stored blocks stay
   wrong until the day is **re-analyzed**; Timeline/Apps/Wrap then correct together (invariant 7).

3. **Midnight split mislabelled the day story.** `buildDayStory` bucketed everything before
   noon as "morning" and labelled the merged beat from its first block's clock, so an overnight
   leftover (00:00) + late-morning class collapsed into one beat reading "Late night · 12am to
   12:27pm". Fix: `dayStory` is now an ordered array of beats with a distinct `lateNight`
   (before 5am) bucket, so a pre-dawn leftover is its own beat and never mislabels the morning.
   Consumers (`wrapDeck.ts`, `wrappedNarrative.ts`, timeline-eval) updated; regression test in
   `dayWrapScenes.test.ts`.

Not-a-bug confirmed: the app/site chart names surfaces by `friendlyDomain(domain)` and
`app.appName`, never raw page titles, so the em-dash/pipe titles in `evidence_summary_json`
(e.g. "SPCS Group — …") cannot leak onto any slide.

## 2026-07-07 — Windows shipping blockers

**Status:** Fixed in code · **Source:** Windows code audit + focused fixtures; live local
`DaylensWindows/daylens.sqlite` only contained `darwin` focus rows, so real Windows capture
still needs manual verification.

- Windows private detection had no structured helper signal. The UIA helper now emits
  `is_private` without URL/title payload, and tracking drops the foreground window before
  creating app sessions or site visits.
- The helper's private detector originally covered only a short Chromium-style browser list;
  Firefox-family browsers already known to the helper must also participate or private
  windows in Waterfox/LibreWolf/Pale Moon/Floorp can be tracked.
- Browser context flushes used `Math.max(endTime, lastSeenAt)`, which defeated backdated
  idle/sleep cutoffs and could store inflated raw `website_visits.duration_sec`. Explicit
  cutoffs now win.
- Windows updater shipping needed two gates: unsigned packaged builds disable built-in
  updates at runtime, and release CI must require a valid Authenticode signer whose subject
  matches packaged updater metadata.

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

---

# 2026-07-02 — the block right-click menu "never appeared": a provisional guard, not an event bug

**Status:** Fixed · **Source:** code read of `Timeline.tsx` `openBlockContextMenu`

Right-clicking a block looked completely broken, but the `contextmenu` wiring was fine.
`openBlockContextMenu` returned early for `block.provisional` — and on a day that hasn't
been through Analyze (i.e. every ordinary live day), EVERY block is provisional, so the
menu could never appear on the blocks a user actually right-clicks. The guard is gone:
the menu opens on any block, and the editor modal itself limits what a provisional block
can change (time edits stay locked until Analyze, since `SET_BLOCK_SPAN` refuses
provisional blocks; title and type stick because they persist as evidence-keyed review
corrections, which survive re-materialization even though provisional block ids don't).

Same session, the floating GCal event-card popover (commit 243418e) was reverted by
founder decision: clicking a block now swaps the persistent right panel to the block's
read-only detail, click-away swaps it back — one `selectedBlockId` state, two mutually
exclusive panel states, nothing floating over the grid. Overlay chrome (context menu,
editor modal, detail panel) is marked `data-timeline-inspector` so the view-root
capture-phase click handler never mistakes clicks inside it for select/deselect intent.

Also new: `db:purge-timeline-block` — the editor modal's Delete block. Unlike the context
menu's Delete (an `ignored` review; raw capture kept), it hard-deletes every tracked row
in the block's span (app sessions, website visits, focus events, derived sessions,
artifact mentions) plus writes the `ignored` review as a backstop for edge-overlapping
sessions. It's the second deliberate exception (after the per-record purge) to "raw
captured activity is never destroyed": full erasure of sensitive stretches.

---

# 2026-07-02 — app time and site time double-counted: two capture streams, no reconciliation

**Status:** Fixed · **Source:** live-day audit of `daylens.sqlite` (Jul 2, 10:00–13:22) + code read of `tracking.ts` / `browserContext.ts` / `browser.ts` / `queries.ts`

The block editor showed Dia at 1h 27m and then x.com, Netflix, Instagram, Meet etc. as
peer rows with their own minutes — but those sites were visited *inside* Dia. Two
independent capture streams write over the same clock time: `app_sessions` gets the
browser's full frontmost stretch (`tracking.ts` `flushCurrent`), while `website_visits`
gets a row per site from two producers (`browserContext.ts` active-tab samples +
`browser.ts` history polls). Nothing ever reconciled them. On the real day the damage
was worse than presentation: history-sourced visits keep accruing while the browser is
in the background or the user is idle, so Dia-hosted site rows summed to 8,820s against
Dia's actual 5,310s of foreground time (a Meet tab "earned" 33m while Warp was focused;
Netflix "played" through idle stretches).

Block duration, category chips, and day totals were never double-counted — they read
`app_sessions` only. The corruption lived in every list that showed app rows and site
rows side by side as if additive (edit modal "Tracked in this block", right panel "What
you were in", plus any AI consumer summing `WebsiteSummary` rows onto app rows).

The model now enforced in `getWebsiteSummariesForRange` (regression-tested in
`tests/websiteTimeReconciliation.test.ts`): **the browser owns the time slot; sites are a
breakdown of that same time.**

1. A visit's minutes clip to when its hosting browser was actually frontmost.
2. Within one browser exactly one tab is active at a time, so visits *partition* the
   browser's time: `active_browser_context` samples claim their seconds first, history
   rows only fill what's left, overlapping same-domain visits union.
3. A visit behind another focused app is a background tab → zero.
4. A visit in a gap covered by an absence signal (idle/away/asleep/paused — the
   `activity_state_events` taxonomy, with `idleSeconds` backdating) → zero: idle time is
   not browsing time.
5. A visit in a truly signal-less gap survives clipped to the gap — a history record
   from when Daylens wasn't looking is real evidence, not a background tab (this keeps
   the Zen-style capture-failure case from findings §2.2 evidence-bearing).

Result on the real day: Dia-hosted site time 8,820s → 5,734s against Dia's 5,255s; the
~8m residual is rule 5 — genuine browsing in signal-less capture gaps, which the app
tracker missed but history saw. The UI now renders sites (and page/file artifacts)
nested under the app they happened in — modal and right panel — so nothing reads as
additive; `WorkContextAppSummary` carries `canonicalAppId` and `WebsiteSummary` already
carried `browserBundleId` for the owner match.

# 2026-07-03 — the timeline-vs-spec audit: five root causes, none where the symptom showed

Two blind investigations (Opus and GPT-5.5, no access to each other's work) traced the
founder's four symptoms end to end against the code and the live DB. Every root cause
sat at least one layer below where the symptom appeared. All five fixed, each with a
regression test in `tests/timelineDivergences.test.ts` / `tests/trackingIdleFsm.test.ts`.

## Post-away sittings vanished: a two-clock mismatch, then a silent discard

A session born on a return-from-away poll was stamped `startTime = Date.now()` at the
detecting poll, but the later away-flush ended it at `provisionalIdleStart` — the true
last-input time from `powerMonitor.getSystemIdleTime()`, up to one poll *earlier*. For a
single-touch return, end < start, and `flushCurrent`'s non-positive-duration guard
discarded the whole session with no row and no log. Meanwhile `focus_events` and
`website_visits` (not gated by that machinery) recorded the sitting fine — which is what
made the DB look like "capture works, blocks don't." Fix: return-born sessions are
stamped at true input time (clamped to the previous flush end), and the flush end clamps
to ≥ start, so short sessions now die only at the explicit 10s floor, logged.
**Founder-pending policy**: a lone wake-touch (~1 input + 120s idle grace) still writes
no row — making those visible means crediting idle-grace on away-escalation.

## The resumed sitting hid for 15 minutes: the analyze-time floor applied to the live view

`buildProvisionalLiveBlocks` dropped any coarse sitting under the 15-minute floor once
the day had one real segment — including the sitting being lived in right now. The floor
is a §3.4 finalize rule; §4 says a provisional block starts when activity resumes.
Reconciliation that keeps both founder decisions: the day's **most recent** sitting is
exempt (appears immediately), earlier finished sittings still need the floor (a 24s
1:56am blip stays dead).

## Sites under the wrong browser: an accumulator keyed by domain alone

`getWebsiteSummariesForRange` collapsed a domain visited in two browsers into one row
owned by whichever visit was read back first (no ORDER BY → rowid order). Attribution of
raw rows was always correct; only the final grouping erased the second browser. Now
keyed `(domain, browser)` with a deterministic ORDER BY.

## Safari history was 100% dark: TCC, not code

`pollWebKit` copies `~/Library/Safari/History.db`, which needs Full Disk Access; FDA was
never requested or checked (only Accessibility + Screen Recording), so `copyFileSync`
threw EPERM into a silent catch — zero `webkit_history` rows ever. The status is now
tracked from the copy outcome and surfaced in Settings' capture health with the
Privacy_AllFiles deep link; the 60s poll retries, so granting FDA heals without restart.

## Page minutes were raw history sums

Domain summaries reconciled against foreground time, but page-level paths
(`getTopPagesForDomains`, `buildPageCandidates`) summed raw `website_visits.duration_sec`
— and Chromium history accrues in the background (56 Dia visits that day before Dia was
ever foreground). Both levels now aggregate the identical per-visit credits from one
`reconcileWebsiteVisits` engine, so page totals equal domain totals by construction.
Still raw: the App Detail browser-profile view (`getDomainSummariesForBrowser` /
`getPageSummariesForBrowser`) — known, small, tracked in `docs/roadmap.md`.

## Also: gap reasons ranked by coverage, and the dead capture layer is gone

`classifyGapRange` let coverage share outrank the spec's asleep > locked > paused >
passive > idle priority (a 60%-idle/40%-asleep gap read "Idle"). And the four
never-written tables from the v14 attribution-first schema (`raw_window_sessions`,
`browser_context_events`, `idle_periods`, `file_activity_events`) are dropped (migration
v42) along with their always-empty readers; `attribution.ts`'s hardcoded browser regex
(missed Dia/Comet/Zen) now uses the app catalog + OS registry like the timeline engine.

# 2026-07-03 — the live-testing fix pass: five symptoms, each rooted a layer below the screen

Two blind investigations (Opus and GPT-5.5) plus a file-mapping pass traced the founder's
five live-testing symptoms (fragmented days, flat detail panel, Leisure mis-tags,
navigation-speak narratives, monotone Week view). Root causes and fixes:

## Fragmented days until "Re-analyze": invariant 3 lived behind a manual click

There was one heuristic block builder, but the AI regroup that merges same-intent
neighbours (`generateDayRegroupPlan` → `mergeTimelineEpisodes`) was called from exactly
one place: the manual Analyze IPC handler. No rollover, consolidation, or startup job
ever merged. DB proof (Jul 2): the automatic path's invalidated generation had 14
artifact-labelled fragments split at every app switch; the founder's manual click
produced the current 6 intent-level blocks. The heuristic genuinely can't do that merge
(it takes AI to see "AI Chat + Joe Rogan video + Template_output" as one intent), so the
fix is not a second merge heuristic: the Analyze body is extracted into one shared
`analyzeTimelineDay` (`services/analyzeDay.ts`) called by both the manual handler and
the automatic finalize hooks (`syncUploader.ts` day-rollover + startup-finalize), gated
by `persistedDayWasProcessed` so tokens are spent at most once per day, falling back
cleanly to heuristic blocks on provider outage. Merges still ride the durable
boundary-correction path, so they survive rebuilds (invariant 8). Regression:
`tests/timelineAutoAnalyze.test.ts`.

## "Active now" pages rendered flat: tab-evidence PageRefs carried no owner

Finalized days nest pages under their browser; the live block's pages come from a
different producer — `buildTabEvidenceFromFocusEvents` (focus_events, because
`website_visits` lags for today) — which never set `ownerBundleId`/`canonicalAppId`, so
the detail panel's `ownerKeyFor` returned undefined and every page fell into the flat
orphan list beside Dia instead of under it. Fixed at both layers: the producer now stamps
owner linkage like `buildPageCandidates` does, and the panel's row-tree construction
(extracted to the pure `renderer/lib/blockDetailRowTree.ts`) falls back to
`browserBundleId`/`canonicalBrowserId` the way site rows always did. Regression:
`tests/blockDetailRowTree.test.ts` asserts nesting depth through the real producer.

## Leisure tag from a background tab: the top artifact overrode the time-weighted base

`dominantCategoryForBlock` ended with `return artifactCategory ?? baseCategory` — the
category of the single largest page artifact beat the block's whole foreground
distribution. Jul 2 proof: `blk_338e5bade088df14` had {aiTools 867s, browsing 39s,
productivity 76s}, zero entertainment app-time, yet a Netflix page (1051s of raw dwell,
accruing in the background) sat at topArtifacts[0] and flipped the block to
entertainment → "Leisure". The asymmetry: Notion pages carried no artifact category at
all (null), so intentional SaaS work could never defend itself. Invariant 6 is now
enforced: an entertainment/social artifact may refine a non-focused base but never
overrides a focused base unless the artifact is a strict majority AND focused work is a
minority; Notion/Google Docs/Linear/Coda/Quip pages now carry `productivity` weight.
Regression: `tests/blockCategoryDominance.test.ts` (uses the real blk_338 shape).

Follow-up peer review found two edge cases in that fix: communication/email/meetings
are work intent even though they are not focused categories, and exact work/leisure
ties must not go to the leisure artifact. The finalized rule now protects a
communication-dominant work block from a high-dwell X/Netflix tab, protects split
focused work even when communication is the plurality category, and only lets leisure
win when it is strictly stronger than total work intent. Browser apps are also
normalized back to `browsing` when loading stored evidence, so stale Dia/Safari/Chrome
categories cannot leak into the Apps rail or block detail. Added regressions to
`tests/blockCategoryDominance.test.ts` and `tests/captureFoundation.test.ts`.

## Narratives described navigation: evidence titles were ranked by dwell alone

The generator already received page titles — but one per domain, the longest-dwelt,
which for Notion is always a hub. Jul 2 evening block: "Notes | All Notes | Notion" 649s
became the topTitle while "AI Training Session | Notion" (12s) and "Andersen AI Training
— Level 3" (9s) — the actual work, navigated through quickly — never reached the prompt.
`getWebsiteSummariesForRange` and `getTopPagesForDomains` now prefer specific titles
over generic index/hub titles (deduped per title), and `workBlockPrompt` names the site
("in Notion") over the browser ("in Dia"). Input enrichment only — invariant 5 stands.
Regression: `tests/blockEvidenceTitleSelection.test.ts` (uses the real dwell shape).

## Week view "one color": not a color bug — the category bug wearing a different shirt

Day and Week share `CalendarBlockCard` → `activityColorForCategory`, and the founder's
Settings overrides were persisted and loaded. The week looked monotone because
`dominant_category` collapsed almost every block to aiTools/browsing (violet) or
entertainment (slate + dimmed) — the artifact-override bug above. One genuine hardcoded
palette did exist: Wrapped's `wrapKit.tsx` `CAT_COLOR`, now deleted in favor of the
shared Settings-aware resolver. Regression: `tests/wrapKitCategoryColor.test.ts`.

Also: `queries.ts` carried two literal NUL bytes in a cache-key template string, which
made git treat the whole file as binary; replaced with `\u0000` escapes (identical
semantics), so the file diffs as text again.

# 2026-07-03 — live blocks stayed grey all day: a naming rule leaked into color

**Status:** Fixed + regression-tested

Founder report: blocks on today's timeline never picked up their category color as the
day was built — only after Analyze ran. Root cause was one line, not a missing pipeline:
`buildProvisionalLiveBlocks` (`workBlocks.ts`) already runs every live sitting through the
same `buildBlockFromCandidate` → `dominantCategoryForBlock` heuristic finalized blocks use,
so a provisional block's `dominantCategory` is real and updates as evidence accumulates.
But `CalendarBlockCard` (`Timeline.tsx`) hardcoded `accent = block.provisional ? '#8b93a7' :
activityColorForCategory(...)` — a leftover that conflated timeline.md §4's naming rule
("a live block is never given a derived intent-name") with §3.4 rule 4 ("color coding is
universal ... day grid, week grid, month dots, inspector"). The month-grid dots and the
block detail inspector never had this override and were already coloring live blocks
correctly, which is how the bug hid: two of three surfaces looked right.

Fix: `accent` always reads `activityColorForCategory(block.dominantCategory)`; no
provisional special case. Live block names still stay neutral ("Active now" / "Earlier
today") — only naming is deferred to finalize, never color. A genuinely thin-evidence
sitting still reads as quiet grey on its own, because `dominantCategoryForBlock` falls
back to `uncategorized` (functionally identical to the old hardcoded grey) — so removing
the override changes nothing until a block actually has a category to show. Regression:
`tests/timelineLiveBlockColor.test.ts`.

# 2026-07-05 — $110/week AI bill: a stale production build ran an unkillable relabel loop

**Status:** Root-caused + code path deleted + budget breaker added; founder must replace the installed app

The Usage page attributed 99.8% of a $110/week spend to "Timeline labeling" — 77k
`block_cleanup_relabel` calls in 7 days, all `trigger_source='background'`, cycling the
same three blocks (922/1027/1087 input tokens) every ~10 seconds for hours. Two causes
stacked: (1) the passive background sweeps (`scheduleOvernightCleanup`,
`runHistoryHeuristicUpgrade`) re-queued blocks whose relabel result never made them
ineligible — a weak AI label kept `shouldReanalyzeBlockWithAI` true forever, and
`getTimelineDayPayload` never rematerializes processed days, so the heuristic-upgrade
`while (true)` refetched the same dates endlessly; (2) **the spender was
`/Applications/Daylens.app` v1.0.44 (built Jun 3), a login item listed twice**, which
predates both the Jun 24 `DAYLENS_ENABLE_PASSIVE_AI` fuse and this repo's removal of the
loop's callers, and shares the DaylensWindows DB + API key with the dev build. Calls
stopped at 23:30 Jul 4 — exactly when that process was quit.

Fixes in this tree: deleted the whole dead passive path (cleanup queue, heuristic-upgrade
sweep, `scheduleTimelineAIJobs`, their queries) — the once-per-day auto-analyze in
`syncUploader.ts` (gated by `persistedDayWasProcessed`) is the only background labeling
left — and added a hard daily budget breaker in `executeTextAIJob`
(`BACKGROUND_AI_DAILY_CALL_CAP = 250` background calls/day, counted from
`ai_usage_events`, user/system work never blocked), so any future runaway loop caps at
pennies instead of $30/day. Regression: `tests/backgroundAIBudget.test.ts`.

Lesson: every unattended AI loop needs a spend ceiling *at the execution choke point*,
not in the scheduler — schedulers get forked, stale builds keep running them.

Also from the same audit: `modelPricing.ts` had no entry for Fable/Mythos-class models,
so they fell through to DEFAULT_RATES ($3/$15) — a 3x underestimate at $10/$50. The
in-app Usage totals otherwise reproduce the Anthropic console CSV within ~4% (local-day
vs UTC-day bucketing accounts for the gap). Regression: `tests/usageReport.test.ts`.

## Apps view browser sections: three numbers from two time bases could never agree

The App Detail header counted foreground seconds while "Time by domain" and "Pages
visited" were raw `SUM(duration_sec)` over browser history — which keeps accruing while
the browser sits in the background and double-counts the two capture paths. Commit
4d140aa fixed exactly this for the timeline paths (`reconcileWebsiteVisits`) and named
App Detail the known remaining raw-SUM path; this closes it. `getDomainSummariesForBrowser`
and `getPageSummariesForBrowser` are deleted; `getBrowserActivityBreakdown` reconciles
over the whole range (shared claim pools), then clips credit to the browser's OWN
foreground sessions — so by construction Σ pages = domain, Σ domains = attributed ≤
header, and the difference renders as an explicit "No page recorded" row (invariant 10).
Rounding happens once, at the page level; domains sum their pages' rounded seconds, so
the arithmetic the user can check on screen closes exactly. The UI merges both sections
into one "Where your Xh Ym went" tree (domains expandable into pages); "What you did
there" stays above it as the intent-level lead-in — a different axis that never claimed
to reconcile to domain seconds. Verified against the real DB: Safari Jul 4 = 58m 20s
across 19 domains + 3m 37s no-page = 1h 1m 57s header, exact. Regressions:
`tests/appsTopDomains.test.ts` (reconciliation identities), `tests/appDetailPayload.test.ts`
(overlapping visits claim disjoint slices: 1200s+600s raw → 1200s credited, never 1800s).

# 2026-07-06 — the 16h34m "Active now": sleep is invisible to the tracker FSM

**Status:** Root-caused + fixed + regression-tested (`tests/trackingSleepGap.test.ts`)

Founder report: Daylens tracked the entire night with the laptop closed — "Active now
11:57 PM – 4:31 PM · 16h 34m". Verified in the raw DB before touching code: the live
session (Dia) started 23:57:14; `activity_state_events` shows `idle_start` 03:08:39 then
NOTHING until `unlock_screen`/`resume` at 12:52:33 — **no `suspend` or `lock_screen`
event was written for the lid-close sleep**, and `app_sessions` has zero rows for Jul 6.

The chain: (1) at 03:08 idle crossed the 120s threshold → `provisional_idle`, session
held open; (2) the machine slept ~3 min later, BEFORE idle could reach the 300s away
flush; (3) interval timers freeze during sleep, so nothing ran for 9h44m; (4) on wake,
unlock reset the OS idle counter, the first poll saw idleSec < 120 and treated it as a
"return from provisional idle" — which by design attributes the idle span to the open
session (meant for 2–5 min gaps); (5) same app focused before and after → never flushed.
`poll()` had no wall-clock gap detection at all, and the block/App/AI layers all read the
poisoned span (block spans exceeded raw session sums day after day: Jul 4 12.3h raw →
22.1h of blocks).

Fix, layered so no single unreliable signal is load-bearing:
- **Poll-gap detection is the primary sleep signal**: a >60s hole between two ticks ends
  the open session at the last evidence of activity (`provisionalIdleStart` when already
  idle — the true last-input time — else the last completed tick), flushes browser
  context at the same boundary, and backdates an `away_start` event so website
  reconciliation excludes the hole too (Codex review shaped both the flush boundary and
  the event choice).
- `resume`/`unlock-screen` also cut a still-open session (belt-and-braces; those DID fire
  on Jul 6); `suspend`/`lock-screen` flushes now trim to `provisionalIdleStart` instead
  of crediting the idle tail.
- `recoverPersistedLiveSnapshot` now splits a cross-midnight recovered session into one
  slice per calendar day, same ownership rule as `flushCurrent`'s midnight split.

# 2026-07-06 — every block one color: the browser's catalog category swamped the day

**Status:** Root-caused + fixed + regression-tested (`tests/weightedCategoryDistribution.test.ts`, `tests/domainCategories.test.ts`)

Founder report: activity colors "aren't being applied at all" despite repeated fixes on
the color side. The color plumbing was fine — the CATEGORY underneath was broken: Dia
was cataloged `defaultCategory: aiTools` (and force-mapped to aiTools in
`inferredFocusedCategoryForSession`), and block distributions were computed purely from
per-app session categories, so on a Dia-centric day every block was aiTools → one violet
everywhere. The 2026-07-02 "week view one color" finding was this same bug at a
different altitude; the artifact-override fix treated a symptom.

Fix: block facts now use a **site-weighted distribution**
(`weightedCategoryDistributionFor`): each browser session's seconds split across the
categories of the sites reconciled inside the block (`categoryForDomain` in
`src/shared/domainCategories.ts`: canva→design, youtube→entertainment, claude.ai→aiTools,
github→research…), residual stays `browsing`. Two invariants hold by construction:
Σ distribution = Σ session seconds (visit credit is clipped to the browser's own
foreground sessions — capture-gap credit stays page EVIDENCE only), and background
history rows contribute nothing. Dia is recataloged `browsing`; heuristic bump to
`timeline-v10` makes `refreshStaleBlockCategoryFacts` recompute persisted category facts
(and now `block_kind`, which the month/range readers consume) in place for processed
days — old blocks recolor immediately, labels and boundaries untouched, and a
user-corrected category is never overwritten (Codex review findings #1/#7).

# 2026-07-06 — incognito was tracked: the gate was a title regex Dia never matches

**Status:** Fixed + regression-tested (`tests/incognitoNeverTracked.test.ts`); Dia-specific structured signal still unavailable

Tracking Controls was ON with skip-incognito ON, yet private windows were tracked: the
only detector was `detectIncognitoFromTitle` (a window-title regex) and Dia's private
windows carry no such marker. Worse, the history-DB fallback could attribute incognito
dwell to whatever regular-history row matched the window title.

**Founder decision (2026-07-06): a private/incognito window is never tracked — no
website visit, no app session — regardless of the Tracking Controls master switch.**
Implemented OUTSIDE the opt-in module (whose disabled-passthrough contract and tests are
unchanged): the browser-context sample now runs BEFORE any session is created and
returns a structured `isPrivate` signal — Chromium's AppleScript `mode of front window`
where supported, plus the title fallback applied unconditionally — and a private sample
flushes the open session (`ended_reason: incognito`), records nothing, and never falls
through to browser history. Known limitation, flagged to founder: Dia's AppleScript
dictionary exposes no window mode (verified live), so a Dia private window without a
title marker is still not structurally detectable; revisit when Dia ships one.

# 2026-07-06 — nested site rows rendered flat: a CSS shorthand ate the indent

**Status:** Fixed (one line) + reconciliation footer added (`tests/blockDetailRowTree.test.ts`)

The inspector's row tree WAS nesting (screenshot row order proved children under Dia
with the orphan last) but the indent never rendered: the clickable-row branch spread
`{...baseStyle, padding: 0, paddingLeft: indented ? 34 : 0}` — object-spread dedup keeps
`paddingLeft` at its FIRST key position (from baseStyle), so React applied
`paddingLeft: 34px` BEFORE `padding: 0` and the shorthand reset it. Children rendered
flush-left and read as additive siblings of the browser row. Fix: the indent is a single
`padding` shorthand. Also added the inspector's reconciliation footer: a browser row
whose children fall short of its total gets an explicit "No page recorded" child
(≥60s), so Σ children = parent by construction — same rule the Apps view breakdown
follows (invariant 7).

# 2026-07-06 (evening) — the lost afternoon recovered from focus_events; site durations from the broken build clamped

**Status:** Data repaired in place (scripts preserved in session scratchpad); backup taken pre-repair

When the overnight Dia phantom was discarded (previous session), the real 12:52–18:11
activity went with it: `app_sessions` jumped 03:06 → 18:16 while the founder was
demonstrably active (idle_start/idle_end pairs at 14:30/14:51/…, 78 website visits,
2,833 focus_events in the hole). Recovery: `unlock_screen` at 12:52:33 in
`activity_state_events` fixed the resume boundary; foreground intervals were rebuilt
from `focus_events` (app_activated/window_changed) with poll-equivalent semantics —
sub-5s blips absorbed, same-app runs merged, system-noise/cmux dropped, sub-10s
sessions dropped, provisional idles (<5 min, all verified) held open. 136 sessions /
5.36h inserted with `capture_source='recovery_backfill'`,
`ended_reason='recovered_from_focus_events'` — distinguishable from live capture
forever. Per-app identity/category/is_focused cloned from each app's most recent
production row so the rows are pipeline-consistent.

Same window, second corruption: the broken pre-restart build had kept crediting
wall-clock time to the last-seen tab while non-browser apps were foreground —
`active_browser_context` visits in the hole summed 19,003s against ~10,250s of real
browser foreground (one "ACET" visit claimed 5,386s; the founder was in Excel/Figma).
Each visit was clamped to its overlap with the recovered browser-foreground intervals
(16 updated, 0 deleted): 19,003s → 10,086s ≤ 10,250s. Site time now reconciles with
app time for the day.

# 2026-07-06 (evening) — block colors: the palette was scrambled by activityColorOverrides, not the plumbing

**Status:** Fixed (config reset; backup of old value in the session scratchpad). Requires app restart.

The founder reported categories rendering the same color after the category fix. The
render path is direct and correct (`activityColorForCategory(block.dominantCategory)` →
stripe/border/fill), and `dominant_category` in the DB is varied. The actual cause:
`activityColorOverrides` in `config.json` (written 2026-07-06 01:11, during the previous
session) mapped entertainment/social to `#64748b` — the same slate as the
browsing/research DEFAULT — and moved development to green, browsing to violet. Result:
leisure and browsing genuinely indistinguishable, and nothing rendered its expected
default. Reset to `{}`; defaults now apply (development blue `#3b82f6`, entertainment
red `#ef4444`, browsing slate, writing gold, meetings violet). Note: electron-store
caches in memory — the running app must be restarted before changing any setting or the
old overrides can be rewritten.

# 2026-07-06 (evening) — website nesting: canonical ids missing on both sides of the owner match

**Status:** Fixed in code (read-time backfill, both sides) + verified by simulation over 73 real blocks

Sites render standalone when `ownerKeyFor` (blockDetailRowTree.ts / the edit modal) finds
no app row matching the site's `browserBundleId` OR `canonicalBrowserId`. Two data eras
broke both match keys at once: (1) blocks persisted before `canonicalAppId` was written
into `evidence_summary_json.apps` carry none, and (2) visits/sessions exist under TWO
bundle-id forms per browser (exe path `/Applications/Dia.app/...` until ~Jul 4, real
bundle id after) so the exact-bundle match fails across the era boundary. Simulated the
exact owner-match over every persisted block since Jun 25: **53 orphaned site rows**
(netflix, youtube, claude.ai, x.com … all standalone). Fixes: `normalizeAppSummary-
ForBlockDisplay` backfills `canonicalAppId` via `resolveCanonicalApp` at read;
`getWebsiteSummariesForRange` backfills `canonicalBrowserId` the same way (Comet's
path-form rows had NULL). Re-simulation: 53 → 1 orphan, and the survivor is CORRECT (a
Dia visit inside a block whose only browser app row is Safari — nesting it would lie).

# 2026-07-06 (evening) — full tracking-pipeline audit (poll → flush → visits → reconciliation → UI)

**Status:** Audit record. Items marked FIXED landed in this commit; others are open, ranked.

Read end-to-end: tracking.ts, focusCapture.ts, browserContext.ts, browserRegistry.ts,
attribution.ts, queries.ts (insert/reconcile/summaries), projections (chunk2 read paths),
workBlocks hydration, blockDetailRowTree, Timeline render path.

FIXED in this commit:
1. **Incognito URLs leaked into focus_events** (founder-rule violation). The
   `shouldCaptureFocusEvent` gate only consulted Tracking Controls, which is a strict
   passthrough while the master switch is OFF (the default) — so private-window tab
   events (URL + title) were written to focus_events even though app sessions and
   website visits correctly dropped them. The incognito title check now runs
   unconditionally (`tests/focusCaptureGate.test.ts`).
2. **insertAppSession returned a stale rowid on dedup conflict** (INSERT OR IGNORE +
   unconditional lastInsertRowid): callers logged identity observations and fired
   invalidations for rows that were never inserted. Returns null on conflict now.
3. **reconcileWebsiteVisits could double-credit across a browser's two identity forms**:
   claim pools were keyed by raw `browser_bundle_id`, so path-form and bundle-form
   visits of the SAME browser reconciled in separate pools (same second claimable
   twice), and the foreground lookup honored only one form's sessions. Pools now key on
   canonical id first, and the allowed intervals are the overlap-merged union of every
   identity form's foreground time.
4. **Dev-mode self-capture**: the dev app's exe basename is `Electron`, which passed the
   self-noise gate (`electron.exe` was listed for Windows; bare `electron` was not) —
   the dev Daylens tracked itself as "Electron / development". Added `electron` to
   SELF_NOISE_EXE_NAMES.

OPEN, ranked:
1. (HIGH, from prior audit, still open) macOS ad-hoc updater strips quarantine without
   hash/signature verification.
2. (HIGH, from prior audit, still open) browserContext copies whole browser History DBs
   synchronously on the main process every uncached tab-read fallback.
3. (MEDIUM, reconciliation) Raw `SUM(duration_sec)` over website_visits survives in
   three consumer families and none reconcile against foreground time — they
   double-count the two capture sources (chrome_history + active_browser_context record
   the same seconds) and count background-tab history estimates as real time:
   `getDistractionByMonth/Hour/Domain` (queries.ts), the AI tool domain-time answer
   (aiTools.ts ~457), and workMemoryProfile domain weights (~488). Route them through
   reconcileWebsiteVisits (or per-day getWebsiteSummariesForRange loops).
4. (MEDIUM, honesty) chrome_history durations are estimates (next-visit gap, clamped
   5s–1800s, last row defaults 30s) stored in the same column as measured
   active-tab durations, distinguished only by `source`. Every consumer must know this;
   the three above didn't. Consider a `duration_estimated` flag column.
5. (LOW) `evidence_summary_json` of pre-v10 blocks is stale (no canonicalAppId, old app
   summaries) and is never rebuilt by in-place recolor; read-time backfill (this commit)
   covers nesting, but any future consumer of evidence.apps must expect missing fields.
6. (LOW) Two parallel hydration paths build WorkContextBlock (workBlocks.ts ~4740 and
   ~5630) with subtly different fallbacks (e.g. one fabricates zero-second website rows
   from `evidence.domains` with `browserBundleId: null`). They will drift; extract one.
7. (NOTE) `dominantCategoryForBlock` re-labels an entertainment/social/browsing-dominant
   block to its largest focused sub-category when that clears 30% share (or focused
   work is the majority) — spec'd in timeline.md §3.6; keep in mind when a block's
   color surprises: the category is intent-level, not time-plurality.
8. (NOTE) The 2026-07-06 afternoon hole itself: the pre-restart build's poll loop ran
   (idle events prove it) but never flushed sessions after the sleep gap — that build
   is gone; the sleep-gap flush (fad6cc0) is the fix, and the recovery above repaired
   the data. If another silent hole appears with the CURRENT build, focus_events is the
   ground truth to reconstruct from (see scripts in the 2026-07-06 session scratchpad).

---

# 2026-07-07 (post-midnight) — the night had the same disease as the afternoon, untreated: one 3h06m Dia blob swallowed Cursor's entire day

**Status:** Data repaired in place (scripts in the 2026-07-07 session scratchpad; backup `daylens-backup-pre-night-recovery.sqlite` taken first)

The founder's Screen Time cross-check exposed two numbers the afternoon repair didn't
explain: Dia over-counted by ~1h50m (Daylens 6h04m vs Screen Time 4h13m) and **Cursor
(55m in Screen Time) absent from Daylens entirely**. Both traced to one row: the
00:00–03:06 night window survived only as the single Dia slice
`recoverPersistedLiveSnapshot` cut at midnight from the broken build's never-flushed
live session (row 49042, 11,197s, `ended_reason: recovered_after_restart`). The old
build never flushed on app switch, so the whole night is Dia in `app_sessions` — while
`focus_events` (404 Cursor events across 00:00–03:00) proves the founder alternated
Dia/Cursor/Warp all night. The afternoon recovery (12:52–18:11) never touched this
window. Downstream, every symptom follows: Dia inflated by exactly Cursor+Warp+idle,
Cursor invisible, the block's "No page recorded 3h 5m" residual (Dia wasn't foreground),
and the "Watching YouTube and Netflix / entertainment" misclassification.

Second corruption in the same window, same as the afternoon's: `active_browser_context`
visits summed 46,062s in a 3.1h window — one youtube.com row carried **36,011s (10h)**,
the last tab before sleep credited through the entire lid-closed hole (02:52 → 12:53).

Repair (mirrors the afternoon scripts, poll-equivalent semantics):
- Rebuilt 00:00:00→03:06:39 from focus_events — 112 sessions / 2.77h inserted
  (`capture_source='recovery_backfill'`), blob row 49042 deleted. Unlike the afternoon,
  this window had two idle spans crossing the 300s away threshold (02:39:33→02:47:18,
  02:55:34→03:06:04, from `activity_state_events`); both excised, exactly where
  production would have flushed. Short provisional idles held open, as production does.
- Clamped the window's measured visits to rebuilt browser foreground: 46,062s → 5,231s
  against 5,328s of Dia/Safari foreground (25 updated, 0 deleted; the 10h youtube row → 195s).

Post-repair reconciliation vs Screen Time (Jul 6): Dia 4h18m vs 4h13m, Cursor 54m vs
55m, Claude 1h01m vs 57m, Figma 17m vs 18m, Excel 14m vs 15m, Safari 13m vs 14m — every
app within minutes (Screen Time snapshot predates the last ~15 min of the day; Finder is
Daylens system-noise by design). Night visits ≤ browser foreground by construction.

Founder actions still required (data is fixed; the running app is not):
1. **Restart the dev app.** It has been running since 18:16 — before the 23:33 commit
   (nesting backfill, incognito gate, reconcile fixes) and before the color-override
   reset; electron-store still holds the scrambled palette in memory and could rewrite
   it on any settings change.
2. **Re-analyze July 6.** The persisted AI blocks (esp. "Watching YouTube and Netflix",
   00:00–03:59, entertainment) were built from the blob + uncorrected visits and are
   kept by design for AI-processed days; re-analyze to rebuild from the repaired rows.

Lesson for the audit record: `recoverPersistedLiveSnapshot` faithfully preserves a
poisoned live session — recovery-from-snapshot is only as honest as the session that was
open. When a hole or a phantom is found, check BOTH sides of midnight; the midnight
split cuts one lie into two days' worth.

# 2026-07-07 — pre-shipping audit: security, performance, reconciliation, sweep

**Status:** Fixed + tested · **Source:** codebase audit + live DB verification

A full sweep of every macOS-facing surface after three sessions of tracking fixes.
Codex adversarial review shaped the plan before any code was touched.

## Security: macOS ad-hoc updater verified downloads (highest priority)

The ad-hoc Mac updater downloaded a ZIP from the update feed, verified only byte-count
vs `installSizeBytes`, then a detached bash script `rm -rf`'d the installed app, moved
the staged bundle in, re-signed ad-hoc, and `xattr -cr` stripped quarantine — no hash
or signature verification. A tampered or truncated download would have been swapped in
and its quarantine cleared.

Fix (fail-closed, layered):
1. The update feed (`apps/web/app/api/update-feed/route.ts`) now populates
   `installSha256` from the GitHub release asset `digest` field (GitHub REST returns
   `sha256:<hex>` for all assets since 2025).
2. `RemoteUpdateDescriptor` (`src/shared/updaterReleaseFeed.ts`) carries an optional
   `installSha256`; `normalizeInstallSha256` accepts bare hex or the `sha256:` prefix.
3. `updater.ts` computes SHA-256 of the downloaded file (streaming, `node:crypto`)
   and compares to the descriptor before staging. Mismatch → temp files deleted, error
   state. No digest in the feed → `canAutoInstall = false`: the UI offers only the
   manual download, never auto-install. Install URL must be HTTPS.
4. Before the swap script runs, `stageAdhocMacUpdate` reads the staged bundle's
   `CFBundleIdentifier` via `defaults` and rejects a bundle that doesn't identify as
   Daylens — so a hash-matched zip with the wrong content never reaches the swap.
5. Temp files (download dir + extract dir) are cleaned up on any failure path.

Regression: `tests/updaterReleaseFeed.test.ts` (descriptor validation + hash normalization).

## Performance: browser history reads no longer block the main process

`browser.ts` (60s poll) and `browserContext.ts` (5s poll fallback) both used
`fs.copyFileSync` to copy entire browser History DBs (100s of MB) synchronously on the
Electron main process, stalling the event loop for the whole copy.

Fix:
- **60s poll (`browser.ts`)**: `pollChromium`/`pollFirefox`/`pollWebKit` are now async.
  `copyHistorySnapshot` uses `fsp.copyFile(src, dst, COPYFILE_FICLONE)` — O(1) APFS
  clone when source and tmpdir share a volume, libuv threadpool fallback otherwise.
  A reentrancy guard (`pollInFlight`) prevents overlapping polls from racing cursor
  writes.
- **5s fallback (`browserContext.ts`)**: `copyHistoryDb` uses `COPYFILE_FICLONE_FORCE`
  first (clone-only, O(1) on APFS). When cloning is impossible, only files <64 MB are
  byte-copied; larger files skip the read entirely and the 60s poll backfills. Returns
  `null` on skip so callers short-circuit cleanly.

Site attribution semantics are unchanged — the same SQLite queries run on the same
temp copies; only the copy mechanism changed.

## Reconciliation: three raw-SUM consumers routed through the reconciled engine

The 2026-07-06 audit flagged three consumer families still running raw
`SUM(duration_sec)` over `website_visits` (double-counting the two capture sources
and counting background-tab history estimates as real time):

1. **`getDistractionByMonth/Hour/Domain`** (`queries.ts`): rewrote all three to bucket
   `getReconciledDomainIntervals` credits by month/hour/domain instead of raw SQL SUM.
2. **AI `aggregateSiteUsage`** (`aiTools.ts`): site time now comes from
   `getReconciledDomainIntervals`; visit COUNT stays raw (it's a navigation count, not
   time). Daily breakdown merges reconciled seconds with raw visit counts per day.
3. **`workMemoryProfile` background-site ranking** (`workMemoryProfile.ts`): background
   domain ranking now uses reconciled credits so background-tab accrual can't inflate
   a domain's position.

A new `getReconciledDomainIntervals` export in `queries.ts` chunks by 24h windows so
multi-month ranges stay bounded; visit straddling a chunk boundary is clipped per chunk.

Regression: `tests/aiResolvers.test.ts` updated to seed a Safari session (the reconciler
requires browser foreground to credit site time).

## Sweep fixes: two silent bugs in the attribution and projection paths

1. **`attribution.ts` `loadIdlePeriods`** (MEDIUM): event-type matching used
   `lower === 'lock'` (never matches `lock_screen`), `lower === 'sleep'` (never matches
   `suspend`), `lower === 'unlock'` (never matches `unlock_screen`). Lock/sleep/idle
   periods were not detected in the attribution segmentation path, so activity segments
   weren't sliced around them. Fixed to match the same event types as
   `reconcileWebsiteVisits`: `idle_start`, `lock_screen`, `suspend`, `away_start` →
   start; `idle_end`, `unlock_screen`, `resume`, `away_end` → end.

2. **`chunk2.ts` `IDLE_GAP_MS`** (LOW): was 5 min, but the founder decision (2026-07-02)
   set the block break threshold to 15 min (`IDLE_GAP_THRESHOLD_MS` in `workBlocks.ts`).
   The derived-session projection path split blocks at 5-min gaps while the main engine
   used 15 min, causing past days to show more fragmented blocks. Fixed to 15 min.

## Verified clean (no bugs found)

- **Apps view**: per-app totals, browser site breakdowns, category filters, range
  switching, "Smaller or Fleeting" — all verified against the live DB for 2026-07-06.
- **Timeline**: block colors (no provisional override), gap labels (Asleep/Away/Idle),
  day/week/month shared color resolver, context menu on provisional blocks.
- **Settings**: color overrides, privacy/tracking gates, memory, capture health — all
  persist correctly and read from real data.
- **AI/Insights**: resolver-first, reconciled site time, no raw SUM, shares data path
  with Timeline and Apps.
- **History/Recap**: day totals from app_sessions via blocks, corrections survive
  rebuilds.

---

# 2026-07-07 — Anthropic prompt cache hit rate dropped 80%: not bad, the killing of the $110/wk loop

**Status:** Investigated — not a bug, expected artifact of the fix in 476d17b. Documented
so future agents don't waste time re-learning this.

**Source:** Anthropic Console notification + live `DaylensWindows/daylens.sqlite` query

## What happened

Anthropic Console alerted that prompt cache hit rate dropped 80% vs the previous week. Live
DB query of `ai_usage_events` confirms why:

### Primary cause: the runaway loop was producing artificial cache hits

Before 476d17b, `block_cleanup_relabel` background calls were ~20-45k/day (June 23: 16,344;
July 1: 13,833; July 4: 19,207). After the fix (deleted cleanup queue + 250/day cap): 3-6
calls/day. Total call volume dropped ~99.5%.

The old calls included repeated labeling of the same 3 blocks with identical system prompts
— exactly the pattern where `stable_prefix` caching produces server-side cache hits. Those
hits inflated the hit rate. Now they're gone.

### Secondary: the system prompt gained one line, invalidating one first-call cache

Commit 476d17b added `'  - Name the site or tool where the work happened ("in Notion" ...)'`
to `workBlockPrompt()` (`aiService.ts:3949`). The `stable_prefix` cache is keyed on the
system prompt text, so this line changes the cache key. Every block type gets one cache miss
the first time it runs after the update — minor relative to the loop effect above.

## Deeper finding: prompt caching is effectively not working right now

Querying `ai_usage_events` reveals:

| job_type | calls (30d) | avg input | avg cache_write_tokens | avg cache_read_tokens |
|---|---|---|---|---|
| block_cleanup_relabel | 110,747 | 1,064 | **0.0** | **0.0** |
| block_label_finalize | 18,491 | 1,733 | **0.0** | **0.0** |
| chat_answer | 84 | 1,458 | 230.7 | **0.0** |
| day_summary | 8 | 447 | 5,452.5 | **0.0** |
| report_generation | 8 | 757 | 6,304.4 | **0.0** |

Key signal: **cache_read_tokens is 0 for 100% of rows.** Not one cache read across 130k+
calls. Cache_write_tokens only appears for `chat_answer`, `day_summary`, and
`report_generation` — all jobs whose cached payload (the whole user message via
`repeated_payload`, or a system prompt large enough to cross Anthropic's minimum
threshold) exceeds ~1,024 tokens.

The 110k block-labeling calls (`stable_prefix` policy, system prompt marked with
`cache_control: { type: 'ephemeral' }`) never produce a single cache write or read. Two
likely reasons:

1. **Anthropic's minimum cache threshold.** The block-labeling system prompt
   (`workBlockPrompt(block)`) includes ~15 lines of instructions + per-block evidence.
   Average total input is 1,064 tokens, but the system prompt alone might be under the
   ~1,024-token minimum, causing Anthropic to silently ignore the `cache_control` marker.
2. **The streaming API may not propagate cache metrics.** `stream.finalMessage()` returns
   `Message.usage` which should include `cache_read_input_tokens`, but this SDK version
   (v0.100.1) may not populate them correctly in streaming mode.

Even the jobs that DO write to cache (`day_summary`, `report_generation`) never read back
— suggesting cache entries always expire or get invalidated before the same request repeats.

### Practical impact

- The Anthropic Console alert is **not actionable** — it's an expected side effect of the
  476d17b fix.
- The cache policy definitions in `JOB_DEFINITIONS` (`aiOrchestration.ts:82-228`) are
  aspirational: three of the four heaviest job types (`block_cleanup_relabel`,
  `block_label_finalize`, `chat_answer`) see no cache benefit from `stable_prefix`, and
  the `repeated_payload` jobs (`day_summary`, etc.) write but never read.
- Should Daylens ever need cache savings at scale, `repeated_payload` strategy for
  day/week summaries is the only path that measurably writes to cache. Block-label caching
  via `stable_prefix` would need the system prompt to credibly exceed ~1,024 tokens.

## 2026-07-08 — Wrapped Stage 0: why the wrap's numbers were wrong (audit vs the live DB)

Verified `buildDayWrapFacts` field-by-field against the live database for Jul 5-7. Four root causes, all fixed with regression tests (commit c60d41e + uncommitted renderer follow-ons):

1. **Block kind re-derivation ignored the site-weighted distribution.** `effectiveBlockKind` fell back to a top-5-sites read through the short `workKind.ts` domain allowlist, so a whole browser-based design day (canva.com, localhost, the company's own site) resolved to "personal": Jul 5 read **50m work / 9h37m personal** when the truth was ~9h48m work. Fix: trust the block's own persisted, site-weighted `categoryDistribution` first (it already drives category and color), teach `kindForDomain` to consult `domainCategories`. `tests/workKindDistribution.test.ts` pins the real Jul 5 distribution.
2. **Meetings counted active seconds, not span.** The Jul 7 11:15-12:28 class (73m block) narrated as 49m-1h07m across the deck. Meeting truth is the calendar span; `meetingsSeconds` (day facts) and the new `meetingsSpanSeconds` (day snapshots → period rollup) now use `max(active, span)` per meeting block.
3. **Day-story bucketed blocks by START hour only.** An 11:25am-midnight block became "Morning · 11:25am to 12am" — nine hours of afternoon/evening narrated as morning. Fix: proportional allocation of a block's active seconds across the day-part windows its span covers, with a 15m/dominant-part rule for which parts get to NAME the work.
4. **Naming leaks.** `friendlyDomain('app.intercom.com')` → "App" (the literal chart bar); `us.posthog.com` → "Us"; "✳ Claude Code" dodged the tool-brand guard via its decorative prefix; pipe-joined tab titles ("OC | Apply founder design to chrispin.jpeg") and media filenames passed `looksLikeRawArtifactLabel`; `workActionPhrase` stacked verbs on gerund labels ("building Reviewing work projects"). All five closed with tests.

Also: window titles in `app_sessions` are rich (project names, meeting names, doc titles) and were entirely unused by the wrap — now distilled per app into semantic clusters (`src/shared/windowTitleContext.ts`) and a first-class `titleContext` facts field.

## 2026-07-10 — Wrapped reliability: guard deaths were silent and unrecoverable; meeting-notes had no collector

Two findings from making the benchmark pass reliably on real days (Jul 9 + 10):

1. **A single guard-tripped line meant a permanent fallback slide, with no visibility.**
   `isWrapLineValid` returned a bare boolean, so when the model wrote one ungrounded clock
   ("12:08pm" on a slide whose facts don't list it), that slide silently fell back to the
   deterministic floor and the whole deck failed the all-AI gate — the Jul 10 wildcard
   fallback was exactly this class. Fix at the root, per the approved plan's "verify + at
   most one repair call": every guard rejection now carries a writer-facing reason naming
   the offending value and what was allowed (`wrapLineViolation`), and both the day and
   period pipelines make ONE repair call feeding the model its own rejected lines with
   those reasons; it rewrites exactly the failed pieces, accepted lines are final
   (`mergeWrapRepair` refuses overlays on non-rejected ids). Still-failing pieces fall
   back honestly, per slide. Rejections are logged (`[ai] wrapped_narrative <date>: … →
   repair round: …`) so a fallback is never a mystery again. Tests:
   `tests/wrappedNarrative.test.ts` (repair section).
2. **The meeting-notes read-side is dormant: nothing writes the 'notes' signal.**
   `resolveMeetingNotes` + prompt directives + fingerprint shipped in 0aca70e, but no
   collector produces a `external_signals` row with source `notes`. Granola's local store
   is now encrypted (`granola.db` has no SQLite header; the live cache is
   `cache-v6.json.enc`; the plaintext `cache-v6.json` is a stale stub) — meeting notes are
   NOT locally reachable and need an authenticated connector (P4 MCP work). Honest
   position until then: the wrap narrates meetings from calendar + blocks only.

## 2026-07-10 — Renderer architecture audit: duplicated policy had become separate truth

The renderer's large files were not just verbose. Several copies had independently become
behavioral authorities:

1. **A block edit was three writes, so one Save could partially succeed.** Timeline wrote
   review, label/category override, and time trim through separate IPC calls. A failed trim
   left the earlier corrections committed. `timelineBlockEdits.ts` now validates first and
   commits the full edit in one SQLite transaction; `tests/timelineBlockEditAtomicity.test.ts`
   pins rollback and all-fields success.
2. **Onboarding client names and canonical clients were separate stores.** Onboarding only
   saved `userClients`, while Settings and attribution read `clients`. Onboarding now ensures
   canonical clients, and every client mutation re-syncs the compatibility name list.
3. **Read failures were presented as real emptiness.** Settings and onboarding converted
   failed IPC reads to `[]`, `{}`, `null`, or “unsupported,” making “could not read” look like
   “you have no data.” Section reads are now lazy, retain their last known value, and show an
   explicit load error. Privacy-history deletion also reports a failed cleanup instead of
   silently claiming the exclusion completed.
4. **Category labels, range keys, live totals, work-first ordering, and date navigation had
   competing copies.** They now live in shared contracts (`activityCategories.ts`,
   `appNarrativeContract.ts`, `liveAppSummaries.ts`, `workKind.ts`, and renderer date helpers),
   with contract tests in `tests/rendererSharedContracts.test.ts`.
5. **The Apps read model lived inside the timeline formation engine.** App-range selection,
   artifact ownership, browser reconciliation, and appearance rollups now live in
   `appDetail.ts`. Existing reconciliation and heavy-history tests exercise the extracted
   boundary.
6. **Linux MCP discovery used the macOS Claude Desktop path.** Main-process discovery and
   Settings copy now distinguish macOS, Windows, and Linux. `tests/enrichmentDiscovery.test.ts`
   asserts all three paths.

Load-bearing warning: the browser domain/page reconciliation and “No page recorded” remainder
remain backend-owned and unchanged. Do not move that arithmetic into renderer components; the
existing app-detail reconciliation tests are the minimum gate for edits in that area.

## 2026-07-12 — Timeline correction audit: timestamps and raw read paths overruled the user's truth

The adversarial W1-A review found seven ways an apparently corrected Timeline could still lie:

1. **A positive `end_time` was treated as proof of continuous activity.** Live row 1399 claimed
   Dia from 13:07:44–13:43:24 while `duration_sec` contained only 236 seconds. Because the next
   session began at 13:43:24, the absence guard hid a real 31m44s hole. The guard now treats a
   wall-clock/duration mismatch of at least 15 minutes as absence, using captured duration as the
   evidence boundary.
2. **Splitting the exact block a user corrected changed both its id and evidence key.** Correction
   replay therefore found nothing. Absence repair now transfers the fused block's correction to
   the rebuilt half with greatest time overlap (earlier wins a tie), instead of guessing that both
   disconnected halves necessarily meant the same thing.
3. **Past-day derived projections filtered ignored blocks but calculated header totals from raw
   derived sessions.** `totalSeconds`, `focusSeconds`, and `appCount` now come from corrected
   derived-session pieces.
4. **Deleted spans used session-start membership.** A 09:00–10:00 session with a 09:15–09:45
   deletion kept all 60 minutes; deleting 09:00–09:15 dropped all 60. Ignored spans are now merged
   and subtracted as exact half-open intervals, producing the honest two surviving 15-minute pieces.
5. **Block category corrections stopped at block appearances.** Apps and AI aggregates still used
   the captured session category. The corrected read model now splits session credit at category
   boundaries and attributes each piece to the user's block category.
6. **AI FTS searched raw session titles and raw page titles.** An ignored block's sensitive content
   could still be recalled. Strict and broadened search now remove both session and page hits that
   overlap ignored spans.
7. **Top-site and peak-hours answers bypassed corrected facts.** Site credit now subtracts ignored
   intervals from the reconciled domain ledger, and peak hours bucket corrected session pieces.
   AI, Insights, and IPC callers all route through `activityFacts.ts`.

Regression coverage: `absenceGuard.test.ts`, `timelineAbsenceRepair.test.ts`,
`correctedActivityFacts.test.ts`, `aiResolvers.test.ts`, and `peakHours.test.ts`.
