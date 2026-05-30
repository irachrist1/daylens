# Timeline Intent Model — what Daylens is actually reconstructing

Status: vision + problem definition agreed with the owner 2026-05-30. Early implementation has started: P0 invalidation throttle, P1 relabel unification, and the lower-risk contentless browser sliver absorption are implemented and tested. This is still the north star for anyone touching the timeline, block assembly, evening consolidation, or the second brain. Read it before changing how blocks are drawn or labeled.

## The one sentence

Daylens is an over-the-shoulder partner that reconstructs the day into a small calendar of coherent activities — what you were *actually doing* — assembled with full-day hindsight. It is not a live log of which app was frontmost.

## What "good" looks like (the contract)

- A block is one continuous **intent**, the way a colleague would describe it. "The morning watching videos." "The evening reviewing the codebase architecture with Claude." Not "Safari 9 minutes, GitHub 7 minutes, mixed 34 minutes."
- Short interruptions are **absorbed**, not boundaries. A 2-minute search or a Slack glance in the middle of a video session does not end the video block.
- The same recurring thread is **one block per contiguous span**, named consistently. Watching YouTube from 7:00 to 8:32, a 2-minute detour, then YouTube again to 10:00 is **one** "Watching YouTube" block, not three.
- No tiny block unless a **real gap** separates it (machine off, or idle beyond a threshold). It reads like a calendar, not a fragment log.
- It **reads through tools to the work**. A terminal with typing is "coding on <repo>," not "Ghostty 10m." A browser is the page or task, not "Safari browsing, no titles."
- It distinguishes **attention from ambient**. Video playing while you type in a terminal is "coding," with video as context, not "entertainment."
- It is **discreet**. Sensitive activity is summarized neutrally and never headlined.

## Why it must run in the evening, not live

You cannot name a block until the day is whole. The 9:09pm "Safari browsing 11m" fragment only means something once you can see it sits between two spans of architecture-review work. Live, as-it-happens reconstruction is structurally blind to this, which is why the current timeline fragments. So the model is:

- **Today (live)** = a cheap provisional sketch. Good enough to glance at, never the source of truth.
- **Evening consolidation** = the authority. It re-segments the finalized day into the calendar and is what history shows.

This also resolves the performance work: today should not be expensively rebuilt on every app switch (see [PERF-COHERENCE-MAP.md](PERF-COHERENCE-MAP.md) §4, already throttled), because today is provisional anyway.

## The three hard problems

### 1. Segmentation — "where does a block begin and end"

This is the core problem and the hardest. "Where does a block get to be a block" is the open question.

- Now: `buildBlocksForSessions` (workBlocks.ts) splits on time gaps and app switches. That is what shreds the day. Real example from 2026-05-30: one video activity became three blocks ("Video consumption and quick research," "Video streaming and adult content," "Video streaming and research"); one architecture-review thread became four ("Codebase architecture review," "Engineering skills reference," "Safari browsing," and a live block).
- Target: cluster the day's segments into intents. Merge adjacent and nearby segments that share dominant category + entity + artifacts, absorbing sub-threshold interruptions. A hard boundary is forced only by a real gap.
- This is **full-day clustering, not a streaming gap-splitter**. Hence evening.
- Data: available now (`activity_segments` with class/attention, categories, entities, artifacts). No capture gap.
- The second brain's real job is to learn which app/site/artifact combinations are *one activity for this user*, and drive **merges**, not just labels. Today it only renames.

### 2. Attention — "the video was in the background while I coded"

- Now: block assembly and the focus/drift score use the frontmost app and its hardcoded category. Ambient media that is frontmost counts as the activity; a backgrounded terminal where the real work happens does not. The 2026-05-30 day scored 42 with 4h25m "drift" largely from video that may have been ambient.
- Target: weight by where the input actually was. A window with keystrokes and a high `attention_score` is the activity; a frontmost-but-idle media tab is ambient context.
- Data: **already captured.** `raw_window_sessions` has `is_frontmost`, `keystrokes`, `input_events`, `mouse_events`, `idle_ms`. `activity_segments` has `input_score`, `attention_score`, `idle_ratio`, `class`. The signal exists; segmentation and labeling just do not consume it yet.

### 3. Tool transparency — "it doesn't know Ghostty is a terminal running Claude Code"

- Now: it sees the app (Ghostty, Warp, Codex) and sometimes `window_title`. It cannot read the working directory, the running command, or the repo. Browsers are handled well (URLs, GitHub artifacts captured).
- Target: read through the terminal to the work. cwd + foreground command (claude/codex) + repo gives "Coding on daylens."
- Data: **capture gap.** No `cwd`/`command` columns exist. Needs new terminal introspection (process_id to child process and cwd, macOS-specific). Separate track. Interim approximation: mine `window_title` plus co-occurring repo/browser artifacts.

## Secondary issues visible in the 2026-05-30 screenshots

- Focus/Drift scoring is the static-category problem (`lib/focusScore.ts`). It should follow attention and learned patterns, not a fixed category list. Tracked as P2 in PERF-COHERENCE-MAP.
- Dignity/tone. "Video streaming and adult content … pornography 19m" was headlined in the narrative and in "What Mattered." A partner is discreet. Sensitive categories should be neutralized in labels, kept out of top billing, still counted in totals.

## We are not starting from zero

