# Daylens — what we're building

Daylens answers one question: **"What did I actually get done today?"**

It quietly watches what you do on your computer — the apps you use, the windows you're in,
the sites you visit — and turns it into an honest picture of your day. Nothing leaves your
machine unless you ask it to.

## The one idea everything is built on

Daylens groups your activity by **what you were trying to do**, not by which app was open.

- A **block** is one continuous stretch of a single thing, shown on your Timeline.
  Example: *"Configuring the work network, 9:00–12:00."* You were in the Ubiquiti dashboard,
  Photos, and Terminal — Daylens shows that as **one block**, named for what you were *doing*,
  not three blocks named after apps. For example a quick 2-minute glance at X(a.ka twitter) gets folded in, not called
  out as its own thing.
- A **thread** is the bigger goal that ties blocks together across the day or week.
  Example: you set up the router in the morning and come back to fix DNS at 2pm — that's
  two blocks, but **one thread**: *"Set up the work network."* Threads are what show up in
  "What mattered" and the weekly review.

That's the whole model: your day is **blocks** (what you see) grouped into **threads**
(what mattered).

## The three things you can do

1. **Timeline** — your day as a clean list of blocks, each sized by how long it took and
   named for what you did. Distractions live separately, not mixed into your work.
2. **Apps** — pick one app (say Ghostty) and see what you actually did in it. Same
   intelligence, filtered to one app.
3. **AI** — ask "What did I get done yesterday?" and get a calm, specific answer, like a
   sharp assistant who watched your day. Morning briefs and a Spotify-Wrapped-style weekly
   review come from the same place and can be triggered by a notification, through command + k search option or even a shortcut key.

All three read from the **same** blocks and threads. If the Timeline says 3 hours of network
work, the AI says the same. **One truth, three views.**

## What Daylens is NOT

- **No grades.** No "Score," no "Focused," no "Drift." We don't judge your day. We show it. It's a tool, not a judge. Minimal and focused.
- **No guessing out loud.** Daylens says what the evidence proves. If it doesn't know, it
  says so plainly — it never pads with "likely…" or robotic precision like
  "32 minutes 22 seconds in Codex."

## How Daylens talks

Like the [Dia morning brief](https://www.diabrowser.com/start), Daylens is warm, short,
specific, and grounded. It uses everyday language that makes sense on the first read,
whether someone is technical or not. It leads with the useful part, keeps one idea per
sentence, and explains an unfamiliar term when it has to use one.

It feels like a thoughtful friend who paid attention to your day. That warmth never becomes
empty praise, forced enthusiasm, judgment, or fake familiarity. Every factual claim still
traces back to something real.

## How we build it

Five rules the whole app obeys:

1. **Evidence first** — the raw activity is the truth; everything is derived from it and can be rebuilt from it.
2. **Blocks before threads** — figure out the continuous stretches first, then group them into goals.
3. **Your corrections win** — if you rename, merge, or hide something, that sticks and teaches Daylens.
4. **Facts before words** — the AI narrates real numbers; it never invents them.
5. **Admit uncertainty** — when Daylens isn't sure, it says so instead of making something up.

We build one view at a time — **Timeline first, then Apps, then AI, then wraps** — and prove each one works on a real day, week, or month before moving to the next.

---

*Shared vocabulary lives in [`CONTEXT.md`](CONTEXT.md). Architecture decisions and
why we made them live in [`docs/adr/`](docs/adr/).*
