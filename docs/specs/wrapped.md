# Wrapped — build spec

The showcase. Spotify Wrapped for your day, week, month, and year. The moment
Daylens stops being a tracker and becomes the thing you *want* to open and share.

This spec is how Wrapped behaves. The words come from [`voice.md`](voice.md). The
underlying numbers and facts come from the same blocks and threads as the Timeline
(`timeline.md`), never recomputed. If a wrap shows a number, it is a number the
Timeline would show.

If you read nothing else: §1 (what good looks like), §3 (availability and
generation controls), §5 (the slide systems per cadence), §6 (the variation
engine), §7 (design variance).

---

## 1. What good looks like

A wrap is a tap-through sequence of full-screen cards, in the spirit of Spotify
Wrapped and Instagram Stories. One idea per card, big type, auto-advancing and
tappable. You finish it and you want to screenshot the last card.

The bar, in order of importance:

1. **It tells you what you actually did,** in plain human words, in detail that is
   not boring. Not "Malaria Notebook." Instead: "You trained the malaria
   classifier and got it past 80%." It tells you things you already know and makes
   you wonder how it knew.
2. **It is grounded.** Every number, name, and claim traces to a real block. The
   model phrases facts the app resolved; it never invents one (`voice.md` §2).
3. **It is never the same twice.** Today and tomorrow differ in copy, in which
   slides appear, in palette, in layout, in tone. Variety is deliberate, not
   random (§6, §7).
4. **It lands one surprising true thing** every time. The "huh, neat" moment.
5. **It is shareable.** Every slide saves as an image with a small Daylens
   watermark (§8).
6. **It is fast and calm.** Auto-advances, pauses on hold or hover, respects
   reduced motion.

What it is NOT: a dashboard, a chart dump, a leaderboard of block labels, a
performance review, or a score. No grades, no focus percentages, no guilt
(`voice.md` §2.9).

---

## 2. The four cadences

| Cadence | Source of truth | When it can be generated |
| --- | --- | --- |
| **Daily** (today / yesterday / any past day) | The day's blocks and threads | After the work threshold is met (§3.1). Yesterday and older are always available. |
| **Weekly** | Frozen daily snapshots for the week | Once the week has days with activity. The current week is generatable but labelled live (§3.2). |
| **Monthly** | Frozen daily snapshots for the month | Only after the month closes. The current month is "still being written" (§3.2). |
| **Annual** | Frozen monthly rollups | Only after the year closes, or in late December as a "year so far". |

Weekly, monthly, and annual are built by summing **frozen daily snapshots**, so the
headline number and the narrative can never disagree (the 20h7m-vs-20h53m bug). One
truth, every card.

---

## 3. Availability and generation controls

Wraps are token-heavy and they are precious. Two rules govern when one is made.

### 3.1 The daily work threshold

A daily wrap is worth making only once the day has something to say.

- **Under 2 hours of tracked work:** do not auto-offer a full wrap. Show a light,
  funny, voice-appropriate line that names the real number, plus a small "Generate
  anyway" escape hatch. The threshold is about **work** time, not leisure or idle.
  - Witty: "34 minutes in. Let it breathe. You don't want a recap of 34 minutes, trust me."
  - Warm: "Only about 34 minutes so far. Give the day a little more and come back."
  - Straight: "34 minutes tracked. Not enough for a wrap yet."
  - The escape hatch is a quiet link, not a dare: "Generate anyway".
- **At or above 2 hours:** the wrap is offered normally and plays.
- This gate is for the **live day (today)** only. A finished day (yesterday and
  older) is always available regardless of length; a quiet past day gets the
  quiet-day treatment (`voice.md` §5), never the threshold block.

### 3.2 Period availability gating

- **This week:** generatable, but the wrap is labelled as a live "week so far"; it
  updates as more days finalize.
- **This month / this year:** **cannot** be generated while the period is open.
  When the user opens it, tell them plainly and point them at what they *can* see:
  - "This month is still being written. Come back when it's done. You can open last
    month any time."
  - Provide a way to browse and open **previous** months and years. A finished past
    period is always viewable.
- A finished period, once generated, is stored and shown (§3.3); it is not
  recomputed unless the user asks.

### 3.3 Conscious regeneration (DEV-118)

Never silently regenerate a wrap. For every cadence:

- **Persist** the generated wrap (the narrative plus the facts it was built from),
  keyed by date or period. Period wraps persist too (keyed by period start); a
  closed period never regenerates without an explicit Regenerate, while the live
  week regenerates only when its underlying facts change.
- **On open, if a wrap already exists, show it** with a clear "generated <when>"
  marker. Do not call the model.