Already built and reusable: the raw attention capture (`raw_window_sessions`), the `activity_segments` layer with attention scores, the attribution pipeline (clients/projects), the work-memory pattern engine (`workMemory.ts`), and evening consolidation (`eveningConsolidation.ts`, today only promotes patterns and backfills labels — it must grow to re-segment). The gap is wiring these into segmentation and making evening the authority.

## Phased build

- **Phase 0 — enabler.** Extract the pure block-assembly out of `workBlocks.ts` into a testable module (sessions/segments in, candidate blocks out, no DB/AI). This is report item 4. Lets us iterate segmentation under tests.
- **Phase 1 — segmentation.** NOT a rewrite. Pipeline: `coarseSegmentsFromSessions` (15-min idle boundary, correct) → `analyzeSessions`/`normalizeTimelineCandidates` → `coalesceTimelineCandidates` (soft-merge, absorb short, bridge same-work) → `bridgeSameWorkCandidates` → `buildBlockFromCandidate` → label (`buildBlocksForSessions`). Regression harness landed: `tests/timelineSegmentation.test.ts` (exercises `buildTimelineBlocksFromSessions` on an in-memory DB; pins the guards).
  - **CORRECTED MECHANISM (verified 2026-05-30).** The earlier "merge window 5<15" hypothesis is WRONG and was reverted after the fixture proved it inert. Reason: `analyzeSessions` splits candidates on **content-context and category shifts, NOT on time gaps** (gap-splitting only happens above the 120-min ceiling, in `normalizeTimelineCandidates`). So candidates reaching `shouldSoftMerge` are already near-contiguous (~0 gap); the 5-vs-15-min gate almost never fires. Same-category/assisted-pair work is already kept whole (`isDeveloperTestingFlow`, coherence). Widening `TIMELINE_SPLIT_GAP_THRESHOLD_MS` changes nothing observable.
  - **The real driver of the owner's fragmentation** is content-context/category splitting that `coalesceTimelineCandidates` then refuses to rejoin, in two shapes:
    1. **Topic-sensitive different content context.** `shouldSoftMerge:1827-1832` / `candidatesRelated:1846-1850` require a shared top app AND equal `dominantContentContext` (the window title). Two research stretches on different GitHub repos of the *same project* have different titles → stay split. Fix needs a **project/entity** signal (second brain / attribution / shared artifact path) so "same project, different files/pages" merges while "distinct topics" stays apart. This is the substantive change and needs the entity signal; do not loosen the content-context guard blindly (it exists to keep distinct browsing topics separate — pinned by the fixture's "two distinct browsing topics stay separate" test).
    2. **Contentless browser slivers — DONE (2026-05-30).** A sub-30-min browser-only browsing block with no useful window titles and no page artifacts (the real "Safari browsing 9:09–9:21, no specific window titles" fragment) was not "related" to its neighbours across category, so `absorbShortCandidates` (requireRelated=true) left it standing alone. Fix: `candidateIsContentlessBrowserSliver` drops the relatedness gate only for that narrow case: the candidate must sit between two non-meeting neighbours, carry no title/page evidence, and remain under the existing gap-boundary/span-ceiling guards. It attaches to the nearest eligible neighbour by gap, not by same-category preference. Regression: `tests/timelineSegmentation.test.ts` "contentless browsing sliver between work stretches is absorbed" (3 blocks → 1), plus guards for nearest-neighbour selection, page artifacts, non-browser titleless activity, and edge browser blocks.
  - The 120-min `TIMELINE_MAX_BLOCK_SPAN_MS` ceiling splits a >2h single activity (the fixture's 3h-video case hit this). OPEN: should a true calendar allow a single coherent activity to exceed 2h? Owner decision pending.
  - Run the reshaped assembler as the evening authority; today stays provisional.
- **Phase 2 — attention.** Feed `keystrokes`/`attention_score`/`is_frontmost` into segmentation and labeling so ambient media stops masquerading as the activity. Fix focus/drift to follow attention.
- **Phase 3 — tool transparency.** Add terminal capture (cwd/command/repo) and an attribution rule: terminal + repo → coding on <repo>.
- **Cross-cutting.** Second brain drives merges and naming, not just naming. Dignity pass on narratives. Provider seam refactor (report item 1) is unrelated but now urgent after the hand-edited OpenRouter switch.

## Design decisions (owner, 2026-05-30) — locked

- **Hard boundary = idle/off ≥ 15 min.** A new block starts only after the machine was off or the user was idle/away for 15+ minutes. Everything in between is merged by intent. Short interruptions are absorbed.
- **Distant same-intent spans stay separate, named consistently.** YouTube in the morning and again at night are two blocks at their real times, both named "Watching YouTube." The timeline stays a truthful chronological calendar; near spans (within the 15-min rule) merge, distant ones do not.
- **Sensitive content is a user-controlled privacy feature, not a label tweak.** This is its own track:
  - The user defines a private list (sites/apps, e.g. pornhub.com).
  - Two modes per entry: (a) **never tracked** — excluded from capture entirely, or (b) **vault** — tracked but locked behind a password; only the unlocked user sees time spent there.
  - Default-private categories (adult) should prompt the user to choose a mode rather than silently logging and headlining them.
  - Implications: capture-layer exclusion (mode a), an encrypted/locked store + auth gate for the vault (mode b), and settings UI to manage the list. Totals: a vault entry counts in private totals only; a never-tracked entry never exists. Spec this separately before building; it touches capture, storage, and settings.
