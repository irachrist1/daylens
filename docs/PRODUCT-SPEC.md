# Daylens — Product Specification

Authoritative target state. Pair this with the implementation plan; every change should move the product closer to what's described here. When the plan and this spec disagree, **this wins** — re-plan rather than ship something off-spec.

Last updated: 2026-05-12 · Author: C. Tonny · Status: Live

---

## North Star

**Daylens is the operating system for your working day.**

It captures everything that happens on the user's computer — apps, browser, focus, work blocks — and turns it into something genuinely useful: a timeline they can actually read, AI that answers grounded questions about their day, and (Phase 2) a thinking layer that bridges what they did with what they read, wrote, and thought.

Three non-negotiables:
- **Local-first.** SQLite on the user's machine is the truth. Web sync is opt-in.
- **Specific, not generic.** Every screen names the block, file, page, artifact. Generic copy is a bug.
- **Voicy, not procedural.** AI answers and Wrapped narration sound like a colleague who's been watching, not a JIRA report.

If a feature does not move the product toward those three, it does not belong in v1.

---

## The Bar for "Done"

A real friend on macOS or Windows installs Daylens, leaves it running for a week, and:

1. Gets an accurate timeline across every browser and app they actually use.
2. Opens Wrapped and feels a real "wow" — specific, AI-narrated, surprising. Not a procedural bullet list inside animated slides.
3. Asks the AI plain questions and gets correct, evidence-cited answers consistently.
4. Installs without seeing a danger screen, unsigned-installer warning, or broken updater.
5. Opens the app daily, unprompted, because it earns the return visit.

If any of those five fail, the product is not done.

---

## The Five Views

### I. Timeline

**Purpose.** A chronological reading of the day — minute by minute, collapsed into 5- to 60-minute work blocks with deterministic labels, the apps involved, the pages opened, the artifacts touched. Gaps explicit. Browser pages first-class. Focus sessions overlaid.

**Should answer:**
- What did I actually do at 3pm yesterday?
- Show me the 90-minute block where I was rewriting the AI router.
- Where did my focus sessions land this week — morning or evening?
- How long was I in meetings on Tuesday, and what did I do between them?
- Which gaps are real breaks, and which are tracking failures?

**Good vs gimmicky.**
- *Good:* "47-minute block titled 'Daylens AI refactor — extract chat_answer from ai.ts.' Cursor in foreground, two GitHub tabs, Claude transcript opened twice."
- *Gimmicky:* "You spent 47 minutes coding." A coloured bar chart that says the same thing every other tracker already says.

**Current problems (specific):**

The **right-side day summary is the weakest part of this view.** Today it lists deterministic counts that feel like a rejected sidebar from a generic analytics dashboard. It should read like a paragraph, not a stat panel.

What it should be:
- A short paragraph (2-4 sentences) describing the shape of the day, voicy, specific. Cites work blocks by their actual label or artifact name.
- Followed by a small set of "what mattered" callouts: the longest deep block, the biggest detour, the meeting with the most follow-up activity, the gap that turned into a side quest.
- Wrap-up line: one sentence connecting to yesterday or to a multi-day thread the user is on ("you finally went past the 90-minute mark in Cursor today, first time this week").

What it must not be:
- A focus-percentage score.
- A list of app names and minutes.
- Inspirational phrasing ("you crushed it!").

Other timeline issues to fix:
- Browser activity gaps on some browsers (audit which actually capture and which silently miss).
- Block splitting still occasionally produces 60-minute blocks that span obvious context switches.
- Empty-state copy should reference the user's recent activity, not generic "no data yet."

---

### II. Apps

**Purpose.** Per-tool view. One row per app the user actually used. Each row earns its space by saying what the app *helped them accomplish*, not just total minutes. Open a row → work blocks the app participated in, pages/documents touched, weekly trend.

