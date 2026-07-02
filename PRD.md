# Daylens — Product Requirements Document

**Version:** 1.0 · **Status:** Living spec, for build-from-scratch and external review
**Owner:** Christian Tonny · **Platform:** macOS, Windows, Linux desktop (Electron)

> This document describes everything Daylens is and does, in enough detail to rebuild it
> from zero. It is the consolidation of the product vision (`PRODUCT.md`), the thirteen
> behavior specs in `docs/specs/`, the two architecture decisions in `docs/adr/`, and the
> root-cause findings in `docs/findings.md`. Where a spec describes a target the current
> build hasn't fully reached, this PRD states the **target** — that is what "generate
> Daylens" should produce.

---

## 1. Overview

### 1.1 The one question

Daylens answers a single question: **"What did I actually get done today?"**

It quietly watches what you do on your computer — the apps you use, the windows you're in,
the sites you visit — and turns it into an honest picture of your day. Nothing leaves your
machine unless you ask it to.

### 1.2 The problem

You read docs, watch videos, and jump between apps all day. None of it stays easy to find
later. You need that article from last Friday, or what you worked on Tuesday morning.
Browser history and your own memory fall short. Web-based AI starts from zero every session —
it wasn't there when you learned it. You shouldn't lose your own digital past because nothing
was keeping track.

### 1.3 What it is

A **local-first desktop app** that runs quietly in your menu bar, logs what you actually did,
and turns it into:

1. An **honest timeline** of your day, grouped by what you were *trying to do*.
2. A **searchable, AI-ready memory** you can ask grounded questions about ("What did I study
   about neural networks this week?") and get answers backed by exact times, domains, and
   page titles — not generic web knowledge.
3. **Spotify-Wrapped-style recaps** of your day, week, month, and year.
4. An **opt-in MCP server** that exposes your local timeline to external tools (Cursor,
   Claude Desktop) — off by default.

### 1.4 What makes it different

- **Grouped by intent, not by app.** A day is a handful of meaningful blocks, not a log of
  every window switch.
- **Local-first.** Everything lives in `daylens.sqlite` on the machine; API keys sit in the
  OS keychain. When the AI is asked a question, only the small set of facts that answer it
  ever leaves — never the whole history, never raw capture.
- **Grounded AI.** The app resolves real data first, then hands it to the model only to
  phrase it. The model never invents a number, and every surface reads the same facts, so
  they never disagree.
- **No grades.** No score, no focus percentage, no "X% of your day," no guilt. Daylens shows
  the day; it does not judge it.
- **A real voice.** Recaps read like a sharp friend who watched your day, not a dashboard.

### 1.5 Who it's for

Knowledge workers, developers, founders, consultants, designers, writers, and students who
spend the day on a computer and want an honest account of where their time and attention
went — without screenshots, surveillance, or a productivity-shaming scoreboard.

---

## 2. Product principles (the foundation)

Everything in Daylens derives from five build rules:

1. **Evidence first.** The raw activity is the truth; everything is derived from it and can
   be rebuilt from it.
2. **Blocks before threads.** Figure out the continuous stretches first, then group them into
   goals.
3. **Your corrections win.** If you rename, merge, hide, or relabel something, that sticks and
   teaches Daylens — and survives every rebuild.
4. **Facts before words.** The AI narrates real numbers; it never invents them.
5. **Admit uncertainty.** When Daylens isn't sure, it says so instead of making something up.

### 2.1 The invariants (the physics — never broken to ship a feature)

1. One block = one stretch of one intent. Apps are evidence inside a block, never a boundary.
2. Brief detours are absorbed; a short off-task glance folds into the surrounding work.
3. Same-intent neighbours merge into one block.
4. Block height = duration, always.
5. A block is never named after a raw window title, file, repo, or app — the name says what
   you did.
6. A single off-task tab never sets a block's category.
7. **One truth, three views:** Timeline, Apps, and AI read the same block facts; totals
   reconcile.
8. Your corrections always win and survive every rebuild.
9. **No grades** — no Score, no Focus, no Drift.
10. When Daylens doesn't know, it says so; it never fills a gap with a guess.
11. System noise (loginwindow, Finder, screensaver) is invisible and never counts as time.
12. Every AI surface uses the model picked in Settings; none secretly switches.

---

## 3. The core model: evidence → sessions → blocks → threads

This is the heart of the product. A day is modeled in layers, each derived purely and
deterministically from the one below it, so the whole thing can be rebuilt from raw events.

| Layer | What it is | Who owns it |
| --- | --- | --- |
| **Focus event** | A single raw observation from capture (active window, process, browser context, idle state). The replay log everything else derives from. | Capture |
| **Session** | A continuous stretch of one app or context. | Projection (pure) |
| **Block** | One contiguous stretch of a *single intent*, shown on the Timeline. Apps/sites inside are evidence, not the definition. | Projection + AI naming |
| **Thread** | A persistent goal that ties blocks together across gaps or days. | AI relationships |

### 3.1 The evidence object

Before any boundary or name is decided, the engine assembles an **evidence object** for a
stretch: the apps, **the window titles, the sites with their URLs and page titles, and the
files touched** — each with timing. This single object is what naming, categorizing, and the
AI all read. A block carries the same evidence object wherever it's read (Timeline, Apps,
AI), declared once, so the views cannot disagree about what happened.

> **Root-cause lesson (build this right or nothing works):** On a real day, a block was
> handed five app names and nothing else (`pages: [], documents: [], domains: []`), and the
> AI correctly but uselessly called it "Computer activity." The AI wasn't dumb; it was
> blindfolded. **Capture quality is the foundation, not a detail.** Two upstream fixes are
> mandatory: (a) window titles and page content must actually be captured; (b) every
> browser's sites must reach the evidence (§4.3).

### 3.2 Block boundaries — what starts a new block

A new block starts **only** on a strong signal:

- A real gap — idle, asleep, or locked for roughly **15+ minutes**.
- A meeting starts or ends.
- You clearly switch to a **different goal** (different subject/project).
- A user correction says "cut here".

A new block does **not** start just because you switched apps, opened a tab, or glanced at
something for a few minutes. Apps are evidence, not boundaries.

**Dwell floor on raw switches.** An app or site you were in for **under ~10 seconds** is not
a real switch — it's a flicker. It never becomes its own session, evidence row, or session
count. (This kills "5,977 micro-sessions in a week" inflation.)

### 3.3 Brief detours are absorbed

A short off-task moment inside a work stretch (under ~10 minutes) folds into that block — it
does not rename or split it. Your X.com peek during network setup is absorbed, not turned
into a SOCIAL block.

### 3.4 The 15-minute floor and proportional height

Two rules make a block read like a real calendar event:

1. **No block is shorter than fifteen minutes** (enforced last, after every boundary
   decision). Any sub-15-minute non-meeting block is folded into its best neighbour (a
   related one first, then same-category, then the nearer by gap). The only blocks allowed
   under the floor: a block with no non-meeting neighbour to fold into (a lone short day),
   and a real **meeting** (a 10-minute standup is a block, not a sliver). A long activity
   that was only sparsely tracked (a 41-minute agent run that logged 30 seconds of polling)
   still spans ≥ 15 minutes and is a real block. **Analyze only ever makes the day fewer,
   truer blocks, never more.**
   - *Edge case learned in the field:* a sliver only folds across a gap under 30 minutes. A
     24-second 2am glance must never fold across an 8-hour sleep gap into the 9:41am block.
