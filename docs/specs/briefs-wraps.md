# Briefs & wraps — build spec

## 1. What briefs and wraps are

Briefs and wraps are the moments Daylens reaches out to **you** instead of waiting for you
to open it.

- The **morning brief** catches you up when you open the laptop — what you left open
  yesterday, and a nudge later in the morning about what's worth picking up.
- The **evening wrap** closes the day when you're shutting down — a short, honest
  recap of what the day was about.
- The **weekly, monthly, and annual wraps** are the recaps — Spotify Wrapped for your
  week, your month, your year.

The bar is simple: these should feel like **Spotify Wrapped done right**. Personal,
specific, occasionally surprising or funny — like someone actually cared about the words.
Not a dashboard readout. When a brief or wrap lands, you should *want* to open it.

This spec sets the **words and structure**, not the visual design of the wrap carousel. The
look is deliberately unspecced: before building the carousel UI, the implementing agent gets
reference screenshots from Tonny first (`AGENTS.md` → "Design work"). Spotify Wrapped is the
obvious touchstone — confirm the direction with him before writing it.

Every brief and wrap reads from the **same blocks and threads** as the Timeline. If the
Timeline says 3 hours of network work, the wrap says 3 hours. No brief or wrap computes its
own numbers. One truth, every view.

And every word is written by the AI through a real API call. No templates, no static copy,
no fallback text pretending to be AI output (section 6). No credits, no briefs or wraps.

## 2. What's broken now and how it should work

The briefs and wraps work today read like a generic productivity dashboard. Every card is a
template. No personality, no insight, no surprise — the opposite of what a wrap should be.

### The evening wrap today — an 8-card carousel, almost all of it wrong

- **Card 1 grades you.** *"5h 37m tracked today · 35% of a 16-hour day · 21 apps · 12 work
  sessions · 8:04 AM – 3:01 PM."* The tracked time is fine. "35% of a 16-hour day" is a
  grade — it tells you that you wasted 65% of your day and makes you feel bad. The app and
  session counts are noise; nobody cares that they touched 21 apps.
- **Card 2 is the grade we're removing.** *"Marked focused 68% of the time. 3h 50m matched
  Daylens' focus signal. The strongest focus signal came in the morning."* Focus scores,
  focus signals, focus percentages — all of it goes. Daylens shows your day, it never grades
  it.
- **Card 3 uses a raw page title as a name.** *"Microsoft Intune admin center — 1h 1m of
  AI-assisted work."* The block name is a browser tab copy-pasted in. It should say what you
  were *doing* ("Managing device policies in Intune"). "AI-assisted work" is a meaningless
  category.
- **Card 4 is robotic and hedges.** *"Claude — 1h 33m here today. Claude captured your
  longest app engagement at 94 minutes, likely supporting the Intune session."* "Captured
  your longest app engagement" is machine-speak. "Likely supporting" is a guess out loud —
  either it knows Claude was for the Intune work or it doesn't. The word "likely" should
  never appear.
- **Card 5 is a chart with no story.** *"WHERE TIME WENT"* with category bars — AI tools 2h
  2m, Writing 1h 27m, Browsing 56m, Development 13m, Communication 12m. The categories are
  wrong (is Claude "AI tools" or "Development"?) and there's no insight. Spotify Wrapped
  doesn't show you a pie chart of genres — it tells you a story about your year.

### The morning brief today — a slideshow with focus heuristics

A multi-slide carousel that leads with focus scores instead of catching you up on what you
left open. Toggle is on; the content has never been verified on a real day.

### The weekly wrap today — numbers that disagree

The stat card says **20h 7m**; the review text on the same screen says **20h 53m**. And
*"Main mode: Entertainment"* shows up for a working developer. Monthly and annual wraps
don't exist at all.

The rest of this spec is how each of these should work instead.

## 3. The voice

