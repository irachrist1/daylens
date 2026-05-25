# Daylens AI — Product Direction

**Author:** Tonny, 2026-05-13. Edited from raw feedback after a behavioural harness pass that confirmed the codebase keeps regressing toward "screen-time-tracker v2" behaviour even when `AGENTS.md` and `PRODUCT-SPEC.md` explicitly forbid it.

**Read this before touching any AI code path, harness scenario, or system prompt.** It is short on purpose.

---

## The single sentence

**Daylens AI exists to make sense of the user's work, not to report which apps were open.**

Every other rule below derives from that. If a fix, prompt, scenario, or judge rubric isn't pointed at that goal, drop it.

---

## What "make sense" means, operationally

A good Daylens answer does at least one of:

1. **Names the activity, not just the app.** "Spent 3h doing the Daylens chat-pipeline refactor in Ghostty + Kiro" — not "3h in Ghostty."
2. **Connects the dots over time.** "That's 3h today, on top of 5h last week — 8h on this refactor so far."
3. **Notices a pattern the user didn't ask about but would care about.** "Same pattern as last Tuesday: long Kiro session in the morning, broken by 49 minutes on X around 11am."
4. **Pinpoints to the minute when the user asks for a moment.** "You started at 09:09 and stopped at 09:38 — 29 minutes uninterrupted."
5. **Knows what time it is.** If the user asks about 4pm and it's 11:37am, Daylens says so before answering. Same for future dates, before-tracking-started dates, etc.

A bad Daylens answer reports raw aggregates: "3h in Ghostty, 56m in Dia, 17m in Claude." The user already has that in any default OS screen-time tool. **Shipping that is shipping the wrong product.**

---

## What we are not

- We are not a privacy-first activity logger. **Speed and usefulness beat privacy.** A user installs Daylens because they want it to know what they do. If privacy were their top constraint, they wouldn't install it. Stop building around "Daylens does not capture X." Build around "Daylens needs to capture X to answer that question — here's the cheapest way to do it."
- We are not a screen-time dashboard. Totals are metadata, not answers.
- We are not an LLM wrapper that says "I can't see that." If we don't have the data, **we get the data**, or we surface the closest signal and frame it as the answer — never a bare refusal.

---

## Concrete failure modes from the 2026-05-13 harness (and what each reveals)

| Scenario | What the AI said | Why it's wrong | The right fix |
|---|---|---|---|
| `today_at_4pm` ("What did I do today at 4pm exactly?") | "There's no tracked activity around 4pm today." | The AI doesn't know the current time. It's 11:37am — 4pm hasn't happened yet. | Inject current local time into every system prompt. Detect future-time questions and respond accordingly. A light joke is allowed: "It's 11:37 — 4pm hasn't happened yet. Check in around 5." |
| `time_on_daylens_this_week` | "20h in Dia browser, 11h in Safari, 3h in Ghostty…" | This is exactly the failure mode. App totals as the answer. The user asked about *Daylens*, the project. | The AI must (a) resolve "Daylens" as a project entity, (b) find the work sessions attributed to it, (c) name what was *done* across those sessions (refactor X, debug Y, ship Z), (d) only mention app names as evidence supporting the activity claim. |
| `longest_focus_block_today` | "Approximately 26 minutes in the Kiro development work block." | The block is actually 60 minutes long. The AI invented "26 minutes" and a block label that doesn't exist. | Timeline block durations must be exact. A 30-minute block is 30 minutes — not 2h 1m, not 26m. Verify block math before exposing it to the prompt. |
| `meetings_this_week` | "No meetings categorised. Closest is 30m on rw-andersen.odoo.com." | Misses the "X + Google Meet" block on 2026-05-12 and Granola (a meetings notes app) appearing in sessions. | Treat meeting evidence as: explicit meeting apps + meeting URLs in window titles + meeting-shaped sessions (camera/mic-using apps, long single-window blocks during work hours). Not just `category === 'meetings'`. |
| `deep_work_pattern` | "Let me get the timeline detail for your high-focus days…" | A non-answer. The AI announces an intent and stops. | This is the empty-stop bug. Force a real answer using the data already gathered before exiting the tool loop. |
| `export_status_update` | "Tool call cap reached. Try narrowing the question." | The cap is 5 calls. A "draft a Slack status from this week" question needs ~6-8 lookups. | Bump tool-call cap per question family. Generative questions get 8+. |

