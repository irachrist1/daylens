# What actually blocks V2

Read this before claiming any Daylens V2 work. It exists because agents keep
choosing backend and architectural work over the user-facing failures that stop
people from using the app. The foundation is not the headline. These are.

## The rule

A change ships V2 only if it moves a line in the owner's acceptance dossier
toward passing. The dossier is the sole authority:

- `~/Desktop/daylens/ACCEPTANCE.md` — the graded pass/fail list, per surface.
- `~/Desktop/daylens/INDEX.md` — every observed failure, expected behavior, and
  the reference screenshots, tab by tab.

Grade your change against ACCEPTANCE.md, not against a ticket you find
convenient. If a foundational or architectural task is not the direct cause of a
failing acceptance line, it is not V2 work — record it and leave it.

## The failures that block use, in phase order

Each is a filed ticket sitting in Backlog. They are the product, not a backlog
to drain after "foundations." Phase order is the intended sequence.

### Phase 2 — Timeline
- **DEV-233** Merging blocks does nothing — no merge, no error, no feedback. A
  core advertised action is silently broken. (Decided: remove the
  across-absence merge rule; if any real blocker exists, say so in plain words
  at the click and still offer merge-anyway.)
- **DEV-232** Continuous work splits into fragment/duplicate blocks. (Decided
  policy: live = one giant block spanning laptop-on time, split only at real
  absence/sleep/idle; it splits into labeled blocks only when the user clicks
  Analyze-day-with-AI, gated at ≥2h tracked time, or the day rolls over.)
- **DEV-234** Overlapping events and filtered blocks are unreadable. Events must
  render side-by-side with blocks like Google Calendar (`16-reference-google-calendar/`);
  a filter highlights matches without stacking dimmed text.
- Also in this phase (see INDEX §01): live blocks renaming themselves, the
  never-dismissing "attended" toast, re-analyze reporting work it didn't do,
  day/week zoom, in-place week-view event popup.

### Phase 3 — Apps
- **DEV-237** "What you did there" summaries are wrong and meaningless — the core
  purpose of the view. Notion renders raw JSON on screen; Safari shows nothing
  for tracked time; generated titles are wrong. Rebuild it against the
  per-domain/per-page breakdown pattern (Comet/Dia). No raw JSON, ever.
- Also (INDEX §02): 30-day scroll/Generate freezes, large unattributed browser
  time, junk strings shown as pages, duplicate app rows, wrong icons/ranking.

### Phase 4 — AI chat
- **DEV-246** The first numeric answer is wrong (10m vs the real 3h43m, same
  local data). Most users won't push back; they trust the wrong number.
- **DEV-242** Model/provider state contradicts across the app — Settings says
  connected, the picker says not installed; chats run a stale model. One source
  of truth, shown identically in both places.
- **DEV-244** Tool activity is a wall of file chips ("what the AI saw"); the full
  context packet attaches to every message, including "hi." Collapse to a
  one-line summary that expands on demand (Codex pattern, `12-reference-codex/`).
- **DEV-243** The AI tab shows "Loading AI…" on a blank screen for seconds. Open
  instantly.
- Also (INDEX §03): no calendar or Granola tool is registered for chat, so it
  can't answer "what's on my calendar tomorrow?"; tone and clarity need work.

### Phase 5 — Recaps & wraps
- **DEV-247** Recaps are inaccurate and contradict themselves (header total vs
  its own prose; raw date strings ranked as activities).

## Cross-cutting: the UX is cluttered everywhere

Timeline, Apps, AI, and Settings are word-dense and bloated with no UX payoff —
documented per tab in INDEX and in ACCEPTANCE ("Every settings page says what it
does in plain words, without paragraphs of filler"). The app should do things,
not describe them. Declutter is part of each phase above, not a separate later
pass. Fewer words, clearer surfaces.

## The anti-pattern to stop

From the owner, about agents on this project: they avoid the complex, important,
user-facing work and default to backend/architectural changes that are not on
the V2 plan or the acceptance criteria. Do not do this. When a task feels
architectural, check it against a failing ACCEPTANCE.md line first; if it does
not trace to one, it is not the work.
