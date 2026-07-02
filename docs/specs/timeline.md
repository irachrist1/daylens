# Timeline — build spec

## 1. What the Timeline is

The home screen. Your day from midnight to now, as a vertical list of **blocks**, newest
work readable at a glance. Each block is named for **what you did** and sized by **how long
it took**. To the right, a short, honest recap of the day. That is the whole screen.

## 2. What's broken now and how it should work

- Blocks named after a page or app — "Ubiquiti Account", "UOS Server",
  "Cross-platform activity tracker", raw YouTube video titles.
- The same activity split into duplicate blocks (two "UOS Server" back-to-back).
- Wrong categories — network work tagged **SOCIAL** because one X.com tab was open.
- A right-side recap that is usually wrong, and totals that disagree (42h 2m vs 46h 19m).
- **Score / Focused / Drift** grades.
- Not responsive; the left column has to be scrolled from the view to the left column to work.
- The detail panel shows **"Apps used"** and **"Key artifacts"** — two lists for one idea.
- Fix controls named badly: "Fix this episode", "Not right?" and "Edit this block" should
  be renamed to "Edit" (one edit surface: title, type, regenerate — see §3.4 rule 5;
  "Rename" was the interim name), "Merge with above/below". Remove the "Split" and "Hide" options
  and get rid of the "episode" wording everywhere.

## 3. How blocks are built (the engine)

This is the heart of the work. Today the engine builds a block whenever you stay in one
app for a while, then tries to patch the result with ~5,000 lines of rules. On a real day
that yields **53 blocks for a ~8-block day**. We replace the approach, not patch it.

### 3.0 Evidence first — the engine is only as good as what it's fed

Before any boundary or name, the engine assembles an **evidence object** for the stretch:
the apps, **the window titles, the sites with their URLs and page titles, and the files
touched** — with timing for each. This object is the single thing naming, categorizing, and
the AI all read.

This is the failure we found on a real day (see `docs/findings.md`): a block was handed
*five app names and nothing else* — `pages: [], documents: [], domains: []` — and the AI
correctly but uselessly called it "Computer activity." It wasn't dumb; it was blindfolded.
Two root causes, both upstream of the engine:

- **Window titles and page content must actually be captured.** If the evidence object is
  empty, no model and no rule can name the block. Capture quality is the foundation, not a
  detail (Daylens is metadata-only, so the little signal we do collect is all we have).
- **Every browser's sites must reach the evidence**, not just the hardcoded ones. How that
  works — discovering browsers from the OS instead of a name list — is specified in
  [`apps.md`](apps.md) §3.4 and applies identically here. A block built while you were in an
  unrecognized browser (Zen) loses the URLs that carried the intent.

A block carries the same evidence object wherever it's read — Timeline, Apps, AI. One object,
declared once, so the views cannot disagree about what happened.

### 3.1 Block boundaries — what starts a new block

A new block starts only on a strong signal:

- A real session break — a genuine gap in activity of roughly **15 minutes or more**
  (founder decision, Jul 2, 2026 — supersedes the earlier 45-minute rule). The gap **ends**
  the current block and is never absorbed into it; a new block starts only once real
  activity resumes. Idle/away time is not a detour, not tracked time, and not part of any
  block's duration — it renders as blank, empty space on the timeline, proportional to how
  long the gap lasted, with no card, no color, no title, and nothing clickable. A block's
  duration equals the time you were genuinely active, never the wall-clock span across a
  lull. The "tracked" total follows the same rule: only real active time, never elapsed
  clock range.
- A single block claiming many unbroken hours (say, 12:00 AM straight to 10:54 AM) is
  almost never real. If a block that long exists with no detected gaps, Daylens flags it
  (main-process log) rather than trusting it silently — it usually means idle/away
  detection failed somewhere in the span.
- A meeting starts or ends.
- You clearly switch to a **different goal** (different subject/project).
- A user correction says "cut here".

A new block does **not** start just because you switched apps, opened a new tab, or glanced
at something for a minute or 5 minutes or even 10 minutes. Apps are *evidence*, not
boundaries. The target shape is a large, readable calendar block — 1, 2, 3, even 5 hours —
never a fragmented string of 15–20 minute chunks.