2. **A block's on-screen height is proportional to its active minutes** (linear, with a small
   readable minimum so the shortest 15-minute block still shows its title and time). The
   shape of the day tells you where time went before you read a label.

### 3.5 How a block gets its name — deterministic first, AI for the rest

Naming is **tiered**, cheapest and most certain first:

1. **A correction or rule wins.** If you renamed this block or set a rule for its kind, that
   is the name — always, surviving every rebuild. No AI call.
2. **Otherwise the AI names it from that one block's evidence object.** A validator checks the
   proposed title is actually supported by the evidence; if not, it falls to tier 3.
3. **If intent can't be derived, name from the evidence we have — never give up out loud.**
   An honest evidence-based title like *"Cursor, Warp, and Terminal — focused work."* It is
   **never** "Computer activity," "Untitled," or "Uncategorized."

Rules: never use a raw page/app/video title as the name. Style is short, verb + object,
saying what you were *doing* — e.g. *"Configuring the work network using the Ubiquiti
dashboard and the Ghostty Terminal."* Prioritize naming after useful work over the social
media running on the side. Naming only runs once a block has enough evidence to be worth
naming (never on thin, early signal). Raw machine identifiers (repo names, SCREAMING file
stems, article titles) are rejected as block names.

### 3.6 How a block gets its category

From the block's **overall intent**, never from a single tab. One open X.com tab can never
flip a work block to SOCIAL.

### 3.7 Threads

A thread is the bigger goal that ties blocks together across gaps or days — e.g. setting up
the router in the morning and fixing DNS at 2pm is two blocks, one thread: "Set up the work
network." Blocks are contiguous; threads are not. "What mattered" and the weekly/monthly
reviews are organized around threads, not raw blocks.

### 3.8 Corrections

- **Boundary correction:** a manual override of where one block ends and the next begins,
  keyed by the two sessions straddling the edge, remembered across rebuilds as the
  highest-weight signal. A **merge** erases a boundary and overrides *every* heuristic cut,
  including a kind change (work↔leisure). The user's intent always wins.
- **Rename / relabel:** wins everywhere and feeds tier-1 naming next time.

---

## 4. The capture engine

Always-on, metadata-only sampling of what the user is doing. **No screenshots, no video,
ever.** Because Daylens is metadata-only, the little signal it collects is all it has — so
capturing it well is the foundation.

### 4.1 What is captured

- **Active window & process** — polled every few seconds via OS APIs (foreground polling, not
  screenshots). Sub-10-second noise is discarded before it hits SQLite.
- **Window titles** — via the macOS Accessibility (AX) API. This is the signal that carries
  intent; capturing it reliably is mandatory.
- **Browser context** — the live tab URL and page title for browsers that expose it, plus
  browser history ingestion (§4.3).
- **Idle / asleep / locked state** — to detect real gaps and presence.
- **Background process evidence** — long-running processes (e.g. an agent run) so sparsely
  tracked but genuinely long work isn't lost.
- **Optionally iMessage** — opt-in.

### 4.2 Presence & idle handling

Input-based idle detection (no keystrokes for ~5 minutes) flushes a session as "away" — right
for an empty desk, wrong for a class you're watching. **Passive presence** holds a session
open through no-input idle when it's a watched video, a live call, or an online class (native
meeting apps by category; browser Meet/Zoom/Teams by window title), with guards so a file
named "team meeting notes.md" stays active work. A genuine walk-away still ends the session on
screen sleep/lock. A 2-hour Google Meet class must record as 2 hours, not 3 minutes.

### 4.3 Browser detection — discovered, not hardcoded

Browsers are special: they host the URLs and page titles that carry a block's intent.
Detecting "is this a browser?" with a hardcoded name regex is a guess that breaks on every
browser not predicted (Zen lost 44 minutes of real browsing this way).

**A browser is any app the OS registers as an `http`/`https` handler** — read from
LaunchServices or the app's own Info.plist (`CFBundleURLSchemes`). This is one source of
truth, consulted by both the history reader and the foreground tagger, and it catches the next
unknown browser with no code change. Detection runs **when an app first appears**, so a newly
installed browser is categorized correctly on day one.

Reading a browser's sites is family-specific:

- **Chromium & WebKit family** (Chrome, Brave, Edge, Arc, Dia, Safari, …): live tab URL is
  readable; history lives in a Chromium `History` DB.
- **Firefox family** (Firefox, Waterfox, LibreWolf, **Zen**): exposes nothing live — sites
  read from `places.sqlite`.
- **Future gold standard:** a Daylens browser extension — exact, live, per-tab,
  incognito-aware, identical across every browser.

A user override always wins over detection.

### 4.4 Privacy at the capture boundary

- **Incognito / private windows are never recorded.**
- **Excluded apps/sites** are removed from capture *and* from anything the AI is shown,
  including data captured before the exclusion (applied at the resolver boundary so old
  history for an excluded app never reaches a provider).
- **Pause tracking** stops capture; the Timeline marks that span as "paused," not idle.
- **System noise** (loginwindow, Finder, Siri, UserNotificationCenter, screensaver) is
  invisible and never counts as time or as a "co-used app."

### 4.5 Capture-health diagnostics

A plain-language "Is Daylens seeing your work?" panel (surfaced in onboarding, reachable from
Settings) that only demands attention when something is wrong:

- **Permissions** — Accessibility granted or not, with a one-tap fix.
- **Window titles** — whether titles are actually being captured (not just whether the
  permission is on).
- **Browsers** — which browsers are being read, so a missing one is visible and fixable.
- **Idle / paused / private** — why a gap exists, so "nothing tracked" is always explained.

Raw metrics ("198/203 samples") live behind an advanced/troubleshooting disclosure.

---

## 5. Feature: Timeline (the home screen)

Your day from midnight to now, as a vertical list of **blocks**, newest work readable at a
glance. Each block is named for *what you did* and sized by *how long it took*. To the right,
a short, honest recap of the day.

### 5.1 Block list

- Vertical, calendar-like; block height proportional to duration (§3.4).
- Each block is named for the work (§3.5), shows its time and duration.
- Click a block to open a **detail panel**: the threads active during it with time on each,
  and the apps/sites/artifacts that are evidence for it — shown **together in one view** (not
  separate "Apps used" / "Key artifacts" lists).
- Fix controls on a block: **Rename**, **Merge with above**, **Merge with below**. (No
  "Split," no "Hide," no "episode" wording.)

### 5.2 The live (today) view

You can't name what someone's doing while they're still doing it — naming live produced
"Software Development Block" stamped on a transcription session. So:

- The day so far is **one big provisional block**, labelled neutrally (*"Active now"*, or an
  already-established thread name) — never speculative per-activity names while live.
- It has breaks where the laptop was locked or idle for ~15+ minutes.
- Leading noise is dropped so the live block starts at real activity (not a 2am blip).
- The provisional block becomes real, named blocks only when it **finalizes** — at end of
  day, on next open, or when the user clicks **Analyze Day**. Naming happens once, on
  finalize, with full evidence in hand.

