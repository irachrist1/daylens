# Wrapped build — stage briefs

The founder's staged build briefs for the Wrapped rebuild, saved verbatim so
later stage sessions start from the same primer. Each stage gets its status
stamped here when it lands.

| Stage | Status |
| --- | --- |
| 0 — Data layer | **Done** 2026-07-08, commit `c60d41e` (renderer-side 0.1 fixes ride uncommitted with the deck rewrite until the founder tests it) |

---

## The primer (read before any stage)

> Before you do anything, read all of these files completely. Do not start
> working until you've read them all.
>
> Codebase:
> - src/renderer/components/DayWrapped.tsx
> - src/renderer/components/PeriodWrapped.tsx
> - src/renderer/components/wrap/WrapDeck.tsx
> - src/renderer/components/wrap/WrapSlideView.tsx
> - src/renderer/components/wrap/GeneratingScreen.tsx
> - src/renderer/lib/wrapDeck.ts
> - src/renderer/lib/dayWrapScenes.ts
> - src/renderer/lib/wrappedFacts.ts
> - src/main/lib/wrappedNarrative.ts
> - src/main/services/wrappedNarrative.ts
> - src/main/services/wrappedPeriodNarrative.ts
> - src/main/db/wrappedNarrativeStore.ts
> - src/main/services/aiTools.ts
> - src/main/services/aiOrchestration.ts
>
> Specs and docs:
> - docs/specs/wrapped.md — the full product spec. This is law.
> - docs/specs/wrapped-agent-plan.md — a previously generated agent plan.
>   Read it but treat it as a reference, not instructions. Your work supersedes
>   it where they conflict.
> - docs/specs/voice.md — how Daylens speaks. Every word in every slide must
>   obey this.
> - docs/full-audit-2026-07-07.md — what's broken and what's been fixed. Read
>   it so you don't re-fix things that are already done.
> - docs/implementation-2026-07-07.md — what's already been implemented.
> - AGENTS.md — how agents work in this repo. Read it and follow it.
>
> Agent setup:
> - You have three sub-agents available: deep-reasoner (Opus 4.8) for hard
>   architecture and taste decisions, fast-worker (Sonnet) for mechanical
>   implementation, and codex-peer for GPT-5.5 review via Codex.
> - Use deep-reasoner for anything that requires judgment. Use fast-worker for
>   boilerplate and clear-spec implementation. Use codex-peer when you need
>   an independent second opinion or a bulk code read.
> - Do not try to do everything in one pass. Fan reads out to sub-agents.
>   Use workflows for tasks that have real stages where one stage feeds the next.
>
> The main thing to understand before touching anything: the Wrapped
> architecture already exists and is more sophisticated than it looks on
> the surface. The slide deck system, the generating screen, the ask-anything
> per slide, and the export are all real. The failure is not structure —
> it's that the data going in is shallow, the AI content coming out is weak,
> and there's no quality bar enforcing either. Every stage in this build
> addresses one of those.
>
> Do not rewrite what works. Do not break the IPC surface. The four channels
> in src/shared/types.ts (ai:get-wrapped-narrative, ai:get-wrapped-period-narrative,
> ai:get-wrap-provider-state, ai:ask-wrapped) stay. The persistence pattern in
> wrappedNarrativeStore.ts stays. Build on top of what's there.
>
> After reading everything, confirm what you've understood and what the current
> state of the stage you're about to work on is, before writing a single line of code.

---

## Stage 0 — the data layer

