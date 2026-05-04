# Daylens Wrapped — Implementation Spec

Status: Ready for implementation planning  
Last updated: 2026-05-04

---

## What this document is

This is the implementation spec for redesigning Daylens Wrapped.

The goal is not to make Wrapped prettier. The goal is to make Wrapped feel like Daylens actually understood the user's day.

Wrapped should be:
- instant
- accurate
- personal
- evidence-backed
- warm
- AI-enhanced when available
- still useful without AI

This spec should be implemented strategically in 3 stages so the feature is not rebuilt blindly or rushed into a fragile state.

Before coding, inspect the real codebase, documentation, settings, AI layer, tracking data, Wrapped components, and tests. Do not assume file names or architecture.

---

# 1. Core product goal

Wrapped should feel like a prepared story of the user's day, not a generic dashboard.

Bad:

> You were a researcher today.

Better:

> Chrome carried 2h 40m of your day, but most of that was YouTube, not research.

Bad:

> You were focused 74% of the time.

Better:

> Your best focus came after lunch. The morning was mostly meetings and switching, but from 3:10 to 5:25 you stayed in one coding flow.

Bad:

> Your day is wrapped.

Better:

> You started with meetings from 9:00 to 11:00, shifted into coding before lunch, slowed down around 2:00, then came back for your clearest build session in the afternoon.

But only say things like this when the data supports them.

If the data is weak, Wrapped should say that clearly.

---

# 2. Key principle

AI should not invent the user's day.

The deterministic data layer must produce grounded facts first.

AI, when available, should only turn those facts into a more natural and personal narrative.

The architecture should be:

1. Raw tracking data
2. Deterministic Wrapped facts layer
3. Deterministic fallback copy
4. Optional AI narrative layer
5. UI slides

AI is a storytelling upgrade, not the source of truth.

---

# 3. Current known issues

The current Wrapped experience has these problems:

1. It can show with too little tracked data.
2. It gives generic insights.
3. It overclaims identity.
4. It treats all browser activity too broadly.
5. It does not reconstruct the actual rhythm of the day.
6. It does not use AI meaningfully even when AI is enabled.
7. It lacks evidence for strong claims.
8. It does not handle edge cases explicitly.
9. Visuals can look polished while the insights remain shallow.
10. It does not feel prepared or instant enough.

---

# 4. Before coding, audit the codebase

Before implementing, inspect and summarize:

- where Wrapped data comes from
- what payload fields exist today
- how sessions are represented
- how blocks are represented
- how websites/domains are represented
- how categories are represented
- how focus is computed
- how app usage is computed
- how current slides are selected
- how current copy is generated
- how current gradients and animations are structured
- how identity labels are currently derived
- how morning/yesterday mode works
- how notifications currently work
- whether there are notification preferences
- how settings work
- whether AI can be enabled by users
- where API keys are stored or checked
- how existing AI reports work
- whether there is already an AI request abstraction that should be reused
- whether there is already local caching or storage suitable for Wrapped facts or AI output
- what tests, fixtures, linting, typecheck, and build commands exist

Do not implement until this audit is complete.

The final implementation should fit into the existing codebase. Do not create a parallel AI system, settings system, notification system, or storage system if one already exists.

---

# 5. Wrapped should feel prepared

Wrapped should not behave like this:

1. User clicks Wrapped.
2. Blank/loading screen appears.
3. AI generates everything.
4. User waits.

That will feel slow and fragile.

Wrapped should behave like this:

1. Daylens tracks the day.
2. Once enough data exists, it computes deterministic Wrapped facts.
3. If appropriate, Daylens can notify the user that Wrapped is ready.
4. When the user clicks, Wrapped opens instantly with deterministic stats and slides.
5. If AI is enabled and configured, AI enriches the narrative in the background.
6. If AI fails or is disabled, the deterministic Wrapped still feels complete.

The user should never be blocked by AI.

---

# 6. The three layers of Wrapped

## 6a. Instant deterministic layer

This must always work.

It should use local tracked data to immediately show:

