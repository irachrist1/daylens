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

*Companion to the specs in `docs/specs/` and the cross-cutting decisions in
`docs/research/open-questions.md`. Next: study how others solved this (Rize, Toggl, StayFree,
the Raycast v2 rewrite), then update the specs, then cut Linear issues.*