- Offer an explicit **Regenerate** control. Only an explicit click spends tokens.
  A regenerate replaces the stored wrap and updates the marker.
- No code path regenerates on app open, navigation, notification tap, or cache
  miss.

### 3.4 No provider, no wrap

Every word comes through a real API call (`ai.md` §5). With no provider connected
or no credits, a wrap is not generated: show one message pointing to Settings and
nothing else. No templated copy dressed as AI.

---

## 4. What the wrap must NOT do

These are removals and hard bans, several of them corrections to the current build.

- **No "needs to be picked up" / open-thread / carryover content.** Removed
  entirely, every cadence. Daylens cannot know what you will do tomorrow without a
  calendar, and guessing is low-value and dishonest. The daily wrap has no "open
  thread" slide. Yesterday's wrap finale is "Continue your day" into the timeline,
  not a "pick it up" prediction.
- **No raw labels.** No filename, folder, repo, branch, tab title, or video title,
  ever (`timeline.md` §3.5). If a thing cannot be named as human work, fold it into
  "a few smaller things."
- **No scores, grades, focus percentages, or guilt** (`voice.md` §2.9).
- **No invented facts, numbers, records, or superlatives** (`voice.md` §2.1).
- **No em dashes** (`voice.md` §2.11).

---

## 5. The slide systems

> **2026-07 deck rewrite.** The wrap is now a *deck*: one deterministic slide
> plan (`src/renderer/lib/wrapDeck.ts` — `planDayWrapSlides` /
> `planPeriodWrapSlides`) computed from the facts, read by BOTH the prompt
> builder in main and the renderer, so the AI's prose and the cards can never
> disagree about which slides exist or what numbers they show. The AI writes
> one line per slide id, plus one **curious question** (an interactive slide —
> the user can answer inline and the AI responds in context) and a closing
> **reflection paragraph** written like an end-of-period message. A rejected
> line falls back per slide to its deterministic `fallbackLine`; the deck
> never collapses wholesale. A full working day yields roughly 12 to 16
> slides; a real week yields **at least 20** (opening, headline, shape,
> best/worst day, longest stretch, thread deep-dives, biggest time sink,
> apps, work-by-kind, work-vs-leisure split, leisure, meetings, the thing you
> forgot, late nights, early starts, last-week comparison, daily average,
> question, reflection, finale). Thin data still never pads: a slide without
> its fact simply does not exist.
>
> Two amendments to the older rules below: (1) the wrap MAY ask the user
> exactly one question — the interactive question slide; every other line
> still never asks. (2) The work-vs-leisure split slide shows the real
> percentage split; the AI may speak *exactly those* percentages and no
> other. Scores, focus percentages, and drift stay banned.
>
> First open plays a cinematic "Generating your wrap" screen while the AI
> assembles the deck; the first slide animates in when it is ready. Every
> slide has an "Ask about this" affordance (`ai:ask-wrapped`) that answers in
> place from the same compact facts the wrap narrated.

Each cadence has a deliberate arc. Within the arc, which slides actually appear
varies by what the day/period contains and by the variation engine (§6). Never pad
to hit a count; never show a slide whose data is thin.

The arc, shared across cadences: **Hook → Substance → Where it went → Wildcard →
Finale.** Below is what each beat is per cadence.

### 5.1 Daily wrap (about 4 to 7 cards)

The directional structure Tonny described. Treat the beats as intent, the exact
count as flexible.

1. **Hook (1 card).** Sets the tone. A one-line read on the shape of the day,
   voice-flavored. "Today was a long one." Then the build moment: a short "recap
   being cooked" beat that reuses the onboarding tetris-stack build animation
   (`DashboardBuild`), then the first real card slides in: "Looking at your day, a
   few things stood out," revealing an **agenda-style chart** of what you worked on
   that day, easing in. Then: "Let's look deeper."
2. **The day as a story (2 to 4 cards).** Morning → midday → evening, narrated like
   a friend who was there (`ai.md` §3 voice example), not a list. Names the real
   work in human words. Owns the YouTube break with a relevant joke, never a scold.
   The midday card is where personality lands hardest: a joke that is actually
   about who the user is and what they were working on (`voice.md` §10).
3. **Where the time went (1 card, a chart).** App and site distribution. Visual,
   skimmable: which apps, how long. The one place a chart is the point. It has a
   legend and its totals match the headline exactly.
