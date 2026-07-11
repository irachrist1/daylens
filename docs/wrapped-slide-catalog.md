# Daylens Wrapped — the slide catalog

> **Status (2026-07-10).** This is the **official catalog**: simultaneously the
> **product spec** for the perfect recap and the **calibration anchor set** for the
> LLM judge that scores AI-written slide lines. It replaces both the original
> Stage-1 catalog and the `wrapped-slide-catalog.v2-draft.md` draft (retired; its
> five open taste calls are resolved in "Resolved decisions" at the end). The
> benchmark anchors in `tests/wrapped-bench/anchors.ts` are distilled from this
> file — keep the two in sync. Read this with [`voice.md`](specs/voice.md) (how
> every word must sound; it wins on any disagreement about *sound*) and the deck
> planner [`src/renderer/lib/wrapDeck.ts`](../src/renderer/lib/wrapDeck.ts) (the
> one contract; every id and every threshold here traces to a real spec there).

---

## The North Star (the bar every example must clear)

A perfect recap does **two things at once and needs both**:

1. It **notices the revealing detail you forgot** — the 22 minutes in Notion, that
   you were three hours in before the standup, that the meeting ran through lunch
   and you built through it. The "how did it know that?" beat.
2. It gives a **complete, honest accounting of where every hour actually went** —
   nothing padded, nothing dropped, the real shape of the day told back to you.
   The "oh, *that's* what today was" beat.

Comprehensive **and** revealing. The persona is a sharp friend who was in the room
all day, forgot nothing, has taste, and tells your day back to you better than you
could. Not a dashboard, not a coach, not a therapist. A record-keeper with taste.

