# AI — build spec

## 1. What the AI tab is

The simplest thing in the world. You ask **"What did I work on today?"** and you get a
calm, specific answer with real times and real activities — like a sharp assistant who
watched your day and can give you a straight answer.

The screen is a chat. A sidebar on the left holds your past conversations; the main area
holds the current one, with the input pinned at the bottom. You type a question, you get an
answer grounded in what you actually did.

It reads from the **same blocks and threads** as the Timeline and the Apps view. If the
Timeline says 3 hours of network work, the AI says the same. One truth, three views.

The one architectural rule that makes this work, and that everything else depends on:
**every claim traces to real data a tool returned.** The AI reads the world through
read-only tools that answer with real rows or an explicit miss; it never invents a row
and never fills a gap with a guess. This is non-negotiable — section 4 is how.

## 2. What's broken now and how it should work

The current tab looks right and works almost nowhere.

- **"What did I work on today?" completely fails.** It answers with *"I don't have the
  tool results… could you share the getDaySummary output again?"* — it asks the user to do
  the app's job. That is the one question the whole app exists to answer, and it can't.
  The response is a wall of text with no structure.
- **The week path half-works.** Ask about the last 7 days and it returns a real per-day
  HH:MM breakdown — so the data layer can fetch ranges. But it hands you walls of text
  instead of tables. Ask for more detail and you get bullets, still no tables.
- **No project attribution.** It says *"No projects attributed in Daylens yet"* and stops
  there, offering nothing.
- **The transforms refuse to run.** "Turn into bullets," "shorter," "checklist," "report"
  live in a dropdown but fail with *"this is a data request, not a summary"* — because the
  base answer is already broken, there's nothing valid to transform.
- **The voice is wrong.** Apologetic, meta, uncertain: *"I apologize, I don't have access
  to…"*, *"based on the available data, it appears that…"*. The opposite of what we want.
- **Chat history vanishes.** Switch from Apps back to AI and five conversations disappear.
  The sidebar also shows duplicates — *"Last 7 days by project"* listed twice under the
  same day.
- **Switching chats mid-generation breaks everything.** Empty chat area, sidebar gone,
  input disabled, no way back without refreshing the whole app.
- **The Settings model is ignored.** You pick Claude Haiku in Settings; re-analyze on the
  Timeline uses Gemini and throws a quota error.
- **No link or artifact recall.** Ask for *"that link I saw yesterday about aliens"* and it
  can't help — even though we have the full browsing history, with URLs and page titles,
  sitting right there unused.

The rest of this spec is how each of those should work instead.

## 3. The voice

The full voice spec is [`voice.md`](voice.md); read it first. The rules below are the
AI-tab specifics on top of it. A friend who quietly watched your day and can give you a
straight, easy answer, never a report, a dashboard, or a database.

**The examples in this section are directional, not templates.** They show the spirit of a
good answer. Never pattern-match their wording or structure; write fresh every time.

- **It leads with the answer**, then lets it flow. It connects the parts of the day
  naturally ("then," "after lunch," "in between") instead of listing timestamps.
- **It sounds human.** Everyday words a non-technical person gets on the first read, short
  natural sentences. It talks about what you *did* — "you had Figma open," "you were setting
  up the work network" — never the plumbing ("foreground," "window titles," "sessions").
- **It uses real times, real app names, real activities** — "Cursor and Claude Code from
  8am to 10am," not "your development tools for a while."
- **Warm, never a performance.** No automatic praise, forced enthusiasm, judgment, or fake
  familiarity. "Good to see you" is warm; "you crushed it" is empty.
- **It never hedges.** No "approximately," no "it appears that," no "based on the available
  data." It states what happened.
- **It never apologizes and never asks you to do its job.** It does not say "I don't have
  access" or "could you share the output again." If the data is thin, it says so plainly
  and moves on (section 7).
- **It matches the question.** A small question gets a sentence or two; a breakdown can use a
  table or a little more. Every claim traces back to something real. No walls of text.

### Concrete examples of good answers

**"What did I work on today?"**