### 5.3 Generating the recap (Analyze Day)

A button splits the giant provisional block into coherent, meaningful blocks using AI on the
full day's evidence. Analyze makes the day **fewer, truer blocks, never more**. A notification
can be sent the next day that yesterday's recap is ready, opening on yesterday's Timeline.

### 5.4 The day recap (right-hand panel)

- Top: tracked hours, plus counts of blocks, apps, and sites for the day.
- An AI-generated summary of the day, built from the same blocks/apps/sites.
- **Removed:** the date headline, Score, Focused hours, Drift hours, "What mattered" section,
  and "The shape of the day" grading. No grades anywhere.

### 5.5 Distractions / off-track time

- Brief detours (under the §3.3 cutoff) are absorbed into the surrounding block — never shown
  as work.
- A **sustained** off-task stretch becomes its own small, visually distinct section inside the
  block's detail panel (not mixed into the main timeline).

### 5.6 Timeline invariants

Every number on screen comes from the same blocks (recap total = sum of blocks). No Score /
Focus / Drift. No block named after a raw label. A single off-task tab never sets a category.
A user correction always wins and survives a rebuild.

---

## 6. Feature: Apps view

Pick one app and see what you actually did in it — same intelligence as the Timeline, filtered
to a single app. Reads from the **same blocks** as Timeline and AI.

### 6.1 The app list

- Left side: every app used in the chosen period, ordered by time spent (most-used first).
- **The bold title is always the app's real name** (Safari, Cursor, Ghostty) — never the
  category, never a page/video/document title, in any period.
- The category is a **quiet badge** next to the name (Safari → *Browsing*).
- Subtitle carries supporting facts: time in that app and a sane session count.
- Category **filter pills** at the top actually filter the list by corrected category.

### 6.2 Periods

Four periods: **Today**, a specific **Day**, **last 7 days**, **last 30 days**. Same app, same
name, same category in every period. **Every period shows real detail with no AI** — time,
domains, deduped pages, computed straight from activity, present the moment you open the app
(Today is never empty). **Generate only adds the written recap.**

### 6.3 Detail panel

Header: app name (bold) + quiet category badge + period (e.g. *Safari · Browsing · last 7
days*), plus a Generate button. Then, in order:

- **Time by domain (browsers only).** Sites the app hosted, each with time and visit count.
  **Domains belong to the browser that loaded them**, never to whichever app was in focus
  (Netflix watched in Safari lives under Safari, even if Dia was briefly focused). Non-browser
  apps show no domain section. **Work surfaces first**; streaming/social are collected in a
  quieter "off to the side" section, still counted.
- **Pages visited.** Specific pages, **deduped — each page appears exactly once** with its
  total time and real visit count. Work pages first, leisure to the side.
- **Generated recap.** A short paragraph (on Generate) naming what you did in that app,
  grounded in real domains/pages. No duplicate artifacts, no invented ones. Uses the Settings
  model, runs reliably.
- **Delete a page or domain.** Each row has a delete control. Deletion is **permanent,
  confirmed first**, removes the captured records everywhere, and regenerates any recap built
  on them.
- **Removed:** the "Often used with" section (it listed system noise as if it were apps you
  chose).

### 6.4 Corrections

Relabel an app's category in Settings (e.g. Dia from *AI tools* to *Browsing*); the override
wins everywhere (Apps list, badge, every grouping), propagates to Timeline and AI after
recompute, and survives rebuilds.

---

## 7. Feature: AI chat

You ask **"What did I work on today?"** and get a calm, specific answer with real times and
real activities — like a sharp assistant who watched your day. Reads from the **same blocks
and threads** as Timeline and Apps.

A chat surface: a sidebar of past conversations on the left, the current conversation in the
main area, input pinned at the bottom.

### 7.1 The architecture rule: plan → resolve → phrase

**The app looks up your real data first, then hands it to the AI only to phrase it nicely.**
The AI never decides whether data exists, never goes looking, never loops on tools. (This
replaces a deleted agentic tool-loop — see ADR 0002.)

Every answer is built in three steps, always in this order:

1. **Plan.** A planner maps the question to one or more **resolver** calls from a fixed, typed
   set, filling their parameters. Common shapes route deterministically; the long tail may use
   a **single constrained model call that only emits a structured query** against the resolver
   schema. The planner never executes, never loops, never fetches.
2. **Resolve.** The app runs the chosen resolvers against the same store the Timeline and Apps
   views read. Fully deterministic — it finds data or it doesn't, and it knows which. The
   resolvers are the *only* way the AI tab touches data.
3. **Phrase.** The resolved facts are handed to the model with the question; the model writes
   the answer in the Daylens voice, in the right format. It's given only the facts the
   resolvers returned.

The model may **select, parameterize, and phrase**. It may never **execute or loop**.

### 7.2 The resolver set (app-owned, not the model)

- **getDay(date)** / **getRange(from, to)** — blocks, threads, totals for a period.
- **getApp(appOrBundle, period)** — one app's story.
- **getBlockAtTime(date, time)** — the block covering a moment.
- **recall(query, period)** — link/artifact/page search over history (§7.6).
- **getAttribution(period)** — work grouped by client/project/thread (§7.7).
- **listClients()** — the client/project roster.

New question types are served by **adding a resolver**, never by loosening the model.

### 7.3 The no-credits rule

**No AI credits, no AI.** Every response passes through a real API call — no fallback
responses, no static text, no hardcoded summaries dressed up as AI. If no provider is
connected or no credits remain, the tab shows **one clear message** pointing to Settings and
nothing else. This applies everywhere the AI speaks: chat, recaps, Generate Recap, briefs,
evening wraps, and weekly/monthly/annual wraps.

And the call uses **the model picked in Settings — every surface, every time.** If that
provider errors (quota, auth), the error names the selected provider plainly; it never
silently swaps to a different model.

### 7.4 Response formats

The AI leads with the answer, then picks the shape that fits:

- **Prose** (default) for a single answer or a recall.
- **A real formatted table** when the data is tabular (time per day/app/project, comparisons).
- **Bullets** when asked, or when a handful of items reads better as a list.
- **CSV / Excel** when asked for an exportable version — a valid file, real headers/rows.

**Transforms ("Turn into…").** A dropdown reformats the *previous grounded answer* (shorter,
bullets, checklist, report, table, CSV). A transform restyles facts already on the table; it
never refetches and never invents.

### 7.5 When data is thin

The AI says so plainly in one line and stops. It does not apologize, pad with "likely," or ask
the user to supply anything. Good: *"Quiet day — about 40 minutes total, all in Safari reading
docs. Nothing else tracked."*

### 7.6 Link & artifact recall

The full browsing history (URLs, page titles, the app that loaded them, when, how long) is
searchable. *"That link I saw yesterday about aliens"* resolves to the real page — title,
site, when, how long, and the URL. When several match, name the best and offer the others.

### 7.7 Project attribution

