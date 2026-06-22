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
**the app looks up your real data first, then hands it to the AI only to phrase it
nicely.** The AI never decides whether data exists. It never goes looking. It narrates
facts the app already fetched. This is non-negotiable — section 4 is how.

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

The AI talks like the [Dia morning brief](https://www.diabrowser.com/start): warm, calm,
specific, grounded in evidence. A friend who quietly watched your day and can give you a
straight, easy answer — never a report, a dashboard, or a database.

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

## 4. How answers work — plan → resolve → phrase

This is the heart of the tab, and it's where the current build is wrong at the root. Today
the AI tab has **two** answering systems bolted together behind a `shouldUseRouter` gate
(`aiService.ts`): a deterministic router, and — when the router doesn't recognize a
question — an **agentic tool-loop** where the model is handed nine tools (`getDaySummary`,
`getAppUsage`, …) and left to orchestrate them. The most important question in the app,
*"what did I work on today,"* falls into the tool-loop, and the tool-loop is exactly what
begs *"could you share the getDaySummary output again?"* **We delete the tool-loop.** We do
not patch it. (See `docs/adr/0002-ai-data-access.md` for the decision and the why.)

Every answer is built in three steps, always in this order.

**Step 1 — plan.** A question comes in. A planner maps it to **one or more resolver calls**
from a fixed, typed set (below) — picking which resolvers and filling their parameters
(which period, which app, which kind of thing). The common shapes ("what did I do today,"
"how long in X last week") route deterministically. For the long tail, the planner may use a
**single constrained model call** that *only emits a structured query* against the resolver
schema. The planner **never executes anything, never loops, never fetches** — it just
decides what to ask for.

**Step 2 — resolve.** The app runs the chosen resolvers against the **same store the
Timeline and Apps views read** — blocks, threads, times, history. This step is fully
deterministic. It either finds data or it doesn't, and it knows which. The resolvers are the
*only* way the AI tab touches data.

**Step 3 — phrase.** The resolved facts are handed to the model with the question, and the
model writes the answer in the Daylens voice using the right format. The model is given
**only** the facts the resolvers returned. It does not decide what's true; it narrates what
it was handed.

The difference from a tool-loop is the whole point: the model may **select and parameterize**
resolvers (step 1) and **phrase** their output (step 3), but it never **executes** them,
never loops on them, and never decides whether data exists. The data is on the table before
the phrasing model is ever called.

### 4.1 The resolver set (the app owns these, not the model)

A small, fixed, typed set of data functions. This is the same capability the nine tools have
today, but executed by the app, not orchestrated by the model:

- **getDay(date)** / **getRange(from, to)** — blocks, threads, totals for a period.
- **getApp(appOrBundle, period)** — one app's story (the Apps-view resolver).
- **getBlockAtTime(date, time)** — the block covering a moment.
- **recall(query, period)** — link/artifact/page search over history (section 8.1).
- **getAttribution(period)** — work grouped by client/project/thread (section 8.2).
- **listClients()** — the client/project roster.

New question types are served by **adding a resolver**, never by loosening the model. The set
is declared in one place with types, so the resolver the AI reads is the same one the
Timeline and Apps views read — they cannot drift.

### 4.2 The long tail — when nothing maps

If the planner can't map a question to any resolver — a greeting, a how-are-you, an aside,
general chat — the AI still answers with a **real model call**, in character: warm, brief,
and human. It is *never* a hardcoded line and *never* a recited menu of capabilities (§5).
It does **not** fall back to free-form tool calling, it does **not** guess about the day,
and it does **not** ask the user to paste data. "Hey — good to see you. Ask me anything
about your day whenever you're ready" is a real answer; a static capability dump, and
begging, are not. When it fits, the reply can name the nearest thing it *can* answer, but it
says it like a person, not a form.

Rules that fall out of this:

- **The AI never claims data that the resolvers didn't return.** If they found three blocks,
  the answer describes three blocks — no invented fourth.
- **The AI never says "I don't have the tool results."** It is always handed the results. If
  there are none, the resolver says so and the answer reflects that honestly (section 7).
- **Every number matches the Timeline.** The resolvers read the same blocks, so a total in
  the AI tab equals the same total on the Timeline. They can't disagree.

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

1. The app resolves the real data first; the AI only phrases facts it was handed. The model
   may select and parameterize resolvers and phrase their output, but it never executes a
   resolver, never loops on tools, and never decides whether data exists. There is no
   agentic tool-loop.
2. The AI never claims a number, block, app, page, or time the resolver didn't return.
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
