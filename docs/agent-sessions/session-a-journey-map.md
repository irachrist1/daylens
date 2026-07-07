# Session A — Reconstruct implementation record, then build the interactive user-journey map

**Read `docs/full-audit-2026-07-07.md` in full before starting.** Do not redo work that is
already done (Task 0 below establishes what that is).

---

## Operating doctrine (applies to this whole session)

**Model & effort.** Run as Fable 5 at **HIGH** reasoning effort. Do not use xhigh, max, or
ultra — they over-reason per step, produce overdone code, and cost multiples more without
being smarter. HIGH is the right level. Reasoning effort is per-step thinking, not how long
you can work; long tasks are handled by taking more steps, not thinking harder per step.

**Model routing (defaults, not limits — override with judgment).**
- *Glossary.* **Intelligence** = hardest problem the model handles unsupervised. **Taste** =
  UI/UX, code quality, API design, copy.
- **Fable 5 (you):** best intelligence + best taste, most expensive. Steer everything, own
  final judgment, write/curate anything user-facing.
- **Opus 4.8:** high taste, less intelligent than you, often cheaper than Sonnet 5. Good
  second reviewer for API/UX/code quality.
- **GPT-5.5 via Codex CLI:** high intelligence, low taste, effectively free here — use it
  liberally for bulk reads, log/PDF digging, and computer-use. Because its taste is low,
  have Fable/Opus review any code it writes before it lands.
- Cost is only a tie-breaker. When axes conflict for anything that ships: intelligence >
  taste > cost. Use cheap models to gather info; escalate the moment output misses the bar,
  without asking.

**Shelling out to GPT-5.5 (Codex) — verified working in this env.**
- Reads / analysis / review:
  `codex exec -m gpt-5.5 -s read-only "<self-contained prompt>"`. Effort is set in Codex
  config, **not** a CLI flag — there is no `--effort` (default here is xhigh, fine for GPT-5.5).
  Prompt it simply and literally — it is not Claude, it won't wander. One focused job, the exact
  output you want. If it finds nothing, that's a valid result; don't loop. For an independent
  code review, the native `codex exec review` subcommand also works.
- **There is no Codex computer-use skill installed, and `codex exec` cannot drive a GUI.** Do
  not tell it to launch the app, click through views, or take screenshots — that capability is
  the separate Codex *desktop app*, which is not wired up here. Visual/real-app verification is
  the founder's job (see Verify & hand off).

**Sub-agents vs. workflows.** Fan out independent reads to parallel sub-agents. Write a
workflow (a JS file that stages work and queues later stages from earlier results) when the
task has real stages. To reach GPT-5.5 inside a workflow, spawn a Sonnet-on-low sub-agent
that calls Codex and reports back. Prefix any 5.5-driven sub-agent/task with `[5.5]`.

**Verification rule (non-negotiable).** A deliverable is done only when (1) the file exists
and is correct, (2) it's *confirmed* — headless-validated by the agent (see below) **and**
visually confirmed by the founder, not "tests pass" — and (3) it's committed. Green tests are
not proof. You do not have a browser/computer-use tool, so you do the headless half and hand
the visual half to the founder. If you couldn't verify your half, say so and stop.

**When the ground contradicts the prompt.** This prompt came from an audit and may be stale.
If a path, file, or premise doesn't match the repo, stop and flag it — never invent files or
paths to make an instruction true.

---

## Task 0 — Reconstruct the implementation record (do this first, ~15 min)

Implementation work landed on Jul 6–7 but was never written up. Reconstruct it so every
later session has a truthful "already done" baseline.

1. Read the commits in range `6df04fa..HEAD` (the fix work since the audit began):
   `fad6cc0`, `79512ae`, `8c6f438`, plus the night-repair record `93f5ffb`. Use
   `git show --stat` and read the actual diffs, not just the messages.
2. Write **`docs/implementation-2026-07-07.md`**: for each fix, one line on what changed and
   which file. Then a short **"cross-referenced against the audit"** section mapping each fix
   back to the finding it closes in `full-audit-2026-07-07.md`, so Sessions C/D/F know what's
   already resolved vs. still open.
3. Commit it. This file is a dependency for the other sessions — do not skip it.

---

## Task 1 — The interactive user-journey map (the main deliverable)

Read every file below **in full** before writing anything. Fan the reads out to Codex
(`codex exec --read-only`) or parallel sub-agents — this is exactly the token-heavy read work
GPT-5.5 is for.

- `src/renderer/App.tsx` (routing and view transitions)
- `src/main/lib/onboardingState.ts`
- `src/main/services/onboarding.ts`
- `src/renderer/views/Onboarding.tsx`
- `src/renderer/views/Timeline.tsx`
- `src/renderer/views/Apps.tsx`
- `src/renderer/views/Settings.tsx`
- `src/renderer/views/Insights.tsx`
- `src/main/services/billing.ts`
- `src/main/ipc/billing.handlers.ts`

Then produce **`docs/user-journey.html`** — a self-contained, interactive HTML file showing
the complete user journey as a visual flow diagram. This is a **diagnostic tool**, not a
wireframe: when something breaks in the app, I should be able to open this file and see
exactly where in the journey it sits and what it connects to. Think of it as a Figma-style
map of the whole app across all three platforms.

**The diagram must show:**
- **Every screen** the user sees, in order, from first launch.
- **Every decision point.** Cover at least: has the user granted permissions (per platform)?
  is an API key configured? free tier vs. API-key vs. subscription (both directions)? has
  today been analyzed? did they receive an end-of-day / week / month report? have they used
  Wrapped before? is AI usage being tracked in Billing? does it run on Gemini infrastructure?
  does Apps show correct icons on **mac, Windows, and Linux**? — plus every other
  feature/page gate you find in the code.
- **Every data flow** at each step: what gets written to SQLite, what is sent to the cloud,
  what PostHog event fires (name it).
- **Every dead end**: places where the user gets no feedback, no next step, or hits a broken
  feature.
- **The subscription gate**: where it appears, what it blocks, and what happens if billing is
  unavailable or the user somehow bypasses it.
- **Platform parity**: where mac / Windows / Linux behave differently, show it.

**Color coding (be honest):** green = working, yellow = partial / inconsistent, red = broken
or missing. Do not paint a path green you didn't confirm from the code.

**Technical constraints:**
- Fully self-contained: inline SVG or HTML/CSS only, **no external libraries, no CDN, no web
  fonts**. Must open in any browser offline.
- Nodes are **clickable**: clicking a screen node shows a tooltip with the file name and line
  number where that screen is defined (e.g. `Timeline.tsx:142`).
- Theme-aware is a nice-to-have, not required.

---

## Verify & hand off, then commit

**Agent verification (headless — you have no browser/computer-use tool, so do all of this in
the shell):**
- Validate `docs/user-journey.html` as a file: it must be truly self-contained — grep it for
  any external `http(s)://`, CDN, or web-font reference and confirm there are none; confirm the
  HTML is well-formed.
- Confirm every `file:line` reference in a tooltip points at a line that actually exists
  (cross-check each against the source). Do **not** try to open a browser or screenshot.
- For each node you colored green/yellow/red, cite the source evidence for that verdict — the
  color coding must be defensible from the code, not guessed.
- Confirm `docs/implementation-2026-07-07.md` exists and cross-references the audit.
- Commit both, then append three sentences to `docs/implementation-2026-07-07.md`.

**Founder handoff (visual check — required before "done"):** tell the founder to open
`docs/user-journey.html` in a browser and click through the nodes. Per AGENTS.md, only the
founder marks it done after real inspection. Report it as: "built + headless-verified; needs
founder's browser check."
