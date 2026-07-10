# Wrapped — the slide catalog

> **Note (2026-07-10).** A richer, example-heavy rewrite of this catalog is in
> draft at [`wrapped-slide-catalog.v2-draft.md`](wrapped-slide-catalog.v2-draft.md)
> — the 9-layer model, per-role example galleries, and two proposed new slides.
> **This file is still the shipping catalog** (the benchmark anchors in
> `tests/wrapped-bench/anchors.ts` are distilled from it); the v2 draft does not
> supersede it yet. If you are extending the catalog, read both and prefer
> adding new material to the draft.

The full catalog of slides Wrapped can produce, for the **day** and **week**
cadences, and the **rubric** the benchmark scores every one against. This is the
Stage 1 standard: the benchmark tests (`tests/wrappedBenchmark.test.ts`) are built
from this document, and no slide ships until it clears the rubric here.

Read this with `wrapped.md` (the product spec, law) and `voice.md` (how every word
must sound). Where an example line here and `voice.md` disagree about *sound*,
`voice.md` wins — the examples below illustrate the rubric, they are never
templates.

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

**The arc, both cadences:** Hook → Substance → Where it went → Wildcard → Finale.

**Counts.** A full working day yields **12–16** slides from a catalog of **20+**
possible; a real week yields **15–18** from a catalog of **27** possible. Which
appear depends entirely on what the day/period contained.

Fields referenced below are from `DayWrapFacts` (`src/renderer/lib/dayWrapScenes.ts`)
and `WrappedPeriodFacts` (`@shared/types`). Stage-0 tools
(`src/main/services/wrappedTools.ts`) that feed a slide are named where relevant.

---

## The rubric — how every slide is scored

Each slide's AI line is scored on four dimensions. **Max 10 per slide.**

### Specificity (0–3)
Does it name real things — app names, times, actual numbers, the real work — or
does it speak in vague terms?
- **3** — every sentence carries at least one specific, correct data point from
  the facts (a real activity name, a real clock time, a real duration).
- **2** — specific, but one sentence coasts on generality.
- **1** — mostly vague; a single concrete detail.
- **0** — "you worked hard today," no anchor to the real day.

### Tone (0–2)
Does it read like a human reflection or a generated report?
- **2** — reads like a thoughtful person who knows you wrote it about your day.
  Connective tissue, varied rhythm, on the chosen voice.
- **1** — fine but flat; a summary with extra words.
- **0** — robotic, hype, therapy, self-referential, or a bullet dressed as a
  sentence. Any `voice.md` §2 non-negotiable broken caps Tone at 0.

### Accuracy (0–3)
Do the numbers and names match the facts object exactly?
- **3** — zero hallucinated or misattributed values; every clock time, duration,
  percentage, and name traces to *this slide's* facts.
- **1–2** — correct but a value is imprecise or attributed to the wrong thing.
- **0** — **any invented number, time, percentage, or name is an automatic 0.**
  (The runtime validator already strips these; a 0 here means the guard missed one
  and the prompt must be fixed, not the guard leaned on.)

### Narrative forward motion (0–2)
Does the prose tell the user something they couldn't already read off the card?
- **2** — adds a genuine read: how the time was spread, what the stretch meant, a
  true juxtaposition the chart can't show.
- **1** — adds a little framing.
- **0** — restates the number that is already printed on the slide.

### Thresholds (the pass bar)
- **Per slide:** a slide scoring **below 7 fails** the suite.
- **Improvement loop:** any slide scoring **below 8** enters the recursive
  improvement loop (§1.3) until it reaches 8.
- **Deck:** the **deck average must be ≥ 9** to pass overall.
- The benchmark test suite **fails the build** if any slide is < 7 or the deck
  average is < 9.

Interactive/deterministic-only slides (`apps`, `shape`, `threads`, `finale`) whose
AI line is a short caption are scored on the same rubric but graded against the
lighter job the card asks of them (a caption that adds a read scores full motion).

---

## DAY WRAP — the catalog

A full working day plays roughly 12–16 of these. `question`, `reflection`, and
`finale` always appear; everything else is gated by data.