> This is Stage 0 of the Wrapped build. Read the primer first. This stage is
> the most important one — everything else depends on it. If the data going
> into Wrapped is shallow and wrong, every slide generated from it will be
> shallow and wrong no matter how good the AI is.
>
> Think of this like the ML engineering stage. Before you train anything, you
> clean the data, structure it, and make sure the pipeline is right. That's
> this stage.
>
> --- Sub-phase 0.1: Audit and fix what we already have ---
>
> Read buildDayWrapFacts in src/renderer/lib/dayWrapScenes.ts and the period
> equivalent in src/main/lib/wrappedPeriodNarrative.ts line by line. For every
> single field in the facts object, verify it against the real database. Is
> this number correct? Does it match what's in daylens.sqlite? Is it
> double-counted anywhere? Are app totals going through the reconciliation
> layer or are they raw sums?
>
> Fix anything wrong. A wrong number in the facts object becomes a wrong
> sentence on a slide. That's the fastest way to break user trust.
>
> Also look at what's in the database but not being used. Window titles are
> stored in app_sessions and they're rich — they contain project names, file
> names, document titles, branch names. Right now we're ignoring most of this.
> Extract semantic context from window titles and make it a first-class field
> in the facts object. Something like: for each app block, group the window
> titles into semantic clusters that describe what the user was doing (not the
> raw titles — humanized descriptions of what the titles suggest).
>
> --- Sub-phase 0.2: External source connectors ---
>
> The goal here is to give the AI a picture of what the user actually produced,
> not just how long they stared at apps. Build these as optional, independent
> connectors that run in the background and store their results in a new
> external_signals table in the database, keyed by date. Each connector is
> completely optional — if it's not available or the user hasn't granted
> permission, skip it silently and proceed without it.
>
> Build these two first (Mac and Windows, Linux comes later):
>
> Git/GitHub connector: scan the user's active directories for .git folders.
> Read the commit log for today — which repos were touched, how many commits,
> what the commit messages say. If the user has the gh CLI installed, also pull
> PR activity for today (what was opened, reviewed, merged). Store this in
> external_signals. This turns "4 hours in Cursor" into "wrote commits to the
> billing service and opened a PR."
>
> Calendar connector: on macOS, read today's calendar events via the Calendar
> framework or the icalBuddy CLI if available. On Windows, use the Windows
> Calendar API. What we want: meeting names, durations, attendee count (not
> names). This separates deep work time from meeting time, which is one of the
> most useful things Wrapped can tell someone.
>
> Also scan for locally installed MCP servers by checking the Claude Desktop
> config at ~/Library/Application Support/Claude/claude_desktop_config.json on
> macOS (and the Windows equivalent). Don't call them yet — just discover what's
> installed and surface it in Settings as optional enrichment sources the user
> can enable. Notion MCP, Linear MCP, Jira MCP — if they have these, their
> Wrapped can eventually be much richer.
>
> Check for focus apps (Raycast Focus, Be Focused, Session) and read their
> logs if accessible. Store what you find in external_signals.
>
> Track which external sources were used for each day in PostHog — not the
> data itself, just which connectors fired. This tells us what to prioritize
> building further.
>
> --- Sub-phase 0.3: Build the AI tool layer ---
>
> Right now Wrapped calls the LLM once with a big prompt and hopes the response
> comes back in the right structure. This is fragile and shallow. Instead, build
> a proper set of tools the AI can call to pull exactly the data it needs.
>
> Create src/main/services/wrappedTools.ts with these tools. Each is a typed
> TypeScript function, tested against the real database, accessible both to the
> in-app AI and to the MCP server:
>
> - getWindowTitleContext(date, appName): returns the window titles from that
>   app on that day clustered into semantic groups. Not raw titles — grouped
>   descriptions like "billing service work (6 sessions)" or "Settings UI (3
>   sessions)". The clustering should use the same humanization logic as the
>   timeline block naming.
>
> - getGitActivity(date): returns commit count, repos touched, commit messages
>   (sanitized — no file paths or branch names in the raw form), and PR activity
>   if gh CLI is available. Returns null gracefully if git is not available.
>
> - getCalendarEvents(date): returns meeting names, durations, and attendee
>   counts for the day. Returns null if calendar access isn't available.
>
> - getDayComparison(date): returns this day's tracked time vs the 7-day
>   rolling average and vs the same weekday last week. This is how we say
>   "this was a long one" with actual evidence.
>
> - getLongestFocusStretch(date): returns the longest unbroken focused block —
>   start time, end time, duration, and the primary app. This is one of the
>   most interesting data points for any day.
>
> - getDistractionProfile(date): returns the split between time spent in
>   high-distraction and low-distraction apps and sites, plus which distraction
>   sites appeared and for how long.
>
> - getMostSurprisingFact(date): returns the single most likely-to-surprise
>   data point for the day — the app the user forgot they used, the time they
>   didn't realize they spent, the unusually early or late session, the longest
>   stretch. Use judgment about what's genuinely surprising vs expected. Ask
>   me (using the ask tool) if you're unsure what the right heuristic is here.
>
> If you identify additional tools that should exist based on what you found
> in the codebase and the database, build them and document why.
>
> Write unit tests for every tool against the real database. Not mocks — real
> data. Run them. Show the output.
>
> --- Sub-phase 0.4: Data quality gate ---
>
> Before any Wrapped generation starts, run a pre-flight check. If any of
> these are true, show the user a warning (not a failure — they can still
> proceed):
>
> - The day has less than 2 hours of tracked work time
> - The day hasn't been analyzed yet
> - More than 30% of the app sessions for this day have no window title
> - The most recent session ended more than 2 hours ago and it's a live day
>
> The warning should be honest and specific: "We're missing window titles for
> 60% of your sessions today — the wrap will be less detailed than usual." Not
> a generic error. Show what's missing so the user understands why.
>
> None of these block generation. The user can override with a single tap.
>
> --- Done when ---
>
> Every field in the facts object is verified correct against the real database.
> Window title semantic context is extracted and available as a first-class field.
> The Git and Calendar connectors are built, tested, and storing results in
> external_signals. All seven tools exist in wrappedTools.ts with passing tests
> run against real data. The data quality gate is live and showing accurate
> warnings. Everything works on both Mac and Windows.
>
> Commit everything. Run npm run typecheck. Show that it passes before you
> consider this done.

### Stage 0 outcome (2026-07-08)

Shipped in `c60d41e`. Founder decisions made during the stage: commit scope =
Stage-0 files only (deck-rewrite-interleaved renderer files stay uncommitted
until the founder tests the rewrite); surprise heuristic = deviation from the
user's own baseline with a minimum-surprise floor (a boring day returns null).
Root-cause record: `docs/findings.md` § 2026-07-08. Later stage briefs get
appended below as they arrive.