- data quality state
- total tracked time
- first activity
- last activity
- top apps
- top domains
- category mix
- focus pattern
- best stretch
- context switching
- simple deterministic day summary

This layer must be fast, local, and available without AI.

## 6b. Prepared facts layer

Create a grounded facts object that can be computed from real tracking data.

It should include:

- date
- data quality
- total tracked time
- first activity time
- last activity time
- sessions
- blocks
- app usage
- domain usage
- category breakdown
- focus windows
- best stretch
- context switches
- switches per hour
- morning pattern
- afternoon pattern
- evening pattern
- distraction/domain interpretation
- identity candidate
- identity confidence
- claim confidence notes
- warnings about uncertain claims

This facts object should be used by both deterministic copy and AI copy.

If the existing architecture supports caching or memoization, cache it.

The facts object should be invalidated or recomputed when underlying day data changes enough to matter.

## 6c. AI narrative layer

Only use AI if:

- AI is enabled in settings
- the user has a valid API key or provider configured
- existing privacy/settings behavior allows sending the data
- the app is online
- the AI request succeeds

AI must not be required.

AI should receive a compact structured facts object, not raw unrestricted logs.

AI should generate structured output, not uncontrolled freeform text.

Suggested output shape:

```json
{
  "headline": "short truthful headline",
  "dayNarrative": "2-4 sentence grounded story of the day",
  "slideCopy": {
    "overview": { "title": "...", "body": "..." },
    "focus": { "title": "...", "body": "..." },
    "apps": { "title": "...", "body": "..." },
    "identity": { "title": "...", "body": "..." },
    "closing": { "title": "...", "body": "..." }
  },
  "confidence": "low | medium | high"
}
````

AI output must be validated before display.

Reject or ignore AI output if it:

* invents meetings
* invents lunch
* invents project names
* changes numbers
* contradicts deterministic facts
* calls YouTube research
* makes unsupported emotional judgments
* says the day was great without evidence
* compares to previous days without historical data
* returns malformed or empty content

If validation fails, use deterministic copy.

---

# 7. AI and non-AI users

Users without AI should not get a second-class Wrapped.

For users without AI enabled, Wrapped should still:

* open instantly
* show useful deterministic insights
* reconstruct the day as much as possible
* use actual apps, domains, block labels, and time windows
* avoid generic copy
* never say “AI required”
* never aggressively pressure the user to enable AI

A subtle optional CTA is acceptable only if it fits existing product language, for example:

> AI can make future recaps more narrative.

But the core experience must feel complete without AI.

For users with AI enabled, AI should make Wrapped more personal, not more speculative.

Good AI behavior:

> Your morning opened with meetings, then shifted into Cursor and GitHub. The middle of the day got noisy with browser switching, but your clearest stretch came later in the afternoon when coding took over.

Bad AI behavior:

> You had an amazing productive day and crushed your goals.

---

# 8. Notification strategy

Wrapped can notify the user only when there is enough meaningful data.

Do not notify for empty or weak data.

Possible notification moments:

* after a strong work session ends
* when the day has enough tracked activity for a real recap
* in the evening when current-day Wrapped is ready
* the next morning for yesterday’s recap, only if yesterday has enough data

Possible notification copy:

* “Your day is ready.”
* “Your work story is ready.”
* “Your afternoon focus recap is ready.”
* “Yesterday’s work story is ready.”
* “You had a strong coding stretch today. See your Wrapped.”

Avoid spam:

* do not notify repeatedly for the same day
* do not notify if the user dismissed Wrapped recently
* do not notify for low-quality data
* respect existing notification settings
* do not introduce notifications if the user has disabled notifications
* do not create a new notification system if one already exists

When clicked, the notification should open Wrapped instantly with deterministic content.

If AI is available, personalization can continue in the background.

---

# 9. Data quality and gating

Add a clear data quality concept.

Likely values:

* empty
* tooEarly
* partial
* full
* completedDay or yesterday, if the app already distinguishes those modes

Use named constants for thresholds.

Do not scatter magic numbers across components.

Example starting points:

* empty: less than 5 minutes
* partial: less than 45 minutes
* full: 45 minutes or more

These are tunable hypotheses, not permanent truth.

Handle:

* no tracked time
* only a few minutes tracked
* partial current day
* yesterday with no work
* sessions but no blocks
* blocks but no websites
* websites but weak labels
* missing or generic block labels

Example copy:

0 tracked seconds:

> Nothing tracked yet today.
> Daylens needs some activity before it can tell the story of your day.

8 minutes tracked:

> Too early to tell.
> Daylens has only tracked 8 minutes so far. Check back after a real session.

Partial day:

> Still early.
> So far, most of your time has been in Cursor and Chrome.

Definition of done:

A user with almost no data does not see fake insight.

---

# 10. Grounded fact extraction

Create a deterministic Wrapped facts layer.

This layer should derive as much as possible from existing data:

* total tracked time
* first activity time
* last activity time
* top apps
* top domains
* top categories
* category breakdown
* focus time
* focus percentage
* focus windows
* peak focus period
* longest session or block
* context switches
* switches per hour
* morning pattern
* afternoon pattern
* evening pattern
* meeting-heavy periods
* coding-heavy periods
* communication-heavy periods
* browser-heavy periods
* distraction-heavy periods
* idle or quiet gaps, if supported
* confidence level for each major claim

Important rules:

* Do not call something a lunch break unless the data strongly supports it.
* If there is only a gap, call it a quiet gap or break in tracking.
* Do not say the user was researching unless the evidence supports research.
* Do not say the user was focused unless focus data supports it.
* Do not say the day was great unless the data supports a positive interpretation.

Each insight should have:

* claim
* supporting data
* confidence
* fallback copy if confidence is low

---

# 11. Browser and domain interpretation

Browser activity must not be treated as one generic category.

Use available website/domain data where possible.

Create or improve a Wrapped-specific domain classification layer.

Do not change core app categories unless the existing architecture clearly supports that.

Domain groups to consider:

* developer documentation
* code platforms
* search engines
* AI tools
* work tools
* productivity tools
* email
* communication
* learning
* video
* entertainment
* social media
* shopping
* news
* unknown

Examples:

* GitHub, Stack Overflow, docs sites, framework docs can support development or research.
* YouTube should not automatically count as research.
* Gmail and Outlook support email or communication.
* Slack and Teams support communication.
* Figma supports design.
* Cursor, VS Code, terminals, Git tools support development.
* ChatGPT, Claude, Perplexity, Gemini, Cursor AI features, or similar tools can support AI-assisted work depending on existing app data.
* Unknown domains should stay unknown instead of being forced into a confident label.

If top app is Chrome and top domain is YouTube:

> Chrome led the day, but most of that time was YouTube.

If Chrome was mostly docs, GitHub, and Stack Overflow:

> Chrome supported your build work today: mostly GitHub, docs, and Stack Overflow.

Definition of done:

A YouTube-heavy day is never mislabeled as research.

---

# 12. Identity with confidence

Identity should be earned, not assigned.

Replace forced identity labels with confidence-aware identity.

Identity should consider:

* total tracked time
* app usage
* website/domain usage
* category mix
* focus time
* distraction time
* context switches
* day length
* whether the day has enough signal

If confidence is low, do not show a strong identity.

Use soft alternatives:

* “a mixed day”
* “mostly browsing”
* “a light work day”
* “not enough signal yet”
* “communication led the day”
* “coding carried the afternoon”

Do not call someone:

* Researcher
* Builder
* Designer
* Writer
* Operator

unless the evidence supports it.

If the claim is research, show evidence:

* documentation domains
* search or reading sessions
* research category
* relevant block labels
* low distraction ratio

Avoid harsh labels:

* lazy
* failed
* bad
* addict
* drifter as a direct identity label

Prefer:

* “time drifted today”
* “the day was scattered”
* “your signal was light”
* “not much to conclude yet”
* “you found your rhythm late”

Definition of done:

Identity feels earned, not forced.

---

# 13. Show your work

Every strong claim must show visible evidence.

Examples:

“Builder” should show:

* development percentage
* top coding apps
* time window
* relevant block or session

“Best stretch” should show:

* start time
* end time
* duration
* app or block label

“2h on YouTube” should show:

* domain
* duration
* share of tracked time if useful

“Meetings shaped the morning” should show:

* meeting app
* time window
* duration

If a slide cannot show the evidence, soften the claim or hide the slide.

---

# 14. Slide strategy

Do not keep slides only because they already exist.

Keep or create slides only when they say something useful and true.

Possible slide set:

1. Day overview
   Reconstruct the rhythm of the day.

2. Time scale
   Total tracked time, first activity, last activity, current/completed state.

3. Focus pattern
   When focus happened, not just a percentage.

4. Best stretch
   Longest meaningful session or block.

5. Where time went
   Top apps and top domains.

6. Category mix
   Coding, meetings, writing, communication, AI tools, browser, etc.

7. Context switching
   Switches per hour, not only raw switch count.

8. Identity
   Only if confidence is high enough.

9. Distraction or drift
   Only if supported by data and phrased kindly.

10. Closing insight
    One memorable, specific truth from the day.

Each slide should answer:

> What data supports this?

If it cannot answer that, remove it, hide it, or rewrite it.

---

# 15. Copy system

Move away from generic template copy.

Use a content matrix approach:

* clear conditions
* clear copy
* clear fallback
* confidence-aware wording

Examples:

Partial:

> Still early.
> Daylens has enough to show where the day started, but not enough to call the whole day yet.

Meetings dominate morning:

> Meetings shaped the morning.
> Your first stretch was mostly calls and communication.

Coding dominates afternoon:

> Coding took over after lunch.
> Cursor and GitHub carried your longest work stretch.

Browser mostly YouTube:

> Browser time drifted.
> YouTube was your top domain today.

Browser mostly docs:

> Browser time supported the work.
> Docs, GitHub, and Stack Overflow were the main places you spent time.

Focus peaked late:

> You found your rhythm late.
> Your clearest work came in the afternoon.

Scattered day:

> A scattered day.
> You switched often, and no single work mode held for long.

Short day:

> A light day.
> There is not enough tracked time to say much more.

Tone rules:

* honest
* warm
* specific
* not judgmental
* not motivational fluff
* not fake praise
* not a productivity grade

---

# 16. Visual system

Visual polish comes after truth.

Improve:

* gradient variation
* slide-specific visual mood
* category-to-color mapping
* animation variety
* visual freshness across repeated days
* performance

The same category should not produce the exact same-looking Wrapped every day.

Focused days, scattered days, meeting-heavy days, coding-heavy days, and distraction-heavy days should feel visually different.

Do not use visuals to hide weak insights.

---

# 17. Caching

If existing architecture supports local caching, cache:

* deterministic facts object
* AI narrative output

Cache key should consider:

* date
* facts hash
* data quality
* AI provider/model if relevant
* Wrapped schema version
* prompt version

If day data changes significantly, regenerate facts.

If AI output becomes stale because facts changed, either regenerate in background or fall back to deterministic copy until fresh AI output is ready.

Never show stale AI narrative that contradicts current deterministic facts.

---

# 18. Edge cases

Handle and test:

* no sessions
* no blocks
* no websites
* sessions but no blocks
* blocks but generic labels
* only browser usage
* mostly YouTube
* mostly entertainment
* mostly meetings
* mostly coding
* mostly design
* mostly writing
* mostly AI tools
* mostly communication
* single-app day
* unknown apps
* unknown domains
* uncategorized activity
* system activity dominant
* very short day
* very long day
* partial current day
* completed previous day
* yesterday with no tracked work
* missing start times
* missing end times
* overlapping sessions
* sessions crossing midnight
* timezone boundaries
* invalid AI key
* AI disabled
* AI enabled but request fails
* offline mode
* malformed AI output
* morning mode
* current-day mode
* notifications disabled
* notification clicked before AI finishes
* AI output arrives while user is viewing slides

---

# 19. Three-stage implementation plan

## Stage 1 — Foundation and truth layer

Goal:

Make Wrapped accurate before making it magical.

Build:

* audit current implementation
* introduce Wrapped facts layer
* add data quality gating
* add empty and partial states
* derive first/last activity
* derive top apps
* derive top domains
* derive category breakdown
* derive focus windows where possible
* derive switches per hour
* classify browser/domain usage
* fix identity confidence logic
* remove misleading browsing → Researcher behavior
* explicitly handle no sessions, no blocks, no websites, unknown categories
* add deterministic fallback copy based on facts

Do not build AI narrative yet.

Do not do major visual polish yet.

Definition of done:

* Wrapped never shows fake insight for weak data
* empty and partial states work
* deterministic full Wrapped is specific and evidence-backed
* YouTube-heavy days are not called research
* identity is confidence-aware
* key edge cases are handled
* typecheck/lint/tests/build pass

## Stage 2 — Prepared experience, AI narrative, and notifications

Goal:

Make Wrapped feel instant and prepared, with AI enrichment when allowed.

Build:

* prepared facts computation path
* caching or memoization if supported by existing architecture
* AI availability check from existing settings and API key state
* AI prompt builder from facts object
* AI structured output schema
* AI output validation
* deterministic fallback when AI is disabled, unavailable, slow, invalid, offline, or malformed
* non-blocking AI enrichment after Wrapped opens
* optional subtle “personalizing your recap…” state if appropriate
* notification readiness rules
* notification click behavior opens deterministic Wrapped instantly
* prevent repeated/spam notifications
* respect notification preferences
* cache AI output if appropriate
* invalidate AI output when facts change significantly

Definition of done:

* Wrapped opens instantly
* AI never blocks the UI
* users without AI get a complete experience
* users with AI get richer narrative
* AI output is grounded and validated
* notifications only appear when Wrapped has enough data
* notification click opens Wrapped reliably
* typecheck/lint/tests/build pass

## Stage 3 — Slide redesign, visual polish, and full validation

Goal:

Make the final experience feel polished, memorable, and cohesive.

Build:

* final slide set
* content matrix for each slide
* day overview narrative slide if appropriate
* top apps/domains breakdown
* focus pattern slide
* best stretch slide
* category mix slide
* context switching slide
* confidence-aware identity slide
* closing insight slide
* visual variation by category, date, and slide
* slide-specific visual mood
* animation variety
* visual QA for focused, scattered, meeting-heavy, coding-heavy, and distraction-heavy days
* fixtures or tests for all major edge cases
* full regression testing

Definition of done:

* full Wrapped feels personal and specific
* every slide shows or implies its evidence clearly
* visuals support the content
* repeated days do not feel visually identical
* all major edge cases are tested
* no unrelated behavior is broken
* typecheck/lint/tests/build pass

---

# 20. What this redesign does not include

* no sharing features
* no new database tables unless the existing code proves they are required
* no new AI system if one already exists
* no new settings system if one already exists
* no user-configurable thresholds yet
* no unsupported historical comparisons
* no productivity scoring
* no harsh moral judgment
* no generic motivational fluff

---

# 21. Final definition of done

The redesign is complete when:

* Wrapped opens instantly
* Wrapped does not show fake insight when there is too little data
* partial days get partial treatment
* full days feel richer and more specific
* deterministic mode feels complete
* AI-personalized Wrapped works only when enabled and configured
* AI never blocks Wrapped
* AI output is grounded, structured, validated, and cached if appropriate
* browser-heavy days are interpreted through domain data where possible
* YouTube-heavy days are not mislabeled as research
* identity claims are confidence-aware
* slides show specific evidence
* the day feels reconstructed, not summarized generically
* notifications are useful, not spammy
* users without AI still get a strong experience
* visuals feel fresh and connected to content
* all available validation commands pass

---

# 22. Final implementation reminder

Before coding:

1. Read docs and project instructions.
2. Audit the current Wrapped implementation.
3. Identify what data exists and what is missing.
4. Identify how AI settings and API keys currently work.
5. Identify how notifications currently work.
6. Identify how caching/storage should fit into the existing architecture.
7. Produce a short implementation plan based on the real code.
8. Implement in 3 stages.
9. Validate each stage before moving to the next.
10. Summarize files changed, tests run, and remaining limitations.