### 1. Opening — the one-line read
**Beat.** The hook. One punchy, honest sentence on the *shape* of the whole day,
no numbers. It sets the tone and is also the notification one-liner, so it has to
earn the open.
**Draws from.** `activeSeconds`, `workSeconds`, `leisureSeconds`, `isLeisureDay`.
**Minimum data.** Always present once `quality` is `partial` or `full`.
- Great: "You started before most people were awake and the code never really let
  you go."
- Great: "A split day: heads-down all morning, then it scattered after lunch."
- Great: "Mostly off the clock today, and that reads as a choice, not a gap."
- Bad: "Today was a productive and focused day with lots of great work." (vague,
  hype, no shape)

### 2. Headline — the day in one number
**Beat.** The single big number (total active time), count-up animated. The line
must ADD something the number can't say (when it began, how it spread) and must
never restate the total or say "tracked across the day."
**Draws from.** `activeSeconds`, `mainStartClock`, `ribbonEndClock`, `dayStory`
(spillover awareness). Tool: `getDayComparison` can color "a long one" later.
**Minimum data.** Always present on a `full`/`partial` day.
- Great: "Nearly all of it landed between 9am and 6pm. A clean, contained day."
- Great: "It began at 7am and the front half carried the weight."
- Great: "That total is denser than it looks; two long stretches did most of it."
- Bad: "You tracked 5h 16m today." (restates the number on the card)

### 3–6. The day as a story (late night / morning / afternoon / evening)
**Beat.** The heart of the wrap. Each real part of the day, narrated like a friend
who was there — names the real work as an action ("building the timeline"), connects
the beats, owns a leisure aside with one kind line, never lists. Up to four slides,
one per part of day that cleared the threshold. A pre-dawn sliver is its own
"last night's tail" beat, framed as winding down, never as starting the day.
**Draws from.** `dayStory[]` (each `DayStorySegment`: `label`, `clockStart`,
`clockEnd`, `items` [humanized work actions], `aside`, `spillover`). Tools:
`getWindowTitleContext` → `titleContext` gives the depth under "4 hours in Cursor".
**Minimum data.** A segment appears only if it holds ≥ 5 min of nameable activity.
- Great (morning): "You went straight into the malaria classifier at 7 and stayed
  with it for two and a half hours before your first real break."
- Great (afternoon): "The meeting ran through lunch and you built through it anyway,
  back on the pipeline the moment it ended."
- Great (evening): "By evening it was cleanup — the essay, then a long YouTube tail
  that honestly reads like a breather after a heavy day."
- Bad: "In the morning you used Cursor, Claude Code, and Chrome." (names the
  plumbing, lists, no story)

### 7. Longest unbroken stretch — the focus reveal
**Beat.** The single longest unbroken work block: when it started, what it was,
that nothing broke it. One of the most interesting facts of any day; the reveal
should land. Earned pride is allowed here.
**Draws from.** `standout` (`seconds`, `startClock`, `endClock`, `name`). Tool:
`getLongestFocusStretch`.
**Minimum data.** A work stretch ≥ 25 min exists.
- Great: "2h 14m without a break on the malaria classifier, 7 to 9am. Nothing got
  in. 🔥"
- Great: "Your longest run was the proposal, 1h 40m straight after lunch, no tab
  switching."
- Great: "One block held the whole afternoon: an hour and a half on the pipeline,
  unbroken."
- Bad: "Your longest stretch was 2h 14m." (restates the stat, no meaning)

### 8. Where the most time pooled — the biggest time sink
**Beat.** The single surface that held the most time, framed honestly given its
category — is it the work, or the leak? No scold, no cheer.
**Draws from.** `appSites[0]` (name, seconds, category). Tool:
`getDistractionProfile` informs the honest framing.
**Minimum data.** A named app/site with ≥ 20 min.
- Great: "Claude Code held more of the day than anything else, and on a build day
  that reads as the work, not the drift."
- Great: "Safari took the most time, and most of that was docs, not wandering."
- Great: "YouTube pooled the most minutes today. Some days the break is the
  headline."
- Bad: "You spent the most time in Claude Code." (no read on what it means)