4. **Wildcard (1 card).** One spontaneous, surprising, true thing that changes every
   day: a personal best within the day, a juxtaposition ("you opened the proposal
   14 times"), a time-of-day pattern ("your best stretch was before 9am"), a count,
   or a genuinely interesting stat. Drawn from the candidate-hook pool (§6); never
   invented.
5. **Trajectory (optional, 1 card).** Pure pace arithmetic, framed as arithmetic,
   never a prediction of *what* you will do: "At this rate, about 22 hours by
   Friday." Clearly hypothetical. Cut it on a day where it would read as a lecture.
6. **Finale / shareable card (1 card, always).** The screenshot-perfect summary:
   date, headline number, top few activities, one signature stat, Daylens
   watermark. Save button. For yesterday's wrap, the CTA is "Continue your day"
   into the timeline. (No "pick it up" prediction, per §4.)

### 5.2 Weekly wrap (about 5 to 7 cards)

More depth than daily, packaged friendly, never a performance review.

1. **Hook.** The week in one line. What it was mostly about.
2. **What mattered.** The biggest threads, named for the work, with real hours and
   day-spread ("12h on the timeline rework across four days").
3. **The shape of the week.** Busiest day, quietest day, a notable run. Story first,
   a bar chart of the seven days second.
4. **Where the time actually went (the nitty-gritty).** This is the weekly depth
   Tonny asked for: which websites, which apps, how time distributed across the
   week. Detailed but friendly and skimmable, never a spreadsheet.
5. **A standout / superlative.** A real within-period one ("Wednesday held your
   longest run, 4h 12m").
6. **Wildcard.** One surprising true thing about the week.
7. **Finale / shareable card.** The week summarized, watermarked, saveable.

### 5.3 Monthly wrap (about 5 to 7 cards)

1. **Hook.** The arc of the month in one line.
2. **The threads that defined it.** The few projects that took the most real hours.
3. **The shape of the month.** Busiest week, quietest week, a streak ("nine days
   straight on the rework"). Story, then a per-week chart.
4. **Where the time went, deeper.** The month's real app/site distribution,
   friendly.
5. **A surprise.** A genuine superlative the user would not have guessed.
6. **Wildcard.** One more interesting true thing.
7. **Finale / shareable card.**

### 5.4 Annual wrap (about 6 to 8 cards)

The big one, the most shareable, so the words matter most (`voice.md` §11, Wraps).

1. **Hook.** The headline story of the year.
2. **Your biggest threads.** The handful of projects that defined the year, with
   real hours and when they were most active.
3. **Your biggest month.** When you got the most done, and on what.
4. **The shape of the year.** A per-month chart and the arc: what you started on,
   what you ended on, what shifted.
5. **Where the time went.** The year's distribution, friendly.
6. **Superlatives.** The surprising, specific, fun ones ("your longest single
   stretch all year was 4h 12m").
7. **Wildcard.** A final fun fact.
8. **Finale / shareable card.**

---

## 6. The variation engine

The same kind of day must never read the same way twice, without ever inventing a
fact. Full voice treatment in `voice.md` §9; the wrap-specific mechanics:

- **Per-period seed.** A stable seed derived from the date/period drives the
  choices below. A given day is *stable if reopened* (same wrap each time you open
  it), but visibly different from the day before. Deliberate variety, not
  randomness.
- **Candidate hooks.** The facts layer computes 3 to 5 true candidate hooks per
  period (longest block, the thread that mattered, a juxtaposition, a time-of-day
  fact, a within-period superlative). The seed + anti-repeat memory pick which one
  leads and which becomes the wildcard. The AI never derives its own.
- **What varies, slide to slide and day to day:**
  - **Which optional slides appear** (trajectory, wildcard kind, an extra
    story beat).
  - **The lead angle** (a number, a verb, a time, the shape of the day).
  - **The rhythm and length.**
  - **The tone** (see §7: data sets the mood, the seed picks the flavor).
  - **The joke** (it is about the real day, so it is different for free).
- **Anti-repeat memory.** Keep a short log (about the last 5) of recent wrap
  openings/structures/jokes per cadence; the prompt is told not to reuse them.
- **Honest repetition.** If a day genuinely resembles yesterday, say so plainly and
  differently ("another one on the proposal"), never manufacture novelty.

---

## 7. Design variance

The wrap should feel like something crafted with insane attention, where every day
you find taste and things you did not expect. The look is never the same twice.

- **Palette changes day to day,** seeded by the period. Each scene still ties its
  gradient to the scene's mood and guarantees text contrast.
- **Layout varies.** Never the same arrangement twice: which beat leads, where the
  chart sits, centered vs offset compositions, type scale. A small set of
  well-crafted layout variants the seed selects among, not one fixed template.
- **Images appear sometimes, not always.** Daylens is metadata-only, so visual
  richness comes from *generated* material: app glyphs, site favicons, Lumen's
  moods (`Mascot.tsx`), and abstract art seeded by the day. Never a screenshot.
- **Tone shifts:** some days playful, some reflective, some simple. The rule:
  **the day's data sets the mood, the seed picks the flavor.** A heavy heads-down
  day reads more reflective; a light day reads more playful; the seed varies the
  exact expression so two similar days still differ. The chosen voice
  (`summaryVoice`) is the ceiling: a Straight user never gets playful.
- **Motion.** Numbers count up, charts and the day ribbon grow in, elements stagger
  in. Tasteful, never busy. Reduced motion: instant reveals, no count-up, manual
  paging, fully readable.

---

## 8. Save and share

- **Every slide is saveable as its own image,** not just the finale. A save control
  on each card.
- **The finale has an Export button that renders the WHOLE deck** — every slide
  as one tall 1080-wide graphic (one 1080×1350 panel per slide) — clean enough
  to post as-is (`wrapExport.ts`).
- Each exported image carries a **small Daylens watermark** for branding.
- Export is a real, clean image (canvas render, no extra deps), saved to disk and
  copied to the clipboard where supported.
- Built so the finale especially is screenshot-and-post perfect.

---

## 9. Interaction model

- **Auto-advance** each scene on a timer (about 5 to 7s). The story progress bar at
  the top fills on the timer, one segment per scene.
- **Tap zones:** tap right to advance, left to go back. **Press-and-hold** pauses;
  **hover** pauses (mouse).
- **Keyboard:** left/right navigate, space pauses, Esc closes.
- A **visible Next affordance** for discoverability (do not rely on invisible tap
  zones alone).
- **Restart** from the finale. **Close** (X / Esc) anywhere.
- **Entry points:** the evening wrap notification (today), the morning recap
  notification (yesterday), the command palette (today, yesterday, this week, this
  month, this year), and dev shortcuts. Notifications hook with the real thing, not
  "your wrap is ready" (`voice.md` §11, Notifications).

---

## 10. Data layer (what the facts must provide)

The wrap is only as good as the facts it narrates, and the facts must be computed,
never left to the model. For each cadence the facts object provides, all derived
from the same trusted blocks as the Timeline:

- The one reconciled total and kind split (work / leisure / personal), so every
  card agrees.
- Ranked human work activities/threads, each named for the work (never a raw
  label), with real durations.
- The agenda/where-it-went distribution (apps, sites) with totals that sum to the
  headline.
- The day/period shape (ribbon for a day, per-day/week/month buckets for periods).
- 3 to 5 candidate hooks and a single computed standout (longest stretch, busiest
  window, a within-period superlative). Cross-period records and streaks are
  roadmap; do not provide or claim them until a history layer exists.
- Quality/availability signals: tracked-work seconds (for the §3.1 threshold) and
  whether the period is closed (for §3.2 gating).

The naming quality (turning "Malaria Notebook" into "training the malaria
classifier") is partly the Timeline engine's job (`timeline.md` §3.5). The wrap
hardens its own guards and instructs the model to humanize, but a wrap cannot be
better than the block names feeding it. Improving block naming improves every wrap.

---

## 11. Invariants

1. Every number on every card comes from the same blocks as the Timeline; the
   headline, the activity list, the chart, and the standout all reconcile.
2. Period wraps are built from frozen daily snapshots; numbers on a screen agree.
3. No raw filename, folder, repo, branch, or tab title ever appears.
4. No scores, grades, focus percentages, or guilt.
5. No "needs to be picked up" / carryover / open-thread content, any cadence.
6. No invented facts, numbers, records, or superlatives.
7. A daily wrap needs 2 hours of tracked work to auto-offer (today only), with a
   "generate anyway" escape; finished days are always available.
8. This month and this year cannot be generated while open; previous periods are
   always viewable.
9. A wrap is never silently regenerated; an existing wrap is shown, with an
   explicit Regenerate control (DEV-118).
10. No provider connected: one Settings message and nothing else.
11. Every slide is saveable as a watermarked image.
12. The same day never reads or looks the same way twice; palette, layout, tone,
    and copy vary by seed and data.
13. Words obey `voice.md`, including the chosen `summaryVoice` and no em dashes.
14. `prefers-reduced-motion` is fully respected.

---

## 12. Related

- Voice: [`voice.md`](voice.md)
- Behaviour spec this supersedes for wrap structure: [`briefs-wraps.md`](briefs-wraps.md)
  (still owns brief notification firing rules)
- Block naming and the facts source: [`timeline.md`](timeline.md)
- AI grounding rules: [`ai.md`](ai.md)
- Linear: DEV-114 (daily), DEV-103 (week/month/year), DEV-118 (generation
  controls), DEV-117 (emoji), DEV-115 (voice adoption), DEV-116 (strip reassurance
  copy)