This is the whole game. A brief or wrap lives or dies on its words. The voice is the same
calm, specific, grounded voice as the rest of Daylens — but with more warmth and more
personality, because this is the moment Daylens talks *to* you.

Think Spotify Wrapped: specific, personal, a little surprising. "You listened to Taylor
Swift 847 times — top 0.5% of fans." Not "Your most-played artist was Taylor Swift."

- **Specific over generic.** Real app names, real times, real activities. "94 minutes
  straight in Claude — your longest stretch in any app today," not "significant time in your
  AI tools."
- **Easy on the first read.** Use everyday words, short sentences, and one idea per card.
  Explain a term if someone would need product or technical knowledge to understand it.
- **Insight over readout.** A number alone isn't a card. Tell the reader something they
  didn't already know or wouldn't have said themselves.
- **Never grades.** No score, no focus percentage, no "you used 35% of your day," no
  "drift." Daylens shows the day; it never judges it.
- **Never hedges.** No "likely," no "approximately," no "it appears." If Daylens isn't sure,
  it leaves it out — it never guesses out loud.
- **Never robotic.** No "captured your longest app engagement," no "matched the focus
  signal," no "AI-assisted work." Write like a person, not a metrics pipeline.
- **Names what you were doing, not the app you used.** "Managing device policies in Intune,"
  not "Microsoft Intune admin center."
- **Warm, occasionally funny.** A wrap can have a personality. Light humor is welcome when
  it fits the facts and the user's tone, especially on a quiet day (section 5). Never tease,
  guilt, scold, or pretend to know how the person feels.

### Good vs bad — the contrast

