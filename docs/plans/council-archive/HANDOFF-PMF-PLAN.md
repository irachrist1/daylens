> ⚠️ **SUPERSEDED — council process artifact (Round 1/2). Do NOT use for implementation.**
> The canonical, assembled plan is [`../DAYLENS-V2-PLAN.md`](../DAYLENS-V2-PLAN.md). Kept for provenance only.

# Daylens v2 — planning handoff

You are a senior engineer brought in to evaluate Daylens and produce the plan to take it to v2.

Daylens already exists. Most of its features are built but don't work the way they should. `docs/daylens-PMF.md` describes where it needs to be. Your job is to look at how the app **actually** works today, measure that against that vision, and write a plan precise enough that another agent can implement it for days or weeks **without anyone interfering** — knowing what to build, building it, testing it, and landing each feature actually working.

v2 = the PMF vision, reached by fixing, rewriting, or re-implementing what's already here. Not greenfield. Not fixing things for the sake of it. Every change traces back to the vision or to something that's broken.

**Read first:** `docs/daylens-PMF.md` (the vision), `docs/plans/FEATURE-REGISTRY.md` (seed list of every feature: what it Should do vs what it does Now).

---

## How truth works here

The code lies. Features look implemented but don't work. So the code never decides what works — it only explains *why* something fails.

| Source | What it's good for |
|--------|--------------------|
| `docs/plans/screenshots/` | The record of what's broken today. Named; indexed in `FEATURE-REGISTRY.md`. |
| Driving the app yourself | Only if you actually can — see below. Reproduce the screenshots, then find more. |
| `docs/plans/FEATURE-REGISTRY.md` | Starting list of features — incomplete on purpose. Correct it inside your own plan (the file is read-only until Round 3). |
| The founder | Decides anything ambiguous. Ask. |
| The codebase | Why something fails. **Never** proof that it works. |
| `npm test`, `npm run timeline:eval` | Ignore for product truth. Green tests ≠ working product. |

**Be honest about what you can actually see.** First try to launch and drive the app. If you genuinely can — open it, click through it, observe the result — make that your main evidence. If you cannot, do **not** fall back to reading the code and guessing; that's how the earlier plans went wrong. Instead work from the screenshots + the registry + the founder, and for anything you can't confirm, mark it `UNVERIFIED — needs live test` and list it. A feature is **"works"** only with screenshot or live-app proof. The code never earns that label.

---

## How this runs — a model council

Several agents run this in parallel — e.g. Claude, Cursor, Codex, Factory Droid. They're different model families, and that difference is the point: each is strong where another is weak. So instead of trusting one of them to be "the best," they act as a **council** — each writes a plan, each judges all the plans, and the final plan is assembled from whatever the council rated highest. No single agent has to be right, and the founder never has to pick the smartest one.

Three rounds, each started by the founder:

1. **Write — all agents.** Each writes its own plan, independently, then stops.
2. **Judge — all agents.** Once every plan exists, each agent scores *all* of them (its own included), surface by surface, and flags what's wrong or unverified.
3. **Assemble — one agent.** One agent tallies the council's scores and builds the final plan from the top-rated parts. This is mechanical — following the council, not out-thinking it — so it doesn't matter which agent does it.

You are **one** of these agents. Do only the round the founder asks for.

---

## Round 1 — write your own plan

1. **Name yourself** after the tool you're running in — `claude`, `cursor`, `codex`, `droid` (or a unique short slug). That's your filename.
2. Read `docs/daylens-PMF.md` and `docs/plans/FEATURE-REGISTRY.md`.
3. Audit **every** screenshot in `docs/plans/screenshots/`.
4. Try to run the app and push past the screenshots (see "How truth works"). Mark anything you can't verify `UNVERIFIED — needs live test`.
5. For **every feature**: confirm or correct its **Now**, write its full **Should** from the vision. Add features the registry is missing.
6. Write your plan to `docs/plans/Daylens-v2-plan-<your-name>.md` using the template below.

**Rules for Step 1:**
- **Write only your own plan file.** Don't spawn subagents.
- **`FEATURE-REGISTRY.md` is read-only.** Put your corrections and additions *inside your own plan*; Round 3 folds them back in. (Several agents editing one registry at once would collide.)
- **Don't read the other agents' plans.** Independence is the whole point.
- **Don't judge or combine anything yet.** That's Rounds 2 and 3.
- **Stop** once your plan file is written.