**Below the block: a dwell floor on raw switches.** An app or site you were in for **under
~10 seconds** is not a real switch — it's a flicker, and it should never become its own
session, evidence row, or session-count. This is Toggl's rule, and it's what kills the
"5,977 micro-sessions in a week" inflation we see in the Apps view
(`docs/research/prior-art.md` §3). Real evidence has a floor; noise doesn't count.

### 3.2 Brief detours are absorbed

A short off-task moment inside a work stretch folds into that block — it does not rename it
or split it. Your X.com peek during network setup is absorbed, not a SOCIAL block.

> **DECISION (resolved): the cutoff.** A brief off-task peek (under ~10 minutes) is absorbed
> into the surrounding work. Independently, the §3.4 calendar floor means **nothing under
> fifteen minutes is ever its own block** — so a 12-minute off-kind sliver that isn't a peek
> still folds into a neighbour. §3.4 is the single size rule.

### 3.3 Same-intent neighbors merge

Two adjacent blocks that are the same thing become one. The two "UOS Server" and
"Configuring the work network" and "Ubiquiti dashboard" blocks are one block — and the AI
should understand that and merge them. The name of the merged block should combine all three
into one coherent title, for example "Configuring the work network using the Ubiquiti
dashboard" or "Setting up the work network using the Ubiquiti dashboard and the Terminal."

### 3.4 What a calendar block is — the 15-minute floor and proportional height

A block is **one continuous stretch of one thing you were doing**, drawn on the vertical
timeline the way an event sits on a calendar. Two rules make it read as a real calendar:

1. **No block is shorter than fifteen minutes.** A stretch briefer than that isn't a block of
   its own — it's a moment that belongs folded into the work around it. This is the hard floor
   the engine enforces last, after every boundary decision (`enforceMinimumBlockFloor` in
   `workBlocks.ts`): any sub-15-minute non-meeting block is folded into its best neighbour
   (a related one first, then same-category, then the nearer by gap). The only blocks that may
   stay under the floor are a block with **no non-meeting neighbour** to fold into (a lone short
   day) and a real **meeting** (a 10-minute standup is a block, not a sliver). A genuinely long
   activity that was only sparsely tracked — a 41-minute agent run that logged 30 seconds of
   foreground polling — spans ≥ 15 minutes and is a real block, never folded. Analyze only ever
   makes the day **fewer, truer blocks**, never more.
2. **A block's height is proportional to how long it lasted.** A 3-hour block towers over a
   15-minute one; the shape of the day tells you where the time went before you read a label.
   Blocks are drawn at their wall-clock position (top = start, bottom = end) on a fixed
   px-per-minute scale, with a small readable minimum so the shortest (15-minute) block
   still shows its title and time.
3. **The day's bounds are the day's activity.** The vertical track runs from the hour of the
   first tracked event to the hour of the last (or "now" on the live day) — hours with no
   activity before or after simply don't exist in the view. No rendering or scrolling
   through an empty midnight-to-9am. The week grid applies the same rule across its seven
   days on one shared hour scale.
4. **Blocks are color-coded by category, Google-Calendar style.** Each kind of activity has
   one consistent color used everywhere a block is drawn — day grid, week grid, month dots,
   inspector — from the single palette in `shared/activityColors.ts`. The user can customize
   the five activity-group colors in Settings → General (see `settings.md` §8); an override
   applies across every surface at once, never per-view. On the card itself the color must
   be unmistakable: a solid accent stripe on the left edge plus a frosted-glass fill
   (backdrop blur) so the hour lines behind never strike through the title or summary text.