**Should answer:**
- What did I do in Cursor today — which files, which projects?
- How is my Claude usage trending: rising, falling, shifting in shape?
- Which sites am I leaking time on this week?
- What did Figma help me ship this month?
- Did Notion become the new Slack for me, or is that just a feeling?

**Good vs gimmicky.**
- *Good:* "Cursor: most time on Daylens (3h 12m) and ai.ts specifically. Started a new file chatAnswer.ts Tuesday — first commit since."
- *Gimmicky:* "Cursor: 3h 12m today. ↑ 14% vs last week. Daily average: 2h 50m."

**Current problems (specific):**

The Apps view needs a redesign. The current row design treats apps as totals; the redesign should treat them as **contexts**.

Redesign brief:
- Each app row's primary text is **what was accomplished in it today**, not its name + total minutes. Name + minutes are secondary metadata, smaller, lower contrast.
- An app's detail panel leads with a narrative — 2-3 sentences describing what the app participated in — not a metrics dashboard.
- Group apps by *category of work* (development / writing / communication / research / etc.), not by raw minute count. Within a category, order by today's relevance (most recent meaningful use), not by total.
- Demote apps with low signal (opened, idle, never returned to) below the fold. Don't hide them; just don't reward them with prominence.
- "Sites you're leaking time on" gets its own callout block at the bottom of the page, not buried in app rows.
- Week-over-week trends are a click-in, not a primary cell — the primary view is *today*.

Visual direction:
- Larger row heights, more breathing room.
- Typography pulls the eye to the narrative text first, the metadata second.
- Category headers act as section breaks, not chips.
- Iconography stays for recognition but never carries the meaning.

---

### III. AI

**Purpose.** Plain-language questions about the user's day, week, patterns. Answers cite the work blocks, pages, or artifacts they came from. Deterministic routing handles well-shaped questions first; the LLM picks up the rest. **When it doesn't know, it says so — never invents.**

**Should answer:**
- How many hours did I spend on ASYV this week, and on what?
- What did I work on for Andersen yesterday?
- Draft a short status update for the team based on what I did this week.
- Which projects am I losing momentum on?
- Was Thursday a deep-work day or a meeting day — by how much?

**Good vs gimmicky.**
- *Good:* "4h 26m on ASYV this week, mostly Tuesday morning in Cursor on the dashboard refactor, plus two meetings (Wednesday 10am, Friday 2pm). The Friday meeting is the only one with no follow-up activity yet."
- *Gimmicky:* "You worked on ASYV for several hours this week. Great job staying focused! Want me to help you plan next week?"

**The bar.** *If a colleague who had been watching the user work were asked the same question, would they answer the same way?* If yes, ship it. If the AI gives a coloured opinion or generic productivity homily, kill that path.

**Current problems (specific):**

AI responses and follow-up suggestions are the weakest part of the product today. Three failure modes:

1. **Fumbling on simple questions.** Time/duration questions sometimes fall through to LLM when they should be answered deterministically. Specific-work questions ("what did I do for X yesterday") hit the LLM with insufficient context and produce vague answers.

2. **Follow-up chips are noise.** The chips offered after an answer often suggest temporal words ("Today", "Yesterday"), generic verbs ("Tell me more"), or things the user already asked. They should suggest a *next coherent question* about a specific entity that appeared in the previous answer.

3. **Voice drift.** The model occasionally produces motivational filler ("great work this week!") or generic prose. Every prompt that touches user-facing copy must enforce the banned-vocabulary list and the cite-evidence rule.