| Bad (today) | Good (the bar) |
| --- | --- |
| "Claude captured your longest app engagement at 94 minutes." | "You spent more time in Claude today than in any other app — 94 minutes straight. That's a new record." |
| "Marked focused 68% of the time." | *(cut — Daylens doesn't grade)* |
| "Microsoft Intune admin center — 1h 1m of AI-assisted work." | "An hour managing device policies in Intune." |
| "5h 37m tracked · 35% of a 16-hour day · 21 apps." | "A long one — 5h 37m, mostly heads-down." |
| "WHERE TIME WENT: AI tools 41%, Writing 29%, Browsing 19%…" | "The afternoon was all Intune. The morning was split between Claude and writing — back and forth between the two for a couple of hours." |
| "likely supporting the Intune session" | *(either it knows, and says so plainly, or it leaves it out)* |

Every claim traces back to a real block. If the evidence doesn't support a sentence, the
sentence doesn't ship.

## 4. The morning brief

The morning brief is **two separate notifications**, with different jobs and different
firing rules. They are not one carousel.

Both are written fresh every day for that specific day. Neither is a generic "Your brief is
ready." The notification body itself must be a real, readable summary — useful without
opening the app.

### 4.1 Yesterday's recap

Sent first thing when you open the laptop in the morning.

**Firing rule — this is critical:** it fires **only if you did not already generate a recap
the previous day.** If you clicked "Analyze Day" yesterday, you already have your recap, and
this notification **does not fire.** It exists to give you the recap you didn't generate
yourself, not to repeat one you already saw.

The notification body is a fresh, specific summary of yesterday — readable without clicking.
Tapping it opens yesterday's Timeline.

> Yesterday was mostly the timeline rework — about four hours in Cursor and Claude Code in
> the morning, then the malaria notebook in the afternoon. You wrapped up around 6pm.

Not: *"Your recap for yesterday is ready."* That's a useless notification.

### 4.2 Carryover nudge

Sent after you've been working for **1–2 hours** that morning — not the instant you open the
laptop. It catches you once you're settled in.

**Firing rule:** it **always** fires, regardless of whether you generated a recap yesterday.
Its job is different from the recap — it's the "here's what to pick up" nudge.

It greets you, notes what it can already see you doing this morning, and lists the open
threads from yesterday worth picking up. If nothing was left open, it says so — a clean
start is a real answer.

> Good morning Tonny! Hope you slept well. I can see you've been on the timeline rework in
> Cursor and Claude Code since about 8am — nice start.
>
> A couple of things from yesterday you might want to pick back up:
> - The malaria Jupyter notebook was open most of yesterday afternoon — you had a couple of
>   hours in it.
> - The timeline rework is getting close to the v2 vision. Good momentum to keep.

When nothing carried over:

> Good morning! Nothing left hanging from yesterday — clean start. You're already an hour
> into the AI tab work in Cursor.

Notice: specific activities, real app names, real times, conversational — a friend catching
you up. Never *"You tracked 5h 37m yesterday across 21 apps."*

### 4.3 The stats slide

After the greeting, the brief can show one slide of interesting stats — time per activity,
apps and sites for yesterday and so far this week, with simple graphs. Same rule as
everywhere: every number comes from the blocks, and the slide is a story, not a wall of
charts. If a stat doesn't add to the picture, cut it.

## 5. The evening wrap

A short carousel of cards, sent in the evening as you're shutting down, written fresh for
that specific day. Tapping it opens today's Timeline.

### 5.1 Card structure — at most 5

Each card has to earn its place. If it doesn't add insight, cut it. A normal working day is
**at most five cards**, in this order:

1. **Shape of the day** — one sentence on what the day was about. Always present.
2. **What you worked on** — the real work, only if meaningful work happened (roughly 15+
   minutes). Named for what you were doing, not the apps.
3. **Where time went** — but as a *story*, not a bar chart. "The afternoon was all Intune;
   the morning bounced between Claude and writing." Not category percentages.
4. **Open thread** — only if something genuinely carries into tomorrow. Skip it otherwise.
5. **Quiet close** — a calm sign-off. Always present.

Cards 2 and 4 are conditional. A focused work day might show all five; a lighter day shows
three. Never pad to hit five.

### 5.2 A leisure day collapses to 2 cards

A rest day — Saturday, a day off, barely any tracked work — collapses to **two cards: shape
and close.** No focus lecture on a rest day. No "you only worked 35%."

There's room for light humor here — playful guilt about where you *could* have been, never
real judgment.

> **Shape:** A proper rest day. Two hours of YouTube, a long lunch, and not much else
> tracked. Honestly, good for you.
>
> **Close:** Your laptop barely saw you today — and that's allowed. See you tomorrow.

### 5.3 Language bar

Same as section 3, and worth repeating because the current wrap fails it hardest. Each card
should read like Spotify Wrapped — personal, specific, occasionally surprising. "You spent
more time in Claude today than any other app — 94 minutes straight. That's a new record"
beats "Claude captured your longest app engagement at 94 minutes." Every time.

## 6. Weekly, monthly, and annual wraps

Spotify Wrapped for your week, month, and year. Same data, same voice as everything else —
just a wider lens.

### 6.1 The one rule that makes them trustworthy: frozen snapshots

Weekly, monthly, and annual wraps are built from **frozen daily snapshots**, not from fresh
re-summaries. When a day's recap is finalized, its numbers are frozen. The week sums the
seven frozen days; the month sums the frozen days in the month; the year sums the months.

This is why the numbers always agree. The bug today — 20h 7m on the stat card, 20h 53m in
the review text on the same screen — happens because two parts of the screen compute
independently. With frozen snapshots, the stat card and the narrative read the **same**
frozen totals. They cannot disagree.

All wraps use the same blocks and threads as the Timeline. If the Timeline says 3 hours of
network work this week, the weekly wrap says 3 hours.

### 6.2 Weekly wrap

A recap worth opening at the end of the week. It should answer: what did you get done, and
what mattered?

- **The week in one line** — what the week was mostly about.
- **What mattered** — the biggest threads, named for the work, with real hours. "12h on the
  timeline rework across four days" — the threads that actually moved.
- **Where the time went** — as a story first; a chart is allowed but it has a **legend** and
  its totals match the stat card exactly.
- **A standout or two** — a real superlative. "Wednesday was your longest day — 6h heads
  down." Specific and true, never a grade.
- **"Main mode"** reflects your actual **work**, not leisure. A working developer's week is
  never "Main mode: Entertainment" because a few YouTube tabs were open on the side. Leisure
  is a separate, quieter readout — never the headline.

### 6.3 Monthly wrap

Spotify Wrapped for the month, built from the month's frozen daily snapshots.

- **The month in one line** — the arc of the month.
- **The threads that defined it** — the few projects or goals that took the most real hours,
  named for the work.
- **The shape of the month** — busiest week, quietest week, a notable streak ("nine days
  straight on the rework"). Story, not a grid of numbers.
- **A surprise or two** — a genuine superlative the user wouldn't have guessed. "Your single
  longest stretch all month was a 3-hour Intune session on the 14th."
- **What's carrying forward** — threads still open heading into next month.

### 6.4 Annual wrap

The big one. Spotify Wrapped for the year, built from the year's frozen monthly snapshots.
This is the wrap people screenshot and share, so the words matter most here.

- **The year in one line** — the headline story of the year.
- **Your biggest threads** — the handful of projects that defined the year, with real hours
  and when they were most active.
- **Your biggest month** — when you got the most done, and on what.
- **Superlatives** — the surprising, specific, fun ones. "Your longest single focus stretch
  all year was 4h 12m." "March was your most heads-down month." "You spent 180 hours in
  Cursor — more than any other app."
- **The arc** — how the year moved: what you started on, what you ended on, what shifted.

Monthly and annual don't exist today; this section is what they should be when built. They
are sequenced after weekly in the build order.

## 7. The no-credits rule

**No AI credits, no briefs or wraps.** Every word in every brief and wrap comes through a
real API call to the provider chosen in Settings. There are no templates, no static copy,
no hardcoded summaries dressed up as AI output, no fallback text.

If the user hasn't connected a provider, or has no credits, **no brief or wrap is
generated.** Daylens shows **one message** telling them to connect a provider in Settings —
and nothing else. No partial wrap, no canned recap, no "here's a sample."

This is the same rule as the rest of the app (see `ai.md` section 5). The call uses the
model picked in Settings, every surface, every time. If the provider errors, the message
names that provider plainly — nothing silently swaps to a different model.

## 8. Invariants (rules briefs and wraps must always obey)

1. Every word in every brief and wrap comes through a real API call. No templates, no static
   copy, no hardcoded text, no fallbacks — anywhere.
2. With no provider connected or no credits, no brief or wrap is generated; the user sees one
   message pointing to Settings and nothing else.
3. Every number comes from the same blocks and threads as the Timeline. No brief or wrap
   computes its own totals.
4. Weekly, monthly, and annual wraps are built from frozen daily snapshots, so every number
   on a screen agrees with every other number on that screen.
5. No grades — ever. No score, no focus percentage, no "X% of your day," no drift.
6. No block is named after a raw app name, page title, or video title. Names say what you
   were doing.
7. The voice never hedges ("likely," "approximately," "it appears") and never reads like a
   metrics pipeline ("captured your longest app engagement").
8. **Yesterday's recap** notification fires only if no recap was generated the previous day;
   its body is a fresh, readable summary, not "your recap is ready."
9. **The carryover nudge** fires after 1–2 hours of work that morning, always, written fresh
   for that day.
10. The evening wrap is at most 5 cards on a working day and collapses to 2 (shape + close)
    on a leisure day — with no focus lecture on a rest day.
11. Every brief and wrap uses the model picked in Settings; errors name that provider and
    nothing silently swaps to another model.
12. Every card is understandable on the first read: everyday words, short sentences, one
    idea per card, and no unexplained product or technical jargon.