5. **Blocks are edited like calendar events.** Clicking a block opens a **floating event
   card anchored beside the block** (the Google Calendar popover, founder reference
   Jul 2, 2026) — never a page change: icon actions top-right (pencil = edit, sparkle =
   regenerate summary, trash = delete, X = close), then color chip + title, the
   date · time · duration line, type tags, the summary, and the evidence ("What you were
   in" + Detours) below. The pencil flips the card into the edit surface in place: title
   (with AI suggest), and **Type** — recategorizing recolors the block everywhere, since
   category drives color. Right-clicking a block opens the same actions as a context menu
   (Edit / Regenerate summary / Delete). A type change is a review correction like a
   rename: it wins over the computed category, flips the work/leisure kind to match, and
   survives every rebuild (invariant 8). Escape or clicking empty grid closes the card.
   The right-hand column always holds the day recap; block details never displace it.
   Provisional (live) blocks open the card read-only (no edit/delete).
6. **Any block can be deleted.** Delete asks "Are you sure?" with the OS-native dialog
   (macOS and Windows), then records the deletion as a correction (review state `ignored`).
   The block disappears from every surface — timeline, month grid, recap, AI, wraps,
   search — its span renders as the empty space it now is, and the deletion survives every
   rebuild: the deleted span's sessions are excluded from re-analysis so the block can
   neither re-form nor be absorbed into a neighbour. Raw captured activity is never
   destroyed.

This supersedes the earlier §3.2 "10-minute cutoff" proposal as the single size rule: under
15 minutes is never its own block.

### 3.5 How a block gets its name — deterministic first, AI for the rest

Naming is **tiered**, cheapest and most certain first. This is the same shape the best
trackers use (Rize: a specific rule wins, AI only handles the ambiguous remainder, and a
correction becomes a durable rule) and the same "resolve before you phrase" rule as the AI
tab. See [`docs/research/prior-art.md`](../research/prior-art.md) §2.

1. **A correction or rule wins.** If you renamed this block, or set a rule for its kind, that
   is the name — always, and it survives every rebuild (§8 invariant 6). No AI call.
2. **Otherwise the AI names it from the block's evidence.** The **AI reads only that one
   block's evidence object** (§3.0) and proposes a human title + subject. A **validator**
   checks the title is actually supported by the evidence; if it isn't, we fall back to tier 3.
3. **If intent can't be derived, name from the evidence we have — never give up out loud.**
   The fallback is an honest, evidence-based title built from the real apps and artifacts:
   *"Cursor, Warp, and Terminal — focused work."* It is **never** the literal "Computer
   activity," never "Untitled," and the category is never shown as "Uncategorized" to the
   user. A block always names what it can see; it never announces that it failed.

Naming only runs once a block has **enough evidence to be worth naming** — never on thin,
early signal (§4). A correction always feeds tier 1 for next time.

- **Never** use a raw page title, app name, or video title as the block name. No "Ubiquiti
  Account", no "Codex", no video titles.
- Style: short, says what you were *doing* — usually verb + object. Bad: "Ubiquiti Account".
  Good: **"Configuring the work network using the Ubiquiti dashboard and the Ghostty Terminal"**.
- Prioritize naming blocks after useful activities instead of streaming or social media
  activities — most users multi-task with social media on the side but they were actually
  working.

> **DECISION (you): the unknown-intent fallback.** When Daylens truly can't tell, I propose it
> names from the evidence it has ("Cursor, Warp, and Terminal — focused work") and never shows
> "Computer activity" or "Uncategorized." Good, or do you want it to say "not sure" outright?

### 3.6 How a block gets its category

From the block's **overall intent**, never from a single tab. Network admin work keeps its
real category; one open X.com tab can never flip a work block to SOCIAL.

### 3.7 Understanding human behavior

We need to study human behavior and ensure we provide the best experience and block names
that are actually closer to what the user was doing, not just the apps they were using.
We need to bring and use all meaningful data available to make blocks coherent and
meaningful — the AI analyzing the block needs to understand what each app does, not just
its name and title, but which app does what and how it contributes to the block.

We need to spend a little more tokens to let the AI prompt the user for more information to
make blocks more coherent — BUT only bring this option when the AI couldn't really figure
out the user's intent.

## 4. The live view (before recap)

**A live block is never given a derived intent-name.** You can't know what someone was trying
to do while they're still doing it — the activity can swing in seconds. Naming live is how we
got "Software Development Block" stamped on a transcription session. The best trackers agree:
Rize keeps the current entry provisional and only finalizes it into a named suggestion at the
context switch (`docs/research/prior-art.md` §2). A name needs **enough accumulated evidence**
before it's worth proposing — never the first signal.

So, on the Today view:

- The day so far is **one provisional block per continuous sitting**, labelled neutrally —
  the stretch being lived in right now is *"Active now"*, finished stretches are *"Earlier
  today"*. No speculative per-activity names while live.
- A real activity gap of roughly **15+ minutes** ends the current provisional block; the
  gap is blank space on the grid, and a new provisional block starts when activity resumes.
- Opening it shows the threads active during that time, with time spent on each — and the
  old "Apps used" and "Key artifacts" sections shown **together in one view**, not separated.
- The "Not right?" button is removed from this view.

The provisional block becomes real, named blocks only when it **finalizes** — at end of day,
on next open, or when the user clicks Analyze Day (§5). Naming happens once, on finalize, with
the full evidence in hand — not live, not every few seconds.

## 5. Generating the recap

When the user clicks the button that splits that giant block into smaller blocks, we use AI
to split the day into blocks that are coherent and meaningful. This is currently called the
"Re-analyze with AI" button — it doesn't work at all right now.

This needs to be done right because it's the foundation of the app. We need to define what
makes a block coherent and meaningful based on the evidence and the user's intent.

**Notifications:** We can send a notification the next day that yesterday's recap is ready,
which opens on yesterday's Timeline view. We can also give the user an option to generate a
recap on the same day with a button called "Analyze Day."

## 6. Distractions / off-track time

- Brief detours are absorbed into the surrounding block (section 3.2) — they never appear
  as work.
- Inside the block's detail panel, a **"Detours"** section answers "where did *active* time
  go elsewhere in this window": the leisure/social sites and apps with their minutes. A
  detour is time you were active but off-task **within** a block (a 20-minute YouTube run
  mid-session) — still real tracked time, so it belongs in the block's breakdown. Idle/away
  time is **never** a detour: it isn't something you were "in", it's the absence of
  activity, and it shows as blank space on the grid instead. It is informational, never a
  grade. (This section was previously called "Side trips".)
- Known limitation, deliberately not solved yet: Detours can't distinguish off-task
  browsing from legitimate learning (an educational video related to the work). Tracked as
  **DEV-119** to design properly; for now all non-primary-task browsing within a block is
  a detour.
- The detail panel also shows a **block type tag** ("Focused work", "Meeting", "Research",
  "Leisure"…) derived from the block's kind + dominant category, and the same tags appear
  as filter chips above the day grid — filtering dims non-matching blocks in place so the
  day's shape stays honest.

> **DECISION (resolved): distraction placement.** Detail panel only; the timeline itself
> stays clean.

## 7. The day recap (right-hand panel)

Replace "The shape of the day" + Score/Focused/Drift with an honest recap built from the
**same blocks**.

Keep the tracked hours section on the top along with how many blocks and apps and sites were
used during that day. Remove everything else from "The shape of the day" section — the date,
the score, the focused hours, the drift hours. Remove the "What mattered" section.

What stays: a "Generate Recap" button and a summary of the day generated by the AI, based on
the blocks and the apps and the sites that were used during that day.

## 8. Invariants (rules this view must always obey)

1. A block's on-screen height is proportional to its duration.
2. No block is shorter than fifteen minutes, except a meeting or a lone block with no
   non-meeting neighbour to fold into (§3.4). Analyze makes the day fewer blocks, never more.
3. No block is named after a raw app, page, or video title.
4. A single off-task tab never sets a block's category.
5. Adjacent same-intent blocks are merged.
6. Every number on the screen comes from the same blocks — the recap total equals the sum of
   the blocks. No two parts of the screen disagree.
7. A user correction always wins and always survives a rebuild.
8. The view never shows a Score, a Focus rating, or a Drift number.
9. When Daylens doesn't know, it says so — it never fills the gap with a guess.
10. Idle/away time is excluded from every block's duration, from Detours, and from the
    tracked total. A 15+ minute activity gap ends the block and renders as blank space —
    it is never absorbed, never a card, never counted.

## 9. Future integrations

In the future Daylens will be able to connect to tools you use — calendar, files on your
laptop, and other tools — to make blocks more coherent and meaningful. For now we need to
ensure Daylens can accurately track the user's activity and the AI can understand and infer
the user's intent from what was tracked.