Every example line below is either a **10** (put it in front of the judge as
"this is the ceiling") or a **fail** (put it in front of the judge as "this is the
floor you reject"). There are no 7s in the galleries on purpose; the 7 is defined
once, in the rubric at the end.

---

## How a wrap is assembled (why no two look alike)

A wrap is not a fixed template. It is a **deck assembled from what actually
happened**:

1. `buildDayWrapFacts` / `buildWrappedPeriodFacts` compute ONE reconciled facts
   object from the same trusted timeline blocks the Timeline shows (invariant 7).
2. `planDayWrapSlides` / `planPeriodWrapSlides` (`src/renderer/lib/wrapDeck.ts`)
   turn those facts into an ordered list of **slide specs**. A slide only exists
   if its data cleared a real threshold — thin data never pads.
3. The **middle** of the deck is shuffled by a per-day/per-period seed, so the
   rhythm differs day to day but is stable on reopen.
4. The AI writes **one line per slide id** (plus the question and the reflection).
   Every number is already on the card; the line gives it meaning, it never
   restates or invents one. A line that breaks a guard dies alone and the slide
   shows its deterministic `fallbackLine` — the deck never collapses wholesale.

**The felt arc, both cadences:** Hook → Substance → where it went → the surprise →
the honest close. The middle is seed-shuffled so no two days read in the same
order, but every layer the day *had* gets its beat.

---

## The 9 layers a complete recap covers

A recap is complete when it has touched every layer the day actually contained.
Layers 2, 5, and 8 are **enrichment**: they light up only when a connector
(git, calendar, todos) is present, and today most of them ride *inside* existing
slides' prose rather than owning a card.

| # | Layer | The question it answers | Owns / rides these slides |
| --- | --- | --- | --- |
| 1 | **Substance** | What did you work on? (named as human work) | `opening`, `headline`, `timesink`, `apps`, `thread-0…3`, `threads`, `categories` |
| 2 | **Output** *(enrichment)* | What did you make / ship / finish? | rides prominently in `headline`, `story-*`, `thread-*`, `reflection`; **`shipped` card: not built yet** |
| 3 | **Shape** | The rhythm: when sharp, when it scattered, the arc | `focus`, `split`, `shape`, `bestday`, `worstday`, `bestbucket`, `consistency`, `average` |
| 4 | **Story** | The connected morning→evening narrative | `story-morning`, `story-midday`, `story-evening`, `reflection` |
| 5 | **World** *(enrichment)* | Who / what was around the work? | `meetings` (calendar enriches names) |
| 6 | **Surprise** | What you forgot or didn't notice (baseline deviation) | `forgotten`, `wildcard` |
| 7 | **Context** | How today compares to your usual | `compare`, `average`, `consistency`, `earlystart(s)`, `latenight(s)` |
| 8 | **Intent** *(enrichment)* | Plan vs actual (a written morning intention) | **`plan-vs-actual` card: not built yet**; nothing rides elsewhere until it is |
| 9 | **Human** | The energy / effort texture — WHAT, never WHY | `focus`, `leisure`, `question`; woven through `story-*` and `reflection` |

Alongside the nine layers, **every deck carries one honesty card** — `coverage`,
documented next — that is not a narrative layer at all: it is the seam the whole
product promises to show.

---

## The honesty card — `coverage`  *(DAY + PERIOD; always present; never AI)*

**What it is.** "Here's what this wrap is actually built on": the observed window
("11:15am to 8:04pm on this computer"), the evidence sources that were present
(apps and windows, browser activity, calendar, git commits, focus timers, meeting
notes) and the ones that weren't, and the one-line seam:
*"Time Daylens didn't observe isn't in the story."*

**Why it exists.** The product's entire identity is that it doesn't lie
("wrapped yes or no.md"): a recap that names its blind spots stays honest, and a
thin day must look honestly thin instead of dressed up. This card is that promise
made visible on every single deck.

**How it works.** Deterministic by design — `buildDayCoverageSlide` /
the period coverage spec in `wrapDeck.ts`. The AI **never writes this slide**
(`ask: ''`), so it can never overclaim. It is pinned right after the headline,
outside the shuffle, on both cadences. When connector presence is unknown, the
card lists nothing about connectors rather than falsely claiming they were absent.

**Minimum data.** None — it always appears (that is the point).

There are no "perfect" or "fail" galleries for this card and it is never judged:
there is no prose to score. Its correctness is enforced by ordinary tests, not
the rubric.

---

## How to read a slide entry

Each entry gives:

- **Layer(s) + beat** — which of the 9 it serves, and the one sentence of what
  story it tells and why it matters.
- **Draws from** — the exact `DayWrapFacts` / `WrappedPeriodFacts` fields, the
  enrichment fields, and the **Stage-0 tools** (`src/main/services/wrappedTools.ts`)
  that feed it: `getWindowTitleContext`, `getGitActivity`, `getCalendarEvents`,
  `getDayComparison`, `getLongestFocusStretch`, `getDistractionProfile`,
  `getMostSurprisingFact`.
- **Minimum data** — the real threshold in `wrapDeck.ts`. Below it, the slide does
  not exist. Thin data never pads.
- **Perfect (a 10)** — lines that are the ceiling.
- **Fail** — one or two lines the judge must score low, with *why*.
- **Role variants** (core slides only) — the same beat across roles so the recap
  reads role-aware: **TECH/FOUNDER**, **ACCOUNTING/FINANCE** (calendar-heavy, few
  commits), **CONSULTING**, **STUDENT**, **CREATOR/DESIGNER**.

**Role note.** The role comes from **what the person selected during onboarding**
(`userRole`, delivered to the writer via `userProfileDirective`) — never inferred
from which apps they used (naming "the reconciliation" for someone who merely
opened Excel would be an invented fact). When no role was set, the directive
simply omits it and the recap falls back to a **plain, neutral tone that assumes
no profession** — it names the surfaces and shapes it can see, nothing more.

**Time-of-day note.** Time-of-day words — morning, midday, afternoon, evening,
night, noon, midnight — are ordinary English. None is banned, none is forced;
the only rule is that whatever is said **matches when things actually happened**.
Mechanically: "noon" and "midnight" are precise clock claims (12pm / 12am), so
the grounding validator treats them like any clock time — they must appear in
that slide's own facts. "Midday", "morning", "the evening" are part-of-day words
and free prose. (This supersedes the draft-era "midday vs noon" ban both ways.)

**Emoji note.** Emoji are used when they genuinely fit the moment — earned,
occasional, never forced onto every slide and never banned. The legal set is
🏆 🔥 🌙 ☕ 🎯 ✨, at most one per line, only at the very end of a line, and the
deck contract keeps it to at most one line per deck carrying one. In the
galleries below an emoji appears on more than one slide only because each slide
is shown in isolation as "here is where one *could* be earned"; a real deck
keeps zero or one.

**The two negative anchors that apply everywhere** (memorize these; most fails are
a flavor of one):

- **The vague-hype fail:** "Today was a productive and focused day with lots of
  great work in Cursor." — vague, hype, uses a banned word ("focused"/"productive"),
  and names the tool where it should name the work. Score 0–2.
- **The card-restate fail:** "You spent 6h 40m working and had 2 meetings." — robotic,
  restates the card, invents a meeting *count* the facts don't hold, adds no read.
  Score 0–3.

---

# LAYER 1 — SUBSTANCE

*What you worked on, named as human work. The spine of "where every hour went."*

## `opening` — the one-line read  *(DAY + WEEK)*

**Layers 1 + 3.** The hook. One punchy, honest sentence naming the *one real thing*
that defined the day (or the true shape of it), no numbers. It is also the
notification one-liner, so it has to earn the open. Serves Substance (names the
work) and Shape (the arc).

**Draws from.** `activeSeconds`, `workSeconds`, `leisureSeconds`, `isLeisureDay`,
`workActivities[0]` (→ `workActionPhrase`); week: `daysWithActivity`, top thread.
No tool required; `getGitActivity` / `getCalendarEvents` can sharpen the named thing.

**Minimum data.** Always present once `quality` is `partial` or `full`.

**Perfect (a 10)** — *core slide, shown across roles:*

- **TECH/FOUNDER:** "A maker's morning that set the whole tone, then the day opened
  up after the design review. The tracking engine quietly won the day."
- **ACCOUNTING/FINANCE:** "The close swallowed the morning, and once the
  reconciliations balanced the afternoon finally had room to breathe."
- **CONSULTING:** "Two discovery calls before lunch, then the whole afternoon
  disappeared into the client deck."
- **STUDENT:** "A slow start, then the problem set caught fire around midday and
  didn't let go until dinner."
- **CREATOR/DESIGNER:** "The thumbnail fought you all morning, then the edit
  clicked after lunch and carried the rest of the day."
- **No role set (neutral):** "One document owned the morning, and the afternoon
  scattered into a dozen smaller things."

**Fail.**

- "Today was a productive and focused day with lots of great work." — vague, hype,
  banned words, no shape. *(0–1)*
- "You had a busy day with several activities across multiple apps." — dashboard
  voice, names nothing, no one real thing. *(1)*

---

## `headline` — the day (or period) in one number  *(DAY + WEEK)*

**Layers 1 + 3.** The single big number (total active time), count-up animated. The
card already shows the number; the line must **add a read the number can't say** —
where the weight sat, the work that filled it — and must never restate the total,
say "tracked across the day," or imply the day ran to midnight off a pre-dawn tail.

**Draws from.** `activeSeconds`/`totalSeconds`, `mainStartClock`, `ribbonEndClock`,
`dayStory` (spillover awareness), top thread. Tools: `getDayComparison` can later
color "a long one"; `getGitActivity` / `getCalendarEvents` sharpen where the weight
sat. **A clock time is allowed here** only because `mainStartClock`/`ribbonEndClock`
are this slide's own facts.

**Minimum data.** Always present on a `full`/`partial` day (or a period with activity).

**Perfect (a 10)** — *card shows `6h 40m`; core slide, across roles:*

- **TECH/FOUNDER:** "Most of it stacked up before lunch, when the tracking engine
  took your two best hours in one sitting."
- **ACCOUNTING/FINANCE:** "The front half of the day was almost all the month-end
  close, before a single client call broke it up."
- **CONSULTING:** "Two thirds of it was the client deck, and it all landed in one
  long afternoon push."
- **STUDENT:** "Most of that was the problem set, and nearly all of it came after 3pm
  once the lectures were done."
- **CREATOR/DESIGNER:** "The edit carried the bulk of it, one long uninterrupted run
  from midday on."

**Fail.**

- "You tracked 6h 40m today." — restates the number on the card. *(0)*
- "6h 40m, tracked across the day from start to finish." — the exact banned filler,
  and implies an all-day span. *(0–1)*

---

## `timesink` — where the most time pooled  *(DAY + WEEK)*

**Layer 1.** The single surface that held the most time, framed honestly given its
category: the work, or the leak. **This is one of the two slides where naming the
tool IS the point** (`apps` is the other). No scold, no cheer.

**Draws from.** `appSites[0]` (day, `kind !== 'other'`) / `topApps[0]` (week), with
`name`, `seconds`, `category`. Tool: `getDistractionProfile` informs the honest
work-or-leak read.

**Minimum data.** Day: a named app/site with **≥ 20 min** (and not `other`). Week:
top app with **≥ 45 min**.

**Perfect (a 10):**

- **TECH/FOUNDER:** "Claude Code held more of the day than anything else, and on a
  build day that reads as the work, not the leak."
- **ACCOUNTING/FINANCE:** "Excel pooled the most time by a wide margin, which for a
  close week is exactly where it should be."
- **CREATOR/DESIGNER:** "Premiere took the biggest share, and most of that was one
  continuous cut, not scrubbing back and forth."
- **STUDENT:** "YouTube pooled the most minutes today, and some days the break is
  the headline. No spin on it."

**Fail.**

- "You spent the most time in Excel." — no read on what it means, restates the card.
  *(1–2)*
- "Excel was your biggest distraction at 3h 12m." — "distraction" is banned, and a
  reconciliation tool is the work, not the leak. *(0)*

---

## `apps` — where the time went (the one chart)  *(DAY + WEEK)*

**Layers 1 + 3.** The app/site distribution chart — the one place a chart *is* the
point. Slices reconcile to the headline exactly. The line is ONE short caption that
reads the **shape** (concentrated in one or two tools, or spread thin) and names at
least one real app. Never adds up or compares the bar values numerically; the chart
already shows the sizes. Naming tools is allowed and expected here.

**Draws from.** `appSites[]` (day) / `topApps[]` top 6 (week). No tool required.

**Minimum data.** **≥ 2** app/site slices.

**Perfect (a 10):**

- "Two tools carried the day and everything else was a rounding error. Cursor and
  Claude Code, back to back."
- "A short, deep list. You lived in Figma and barely touched anything else."
- "The day lived in a handful of tools: Excel for the reconciliations, Outlook for
  the back-and-forth, and the GL system underneath it all."
- "Spread wide today. The slides, the spreadsheet, and the inbox all took a real
  slice, the mark of a day pulled in several directions."

**Fail.**

- "Cursor 2h, Claude Code 1h, Safari 40m, Slack 20m." — restates the chart. *(0)*
- "Figma was bigger than Slack and Notion combined." — does the arithmetic the chart
  already shows, and voice bans it. *(0–1)*

---

## `thread-0…3` — the thread deep-dives  *(WEEK)*

**Layers 1 + 2.** The biggest named threads each get their own card: what that
commitment actually looked like across the week. Two cards for a week, four for a
month/year. This is where **output enrichment** rides — git tells you *what shipped*
under the thread, not just how long it ran.

**Draws from.** `threads[]` (`subject`, `seconds`, `daysActive`; raw artifact labels
filtered by `looksLikeRawArtifactLabel`). Tool: `getGitActivity` enriches the thread
with what was actually built/shipped.

**Minimum data.** A clean-named thread exists (raw file/artifact labels rejected).

**Perfect (a 10):**

- **TECH/FOUNDER (thread-0):** "The tracking engine was the week: about twelve hours
  across four days, and every other thread bent around it. It ended with the
  midnight-split bug finally closed."
- **CONSULTING (thread-0):** "The client deck was the spine of the week, close to
  fourteen hours, rebuilt twice before the Thursday readout."
- **ACCOUNTING/FINANCE (thread-1):** "The other constant was the audit workpapers,
  about three hours that kept resurfacing between the bigger blocks."
- **STUDENT (thread-1):** "The dissertation reading was the quiet second thread,
  a couple of hours at a time, four days out of five."

**Fail.**

- "Thread 1 was Malaria_Notebook.ipynb, 12h." — raw artifact label, restates. *(0)*
- "You worked on the deck a lot this week." — names nothing real, no duration, no
  shape. *(1)*

---

## `threads` — the thread chart / `categories` — the work by kind  *(WEEK)*

**Layer 1.** `threads` ranks the week's real threads as bars; `categories` names what
*kind* of work dominated (coding / writing / design / admin). One caption on what the
ranking says, as a story, never the list restated and never invented percentages.

**Draws from.** `threads[]` top 5; `categories[]` (→ `humanCategoryWord`). No tool.

**Minimum data.** `threads` ≥ 2 clean threads; `categories` ≥ 2 kinds and
`workSeconds > 0`.

**Perfect (a 10):**

- (threads) "One thread towered and the rest were the supporting cast."
- (threads) "Two threads split it evenly: the proposal early, the network build
  late, about nine hours each."
- (categories, TECH) "This was a building week, not a writing one. The design and
  admin were just what kept it moving."
- (categories, CONSULTING) "Mostly slide work and calls this week. The analysis was
  the thin layer underneath both."

**Fail.**

- "Coding 60%, design 25%, admin 15%." — invents percentages not on the card. *(0)*
- "Your threads were pipeline, Claude, design, admin." — restates the chart. *(0–1)*

---

# LAYER 2 — OUTPUT *(enrichment)*

*What you MADE, shipped, finished. Verified output is the most satisfying true
thing a recap can say — and the easiest place to lie, so it carries the strictest
evidence rule in the catalog.*

**What ships today (built, live).** When the git connector has real evidence —
commits by the configured author, PR activity from the user's own authenticated
`gh` — the sanitized `shipped` enrichment (projects, exact counts, humanized
highlights) is handed to the writer, and the prompt requires it to land
**prominently in at least one main slide** (the headline read, the story beat it
happened in, or the reflection) — never buried in a footnote. The count guard
(`enrichmentAllowedCounts`) kills any commit/PR count the connector didn't hand
over, so output is never guessed or inflated. On a day with no verified output,
the recap simply says nothing about output — silence, not a guess. This is
enforced deterministically: completion words ("finished", "shipped", "is done",
"crossed the line", …) are legal in a line ONLY when the day's facts carry
verified output (git shipped / recorded meeting notes); otherwise the guard
rejects the line outright (`findUnverifiedCompletionClaim`).

## `shipped` — what you finished  *(NOT BUILT YET — proposed card, DAY + WEEK)*

> **Not built yet.** There is no `shipped` id in `wrapDeck.ts` and no card in the
> running app; today Layer 2 ships only as the cross-slide prose behavior above.
> This entry is the locked contract for the card **if and when** it is built.
> **Gate:** at least one real, *confirmed* artifact of output the connector
> actually attests — a merged PR, N commits with a coherent subject, a doc marked
> done, a sent deliverable. **Never guessed, never implied** from app time ("3
> hours in Figma" is not a shipped design). Without a connector that resolves
> *output* (not just time), this card does not appear, and its absence is silent —
> a day of real effort with no shippable artifact is process, not failure, and the
> effort still shows up in Shape and Story.

**Layer 2.** The single most satisfying beat a recap can land: not "you spent time
on X" but "X now exists." It closes the loop between effort and result. It names the
*thing made*, never the tool, and never inflates (only what the connector actually
handed over — no invented records, per voice.md §5 and §16).

**Draws from (when built).** `getGitActivity` (commits, PRs, merges, diff subjects),
future doc/design/send connectors. Minimum viable: git commit count + merged-PR
titles resolved to human work.

**Minimum data (when built).** ≥ 1 concrete, confirmed, finished artifact resolvable
to human work. No artifact → no card, silently.

**Perfect (a 10)** — *across roles:*

- **TECH/FOUNDER:** "Eleven commits and the midnight-split fix merged before lunch.
  The bug that had been quietly wrong for weeks is closed. 🎯"
- **ACCOUNTING/FINANCE:** "The Q2 books closed today. Every reconciliation balanced
  and the pack went out to the partners."
- **CONSULTING:** "The client deck went out. Twenty-two slides, the readout version,
  sent an hour before the call."
- **STUDENT:** "The essay is done and submitted. Two thousand words that were a blank
  page this morning."
- **CREATOR/DESIGNER:** "The video is cut and exported. Nine minutes, the version
  you'll actually publish, rendered by evening."

**Fail.**

- "You made great progress on your project today." — vague, hype, names no artifact.
  *(0–1)*
- "You wrote 11 commits and pushed them to GitHub." — robotic, names the plumbing
  ("commits," "GitHub") instead of the work that shipped. *(1–2)*
- "You shipped a record number of commits today." — invents a superlative the
  connector never provided. *(0, accuracy gate)*
- "You probably finished the deck, given the hours." — output guessed from app
  time. The one unforgivable failure for this layer. *(0, accuracy gate)*

---

# LAYER 3 — SHAPE

*The rhythm of the day: when it was sharp, when it scattered, the arc. Half of the
"honest accounting" mandate lives here.*

## `focus` — the longest unbroken stretch  *(DAY + WEEK)*

**Layers 3 + 9 + 1.** The single longest unbroken block: when it started, what it
was, that nothing broke it. One of the most interesting facts of any day, and the one
place earned pride is welcome. Serves Shape (the rhythm's peak), Human (the effort
texture), and Substance (names the real work). **Clock time allowed** (`startClock`
is this slide's fact).

**Draws from.** `standout` (day: `seconds`, `startClock`, `endClock`, `name`) /
`longestStretch` (week: `+ dayLabel`). Tools: `getLongestFocusStretch`,
`getWindowTitleContext` (→ `titleContext`) adds the depth under "two and a half
hours in Cursor."

**Minimum data.** Day: a `standout` exists (a real unbroken work stretch). Week: a
`longestStretch` exists.

**Perfect (a 10)** — *card shows `2h 28m`, `7:12am to 9:40am`:*

- **TECH/FOUNDER:** "From 7:12am you stayed with the tracking engine for two and a
  half hours without surfacing, your longest unbroken run of the day. 🔥"
- **ACCOUNTING/FINANCE:** "The reconciliations held you for two and a half hours
  straight from 7:12am, before a single email got a reply. Nothing broke it."
- **CONSULTING:** "The deck took your deepest run of the day, two and a half hours
  from 7:12am with no calls cutting in."
- **STUDENT:** "Two and a half hours on the problem set from 7:12am, not a single
  switch away. The cleanest stretch of the day."
- **CREATOR/DESIGNER:** "One unbroken cut from 7:12am, two and a half hours in the
  edit before you came up for air. 🔥"

**Fail.**

- "Your longest stretch was 2h 28m." — restates the stat, no meaning. *(0)*
- "You focused for 2h 28m without any distractions." — "focused"/"distractions"
  banned; robotic. *(0)*

---

## `split` — the honest split (work vs leisure)  *(DAY + WEEK)*

**Layer 3.** The real work-to-leisure ratio, framed without judgment. **The ONE slide
where the line may speak exact percentages**, and only the two the card shows. This
is the "no guilt over breaks" slide: leisure is accounted for, never scored — and
never *defended* either ("earned", "deliberate", "not drift" are all bans; rest
needs no lawyer).

**Draws from.** `workSeconds`, `leisureSeconds`, largest-remainder percentages
(`largestRemainderPercentages`). No tool.

**Minimum data.** Both work AND leisure **> 0**.

**Perfect (a 10)** — *card shows `88 / 12`:*

- "Nearly all of it was the build, with just enough off the clock to not fry.
  88% to 12%."
- "A heads-down ratio: 88 to 12. The kind of day where the work crowded almost
  everything else out."
- "88% on the books, 12% off them, and the off hours sat at the end of the day
  where they belonged."

**Fail.**

- "You were 88% productive today." — turns a split into a grade; "productive" banned.
  *(0)*
- "88% work, 12% wasted on breaks." — "wasted" banned, guilt over a break. *(0)*
- "88% work, and the 12% off was earned." — defends rest; rest needs no defense.
  *(1–2)*

---

## `shape` — the silhouette / `bestday` / `worstday` / `bestbucket` / `consistency` / `average`  *(WEEK)*

**Layer 3 (with 7).** The period's rhythm made visible: the per-day/per-bucket bars
(`shape`), the fullest day given its due (`bestday`), the lightest day said without
judgment (`worstday`), the biggest sub-period by name (`bestbucket`, month/year),
how many days you showed up (`consistency`), and the typical day (`average`).
Together they are the honest accounting at period scale.

**Draws from.** `buckets[]`, `busiestBucket`, `busiestDay`, `quietestActiveDay`,
`daysWithActivity`, `totalSeconds / daysWithActivity`. No tool required.

**Minimum data.** `shape` ≥ 2 buckets; `bestday` a busiest day; `worstday` a distinct
quietest day **and ≥ 3 active days**; `bestbucket` `period !== 'week'` and ≥ 2 buckets;
`consistency` week and ≥ 2 active days; `average` ≥ 3 active days.

**Perfect (a 10):**

- (shape) "Sunday was the mountain and Wednesday the valley. The rest held a steady
  line."
- (shape) "Front-loaded and honest about it: Monday and Tuesday did the heavy
  lifting, the rest was follow-through."
- (bestday) "Sunday carried the week, and it was the day the proposal finally moved
  from notes to a draft."
- (worstday) "Wednesday was the exhale, and the week was better for it."
- (consistency) "Seven of seven. You didn't take a day fully off this week."
- (average, FINANCE) "About 7h 35m on a working day, which for a close week is full
  without being punishing."
- (average, CONSULTING) "Close to six hours on a working day, the pace of a delivery
  week rather than a pitch week."
- (bestbucket) "The second week did the heavy lifting, nearly a third of the whole
  month in seven days."

**Fail.**

- "Wednesday was your worst day." — "worst" as a verdict; no honesty, just judgment.
  *(1)*
- "Here are your daily totals." / "Your average was 7h 35m per day." — restates the
  chart / the card. *(0)*
- "Sunday carried the week, more than any two other days combined." — arithmetic
  across bars the facts never stated. *(0–1, accuracy gate)*

---

# LAYER 4 — STORY

*The connected morning→evening narrative. The heart of the wrap: a friend who was
there, walking you through your own day.*

## `story-morning` / `story-midday` / `story-evening`  *(DAY; dynamic beats)*

**Layers 4 + 1 (+ 2, + 5 via enrichment).** Each real part of the day, narrated in at
most two sentences: names the one or two things that mattered (never all, never a
list), connects the beats, owns a leisure aside with one kind clause, weaves in git
(*what shipped*) and calendar (*the meeting that broke it*) when present. A pre-dawn
sliver is its own "last night's tail" beat, framed as winding down, never as starting
the day. **Clock time allowed** (each segment's `clockStart`/`clockEnd` are its facts).

**Draws from.** `dayStory[]` (`DayStorySegment`: `label`, `part`, `clockStart`,
`clockEnd`, `items` [humanized work actions], `aside`, `spillover`, `seconds`). Tools:
`getWindowTitleContext` (depth), `getGitActivity` (the shipped clause),
`getCalendarEvents` (the meeting that anchors a beat).

**Minimum data.** A segment appears only if it holds nameable activity (`items.length > 0`).

**Perfect (a 10)** — *core slide, across roles (morning beat):*

- **TECH/FOUNDER:** "You were on the tracking engine from the first coffee, fixing
  the midnight day-split that had been quietly wrong for weeks. By the standup at 9
  you'd already closed it."
- **ACCOUNTING/FINANCE:** "The morning was all the month-end close, one account at a
  time, until the trial balance finally tied out just before the 10am partner call."
- **CONSULTING:** "You opened with two back-to-back discovery calls, then went
  straight into the deck while the notes were still fresh."
- **STUDENT:** "The morning went to the 9am lecture and the reading after it, and you
  were still underlining when the second class started."
- **CREATOR/DESIGNER:** "You spent the morning wrestling the thumbnail, three
  versions before one held, then finally opened the edit just before lunch."

*Midday / evening (for range):*

- **midday (TECH):** "The design review at midday reset the plan, and you were back
  on the engine the moment it ended, no wind-down."
- **evening (STUDENT):** "By evening it was cleanup, the bibliography and a last
  read-through, then a long YouTube tail that reads like a breather after a heavy
  day."

**Fail.**

- "In the morning you used Cursor, Claude Code, and Chrome." — names the plumbing,
  lists, no story. *(0–1)*
- "Morning: 3h. Afternoon: 2h. Evening: 1h." — timestamps, not narration. *(0)*

---

## `reflection` — the closing message  *(DAY + WEEK)*

**Layers 4 + all.** The finale paragraph, written like a text you'd send someone at
the end of their day. 3–5 sentences that *synthesize* every layer the day had:
substance, the arc, the one thing shipped, the surprise, the honest ratio. Warm,
specific, grounded, no advice, no prediction, no hype. This is the slide where Output
enrichment most naturally rides today.

**Draws from.** the whole facts object (`narrative.reflection`). All tools feed it
indirectly.

**Minimum data.** Always present.

**Perfect (a 10)** — *core slide, across roles:*

- **TECH/FOUNDER:** "You put in about seven hours and nearly all of it went to the
  tracking engine, which finally closed the midnight-split bug before lunch. The
  morning was the cleanest part, one long unbroken run before the design review. You
  took the evening slower and that's fair. A good, honest day of building."
- **ACCOUNTING/FINANCE:** "About seven hours, and the month-end close was the whole
  spine of it. The reconciliations tied out by early afternoon and the pack went to
  the partners after. A couple of calls broke it up but never derailed it. The kind
  of day that leaves the close further along than it found it."
- **CONSULTING:** "Close to seven hours, and the client deck took most of them. Two
  discovery calls in the morning fed straight into it, and it went out an hour before
  the readout. A heads-down day with a clear finish line, and you hit it."
- **STUDENT:** "About seven hours once the lectures were done. The problem set was the
  real work, one long stretch in the afternoon that did most of it, and the essay went
  in before dinner. A day that started slow and ended with two things off your plate."
- **CREATOR/DESIGNER:** "Seven hours, most of it in the edit once the thumbnail
  finally stopped fighting you. The cut came together in one long afternoon run and
  the video is exported. A day that looked stuck at first and wasn't by the end."

**Fail.**

- "Great job today! Keep up the momentum and crush it tomorrow!" — hype, prediction,
  therapy, names nothing. *(0)*
- "You worked 6h 40m, had 2 meetings, and used 8 apps." — a stat dump, not a message.
  *(0–1)*

---

# LAYER 5 — WORLD *(enrichment)*

*Meetings, and who/what was around the work. Calendar-fed.*

## `meetings` — in meetings and calls  *(DAY + WEEK)*

**Layer 5.** Meeting time as its own beat, separating deep work from talking. Plain
and factual. **Never states HOW MANY meetings** unless calendar is connected and the
count is a real fact — the base facts only know total meeting *time*. When calendar is
connected, the specific meeting that mattered can be named — always as what the
calendar *held*, never as attendance the data can't prove.

**Draws from.** `meetingsSeconds` (block span). Tool: `getCalendarEvents` enriches
with real event names/durations when calendar is connected.

**Minimum data.** **≥ 30 min** of meetings-category time.

**Perfect (a 10):**

- **TECH/FOUNDER:** "About an hour went to calls, and the design review was most of
  it. The rest of the day stayed clear for the build."
- **ACCOUNTING/FINANCE:** "Close to two hours in meetings, the partner review and two
  client check-ins, which for close week is a light talking load."
- **CONSULTING:** "Both discovery calls ran back to back before lunch, which is why
  the afternoon had room for the deck."

**Fail.**

- "You had 3 meetings today." — invents a count the base facts don't hold (no
  calendar). *(0, accuracy gate)*
- "You spent 1h 4m in meetings." — restates the card, no read. *(1–2)*

---

# LAYER 6 — SURPRISE

*What you forgot or didn't notice. Baseline deviation. The "how did it know that?"
beat.*

## `forgotten` — you probably forgot this one  *(DAY + WEEK)*

**Layer 6.** A real surface that took meaningful time without ever being a headline —
the "oh right, that" moment. The purest expression of the North Star's revealing half.
Names the surface and the duration; **no clock time** (it isn't one of this slide's
facts) and no invented reason it happened. (The *kicker* says "probably"; the line
itself never speculates — the overclaim guard kills "probably"/"likely" in prose.)

**Draws from.** `appSites` ranked outside top 3, `kind !== 'other'`, ≥ 10 min (day) /
`topApps` outside top 3, ≥ 20 min (week). Tool: `getMostSurprisingFact` (`forgottenApp`).

**Minimum data.** A 4th+ ranked app/site clearing the floor.

**Perfect (a 10)** — *core slide, across roles:*

- **TECH/FOUNDER:** "Notion quietly ate 22 minutes, notes you opened once and never
  closed."
- **ACCOUNTING/FINANCE:** "A forgotten half hour in DocuSign today, buried between the
  bigger blocks, signatures chased in the margins."
- **CONSULTING:** "You spent more time in the expense tool than you'd guess, about 20
  minutes, none of it the work you'd remember."
- **STUDENT:** "Eighteen minutes in the citation manager you'll swear you never
  opened. It adds up between the reading."
- **CREATOR/DESIGNER:** "A quiet 25 minutes in the stock-footage tab, hunting one
  clip, never the main event."

**Fail.**

- "You also used Notion today." — no surprise, no time, no life. *(1)*
- "You wasted 22 minutes in Notion." — "wasted" banned; assigns a verdict the app
  can't see. *(0)*

---

## `wildcard` — and one more thing  *(DAY)*

**Layer 6 (+ 7).** The signature "huh, neat" moment: one spontaneous, surprising,
TRUE thing that changes every day. The seed picks which computed candidate hook leads,
so one slide has several possible faces. **The contract (fixed 2026-07-10):** anchor
the line in the hook's concrete value or the real activity, give it meaning by tying
it to ONE other real, *named* fact of the day, use a part-of-day word rather than a
bare clock time, and add **no comparison or consistency claim the hook itself didn't
state**.

**Draws from.** `wildcardHook` (chosen from `candidateHooks[]`). Tool:
`getMostSurprisingFact`.

**Minimum data.** At least one candidate hook cleared its floor.

**The faces (only one appears):**

- **longestStretch:** "Your deepest single run today was that unbroken morning block
  on the grant application, and nothing else came close."
- **peakWindow:** "Your best stretch was the morning, and it went to the edit. The
  afternoon never quite matched it."
- **earlyBird:** "Most of the real work was done before midday, almost all of it the
  close."
- **nightOwl:** "The evening did the heavy lifting on the proposal. You found a
  second gear after 8."
- **count:** "You came back to the proposal seven separate times today, and the day kept
  circling back to it."
- **topApp juxtaposition** *(only when the hook itself states the comparison)*:
  "More time in the editor today than in everything else put together."

**Fail.**

- "Interesting fact: you were productive!" — invented, generic, a score in disguise.
  *(0)*
- "Your best stretch was before 9am, way more than the afternoon and evening
  combined." — adds a comparison it wasn't given. *(0–1, accuracy gate)*

---

# LAYER 7 — CONTEXT

*How today compares to your usual: longer, earlier, a streak, against last time.*

## `earlystart` / `latenight`  *(DAY)* and `earlystarts` / `latenights`  *(WEEK)*

**Layers 7 + 3.** The day's (or week's) edges. Started unusually early, or ran late,
named by the real clock time, observational, never a scold and never a WHY it can't
see. **Clock time allowed** (the edge clocks are these slides' facts).

**Draws from.** Day: `ribbon[0]`/`ribbon[last]` hour, `ribbonStartClock`/
`ribbonEndClock`. Week: `dayEdges[]` (`firstHour`/`lastHour`, `firstClock`/`lastClock`,
`dayLabel`), counts. Tool: `getMostSurprisingFact` (`unusualStart`).

**Minimum data.** Day early: first activity 1–6am. Day late: last activity ≥ 10pm or
< 4am. Week: ≥ 1 day past the edge.

**Perfect (a 10):**

- (earlystart, TECH) "The day started at 6:12am. The house was still quiet and the
  code had the cleanest hours to itself. ☕"
- (earlystart, STUDENT) "5:40am. Whatever pulled you up early, the reading got the
  best of it."
- (latenight) "The last thing you touched landed at 10:26pm. A long one, still in it
  well after dark. 🌙"
- (latenights, WEEK) "Five nights ran past 11, the latest ending at 12:40am Thursday.
  A week that didn't clock out easily."
- (earlystarts, WEEK) "Two days started before 7, the earliest a 5:40am Tuesday that
  got the whole morning to itself."

**Fail.**

- "You stayed up too late working." — scold plus a WHY it can't see. *(0)*
- "You woke up early today." — the app can't see you wake; no real clock. *(0–1)*

---

## `compare` — against last period  *(WEEK)*

**Layer 7.** This period against the previous, framed as arithmetic, never a verdict.
Uses the exact difference the card provides, never a computed one, never a percentage.

**Draws from.** `previousPeriodSeconds`, `totalSeconds`, the exact `delta`. Tool:
`getDayComparison` (day-level analog).

**Minimum data.** `previousPeriodSeconds > 0`.

**Perfect (a 10):**

- "About six hours more than last week, most of that landing on Sunday alone."
- "Almost exactly last week again, within an hour. A steady stretch, not a spike."
- "A lighter week than the one before it by a few hours, and it reads as a breather,
  not a slump."

**Fail.**

- "You improved 12% over last week!" — grade plus invented percentage. *(0)*
- "This week was more productive than last week." — "productive," a verdict. *(0)*

---

# LAYER 8 — INTENT *(enrichment)*

*Plan vs actual: what you wrote down that you meant to do, against what happened.
The layer that turns a recap into accountability without judgment.*

## `plan-vs-actual` — the plan, and the day  *(NOT BUILT YET — proposed card, DAY + WEEK)*

> **Not built yet.** There is no `plan-vs-actual` id in `wrapDeck.ts`, no card in
> the running app, and — as of 2026-07-10 — **no morning-intention field in the
> app yet either** (no schema column, no capture UI); that field is a
> prerequisite. This entry is the locked contract for the card if and when both
> exist. **The plan source is exactly one thing: a plan the person actually and
> explicitly wrote down for that day (the morning intention).** Never a plan
> *derived* from the calendar, never one inferred from habits or history, never
> one invented by the model. On any day with no written intention, this slide
> simply does not appear — no fallback, no guess, just silence.

**Layer 8.** The honest mirror: you wrote "ship the tracking fix and clear the
inbox" in the morning, and the evening recap holds that next to what the day
actually held. States the plan and the actual side by side, no scold when they
diverge (WHAT, never WHY — voice.md §10). A gap is named plainly, never explained,
never graded.

**Draws from (when built).** The written morning intention (field to be added),
reconciled against `dayStory` / `threads` for what actually happened.

**Minimum data (when built).** A written intention exists for that exact day.
None → no card, silently.

**Perfect (a 10)** — *across roles:*

- **TECH/FOUNDER:** "You wrote 'tracking engine' this morning and the morning went
  exactly there. The one thing that slipped was the code review, still sitting
  where you left it."
- **ACCOUNTING/FINANCE:** "The plan was to close two entities today. One tied out,
  the second is a reconciliation short."
- **CONSULTING:** "You'd set the afternoon aside for the deck and it held. The
  client-call prep you also wrote down got the leftover twenty minutes."
- **STUDENT:** "Three things on the morning list. The problem set and the reading
  got real hours, the lab report never came up."
- **CREATOR/DESIGNER:** "You planned to shoot and edit today. The shoot ran long,
  and the edit is the half of the plan the day never reached."

**Fail.**

- "You completed 80% of your planned tasks today." — a grade, a percentage, banned.
  *(0)*
- "You got distracted and didn't finish your plan." — "distracted," a verdict, a WHY
  it can't see. *(0)*
- "You planned to work on the deck." — no *actual* half; states intent alone, no
  comparison. *(1)*
- "Your calendar suggests the plan was deep work until noon." — a plan *inferred*
  from the calendar; the one unforgivable failure for this layer. *(0, accuracy
  gate)*

---

# LAYER 9 — HUMAN

*The energy and effort texture. WHAT, never WHY. Rest counts.*

## `leisure` — off the clock  *(WEEK)*

**Layer 9.** Where the downtime went, one kind, honest line. Rest is allowed and never
apologized for — and never defended either. Naming the leisure surface is fine (it's
the point here), but never "wasted," never a deficit.

**Draws from.** `leisureSurfaces[]`, `leisureSeconds`. No tool.

**Minimum data.** `leisureSurfaces.length > 0` and `leisureSeconds ≥ 30 min`.

**Perfect (a 10):**

- "The downtime was mostly YouTube and Netflix, clustered in the evenings after the
  work was done."
- "A real weekend in there. The downtime pooled into two long evenings and left the
  workdays clean."

**Fail.**

- "You wasted time on YouTube and Netflix." — "wasted," banned. *(0)*
- "You spent 4h 12m on leisure activities." — robotic, restates. *(1)*

---

## `question` — the one curious question  *(DAY + WEEK)*

**Layer 9.** The ONE slide that asks the user something (every other line never asks).
One genuine question the AI is curious about after reading the day, specific to THIS
data, answerable inline. Never a task, never a "should," never homework about tomorrow.

**Draws from.** the whole facts object (`narrative.question`).

**Minimum data.** Always present.

**Perfect (a 10):**

- **TECH/FOUNDER:** "You gave the tracking engine the whole morning. Was it the fun
  kind of hard, or the grinding kind?"
- **CONSULTING:** "The deck came back to life today after two quiet days. What
  unblocked it?"
- **CREATOR/DESIGNER:** "That thumbnail took three tries before it held. Was the third
  one obvious in hindsight, or a lucky swing?"

**Fail.**

- "What will you work on tomorrow?" — prediction / homework, banned. *(0)*
- "Do you think you were productive today?" — invites a self-grade; "productive"
  banned. *(0)*

---

## `finale` — the share card  *(DAY + WEEK)*

**Deterministic-heavy; the AI line is a short close.** The screenshot-perfect summary:
date, headline number, top activities, one signature stat, Daylens watermark. A short
sign-off, no product-speak.

**Minimum data.** Always present.

**Perfect (a 10):** "That's the day. One long stretch, one thing finished." /
"That's the week. One thread, start to finish." / "That's the day. The close is
closed."

**Fail.** "Thanks for using Daylens!" — self-referential product-speak. *(0)*

---

# ACCEPTANCE CRITERIA — the judge's rubric

Every AI-written slide line is scored on four dimensions, **max 10**. The catalog
galleries above are the anchors; this section is the calibration key so the judge can
place a line between them. Interactive/caption slides (`apps`, `shape`, `threads`,
`finale`) are scored on the same axes against the lighter job they do. The
deterministic `coverage` card is never judged (no prose to score).

## Specificity (0–3) — does it name real things?

- **3 (a 10-grade line):** every sentence carries a correct, specific data point from
  *this slide's* facts. *"From 7:12am you stayed with the tracking engine for two and
  a half hours without surfacing."* — real clock, real work, real duration.
- **2 (the 7 floor):** specific, but one clause coasts on generality. *"You stayed
  with the tracking engine for a good while this morning."* — real work, vague time.
- **0 (a fail):** no anchor to the real day. *"You worked hard today."*

## Tone (0–2) — human reflection, or generated report?

- **2 (a 10-grade line):** reads like a thoughtful person who was there. Connective
  tissue, varied rhythm, on-voice. *"Notion quietly ate 22 minutes, notes you opened
  once and never closed."*
- **1 (the 7 floor):** fine but flat, a summary with extra words. *"Notion took 22
  minutes today that weren't part of the main work."*
- **0 (a fail):** robotic, hype, therapy, self-referential, or a bullet dressed as a
  sentence. **Any voice.md §2 non-negotiable broken caps Tone at 0** (em dash, banned
  word, score, hype, apology, self-reference). *"Notion captured 22m of secondary
  engagement."*

## Accuracy (0–3) — do numbers and names match the facts exactly?  *(hard gate)*

- **3 (a 10-grade line):** zero hallucinated or misattributed values; every clock,
  duration, percentage, and name traces to *this slide's* facts. *"88% to 12%"* on the
  slide whose card shows 88/12.
- **1–2 (partial):** correct but a value is imprecise or attributed to the wrong
  thing. *"Nearly 90% work"* when the card says 88% (close, but the slide is the one
  place exact percentages are required).
- **0 (an automatic fail):** **any invented number, time, percentage, name, or count.**
  *"You had 3 meetings"* with no calendar; *"a record number of commits"* the connector
  never gave. The runtime validator strips most of these; a 0 here means the prompt,
  not the guard, must be fixed.

## Narrative forward motion (0–2) — does it tell you something the card can't?

- **2 (a 10-grade line):** adds a genuine read — how the time spread, what the stretch
  meant, a true juxtaposition. *"Most of it stacked up before lunch, when the tracking
  engine took your two best hours in one sitting."* (card just shows 6h 40m.)
- **1 (the 7 floor):** adds a little framing. *"Most of it was before lunch."*
- **0 (a fail):** restates the number already printed. *"You tracked 6h 40m today."*

## Thresholds (the pass bar, unchanged from Stage 1)

- **Per slide:** below **7** fails the suite. Below **8** enters the recursive
  improvement loop until it reaches 8.
- **Deck:** the deck average must be **≥ 9** to pass overall.
- **Accuracy is absolute:** any invented number/name/count is a 0 and a suite failure,
  regardless of how good the prose is.
- **The North Star check (qualitative, per deck):** does the finished deck do *both*
  jobs — did it (a) surface at least one genuinely revealing/forgotten detail
  (`forgotten`, `wildcard`, or a Story beat), and (b) account for where the hours
  actually went (`headline` + `split` + `apps`/`story` reconciling)? A deck that is
  accurate and on-voice but reveals nothing forgotten tops out around 8, not 10.

## The whole-deck judgment (one story, not fifteen lines)

Per-slide scores cannot see the failure the founder actually hits: a deck where
every line passes alone but the deck reads wrong as a whole. After per-slide
scoring, the benchmark judges the ENTIRE deck in order and fails it on any of:

1. **Cross-slide repetition** — the same fact, number, or phrase re-announced on
   more than one slide beyond ONE deliberate callback. The cards may share
   numbers by design (the chart reconciles to the headline); the PROSE may not
   keep re-introducing them.
2. **Broken arc** — the deck must read as one day (or week) told start to
   finish: a hook, the substance in an order that makes sense, an honest close.
   Shuffled rhythm is fine; shuffled STORY is not.
3. **Internal contradiction** — two slides disagreeing about the same fact (a
   morning called quiet on one card and the day's engine on another).
4. **The emoji budget** — more than one emoji across the whole deck (the rule
   above), checked deterministically.

The deck-level pass gates the benchmark exactly like the per-slide scores: a
deck of ten 10s that repeats itself or contradicts itself fails.

## How the judge learns from this catalog

The per-slide anchor sets in `tests/wrapped-bench/anchors.ts` are distilled from
the galleries above and injected into every judge call as "excellent" and
"failing" calibration lines. **Every slide id the planner can emit with an AI ask
has its own set — day and week separately** (the week slides no longer share one
thin set); month and year score against the same period set (the period planner
emits identical slide ids for all three cadences); the dynamic families
(`story-*`, `thread-0…3`) each share one family set by design. `tests/wrapAnchors.test.ts` enforces that coverage, and also that
no "perfect" anchor would itself be killed by the deterministic runtime guards
(a line the writer can never ship must never be taught as the ceiling). The
benchmark fixtures (`tests/wrapped-bench/fixtures.ts`) deliberately span day
shapes — rich, thin, boring, low-variety, floor — so the bar holds on messy days,
not just good ones.

---

## Resolved decisions (2026-07-10)

The five open taste calls from the v2 draft, resolved by the founder:

1. **"noon" vs "midday" (time-of-day words).** Neither is banned; nothing is
   forced. All time-of-day words are ordinary English, used naturally and only
   where they match when things actually happened. Mechanically, "noon" and
   "midnight" are clock claims (12pm/12am) grounded by the validator against the
   slide's own facts; "midday"/"morning"/"evening" are free part-of-day words.
   The writer prompts and the validator were updated to agree with voice.md §6.
2. **`shipped`.** Kept in the catalog as a proposed card, clearly marked **not
   built yet**. The shipping behavior today is cross-slide prose: verified git/PR
   output is woven prominently into `headline` / `story-*` / `reflection`, with
   exact-count guards. The card, when built, is gated on a *confirmed* artifact —
   never guessed or implied from app time; no artifact means silence.
3. **`plan-vs-actual`.** Kept in the catalog as a proposed card, clearly marked
   **not built yet** (the morning-intention field it depends on does not exist in
   the app yet). Contract locked: explicit written intention only, never a
   calendar-derived or invented plan, and total silence on days with no plan.
4. **Emoji.** Natural, occasional, earned — never forced onto every slide, never
   banned. Legal set 🏆 🔥 🌙 ☕ 🎯 ✨, end-of-line only, at most one line per deck.
5. **Role.** Always from the onboarding selection (`userRole` via
   `userProfileDirective`), never inferred from app usage. No role set → plain,
   neutral tone that assumes no profession.