Concrete fix targets:
- **Router coverage.** Time/duration, "what did I do for X", and "show me the block where Y" must be deterministic in 95%+ of cases. Add a regression harness with 30+ golden examples.
- **Follow-up generation.** Chips must (a) name a real entity from the answer just produced, (b) ask a different *shape* of question than the one just answered, (c) reject any chip containing a temporal word, greeting, or generic verb. Two-stage filter: deterministic candidates pass a stop-list; LLM-generated candidates must reference a named entity from the answer text.
- **Citation discipline.** Every claim cites at least one work block, page, or artifact, or the answer says "I can't see evidence for that." No exceptions.
- **Voice contract.** A single system prompt fragment, reused across every chat job, enforcing voice and banned vocabulary. Tested against a golden set of expected outputs.
- **Architecture.** The current `ai.ts` is a single 4,500+ line file. Extract per-job modules (`jobs/chatAnswer.ts`, `jobs/daySummary.ts`, etc.); keep `aiOrchestration.ts` as the dispatcher. Refactor before adding new job types.

---

### IV. Wrapped

**Purpose.** Daily, weekly, eventually yearly recaps. AI-narrated, not procedural. Voicy. Specific. Surprising. The morning brief should feel like Spotify Wrapped opening for a year the user actually lived; the evening wrap should feel like a friend asking how the day went and listening.

**Should answer:**
- What was yesterday actually like?
- Did I do anything I'm proud of this week?
- What was the shape of my Tuesday — focus or fragmentation?
- When did I do my best work this month, and at what time of day?
- How did this week compare to last week — not in numbers, in feel?

**Good vs gimmicky.**
- *Good:* "Tuesday was your kind of day — three uninterrupted blocks on Daylens, no meetings, one detour into Sunday Scoop drafts at 4pm. You stayed late."
- *Gimmicky:* "On Tuesday you spent 6h 12m in development apps. Your top app was Cursor. You had 0 meetings. ★★★★☆"

**Current problems (specific):**

Wrapped's slide aesthetic is fine. The **content inside the slides is the problem.** Every slide today is computed deterministically from `wrappedFacts.ts` — no AI narration, no voice, no surprise. The slides are pretty animations wrapped around procedural bullet points.

Fix path:
- Replace deterministic slide *content* with AI-narrated content, fed by the same `wrappedFacts` data. Keep deterministic facts as a fallback when AI is unavailable; make AI the default.
- Pin narration to a real voice via system prompt — tone calibrated against the user's published writing. Plain, direct, slightly dry. No motivational filler.
- Each slide narrates one specific thing well. Avoid the "summary of summaries" failure mode where every slide says a slightly different version of the same fact.
- **Evening Wrap is currently broken.** Fix as part of this work. Evening wrap should:
  - Recap the day in 2-3 sentences.
  - Surface one thing worth reflecting on (a contradiction, a missed plan, an unusual pattern).
  - Set up tomorrow with one line — not a to-do list, a posture ("tomorrow's the second day on the refactor — go finish it").
- Weekly Wrapped is a Sunday-evening surface. Should feel like a friend asking about the week, not a productivity report card.

---

### V. Mind (Phase 2)

**Purpose.** A thinking layer. Bridges Daylens (what the user did) with their Obsidian vault (what they read, wrote, thought). Maintains a small set of evolving **positions** — the user's actual takes on the topics they engage with, citing the journals/drafts they came from. Flags **contradictions** when this week's draft conflicts with last month's. Surfaces **action chips** — "four saved sources on evals, no draft yet" — that turn saving into shipping.

Positions live in the vault as plain markdown. Mind reads, synthesises, and surfaces. **The user remains the author.** The model never authors a position the user hasn't, at some point, said in their own writing — it can only summarise, contrast, and ask.

**Should answer:**
- What is my current take on AI agents, with sources?
- Is anything I'm writing this week contradicting what I wrote last month?
- Which of my saved articles deserve to become a Sunday Scoop?
- Have I changed my mind about anything recently — and where is the evidence?
- Which of my open drafts are stale, and what would it take to finish them?

**Scope marker.** Mind does not ship in v1. Do not start Mind work until the v1 bar (top of this doc) is met on Timeline, Apps, AI, and Wrapped.

---

## The Question Taxonomy

Five families of questions the AI must answer well. Each is a different shape of thinking — and a different failure when you get it wrong. Every release is graded against a golden set from each family. **Regression in any family is grounds to hold the release.**