---

## The success bar (replaces the harness's current default)

Old bar: "Does the answer match the DB ground truth?" — too narrow. The DB ground truth can be 100% accurate and the answer still useless.

New bar, per scenario:
1. **Imagine a colleague who had been watching the user work all week answering the same question.** Write down what they'd say in 2-4 sentences. That is the gold answer.
2. **Grade the AI against the gold answer, not against the raw DB.** The judge rubric must check: did the AI surface the *activity*, did it *connect* the dots, did it *notice* something useful, did it pinpoint *when*?
3. **A factually-correct answer that doesn't reveal understanding is a fail.** "3h in Cursor" when the truth was "3h finishing the chat pipeline rewrite in Cursor" — fail.

Update `tests/ai-behaviour/judge.ts` and every rubric in `tests/ai-behaviour/scenarios.yaml` to grade against the gold-answer bar, not the data-match bar.

---

## P0 directives (must be addressed in the current and any follow-up pass)

Anything below this line is mandatory direction, not a suggestion.

### D1 — Activity, not app

Every prompt that produces a user-facing answer must demand the *activity* the user was doing. App names are evidence, never the answer.

- Update `CHAT_TOOL_USE_SYSTEM_PROMPT` to forbid "X hours in App Y" as a final sentence shape.
- Update the deterministic router's per-app fallbacks (`durationMatchAnswer`, weekly catch-all, yesterday catch-all) to name what the user was *doing* during the time, derived from block labels + window titles + page refs. If we only have app totals, say so plainly *and* surface the most concrete signal Daylens has for that window.
- Reports, summaries, and follow-up suggestions inherit the same rule.

### D2 — Time awareness

The model must always know the current local date and time. Inject both `Today is YYYY-MM-DD` and `It is currently HH:MM local.` into every system prompt for chat answers.

Handle the four edge cases explicitly:

| Question type | Behaviour |
|---|---|
| Asks about a future moment today | "It's 11:37 — 4pm hasn't happened yet. I'll have data after." (Light tone allowed, no forced humour.) |
| Asks about a future date | "That's in the future. Most recent day with data is X." |
| Asks about a date before tracking started | "Daylens started tracking on YYYY-MM-DD. Closest day I have is X." |
| Asks about a tracking gap | "Daylens wasn't running between A and B. Here's what's nearest." |

`trackingWindowStart` (the earliest `app_sessions.start_time`) must be available to every router and tool path, not just the LLM prompt.

### D3 — Minute-level precision

Block start and end times must round to the actual minute boundary, never to "approximately." If we say "60 minutes," it must *be* 60 minutes. If we say "between 9:09 and 10:08," those times must be exact.

The current bug where a 30-minute block reads as "2h 1m" in the timeline view is a math error somewhere in the renderer or labeller — find it and fix it before anything else lands. (Likely candidate: a `durationSeconds` field being summed across sessions instead of being measured from block boundary.)

### D4 — Never refuse with "I don't know"

This was partially handled in the previous pass (`voiceContract.ts` and `citationFallback` were rewritten to surface evidence instead of refusing). Keep extending. The principle:

- If the user asks about something Daylens doesn't currently capture, name the *closest captured signal* and answer from that. Not "I can't see file contents" — instead, "Your Word window title was 'Q2 plan — final draft.docx' for 47 minutes Monday morning."
- If the user asks about a date out of the tracking window, see D2.
- If the user asks about a known-broken entity (no clients exist), name what *is* available (window titles, work sessions even if unattributed).

The phrase "I don't know" and "I can't see that" are banned outputs. The phrase "Here's what Daylens captured" is the replacement frame.

### D5 — App view is a context view, not a totals view

Per `PRODUCT-SPEC.md` §II. Apps:
- The primary text in each app row is **what was accomplished in it today**, not the app name + minute total.
- Minute totals are secondary metadata.
- The detail panel leads with a 2-3 sentence narrative.
- Grouping is by category of work.