### Plan template

```markdown
## Problem Statement
Why the current app fails the PMF vision (docs/daylens-PMF.md), from the user's perspective.

## Solution
What Daylens v2 is — the same vision, actually working.

## Feature map (Should vs Now)
Every feature, expanded from FEATURE-REGISTRY.md:
| Feature | Should (v2) | Now (today) | Status | Evidence (screenshot / app) |

## How each feature should work   ← the core of this plan
For every broken, untrusted, or missing feature, and every PMF surface:
- **Should** — exact behavior, with a real-life example of it working right.
- **Now** — what the user sees today (tie to a screenshot or app observation).
- **Gap** — what's wrong and why it matters for the vision.
- **Fix** — patch, rewrite, or re-implement. Product-level decision, not file paths.
A builder implements from Should and uses Now only to know what to replace.

Surfaces to cover: capture/tracking, timeline, apps view, AI chat & Q&A, memory,
morning brief, evening wrap, daily/weekly/monthly/annual wraps, notifications,
settings (incl. model selection / re-analyze), onboarding, trust.

## User Stories
Long numbered list. "As a <founder/consultant/eng lead/first-time user>, I want
<feature>, so that <benefit>." Cover fixing today's failures, not just new work.

## Implementation Decisions
Per area: what exists, what's wrong, target behavior after the fix, and whether to
modify / rewrite / replace the module. No file paths unless a prototype snippet
(schema, type, state machine) encodes a decision more precisely than prose.

## Testing Decisions
External-behavior tests that prove Should and would have caught today's screenshot
issues. What the building agent runs to verify each feature itself.

## Build sequence (for autonomous execution)
Ordered phases by dependency. Each phase states its acceptance criteria — exactly
how the building agent confirms it works by running the app, so it can move on
without a human. First phase is the first user-visible step toward PMF (likely
trustworthy timeline + morning brief). Sequencing, not a scope cut.

## Out of Scope

## Further Notes
```

---

## Round 2 — judge every plan (the council)

Only when all `Daylens-v2-plan-*.md` files exist and the founder asks for this round.

Read every plan, including your own. Judge on merit — do **not** favor yours; if anything, be harder on it. (The founder may have renamed the files to neutral labels so you can't tell whose is whose — score them the same either way.)

For each PMF surface (capture, timeline, apps, AI chat, memory, morning, evening, wraps, notifications, settings, onboarding, trust) and each cross-cutting section (problem statement, build sequence, testing):

- **Score each plan 1–5** on: **evidence** (screenshot / live-app backed vs guessed from code), **accuracy of Now**, and **clarity + implementability of Should and Fix**.
- Name the **single best plan for that surface**.
- Flag anything to **drop** (called "works" with no evidence, or contradicted by a screenshot) and any **gap every plan missed**.

Write your scorecard to `docs/plans/DAYLENS-V2-PLAN-Council-<your-name>.md`. Don't edit anyone's plan. Stop.

---

## Round 3 — assemble the final plan (one agent)

Only when all `DAYLENS-V2-PLAN-Council-*.md` scorecards exist and the founder asks.

1. Read every scorecard.
2. For each surface, take the plan the council rated highest (most "best" votes, or highest average score) and pull its Should/Now/Gap/Fix into the final plan.
3. Apply every **drop** the council agreed on. Add every **gap** the council flagged as missed, marked as open work.
4. Write the result to `docs/plans/DAYLENS-V2-PLAN.md` using the plan template. Fold the registry corrections from the winning plans back into `docs/plans/FEATURE-REGISTRY.md`.

**Done when** `DAYLENS-V2-PLAN.md` exists, covers every surface with Should/Now/Gap/Fix, and carries an ordered build sequence with per-phase acceptance criteria — detailed enough to implement for days without further direction.

---

## Files

```
docs/plans/
  FEATURE-REGISTRY.md                    ← feature DB: Should vs Now (read-only until Round 3)
  screenshots/                           ← named app screenshots (see registry index)
  Daylens-v2-plan-<your-name>.md         ← Round 1: each agent's own plan
  DAYLENS-V2-PLAN-Council-<your-name>.md ← Round 2: each agent's scorecard
  DAYLENS-V2-PLAN.md                     ← Round 3: the final assembled plan
```