### 01 — Time & Duration

Simplest. Deterministic when data is clean. Failure mode: silent rounding, attribution gaps.
- How many hours did I spend on Daylens this week?
- When did my deepest focus block start yesterday, and how long?
- How long was the gap between the standup and lunch?
- What was my longest uninterrupted stretch in Cursor this month?
- How many hours in meetings Thursday vs Friday?

### 02 — Specific Work

Hardest. Requires real attribution — pages, artifacts, repos — not just app names. Failures here feel like the product is lying.
- What did I work on for ASYV this week?
- Show me every block where I touched the Daylens AI refactor.
- Which pages did I have open while drafting Sunday Scoop #51?
- What was the 4pm block on Tuesday actually about?
- Which artifacts did I produce yesterday — files, PRs, drafts?

### 03 — Cross-cutting

Synthesis across days. Risk: generic answers that sound smart but don't land.
- Which projects am I losing momentum on?
- When in the day do I do my best deep work?
- Is my browser-research-to-writing ratio off this week?
- Which sites are quietly stealing more time than I think?
- What's the rhythm of my Mondays vs my Fridays?

### 04 — Reflective

Voicy. Risky. Resist inspiration. Specificity over warmth — but warmth where earned.
- What was yesterday actually like — describe it in three lines.
- Was Tuesday a deep day or a fragmented one?
- Did I do anything I'm proud of this week?
- Where did my attention drift today — and was it on purpose?
- If I described my week to a friend, what would I say first?

### 05 — Generative

Drafts, status updates, recaps. Trap: generic AI prose. Voice and citation mandatory.
- Write a short Slack status: "what I did this week, what's next."
- Summarise this week for the Daylens investors' update.
- Draft a daily journal entry for Tuesday — in my voice.
- Turn yesterday's deep block into a paragraph I could share.
- List the three things I should not forget from this week.

---

## Design Principles

Six rules. They override taste, opinion, and shipping pressure. When two conflict, the earlier one wins.

### 01 — Specificity over abstraction

If a sentence could appear in any other tool's marketing copy, it does not belong. Name the block. Cite the file. Quote the title. Generic costs nothing to say, which is why nobody pays attention to it.

### 02 — Evidence beats inference

Every claim the AI makes is anchored to a work block, page, artifact, or captured note. If no anchor exists, the AI says so. "I don't know" is a feature, not a failure.

### 03 — Voice, not voiceover

The product writes the way the user writes — dry, direct, a little impatient with its own cleverness. No motivational filler. No "great question." No emojis. No "let's dive into…". The model is a colleague who has been paying attention, not a coach.

### 04 — Local first, sync second

Truth lives in SQLite on the user's laptop. Web companion opt-in. Sync opt-in. Telemetry opt-in and redacted. The product works fully offline forever.

### 05 — Daylens is for one person

No teams, no leaderboards, no sharing-by-default. The reader of every screen is the person who made the data. Other audiences come later, separately, or not at all.

### 06 — Worth opening daily, or cut it

Every view, every notification, every Wrapped slide must justify the user opening it again tomorrow. If a feature does not earn its return visit, it's dead weight. The product is a destination, not a dashboard.

---

## Banned Vocabulary

These never ship in user-facing copy. AI prompts must enforce.

- dive into
- unleash
- navigate the landscape
- this isn't X, it's Y
- in today's fast-paced world
- game-changing
- seamless
- elevate
- great question
- let's explore
- at the end of the day
- fascinating perspective
- you're absolutely right
- harness the power
- empower
- robust
- streamline
- crush it
- you've got this

---

## Mobile

Phone is real. Phone is where the flash of an idea actually happens. But a native iOS app is a six-month detour Daylens cannot afford. The right answer: **layer the phone surface on top of plain file sync.**