The current Apps view violates all four. It is a roughly 28k-line implementation that re-derives screen-time totals. The brief is to rebuild the view around **what the user did in the app**, not how long they were in it. ~300 lines of focused code beats the current state.

This is a frontend + service refactor, owned outside the AI fix passes — but every AI fix that touches `getAppUsage`, `searchSessions`, or block labels should produce data shaped to enable this view, not data shaped to enable totals.

### D6 — Capture surface is a tradeoff, not a constraint

Privacy is not the priority. **The priority is answering the user's question.**

When a question can't be answered from current capture:
1. Identify what data would answer it (Gmail body, document content, terminal history, file diff, calendar invite text).
2. Identify the cheapest way to capture that data with reasonable opt-in (provider OAuth, local SQLite reads from `~/Library/Messages/chat.db`, filesystem watcher with allowlisted paths, browser extension).
3. Add a roadmap line item. Don't pretend the gap doesn't exist.

The current "Daylens does not capture X" list in the system prompt is a *temporary* admission of capability, not a permanent capture contract. It should shrink over time.

Specific captures to add to the roadmap (in priority order, based on Tonny's actual workflow):
1. **Window title context enrichment** for VS Code / Cursor / Kiro / Excel — currently many sessions have null titles. Investigate why; fix the tracker if there's an OS-level approach.
2. **iMessage local DB** — `~/Library/Messages/chat.db` is plain SQLite, no auth needed, opt-in flag.
3. **Gmail / Outlook / Calendar** — OAuth, scoped read.
4. **Local document indexing** — Notion local cache, Google Docs export, filesystem watcher on allowlisted folders.

### D7 — Common understanding across agents

Any agent (including future LLM passes) working on this codebase must read in this order:
1. `docs/AGENTS.md` — what Daylens is
2. `docs/AI-PRODUCT-DIRECTION.md` (this file) — the philosophy and operational rules
3. `docs/PRODUCT-SPEC.md` — the views and the bar

The user supplies the punch-list of unfinished work per session as part of the prompt; do not look for it in a doc.

If an agent's plan or diff violates any P0 directive in this file, the agent must stop and ask. **No agent ships against the user's first principles.**

---

## Specific bugs to fix while applying these directives

Surfaced during the 2026-05-13 review. None of these are "AI prompt" fixes; they are upstream code bugs whose output the AI then has to lie around.

1. **30-minute block displayed as 2h 1m in the timeline view.** Math bug in renderer or `getTimelineDayPayload`. Trace one offending block end-to-end (`npm run timeline` for the affected date) and fix the root.
2. **Client creation flow missing in the UI.** The AI tells the user to "Settings → Clients" but that path doesn't exist. Either build the flow or remove the suggestion from the AI's vocabulary. The "attribute a work session to a client to create one automatically" mechanism also needs to actually exist, or be removed from the prompt.
3. **`getDaySummary` and `getWeekSummary` return app totals.** They should return *block narratives* with apps as evidence inside each block. The shape change cascades into every chat answer that touches a date.
4. **`routerProsePass` invents details not in its structured input.** The "houses" album hallucination is this. Tighten the prompt or replace with deterministic templating.
5. **Block labels are still being sourced from raw window titles in places.** F2 fixed the AI path; the renderer / Wrapped / weekly brief paths should also be audited for `label_current` reads that should be `userVisibleLabelForBlock(block)` calls.

---

## What this doc replaces

- Any rubric in `tests/ai-behaviour/scenarios.yaml` that grades on data-match without grading on activity-naming, dot-connection, or time-awareness.
- Any system prompt that tells the model "if you can't see it, say so" without the "but surface the closest signal" requirement.

---

## Working agreement for the next agent

1. Read this file before starting.
2. If the user's request conflicts with a P0 directive here, ask first.
3. If you find a directive here that's wrong, surface it — don't silently ignore it.
4. Update this file when a directive is met (move it to a "Shipped" section, don't delete).
5. Use the `grill-with-docs` skill when designing a new feature against this contract.
 