> Today was a solid one. You started the morning on Daylens development in Cursor and
> Claude Code from around 8am to 10am — mostly working on the timeline rework. Then you
> had your ML pipeline class from 10am to 1pm on Google Colab.
>
> After lunch you switched to networking — spent the afternoon and evening in Ghostty
> Terminal and the Ubiquiti dashboard configuring your work network, all the way until
> about 9pm.
>
> In between, around 10am to 10:40, you watched some YouTube videos on AI (I can see
> you're into that — you did the same thing Wednesday between 3pm and 4:40pm). Overall
> solid progress, especially on the timeline rework.

**"How much time did I spend in Cursor last week?"**

> | Day       | Hours   | What you were doing                          |
> | --------- | ------- | -------------------------------------------- |
> | Monday    | 3h 20m  | Timeline rework — block segmentation         |
> | Tuesday   | 1h 45m  | Bug fixes in the recap panel                 |
> | Wednesday | 4h 10m  | Timeline rework continued + AI tab debugging |
> | Thursday  | 2h 30m  | Settings page — model selector               |
> | Friday    | 0h 40m  | Quick PR review                              |
> | **Total** | **12h 25m** |                                          |
>
> Most of your Cursor time went to the timeline rework — about 7h 30m across three days.

**"That link I saw about transformer architectures"**

> You were reading "Attention Is All You Need — Illustrated Transformer" on
> jalammar.github.io last Wednesday around 3:15pm in Safari. You spent about 12 minutes
> on it.
>
> Here's the link: https://jalammar.github.io/illustrated-transformer/

Notice the pattern across all three: lead with the answer, ground every claim in real
times and real activities, and pick the format that fits the question (section 6).

## 4. How answers work — one agent, grounded tools

This is the heart of the tab. Chat is **one agent loop** (`docs/adr/0003-chat-agent-loop.md`):
the model reads the question and the conversation, calls read-only tools to look at the real
data, asks the user a clarifying question when it's genuinely stuck between readings, and
answers in the Daylens voice. There is no keyword router, no regex follow-up classifier, and
no separate phrasing pass — the history the loop carries *is* the follow-up context, which is
why "break that hour into 10-minute increments" works: the hour is right there in the
conversation, and the tools can be called again at finer grain.

The previous design (ADR 0002's plan → resolve → phrase, and the deterministic router that
fronted it) was retired for chat because it could not scale past the questions someone had
already predicted. An older tool-loop failed before it — by begging the user for tool output —
but that loop had a thin tool surface and no grounding contract. This one is built on the
opposite premises:

**The grounding contract.**

1. **Tools return real rows or an explicit miss.** Every Daylens tool answers from the same
   store the Timeline and Apps read, and returns either data or `{ found: false, reason }`.
   The model is never left to decide whether data exists — the tool tells it.
2. **The tool trace is the evidence.** Every turn records which tools ran and what they
   returned, stored with the message. Every claim in an answer traces to something a tool
   returned — a visit, a session, a block, a commit, a file. Judgment on top of evidence is
   fine ("this YouTube video is a podcast"); a fact with no evidence is a defect.
3. **Answers are verified before they ship.** Clock times, dates, and durations in the final
   text are checked against the turn's tool results. A violation triggers one retry with the
   problem named; if it fails again, the honest miss ships, never the fabrication.
4. **Read-only.** No tool writes, edits, or deletes anything — not files, not the DB, not
   git. In-app mutations (rename a block, merge, focus sessions, memory) stay outside the
   loop as the existing confirm-gated action widgets.
5. **Bounded.** Steps and output tokens are capped per turn. Cancel aborts the loop and all
   in-flight tools.

### 4.1 The tool surface (the app owns these)

Daylens data first — these wrap the same query layer the Timeline and Apps views read, so
the views cannot disagree:

- **get_day_overview(date)** / period totals — blocks, threads, totals.
- **get_moment(date, time)** — what was actually on screen at that minute: the covering
  block plus the specific page/app active at the asked clock time, not the whole block's
  evidence.
- **get_visits(range, filters)** — website visits with titles, URLs, and observed durations.
- **search_history(query, range)** — fuzzy recall over pages, titles, blocks ("that
  drowning video").
- **get_app_usage(range, app?)** — per-app time, the Apps-view numbers.

The world beyond the store, still read-only:

- **read_file / list_dir** — files on the machine, read only.
- **git** — allowlisted read subcommands (log, show, diff) for "what did I ship."
- **MCP** — tools from MCP servers the user has configured; the standard interface for
  "whatever's installed on this laptop," never a parallel plugin system.
- **ask_user(question, options)** — one clarifying question with tappable options and a
  free-text escape, only when the evidence genuinely underdetermines the answer.
- **create_artifact(format, content)** — a real downloadable file (CSV, Excel, Markdown)
  when the user asks for an export or report.

New capabilities are served by **adding a tool**, never by loosening the prompt. Tool
implementations live in one place and are shared with the MCP server.

### 4.2 The long tail — when no tool fits

A greeting, a how-are-you, an aside: the agent answers in character — warm, brief, human —
without calling tools it doesn't need. It never recites a capability menu, never guesses
about the day, never asks the user to paste data. When the question is about the day but the
tools come back empty, the answer says so plainly (section 7).

Rules that fall out of this:

- **The AI never claims data the tools didn't return.** Three blocks found means three
  blocks described — no invented fourth.
- **The AI never begs.** The tools always answer, with data or an explicit miss, and the
  answer reflects which honestly.
- **Every number matches the Timeline.** Same store, same query layer — they can't disagree.

### 4.3 Bench parity — the terminal is the UI

The chat entrypoint is one function; the IPC handler and the terminal bench
(`npm run moment:bench`) both call it with real provider settings. A bench answer **is** the
answer the UI would stream for the same question on the same data — same code path, same
model, same tools. The bench covers the hard families (moments, increments, recall, podcasts,
exports, shipped-this-month) against the live DB and is the acceptance gate for this spec.

## 5. The no-credits rule

**No AI credits, no AI.** Every response in this tab passes through a real API call. There
are no fallback responses, no static text, no hardcoded summaries dressed up as AI output.

If the user hasn't connected a provider or has no API credits, the AI chat does not work.
The tab shows **one clear message** telling them to connect a provider in Settings — and
nothing else. No fake answer, no canned summary, no "here's a sample."

This applies everywhere the AI speaks, not just here: chat, recaps, the **Generate Recap**
button on the Timeline, morning briefs, evening wraps, weekly and monthly wraps — all of
it. If a response didn't come from the API, it does not show up as if it did.

And the call uses **the model picked in Settings** — every surface, every time. If Settings
says Claude Haiku, then chat, re-analyze, and every recap use Claude Haiku. Nothing silently
falls back to Gemini. If that provider errors (quota, auth), the error names the selected
provider plainly; it never swaps in a different model behind the user's back.

## 6. Response formats — prose, tables, bullets, CSV

The AI picks the shape that fits the question. It always leads with the answer first,
whatever the shape.

- **Prose** for a single answer or a recall — "what did I work on today," "that link about
  aliens." A short, grounded paragraph or two. This is the default.
- **A table** when the data is tabular — time per day, per app, or per project; comparisons;
  any breakdown with rows and columns. It renders as a **real formatted table**, not
  monospace text. The "how much time in Cursor last week" example is a table because that's
  what the question is.
- **Bullets** when the user asks for bullets, or when a handful of distinct items reads
  better as a list than a paragraph.
- **CSV or Excel** when the user asks for an exportable version. Give them a valid file they
  can open in a spreadsheet — real headers, real rows, no prose wrapped around it.

### Transforms ("Turn into…")

The dropdown reformats the **previous grounded answer** — shorter, bullets, checklist,
report, table, CSV. Because every base answer is now real and grounded (section 4), there is
always something valid to transform. A transform restyles facts that are already on the
table; it never refetches and never invents. "Turn into bullets" on a working answer always
works.

## 7. When the data is thin

Sometimes the resolver genuinely finds little or nothing — a day you barely used the
laptop, an app with almost no signal. The AI says so plainly and stops. It does **not**
apologize, pad with "likely," or ask the user to supply anything.

Good: *"Quiet day — about 40 minutes total, all in Safari reading docs. Nothing else
tracked."* Bad: *"I don't have enough data… could you share more context?"*

If there's truly nothing for the period, say that in one calm line. Admitting a quiet day is
a real answer; begging is not.

## 8. Special capabilities

These are resolvers (section 4) — the app fetches the data, the AI phrases it.

### 8.1 Link and artifact recall

We have the full browsing history: URLs, page titles, the app that loaded them, when, and
for how long. The recall resolver searches it. So *"that link I saw yesterday about aliens"*
or *"the transformer architectures page"* resolves to the real page — title, site, when you
saw it, how long you spent, and the URL — phrased like the transformer example in section 3.
When several pages match, the answer names the best match and can offer the others.

### 8.2 Project attribution

When the user has named clients or projects in Settings, the AI attributes work to them —
"6h on the Acme rebuild this week."

When **no** projects are set up yet, the AI does not dead-end with *"No projects attributed
in Daylens yet."* It does two things: offers an **inferred breakdown** grouped by the
threads and subjects it can already see in the blocks, and **offers to set up** named
projects in Settings so attribution gets sharper. It never just refuses.

### 8.3 Period queries

The AI answers across **today, a specific day, the last 7 days, the last 30 days** — and
longer once those exist. The week and month paths read the same resolver as today; the only
thing that changes is the range handed in. A period question that returns a breakdown
(time per day, per app) is a table by default (section 6).

## 9. Chat state behavior

The sidebar and the conversations in it are real, persistent, and safe to interrupt.

- **History persists across tab switches and navigation.** Go to Apps, come back to AI, and
  every conversation is still there, in order. Switching tabs never clears the sidebar.
- **No duplicate entries.** Each conversation is listed once. "Last 7 days by project" shows
  up a single time, not twice under the same day.
- **The input is always live.** The chat input is prominent, pinned to the bottom, and never
  disabled and never hidden behind a loading state. You can always type.
- **Generation shows a clear, cancelable loading state.** While the AI is working, you see
  that it's working and you have a way to cancel.
- **Switching chats mid-generation is safe.** It never produces an empty chat, a missing
  sidebar, or a dead input. Either the in-flight generation is **cleanly canceled** when you
  switch, or it **keeps running in the background** and lands in its own chat when done —
  but the app never breaks and never needs a refresh to recover.
- **Suggested prompts on the empty state all work.** The empty state ("No chats yet") shows
  quick-start prompts like "What did I work on today?" and "Summarize the last 7 days." Every
  prompt shown leads to a real, grounded answer. Any prompt that would lead to a broken
  answer is removed, not displayed.

## 10. Visual changes

- The chat input is prominent and always visible at the bottom — never disabled, never
  hidden behind a loading state.
- Suggested prompts on the empty state all actually work; remove any that lead to broken
  answers.
- The sidebar persists across tab switches and navigation.
- No duplicate entries in the sidebar.
- During generation, show a clear loading state with a way to cancel; switching chats during
  generation does not break anything.
- When the AI uses a table, it renders as a real formatted table, not monospace text.

These are **behaviors**, not a visual style. The look of the chat surface (layout, spacing,
typography, the sidebar) is deliberately unspecced — before redesigning the *look* (not the
behavior above), the implementing agent gets reference screenshots from Tonny first
(`AGENTS.md` → "Design work"). Touchstones: **Raycast** and **Dia** and **Linear**.

## 11. Invariants (rules this view must always obey)

1. Chat is one agent loop over read-only, real-data tools (ADR 0003). Tools return real
   rows or an explicit miss; the model never invents rows and never decides unaided whether
   data exists. There is no keyword router in front of it.
2. The AI never claims a number, block, app, page, or time its tools didn't return, and
   answers are verified against the turn's tool results before they ship.
3. Every response passes through a real API call. No fallbacks, no static text, no hardcoded
   summaries — anywhere the AI speaks, including recaps and wraps.
4. With no provider connected or no credits, the tab shows one message pointing to Settings
   and nothing else.
5. Every AI surface uses the model picked in Settings; errors name that provider and nothing
   silently swaps to another model.
6. Every number in the AI tab matches the Timeline — they read the same blocks and can't
   disagree.
7. The voice is calm, confident, specific, and grounded — never apologetic, never uncertain,
   never asks the user to do the app's job.
8. The AI leads with the answer and picks the format that fits: prose, table, bullets, or
   CSV; tables render as real formatted tables.
9. Transforms restyle the previous grounded answer; they never refetch and never invent.
10. When data is thin, the AI says so plainly in one line — it never begs for context.
11. Chat history persists across tab switches and navigation, with no duplicate entries.
12. The chat input is always live; generation is cancelable; switching chats mid-generation
    never breaks the view or requires a refresh.
13. Every suggested prompt on the empty state leads to a real, grounded answer.