### 9. Where the time went — the one chart
**Beat.** The app/site distribution chart, the one place a chart is the point.
Slices sum to the headline exactly. The line is ONE short caption that adds a read,
not a restatement of the bars.
**Draws from.** `appSites[]` (each slice, reconciled to `activeSeconds`).
**Minimum data.** ≥ 2 app/site slices.
- Great: "Two tools carried the day; everything else was a rounding error."
- Great: "A short list. You didn't spread yourself thin today."
- Great: "The top three are all one project wearing different hats."
- Bad: "Cursor 2h, Claude Code 1h, Safari 40m, Slack 20m." (restates the chart)

### 10. The honest split — work vs leisure
**Beat.** The real work-to-leisure ratio, the ONE place the line may speak exact
percentages (and only the two the slide shows). Framed without judgment or grade.
**Draws from.** `workSeconds`, `leisureSeconds`, largest-remainder percentages.
**Minimum data.** Both work AND leisure > 0.
- Great: "59% work, 41% off the clock. A day that left room to breathe."
- Great: "Two thirds work today, and the other third wasn't wasted."
- Great: "Closer to even than most days, and that's allowed."
- Bad: "You were 59% productive today." (turns a split into a grade — banned)

### 11. An early one — early start
**Beat.** The day started unusually early; name the real clock time and let it
speak. Observational, never a badge.
**Draws from.** `ribbon[0].startMs` (first hour 1–6am), `ribbonStartClock`. Tool:
`getMostSurprisingFact` (`unusualStart`).
**Minimum data.** First activity between 1am and 6am.
- Great: "The day started at 6:12am. The house was still quiet."
- Great: "You were three hours in before most people had coffee."
- Great: "5:40am. Whatever pulled you up early, it got the cleanest hours."
- Bad: "You woke up early today." (no real time, and it can't see when you woke)

### 12. It ran late — late night
**Beat.** The day ran late; name the real end-of-day clock time, observational,
never a scold. (Mutually exclusive with early start when both trigger; the seed
picks.)
**Draws from.** `ribbon[last].endMs` (≥ 10pm or < 4am), `ribbonEndClock`.
**Minimum data.** Last activity at/after 10pm or before 4am.
- Great: "The last thing you touched was at 10:26pm. It was a long one. 🌙"
- Great: "You didn't really stop until 11 tonight."
- Great: "The screen was still on at 12:40am, winding down, not ramping up."
- Bad: "You stayed up too late working." (scold + a WHY it can't see)

### 13. You probably forgot this one — the forgotten surface
**Beat.** A real surface that took meaningful time without ever being a headline —
the "oh right, that" moment.
**Draws from.** `appSites` ranked outside the top 3, ≥ 10 min. Tool:
`getMostSurprisingFact` (`forgottenApp`).
**Minimum data.** A 4th+ ranked app/site with ≥ 10 min.
- Great: "Notion quietly took 26 minutes today without ever being the main thing."
- Great: "You spent more time in Preview than you'd probably guess: 18 minutes."
- Great: "A forgotten half hour in Numbers, buried between the bigger blocks."
- Bad: "You also used Notion today." (no surprise, no time, no life)

### 14. In meetings and calls
**Beat.** Meeting time as its own beat, separating deep work from talking. Plain
and factual. Never states HOW MANY meetings — the facts only know total time.
**Draws from.** `meetingsSeconds` (block span, not active seconds). Tool:
`getCalendarEvents` enriches with names/durations when calendar is connected.
**Minimum data.** ≥ 30 min of meetings-category time.
- Great: "About an hour went to calls, and the ML pipeline sync was most of it."
- Great: "49 minutes in meetings, all of it in the morning before the real build."
- Great: "The calls clustered early, which left the afternoon clear for one thing."
- Bad: "You had 3 meetings today." (invents a count the facts don't hold)

### 15. And one more thing — the wildcard
**Beat.** The signature "huh, neat" moment: one spontaneous, surprising, TRUE thing
that changes every day. The seed picks which computed candidate hook leads. This is
one slide with several possible faces (below), so it reads different every day.
**Draws from.** `wildcardHook` (chosen from `candidateHooks[]`). Tool:
`getMostSurprisingFact`.
**Minimum data.** At least one candidate hook cleared its floor.

The wildcard's faces (each a distinct catalog possibility; only one appears):
- **15a · longestStretch** — "2h 14m unbroken, your deepest single stretch today."
- **15b · peakWindow** — "Your best stretch was the morning; the afternoon never
  matched it."
- **15c · earlyBird** — "Most of the real work was done before noon."
- **15d · nightOwl** — "The evening did the heavy lifting; you found a second gear
  after 8."
- **15e · count** — "You came back to the proposal seven separate times before it
  was done."
- **15f · topApp juxtaposition** — "More time on the classifier than everything else
  combined."
- Bad (any face): "Interesting fact: you were productive!" (invented, generic, a
  score in disguise)

### 16. The curious question — interactive
**Beat.** The ONE slide that asks the user something (every other line never asks).
One genuine question the AI is curious about after reading the day, specific to
THIS data, answerable inline. Never a task, never a "should."
**Draws from.** the whole facts object (`narrative.question`).
**Minimum data.** Always present.
- Great: "You gave the classifier the whole morning. Was it the fun kind of hard,
  or the grinding kind?"
- Great: "The proposal came back to life today after two quiet days. What
  unblocked it?"
- Great: "That YouTube tail after 9pm, was that the reward or the wall?"
- Bad: "What will you work on tomorrow?" (prediction/homework — banned)

### 17. The reflection — the finale paragraph
**Beat.** The closing message, written like a text you'd send someone at the end of
their day. 3–5 sentences, warm, specific, grounded, no advice, no prediction.
**Draws from.** the whole facts object (`narrative.reflection`).
**Minimum data.** Always present.
- Great: "You put in about five hours today and nearly all of it went to the
  classifier, which crossed 80% by evening. The morning was the cleanest part, one
  long unbroken run before the meetings started. You took the afternoon a little
  slower and that's fine. It was a good, honest day of work."
- Bad: "Great job today! Keep up the momentum and crush it tomorrow!" (hype +
  prediction + therapy)

### 18. The finale — share card
**Beat.** The screenshot-perfect summary card: date, headline number, top few
activities, one signature stat, Daylens watermark. A short sign-off line.
**Draws from.** deck meta + facts. Deterministic-heavy; the AI line is a short
close.
**Minimum data.** Always present.
- Great: "That's the day. See you tomorrow."
- Great: "One number, one long stretch, one thing finished. Enough."
- Bad: "Thanks for using Daylens!" (self-referential product-speak)

**Day catalog total: 20+ possible faces** (opening, headline, 4 story parts, focus,
timesink, apps, split, early, late, forgotten, meetings, 6 wildcard faces, question,
reflection, finale). **12–16 appear on any given full day.**

---

## WEEK WRAP — the catalog

A real week plays roughly 15–18 of these from **27** possible. Same rubric. The
period deck sums **frozen daily snapshots**, so every number reconciles.

### 1. Opening — what kind of week
**Beat.** One honest sentence on the arc of the whole week, no numbers.
**Draws from.** `totalSeconds`, `daysWithActivity`, biggest thread.
**Minimum data.** Always.
- Great: "A week with one clear center of gravity: the ML pipeline pulled almost
  everything toward it."
- Great: "Front-loaded and heavy, then it eased off by the weekend."
- Bad: "It was a busy and productive week overall." (vague, hype)

### 2. Headline — the week in one number
**Beat.** The week's total, count-up. The line reads the total, never restates it.
**Draws from.** `totalSeconds`, `daysWithActivity`.
- Great: "Fifty-three hours across seven days is a lot of steady, not a lot of
  spikes."
- Bad: "You tracked 53h 4m this week." (restates)

### 3. Days you showed up — consistency (week only)
**Beat.** How many of the seven days had activity. Observational, no grade.
**Draws from.** `daysWithActivity`.
**Minimum data.** `period === 'week'` and ≥ 2 active days.
- Great: "Seven of seven. You didn't take a day fully off this week."
- Bad: "You showed up 100% of days!" (grade)

### 4. The shape of the week — the silhouette
**Beat.** The per-day bar chart, story first: where it peaked, where it thinned.
**Draws from.** `buckets[]`, `busiestBucket`.
**Minimum data.** ≥ 2 buckets.
- Great: "Sunday was the mountain and Wednesday the valley; the rest held a steady
  line."
- Bad: "Here are your daily totals." (restates the chart)

### 5. The big day — best day
**Beat.** The fullest day, given its due.
**Draws from.** `busiestDay` (`dayLabel`, `totalSeconds`).
**Minimum data.** A busiest day exists.
- Great: "Sunday carried the week: 10h 27m, more than any two other days combined."
- Bad: "Your busiest day was Sunday with 10h 27m." (restates)

### 6. The quiet one — worst day
**Beat.** The lightest active day, said honestly, no judgment.
**Draws from.** `quietestActiveDay`, distinct from busiest, ≥ 3 active days.
- Great: "Wednesday was the exhale: 8 minutes, and the week was better for it."
- Bad: "Wednesday was your worst day." ("worst" as a verdict)

### 7. Longest unbroken stretch — the focus reveal (period)
**Beat.** The single longest unbroken stretch of the whole week, when and on what.
Be a little proud.
**Draws from.** `longestStretch` (`seconds`, `dayLabel`, `startClock`, `label`).
- Great: "4h 14m without breaking on Thursday, all of it in Claude Code. Your
  deepest run of the week. 🏆"
- Bad: "Your longest stretch was 4h 14m." (restates)

### 8. The big week — best bucket (month/year only)
**Beat.** For a month/year deck, the fullest week/month called out by name.
**Draws from.** `busiestBucket`, `period !== 'week'`.
- Great: "The second week of the month did the heavy lifting, nearly a third of the
  whole thing."
- Bad: "Week 2 had the most hours." (restates)

### 9–12. Thread deep-dives (thread-0 … thread-3)
**Beat.** The biggest named threads each get their own card — what that commitment
looked like. Two for a week, four for a month/year.
**Draws from.** `threads[]` (`subject`, `seconds`, `daysActive`). Tool:
`getGitActivity` enriches thread naming with what was actually shipped.
**Minimum data.** A clean-named thread exists (raw artifact labels filtered out).
- Great (thread-0): "The ML pipeline was the week: 12 hours across four days, and
  every other thread bent around it."
- Great (thread-1): "The other constant was the Claude Code work, 3 hours that kept
  resurfacing between the bigger blocks."
- Bad: "Thread 1 was Malaria Notebook, 12h." (raw label, restates)

### 13. What mattered — the thread chart
**Beat.** The ranked thread list as a chart; one caption on what the ranking says.
**Draws from.** `threads[]` (top 5).
**Minimum data.** ≥ 2 clean threads.
- Great: "One thread towered; the rest were the supporting cast."
- Bad: "Your threads were pipeline, Claude, design, admin." (restates)

### 14. Where the most time pooled — biggest time sink (period)
**Beat.** The single app that took the most raw time across the week, framed
honestly as the work or the leak.
**Draws from.** `topApps[0]`, ≥ 45 min.
- Great: "Dia held 32 hours this week, and most of that was the pipeline living in a
  browser tab, not idle drift."
- Bad: "You used Dia the most." (no read)

### 15. Where the time actually went — the app chart (period)
**Beat.** The week's real app distribution; one short caption.
**Draws from.** `topApps[]` (top 6).
**Minimum data.** ≥ 2 apps.
- Great: "The whole week ran through three tools; the rest is noise."
- Bad: "Dia, Safari, Notion, Slack, Cursor, Warp." (restates)

### 16. The work, by kind
**Beat.** What kind of work dominated (coding / writing / design / admin), as a
story not a readout.
**Draws from.** `categories[]` (humanized kind words).
**Minimum data.** ≥ 2 categories and `workSeconds > 0`.
- Great: "This was a building week, not a writing one; the design and admin were
  just what kept it moving."
- Bad: "Coding 60%, design 25%, admin 15%." (invents percentages not on the card)

### 17. The honest split — work vs leisure (period)
**Beat.** The week's real work-to-leisure ratio; the two exact percentages allowed.
**Draws from.** `workSeconds`, `leisureSeconds`.
**Minimum data.** Both > 0.
- Great: "40% work, 60% off the clock. Not every week is a sprint, and this one
  wasn't."
- Bad: "You were only 40% productive this week." (grade)

### 18. Off the clock — leisure surfaces
**Beat.** Where the downtime went, one kind honest line. Rest is allowed.
**Draws from.** `leisureSurfaces[]`, `leisureSeconds` ≥ 30 min.
- Great: "The downtime was mostly YouTube and Netflix, clustered in the evenings
  after the work was done."
- Bad: "You wasted time on YouTube and Netflix." ("wasted" — banned)

### 19. In meetings and calls (period)
**Beat.** Total meeting time for the week, plain.
**Draws from.** `meetingsSeconds` ≥ 30 min. Tool: `getCalendarEvents`.
- Great: "A little over an hour in calls all week, which is a light meeting load for
  the amount that got built."
- Bad: "You had 1h 7m of meetings across several calls." (invents "several")

### 20. You probably forgot this one — forgotten surface (period)
**Beat.** A surface that took real time without being a headline, over the week.
**Draws from.** `topApps` ranked outside top 3, ≥ 20 min.
- Great: "Warp quietly took 26 minutes this week, never once the main event."
- Bad: "You also used Warp." (no life)

### 21. It ran late — late nights
**Beat.** How many nights ran past 11pm and the latest, observational.
**Draws from.** `dayEdges[]` (lastHour ≥ 23 or < 4).
- Great: "Five nights ran past 11, the latest ending at 12:40am on Thursday. A week
  that didn't clock out easily. 🌙"
- Bad: "You stayed up too late 5 nights." (scold)

### 22. The early starts
**Beat.** How many days started before 7am and the earliest.
**Draws from.** `dayEdges[]` (firstHour 1–6).
- Great: "Two days started before 7, the earliest a 2:27am Thursday that was really
  Wednesday refusing to end."
- Bad: "You woke up early twice." (can't see waking)

### 23. Against last week — the comparison
**Beat.** This period vs the previous, framed as arithmetic, never a verdict.
**Draws from.** `previousPeriodSeconds`. Tool: `getDayComparison` (day-level analog).
**Minimum data.** `previousPeriodSeconds > 0`.
- Great: "About 6 hours more than last week, most of that landing on Sunday alone."
- Bad: "You improved 12% over last week!" (grade + invented percent)

### 24. A typical day — the daily average
**Beat.** The per-active-day average, plain arithmetic.
**Draws from.** `totalSeconds / daysWithActivity`, ≥ 3 active days.
- Great: "About 7h 35m on a working day, which is a full day without being a
  punishing one."
- Bad: "Your average was 7h 35m per day." (restates)

### 25. The curious question — interactive (period)
**Beat.** One genuine question about the week, answerable inline.
**Draws from.** whole facts object.
- Great: "The pipeline ate the whole week. Was that the plan, or did it quietly take
  over?"
- Bad: "What are your goals for next week?" (homework)

### 26. The reflection — end-of-week message
**Beat.** The closing paragraph, written like a text at the end of the week.
- Great: "Fifty-three hours, and the ML pipeline was the spine of nearly all of it,
  twelve of those hours across four days. Sunday was the big one and Wednesday was
  almost nothing, which is a healthy shape for a week. You ran late more nights than
  not. It was a heads-down stretch, and it looks like it moved the thing that
  mattered."
- Bad: "Amazing week! You're a machine. Next week will be even better!" (hype +
  prediction)

### 27. The finale — share card (period)
**Beat.** The week summarized, watermarked, saveable. Short sign-off.
- Great: "That's the week. One thread, start to finish."
- Bad: "Thanks for a great week with Daylens!" (product-speak)

**Week catalog total: 27 possible slides.** **15–18 appear** in a real week
(consistency + late/early + compare + the second thread cards push a full week to
the top of that range; a thin week drops the deep-dives, worst-day, and comparison).

---

## What the benchmark must enforce (summary)

- Every slide's line scores **≥ 7**, and the improvement loop lifts anything **< 8**.
- The **deck average is ≥ 9**.
- **Accuracy is a hard gate:** any number, clock time, percentage, or name not in
  that slide's facts is an automatic 0 and a suite failure.
- Every line obeys the `voice.md` non-negotiables (no scores, no hype, no em dashes,
  no homework/prediction, no raw labels, emoji only from the earned set).
- The catalog is the source of truth for *which* slides exist; the benchmark builds
  one fixture per slide type from **real data** in `daylens.sqlite`.