| Need on phone | Solution |
|---|---|
| Read today's brief over coffee | iCloud → Obsidian iOS or any markdown reader |
| Capture a thought while walking | Siri Shortcut → vault inbox |
| Voice memo for longer thinking | Voice Memos → Whisper nightly transcribe |
| Ask "what did I work on yesterday?" | daylens-web (responsive) |
| Browse the week's timeline | daylens-web (responsive) |
| Edit a position by hand | Any markdown editor on iOS |

A native phone shell is a v2 conversation, not a v1 problem.

---

## Deliberately Not in Scope

Each of these has been considered. Each has been refused. The refusals are part of the product.

- **Social features.** No public profiles, follower graphs, friend comparison.
- **Public sharing.** No "share your wrap" button. Personal data stays personal.
- **Team analytics.** No team dashboards, no manager view. Daylens becomes surveillance the moment a second person can read.
- **Gamification.** No streaks, badges, focus scores out of 100, leaderboards-against-yesterday. Productivity theatre.
- **Calendar control.** Daylens reads time, doesn't manage it. No scheduling, no blocking.
- **Time billing / invoicing.** Data is here if the user wants to roll their own, but the product is not in that business.

---

## Current Problem Inventory

Specific, in priority order. Use this list to ground the implementation plan.

### P0 — AI quality

- Time/duration questions sometimes fall through to LLM when deterministic routing should handle them. Audit the router; expand deterministic patterns.
- Specific-work questions ("what did I do for X yesterday?") produce vague answers because not enough structured evidence reaches the prompt. Fix evidence assembly before LLM call.
- Follow-up suggestion chips often surface temporal words, generic verbs, or already-asked questions. Add a two-stage filter: stop-list for deterministic candidates, named-entity requirement for LLM candidates.
- Voice drift — motivational filler and generic prose still slip through. Centralise the voice contract; test against golden outputs.
- **Architecture:** `src/main/services/ai.ts` is 4,500+ lines. Extract per-job modules; keep `aiOrchestration.ts` as the dispatcher. Refactor before adding any new job types.
- Add an AI eval harness with at least 30 golden questions, pass/fail counts tracked across releases.

### P1 — Timeline summary

- Replace the right-side day summary with a voicy paragraph + "what mattered" callouts (see Timeline section above).
- Audit which browsers/apps silently miss capture and document or fix.
- Tighten block splitting where 60-minute blocks span obvious context switches.

### P2 — Apps view redesign

- Lead each row with what was accomplished, not totals.
- Group by category of work, not raw minutes.
- App detail panel narrates in 2-3 sentences before any metrics.
- "Sites you're leaking time on" gets its own callout block.
- Demote low-signal apps below the fold.
- Larger row heights, better typography hierarchy.

### P3 — Wrapped

- Replace deterministic slide *content* with AI-narrated content (keep `wrappedFacts.ts` as the data feeder).
- Pin narration to user's actual voice; reuse the centralised voice contract.
- Fix the broken Evening Wrap.
- Weekly Wrapped: feels like a friend asking, not a report card.

### P4 — Distribution

- Sign and publish a Windows installer.
- Resolve Linux browser-history scope (implement or document the boundary).
- daylens-web responsive pass — phone-first reading.

### P5 — Ship verification

- Three real users on macOS and Windows install without friction.
- Each opens the app daily for a week unprompted.
- Each can answer at least 8 of 10 questions from the taxonomy via the AI.
- Each feels the Wrapped is worth opening.

---

## Reporting Format

For any AI-driven implementation pass:
- After each P-level pass, post a short status note: what changed, what's verified, what's still rough.
- Surface what moved from "open" to "code-proven" in the CHANGELOG and in the response to the user; the punch-list itself lives in the next session's prompt.
- Run the AI eval harness; report pass-rate delta.
- If a change touches user-facing copy, paste five real examples in the status note for voice review.

When in doubt about scope, stop and re-read this spec. The five views, the bar for done, the principles, the banned vocabulary, and the not-in-scope list are the boundaries.
