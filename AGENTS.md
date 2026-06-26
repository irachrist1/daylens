# Daylens — how agents work here

Read this first. Then read [`PRODUCT.md`](PRODUCT.md) (what Daylens is and what good looks
like), the behavior specs in [`docs/specs/`](docs/specs/), and
[`docs/findings.md`](docs/findings.md) (root causes we've already dug out — read it so you
don't re-learn them). That is the whole map. There is no Linear queue and no build-packet
plan to follow: you work directly with the founder on what's in front of you, committing to
`main`.

## Ask, don't assume

The most expensive mistakes in this repo came from an agent that was sure it knew. When the
request is ambiguous, when the spec is silent on something that changes the outcome, or when
you're about to act on a sub-agent's claim — stop and ask, or verify against the real data
(`daylens.sqlite`) and the real code first. A wrong assumption confidently executed costs
more than a question. Surface what you're unsure of; never paper over it.

## The invariants — the physics

Laws the app always obeys; never break one to ship a feature. Each feature spec restates the
ones it owns. The cross-cutting set:

1. One block = one stretch of one intent. Apps are evidence inside a block, never a boundary.
2. Brief detours are absorbed; a short off-task glance folds into the surrounding work.
3. Same-intent neighbours merge into one block.
4. Block height = duration, always.
5. A block is never named after a raw window title, file, repo, or app — the name says what you did.
6. A single off-task tab never sets a block's category.
7. One truth, three views: Timeline, Apps, and AI read the same block facts; totals reconcile.
8. Your corrections always win and survive every rebuild.
9. No grades — no Score, no Focus, no Drift.
10. When Daylens doesn't know, it says so; it never fills a gap with a guess.
11. System noise (loginwindow, Finder, screensaver) is invisible and never counts as time.
12. Every AI surface uses the model picked in Settings; none secretly switches.

## How to work

1. **Understand before you change.** Read the relevant spec and the real code; check the
   real data in `daylens.sqlite`. Fix the foundation, not the symptom (below).
2. **Work on `main`.** Commit straight to `main`, or a short-lived branch you merge back the
   same session. Keep `main` green: typecheck and tests pass on every commit.
3. **Build it.** Make reasonable calls when the spec is silent and write down why. Delete the
   legacy code you replace — don't leave it lying next to the new path.
4. **Verify for real.** Green tests are the floor, not the proof. Drive the app and see the
   change (the quality gate, below).
5. **Hand it to the founder to test.** The founder's only job is to test; everything up to
   the test is yours. Only the founder marks something done, after a real day.

## Fix the foundation, not the symptom

When something reads wrong on screen, the bug is almost never where it shows. A wrap that
"feels flat", a timeline that "makes no sense" — the cause is usually a layer down: the
blocks, the capture, the names. Diagnose bottom-up (capture → blocks → naming → words) and
check against `daylens.sqlite` before touching code. Patching the copy on top of wrong data
is still wrong. When fixing the named feature means repairing the timeline or tracking engine
underneath it, repair it; that is the job, not scope creep. Record what you find in
[`docs/findings.md`](docs/findings.md) and leave a regression test, so the next person
inherits the cause, not just the patch.

## The quality gate — green tests are not truth

`npm run typecheck` must pass; that's the floor. Green `npm test` does **not** mean the
feature works — the only proof is the running app. Drive it (`npm start`, or the headless
CDP method), look at the actual screen, and if you can't verify something visually, say so
plainly. "I couldn't reproduce this on a live day" is a real answer; a false "it works" is
not.

## Design — ask before you invent a look

Specs define behavior, not aesthetics. If a change involves visual or UX design — a new
screen, the wrap carousel, onboarding — stop and ask the founder for reference screenshots
before building the look. Touchstones: **Raycast** (clean, native, keyboard-first), **Dia**
(the brief's voice), **Spotify Wrapped** (the wraps). Functional behavior never waits; the
look does.

## Language

Plain English. No honorifics, no agent-speak, no walls of text. Write like the specs are
written: short, specific, grounded. Say what changed and what to test. That's it.

## Commands that need human approval

These cost money, mutate data, or hit the AI providers — never run them without explicit
approval: `npm run test:behaviour`, `npm run ai:bench`, `npm run test:toolcalls`,
`npm run test:entity-prompts`, regenerating reports/wraps, and work-memory backfills.
Always safe, no approval needed: `npm run typecheck`, `npm test`, `npm start`, reading code,
taking screenshots.