When the user has named clients/projects, the AI attributes work to them ("6h on the Acme
rebuild this week"). When **no** projects are set up, it never dead-ends — it offers an
**inferred breakdown** grouped by the threads/subjects already visible in the blocks, and
**offers to set up** named projects in Settings.

### 7.8 Chat state behavior

History persists across tab switches and navigation; no duplicate sidebar entries; the input
is always live (never disabled/hidden behind a loading state); generation shows a clear,
cancelable loading state; switching chats mid-generation is safe (either cleanly canceled or
kept running in the background, never breaks or needs a refresh); every suggested empty-state
prompt leads to a real, grounded answer.

### 7.9 AI actions & widgets (the AI can *act*, not just answer)

The AI chat can change things on your instruction and render an interactive widget inline.
"Merge these two blocks." "Rename this to networking." "Remember Acme is my biggest client."
"Attribute yesterday afternoon to Acme."

- **Reference feel:** Claude Artifacts / ChatGPT Canvas — a live interactive surface beside
  the conversation.
- **Preview, then confirm.** You say it → the AI proposes the action and renders its widget
  (nothing changed yet) → you confirm/tweak/cancel in the widget → only on confirm does it
  commit → it takes effect everywhere via the same correction pipeline as a manual edit.
  **Never a silent mutation.**
- **Widgets reuse real Daylens components** (the timeline block component, the manage-memory
  card, the client view) — one source of truth per surface.
- **In scope to start:** block edits (rename, merge, attribute, mark a detour), memory edits
  (remember/forget/correct a fact), client edits (create, add a fact to scope). Anything
  destructive or without a manual equivalent gets a stronger confirm.
- **Reading stays resolver-first** (ADR 0002). This adds a separate, explicit set of *action
  tools* plus widget rendering. Reading = resolvers; acting = action tools + widgets.

---

## 8. Feature: Voice and tone

The single document any human or AI reads before writing a word of Daylens copy. Wraps,
briefs, chat answers, onboarding, Timeline labels, tooltips, empty states, errors,
notifications — it all sounds like one product because it all comes from here. If a spec's
example line disagrees with the voice doc about *how something sounds*, the voice doc wins.

### 8.1 Personality

**The sharp friend who was in the room.** Someone who quietly watched your day, has taste and
a point of view, and tells you what you actually did in plain words you enjoy reading. Glad to
see you, never fawning. Confident, a little playful, occasionally surprising. The craft bar is
Jony Ive: nothing filler, nothing boilerplate, nothing that reads like it was generated.

### 8.2 The non-negotiables (never bend, any voice, any surface)

1. **Facts before words.** Every claim traces to something real; the model only phrases
   resolved facts and never invents.
2. **Lead with the answer.** State the thing, then let it flow.
3. **Real names, real times, real work.** Name the work ("setting up the work network"), never
   the plumbing ("foreground window titles," "sessions").
4. **Never hedge** ("likely," "approximately," "it appears," "based on the available data").
5. **Never robotic** ("captured your longest app engagement," "matched the focus signal").
6. **Never apologize, never beg** ("sorry," "I don't have access," "could you share that
   again").
7. **No walls of text.** Match the answer to the question.
8. **No self-referential reassurance.** Never tell the user what kind of product Daylens is
   ("we don't grade you," "your privacy is safe").
9. **No shaming scores.** No focus percentage, no "X% of your day," no drift, no guilt.
   Celebrate wins loudly; never lecture gaps.
10. **No hype or flattery** ("you crushed it," "amazing job," "let's dive in").
11. **No em dashes, ever.** Use a comma, a period, or "and."

### 8.3 The three named voices

The user picks a voice in onboarding (stored as `summaryVoice`); it flows to every surface
that speaks. The picker preview and the real prompts read the same module
(`src/shared/summaryVoice.ts`).

- **Straight** — no narrator, pure facts, economical (not cold). Shortest.
- **Warm** (default) — first-person and light, a friend glad to see you (not a coach).
- **Witty** — first-person and playful, observational humor (never snark, never at the
  reader's expense, never invents a fact to land a joke, never swears — these get
  screenshotted and shared).

Constant across all three: facts, no scores, no hedging, no em dashes, lead with the answer,
no walls, no reassurance.

### 8.4 It knows WHAT, never WHY

It observes; it never diagnoses. No feelings ("you must be tired"), no motives ("you were
procrastinating"). "You came back to the proposal four times" is an observation. "You kept
getting distracted from the proposal" is a banned verdict.

### 8.5 Emoji

Rare, deliberate, reactive — earned by a real moment, never placed as punctuation. Never more
than one in view. Closed starter set of six: 🏆 (a record/longest stretch), 🔥 (a long unbroken
stretch), 📭 (inbox hit zero), ✨ (a first), 🌙 (late-night, light observation only), 🎯
(finished a multi-day thread). Straight: none, ever. Warm: 0–1, rarely. Witty: 0–1, a bit more
often.

### 8.6 The variation engine

The same kind of day must never read the same way twice, without ever inventing a fact:

- **Candidate hooks.** The data layer computes 3–5 true candidate hooks per period (longest
  block, the thread that mattered, a juxtaposition, a time-of-day fact, a within-period
  superlative). The AI picks which leads and which becomes the wildcard; it never derives its
  own.
- **Anti-repeat memory.** Keep a short log (~last 5) of recent openings/structures/jokes per
  surface; the prompt is told not to reuse them.
- **Vary** the lead angle, rhythm, twist kind, and (in Witty) the joke (it's about the real
  day, so it differs for free).
- **Honest repetition.** If a day genuinely resembles yesterday, say so plainly and
  differently ("another one on the proposal"), never manufacture novelty.

### 8.7 Runtime enforcement

The voice doc is the source of the system prompt. After generation, a **linter** catches
mechanical violations automatically (em dashes, banned words, score language, hedges, emoji
count/set, length caps); anything that fails is stripped or regenerated. The model is never
trusted to police its own em dashes. Tested with golden-day fixtures (quiet/huge/scattered/
first/error days × three voices), a repetition test, a banned-token test, a fact-grounding
test, and a voice-distinctness test.

---

## 9. Feature: Briefs (morning) and the evening wrap

The moments Daylens reaches out to *you* instead of waiting. Every word comes through a real
API call (the no-credits rule, §7.3). Every number comes from the same blocks as the Timeline.

### 9.1 The morning brief — two separate notifications

Both are written fresh every day, and the notification body itself must be a real, readable
summary (not "Your brief is ready").

- **Yesterday's recap** — sent first thing when you open the laptop. **Fires only if you did
  not already generate a recap the previous day.** Body is a fresh, specific summary of
  yesterday; tapping it opens yesterday's Timeline.
- **Carryover nudge** — sent after you've been working **1–2 hours** that morning (not the
  instant you open the laptop). **Always fires.** Greets you, notes what it can already see
  you doing this morning, and lists the open threads worth picking up. If nothing carried
  over, it says so (a clean start is a real answer).
- **Stats slide (optional)** — one slide of interesting stats (time per activity, apps/sites
  for yesterday and so far this week) with simple graphs; a story, not a wall of charts.

### 9.2 The evening wrap — a short carousel

Sent in the evening as you're shutting down, written fresh for that day; tapping opens today's
Timeline. **At most 5 cards** on a working day, each earning its place:

1. **Shape of the day** — one sentence on what the day was about. Always present.
2. **What you worked on** — the real work (only if meaningful work happened, ~15+ min), named
   for the doing.
3. **Where time went** — as a *story* ("the afternoon was all Intune"), not a bar chart.
4. **Open thread** — only if something genuinely carries into tomorrow.
5. **Quiet close** — a calm sign-off. Always present.

Cards 2 and 4 are conditional; never pad to five. **A leisure/rest day collapses to two cards
(shape + close)** — no focus lecture, room for light humor.

> Note: `wrapped.md` (§10) supersedes the wrap *structure* and removes "open thread /
> carryover" content from wraps entirely. `briefs-wraps.md` still owns the brief *notification
> firing rules* above. Where they conflict on wrap content, the Wrapped spec wins.

---

## 10. Feature: Wrapped (daily / weekly / monthly / annual)

The showcase — Spotify Wrapped for your day, week, month, and year. The moment Daylens stops
being a tracker and becomes the thing you *want* to open and share.

### 10.1 What good looks like

A tap-through sequence of full-screen cards (Spotify Wrapped / Instagram Stories), one idea per
card, big type, auto-advancing and tappable. The bar, in order:

1. **It tells you what you actually did,** in plain human words, in non-boring detail. Not
   "Malaria Notebook" but "You trained the malaria classifier and got it past 80%."
2. **It is grounded** — every number/name/claim traces to a real block.
3. **It is never the same twice** — copy, which slides appear, palette, layout, tone all vary
   by seed and data.
4. **It lands one surprising true thing** every time.
5. **It is shareable** — every slide saves as an image with a small Daylens watermark.
6. **It is fast and calm** — auto-advances, pauses on hold/hover, respects reduced motion.

What it is NOT: a dashboard, chart dump, leaderboard of block labels, performance review, or
score.

### 10.2 The four cadences

| Cadence | Source of truth | When generatable |
| --- | --- | --- |
| **Daily** | The day's blocks and threads | After the work threshold (§10.3). Yesterday and older always available. |
| **Weekly** | Frozen daily snapshots for the week | Once the week has activity; current week labelled "week so far." |
| **Monthly** | Frozen daily snapshots for the month | Only after the month closes. |
| **Annual** | Frozen monthly rollups | Only after the year closes (or "year so far" in late December). |

**Frozen snapshots are the one rule that makes them trustworthy.** When a day's recap
finalizes, its numbers are frozen. A week sums seven frozen days; a month sums frozen days; a
year sums months. This is why the headline number and the narrative can never disagree (the
20h7m-vs-20h53m bug).

### 10.3 Availability & generation controls

- **Daily work threshold:** under 2 hours of *tracked work*, don't auto-offer a full daily
  wrap — show a light, voice-appropriate line that names the real number plus a quiet "Generate
  anyway." At/above 2 hours, it plays. This gate is for the live day only; finished days are
  always available.
- **Period gating:** this week is generatable but labelled live; **this month/this year cannot
  be generated while open** — tell the user plainly and point them to previous, finished
  periods (always viewable).
- **Conscious regeneration:** never silently regenerate. Persist each generated wrap (narrative
  + the facts it was built from), keyed by date/period. On open, if one exists, **show it** with
  a "generated <when>" marker and do not call the model. Offer an explicit **Regenerate**
  control; only an explicit click spends tokens.
- **No provider, no wrap** (§7.3).

### 10.4 The slide systems

Shared arc: **Hook → Substance → Where it went → Wildcard → Finale.** Never pad to a count;
never show a thin-data slide.

- **Daily (≈4–7 cards):** Hook (with a short "recap being cooked" build animation reusing the
  onboarding tetris-stack build, then an agenda-style chart easing in) → the day as a story
  (morning/midday/evening, narrated like a friend; the midday card is where personality lands
  hardest) → where the time went (the one place a chart is the point; legend + totals match the
  headline) → wildcard (one surprising true thing) → optional trajectory (pure pace arithmetic,
  never a prediction of *what* you'll do) → finale/shareable card.
- **Weekly (≈5–7):** Hook → what mattered (biggest threads with real hours + day-spread) →
  shape of the week (busiest/quietest day, a run; story then a 7-day bar chart) → where time
  actually went (the weekly nitty-gritty: which sites/apps, distribution) → a standout →
  wildcard → finale.
- **Monthly (≈5–7):** Hook → threads that defined it → shape of the month (busiest/quietest
  week, a streak; per-week chart) → where time went deeper → a surprise → wildcard → finale.
- **Annual (≈6–8):** Hook → biggest threads (with when they were most active) → biggest month
  → shape of the year (per-month chart + the arc) → where time went → superlatives → wildcard →
  finale.

### 10.5 What wraps must NOT do

No "needs to be picked up" / carryover / open-thread content, any cadence (Daylens can't know
tomorrow without a calendar). No raw labels (filename, folder, repo, branch, tab title, video
title). No scores/grades/focus percentages/guilt. No invented facts/numbers/records/
superlatives. No em dashes.

### 10.6 Design variance

Palette changes day to day (seeded by the period, each scene tied to its mood, text contrast
guaranteed). Layout varies (a small set of well-crafted variants the seed selects among).
Images appear sometimes, not always — and since Daylens is metadata-only, visual richness comes
from *generated* material (app glyphs, site favicons, the mascot Lumen's moods, abstract art
seeded by the day) — never a screenshot. Tone shifts (the day's data sets the mood, the seed
picks the flavor; the chosen voice is the ceiling — a Straight user never gets playful). Motion:
numbers count up, charts grow in, staggered reveals; reduced motion = instant reveals, manual
paging, fully readable.

### 10.7 Save, share, interaction

- Every slide saveable as its own watermarked image (canvas render, no extra deps), to disk and
  clipboard where supported; the finale is built to be screenshot-and-post perfect.
- Auto-advance (~5–7s) with a story progress bar; tap right/left to advance/back;
  press-and-hold or hover pauses; keyboard left/right/space/Esc; a visible Next affordance;
  restart from the finale; close anywhere.
- **Entry points:** the evening wrap notification (today), the morning recap notification
  (yesterday), the command palette (today, yesterday, this week, this month, this year), and
  dev shortcuts.

### 10.8 The facts layer

The wrap is only as good as the facts it narrates, and the facts are computed, never left to
the model. Per cadence the facts object provides: the one reconciled total and kind split
(work/leisure/personal); ranked human work activities/threads with real durations; the
agenda/where-it-went distribution with totals summing to the headline; the day/period shape;
3–5 candidate hooks and a single computed standout; quality/availability signals
(tracked-work seconds for the threshold, whether the period is closed). Cross-period records
and streaks are roadmap — do not claim them until a history layer exists.

---

## 11. Feature: Memory (and clients)

Everything Daylens knows about you and your work, so answers feel like they come from someone
who knows you. The bar is **how Claude's memory works:** tell it something in plain
conversation and it remembers going forward, it organizes what it knows into readable sections,
and you can open a "Manage memory" view to see/edit/forget any of it. The AI does the
bookkeeping; you steer.

### 11.1 The two new things

- **You tell it, it remembers.** The main way memory grows is **conversation** — say "remember
  that Acme is my biggest client" in chat and Daylens captures it into memory itself (you don't
  open Settings to type into a box). It can also propose remembering something it noticed
  ("Looks like you spend most mornings on the Ubiquiti work — want me to remember that?")
  rather than silently absorbing everything. Everything memory writes is a fact you can see and
  undo.
- **Memory has scopes — and clients are one.**
  - **General memory** — who you are, how you work, your tools, your style. Always in play.
  - **Scoped memory** — everything tied to one **client or project** (what Acme is, where their
    files live, what you've done, deadlines, people). Comes into play only when the question is
    about that client.

A **client** in Daylens is exactly a named scope with its own memory. Asking "how's the Acme
work going" pulls Acme's scoped memory *plus* the real tracked activity attributed to it.

### 11.2 Managing memory

A clean "Manage memory" view (in the sectioned Settings): see it organized into sections (and
each client's memory under that client) as plain readable sentences; edit any fact by hand (a
hand edit is a correction that wins and survives rebuilds); forget a fact, a whole client, or
everything (forgotten-on-purpose stays gone — no silent resurrection); a short audit of what
was remembered/edited/forgotten. Visual bar: Claude's Capabilities/Memory panel — calm,
spacious, "set and forget," never a debug dump of bordered textareas.

### 11.3 How memory shapes the AI

Memory is handed to the model as **context** on every surface (chat, recaps, wraps, naming) —
general memory always, the relevant client's scoped memory when the question is about that
client. Editing memory must visibly change what the AI says next; if it doesn't, memory is
broken. It is **context, never fact-of-record:** it colors how Daylens *reads* your real
activity but never invents activity the evidence doesn't show. "Ubiquiti" means your network
work because memory says so; the *hours* still come from the tracked evidence.

> Durability carried over from the shipped work-memory: `topic_key` identity, the
> drafted-vs-user origin flip on a hand edit, tombstones so forgotten things stay gone, and
> memory already feeding the AI prompt. (The earlier `work-memory.md` "editable paragraph"
> model is superseded by this; no confidence-percentage theater.)

---

## 12. Feature: Settings

The one place to tune Daylens — and **every control here visibly changes something you can
see** (a toggle that does nothing is a bug). Settings reads and writes the **same truth** as
the rest of the app; there is no separate "settings world."

### 12.1 AI provider & model

Connect one provider (Anthropic, OpenAI, Google) and pick a model. That model is used by chat,
re-analyze, recaps, briefs, and wraps — every surface, every time. On failure the error names
the selected provider; nothing silently swaps. With no provider/credits, AI surfaces show one
"connect a provider" message and nothing fake.

### 12.2 Labels (per-app categories)

The label list is **every app you've actually used**, including uncategorized ones (so nothing
is unreachable). Detection is the default (browsers via the OS handler, others by what they
are); your override is the truth. An override wins everywhere and survives rebuilds; a relabel
reports its effect ("updated 3 days of blocks"). Filter pills actually filter.

### 12.3 Clients & projects

Create a client/project and optionally attach aliases or apps/domains. From then on the AI can
answer "how much on Acme this week?" with a real number. With no clients, the AI never
dead-ends (§7.7); this screen is where setup happens.

### 12.4 Tracking & privacy

Pause tracking (Timeline marks the span "paused"). Excluded apps/sites removed from capture
**and** from anything the AI is shown, including already-captured data (applied at the resolver
boundary). Incognito/private windows never recorded. Each state is explained where it shows up.

### 12.5 MCP server

A power-user feature (external clients querying your data), **off by default** and safe in
production. Packaged build: MCP off, config shows the real userData DB path (never a
developer's repo path), no debug menus. Dev build: may default on, with the dev-vs-packaged
difference explained. Raw JSON config, file paths, and `DAYLENS_*` env live behind an
"Advanced / Show config" disclosure.

### 12.6 The rest

- **Profile name** feeds the AI's persona ("Good morning, Tonny") but is never treated as
  activity data.
- **Notifications** — morning brief and evening wrap toggles; when on, the briefs fire with
  real content.
- **Theme** (System / Light / Dark) applies immediately.
- **Capture health** — reframed as a plain-language "Is Daylens seeing your work?" status that
  only demands attention when something's wrong (§4.5).
- **Updates** — a beautifully designed, editorial changelog (a crafted newsletter, not a "bug
  fixes" list), with the check/install/restart controls. Packaged builds auto-update.
- **Billing / Usage** (§13) — honest, calm, plain numbers, no dark patterns.
- **Analytics** — anonymous, opt-in/out; the "local-only" promise is real when set.

### 12.7 Layout (visual direction)

Sectioned: app sidebar → settings rail → content pane, each section its own page. Mood: calm,
spacious, plain-language, native — Claude's settings, not a dense control panel. Generous
vertical rhythm, one job per page, a muted one-line description under each control,
right-aligned controls. There must always be an obvious way back from any page (no dead-end
pages). Never dump raw config, dev paths, or jargon at the user.

---

## 13. Feature: Billing & AI access

Daylens needs an AI provider for its best work (recaps, chat, wraps). A normal person should
get the full experience without ever touching an API key, while technical users who want their
own key still can. Three ways to power the AI, a natural ladder:

1. **Free credit** — every new user gets **$5 of AI on us** (granted on first run, no card).
   The on-ramp to the magic moment before money is mentioned. A small, honest meter shows
   what's left ("$3.40 of AI left"), never a pressuring countdown. Credit is consumed by real
   metered provider cost, granted once per user; when gone, AI pauses and the user sees one
   clear choice (subscribe or add a key) — capture and local views keep working.
2. **Subscription** — a flat recurring price; Daylens handles the AI through its proxy (covers
   provider cost). Manage in Settings → Billing (upgrade, renewal date, payment, cancel). A
   canceller keeps Daylens; the AI falls back to "no credit." Sensible fair-use ceiling, stated
   honestly.
3. **Bring your own key** — paste a provider key; the call goes straight to the provider. Not
   charged by us, not drawing credit. Switching modes is clean.

**How the call routes (the privacy story):**

- **With your own key:** the AI call goes straight from your machine to the provider; Daylens
  never sees it.
- **On free credit or subscription:** the call routes **through the Daylens proxy** (our
  server, our keys) and is metered/billed.
- **Either way:** your activity always lives on your machine. When you ask a question, only the
  handful of resolved facts needed for that one answer leave — never your whole history, never
  raw capture. (The resolver-first design, §7.1, is what makes this safe — the payload is the
  same tiny fact set whether direct or via the proxy.) The proxy adds nothing beyond what the
  provider needs and stores no more than required to meter usage; that retention is stated
  plainly at sign-up.

---

## 14. Feature: Onboarding

The first five minutes. By the end, the user has **granted the permissions Daylens needs and
seen it already understand a slice of their real day.** The bar: they think *"oh — it actually
sees what I do,"* not *"okay, I clicked through five slides."* Short, honest, warm, front-loaded
with the permission grant. Told as a small story with the mascot **Lumen** (a friendly
camera-lens character) present on every screen. Every example reads for a normal person (a
proposal, a call, an inbox), never developer-specific.

### 14.1 The flow

1. **Greeting** — Lumen waves; a single name input whose placeholder is derived from the
   computer's friendly name. The name is only ever used to greet.
2. **Why (the story)** — answer "why let an app watch my laptop?": it all stays on this device,
   no screenshots/video ever, and at day's end you get an honest recap. A low-contrast Skip.
3. **Grant capture** — ask for **Accessibility** (window titles). Screen Recording is **not**
   required. Deep-link to the macOS pane; detect the grant and advance automatically; never
   trap.
4. **Wait for first capture** — a brief, honest "watching…" moment (no fake progress bar).
5. **Show the proof** — *"Here's what I can already see"*: **real captured activity**, named
   the Daylens way. Never a canned demo.
6. **Narrated day (tour)** — one relatable everyday day told back the Daylens way (merge,
   absorbed detour, two clean blocks, recap, weekly wrap). Explicit advance control, small Skip.
7. **About you** — `userRole` (Consultant · Designer · Engineer · Founder · Writer · …) + why
   you're here (intent chips + free text). The role seeds the next screen.
8. **Pick your voice** — three sample tunes of the same day (Straight · Warm · Witty, default
   Warm); drives every recap/wrap prompt.
9. **Your work** — categories you care about + which apps count as *real work* (one deduped
   list seeded from your actual top apps).
10. **Who you work with, and when** — `userClients` (chips, optional) + `workRhythm` (early
    bird · nine-to-five · night owl · always on). Skippable.
11. **Keep it private** — apps to never track, via a "+ keep private" affordance with quick-add
    from your real apps (reuses tracking exclusions).
12. **AI setup** — care-first money moment, adaptive to the real billing snapshot: leads with
    **$5 of AI free** (covers recaps/wraps/briefs), offers a paid plan for unlimited chat when
    checkout is live, and bring-your-own-key. Optional and clearly separate — capture and
    Timeline work without it.
13. **Ready** — *"You're all set, {name}."* Reflects the whole profile back plus a sample recap
    in the chosen voice.

Onboarding is skippable-forward but not fakeable: if permissions aren't granted, the proof step
says so plainly and offers to fix it. Visual craft: one fixed *stage* frame that never resizes
and scrolls content inside it; a single type/chip/card/input/button system; Lumen with
per-moment expressions; calm, reduced-motion-aware transitions.

### 14.2 Trust affordances (carried into the app)

Inferred / low-confidence items are visibly marked and easy to correct. Corrected-by-you,
hidden, deleted, excluded, and stale states are distinguishable. A future day looks like a
future day; a missing past day gives a reason; "no data" appears only when there genuinely is
none. Daylens never bluffs.

---

## 15. Feature: MCP server (power users)

An opt-in Model Context Protocol server that lets external clients (Cursor, Claude Desktop)
query your local timeline. Off by default; a side feature, not the engine that answers the AI
tab. In packaged builds it ships off and never exposes developer filesystem paths. Plain-English
framing ("what this is and why you'd turn it on," a single clear on/off, "what apps can do with
it"), with raw config behind an Advanced disclosure.

---

## 16. Architecture & data model

### 16.1 Module map and the main seam

Capture writes focus events. Projections turn events into sessions and blocks. AI jobs read
derived data and produce narratives. **The renderer never touches the database or main
services directly — it calls across the IPC seam.**

```
[ Capture ] → focus events → [ Projections (pure) ] → sessions → blocks → threads
                                                          │
                                        one evidence object per block
                                                          │
                  ┌───────────────────────┼───────────────────────┐
              [ Timeline ]            [ Apps view ]            [ AI: plan→resolve→phrase ]
                  └───────────────────────┴───────────────────────┘
                          all read the SAME blocks (one truth, three views)
```

- **The IPC seam.** `src/preload` exposes a typed surface; `src/main/ipc` handles it. The
  single boundary between renderer and main.
- **Projections stay pure and deterministic.** No clock, no randomness, no network inside them.
  Same events in, byte-identical output. The live day is finalized only at rollover.

### 16.2 Process layout (Electron)

- **Main process** (`src/main`) — capture services, projections, AI jobs/orchestration,
  database, IPC handlers, MCP server.
- **Preload** (`src/preload`) — the typed IPC bridge.
- **Renderer** (`src/renderer`) — React 19 + React Router views: Timeline, Apps, Insights (AI
  chat), Settings, Onboarding; the wrap carousel; the mascot.
- **Shared** (`src/shared`) — types and pure helpers shared across processes (voice, humanize,
  block labels, domain policy, system noise, summary voice, etc.).
- **Native helpers** (`src/native`) — platform capture helpers (macOS/Windows).

### 16.3 Key main-process modules (representative)

- **Capture:** `focusCapture.ts`, `processMonitor.ts`, `browserContext.ts`, `tracking.ts`,
  `trackingHistory.ts`, `trackingPermissions.ts`, `backgroundProcessEvidence.ts`,
  `windowsFocusCapture.ts`, `windowsHistory.ts`; passive presence in `lib/passivePresence.ts`.
- **Browser registry (OS-detected):** `browserRegistry.ts`, `linuxBrowserRegistry.ts`,
  `windowsBrowserRegistry.ts`.
- **Projections / blocks:** `core/projections/chunk2.ts` (+ `chunk2Label.ts`, `invalidation.ts`,
  `metadata.ts`), `workBlocks.ts` (block assembly + `enforceMinimumBlockFloor`),
  `blockCorrections.ts`.
- **AI (plan→resolve→phrase):** `ai/planner.ts`, `ai/resolvers.ts`, `ai/phrase.ts`,
  `ai/converse.ts`, `ai/actions.ts`, `ai/memoryWrite.ts`, `ai/citations.ts`,
  `ai/voiceContract.ts`, `ai/dayRegroup.ts`; engine `jobs/aiService.ts`; orchestration
  `aiOrchestration.ts`; provider clients for Anthropic/OpenAI/Google + CLI passthrough.
- **AI jobs:** appCategory, appNarrative, blockInsight, chatAnswer, daySummary,
  eveningConsolidation (`jobs/eveningConsolidation.ts`), focusIntent, reportGeneration,
  weeklyBrief. Usage metered into `ai_usage_events`, priced via `shared/aiPricing`;
  Anthropic prompt caching in `anthropicPromptCaching.ts`.
- **Wraps:** `wrappedNarrative.ts`, `wrappedPeriodNarrative.ts`, `daySnapshots.ts` (frozen
  snapshots).
- **Memory & attribution:** `workMemory.ts`, `workMemoryProfile.ts`, `attribution.ts`,
  `core/query/attributionResolvers.ts`.
- **Recall / search:** `naturalSearch.ts`, `searchTerms.ts`, FTS tables.
- **Billing:** `billing.ts` + a separate `services/billing` proxy server.
- **Platform & infra:** `database.ts`, `secureStore.ts` (keychain via keytar), `updater.ts`,
  `analytics.ts` (PostHog, opt-in), `commandPalette.ts`, `mcpServer.ts`, `syncUploader.ts`.

### 16.4 Data store

- A single local **SQLite** database (`daylens.sqlite`, via `better-sqlite3`) in the OS
  userData dir. API keys live in the OS keychain (keytar), not the DB.
- **Hierarchical rollups for scale:** a day finalizes into a **frozen snapshot**; a week sums
  seven frozen days; a month sums weeks; a year sums months. A yearly wrap reads ~12 small
  summaries, never millions of events.
- **Retrieval, not context, for recall:** full-text search tables (`website_visits_fts`,
  `app_sessions_fts`, `artifacts_fts`) are the RAG layer for "that link about aliens."
- Same rule at every scale (one day or two years): resolve a small, true set of facts, then let
  the model phrase them. You never put a year of events in a context window.

> **Schema simplification is an explicit goal.** The legacy schema had five overlapping notions
> of "a block" (`timeline_blocks`, `derived_blocks`, `work_sessions`, `activity_segments`,
> `app_sessions`) and 60+ tables, with giant files (`aiService.ts` ~6,100 lines, `workBlocks.ts`
> ~5,500). The through-line that pays this back: **one evidence object per block, read by every
> surface.** A clean rebuild should target that, not reproduce the sprawl.

### 16.5 AI providers

- Backends behind a common interface: **anthropic**, **openai**, **google**, and **cli**.
- **Provider mode / CLI passthrough:** a job either hits a paid API or runs the user's local
  `claude` or `codex` CLI (CLI passthrough costs Daylens nothing).
- Models are user-configurable, not hardcoded per job; defaults live in `services/settings.ts`.
- Default to the latest, most capable models.

### 16.6 Tech stack

- **Runtime:** Electron 34, Node, TypeScript.
- **UI:** React 19, React Router 7, Tailwind CSS 4, lucide-react icons.
- **Data:** better-sqlite3, electron-store.
- **AI SDKs:** `@anthropic-ai/sdk`, `openai`, `@google/genai`, `@modelcontextprotocol/sdk`.
- **Capture:** `@paymoapp/active-window` + native helpers.
- **Secrets:** keytar (OS keychain). **Telemetry:** Sentry (errors), PostHog (opt-in product
  analytics). **Updates:** electron-updater.
- **Build:** Vite + Electron Forge / electron-builder; targets macOS (dmg/zip, Homebrew cask),
  Windows (NSIS/appx), Linux (AppImage/deb/rpm/tar.gz).

### 16.7 Platform support

Cross-platform desktop. macOS is the lead platform (Accessibility-based title capture, Apple
Silicon Homebrew cask). Windows and Linux have their own capture/history/browser-registry
paths and surface QA checklists.

---

## 17. The two architecture decisions (ADRs)

- **ADR 0001 — A day is blocks grouped into threads.** Model a day in two levels (block =
  contiguous intent; thread = persistent goal). Sessions → blocks → threads. "Episode" is
  retired; "block" is canonical. Code owns time/duration/evidence/hard-constraints; AI proposes
  subject/title/relationships; a validator decides whether an AI proposal is evidence-supported
  before it's stored. The founder day must render as ~8 believable blocks, not 53.
- **ADR 0002 — How the AI gets data: plan → resolve → phrase.** The agentic tool-loop is
  **deleted, not patched.** The model may select, parameterize, and phrase resolvers; it may
  never execute or loop. Resolvers are declared once, typed, and read the same store as the
  Timeline/Apps views, so the AI cannot disagree with them. New question types = add a resolver.

---

## 18. Non-goals (what Daylens is NOT)

- **Not a grader.** No Score, Focused, Drift, "X% of your day," or guilt. It shows the day; it
  does not score it.
- **Not a screen recorder.** Metadata only — no screenshots, no video, ever.
- **Not a cloud product.** Local-first; only resolved facts for a single answer ever leave the
  machine, and only when the user asks.
- **Not a guesser.** It says what the evidence proves; when it doesn't know, it says so.
- **Not a dashboard or report.** Recaps and wraps are stories with a voice, not chart dumps.
- **Not an app-logger.** Blocks are named for the work, never for the app, file, repo, or tab
  title.

---

## 19. Quality bar (what "done" means)

- **Green tests are the floor, not the proof.** Typecheck must pass; tests passing does not
  mean a feature works. The only proof is the running app on a real day.
- **Fix the foundation, not the symptom.** When something reads wrong on screen, the cause is
  usually a layer down (capture → blocks → naming → words). Diagnose bottom-up against the real
  data before touching code.
- **The founder's only job is to test.** Only the founder marks something done, after a real
  day's use.
- **Token-spending commands need explicit approval** (behaviour tests, AI benchmarks,
  report/wrap regeneration, memory backfills).

---

## 20. Build order

Build one surface at a time and prove each on a real day/week/month before the next. The
foundation comes first, because everything is downstream of it:

1. **Capture the truth** — reliable window-title capture (Accessibility), OS-detected browsers,
   files; one clean evidence object per block.
2. **Timeline** — the block engine (boundaries, 15-min floor, proportional height, tiered
   naming), the live/provisional view, Analyze Day, the recap panel.
3. **Apps** — the same blocks filtered to one app; real detail with no AI; correct domain
   attribution; deduped pages; corrections.
4. **AI chat** — plan→resolve→phrase, the resolver set, recall, attribution, formats &
   transforms, chat state, then actions & widgets.
5. **Briefs & wraps** — morning brief notifications, evening wrap, then daily → weekly →
   monthly → annual Wrapped with frozen snapshots and the variation/design engines.
6. **Memory, Settings, Billing, Onboarding, MCP** — woven through, each proven to visibly
   change the rest of the app.

---

## 21. Glossary

- **Capture** — always-on, metadata-only sampling of activity.
- **Focus event** — a single raw observation; the replay log everything derives from.
- **Projection** — a pure, deterministic transform from raw events to derived rows.
- **Session** — a continuous stretch of one app or context.
- **Block** — one contiguous stretch of a single intent, shown on the Timeline. The canonical
  term ("episode" is retired). Apps/sites inside are evidence, not the definition.
- **Live block** — the single in-flight provisional block for today; re-derived each refresh,
  finalized at rollover.
- **Thread** — the persistent goal tying blocks together across gaps or days.
- **Evidence object** — the apps, window titles, sites/URLs/page titles, and files (with
  timing) a block is named, categorized, and narrated from. One object, read by every surface.
- **Boundary correction / merge** — a user override of where blocks split; a merge overrides
  every heuristic cut.
- **Distraction** — activity that deviates from learned patterns (deviation, not a fixed
  blocklist).
- **Entity** — the who/what work is attributed to (clients, projects, apps, aliases).
- **Resolver** — an app-owned, typed data function the AI's planner selects and the app
  executes; the only way the AI tab touches data.
- **Provider / CLI passthrough** — a model backend behind a common interface; passthrough runs
  the user's local `claude`/`codex` CLI at no cost to Daylens.
- **Frozen snapshot** — a finalized day's numbers, frozen so weekly/monthly/annual wraps sum
  them and never disagree.
- **summaryVoice** — the user's chosen voice (Straight / Warm / Witty), flowing to every
  surface that speaks.
- **Wrap** — a Spotify-Wrapped-style recap (daily / weekly / monthly / annual).
- **Lumen** — the friendly camera-lens mascot present in onboarding and as generated wrap art.

---

*Source documents: `PRODUCT.md`, `CONTEXT.md`, `docs/specs/*.md` (timeline, apps, ai,
briefs-wraps, wrapped, voice, settings, billing, memory, work-memory, onboarding, ai-actions),
`docs/adr/0001`, `docs/adr/0002`, `docs/findings.md`. Where this PRD and a spec disagree about
how something sounds, `voice.md` wins; about data access, ADR 0002 wins; about block structure,
ADR 0001 wins.*
